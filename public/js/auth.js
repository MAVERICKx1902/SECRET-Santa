/**
 * Browser-side OAuth.
 *  - Spotify: Authorization Code + PKCE (no client secret, refreshable).
 *  - Google:  OAuth 2.0 implicit token for the YouTube Data API (read-only).
 * Tokens live in localStorage on the user's machine; the server never sees them.
 */

const LS = {
  spClient: 'mpvweb.spotify.clientId',
  spTok: 'mpvweb.spotify.token',
  spVer: 'mpvweb.spotify.verifier',
  ytClient: 'mpvweb.youtube.clientId',
  ytKey: 'mpvweb.youtube.apiKey',
  ytTok: 'mpvweb.youtube.token',
  email: 'mpvweb.account.email',
};

// Spotify requires 127.0.0.1 for HTTP loopback redirects. Keep the public
// app URL friendly while using the registered loopback address for OAuth.
export const REDIRECT_URI = `${location.protocol === 'http:' && location.hostname === 'localhost'
  ? `${location.protocol}//127.0.0.1${location.port ? `:${location.port}` : ''}`
  : location.origin}/callback.html`;

const SPOTIFY_CLIENT_ID = /^[A-Za-z0-9]{32}$/;

const SPOTIFY_SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-library-read',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-top-read',
].join(' ');

const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/youtube.readonly';

const read = (k, d = null) => {
  try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; }
};
const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch {} };

/**
 * The one email for this device. Purely a local identity tag (shown in the
 * stats overlay) — it authenticates nothing. All logins are official OAuth
 * against Spotify / Google; there is deliberately no custom OTP/code login.
 */
export const account = {
  email: () => read(LS.email, ''),
  setEmail: (v) => write(LS.email, String(v || '').trim() || null),
};

/* ---------- PKCE helpers ---------- */
function randomString(len = 96) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}
async function s256(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Open a popup and resolve with the message posted back by callback.html. */
function popupAuth(url, name) {
  return new Promise((resolve, reject) => {
    const w = 520, h = 700;
    // window.top is cross-origin when the app is embedded in a preview iframe,
    // so reading its geometry can throw — fall back to this window's screen.
    let x = 0, y = 0;
    try {
      const ref = window.top.outerWidth ? window.top : window;
      y = ref.outerHeight / 2 + ref.screenY - h / 2;
      x = ref.outerWidth / 2 + ref.screenX - w / 2;
    } catch {
      y = Math.max(0, (screen.height - h) / 2);
      x = Math.max(0, (screen.width - w) / 2);
    }
    const win = window.open(url, name, `popup=yes,width=${w},height=${h},top=${Math.round(y)},left=${Math.round(x)}`);
    if (!win) {
      // Popup blocked. Break out of the iframe if we're in one, else redirect.
      try { (window.top || window).location.href = url; } catch { location.href = url; }
      return;
    }

    let receivedMessage = false;
    const onMsg = (ev) => {
      if (ev.origin !== location.origin) return;
      const d = ev.data;
      if (!d || d.type !== 'mpv-web-auth') return;
      receivedMessage = true;
      cleanup();
      d.error ? reject(new Error(d.error)) : resolve(d);
    };
    const timer = setInterval(() => {
      if (win.closed) {
        cleanup();
        if (!receivedMessage) {
          reject(new Error(`Sign-in window closed before returning a result. Check that the registered redirect URI exactly matches ${REDIRECT_URI}.`));
        }
      }
    }, 600);
    function cleanup() { clearInterval(timer); window.removeEventListener('message', onMsg); try { win.close(); } catch {} }
    window.addEventListener('message', onMsg);
  });
}

/* =================== SPOTIFY =================== */
export const spotify = {
  clientId: () => read(LS.spClient, ''),
  setClientId: (id) => write(LS.spClient, id.trim() || null),
  session: () => readJSON(LS.spTok),

  isAuthed() {
    const s = this.session ? this.session() : readJSON(LS.spTok);
    return Boolean(s && s.refresh_token);
  },

  async login() {
    const clientId = read(LS.spClient, '');
    if (!clientId) throw new Error('Set a Spotify Client ID first (accounts tab).');
    if (!SPOTIFY_CLIENT_ID.test(clientId)) {
      throw new Error('Spotify Client ID must be exactly 32 letters and numbers. Use the Client ID, not the Client Secret or app URL.');
    }
    const verifier = randomString();
    write(LS.spVer, verifier);
    const url = new URL('https://accounts.spotify.com/authorize');
    url.search = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      code_challenge_method: 'S256',
      code_challenge: await s256(verifier),
      state: 'sp:' + randomString(8),
      scope: SPOTIFY_SCOPES,
    }).toString();

    const res = await popupAuth(url.toString(), 'spotify-auth');
    return this.exchange(res.code);
  },

  async exchange(code) {
    const verifier = read(LS.spVer, '');
    const body = new URLSearchParams({
      client_id: read(LS.spClient, ''),
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    });
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error_description || j.error || 'token_exchange_failed');
    j.expires_at = Date.now() + (j.expires_in - 60) * 1000;
    write(LS.spTok, j);
    write(LS.spVer, null);
    return j;
  },

  async token() {
    let s = readJSON(LS.spTok);
    if (!s) return null;
    if (Date.now() < (s.expires_at || 0)) return s.access_token;
    if (!s.refresh_token) return null;
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: read(LS.spClient, ''),
        grant_type: 'refresh_token',
        refresh_token: s.refresh_token,
      }),
    });
    const j = await r.json();
    if (!r.ok) { write(LS.spTok, null); return null; }
    j.refresh_token = j.refresh_token || s.refresh_token;
    j.expires_at = Date.now() + (j.expires_in - 60) * 1000;
    write(LS.spTok, j);
    return j.access_token;
  },

  logout() { write(LS.spTok, null); },

  /** Thin Web API wrapper that always attaches a fresh token. */
  async api(path, opts = {}) {
    const tok = await this.token();
    if (!tok) throw new Error('spotify_not_authed');
    const url = path.startsWith('http') ? path : `https://api.spotify.com/v1${path}`;
    const r = await fetch(url, {
      ...opts,
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    if (r.status === 204) return null;
    const text = await r.text();
    const data = text ? JSON.parse(text) : null;
    if (!r.ok) throw new Error(data?.error?.message || `spotify_http_${r.status}`);
    return data;
  },
};

