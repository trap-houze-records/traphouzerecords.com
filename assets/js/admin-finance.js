window.FinanceModule = (() => {
  const money = cents => (Number(cents || 0) / 100).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
  const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const date = value => value ? new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${String(value).replace(' ', 'T')}Z`)) : 'Sem data';
  const recordLabel = item => item.type === 'track' ? `Música · ${item.stage || 'Iniciar'}` : item.type === 'appointment' ? 'Sessão na agenda' : 'Reserva manual';

  function mount(root, options) {
    let bookingServices = (options.bookingServices || []).map(item => ({ ...item }));
    let mixMasterServices = (options.mixMasterServices || []).map(item => ({ ...item }));
    async function api(path) {
      const response = await fetch(`${options.apiBase}${path}`, { headers: { Authorization: `Bearer ${options.getToken()}` } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível carregar o resumo financeiro.');
      return result;
    }
    function render(data) {
      const pending = data.items.filter(item => Number(item.outstandingCents || 0) > 0);
      const sessions = data.items.filter(item => item.type === 'appointment');
      root.innerHTML = `<section class="finance">
        <header class="finance-heading"><div><p class="eyebrow">Visão financeira</p><h2>Contas e sessões</h2><p>Valores das músicas, reservas manuais e marcações da agenda.</p></div><span>${data.items.length} registos</span></header>
        <section class="finance-pricing finance-pricing-compact"><div class="finance-pricing-head"><div><p class="eyebrow">Configuração</p><h3>Preços dos serviços</h3><p>Aplicados automaticamente a novas marcações e pedidos de Mix & Master.</p></div><button type="button" class="finance-save" data-save-service-prices>Guardar preços</button></div><div class="finance-pricing-list"><div class="finance-price-columns"><span>Reserva de estúdio</span><span>€/hora</span><span>Estado</span></div>${bookingServices.map((service, index) => `<div class="finance-price-row"><label><span class="sr-only">Serviço</span><input aria-label="Serviço" data-booking-price="title" data-index="${index}" value="${escapeHtml(service.title)}"></label><label><span class="sr-only">Preço por hora</span><input aria-label="Preço por hora" type="number" min="0" step="0.01" data-booking-price="pricePerHour" data-index="${index}" value="${Number(service.pricePerHour || 0)}"></label><label class="finance-price-availability"><input type="checkbox" data-booking-price="active" data-index="${index}" ${service.active !== false ? 'checked' : ''}><span>Disponível</span></label></div>`).join('')}</div><div class="finance-pricing-list finance-mix-pricing"><div class="finance-price-columns"><span>Mix & Master</span><span>Preço</span><span>Estado</span></div>${mixMasterServices.map((service, index) => `<div class="finance-price-row"><label><span class="sr-only">Serviço</span><input aria-label="Serviço" data-mix-price="title" data-index="${index}" value="${escapeHtml(service.title)}"></label><label><span class="sr-only">Preço</span><input aria-label="Preço" type="number" min="0" step="0.01" data-mix-price="price" data-index="${index}" value="${Number(service.price || 0)}"></label><label class="finance-price-availability"><input type="checkbox" data-mix-price="active" data-index="${index}" ${service.active !== false ? 'checked' : ''}><span>Disponível</span></label></div>`).join('')}</div></section>
        <section class="finance-totals" aria-label="Totais financeiros"><article><span>Faturação registada</span><strong>${money(data.totals.total)}</strong><small>músicas e reservas</small></article><article class="paid"><span>Recebido</span><strong>${money(data.totals.paid)}</strong><small>pagamentos confirmados</small></article><article class="pending"><span>Por receber</span><strong>${money(data.totals.pending)}</strong><small>${data.totals.pendingCount} pagamento${data.totals.pendingCount === 1 ? '' : 's'} pendente${data.totals.pendingCount === 1 ? '' : 's'}</small></article><article><span>Sessões registadas</span><strong>${sessions.length}</strong><small>na agenda do estúdio</small></article></section>
        <div class="finance-grid"><section class="finance-panel"><div class="finance-panel-head"><div><p class="eyebrow">A receber</p><h3>Pagamentos pendentes</h3></div><span>${pending.length}</span></div><div class="finance-list">${pending.length ? pending.map(item => `<article class="finance-item"><div><strong>${escapeHtml(item.description)}</strong><span>${escapeHtml(item.clientName)} · ${escapeHtml(recordLabel(item))}</span></div><div><b>${money(item.outstandingCents)}</b><small>${item.paidCents > 0 ? `Recebido ${money(item.paidCents)}` : 'Ainda sem pagamento'}</small>${item.paymentUrl ? `<a href="${escapeHtml(item.paymentUrl)}" target="_blank" rel="noopener">Pagamento →</a>` : ''}</div></article>`).join('') : '<p class="admin-hint">Não existem pagamentos pendentes.</p>'}</div></section>
        <section class="finance-panel"><div class="finance-panel-head"><div><p class="eyebrow">Por cliente</p><h3>Estado de contas</h3></div><span>${data.clients.length}</span></div><div class="finance-list">${data.clients.length ? data.clients.map(client => `<article class="finance-client"><div><strong>${escapeHtml(client.clientName)}</strong><span>${client.items} registo${client.items === 1 ? '' : 's'}</span></div><dl><div><dt>Recebido</dt><dd>${money(client.paid)}</dd></div><div><dt>Em falta</dt><dd class="${client.pending ? 'has-pending' : ''}">${money(client.pending)}</dd></div></dl></article>`).join('') : '<p class="admin-hint">Ainda não existem dados financeiros.</p>'}</div></section></div>
        <section class="finance-panel finance-history"><div class="finance-panel-head"><div><p class="eyebrow">Registos</p><h3>Histórico financeiro</h3></div></div><div class="finance-table"><div class="finance-table-head"><span>Descrição</span><span>Cliente</span><span>Data</span><span>Estado</span><span>Valor</span></div>${data.items.map(item => `<article><span><strong>${escapeHtml(item.description)}</strong><small>${escapeHtml(recordLabel(item))}</small></span><span>${escapeHtml(item.clientName)}</span><span>${date(item.createdAt)}</span><span class="finance-status ${item.paymentStatus}">${item.paymentStatus === 'paid' ? 'Pago' : item.paymentStatus === 'partial' ? 'Parcial' : 'Pendente'}</span><strong>${money(item.amountCents)}<small>${item.outstandingCents > 0 ? `Faltam ${money(item.outstandingCents)}` : `Recebido ${money(item.paidCents)}`}</small></strong></article>`).join('') || '<p class="admin-hint">Ainda não existem registos financeiros.</p>'}</div></section></section>`;
    }
    root.innerHTML = '<p class="admin-hint">A carregar resumo financeiro…</p>';
    root.addEventListener('input', event => {
      const field = event.target.closest('[data-booking-price]'); if (!field) return;
      const service = bookingServices[Number(field.dataset.index)]; if (!service) return;
      service[field.dataset.bookingPrice] = field.dataset.bookingPrice === 'pricePerHour' ? Math.max(0, Number(field.value || 0)) : field.value;
    });
    root.addEventListener('change', event => {
      const field = event.target.closest('[data-booking-price]'); if (!field || field.dataset.bookingPrice !== 'active') return;
      const service = bookingServices[Number(field.dataset.index)]; if (service) service.active = field.checked;
    });
    root.addEventListener('input', event => {
      const field = event.target.closest('[data-mix-price]'); if (!field) return;
      const service = mixMasterServices[Number(field.dataset.index)]; if (!service) return;
      service[field.dataset.mixPrice] = field.dataset.mixPrice === 'price' ? Math.max(0, Number(field.value || 0)) : field.value;
    });
    root.addEventListener('change', event => {
      const field = event.target.closest('[data-mix-price]'); if (!field || field.dataset.mixPrice !== 'active') return;
      const service = mixMasterServices[Number(field.dataset.index)]; if (service) service.active = field.checked;
    });
    root.addEventListener('click', event => { if (event.target.closest('[data-save-service-prices]')) options.saveServices(bookingServices, mixMasterServices).catch(options.onError); });
    return api('/finance/summary').then(render);
  }
  return { mount };
})();
