/**
 * mpv-web — the shell that ties auth + backends into one keyboard-driven player.
 */
import { spotify, youtube, account, bootstrapConfig, consumePendingRedirect, REDIRECT_URI } from './auth.js';
import { YouTubeBackend, SpotifyBackend, LocalBackend } from './players.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ---------------- state ---------------- */
const state = {
  playlist: [],
  index: -1,
  backend: null,
  volume: 1,
  muted: false,
  speed: 1,
  loop: false,
  sel: 0,
  results: [],
  resultSel: 0,
  lastLatency: null,
};

const backends = {};
const el = {
  stage: $('#stage'), yt: $('#yt-host'), local: $('#local-host'), art: $('#art-host'),
  artImg: $('#art-img'), artT: $('#art-meta .t'), artA: $('#art-meta .a'),
  idle: $('#idle'), osd: $('#osd'), stats: $('#stats'), panel: $('#panel'),
  playlist: $('#playlist'), results: $('#results'), console: $('#console'),
  consoleInput: $('#console-input'), log: $('#log'), help: $('#help'),
  seek: $('#seek'), fill: $('#seek .fill'), buf: $('#seek .buf'), knob: $('#seek .knob'),
  tPos: $('#t-pos'), tDur: $('#t-dur'), now: $('#now'), osc: $('#osc'),
  bPlay: $('#b-play'), video: $('#local-video'),
};

/* ---------------- utils ---------------- */
function fmt(sec, long = false) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  const p = (n) => String(n).padStart(2, '0');
  return h || long ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

/** Keep a selected row visible without allowing the browser to scroll #stage. */
function scrollRowIntoView(container, row) {
  if (!container || !row) return;
  const rowTop = row.offsetTop;
  const rowBottom = rowTop + row.offsetHeight;
  const viewTop = container.scrollTop;
  const viewBottom = viewTop + container.clientHeight;

  if (rowTop < viewTop) container.scrollTop = rowTop;
  else if (rowBottom > viewBottom) container.scrollTop = rowBottom - container.clientHeight;
}

let osdTimer;
function osd(text, ms = 1600) {
  el.osd.textContent = text;
  el.osd.classList.add('show');
  clearTimeout(osdTimer);
  osdTimer = setTimeout(() => el.osd.classList.remove('show'), ms);
}

function logLine(msg, cls = '') {
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = msg;
  el.log.appendChild(d);
  el.log.scrollTop = el.log.scrollHeight;
}

function notify(kind, msg) {
  if (kind === 'error') { osd('ERROR: ' + msg, 4000); logLine('[error] ' + msg, 'e'); }
  else if (kind === 'warn') { osd(msg, 2500); logLine('[warn] ' + msg); }
}

/* ---------------- backend plumbing ---------------- */
function getBackend(kind) {
  if (backends[kind]) return backends[kind];
  if (kind === 'youtube') backends.youtube = new YouTubeBackend('yt-player', onTrackEnd, notify);
  if (kind === 'spotify') backends.spotify = new SpotifyBackend(onTrackEnd, notify);
  if (kind === 'local') backends.local = new LocalBackend(el.video, onTrackEnd, notify);
  return backends[kind];
}

function showHost(kind) {
  el.yt.classList.toggle('on', kind === 'youtube');
  el.local.classList.toggle('on', kind === 'local');
  el.art.classList.toggle('on', kind === 'spotify');
  el.idle.classList.toggle('off', Boolean(kind));
  // Dim the ambient wash behind video so it doesn't wash out the picture.
  el.stage.classList.toggle('has-video', kind === 'youtube' || kind === 'local');
}

/**
 * Pull three dominant colours out of the artwork and feed them to the
 * ambient layer, so the frosted panels refract the current track's palette.
 */
