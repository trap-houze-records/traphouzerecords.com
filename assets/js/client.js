const storageKey = 'th_client_portal_data';
const defaultClientData = {
  client: 'Dinis',
  tracks: [
    { title: 'NOITE LONGA', stage: 'mix', paid: false, amount: 45, paymentUrl: '' },
    { title: 'SEM MEDO', stage: 'master', paid: true, amount: 60, paymentUrl: '' }
  ],
  bookings: [
    { date: '18 AGO', time: '16:00 — 18:00', service: 'Sessão de Estúdio', paid: false, amount: 30, paymentUrl: '' },
    { date: '02 AGO', time: '14:00 — 16:00', service: 'Captação vocal', paid: true, amount: 40, paymentUrl: '' }
  ]
};
let clientData = defaultClientData;
const apiBase = (window.CLIENT_PORTAL_API_URL || window.CMS_API_URL || '').replace(/\/$/, '');
const usesLocalPortalApi = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(apiBase);
const clientTokenKey = 'th_client_portal_token';
let apiToken = localStorage.getItem(clientTokenKey) || sessionStorage.getItem(clientTokenKey) || '';
if (apiToken) {
  localStorage.setItem(clientTokenKey, apiToken);
  sessionStorage.removeItem(clientTokenKey);
}

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const stages = [['start', 'Iniciar'], ['mix', 'Mix'], ['master', 'Master']];
const money = value => `${Number(value || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const profileImage = value => /^(?:\/?images\/[-a-zA-Z0-9_./]+|https:\/\/[^\s]+)$/i.test(String(value || '')) ? String(value) : '/images/Logo.png';
function normalisePortal(data) {
  const appointments = (data.appointments || []).map(item => ({ id: item.id, appointmentId: item.id, date: item.startsAt || 'A confirmar', time: item.endsAt ? `${String(item.startsAt || '').slice(11, 16)} — ${String(item.endsAt).slice(11, 16)}` : '', service: item.service, paid: item.paymentStatus === 'paid', amount: Number(item.amountCents || 0) / 100, paymentUrl: item.paymentUrl || '' }));
  const linkedAppointments = new Set((data.bookings || []).map(item => item.appointmentId).filter(Boolean));
  return {
    client: data.client.name,
    artistProfile: data.artistProfile || null,
    tracks: (data.tracks || []).map(item => ({ title: item.title, stage: item.stage, paid: item.paymentStatus === 'paid', amount: Number(item.amountCents || 0) / 100, paymentUrl: item.paymentUrl || '', samplyUrl: item.samplyUrl || '' })),
    bookings: [...appointments, ...(data.bookings || []).filter(item => !linkedAppointments.has(item.appointmentId)).map(item => ({ id: item.id, date: item.startsAt || 'A confirmar', time: '', service: item.service, paid: item.paymentStatus === 'paid', amount: Number(item.amountCents || 0) / 100, paymentUrl: item.paymentUrl || '' }))]
  };
}

function renderArtistProfile(profile) {
  if (!profile) return '';
  return `<section class="client-artist-profile"><div class="booking-section-heading"><div><p class="eyebrow">Perfil público</p><h2>O teu perfil de artista</h2></div><span>Visível no site</span></div><div class="client-artist-profile-body"><div class="client-artist-photo"><img src="${escapeHtml(profileImage(profile.image))}" alt="Fotografia de ${escapeHtml(profile.artistName || clientData.client)}"><label>Atualizar fotografia<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" data-artist-profile-image></label></div><form id="artistProfileForm" class="client-artist-form"><p>Atualiza a biografia e os links. A Trap Houze mantém o catálogo e escolhe o que fica visível no perfil público.</p><label>Biografia<textarea name="bio" rows="4" maxlength="2000">${escapeHtml(profile.bio || '')}</textarea></label><div><label>Instagram<input name="instagram" type="url" placeholder="https://instagram.com/..." value="${escapeHtml(profile.instagram || '')}"></label><label>YouTube<input name="youtube" type="url" placeholder="https://youtube.com/..." value="${escapeHtml(profile.youtube || '')}"></label><label>Spotify<input name="spotify" type="url" placeholder="https://open.spotify.com/..." value="${escapeHtml(profile.spotify || '')}"></label><label>Apple Music<input name="appleMusic" type="url" placeholder="https://music.apple.com/..." value="${escapeHtml(profile.appleMusic || '')}"></label></div><button type="submit">Guardar perfil <span>→</span></button><small id="artistProfileNotice" role="status"></small></form></div></section>`;
}
async function apiRequest(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}), ...options.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Não foi possível completar o pedido.');
  return body;
}

