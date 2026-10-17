const AUTH_URL = 'https://ep-aged-fog-b44rru2q.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth';
const API_URL = '/api/v1';

const button = document.createElement('button');
button.id = 'mh-account-open';
button.textContent = 'Profile & Settings';
button.setAttribute('aria-label', 'Open MusicHub profile and settings');
button.hidden = true;
document.body.append(button);

const modal = document.createElement('section');
modal.id = 'mh-account-modal';
modal.hidden = true;
modal.innerHTML = `
  <div class="mh-account-card" role="dialog" aria-modal="true" aria-labelledby="mh-title">
    <button type="button" id="mh-close" class="mh-close" aria-label="Close">×</button>
    <h2 id="mh-title">MusicHub Account</h2>
    <p id="mh-message" role="status">Sign in or create your account.</p>
    <div id="mh-auth-area">
      <form id="mh-auth-form">
        <label id="mh-name-label" hidden>Full name
          <input id="mh-name" autocomplete="name" maxlength="100">
        </label>
        <label>Email
          <input id="mh-email" type="email" autocomplete="email" required>
        </label>
        <label>Password
          <input id="mh-password" type="password" autocomplete="current-password" minlength="8" required>
        </label>
        <button id="mh-submit" type="submit">Sign in</button>
      </form>
      <button type="button" id="mh-switch" class="mh-secondary">Create an account</button>
    </div>
    <div id="mh-profile-area" hidden></div>
  </div>`;
document.body.append(modal);

let auth;
let mode = 'login';

const message = (text) => {
  document.getElementById('mh-message').textContent = text;
};

const profileArea = document.getElementById('mh-profile-area');
const authArea = document.getElementById('mh-auth-area');
const form = document.getElementById('mh-auth-form');
const nameLabel = document.getElementById('mh-name-label');
const password = document.getElementById('mh-password');
const submit = document.getElementById('mh-submit');
const switchButton = document.getElementById('mh-switch');

function setMode(next) {
  mode = next;
  nameLabel.hidden = mode !== 'register';
  document.getElementById('mh-name').required = mode === 'register';
  password.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
  submit.textContent = mode === 'register' ? 'Create account' : 'Sign in';
  switchButton.textContent = mode === 'register'
    ? 'Already have an account? Sign in'
    : 'Create an account';
  message(mode === 'register'
    ? 'Create your personal MusicHub account.'
    : 'Sign in to access your account.');
}

async function getToken() {
  const result = await auth.getJWTToken?.();
  if (typeof result === 'string') return result;
  return result?.token || result?.jwt || result?.data?.token ||
    result?.data?.jwt || null;
}

async function api(path, options = {}) {
  const token = await getToken();
  if (!token) throw new Error('Your session token is unavailable. Sign in again and check the Neon Auth configuration.');
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || data.message || 'Account request failed.');
    error.status = response.status;
    error.code = data.code || data.error;
    throw error;
  }
  return data;
}

function showDashboard() {
  document.getElementById('splashScreen').style.display = 'none';
  document.getElementById('mainContent').style.display = 'block';
  button.hidden = false;
  modal.hidden = true;
}

function showProfileForm(profile = {}) {
  authArea.hidden = true;
  profileArea.hidden = false;
  profileArea.innerHTML = `
    <h3>${profile.display_name ? 'Profile & Settings' : 'Complete your profile'}</h3>
    <form id="mh-profile-form">
      <label>Display name
        <input id="mh-display-name" maxlength="100" required>
      </label>
      <label>Kenyan phone number
        <input id="mh-phone" type="tel" autocomplete="tel" placeholder="07XXXXXXXX or +2547XXXXXXXX">
      </label>
      <button type="submit">Save profile</button>
    </form>`;
  document.getElementById('mh-display-name').value = profile.display_name || '';
  document.getElementById('mh-phone').value = profile.phone || '';
  document.getElementById('mh-profile-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const displayName = document.getElementById('mh-display-name').value.trim();
    const phone = document.getElementById('mh-phone').value.trim();
    const save = event.submitter;
    if (save) save.disabled = true;
    try {
      await api('/account/me/profile', {
        method: 'POST',
        body: JSON.stringify({ displayName, phone })
      });
      message('Profile saved successfully.');
      await loadProfile(true);
    } catch (error) {
      message(error.message);
    } finally {
      if (save) save.disabled = false;
    }
  });
}

