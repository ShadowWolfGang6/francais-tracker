import { connectPagesJournal } from './sync.js';

const service = document.querySelector('[name="journal-service"]').content;
const sessionKey = 'francais-tracker:pages-session';
const attemptKey = 'francais-tracker:pages-login';
const welcome = document.getElementById('pagesWelcome');
const journal = document.getElementById('pagesJournal');
const signIn = document.getElementById('pagesSignIn');
const signOut = document.getElementById('pagesSignOut');
const status = document.getElementById('pagesStatus');
let session;

async function retireLegacyHomepage() {
  const oldWorker = new URL('./sw.js', location.href).href;
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.getRegistration(location.href);
    if ([registration?.active, registration?.waiting, registration?.installing]
      .some(worker => worker?.scriptURL === oldWorker)) await registration.unregister();
  }
  if ('caches' in window) await caches.delete('francais-tracker-v1');
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function nonce() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(sessionKey));
  } catch {
    return null;
  }
}

function clearSession(expectedToken) {
  if (!expectedToken || loadSession()?.token === expectedToken) localStorage.removeItem(sessionKey);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers);
  if (session?.token) headers.set('Authorization', 'Bearer ' + session.token);
  return fetch(service + '/pages/' + path, { cache: 'no-store', credentials: 'omit', ...options, headers });
}

function showSignIn(message = '') {
  journal.hidden = true;
  welcome.hidden = false;
  signIn.disabled = false;
  status.textContent = message;
}

signIn.onclick = async () => {
  signIn.disabled = true;
  status.textContent = 'Opening ChatGPT sign-in…';
  try {
    const verifier = nonce();
    const state = nonce();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = base64Url(new Uint8Array(digest));
    sessionStorage.setItem(attemptKey, JSON.stringify({ verifier, state }));
    location.assign(service + '/pages/authorize?' + new URLSearchParams({ challenge, state }));
  } catch {
    showSignIn('Could not start sign-in. Allow site storage and try again.');
  }
};

signOut.onclick = async () => {
  signOut.disabled = true;
  // The account-scoped queue stays on this device if an edit is still syncing.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    await api('session', { method: 'DELETE', signal: controller.signal });
  } catch {
    // The server session expires automatically if it cannot be revoked here.
  } finally {
    clearTimeout(timeout);
    clearSession(session?.token);
    location.assign(service + '/pages/signout');
  }
};

async function completeSignIn(params) {
  history.replaceState(null, '', location.pathname + location.search);
  const saved = JSON.parse(sessionStorage.getItem(attemptKey));
  sessionStorage.removeItem(attemptKey);
  if (!saved || saved.state !== params.get('state')) throw Error('Please start sign-in again in this tab.');
  const response = await api('exchange', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: params.get('tracker_auth'), verifier: saved.verifier })
  });
  if (!response.ok) throw Error('Could not finish sign-in. Please try again.');
  const result = await response.json();
  localStorage.setItem(sessionKey, JSON.stringify(result));
  return result;
}

async function open() {
  const params = new URLSearchParams(location.hash.slice(1));
  const wantsSignIn = new URLSearchParams(location.search).get('signin') === '1';
  if (wantsSignIn && !params.has('tracker_auth')) return showSignIn();
  try {
    if (params.has('tracker_auth')) {
      status.textContent = 'Finishing sign-in…';
      session = await completeSignIn(params);
    } else {
      session = loadSession();
      if (!session) return showSignIn();
      if (session.expiresAt <= Date.now()) {
        clearSession(session.token);
        return showSignIn('Your session expired. Sign in again.');
      }
      const response = await api('session');
      if (response.status === 401) {
        clearSession(session.token);
        return showSignIn('Sign in again to open your journal.');
      }
      if (!response.ok) throw Error('Could not connect to the journal. Refresh to try again.');
      const current = await response.json();
      if (session.owner !== current.owner) {
        clearSession(session.token);
        return showSignIn('Sign in again to open your journal.');
      }
    }
    document.querySelector('[name="journal-owner"]').content = session.owner;
    connectPagesJournal({ endpoint: service + '/pages/progress', token: session.token, onExpired() {
      clearSession(session.token);
      location.reload();
    } });
    await import('./app.js');
    welcome.hidden = true;
    journal.hidden = false;
  } catch (error) {
    showSignIn(error instanceof TypeError ? 'Could not connect to the journal. Refresh to try again.' : error.message);
  }
}

addEventListener('storage', event => {
  if (event.key === sessionKey) location.reload();
});
retireLegacyHomepage().catch(() => {});
open();
