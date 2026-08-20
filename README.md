# mpv-web — Version 1.1.3

An **mpv-style** player for the browser (and as a Windows `.exe`). Black canvas, monospace OSD, no chrome, everything on the keyboard — media from **Spotify**, **YouTube**, or local files.

```
 space/k  pause      < >    prev/next     /      search
 ← →      ±5s        0-9    seek %        :      console
 ↑ ↓      volume     f      fullscreen    Tab    playlist
 [ ]      speed      L      loop          ?      help
 Shift+I  stats      m      mute          q/Esc  stop
 Ctrl+S   search (capture phase — no Save dialog, no shuffle)
 s        shuffle   Esc / ← Back  back to main screen (even if search is focused)
```

## Version 1.1.3 (this file — check the stamp before installing)

- **Apple-Inspired Opening Screen:** Replaced static idle page with a modern animated "WAZZUPPP" hero greeting.
- **Electron OAuth Popup Window Support:** Enabled Electron child popup windows for Spotify and Google authentication flow.
- **Google PKCE Flow:** Upgraded Google OAuth to PKCE Authorization Code flow (`response_type=code`) resolving `Error 400: unsupported_response_type`.
- **IP Loopback & Fallback Improvements:** Standardized loopback handling (`127.0.0.1`) and context Uri playback fallback for Spotify tracks.

- **Correct Server Port Output:** `server.js` now dynamically logs the actual configured `PORT` rather than hardcoding port 3001.
- **Cross-Host OAuth Popup Reliability:** `callback.html` and `auth.js` safely accept postMessages between `localhost` and `127.0.0.1` origin variations so local authorization popups complete smoothly.
- **Full Spotify Album Support:** Loading Spotify album links now correctly retrieves high-resolution album artwork and attaches album context for playback.
- **Seamless Search-to-Playback Focus:** Playing search results automatically returns focus to the stage so player keybindings (`space`, `f`, `m`, `arrows`) work instantly.
- **Robust Track End & Speed Controls:** Spotify track end detection and YouTube playback rate persistence across video loads have been strengthened.

## Version 1.1.1

- **Stable keyboard navigation:** the closed side panel is now inert, list selection scrolls only its own list, and keyboard shortcuts no longer shift the whole player sideways.
- **Diagnosable OAuth failures:** the callback page shows provider errors and the exact redirect URI required; closing an incomplete Spotify/Google sign-in now reports the same actionable hint instead of `window_closed`.
- **Helpful direct-file fallback:** asset paths are relative, and opening `public/index.html` over `file://` explains that browser CORS rules require starting the local server instead of showing a blank page.
- **Zero-dependency browser server:** `node server.js` now works from a clean clone using Node's built-in HTTP server. The Electron wrapper uses the same server unchanged.

## Version 1.1.0

- **Ctrl+S / Cmd+S** opens **search** in the **capture phase**: no more browser Save dialog, and it never shuffles. Bare **S** still shuffles the playlist.
- **Esc** and **← Back** (top-left button + the button in the panel header) return to the main screen even when the search box is focused.
- **Accounts** pane: one **email** + **Continue with Spotify** / **Continue with Google** — official OAuth (Spotify PKCE, Google OAuth 2.0), no custom OTP/code login.
- **Electron:** `npm run build:win` → **`dist/mpv-web-portable.exe`**.
- **`npm start`** serves `public/` (the mpv-web player). The Secret Santa page was removed in 1.0.0 and stays removed.

## Run in a browser

```bash
git clone https://github.com/MAVERICKx1902/SECRET-Santa.git
cd SECRET-Santa
git fetch origin
git checkout main
git pull origin main
node server.js     # http://localhost:3000
```

Then hard-refresh the browser (Ctrl+Shift+R) and press **Ctrl+S** to open search.

## Windows `.exe` (build on your PC)

This sandbox cannot download the Electron runtime. On a **Windows** machine with [Node.js 18+](https://nodejs.org/):

```bash
git clone https://github.com/MAVERICKx1902/SECRET-Santa.git
cd SECRET-Santa
git fetch origin
git checkout main
git pull origin main
npm install
npm run build:win
```

Then open the **`dist/`** folder:

| File | What it is |
|---|---|
| **`mpv-web-portable.exe`** | Double-click — no installer. This is the file to copy/share. |
| `mpv-web Setup x.x.x.exe` | Optional installer |

Try the desktop window without packaging:

```bash
npm run desktop
```

The `.exe` starts the same local server and opens it in a frameless window. Register this redirect URI in Spotify / Google:

`http://localhost:3000/callback.html`

## Sign in

Open the app, press <kbd>Tab</kbd> → **accounts**. Enter one **email** for this device, then **Continue with Spotify** / **Continue with Google**. You need a client ID per service. Both are free. Everything is browser-side: **no client secrets, no tokens on the server, no custom OTP.**

### Spotify

1. <https://developer.spotify.com/dashboard> → **Create app**
2. Add the redirect URI shown in the accounts pane — typically `http://localhost:3000/callback.html`
3. Copy the **Client ID** into the app, click **Continue with Spotify**

Uses **Authorization Code + PKCE**. In-browser playback requires **Spotify Premium**. Free accounts can still search and browse.

### YouTube

Playback works **signed out** — paste any video/playlist URL and it plays. Sign in only if you want to search or pull in your playlists.

1. <https://console.cloud.google.com> → enable **YouTube Data API v3**
2. **Credentials** → OAuth client ID → *Web application* → add the same redirect URI
3. Copy the **Client ID** into the app, click **Continue with Google**

Optionally paste a **YouTube Data API key** instead of signing in, if you only want search.

### Optional server-side defaults

```bash
SPOTIFY_CLIENT_ID=... GOOGLE_CLIENT_ID=... YOUTUBE_API_KEY=... npm start
```

## What you get

- **One transport for both services.** Spotify tracks and YouTube videos sit in the same playlist.
- **mpv keybindings**, drag & drop of URLs and files.
- **Command console** (`:`) — `loadfile <url>`, `seek 30`, `set volume 70`, `set speed 1.5`, `playlist-next`, `shuffle`, `login spotify`, `quit`.
- **Stats overlay** (Shift+I).
- **Local files** — open or drop any video/audio, no account.

## Limits

- Spotify playback needs Premium; speed control is not supported by their SDK.
- YouTube playback uses the IFrame API (ads/restrictions apply).
- Tokens live in `localStorage`.
