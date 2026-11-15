import { configureJournalSync } from './sync.js';
import { supabaseConfig } from './supabase-config.js';

const $ = id => document.getElementById(id);
const site = 'https://shadowwolfgang6.github.io/francais-tracker/';
const recoveryKey = 'francais-journal:password-recovery';
const welcome = $('pagesWelcome');
const journal = $('pagesJournal');
const form = $('authForm');
const email = $('authEmail');
const password = $('authPassword');
const status = $('authStatus');
const actions = $('authActions');
const submit = $('authSubmit');
const signOut = $('pagesSignOut');
const modes = {
  signin: { title: 'Sign in', intro: 'Open your French journal.', email: true, password: true, button: 'Sign in' },
  signup: { title: 'Create account', intro: 'We’ll send you an email to verify your address.', email: true, password: true, button: 'Create account' },
  forgot: { title: 'Reset password', intro: 'Enter the email address you used for your account.', email: true, button: 'Send reset email' },
  resend: { title: 'Verify your email', intro: 'Send yourself a new account verification link.', email: true, button: 'Send verification email' },
  confirm: { title: 'Verify your email', intro: 'Confirm your address to open your journal.', button: 'Verify email' },
  recovery: { title: 'Reset password', intro: 'Continue from the link in your password reset email.', button: 'Continue to reset' },
  update: { title: 'Choose a new password', intro: 'You’ll use this password next time you sign in.', password: true, button: 'Save new password' }
};
let activeMode = 'signin';
let verificationToken;
let emailSession;
let authenticatedOwner;
let accessToken;
let client;
let signingOut = false;

function say(message, isError = false) {
  status.textContent = message;
  status.dataset.error = String(isError);
}

function showMode(mode, message = '', isError = false) {
  activeMode = mode;
  const options = modes[mode];
  $('authTitle').textContent = options.title;
  $('authIntro').textContent = options.intro;
  $('authEmailField').hidden = !options.email;
  $('authPasswordField').hidden = !options.password;
  email.required = Boolean(options.email);
  email.disabled = !options.email;
  password.required = Boolean(options.password);
  password.disabled = !options.password;
  password.value = '';
  const newPassword = mode === 'signup' || mode === 'update';
  password.autocomplete = newPassword ? 'new-password' : 'current-password';
  $('authPasswordHint').hidden = !newPassword;
  submit.textContent = options.button;
  for (const button of actions.querySelectorAll('[data-auth-mode]')) {
    button.hidden = mode === 'signin' ? button.dataset.authMode === 'signin' : button.dataset.authMode !== 'signin';
  }
  journal.hidden = true;
  welcome.hidden = false;
  form.hidden = false;
  actions.hidden = false;
  say(message, isError);
}

async function retireLegacyHomepage() {
  const oldWorker = new URL('./sw.js', location.href).href;
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.getRegistration(location.href);
    if ([registration?.active, registration?.waiting, registration?.installing]
      .some(worker => worker?.scriptURL === oldWorker)) await registration.unregister();
  }
  if ('caches' in window) await caches.delete('francais-tracker-v1');
}

function checked(response) {
  if (response.error) throw response.error;
  return response.data;
}

function requestMessage(error) {
  if (error.code === 'invalid_credentials') return 'Check your email address and password.';
  if (error.code === 'email_not_confirmed') return 'Check your inbox and verify your email before signing in.';
  if (error.code === 'otp_expired') return 'This email link expired. Request a new one from the sign-in page.';
  if (error.status === 429) return 'Too many attempts. Wait a minute and try again.';
  if (error.code === 'weak_password') return 'Choose a stronger password and try again.';
  if (error.code === 'same_password') return 'Choose a password you haven’t just used.';
  return 'Could not finish that request. Please try again.';
}

async function openJournal(session) {
  const identity = checked(await client.auth.getUser());
  if (!identity.user || identity.user.id !== session.user.id) throw Error('Journal account changed.');
  authenticatedOwner = identity.user.id;
  accessToken = session.access_token;
  document.querySelector('[name="journal-owner"]').content = authenticatedOwner;

  async function rpc(name, args, signal) {
    const result = await client.rpc(name, { expected_owner: authenticatedOwner, ...args }).abortSignal(signal);
    if (result.status === 401 || result.error?.code === '42501') {
      throw Object.assign(Error('Sign in again to sync'), { status: 409 });
    }
    return checked(result);
  }

  configureJournalSync({
    pull: (after_sequence, signal) => rpc('tracker_journal_pull', { after_sequence }, signal),
    push: (entries, signal) => rpc('tracker_journal_push', { entries }, signal),
    flush: entries => {
      const body = JSON.stringify({ expected_owner: authenticatedOwner, entries });
      if (!accessToken || new Blob([body]).size > 60000) return Promise.resolve();
      return fetch(supabaseConfig.projectUrl + '/rest/v1/rpc/tracker_journal_push', {
        method: 'POST', credentials: 'omit', keepalive: true, body,
        headers: { 'Content-Type': 'application/json', apikey: supabaseConfig.publishableKey,
          Authorization: 'Bearer ' + accessToken }
      });
    }
  });
  await import('./app.js');
  welcome.hidden = true;
  journal.hidden = false;
}

function switchMode(mode) {
  if (activeMode !== 'update') return showMode(mode);
  return signOutFromRecovery();
}

async function signOutFromRecovery(message = '') {
  checked(await client.auth.signOut({ scope: 'local' }));
  sessionStorage.removeItem(recoveryKey);
  showMode('signin', message);
}

