let draft;
let contentLoaded = false;
let activeTab = 'site';
const requestedModule = new URLSearchParams(location.search).get('section');
let activeModule = ['clients', 'schedule', 'finance'].includes(requestedModule) ? requestedModule : (sessionStorage.getItem('th_admin_requested_module') || 'dashboard');
let csrfToken = '';
let sessionToken = sessionStorage.getItem('th_cms_session') || '';
const apiBase = (window.CMS_API_URL || '').replace(/\/$/, '');
const isLocalPreview = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
const tabs = [['site', 'Identidade'], ['menu', 'Menu'], ['hero', 'Destaques'], ['services', 'Serviços'], ['equipment', 'Equipamento'], ['about', 'Quem somos'], ['artists', 'Artistas'], ['reviews', 'Avaliações']];
const editorMeta = {
  site: ['Identidade do estúdio', 'Os dados base que aparecem no site, contactos e ligação de agendamento.'],
  menu: ['Navegação', 'Controla as secções disponíveis no menu e no site público.'],
  hero: ['Destaques', 'Define as imagens e mensagens principais da primeira secção do site.'],
  services: ['Serviços', 'Apresenta serviços, respetivas descrições e a ação de cada botão.'],
  equipment: ['Equipamento', 'Mantém a lista de equipamento e as galerias apresentadas no site.'],
  about: ['Quem somos', 'Edita a apresentação do estúdio, imagem e indicadores principais.'],
  artists: ['Artistas', 'Gere os artistas ou colaboradores apresentados no site.'],
  reviews: ['Avaliações', 'Edita os testemunhos que reforçam a confiança no estúdio.']
};
const modules = [['dashboard', 'Dashboard'], ['site', 'Editar site'], ['schedule', 'Agenda'], ['clients', 'Clientes'], ['finance', 'Finanças']];
const $ = selector => document.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const field = (label, path, value, type = 'text') => `<label class="admin-field"><span>${label}</span>${type === 'textarea' ? `<textarea data-bind="${path}" rows="4">${escapeHtml(value || '')}</textarea>` : `<input type="${type}" data-bind="${path}" value="${escapeHtml(value || '')}">`}</label>`;
const checkbox = (label, path, value) => `<label class="admin-check"><input type="checkbox" data-bind="${path}" ${value ? 'checked' : ''}><span>${label}</span></label>`;
const addButton = (collection, label) => `<button class="btn btn-sm" data-add="${collection}">+ ${label}</button>`;

function getPath(path) { return path.split('.').reduce((object, key) => object?.[key], draft); }
function setPath(path, value) { const keys = path.split('.'); const last = keys.pop(); const target = keys.reduce((object, key) => object[key], draft); target[last] = value; }
function card(title, body, remove = '') { return `<article class="admin-card"><div class="admin-card-heading"><h2>${escapeHtml(title)}</h2>${remove}</div>${body}</article>`; }
function listCards(collection, renderer, label) { return `<div class="admin-list">${draft[collection].map(renderer).join('')}</div>${addButton(collection, label)}`; }

