let content;
let activeSlide = 0;

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const safeUrl = value => { try { const url = new URL(String(value || '')); return ['https:', 'http:'].includes(url.protocol) ? url.toString() : ''; } catch { return ''; } };
const artistPlatforms = [['Instagram', 'instagram'], ['YouTube', 'youtube'], ['Spotify', 'spotify'], ['Apple Music', 'applemusic']];
const spotifyPlaylistEmbed = value => {
  const url = safeUrl(value);
  const match = url.match(/^https:\/\/open\.spotify\.com\/playlist\/([A-Za-z0-9]+)(?:\?.*)?$/i);
  return match ? `https://open.spotify.com/embed/playlist/${match[1]}?utm_source=generator` : '';
};
const visibleNav = () => content.navigation.filter(item => item.visible);
const sectionVisible = id => visibleNav().some(item => item.id === id);

function renderHero() {
  return `<section id="home" class="hero-slider">${content.hero.map((slide, index) => `
    <div class="slide ${index === 0 ? 'active' : ''}" style="background-image:url('${escapeHtml(slide.image)}')">
      <div class="slide-content"><h1 class="logo-text">${escapeHtml(slide.title)}</h1><p class="slide-subtitle">${escapeHtml(slide.subtitle)}</p></div>
    </div>`).join('')}</section>`;
}

function renderServices() {
  const services = content.services.map((service, index) => ({ service, index })).filter(({ service }) => service.visible);
  if (!sectionVisible('services') || !services.length) return '';
  return `<section id="services" class="services"><h2 class="section-title">Serviços</h2><div class="service-grid">${services.map(({ service, index }) => `
    <article class="service-card"><div><div class="service-icon">${escapeHtml(service.icon)}</div><h3>${escapeHtml(service.title)}</h3><p>${escapeHtml(service.description)}</p></div>
    <button class="btn" data-service="${index}">${service.action === 'whatsapp' ? 'Contactar' : 'Reservar'}</button></article>`).join('')}</div></section>`;
}

function renderEquipment() {
  if (!sectionVisible('equipment')) return '';
  return `<section id="equipment" class="equipment"><h2 class="section-title">Equipamento</h2><div class="equipment-grid">${content.equipment.map((item, index) => `
    <button class="equipment-item" data-equipment="${index}"><div class="equipment-icon">✦</div><h4>${escapeHtml(item.title)}</h4><p>Ver detalhes</p></button>`).join('')}</div></section>`;
}

function renderAbout() {
  if (!sectionVisible('about')) return '';
  const about = content.about;
  return `<section id="about" class="about"><h2 class="section-title">Quem somos</h2><div class="about-content"><div class="about-text"><h3>${escapeHtml(about.title)}</h3>${about.paragraphs.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('')}<div class="about-stats">${about.stats.map(stat => `<div class="stat-item"><span class="stat-number">${escapeHtml(stat.value)}</span><span class="stat-label">${escapeHtml(stat.label)}</span></div>`).join('')}</div></div><div class="about-image">${about.image ? `<img src="${escapeHtml(about.image)}" alt="${escapeHtml(about.title)}">` : 'Imagem do estúdio'}</div></div></section>`;
}

function renderArtists() {
  if (!sectionVisible('artists') || !content.artists.length) return '';
  return `<section id="artists" class="artists"><h2 class="section-title">Artistas</h2><div class="artists-grid">${content.artists.map((artist, index) => `<button type="button" class="artist-item" data-artist="${index}" aria-label="Ver perfil de ${escapeHtml(artist.name)}"><img class="artist-item-image" src="${escapeHtml(safeUrl(artist.image) || 'images/Logo.png')}" alt="${escapeHtml(artist.name)}"><div class="artist-item-name"><h4>${escapeHtml(artist.name)}</h4><p>${escapeHtml(artist.genre)}</p><span>Ver perfil →</span></div></button>`).join('')}</div></section>`;
}

