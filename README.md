# mpv-web

An **mpv-style** player for the browser. Black canvas, monospace OSD, no chrome, everything on the keyboard — but the media comes from **your Spotify or YouTube account** (or local files).

```
 space/k  pause      < >    prev/next     /      search
 ← →      ±5s        0-9    seek %        :      console
 ↑ ↓      volume     f      fullscreen    Tab    playlist
 [ ]      speed      L      loop          ?      help
 Shift+I  stats      m      mute          q/Esc  stop
```

## Run

```bash
npm install
npm start          # http://localhost:3000
```

## Sign in

Open the app, press <kbd>Tab</kbd> → **accounts**. You need a client ID per service. Both are free and take ~2 minutes. Everything is browser-side: **no client secrets, no tokens on the server.**

### Spotify

1. <https://developer.spotify.com/dashboard> → **Create app**
2. Add the redirect URI shown in the accounts pane (the *copy* button next to it) — typically `http://localhost:3000/callback.html`
3. Copy the **Client ID** into the app, click *sign in with spotify*

Uses **Authorization Code + PKCE**, so no secret is needed. In-browser playback requires **Spotify Premium** — that's a hard limit of Spotify's Web Playback SDK, not this app. Free accounts can still search and browse.

### YouTube

Playback works **signed out** — paste any video/playlist URL and it plays. Sign in only if you want to search or pull in your own playlists.

1. <https://console.cloud.google.com> → enable **YouTube Data API v3**
2. **Credentials** → OAuth client ID → *Web application* → add the same redirect URI
3. Copy the **Client ID** into the app

Optionally paste a **YouTube Data API key** instead of signing in, if you only want search.

### Optional server-side defaults

Prefill the client IDs so you don't type them each time, and enable keyless search:

```bash
SPOTIFY_CLIENT_ID=... GOOGLE_CLIENT_ID=... YOUTUBE_API_KEY=... npm start
```

## What you get

- **One transport for both services.** Spotify tracks and YouTube videos sit in the same playlist; the right backend loads per item.
- **mpv keybindings** — the ones in the table above, plus drag & drop of URLs and files onto the window.
- **Command console** (<kbd>:</kbd>) — `loadfile <url>`, `seek 30`, `set volume 70`, `set speed 1.5`, `playlist-next`, `shuffle`, `login spotify`, `quit`.
- **Stats overlay** (<kbd>Shift</kbd>+<kbd>I</kbd>) — backend, position, speed, load latency, like mpv's.
- **Audio-only view** for Spotify: cover art centered on black, since there's no video track.
- **Local files** — open or drop any video/audio, no account at all.

## How it fits together

```
public/index.html    shell: stage, OSC, panel, help, console
public/js/auth.js    Spotify PKCE + Google implicit; token storage & API wrappers
public/js/players.js YouTubeBackend / SpotifyBackend / LocalBackend, one interface
public/js/app.js     playlist, keybindings, OSD, search, render loop
server.js            static host + optional YouTube search proxy
```

Each backend implements `load / play / pause / seek / setVolume / setSpeed / state()`, so `app.js` never branches on which service is playing.

## Limits worth knowing

- Spotify playback needs Premium, and speed control isn't supported by their SDK.
- YouTube playback goes through the IFrame API, so YouTube's own ads/restrictions apply and some videos are not embeddable.
- Tokens live in `localStorage` — signing out clears them.