function renderTrack(track) {
  const samplyUrl = String(track.samplyUrl || '');
  const samplyPlayer = /^https:\/\/(?:www\.)?samply\.app\/embed\/[A-Za-z0-9_-]+\/?(?:\?.*)?$/i.test(samplyUrl)
    ? `<div class="track-samply"><p class="eyebrow">Ouvir no Samply</p><iframe src="${escapeHtml(samplyUrl)}" title="Player Samply: ${escapeHtml(track.title)}" loading="lazy" allow="autoplay; clipboard-write; encrypted-media"></iframe></div>`
    : '';
  return `<article class="track-card">
    <div class="track-heading"><p class="eyebrow">Música</p><h2>${escapeHtml(track.title)}</h2></div>
    <div class="track-stages" aria-label="Estado do trabalho">
      ${stages.map(([id, label], index) => {
        const activeIndex = stages.findIndex(([stage]) => stage === String(track.stage).toLowerCase());
        const state = index < activeIndex ? 'complete' : index === activeIndex ? 'current' : '';
        return `<div class="track-stage ${state}"><span>${index + 1}</span><strong>${label}</strong></div>`;
      }).join('')}
    </div>
    ${samplyPlayer}
    <div class="track-payment ${track.paid ? 'paid' : 'pending'}"><span>${track.paid ? 'Pagamento confirmado' : `Pagamento pendente · ${money(track.amount)}`}</span>${track.paid ? '<span class="track-payment-mark">✓</span>' : `<button type="button" data-payment-url="${escapeHtml(track.paymentUrl || '')}">Pagar ${money(track.amount)}</button>`}</div>
  </article>`;
}

function bookingDisplay(booking) {
  const moment = bookingMoment(booking);
  if (!moment) return { date: booking.date || 'Data a confirmar', time: booking.time || 'Horário a confirmar' };
  const date = new Intl.DateTimeFormat('pt-PT', { weekday: 'short', day: 'numeric', month: 'long' }).format(moment).replace('.', '');
  const start = new Intl.DateTimeFormat('pt-PT', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(moment);
  return { date, time: booking.time || start };
}
function renderBooking(booking) {
  const display = bookingDisplay(booking);
  const hasAmount = Number(booking.amount || 0) > 0;
  const payment = booking.paid ? '<span>Pago ✓</span>' : hasAmount ? `<button type="button" data-payment-url="${escapeHtml(booking.paymentUrl || '')}">Pagar ${money(booking.amount)}</button>` : '<span class="booking-payment-unset">Pagamento a definir</span>';
  const reschedule = booking.appointmentId && bookingMoment(booking) >= new Date() ? `<a class="booking-reschedule" href="/booking.html?reschedule=${encodeURIComponent(booking.appointmentId)}">Reagendar →</a>` : '';
  return `<article class="booking-row"><time>${escapeHtml(display.date)}</time><div><strong>${escapeHtml(booking.service)}</strong><p>${escapeHtml(display.time)}</p></div><div class="booking-payment ${booking.paid ? 'paid' : 'pending'}">${payment}${reschedule}</div></article>`;
}
function bookingMoment(booking) {
  const value = String(booking.date || '').trim().replace(' ', 'T');
  const moment = new Date(value);
  return Number.isNaN(moment.getTime()) ? null : moment;
}
function splitBookings(bookings) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dated = bookings.map((booking, index) => ({ booking, index, moment: bookingMoment(booking) }));
  const compare = (a, b) => (a.moment?.getTime() || 0) - (b.moment?.getTime() || 0) || a.index - b.index;
  return {
    upcoming: dated.filter(item => !item.moment || item.moment >= today).sort(compare).map(item => item.booking),
    history: dated.filter(item => item.moment && item.moment < today).sort((a, b) => compare(b, a)).map(item => item.booking)
  };
}