function renderReviews() {
  if (!sectionVisible('reviews') || !content.reviews.length) return '';
  return `<section id="reviews" class="reviews"><h2 class="section-title">Avaliações</h2><div class="review-container">${content.reviews.map(review => `<article class="review-card"><div class="review-header"><span class="reviewer-name">${escapeHtml(review.name)}</span><span class="stars">★★★★★</span></div><p class="review-text">${escapeHtml(review.text)}</p></article>`).join('')}</div></section>`;
}

function renderModal() { return `<div id="modal" class="modal"><div class="modal-content"><div class="modal-header"><h3 id="modalTitle"></h3><button class="close-modal" aria-label="Fechar">×</button></div><div class="modal-body"><div id="modalGallery" class="equipment-gallery"></div><p id="modalDescription" class="equipment-description"></p></div></div></div>`; }
function renderArtistModal() { return `<div id="artistModal" class="modal artist-modal" aria-hidden="true"><article class="modal-content artist-modal-content" role="dialog" aria-modal="true" aria-labelledby="artistModalTitle"><header class="modal-header"><div><p class="eyebrow">Trap Houze Records</p><h3 id="artistModalTitle"></h3></div><button class="close-modal" aria-label="Fechar perfil do artista">×</button></header><div id="artistModalBody" class="artist-modal-body"></div></article></div>`; }
function renderBooking() { return `<div id="bookingPopup" class="popup-overlay" aria-hidden="true"><div class="popup" role="dialog" aria-modal="true" aria-labelledby="popupServiceTitle"><button class="close-btn" aria-label="Fechar">×</button><div class="popup-header"><h2 id="popupServiceTitle">Agendar sessão</h2></div><div class="popup-body"><div class="tidycal-embed" data-path="traphouzerecords"></div></div></div></div>`; }

function renderSite() {
  document.getElementById('site').innerHTML = `<nav><a href="#home" aria-label="Início"><img src="images/Logo.png" alt="${escapeHtml(content.site.name)}" class="nav-logo"></a><ul>${visibleNav().map(item => `<li><a href="#${escapeHtml(item.id)}">${escapeHtml(item.label)}</a></li>`).join('')}</ul></nav>${renderHero()}${renderServices()}${renderEquipment()}${renderAbout()}${renderArtists()}${renderReviews()}<footer><p>© ${new Date().getFullYear()} ${escapeHtml(content.site.name)}</p><p>${escapeHtml(content.site.location)}</p></footer><button class="help-button" aria-label="Contactos">?</button><div id="helpPopup" class="help-popup"><div class="help-popup-header"><h4>Contactos</h4><button class="close-help" aria-label="Fechar">×</button></div><div class="help-content"><a href="mailto:${escapeHtml(content.site.email)}">${escapeHtml(content.site.email)}</a><a href="${escapeHtml(content.site.instagram)}" target="_blank" rel="noopener">${escapeHtml(content.site.instagramHandle)}</a><a href="https://wa.me/${escapeHtml(content.site.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a><p>${escapeHtml(content.site.hours)}</p></div></div>${renderModal()}${renderArtistModal()}${renderBooking()}`;
}

function showEquipment(index) {
  const item = content.equipment[index];
  document.getElementById('modalTitle').textContent = item.title;
  document.getElementById('modalDescription').textContent = item.description;
  document.getElementById('modalGallery').innerHTML = item.images.map(image => `<img class="equipment-image" src="${escapeHtml(image)}" alt="${escapeHtml(item.title)}">`).join('');
  document.getElementById('modal').classList.add('active');
}
function openBooking(service) {
  if (service.action === 'whatsapp') {
    window.open(`https://wa.me/${content.site.whatsapp}?text=${encodeURIComponent(`Olá Trap Houze! Quero marcar ${service.title}.`)}`, '_blank', 'noopener');
    return;
  }
  const popup = document.getElementById('bookingPopup');
  document.getElementById('popupServiceTitle').textContent = `Agendar ${service.title}`;
  popup.classList.add('active');
  popup.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}
