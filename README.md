# Secret Santa

A local Secret Santa organizer. Add participants, draw names so nobody gets themselves, and let each person reveal only their own assignment.

Organizer password (change it in `index.html`): **`santa123`**

## Use it in a browser (no install)

```bash
npm install
npm start
```

Then open **http://localhost:3000**

1. Click **Organizer Login** → password `santa123`
2. Add everyone, then **Draw Secret Santa Names**
3. Each person logs in with their name and clicks reveal

Data stays in this browser’s `localStorage` (not shared across PCs unless you copy the storage).

## Make a Windows `.exe` (on your PC)

You need [Node.js 18+](https://nodejs.org/) installed on the Windows machine.

```bash
git clone <this-repo>
cd SECRET-Santa
npm install
npm run build:win
```

When it finishes, look in the **`dist/`** folder:

| File | What it is |
|---|---|
| `SecretSanta-portable.exe` | Double-click — no installer. Copy this file anywhere. |
| `Secret Santa Setup x.x.x.exe` | Optional installer (Start Menu shortcut) |

That is the downloadable app: send `SecretSanta-portable.exe` to your PC (or build it *on* the PC).

### Run the desktop app without building

```bash
npm install
npm run desktop
```

### If you are not on Windows

`electron-builder --win` can still produce an `.exe` from macOS/Linux, but the first Windows build downloads a large Electron cache. Easiest path: clone the repo on your Windows PC and run `npm run build:win` there.

## Optional: mpv-style Spotify/YouTube player

The previous media-player front-end is still at **http://localhost:3000/index.html** under `public/` after `npm start`.