/* =================== YOUTUBE / GOOGLE =================== */
export const youtube = {
  clientId: () => read(LS.ytClient, ''),
  setClientId: (id) => write(LS.ytClient, id.trim() || null),
  apiKey: () => read(LS.ytKey, ''),
  setApiKey: (k) => write(LS.ytKey, k.trim() || null),

  session: () => readJSON(LS.ytTok),
  isAuthed() {
    const s = readJSON(LS.ytTok);
    return Boolean(s && s.access_token && Date.now() < s.expires_at);
  },

  async login() {
    const clientId = read(LS.ytClient, '');
    if (!clientId) throw new Error('Set a Google OAuth Client ID first (accounts tab).');
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'token',
      scope: GOOGLE_SCOPES,
      include_granted_scopes: 'true',
      state: 'yt:' + randomString(8),
      prompt: 'consent',
    }).toString();

    const res = await popupAuth(url.toString(), 'google-auth');
    if (!res.accessToken) throw new Error('no_token_returned');
    const sess = {
      access_token: res.accessToken,
      expires_at: Date.now() + (Number(res.expiresIn || 3600) - 60) * 1000,
    };
    write(LS.ytTok, sess);
    return sess;
  },

  token() {
    const s = readJSON(LS.ytTok);
    return s && Date.now() < s.expires_at ? s.access_token : null;
  },

  logout() { write(LS.ytTok, null); },

  /**
   * Call the Data API with whichever credential exists:
   * OAuth token > user API key > server-side key proxy.
   */
  async api(path, params = {}) {
    const tok = this.token();
    const key = this.apiKey();
    const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
    Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));

    if (!tok && !key) {
      if (path !== 'search') throw new Error('youtube_not_authed');
      const r = await fetch(`/api/youtube/search?q=${encodeURIComponent(params.q || '')}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error === 'no_server_key' ? 'youtube_no_credentials' : 'youtube_search_failed');
      return j;
    }
    if (!tok && key) url.searchParams.set('key', key);

    const r = await fetch(url, tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message || `youtube_http_${r.status}`);
    return j;
  },
};

/** Consume an auth result stashed by callback.html when the popup was blocked. */
export async function consumePendingRedirect() {
  let raw = null;
  try { raw = sessionStorage.getItem('mpvweb.pendingAuth'); sessionStorage.removeItem('mpvweb.pendingAuth'); } catch {}
  if (!raw) return null;
  const d = JSON.parse(raw);
  if (d.error) return { provider: d.provider, error: d.error };
  if (d.provider === 'spotify' && d.code) { await spotify.exchange(d.code); return { provider: 'spotify' }; }
  if (d.provider === 'youtube' && d.accessToken) {
    write(LS.ytTok, { access_token: d.accessToken, expires_at: Date.now() + (Number(d.expiresIn || 3600) - 60) * 1000 });
    return { provider: 'youtube' };
  }
  return null;
}

/** Seed client IDs from server env if the user hasn't set their own. */
export async function bootstrapConfig() {
  try {
    const r = await fetch('/api/config');
    const c = await r.json();
    if (c.spotifyClientId && !read(LS.spClient)) write(LS.spClient, c.spotifyClientId);
    if (c.googleClientId && !read(LS.ytClient)) write(LS.ytClient, c.googleClientId);
    return c;
  } catch { return { hasServerYoutubeKey: false }; }
}
