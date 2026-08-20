window.StudioScheduleModule = (() => {
  const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const asScheduleDate = value => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(raw) ? `${raw.replace(' ', 'T')}:00Z` : raw;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const scheduleParts = value => {
    const match = String(value || '').trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
    return match ? { date: match[1], time: match[2] } : null;
  };
  const dayKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const inputDate = value => value ? String(value).replace(' ', 'T').slice(0, 16) : '';
  const displayDate = value => {
    const parts = scheduleParts(value);
    if (!parts) return 'Data por confirmar';
    return new Intl.DateTimeFormat('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${parts.date}T12:00:00Z`));
  };
  // Os horários são guardados como hora local de Lisboa. Nunca converter para UTC aqui.
  const displayTime = value => scheduleParts(value)?.time || '—';
  const monday = value => { const date = new Date(value); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); return date; };
  const shiftDays = (date, amount) => { const next = new Date(date); next.setDate(next.getDate() + amount); return next; };
  const localInput = date => { const offset = date.getTimezoneOffset(); return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16); };

  function mount(root, options) {
    let week = monday(new Date());
    let appointments = [];
    let clients = [];
    let selected = null;
    let draft = null;
    let google = { configured: false, connected: false };
    let googleCalendars = [];
    let bookingServices = [
      { id: 'studio-engineer', title: 'Sessão de Estúdio (Captação com engenheiro)', pricePerHour: 20, active: true },
      { id: 'studio-art-direction', title: 'Sessão de Estúdio (Captação com engenheiro + Direção Artística)', pricePerHour: 30, active: true },
      { id: 'studio-rental', title: 'Alugar o Estúdio', pricePerHour: 10, active: true }
    ];
    let scheduleConfig = { serviceRules: {}, blocks: [] };
    const ruleMinutes = value => /^([01]\d|2[0-3]):(?:00|30)$/.test(String(value || '')) ? Number(String(value).slice(0, 2)) * 60 + Number(String(value).slice(3, 5)) : null;
    const validateScheduleConfig = config => {
      for (const service of bookingServices.filter(item => item.active !== false)) {
        const rule = config.serviceRules?.[service.id];
        const startsAt = ruleMinutes(rule?.startsAt); const endsAt = ruleMinutes(rule?.endsAt);
        const fullDayRental = service.id === 'studio-rental' && startsAt === 0 && endsAt === 0;
        if (startsAt === null || endsAt === null || (!fullDayRental && startsAt >= endsAt)) throw new Error(`Defina um período válido para “${service.title}”.`);
        if (rule?.lunchEnabled) {
          const lunchStartsAt = ruleMinutes(rule.lunchStartsAt); const lunchEndsAt = ruleMinutes(rule.lunchEndsAt);
          if (fullDayRental || lunchStartsAt === null || lunchEndsAt === null || lunchStartsAt >= lunchEndsAt || lunchStartsAt < startsAt || lunchEndsAt > endsAt) throw new Error(`A pausa de almoço de “${service.title}” tem de estar dentro do período disponível.`);
        }
      }
      for (const block of config.blocks || []) {
        const startsAt = ruleMinutes(block.startsAt); const endsAt = ruleMinutes(block.endsAt);
        if (!block.date || startsAt === null || endsAt === null || startsAt >= endsAt) throw new Error('Cada bloqueio precisa de uma data e de um intervalo válido.');
      }
    };

    async function api(path, request = {}) {
      const response = await fetch(`${options.apiBase}${path}`, {
        ...request,
        headers: {
          ...(request.body ? { 'Content-Type': 'application/json' } : {}),
          Authorization: `Bearer ${options.getToken()}`,
          ...(request.method && request.method !== 'GET' ? { 'X-CMS-CSRF': options.getCsrf() } : {}),
          ...request.headers
        }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível concluir o pedido.');
      return result;
    }

    function defaultAppointment() {
      const start = new Date(); start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30, 0, 0);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      return { id: '', clientId: '', clientName: '', clientEmail: '', service: bookingServices[0].title, serviceId: bookingServices[0].id, startsAt: localInput(start), endsAt: localInput(end), amount: bookingServices[0].pricePerHour, paidAmount: 0, paymentStatus: 'pending', paymentUrl: '', status: 'confirmed', notes: '' };
    }
    function serviceFor(form) { return bookingServices.find(item => item.id === form.serviceId || item.title === form.service) || bookingServices[0]; }
    function appointmentHours(form) { const start = new Date(form.startsAt); const end = new Date(form.endsAt); return start && end && end > start ? Math.round((end - start) / 3600000 * 100) / 100 : 0; }

    function eventCard(item) {
      if (item.readOnly) return `<article class="schedule-event status-${escapeHtml(item.status)} external"><time>${displayTime(item.startsAt)}–${displayTime(item.endsAt)}</time><strong>${escapeHtml(item.service)}</strong><span>Google Calendar</span></article>`;
      const active = selected?.id === item.id ? ' active' : '';
      return `<button type="button" class="schedule-event status-${escapeHtml(item.status)}${active}" data-appointment="${item.id}"><time>${displayTime(item.startsAt)}–${displayTime(item.endsAt)}</time><strong>${escapeHtml(item.service)}</strong><span>${escapeHtml(item.clientName || 'Cliente por definir')}</span></button>`;
    }

    function render() {
      const days = Array.from({ length: 7 }, (_, index) => shiftDays(week, index));
      const form = draft || selected || defaultAppointment();
      const service = serviceFor(form);
      const total = Number(form.amount ?? service.pricePerHour * appointmentHours(form));
      const paidAmount = Number(form.paidAmount ?? (form.paidCents === undefined ? (form.paymentStatus === 'paid' ? total : 0) : Number(form.paidCents || 0) / 100));
      const outstanding = Math.max(0, total - paidAmount);
      const googlePanel = !google.configured ? '<div class="schedule-google muted">Google Calendar: falta configurar a integração no Worker.</div>' : !google.connected ? '<div class="schedule-google"><span>Google Calendar não ligado.</span><button type="button" data-google-connect>Ligar conta Google</button></div>' : google.serviceAccount ? `<div class="schedule-google connected"><span>Google Calendar ligado: <strong>${escapeHtml(google.calendarName)}</strong></span><em>Calendário Booking protegido</em></div>` : !google.calendarId ? `<div class="schedule-google"><span>Google ligado. Escolhe o calendário das sessões.</span><button type="button" data-google-calendars>Escolher calendário</button></div>` : `<div class="schedule-google connected"><span>Google Calendar ligado: <strong>${escapeHtml(google.calendarName)}</strong></span><button type="button" data-google-calendars>Alterar calendário</button></div>`;
      const calendarSelector = googleCalendars.length ? `<label class="schedule-google-select"><span>Calendário Google</span><select data-google-calendar>${googleCalendars.map(calendar => `<option value="${escapeHtml(calendar.id)}" ${calendar.id === google.calendarId ? 'selected' : ''}>${escapeHtml(calendar.name)}${calendar.primary ? ' (principal)' : ''}</option>`).join('')}</select><button type="button" data-google-save-calendar>Usar este calendário</button></label>` : '';
      const settings = `<section class="schedule-settings"><div class="schedule-settings-head"><div><p class="eyebrow">Disponibilidade pública</p><h3>Regras por sessão</h3></div><button type="button" class="manager-copy" data-save-schedule-settings>Guardar regras</button></div>${bookingServices.filter(item => item.active !== false).map(service => { const rule = { startsAt: '10:00', endsAt: '22:00', lunchStartsAt: '13:00', lunchEndsAt: '14:00', lunchEnabled: service.id !== 'studio-rental', minNoticeHours: 24, ...(scheduleConfig.serviceRules?.[service.id] || {}) }; const fullDayHint = service.id === 'studio-rental' ? '<small>Para disponibilidade 24h, define início e fim como 00:00. A pausa de almoço fica desativada.</small>' : ''; return `<article class="schedule-rule" data-service-rule="${escapeHtml(service.id)}"><strong>${escapeHtml(service.title)}</strong>${fullDayHint}<label>Início<input type="time" step="1800" data-rule="startsAt" value="${rule.startsAt}"></label><label>Fim<input type="time" step="1800" data-rule="endsAt" value="${rule.endsAt}"></label><label>Almoço início<input type="time" step="1800" data-rule="lunchStartsAt" value="${rule.lunchStartsAt}"></label><label>Almoço fim<input type="time" step="1800" data-rule="lunchEndsAt" value="${rule.lunchEndsAt}"></label><label class="schedule-lunch-toggle"><input type="checkbox" data-rule="lunchEnabled" ${rule.lunchEnabled ? 'checked' : ''}> Pausa almoço</label><label>Antecedência (h)<input type="number" min="0" max="720" data-rule="minNoticeHours" value="${Number(rule.minNoticeHours || 0)}"></label></article>`; }).join('')}<div class="schedule-blocks"><strong>Bloqueios específicos</strong><button type="button" class="client-link" data-add-schedule-block>+ Adicionar</button>${(scheduleConfig.blocks || []).map((block, index) => `<article data-schedule-block="${index}"><input type="date" data-block="date" value="${escapeHtml(block.date || '')}"><input type="time" step="1800" data-block="startsAt" value="${escapeHtml(block.startsAt || '10:00')}"><input type="time" step="1800" data-block="endsAt" value="${escapeHtml(block.endsAt || '11:00')}"><input data-block="label" placeholder="Motivo" value="${escapeHtml(block.label || '')}"><button type="button" class="admin-icon" data-remove-schedule-block="${index}">×</button></article>`).join('')}</div></section>`;
      root.innerHTML = `<section class="studio-schedule"><header class="studio-editor-heading"><div><p class="eyebrow">Agenda do estúdio</p><h2>Marcações e disponibilidade</h2><p>Cria e gere as reservas do estúdio. Os horários sobrepostos são bloqueados automaticamente.</p></div><div class="studio-editor-state"><span>Agenda própria</span><small>O TidyCal mantém-se ativo até ligarmos as reservas públicas.</small></div></header>${googlePanel}${calendarSelector}<div class="schedule-toolbar"><div><button type="button" data-week="-1" aria-label="Semana anterior">←</button><strong>${new Intl.DateTimeFormat('pt-PT', { day: 'numeric', month: 'short' }).format(days[0])} — ${new Intl.DateTimeFormat('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' }).format(days[6])}</strong><button type="button" data-week="1" aria-label="Semana seguinte">→</button></div><button type="button" class="manager-copy" data-new-appointment>+ Nova marcação</button></div><div class="schedule-layout"><section class="schedule-week">${days.map(day => { const key = dayKey(day); const items = appointments.filter(item => String(item.startsAt).slice(0, 10) === key); return `<article class="schedule-day"><header><span>${new Intl.DateTimeFormat('pt-PT', { weekday: 'short' }).format(day)}</span><strong>${day.getDate()}</strong></header><div class="schedule-events">${items.map(eventCard).join('') || '<p>Disponível</p>'}</div></article>`; }).join('')}</section><aside class="schedule-form"><div class="schedule-form-heading"><div><p class="eyebrow">${form.id ? 'Editar marcação' : 'Nova marcação'}</p><h3>${form.id ? escapeHtml(form.service) : 'Reservar horário'}</h3></div>${form.id ? '<button type="button" class="admin-icon" data-close-appointment aria-label="Fechar">×</button>' : ''}</div><label class="admin-field"><span>Cliente existente</span><select data-schedule="clientId"><option value="">Criar cliente com nome e e-mail</option>${clients.map(client => `<option value="${client.id}" ${form.clientId === client.id ? 'selected' : ''}>${escapeHtml(client.name)}${client.email ? ` · ${escapeHtml(client.email)}` : ''}</option>`).join('')}</select></label><div class="schedule-guest-fields ${form.clientId ? 'hidden' : ''}"><label class="admin-field"><span>Nome do novo cliente</span><input data-schedule="clientName" value="${escapeHtml(form.clientName || '')}"></label><label class="admin-field"><span>E-mail</span><input type="email" data-schedule="clientEmail" value="${escapeHtml(form.clientEmail || '')}"></label><p class="admin-hint">Se o e-mail já existir, a reserva é ligada a esse cliente. Caso contrário, cria-se um perfil sem acesso até definires credenciais.</p></div><label class="admin-field"><span>Tipo de reserva</span><select data-schedule="serviceId">${bookingServices.filter(item => item.active !== false).map(item => `<option value="${escapeHtml(item.id)}" ${item.id === service.id ? 'selected' : ''}>${escapeHtml(item.title)} · ${item.pricePerHour} €/h</option>`).join('')}</select></label><div class="schedule-date-fields"><label class="admin-field"><span>Início</span><input type="datetime-local" data-schedule="startsAt" value="${escapeHtml(inputDate(form.startsAt))}"></label><label class="admin-field"><span>Fim</span><input type="datetime-local" data-schedule="endsAt" value="${escapeHtml(inputDate(form.endsAt))}"></label></div><div class="schedule-date-fields"><label class="admin-field"><span>Valor desta reserva (€)</span><input type="number" step="0.01" min="0" data-schedule="amount" value="${escapeHtml(total.toFixed(2))}"></label><label class="admin-field"><span>Recebido (€)</span><input type="number" step="0.01" min="0" data-schedule="paidAmount" value="${escapeHtml(paidAmount.toFixed(2))}"></label></div><p class="admin-hint">${outstanding > 0 ? `${paidAmount > 0 ? 'Pagamento parcial' : 'Pagamento pendente'} · faltam ${outstanding.toFixed(2)} €` : 'Pagamento confirmado'}</p><label class="admin-field"><span>Link de pagamento</span><input type="url" data-schedule="paymentUrl" value="${escapeHtml(form.paymentUrl || '')}" placeholder="https://"></label><label class="admin-field"><span>Estado da sessão</span><select data-schedule="status"><option value="pending" ${form.status === 'pending' ? 'selected' : ''}>Pendente</option><option value="confirmed" ${form.status === 'confirmed' ? 'selected' : ''}>Confirmada</option><option value="cancelled" ${form.status === 'cancelled' ? 'selected' : ''}>Cancelada</option></select></label><label class="admin-field"><span>Notas internas</span><textarea rows="4" data-schedule="notes">${escapeHtml(form.notes || '')}</textarea></label><button type="button" class="manager-copy" data-save-appointment>${form.id ? 'Guardar alterações' : 'Criar marcação'}</button>${form.id ? '<button type="button" class="manager-delete" data-delete-appointment>Apagar marcação</button>' : ''}</aside></div></section>`;
      root.querySelector('.schedule-toolbar')?.insertAdjacentHTML('beforebegin', settings);
    }

    async function refresh() {
      const until = shiftDays(week, 7);
      const [schedule, clientList, googleStatus, content] = await Promise.all([
        api(`/studio/appointments?from=${encodeURIComponent(dayKey(week))}&until=${encodeURIComponent(dayKey(until))}`),
        api('/client/admin/clients'),
        api('/google-calendar/status'),
        fetch(`${options.apiBase}/content`, { cache: 'no-store' }).then(response => response.ok ? response.json() : null).catch(() => null)
      ]);
      const receivedAppointments = Array.isArray(schedule.appointments) ? schedule.appointments : [];
      const invalidAppointments = receivedAppointments.filter(item => !asScheduleDate(item.startsAt) || !asScheduleDate(item.endsAt));
      appointments = receivedAppointments.filter(item => !invalidAppointments.includes(item));
      if (invalidAppointments.length) options.onNotice?.(`${invalidAppointments.length} evento${invalidAppointments.length > 1 ? 's' : ''} com data inválida foi ocultado da agenda.`, 'error');
      clients = clientList.clients;
      google = googleStatus;
      if (Array.isArray(content?.bookingServices) && content.bookingServices.length) bookingServices = content.bookingServices.filter(service => service.active !== false && service.id && service.title).map(service => ({ id: String(service.id), title: String(service.title), pricePerHour: Math.max(0, Number(service.pricePerHour || 0)), active: true }));
      scheduleConfig = content?.bookingSchedule && typeof content.bookingSchedule === 'object' ? { serviceRules: content.bookingSchedule.serviceRules || {}, blocks: Array.isArray(content.bookingSchedule.blocks) ? content.bookingSchedule.blocks : [] } : { serviceRules: {}, blocks: [] };
      if (selected?.id) selected = appointments.find(item => item.id === selected.id) || null;
      render();
    }

    function readForm() {
      const value = name => root.querySelector(`[data-schedule="${name}"]`)?.value.trim() || '';
      const service = bookingServices.find(item => item.id === value('serviceId')) || bookingServices[0];
      const startsAt = value('startsAt'); const endsAt = value('endsAt');
      const hours = Math.max(0, (new Date(endsAt) - new Date(startsAt)) / 3600000);
      return { id: draft?.id || selected?.id || '', clientId: value('clientId'), clientName: value('clientName'), clientEmail: value('clientEmail'), serviceId: service.id, service: service.title, startsAt, endsAt, amount: Number(value('amount') || 0), paidAmount: Number(value('paidAmount') || 0), paymentUrl: value('paymentUrl'), status: value('status'), notes: value('notes'), hours };
    }

    root.addEventListener('click', event => {
      const weekButton = event.target.closest('[data-week]');
      if (weekButton) { week = shiftDays(week, Number(weekButton.dataset.week) * 7); selected = null; draft = null; return refresh().catch(options.onError); }
      if (event.target.closest('[data-new-appointment]')) { selected = null; draft = defaultAppointment(); return render(); }
      if (event.target.closest('[data-add-schedule-block]')) { scheduleConfig.blocks.push({ date: dayKey(new Date()), startsAt: '10:00', endsAt: '11:00', label: '' }); return render(); }
      const removeBlock = event.target.closest('[data-remove-schedule-block]');
      if (removeBlock) { scheduleConfig.blocks.splice(Number(removeBlock.dataset.removeScheduleBlock), 1); return render(); }
      if (event.target.closest('[data-save-schedule-settings]')) {
        const button = event.target.closest('[data-save-schedule-settings]');
        root.querySelectorAll('[data-service-rule]').forEach(card => { const id = card.dataset.serviceRule; scheduleConfig.serviceRules[id] = Object.fromEntries([...card.querySelectorAll('[data-rule]')].map(input => [input.dataset.rule, input.type === 'checkbox' ? input.checked : input.dataset.rule === 'minNoticeHours' ? Number(input.value || 0) : input.value])); });
        scheduleConfig.blocks = [...root.querySelectorAll('[data-schedule-block]')].map(card => ({ date: card.querySelector('[data-block="date"]').value, startsAt: card.querySelector('[data-block="startsAt"]').value, endsAt: card.querySelector('[data-block="endsAt"]').value, label: card.querySelector('[data-block="label"]').value.trim() })).filter(block => block.date && block.startsAt && block.endsAt);
        try { validateScheduleConfig(scheduleConfig); } catch (error) { return options.onError(error); }
        button.disabled = true; button.textContent = 'A guardar…';
        return options.saveBookingSchedule(scheduleConfig).then(result => { scheduleConfig = result.schedule || scheduleConfig; button.textContent = 'Guardado'; options.onNotice?.(`Regras da agenda guardadas${result.commit ? `. Commit ${result.commit.slice(0, 7)}` : ''}.`, 'success'); }).catch(error => { button.disabled = false; button.textContent = 'Guardar regras'; options.onError(error); });
      }
      if (event.target.closest('[data-google-connect]')) return api('/google-calendar/connect', { method: 'POST', body: JSON.stringify({}) }).then(result => { window.location.assign(result.url); }).catch(options.onError);
      if (event.target.closest('[data-google-calendars]')) return api('/google-calendar/calendars').then(result => { googleCalendars = result.calendars; render(); }).catch(options.onError);
      if (event.target.closest('[data-google-save-calendar]')) { const select = root.querySelector('[data-google-calendar]'); const item = googleCalendars.find(calendar => calendar.id === select.value); return api('/google-calendar/calendar', { method: 'PATCH', body: JSON.stringify({ calendarId: item?.id, calendarName: item?.name }) }).then(() => { googleCalendars = []; options.onNotice?.('Calendário Google configurado.', 'success'); return refresh(); }).catch(options.onError); }
      const appointment = event.target.closest('[data-appointment]');
      if (appointment) { selected = appointments.find(item => item.id === appointment.dataset.appointment) || null; draft = selected ? { ...selected, serviceId: serviceFor(selected).id, amount: Number(selected.amountCents || 0) / 100, paidAmount: Number(selected.paidCents || 0) / 100, paymentStatus: selected.paymentStatus || 'pending', paymentUrl: selected.paymentUrl || '' } : null; return render(); }
      if (event.target.closest('[data-close-appointment]')) { selected = null; draft = null; return render(); }
      if (event.target.closest('[data-save-appointment]')) {
        const body = readForm();
        const path = selected?.id ? `/studio/appointments/${selected.id}` : '/studio/appointments';
        return api(path, { method: selected?.id ? 'PATCH' : 'POST', body: JSON.stringify(body) }).then(result => { selected = result; draft = null; options.onNotice?.(result.clientCreated ? 'Marcação guardada e novo cliente criado sem acesso à Área do Cliente.' : 'Marcação guardada com sucesso.', 'success'); return refresh(); }).catch(options.onError);
      }
      if (event.target.closest('[data-delete-appointment]')) {
        if (!window.confirm('Apagar esta marcação? Esta ação não pode ser revertida.')) return;
        return api(`/studio/appointments/${selected.id}`, { method: 'DELETE', body: JSON.stringify({}) }).then(() => { selected = null; draft = null; options.onNotice?.('Marcação apagada.', 'success'); return refresh(); }).catch(options.onError);
      }
    });
    root.addEventListener('change', event => {
      if (!event.target.matches('[data-schedule]')) return;
      const changed = event.target.dataset.schedule;
      if (!['clientId', 'serviceId', 'startsAt', 'endsAt', 'status'].includes(changed)) return;
      if (changed === 'status' && event.target.value === 'cancelled') {
        root.querySelector('[data-schedule="amount"]').value = '0';
        root.querySelector('[data-schedule="paidAmount"]').value = '0';
      }
      draft = readForm();
      if (changed === 'serviceId') {
        const service = serviceFor(draft);
        draft.service = service.title;
        draft.amount = service.pricePerHour * appointmentHours(draft);
      }
      render();
    });
    return refresh();
  }
  return { mount };
})();
