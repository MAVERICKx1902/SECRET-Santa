/**
 * mpv-web — tiny static server + optional YouTube search proxy.
 *
 * All OAuth happens in the browser (Spotify PKCE / Google Identity Services),
 * so this server never sees or stores a user token or a client secret.
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');

// Never let the preview/iframe be blocked, and keep the SDKs happy.
app.use((req, res, next) => {
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use(
  express.static(path.join(__dirname, 'public'), {
    extensions: ['html'],
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    },
  })
);

/**
 * Public, non-secret bootstrap config. Client IDs are public by design in
 * PKCE / implicit flows; they can also be typed into the in-app settings pane.
 */
app.get('/api/config', (req, res) => {
  res.json({
    spotifyClientId: process.env.SPOTIFY_CLIENT_ID || '',
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    hasServerYoutubeKey: Boolean(process.env.YOUTUBE_API_KEY),
  });
});

/** Optional: search YouTube without signing into Google, using a server-side key. */
app.get('/api/youtube/search', async (req, res) => {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return res.status(501).json({ error: 'no_server_key' });
  const q = String(req.query.q || '').slice(0, 200);
  if (!q) return res.status(400).json({ error: 'missing_query' });

  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  url.searchParams.set('maxResults', '25');
  url.searchParams.set('videoEmbeddable', 'true');
  url.searchParams.set('q', q);
  url.searchParams.set('key', key);

  try {
    const r = await fetch(url);
    const body = await r.json();
    res.status(r.status).json(body);
  } catch (err) {
    res.status(502).json({ error: 'upstream_failed', detail: String(err) });
  }
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Secret Santa listening on http://0.0.0.0:${PORT}`);
});
