async function loadData() {
  const res = await fetch('data/equipment.json');
  return await res.json();
}

async function loadMenuData() {
  const res = await fetch('data/menu.json');
  return await res.json();
}

function renderItems(container, data) {
  container.innerHTML = '';
  Object.entries(data).forEach(([key, item]) => {
    const card = document.createElement('div');
    card.className = 'admin-card';
    card.setAttribute('data-oldkey', key);

    card.innerHTML = `
      <h3>${item.title || key} <small style="opacity:.6;font-size:.8rem;">(${key})</small></h3>
      <div class="field">
        <label>Título</label>
        <input type="text" data-key="${key}" data-field="title" value="${(item.title||'').replace(/"/g,'&quot;')}">
      </div>
      <div class="field">
        <label>Descrição</label>
        <textarea rows="3" data-key="${key}" data-field="description">${item.description||''}</textarea>
      </div>
      <div class="field">
        <label>Imagens (URLs relativas)</label>
        <div class="images-list" data-key="${key}"></div>
        <button class="btn btn-sm" data-action="add-image" data-key="${key}">+ Adicionar imagem</button>
      </div>
    `;

    container.appendChild(card);

    // Insert key field at the top
    const keyField = document.createElement('div');
    keyField.className = 'field';
    keyField.innerHTML = `
      <label>Identificador (key) — único, sem espaços</label>
      <input type="text" data-key="${key}" data-field="key" value="${(key||'').replace(/\"/g,'&quot;')}">
    `;
    const firstField = card.querySelector('.field');
    if (firstField) card.insertBefore(keyField, firstField); else card.appendChild(keyField);

    const list = card.querySelector('.images-list');
    (item.images || []).forEach((url, idx) => {
      const row = document.createElement('div');
      row.className = 'image-row';
      row.setAttribute('data-index', String(idx));
      row.innerHTML = `
        <button class="btn btn-sm" title="Subir" data-action="img-up">&#9650;</button>
        <button class="btn btn-sm" title="Descer" data-action="img-down">&#9660;</button>
        <input type="text" value="${url.replace(/"/g,'&quot;')}">
        <button class="btn btn-sm" data-action="remove-image">Remover</button>
      `;
      list.appendChild(row);
    });
    // Append remove item action
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.innerHTML = `<button class="btn btn-sm" data-action="remove-item" data-key="${key}">Remover item</button>`;
    card.appendChild(actions);
  });
}

function collectData(container, original) {
  const data = {};
  const cards = Array.from(container.querySelectorAll('.admin-card'));
  for (const card of cards) {
    const oldKey = card.getAttribute('data-oldkey');
    const keyInput = card.querySelector('input[data-field="key"]');
    let key = (keyInput?.value || '').trim();
    if (!key) key = oldKey || 'item';
    key = key.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    if (data[key]) {
      alert(`Chave duplicada: ${key}. Ajusta para ser única.`);
      return original;
    }
    const title = card.querySelector('input[data-field="title"]')?.value || '';
    const description = card.querySelector('textarea[data-field="description"]')?.value || '';
    const images = Array.from(card.querySelectorAll('.images-list input')).map(i => i.value).filter(Boolean);
    data[key] = { title, description, images };
  }
  return data;
}

