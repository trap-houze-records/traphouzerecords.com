let content;
let activeSlide = 0;

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
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
  return `<section id="artists" class="artists"><h2 class="section-title">Artistas</h2><div class="artists-grid">${content.artists.map(artist => `<article class="artist-item">${artist.image ? `<img class="artist-item-image" src="${escapeHtml(artist.image)}" alt="${escapeHtml(artist.name)}">` : '<div class="artist-item-image">FOTO</div>'}<div class="artist-item-name"><h4>${escapeHtml(artist.name)}</h4><p>${escapeHtml(artist.genre)}</p></div></article>`).join('')}</div></section>`;
}

function renderReviews() {
  if (!sectionVisible('reviews') || !content.reviews.length) return '';
  return `<section id="reviews" class="reviews"><h2 class="section-title">Avaliações</h2><div class="review-container">${content.reviews.map(review => `<article class="review-card"><div class="review-header"><span class="reviewer-name">${escapeHtml(review.name)}</span><span class="stars">★★★★★</span></div><p class="review-text">${escapeHtml(review.text)}</p></article>`).join('')}</div></section>`;
}

function renderModal() { return `<div id="modal" class="modal"><div class="modal-content"><div class="modal-header"><h3 id="modalTitle"></h3><button class="close-modal" aria-label="Fechar">×</button></div><div class="modal-body"><div id="modalGallery" class="equipment-gallery"></div><p id="modalDescription" class="equipment-description"></p></div></div></div>`; }
function renderBooking() { return `<div id="bookingPopup" class="popup-overlay" aria-hidden="true"><div class="popup" role="dialog" aria-modal="true" aria-labelledby="popupServiceTitle"><button class="close-btn" aria-label="Fechar">×</button><div class="popup-header"><h2 id="popupServiceTitle">Agendar sessão</h2></div><div class="popup-body"><div class="tidycal-embed" data-path="traphouzerecords"></div></div></div></div>`; }

function renderSite() {
  document.getElementById('site').innerHTML = `<nav><a href="#home" aria-label="Início"><img src="images/Logo.png" alt="${escapeHtml(content.site.name)}" class="nav-logo"></a><ul>${visibleNav().map(item => `<li><a href="#${escapeHtml(item.id)}">${escapeHtml(item.label)}</a></li>`).join('')}</ul></nav>${renderHero()}${renderServices()}${renderEquipment()}${renderAbout()}${renderArtists()}${renderReviews()}<footer><p>© ${new Date().getFullYear()} ${escapeHtml(content.site.name)}</p><p>${escapeHtml(content.site.location)}</p></footer><button class="help-button" aria-label="Contactos">?</button><div id="helpPopup" class="help-popup"><div class="help-popup-header"><h4>Contactos</h4><button class="close-help" aria-label="Fechar">×</button></div><div class="help-content"><a href="mailto:${escapeHtml(content.site.email)}">${escapeHtml(content.site.email)}</a><a href="${escapeHtml(content.site.instagram)}" target="_blank" rel="noopener">${escapeHtml(content.site.instagramHandle)}</a><a href="https://wa.me/${escapeHtml(content.site.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a><p>${escapeHtml(content.site.hours)}</p></div></div>${renderModal()}${renderBooking()}`;
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
function closeOverlays() {
  document.querySelectorAll('.modal.active, .popup-overlay.active').forEach(element => {
    element.classList.remove('active');
    if (element.id === 'bookingPopup') element.setAttribute('aria-hidden', 'true');
  });
  document.body.style.overflow = '';
}

function bindEvents() {
  document.addEventListener('click', event => {
    const service = event.target.closest('[data-service]');
    const equipment = event.target.closest('[data-equipment]');
    if (service) openBooking(content.services[Number(service.dataset.service)]);
    if (equipment) showEquipment(Number(equipment.dataset.equipment));
    if (event.target.closest('.close-modal, .close-btn') || event.target.matches('.modal, .popup-overlay')) closeOverlays();
    if (event.target.closest('.help-button, .close-help')) document.getElementById('helpPopup').classList.toggle('active');
  });
}
function startSlides() { setInterval(() => { const slides = document.querySelectorAll('.slide'); if (!slides.length) return; slides[activeSlide].classList.remove('active'); activeSlide = (activeSlide + 1) % slides.length; slides[activeSlide].classList.add('active'); }, 5000); }

fetch('data/site.json', { cache: 'no-store' }).then(response => { if (!response.ok) throw new Error('Não foi possível carregar o conteúdo.'); return response.json(); }).then(data => { content = data; renderSite(); bindEvents(); startSlides(); const script = document.createElement('script'); script.src = 'https://asset-tidycal.b-cdn.net/js/embed.js'; script.async = true; document.body.appendChild(script); }).catch(error => { document.getElementById('site').innerHTML = `<main class="site-error">${escapeHtml(error.message)}</main>`; console.error(error); });
