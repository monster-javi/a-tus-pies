// Línea de tiempo: intro + video + outro, transiciones, preview en tiempo real y exportación
import { drawCard, drawOverlays } from './graphics.js';
import { clamp, mkCanvas, waitEvent } from './util.js';

export const FORMATS = {
  '9x16': { w: 1080, h: 1920, label: 'Reels / Historias 9:16' },
  '4x5': { w: 1080, h: 1350, label: 'Feed 4:5' },
  '1x1': { w: 1080, h: 1080, label: 'Cuadrado 1:1' },
};

const LAST_FADE = 0.45;
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
    if (this.t > this.total) this.t = this.total;
    this.emit('timeline', this.total);
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
      } else {
        this.drawVideo(ctx, s.src.el, W, H, s.role === 'main' ? this.fit : 'clip', a);
      }
      if (s.role === 'main') drawOverlays(ctx, lt, W, H, this.overlays, a, this.logo);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  }

  drawVideo(ctx, el, W, H, mode, a) {
    const vw = el.videoWidth, vh = el.videoHeight;
    if (!vw || !vh || el.readyState < 2) return;
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
          const p = el.play(); if (p && p.catch) p.catch(() => {});
        } else if (Math.abs(el.currentTime - exp) > 0.3) {
          el.currentTime = exp;
        }
      } else {
        if (!el.paused) el.pause();
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

  scheduleAudio(s, from, base) {
    if (from >= s.end) return;
    const audio = s.src.audioBuffer;
    const useEl = !audio && s.src.useElementAudio && s.src.el;
    if (!audio && !useEl) return;
    const ac = this.ac;
    const off = Math.max(0, from - s.start);
    const when = base + Math.max(0, s.start - from);
    const d = s.dur, fi = s.aIn, fo = s.aOut, vol = s.volume ?? 1;
    const env = (x) => vol * clamp(Math.min(fi > 0 ? x / fi : 1, fo > 0 ? (d - x) / fo : 1));
    const g = ac.createGain();
    g.connect(this.master);
    g.gain.setValueAtTime(env(off), when);
    [fi, d - fo, d].filter((x) => x > off).sort((a, b) => a - b)
      .forEach((x) => g.gain.linearRampToValueAtTime(env(x), when + (x - off)));
    if (audio) {
      const src = ac.createBufferSource();
      src.buffer = audio;
      src.connect(g);
      const startOff = s.in + off;
      if (startOff < audio.duration) src.start(when, startOff, Math.max(0.01, d - off));
      this.nodes.push({ src, g });
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
    this.pauseVideos();
    this.segments.forEach((s) => { s.prepped = false; });
    await this.prepareVideos(from);
    const base = this.ac.currentTime + 0.12;
    this.clock = { from, base };
    for (const s of this.segments) this.scheduleAudio(s, from, base);
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
  async export({ onProgress, only = null } = {}) {
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
