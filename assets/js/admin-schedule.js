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
    let google = { configured: false, connected: false };
    let googleCalendars = [];

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
      return { id: '', clientId: '', clientName: '', clientPhone: '', service: 'Sessão de estúdio', startsAt: localInput(start), endsAt: localInput(end), status: 'confirmed', notes: '' };
    }

    function eventCard(item) {
      if (item.readOnly) return `<article class="schedule-event status-${escapeHtml(item.status)} external"><time>${displayTime(item.startsAt)}–${displayTime(item.endsAt)}</time><strong>${escapeHtml(item.service)}</strong><span>Google Calendar</span></article>`;
      const active = selected?.id === item.id ? ' active' : '';
      return `<button type="button" class="schedule-event status-${escapeHtml(item.status)}${active}" data-appointment="${item.id}"><time>${displayTime(item.startsAt)}–${displayTime(item.endsAt)}</time><strong>${escapeHtml(item.service)}</strong><span>${escapeHtml(item.clientName || 'Cliente por definir')}</span></button>`;
    }

    function render() {
      const days = Array.from({ length: 7 }, (_, index) => shiftDays(week, index));
      const form = selected || defaultAppointment();
      const googlePanel = !google.configured ? '<div class="schedule-google muted">Google Calendar: falta configurar a integração no Worker.</div>' : !google.connected ? '<div class="schedule-google"><span>Google Calendar não ligado.</span><button type="button" data-google-connect>Ligar conta Google</button></div>' : google.serviceAccount ? `<div class="schedule-google connected"><span>Google Calendar ligado: <strong>${escapeHtml(google.calendarName)}</strong></span><em>Calendário Booking protegido</em></div>` : !google.calendarId ? `<div class="schedule-google"><span>Google ligado. Escolhe o calendário das sessões.</span><button type="button" data-google-calendars>Escolher calendário</button></div>` : `<div class="schedule-google connected"><span>Google Calendar ligado: <strong>${escapeHtml(google.calendarName)}</strong></span><button type="button" data-google-calendars>Alterar calendário</button></div>`;
      const calendarSelector = googleCalendars.length ? `<label class="schedule-google-select"><span>Calendário Google</span><select data-google-calendar>${googleCalendars.map(calendar => `<option value="${escapeHtml(calendar.id)}" ${calendar.id === google.calendarId ? 'selected' : ''}>${escapeHtml(calendar.name)}${calendar.primary ? ' (principal)' : ''}</option>`).join('')}</select><button type="button" data-google-save-calendar>Usar este calendário</button></label>` : '';
      root.innerHTML = `<section class="studio-schedule"><header class="studio-editor-heading"><div><p class="eyebrow">Agenda do estúdio</p><h2>Marcações e disponibilidade</h2><p>Cria e gere as reservas do estúdio. Os horários sobrepostos são bloqueados automaticamente.</p></div><div class="studio-editor-state"><span>Agenda própria</span><small>O TidyCal mantém-se ativo até ligarmos as reservas públicas.</small></div></header>${googlePanel}${calendarSelector}<div class="schedule-toolbar"><div><button type="button" data-week="-1" aria-label="Semana anterior">←</button><strong>${new Intl.DateTimeFormat('pt-PT', { day: 'numeric', month: 'short' }).format(days[0])} — ${new Intl.DateTimeFormat('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' }).format(days[6])}</strong><button type="button" data-week="1" aria-label="Semana seguinte">→</button></div><button type="button" class="manager-copy" data-new-appointment>+ Nova marcação</button></div><div class="schedule-layout"><section class="schedule-week">${days.map(day => { const key = dayKey(day); const items = appointments.filter(item => String(item.startsAt).slice(0, 10) === key); return `<article class="schedule-day"><header><span>${new Intl.DateTimeFormat('pt-PT', { weekday: 'short' }).format(day)}</span><strong>${day.getDate()}</strong></header><div class="schedule-events">${items.map(eventCard).join('') || '<p>Disponível</p>'}</div></article>`; }).join('')}</section><aside class="schedule-form"><div class="schedule-form-heading"><div><p class="eyebrow">${form.id ? 'Editar marcação' : 'Nova marcação'}</p><h3>${form.id ? escapeHtml(form.service) : 'Reservar horário'}</h3></div>${form.id ? '<button type="button" class="admin-icon" data-close-appointment aria-label="Fechar">×</button>' : ''}</div><label class="admin-field"><span>Cliente existente</span><select data-schedule="clientId"><option value="">Contacto manual / novo cliente</option>${clients.map(client => `<option value="${client.id}" ${form.clientId === client.id ? 'selected' : ''}>${escapeHtml(client.name)}</option>`).join('')}</select></label><div class="schedule-guest-fields ${form.clientId ? 'hidden' : ''}"><label class="admin-field"><span>Nome do cliente</span><input data-schedule="clientName" value="${escapeHtml(form.clientName || '')}"></label><label class="admin-field"><span>WhatsApp</span><input data-schedule="clientPhone" value="${escapeHtml(form.clientPhone || '')}"></label></div><label class="admin-field"><span>Serviço</span><input data-schedule="service" value="${escapeHtml(form.service || '')}"></label><div class="schedule-date-fields"><label class="admin-field"><span>Início</span><input type="datetime-local" data-schedule="startsAt" value="${escapeHtml(inputDate(form.startsAt))}"></label><label class="admin-field"><span>Fim</span><input type="datetime-local" data-schedule="endsAt" value="${escapeHtml(inputDate(form.endsAt))}"></label></div><label class="admin-field"><span>Estado</span><select data-schedule="status"><option value="pending" ${form.status === 'pending' ? 'selected' : ''}>Pendente</option><option value="confirmed" ${form.status === 'confirmed' ? 'selected' : ''}>Confirmada</option><option value="cancelled" ${form.status === 'cancelled' ? 'selected' : ''}>Cancelada</option></select></label><label class="admin-field"><span>Notas internas</span><textarea rows="4" data-schedule="notes">${escapeHtml(form.notes || '')}</textarea></label><button type="button" class="manager-copy" data-save-appointment>${form.id ? 'Guardar alterações' : 'Criar marcação'}</button>${form.id ? '<button type="button" class="manager-delete" data-delete-appointment>Apagar marcação</button>' : ''}</aside></div></section>`;
    }

    async function refresh() {
      const until = shiftDays(week, 7);
      const [schedule, clientList, googleStatus] = await Promise.all([
        api(`/studio/appointments?from=${encodeURIComponent(dayKey(week))}&until=${encodeURIComponent(dayKey(until))}`),
        api('/client/admin/clients'),
        api('/google-calendar/status')
      ]);
      const receivedAppointments = Array.isArray(schedule.appointments) ? schedule.appointments : [];
      const invalidAppointments = receivedAppointments.filter(item => !asScheduleDate(item.startsAt) || !asScheduleDate(item.endsAt));
      appointments = receivedAppointments.filter(item => !invalidAppointments.includes(item));
      if (invalidAppointments.length) options.onNotice?.(`${invalidAppointments.length} evento${invalidAppointments.length > 1 ? 's' : ''} com data inválida foi ocultado da agenda.`, 'error');
      clients = clientList.clients;
      google = googleStatus;
      if (selected?.id) selected = appointments.find(item => item.id === selected.id) || null;
      render();
    }

    function readForm() {
      const value = name => root.querySelector(`[data-schedule="${name}"]`)?.value.trim() || '';
      return { clientId: value('clientId'), guestName: value('clientName'), guestPhone: value('clientPhone'), service: value('service'), startsAt: value('startsAt'), endsAt: value('endsAt'), status: value('status'), notes: value('notes') };
    }

    root.addEventListener('click', event => {
      const weekButton = event.target.closest('[data-week]');
      if (weekButton) { week = shiftDays(week, Number(weekButton.dataset.week) * 7); selected = null; return refresh().catch(options.onError); }
      if (event.target.closest('[data-new-appointment]')) { selected = null; return render(); }
      if (event.target.closest('[data-google-connect]')) return api('/google-calendar/connect', { method: 'POST', body: JSON.stringify({}) }).then(result => { window.location.assign(result.url); }).catch(options.onError);
      if (event.target.closest('[data-google-calendars]')) return api('/google-calendar/calendars').then(result => { googleCalendars = result.calendars; render(); }).catch(options.onError);
      if (event.target.closest('[data-google-save-calendar]')) { const select = root.querySelector('[data-google-calendar]'); const item = googleCalendars.find(calendar => calendar.id === select.value); return api('/google-calendar/calendar', { method: 'PATCH', body: JSON.stringify({ calendarId: item?.id, calendarName: item?.name }) }).then(() => { googleCalendars = []; options.onNotice?.('Calendário Google configurado.', 'success'); return refresh(); }).catch(options.onError); }
      const appointment = event.target.closest('[data-appointment]');
      if (appointment) { selected = appointments.find(item => item.id === appointment.dataset.appointment) || null; return render(); }
      if (event.target.closest('[data-close-appointment]')) { selected = null; return render(); }
      if (event.target.closest('[data-save-appointment]')) {
        const body = readForm();
        const path = selected?.id ? `/studio/appointments/${selected.id}` : '/studio/appointments';
        return api(path, { method: selected?.id ? 'PATCH' : 'POST', body: JSON.stringify(body) }).then(result => { selected = result; options.onNotice?.('Marcação guardada com sucesso.', 'success'); return refresh(); }).catch(options.onError);
      }
      if (event.target.closest('[data-delete-appointment]')) {
        if (!window.confirm('Apagar esta marcação? Esta ação não pode ser revertida.')) return;
        return api(`/studio/appointments/${selected.id}`, { method: 'DELETE', body: JSON.stringify({}) }).then(() => { selected = null; options.onNotice?.('Marcação apagada.', 'success'); return refresh(); }).catch(options.onError);
      }
    });
    root.addEventListener('change', event => { if (event.target.matches('[data-schedule="clientId"]')) render(); });
    return refresh();
  }
  return { mount };
})();