const paletteCache = new Map();
function tintFromArt(src) {
  if (!src) return;
  if (paletteCache.has(src)) return applyTint(paletteCache.get(src));

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const n = 24;
      const c = document.createElement('canvas');
      c.width = c.height = n;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, n, n);
      const { data } = ctx.getImageData(0, 0, n, n);

      // Bucket by hue, keep reasonably saturated/bright pixels.
      const buckets = new Map();
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx < 40 || mx - mn < 24) continue;
        const key = `${Math.round(r / 48)},${Math.round(g / 48)},${Math.round(b / 48)}`;
        const e = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
        e.r += r; e.g += g; e.b += b; e.n++;
        buckets.set(key, e);
      }
      const top = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, 3)
        .map((e) => `rgb(${Math.round(e.r / e.n)},${Math.round(e.g / e.n)},${Math.round(e.b / e.n)})`);
      if (!top.length) return;
      while (top.length < 3) top.push(top[top.length - 1]);
      paletteCache.set(src, top);
      applyTint(top);
    } catch {
      /* tainted canvas (no CORS header) — keep the default palette */
    }
  };
  img.src = src;
}

function applyTint([a, b, c]) {
  const s = document.documentElement.style;
  s.setProperty('--amb1', a);
  s.setProperty('--amb2', b);
  s.setProperty('--amb3', c);
}

function onTrackEnd() {
  if (state.loop) { state.backend?.seek(0); state.backend?.play(); return; }
  next();
}

/* ---------------- playlist ---------------- */
function addItems(items, { play = false } = {}) {
  if (!items.length) return;
  const start = state.playlist.length;
  state.playlist.push(...items);
  renderPlaylist();
  if (play) playIndex(start);
  else osd(`Added ${items.length} item${items.length > 1 ? 's' : ''} to playlist`);
}

async function playIndex(i) {
  if (i < 0 || i >= state.playlist.length) return;
  const item = state.playlist[i];
  state.index = i;
  state.sel = i;

  const t0 = performance.now();
  try {
    // Only one backend renders at a time — stop the previous one.
    if (state.backend && state.backend.name !== item.source) state.backend.stop();
    const b = getBackend(item.source);
    state.backend = b;
    showHost(item.source);

    if (item.source === 'spotify') {
      el.artImg.src = item.art || '';
      el.artT.textContent = item.title;
      el.artA.textContent = item.subtitle || '';
    }
    tintFromArt(item.art);

    await b.load(item);
    b.setVolume(state.muted ? 0 : state.volume);
    if (b.name !== 'spotify') b.setSpeed(state.speed);

    state.lastLatency = Math.round(performance.now() - t0);
    el.now.innerHTML = `<b>${escapeHTML(item.title)}</b>${item.subtitle ? ' — ' + escapeHTML(item.subtitle) : ''}`;
    osd(`Playing: ${item.title}`);
    renderPlaylist();
  } catch (err) {
    const msg = String(err.message || err);
    if (msg.includes('not_authed')) notify('error', `Sign into ${item.source} first (Tab → accounts).`);
    else notify('error', msg);
  }
}

function next() {
  if (state.index + 1 < state.playlist.length) playIndex(state.index + 1);
  else { osd('End of playlist'); state.backend?.pause(); }
}
function prev() {
  const st = state.backend?.state();
  if (st && st.position > 3) { state.backend.seek(0); return; }
  if (state.index > 0) playIndex(state.index - 1);
}

function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderPlaylist() {
  const list = el.playlist;
  if (!state.playlist.length) {
    list.innerHTML = `<div class="empty">Playlist is empty.<br>Paste a URL above, press <b>/</b> to search, or open a local file from the accounts tab.</div>`;
    $('#pl-count').textContent = '0 items';
    return;
  }
  list.innerHTML = state.playlist.map((it, i) => `
    <div class="row ${i === state.sel ? 'sel' : ''} ${i === state.index ? 'playing' : ''}" data-i="${i}">
      <img src="${escapeHTML(it.art || '')}" alt="" onerror="this.style.visibility='hidden'">
      <div class="meta">
        <div class="t">${escapeHTML(it.title)}</div>
        <div class="s">${escapeHTML(it.subtitle || '')}</div>
      </div>
      <span class="src">${it.source === 'spotify' ? 'SP' : it.source === 'youtube' ? 'YT' : 'FILE'}</span>
    </div>`).join('');
  $('#pl-count').textContent = `${state.playlist.length} item${state.playlist.length > 1 ? 's' : ''}`;
  list.querySelectorAll('.row').forEach((r) => {
    r.onclick = () => playIndex(Number(r.dataset.i));
  });
  scrollRowIntoView(list, list.querySelector('.row.sel'));
}

