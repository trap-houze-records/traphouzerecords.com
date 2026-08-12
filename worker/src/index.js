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
function jsonResponse(body, status = 200, headers = {}) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=UTF-8', ...headers } }); }
function error(message, status = 400) { return jsonResponse({ error: message }, status); }
function allowedOrigin(request, env) {
  return request.headers.get('Origin') === env.ADMIN_ORIGIN ? env.ADMIN_ORIGIN : '';
}
function corsHeaders(request, env) {
  const origin = allowedOrigin(request, env);
  return origin ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS', vary: 'Origin' } : {};
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
function secureCookie(name, value, seconds) { return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`; }
function redirect(url, headers = {}) { return new Response(null, { status: 302, headers: { location: url, ...headers } }); }

async function github(request, path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, { ...options, headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...options.headers } });
  if (!response.ok) throw new Error(`GitHub respondeu ${response.status}.`);
  return response;
}
function pemToBuffer(pem) {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
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
  return { sha: file.sha, content: JSON.parse(decoder.decode(Uint8Array.from(atob(file.content.replace(/\n/g, '')), char => char.charCodeAt(0)))) };
}
function validContent(content) {
  return content && typeof content === 'object' && content.site && Array.isArray(content.navigation) && Array.isArray(content.hero) && Array.isArray(content.services) && Array.isArray(content.equipment);
}

async function login(request, env) {
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
  const session = await signedValue({ login: loginName, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8 }, env);
  return redirect(`${env.ADMIN_ORIGIN}/admin.html`, { 'set-cookie': secureCookie('th_session', session, 60 * 60 * 8) });
}
async function session(request, env) {
  const value = await readSignedValue(cookie(request, 'th_session'), env);
  return jsonResponse(value ? { authenticated: true, login: value.login } : { authenticated: false });
}
async function publish(request, env) {
  const user = await readSignedValue(cookie(request, 'th_session'), env);
  if (!user) return error('Inicie sessão para publicar.', 401);
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
      else response = error('Rota não encontrada.', 404);
      return withCors(response, request, env);
    } catch (caught) {
      console.error(caught);
      return withCors(error(caught.message || 'Erro inesperado.', 500), request, env);
    }
  }
};
