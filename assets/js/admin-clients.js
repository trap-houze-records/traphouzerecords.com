window.ClientAdminModule = (() => {
  const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  // Campos type="number" aceitam ponto decimal; a vírgula portuguesa torna o valor inválido e vazio.
  const numericAmount = cents => (Number(cents || 0) / 100).toFixed(2);
  const paymentMeta = item => {
    const amount = Number(item.amountCents || 0) / 100;
    const paid = item.paidCents === undefined ? (item.paymentStatus === 'paid' ? amount : 0) : Number(item.paidCents || 0) / 100;
    const due = Math.max(0, amount - paid);
    return { amount, paid, due, label: due === 0 ? 'Pago' : paid > 0 ? `Parcial · faltam ${due.toFixed(2)} €` : `Em falta · ${due.toFixed(2)} €` };
  };

  function mount(root, options) {
    const apiBase = options.apiBase;
    const getToken = options.getToken;
    const getCsrf = options.getCsrf;
    let clients = [];
    let portal;
    const revealedPasswords = new Map();
    const mixServices = options.mixMasterServices || [];

    function generatePassword() {
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
    }
    async function copyPassword(value) {
      if (!value) throw new Error('Gere ou introduza uma palavra-passe primeiro.');
      await navigator.clipboard.writeText(value);
      options.onNotice?.('Palavra-passe copiada. Guarde-a ou envie-a ao cliente agora.', 'success');
    }

    async function api(path, request = {}) {
      const response = await fetch(`${apiBase}${path}`, {
        ...request,
        headers: {
          ...(request.body ? { 'Content-Type': 'application/json' } : {}),
          Authorization: `Bearer ${getToken()}`,
          ...(request.method && request.method !== 'GET' ? { 'X-CMS-CSRF': getCsrf() } : {}),
          ...request.headers
        }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível concluir o pedido.');
      return result;
    }

    function recordForm(type, item) {
      const track = type === 'tracks';
      const label = track ? 'Nome' : 'Serviço';
      const name = track ? 'title' : 'service';
      const payment = paymentMeta(item);
      const recordingOptions = track ? portal.tracks.filter(candidate => candidate.category === 'recording' && candidate.id !== item.id).map(candidate => `<option value="${escapeHtml(candidate.id)}" ${candidate.id === item.sourceTrackId ? 'selected' : ''}>${escapeHtml(candidate.title)}</option>`).join('') : '';
      const versions = track ? (item.versions || []) : [];
      const comments = track ? (item.comments || []) : [];
      return `<article class="manager-record" data-item="${type}" data-id="${item.id}">
        <div class="manager-record-top"><strong>${track ? 'Música' : 'Reserva'}</strong><button type="button" data-delete="${type}" data-id="${item.id}" aria-label="Remover">×</button></div>
        <label class="admin-field"><span>${label}</span><input data-field="${name}" value="${escapeHtml(item[name])}"></label>
        ${track ? `<div class="manager-record-grid"><label class="admin-field"><span>Área</span><select data-field="category"><option value="mix-master" ${item.category !== 'recording' ? 'selected' : ''}>Mix & Master</option><option value="recording" ${item.category === 'recording' ? 'selected' : ''}>Gravações</option></select></label><label class="admin-field"><span>Fase</span><select data-field="stage">${[['start', 'Iniciar'], ['mix', 'Mix'], ['master', 'Master']].map(([value, text]) => `<option value="${value}" ${item.stage === value ? 'selected' : ''}>${text}</option>`).join('')}</select></label></div><div class="manager-record-grid"><label class="admin-field"><span>Serviço pedido</span><select data-field="requestedService"><option value="">Sem pedido</option>${mixServices.map(service => `<option value="${escapeHtml(service.id)}" ${item.requestedService === service.id ? 'selected' : ''}>${escapeHtml(service.title)}</option>`).join('')}</select></label><label class="admin-field"><span>Gravação de origem</span><select data-field="sourceTrackId"><option value="">Nenhuma</option>${recordingOptions}</select></label></div>` : `<label class="admin-field"><span>Data e hora</span><input type="datetime-local" data-field="startsAt" value="${escapeHtml((item.startsAt || '').replace(' ', 'T').slice(0, 16))}"></label>`}
        <div class="manager-record-grid"><label class="admin-field"><span>Valor (€)</span><input type="number" step="0.01" min="0" data-field="amount" value="${numericAmount(item.amountCents)}"></label><label class="admin-field"><span>Recebido (€)</span><input type="number" step="0.01" min="0" data-field="paidAmount" value="${payment.paid.toFixed(2)}"></label></div>
       <label class="admin-field"><span>Link de pagamento</span><input type="url" data-field="paymentUrl" value="${escapeHtml(item.paymentUrl || '')}" placeholder="https://"></label>
        ${track ? `<div class="manager-track-workspace"><strong>Versões no Trap Houze Player (${versions.length})</strong>${versions.map(version => `<small>${escapeHtml(version.label)} · ${escapeHtml(version.originalName)}</small>`).join('') || '<small>Sem versões carregadas.</small>'}<form data-admin-track-upload="${escapeHtml(item.id)}"><input name="file" type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/mp4,audio/aac,audio/ogg" required><input name="label" maxlength="120" placeholder="Nome da versão"><button type="submit">Enviar versão</button></form></div><div class="manager-track-workspace"><strong>Comentários (${comments.length})</strong>${comments.map(comment => `<small><b>${comment.authorType === 'admin' ? 'Trap Houze' : 'Artista'}:</b> ${escapeHtml(comment.body)}</small>`).join('') || '<small>Sem comentários.</small>'}<form data-admin-track-comment="${escapeHtml(item.id)}"><input name="body" maxlength="2000" placeholder="Adicionar comentário"><button type="submit">Comentar</button></form></div>` : ''}
       <p class="admin-hint">${payment.label}</p>
       <button type="button" class="manager-copy" data-save-record>Guardar ${track ? 'música' : 'reserva'}</button>
      </article>`;
    }
    function appointmentForm(item) {
      const payment = paymentMeta(item);
      return `<article class="manager-record" data-appointment="${item.id}">
        <div class="manager-record-top"><strong>Marcação na agenda</strong><button type="button" data-delete-appointment="${item.id}" aria-label="Apagar marcação">×</button></div>
        <label class="admin-field"><span>Serviço</span><input data-appointment-field="service" value="${escapeHtml(item.service)}"></label>
        <div class="manager-record-grid"><label class="admin-field"><span>Início</span><input type="datetime-local" data-appointment-field="startsAt" value="${escapeHtml((item.startsAt || '').replace(' ', 'T').slice(0, 16))}"></label><label class="admin-field"><span>Fim</span><input type="datetime-local" data-appointment-field="endsAt" value="${escapeHtml((item.endsAt || '').replace(' ', 'T').slice(0, 16))}"></label></div>
        <div class="manager-record-grid"><label class="admin-field"><span>Valor (€)</span><input type="number" step="0.01" min="0" data-appointment-field="amount" value="${numericAmount(item.amountCents)}"></label><label class="admin-field"><span>Recebido (€)</span><input type="number" step="0.01" min="0" data-appointment-field="paidAmount" value="${payment.paid.toFixed(2)}"></label></div><p class="admin-hint">${payment.label}</p>
        <label class="admin-field"><span>Link de pagamento</span><input type="url" data-appointment-field="paymentUrl" value="${escapeHtml(item.paymentUrl || '')}" placeholder="https://"></label>
        <label class="admin-field"><span>Estado da sessão</span><select data-appointment-field="status"><option value="pending" ${item.status === 'pending' ? 'selected' : ''}>Pendente</option><option value="confirmed" ${item.status === 'confirmed' ? 'selected' : ''}>Confirmada</option><option value="cancelled" ${item.status === 'cancelled' ? 'selected' : ''}>Cancelada</option></select></label>
        <label class="admin-field"><span>Notas</span><textarea rows="3" data-appointment-field="notes">${escapeHtml(item.notes || '')}</textarea></label>
        <button type="button" class="manager-copy" data-save-appointment>Guardar marcação</button>
      </article>`;
    }

    function render() {
      if (!portal) {
        root.innerHTML = `<section class="admin-empty"><p class="eyebrow">Clientes</p><h2>Ainda não existem clientes.</h2><p>Cria a primeira conta para começar a gerir músicas, reservas e pagamentos.</p><button class="btn" type="button" data-new-client>+ Novo cliente</button></section>`;
        return;
      }
      const client = portal.client;
      const revealedPassword = revealedPasswords.get(client.id) || '';
      root.innerHTML = `<div class="manager-layout"><aside class="manager-sidebar"><button class="manager-add" type="button" data-new-client>+ Novo cliente</button><div class="manager-client-list">${clients.map(item => `<button type="button" class="${item.id === client.id ? 'active' : ''}" data-client="${item.id}"><strong>${escapeHtml(item.name)}</strong><span>${item.active ? 'Ativo' : 'Pausado'}</span></button>`).join('')}</div></aside>
      <section class="manager-content"><div class="manager-content-heading"><div><p class="eyebrow">Cliente selecionado</p><h2>${escapeHtml(client.name)}</h2></div></div><div class="manager-grid">
        <article class="client-card"><h3>Acesso</h3><label class="admin-field"><span>Nome</span><input data-client-field="name" value="${escapeHtml(client.name)}"></label><label class="admin-field"><span>E-mail</span><input type="email" data-client-field="email" value="${escapeHtml(client.email || '')}"></label><label class="admin-field"><span>WhatsApp</span><input data-client-field="phone" value="${escapeHtml(client.phone || '')}"></label><label class="admin-field"><span>Palavra-passe</span><div class="manager-password"><input type="${revealedPassword ? 'text' : 'password'}" data-client-field="password" value="${escapeHtml(revealedPassword)}" placeholder="Manter a atual" autocomplete="new-password"><button type="button" data-toggle-password>${revealedPassword ? 'Ocultar' : 'Mostrar'}</button></div></label><div class="manager-credential-actions"><button class="manager-copy" type="button" data-generate-password>Gerar nova palavra-passe</button><button class="manager-preview" type="button" data-copy-password ${revealedPassword ? '' : 'disabled'}>Copiar palavra-passe</button></div><p class="manager-security-note">Por segurança, palavras-passe existentes não podem ser recuperadas. Uma nova fica visível aqui depois de a gerar ou guardar.</p><label class="admin-check"><input type="checkbox" data-client-field="active" ${client.active ? 'checked' : ''}><span>Conta com acesso ativo</span></label><button class="manager-copy" type="button" data-save-client>Guardar acesso</button><button class="manager-delete" type="button" data-delete-client>Apagar cliente</button></article>
        <article class="client-card"><div class="manager-title-row"><h3>Músicas</h3><button class="client-link" type="button" data-client-add="tracks">Adicionar</button></div><div class="manager-records">${portal.tracks.map(item => recordForm('tracks', item)).join('') || '<p class="admin-hint">Sem músicas registadas.</p>'}</div></article>
        <article class="client-card"><div class="manager-title-row"><h3>Marcações na agenda</h3></div><div class="manager-records">${portal.appointments.map(appointmentForm).join('') || '<p class="admin-hint">Sem marcações registadas.</p>'}</div></article>
        <article class="client-card"><div class="manager-title-row"><h3>Reservas sem agenda</h3><button class="client-link" type="button" data-client-add="bookings">Adicionar</button></div><div class="manager-records">${portal.bookings.filter(item => !item.appointmentId).map(item => recordForm('bookings', item)).join('') || '<p class="admin-hint">Sem reservas adicionais.</p>'}</div></article>
      </div></section></div>`;
    }

    async function refresh(clientId) {
      clients = (await api('/client/admin/clients')).clients;
      const id = clientId || portal?.client?.id || clients[0]?.id;
      portal = id ? await api(`/client/admin/clients/${id}`) : null;
      render();
    }

    function payload(card) {
      const type = card.dataset.item;
      const track = type === 'tracks';
      const field = name => card.querySelector(`[data-field="${name}"]`);
      const base = { amount: Number(field('amount').value || 0), paidAmount: Number(field('paidAmount').value || 0), paymentUrl: field('paymentUrl').value.trim() };
      return type === 'tracks' ? { ...base, title: field('title').value.trim(), stage: field('stage').value, category: field('category').value, requestedService: field('requestedService').value, sourceTrackId: field('sourceTrackId').value, samplyUrl: '' } : { ...base, service: field('service').value.trim(), startsAt: field('startsAt').value.replace('T', ' ') };
    }
    function appointmentPayload(card) {
      const field = name => card.querySelector(`[data-appointment-field="${name}"]`);
      return { clientId: portal.client.id, service: field('service').value.trim(), startsAt: field('startsAt').value, endsAt: field('endsAt').value, amount: Number(field('amount').value || 0), paidAmount: Number(field('paidAmount').value || 0), paymentUrl: field('paymentUrl').value.trim(), status: field('status').value, notes: field('notes').value.trim() };
    }

    root.addEventListener('click', event => {
      const selected = event.target.closest('[data-client]');
      if (selected) return refresh(selected.dataset.client).catch(options.onError);
      if (event.target.closest('[data-new-client]')) {
        const password = generatePassword();
        return api('/client/admin/clients', { method: 'POST', body: JSON.stringify({ name: 'Novo cliente', username: `cliente-${Date.now()}`, password }) }).then(result => {
          const clientId = result.id;
          if (!clientId) throw new Error('A conta foi criada, mas não foi possível selecioná-la. Atualize a página e defina uma nova palavra-passe.');
          revealedPasswords.set(clientId, password);
          options.onNotice?.('Cliente criado. Copie agora a palavra-passe apresentada e guarde-a antes de sair desta página.', 'success');
          return refresh(clientId);
        }).catch(options.onError);
      }
      if (event.target.closest('[data-generate-password]')) {
        const input = root.querySelector('[data-client-field="password"]');
        const password = generatePassword();
        input.value = password;
        input.type = 'text';
        revealedPasswords.set(portal.client.id, password);
        const copy = root.querySelector('[data-copy-password]'); if (copy) copy.disabled = false;
        const toggle = root.querySelector('[data-toggle-password]'); if (toggle) toggle.textContent = 'Ocultar';
        options.onNotice?.('Nova palavra-passe gerada. Carregue em Guardar acesso para a aplicar.', 'success');
        return;
      }
      if (event.target.closest('[data-toggle-password]')) {
        const input = root.querySelector('[data-client-field="password"]');
        input.type = input.type === 'password' ? 'text' : 'password';
        event.target.closest('[data-toggle-password]').textContent = input.type === 'password' ? 'Mostrar' : 'Ocultar';
        return;
      }
      if (event.target.closest('[data-copy-password]')) return copyPassword(root.querySelector('[data-client-field="password"]').value).catch(options.onError);
      if (event.target.closest('[data-save-client]')) {
        const client = portal.client;
        const body = { name: root.querySelector('[data-client-field="name"]').value.trim(), email: root.querySelector('[data-client-field="email"]').value.trim(), phone: root.querySelector('[data-client-field="phone"]').value.trim(), password: root.querySelector('[data-client-field="password"]').value, active: root.querySelector('[data-client-field="active"]').checked };
        return api(`/client/admin/clients/${client.id}`, { method: 'PATCH', body: JSON.stringify(body) }).then(() => { if (body.password) revealedPasswords.set(client.id, body.password); options.onNotice?.('Acesso guardado com sucesso.', 'success'); return refresh(client.id); }).catch(options.onError);
      }
      if (event.target.closest('[data-delete-client]')) {
        const client = portal.client;
        if (!window.confirm(`Apagar ${client.name} e todas as suas músicas, reservas e sessões? Esta ação não pode ser revertida.`)) return;
        return api(`/client/admin/clients/${client.id}`, { method: 'DELETE', body: JSON.stringify({}) }).then(() => { revealedPasswords.delete(client.id); options.onNotice?.('Cliente apagado.', 'success'); return refresh(); }).catch(options.onError);
      }
      const add = event.target.closest('[data-client-add]');
      if (add) {
        const type = add.dataset.clientAdd;
        const body = type === 'tracks' ? { title: 'Nova música', stage: 'start', amount: 0, paymentStatus: 'pending' } : { service: 'Nova reserva', startsAt: '', amount: 0, paymentStatus: 'pending' };
        return api(`/client/admin/${type}/${portal.client.id}`, { method: 'POST', body: JSON.stringify(body) }).then(() => refresh()).catch(options.onError);
      }
      const remove = event.target.closest('[data-delete]');
      if (remove && window.confirm('Remover este registo?')) return api(`/client/admin/${remove.dataset.delete}/${remove.dataset.id}`, { method: 'DELETE', body: JSON.stringify({}) }).then(() => refresh()).catch(options.onError);
      const saveRecord = event.target.closest('[data-save-record]');
      if (saveRecord) { const card = saveRecord.closest('[data-item]'); return api(`/client/admin/${card.dataset.item}/${card.dataset.id}`, { method: 'PATCH', body: JSON.stringify(payload(card)) }).then(() => { options.onNotice?.('Registo guardado.', 'success'); return refresh(); }).catch(options.onError); }
      const saveAppointment = event.target.closest('[data-save-appointment]');
      if (saveAppointment) { const card = saveAppointment.closest('[data-appointment]'); return api(`/studio/appointments/${card.dataset.appointment}`, { method: 'PATCH', body: JSON.stringify(appointmentPayload(card)) }).then(() => { options.onNotice?.('Marcação guardada.', 'success'); return refresh(); }).catch(options.onError); }
      const deleteAppointment = event.target.closest('[data-delete-appointment]');
      if (deleteAppointment && window.confirm('Apagar esta marcação? Esta ação não pode ser revertida.')) return api(`/studio/appointments/${deleteAppointment.dataset.deleteAppointment}`, { method: 'DELETE', body: JSON.stringify({}) }).then(() => { options.onNotice?.('Marcação apagada.', 'success'); return refresh(); }).catch(options.onError);
    });
    root.addEventListener('input', event => {
      if (!event.target.matches('[data-client-field="password"]')) return;
      const copy = root.querySelector('[data-copy-password]');
      if (copy) copy.disabled = !event.target.value;
    });
    root.addEventListener('submit', event => {
      const upload = event.target.closest('[data-admin-track-upload]');
      if (upload) {
        event.preventDefault();
        const button = upload.querySelector('button'); button.disabled = true;
        return fetch(`${apiBase}/client/admin/tracks/${encodeURIComponent(upload.dataset.adminTrackUpload)}/versions`, { method: 'POST', headers: { Authorization: `Bearer ${getToken()}`, 'X-CMS-CSRF': getCsrf() }, body: new FormData(upload) }).then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Não foi possível enviar a versão.'); return refresh(); }).catch(options.onError).finally(() => { button.disabled = false; });
      }
      const comment = event.target.closest('[data-admin-track-comment]');
      if (comment) {
        event.preventDefault();
        const button = comment.querySelector('button'); button.disabled = true;
        return api(`/client/admin/tracks/${encodeURIComponent(comment.dataset.adminTrackComment)}/comments`, { method: 'POST', body: JSON.stringify({ body: new FormData(comment).get('body') }) }).then(() => refresh()).catch(options.onError).finally(() => { button.disabled = false; });
      }
    });
    return refresh();
  }
  return { mount };
})();
