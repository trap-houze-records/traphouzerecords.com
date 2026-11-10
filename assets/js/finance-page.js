(() => {
  const apiBase = (window.CMS_API_URL || '').replace(/\/$/, '');
  let sessionToken = sessionStorage.getItem('th_cms_session') || '';
  let csrfToken = '';
  const $ = selector => document.querySelector(selector);

  function notice(message = '', kind = '') {
    const element = $('#financeNotice');
    element.textContent = message;
    element.className = `admin-notice ${kind}`;
  }

  function login() {
    if (!apiBase) return notice('O serviço de publicação não está configurado.', 'error');
    location.assign(`${apiBase}/auth/login?return=financas`);
  }

  async function authenticatedSession() {
    if (!apiBase) throw new Error('O serviço de publicação não está configurado.');
    const response = await fetch(`${apiBase}/auth/session`, { headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {} });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Não foi possível validar a sessão.');
    if (!result.authenticated) return null;
    csrfToken = result.csrf || '';
    return result;
  }

  async function loadContent() {
    const response = await fetch(`${apiBase}/content?refresh=${Date.now()}`, { cache: 'no-store' });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) throw new Error('Não foi possível carregar a configuração financeira.');
    return result;
  }

  async function saveServices(bookingServices, mixMasterServices) {
    notice('A guardar preços…');
    const content = await loadContent();
    content.bookingServices = bookingServices;
    content.mixMasterServices = mixMasterServices;
    const response = await fetch(`${apiBase}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CMS-CSRF': csrfToken, Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ content })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Não foi possível guardar os preços.');
    notice(`Preços publicados. Commit ${String(result.commit || '').slice(0, 7)}.`, 'success');
  }

  async function start() {
    const tokenMatch = location.hash.match(/(?:^#|&)cms_session=([^&]+)/);
    if (tokenMatch) {
      sessionToken = decodeURIComponent(tokenMatch[1]);
      sessionStorage.setItem('th_cms_session', sessionToken);
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    }
    document.querySelectorAll('[data-finance-login]').forEach(button => button.addEventListener('click', login));
    $('#financeLoginButton').addEventListener('click', login);
    let session;
    try {
      session = await authenticatedSession();
    } catch (error) {
      notice(error.message, 'error');
      $('#financeLoginButton').hidden = false;
      $('#financeLoginGate').hidden = false;
      return;
    }
    if (!session) {
      $('#financeLoginButton').hidden = false;
      $('#financeLoginGate').hidden = false;
      return;
    }
    $('#financeAuthStatus').textContent = `Ligado como ${session.login}`;
    try {
      const content = await loadContent();
      $('#financePageRoot').hidden = false;
      await window.FinanceModule.mount($('#financePageRoot'), {
        apiBase,
        getToken: () => sessionToken,
        bookingServices: content.bookingServices || [],
        mixMasterServices: content.mixMasterServices || [],
        saveServices,
        onError: error => notice(error.message, 'error'),
        onNotice: notice
      });
    } catch (error) {
      notice(error.message, 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', start);
})();
