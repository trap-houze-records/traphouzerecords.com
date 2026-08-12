window.ClientAdminModule = (() => {
  const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const money = cents => (Number(cents || 0) / 100).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function mount(root, options) {
    const apiBase = options.apiBase;
    const getToken = options.getToken;
    const getCsrf = options.getCsrf;
    let clients = [];
    let portal;

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
      return `<article class="manager-record" data-item="${type}" data-id="${item.id}">
        <div class="manager-record-top"><strong>${track ? 'Música' : 'Reserva'}</strong><button type="button" data-delete="${type}" data-id="${item.id}" aria-label="Remover">×</button></div>
        <label class="admin-field"><span>${label}</span><input data-field="${name}" value="${escapeHtml(item[name])}"></label>
        ${track ? `<label class="admin-field"><span>Fase</span><select data-field="stage">${[['start', 'Iniciar'], ['mix', 'Mix'], ['master', 'Master']].map(([value, text]) => `<option value="${value}" ${item.stage === value ? 'selected' : ''}>${text}</option>`).join('')}</select></label>` : `<label class="admin-field"><span>Data e hora</span><input type="datetime-local" data-field="startsAt" value="${escapeHtml((item.startsAt || '').replace(' ', 'T').slice(0, 16))}"></label>`}
        <label class="admin-field"><span>Valor (€)</span><input type="number" step="0.01" min="0" data-field="amount" value="${money(item.amountCents)}"></label>
        <label class="admin-field"><span>Link de pagamento</span><input type="url" data-field="paymentUrl" value="${escapeHtml(item.paymentUrl || '')}" placeholder="https://"></label>
        <label class="admin-check"><input type="checkbox" data-field="paymentStatus" ${item.paymentStatus === 'paid' ? 'checked' : ''}><span>Pagamento confirmado</span></label>
      </article>`;
    }

    function render() {
      if (!portal) {
        root.innerHTML = `<section class="admin-empty"><p class="eyebrow">Clientes</p><h2>Ainda não existem clientes.</h2><p>Cria a primeira conta para começar a gerir músicas, reservas e pagamentos.</p><button class="btn" type="button" data-new-client>+ Novo cliente</button></section>`;
        return;
      }
      const client = portal.client;
      root.innerHTML = `<section class="manager-hero admin-module-intro"><p class="eyebrow">Área privada</p><h2>Clientes</h2><p>Cria contas, acompanha trabalhos e controla pagamentos.</p></section>
      <div class="manager-layout"><aside class="manager-sidebar"><button class="manager-add" type="button" data-new-client>+ Novo cliente</button><div class="manager-client-list">${clients.map(item => `<button type="button" class="${item.id === client.id ? 'active' : ''}" data-client="${item.id}"><strong>${escapeHtml(item.name)}</strong><span>@${escapeHtml(item.username)} · ${item.active ? 'Ativo' : 'Pausado'}</span></button>`).join('')}</div></aside>
      <section class="manager-content"><div class="manager-content-heading"><div><p class="eyebrow">Cliente selecionado</p><h2>${escapeHtml(client.name)}</h2></div></div><div class="manager-grid">
        <article class="client-card"><h3>Acesso</h3><label class="admin-field"><span>Nome</span><input data-client-field="name" value="${escapeHtml(client.name)}"></label><label class="admin-field"><span>WhatsApp</span><input data-client-field="phone" value="${escapeHtml(client.phone || '')}"></label><label class="admin-field"><span>Nova palavra-passe</span><input type="password" data-client-field="password" placeholder="Manter a atual"></label><label class="admin-check"><input type="checkbox" data-client-field="active" ${client.active ? 'checked' : ''}><span>Conta com acesso ativo</span></label><button class="manager-copy" type="button" data-save-client>Guardar acesso</button></article>
        <article class="client-card"><div class="manager-title-row"><h3>Músicas</h3><button class="client-link" type="button" data-client-add="tracks">Adicionar</button></div><div class="manager-records">${portal.tracks.map(item => recordForm('tracks', item)).join('') || '<p class="admin-hint">Sem músicas registadas.</p>'}</div></article>
        <article class="client-card"><div class="manager-title-row"><h3>Reservas</h3><button class="client-link" type="button" data-client-add="bookings">Adicionar</button></div><div class="manager-records">${portal.bookings.map(item => recordForm('bookings', item)).join('') || '<p class="admin-hint">Sem reservas registadas.</p>'}</div></article>
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
      const field = name => card.querySelector(`[data-field="${name}"]`);
      const base = { amount: Number(field('amount').value || 0), paymentUrl: field('paymentUrl').value.trim(), paymentStatus: field('paymentStatus').checked ? 'paid' : 'pending' };
      return type === 'tracks' ? { ...base, title: field('title').value.trim(), stage: field('stage').value } : { ...base, service: field('service').value.trim(), startsAt: field('startsAt').value.replace('T', ' ') };
    }

    root.addEventListener('click', event => {
      const selected = event.target.closest('[data-client]');
      if (selected) return refresh(selected.dataset.client).catch(options.onError);
      if (event.target.closest('[data-new-client]')) {
        const password = crypto.randomUUID().slice(0, 12);
        return api('/client/admin/clients', { method: 'POST', body: JSON.stringify({ name: 'Novo cliente', username: `cliente-${Date.now()}`, password }) }).then(result => refresh(result.id)).catch(options.onError);
      }
      if (event.target.closest('[data-save-client]')) {
        const client = portal.client;
        const body = { name: root.querySelector('[data-client-field="name"]').value.trim(), phone: root.querySelector('[data-client-field="phone"]').value.trim(), password: root.querySelector('[data-client-field="password"]').value, active: root.querySelector('[data-client-field="active"]').checked };
        return api(`/client/admin/clients/${client.id}`, { method: 'PATCH', body: JSON.stringify(body) }).then(() => refresh(client.id)).catch(options.onError);
      }
      const add = event.target.closest('[data-client-add]');
      if (add) {
        const type = add.dataset.clientAdd;
        const body = type === 'tracks' ? { title: 'Nova música', stage: 'start', amount: 0, paymentStatus: 'pending' } : { service: 'Nova reserva', startsAt: '', amount: 0, paymentStatus: 'pending' };
        return api(`/client/admin/${type}/${portal.client.id}`, { method: 'POST', body: JSON.stringify(body) }).then(() => refresh()).catch(options.onError);
      }
      const remove = event.target.closest('[data-delete]');
      if (remove && window.confirm('Remover este registo?')) return api(`/client/admin/${remove.dataset.delete}/${remove.dataset.id}`, { method: 'DELETE', body: JSON.stringify({}) }).then(() => refresh()).catch(options.onError);
    });
    root.addEventListener('change', event => {
      const card = event.target.closest('[data-item]');
      if (card) api(`/client/admin/${card.dataset.item}/${card.dataset.id}`, { method: 'PATCH', body: JSON.stringify(payload(card)) }).then(() => refresh()).catch(options.onError);
    });
    return refresh();
  }
  return { mount };
})();
