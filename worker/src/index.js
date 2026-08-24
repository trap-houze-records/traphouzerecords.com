const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64Url(bytes) {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlText(value) { return base64Url(encoder.encode(value)); }
function base64Text(value) { return btoa(String.fromCharCode(...encoder.encode(value))); }
function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  return btoa(binary);
}
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
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }
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

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function github(request, path, options = {}) {
  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(`https://api.github.com${path}`, { ...options, headers: { accept: 'application/vnd.github+json', 'user-agent': 'trap-houze-cms', 'x-github-api-version': '2022-11-28', ...options.headers } });
    if (response.ok || ![429, 502, 503, 504].includes(response.status) || attempt === 2) break;
    await wait(350 * (attempt + 1));
  }
  if (!response.ok) {
    const detail = await response.text();
    const caught = new Error([429, 502, 503, 504].includes(response.status) ? 'O GitHub está temporariamente indisponível. Tente novamente dentro de instantes.' : `GitHub respondeu ${response.status}: ${detail.slice(0, 240)}`);
    caught.status = [429, 502, 503, 504].includes(response.status) ? 503 : response.status;
    throw caught;
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
const defaultBookingServices = [
  { id: 'studio-engineer', title: 'Sessão de Estúdio (Captação com engenheiro)', pricePerHour: 20, active: true },
  { id: 'studio-art-direction', title: 'Sessão de Estúdio (Captação com engenheiro + Direção Artística)', pricePerHour: 30, active: true },
  { id: 'studio-rental', title: 'Alugar o Estúdio', pricePerHour: 10, active: true }
];
const defaultMixMasterServices = [
  { id: 'mix', title: 'Mix', price: 50, active: true },
  { id: 'master', title: 'Master', price: 30, active: true },
  { id: 'mix-master', title: 'Mix & Master', price: 70, active: true }
];
const defaultBookingAvailability = { startsAt: '10:00', endsAt: '22:00', lunchStartsAt: '13:00', lunchEndsAt: '14:00', lunchEnabled: true, minNoticeHours: 24 };
function bookingScheduleFromContent(content) {
  const raw = content?.bookingSchedule && typeof content.bookingSchedule === 'object' ? content.bookingSchedule : {};
  const serviceRules = raw.serviceRules && typeof raw.serviceRules === 'object' ? raw.serviceRules : {};
  const blocks = Array.isArray(raw.blocks) ? raw.blocks : [];
  const validTime = value => /^([01]\d|2[0-3]):(?:00|30)$/.test(String(value || '')) ? String(value) : '';
  const rule = item => {
    const source = serviceRules[item.id] && typeof serviceRules[item.id] === 'object' ? serviceRules[item.id] : {};
    const startsAt = validTime(source.startsAt) || defaultBookingAvailability.startsAt;
    const endsAt = validTime(source.endsAt) || defaultBookingAvailability.endsAt;
    const lunchStartsAt = validTime(source.lunchStartsAt) || defaultBookingAvailability.lunchStartsAt;
    const lunchEndsAt = validTime(source.lunchEndsAt) || defaultBookingAvailability.lunchEndsAt;
    // O aluguer pode usar 00:00–00:00 como abreviatura explícita de um dia inteiro.
    // Para os restantes serviços, um intervalo que termina antes de começar continua inválido.
    const fullDay = item.id === 'studio-rental' && startsAt === '00:00' && endsAt === '00:00';
    const windowIsValid = startsAt < endsAt || fullDay;
    const availableStartsAt = windowIsValid ? startsAt : defaultBookingAvailability.startsAt;
    const availableEndsAt = windowIsValid ? endsAt : defaultBookingAvailability.endsAt;
    const lunchEnabled = source.lunchEnabled !== undefined ? source.lunchEnabled !== false : item.id !== 'studio-rental';
    const lunchIsWithinAvailability = fullDay || (lunchStartsAt < lunchEndsAt && lunchStartsAt >= availableStartsAt && lunchEndsAt <= availableEndsAt);
    return { startsAt: availableStartsAt, endsAt: availableEndsAt, fullDay, lunchStartsAt, lunchEndsAt, lunchEnabled: !fullDay && lunchEnabled && lunchIsWithinAvailability, minNoticeHours: Math.max(0, Math.min(720, Number(source.minNoticeHours ?? defaultBookingAvailability.minNoticeHours) || 0)) };
  };
  return { serviceRules: Object.fromEntries(bookingServicesFromContent(content).map(item => [item.id, rule(item)])), blocks: blocks.map((item, index) => ({ id: String(item.id || `block-${index + 1}`), date: String(item.date || ''), startsAt: validTime(item.startsAt), endsAt: validTime(item.endsAt), label: String(item.label || 'Bloqueio').trim().slice(0, 120) })).filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item.date) && item.startsAt && item.endsAt && item.endsAt > item.startsAt) };
}
function bookingServicesFromContent(content) {
  const source = Array.isArray(content?.bookingServices) && content.bookingServices.length ? content.bookingServices : defaultBookingServices;
  return source.map((item, index) => ({ id: String(item.id || `service-${index + 1}`), title: String(item.title || '').trim(), pricePerHour: Math.max(0, Number(item.pricePerHour || 0)), active: item.active !== false })).filter(item => item.title);
}
async function configuredBookingService(env, id) {
  const services = bookingServicesFromContent((await contentFromGitHub(env)).content);
  const service = services.find(item => item.id === String(id || ''));
  if (!service || !service.active) throw inputError('Este tipo de reserva não está disponível.');
  return service;
}
async function bookingConfiguration(env, id) {
  const content = (await contentFromGitHub(env)).content;
  const service = bookingServicesFromContent(content).find(item => item.id === String(id || ''));
  if (!service || !service.active) throw inputError('Este tipo de reserva não está disponível.');
  const schedule = bookingScheduleFromContent(content);
  return { service, rules: schedule.serviceRules[service.id] || defaultBookingAvailability, blocks: schedule.blocks };
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
  if (typeof password !== 'string' || password.length < 6) throw inputError('A palavra-passe deve ter pelo menos 6 caracteres.');
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
function artistProfileRow(row) {
  if (!row) return null;
  return {
    clientId: row.clientId,
    artistName: row.artistName,
    image: row.image || '',
    bio: row.bio || '',
    instagram: row.instagram || '',
    youtube: row.youtube || '',
    spotify: row.spotify || '',
    appleMusic: row.appleMusic || '',
    updatedAt: row.updatedAt
  };
}
function artistProfileUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') throw new Error();
    return url.toString();
  } catch { throw inputError('Os links do artista devem usar HTTPS.'); }
}
function artistProfileSource(artist) {
  const links = Array.isArray(artist?.links) ? artist.links : [];
  const legacy = label => links.find(item => String(item?.label || '').trim().toLowerCase() === label.toLowerCase())?.url || '';
  return {
    artistName: String(artist?.name || 'Artista').trim().slice(0, 120) || 'Artista',
    image: String(artist?.image || '').trim() || null,
    bio: String(artist?.bio || '').trim() || null,
    instagram: String(artist?.instagram || legacy('Instagram') || '').trim() || null,
    youtube: String(artist?.youtube || legacy('YouTube') || '').trim() || null,
    spotify: String(artist?.spotify || legacy('Spotify') || '').trim() || null,
    appleMusic: String(artist?.appleMusic || legacy('Apple Music') || '').trim() || null
  };
}
async function artistProfileForClient(clientId, env) {
  const db = clientDb(env);
  const existing = await db.prepare('SELECT client_id AS clientId, artist_name AS artistName, image, bio, instagram, youtube, spotify, apple_music AS appleMusic, updated_at AS updatedAt FROM artist_profiles WHERE client_id = ?').bind(clientId).first();
  if (existing) return artistProfileRow(existing);
  let artist;
  try {
    const content = (await contentFromGitHub(env)).content;
    artist = (content.artists || []).find(item => String(item?.clientId || '') === clientId);
  } catch (caught) {
    console.warn('Perfil de artista: não foi possível confirmar a associação', caught);
    return null;
  }
  if (!artist) return null;
  const source = artistProfileSource(artist);
  await db.prepare('INSERT OR IGNORE INTO artist_profiles (client_id, artist_name, image, bio, instagram, youtube, spotify, apple_music) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(clientId, source.artistName, source.image, source.bio, source.instagram, source.youtube, source.spotify, source.appleMusic).run();
  const created = await db.prepare('SELECT client_id AS clientId, artist_name AS artistName, image, bio, instagram, youtube, spotify, apple_music AS appleMusic, updated_at AS updatedAt FROM artist_profiles WHERE client_id = ?').bind(clientId).first();
  return artistProfileRow(created);
}
async function publicArtistProfiles(env) {
  const rows = await clientDb(env).prepare('SELECT client_id AS clientId, artist_name AS artistName, image, bio, instagram, youtube, spotify, apple_music AS appleMusic, updated_at AS updatedAt FROM artist_profiles').all();
  return jsonResponse({ profiles: rows.results.map(artistProfileRow) });
}
async function clientArtistProfile(request, env) {
  const session = await clientSession(request, env);
  if (!session) return error('Inicie sessão para editar o perfil.', 401);
  const current = await artistProfileForClient(session.clientId, env);
  if (!current) return error('Esta conta ainda não está associada a um artista exposto no site.', 404);
  if (request.method === 'GET') return jsonResponse(current);
  let body;
  try { body = await request.json(); } catch { return error('Pedido inválido.'); }
  const bio = String(body.bio || '').trim().slice(0, 2000) || null;
  const instagram = artistProfileUrl(body.instagram);
  const youtube = artistProfileUrl(body.youtube);
  const spotify = artistProfileUrl(body.spotify);
  const appleMusic = artistProfileUrl(body.appleMusic);
  const db = clientDb(env);
  await db.prepare('UPDATE artist_profiles SET bio = ?, instagram = ?, youtube = ?, spotify = ?, apple_music = ?, updated_at = CURRENT_TIMESTAMP WHERE client_id = ?').bind(bio, instagram, youtube, spotify, appleMusic, session.clientId).run();
  await db.prepare('INSERT INTO client_audit_log (id, client_id, actor, action) VALUES (?, ?, ?, ?)').bind(randomId(), session.clientId, `client:${session.clientId}`, 'artist_profile.updated').run();
  return jsonResponse(await artistProfileForClient(session.clientId, env));
}
async function clientArtistImage(request, env) {
  const session = await clientSession(request, env);
  if (!session) return error('Inicie sessão para atualizar a fotografia.', 401);
  const profile = await artistProfileForClient(session.clientId, env);
  if (!profile) return error('Esta conta ainda não está associada a um artista exposto no site.', 404);
  const form = await request.formData();
  const file = form.get('image');
  const allowed = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };
  if (!(file instanceof File) || !allowed[file.type]) return error('Use uma imagem JPG, PNG, WebP ou AVIF.');
  if (file.size > 5 * 1024 * 1024) return error('A imagem não pode ultrapassar 5 MB.');
  const label = profile.artistName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'artista';
  const path = `images/artists/${label}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${allowed[file.type]}`;
  const token = await installationToken(env);
  await github(null, `/repos/${env.REPO_OWNER}/${env.REPO_NAME}/contents/${path}`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ message: `media: fotografia de artista atualizada`, branch: env.BRANCH, content: bytesToBase64(new Uint8Array(await file.arrayBuffer())) }) });
  await clientDb(env).prepare('UPDATE artist_profiles SET image = ?, updated_at = CURRENT_TIMESTAMP WHERE client_id = ?').bind(path, session.clientId).run();
  await clientDb(env).prepare('INSERT INTO client_audit_log (id, client_id, actor, action) VALUES (?, ?, ?, ?)').bind(randomId(), session.clientId, `client:${session.clientId}`, 'artist_profile.image_updated').run();
  return jsonResponse(await artistProfileForClient(session.clientId, env), 201);
}
async function portalData(clientId, env) {
  const db = clientDb(env);
  const client = await db.prepare('SELECT id, display_name AS name, username, email, phone, active FROM clients WHERE id = ?').bind(clientId).first();
  if (!client) return null;
  const artistProfile = await artistProfileForClient(clientId, env);
  const [tracks, bookings, appointments, content] = await Promise.all([
    trackWorkspace(clientId, env),
    db.prepare("SELECT id, appointment_id AS appointmentId, service, starts_at AS startsAt, CASE WHEN paid_cents >= amount_cents THEN 'paid' WHEN paid_cents > 0 THEN 'partial' ELSE 'pending' END AS paymentStatus, amount_cents AS amountCents, paid_cents AS paidCents, payment_url AS paymentUrl FROM client_bookings WHERE client_id = ? ORDER BY starts_at DESC").bind(clientId).all(),
    db.prepare("SELECT id, client_id AS clientId, service, starts_at AS startsAt, ends_at AS endsAt, status, notes, CASE WHEN paid_cents >= amount_cents THEN 'paid' WHEN paid_cents > 0 THEN 'partial' ELSE 'pending' END AS paymentStatus, amount_cents AS amountCents, paid_cents AS paidCents, payment_url AS paymentUrl FROM studio_appointments WHERE client_id = ? AND status != 'cancelled' ORDER BY starts_at DESC").bind(clientId).all(),
    contentFromGitHub(env)
  ]);
  return { client, tracks, bookings: bookings.results, appointments: appointments.results, artistProfile, mixMasterServices: mixMasterServicesFromContent(content.content) };
}
async function clientLogin(request, env) {
  let body;
  try { body = await request.json(); } catch { return error('Pedido inválido.'); }
  const identity = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  const db = clientDb(env);
  let row = await db.prepare('SELECT id, password_hash, password_salt, active FROM clients WHERE username = ? COLLATE NOCASE').bind(identity).first();
  if (!row) {
    const matches = await db.prepare('SELECT id, password_hash, password_salt, active FROM clients WHERE display_name = ? COLLATE NOCASE LIMIT 2').bind(identity).all();
    if (matches.results.length > 1) return error('Existem várias contas com este nome. Use o utilizador fornecido pela Trap Houze Records.', 401);
    row = matches.results[0];
  }
  if (!row || !row.active || !await passwordMatches(password, row.password_hash, row.password_salt)) return error('Credenciais inválidas.', 401);
  const sessionId = randomId();
  const clientSessionSeconds = 60 * 60 * 24 * 30;
  const expiresAt = new Date(Date.now() + 1000 * clientSessionSeconds).toISOString().replace('T', ' ').replace('Z', '');
  await db.prepare('INSERT INTO client_sessions (id, client_id, expires_at) VALUES (?, ?, ?)').bind(sessionId, row.id, expiresAt).run();
  const token = await signedValue({ role: 'client', clientId: row.id, sessionId, exp: Math.floor(Date.now() / 1000) + clientSessionSeconds }, env);
  return jsonResponse({ token, portal: await portalData(row.id, env) });
}
async function clientPortal(request, env) {
  const session = await clientSession(request, env);
  if (!session) return error('Inicie sessão para ver a sua área.', 401);
  const portal = await portalData(session.clientId, env);
  return portal?.client.active ? jsonResponse(portal) : error('A conta não está ativa.', 403);
}
async function clientTrackRequest(request, env) {
  const session = await clientSession(request, env);
  if (!session) return error('Inicie sessão para enviar uma música.', 401);
  let body;
  try { body = await request.json(); } catch { return error('Pedido inválido.'); }
  const title = String(body.title || '').trim().slice(0, 180);
  const category = trackCategory(String(body.category || 'mix-master'));
  if (category === 'recording') return error('As gravações são adicionadas pela Trap Houze Records.', 403);
  if (!title) return error('Indique o nome da música.');
  const content = (await contentFromGitHub(env)).content;
  const service = category === 'mix-master' ? requestedMixService(content, body.requestedService, true) : null;
  const sourceTrackId = String(body.sourceTrackId || '').trim() || null;
  const db = clientDb(env);
  if (sourceTrackId) {
    const source = await clientOwnedTrack(db, session.clientId, sourceTrackId);
    if (source.category !== 'recording') return error('A origem tem de ser uma gravação tua.', 400);
  }
  const id = randomId();
  await db.prepare('INSERT INTO client_tracks (id, client_id, title, stage, category, requested_service, source_track_id, payment_status, amount_cents, paid_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)').bind(id, session.clientId, title, 'start', category, service?.id || null, sourceTrackId, 'pending', Math.round((service?.price || 0) * 100)).run();
  await db.prepare('INSERT INTO client_audit_log (id, client_id, actor, action, metadata_json) VALUES (?, ?, ?, ?, ?)').bind(randomId(), session.clientId, `client:${session.clientId}`, 'tracks.submitted', JSON.stringify({ id, category, requestedService: service?.id || null })).run();
  return jsonResponse({ id, title, category, requestedService: service?.id || null }, 201);
}
async function clientTrackVersion(request, env, trackId) {
  const session = await clientSession(request, env);
  if (!session) return error('Inicie sessão para enviar o ficheiro inicial.', 401);
  const db = clientDb(env);
  const track = await clientOwnedTrack(db, session.clientId, trackId);
  if (track.category === 'recording') return error('Os ficheiros das gravações são geridos pela Trap Houze Records.', 403);
  const existing = await db.prepare('SELECT COUNT(*) AS total FROM client_track_versions WHERE track_id = ?').bind(track.id).first();
  if (Number(existing?.total || 0) > 0) return error('As versões seguintes são geridas pela Trap Houze Records.', 403);
  const form = await request.formData();
  const version = await createTrackVersion(db, env, track, form.get('file'), form.get('label'), 'client');
  await db.prepare('INSERT INTO client_audit_log (id, client_id, actor, action) VALUES (?, ?, ?, ?)').bind(randomId(), session.clientId, `client:${session.clientId}`, 'track_version.created').run();
  return jsonResponse(version, 201);
}
async function clientTrackComment(request, env, trackId) {
  const session = await clientSession(request, env);
  if (!session) return error('Inicie sessão para comentar.', 401);
  let body;
  try { body = await request.json(); } catch { return error('Pedido inválido.'); }
  const text = String(body.body || '').trim().slice(0, 2000);
  if (!text) return error('Escreva um comentário.');
  const db = clientDb(env);
  const track = await clientOwnedTrack(db, session.clientId, trackId);
  const versionId = String(body.versionId || '').trim();
  if (!versionId || !await db.prepare('SELECT id FROM client_track_versions WHERE id = ? AND track_id = ?').bind(versionId, track.id).first()) return error('Selecione uma versão válida.', 404);
  const positionSeconds = trackCommentPosition(body.positionSeconds);
  const id = randomId();
  await db.prepare('INSERT INTO client_track_comments (id, track_id, version_id, author_type, body, position_seconds) VALUES (?, ?, ?, ?, ?, ?)').bind(id, track.id, versionId, 'client', text, positionSeconds).run();
  return jsonResponse({ id, trackId: track.id, versionId, authorType: 'client', body: text, positionSeconds }, 201);
}
async function clientTrackFile(request, env, trackId, versionId) {
  const session = await clientSession(request, env);
  if (!session) return error('Inicie sessão para descarregar ficheiros.', 401);
  const db = clientDb(env);
  await clientOwnedTrack(db, session.clientId, trackId);
  return trackFileResponse(env, db, trackId, versionId);
}
async function adminTrackVersion(request, env, trackId) {
  const admin = await requirePortalAdmin(request, env);
  if (!admin) return error('Pedido de administração não autorizado.', 403);
  const db = clientDb(env);
  const track = await db.prepare('SELECT id, client_id AS clientId, title, category FROM client_tracks WHERE id = ?').bind(trackId).first();
  if (!track) return error('Música não encontrada.', 404);
  const form = await request.formData();
  const version = await createTrackVersion(db, env, track, form.get('file'), form.get('label'), 'admin');
  await db.prepare('INSERT INTO client_audit_log (id, client_id, actor, action) VALUES (?, ?, ?, ?)').bind(randomId(), track.clientId, admin.login, 'track_version.created').run();
  return jsonResponse(version, 201);
}
async function adminTrackVersionDelete(request, env, trackId, versionId) {
  const admin = await requirePortalAdmin(request, env);
  if (!admin) return error('Pedido de administração não autorizado.', 403);
  const db = clientDb(env);
  const version = await db.prepare('SELECT v.id, v.storage_key AS storageKey, t.client_id AS clientId FROM client_track_versions v JOIN client_tracks t ON t.id = v.track_id WHERE v.id = ? AND v.track_id = ?').bind(versionId, trackId).first();
  if (!version) return error('Versão não encontrada.', 404);
  await db.batch([
    db.prepare('DELETE FROM client_track_comments WHERE version_id = ?').bind(versionId),
    db.prepare('DELETE FROM client_track_versions WHERE id = ? AND track_id = ?').bind(versionId, trackId),
    db.prepare('INSERT INTO client_audit_log (id, client_id, actor, action, metadata_json) VALUES (?, ?, ?, ?, ?)').bind(randomId(), version.clientId, admin.login, 'track_version.deleted', JSON.stringify({ trackId, versionId }))
  ]);
  try { await env.CLIENT_AUDIO?.delete(version.storageKey); } catch (caught) { console.warn('R2: metadados removidos sem apagar o objeto', caught); }
  return jsonResponse({ id: versionId, deleted: true });
}
async function adminTrackComment(request, env, trackId) {
  const admin = await requirePortalAdmin(request, env);
  if (!admin) return error('Pedido de administração não autorizado.', 403);
  let body;
  try { body = await request.json(); } catch { return error('Pedido inválido.'); }
  const text = String(body.body || '').trim().slice(0, 2000);
  if (!text) return error('Escreva um comentário.');
  const db = clientDb(env);
  const track = await db.prepare('SELECT id, client_id AS clientId FROM client_tracks WHERE id = ?').bind(trackId).first();
  if (!track) return error('Música não encontrada.', 404);
  const versionId = String(body.versionId || '').trim();
  if (!versionId || !await db.prepare('SELECT id FROM client_track_versions WHERE id = ? AND track_id = ?').bind(versionId, track.id).first()) return error('Selecione uma versão válida.', 404);
  const positionSeconds = trackCommentPosition(body.positionSeconds);
  const id = randomId();
  await db.prepare('INSERT INTO client_track_comments (id, track_id, version_id, author_type, body, position_seconds) VALUES (?, ?, ?, ?, ?, ?)').bind(id, track.id, versionId, 'admin', text, positionSeconds).run();
  return jsonResponse({ id, trackId: track.id, versionId, authorType: 'admin', body: text, positionSeconds }, 201);
}
async function adminTrackFile(request, env, trackId, versionId) {
  const admin = await adminSession(request, env);
  if (!admin) return error('Pedido de administração não autorizado.', 403);
  return trackFileResponse(env, clientDb(env), trackId, versionId);
}
async function clientAppointment(request, env, appointmentId) {
  const session = await clientSession(request, env);
  if (!session) return error('Inicie sessão para gerir a marcação.', 401);
  const db = clientDb(env);
  const current = await db.prepare("SELECT id, client_id AS clientId, service, starts_at AS startsAt, ends_at AS endsAt, status, notes, amount_cents AS amountCents, paid_cents AS paidCents, payment_status AS paymentStatus, payment_url AS paymentUrl, google_event_id AS googleEventId FROM studio_appointments WHERE id = ? AND client_id = ? AND status != 'cancelled'").bind(appointmentId, session.clientId).first();
  if (!current) return error('Marcação não encontrada.', 404);
  if (request.method === 'GET') return jsonResponse(current);
  if (request.method === 'DELETE') {
    const cancelled = { ...current, status: 'cancelled', amountCents: 0, paidCents: 0, paymentStatus: 'paid' };
    await db.batch([
      db.prepare("UPDATE studio_appointments SET status = 'cancelled', amount_cents = 0, paid_cents = 0, payment_status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(appointmentId),
      db.prepare('INSERT INTO client_audit_log (id, client_id, actor, action, metadata_json) VALUES (?, ?, ?, ?, ?)').bind(randomId(), session.clientId, `client:${session.clientId}`, 'booking.cancelled', JSON.stringify({ appointmentId }))
    ]);
    await syncAppointmentBooking(db, appointmentId, cancelled);
    try { await googleDeleteAppointment(env, cancelled); } catch (caught) { console.warn('Google Calendar: cancelamento guardado sem remover espelho', caught); }
    return jsonResponse({ id: appointmentId, status: 'cancelled', amountCents: 0, paidCents: 0 });
  }
  let body;
  try { body = await request.json(); } catch { return error('Pedido inválido.'); }
  const date = bookingDate(body.date);
  const time = bookingTime(body.time);
  const duration = Number(body.duration);
  if (!Number.isFinite(duration) || duration < 2 || duration > 10 || Math.round(duration * 2) !== duration * 2) return error('A duração deve estar entre 2 e 10 horas, em blocos de 30 minutos.');
  if (!isBookableDay(date)) return error('Só é possível agendar de terça a sábado.');
  const startsAt = `${date} ${time}`;
  const endsAt = bookingEnd(startsAt, duration);
  const content = (await contentFromGitHub(env)).content;
  const matchedService = bookingServicesFromContent(content).find(item => item.title === current.service);
  const schedule = bookingScheduleFromContent(content);
  const rules = schedule.serviceRules[matchedService?.id] || defaultBookingAvailability;
  const ruleError = bookingBlockedByRules(startsAt, endsAt, rules);
  if (ruleError) return error(ruleError, 409);
  if (lisbonInstant(startsAt).getTime() < Date.now() + rules.minNoticeHours * 3600000) return error(`Esta sessão requer pelo menos ${rules.minNoticeHours}h de antecedência.`, 409);
  if (schedule.blocks.some(item => startsAt < bookingDateTime(item.date, item.endsAt) && endsAt > bookingDateTime(item.date, item.startsAt))) return error('Este período está bloqueado pelo estúdio.', 409);
  const appointment = { ...current, startsAt, endsAt, status: 'pending', notes: String(body.notes || current.notes || '').trim().slice(0, 2000) || null };
  if (await hasAppointmentConflict(db, appointment, appointmentId)) return error('Este horário já não está disponível. Escolha outro, por favor.', 409);
  await db.batch([
    db.prepare("UPDATE studio_appointments SET starts_at = ?, ends_at = ?, status = 'pending', notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(startsAt, endsAt, appointment.notes, appointmentId),
    db.prepare('INSERT INTO client_audit_log (id, client_id, actor, action, metadata_json) VALUES (?, ?, ?, ?, ?)').bind(randomId(), session.clientId, `client:${session.clientId}`, 'booking.rescheduled', JSON.stringify({ appointmentId, startsAt, endsAt }))
  ]);
  await syncAppointmentBooking(db, appointmentId, appointment);
  let googleSynced = true;
  try { appointment.googleEventId = await googleSyncAppointment(env, db, appointment); } catch (caught) { console.warn('Google Calendar: reagendamento guardado sem espelho', caught); googleSynced = false; }
  let notificationSent = false;
  try { notificationSent = await sendBookingNotification(env, appointment, { kind: 'reagendada', clientName: (await db.prepare('SELECT display_name AS name FROM clients WHERE id = ?').bind(session.clientId).first())?.name || 'Cliente' }); } catch (caught) { console.warn('E-mail: reagendamento guardado sem notificação', caught); }
  return jsonResponse({ id: appointmentId, startsAt, endsAt, status: 'pending', googleSynced, notificationSent });
}
async function clientLogout(request, env) {
  const session = await clientSession(request, env);
  if (session) await clientDb(env).prepare('DELETE FROM client_sessions WHERE id = ?').bind(session.sessionId).run();
  return jsonResponse({ ok: true });
}
async function portalAdminClients(request, env) {
  const user = await adminSession(request, env);
  if (!user) return error('Inicie sessão como administrador.', 401);
  const clients = await clientDb(env).prepare('SELECT id, display_name AS name, username, email, phone, active, created_at AS createdAt FROM clients ORDER BY display_name COLLATE NOCASE').all();
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
  const email = clientEmail(body.email);
  const phone = String(body.phone || '').replace(/\D/g, '');
  if (!name || !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) return error('Nome ou utilizador inválido.');
  if (phone && !/^\d{9,15}$/.test(phone)) return error('Número de WhatsApp inválido.');
  const password = await passwordHash(String(body.password || ''));
  const id = randomId();
  try {
    await clientDb(env).prepare('INSERT INTO clients (id, display_name, username, email, phone, password_hash, password_salt, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)').bind(id, name, username, email, phone || null, password.hash, password.salt).run();
  } catch (caught) {
    if (String(caught.message).includes('UNIQUE')) return error('Esse utilizador ou e-mail já existe.', 409);
    throw caught;
  }
  await clientDb(env).prepare('INSERT INTO client_audit_log (id, client_id, actor, action) VALUES (?, ?, ?, ?)').bind(randomId(), id, admin.login, 'client.created').run();
  return jsonResponse({ id, name, username, email, phone, active: true }, 201);
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
function mixMasterServicesFromContent(content) {
  const source = Array.isArray(content?.mixMasterServices) && content.mixMasterServices.length ? content.mixMasterServices : defaultMixMasterServices;
  return source.map((item, index) => ({ id: String(item.id || `mix-service-${index + 1}`), title: String(item.title || '').trim(), price: Math.max(0, Number(item.price || 0)), active: item.active !== false })).filter(item => item.title);
}
function paymentDetails(amount, paidAmount, legacyStatus = 'pending') {
  const amountCents = cents(amount || 0);
  const hasPaidAmount = paidAmount !== undefined && paidAmount !== null && String(paidAmount).trim() !== '';
  const paidCents = hasPaidAmount ? cents(paidAmount) : legacyStatus === 'paid' ? amountCents : 0;
  if (paidCents > amountCents) throw inputError('O montante recebido não pode ser superior ao valor total.');
  return { amountCents, paidCents, paymentStatus: paidCents >= amountCents ? 'paid' : 'pending' };
}
function paymentUrl(value) {
  if (!value) return null;
  try { const url = new URL(value); if (url.protocol !== 'https:') throw new Error(); return url.toString(); } catch { throw inputError('O link de pagamento deve usar HTTPS.'); }
}
function clientEmail(value, required = false) {
  const email = String(value || '').trim().toLowerCase();
  if (!email && !required) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw inputError(required ? 'Indique um e-mail válido para o novo cliente.' : 'E-mail inválido.');
  return email;
}
function samplyPlayerUrl(value) {
  if (!value) return null;
  try {
    const raw = String(value).trim();
    const source = raw.match(/<iframe[^>]+src=['"]([^'"]+)['"]/i)?.[1] || raw;
    const url = new URL(source);
    if (url.protocol !== 'https:' || !['samply.app', 'www.samply.app'].includes(url.hostname) || !/^\/embed\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) throw new Error();
    return url.toString();
  } catch { throw inputError('Use o link de embed do Samply (https://samply.app/embed/…).'); }
}
function trackCategory(value) {
  if (!['mix-master', 'recording'].includes(value)) throw inputError('Tipo de música inválido.');
  return value;
}
function requestedMixService(content, value, required = false) {
  const id = String(value || '').trim();
  if (!id && !required) return null;
  const service = mixMasterServicesFromContent(content).find(item => item.id === id && item.active);
  if (!service) throw inputError('Selecione um serviço de Mix & Master disponível.');
  return service;
}
function safeAudioFile(file) {
  const allowed = new Set(['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/flac', 'audio/mp4', 'audio/aac', 'audio/ogg']);
  if (!(file instanceof File) || (!allowed.has(file.type) && !/\.(mp3|wav|flac|m4a|aac|ogg)$/i.test(file.name || ''))) throw inputError('Envie um ficheiro de áudio MP3, WAV, FLAC, M4A, AAC ou OGG.');
  if (file.size < 1 || file.size > 100 * 1024 * 1024) throw inputError('O áudio deve ter no máximo 100 MB.');
  return file;
}
function audioExtension(file) {
  const match = String(file.name || '').match(/\.([a-z0-9]{2,5})$/i);
  return match ? match[1].toLowerCase() : ({ 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/flac': 'flac', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg' }[file.type] || 'audio');
}
function trackCommentPosition(value) {
  const seconds = Math.floor(Number(value || 0));
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 24 * 60 * 60) throw inputError('O momento do comentário é inválido.');
  return seconds;
}
async function trackWorkspace(clientId, env) {
  const db = clientDb(env);
  const [tracks, versions, comments] = await db.batch([
    db.prepare("SELECT id, title, stage, category, requested_service AS requestedService, source_track_id AS sourceTrackId, CASE WHEN paid_cents >= amount_cents THEN 'paid' WHEN paid_cents > 0 THEN 'partial' ELSE 'pending' END AS paymentStatus, amount_cents AS amountCents, paid_cents AS paidCents, payment_url AS paymentUrl, samply_url AS samplyUrl, created_at AS createdAt FROM client_tracks WHERE client_id = ? ORDER BY created_at DESC").bind(clientId),
    db.prepare('SELECT v.id, v.track_id AS trackId, v.label, v.original_name AS originalName, v.mime_type AS mimeType, v.size_bytes AS sizeBytes, v.created_by AS createdBy, v.created_at AS createdAt FROM client_track_versions v JOIN client_tracks t ON t.id = v.track_id WHERE t.client_id = ? ORDER BY v.created_at DESC').bind(clientId),
    db.prepare('SELECT c.id, c.track_id AS trackId, c.version_id AS versionId, c.author_type AS authorType, c.body, c.position_seconds AS positionSeconds, c.created_at AS createdAt FROM client_track_comments c JOIN client_tracks t ON t.id = c.track_id WHERE t.client_id = ? ORDER BY c.created_at ASC').bind(clientId)
  ]);
  const versionsByTrack = new Map();
  for (const version of versions.results) versionsByTrack.set(version.trackId, [...(versionsByTrack.get(version.trackId) || []), version]);
  const commentsByTrack = new Map();
  for (const comment of comments.results) commentsByTrack.set(comment.trackId, [...(commentsByTrack.get(comment.trackId) || []), comment]);
  return tracks.results.map(track => ({ ...track, versions: versionsByTrack.get(track.id) || [], comments: commentsByTrack.get(track.id) || [] }));
}
async function clientOwnedTrack(db, clientId, trackId) {
  const track = await db.prepare('SELECT id, client_id AS clientId, title, category FROM client_tracks WHERE id = ? AND client_id = ?').bind(trackId, clientId).first();
  if (!track) throw inputError('Música não encontrada.');
  return track;
}
async function createTrackVersion(db, env, track, file, label, actor) {
  safeAudioFile(file);
  if (!env.CLIENT_AUDIO) throw new Error('O armazenamento de áudio ainda não foi configurado.');
  const id = randomId();
  const key = `clients/${track.clientId}/${track.id}/${id}.${audioExtension(file)}`;
  await env.CLIENT_AUDIO.put(key, file.stream(), { httpMetadata: { contentType: file.type || 'audio/mpeg', contentDisposition: `attachment; filename="${String(file.name || 'audio').replace(/["\\]/g, '')}"` } });
  await db.prepare('INSERT INTO client_track_versions (id, track_id, label, storage_key, original_name, mime_type, size_bytes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, track.id, String(label || 'Nova versão').trim().slice(0, 120) || 'Nova versão', key, String(file.name || 'audio').slice(0, 240), file.type || 'audio/mpeg', file.size, actor).run();
  return { id, trackId: track.id, label: String(label || 'Nova versão').trim().slice(0, 120) || 'Nova versão', originalName: String(file.name || 'audio'), mimeType: file.type || 'audio/mpeg', sizeBytes: file.size, createdBy: actor };
}
async function trackFileResponse(env, db, trackId, versionId) {
  const version = await db.prepare('SELECT id, storage_key AS storageKey, original_name AS originalName, mime_type AS mimeType FROM client_track_versions WHERE id = ? AND track_id = ?').bind(versionId, trackId).first();
  if (!version) return error('Versão não encontrada.', 404);
  const object = await env.CLIENT_AUDIO?.get(version.storageKey);
  if (!object) return error('Ficheiro não encontrado.', 404);
  return new Response(object.body, { headers: { 'content-type': version.mimeType || object.httpMetadata?.contentType || 'audio/mpeg', 'content-length': String(object.size), 'content-disposition': `attachment; filename="${String(version.originalName).replace(/["\\]/g, '')}"`, 'cache-control': 'private, max-age=300' } });
}
function appointmentDate(value, label) {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) throw inputError(`${label} inválida.`);
  return date.toISOString().slice(0, 16).replace('T', ' ');
}
function appointmentStatus(value) {
  if (!['pending', 'confirmed', 'cancelled'].includes(value)) throw inputError('Estado da marcação inválido.');
  return value;
}
async function appointmentPayload(body, db) {
  let clientId = String(body.clientId || '').trim() || null;
  // A Agenda usa clientName/clientEmail; os pedidos públicos usam guestName/guestEmail.
  // Aceitar ambos impede que uma marcação criada pelo admin perca o contacto.
  const guestName = String(body.guestName || body.clientName || '').trim() || null;
  const guestEmail = clientEmail(body.guestEmail || body.clientEmail || body.email, !clientId);
  const service = String(body.service || '').trim();
  const startsAt = appointmentDate(body.startsAt, 'Data de início');
  const endsAt = appointmentDate(body.endsAt, 'Data de fim');
  const status = appointmentStatus(body.status || 'confirmed');
  const notes = String(body.notes || '').trim().slice(0, 2000) || null;
  if (!service || (!clientId && !guestName)) throw inputError('Indique o serviço e o cliente.');
  if (endsAt <= startsAt) throw inputError('A hora de fim deve ser posterior à hora de início.');
  if (clientId && !await db.prepare('SELECT id FROM clients WHERE id = ?').bind(clientId).first()) throw inputError('Cliente não encontrado.');
  let newClient = null;
  if (!clientId) {
    const existing = await db.prepare('SELECT id FROM clients WHERE email = ? COLLATE NOCASE LIMIT 1').bind(guestEmail).first();
    if (existing) clientId = existing.id;
    else newClient = { name: guestName, email: guestEmail };
  }
  const payment = status === 'cancelled' ? { amountCents: 0, paidCents: 0, paymentStatus: 'paid' } : paymentDetails(body.amount, body.paidAmount, paymentStatus(body.paymentStatus || 'pending'));
  return { clientId, guestName: clientId ? null : guestName, guestPhone: null, guestEmail: clientId ? null : guestEmail, newClient, service, startsAt, endsAt, status, notes, ...payment, paymentUrl: paymentUrl(body.paymentUrl) };
}
async function appointmentClient(db, appointment) {
  if (!appointment.newClient) return appointment;
  const existing = await db.prepare('SELECT id FROM clients WHERE email = ? COLLATE NOCASE LIMIT 1').bind(appointment.newClient.email).first();
  if (existing) return { ...appointment, clientId: existing.id, guestName: null, guestEmail: null, newClient: null };
  const base = appointment.newClient.email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 42) || 'cliente';
  let username = `cliente-${base}`.slice(0, 60);
  for (let attempt = 0; await db.prepare('SELECT id FROM clients WHERE username = ? COLLATE NOCASE').bind(username).first(); attempt += 1) username = `cliente-${base.slice(0, 46)}-${crypto.randomUUID().slice(0, 6)}`;
  const password = await passwordHash(crypto.randomUUID());
  const id = randomId();
  await db.prepare('INSERT INTO clients (id, display_name, username, email, password_hash, password_salt, active) VALUES (?, ?, ?, ?, ?, ?, 0)').bind(id, appointment.newClient.name, username, appointment.newClient.email, password.hash, password.salt).run();
  return { ...appointment, clientId: id, guestName: null, guestEmail: null, newClient: null, clientCreated: true };
}
async function syncAppointmentBooking(db, appointmentId, appointment) {
  const linked = await db.prepare('SELECT id FROM client_bookings WHERE appointment_id = ?').bind(appointmentId).first();
  if (!appointment.clientId) {
    if (linked) await db.prepare('DELETE FROM client_bookings WHERE id = ?').bind(linked.id).run();
    return;
  }
  const values = [appointment.clientId, appointment.service, appointment.startsAt, appointment.paymentStatus, appointment.amountCents, Number(appointment.paidCents || 0), appointment.paymentUrl];
  if (linked) {
    await db.prepare('UPDATE client_bookings SET client_id = ?, service = ?, starts_at = ?, payment_status = ?, amount_cents = ?, paid_cents = ?, payment_url = ?, updated_at = CURRENT_TIMESTAMP WHERE appointment_id = ?').bind(...values, appointmentId).run();
    return;
  }
  const legacy = await db.prepare('SELECT id FROM client_bookings WHERE appointment_id IS NULL AND client_id = ? AND service = ? AND starts_at = ? LIMIT 1').bind(appointment.clientId, appointment.service, appointment.startsAt).first();
  if (legacy) {
    await db.prepare('UPDATE client_bookings SET appointment_id = ?, payment_status = ?, amount_cents = ?, paid_cents = ?, payment_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(appointmentId, appointment.paymentStatus, appointment.amountCents, Number(appointment.paidCents || 0), appointment.paymentUrl, legacy.id).run();
    return;
  }
  await db.prepare('INSERT INTO client_bookings (id, client_id, appointment_id, service, starts_at, payment_status, amount_cents, paid_cents, payment_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(randomId(), appointment.clientId, appointmentId, appointment.service, appointment.startsAt, appointment.paymentStatus, appointment.amountCents, Number(appointment.paidCents || 0), appointment.paymentUrl).run();
}
async function hasAppointmentConflict(db, appointment, excludeId = '') {
  if (appointment.status === 'cancelled') return false;
  const row = await db.prepare("SELECT id FROM studio_appointments WHERE status != 'cancelled' AND starts_at < ? AND ends_at > ? AND id != ? LIMIT 1").bind(appointment.endsAt, appointment.startsAt, excludeId).first();
  return Boolean(row);
}
function googleServiceConfigured(env) { return Boolean(env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY && env.GOOGLE_CALENDAR_DEFAULT_ID); }
function googleOAuthConfigured(env) { return Boolean(env.GOOGLE_CALENDAR_CLIENT_ID && env.GOOGLE_CALENDAR_CLIENT_SECRET && env.GOOGLE_CALENDAR_TOKEN_KEY); }
function googleCalendarConfigured(env) { return googleServiceConfigured(env) || googleOAuthConfigured(env); }
async function googleCryptoKey(env) {
  if (!env.GOOGLE_CALENDAR_TOKEN_KEY) throw new Error('Falta configurar GOOGLE_CALENDAR_TOKEN_KEY.');
  const material = await crypto.subtle.digest('SHA-256', encoder.encode(env.GOOGLE_CALENDAR_TOKEN_KEY));
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
async function sealGoogleToken(value, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await googleCryptoKey(env), encoder.encode(value));
  return `${base64Url(iv)}.${base64Url(encrypted)}`;
}
async function openGoogleToken(value, env) {
  const [iv, encrypted] = String(value || '').split('.');
  if (!iv || !encrypted) throw new Error('A ligação Google Calendar guardada é inválida.');
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBase64Url(iv) }, await googleCryptoKey(env), decodeBase64Url(encrypted));
  return decoder.decode(bytes);
}
async function googleConnection(env) {
  const row = await clientDb(env).prepare('SELECT calendar_id AS calendarId, calendar_name AS calendarName, access_token AS accessToken, refresh_token AS refreshToken, expires_at AS expiresAt FROM google_calendar_connection WHERE id = 1').first();
  if (!row) return null;
  return { ...row, accessToken: await openGoogleToken(row.accessToken, env), refreshToken: await openGoogleToken(row.refreshToken, env) };
}
async function storeGoogleConnection(env, connection) {
  const db = clientDb(env);
  await db.prepare('INSERT INTO google_calendar_connection (id, calendar_id, calendar_name, access_token, refresh_token, expires_at, updated_at) VALUES (1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET calendar_id = excluded.calendar_id, calendar_name = excluded.calendar_name, access_token = excluded.access_token, refresh_token = excluded.refresh_token, expires_at = excluded.expires_at, updated_at = CURRENT_TIMESTAMP').bind(connection.calendarId || null, connection.calendarName || null, await sealGoogleToken(connection.accessToken, env), await sealGoogleToken(connection.refreshToken, env), connection.expiresAt).run();
}
async function refreshGoogleConnection(env, current) {
  const body = new URLSearchParams({ client_id: env.GOOGLE_CALENDAR_CLIENT_ID, client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET, refresh_token: current.refreshToken, grant_type: 'refresh_token' });
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) throw new Error('Não foi possível atualizar a ligação ao Google Calendar.');
  const refreshed = { ...current, accessToken: payload.access_token, refreshToken: payload.refresh_token || current.refreshToken, expiresAt: new Date(Date.now() + Number(payload.expires_in || 3600) * 1000).toISOString() };
  await storeGoogleConnection(env, refreshed);
  return refreshed;
}
async function financeSummary(request, env) {
  const admin = await adminSession(request, env);
  if (!admin) return error('Pedido de administração não autorizado.', 403);
  const db = clientDb(env);
  const records = await db.prepare(`
    SELECT t.id, t.client_id AS clientId, c.display_name AS clientName, 'track' AS type, t.title AS description, t.stage, CASE WHEN t.paid_cents >= t.amount_cents THEN 'paid' WHEN t.paid_cents > 0 THEN 'partial' ELSE 'pending' END AS paymentStatus, t.amount_cents AS amountCents, t.paid_cents AS paidCents, t.payment_url AS paymentUrl, t.created_at AS createdAt
    FROM client_tracks t JOIN clients c ON c.id = t.client_id
    UNION ALL
    SELECT a.id, COALESCE(a.client_id, 'guest:' || a.id) AS clientId, COALESCE(c.display_name, a.guest_name, 'Cliente') AS clientName, 'appointment' AS type, a.service AS description, NULL AS stage, CASE WHEN a.paid_cents >= a.amount_cents THEN 'paid' WHEN a.paid_cents > 0 THEN 'partial' ELSE 'pending' END AS paymentStatus, a.amount_cents AS amountCents, a.paid_cents AS paidCents, a.payment_url AS paymentUrl, a.starts_at AS createdAt
    FROM studio_appointments a LEFT JOIN clients c ON c.id = a.client_id
    WHERE a.status != 'cancelled'
    UNION ALL
    SELECT b.id, b.client_id AS clientId, c.display_name AS clientName, 'booking' AS type, b.service AS description, NULL AS stage, CASE WHEN b.paid_cents >= b.amount_cents THEN 'paid' WHEN b.paid_cents > 0 THEN 'partial' ELSE 'pending' END AS paymentStatus, b.amount_cents AS amountCents, b.paid_cents AS paidCents, b.payment_url AS paymentUrl, COALESCE(b.starts_at, b.created_at) AS createdAt
    FROM client_bookings b JOIN clients c ON c.id = b.client_id
    WHERE b.appointment_id IS NULL
    ORDER BY createdAt DESC
  `).all();
  const items = (records.results || []).map(item => ({ ...item, paidCents: Math.min(Number(item.amountCents || 0), Number(item.paidCents || 0)), outstandingCents: Math.max(0, Number(item.amountCents || 0) - Number(item.paidCents || 0)) }));
  const totals = items.reduce((summary, item) => {
    const amount = Number(item.amountCents || 0);
    summary.total += amount;
    summary.paid += item.paidCents;
    summary.pending += item.outstandingCents;
    if (item.outstandingCents > 0) summary.pendingCount += 1;
    return summary;
  }, { total: 0, paid: 0, pending: 0, pendingCount: 0 });
  const byClient = new Map();
  items.forEach(item => {
    const entry = byClient.get(item.clientId) || { clientId: item.clientId, clientName: item.clientName, paid: 0, pending: 0, items: 0 };
    entry.items += 1;
    entry.paid += item.paidCents;
    entry.pending += item.outstandingCents;
    byClient.set(item.clientId, entry);
  });
  return jsonResponse({ totals, items, clients: [...byClient.values()].sort((a, b) => b.pending - a.pending || b.paid - a.paid) });
}
async function dashboardSummary(request, env) {
  const admin = await adminSession(request, env);
  if (!admin) return error('Pedido de administração não autorizado.', 403);
  const db = clientDb(env);
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const today = now.toISOString().slice(0, 10);
  const [clients, finance, appointments, upcoming, activity] = await db.batch([
    db.prepare('SELECT COUNT(*) AS count FROM clients WHERE active = 1'),
    db.prepare(`SELECT COALESCE(SUM(paid_cents), 0) AS paid, COALESCE(SUM(amount_cents - paid_cents), 0) AS pending FROM (SELECT amount_cents, paid_cents FROM client_tracks WHERE substr(created_at, 1, 7) = ? UNION ALL SELECT amount_cents, paid_cents FROM studio_appointments WHERE status != 'cancelled' AND substr(starts_at, 1, 7) = ? UNION ALL SELECT amount_cents, paid_cents FROM client_bookings WHERE appointment_id IS NULL AND substr(COALESCE(starts_at, created_at), 1, 7) = ?)` ).bind(month, month, month),
    db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM((julianday(ends_at) - julianday(starts_at)) * 24), 0) AS hours FROM studio_appointments WHERE status != 'cancelled' AND substr(starts_at, 1, 7) = ?").bind(month),
    db.prepare("SELECT a.id, COALESCE(c.display_name, a.guest_name, 'Cliente') AS clientName, a.service, a.starts_at AS startsAt, a.ends_at AS endsAt, a.status FROM studio_appointments a LEFT JOIN clients c ON c.id = a.client_id WHERE a.status != 'cancelled' AND a.starts_at >= ? ORDER BY a.starts_at ASC LIMIT 5").bind(`${today} 00:00`),
    db.prepare("SELECT l.action, l.created_at AS createdAt, COALESCE(c.display_name, 'Cliente removido') AS clientName FROM client_audit_log l LEFT JOIN clients c ON c.id = l.client_id ORDER BY l.created_at DESC LIMIT 6")
  ]);
  return jsonResponse({ month, clients: Number(clients.results[0]?.count || 0), finance: finance.results[0] || { paid: 0, pending: 0 }, appointments: appointments.results[0] || { count: 0, hours: 0 }, upcoming: upcoming.results || [], activity: activity.results || [] });
}
async function googleServiceAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64UrlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64UrlText(JSON.stringify({ iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, scope: 'https://www.googleapis.com/auth/calendar', aud: 'https://oauth2.googleapis.com/token', iat: now - 30, exp: now + 3300 }))}`;
  const privateKey = String(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY).replace(/\\n/g, '\n');
  const key = await crypto.subtle.importKey('pkcs8', pemToBuffer(privateKey).buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const assertion = `${unsigned}.${base64Url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned)))}`;
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) throw new Error(payload?.error_description || 'Não foi possível autenticar a conta de serviço Google.');
  return payload.access_token;
}
async function activeGoogleConnection(env) {
  if (googleServiceConfigured(env)) return { calendarId: env.GOOGLE_CALENDAR_DEFAULT_ID, calendarName: env.GOOGLE_CALENDAR_DEFAULT_NAME || 'Booking', serviceAccount: true };
  return googleConnection(env);
}
async function googleApi(env, path, options = {}) {
  let connection = await activeGoogleConnection(env);
  if (!connection) throw new Error('Ligue primeiro o Google Calendar no painel de administração.');
  const accessToken = connection.serviceAccount ? await googleServiceAccessToken(env) : (new Date(connection.expiresAt).getTime() < Date.now() + 60000 ? (connection = await refreshGoogleConnection(env, connection)).accessToken : connection.accessToken);
  const response = await fetch(`https://www.googleapis.com/calendar/v3/${path}`, { ...options, headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json', ...options.headers } });
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || 'O Google Calendar não respondeu como esperado.');
  return { connection, payload };
}
function googleDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).reduce((all, part) => ({ ...all, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
function googleEventDateTime(value) {
  const normalized = String(value || '').replace(' ', 'T');
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized) ? `${normalized}:00` : normalized;
}
async function googleBusyEvents(env, from, until) {
  let connection;
  try { connection = await activeGoogleConnection(env); } catch { return []; }
  if (!connection?.calendarId) return [];
  const fromDay = String(from).slice(0, 10);
  const untilDay = String(until).slice(0, 10);
  const query = new URLSearchParams({ timeMin: new Date(`${fromDay}T00:00:00+01:00`).toISOString(), timeMax: new Date(`${untilDay}T00:00:00+01:00`).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '2500' });
  const { payload } = await googleApi(env, `calendars/${encodeURIComponent(connection.calendarId)}/events?${query}`);
  return (payload.items || []).filter(item => item.status !== 'cancelled' && item.transparency !== 'transparent' && item.start?.dateTime && item.end?.dateTime).map(item => {
    const startsAt = googleDateTime(item.start.dateTime);
    const endsAt = googleDateTime(item.end.dateTime);
    return startsAt && endsAt ? { id: item.id, startsAt, endsAt, title: item.summary || 'Evento Google Calendar' } : null;
  }).filter(Boolean);
}
async function googleSyncAppointment(env, db, appointment) {
  let connection;
  try { connection = await activeGoogleConnection(env); } catch { return appointment.googleEventId || null; }
  if (!connection?.calendarId || appointment.status === 'cancelled') return appointment.googleEventId || null;
  const client = appointment.clientId ? await db.prepare('SELECT display_name AS name, phone FROM clients WHERE id = ?').bind(appointment.clientId).first() : null;
  const name = client?.name || appointment.guestName || 'Cliente';
  const event = { summary: `🎧 ${appointment.service} — ${name}`, description: `Reserva Trap Houze Records\nCliente: ${name}${client?.phone || appointment.guestPhone ? `\nWhatsApp: ${client?.phone || appointment.guestPhone}` : ''}${appointment.guestEmail ? `\nE-mail: ${appointment.guestEmail}` : ''}${appointment.notes ? `\nNotas: ${appointment.notes}` : ''}\nEstado: ${appointment.status}`, location: 'Trap Houze Records', start: { dateTime: googleEventDateTime(appointment.startsAt), timeZone: 'Europe/Lisbon' }, end: { dateTime: googleEventDateTime(appointment.endsAt), timeZone: 'Europe/Lisbon' } };
  const id = appointment.googleEventId;
  const result = await googleApi(env, `calendars/${encodeURIComponent(connection.calendarId)}/events${id ? `/${encodeURIComponent(id)}` : ''}`, { method: id ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) });
  const googleEventId = result.payload.id;
  await db.prepare('UPDATE studio_appointments SET google_event_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(googleEventId, appointment.id).run();
  return googleEventId;
}
async function googleDeleteAppointment(env, appointment) {
  if (!appointment.googleEventId) return;
  try {
    const connection = await activeGoogleConnection(env);
    if (connection?.calendarId) await googleApi(env, `calendars/${encodeURIComponent(connection.calendarId)}/events/${encodeURIComponent(appointment.googleEventId)}`, { method: 'DELETE' });
  } catch (caught) { console.warn('Google Calendar: não foi possível apagar evento', caught); }
}
function bookingNotificationTime(value) {
  const [date = '', clock = ''] = String(value || '').split(' ');
  const [year = '', month = '', day = ''] = date.split('-');
  return year && month && day && clock ? `${day}/${month}/${year} · ${clock}` : String(value || '—');
}
async function sendBookingNotification(env, appointment, { kind = 'nova', clientName = '', clientEmail = '' } = {}) {
  const apiKey = String(env.RESEND_API_KEY || '').trim();
  const recipient = String(env.BOOKING_NOTIFICATION_EMAIL || '').trim();
  const sender = String(env.BOOKING_NOTIFICATION_FROM || '').trim();
  if (!apiKey || !recipient || !sender) return false;
  const name = clientName || appointment.guestName || 'Cliente';
  const label = kind === 'reagendada' ? 'Reserva reagendada' : 'Nova reserva';
  const period = `${bookingNotificationTime(appointment.startsAt)} — ${String(appointment.endsAt || '').slice(11, 16)}`;
  const lines = [
    label,
    '',
    `Cliente: ${name}`,
    clientEmail || appointment.guestEmail ? `E-mail: ${clientEmail || appointment.guestEmail}` : '',
    `Sessão: ${appointment.service}`,
    `Horário: ${period}`,
    `Estado: ${appointment.status === 'confirmed' ? 'Confirmada' : 'Pendente'}`,
    appointment.notes ? `Notas: ${appointment.notes}` : ''
  ].filter(Boolean);
  const details = lines.slice(2).map(line => `<p style="margin:0 0 9px">${escapeHtml(line)}</p>`).join('');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: sender,
      to: [recipient],
      subject: `${label} — ${name}`,
      text: lines.join('\n'),
      html: `<div style="background:#111;color:#fff;font-family:Arial,sans-serif;padding:28px"><p style="color:#16c7f3;font-size:12px;letter-spacing:1.6px;margin:0 0 12px;text-transform:uppercase">Trap Houze Records</p><h1 style="font-size:24px;margin:0 0 22px">${escapeHtml(label)}</h1>${details}<p style="border-top:1px solid #3a3a3a;color:#aaa;font-size:12px;margin:22px 0 0;padding-top:16px">Enviado automaticamente pela agenda Trap Houze.</p></div>`
    })
  });
  if (!response.ok) throw new Error(`Resend respondeu ${response.status}: ${(await response.text()).slice(0, 180)}`);
  return true;
}
async function googleCalendarStatus(request, env) {
  const admin = await adminSession(request, env);
  if (!admin) return error('Pedido de administração não autorizado.', 403);
  if (!googleCalendarConfigured(env)) return jsonResponse({ configured: false, connected: false });
  const connection = await activeGoogleConnection(env);
  return jsonResponse({ configured: true, connected: Boolean(connection), calendarId: connection?.calendarId || '', calendarName: connection?.calendarName || '', serviceAccount: Boolean(connection?.serviceAccount) });
}
async function googleCalendarConnect(request, env) {
  const admin = await requirePortalAdmin(request, env);
  if (!admin) return error('Pedido de administração não autorizado.', 403);
  if (googleServiceConfigured(env)) return jsonResponse({ connected: true, message: 'A agenda Booking está ligada através da conta de serviço.' });
  if (!googleCalendarConfigured(env)) return error('A ligação Google Calendar ainda não foi configurada no Worker.', 503);
  const redirectUri = new URL('/google-calendar/callback', request.url).toString();
  const state = await signedValue({ role: 'google-calendar', exp: Math.floor(Date.now() / 1000) + 600 }, env);
  const authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorize.search = new URLSearchParams({ client_id: env.GOOGLE_CALENDAR_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: 'https://www.googleapis.com/auth/calendar', access_type: 'offline', prompt: 'consent', state });
  return jsonResponse({ url: authorize.toString() });
}
async function googleCalendarCallback(request, env) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  if (!state || !(await readSignedValue(state, env))?.role?.includes('google-calendar')) return error('A ligação ao Google Calendar expirou. Tente novamente.', 401);
  const code = url.searchParams.get('code');
  if (!code) return error('O Google não devolveu um código de ligação.', 401);
  const redirectUri = new URL('/google-calendar/callback', request.url).toString();
  const body = new URLSearchParams({ code, client_id: env.GOOGLE_CALENDAR_CLIENT_ID, client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const payload = await response.json();
  if (!response.ok || !payload.access_token || !payload.refresh_token) return error('Não foi possível concluir a ligação ao Google Calendar.', 401);
  await storeGoogleConnection(env, { accessToken: payload.access_token, refreshToken: payload.refresh_token, calendarId: env.GOOGLE_CALENDAR_DEFAULT_ID || null, calendarName: env.GOOGLE_CALENDAR_DEFAULT_NAME || null, expiresAt: new Date(Date.now() + Number(payload.expires_in || 3600) * 1000).toISOString() });
  return redirect(`${env.ADMIN_ORIGIN}/admin.html?section=schedule&google=connected`);
}
async function googleCalendarCalendars(request, env) {
  const admin = await adminSession(request, env);
  if (!admin) return error('Pedido de administração não autorizado.', 403);
  if (googleServiceConfigured(env)) return jsonResponse({ calendars: [{ id: env.GOOGLE_CALENDAR_DEFAULT_ID, name: env.GOOGLE_CALENDAR_DEFAULT_NAME || 'Booking', primary: false }] });
  const { payload } = await googleApi(env, 'users/me/calendarList?maxResults=250');
  return jsonResponse({ calendars: (payload.items || []).map(item => ({ id: item.id, name: item.summary, primary: Boolean(item.primary) })) });
}
async function googleCalendarSelect(request, env) {
  const admin = await requirePortalAdmin(request, env);
  if (!admin) return error('Pedido de administração não autorizado.', 403);
  let body; try { body = await request.json(); } catch { return error('Pedido inválido.'); }
  const calendarId = String(body.calendarId || '').trim();
  const calendarName = String(body.calendarName || '').trim();
  if (!calendarId || !calendarName) return error('Selecione um calendário Google válido.');
  if (googleServiceConfigured(env)) return error('O calendário Booking é gerido pela conta de serviço.', 409);
  const current = await googleConnection(env);
  if (!current) return error('Ligue primeiro a conta Google.', 409);
  await storeGoogleConnection(env, { ...current, calendarId, calendarName });
  return jsonResponse({ ok: true, calendarId, calendarName });
}
function bookingDate(value) {
  const normalized = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(new Date(`${normalized}T00:00:00Z`).getTime())) throw inputError('Data de marcação inválida.');
  return normalized;
}
function bookingTime(value) {
  const normalized = String(value || '');
  if (!/^\d{2}:(?:00|30)$/.test(normalized)) throw inputError('Hora de marcação inválida.');
  return normalized;
}
function bookingEnd(startsAt, hours) {
  const date = new Date(`${startsAt.replace(' ', 'T')}Z`);
  date.setTime(date.getTime() + hours * 3600000);
  return date.toISOString().slice(0, 16).replace('T', ' ');
}
function isBookableDay(date) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday >= 2 && weekday <= 6;
}
function bookingDateTime(date, time) { return `${date} ${time}`; }
function bookingBlockedByRules(startsAt, endsAt, rules) {
  const date = startsAt.slice(0, 10);
  const startTime = startsAt.slice(11, 16);
  const endTime = endsAt.slice(11, 16);
  const nextDate = new Date(`${date}T00:00:00Z`); nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const midnightNextDay = nextDate.toISOString().slice(0, 10);
  const endsAtMidnight = rules.fullDay && endsAt.slice(0, 10) === midnightNextDay && endTime === '00:00';
  if (!rules.fullDay && (endsAt.slice(0, 10) !== date || startTime < rules.startsAt || endTime > rules.endsAt)) return 'Esse horário está fora do período disponível para esta sessão.';
  if (rules.fullDay && (endsAt.slice(0, 10) !== date && !endsAtMidnight)) return 'Esse horário está fora do período disponível para esta sessão.';
  if (rules.lunchEnabled && startTime < rules.lunchEndsAt && endTime > rules.lunchStartsAt) return 'Esse horário inclui a pausa de almoço.';
  return '';
}
function lisbonInstant(localValue) {
  const wanted = String(localValue).replace(' ', 'T');
  const guess = new Date(`${wanted}:00Z`);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(guess).reduce((all, item) => ({ ...all, [item.type]: item.value }), {});
  const displayed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  const intended = Date.parse(`${wanted}:00Z`);
  return new Date(guess.getTime() + intended - displayed);
}
async function publicAvailability(request, env) {
  const url = new URL(request.url);
  const from = bookingDate(url.searchParams.get('from'));
  const until = bookingDate(url.searchParams.get('until'));
  if (until <= from) throw inputError('Intervalo de disponibilidade inválido.');
  const { service, rules, blocks } = await bookingConfiguration(env, url.searchParams.get('serviceId'));
  const busy = await clientDb(env).prepare("SELECT starts_at AS startsAt, ends_at AS endsAt FROM studio_appointments WHERE status != 'cancelled' AND starts_at < ? AND ends_at > ? ORDER BY starts_at ASC").bind(`${until} 00:00`, `${from} 00:00`).all();
  const googleBusy = await googleBusyEvents(env, from, until);
  const configuredBlocks = blocks.filter(item => item.date >= from && item.date < until).map(item => ({ startsAt: bookingDateTime(item.date, item.startsAt), endsAt: bookingDateTime(item.date, item.endsAt), title: item.label }));
  return jsonResponse({ timezone: 'Europe/Lisbon', serviceId: service.id, rules, busy: [...busy.results, ...googleBusy, ...configuredBlocks] });
}
async function publicBooking(request, env) {
  let body;
  try { body = await request.json(); } catch { return error('Pedido inválido.'); }
  const date = bookingDate(body.date);
  const time = bookingTime(body.time);
  const duration = Number(body.duration);
  if (!Number.isFinite(duration) || duration < 2 || duration > 10 || Math.round(duration * 2) !== duration * 2) return error('A duração deve ser entre 2 e 10 horas, em blocos de 30 minutos.');
  if (!isBookableDay(date)) return error('Só é possível agendar de terça a sábado.');
  const startsAt = `${date} ${time}`;
  const endsAt = bookingEnd(startsAt, duration);
  const db = clientDb(env);
  const session = await clientSession(request, env);
  const sessionClient = session ? await db.prepare('SELECT id, display_name AS name, phone FROM clients WHERE id = ? AND active = 1').bind(session.clientId).first() : null;
  const guestName = String(body.name || '').trim();
  const guestEmail = String(body.email || '').trim().toLowerCase();
  const { service: bookingService, rules, blocks } = await bookingConfiguration(env, body.serviceId);
  const service = bookingService.title;
  const notes = String(body.notes || '').trim().slice(0, 2000) || null;
  const ruleError = bookingBlockedByRules(startsAt, endsAt, rules);
  if (ruleError) return error(ruleError, 409);
  if (lisbonInstant(startsAt).getTime() < Date.now() + rules.minNoticeHours * 3600000) return error(`Esta sessão requer pelo menos ${rules.minNoticeHours}h de antecedência.`, 409);
  const overlapsBlock = blocks.some(item => startsAt < bookingDateTime(item.date, item.endsAt) && endsAt > bookingDateTime(item.date, item.startsAt));
  if (overlapsBlock) return error('Este período está bloqueado pelo estúdio.', 409);
  if (!sessionClient && (!guestName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail))) return error('Indique o nome e um e-mail válido.');
  const amountCents = Math.round(bookingService.pricePerHour * duration * 100);
  const appointment = { clientId: sessionClient?.id || null, guestName: sessionClient ? null : guestName, guestPhone: null, guestEmail: sessionClient ? null : guestEmail, service, startsAt, endsAt, status: 'pending', amountCents, paidCents: 0, paymentStatus: 'pending', paymentUrl: null, notes };
  if (await hasAppointmentConflict(db, appointment)) return error('Este horário já não está disponível. Escolha outro, por favor.', 409);
  const id = randomId();
  const statements = [db.prepare('INSERT INTO studio_appointments (id, client_id, guest_name, guest_phone, guest_email, service, starts_at, ends_at, status, amount_cents, payment_status, payment_url, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, appointment.clientId, appointment.guestName, appointment.guestPhone, appointment.guestEmail, appointment.service, appointment.startsAt, appointment.endsAt, appointment.status, appointment.amountCents, appointment.paymentStatus, appointment.paymentUrl, appointment.notes)];
  if (sessionClient) {
    statements.push(db.prepare('INSERT INTO client_audit_log (id, client_id, actor, action, metadata_json) VALUES (?, ?, ?, ?, ?)').bind(randomId(), sessionClient.id, `client:${sessionClient.id}`, 'booking.requested', JSON.stringify({ appointmentId: id, duration })));
  }
  await db.batch(statements);
  await syncAppointmentBooking(db, id, appointment);
  let googleSynced = true;
  try { await googleSyncAppointment(env, db, { id, ...appointment }); } catch (caught) { console.warn('Google Calendar: reserva criada sem espelho', caught); googleSynced = false; }
  let notificationSent = false;
  try { notificationSent = await sendBookingNotification(env, { id, ...appointment }, { clientName: sessionClient?.name || guestName, clientEmail: sessionClient ? '' : guestEmail }); } catch (caught) { console.warn('E-mail: reserva criada sem notificação', caught); }
  return jsonResponse({ id, startsAt, endsAt, status: 'pending', googleSynced, notificationSent, client: sessionClient ? { name: sessionClient.name } : null }, 201);
}
async function studioSchedule(request, env, appointmentId = '') {
  const admin = request.method === 'GET' ? await adminSession(request, env) : await requirePortalAdmin(request, env);
  if (!admin) return error('Pedido de administração não autorizado.', 403);
  const db = clientDb(env);
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const from = appointmentDate(url.searchParams.get('from') || new Date().toISOString(), 'Data inicial');
    const until = appointmentDate(url.searchParams.get('until') || new Date(Date.now() + 1000 * 60 * 60 * 24 * 31).toISOString(), 'Data final');
    const appointments = await db.prepare("SELECT a.id, a.client_id AS clientId, COALESCE(c.display_name, a.guest_name) AS clientName, COALESCE(c.email, a.guest_email) AS clientEmail, a.service, a.starts_at AS startsAt, a.ends_at AS endsAt, a.status, a.notes, a.amount_cents AS amountCents, a.paid_cents AS paidCents, CASE WHEN a.paid_cents >= a.amount_cents THEN 'paid' WHEN a.paid_cents > 0 THEN 'partial' ELSE 'pending' END AS paymentStatus, a.payment_url AS paymentUrl, a.google_event_id AS googleEventId, 'studio' AS source FROM studio_appointments a LEFT JOIN clients c ON c.id = a.client_id WHERE a.starts_at < ? AND a.ends_at > ? ORDER BY a.starts_at ASC").bind(until, from).all();
    for (const appointment of appointments.results) {
      if (!appointment.googleEventId && appointment.status !== 'cancelled') {
        try { appointment.googleEventId = await googleSyncAppointment(env, db, appointment); } catch (caught) { console.warn('Google Calendar: não foi possível sincronizar marcação existente', caught); }
      }
    }
    const linkedGoogleIds = new Set(appointments.results.map(item => item.googleEventId).filter(Boolean));
    const external = (await googleBusyEvents(env, from, until)).filter(item => !linkedGoogleIds.has(item.id)).map(item => ({ id: `google:${item.id}`, clientId: '', clientName: 'Google Calendar', clientPhone: '', service: item.title, startsAt: item.startsAt, endsAt: item.endsAt, status: 'confirmed', notes: 'Evento externo — gerido no Google Calendar.', googleEventId: item.id, source: 'google', readOnly: true }));
    return jsonResponse({ appointments: [...appointments.results, ...external].sort((a, b) => a.startsAt.localeCompare(b.startsAt)) });
  }
  if (request.method === 'DELETE') {
    const current = await db.prepare('SELECT id, google_event_id AS googleEventId FROM studio_appointments WHERE id = ?').bind(appointmentId).first();
    if (!current) return error('Marcação não encontrada.', 404);
    await googleDeleteAppointment(env, current);
    await db.prepare('DELETE FROM studio_appointments WHERE id = ?').bind(appointmentId).run();
    return jsonResponse({ ok: true });
  }
  let body;
  try { body = await request.json(); } catch { return error('Pedido inválido.'); }
  let appointment = await appointmentPayload(body, db);
  if (await hasAppointmentConflict(db, appointment, appointmentId)) return error('Este horário entra em conflito com outra marcação.', 409);
  appointment = await appointmentClient(db, appointment);
  const id = appointmentId || randomId();
  if (appointmentId) {
    const current = await db.prepare('SELECT id FROM studio_appointments WHERE id = ?').bind(id).first();
    if (!current) return error('Marcação não encontrada.', 404);
    await db.prepare('UPDATE studio_appointments SET client_id = ?, guest_name = ?, guest_phone = ?, guest_email = ?, service = ?, starts_at = ?, ends_at = ?, status = ?, amount_cents = ?, paid_cents = ?, payment_status = ?, payment_url = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(appointment.clientId, appointment.guestName, appointment.guestPhone, appointment.guestEmail, appointment.service, appointment.startsAt, appointment.endsAt, appointment.status, appointment.amountCents, appointment.paidCents, appointment.paymentStatus, appointment.paymentUrl, appointment.notes, id).run();
  } else {
    await db.prepare('INSERT INTO studio_appointments (id, client_id, guest_name, guest_phone, guest_email, service, starts_at, ends_at, status, amount_cents, paid_cents, payment_status, payment_url, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, appointment.clientId, appointment.guestName, appointment.guestPhone, appointment.guestEmail, appointment.service, appointment.startsAt, appointment.endsAt, appointment.status, appointment.amountCents, appointment.paidCents, appointment.paymentStatus, appointment.paymentUrl, appointment.notes).run();
  }
  await syncAppointmentBooking(db, id, appointment);
  const currentGoogle = appointmentId ? await db.prepare('SELECT google_event_id AS googleEventId FROM studio_appointments WHERE id = ?').bind(id).first() : null;
  const synced = { id, ...appointment, googleEventId: currentGoogle?.googleEventId || '' };
  let googleSynced = true;
  if (appointment.status === 'cancelled') await googleDeleteAppointment(env, synced);
  else {
    try { synced.googleEventId = await googleSyncAppointment(env, db, synced); } catch (caught) { console.warn('Google Calendar: marcação guardada sem espelho', caught); googleSynced = false; }
  }
  return jsonResponse({ ...synced, googleSynced }, appointmentId ? 200 : 201);
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
    if (request.method === 'DELETE') {
      // As marcações do estúdio exigem sempre um cliente ou nome de convidado.
      // Apagamo-las primeiro para não acionar ON DELETE SET NULL contra essa regra.
      const appointments = (await db.prepare('SELECT id, google_event_id AS googleEventId FROM studio_appointments WHERE client_id = ?').bind(id).all()).results;
      for (const appointment of appointments) {
        try { await googleDeleteAppointment(env, appointment); } catch (caught) { console.warn('Google Calendar: não foi possível apagar o espelho da marcação', caught); }
      }
      await db.batch([
        db.prepare('DELETE FROM studio_appointments WHERE client_id = ?').bind(id),
        db.prepare('DELETE FROM client_sessions WHERE client_id = ?').bind(id),
        db.prepare('DELETE FROM client_tracks WHERE client_id = ?').bind(id),
        db.prepare('DELETE FROM client_bookings WHERE client_id = ?').bind(id),
        db.prepare('DELETE FROM clients WHERE id = ?').bind(id)
      ]);
      return jsonResponse({ ok: true });
    }
    const name = String(body.name || '').trim();
    const email = clientEmail(body.email);
    const phone = String(body.phone || '').replace(/\D/g, '');
    if (!name || (phone && !/^\d{9,15}$/.test(phone))) return error('Dados de cliente inválidos.');
    const active = body.active === false ? 0 : 1;
    const statements = [db.prepare('UPDATE clients SET display_name = ?, email = ?, phone = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(name, email, phone || null, active, id)];
    if (body.password) {
      const password = await passwordHash(String(body.password));
      statements.push(db.prepare('UPDATE clients SET password_hash = ?, password_salt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(password.hash, password.salt, id));
      statements.push(db.prepare('DELETE FROM client_sessions WHERE client_id = ?').bind(id));
    }
    try { await db.batch(statements); } catch (caught) { if (String(caught.message).includes('UNIQUE')) return error('Esse e-mail já pertence a outro cliente.', 409); throw caught; }
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
    const payment = paymentDetails(body.amount, body.paidAmount, paymentStatus(body.paymentStatus || 'pending'));
    if (isTrack) {
      const category = trackCategory(String(body.category || 'mix-master'));
      const service = category === 'mix-master' && body.requestedService ? requestedMixService((await contentFromGitHub(env)).content, body.requestedService) : null;
      await db.prepare('INSERT INTO client_tracks (id, client_id, title, stage, category, requested_service, source_track_id, payment_status, amount_cents, paid_cents, payment_url, samply_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(itemId, clientId, title, ['start', 'mix', 'master'].includes(body.stage) ? body.stage : 'start', category, service?.id || null, body.sourceTrackId || null, payment.paymentStatus, payment.amountCents, payment.paidCents, paymentUrl(body.paymentUrl), samplyPlayerUrl(body.samplyUrl)).run();
    }
    else await db.prepare('INSERT INTO client_bookings (id, client_id, service, starts_at, payment_status, amount_cents, paid_cents, payment_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(itemId, clientId, title, body.startsAt || null, payment.paymentStatus, payment.amountCents, payment.paidCents, paymentUrl(body.paymentUrl)).run();
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
  const payment = paymentDetails(body.amount, body.paidAmount, paymentStatus(body.paymentStatus || 'pending'));
  if (isTrack) {
    const category = trackCategory(String(body.category || 'mix-master'));
    const service = category === 'mix-master' && body.requestedService ? requestedMixService((await contentFromGitHub(env)).content, body.requestedService) : null;
    await db.prepare('UPDATE client_tracks SET title = ?, stage = ?, category = ?, requested_service = ?, source_track_id = ?, payment_status = ?, amount_cents = ?, paid_cents = ?, payment_url = ?, samply_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(title, ['start', 'mix', 'master'].includes(body.stage) ? body.stage : 'start', category, service?.id || null, body.sourceTrackId || null, payment.paymentStatus, payment.amountCents, payment.paidCents, paymentUrl(body.paymentUrl), samplyPlayerUrl(body.samplyUrl), id).run();
  }
  else await db.prepare('UPDATE client_bookings SET service = ?, starts_at = ?, payment_status = ?, amount_cents = ?, paid_cents = ?, payment_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(title, body.startsAt || null, payment.paymentStatus, payment.amountCents, payment.paidCents, paymentUrl(body.paymentUrl), id).run();
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
  if (!result?.commit?.sha) throw new Error('O GitHub não confirmou a publicação.');
  return jsonResponse({ commit: result.commit.sha, content: payload.content });
}
async function uploadArtistImage(request, env) {
  const user = await sessionFromRequest(request, env);
  if (!user) return error('Inicie sessão para enviar uma imagem.', 401);
  if (request.headers.get('Origin') !== env.ADMIN_ORIGIN) return error('Origem não autorizada.', 403);
  if (!user.csrf || request.headers.get('x-cms-csrf') !== user.csrf) return error('Pedido de imagem inválido.', 403);
  const form = await request.formData();
  const file = form.get('image');
  const allowed = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };
  if (!(file instanceof File) || !allowed[file.type]) return error('Use uma imagem JPG, PNG, WebP ou AVIF.');
  if (file.size > 5 * 1024 * 1024) return error('A imagem não pode ultrapassar 5 MB.');
  const label = String(form.get('artist') || 'artista').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'artista';
  const path = `images/artists/${label}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${allowed[file.type]}`;
  const token = await installationToken(env);
  const response = await github(null, `/repos/${env.REPO_OWNER}/${env.REPO_NAME}/contents/${path}`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ message: `media: imagem de artista por ${user.login}`, branch: env.BRANCH, content: bytesToBase64(new Uint8Array(await file.arrayBuffer())) }) });
  const result = await response.json();
  return jsonResponse({ path, commit: result.commit.sha }, 201);
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
      else if (url.pathname === '/media/artists' && request.method === 'POST') response = await uploadArtistImage(request, env);
      else if (url.pathname === '/client/auth/login' && request.method === 'POST') response = await clientLogin(request, env);
      else if (url.pathname === '/client/auth/logout' && request.method === 'POST') response = await clientLogout(request, env);
      else if (url.pathname === '/client/portal' && request.method === 'GET') response = await clientPortal(request, env);
      else if (url.pathname === '/client/tracks' && request.method === 'POST') response = await clientTrackRequest(request, env);
      else if (url.pathname === '/client/artist-profile' && ['GET', 'PATCH'].includes(request.method)) response = await clientArtistProfile(request, env);
      else if (url.pathname === '/client/artist-image' && request.method === 'POST') response = await clientArtistImage(request, env);
      else if (url.pathname === '/artists/profiles' && request.method === 'GET') response = await publicArtistProfiles(env);
      else if (/^\/client\/tracks\/[0-9a-f-]{36}\/versions$/i.test(url.pathname) && request.method === 'POST') response = await clientTrackVersion(request, env, url.pathname.split('/')[3]);
      else if (/^\/client\/tracks\/[0-9a-f-]{36}\/comments$/i.test(url.pathname) && request.method === 'POST') response = await clientTrackComment(request, env, url.pathname.split('/')[3]);
      else if (/^\/client\/tracks\/[0-9a-f-]{36}\/versions\/[0-9a-f-]{36}\/file$/i.test(url.pathname) && request.method === 'GET') response = await clientTrackFile(request, env, url.pathname.split('/')[3], url.pathname.split('/')[5]);
      else if (/^\/client\/appointments\/[0-9a-f-]{36}$/i.test(url.pathname) && ['GET', 'PATCH', 'DELETE'].includes(request.method)) response = await clientAppointment(request, env, url.pathname.split('/').pop());
      else if (url.pathname === '/google-calendar/status' && request.method === 'GET') response = await googleCalendarStatus(request, env);
      else if (url.pathname === '/google-calendar/connect' && request.method === 'POST') response = await googleCalendarConnect(request, env);
      else if (url.pathname === '/google-calendar/callback' && request.method === 'GET') response = await googleCalendarCallback(request, env);
      else if (url.pathname === '/google-calendar/calendars' && request.method === 'GET') response = await googleCalendarCalendars(request, env);
      else if (url.pathname === '/google-calendar/calendar' && request.method === 'PATCH') response = await googleCalendarSelect(request, env);
      else if (url.pathname === '/studio/availability' && request.method === 'GET') response = await publicAvailability(request, env);
      else if (url.pathname === '/studio/booking' && request.method === 'POST') response = await publicBooking(request, env);
      else if (url.pathname === '/client/admin/clients' && request.method === 'GET') response = await portalAdminClients(request, env);
      else if (url.pathname === '/finance/summary' && request.method === 'GET') response = await financeSummary(request, env);
      else if (url.pathname === '/dashboard/summary' && request.method === 'GET') response = await dashboardSummary(request, env);
      else if (url.pathname === '/client/admin/clients' && request.method === 'POST') response = await portalCreateClient(request, env);
      else if (/^\/client\/admin\/tracks\/[0-9a-f-]{36}\/versions$/i.test(url.pathname) && request.method === 'POST') response = await adminTrackVersion(request, env, url.pathname.split('/')[4]);
      else if (/^\/client\/admin\/tracks\/[0-9a-f-]{36}\/versions\/[0-9a-f-]{36}$/i.test(url.pathname) && request.method === 'DELETE') response = await adminTrackVersionDelete(request, env, url.pathname.split('/')[4], url.pathname.split('/')[6]);
      else if (/^\/client\/admin\/tracks\/[0-9a-f-]{36}\/comments$/i.test(url.pathname) && request.method === 'POST') response = await adminTrackComment(request, env, url.pathname.split('/')[4]);
      else if (/^\/client\/admin\/tracks\/[0-9a-f-]{36}\/versions\/[0-9a-f-]{36}\/file$/i.test(url.pathname) && request.method === 'GET') response = await adminTrackFile(request, env, url.pathname.split('/')[4], url.pathname.split('/')[6]);
      else if (/^\/client\/admin\/clients\/[0-9a-f-]{36}$/i.test(url.pathname) && request.method === 'GET') response = await portalAdminClient(request, env, url.pathname.split('/').pop());
      else if (url.pathname === '/studio/appointments' && request.method === 'GET') response = await studioSchedule(request, env);
      else if (url.pathname === '/studio/appointments' && request.method === 'POST') response = await studioSchedule(request, env);
      else if (/^\/studio\/appointments\/[0-9a-f-]{36}$/i.test(url.pathname) && ['PATCH', 'DELETE'].includes(request.method)) response = await studioSchedule(request, env, url.pathname.split('/').pop());
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