function download(filename, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function saveWithFileSystemAccess(text) {
  if (!('showSaveFilePicker' in window)) {
    alert('O navegador não suporta gravação direta. Use Exportar JSON.');
    return;
  }
  const handle = await window.showSaveFilePicker({
    suggestedName: 'equipment.json',
    types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
  });
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
  alert('Gravado! Substitua data/equipment.json no servidor.');
}

document.addEventListener('DOMContentLoaded', async () => {
  let original = await loadData();
  let originalMenu = await loadMenuData();
  const container = document.getElementById('items');
  const menuContainer = document.getElementById('menuItems');
  renderItems(container, original);
  if (menuContainer) renderMenuItems(menuContainer, originalMenu);

  // add/remove image rows
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    if (action === 'add-image') {
      const key = btn.getAttribute('data-key');
      const list = container.querySelector(`.images-list[data-key="${key}"]`);
      const row = document.createElement('div');
      row.className = 'image-row';
      row.innerHTML = `<input type="text" placeholder="./imagens/equipamento/nome.jpg"><button class="btn btn-sm" data-action="remove-image">Remover</button>`;
      list.appendChild(row);
    } else if (action === 'remove-image') {
      const row = btn.closest('.image-row');
      row?.remove();
    } else if (action === 'img-up' || action === 'img-down') {
      const row = btn.closest('.image-row');
      const list = row?.parentElement;
      if (!row || !list) return;
      if (action === 'img-up' && row.previousElementSibling) {
        list.insertBefore(row, row.previousElementSibling);
      }
      if (action === 'img-down' && row.nextElementSibling) {
        list.insertBefore(row.nextElementSibling, row);
      }
    } else if (action === 'remove-item') {
      const card = btn.closest('.admin-card');
      card?.remove();
    }
  });

  // import JSON
  document.getElementById('importJson').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      original = JSON.parse(text);
      renderItems(container, original);
    } catch (err) {
      alert('JSON inválido');
    }
  });

  // export JSON
  document.getElementById('downloadJson').addEventListener('click', () => {
    const data = collectData(container, original);
    download('equipment.json', JSON.stringify(data, null, 2));
  });

  // save via FS Access API (persistente)
  document.getElementById('saveFs').addEventListener('click', async () => {
    const data = collectData(container, original);
    await saveJSONWithPersist('equipment.json', JSON.stringify(data, null, 2));
  });

  // add new item
  const addBtn = document.getElementById('addItem');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const draftKeyBase = 'novo-item';
      let idx = 1;
      let newKey = draftKeyBase;
      while (original[newKey]) { newKey = `${draftKeyBase}-${idx++}`; }
      original[newKey] = { title: 'Novo Item', description: '', images: [] };
      renderItems(container, original);
    });
  }

  // ===== Menu Admin =====
  function renderMenuItems(container, data) {
    container.innerHTML = '';
    const items = Array.isArray(data?.items) ? data.items : [];
    items.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = 'admin-card';
      card.innerHTML = `
        <div class="field"><label>Label</label>
          <input type="text" data-menu-index="${idx}" data-field="label" value="${(item.label||'').replace(/\"/g,'&quot;')}">
        </div>
        <div class="field"><label>Destino (href)</label>
          <input type="text" data-menu-index="${idx}" data-field="href" value="${(item.href||'').replace(/\"/g,'&quot;')}">
        </div>
        <div class="field"><label>Identificador (id/section)</label>
          <input type="text" data-menu-index="${idx}" data-field="id" value="${(item.id||'').replace(/\"/g,'&quot;')}">
        </div>
        <div class="field"><label><input type="checkbox" data-menu-index="${idx}" data-field="visible" ${item.visible!==false?'checked':''}> Visível</label></div>
        <div class="actions">
          <button class="btn btn-sm" data-menu-action="up" data-index="${idx}">&#9650;</button>
          <button class="btn btn-sm" data-menu-action="down" data-index="${idx}">&#9660;</button>
          <button class="btn btn-sm" data-menu-action="remove" data-index="${idx}">Remover</button>
        </div>
      `;
      container.appendChild(card);
    });
  }

  function collectMenu(container, original) {
    const data = { items: [] };
    const cards = Array.from(container.querySelectorAll('.admin-card'));
    cards.forEach((card) => {
      const get = (sel) => card.querySelector(sel);
      const label = get('input[data-field="label"]')?.value || '';
      const href = get('input[data-field="href"]')?.value || '';
      const id = get('input[data-field="id"]')?.value || '';
      const visible = !!get('input[data-field="visible"]')?.checked;
      data.items.push({ label, href, id, visible });
    });
    return data;
  }

  if (menuContainer) {
    // reorder/remove menu items
    menuContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const action = btn.getAttribute('data-menu-action');
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      const items = originalMenu.items || [];
      if (action === 'remove') {
        items.splice(idx, 1);
      } else if (action === 'up' && idx > 0) {
        [items[idx-1], items[idx]] = [items[idx], items[idx-1]];
      } else if (action === 'down' && idx < items.length - 1) {
        [items[idx+1], items[idx]] = [items[idx], items[idx+1]];
      }
      originalMenu.items = items;
      renderMenuItems(menuContainer, originalMenu);
    });

    // add new menu item
    const addMenuBtn = document.getElementById('addMenuItem');
    if (addMenuBtn) addMenuBtn.addEventListener('click', () => {
      if (!originalMenu.items) originalMenu.items = [];
      originalMenu.items.push({ label: 'Novo', href: '#', id: '', visible: true });
      renderMenuItems(menuContainer, originalMenu);
    });

    // import/export menu
    const importMenu = document.getElementById('importMenu');
    if (importMenu) importMenu.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        originalMenu = JSON.parse(await file.text());
        renderMenuItems(menuContainer, originalMenu);
      } catch (err) {
        alert('Menu JSON inválido');
      }
    });
    const downloadMenu = document.getElementById('downloadMenu');
    if (downloadMenu) downloadMenu.addEventListener('click', () => {
      const data = collectMenu(menuContainer, originalMenu);
      download('menu.json', JSON.stringify(data, null, 2));
    });
    const saveMenuFs = document.getElementById('saveMenuFs');
    if (saveMenuFs) saveMenuFs.addEventListener('click', async () => {
      const data = collectMenu(menuContainer, originalMenu);
      await saveJSONWithPersist('menu.json', JSON.stringify(data, null, 2));
    });
  }
});