/* ---------------- URL parsing ---------------- */
function parseURL(raw) {
  const s = raw.trim();
  if (!s) return null;

  // Spotify URI or link
  let m = s.match(/spotify[:/]+(track|playlist|album)[:/]+([A-Za-z0-9]+)/);
  if (m) return { kind: 'spotify', type: m[1], id: m[2] };

  // YouTube
  m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
  if (m) return { kind: 'youtube', type: 'video', id: m[1] };
  m = s.match(/[?&]list=([\w-]+)/);
  if (m) return { kind: 'youtube', type: 'playlist', id: m[1] };
  if (/^[\w-]{11}$/.test(s)) return { kind: 'youtube', type: 'video', id: s };

  return null;
}

async function loadURL(raw, { play = true } = {}) {
  const p = parseURL(raw);
  if (!p) { notify('error', 'Unrecognized URL. Paste a YouTube or Spotify link.'); return; }

  if (p.kind === 'youtube' && p.type === 'video') {
    let item = { source: 'youtube', id: p.id, title: `YouTube ${p.id}`, subtitle: '', art: `https://i.ytimg.com/vi/${p.id}/default.jpg` };
    try {
      const d = await youtube.api('videos', { part: 'snippet', id: p.id });
      const v = d.items?.[0];
      if (v) item = { ...item, title: v.snippet.title, subtitle: v.snippet.channelTitle, art: v.snippet.thumbnails?.default?.url };
    } catch {}
    addItems([item], { play });
    return;
  }

  if (p.kind === 'youtube' && p.type === 'playlist') {
    const d = await youtube.api('playlistItems', { part: 'snippet', playlistId: p.id, maxResults: 50 });
    const items = (d.items || [])
      .filter((i) => i.snippet?.resourceId?.videoId)
      .map((i) => ({
        source: 'youtube', id: i.snippet.resourceId.videoId, title: i.snippet.title,
        subtitle: i.snippet.videoOwnerChannelTitle || '', art: i.snippet.thumbnails?.default?.url,
      }));
    addItems(items, { play });
    return;
  }

  if (p.kind === 'spotify' && p.type === 'track') {
    const t = await spotify.api(`/tracks/${p.id}`);
    addItems([trackToItem(t)], { play });
    return;
  }

  if (p.kind === 'spotify') {
    const path = p.type === 'album' ? `/albums/${p.id}/tracks?limit=50` : `/playlists/${p.id}/tracks?limit=50`;
    const d = await spotify.api(path);
    const items = (d.items || [])
      .map((row) => (p.type === 'album' ? row : row.track))
      .filter(Boolean)
      .map((t) => trackToItem(t, p.type === 'album' ? null : `spotify:playlist:${p.id}`));
    addItems(items, { play });
  }
}

function trackToItem(t, contextUri = null) {
  return {
    source: 'spotify',
    uri: t.uri,
    contextUri,
    id: t.id,
    title: t.name,
    subtitle: (t.artists || []).map((a) => a.name).join(', '),
    art: t.album?.images?.slice(-1)[0]?.url || t.album?.images?.[0]?.url || '',
    duration: (t.duration_ms || 0) / 1000,
  };
}