const portal = document.getElementById('clientPortal');

function renderPortal() {
const outstanding = [...clientData.tracks, ...clientData.bookings].filter(item => !item.paid).reduce((total, item) => total + Number(item.amount || 0), 0);
const portalNote = apiBase ? 'Área privada · acesso protegido por credenciais.' : 'Protótipo local · o acesso real de cada cliente será ligado numa fase seguinte.';
const bookings = splitBookings(clientData.bookings);
portal.innerHTML = `<div class="client-shell client-simple">
  <header class="client-header"><a class="client-brand" href="/" aria-label="Trap Houze Records"><img src="/images/Logo.png" alt="Trap Houze Records"><span>Área do cliente</span></a><div class="client-user"><span>Olá, ${escapeHtml(clientData.client)}</span>${apiBase ? '<a class="client-book-session" href="/booking.html">Agendar sessão</a>' : ''}<button class="client-signout" type="button">Sair</button></div></header>
  <section class="client-simple-hero"><p class="eyebrow">O teu trabalho</p><h1>A tua agenda</h1><p>Reservas, músicas e pagamentos num só lugar.</p>${outstanding ? `<div class="client-total-due"><span>Total em falta</span><strong>${money(outstanding)}</strong></div>` : ''}</section>
  ${renderArtistProfile(clientData.artistProfile)}
  <section class="booking-section booking-section-upcoming"><div class="booking-section-heading"><div><p class="eyebrow">Próximas sessões</p><h2>Reservas futuras</h2></div><span>${bookings.upcoming.length} agendadas</span></div><div class="booking-list">${bookings.upcoming.map(renderBooking).join('') || '<p class="client-empty">Ainda não tens reservas futuras.</p>'}</div></section>
  <section class="track-section"><div class="booking-section-heading"><div><p class="eyebrow">Música</p><h2>As tuas músicas</h2></div><span>${clientData.tracks.length} registadas</span></div><div class="track-list">${clientData.tracks.map(renderTrack).join('') || '<p class="client-empty">Ainda não tens músicas registadas.</p>'}</div></section>
  <section class="booking-section booking-section-history"><div class="booking-section-heading"><div><p class="eyebrow">Histórico</p><h2>Reservas anteriores</h2></div><span>${bookings.history.length} concluídas</span></div><div class="booking-list">${bookings.history.map(renderBooking).join('') || '<p class="client-empty">Ainda não existem reservas anteriores.</p>'}</div></section>
  <aside class="client-simple-help"><span>Precisas de ajuda?</span><a href="https://wa.me/351910734914" target="_blank" rel="noopener">Abrir WhatsApp <b>→</b></a></aside>
  <p class="client-demo">${portalNote}</p>
</div>`;
}

function renderLogin(message = '') {
  portal.innerHTML = `<main class="client-login-shell"><section class="client-login-card"><a class="client-brand" href="/" aria-label="Trap Houze Records"><img src="/images/Logo.png" alt="Trap Houze Records"><span>Área do cliente</span></a><div><p class="eyebrow">Acesso privado</p><h1>O teu trabalho, num só lugar.</h1><p>Entra com o teu nome e a palavra-passe enviada pela Trap Houze Records.</p></div><form id="clientLoginForm" class="client-login-form"><label>Nome do cliente<input name="username" autocomplete="username" required></label><label>Palavra-passe<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">Entrar <span>→</span></button><p id="clientLoginMessage" role="alert">${escapeHtml(message)}</p></form><p class="client-login-help">Ainda não tens acesso? <a href="https://wa.me/351910734914" target="_blank" rel="noopener">Fala connosco</a></p></section></main>`;
  document.getElementById('clientLoginForm').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = form.get('username').trim().toLowerCase();
    if (apiBase) {
      apiRequest('/client/auth/login', { method: 'POST', body: JSON.stringify({ username, password: form.get('password') }) }).then(result => {
        apiToken = result.token;
        localStorage.setItem(clientTokenKey, apiToken);
        clientData = normalisePortal(result.portal);
        renderPortal();
      }).catch(caught => {
        const message = usesLocalPortalApi && caught.message === 'Credenciais inválidas.'
          ? 'Estás na versão local. Esta usa uma base de dados separada da versão online; cria aqui um cliente de teste ou entra em traphouzerecords.com/zona-do-artista/.'
          : caught.message;
        renderLogin(message);
      });
      return;
    }
    const client = loadClients().find(item => item.username.toLowerCase() === username && item.password === form.get('password'));
    if (client?.active !== false) {
      clientData = client;
      sessionStorage.setItem('th_client_demo', username);
      renderPortal();
    } else if (client) renderLogin('Esta conta está temporariamente sem acesso. Fala com a Trap Houze Records.');
    else renderLogin('Credenciais inválidas. Nesta demonstração usa Dinis / demo.');
  });
}

