/**
 * mpv-web — zero-dependency static server + optional YouTube search proxy.
 *
 * All OAuth happens in the browser (Spotify PKCE / Google Identity Services),
 * so this server never sees or stores a user token or a client secret.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
};

function sendJson(req, res, statusCode, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
  });
  if (req.method === 'HEAD') res.end();
  else res.end(body);
}

function sendText(req, res, statusCode, text) {
  const body = Buffer.from(text);
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
  });
  if (req.method === 'HEAD') res.end();
  else res.end(body);
}

function safePublicPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const filePath = path.resolve(PUBLIC_DIR, decoded.replace(/^\/+/, ''));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) return null;
  return filePath;
}

async function findStaticFile(pathname) {
  let filePath = safePublicPath(pathname);
  if (!filePath) return null;

  const candidates = [];
  if (pathname.endsWith('/')) candidates.push(path.join(filePath, 'index.html'));
  else {
    candidates.push(filePath);
    if (!path.extname(filePath)) candidates.push(filePath + '.html');
  }

  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Try the extension/index fallback before returning 404.
    }
  }
  return null;
}

async function serveStatic(req, res, pathname) {
  const filePath = await findStaticFile(pathname);
  if (!filePath) {
    sendText(req, res, 404, 'Not Found\n');
    return;
  }

  const body = await readFile(filePath);
  const headers = {
    'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': body.length,
  };
  if (filePath.endsWith('.html')) headers['Cache-Control'] = 'no-store';
  res.writeHead(200, headers);
  if (req.method === 'HEAD') res.end();
  else res.end(body);
}

async function handleRequest(req, res) {
  // Never let the preview/iframe be blocked, and keep the SDKs happy.
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    sendText(req, res, 405, 'Method Not Allowed\n');
    return;
  }

  const url = new URL(req.url || '/', 'http://localhost');

  /**
   * Public, non-secret bootstrap config. Client IDs are public by design in
   * PKCE / implicit flows; they can also be typed into the in-app settings pane.
   */
  if (url.pathname === '/api/config') {
    sendJson(req, res, 200, {
      spotifyClientId: process.env.SPOTIFY_CLIENT_ID || '',
      googleClientId: process.env.GOOGLE_CLIENT_ID || '',
      hasServerYoutubeKey: Boolean(process.env.YOUTUBE_API_KEY),
    });
    return;
  }

  /** Optional: search YouTube without signing into Google, using a server-side key. */
  if (url.pathname === '/api/youtube/search') {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) {
      sendJson(req, res, 501, { error: 'no_server_key' });
      return;
    }
    const q = String(url.searchParams.get('q') || '').slice(0, 200);
    if (!q) {
      sendJson(req, res, 400, { error: 'missing_query' });
      return;
    }

    const upstream = new URL('https://www.googleapis.com/youtube/v3/search');
    upstream.searchParams.set('part', 'snippet');
    upstream.searchParams.set('type', 'video');
    upstream.searchParams.set('maxResults', '25');
    upstream.searchParams.set('videoEmbeddable', 'true');
    upstream.searchParams.set('q', q);
    upstream.searchParams.set('key', key);

    try {
      const response = await fetch(upstream);
      const body = await response.json();
      sendJson(req, res, response.status, body);
    } catch (err) {
      sendJson(req, res, 502, { error: 'upstream_failed', detail: String(err) });
    }
    return;
  }

  if (url.pathname === '/healthz') {
    sendJson(req, res, 200, { ok: true });
    return;
  }

  await serveStatic(req, res, url.pathname);
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) sendJson(req, res, 500, { error: 'internal_server_error' });
    else res.end();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`mpv-web listening on http://0.0.0.0:${PORT}`);
});
