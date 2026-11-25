// Línea de tiempo: intro + video + outro, transiciones, preview en tiempo real y exportación
import { drawCard, drawOverlays } from './graphics.js';
import { drawPhotos } from './photos.js';
import { clamp, mkCanvas, waitEvent } from './util.js';

export const FORMATS = {
  '9x16': { w: 1080, h: 1920, label: 'Reels / Historias 9:16' },
  '4x5': { w: 1080, h: 1350, label: 'Feed 4:5' },
  '1x1': { w: 1080, h: 1080, label: 'Cuadrado 1:1' },
};

const LAST_FADE = 0.45;
let aacRegistered = false;
const AC = () => window.AudioContext || window.webkitAudioContext;

let hiddenHost = null;
function host() {
  if (hiddenHost) return hiddenHost;
  hiddenHost = document.createElement('div');
  hiddenHost.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;overflow:hidden;z-index:-1';
  document.body.appendChild(hiddenHost);
  return hiddenHost;
}

export async function makeVideo(url) {
  const v = document.createElement('video');
  v.muted = true; v.defaultMuted = true;
  v.playsInline = true;
  v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.setAttribute('muted', '');
  v.preload = 'auto';
  v.src = url;
  host().appendChild(v);
  v.load();
  const ok = await waitEvent(v, 'loadedmetadata', 15000);
  if (!ok && !(v.duration > 0)) throw new Error('No se pudo leer el video');
  // Algunos navegadores reportan Infinity hasta buscar el final
  if (!isFinite(v.duration)) {
    v.currentTime = 1e7;
    await waitEvent(v, 'durationchange', 3000);
    v.currentTime = 0;
  }
  return v;
}

let decodeCtx = null;
export async function decodeAudio(arrayBuffer) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!decodeCtx) decodeCtx = new OAC(2, 44100, 44100);
  return new Promise((res, rej) => {
    try {
      const p = decodeCtx.decodeAudioData(arrayBuffer, res, rej);
      if (p && p.then) p.then(res, rej);
    } catch (e) { rej(e); }
  });
}