document.addEventListener('click', event => {
  const payment = event.target.closest('[data-payment-url]');
  if (payment) {
    const url = payment.dataset.paymentUrl;
    if (url && /^https:\/\//i.test(url)) window.open(url, '_blank', 'noopener');
    else alert('A Trap Houze ainda não adicionou um link de pagamento para este item.');
  }
  if (event.target.closest('.client-signout')) {
    sessionStorage.removeItem('th_client_demo');
    if (apiBase && apiToken) apiRequest('/client/auth/logout', { method: 'POST' }).catch(() => {}).finally(() => { apiToken = ''; localStorage.removeItem(clientTokenKey); sessionStorage.removeItem(clientTokenKey); renderLogin(); });
    else renderLogin();
  }
});

document.addEventListener('submit', event => {
  if (event.target.id !== 'artistProfileForm') return;
  event.preventDefault();
  const form = new FormData(event.target);
  const button = event.target.querySelector('button[type="submit"]');
  const note = document.getElementById('artistProfileNotice');
  button.disabled = true;
  if (note) note.textContent = 'A guardar…';
  apiRequest('/client/artist-profile', { method: 'PATCH', body: JSON.stringify(Object.fromEntries(form)) }).then(profile => {
    clientData.artistProfile = profile;
    renderPortal();
  }).catch(error => {
    button.disabled = false;
    if (note) note.textContent = error.message;
  });
});

document.addEventListener('change', event => {
  if (!event.target.matches('[data-artist-profile-image]')) return;
  const file = event.target.files?.[0];
  if (!file) return;
  const form = new FormData();
  form.append('image', file);
  const note = document.getElementById('artistProfileNotice');
  if (note) note.textContent = 'A enviar fotografia…';
  fetch(`${apiBase}/client/artist-image`, { method: 'POST', headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {}, body: form }).then(async response => {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível atualizar a fotografia.');
    return result;
  }).then(profile => {
    clientData.artistProfile = profile;
    renderPortal();
  }).catch(error => { if (note) note.textContent = error.message; });
});

function loadClients() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(saved) && saved.length) return saved;
  } catch { /* Usa os dados de demonstração. */ }
  return [{ name: defaultClientData.client, username: 'dinis', password: 'demo', tracks: defaultClientData.tracks, bookings: defaultClientData.bookings }];
}
const savedUsername = sessionStorage.getItem('th_client_demo');
const savedClient = loadClients().find(item => item.username.toLowerCase() === savedUsername);
const previewUsername = new URLSearchParams(location.search).get('preview')?.toLowerCase();
const previewClient = location.protocol === 'file:' && previewUsername ? loadClients().find(item => item.username.toLowerCase() === previewUsername) : null;
if (apiBase && apiToken) {
  apiRequest('/client/portal').then(result => { clientData = normalisePortal(result); renderPortal(); }).catch(() => { apiToken = ''; localStorage.removeItem(clientTokenKey); sessionStorage.removeItem(clientTokenKey); renderLogin(); });
} else if (apiBase) renderLogin();
else if (previewClient) { clientData = previewClient; renderPortal(); }
else if (savedClient?.active !== false) { clientData = savedClient; renderPortal(); }
else { sessionStorage.removeItem('th_client_demo'); renderLogin(savedClient ? 'Esta conta está temporariamente sem acesso.' : ''); }