/* ---------------- search ---------------- */
let searchTimer;
async function runSearch(q) {
  if (!q.trim()) { el.results.innerHTML = '<div class="empty">Type to search.</div>'; return; }
  const src = $('#search-src').value;
  el.results.innerHTML = '<div class="empty">searching…</div>';
  const out = [];

  const wantSpotify = src === 'spotify' || (src === 'auto' && spotify.isAuthed());
  const wantYouTube = src === 'youtube' || src === 'auto';

  const jobs = [];
  if (wantSpotify) {
    jobs.push(spotify.api(`/search?type=track&limit=15&q=${encodeURIComponent(q)}`)
      .then((d) => (d.tracks?.items || []).forEach((t) => out.push(trackToItem(t))))
      .catch((e) => logLine('[spotify] ' + e.message, 'e')));
  }
  if (wantYouTube) {
    jobs.push(youtube.api('search', { part: 'snippet', type: 'video', maxResults: 15, videoEmbeddable: 'true', q })
      .then((d) => (d.items || []).forEach((v) => out.push({
        source: 'youtube', id: v.id.videoId, title: decodeEntities(v.snippet.title),
        subtitle: v.snippet.channelTitle, art: v.snippet.thumbnails?.default?.url,
      })))
      .catch((e) => logLine('[youtube] ' + e.message, 'e')));
  }
  await Promise.all(jobs);

  state.results = out;
  state.resultSel = 0;
  if (!out.length) {
    el.results.innerHTML = `<div class="empty">No results.<br>Search needs Spotify sign-in, or a Google sign-in / YouTube API key (accounts tab).</div>`;
    return;
  }
  renderResults();
}

function decodeEntities(s) {
  const t = document.createElement('textarea');
  t.innerHTML = s;
  return t.value;
}

function renderResults() {
  el.results.innerHTML = state.results.map((it, i) => `
    <div class="row ${i === state.resultSel ? 'sel' : ''}" data-i="${i}">
      <img src="${escapeHTML(it.art || '')}" alt="" onerror="this.style.visibility='hidden'">
      <div class="meta">
        <div class="t">${escapeHTML(it.title)}</div>
        <div class="s">${escapeHTML(it.subtitle || '')}</div>
      </div>
      <span class="src">${it.source === 'spotify' ? 'SP' : 'YT'}</span>
    </div>`).join('');
  el.results.querySelectorAll('.row').forEach((r) => {
    r.onclick = (ev) => {
      const it = state.results[Number(r.dataset.i)];
      ev.shiftKey ? addItems([it]) : addItems([it], { play: true });
    };
  });
}

/* ---------------- transport helpers ---------------- */
function seekRel(delta) {
  const st = state.backend?.state();
  if (!st) return;
  const target = Math.max(0, Math.min(st.position + delta, st.duration || Infinity));
  state.backend.seek(target);
  osd(`${delta > 0 ? '+' : ''}${delta}s  ${fmt(target)} / ${fmt(st.duration)}`);
}
function seekPercent(pct) {
  const st = state.backend?.state();
  if (!st || !st.duration) return;
  state.backend.seek((pct / 100) * st.duration);
  osd(`Seek ${pct}%`);
}
function setVolume(v) {
  state.volume = Math.max(0, Math.min(1, v));
  state.muted = false;
  state.backend?.setVolume(state.volume);
  osd(`Volume: ${Math.round(state.volume * 100)}`);
}
function toggleMute() {
  state.muted = !state.muted;
  state.backend?.setMuted(state.muted);
  osd(state.muted ? 'Mute: yes' : `Mute: no (${Math.round(state.volume * 100)})`);
}
function setSpeed(n) {
  state.speed = Math.max(0.25, Math.min(4, Number(n.toFixed(2))));
  state.backend?.setSpeed(state.speed);
  osd(`Speed: ${state.speed.toFixed(2)}x`);
}
function toggleFullscreen() {
  document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
}
function togglePanel(force) {
  const open = force ?? !el.panel.classList.contains('open');
  el.panel.classList.toggle('open', open);
}
function shuffle() {
  const cur = state.playlist[state.index];
  for (let i = state.playlist.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.playlist[i], state.playlist[j]] = [state.playlist[j], state.playlist[i]];
  }
  state.index = cur ? state.playlist.indexOf(cur) : -1;
  renderPlaylist();
  osd('Playlist shuffled');
}

