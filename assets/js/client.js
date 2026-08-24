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
let musicTab = 'mix-master';
let submittingTrack = false;
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
const paymentFields = item => {
  const amount = item.amountCents === undefined ? Number(item.amount || 0) : Number(item.amountCents || 0) / 100;
  const paid = item.paidCents === undefined ? (item.paymentStatus === 'paid' || item.paid ? amount : 0) : Number(item.paidCents || 0) / 100;
  return { amount, paid, due: Math.max(0, amount - paid), paymentStatus: paid >= amount ? 'paid' : paid > 0 ? 'partial' : 'pending' };
};
const paymentLabel = item => item.amount > 0
  ? `Pago ${money(item.paid)}${item.due > 0 ? ` · faltam ${money(item.due)}` : ' · confirmado'}`
  : 'Pagamento a definir';
function normalisePortal(data) {
  const appointments = (data.appointments || []).map(item => ({ id: item.id, appointmentId: item.id, date: item.startsAt || 'A confirmar', time: item.endsAt ? `${String(item.startsAt || '').slice(11, 16)} — ${String(item.endsAt).slice(11, 16)}` : '', service: item.service, ...paymentFields(item), paymentUrl: item.paymentUrl || '' }));
  const linkedAppointments = new Set((data.bookings || []).map(item => item.appointmentId).filter(Boolean));
  return {
    client: data.client.name,
    artistProfile: data.artistProfile || null,
    tracks: (data.tracks || []).map(item => ({ id: item.id, title: item.title, stage: item.stage, category: item.category || 'mix-master', requestedService: item.requestedService || '', sourceTrackId: item.sourceTrackId || '', versions: item.versions || [], comments: item.comments || [], ...paymentFields(item), paymentUrl: item.paymentUrl || '', samplyUrl: item.samplyUrl || '' })),
    mixMasterServices: (data.mixMasterServices || []).filter(item => item.active !== false),
    bookings: [...appointments, ...(data.bookings || []).filter(item => !linkedAppointments.has(item.appointmentId)).map(item => ({ id: item.id, date: item.startsAt || 'A confirmar', time: '', service: item.service, ...paymentFields(item), paymentUrl: item.paymentUrl || '' }))]
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

function trackServiceLabel(track) {
  return track.category === 'recording' ? 'Gravação' : ({ mix: 'Mix', master: 'Master', 'mix-master': 'Mix & Master' }[track.requestedService] || 'Em produção');
}
function versionFileSize(size) { return Number(size || 0) >= 1024 * 1024 ? `${(Number(size) / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(Number(size || 0) / 1024))} KB`; }
function renderTrack(track) {
  const samplyUrl = String(track.samplyUrl || '');
  const samplyPlayer = /^https:\/\/(?:www\.)?samply\.app\/embed\/[A-Za-z0-9_-]+\/?(?:\?.*)?$/i.test(samplyUrl)
    ? `<div class="track-samply"><p class="eyebrow">Ouvir no Samply</p><iframe src="${escapeHtml(samplyUrl)}" title="Player Samply: ${escapeHtml(track.title)}" loading="lazy" allow="autoplay; clipboard-write; encrypted-media"></iframe></div>`
    : '';
  const versions = track.versions || [];
  const comments = track.comments || [];
  const latest = versions[0];
  const audio = latest ? `<div class="track-audio"><audio controls preload="none" data-track-audio="${escapeHtml(track.id)}" data-version-audio="${escapeHtml(latest.id)}"></audio><button type="button" data-download-version="${escapeHtml(latest.id)}" data-track-id="${escapeHtml(track.id)}">Download</button></div>` : '';
  const stagesPanel = track.category === 'recording' ? '' : `<div class="track-stages" aria-label="Estado do trabalho">${stages.map(([id, label], index) => {
    const activeIndex = stages.findIndex(([stage]) => stage === String(track.stage).toLowerCase());
    const state = index < activeIndex ? 'complete' : index === activeIndex ? 'current' : '';
    return `<div class="track-stage ${state}"><span>${index + 1}</span><strong>${label}</strong></div>`;
  }).join('')}</div>`;
  const versionsPanel = `<div class="track-workspace"><div class="track-workspace-heading"><strong>Versões</strong><span>${versions.length}</span></div>${versions.length ? versions.map((version, index) => `<div class="track-version ${index === 0 ? 'latest' : ''}"><span>${escapeHtml(version.label)}</span><small>${escapeHtml(version.originalName)} · ${versionFileSize(version.sizeBytes)}</small><div><button type="button" data-play-version="${escapeHtml(version.id)}" data-track-id="${escapeHtml(track.id)}">Ouvir</button><button type="button" data-download-version="${escapeHtml(version.id)}" data-track-id="${escapeHtml(track.id)}">Descarregar</button></div></div>`).join('') : '<p class="track-empty">Ainda não foi carregada nenhuma versão.</p>'}<form class="track-upload-form" data-track-upload="${escapeHtml(track.id)}"><label>Adicionar versão<input name="file" type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/mp4,audio/aac,audio/ogg" required></label><input name="label" maxlength="120" placeholder="Ex.: V2 · revisão"><button type="submit">Enviar</button></form></div>`;
  const commentsPanel = `<div class="track-workspace track-comments"><div class="track-workspace-heading"><strong>Comentários</strong><span>${comments.length}</span></div>${comments.length ? comments.map(comment => `<article><b>${comment.authorType === 'admin' ? 'Trap Houze' : 'Tu'}</b><p>${escapeHtml(comment.body)}</p></article>`).join('') : '<p class="track-empty">Sem comentários por agora.</p>'}<form class="track-comment-form" data-track-comment="${escapeHtml(track.id)}"><textarea name="body" rows="2" maxlength="2000" placeholder="Deixa uma nota sobre esta música ou versão"></textarea><button type="submit">Comentar</button></form></div>`;
  return `<article class="track-card">
    <div class="track-heading"><p class="eyebrow">${trackServiceLabel(track)}</p><h2>${escapeHtml(track.title)}</h2></div>
    ${stagesPanel}
    ${audio}${samplyPlayer}
    ${track.category === 'recording' ? '' : `<div class="track-payment ${track.paymentStatus}"><span>${paymentLabel(track)}</span>${track.due === 0 ? '<span class="track-payment-mark">✓</span>' : `<button type="button" data-payment-url="${escapeHtml(track.paymentUrl || '')}">Pagar ${money(track.due)}</button>`}</div>`}
    ${versionsPanel}${commentsPanel}
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
  const payment = hasAmount
    ? `<span>${paymentLabel(booking)}</span>${booking.due > 0 ? `<button type="button" data-payment-url="${escapeHtml(booking.paymentUrl || '')}">Pagar ${money(booking.due)}</button>` : ''}`
    : '<span class="booking-payment-unset">Pagamento a definir</span>';
  const reschedule = booking.appointmentId && bookingMoment(booking) >= new Date() ? `<a class="booking-reschedule" href="/booking.html?reschedule=${encodeURIComponent(booking.appointmentId)}">Reagendar →</a>` : '';
  const cancel = booking.appointmentId && bookingMoment(booking) >= new Date() ? `<button type="button" class="booking-cancel" data-cancel-reservation="${escapeHtml(booking.appointmentId)}">Cancelar</button>` : '';
  return `<article class="booking-row"><time>${escapeHtml(display.date)}</time><div><strong>${escapeHtml(booking.service)}</strong><p>${escapeHtml(display.time)}</p></div><div class="booking-payment ${booking.paymentStatus}">${payment}${reschedule}${cancel}</div></article>`;
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
const outstanding = [...clientData.tracks, ...clientData.bookings].reduce((total, item) => total + Number(item.due || 0), 0);
const portalNote = apiBase ? 'Área privada · acesso protegido por credenciais.' : 'Protótipo local · o acesso real de cada cliente será ligado numa fase seguinte.';
const bookings = splitBookings(clientData.bookings);
const musicTracks = clientData.tracks.filter(track => (track.category || 'mix-master') === musicTab);
const recordings = clientData.tracks.filter(track => track.category === 'recording');
const serviceOptions = (clientData.mixMasterServices || []).map(service => `<option value="${escapeHtml(service.id)}">${escapeHtml(service.title)} · ${money(service.price)}</option>`).join('');
const submitPanel = submittingTrack ? `<form id="trackSubmissionForm" class="track-submission"><div><p class="eyebrow">Novo pedido</p><h3>${musicTab === 'recording' ? 'Enviar gravação' : 'Pedir Mix & Master'}</h3></div><label>Nome da música<input name="title" maxlength="180" required></label>${musicTab === 'mix-master' ? `<label>Serviço<select name="requestedService" required>${serviceOptions}</select></label><label>Usar uma gravação existente<select name="sourceTrackId"><option value="">Enviar novo ficheiro</option>${recordings.map(track => `<option value="${escapeHtml(track.id)}">${escapeHtml(track.title)}</option>`).join('')}</select></label>` : ''}<label>Ficheiro de áudio${musicTab === 'recording' ? '<input name="file" type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/mp4,audio/aac,audio/ogg" required>' : '<input name="file" type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/mp4,audio/aac,audio/ogg">'}</label><div class="track-submission-actions"><button type="submit">Submeter <span>→</span></button><button type="button" class="client-link" data-close-track-submit>Cancelar</button></div></form>` : '';
portal.innerHTML = `<div class="client-shell client-simple">
  <header class="client-header"><a class="client-brand" href="/" aria-label="Trap Houze Records"><img src="/images/Logo.png" alt="Trap Houze Records"><span>Área do cliente</span></a><div class="client-user"><span>Olá, ${escapeHtml(clientData.client)}</span>${apiBase ? '<a class="client-book-session" href="/booking.html">Agendar sessão</a><button class="client-book-session" type="button" data-open-track-submit>Mix & Master</button>' : ''}<button class="client-signout" type="button">Sair</button></div></header>
  <section class="client-simple-hero"><p class="eyebrow">O teu trabalho</p><h1>A tua agenda</h1><p>Reservas, músicas e pagamentos num só lugar.</p>${outstanding ? `<div class="client-total-due"><span>Total em falta</span><strong>${money(outstanding)}</strong></div>` : ''}</section>
  <section class="booking-section booking-section-upcoming"><div class="booking-section-heading"><div><p class="eyebrow">Próximas sessões</p><h2>Reservas futuras</h2></div><span>${bookings.upcoming.length} agendadas</span></div><div class="booking-list">${bookings.upcoming.map(renderBooking).join('') || '<p class="client-empty">Ainda não tens reservas futuras.</p>'}</div></section>
  <section class="track-section"><div class="booking-section-heading"><div><p class="eyebrow">Música</p><h2>As tuas faixas</h2></div><button type="button" class="client-book-session" data-open-track-submit>${musicTab === 'recording' ? '+ Gravação' : '+ Mix & Master'}</button></div><div class="track-tabs" role="tablist"><button type="button" class="${musicTab === 'mix-master' ? 'active' : ''}" data-music-tab="mix-master">Mix & Master <span>${clientData.tracks.filter(track => (track.category || 'mix-master') === 'mix-master').length}</span></button><button type="button" class="${musicTab === 'recording' ? 'active' : ''}" data-music-tab="recording">Gravações <span>${recordings.length}</span></button></div>${submitPanel}<div class="track-list">${musicTracks.map(renderTrack).join('') || `<p class="client-empty">${musicTab === 'recording' ? 'Ainda não tens gravações guardadas.' : 'Ainda não tens músicas em Mix & Master.'}</p>`}</div></section>
  <section class="booking-section booking-section-history"><div class="booking-section-heading"><div><p class="eyebrow">Histórico</p><h2>Reservas anteriores</h2></div><span>${bookings.history.length} concluídas</span></div><div class="booking-list">${bookings.history.map(renderBooking).join('') || '<p class="client-empty">Ainda não existem reservas anteriores.</p>'}</div></section>
  ${renderArtistProfile(clientData.artistProfile)}
  <aside class="client-simple-help"><span>Precisas de ajuda?</span><a href="https://wa.me/351910734914" target="_blank" rel="noopener">Abrir WhatsApp <b>→</b></a></aside>
  <p class="client-demo">${portalNote}</p>
</div>`;
  if (apiBase && apiToken) hydrateTrackPlayers();
}

async function refreshPortal() {
  const result = await apiRequest('/client/portal');
  clientData = normalisePortal(result);
  renderPortal();
}
async function trackBlob(trackId, versionId) {
  const response = await fetch(`${apiBase}/client/tracks/${encodeURIComponent(trackId)}/versions/${encodeURIComponent(versionId)}/file`, { headers: { Authorization: `Bearer ${apiToken}` } });
  if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || 'Não foi possível obter este ficheiro.'); }
  return { blob: await response.blob(), type: response.headers.get('content-type') || 'audio/mpeg' };
}
function hydrateTrackPlayers() {
  document.querySelectorAll('[data-track-audio]').forEach(async audio => {
    try { const file = await trackBlob(audio.dataset.trackAudio, audio.dataset.versionAudio); audio.src = URL.createObjectURL(file.blob); } catch { audio.closest('.track-audio')?.remove(); }
  });
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
  const tab = event.target.closest('[data-music-tab]');
  if (tab) { musicTab = tab.dataset.musicTab; submittingTrack = false; renderPortal(); return; }
  if (event.target.closest('[data-open-track-submit]')) { submittingTrack = true; renderPortal(); return; }
  if (event.target.closest('[data-close-track-submit]')) { submittingTrack = false; renderPortal(); return; }
  const play = event.target.closest('[data-play-version]');
  if (play) {
    const audio = play.closest('.track-card')?.querySelector('[data-track-audio]');
    if (!audio) return;
    play.disabled = true;
    trackBlob(play.dataset.trackId, play.dataset.playVersion).then(file => { audio.src = URL.createObjectURL(file.blob); audio.play().catch(() => {}); }).catch(error => alert(error.message)).finally(() => { play.disabled = false; });
    return;
  }
  const download = event.target.closest('[data-download-version]');
  if (download) {
    trackBlob(download.dataset.trackId, download.dataset.downloadVersion).then(file => {
      const url = URL.createObjectURL(file.blob); const link = document.createElement('a'); link.href = url; link.download = ''; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }).catch(error => alert(error.message));
    return;
  }
  const payment = event.target.closest('[data-payment-url]');
  if (payment) {
    const url = payment.dataset.paymentUrl;
    if (url && /^https:\/\//i.test(url)) window.open(url, '_blank', 'noopener');
    else alert('A Trap Houze ainda não adicionou um link de pagamento para este item.');
  }
  const cancel = event.target.closest('[data-cancel-reservation]');
  if (cancel) {
    if (!window.confirm('Cancelar esta reserva? O horário volta a ficar disponível.')) return;
    cancel.disabled = true;
    apiRequest(`/client/appointments/${encodeURIComponent(cancel.dataset.cancelReservation)}`, { method: 'DELETE' }).then(() => apiRequest('/client/portal')).then(result => { clientData = normalisePortal(result); renderPortal(); }).catch(error => { cancel.disabled = false; alert(error.message); });
    return;
  }
  if (event.target.closest('.client-signout')) {
    sessionStorage.removeItem('th_client_demo');
    if (apiBase && apiToken) apiRequest('/client/auth/logout', { method: 'POST' }).catch(() => {}).finally(() => { apiToken = ''; localStorage.removeItem(clientTokenKey); sessionStorage.removeItem(clientTokenKey); renderLogin(); });
    else renderLogin();
  }
});

document.addEventListener('submit', event => {
  if (event.target.id === 'trackSubmissionForm') {
    event.preventDefault();
    const form = new FormData(event.target);
    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    const category = musicTab;
    apiRequest('/client/tracks', { method: 'POST', body: JSON.stringify({ title: form.get('title'), category, requestedService: form.get('requestedService'), sourceTrackId: form.get('sourceTrackId') }) }).then(async track => {
      const file = form.get('file');
      if (file instanceof File && file.size) {
        const upload = new FormData(); upload.append('file', file); upload.append('label', 'Versão inicial');
        const response = await fetch(`${apiBase}/client/tracks/${encodeURIComponent(track.id)}/versions`, { method: 'POST', headers: { Authorization: `Bearer ${apiToken}` }, body: upload });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || 'O pedido foi criado, mas o áudio não foi enviado.');
      }
      submittingTrack = false; return refreshPortal();
    }).catch(error => { button.disabled = false; alert(error.message); });
    return;
  }
  const upload = event.target.closest('[data-track-upload]');
  if (upload) {
    event.preventDefault(); const form = new FormData(upload); const button = upload.querySelector('button'); button.disabled = true;
    fetch(`${apiBase}/client/tracks/${encodeURIComponent(upload.dataset.trackUpload)}/versions`, { method: 'POST', headers: { Authorization: `Bearer ${apiToken}` }, body: form }).then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Não foi possível enviar a versão.'); return refreshPortal(); }).catch(error => { button.disabled = false; alert(error.message); });
    return;
  }
  const comment = event.target.closest('[data-track-comment]');
  if (comment) {
    event.preventDefault(); const form = new FormData(comment); const button = comment.querySelector('button'); button.disabled = true;
    apiRequest(`/client/tracks/${encodeURIComponent(comment.dataset.trackComment)}/comments`, { method: 'POST', body: JSON.stringify({ body: form.get('body') }) }).then(refreshPortal).catch(error => { button.disabled = false; alert(error.message); });
    return;
  }
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
