# mpv-web

An **mpv-style** player for the browser (and as a Windows `.exe`). Black canvas, monospace OSD, no chrome, everything on the keyboard — media from **Spotify**, **YouTube**, or local files.

```
 space/k  pause      < >    prev/next     /      search
 ← →      ±5s        0-9    seek %        :      console
 ↑ ↓      volume     f      fullscreen    Tab    playlist
 [ ]      speed      L      loop          ?      help
 Shift+I  stats      m      mute          q/Esc  stop
```

## Run in a browser

```bash
npm install
npm start          # http://localhost:3000
```

## Windows `.exe` (build on your PC)

This sandbox cannot download the Electron runtime. On a **Windows** machine with [Node.js 18+](https://nodejs.org/):

```bash
git clone <this-repo>
cd SECRET-Santa
git checkout arena/01a01d46-secret-santa
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

Open the app, press <kbd>Tab</kbd> → **accounts**. You need a client ID per service. Both are free. Everything is browser-side: **no client secrets, no tokens on the server.**

### Spotify

1. <https://developer.spotify.com/dashboard> → **Create app**
2. Add the redirect URI shown in the accounts pane — typically `http://localhost:3000/callback.html`
3. Copy the **Client ID** into the app, click *sign in with spotify*

Uses **Authorization Code + PKCE**. In-browser playback requires **Spotify Premium**. Free accounts can still search and browse.

### YouTube

Playback works **signed out** — paste any video/playlist URL and it plays. Sign in only if you want to search or pull in your playlists.

1. <https://console.cloud.google.com> → enable **YouTube Data API v3**
2. **Credentials** → OAuth client ID → *Web application* → add the same redirect URI
3. Copy the **Client ID** into the app

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
