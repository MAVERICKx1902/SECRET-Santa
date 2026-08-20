/**
 * Three backends behind one mpv-ish interface:
 *   load(item) play() pause() togglePause() seek(sec) setVolume(0..1)
 *   setSpeed(n) state() -> {position, duration, paused, ...}
 */
import { spotify } from './auth.js';

const loadScript = (src) => new Promise((res, rej) => {
  if (document.querySelector(`script[src="${src}"]`)) return res();
  const s = document.createElement('script');
  s.src = src; s.async = true; s.onload = res; s.onerror = () => rej(new Error('script_failed: ' + src));
  document.head.appendChild(s);
});

/* ===================== YOUTUBE ===================== */
export class YouTubeBackend {
  constructor(hostId, onEnd, onEvent) {
    this.name = 'youtube';
    this.hostId = hostId;
    this.onEnd = onEnd;
    this.onEvent = onEvent || (() => {});
    this.ready = false;
    this.player = null;
    this.speed = 1;
  }

  async init() {
    if (this.ready) return;
    if (!window.YT || !window.YT.Player) {
      const prev = window.onYouTubeIframeAPIReady;
      const waiter = new Promise((res) => {
        window.onYouTubeIframeAPIReady = () => { prev && prev(); res(); };
      });
      await loadScript('https://www.youtube.com/iframe_api');
      await waiter;
    }
    await new Promise((resolve) => {
      this.player = new YT.Player(this.hostId, {
        width: '100%', height: '100%', videoId: '',
        playerVars: {
          autoplay: 0, controls: 0, disablekb: 1, modestbranding: 1,
          rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0, origin: location.origin,
        },
        events: {
          onReady: () => { this.ready = true; resolve(); },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.PLAYING) {
              try { this.player.setPlaybackRate(this.speed); } catch {}
            }
            if (e.data === YT.PlayerState.ENDED) this.onEnd();
            this.onEvent('state', e.data);
          },
          onError: (e) => this.onEvent('error', `youtube error ${e.data}`),
        },
      });
    });
  }

  async load(item, { autoplay = true } = {}) {
    await this.init();
    autoplay ? this.player.loadVideoById(item.id) : this.player.cueVideoById(item.id);
    try { this.player.setPlaybackRate(this.speed); } catch {}
  }

  play() { this.player?.playVideo(); }
  pause() { this.player?.pauseVideo(); }
  togglePause() {
    if (!this.player) return;
    const s = this.player.getPlayerState();
    s === YT.PlayerState.PLAYING ? this.pause() : this.play();
  }
  stop() { try { this.player?.stopVideo(); } catch {} }
  seek(sec) { this.player?.seekTo(Math.max(0, sec), true); }
  setVolume(v) { this.player?.setVolume(Math.round(v * 100)); }
  setMuted(m) { m ? this.player?.mute() : this.player?.unMute(); }
  setSpeed(n) { this.speed = n; try { this.player?.setPlaybackRate(n); } catch {} }

  state() {
    if (!this.player || !this.player.getDuration) return null;
    let buffered = 0;
    try { buffered = this.player.getVideoLoadedFraction() || 0; } catch {}
    return {
      position: this.player.getCurrentTime() || 0,
      duration: this.player.getDuration() || 0,
      paused: this.player.getPlayerState() !== YT.PlayerState.PLAYING,
      buffered,
      speed: this.speed,
      hasVideo: true,
    };
  }
}

/* ===================== SPOTIFY ===================== */
export class SpotifyBackend {
  constructor(onEnd, onEvent) {
    this.name = 'spotify';
    this.onEnd = onEnd;
    this.onEvent = onEvent || (() => {});
    this.device = null;
    this.player = null;
    this.last = null;
    this.lastTick = 0;
    this._endGuard = false;
    this._wasPlaying = false;
  }