function renderTab() {
  $('#adminTabs').innerHTML = tabs.map(([id, label]) => `<button class="admin-tab ${id === activeTab ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('');
  const section = {
    site: renderSite,
    menu: renderMenu,
    hero: renderHero,
    services: renderServices,
    equipment: renderEquipment,
    about: renderAbout,
    artists: renderArtists,
    reviews: renderReviews
  }[activeTab];
  const [title, description] = editorMeta[activeTab];
  $('#adminContent').innerHTML = `<section class="studio-editor"><header class="studio-editor-heading"><div><p class="eyebrow">Edição do site</p><h2>${title}</h2><p>${description}</p></div><div class="studio-editor-state"><span>Rascunho</span><small>Publica quando estiver pronto.</small></div></header><div class="studio-editor-body">${section()}</div></section>`;
}

const bookingServiceDefaults = [
  { id: 'studio-engineer', title: 'Sessão de Estúdio (Captação com engenheiro)', pricePerHour: 20, active: true },
  { id: 'studio-art-direction', title: 'Sessão de Estúdio (Captação com engenheiro + Direção Artística)', pricePerHour: 30, active: true },
  { id: 'studio-rental', title: 'Alugar o Estúdio', pricePerHour: 10, active: true }
];
function renderSite() { const site = draft.site; return `<section class="admin-grid">${card('Dados gerais', [field('Nome', 'site.name', site.name), field('Subtítulo', 'site.tagline', site.tagline), field('Localização', 'site.location', site.location), field('E-mail', 'site.email', site.email), field('URL Instagram', 'site.instagram', site.instagram), field('Nome no Instagram', 'site.instagramHandle', site.instagramHandle), field('WhatsApp (só algarismos)', 'site.whatsapp', site.whatsapp), field('URL de agendamento', 'site.bookingUrl', site.bookingUrl), field('Horário', 'site.hours', site.hours)].join(''))}</section>`; }
function renderMenu() { return `<section>${card('Navegação', '<p class="admin-hint">Desative uma secção para escondê-la do menu e do site.</p>' + draft.navigation.map((item, index) => `<div class="admin-row">${field('Nome', `navigation.${index}.label`, item.label)}${field('ID', `navigation.${index}.id`, item.id)}${checkbox('Visível', `navigation.${index}.visible`, item.visible)}</div>`).join(''))}</section>`; }
function renderHero() { return `<section>${listCards('hero', (item, index) => card(`Destaque ${index + 1}`, `${field('Título', `hero.${index}.title`, item.title)}${field('Subtítulo', `hero.${index}.subtitle`, item.subtitle)}${field('Imagem (URL)', `hero.${index}.image`, item.image)}`, `<button class="admin-icon" data-remove="hero" data-index="${index}" aria-label="Remover">×</button>`), 'Adicionar destaque')}</section>`; }
function renderServices() { return `<section>${listCards('services', (item, index) => card(item.title || `Serviço ${index + 1}`, `${field('Título', `services.${index}.title`, item.title)}${field('Ícone', `services.${index}.icon`, item.icon)}${field('Descrição', `services.${index}.description`, item.description, 'textarea')}<label class="admin-field"><span>Ação</span><select data-bind="services.${index}.action"><option value="booking" ${item.action === 'booking' ? 'selected' : ''}>Agenda</option><option value="whatsapp" ${item.action === 'whatsapp' ? 'selected' : ''}>WhatsApp</option></select></label>${checkbox('Disponível', `services.${index}.visible`, item.visible)}`, `<button class="admin-icon" data-remove="services" data-index="${index}" aria-label="Remover">×</button>`), 'Adicionar serviço')}</section>`; }
function renderEquipment() { return `<section>${listCards('equipment', (item, index) => card(item.title || `Item ${index + 1}`, `${field('Identificador', `equipment.${index}.id`, item.id)}${field('Título', `equipment.${index}.title`, item.title)}${field('Descrição', `equipment.${index}.description`, item.description, 'textarea')}${field('Imagens (uma URL por linha)', `equipment.${index}.images`, item.images.join('\n'), 'textarea')}`, `<button class="admin-icon" data-remove="equipment" data-index="${index}" aria-label="Remover">×</button>`), 'Adicionar equipamento')}</section>`; }
function renderAbout() { const about = draft.about; return `<section class="admin-grid">${card('Texto', `${field('Título', 'about.title', about.title)}${field('Parágrafos (um por linha)', 'about.paragraphs', about.paragraphs.join('\n'), 'textarea')}${field('Imagem (URL)', 'about.image', about.image)}`)}${card('Indicadores', about.stats.map((stat, index) => `<div class="admin-row">${field('Número', `about.stats.${index}.value`, stat.value)}${field('Descrição', `about.stats.${index}.label`, stat.label)}</div>`).join(''))}</section>`; }
function artistPlatformUrl(item, property, legacyLabel) { return item[property] || (item.links || []).find(link => String(link.label || '').trim().toLowerCase() === legacyLabel.toLowerCase())?.url || ''; }
function artistPlaylistUrl(item) { return item.spotifyPlaylist || (item.catalog || []).find(entry => /spotify/i.test(entry.type || '') || /open\.spotify\.com\/playlist/i.test(entry.url || ''))?.url || ''; }
function artistImageField(item, index) { return `<label class="admin-field artist-image-field"><span>Imagem do artista</span><input type="file" accept="image/jpeg,image/png,image/webp,image/avif" data-artist-image="${index}"><small>${item.image ? 'Imagem guardada no site. Escolha outro ficheiro para substituir.' : 'JPG, PNG, WebP ou AVIF · máximo 5 MB'}</small>${item.image ? `<img src="${escapeHtml(item.image)}" alt="Pré-visualização de ${escapeHtml(item.name || 'artista')}">` : ''}</label>`; }
function renderArtists() { return `<section>${listCards('artists', (item, index) => card(item.name || `Artista ${index + 1}`, `${field('Nome', `artists.${index}.name`, item.name)}${field('Género / função', `artists.${index}.genre`, item.genre)}${artistImageField(item, index)}${field('Biografia', `artists.${index}.bio`, item.bio || '', 'textarea')}<div class="admin-row">${field('Instagram', `artists.${index}.instagram`, artistPlatformUrl(item, 'instagram', 'Instagram'), 'url')}${field('YouTube', `artists.${index}.youtube`, artistPlatformUrl(item, 'youtube', 'YouTube'), 'url')}${field('Spotify', `artists.${index}.spotify`, artistPlatformUrl(item, 'spotify', 'Spotify'), 'url')}${field('Apple Music', `artists.${index}.appleMusic`, artistPlatformUrl(item, 'appleMusic', 'Apple Music'), 'url')}</div>${field('Playlist Spotify do catálogo', `artists.${index}.spotifyPlaylist`, artistPlaylistUrl(item), 'url')}`, `<button class="admin-icon" data-remove="artists" data-index="${index}" aria-label="Remover">×</button>`), 'Adicionar artista')}</section>`; }
function renderReviews() { return `<section>${listCards('reviews', (item, index) => card(item.name || `Avaliação ${index + 1}`, `${field('Nome', `reviews.${index}.name`, item.name)}${field('Texto', `reviews.${index}.text`, item.text, 'textarea')}`, `<button class="admin-icon" data-remove="reviews" data-index="${index}" aria-label="Remover">×</button>`), 'Adicionar avaliação')}</section>`; }

function addItem(collection) { const models = { hero: { title: 'Novo destaque', subtitle: '', image: '' }, services: { title: 'Novo serviço', description: '', icon: '✦', action: 'booking', visible: true }, equipment: { id: 'novo-item', title: 'Novo equipamento', description: '', images: [] }, artists: { name: 'Novo artista', genre: '', image: '', bio: '', instagram: '', youtube: '', spotify: '', appleMusic: '', spotifyPlaylist: '' }, reviews: { name: 'Nome', text: '' } }; draft[collection].push(models[collection]); renderTab(); }
function removeItem(collection, index) { draft[collection].splice(index, 1); renderTab(); }
function parseSpecial(path, value) { if (path.endsWith('.images')) return value.split('\n').map(item => item.trim()).filter(Boolean); if (path === 'about.paragraphs') return value.split('\n').map(item => item.trim()).filter(Boolean); return value; }
function notice(message, kind = '') { const element = $('#notice'); element.textContent = message; element.className = `admin-notice ${kind}`; }

async function loadContent() {
  const url = isLocalPreview ? 'data/site.json' : (apiBase ? `${apiBase}/content` : 'data/site.json');
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error('Não foi possível carregar o conteúdo.');
  draft = await response.json();
  draft.bookingServices = Array.isArray(draft.bookingServices) && draft.bookingServices.length ? draft.bookingServices : bookingServiceDefaults.map(service => ({ ...service }));
  draft.artists = (draft.artists || []).map(artist => ({
    ...artist,
    instagram: artistPlatformUrl(artist, 'instagram', 'Instagram'),
    youtube: artistPlatformUrl(artist, 'youtube', 'YouTube'),
    spotify: artistPlatformUrl(artist, 'spotify', 'Spotify'),
    appleMusic: artistPlatformUrl(artist, 'appleMusic', 'Apple Music'),
    spotifyPlaylist: artistPlaylistUrl(artist)
  }));
  contentLoaded = true;
  if (activeModule === 'site') renderTab();
}
async function refreshSession() {
  if (!apiBase) { notice('O serviço de publicação não está configurado.', 'error'); return false; }
  try {
    const response = await fetch(`${apiBase}/auth/session`, { headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {} });
    const session = await response.json();
    if (!session.authenticated) { $('#loginButton').hidden = false; return false; }
    csrfToken = session.csrf || '';
    $('#loginButton').hidden = true;
    $('#authStatus').textContent = `Ligado como ${session.login}`;
    $('#publishButton').hidden = false;
    return true;
  } catch {
    notice('Não foi possível ligar ao serviço de publicação.', 'error');
    return false;
  }
}

function renderModules() {
  $('#adminModules').innerHTML = `<span class="admin-nav-label">Áreas</span>${modules.map(([id, label]) => `<button class="admin-module ${id === activeModule ? 'active' : ''}" data-module="${id}">${label}</button>`).join('')}`;
  $('#adminModules').scrollLeft = 0;
}
function renderDashboard() {
  $('#adminTabs').hidden = true;
  $('#publishButton').hidden = true;
  $('#adminContent').innerHTML = `<section class="studio-dashboard"><div class="studio-stats"><article><span>Clientes ativos</span><strong id="dashboardClientCount">—</strong><small>na Área do Cliente</small></article><article><span>Trabalhos pendentes</span><strong>—</strong><small>Em breve</small></article><article><span>Reservas</span><strong>—</strong><small>Gerir na agenda</small></article><article><span>Pagamentos pendentes</span><strong>→</strong><small>Ver resumo financeiro</small></article></div><div class="studio-dashboard-grid"><section class="studio-panel"><div class="studio-panel-heading"><div><p class="eyebrow">Começar</p><h3>Gestão do estúdio</h3></div></div><button type="button" class="studio-action" data-module="schedule"><span>01</span><div><strong>Abrir agenda</strong><small>Marcações, horários e disponibilidade.</small></div><b>→</b></button><button type="button" class="studio-action" data-module="clients"><span>02</span><div><strong>Gerir clientes</strong><small>Contas, músicas, reservas e pagamentos.</small></div><b>→</b></button><button type="button" class="studio-action" data-module="finance"><span>03</span><div><strong>Resumo financeiro</strong><small>Recebido, pendente e estado de contas.</small></div><b>→</b></button><button type="button" class="studio-action" data-module="site"><span>04</span><div><strong>Editar site</strong><small>Conteúdos, navegação e publicação.</small></div><b>→</b></button></section><section class="studio-panel"><div class="studio-panel-heading"><div><p class="eyebrow">Próximas funções</p><h3>Em preparação</h3></div></div><ul class="studio-roadmap"><li><span>Reservas públicas</span><small>Substituição gradual do TidyCal pela agenda própria.</small></li><li><span>Atividade recente</span><small>Histórico centralizado do estúdio.</small></li></ul></section></div></section>`;
  fetch(`${apiBase}/dashboard/summary`, { headers: { Authorization: `Bearer ${sessionToken}` } }).then(response => response.ok ? response.json() : null).then(result => {
    if (!result) return;
    const euro = cents => (Number(cents || 0) / 100).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
    const date = value => {
      const [day, time = ''] = String(value || '').split(' ');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return 'Data por confirmar';
      const label = new Intl.DateTimeFormat('pt-PT', { day: 'numeric', month: 'short' }).format(new Date(`${day}T12:00:00Z`));
      return time ? `${label}, ${time.slice(0, 5)}` : label;
    };
    const activityLabel = action => ({ 'client.created': 'Nova conta criada', 'client.updated': 'Dados de cliente atualizados', 'tracks.created': 'Música adicionada', 'tracks.updated': 'Música atualizada', 'tracks.deleted': 'Música removida', 'bookings.created': 'Reserva adicionada', 'bookings.updated': 'Reserva atualizada', 'bookings.deleted': 'Reserva removida' }[action] || 'Atividade registada');
    const stats = $('#adminContent').querySelector('.studio-stats');
    if (stats) stats.innerHTML = `<article><span>Clientes ativos</span><strong>${result.clients}</strong><small>na Área do Cliente</small></article><article><span>Recebido este mês</span><strong>${euro(result.finance.paid)}</strong><small>pagamentos confirmados</small></article><article><span>Ocupação do mês</span><strong>${Math.round(Number(result.appointments.hours || 0))}h</strong><small>${result.appointments.count} sessões registadas</small></article><article><span>Por receber</span><strong>${euro(result.finance.pending)}</strong><small>valores pendentes este mês</small></article>`;
    const host = $('#adminContent').querySelector('.studio-dashboard-grid');
    if (host) host.insertAdjacentHTML('afterend', `<section class="dashboard-live"><article class="studio-panel"><div class="studio-panel-heading"><div><p class="eyebrow">Próximas sessões</p><h3>Agenda do estúdio</h3></div><button type="button" class="client-link" data-module="schedule">Abrir agenda</button></div><div class="dashboard-session-list">${result.upcoming.length ? result.upcoming.map(item => `<div><time>${date(item.startsAt)}</time><span><strong>${escapeHtml(item.service)}</strong><small>${escapeHtml(item.clientName)} · até ${String(item.endsAt).slice(11, 16)}</small></span><b class="status-${escapeHtml(item.status)}">${item.status === 'pending' ? 'Pendente' : 'Confirmada'}</b></div>`).join('') : '<p class="admin-hint">Sem próximas sessões.</p>'}</div></article><article class="studio-panel"><div class="studio-panel-heading"><div><p class="eyebrow">Atividade recente</p><h3>Operações</h3></div></div><div class="dashboard-activity-list">${result.activity.length ? result.activity.map(item => `<div><span></span><p><strong>${activityLabel(item.action)}</strong><small>${escapeHtml(item.clientName)} · ${String(item.createdAt).slice(0, 16).replace(' ', ' às ')}</small></p></div>`).join('') : '<p class="admin-hint">Ainda não há atividade registada.</p>'}</div></article></section>`);
  }).catch(() => {});
}
function renderClients() {
  $('#adminTabs').hidden = true;
  $('#publishButton').hidden = true;
  $('#adminContent').innerHTML = '<div id="clientModuleRoot"></div>';
  window.ClientAdminModule.mount($('#clientModuleRoot'), { apiBase, getToken: () => sessionToken, getCsrf: () => csrfToken, onError: error => notice(error.message, 'error'), onNotice: notice }).catch(error => notice(error.message, 'error'));
}
function renderSchedule() {
  $('#adminTabs').hidden = true;
  $('#publishButton').hidden = true;
  $('#adminContent').innerHTML = '<div id="scheduleModuleRoot"></div>';
  window.StudioScheduleModule.mount($('#scheduleModuleRoot'), { apiBase, getToken: () => sessionToken, getCsrf: () => csrfToken, onError: error => notice(error.message, 'error'), onNotice: notice }).catch(error => notice(error.message, 'error'));
}
function renderFinance() {
  $('#adminTabs').hidden = true;
  $('#publishButton').hidden = true;
  $('#adminContent').innerHTML = '<div id="financeModuleRoot"></div>';
  window.FinanceModule.mount($('#financeModuleRoot'), { apiBase, getToken: () => sessionToken, bookingServices: draft?.bookingServices || bookingServiceDefaults, saveBookingServices: async services => {
    if (!draft) { const response = await fetch(`${apiBase}/content`, { cache: 'no-store' }); if (!response.ok) throw new Error('Não foi possível carregar a configuração de preços.'); draft = await response.json(); }
    draft.bookingServices = services;
    const response = await fetch(`${apiBase}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CMS-CSRF': csrfToken, Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify({ content: draft }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível guardar os preços.');
    notice(`Preços publicados. Commit ${result.commit.slice(0, 7)}.`, 'success');
  }, onError: error => notice(error.message, 'error'), onNotice: notice }).catch(error => notice(error.message, 'error'));
}
function selectModule(module) {
  activeModule = module;
  sessionStorage.setItem('th_admin_requested_module', module);
  history.replaceState(null, '', `${['clients', 'schedule', 'finance'].includes(module) ? `${location.pathname}?section=${module}` : location.pathname}`);
  renderModules();
  if (module === 'dashboard') return renderDashboard();
  if (module === 'clients') return renderClients();
  if (module === 'schedule') return renderSchedule();
  if (module === 'finance') return renderFinance();
  $('#adminTabs').hidden = false;
  $('#publishButton').hidden = isLocalPreview;
  if (contentLoaded) return renderTab();
  $('#adminContent').innerHTML = '<p class="admin-hint">A carregar o conteúdo do site…</p>';
  loadContent().catch(error => notice(error.message, 'error'));
}
function showEditor() {
  $('#adminTitle').textContent = 'Gerir o estúdio';
  $('#adminDescription').textContent = 'Conteúdos, clientes e operações, numa única área privada.';
  $('#adminModules').hidden = false;
  $('#adminContent').hidden = false;
  document.body.classList.add('admin-ready');
  renderModules();
  selectModule(activeModule);
}
async function publish() {
  if (isLocalPreview) { notice('Pré-visualização local: as alterações não podem ser publicadas daqui.', 'muted'); return; }
  notice('A publicar…');
  const response = await fetch(`${apiBase}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CMS-CSRF': csrfToken, Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify({ content: draft }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'A publicação falhou.');
  notice(`Publicado com sucesso. Commit ${result.commit.slice(0, 7)}. O GitHub Pages pode demorar um momento a atualizar.`, 'success');
}
async function uploadArtistImage(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (isLocalPreview) { notice('O envio de imagens requer o Admin online.', 'muted'); input.value = ''; return; }
  if (!apiBase || !sessionToken || !csrfToken) throw new Error('Inicie sessão para enviar imagens.');
  const index = Number(input.dataset.artistImage);
  if (!Number.isInteger(index) || !draft.artists[index]) throw new Error('Artista inválido.');
  const form = new FormData();
  form.append('image', file);
  form.append('artist', draft.artists[index].name || 'artista');
  input.disabled = true;
  notice('A enviar imagem…');
  try {
    const response = await fetch(`${apiBase}/media/artists`, { method: 'POST', headers: { 'X-CMS-CSRF': csrfToken, Authorization: `Bearer ${sessionToken}` }, body: form });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível enviar a imagem.');
    draft.artists[index].image = result.path;
    notice('Imagem guardada. Carregue em Publicar para a associar ao artista.', 'success');
    renderTab();
  } finally { input.disabled = false; }
}

document.addEventListener('DOMContentLoaded', async () => {
  const tokenMatch = location.hash.match(/(?:^#|&)cms_session=([^&]+)/);
  if (tokenMatch) {
    sessionToken = decodeURIComponent(tokenMatch[1]);
    sessionStorage.setItem('th_cms_session', sessionToken);
    history.replaceState(null, '', location.pathname + location.search);
  }
  document.addEventListener('input', event => { if (!event.target.matches('[data-bind]')) return; setPath(event.target.dataset.bind, parseSpecial(event.target.dataset.bind, event.target.value)); });
  document.addEventListener('change', event => { if (event.target.matches('[data-artist-image]')) { uploadArtistImage(event.target).catch(error => notice(error.message, 'error')); return; } if (!event.target.matches('[data-bind]')) return; setPath(event.target.dataset.bind, event.target.type === 'checkbox' ? event.target.checked : parseSpecial(event.target.dataset.bind, event.target.value)); });
  document.addEventListener('click', event => { const module = event.target.closest('[data-module]'); const tab = event.target.closest('[data-tab]'); const add = event.target.closest('[data-add]'); const remove = event.target.closest('[data-remove]'); if (module) selectModule(module.dataset.module); if (tab) { activeTab = tab.dataset.tab; renderTab(); } if (add) addItem(add.dataset.add); if (remove) removeItem(remove.dataset.remove, Number(remove.dataset.index)); });
  $('#loginButton').addEventListener('click', () => { window.location.assign(`${apiBase}/auth/login`); });
  $('#publishButton').addEventListener('click', () => publish().catch(error => notice(error.message, 'error')));
  try { if (await refreshSession()) { showEditor(); loadContent().catch(error => { if (activeModule === 'site') notice(error.message, 'error'); }); } } catch (error) { notice(error.message, 'error'); }
});