/* ---------------- render loop ---------------- */
function tick() {
  const st = state.backend?.state();
  if (st) {
    const pct = st.duration ? (st.position / st.duration) * 100 : 0;
    el.fill.style.width = pct + '%';
    el.knob.style.left = pct + '%';
    el.buf.style.width = (st.buffered || 0) * 100 + '%';
    el.tPos.textContent = fmt(st.position);
    el.tDur.textContent = fmt(st.duration);
    el.bPlay.innerHTML = st.paused ? '&#9654;' : '&#10073;&#10073;';

    if (state.backend.name === 'spotify' && st.track) {
      const cur = state.playlist[state.index];
      if (!cur || cur.uri !== st.track.uri) {
        const cover = st.track.album?.images?.[0]?.url || '';
        el.artImg.src = cover;
        tintFromArt(cover);
        el.artT.textContent = st.track.name;
        el.artA.textContent = st.track.artists.map((a) => a.name).join(', ');
        el.now.innerHTML = `<b>${escapeHTML(st.track.name)}</b> — ${escapeHTML(st.track.artists.map((a) => a.name).join(', '))}`;
      }
    }

    if (el.stats.classList.contains('on')) {
      $('#st-backend').textContent = state.backend.name;
      $('#st-title').textContent = (state.playlist[state.index]?.title || '—').slice(0, 42);
      $('#st-pos').textContent = `${fmt(st.position, true)} / ${fmt(st.duration, true)}`;
      $('#st-speed').textContent = st.speed.toFixed(2) + 'x';
      $('#st-vol').textContent = state.muted ? 'muted' : Math.round(state.volume * 100);
      $('#st-pl').textContent = `${state.index + 1} / ${state.playlist.length}`;
      $('#st-loop').textContent = state.loop ? 'yes' : 'no';
      $('#st-video').textContent = st.hasVideo ? 'yes' : 'no (audio only)';
      $('#st-lat').textContent = state.lastLatency != null ? state.lastLatency + ' ms' : '—';
      $('#st-acct').textContent = ([spotify.isAuthed() && 'spotify', youtube.isAuthed() && 'google'].filter(Boolean).join(', ') || 'none') + (account.email() ? ' \u00b7 ' + account.email() : '');
    }
  }
  requestAnimationFrame(tick);
}

/* ---------------- keybindings ---------------- */
function typing(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
}

function openSearch() {
  togglePanel(true);
  showPane('search');
  setTimeout(() => { const inp = $('#search-input'); inp.focus(); inp.select(); }, 60);
}

/**
 * Back to the main screen: close whatever overlay is on top (console → help
 * → panel) and drop focus from any input — works even if the search box is
 * focused.
 */
function goBack() {
  if (el.console.classList.contains('on')) closeConsole();
  else if (el.help.classList.contains('on')) el.help.classList.remove('on');
  else if (el.panel.classList.contains('open')) togglePanel(false);
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT')) a.blur();
}

/**
 * Ctrl+S / Cmd+S opens search. Registered in the CAPTURE phase so it wins
 * over the browser's Save Page default and over the bubble handler below
 * (where bare 's' shuffles). Ctrl+S must never shuffle.
 */
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    e.stopPropagation();
    openSearch();
  }
}, true);