actions.addEventListener('click', async event => {
  const button = event.target.closest('[data-auth-mode]');
  if (!button) return;
  try {
    await switchMode(button.dataset.authMode);
  } catch (error) {
    say(requestMessage(error), true);
  }
});

signOut.onclick = async () => {
  signOut.disabled = true;
  signingOut = true;
  try {
    checked(await client.auth.signOut({ scope: 'local' }));
    sessionStorage.removeItem(recoveryKey);
    location.assign(site + '?signin=1');
  } catch {
    signingOut = false;
    signOut.disabled = false;
    $('syncStatus').textContent = 'Could not sign out. Try again.';
  }
};

form.onsubmit = async event => {
  event.preventDefault();
  const mode = activeMode;
  const address = email.value.trim();
  const secret = password.value;
  if ((mode === 'signup' || mode === 'update') &&
    ([...secret].length < 12 || new TextEncoder().encode(secret).length > 72)) {
    say('Use at least 12 characters and keep your password within 72 bytes.', true);
    password.focus();
    return;
  }

  submit.disabled = true;
  say('Working…');
  for (const button of actions.querySelectorAll('button')) button.disabled = true;
  try {
    switch (mode) {
      case 'signin': {
        const { session } = checked(await client.auth.signInWithPassword({ email: address, password: secret }));
        history.replaceState(null, '', location.pathname + location.hash);
        await openJournal(session);
        break;
      }
      case 'signup': {
        checked(await client.auth.signUp({ email: address, password: secret }));
        showMode('signin', 'Check your inbox for a link to verify your account.');
        break;
      }
      case 'forgot': {
        checked(await client.auth.resetPasswordForEmail(address));
        showMode('signin', 'If an account uses that email, a password reset link will arrive shortly.');
        break;
      }
      case 'resend': {
        checked(await client.auth.resend({ email: address, type: 'signup' }));
        showMode('signin', 'If your address still needs verification, a new link will arrive shortly.');
        break;
      }
      case 'confirm':
      case 'recovery': {
        const type = mode === 'confirm' ? 'email' : 'recovery';
        const { session } = checked(emailSession
          ? await client.auth.setSession(emailSession)
          : await client.auth.verifyOtp({ token_hash: verificationToken, type }));
        verificationToken = undefined;
        emailSession = undefined;
        if (mode === 'recovery') {
          sessionStorage.setItem(recoveryKey, session.user.id);
          showMode('update');
        } else {
          await openJournal(session);
        }
        break;
      }
      case 'update': {
        const { session } = checked(await client.auth.getSession());
        if (!session || sessionStorage.getItem(recoveryKey) !== session.user.id) throw Error('Password reset expired.');
        checked(await client.auth.updateUser({ password: secret }));
        await signOutFromRecovery('Password updated. Sign in with your new password.');
        break;
      }
    }
  } catch (error) {
    say(requestMessage(error), true);
  } finally {
    submit.disabled = false;
    for (const button of actions.querySelectorAll('button')) button.disabled = false;
  }
};

async function start() {
  const params = new URLSearchParams(location.search);
  const callback = new URLSearchParams(location.hash.slice(1));
  const defaultType = callback.get('type');
  const defaultAction = defaultType === 'recovery' ? 'recovery'
    : ['signup', 'email'].includes(defaultType) ? 'confirm' : null;
  const emailAction = callback.get('auth') || defaultAction;
  const expiredEmail = callback.has('error_code');
  const access = callback.get('access_token');
  const refresh = callback.get('refresh_token');
  if (expiredEmail || access || refresh || callback.has('token_hash')) {
    history.replaceState(null, '', location.pathname + location.search);
  }
  if (callback.has('token_hash')) verificationToken = callback.get('token_hash');
  else if (defaultAction && access && refresh) emailSession = { access_token: access, refresh_token: refresh };
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(supabaseConfig.projectUrl) ||
      !/^sb_publishable_[a-zA-Z0-9_-]+$/.test(supabaseConfig.publishableKey) || !window.supabase?.createClient) {
    say('Email sign-in is awaiting setup.');
    return;
  }

  client = window.supabase.createClient(supabaseConfig.projectUrl, supabaseConfig.publishableKey, {
    auth: { detectSessionInUrl: false, storageKey: 'francais-journal:email-session' }
  });
  client.auth.onAuthStateChange((_event, next) => {
    if (!authenticatedOwner || signingOut) return;
    if (next?.user.id !== authenticatedOwner) {
      accessToken = undefined;
      journal.hidden = true;
      location.reload();
    } else {
      accessToken = next.access_token;
    }
  });

  try {
    if (expiredEmail) return showMode('signin', 'This email link expired. Request a new one.', true);
    if ((verificationToken || emailSession) && (emailAction === 'confirm' || emailAction === 'recovery')) return showMode(emailAction);
    if (emailAction === 'confirm' || emailAction === 'recovery') return showMode('signin', 'Open the original link in your email.', true);
    const { session } = checked(await client.auth.getSession());
    if (session && sessionStorage.getItem(recoveryKey) === session.user.id) return showMode('update');
    if (session && params.get('signin') !== '1') await openJournal(session);
    else showMode('signin');
  } catch (error) {
    showMode('signin', 'Could not restore your session. Sign in again or refresh the page.', true);
  }
}

retireLegacyHomepage().catch(() => {});
start();
