let draft;
let contentLoaded = false;
let artistClientAccounts = [];
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
function artistClientField(item, index) {
  const accounts = artistClientAccounts.map(client => `<option value="${escapeHtml(client.id)}" ${client.id === item.clientId ? 'selected' : ''}>${escapeHtml(client.name)}${client.active ? '' : ' · pausado'}</option>`).join('');
  return `<label class="admin-field"><span>Conta associada</span><select data-bind="artists.${index}.clientId"><option value="">Sem associação à Área do Artista</option>${accounts}</select><small>Quando publicares, esta conta poderá atualizar fotografia, biografia e links. O catálogo continua gerido aqui.</small></label>`;
}
function artistOrderPanel() {
  return `<div class="artist-order-panel"><div class="artist-order-heading"><div><p class="eyebrow">Ordem pública</p><h3>Artistas no site</h3></div><small>A primeira posição aparece primeiro na secção Artistas.</small></div><ol class="artist-order-list">${draft.artists.map((artist, index) => `<li><span>${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(artist.name || `Artista ${index + 1}`)}</strong><div><button type="button" class="artist-order-button" data-move-artist="up" data-index="${index}" aria-label="Subir ${escapeHtml(artist.name || `artista ${index + 1}`)}" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" class="artist-order-button" data-move-artist="down" data-index="${index}" aria-label="Descer ${escapeHtml(artist.name || `artista ${index + 1}`)}" ${index === draft.artists.length - 1 ? 'disabled' : ''}>↓</button></div></li>`).join('')}</ol></div>`;
}
function renderArtists() { return `<section class="artist-editor">${artistOrderPanel()}${listCards('artists', (item, index) => card(item.name || `Artista ${index + 1}`, `${field('Nome', `artists.${index}.name`, item.name)}${field('Género / função', `artists.${index}.genre`, item.genre)}${artistClientField(item, index)}${artistImageField(item, index)}<div class="artist-display-options"><p class="eyebrow">Perfil público</p>${checkbox('Mostrar biografia', `artists.${index}.showBio`, item.showBio !== false)}${checkbox('Mostrar links das plataformas', `artists.${index}.showLinks`, item.showLinks !== false)}<small>Desativa ambos para apresentar apenas a fotografia e o catálogo Trap Houze.</small></div>${field('Biografia', `artists.${index}.bio`, item.bio || '', 'textarea')}<div class="admin-row">${field('Instagram', `artists.${index}.instagram`, artistPlatformUrl(item, 'instagram', 'Instagram'), 'url')}${field('YouTube', `artists.${index}.youtube`, artistPlatformUrl(item, 'youtube', 'YouTube'), 'url')}${field('Spotify', `artists.${index}.spotify`, artistPlatformUrl(item, 'spotify', 'Spotify'), 'url')}${field('Apple Music', `artists.${index}.appleMusic`, artistPlatformUrl(item, 'appleMusic', 'Apple Music'), 'url')}</div>${field('Playlist Spotify do catálogo', `artists.${index}.spotifyPlaylist`, artistPlaylistUrl(item), 'url')}<p class="admin-hint">O catálogo é sempre definido pela Trap Houze e não fica disponível para edição na Área do Artista.</p>`, `<button class="admin-icon" data-remove="artists" data-index="${index}" aria-label="Remover">×</button>`), 'Adicionar artista')}</section>`; }
function renderReviews() { return `<section>${listCards('reviews', (item, index) => card(item.name || `Avaliação ${index + 1}`, `${field('Nome', `reviews.${index}.name`, item.name)}${field('Texto', `reviews.${index}.text`, item.text, 'textarea')}`, `<button class="admin-icon" data-remove="reviews" data-index="${index}" aria-label="Remover">×</button>`), 'Adicionar avaliação')}</section>`; }