function showArtist(index) {
  const artist = content.artists[index];
  const links = Array.isArray(artist.links) ? artist.links : [];
  const platformProperties = { Instagram: 'instagram', YouTube: 'youtube', Spotify: 'spotify', 'Apple Music': 'appleMusic' };
  const platformLinks = artistPlatforms.map(([label, icon]) => {
    const legacy = links.find(item => String(item.label || '').trim().toLowerCase() === label.toLowerCase());
    const url = safeUrl(artist[platformProperties[label]] || legacy?.url);
    return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" aria-label="${label} de ${escapeHtml(artist.name)}"><img src="https://cdn.simpleicons.org/${icon}/ffffff" alt="">${label}<span>↗</span></a>` : `<span class="artist-platform-disabled" aria-label="${label} ainda não disponível"><img src="https://cdn.simpleicons.org/${icon}/777777" alt="">${label}</span>`;
  }).join('');
  const legacyPlaylist = (artist.catalog || []).find(item => spotifyPlaylistEmbed(item.url));
  const playlist = spotifyPlaylistEmbed(artist.spotifyPlaylist || legacyPlaylist?.url);
  const catalogMarkup = playlist
    ? `<article class="artist-catalog-playlist"><div><strong>Playlist Spotify</strong><small>Catálogo Trap Houze · ${escapeHtml(artist.name)}</small></div><iframe src="${escapeHtml(playlist)}" title="Playlist Spotify: ${escapeHtml(artist.name)}" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe></article>`
    : '<p>A playlist Spotify deste artista será disponibilizada em breve.</p>';
  document.getElementById('artistModalTitle').textContent = artist.name;
  document.getElementById('artistModalBody').innerHTML = `<div class="artist-modal-profile"><img class="artist-modal-image" src="${escapeHtml(safeUrl(artist.image) || 'images/Logo.png')}" alt="${escapeHtml(artist.name)}"><div><p class="artist-modal-genre">${escapeHtml(artist.genre || 'Artista Trap Houze Records')}</p><p class="artist-modal-bio">${escapeHtml(artist.bio || 'Perfil em atualização.')}</p></div></div><section class="artist-modal-section"><h4>Ouvir e seguir</h4><div class="artist-links">${platformLinks}</div></section><section class="artist-modal-section"><h4>Catálogo Trap Houze</h4><div class="artist-catalog">${catalogMarkup}</div></section>`;
  const modal = document.getElementById('artistModal');
  modal.classList.add('active'); modal.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden';
}
function closeOverlays() {
  document.querySelectorAll('.modal.active, .popup-overlay.active').forEach(element => {
    element.classList.remove('active');
    if (element.id === 'bookingPopup') element.setAttribute('aria-hidden', 'true');
    if (element.id === 'artistModal') element.setAttribute('aria-hidden', 'true');
  });
  document.body.style.overflow = '';
}

function bindEvents() {
  document.addEventListener('click', event => {
    const service = event.target.closest('[data-service]');
    const equipment = event.target.closest('[data-equipment]');
    const artist = event.target.closest('[data-artist]');
    if (service) openBooking(content.services[Number(service.dataset.service)]);
    if (equipment) showEquipment(Number(equipment.dataset.equipment));
    if (artist) showArtist(Number(artist.dataset.artist));
    if (event.target.closest('.close-modal, .close-btn') || event.target.matches('.modal, .popup-overlay')) closeOverlays();
    if (event.target.closest('.help-button, .close-help')) document.getElementById('helpPopup').classList.toggle('active');
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeOverlays(); });
}
function startSlides() { setInterval(() => { const slides = document.querySelectorAll('.slide'); if (!slides.length) return; slides[activeSlide].classList.remove('active'); activeSlide = (activeSlide + 1) % slides.length; slides[activeSlide].classList.add('active'); }, 5000); }

fetch('data/site.json', { cache: 'no-store' }).then(response => { if (!response.ok) throw new Error('Não foi possível carregar o conteúdo.'); return response.json(); }).then(data => { content = data; renderSite(); bindEvents(); startSlides(); const script = document.createElement('script'); script.src = 'https://asset-tidycal.b-cdn.net/js/embed.js'; script.async = true; document.body.appendChild(script); }).catch(error => { document.getElementById('site').innerHTML = `<main class="site-error">${escapeHtml(error.message)}</main>`; console.error(error); });