  async init() {
    if (this.player) return;
    const token = await spotify.token();
    if (!token) throw new Error('spotify_not_authed');

    if (!window.Spotify) {
      const waiter = new Promise((res) => { window.onSpotifyWebPlaybackSDKReady = res; });
      await loadScript('https://sdk.scdn.co/spotify-player.js');
      await waiter;
    }

    this.player = new Spotify.Player({
      name: 'mpv-web',
      volume: 1,
      getOAuthToken: (cb) => { spotify.token().then((t) => t && cb(t)); },
    });

    this.player.addListener('initialization_error', ({ message }) => this.onEvent('error', message));
    this.player.addListener('authentication_error', ({ message }) => this.onEvent('error', 'auth: ' + message));
    this.player.addListener('account_error', () => this.onEvent('error', 'Spotify Premium is required for in-browser playback.'));
    this.player.addListener('playback_error', ({ message }) => this.onEvent('error', message));

    this.player.addListener('player_state_changed', (s) => {
      if (!s) return;
      if (!s.paused || s.position > 1000) this._wasPlaying = true;
      const ended = this._wasPlaying && s.paused && s.position === 0;
      this.last = s;
      this.lastTick = performance.now();
      if (ended && !this._endGuard) {
        this._endGuard = true;
        this._wasPlaying = false;
        setTimeout(() => { this._endGuard = false; }, 1500);
        this.onEnd();
      }
      this.onEvent('state', s);
    });

    const ready = new Promise((res, rej) => {
      this.player.addListener('ready', ({ device_id }) => { this.device = device_id; res(device_id); });
      setTimeout(() => rej(new Error('spotify_sdk_timeout')), 15000);
    });

    const ok = await this.player.connect();
    if (!ok) throw new Error('spotify_connect_failed');
    await ready;
  }

  async load(item) {
    await this.init();
    try {
      await spotify.api(`/me/player/play?device_id=${this.device}`, {
        method: 'PUT',
        body: JSON.stringify(item.contextUri ? { context_uri: item.contextUri, offset: { uri: item.uri } } : { uris: [item.uri] }),
      });
    } catch (err) {
      if (item.contextUri) {
        await spotify.api(`/me/player/play?device_id=${this.device}`, {
          method: 'PUT',
          body: JSON.stringify({ uris: [item.uri] }),
        });
      } else {
        throw err;
      }
    }
  }

  play() { this.player?.resume(); }
  pause() { this.player?.pause(); }
  togglePause() { this.player?.togglePlay(); }
  stop() { this.player?.pause(); }
  seek(sec) { this.player?.seek(Math.max(0, sec) * 1000); }
  setVolume(v) { this.player?.setVolume(Math.max(0, Math.min(1, v))); }
  setMuted(m) { this._preMute = m ? (this._preMute ?? 1) : this._preMute; this.player?.setVolume(m ? 0 : (this._preMute ?? 1)); }
  setSpeed() { this.onEvent('warn', 'Spotify does not support playback speed.'); }

  state() {
    const s = this.last;
    if (!s) return null;
    // Interpolate between SDK state pushes so the seek bar moves smoothly.
    const drift = s.paused ? 0 : performance.now() - this.lastTick;
    return {
      position: (s.position + drift) / 1000,
      duration: s.duration / 1000,
      paused: s.paused,
      buffered: 1,
      speed: 1,
      hasVideo: false,
      track: s.track_window?.current_track || null,
    };
  }

  async disconnect() { try { await this.player?.disconnect(); } catch {} this.player = null; this.device = null; this.last = null; }
}

/* ===================== LOCAL FILE ===================== */
export class LocalBackend {
  constructor(videoEl, onEnd, onEvent) {
    this.name = 'local';
    this.el = videoEl;
    this.onEvent = onEvent || (() => {});
    this.el.addEventListener('ended', onEnd);
    this.el.addEventListener('error', () => this.onEvent('error', 'cannot decode file'));
  }
  async load(item) { this.el.src = item.url; await this.el.play().catch(() => {}); }
  play() { this.el.play().catch(() => {}); }
  pause() { this.el.pause(); }
  togglePause() { this.el.paused ? this.play() : this.pause(); }
  stop() { this.el.pause(); this.el.removeAttribute('src'); this.el.load(); }
  seek(sec) { this.el.currentTime = Math.max(0, Math.min(sec, this.el.duration || 0)); }
  setVolume(v) { this.el.volume = Math.max(0, Math.min(1, v)); }
  setMuted(m) { this.el.muted = m; }
  setSpeed(n) { this.el.playbackRate = n; }
  state() {
    const el = this.el;
    if (!el.src) return null;
    let buffered = 0;
    try { if (el.buffered.length && el.duration) buffered = el.buffered.end(el.buffered.length - 1) / el.duration; } catch {}
    return {
      position: el.currentTime || 0,
      duration: el.duration || 0,
      paused: el.paused,
      buffered,
      speed: el.playbackRate,
      hasVideo: el.videoWidth > 0,
    };
  }
}
