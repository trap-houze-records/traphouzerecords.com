window.FinanceModule = (() => {
  const money = cents => (Number(cents || 0) / 100).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
  const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const date = value => value ? new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${String(value).replace(' ', 'T')}Z`)) : 'Sem data';

  function mount(root, options) {
    let bookingServices = (options.bookingServices || []).map(item => ({ ...item }));
    async function api(path) {
      const response = await fetch(`${options.apiBase}${path}`, { headers: { Authorization: `Bearer ${options.getToken()}` } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível carregar o resumo financeiro.');
      return result;
    }
    function render(data) {
      const pending = data.items.filter(item => item.paymentStatus !== 'paid');
      root.innerHTML = `<section class="finance">
        <section class="finance-panel finance-pricing"><div class="finance-pricing-head"><div><h3>Preços das reservas</h3><p>Aplicados automaticamente a novas marcações.</p></div><button type="button" class="finance-save" data-save-booking-prices>Guardar</button></div><div class="finance-pricing-list">${bookingServices.map((service, index) => `<div class="finance-price-row"><label><span>Serviço</span><input data-booking-price="title" data-index="${index}" value="${escapeHtml(service.title)}"></label><label><span>€/hora</span><input type="number" min="0" step="0.01" data-booking-price="pricePerHour" data-index="${index}" value="${Number(service.pricePerHour || 0)}"></label><label class="finance-price-availability"><input type="checkbox" data-booking-price="active" data-index="${index}" ${service.active !== false ? 'checked' : ''}><span>Disponível</span></label></div>`).join('')}</div></section>
        <section class="finance-totals" aria-label="Totais financeiros"><article><span>Faturação registada</span><strong>${money(data.totals.total)}</strong><small>músicas e reservas</small></article><article class="paid"><span>Recebido</span><strong>${money(data.totals.paid)}</strong><small>pagamentos confirmados</small></article><article class="pending"><span>Por receber</span><strong>${money(data.totals.pending)}</strong><small>${data.totals.pendingCount} pagamento${data.totals.pendingCount === 1 ? '' : 's'} pendente${data.totals.pendingCount === 1 ? '' : 's'}</small></article></section>
        <div class="finance-grid"><section class="finance-panel"><div class="finance-panel-head"><div><p class="eyebrow">A receber</p><h3>Pagamentos pendentes</h3></div><span>${pending.length}</span></div><div class="finance-list">${pending.length ? pending.map(item => `<article class="finance-item"><div><strong>${escapeHtml(item.description)}</strong><span>${escapeHtml(item.clientName)} · ${item.type === 'track' ? (item.stage || 'Música') : 'Reserva'}</span></div><div><b>${money(item.amountCents)}</b>${item.paymentUrl ? `<a href="${escapeHtml(item.paymentUrl)}" target="_blank" rel="noopener">Pagamento ↗</a>` : '<small>Sem link de pagamento</small>'}</div></article>`).join('') : '<p class="admin-hint">Não existem pagamentos pendentes.</p>'}</div></section>
        <section class="finance-panel"><div class="finance-panel-head"><div><p class="eyebrow">Por cliente</p><h3>Estado de contas</h3></div><span>${data.clients.length}</span></div><div class="finance-list">${data.clients.length ? data.clients.map(client => `<article class="finance-client"><div><strong>${escapeHtml(client.clientName)}</strong><span>${client.items} registo${client.items === 1 ? '' : 's'}</span></div><dl><div><dt>Recebido</dt><dd>${money(client.paid)}</dd></div><div><dt>Em falta</dt><dd class="${client.pending ? 'has-pending' : ''}">${money(client.pending)}</dd></div></dl></article>`).join('') : '<p class="admin-hint">Ainda não existem dados financeiros.</p>'}</div></section></div>
        <section class="finance-panel finance-history"><div class="finance-panel-head"><div><p class="eyebrow">Registos</p><h3>Histórico financeiro</h3></div></div><div class="finance-table"><div class="finance-table-head"><span>Descrição</span><span>Cliente</span><span>Data</span><span>Estado</span><span>Valor</span></div>${data.items.map(item => `<article><span><strong>${escapeHtml(item.description)}</strong><small>${item.type === 'track' ? `Música · ${escapeHtml(item.stage || 'Iniciar')}` : 'Reserva'}</small></span><span>${escapeHtml(item.clientName)}</span><span>${date(item.createdAt)}</span><span class="finance-status ${item.paymentStatus}">${item.paymentStatus === 'paid' ? 'Pago' : 'Pendente'}</span><strong>${money(item.amountCents)}</strong></article>`).join('') || '<p class="admin-hint">Ainda não existem registos financeiros.</p>'}</div></section></section>`;
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
    root.addEventListener('click', event => { if (event.target.closest('[data-save-booking-prices]')) options.saveBookingServices(bookingServices).catch(options.onError); });
    return api('/finance/summary').then(render);
  }
  return { mount };
})();