document.addEventListener('keydown', (e) => {
  if (el.console.classList.contains('on') && e.target === el.consoleInput) {
    if (e.key === 'Escape') { closeConsole(); e.preventDefault(); }
    if (e.key === 'Enter') { runCommand(el.consoleInput.value); el.consoleInput.value = ''; e.preventDefault(); }
    return;
  }

  // Result / playlist list navigation while a search box is focused.
  if (typing(e)) {
    if (e.key === 'Escape') {
      // Back to the main screen even if search is focused.
      e.target.blur();
      if (el.panel.classList.contains('open')) togglePanel(false);
      return;
    }
    if (e.target.id === 'search-input') {
      if (e.key === 'Enter') {
        const it = state.results[state.resultSel];
        if (it) e.shiftKey ? addItems([it]) : addItems([it], { play: true });
        e.preventDefault(); return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        state.resultSel = Math.max(0, Math.min(state.results.length - 1, state.resultSel + (e.key === 'ArrowDown' ? 1 : -1)));
        renderResults();
        scrollRowIntoView(el.results, el.results.querySelector('.row.sel'));
        e.preventDefault(); return;
      }
    }
    if (e.target.id === 'url-input' && e.key === 'Enter') { addFromInput(); e.preventDefault(); }
    return;
  }

  const k = e.key;
  const shift = e.shiftKey;

  switch (true) {
    case k === ' ' || k === 'k': state.backend?.togglePause(); osd(state.backend?.state()?.paused ? 'Play' : 'Pause', 700); e.preventDefault(); break;
    case k === 'ArrowRight': seekRel(shift ? 1 : 5); e.preventDefault(); break;
    case k === 'ArrowLeft': seekRel(shift ? -1 : -5); e.preventDefault(); break;
    case k === 'l': seekRel(10); break;
    case k === 'j': seekRel(-10); break;
    case k === 'PageUp': seekRel(60); e.preventDefault(); break;
    case k === 'PageDown': seekRel(-60); e.preventDefault(); break;
    case k === 'ArrowUp': setVolume(state.volume + 0.05); e.preventDefault(); break;
    case k === 'ArrowDown': setVolume(state.volume - 0.05); e.preventDefault(); break;
    case k === 'm': toggleMute(); break;
    case k === '>' || (k === '.' && shift): next(); break;
    case k === '<' || (k === ',' && shift): prev(); break;
    case k === '[': setSpeed(state.speed - 0.1); break;
    case k === ']': setSpeed(state.speed + 0.1); break;
    case k === 'Backspace': setSpeed(1); e.preventDefault(); break;
    case k === 'f': toggleFullscreen(); break;
    case k === 'Tab': togglePanel(); e.preventDefault(); break;
    case k === '/': togglePanel(true); showPane('search'); setTimeout(() => $('#search-input').focus(), 60); e.preventDefault(); break;
    case k === ':': openConsole(); e.preventDefault(); break;
    case k === '?': el.help.classList.toggle('on'); break;
    case k === 'I' && shift: el.stats.classList.toggle('on'); break;
    case k === 'L': state.loop = !state.loop; $('#b-loop').classList.toggle('on', state.loop); osd('Loop: ' + (state.loop ? 'yes' : 'no')); break;
    case k === 's' && !e.ctrlKey && !e.metaKey: shuffle(); break;
    case k === 'C' && shift: state.playlist = []; state.index = -1; renderPlaylist(); osd('Playlist cleared'); break;
    case /^[0-9]$/.test(k): seekPercent(Number(k) * 10); break;
    case k === 'Escape' || k === 'q':
      if (el.help.classList.contains('on')) el.help.classList.remove('on');
      else if (el.panel.classList.contains('open')) togglePanel(false);
      else { state.backend?.pause(); osd('Stopped'); }
      break;
  }
});

/* ---------------- console ---------------- */
function openConsole() { el.console.classList.add('on'); el.consoleInput.focus(); }
function closeConsole() { el.console.classList.remove('on'); el.consoleInput.blur(); }

async function runCommand(line) {
  const raw = line.trim();
  if (!raw) return;
  logLine('> ' + raw, 'i');
  const [cmd, ...args] = raw.split(/\s+/);
  const rest = args.join(' ');

  try {
    switch (cmd) {
      case 'loadfile': case 'add': await loadURL(rest, { play: cmd === 'loadfile' }); break;
      case 'seek': seekRel(Number(args[0]) || 0); break;
      case 'set':
        if (args[0] === 'volume') setVolume(Number(args[1]) / 100);
        else if (args[0] === 'speed') setSpeed(Number(args[1]));
        else if (args[0] === 'loop') { state.loop = args[1] !== 'no'; $('#b-loop').classList.toggle('on', state.loop); }
        else logLine('unknown property: ' + args[0], 'e');
        break;
      case 'playlist-next': next(); break;
      case 'playlist-prev': prev(); break;
      case 'playlist-clear': state.playlist = []; state.index = -1; renderPlaylist(); break;
      case 'shuffle': shuffle(); break;
      case 'search': togglePanel(true); showPane('search'); $('#search-input').value = rest; runSearch(rest); break;
      case 'login':
        if (rest === 'spotify') await doSpotifyLogin();
        else if (rest === 'youtube' || rest === 'google') await doYouTubeLogin();
        else logLine('usage: login spotify|youtube', 'e');
        break;
      case 'logout': spotify.logout(); youtube.logout(); refreshAuthUI(); logLine('signed out of everything'); break;
      case 'stop': state.backend?.stop(); break;
      case 'quit': state.backend?.stop(); showHost(null); state.index = -1; closeConsole(); break;
      case 'help': el.help.classList.add('on'); closeConsole(); break;
      default: logLine('unknown command: ' + cmd, 'e');
    }
  } catch (err) {
    logLine('[error] ' + (err.message || err), 'e');
  }
}

