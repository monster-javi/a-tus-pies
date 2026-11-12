// Utilidades compartidas
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t), 3);
export const easeInOutCubic = (t) => {
  t = clamp(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
export const easeOutBack = (t) => {
  t = clamp(t);
  const c1 = 1.4, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const fract = (x) => x - Math.floor(x);

// PRNG determinístico (mulberry32): mismas partículas en cada render
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, '0')}`;
}

export function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function waitEvent(el, ev, timeout = 4000) {
  return new Promise((res) => {
    let done = false;
    const fin = (ok) => { if (done) return; done = true; el.removeEventListener(ev, on); clearTimeout(tm); res(ok); };
    const on = () => fin(true);
    el.addEventListener(ev, on);
    const tm = setTimeout(() => fin(false), timeout);
  });
}

export async function loadFonts() {
  if (!document.fonts) return;
  const specs = [
    '700 100px Cinzel', '400 100px Cinzel', '900 100px Cinzel',
    'italic 600 100px "Cormorant Garamond"', '600 100px "Cormorant Garamond"', 'italic 500 100px "Cormorant Garamond"',
  ];
  try { await Promise.all(specs.map((s) => document.fonts.load(s, 'AÁÑ¡!aá'))); } catch (e) { /* sigue con fallback */ }
}
