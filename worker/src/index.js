const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64Url(bytes) {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlText(value) { return base64Url(encoder.encode(value)); }
function base64Text(value) { return btoa(String.fromCharCode(...encoder.encode(value))); }
function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(normalized), char => char.charCodeAt(0));
}
function decodeBase64(value) {
  const normalized = value.replace(/\s/g, '') + '='.repeat((4 - value.replace(/\s/g, '').length % 4) % 4);
  return Uint8Array.from(atob(normalized), char => char.charCodeAt(0));
}
function jsonResponse(body, status = 200, headers = {}) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=UTF-8', ...headers } }); }
function error(message, status = 400) { return jsonResponse({ error: message }, status); }
function inputError(message) { const caught = new Error(message); caught.status = 400; return caught; }
function allowedOrigin(request, env) {
  return request.headers.get('Origin') === env.ADMIN_ORIGIN ? env.ADMIN_ORIGIN : '';
}
function corsHeaders(request, env) {
  const origin = allowedOrigin(request, env);
  return origin ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'content-type, authorization, x-cms-csrf', 'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS', vary: 'Origin' } : {};
}
function withCors(response, request, env) {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders(request, env)).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, { status: response.status, headers });
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64Url(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}
async function signedValue(payload, env) {
  const value = base64UrlText(JSON.stringify(payload));
  return `${value}.${await hmac(value, env.SESSION_SECRET)}`;
}
async function readSignedValue(value, env) {
  if (!value) return null;
  const [encoded, signature] = value.split('.');
  if (!encoded || !signature || signature !== await hmac(encoded, env.SESSION_SECRET)) return null;
  try { const payload = JSON.parse(decoder.decode(decodeBase64Url(encoded))); return payload.exp > Math.floor(Date.now() / 1000) ? payload : null; } catch { return null; }
}
function cookie(request, name) {
  const part = (request.headers.get('Cookie') || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : '';
}
function sessionFromRequest(request, env) {
  const bearer = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  return readSignedValue(bearer || cookie(request, 'th_session'), env);
}
function secureCookie(name, value, seconds) { return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${seconds}`; }
function redirect(url, headers = {}) { return new Response(null, { status: 302, headers: { location: url, ...headers } }); }

async function github(request, path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, { ...options, headers: { accept: 'application/vnd.github+json', 'user-agent': 'trap-houze-cms', 'x-github-api-version': '2022-11-28', ...options.headers } });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub respondeu ${response.status}: ${detail.slice(0, 240)}`);
  }
  return response;
}
function pemToBuffer(pem) {
  const body = pem.replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----|-----END (?:RSA )?PRIVATE KEY-----/g, '').replace(/[^A-Za-z0-9+/=]/g, '');
  return Uint8Array.from(atob(body), char => char.charCodeAt(0));
}
async function appJwt(env) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64UrlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64UrlText(JSON.stringify({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_ID }))}`;
  const key = await crypto.subtle.importKey('pkcs8', pemToBuffer(env.GITHUB_APP_PRIVATE_KEY).buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  return `${unsigned}.${base64Url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned)))}`;
}
async function installationToken(env) {
  if (!env.GITHUB_INSTALLATION_ID) throw new Error('Falta configurar GITHUB_INSTALLATION_ID.');
  const jwt = await appJwt(env);
  const response = await github(null, `/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`, { method: 'POST', headers: { authorization: `Bearer ${jwt}` } });
  return (await response.json()).token;
}
async function contentFromGitHub(env) {
  const token = await installationToken(env);
  const response = await github(null, `/repos/${env.REPO_OWNER}/${env.REPO_NAME}/contents/${env.CONTENT_PATH}?ref=${encodeURIComponent(env.BRANCH)}`, { headers: { authorization: `Bearer ${token}` } });
  const file = await response.json();
  const raw = await fetch(file.download_url, { headers: { accept: 'application/json' } });
  if (!raw.ok) throw new Error('Não foi possível ler o conteúdo publicado.');
  return { sha: file.sha, content: await raw.json() };
}
function validContent(content) {
  return content && typeof content === 'object' && content.site && Array.isArray(content.navigation) && Array.isArray(content.hero) && Array.isArray(content.services) && Array.isArray(content.equipment);
}

async function login(request, env) {
  // Apenas no Worker local: permite validar a interface sem copiar segredos OAuth.
  if (env.LOCAL_DEV_AUTH === 'true' && new URL(request.url).hostname === '127.0.0.1') {
    const session = await signedValue({ login: 'local-test-admin', csrf: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) + 60 * 60 }, env);
    return redirect(`${env.ADMIN_ORIGIN}/admin.html#cms_session=${encodeURIComponent(session)}`);
  }
  if (!env.GITHUB_OAUTH_CLIENT_ID || !env.GITHUB_OAUTH_CLIENT_SECRET || !env.SESSION_SECRET) return error('O Worker ainda não foi configurado.', 503);
  const state = await signedValue({ exp: Math.floor(Date.now() / 1000) + 600, nonce: crypto.randomUUID() }, env);
  const callback = new URL('/auth/callback', new URL(request.url).origin).toString();
  const url = new URL('https://github.com/login/oauth/authorize');
  url.search = new URLSearchParams({ client_id: env.GITHUB_OAUTH_CLIENT_ID, redirect_uri: callback, scope: 'read:user', state });
  return redirect(url.toString(), { 'set-cookie': secureCookie('th_oauth_state', state, 600) });
}
async function callback(request, env) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  if (!state || state !== cookie(request, 'th_oauth_state') || !await readSignedValue(state, env)) return error('O pedido de entrada expirou. Tente novamente.', 401);
  const code = url.searchParams.get('code');
  if (!code) return error('O GitHub não devolveu um código de autorização.', 401);
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ client_id: env.GITHUB_OAUTH_CLIENT_ID, client_secret: env.GITHUB_OAUTH_CLIENT_SECRET, code }) });
  const token = (await tokenResponse.json()).access_token;
  if (!token) return error('Não foi possível autenticar no GitHub.', 401);
  const user = await github(null, '/user', { headers: { authorization: `Bearer ${token}` } });
  const loginName = (await user.json()).login;
  const allowed = (env.ALLOWED_GITHUB_USERS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(loginName.toLowerCase())) return error('Este utilizador não está autorizado a publicar.', 403);
  const session = await signedValue({ login: loginName, csrf: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) + 60 * 60 }, env);
  return redirect(`${env.ADMIN_ORIGIN}/admin.html#cms_session=${encodeURIComponent(session)}`);
}
async function session(request, env) {
  const value = await sessionFromRequest(request, env);
  return jsonResponse(value ? { authenticated: true, login: value.login, csrf: value.csrf } : { authenticated: false });
}