/* ---------------- auth UI ---------------- */
async function doSpotifyLogin() {
  const id = $('#sp-client').value.trim();
  if (id) spotify.setClientId(id);
  try {
    await spotify.login();
    osd('Signed into Spotify');
    refreshAuthUI();
    await getBackend('spotify').init().catch((e) => notify('error', e.message));
  } catch (e) {
    notify('error', 'Spotify sign-in: ' + e.message);
  }
}

async function doYouTubeLogin() {
  const id = $('#yt-client').value.trim();
  if (id) youtube.setClientId(id);
  try {
    await youtube.login();
    osd('Signed into Google');
    refreshAuthUI();
  } catch (e) {
    notify('error', 'Google sign-in: ' + e.message);
  }
}

function refreshAuthUI() {
  const sp = spotify.isAuthed(), yt = youtube.isAuthed();
  $('#sp-status').textContent = sp ? 'signed in' : 'signed out';
  $('#sp-status').className = sp ? 'ok' : 'bad';
  $('#yt-status').textContent = yt ? 'signed in' : 'signed out';
  $('#yt-status').className = yt ? 'ok' : 'bad';
  $('#badge-sp').classList.toggle('on', sp);
  $('#badge-yt').classList.toggle('on', yt);
  $('#account-email').value = account.email();
  $('#sp-client').value = spotify.clientId();
  $('#yt-client').value = youtube.clientId();
  $('#yt-key').value = youtube.apiKey();
}

/* ---------------- panel wiring ---------------- */
function showPane(name) {
  $$('#panel .tab[data-pane]').forEach((t) => t.classList.toggle('on', t.dataset.pane === name));
  $$('.pane').forEach((p) => p.classList.toggle('on', p.id === 'pane-' + name));
}

function addFromInput() {
  const v = $('#url-input').value.trim();
  if (!v) return;
  loadURL(v, { play: state.playlist.length === 0 });
  $('#url-input').value = '';
}