async function loadProfile(continueToDashboard = false) {
  try {
    const data = await api('/account/me');
    const profile = data.profile || data.data || data;
    authArea.hidden = true;
    profileArea.hidden = false;
    profileArea.replaceChildren();

    const heading = document.createElement('h3');
    heading.textContent = profile.display_name || 'Your MusicHub profile';
    const email = document.createElement('p');
    email.textContent = profile.email || 'Email not available';
    const edit = document.createElement('button');
    edit.textContent = 'Edit profile & settings';
    edit.addEventListener('click', () => showProfileForm(profile));

    const logout = document.createElement('button');
    logout.textContent = 'Sign out';
    logout.className = 'mh-secondary';
    logout.addEventListener('click', async () => {
      try {
        await auth.signOut();
        button.hidden = true;
        modal.hidden = true;
        profileArea.hidden = true;
        authArea.hidden = false;
        form.reset();
        setMode('login');
        document.getElementById('mainContent').style.display = 'none';
        document.getElementById('splashScreen').style.display = 'flex';
        message('You have signed out.');
      } catch {
        message('Sign-out failed. Check your connection and try again.');
      }
    });
    profileArea.append(heading, email, edit, logout);
    message('You are signed in.');
    if (continueToDashboard) showDashboard();
  } catch (error) {
    if (error.status === 404 || error.code === 'PROFILE_NOT_INITIALIZED') {
      showProfileForm();
      message('Complete your profile to finish onboarding.');
    } else {
      message(error.message || 'Could not load your profile.');
    }
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submit.disabled = true;
  message(mode === 'register' ? 'Creating your account…' : 'Signing in…');
  try {
    const email = document.getElementById('mh-email').value.trim();
    const pass = password.value;
    const result = mode === 'register'
      ? await auth.signUp.email({
          email,
          password: pass,
          name: document.getElementById('mh-name').value.trim()
        })
      : await auth.signIn.email({ email, password: pass });

    if (result?.error) throw new Error(result.error.message || 'Authentication failed.');
    const sessionResult = await auth.getSession();
    const session = sessionResult?.data ?? sessionResult;
    if (!session?.user) {
      message('Check your email if verification is required, then sign in.');
      return;
    }
    await loadProfile(true);
  } catch (error) {
    message(error.message || 'Authentication failed. Please try again.');
  } finally {
    submit.disabled = false;
  }
});

switchButton.addEventListener('click', () => setMode(mode === 'login' ? 'register' : 'login'));
document.addEventListener('musichub:enter', async () => {
  modal.hidden = false;
  if (!auth) {
    message('Authentication is still loading or unavailable. Check your connection and reload.');
    return;
  }
  try {
    const result = await auth.getSession();
    const session = result?.data ?? result;
    if (session?.user) {
      await loadProfile(true);
    } else {
      authArea.hidden = false;
      profileArea.hidden = true;
      setMode('login');
      document.getElementById('mh-email').focus();
    }
  } catch (error) {
    message(error.message || 'Could not verify your session. Please try again.');
  }
});

button.addEventListener('click', () => {
  modal.hidden = false;
  if (auth) loadProfile();
});
document.getElementById('mh-close').addEventListener('click', () => {
  modal.hidden = true;
});
modal.addEventListener('click', (event) => {
  if (event.target === modal) modal.hidden = true;
});

(async () => {
  try {
    const { createAuthClient } = await import('https://esm.sh/@neondatabase/auth');
    auth = createAuthClient(AUTH_URL);
    const sessionResult = await auth.getSession();
    const session = sessionResult?.data ?? sessionResult;
    if (session?.user) {
      button.textContent = 'My Account';
      message('Your session is available.');
    }
  } catch (error) {
    message('Authentication could not initialize. Check your connection and Neon Auth allowed domains.');
    console.error('MusicHub auth initialization failed:', error);
  }
})();
