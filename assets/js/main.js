// ===== MENU DINÂMICO =====
let menuData = null;
async function loadMenu() {
  try {
    const res = await fetch('data/menu.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    menuData = await res.json();
  } catch (e) {
    console.warn('Falha a carregar menu.json, usando nav existente', e);
  }
}

function renderMenu() {
  const ul = document.querySelector('nav ul');
  if (!ul || !menuData?.items) return;
  ul.innerHTML = '';
  menuData.items.forEach(item => {
    if (!item.visible) return;
    const li = document.createElement('li');
    li.setAttribute('data-section-link', item.id || '');
    const a = document.createElement('a');
    a.href = item.href || '#';
    a.textContent = item.label || item.id || '';
    li.appendChild(a);
    ul.appendChild(li);
  });

  // Controla visibilidade das secções conforme menu
  if (menuData?.items) {
    menuData.items.forEach(item => {
      const section = item.id ? document.getElementById(item.id) : null;
      if (section) section.style.display = item.visible ? 'block' : 'none';
    });
  }
}

// ========== SLIDESHOW ==========
let currentSlide = 0;
const slides = document.querySelectorAll(".slide");
function showSlide(n) {
  slides.forEach((slide) => slide.classList.remove("active"));
  currentSlide = (n + slides.length) % slides.length;
  slides[currentSlide].classList.add("active");
}
setInterval(() => showSlide(currentSlide + 1), 5000);

// ========== BOOKING ==========
function bookService(service) {
  const popup = document.getElementById("bookingPopup");
  const title = document.getElementById("popupServiceTitle");
  title.textContent = `Agendar ${service}`;
  popup.style.display = "flex";
  document.body.style.overflow = "hidden";
}
function bookServiceMixMaster() {
  const phone = "351910734914";
  const message = "Ola Trap Houze! Quero marcar Mix & Master.";
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank");
}
function closeBookingPopup() {
  const popup = document.getElementById("bookingPopup");
  popup.style.display = "none";
  document.body.style.overflow = "auto";
}
document.getElementById("bookingPopup").addEventListener("click", function (e) {
  if (e.target === this) closeBookingPopup();
});

// ========== EQUIPAMENTO MODAL ==========
let equipmentData = {};
function renderEquipmentGrid() {
  const grid = document.getElementById('equipmentGrid');
  if (!grid) return;
  grid.innerHTML = '';
  Object.entries(equipmentData).forEach(([key, item]) => {
    const el = document.createElement('div');
    el.className = 'equipment-item';
    el.setAttribute('onclick', `openModal('${key}')`);
    el.innerHTML = `
      <div class="equipment-icon">&#9733;</div>
      <h4>${(item.title||key)}</h4>
      <p>${item.images?.length ? 'Ver detalhes' : ''}</p>
    `;
    grid.appendChild(el);
  });
}

// Carrega dados do ficheiro JSON
fetch('data/equipment.json')
  .then((r) => r.json())
  .then((data) => {
    equipmentData = data || {};
    renderEquipmentGrid();
  })
  .catch((err) => { console.error('Falha ao carregar equipment.json', err); });

// Inicialização dependente do DOM
window.addEventListener('DOMContentLoaded', async () => {
  await loadMenu();
  renderMenu();
});
function openModal(type) {
  const modal = document.getElementById("equipmentModal");
  const data = equipmentData[type];
  if (!data) return;
  document.getElementById("modalTitle").textContent = data.title;
  document.getElementById("modalDescription").textContent = data.description;
  const gallery = document.getElementById("modalGallery");
  gallery.innerHTML = "";
  data.images.forEach((src) => {
    const imgEl = document.createElement("img");
    imgEl.src = src;
    imgEl.className = "equipment-image";
    imgEl.alt = data.title;
    gallery.appendChild(imgEl);
  });
  modal.classList.add("active");
  document.body.style.overflow = "hidden";
}
function closeModal() {
  document.getElementById("equipmentModal").classList.remove("active");
  document.body.style.overflow = "auto";
}
document.getElementById("equipmentModal").addEventListener("click", function (e) {
  if (e.target === this) closeModal();
});

// ========== ARTISTAS MODAL ==========
const artistsData = {
  artist1: {
    name: "MC Flow",
    genre: "Trap | Hip-Hop",
    trajectory:
      "<p>Comecou em 2020 e destacou-se na cena trap nacional, somando centenas de milhares de streams.</p>",
    testimonial:
      "<p>A Trap Houze Records elevou a qualidade do meu som e profissionalizou o meu processo.</p>",
  },
  artist2: {
    name: "Lil Trap",
    genre: "Trap | Drill",
    trajectory:
      "<p>Artista com varias colabs de peso e projetos gravados em estudios profissionais.</p>",
    testimonial:
      "<p>O ambiente e o som da Trap Houze dao vontade de criar hits atras de hits.</p>",
  },
  artist3: {
    name: "DJ Beats",
    genre: "Producer | Beatmaker",
    trajectory:
      "<p>Responsavel por producoes para diversos artistas, sempre a inovar no som.</p>",
    testimonial:
      "<p>A Trap Houze da-me as condicoes perfeitas para produzir e finalizar instrumentais de alto nivel.</p>",
  },
  artist4: {
    name: "Rapper King",
    genre: "Rap | Hip-Hop",
    trajectory:
      "<p>Nova escola com barras fortes e presenca em varios palcos nacionais.</p>",
    testimonial:
      "<p>Gravar aqui fez a diferenca na rececao do meu trabalho.</p>",
  },
  artist5: {
    name: "Producer Pro",
    genre: "Producer | Mix Engineer",
    trajectory:
      "<p>Anos de experiencia em mix e master de projetos de referencia.</p>",
    testimonial:
      "<p>Setup tecnico da Trap Houze ao nivel dos grandes estudios.</p>",
  },
  artist6: {
    name: "Artista X",
    genre: "Trap Soul | R&B",
    trajectory:
      "<p>Voz melodica com fusao de trap e R&B, com registos em estudio profissional.</p>",
    testimonial:
      "<p>A vibe do espaco ajuda-me a entrar no mood certo para gravar.</p>",
  },
};
function openArtistModal(id) {
  const data = artistsData[id];
  if (!data) return;
  document.getElementById("artistName").textContent = data.name;
  document.getElementById("artistGenre").textContent = data.genre;
  document.getElementById("artistTrajectory").innerHTML = data.trajectory;
  document.getElementById("artistTestimonial").innerHTML = data.testimonial;
  document.getElementById("artistModal").classList.add("active");
  document.body.style.overflow = "hidden";
}
function closeArtistModal() {
  document.getElementById("artistModal").classList.remove("active");
  document.body.style.overflow = "auto";
}
document.getElementById("artistModal").addEventListener("click", function (e) {
  if (e.target === this) closeArtistModal();
});

// ========== HELP POPUP ==========
function toggleHelp() {
  document.getElementById("helpPopup").classList.toggle("active");
}
document.addEventListener("click", function (e) {
  const popup = document.getElementById("helpPopup");
  const button = document.querySelector(".help-button");
  if (!popup.contains(e.target) && !button.contains(e.target)) popup.classList.remove("active");
});

// ========== SMOOTH SCROLL ==========
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute("href"));
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});
