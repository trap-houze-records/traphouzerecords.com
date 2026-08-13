let draft;
let contentLoaded = false;
let activeTab = 'site';
const requestedModule = new URLSearchParams(location.search).get('section');
let activeModule = ['clients', 'schedule'].includes(requestedModule) ? requestedModule : (sessionStorage.getItem('th_admin_requested_module') || 'dashboard');
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
const modules = [['dashboard', 'Dashboard'], ['site', 'Editar site'], ['schedule', 'Agenda'], ['clients', 'Clientes']];
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

function renderSite() { const site = draft.site; return `<section class="admin-grid">${card('Dados gerais', [field('Nome', 'site.name', site.name), field('Subtítulo', 'site.tagline', site.tagline), field('Localização', 'site.location', site.location), field('E-mail', 'site.email', site.email), field('URL Instagram', 'site.instagram', site.instagram), field('Nome no Instagram', 'site.instagramHandle', site.instagramHandle), field('WhatsApp (só algarismos)', 'site.whatsapp', site.whatsapp), field('URL de agendamento', 'site.bookingUrl', site.bookingUrl), field('Horário', 'site.hours', site.hours)].join(''))}</section>`; }
function renderMenu() { return `<section>${card('Navegação', '<p class="admin-hint">Desative uma secção para escondê-la do menu e do site.</p>' + draft.navigation.map((item, index) => `<div class="admin-row">${field('Nome', `navigation.${index}.label`, item.label)}${field('ID', `navigation.${index}.id`, item.id)}${checkbox('Visível', `navigation.${index}.visible`, item.visible)}</div>`).join(''))}</section>`; }
function renderHero() { return `<section>${listCards('hero', (item, index) => card(`Destaque ${index + 1}`, `${field('Título', `hero.${index}.title`, item.title)}${field('Subtítulo', `hero.${index}.subtitle`, item.subtitle)}${field('Imagem (URL)', `hero.${index}.image`, item.image)}`, `<button class="admin-icon" data-remove="hero" data-index="${index}" aria-label="Remover">×</button>`), 'Adicionar destaque')}</section>`; }
function renderServices() { return `<section>${listCards('services', (item, index) => card(item.title || `Serviço ${index + 1}`, `${field('Título', `services.${index}.title`, item.title)}${field('Ícone', `services.${index}.icon`, item.icon)}${field('Descrição', `services.${index}.description`, item.description, 'textarea')}<label class="admin-field"><span>Ação</span><select data-bind="services.${index}.action"><option value="booking" ${item.action === 'booking' ? 'selected' : ''}>Agenda</option><option value="whatsapp" ${item.action === 'whatsapp' ? 'selected' : ''}>WhatsApp</option></select></label>${checkbox('Disponível', `services.${index}.visible`, item.visible)}`, `<button class="admin-icon" data-remove="services" data-index="${index}" aria-label="Remover">×</button>`), 'Adicionar serviço')}</section>`; }
function renderEquipment() { return `<section>${listCards('equipment', (item, index) => card(item.title || `Item ${index + 1}`, `${field('Identificador', `equipment.${index}.id`, item.id)}${field('Título', `equipment.${index}.title`, item.title)}${field('Descrição', `equipment.${index}.description`, item.description, 'textarea')}${field('Imagens (uma URL por linha)', `equipment.${index}.images`, item.images.join('\n'), 'textarea')}`, `<button class="admin-icon" data-remove="equipment" data-index="${index}" aria-label="Remover">×</button>`), 'Adicionar equipamento')}</section>`; }
function renderAbout() { const about = draft.about; return `<section class="admin-grid">${card('Texto', `${field('Título', 'about.title', about.title)}${field('Parágrafos (um por linha)', 'about.paragraphs', about.paragraphs.join('\n'), 'textarea')}${field('Imagem (URL)', 'about.image', about.image)}`)}${card('Indicadores', about.stats.map((stat, index) => `<div class="admin-row">${field('Número', `about.stats.${index}.value`, stat.value)}${field('Descrição', `about.stats.${index}.label`, stat.label)}</div>`).join(''))}</section>`; }
function renderArtists() { return `<section>${listCards('artists', (item, index) => card(item.name || `Artista ${index + 1}`, `${field('Nome', `artists.${index}.name`, item.name)}${field('Género / função', `artists.${index}.genre`, item.genre)}${field('Imagem (URL)', `artists.${index}.image`, item.image)}`, `<button class="admin-icon" data-remove="artists" data-index="${index}" aria-label="Remover">×</button>`), 'Adicionar artista')}</section>`; }
function renderReviews() { return `<section>${listCards('reviews', (item, index) => card(item.name || `Avaliação ${index + 1}`, `${field('Nome', `reviews.${index}.name`, item.name)}${field('Texto', `reviews.${index}.text`, item.text, 'textarea')}`, `<button class="admin-icon" data-remove="reviews" data-index="${index}" aria-label="Remover">×</button>`), 'Adicionar avaliação')}</section>`; }

