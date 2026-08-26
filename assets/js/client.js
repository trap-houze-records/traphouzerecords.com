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
let submittingTrack = null;
const trackAudioUrls = new Map();
const openTrackComments = new Set();
const apiBase = (window.CLIENT_PORTAL_API_URL || window.CMS_API_URL || '').replace(/\/$/, '');
const usesLocalPortalApi = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(apiBase);
const clientTokenKey = 'th_client_portal_token';
let apiToken = localStorage.getItem(clientTokenKey) || sessionStorage.getItem(clientTokenKey) || '';
if (apiToken) {
  localStorage.setItem(clientTokenKey, apiToken);
  sessionStorage.removeItem(clientTokenKey);
}

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const stages = [['start', 'Gravação'], ['mix', 'Mix'], ['master', 'Master']];
const money = value => `${Number(value || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const profileImage = value => /^(?:\/?images\/[-a-zA-Z0-9_./]+|https:\/\/[^\s]+)$/i.test(String(value || '')) ? String(value) : '/images/Logo.png';
const paymentFields = item => {
  const amount = item.amountCents === undefined ? Number(item.amount || 0) : Number(item.amountCents || 0) / 100;
  const paid = item.paidCents === undefined ? (item.paymentStatus === 'paid' || item.paid ? amount : 0) : Number(item.paidCents || 0) / 100;
  return { amount, paid, due: Math.max(0, amount - paid), paymentStatus: paid >= amount ? 'paid' : paid > 0 ? 'partial' : 'pending' };
};
const paymentLabel = item => {
  if (item.amount <= 0) return 'Pagamento a definir';
  if (item.due <= 0) return `Pago ${money(item.paid)} · confirmado`;
  return item.paid > 0 ? `Pago ${money(item.paid)} · faltam ${money(item.due)}` : '';
};
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
function trackSubmissionForm(sourceTrack = null) {
  const services = (clientData.mixMasterServices || []).filter(service => !sourceTrack || ['mix', 'mix-master'].includes(service.id));
  const serviceOptions = services.map(service => `<option value="${escapeHtml(service.id)}">${escapeHtml(service.title)} · ${money(service.price)}</option>`).join('');
  const sourceId = sourceTrack?.id || '';
  const sourceTitle = sourceTrack?.title || '';
  if (sourceTrack) return `<form class="track-submission track-submission-recording" data-track-submission data-source-track-id="${escapeHtml(sourceId)}" data-source-track-title="${escapeHtml(sourceTitle)}">
    <label>Serviço para “${escapeHtml(sourceTitle)}”<select name="requestedService" required><option value="" selected disabled>Escolher Mix ou Mix & Master</option>${serviceOptions}</select></label>
    <div class="track-submission-actions"><button type="submit">Submeter <span>→</span></button><button type="button" class="client-link" data-close-track-submit>Cancelar</button></div>
  </form>`;
  return `<form class="track-submission ${sourceTrack ? 'track-submission-recording' : ''}" data-track-submission data-source-track-id="${escapeHtml(sourceId)}" data-source-track-title="${escapeHtml(sourceTitle)}">
    <div><p class="eyebrow">Novo pedido</p><h3>Pedir Mix & Master</h3></div>
    <label>Nome da música<input name="title" maxlength="180" required></label>
    <label>Serviço<select name="requestedService" required><option value="" selected disabled>Escolher serviço</option>${serviceOptions}</select></label>
    <label>Ficheiro de áudio<input name="file" type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/mp4,audio/aac,audio/ogg" required></label>
    <div class="track-submission-actions"><button type="submit">Submeter <span>→</span></button><button type="button" class="client-link" data-close-track-submit>Cancelar</button></div>
  </form>`;
}
function versionFileSize(size) { return Number(size || 0) >= 1024 * 1024 ? `${(Number(size) / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(Number(size || 0) / 1024))} KB`; }
function renderTrackPlayer(track, versions) {
  if (!versions.length) return `<div class="track-player-empty"><strong>Sem áudio disponível</strong><span>A Trap Houze ainda não adicionou uma versão a esta música.</span>${track.category === 'recording' ? `<button type="button" class="track-player-submit" data-submit-recording="${escapeHtml(track.id)}">Submeter para Mix & Master</button>${submittingTrack === track.id ? trackSubmissionForm(track) : ''}` : ''}</div>`;
  const active = versions[0];
  return `<section class="track-player" data-track-player="${escapeHtml(track.id)}">
    <div class="track-player-heading">
      <div class="track-player-identity"><img src="/images/Logo.png" alt=""><div><span>Trap Houze Player</span><strong data-player-filename>${escapeHtml(active.originalName || track.title)}</strong><small data-player-filemeta>${escapeHtml(active.label)} · ${versionFileSize(active.sizeBytes)}</small></div></div>
      <div class="track-player-actions">${track.category === 'recording' ? `<button type="button" class="track-player-submit" data-submit-recording="${escapeHtml(track.id)}">Submeter para Mix & Master</button>` : ''}<button type="button" class="track-player-download" data-download-version="${escapeHtml(active.id)}" data-track-id="${escapeHtml(track.id)}">Descarregar</button></div>
    </div>
    <div class="track-player-versions" role="tablist" aria-label="Versões de ${escapeHtml(track.title)}">
      ${versions.map((version, index) => `<button type="button" role="tab" aria-selected="${index === 0 ? 'true' : 'false'}" class="${index === 0 ? 'active' : ''}" data-player-version="${escapeHtml(version.id)}" data-track-id="${escapeHtml(track.id)}" data-version-label="${escapeHtml(version.label)}" data-version-name="${escapeHtml(version.originalName || track.title)}" data-version-size="${escapeHtml(versionFileSize(version.sizeBytes))}">${escapeHtml(version.label)}</button>`).join('')}
    </div>
    <audio preload="metadata" data-track-audio="${escapeHtml(track.id)}" data-version-audio="${escapeHtml(active.id)}"></audio>
    <div class="track-player-controls">
      <button type="button" class="track-player-toggle" data-player-toggle aria-label="Reproduzir" title="Reproduzir"></button>
      <span data-player-current>0:00</span>
      <input type="range" min="0" max="1000" value="0" step="1" aria-label="Posição na música" data-player-progress>
      <span data-player-duration>--:--</span>
    </div>
    <div class="track-player-foot"><span data-player-status>A preparar áudio…</span><span>${versions.length} ${versions.length === 1 ? 'versão' : 'versões'}</span></div>
    ${track.category === 'recording' && submittingTrack === track.id ? trackSubmissionForm(track) : ''}
  </section>`;
}
function renderTrack(track) {
  const versions = track.versions || [];
  const comments = track.comments || [];
  const latest = versions[0];
  const stagesPanel = track.category === 'recording' ? '' : `<div class="track-stages" aria-label="Estado do trabalho">${stages.map(([id, label], index) => {
    const activeIndex = stages.findIndex(([stage]) => stage === String(track.stage).toLowerCase());
    const state = index < activeIndex ? 'complete' : index === activeIndex ? 'current' : '';
    return `<div class="track-stage ${state}"><span>${index + 1}</span><strong>${label}</strong></div>`;
  }).join('')}</div>`;
  const initialVersionId = latest?.id || '';
  const initialComments = comments.filter(comment => (comment.versionId || initialVersionId) === initialVersionId);
  const versionLabels = new Map(versions.map(version => [version.id, version.label]));
  const commentsOpen = openTrackComments.has(track.id);
  const commentsPanel = `<div class="track-workspace track-comments" data-track-comments ${commentsOpen ? '' : 'hidden'}><div class="track-workspace-heading"><strong>Comentários da versão</strong><span data-comment-count>${initialComments.length}</span></div><div data-track-comment-list>${comments.map(comment => {
    const versionId = comment.versionId || initialVersionId;
    const visible = versionId === initialVersionId;
    const ownActions = comment.authorType === 'client' && comment.id ? `<div class="track-comment-actions" data-comment-actions><button type="button" data-edit-comment="${escapeHtml(comment.id)}">Editar</button><button type="button" class="danger" data-delete-comment="${escapeHtml(comment.id)}" data-track-id="${escapeHtml(track.id)}">Apagar</button></div><form class="track-comment-edit-form" data-comment-edit="${escapeHtml(comment.id)}" data-track-id="${escapeHtml(track.id)}" hidden><textarea name="body" rows="2" maxlength="2000" required>${escapeHtml(comment.body)}</textarea><div><button type="submit">Guardar</button><button type="button" data-cancel-comment-edit>Cancelar</button></div></form>` : '';
    return `<article data-comment-id="${escapeHtml(comment.id || '')}" data-comment-version="${escapeHtml(versionId)}" ${visible ? '' : 'hidden'}><div class="track-comment-meta"><b>${comment.authorType === 'admin' ? 'Trap Houze' : 'Tu'}</b><button type="button" data-comment-seek="${Number(comment.positionSeconds || 0)}" data-comment-version="${escapeHtml(versionId)}" data-track-id="${escapeHtml(track.id)}">${escapeHtml(versionLabels.get(versionId) || 'Versão')} · ${formatAudioTime(comment.positionSeconds)}</button></div><p data-comment-body>${escapeHtml(comment.body)}</p>${ownActions}</article>`;
  }).join('')}</div><p class="track-empty" data-comment-empty ${initialComments.length ? 'hidden' : ''}>Sem comentários nesta versão.</p>${latest ? `<form class="track-comment-form" data-track-comment="${escapeHtml(track.id)}"><input type="hidden" name="versionId" value="${escapeHtml(latest.id)}"><input type="hidden" name="positionSeconds" value="0"><p class="track-comment-context" data-comment-context>Comentário em <b>${escapeHtml(latest.label)}</b> · <span>0:00</span></p><textarea name="body" rows="2" maxlength="2000" placeholder="Comenta o ponto atual desta versão" required></textarea><button type="submit">Comentar</button></form>` : '<p class="track-empty">Os comentários ficam disponíveis quando existir uma versão.</p>'}</div>`;
  return `<article class="track-card">
    <div class="track-heading"><p class="eyebrow">${trackServiceLabel(track)}</p><h2>${escapeHtml(track.title)}</h2></div>
    ${stagesPanel}
    ${renderTrackPlayer(track, versions)}
    ${track.category === 'recording' ? '' : `<button type="button" class="track-comments-toggle" data-toggle-track-comments="${escapeHtml(track.id)}" aria-expanded="${commentsOpen ? 'true' : 'false'}">Comentários <span>${comments.length}</span></button>${commentsPanel}`}
    ${track.category === 'recording' ? '' : `<div class="track-payment ${track.paymentStatus}">${paymentLabel(track) ? `<span>${paymentLabel(track)}</span>` : ''}${track.due === 0 ? '<span class="track-payment-mark">✓</span>' : `<button type="button" data-payment-url="${escapeHtml(track.paymentUrl || '')}">Pagar ${money(track.due)}</button>`}</div>`}
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
    ? `${paymentLabel(booking) ? `<span>${paymentLabel(booking)}</span>` : ''}${booking.due > 0 ? `<button type="button" data-payment-url="${escapeHtml(booking.paymentUrl || '')}">Pagar ${money(booking.due)}</button>` : ''}`
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
trackAudioUrls.forEach(url => URL.revokeObjectURL(url));
trackAudioUrls.clear();
const outstanding = [...clientData.tracks, ...clientData.bookings].reduce((total, item) => total + Number(item.due || 0), 0);
const portalNote = apiBase ? 'Área privada · acesso protegido por credenciais.' : 'Protótipo local · o acesso real de cada cliente será ligado numa fase seguinte.';
const bookings = splitBookings(clientData.bookings);
const musicTracks = clientData.tracks.filter(track => (track.category || 'mix-master') === musicTab);
const recordings = clientData.tracks.filter(track => track.category === 'recording');
const submitPanel = submittingTrack === 'new' && musicTab === 'mix-master' ? trackSubmissionForm() : '';
portal.innerHTML = `<div class="client-shell client-simple">
  <header class="client-header"><a class="client-brand" href="/" aria-label="Trap Houze Records"><img src="/images/Logo.png" alt="Trap Houze Records"><span>Área do cliente</span></a><div class="client-user"><span>Olá, ${escapeHtml(clientData.client)}</span>${apiBase ? '<a class="client-book-session" href="/booking.html">Agendar sessão</a>' : ''}<button class="client-signout" type="button">Sair</button></div></header>
  <section class="client-simple-hero"><p class="eyebrow">O teu trabalho</p><h1>A tua agenda</h1><p>Reservas, músicas e pagamentos num só lugar.</p></section>
  <section class="booking-section booking-section-upcoming"><div class="booking-section-heading"><div><p class="eyebrow">Próximas sessões</p><h2>Reservas futuras</h2></div><span>${bookings.upcoming.length} agendadas</span></div><div class="booking-list">${bookings.upcoming.map(renderBooking).join('') || '<p class="client-empty">Ainda não tens reservas futuras.</p>'}</div></section>
  <section class="track-section"><div class="booking-section-heading"><div><p class="eyebrow">Música</p><h2>As tuas faixas</h2></div>${musicTab === 'mix-master' ? '<button type="button" class="client-book-session" data-open-track-submit>+ Mix & Master</button>' : ''}</div><div class="track-tabs" role="tablist"><button type="button" class="${musicTab === 'mix-master' ? 'active' : ''}" data-music-tab="mix-master">Mix & Master <span>${clientData.tracks.filter(track => (track.category || 'mix-master') === 'mix-master').length}</span></button><button type="button" class="${musicTab === 'recording' ? 'active' : ''}" data-music-tab="recording">Gravações <span>${recordings.length}</span></button></div>${submitPanel}<div class="track-list">${musicTracks.map(renderTrack).join('') || `<p class="client-empty">${musicTab === 'recording' ? 'Ainda não tens gravações guardadas.' : 'Ainda não tens músicas em Mix & Master.'}</p>`}</div></section>
  <section class="booking-section booking-section-history"><div class="booking-section-heading"><div><p class="eyebrow">Histórico</p><h2>Reservas anteriores</h2></div><span>${bookings.history.length} concluídas</span></div><div class="booking-list">${bookings.history.map(renderBooking).join('') || '<p class="client-empty">Ainda não existem reservas anteriores.</p>'}</div></section>
  ${renderArtistProfile(clientData.artistProfile)}
  <aside class="client-simple-help"><span>Precisas de ajuda?</span><a href="https://wa.me/351910734914" target="_blank" rel="noopener">Abrir WhatsApp <b>→</b></a></aside>
  <p class="client-demo">${portalNote}</p>
  ${outstanding ? `<div class="client-total-due client-total-due-footer"><span>Total em falta</span><strong>${money(outstanding)}</strong></div>` : ''}
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
function formatAudioTime(value) {
  const seconds = Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function updateTrackPlayerProgress(player) {
  const audio = player.querySelector('[data-track-audio]');
  const progress = player.querySelector('[data-player-progress]');
  if (!audio || !progress) return;
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  progress.value = duration ? Math.round((audio.currentTime / duration) * 1000) : 0;
  progress.style.setProperty('--track-progress', `${Number(progress.value) / 10}%`);
  player.querySelector('[data-player-current]').textContent = formatAudioTime(audio.currentTime);
  player.querySelector('[data-player-duration]').textContent = duration ? formatAudioTime(duration) : '--:--';
  updateTrackCommentPosition(player);
}
function setTrackPlayerState(player, playing) {
  const toggle = player.querySelector('[data-player-toggle]');
  if (!toggle) return;
  const label = playing ? 'Pausa' : 'Reproduzir';
  toggle.setAttribute('aria-label', label);
  toggle.title = label;
  toggle.classList.toggle('playing', playing);
}
function syncTrackComments(player, versionButton) {
  const panel = player.closest('.track-card')?.querySelector('[data-track-comments]');
  if (!panel || !versionButton) return;
  const versionId = versionButton.dataset.playerVersion;
  const rows = [...panel.querySelectorAll('article[data-comment-version]')];
  let visible = 0;
  rows.forEach(row => {
    const show = row.dataset.commentVersion === versionId;
    row.hidden = !show;
    if (show) visible += 1;
  });
  panel.querySelector('[data-comment-count]').textContent = visible;
  panel.querySelector('[data-comment-empty]').hidden = visible > 0;
  const form = panel.querySelector('[data-track-comment]');
  if (!form) return;
  form.elements.versionId.value = versionId;
  form.elements.positionSeconds.value = '0';
  const context = form.querySelector('[data-comment-context]');
  context.innerHTML = `Comentário em <b>${escapeHtml(versionButton.dataset.versionLabel || 'Versão')}</b> · <span>0:00</span>`;
}
function updateTrackCommentPosition(player) {
  const audio = player.querySelector('[data-track-audio]');
  const form = player.closest('.track-card')?.querySelector('[data-track-comment]');
  if (!audio || !form || form.elements.versionId.value !== audio.dataset.versionAudio) return;
  const seconds = Math.max(0, Math.floor(Number(audio.currentTime || 0)));
  form.elements.positionSeconds.value = String(seconds);
  const time = form.querySelector('[data-comment-context] span');
  if (time) time.textContent = formatAudioTime(seconds);
}
async function loadTrackVersion(player, versionButton, options = {}) {
  const { autoplay = false, seekSeconds = null } = options;
  const audio = player.querySelector('[data-track-audio]');
  if (!audio || !versionButton) return;
  const trackId = versionButton.dataset.trackId;
  const versionId = versionButton.dataset.playerVersion;
  const requestId = `${Date.now()}-${Math.random()}`;
  player.dataset.playerRequest = requestId;
  player.querySelectorAll('[data-player-version]').forEach(button => {
    const active = button === versionButton;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  syncTrackComments(player, versionButton);
  player.querySelector('[data-player-filename]').textContent = versionButton.dataset.versionName || '';
  player.querySelector('[data-player-filemeta]').textContent = `${versionButton.dataset.versionLabel || ''} · ${versionButton.dataset.versionSize || ''}`;
  const download = player.querySelector('[data-download-version]');
  download.dataset.downloadVersion = versionId;
  download.dataset.trackId = trackId;
  const status = player.querySelector('[data-player-status]');
  status.textContent = 'A carregar versão…';
  setTrackPlayerState(player, false);
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  try {
    const file = await trackBlob(trackId, versionId);
    if (player.dataset.playerRequest !== requestId) return;
    const oldUrl = trackAudioUrls.get(trackId);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    const url = URL.createObjectURL(file.blob);
    trackAudioUrls.set(trackId, url);
    audio.dataset.versionAudio = versionId;
    audio.src = url;
    audio.load();
    status.textContent = versionButton.dataset.versionName || 'Versão pronta';
    if (seekSeconds !== null) {
      await new Promise(resolve => {
        const seek = () => { audio.currentTime = Math.min(Number(seekSeconds || 0), Number.isFinite(audio.duration) ? audio.duration : Number(seekSeconds || 0)); resolve(); };
        if (audio.readyState >= 1) seek();
        else audio.addEventListener('loadedmetadata', seek, { once: true });
      });
      updateTrackPlayerProgress(player);
    }
    if (autoplay) await audio.play();
  } catch (error) {
    if (player.dataset.playerRequest === requestId) status.textContent = error.message || 'Não foi possível carregar esta versão.';
  }
}
function bindTrackPlayer(player) {
  const audio = player.querySelector('[data-track-audio]');
  const progress = player.querySelector('[data-player-progress]');
  if (!audio || !progress) return;
  audio.addEventListener('loadedmetadata', () => updateTrackPlayerProgress(player));
  audio.addEventListener('timeupdate', () => updateTrackPlayerProgress(player));
  audio.addEventListener('play', () => setTrackPlayerState(player, true));
  audio.addEventListener('pause', () => setTrackPlayerState(player, false));
  audio.addEventListener('ended', () => setTrackPlayerState(player, false));
  progress.addEventListener('input', () => {
    if (!Number.isFinite(audio.duration)) return;
    audio.currentTime = (Number(progress.value) / 1000) * audio.duration;
    updateTrackPlayerProgress(player);
  });
  loadTrackVersion(player, player.querySelector('[data-player-version]'));
}
function hydrateTrackPlayers() {
  document.querySelectorAll('[data-track-player]').forEach(bindTrackPlayer);
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
  if (tab) { musicTab = tab.dataset.musicTab; submittingTrack = null; renderPortal(); return; }
  if (event.target.closest('[data-open-track-submit]')) { submittingTrack = 'new'; renderPortal(); return; }
  const submitRecording = event.target.closest('[data-submit-recording]');
  if (submitRecording) { submittingTrack = submittingTrack === submitRecording.dataset.submitRecording ? null : submitRecording.dataset.submitRecording; renderPortal(); return; }
  if (event.target.closest('[data-close-track-submit]')) { submittingTrack = null; renderPortal(); return; }
  const commentsToggle = event.target.closest('[data-toggle-track-comments]');
  if (commentsToggle) {
    const trackId = commentsToggle.dataset.toggleTrackComments;
    const panel = commentsToggle.nextElementSibling;
    const opening = panel?.hidden !== false;
    if (panel) panel.hidden = !opening;
    commentsToggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
    if (opening) openTrackComments.add(trackId); else openTrackComments.delete(trackId);
    return;
  }
  const editComment = event.target.closest('[data-edit-comment]');
  if (editComment) {
    const article = editComment.closest('[data-comment-id]');
    article.querySelector('[data-comment-body]').hidden = true;
    article.querySelector('[data-comment-actions]').hidden = true;
    article.querySelector('[data-comment-edit]').hidden = false;
    return;
  }
  const cancelCommentEdit = event.target.closest('[data-cancel-comment-edit]');
  if (cancelCommentEdit) {
    const article = cancelCommentEdit.closest('[data-comment-id]');
    article.querySelector('[data-comment-body]').hidden = false;
    article.querySelector('[data-comment-actions]').hidden = false;
    article.querySelector('[data-comment-edit]').hidden = true;
    return;
  }
  const deleteComment = event.target.closest('[data-delete-comment]');
  if (deleteComment) {
    if (!window.confirm('Apagar este comentário?')) return;
    deleteComment.disabled = true;
    apiRequest(`/client/tracks/${encodeURIComponent(deleteComment.dataset.trackId)}/comments/${encodeURIComponent(deleteComment.dataset.deleteComment)}`, { method: 'DELETE' }).then(refreshPortal).catch(error => { deleteComment.disabled = false; alert(error.message); });
    return;
  }
  const version = event.target.closest('[data-player-version]');
  if (version) {
    loadTrackVersion(version.closest('[data-track-player]'), version);
    return;
  }
  const toggle = event.target.closest('[data-player-toggle]');
  if (toggle) {
    const player = toggle.closest('[data-track-player]');
    const audio = player?.querySelector('[data-track-audio]');
    if (!audio) return;
    if (!audio.src) loadTrackVersion(player, player.querySelector('[data-player-version].active'), { autoplay: true });
    else if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
    return;
  }
  const commentSeek = event.target.closest('[data-comment-seek]');
  if (commentSeek) {
    const card = commentSeek.closest('.track-card');
    const player = card?.querySelector('[data-track-player]');
    const versionButton = player?.querySelector(`[data-player-version="${commentSeek.dataset.commentVersion}"]`);
    if (player && versionButton) loadTrackVersion(player, versionButton, { autoplay: true, seekSeconds: Number(commentSeek.dataset.commentSeek || 0) });
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
  const trackSubmission = event.target.closest('[data-track-submission]');
  if (trackSubmission) {
    event.preventDefault();
    const form = new FormData(trackSubmission);
    const button = trackSubmission.querySelector('button[type="submit"]');
    button.disabled = true;
    const category = 'mix-master';
    const sourceTrackId = trackSubmission.dataset.sourceTrackId || '';
    const title = sourceTrackId ? trackSubmission.dataset.sourceTrackTitle : form.get('title');
    apiRequest('/client/tracks', { method: 'POST', body: JSON.stringify({ title, category, requestedService: form.get('requestedService'), sourceTrackId }) }).then(async track => {
      const file = form.get('file');
      if (file instanceof File && file.size) {
        const upload = new FormData(); upload.append('file', file); upload.append('label', 'Versão inicial');
        const response = await fetch(`${apiBase}/client/tracks/${encodeURIComponent(track.id)}/versions`, { method: 'POST', headers: { Authorization: `Bearer ${apiToken}` }, body: upload });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || 'O pedido foi criado, mas o áudio não foi enviado.');
      }
      submittingTrack = null;
      if (sourceTrackId) musicTab = 'mix-master';
      return refreshPortal();
    }).catch(error => { button.disabled = false; alert(error.message); });
    return;
  }
  const commentEdit = event.target.closest('[data-comment-edit]');
  if (commentEdit) {
    event.preventDefault();
    const button = commentEdit.querySelector('button[type="submit"]');
    button.disabled = true;
    apiRequest(`/client/tracks/${encodeURIComponent(commentEdit.dataset.trackId)}/comments/${encodeURIComponent(commentEdit.dataset.commentEdit)}`, { method: 'PATCH', body: JSON.stringify({ body: new FormData(commentEdit).get('body') }) }).then(refreshPortal).catch(error => { button.disabled = false; alert(error.message); });
    return;
  }
  const comment = event.target.closest('[data-track-comment]');
  if (comment) {
    event.preventDefault(); const form = new FormData(comment); const button = comment.querySelector('button'); button.disabled = true;
    apiRequest(`/client/tracks/${encodeURIComponent(comment.dataset.trackComment)}/comments`, { method: 'POST', body: JSON.stringify({ body: form.get('body'), versionId: form.get('versionId'), positionSeconds: Number(form.get('positionSeconds') || 0) }) }).then(refreshPortal).catch(error => { button.disabled = false; alert(error.message); });
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