export function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const list = [
    'video/mp4;codecs=avc1.640028,mp4a.40.2',
    'video/mp4;codecs=avc1.4d0028,mp4a.40.2',
    'video/mp4;codecs=avc1.42E028,mp4a.40.2',
    'video/mp4;codecs=avc3.640028,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4;codecs="avc1,mp4a"',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const m of list) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) { /* */ } }
  return '';
}

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sources = { intro: null, main: null, outro: null };
    this.overlays = [];
    this.music = null; // { buffer, offset, vol, bed }
    this.musicPts = [];
    this.logo = null;
    this.format = '9x16';
    this.fit = 'auto';
    this.transition = { type: 'crossfade', dur: 0.6 };
    this.segments = [];
    this.total = 0;
    this.t = 0;
    this.playing = false;
    this.ac = null;
    this.master = null;
    this.nodes = [];
    this.raf = 0;
    this.listeners = {};
    this.previewScale = 0.5;
    this.blurC = mkCanvas(45, 80);
    this.blurC2 = mkCanvas(180, 320);
    this.setResolution(this.previewScale);
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, ...a) { (this.listeners[ev] || []).forEach((f) => f(...a)); }

  setResolution(scale) {
    const f = FORMATS[this.format];
    const w = Math.round(f.w * scale), h = Math.round(f.h * scale);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  setFormat(fmt) { this.format = fmt; this.setResolution(this.previewScale); this.refresh(); }

  // ---------- Línea de tiempo ----------
  rebuild() {
    const list = [];
    const { intro, main, outro } = this.sources;
    if (intro) list.push({ role: 'intro', src: intro, in: 0, dur: intro.duration, volume: intro.volume ?? 1 });
    if (main) list.push({ role: 'main', src: main, in: main.in || 0, dur: Math.max(0.1, (main.out ?? main.duration) - (main.in || 0)), volume: main.volume ?? 1 });
    if (outro) list.push({ role: 'outro', src: outro, in: 0, dur: outro.duration, volume: outro.volume ?? 1 });
    const type = this.transition.type, T = type === 'cut' ? 0 : this.transition.dur;
    let t = 0;
    list.forEach((s, i) => {
      s.ov = 0;
      if (i > 0 && type === 'crossfade') { s.ov = Math.min(T, list[i - 1].dur / 2, s.dur / 2); t -= s.ov; }
      s.start = t; s.end = t + s.dur; t = s.end;
    });
    const n = list.length;
    list.forEach((s, i) => {
      const nextOv = i < n - 1 ? list[i + 1].ov : 0;
      if (type === 'crossfade') {
        s.vIn = s.ov; s.vOut = 0; s.aIn = s.ov || 0.02; s.aOut = nextOv || 0.02;
      } else if (type === 'black') {
        const h = Math.min(T / 2, s.dur / 3);
        s.vIn = i > 0 ? h : 0; s.vOut = i < n - 1 ? h : 0; s.aIn = i > 0 ? h : 0.02; s.aOut = i < n - 1 ? h : 0.02;
      } else {
        s.vIn = 0; s.vOut = 0; s.aIn = 0.02; s.aOut = 0.02;
      }
      if (i === n - 1) { const f = Math.min(LAST_FADE, s.dur / 3); s.vOut = Math.max(s.vOut, f); s.aOut = Math.max(s.aOut, f); }
    });
    this.segments = list;
    this.total = t;
    this.buildMusicEnv();
    if (this.t > this.total) this.t = this.total;
    this.emit('timeline', this.total);
  }

  // ---------- Música ----------
  // Curva de volumen de la música a lo largo de la línea de tiempo
  buildMusicEnv() {
    const mu = this.music;
    this.musicPts = [];
    if (!mu || !this.total) return;
    const T = this.total, v = mu.vol;
    const m = this.mainSeg();
    const duck = m && m.src.kind === 'video' && (m.volume ?? 1) > 0.05;
    const b = duck ? mu.bed : v;
    const pts = [[0, 0], [Math.min(0.4, T / 4), m && m.start < 0.05 ? b : v]];
    if (m && b !== v) {
      const du = clamp(Math.max(m.ov || 0, 0.8), 0.2, m.dur / 2);
      if (m.start >= 0.05) { pts.push([m.start, v], [m.start + du, b]); }
      if (m.end < T - 0.05) { pts.push([m.end - du, b], [m.end, v]); }
    }
    const f = Math.min(LAST_FADE + 0.3, T / 3);
    const lastLevel = m && m.end >= T - 0.05 ? b : v;
    pts.push([T - f, lastLevel], [T, 0]);
    // la canción termina antes que el video: fundido al final de la canción
    const songEnd = mu.buffer.duration - mu.offset;
    let out = pts.filter((p) => p[0] >= 0).sort((a, c) => a[0] - c[0]);
    if (songEnd < T) {
      const fe = Math.max(0, songEnd - 0.8);
      const lv = this.levelAt(out, fe);
      out = out.filter((p) => p[0] < fe).concat([[fe, lv], [songEnd, 0]]);
    }
    this.musicPts = out;
  }

  levelAt(pts, t) {
    if (!pts.length) return 0;
    if (t <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (t <= pts[i][0]) {
        const [t0, v0] = pts[i - 1], [t1, v1] = pts[i];
        return t1 > t0 ? v0 + ((v1 - v0) * (t - t0)) / (t1 - t0) : v1;
      }
    }
    return pts[pts.length - 1][1];
  }

  setMusic(m) { this.music = m; this.buildMusicEnv(); if (this.playing) this.play(this.now()); }

  scheduleMusic(from, base, ac = this.ac, dest = this.master, live = true) {
    const mu = this.music;
    if (!mu || !this.musicPts.length) return;
    const off = mu.offset + from;
    if (off >= mu.buffer.duration - 0.05) return;
    const g = ac.createGain();
    g.connect(dest);
    g.gain.setValueAtTime(this.levelAt(this.musicPts, from), base);
    for (const [t, v] of this.musicPts) if (t > from) g.gain.linearRampToValueAtTime(v, base + (t - from));
    const src = ac.createBufferSource();
    src.buffer = mu.buffer;
    src.connect(g);
    src.start(base, off, Math.max(0.05, Math.min(this.total - from, mu.buffer.duration - off)));
    if (live) this.nodes.push({ src, g });
  }

  // Escuchar solo un pedazo de la música (al elegir el tramo)
  previewMusic(offset, dur = 7) {
    this.unlock();
    this.stopMusicPreview();
    if (this.playing) this.pause();
    const mu = this.music; if (!mu) return;
    const ac = this.ac, t0 = ac.currentTime + 0.05;
    const g = ac.createGain();
    g.connect(this.master);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(mu.vol, t0 + 0.15);
    g.gain.setValueAtTime(mu.vol, t0 + dur - 0.6);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    const src = ac.createBufferSource();
    src.buffer = mu.buffer; src.connect(g);
    src.start(t0, offset, dur);
    this._mprev = { src, g, t0, offset, dur };
    src.onended = () => { if (this._mprev && this._mprev.src === src) this._mprev = null; };
  }

  musicPreviewPos() {
    const p = this._mprev; if (!p || !this.ac) return null;
    const e = this.ac.currentTime - p.t0;
    return e >= 0 && e <= p.dur ? p.offset + e : null;
  }

  stopMusicPreview() {
    const p = this._mprev; if (!p) return;
    try { p.src.stop(); } catch (e) { /* */ }
    try { p.g.disconnect(); } catch (e) { /* */ }
    this._mprev = null;
  }

  mainSeg() { return this.segments.find((s) => s.role === 'main'); }
  mainTime(t = this.t) { const m = this.mainSeg(); return m ? clamp(t - m.start, 0, m.dur) : 0; }

  vAlpha(s, lt) {
    let a = 1;
    if (s.vIn > 0) a = Math.min(a, lt / s.vIn);
    if (s.vOut > 0) a = Math.min(a, (s.dur - lt) / s.vOut);
    return clamp(a);
  }

  // ---------- Render ----------
  renderAt(t, ctx = this.ctx) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < this.segments.length; i++) {
      const s = this.segments[i];
      const isLast = i === this.segments.length - 1;
      if (t < s.start || t > s.end || (t === s.end && !isLast)) continue;
      const lt = t - s.start;
      const a = this.vAlpha(s, lt);
      if (a <= 0.001) continue;
      if (s.src.kind === 'card') {
        drawCard(ctx, lt, W, H, s.src.params, a, this.logo);
      } else if (s.src.kind === 'photos') {
        drawPhotos(ctx, s.src, lt, W, H, this.fit, a);
      } else {
        this.drawVideo(ctx, s.src.frame || s.src.el, W, H, s.role === 'main' ? this.fit : 'clip', a);
      }
      if (s.role === 'main') drawOverlays(ctx, lt, W, H, this.overlays, a, this.logo);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  }

  drawVideo(ctx, el, W, H, mode, a) {
    if (!el) return;
    const vw = el.videoWidth || el.width, vh = el.videoHeight || el.height;
    if (!vw || !vh || (el.readyState !== undefined && el.readyState < 2)) return;
    const ar = vw / vh, AR = W / H;
    if (mode === 'auto') mode = Math.abs(ar - AR) / AR < 0.12 ? 'cover' : 'blur';
    if (mode === 'clip') mode = ar < AR ? 'cover' : 'contain';
    ctx.globalAlpha = a;
    const draw = (scale) => {
      const w = vw * scale, h = vh * scale;
      ctx.drawImage(el, (W - w) / 2, (H - h) / 2, w, h);
    };
    if (mode === 'cover') { draw(Math.max(W / vw, H / vh)); return; }
    if (mode === 'blur') {
      // fondo desenfocado barato y compatible con Safari (escala abajo / arriba)
      const b1 = this.blurC, b2 = this.blurC2;
      const r = H / W;
      b1.width = 40; b1.height = Math.round(40 * r);
      b2.width = 160; b2.height = Math.round(160 * r);
      const c1 = b1.getContext('2d'), c2 = b2.getContext('2d');
      const sc = Math.max(b1.width / vw, b1.height / vh);
      c1.drawImage(el, (b1.width - vw * sc) / 2, (b1.height - vh * sc) / 2, vw * sc, vh * sc);
      c2.imageSmoothingQuality = 'high';
      c2.drawImage(b1, 0, 0, b2.width, b2.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(b2, 0, 0, W, H);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
    }
    draw(Math.min(W / vw, H / vh));
  }

  // ---------- Videos ----------
  videoSegs() { return this.segments.filter((s) => s.src.kind === 'video'); }

  async prepareVideos(t) {
    const jobs = [];
    for (const s of this.videoSegs()) {
      const el = s.src.el;
      let target = null;
      if (t >= s.start && t <= s.end) target = s.in + clamp(t - s.start, 0, s.dur - 0.03);
      else if (t < s.start) target = s.in;
      if (target == null) continue;
      if (Math.abs(el.currentTime - target) > 0.02 || el.readyState < 2) {
        el.currentTime = target;
        jobs.push(waitEvent(el, 'seeked', 2500));
      }
    }
    await Promise.all(jobs);
  }

  syncVideos(t) {
    for (const s of this.videoSegs()) {
      const el = s.src.el;
      const active = t >= s.start && t < s.end;
      if (active) {
        const exp = s.in + (t - s.start);
        if (el.paused) {
          if (Math.abs(el.currentTime - exp) > 0.08) el.currentTime = exp;
          el.playbackRate = 1;
          const p = el.play(); if (p && p.catch) p.catch(() => {});
        } else {
          // corrige el desfase acelerando o frenando apenas, sin saltos visibles
          const diff = el.currentTime - exp;
          if (Math.abs(diff) > 1.0) { el.currentTime = exp; el.playbackRate = 1; }
          else if (Math.abs(diff) > 0.04) el.playbackRate = clamp(1 - diff * 0.8, 0.9, 1.1);
          else if (el.playbackRate !== 1) el.playbackRate = 1;
        }
      } else {
        if (!el.paused) { el.pause(); el.playbackRate = 1; }
        if (t < s.start && t > s.start - 1.2 && !s.prepped && Math.abs(el.currentTime - s.in) > 0.05) { el.currentTime = s.in; s.prepped = true; }
      }
    }
  }

  // ---------- Audio ----------
  // Llamar de forma SINCRÓNICA dentro de un toque/click (iOS)
  unlock() {
    if (!this.ac) {
      const C = AC();
      this.ac = new C();
      this.master = this.ac.createGain();
      this.master.connect(this.ac.destination);
    }
    if (this.ac.state !== 'running') this.ac.resume();
    if (!this._unlocked) {
      this._unlocked = true;
      for (const r of ['intro', 'main', 'outro']) {
        const el = this.sources[r]?.el;
        if (el) { const p = el.play(); if (p && p.then) p.then(() => el.pause()).catch(() => {}); }
      }
    }
  }

  unlockElement(el) {
    if (!el || !this._unlocked) return;
    const p = el.play(); if (p && p.then) p.then(() => el.pause()).catch(() => {});
  }

  stopAudio() {
    for (const n of this.nodes) {
      try { n.src && n.src.stop(); } catch (e) { /* */ }
      try { n.src && n.src.disconnect(); } catch (e) { /* */ }
      try { n.el && n.el.disconnect(); } catch (e) { /* */ }
      try { n.g.disconnect(); } catch (e) { /* */ }
    }
    this.nodes = [];
  }

  scheduleAudio(s, from, base, ac = this.ac, dest = this.master, live = true) {
    if (from >= s.end) return;
    const audio = s.src.audioBuffer;
    const useEl = live && !audio && s.src.useElementAudio && s.src.el;
    if (!audio && !useEl) return;
    const off = Math.max(0, from - s.start);
    const when = base + Math.max(0, s.start - from);
    const d = s.dur, fi = s.aIn, fo = s.aOut, vol = s.volume ?? 1;
    const env = (x) => vol * clamp(Math.min(fi > 0 ? x / fi : 1, fo > 0 ? (d - x) / fo : 1));
    const g = ac.createGain();
    g.connect(dest);
    g.gain.setValueAtTime(env(off), when);
    [fi, d - fo, d].filter((x) => x > off).sort((a, b) => a - b)
      .forEach((x) => g.gain.linearRampToValueAtTime(env(x), when + (x - off)));
    if (audio) {
      const src = ac.createBufferSource();
      src.buffer = audio;
      src.connect(g);
      const startOff = s.in + off;
      if (startOff < audio.duration) src.start(when, startOff, Math.max(0.01, d - off));
      if (live) this.nodes.push({ src, g });
    } else {
      const el = s.src.el;
      if (!el._srcNode) el._srcNode = ac.createMediaElementSource(el);
      el.muted = false;
      el._srcNode.connect(g);
      this.nodes.push({ el: el._srcNode, g });
    }
  }

  now() { return this.clock.from + Math.max(0, this.ac.currentTime - this.clock.base); }

  async play(from = this.t) {
    if (!this.segments.length) return;
    this.unlock();
    if (this.ac.state !== 'running') { try { await this.ac.resume(); } catch (e) { /* */ } }
    if (from >= this.total - 0.05) from = 0;
    this.cancelLoop();
    this.stopAudio();
    this.stopMusicPreview();
    this.pauseVideos();
    this.segments.forEach((s) => { s.prepped = false; });
    await this.prepareVideos(from);
    const base = this.ac.currentTime + 0.12;
    this.clock = { from, base };
    for (const s of this.segments) this.scheduleAudio(s, from, base);
    this.scheduleMusic(from, base);
    this.playing = true;
    this.emit('state', true);
    const loop = () => {
      if (!this.playing) return;
      let t = this.now();
      if (t >= this.total) t = this.total;
      this.t = t;
      this.syncVideos(t);
      this.renderAt(t);
      this.emit('time', t);
      if (t >= this.total) { this.finish(); return; }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  finish() {
    this.playing = false;
    this.cancelLoop();
    this.stopAudio();
    this.pauseVideos();
    this.emit('state', false);
    this.emit('end');
  }

  cancelLoop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
  pauseVideos() { for (const s of this.videoSegs()) if (!s.src.el.paused) s.src.el.pause(); }

  pause() {
    if (!this.playing) return;
    this.t = Math.min(this.total, this.now());
    this.playing = false;
    this.cancelLoop();
    this.stopAudio();
    this.pauseVideos();
    this.emit('state', false);
    this.refresh();
  }

  toggle() { if (this.playing) this.pause(); else this.play(); }

  seek(t) {
    this.t = clamp(t, 0, this.total);
    if (this.playing) { this.play(this.t); return; }
    this.refresh();
  }

  // Redibuja el cuadro actual (con búsqueda de video, sin superponer búsquedas)
  refresh() {
    if (this.playing) return;
    if (this._refreshing) { this._again = true; return; }
    this._refreshing = true;
    const t = this.t;
    this.renderAt(t);
    this.prepareVideos(t).then(() => {
      this.renderAt(this.t);
      this.emit('time', this.t);
      this._refreshing = false;
      if (this._again) { this._again = false; this.refresh(); }
    });
  }

  cancelExport() { if (!this.exporting) return; this._cancel = true; if (this.playing) this.finish(); else this.emit('end'); }

  // ---------- Exportar ----------
  // 1) Cuadro por cuadro con WebCodecs (sin tirones, siempre H.264/AAC)
  // 2) Si el navegador no puede, grabación en tiempo real (MediaRecorder)
  async export(opts = {}) {
    try {
      const blob = await this.exportOffline(opts);
      if (blob) return blob;
    } catch (e) {
      if (e && e.message === 'cancelado') throw e;
      console.warn('Exportación cuadro por cuadro falló, uso tiempo real', e);
    }
    return this.exportRealtime(opts);
  }

  // Pre-arma letras doradas y gráficas a resolución final para que no haya cuadros lentos al grabar
  prewarm(ctx) {
    const ts = new Set([0]);
    for (const s of this.segments) { ts.add(s.start + Math.min(1.5, s.dur / 2)); ts.add(s.start + Math.min(2.5, s.dur * 0.8)); }
    const m = this.mainSeg();
    if (m) for (const o of this.overlays) ts.add(m.start + clamp((o.start || 0) + 1.2, 0, m.dur));
    for (const t of ts) this.renderAt(Math.min(t, this.total), ctx);
  }

  async exportOffline({ onProgress, only = null } = {}) {
    if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined' || typeof OfflineAudioContext === 'undefined') return null;
    let MB;
    try { MB = await import('mediabunny'); } catch (e) { return null; }
    if (this.exporting) throw new Error('Ya hay una exportación en curso');
    this.pause();
    const saved = only ? { ...this.sources } : null;
    const savedOv = this.overlays;
    if (only) { this.sources = { intro: null, main: null, outro: null, [only.role]: only.src }; this.overlays = []; this.rebuild(); }
    this.exporting = true;
    this._cancel = false;
    const FPS = 30;
    const f = FORMATS[this.format];
    const W = f.w, H = f.h;
    const inputs = [], cursors = new Map();
    let wake = null;
    const restore = () => {
      for (const c of cursors.values()) c.close();
      inputs.forEach((i) => { try { i.dispose(); } catch (e) { /* */ } });
      for (const s of this.segments) delete s.src.frame;
      try { wake && wake.release(); } catch (e) { /* */ }
      if (only) { this.sources = saved; this.overlays = savedOv; this.rebuild(); }
      this.exporting = false;
      this.t = 0;
      this.refresh();
    };
    let output = null;
    try {
      const okV = await MB.canEncodeVideo('avc', { width: W, height: H, bitrate: 8e6 });
      const aCfg = { numberOfChannels: 2, sampleRate: 48000, bitrate: 192e3 };
      let okA = await MB.canEncodeAudio('aac', aCfg);
      if (!okA && !aacRegistered) {
        // navegadores sin AAC nativo (algunos iPhone / Linux): encoder AAC en WebAssembly
        try { const { registerAacEncoder } = await import('./vendor/mediabunny-aac-encoder.min.mjs'); registerAacEncoder(); aacRegistered = true; } catch (e) { /* */ }
        okA = await MB.canEncodeAudio('aac', aCfg);
      }
      if (!okV || !okA) { restore(); return null; }

      for (const s of this.videoSegs()) {
        const blob = s.src.blob;
        if (!blob) { restore(); return null; }
        const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
        inputs.push(input);
        const vt = await input.getPrimaryVideoTrack();
        if (!vt || !(await vt.canDecode())) { restore(); return null; }
        // el audio no se pudo decodificar antes pero existe → mejor tiempo real
        if (!s.src.audioBuffer && s.src.useElementAudio && (await input.getPrimaryAudioTrack())) { restore(); return null; }
        const k = Math.min(1, 1920 / Math.max(vt.displayWidth, vt.displayHeight));
        const sink = new MB.CanvasSink(vt, { width: Math.max(2, Math.round(vt.displayWidth * k)), poolSize: 4 });
        cursors.set(s, new FrameCursor(sink.canvases(s.in, s.in + s.dur + 0.25)));
      }

      // Mezcla de audio exacta, fuera de tiempo real
      const SR = 48000, N = Math.max(1, Math.round(this.total * FPS));
      const len = Math.round((N / FPS) * SR);
      const oac = new OfflineAudioContext(2, len, SR);
      const mg = oac.createGain();
      mg.connect(oac.destination);
      for (const s of this.segments) this.scheduleAudio(s, 0, 0, oac, mg, false);
      this.scheduleMusic(0, 0, oac, mg, false);
      const mix = await oac.startRendering();

      const work = mkCanvas(W, H);
      const wctx = work.getContext('2d');
      output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new MB.BufferTarget() });
      const vsrc = new MB.CanvasSource(work, { codec: 'avc', bitrate: 8_000_000, keyFrameInterval: 2 });
      output.addVideoTrack(vsrc, { frameRate: FPS });
      const asrc = new MB.AudioBufferSource({ codec: 'aac', bitrate: 192_000 });
      output.addAudioTrack(asrc);
      await output.start();
      try { wake = await navigator.wakeLock?.request('screen'); } catch (e) { /* */ }

      const chunk = SR; // 1 s de audio por vez, intercalado con el video
      let aPos = 0;
      const pushAudio = async (upTo) => {
        while (aPos < Math.min(upTo, len)) {
          const n = Math.min(chunk, len - aPos);
          const ab = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: SR });
          for (let c = 0; c < 2; c++) ab.copyToChannel(mix.getChannelData(c).subarray(aPos, aPos + n), c);
          await asrc.add(ab);
          aPos += n;
        }
      };

      let lastYield = performance.now();
      for (let i = 0; i < N; i++) {
        if (this._cancel) throw new Error('cancelado');
        const t = i / FPS;
        for (const [s, cur] of cursors) {
          if (t >= s.start - 0.001 && t <= s.end + 0.001) s.src.frame = await cur.at(s.in + clamp(t - s.start, 0, s.dur));
        }
        this.renderAt(t, wctx);
        await vsrc.add(t, 1 / FPS);
        await pushAudio(Math.round((t + 1) * SR));
        if (performance.now() - lastYield > 150) {
          this.ctx.drawImage(work, 0, 0, this.canvas.width, this.canvas.height);
          onProgress && onProgress((i + 1) / N);
          this.emit('time', t);
          await new Promise((r) => setTimeout(r, 0));
          lastYield = performance.now();
        }
      }
      await pushAudio(len);
      onProgress && onProgress(1);
      await output.finalize();
      const blob = new Blob([output.target.buffer], { type: 'video/mp4' });
      blob.codecs = 'avc1,mp4a';
      restore();
      return blob;
    } catch (e) {
      try { output && output.state !== 'finalized' && (await output.cancel()); } catch (x) { /* */ }
      restore();
      throw e;
    }
  }

  async exportRealtime({ onProgress, only = null } = {}) {
    if (this.exporting) throw new Error('Ya hay una exportación en curso');
    const mime = pickMime();
    if (mime === null || !this.canvas.captureStream) throw new Error('Este navegador no puede grabar video. Probá con Chrome o Safari actualizados.');
    this.unlock();
    if (this.ac.state !== 'running') { try { await this.ac.resume(); } catch (e) { /* */ } }
    this.pause();

    const saved = only ? { ...this.sources } : null;
    const savedOv = this.overlays;
    if (only) { this.sources = { intro: null, main: null, outro: null, [only.role]: only.src }; this.overlays = []; this.rebuild(); }

    this.exporting = true;
    this._cancel = false;
    this.setResolution(1);
    const dest = this.ac.createMediaStreamDestination();
    this.master.disconnect();
    this.master.connect(dest);
    const vstream = this.canvas.captureStream(30);
    const stream = new MediaStream([...vstream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const opts = { videoBitsPerSecond: 10_000_000, audioBitsPerSecond: 192_000 };
    if (mime) opts.mimeType = mime;
    let rec;
    try { rec = new MediaRecorder(stream, opts); } catch (e) { rec = new MediaRecorder(stream); }
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res) => { rec.onstop = res; });

    let wake = null;
    try { wake = await navigator.wakeLock?.request('screen'); } catch (e) { /* */ }
    let aborted = false;
    const onHide = () => { if (document.hidden) { aborted = true; this.pause(); this.emit('end'); } };
    document.addEventListener('visibilitychange', onHide);

    const cleanup = () => {
      document.removeEventListener('visibilitychange', onHide);
      try { wake && wake.release(); } catch (e) { /* */ }
      vstream.getTracks().forEach((t) => t.stop());
      try { this.master.disconnect(); } catch (e) { /* */ }
      this.master.connect(this.ac.destination);
      this.setResolution(this.previewScale);
      if (only) { this.sources = saved; this.overlays = savedOv; this.rebuild(); }
      this.exporting = false;
      this.t = 0;
      this.refresh();
    };

    try {
      this.t = 0;
      this.prewarm(this.ctx);
      await this.prepareVideos(0);
      this.renderAt(0);
      const ended = new Promise((res) => {
        const fn = () => { this.listeners.end = (this.listeners.end || []).filter((f) => f !== fn); res(); };
        this.on('end', fn);
      });
      const onT = (t) => onProgress && onProgress(t / this.total);
      this.on('time', onT);
      rec.start();
      await this.play(0);
      await ended;
      this.listeners.time = this.listeners.time.filter((f) => f !== onT);
      // un par de cuadros extra para cerrar
      this.renderAt(this.total);
      await new Promise((r) => setTimeout(r, 250));
      rec.stop();
      await stopped;
    } catch (e) {
      try { rec.state !== 'inactive' && rec.stop(); } catch (x) { /* */ }
      cleanup();
      throw e;
    }
    cleanup();
    if (this._cancel) throw new Error('cancelado');
    if (aborted) throw new Error('La exportación se cortó porque la app pasó a segundo plano. Dejá la pantalla encendida y volvé a intentar.');
    const full = rec.mimeType || mime || 'video/webm';
    const blob = new Blob(chunks, { type: full.split(';')[0] });
    blob.codecs = full;
    return blob;
  }
}

// Recorre los cuadros decodificados de un video en orden y devuelve el que corresponde a cada tiempo
class FrameCursor {
  constructor(gen) { this.gen = gen; this.cur = null; this.next = null; this.done = false; }
  async pull() {
    const r = await this.gen.next();
    if (r.done) { this.done = true; this.next = null; } else this.next = r.value;
  }
  async at(time) {
    if (!this.next && !this.done && !this.cur) await this.pull();
    while (this.next && this.next.timestamp <= time + 1e-4) {
      this.cur = this.next;
      await this.pull();
    }
    return (this.cur || this.next)?.canvas || null;
  }
  close() { try { this.gen.return(); } catch (e) { /* */ } }
}