function addItem(collection) { const models = { hero: { title: 'Novo destaque', subtitle: '', image: '' }, services: { title: 'Novo serviço', description: '', icon: '✦', action: 'booking', visible: true }, equipment: { id: 'novo-item', title: 'Novo equipamento', description: '', images: [] }, artists: { name: 'Novo artista', genre: '', image: '', bio: '', instagram: '', youtube: '', spotify: '', appleMusic: '', spotifyPlaylist: '', clientId: '', showBio: true, showLinks: true }, reviews: { name: 'Nome', text: '' } }; draft[collection].push(models[collection]); renderTab(); }
function removeItem(collection, index) { draft[collection].splice(index, 1); renderTab(); }
function moveArtist(index, direction) { const target = index + direction; if (!draft.artists?.[index] || !draft.artists?.[target]) return; const [artist] = draft.artists.splice(index, 1); draft.artists.splice(target, 0, artist); notice('Ordem atualizada no rascunho. Publique para aplicar no site.', 'success'); renderTab(); }
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
    spotifyPlaylist: artistPlaylistUrl(artist),
    clientId: artist.clientId || '',
    showBio: artist.showBio !== false,
    showLinks: artist.showLinks !== false
  }));
  loadArtistClientAccounts().then(() => {
    if (activeModule === 'site' && activeTab === 'artists') renderTab();
  });
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
  $('#adminContent').innerHTML = `<section class="studio-dashboard studio-dashboard-practical"><header class="dashboard-overview"><div><p class="eyebrow">Visão operacional</p><h2>Hoje no estúdio</h2><p>Vê o que exige atenção e avança diretamente para a área certa.</p></div><button type="button" class="dashboard-primary-action" data-module="schedule"><span>+</span> Nova marcação</button></header><div class="studio-stats dashboard-stats"><article><span>Clientes ativos</span><strong>—</strong><small>na Área do Artista</small></article><article><span>Recebido este mês</span><strong>—</strong><small>pagamentos confirmados</small></article><article><span>Ocupação do mês</span><strong>—</strong><small>sessões registadas</small></article><article><span>Por receber</span><strong>—</strong><small>valores pendentes este mês</small></article></div><div class="dashboard-priority-grid"><section class="studio-panel dashboard-sessions-panel"><div class="studio-panel-heading"><div><p class="eyebrow">Agenda</p><h3>Próximas sessões</h3></div><button type="button" class="client-link" data-module="schedule">Ver agenda</button></div><div id="dashboardUpcoming" class="dashboard-session-list"><p class="admin-hint">A carregar sessões…</p></div></section><section class="studio-panel dashboard-actions-panel"><div class="studio-panel-heading"><div><p class="eyebrow">Ações rápidas</p><h3>Gerir o estúdio</h3></div></div><div class="dashboard-quick-actions"><button type="button" class="dashboard-quick-action" data-module="clients"><span>Clientes</span><small>Contas, músicas e reservas</small><b>→</b></button><button type="button" class="dashboard-quick-action" data-module="finance"><span>Finanças</span><small>Pagamentos e valores pendentes</small><b>→</b></button><button type="button" class="dashboard-quick-action" data-module="site"><span>Editar site</span><small>Conteúdos e publicação</small><b>→</b></button></div></section></div><section class="studio-panel dashboard-activity-panel"><div class="studio-panel-heading"><div><p class="eyebrow">Registo recente</p><h3>Últimas operações</h3></div></div><div id="dashboardActivity" class="dashboard-activity-list"><p class="admin-hint">A carregar atividade…</p></div></section></section>`;
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
    const upcoming = $('#dashboardUpcoming');
    if (upcoming) upcoming.innerHTML = result.upcoming.length ? result.upcoming.map(item => `<div><time>${date(item.startsAt)}</time><span><strong>${escapeHtml(item.service)}</strong><small>${escapeHtml(item.clientName)} · até ${String(item.endsAt).slice(11, 16)}</small></span><b class="status-${escapeHtml(item.status)}">${item.status === 'pending' ? 'Pendente' : 'Confirmada'}</b></div>`).join('') : '<p class="admin-hint">Sem próximas sessões.</p>';
    const activity = $('#dashboardActivity');
    if (activity) activity.innerHTML = result.activity.length ? result.activity.map(item => `<div><span></span><p><strong>${activityLabel(item.action)}</strong><small>${escapeHtml(item.clientName)} · ${String(item.createdAt).slice(0, 16).replace(' ', ' às ')}</small></p></div>`).join('') : '<p class="admin-hint">Ainda não há atividade registada.</p>';
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
  window.StudioScheduleModule.mount($('#scheduleModuleRoot'), { apiBase, getToken: () => sessionToken, getCsrf: () => csrfToken, onError: error => notice(error.message, 'error'), onNotice: notice, saveBookingSchedule: async schedule => {
    const contentResponse = await fetch(`${apiBase}/content?refresh=${Date.now()}`, { cache: 'no-store' });
    const currentContent = await contentResponse.json().catch(() => null);
    if (!contentResponse.ok || !currentContent) throw new Error('Não foi possível carregar a configuração atual da agenda.');
    currentContent.bookingSchedule = schedule;
    const response = await fetch(`${apiBase}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CMS-CSRF': csrfToken, Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify({ content: currentContent }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Não foi possível guardar a configuração da agenda.');
    draft = result.content || currentContent;
    return { commit: result.commit || '', schedule: draft.bookingSchedule };
  } }).catch(error => notice(error.message, 'error'));
}
async function loadArtistClientAccounts() {
  if (!apiBase || !sessionToken) return;
  try {
    const response = await fetch(`${apiBase}/client/admin/clients`, { headers: { Authorization: `Bearer ${sessionToken}` } });
    if (!response.ok) return;
    artistClientAccounts = (await response.json()).clients || [];
  } catch { /* O editor continua disponível se a lista de contas não puder ser carregada. */ }
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
  $('#adminTitle').hidden = true;
  $('#adminDescription').hidden = true;
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
  document.addEventListener('click', event => { const module = event.target.closest('[data-module]'); const tab = event.target.closest('[data-tab]'); const add = event.target.closest('[data-add]'); const remove = event.target.closest('[data-remove]'); const move = event.target.closest('[data-move-artist]'); if (module) selectModule(module.dataset.module); if (tab) { activeTab = tab.dataset.tab; renderTab(); } if (add) addItem(add.dataset.add); if (remove) removeItem(remove.dataset.remove, Number(remove.dataset.index)); if (move) moveArtist(Number(move.dataset.index), move.dataset.moveArtist === 'up' ? -1 : 1); });
  $('#loginButton').addEventListener('click', () => { window.location.assign(`${apiBase}/auth/login`); });
  $('#publishButton').addEventListener('click', () => publish().catch(error => notice(error.message, 'error')));
  try { if (await refreshSession()) { showEditor(); loadContent().catch(error => { if (activeModule === 'site') notice(error.message, 'error'); }); } } catch (error) { notice(error.message, 'error'); }
});
