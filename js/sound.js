// Sonido de "brillo" sintetizado para los títulos generados (sin archivos de audio)
import { rng } from './util.js';

export async function makeShimmer(dur, seed = 5, { revealAt = 0.45, sweepAt = 1.6 } = {}) {
  const sr = 44100;
  const len = Math.max(1, Math.ceil(dur * sr));
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) return null;
  const ac = new OAC(2, len, sr);
  const r = rng(seed);
  const out = ac.createGain();
  out.gain.value = 0.9;
  out.connect(ac.destination);
  const hasPan = typeof ac.createStereoPanner === 'function';

  // Colchón armónico suave
  const pad = ac.createGain();
  pad.gain.setValueAtTime(0, 0);
  pad.gain.linearRampToValueAtTime(0.06, Math.min(1.2, dur * 0.4));
  pad.gain.setValueAtTime(0.06, Math.max(1.3, dur - 1.2));
  pad.gain.linearRampToValueAtTime(0, dur);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 1600;
  pad.connect(lp); lp.connect(out);
  for (const f of [146.83, 220, 277.18, 329.63, 440, 554.37]) {
    const o = ac.createOscillator();
    o.type = 'triangle'; o.frequency.value = f; o.detune.value = (r() - 0.5) * 12;
    const g = ac.createGain(); g.gain.value = 0.5;
    o.connect(g); g.connect(pad);
    o.start(0); o.stop(dur);
  }

  // Whoosh de ruido filtrado
  const nb = ac.createBuffer(1, len, sr);
  const nd = nb.getChannelData(0);
  for (let i = 0; i < len; i++) nd[i] = r() * 2 - 1;
  const ns = ac.createBufferSource(); ns.buffer = nb;
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1;
  bp.frequency.setValueAtTime(300, 0);
  bp.frequency.exponentialRampToValueAtTime(7000, Math.min(dur, revealAt + 0.6));
  const wg = ac.createGain();
  wg.gain.setValueAtTime(0, 0);
  wg.gain.linearRampToValueAtTime(0.28, Math.min(dur, revealAt));
  wg.gain.linearRampToValueAtTime(0, Math.min(dur, revealAt + 1.3));
  ns.connect(bp); bp.connect(wg); wg.connect(out);
  ns.start(0);

  // Campanitas
  const scale = [1318.5, 1567.98, 1760, 2093, 2349.3, 2637, 3136, 3520, 4186];
  const bell = (time, freq, gain, pan) => {
    if (time >= dur - 0.05) return;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, Math.min(dur, time + 1.0));
    let node = g;
    if (hasPan) { const p = ac.createStereoPanner(); p.pan.value = pan; g.connect(p); node = p; }
    node.connect(out);
    for (const [mult, gm] of [[1, 1], [2.76, 0.25], [5.4, 0.08]]) {
      const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = freq * mult;
      const og = ac.createGain(); og.gain.value = gm;
      o.connect(og); og.connect(g);
      o.start(time); o.stop(Math.min(dur, time + 1.05));
    }
  };
  const pick = () => scale[Math.floor(r() * scale.length)];
  for (let i = 0; i < Math.round(dur * 3.5); i++) bell(0.3 + r() * Math.max(0.1, dur - 1.2), pick(), 0.025 + 0.025 * r(), r() * 1.6 - 0.8);
  for (let k = 0; k < 6; k++) bell(revealAt + k * 0.045, pick(), 0.045, r() * 1.4 - 0.7);
  for (let k = 0; k < 5; k++) bell(sweepAt + k * 0.06, pick(), 0.035, r() * 1.4 - 0.7);

  return new Promise((res) => {
    let done = false;
    const fin = (b) => { if (!done) { done = true; res(b); } };
    ac.oncomplete = (e) => fin(e.renderedBuffer);
    const p = ac.startRendering();
    if (p && p.then) p.then(fin).catch(() => fin(null));
  });
}

export function audioBufferToWav(buf) {
  const ch = buf.numberOfChannels, sr = buf.sampleRate, n = buf.length;
  const ab = new ArrayBuffer(44 + n * ch * 2);
  const v = new DataView(ab);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * ch * 2, true);
  const data = []; for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, data[c][i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return ab;
}
