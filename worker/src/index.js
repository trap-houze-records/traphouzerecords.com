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
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 8).toISOString().replace('T', ' ').replace('Z', '');
  await db.prepare('INSERT INTO client_sessions (id, client_id, expires_at) VALUES (?, ?, ?)').bind(sessionId, row.id, expiresAt).run();
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
  const clientId = String(body.clientId || '').trim() || null;
  const guestName = String(body.guestName || '').trim() || null;
  const guestPhone = String(body.guestPhone || '').replace(/\D/g, '') || null;
  const service = String(body.service || '').trim();
  const startsAt = appointmentDate(body.startsAt, 'Data de início');
  const endsAt = appointmentDate(body.endsAt, 'Data de fim');
  const status = appointmentStatus(body.status || 'confirmed');
  const notes = String(body.notes || '').trim().slice(0, 2000) || null;
  if (!service || (!clientId && !guestName)) throw inputError('Indique o serviço e um cliente ou contacto.');
  if (endsAt <= startsAt) throw inputError('A hora de fim deve ser posterior à hora de início.');
  if (guestPhone && !/^\d{9,15}$/.test(guestPhone)) throw inputError('Número de WhatsApp inválido.');
  if (clientId && !await db.prepare('SELECT id FROM clients WHERE id = ?').bind(clientId).first()) throw inputError('Cliente não encontrado.');
  return { clientId, guestName, guestPhone, service, startsAt, endsAt, status, notes };
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
async function googleBusyEvents(env, from, until) {
  let connection;
  try { connection = await activeGoogleConnection(env); } catch { return []; }
  if (!connection?.calendarId) return [];
  const query = new URLSearchParams({ timeMin: new Date(`${from}T00:00:00+01:00`).toISOString(), timeMax: new Date(`${until}T00:00:00+01:00`).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '2500' });
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
  const event = { summary: `🎧 ${appointment.service} — ${name}`, description: `Reserva Trap Houze Records\nCliente: ${name}${client?.phone || appointment.guestPhone ? `\nWhatsApp: ${client?.phone || appointment.guestPhone}` : ''}${appointment.notes ? `\nNotas: ${appointment.notes}` : ''}\nEstado: ${appointment.status}`, location: 'Trap Houze Records', start: { dateTime: appointment.startsAt.replace(' ', 'T'), timeZone: 'Europe/Lisbon' }, end: { dateTime: appointment.endsAt.replace(' ', 'T'), timeZone: 'Europe/Lisbon' } };
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
  if (!/^\d{2}:00$/.test(normalized)) throw inputError('Hora de marcação inválida.');
  return normalized;
}
function bookingEnd(startsAt, hours) {
  const date = new Date(`${startsAt.replace(' ', 'T')}Z`);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString().slice(0, 16).replace('T', ' ');
}
function isBookableDay(date) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday >= 2 && weekday <= 6;
}
async function publicAvailability(request, env) {
  const url = new URL(request.url);
  const from = bookingDate(url.searchParams.get('from'));
  const until = bookingDate(url.searchParams.get('until'));
  if (until <= from) throw inputError('Intervalo de disponibilidade inválido.');
  const busy = await clientDb(env).prepare("SELECT starts_at AS startsAt, ends_at AS endsAt FROM studio_appointments WHERE status != 'cancelled' AND starts_at < ? AND ends_at > ? ORDER BY starts_at ASC").bind(`${until} 00:00`, `${from} 00:00`).all();
  const googleBusy = await googleBusyEvents(env, from, until);
  return jsonResponse({ timezone: 'Europe/Lisbon', hours: { startsAt: '10:00', endsAt: '22:00' }, busy: [...busy.results, ...googleBusy] });
}
async function publicBooking(request, env) {
  let body;
  try { body = await request.json(); } catch { return error('Pedido inválido.'); }
  const date = bookingDate(body.date);
  const time = bookingTime(body.time);
  const duration = Number(body.duration);
  if (!Number.isInteger(duration) || duration < 1 || duration > 10) return error('A duração deve ser entre 1 e 10 horas.');
  if (!isBookableDay(date)) return error('Só é possível agendar de terça a sábado.');
  const startsAt = `${date} ${time}`;
  const endsAt = bookingEnd(startsAt, duration);
  if (endsAt.slice(0, 10) !== date || endsAt.slice(11, 16) > '22:00') return error('Esse horário ultrapassa o período disponível do estúdio.');
  const db = clientDb(env);
  const session = await clientSession(request, env);
  const sessionClient = session ? await db.prepare('SELECT id, display_name AS name, phone FROM clients WHERE id = ? AND active = 1').bind(session.clientId).first() : null;
  const guestName = String(body.name || '').trim();
  const guestPhone = String(body.phone || '').replace(/\D/g, '');
  const service = String(body.service || 'Sessão de estúdio').trim().slice(0, 160);
  const notes = String(body.notes || '').trim().slice(0, 2000) || null;
  if (!sessionClient && (!guestName || !/^\d{9,15}$/.test(guestPhone))) return error('Indique o nome e um WhatsApp válido.');
  const appointment = { clientId: sessionClient?.id || null, guestName: sessionClient ? null : guestName, guestPhone: sessionClient ? null : guestPhone, service, startsAt, endsAt, status: 'pending', notes };
  if (await hasAppointmentConflict(db, appointment)) return error('Este horário já não está disponível. Escolha outro, por favor.', 409);
  const id = randomId();
  const statements = [db.prepare('INSERT INTO studio_appointments (id, client_id, guest_name, guest_phone, service, starts_at, ends_at, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, appointment.clientId, appointment.guestName, appointment.guestPhone, appointment.service, appointment.startsAt, appointment.endsAt, appointment.status, appointment.notes)];
  if (sessionClient) {
    statements.push(db.prepare("INSERT INTO client_bookings (id, client_id, service, starts_at, payment_status, amount_cents, payment_url) VALUES (?, ?, ?, ?, 'pending', 0, NULL)").bind(randomId(), sessionClient.id, service, startsAt));
    statements.push(db.prepare('INSERT INTO client_audit_log (id, client_id, actor, action, metadata_json) VALUES (?, ?, ?, ?, ?)').bind(randomId(), sessionClient.id, `client:${sessionClient.id}`, 'booking.requested', JSON.stringify({ appointmentId: id, duration })));
  }
  await db.batch(statements);
  googleSyncAppointment(env, db, { id, ...appointment }).catch(caught => console.warn('Google Calendar: reserva criada sem espelho', caught));
  return jsonResponse({ id, startsAt, endsAt, status: 'pending', client: sessionClient ? { name: sessionClient.name } : null }, 201);
}
async function studioSchedule(request, env, appointmentId = '') {
  const admin = request.method === 'GET' ? await adminSession(request, env) : await requirePortalAdmin(request, env);
  if (!admin) return error('Pedido de administração não autorizado.', 403);
  const db = clientDb(env);
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const from = appointmentDate(url.searchParams.get('from') || new Date().toISOString(), 'Data inicial');
    const until = appointmentDate(url.searchParams.get('until') || new Date(Date.now() + 1000 * 60 * 60 * 24 * 31).toISOString(), 'Data final');
    const appointments = await db.prepare("SELECT a.id, a.client_id AS clientId, COALESCE(c.display_name, a.guest_name) AS clientName, COALESCE(c.phone, a.guest_phone) AS clientPhone, a.service, a.starts_at AS startsAt, a.ends_at AS endsAt, a.status, a.notes, a.google_event_id AS googleEventId, 'studio' AS source FROM studio_appointments a LEFT JOIN clients c ON c.id = a.client_id WHERE a.starts_at < ? AND a.ends_at > ? ORDER BY a.starts_at ASC").bind(until, from).all();
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
  const appointment = await appointmentPayload(body, db);
  if (await hasAppointmentConflict(db, appointment, appointmentId)) return error('Este horário entra em conflito com outra marcação.', 409);
  const id = appointmentId || randomId();
  if (appointmentId) {
    const current = await db.prepare('SELECT id FROM studio_appointments WHERE id = ?').bind(id).first();
    if (!current) return error('Marcação não encontrada.', 404);
    await db.prepare('UPDATE studio_appointments SET client_id = ?, guest_name = ?, guest_phone = ?, service = ?, starts_at = ?, ends_at = ?, status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(appointment.clientId, appointment.guestName, appointment.guestPhone, appointment.service, appointment.startsAt, appointment.endsAt, appointment.status, appointment.notes, id).run();
  } else {
    await db.prepare('INSERT INTO studio_appointments (id, client_id, guest_name, guest_phone, service, starts_at, ends_at, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, appointment.clientId, appointment.guestName, appointment.guestPhone, appointment.service, appointment.startsAt, appointment.endsAt, appointment.status, appointment.notes).run();
  }
  const currentGoogle = appointmentId ? await db.prepare('SELECT google_event_id AS googleEventId FROM studio_appointments WHERE id = ?').bind(id).first() : null;
  const synced = { id, ...appointment, googleEventId: currentGoogle?.googleEventId || '' };
  if (appointment.status === 'cancelled') await googleDeleteAppointment(env, synced);
  else googleSyncAppointment(env, db, synced).catch(caught => console.warn('Google Calendar: marcação guardada sem espelho', caught));
  return jsonResponse(synced, appointmentId ? 200 : 201);
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
      await db.prepare('DELETE FROM clients WHERE id = ?').bind(id).run();
      return jsonResponse({ ok: true });
    }
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
      else if (url.pathname === '/google-calendar/status' && request.method === 'GET') response = await googleCalendarStatus(request, env);
      else if (url.pathname === '/google-calendar/connect' && request.method === 'POST') response = await googleCalendarConnect(request, env);
      else if (url.pathname === '/google-calendar/callback' && request.method === 'GET') response = await googleCalendarCallback(request, env);
      else if (url.pathname === '/google-calendar/calendars' && request.method === 'GET') response = await googleCalendarCalendars(request, env);
      else if (url.pathname === '/google-calendar/calendar' && request.method === 'PATCH') response = await googleCalendarSelect(request, env);
      else if (url.pathname === '/studio/availability' && request.method === 'GET') response = await publicAvailability(request, env);
      else if (url.pathname === '/studio/booking' && request.method === 'POST') response = await publicBooking(request, env);
      else if (url.pathname === '/client/admin/clients' && request.method === 'GET') response = await portalAdminClients(request, env);
      else if (url.pathname === '/client/admin/clients' && request.method === 'POST') response = await portalCreateClient(request, env);
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