function addItem(collection) { const models = { hero: { title: 'Novo destaque', subtitle: '', image: '' }, services: { title: 'Novo serviço', description: '', icon: '✦', action: 'booking', visible: true }, equipment: { id: 'novo-item', title: 'Novo equipamento', description: '', images: [] }, artists: { name: 'Novo artista', genre: '', image: '' }, reviews: { name: 'Nome', text: '' } }; draft[collection].push(models[collection]); renderTab(); }
function removeItem(collection, index) { draft[collection].splice(index, 1); renderTab(); }
function parseSpecial(path, value) { if (path.endsWith('.images')) return value.split('\n').map(item => item.trim()).filter(Boolean); if (path === 'about.paragraphs') return value.split('\n').map(item => item.trim()).filter(Boolean); return value; }
function notice(message, kind = '') { const element = $('#notice'); element.textContent = message; element.className = `admin-notice ${kind}`; }

async function loadContent() {
  const url = isLocalPreview ? 'data/site.json' : (apiBase ? `${apiBase}/content` : 'data/site.json');
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error('Não foi possível carregar o conteúdo.');
  draft = await response.json();
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
  $('#adminContent').innerHTML = `<section class="studio-dashboard"><header class="studio-dashboard-heading"><div><p class="eyebrow">Visão operacional</p><h2>Hoje no estúdio</h2><p>O essencial do dia, sem distrações.</p></div><span class="studio-live">Sistema ativo</span></header><div class="studio-stats"><article><span>Clientes ativos</span><strong id="dashboardClientCount">—</strong><small>na Área do Cliente</small></article><article><span>Trabalhos pendentes</span><strong>—</strong><small>Em breve</small></article><article><span>Reservas</span><strong>—</strong><small>Gerir na agenda</small></article><article><span>Pagamentos pendentes</span><strong>—</strong><small>Em breve</small></article></div><div class="studio-dashboard-grid"><section class="studio-panel"><div class="studio-panel-heading"><div><p class="eyebrow">Começar</p><h3>Gestão do estúdio</h3></div></div><button type="button" class="studio-action" data-module="schedule"><span>01</span><div><strong>Abrir agenda</strong><small>Marcações, horários e disponibilidade.</small></div><b>→</b></button><button type="button" class="studio-action" data-module="clients"><span>02</span><div><strong>Gerir clientes</strong><small>Contas, músicas, reservas e pagamentos.</small></div><b>→</b></button><button type="button" class="studio-action" data-module="site"><span>03</span><div><strong>Editar site</strong><small>Conteúdos, navegação e publicação.</small></div><b>→</b></button></section><section class="studio-panel"><div class="studio-panel-heading"><div><p class="eyebrow">Próximas funções</p><h3>Em preparação</h3></div></div><ul class="studio-roadmap"><li><span>Reservas públicas</span><small>Substituição gradual do TidyCal pela agenda própria.</small></li><li><span>Resumo financeiro</span><small>Pagamentos, faturação e valores em falta.</small></li><li><span>Atividade recente</span><small>Histórico centralizado do estúdio.</small></li></ul></section></div></section>`;
  fetch(`${apiBase}/client/admin/clients`, { headers: { Authorization: `Bearer ${sessionToken}` } }).then(response => response.ok ? response.json() : null).then(result => { const count = $('#dashboardClientCount'); if (count) count.textContent = result ? result.clients.filter(client => client.active).length : '—'; }).catch(() => {});
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
function selectModule(module) {
  activeModule = module;
  sessionStorage.setItem('th_admin_requested_module', module);
  history.replaceState(null, '', `${location.pathname}${['clients', 'schedule'].includes(module) ? `?section=${module}` : ''}`);
  renderModules();
  if (module === 'dashboard') return renderDashboard();
  if (module === 'clients') return renderClients();
  if (module === 'schedule') return renderSchedule();
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

document.addEventListener('DOMContentLoaded', async () => {
  const tokenMatch = location.hash.match(/(?:^#|&)cms_session=([^&]+)/);
  if (tokenMatch) {
    sessionToken = decodeURIComponent(tokenMatch[1]);
    sessionStorage.setItem('th_cms_session', sessionToken);
    history.replaceState(null, '', location.pathname + location.search);
  }
  document.addEventListener('input', event => { if (!event.target.matches('[data-bind]')) return; setPath(event.target.dataset.bind, parseSpecial(event.target.dataset.bind, event.target.value)); });
  document.addEventListener('change', event => { if (!event.target.matches('[data-bind]')) return; setPath(event.target.dataset.bind, event.target.type === 'checkbox' ? event.target.checked : parseSpecial(event.target.dataset.bind, event.target.value)); });
  document.addEventListener('click', event => { const module = event.target.closest('[data-module]'); const tab = event.target.closest('[data-tab]'); const add = event.target.closest('[data-add]'); const remove = event.target.closest('[data-remove]'); if (module) selectModule(module.dataset.module); if (tab) { activeTab = tab.dataset.tab; renderTab(); } if (add) addItem(add.dataset.add); if (remove) removeItem(remove.dataset.remove, Number(remove.dataset.index)); });
  $('#loginButton').addEventListener('click', () => { window.location.assign(`${apiBase}/auth/login`); });
  $('#publishButton').addEventListener('click', () => publish().catch(error => notice(error.message, 'error')));
  try { if (await refreshSession()) { showEditor(); loadContent().catch(error => { if (activeModule === 'site') notice(error.message, 'error'); }); } } catch (error) { notice(error.message, 'error'); }
});