function wireUI() {
  $$('#panel .tab[data-pane]').forEach((t) => (t.onclick = () => showPane(t.dataset.pane)));
  $('#panel-close').onclick = () => togglePanel(false);
  $('#back-top').onclick = goBack;
  $('#panel-back').onclick = goBack;

  $('#account-email').onchange = (e) => {
    account.setEmail(e.target.value);
    osd('Email saved: ' + (account.email() || '(cleared)'));
  };
  $('#url-add').onclick = addFromInput;

  $('#search-input').oninput = (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value;
    searchTimer = setTimeout(() => runSearch(q), 350);
  };
  $('#search-src').onchange = () => runSearch($('#search-input').value);

  $('#b-play').onclick = () => state.backend?.togglePause();
  $('#b-next').onclick = next;
  $('#b-prev').onclick = prev;
  $('#b-mute').onclick = toggleMute;
  $('#b-loop').onclick = () => { state.loop = !state.loop; $('#b-loop').classList.toggle('on', state.loop); };
  $('#b-panel').onclick = () => togglePanel();
  $('#b-full').onclick = toggleFullscreen;

  const seekTo = (ev) => {
    const st = state.backend?.state();
    if (!st || !st.duration) return;
    const r = el.seek.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    state.backend.seek(pct * st.duration);
  };
  el.seek.onclick = seekTo;
  el.seek.onmousedown = (e) => {
    seekTo(e);
    const mv = (ev) => seekTo(ev);
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  };

  $('#sp-login').onclick = doSpotifyLogin;
  $('#sp-logout').onclick = () => { spotify.logout(); backends.spotify?.disconnect(); backends.spotify = null; refreshAuthUI(); osd('Signed out of Spotify'); };
  $('#yt-login').onclick = doYouTubeLogin;
  $('#yt-logout').onclick = () => { youtube.logout(); refreshAuthUI(); osd('Signed out of Google'); };
  $('#yt-key').onchange = (e) => { youtube.setApiKey(e.target.value); osd('YouTube API key saved'); };
  $('#sp-client').onchange = (e) => spotify.setClientId(e.target.value);
  $('#yt-client').onchange = (e) => youtube.setClientId(e.target.value);

  $('#yt-mine').onclick = async () => {
    try {
      const d = await youtube.api('playlists', { part: 'snippet,contentDetails', mine: 'true', maxResults: 25 });
      const items = (d.items || []).map((p) => ({ id: p.id, title: p.snippet.title, count: p.contentDetails.itemCount }));
      if (!items.length) { osd('No playlists found'); return; }
      showPane('search');
      state.results = [];
      el.results.innerHTML = items.map((p) => `<div class="row" data-pl="${p.id}">
        <div class="meta"><div class="t">${escapeHTML(p.title)}</div><div class="s">${p.count} videos</div></div>
        <span class="src">YT</span></div>`).join('');
      el.results.querySelectorAll('[data-pl]').forEach((r) => {
        r.onclick = () => loadURL('https://youtube.com/playlist?list=' + r.dataset.pl, { play: true });
      });
    } catch (e) { notify('error', e.message); }
  };

  $('#open-local').onclick = () => $('#file-input').click();
  $('#file-input').onchange = (e) => {
    const items = Array.from(e.target.files).map((f) => ({
      source: 'local', url: URL.createObjectURL(f), title: f.name, subtitle: `${(f.size / 1048576).toFixed(1)} MB`, art: '',
    }));
    addItems(items, { play: true });
  };

  $('#redirect-uri').textContent = REDIRECT_URI;
  $('#copy-uri').onclick = async () => {
    try { await navigator.clipboard.writeText(REDIRECT_URI); osd('Redirect URI copied'); }
    catch { osd('Copy failed — select it manually'); }
  };

  // Auto-hide the OSC + cursor during video playback, mpv style.
  let idleTimer;
  const wake = () => {
    el.osc.classList.remove('hidden');
    el.stage.classList.add('cursor');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      const st = state.backend?.state();
      if (st && !st.paused && st.hasVideo && !el.panel.classList.contains('open') && !el.console.classList.contains('on')) {
        el.osc.classList.add('hidden');
        el.stage.classList.remove('cursor');
      }
    }, 2600);
  };
  ['mousemove', 'mousedown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, wake));
  wake();

  el.stage.addEventListener('click', (ev) => {
    if (ev.target === el.stage || ev.target === el.idle) state.backend?.togglePause();
  });
  el.stage.addEventListener('dblclick', toggleFullscreen);

  // Drag & drop URLs or local files onto the stage.
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const text = e.dataTransfer.getData('text/plain');
    if (text) { loadURL(text, { play: true }); return; }
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) {
      addItems(files.map((f) => ({ source: 'local', url: URL.createObjectURL(f), title: f.name, subtitle: '', art: '' })), { play: true });
    }
  });
}

/* ---------------- boot ---------------- */
(async function boot() {
  wireUI();
  renderPlaylist();
  await bootstrapConfig();

  try {
    const pending = await consumePendingRedirect();
    if (pending && !pending.error) osd(`Signed into ${pending.provider}`);
    if (pending?.error) notify('error', pending.provider + ': ' + pending.error);
  } catch (e) { notify('error', 'auth: ' + e.message); }

  refreshAuthUI();

  // Warm up the Spotify SDK if we already have a session.
  if (spotify.isAuthed()) getBackend('spotify').init().catch(() => {});

  requestAnimationFrame(tick);
  logLine('mpv-web 1.1.1 ready. Type "help" or press ? for keys.');
})();