// ====== Permissões persistentes (IndexedDB + FS Access) ======
async function openDB() {
  return await new Promise((resolve, reject) => {
    const req = indexedDB.open('admin-store', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('fs');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveHandle(key, handle) {
  const db = await openDB();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction('fs', 'readwrite');
    tx.objectStore('fs').put(handle, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function loadHandle(key) {
  const db = await openDB();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction('fs', 'readonly');
    const req = tx.objectStore('fs').get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function ensurePermission(handle, write = true) {
  try {
    const opts = write ? { mode: 'readwrite' } : {};
    const q = await handle.queryPermission?.(opts);
    if (q === 'granted') return true;
    if (q === 'prompt') {
      const r = await handle.requestPermission?.(opts);
      return r === 'granted';
    }
    if (!q && handle.requestPermission) {
      const r = await handle.requestPermission(opts);
      return r === 'granted';
    }
    return false;
  } catch (_) {
    return false;
  }
}

async function saveJSONWithPersist(defaultFilename, jsonText) {
  if (!('showSaveFilePicker' in window) && !('showDirectoryPicker' in window)) {
    return download(defaultFilename, jsonText);
  }
  // Tenta pasta persistente
  try {
    let dir = await loadHandle('content-dir');
    if (!dir) {
      if (!window.showDirectoryPicker) throw new Error('no-dir');
      dir = await window.showDirectoryPicker();
      await saveHandle('content-dir', dir);
    }
    const ok = await ensurePermission(dir, true);
    if (!ok) throw new Error('perm-dir');
    const fileHandle = await dir.getFileHandle(defaultFilename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(jsonText);
    await writable.close();
    alert('Gravado na pasta selecionada.');
    return;
  } catch (e) {}
  // Ficheiro persistente
  try {
    let file = await loadHandle(defaultFilename + '-file');
    if (!file) {
      file = await window.showSaveFilePicker({
        suggestedName: defaultFilename,
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
      });
      await saveHandle(defaultFilename + '-file', file);
    }
    const ok = await ensurePermission(file, true);
    if (!ok) throw new Error('perm-file');
    const writable = await file.createWritable();
    await writable.write(jsonText);
    await writable.close();
    alert('Gravado no ficheiro selecionado.');
  } catch (e) {
    download(defaultFilename, jsonText);
  }
}