function clientDb(env) {
  if (!env.CLIENT_PORTAL_DB) throw new Error('A base da Área do Cliente ainda não está configurada.');
  return env.CLIENT_PORTAL_DB;
}
function randomId() { return crypto.randomUUID(); }
function textToBase64(bytes) { return base64Url(bytes); }
function bytesFromBase64(value) { return decodeBase64Url(value); }
async function passwordHash(password, salt = crypto.getRandomValues(new Uint8Array(16))) {
  if (typeof password !== 'string' || password.length < 10) throw inputError('A palavra-passe deve ter pelo menos 10 caracteres.');
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  // O runtime Cloudflare limita PBKDF2 a 100 000 iterações.
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return { hash: textToBase64(bits), salt: textToBase64(salt) };
}
async function passwordMatches(password, hash, salt) {
  const computed = await passwordHash(password, bytesFromBase64(salt));
  if (computed.hash.length !== hash.length) return false;
  let mismatch = 0;
  for (let index = 0; index < hash.length; index += 1) mismatch |= computed.hash.charCodeAt(index) ^ hash.charCodeAt(index);
  return mismatch === 0;
}
async function clientSession(request, env) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  const value = await readSignedValue(token, env);
  if (!value || value.role !== 'client' || !value.clientId || !value.sessionId) return null;
  const row = await clientDb(env).prepare('SELECT id FROM client_sessions WHERE id = ? AND client_id = ? AND expires_at > CURRENT_TIMESTAMP').bind(value.sessionId, value.clientId).first();
  return row ? value : null;
}
async function adminSession(request, env) {
  const user = await sessionFromRequest(request, env);
  return user?.login && user?.csrf ? user : null;
}
async function requirePortalAdmin(request, env) {
  const user = await adminSession(request, env);
  if (!user) return null;
  if (request.headers.get('Origin') !== env.ADMIN_ORIGIN) return null;
  if (!user.csrf || request.headers.get('x-cms-csrf') !== user.csrf) return null;
  return user;
}
async function portalData(clientId, env) {
  const db = clientDb(env);
  const client = await db.prepare('SELECT id, display_name AS name, username, phone, active FROM clients WHERE id = ?').bind(clientId).first();
  if (!client) return null;
  const [tracks, bookings] = await db.batch([
    db.prepare("SELECT id, title, stage, payment_status AS paymentStatus, amount_cents AS amountCents, payment_url AS paymentUrl FROM client_tracks WHERE client_id = ? ORDER BY created_at DESC").bind(clientId),
    db.prepare("SELECT id, service, starts_at AS startsAt, payment_status AS paymentStatus, amount_cents AS amountCents, payment_url AS paymentUrl FROM client_bookings WHERE client_id = ? ORDER BY starts_at DESC").bind(clientId)
  ]);
  return { client, tracks: tracks.results, bookings: bookings.results };
}
async function clientLogin(request, env) {
  let body;
  try { body = await request.json(); } catch { return error('Pedido inválido.'); }
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  const row = await clientDb(env).prepare('SELECT id, password_hash, password_salt, active FROM clients WHERE username = ? COLLATE NOCASE').bind(username).first();
  if (!row || !row.active || !await passwordMatches(password, row.password_hash, row.password_salt)) return error('Credenciais inválidas.', 401);
  const sessionId = randomId();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 8).toISOString().replace('T', ' ').replace('Z', '');
  await clientDb(env).prepare('INSERT INTO client_sessions (id, client_id, expires_at) VALUES (?, ?, ?)').bind(sessionId, row.id, expiresAt).run();
  const token = await signedValue({ role: 'client', clientId: row.id, sessionId, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8 }, env);
  return jsonResponse({ token, portal: await portalData(row.id, env) });
}
async function clientPortal(request, env) {
  const session = await clientSession(request, env);
  if (!session) return error('Inicie sessão para ver a sua área.', 401);
  const portal = await portalData(session.clientId, env);
  return portal?.client.active ? jsonResponse(portal) : error('A conta não está ativa.', 403);
}
async function clientLogout(request, env) {
  const session = await clientSession(request, env);
  if (session) await clientDb(env).prepare('DELETE FROM client_sessions WHERE id = ?').bind(session.sessionId).run();
  return jsonResponse({ ok: true });
}
async function portalAdminClients(request, env) {
  const user = await adminSession(request, env);
  if (!user) return error('Inicie sessão como administrador.', 401);
  const clients = await clientDb(env).prepare('SELECT id, display_name AS name, username, phone, active, created_at AS createdAt FROM clients ORDER BY display_name COLLATE NOCASE').all();
  return jsonResponse({ clients: clients.results });
}
async function portalAdminClient(request, env, clientId) {
  const user = await adminSession(request, env);
  if (!user) return error('Inicie sessão como administrador.', 401);
  const portal = await portalData(clientId, env);
  return portal ? jsonResponse(portal) : error('Cliente não encontrado.', 404);
}
async function portalCreateClient(request, env) {
  const admin = await requirePortalAdmin(request, env);
  if (!admin) return error('Pedido de administração não autorizado.', 403);
  let body;
  try { body = await request.json(); } catch { return error('Pedido inválido.'); }
  const name = String(body.name || '').trim();
  const username = String(body.username || '').trim().toLowerCase();
  const phone = String(body.phone || '').replace(/\D/g, '');
  if (!name || !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) return error('Nome ou utilizador inválido.');
  if (phone && !/^\d{9,15}$/.test(phone)) return error('Número de WhatsApp inválido.');
  const password = await passwordHash(String(body.password || ''));
  const id = randomId();
  try {
    await clientDb(env).prepare('INSERT INTO clients (id, display_name, username, phone, password_hash, password_salt, active) VALUES (?, ?, ?, ?, ?, ?, 1)').bind(id, name, username, phone || null, password.hash, password.salt).run();
  } catch (caught) {
    if (String(caught.message).includes('UNIQUE')) return error('Esse utilizador já existe.', 409);
    throw caught;
  }
  await clientDb(env).prepare('INSERT INTO client_audit_log (id, client_id, actor, action) VALUES (?, ?, ?, ?)').bind(randomId(), id, admin.login, 'client.created').run();
  return jsonResponse({ id, name, username, phone, active: true }, 201);
}
function cents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) throw inputError('Valor inválido.');
  return Math.round(amount * 100);
}
function paymentStatus(value) {
  if (!['pending', 'paid'].includes(value)) throw inputError('Estado de pagamento inválido.');
  return value;
}
function paymentUrl(value) {
  if (!value) return null;
  try { const url = new URL(value); if (url.protocol !== 'https:') throw new Error(); return url.toString(); } catch { throw inputError('O link de pagamento deve usar HTTPS.'); }
}
async function portalAdminMutation(request, env, resource, id) {
  const admin = await requirePortalAdmin(request, env);
  if (!admin) return error('Pedido de administração não autorizado.', 403);
  let body;
  try { body = await request.json(); } catch { return error('Pedido inválido.'); }
  const db = clientDb(env);
  if (resource === 'clients') {
    const current = await db.prepare('SELECT id FROM clients WHERE id = ?').bind(id).first();
    if (!current) return error('Cliente não encontrado.', 404);
    const name = String(body.name || '').trim();
    const phone = String(body.phone || '').replace(/\D/g, '');
    if (!name || (phone && !/^\d{9,15}$/.test(phone))) return error('Dados de cliente inválidos.');
    const active = body.active === false ? 0 : 1;
    const statements = [db.prepare('UPDATE clients SET display_name = ?, phone = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(name, phone || null, active, id)];
    if (body.password) {
      const password = await passwordHash(String(body.password));
      statements.push(db.prepare('UPDATE clients SET password_hash = ?, password_salt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(password.hash, password.salt, id));
      statements.push(db.prepare('DELETE FROM client_sessions WHERE client_id = ?').bind(id));
    }
    await db.batch(statements);
    await db.prepare('INSERT INTO client_audit_log (id, client_id, actor, action) VALUES (?, ?, ?, ?)').bind(randomId(), id, admin.login, 'client.updated').run();
    return jsonResponse(await portalData(id, env));
  }
  const isTrack = resource === 'tracks';
  const table = isTrack ? 'client_tracks' : 'client_bookings';
  const clientId = request.method === 'POST' ? id : String(body.clientId || '');
  if (request.method === 'POST') {
    const title = String((isTrack ? body.title : body.service) || '').trim();
    if (!clientId || !title) return error('Dados incompletos.');
    const itemId = randomId();
    if (isTrack) await db.prepare('INSERT INTO client_tracks (id, client_id, title, stage, payment_status, amount_cents, payment_url) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(itemId, clientId, title, ['start', 'mix', 'master'].includes(body.stage) ? body.stage : 'start', paymentStatus(body.paymentStatus || 'pending'), cents(body.amount || 0), paymentUrl(body.paymentUrl)).run();
    else await db.prepare('INSERT INTO client_bookings (id, client_id, service, starts_at, payment_status, amount_cents, payment_url) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(itemId, clientId, title, body.startsAt || null, paymentStatus(body.paymentStatus || 'pending'), cents(body.amount || 0), paymentUrl(body.paymentUrl)).run();
    await db.prepare('INSERT INTO client_audit_log (id, client_id, actor, action) VALUES (?, ?, ?, ?)').bind(randomId(), clientId, admin.login, `${resource}.created`).run();
    return jsonResponse({ id: itemId }, 201);
  }
  const item = await db.prepare(`SELECT client_id FROM ${table} WHERE id = ?`).bind(id).first();
  if (!item) return error('Registo não encontrado.', 404);
  if (request.method === 'DELETE') {
    await db.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
    await db.prepare('INSERT INTO client_audit_log (id, client_id, actor, action) VALUES (?, ?, ?, ?)').bind(randomId(), item.client_id, admin.login, `${resource}.deleted`).run();
    return jsonResponse({ ok: true });
  }
  const title = String((isTrack ? body.title : body.service) || '').trim();
  if (!title) return error('Título inválido.');
  if (isTrack) await db.prepare('UPDATE client_tracks SET title = ?, stage = ?, payment_status = ?, amount_cents = ?, payment_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(title, ['start', 'mix', 'master'].includes(body.stage) ? body.stage : 'start', paymentStatus(body.paymentStatus), cents(body.amount), paymentUrl(body.paymentUrl), id).run();
  else await db.prepare('UPDATE client_bookings SET service = ?, starts_at = ?, payment_status = ?, amount_cents = ?, payment_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(title, body.startsAt || null, paymentStatus(body.paymentStatus), cents(body.amount), paymentUrl(body.paymentUrl), id).run();
  await db.prepare('INSERT INTO client_audit_log (id, client_id, actor, action) VALUES (?, ?, ?, ?)').bind(randomId(), item.client_id, admin.login, `${resource}.updated`).run();
  return jsonResponse({ ok: true });
}
async function publish(request, env) {
  const user = await sessionFromRequest(request, env);
  if (!user) return error('Inicie sessão para publicar.', 401);
  if (request.headers.get('Origin') !== env.ADMIN_ORIGIN) return error('Origem não autorizada.', 403);
  if (!user.csrf || request.headers.get('x-cms-csrf') !== user.csrf) return error('Pedido de publicação inválido.', 403);
  let payload;
  try { payload = await request.json(); } catch { return error('Pedido inválido.'); }
  if (!validContent(payload.content)) return error('O conteúdo enviado não tem a estrutura esperada.');
  const token = await installationToken(env);
  const current = await contentFromGitHub(env);
  const response = await github(null, `/repos/${env.REPO_OWNER}/${env.REPO_NAME}/contents/${env.CONTENT_PATH}`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ message: `content: publicação por ${user.login}`, branch: env.BRANCH, sha: current.sha, content: base64Text(JSON.stringify(payload.content, null, 2) + '\n') }) });
  const result = await response.json();
  return jsonResponse({ commit: result.commit.sha });
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
      let response;
      if (url.pathname === '/health') response = jsonResponse({ ok: true });
      else if (url.pathname === '/auth/login' && request.method === 'GET') response = await login(request, env);
      else if (url.pathname === '/auth/callback' && request.method === 'GET') response = await callback(request, env);
      else if (url.pathname === '/auth/session' && request.method === 'GET') response = await session(request, env);
      else if (url.pathname === '/content' && request.method === 'GET') response = jsonResponse((await contentFromGitHub(env)).content);
      else if (url.pathname === '/publish' && request.method === 'POST') response = await publish(request, env);
      else if (url.pathname === '/client/auth/login' && request.method === 'POST') response = await clientLogin(request, env);
      else if (url.pathname === '/client/auth/logout' && request.method === 'POST') response = await clientLogout(request, env);
      else if (url.pathname === '/client/portal' && request.method === 'GET') response = await clientPortal(request, env);
      else if (url.pathname === '/client/admin/clients' && request.method === 'GET') response = await portalAdminClients(request, env);
      else if (url.pathname === '/client/admin/clients' && request.method === 'POST') response = await portalCreateClient(request, env);
      else if (/^\/client\/admin\/clients\/[0-9a-f-]{36}$/i.test(url.pathname) && request.method === 'GET') response = await portalAdminClient(request, env, url.pathname.split('/').pop());
      else {
        const match = url.pathname.match(/^\/client\/admin\/(clients|tracks|bookings)\/([0-9a-f-]{36})$/i);
        if (match && ['PATCH', 'POST', 'DELETE'].includes(request.method)) response = await portalAdminMutation(request, env, match[1], match[2]);
        else response = error('Rota não encontrada.', 404);
      }
      return withCors(response, request, env);
    } catch (caught) {
      console.error(caught);
      return withCors(error(caught.message || 'Erro inesperado.', caught.status || 500), request, env);
    }
  }
};
