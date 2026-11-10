window.FinanceModule = (() => {
  const money = cents => (Number(cents || 0) / 100).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
  const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const date = value => value ? new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${String(value).replace(' ', 'T')}Z`)) : 'Sem data';
  const monthKey = value => /^\d{4}-\d{2}/.test(String(value || '')) ? String(value).slice(0, 7) : '';
  const monthLabel = value => {
    const [year, month] = String(value || '').split('-').map(Number);
    return year && month ? new Intl.DateTimeFormat('pt-PT', { month: 'long', year: 'numeric' }).format(new Date(Date.UTC(year, month - 1, 15))) : 'Mês por selecionar';
  };
  const currentMonth = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  };
  const shiftMonth = (value, amount) => {
    const [year, month] = String(value).split('-').map(Number);
    const next = new Date(Date.UTC(year, month - 1 + amount, 1));
    return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const stageLabel = stage => ({ start: 'Gravação', mix: 'Mix', master: 'Master' }[stage] || 'Gravação');
  const recordLabel = item => item.type === 'track' ? `Música · ${stageLabel(item.stage)}` : item.type === 'appointment' ? 'Sessão na agenda' : 'Reserva manual';
  const typeLabel = type => ({ appointment: 'Sessões de estúdio', track: 'Mix & Master', booking: 'Reservas manuais' }[type] || 'Outros');
  const paymentLabel = status => ({ paid: 'Pago', partial: 'Parcial', pending: 'Pendente' }[status] || 'Pendente');
  const duration = item => {
    if (!item.createdAt || !item.endsAt) return 0;
    const start = new Date(`${String(item.createdAt).replace(' ', 'T')}Z`).getTime();
    const end = new Date(`${String(item.endsAt).replace(' ', 'T')}Z`).getTime();
    return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, (end - start) / 3600000) : 0;
  };
  const durationLabel = hours => `${Number(hours || 0).toLocaleString('pt-PT', { maximumFractionDigits: 1 })}h`;
  const summarize = items => items.reduce((summary, item) => {
    summary.total += Number(item.amountCents || 0);
    summary.paid += Number(item.paidCents || 0);
    summary.pending += Number(item.outstandingCents || 0);
    summary.records += 1;
    if (Number(item.outstandingCents || 0) > 0) summary.pendingCount += 1;
    if (item.type === 'appointment') { summary.sessions += 1; summary.hours += duration(item); }
    return summary;
  }, { total: 0, paid: 0, pending: 0, records: 0, pendingCount: 0, sessions: 0, hours: 0 });
  const groupClients = items => {
    const clients = new Map();
    items.forEach(item => {
      const entry = clients.get(item.clientId) || { clientId: item.clientId, clientName: item.clientName, paid: 0, pending: 0, total: 0, items: 0 };
      entry.items += 1;
      entry.total += Number(item.amountCents || 0);
      entry.paid += Number(item.paidCents || 0);
      entry.pending += Number(item.outstandingCents || 0);
      clients.set(item.clientId, entry);
    });
    return [...clients.values()].sort((a, b) => b.pending - a.pending || b.total - a.total);
  };

  function mount(root, options) {
    let bookingServices = (options.bookingServices || []).map(item => ({ ...item }));
    let mixMasterServices = (options.mixMasterServices || []).map(item => ({ ...item }));
    let financeData = null;
    let activeView = 'overview';
    let selectedMonth = currentMonth();

    async function api(path) {
      const response = await fetch(`${options.apiBase}${path}`, { headers: { Authorization: `Bearer ${options.getToken()}` } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível carregar o resumo financeiro.');
      return result;
    }

    function pricingView() {
      return `<section class="finance-pricing finance-pricing-standalone"><div class="finance-pricing-head"><div><p class="eyebrow">Configuração</p><h3>Preços dos serviços</h3><p>Valores aplicados automaticamente a novas marcações e pedidos de Mix & Master.</p></div><button type="button" class="finance-save" data-save-service-prices>Guardar preços</button></div><div class="finance-pricing-list"><div class="finance-price-columns"><span>Reserva de estúdio</span><span>€/hora</span><span>Estado</span></div>${bookingServices.map((service, index) => `<div class="finance-price-row"><label><span class="sr-only">Serviço</span><input aria-label="Serviço" data-booking-price="title" data-index="${index}" value="${escapeHtml(service.title)}"></label><label><span class="sr-only">Preço por hora</span><input aria-label="Preço por hora" type="number" min="0" step="0.01" data-booking-price="pricePerHour" data-index="${index}" value="${Number(service.pricePerHour || 0)}"></label><label class="finance-price-availability"><input type="checkbox" data-booking-price="active" data-index="${index}" ${service.active !== false ? 'checked' : ''}><span>Disponível</span></label></div>`).join('')}</div><div class="finance-pricing-list finance-mix-pricing"><div class="finance-price-columns"><span>Mix & Master</span><span>Preço</span><span>Estado</span></div>${mixMasterServices.map((service, index) => `<div class="finance-price-row"><label><span class="sr-only">Serviço</span><input aria-label="Serviço" data-mix-price="title" data-index="${index}" value="${escapeHtml(service.title)}"></label><label><span class="sr-only">Preço</span><input aria-label="Preço" type="number" min="0" step="0.01" data-mix-price="price" data-index="${index}" value="${Number(service.price || 0)}"></label><label class="finance-price-availability"><input type="checkbox" data-mix-price="active" data-index="${index}" ${service.active !== false ? 'checked' : ''}><span>Disponível</span></label></div>`).join('')}</div></section>`;
    }

    function trendView(items) {
      const months = [];
      for (let offset = 5; offset >= 0; offset -= 1) months.push(shiftMonth(selectedMonth, -offset));
      const summaries = months.map(month => ({ month, ...summarize(items.filter(item => monthKey(item.createdAt) === month)) }));
      const ceiling = Math.max(1, ...summaries.map(item => item.total));
      return `<section class="finance-panel finance-trend"><div class="finance-panel-head"><div><p class="eyebrow">Evolução</p><h3>Últimos seis meses</h3></div></div><div class="finance-trend-chart">${summaries.map(item => `<button type="button" data-finance-month="${item.month}" class="${item.month === selectedMonth ? 'active' : ''}" title="${escapeHtml(monthLabel(item.month))}: ${money(item.total)}"><span class="finance-trend-value">${money(item.total)}</span><i><b style="height:${Math.max(item.total ? 8 : 2, Math.round(item.total / ceiling * 100))}%"></b></i><small>${new Intl.DateTimeFormat('pt-PT', { month: 'short' }).format(new Date(`${item.month}-15T12:00:00Z`))}</small></button>`).join('')}</div></section>`;
    }

    function sourceView(items) {
      return `<section class="finance-source-grid">${['appointment', 'track', 'booking'].map(type => { const records = items.filter(item => item.type === type); const totals = summarize(records); return `<article><div><span>${typeLabel(type)}</span><strong>${totals.records}</strong></div><dl><div><dt>Faturado</dt><dd>${money(totals.total)}</dd></div><div><dt>Recebido</dt><dd>${money(totals.paid)}</dd></div><div><dt>Em falta</dt><dd class="${totals.pending ? 'has-pending' : ''}">${money(totals.pending)}</dd></div>${type === 'appointment' ? `<div><dt>Ocupação</dt><dd>${durationLabel(totals.hours)}</dd></div>` : ''}</dl></article>`; }).join('')}</section>`;
    }

    function monthlyView(data) {
      const items = data.items.filter(item => monthKey(item.createdAt) === selectedMonth);
      const totals = summarize(items);
      const pending = items.filter(item => Number(item.outstandingCents || 0) > 0).sort((a, b) => b.outstandingCents - a.outstandingCents);
      const clients = groupClients(items);
      const months = [...new Set([currentMonth(), selectedMonth, ...data.items.map(item => monthKey(item.createdAt)).filter(Boolean)])].sort().reverse();
      const collectionRate = totals.total ? Math.round(totals.paid / totals.total * 100) : 0;
      return `<div class="finance-month-view"><section class="finance-month-toolbar"><button type="button" data-month-shift="-1" aria-label="Mês anterior">←</button><label><span>Mês em análise</span><select data-finance-month-select>${months.map(month => `<option value="${month}" ${month === selectedMonth ? 'selected' : ''}>${escapeHtml(monthLabel(month))}</option>`).join('')}</select></label><button type="button" data-month-shift="1" aria-label="Mês seguinte" ${selectedMonth >= currentMonth() ? 'disabled' : ''}>→</button><div><strong>${totals.records} movimento${totals.records === 1 ? '' : 's'}</strong><span>${totals.sessions} sess${totals.sessions === 1 ? 'ão' : 'ões'} · ${durationLabel(totals.hours)}</span></div></section>
        <section class="finance-totals" aria-label="Totais do mês"><article><span>Faturado</span><strong>${money(totals.total)}</strong><small>valor total registado</small></article><article class="paid"><span>Recebido</span><strong>${money(totals.paid)}</strong><small>${collectionRate}% do valor faturado</small></article><article class="pending"><span>Por receber</span><strong>${money(totals.pending)}</strong><small>${totals.pendingCount} pagamento${totals.pendingCount === 1 ? '' : 's'} pendente${totals.pendingCount === 1 ? '' : 's'}</small></article><article><span>Atividade</span><strong>${totals.records}</strong><small>${totals.sessions} sessões · ${durationLabel(totals.hours)}</small></article></section>
        ${trendView(data.items)}
        <div class="finance-section-title"><div><p class="eyebrow">Origem</p><h3>Faturação por serviço</h3></div><span>${escapeHtml(monthLabel(selectedMonth))}</span></div>${sourceView(items)}
        <div class="finance-grid"><section class="finance-panel"><div class="finance-panel-head"><div><p class="eyebrow">A receber</p><h3>Pagamentos pendentes</h3></div><span>${pending.length}</span></div><div class="finance-list">${pending.length ? pending.map(item => `<article class="finance-item"><div><strong>${escapeHtml(item.description)}</strong><span>${escapeHtml(item.clientName)} · ${escapeHtml(recordLabel(item))}</span></div><div><b>${money(item.outstandingCents)}</b><small>${item.paidCents > 0 ? `Recebido ${money(item.paidCents)}` : 'Ainda sem pagamento'}</small>${item.paymentUrl ? `<a href="${escapeHtml(item.paymentUrl)}" target="_blank" rel="noopener">Pagamento →</a>` : ''}</div></article>`).join('') : '<p class="admin-hint">Não existem pagamentos pendentes neste mês.</p>'}</div></section>
        <section class="finance-panel"><div class="finance-panel-head"><div><p class="eyebrow">Por cliente</p><h3>Estado de contas</h3></div><span>${clients.length}</span></div><div class="finance-list">${clients.length ? clients.map(client => `<article class="finance-client"><div><strong>${escapeHtml(client.clientName)}</strong><span>${client.items} movimento${client.items === 1 ? '' : 's'} · ${money(client.total)}</span></div><dl><div><dt>Recebido</dt><dd>${money(client.paid)}</dd></div><div><dt>Em falta</dt><dd class="${client.pending ? 'has-pending' : ''}">${money(client.pending)}</dd></div></dl></article>`).join('') : '<p class="admin-hint">Ainda não existem movimentos neste mês.</p>'}</div></section></div>
        <section class="finance-panel finance-history"><div class="finance-panel-head"><div><p class="eyebrow">Movimentos</p><h3>Detalhe do mês</h3></div><span>${items.length}</span></div><div class="finance-table finance-table-detailed"><div class="finance-table-head"><span>Descrição</span><span>Cliente</span><span>Data</span><span>Estado</span><span>Total</span><span>Recebido</span><span>Em falta</span></div>${items.map(item => `<article><span><strong>${escapeHtml(item.description)}</strong><small>${escapeHtml(recordLabel(item))}${item.type === 'appointment' && duration(item) ? ` · ${durationLabel(duration(item))}` : ''}</small></span><span>${escapeHtml(item.clientName)}</span><span>${date(item.createdAt)}</span><span class="finance-status ${item.paymentStatus}">${paymentLabel(item.paymentStatus)}</span><strong>${money(item.amountCents)}</strong><strong class="finance-table-paid">${money(item.paidCents)}</strong><strong class="${item.outstandingCents ? 'finance-table-pending' : ''}">${money(item.outstandingCents)}</strong></article>`).join('') || '<p class="admin-hint">Ainda não existem movimentos neste mês.</p>'}</div></section></div>`;
    }

    function render() {
      if (!financeData) return;
      root.innerHTML = `<div class="finance"><header class="finance-heading"><div><p class="eyebrow">Finanças</p><h2>${activeView === 'overview' ? 'Visão financeira mensal' : 'Preços e serviços'}</h2><p>${activeView === 'overview' ? 'Acompanha faturação, recebimentos e valores pendentes por mês.' : 'Define os valores aplicados a novas reservas e trabalhos.'}</p></div><span>${financeData.items.length} registos no total</span></header><div class="finance-tabs" role="tablist" aria-label="Secções de Finanças"><button type="button" role="tab" aria-selected="${activeView === 'overview'}" data-finance-view="overview" class="${activeView === 'overview' ? 'active' : ''}">Visão mensal</button><button type="button" role="tab" aria-selected="${activeView === 'pricing'}" data-finance-view="pricing" class="${activeView === 'pricing' ? 'active' : ''}">Preços e serviços</button></div>${activeView === 'overview' ? monthlyView(financeData) : pricingView()}</div>`;
    }

    root.innerHTML = '<p class="admin-hint">A carregar resumo financeiro…</p>';
    root.addEventListener('input', event => {
      const field = event.target.closest('[data-booking-price]'); if (!field) return;
      const service = bookingServices[Number(field.dataset.index)]; if (!service) return;
      service[field.dataset.bookingPrice] = field.dataset.bookingPrice === 'pricePerHour' ? Math.max(0, Number(field.value || 0)) : field.value;
    });
    root.addEventListener('change', event => {
      const bookingField = event.target.closest('[data-booking-price]');
      if (bookingField?.dataset.bookingPrice === 'active') { const service = bookingServices[Number(bookingField.dataset.index)]; if (service) service.active = bookingField.checked; }
      const mixField = event.target.closest('[data-mix-price]');
      if (mixField?.dataset.mixPrice === 'active') { const service = mixMasterServices[Number(mixField.dataset.index)]; if (service) service.active = mixField.checked; }
      if (event.target.matches('[data-finance-month-select]')) { selectedMonth = event.target.value; render(); }
    });
    root.addEventListener('input', event => {
      const field = event.target.closest('[data-mix-price]'); if (!field) return;
      const service = mixMasterServices[Number(field.dataset.index)]; if (!service) return;
      service[field.dataset.mixPrice] = field.dataset.mixPrice === 'price' ? Math.max(0, Number(field.value || 0)) : field.value;
    });
    root.addEventListener('click', event => {
      const view = event.target.closest('[data-finance-view]');
      if (view) { activeView = view.dataset.financeView; return render(); }
      const shift = event.target.closest('[data-month-shift]');
      if (shift && !shift.disabled) { selectedMonth = shiftMonth(selectedMonth, Number(shift.dataset.monthShift)); return render(); }
      const month = event.target.closest('[data-finance-month]');
      if (month) { selectedMonth = month.dataset.financeMonth; return render(); }
      if (event.target.closest('[data-save-service-prices]')) options.saveServices(bookingServices, mixMasterServices).catch(options.onError);
    });
    return api('/finance/summary').then(data => { financeData = data; render(); });
  }
  return { mount };
})();
