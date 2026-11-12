// Fotos animadas (Ken Burns) con fundidos entre una y otra
import { rng, mkCanvas, clamp } from './util.js';

export const PHOTO_PRESETS = [
  ['random', 'Aleatoria'],
  ['zoomIn', 'Acercar'],
  ['zoomOut', 'Alejar'],
  ['pan', 'Paneo'],
  ['drift', 'Suave'],
  ['still', 'Quietas'],
];

let pid = 1;

// Achica la foto (respeta la orientación EXIF) y la guarda como JPEG liviano
export async function loadPhoto(file) {
  const url = URL.createObjectURL(file);
  const src = new Image();
  src.decoding = 'async';
  await new Promise((res, rej) => { src.onload = res; src.onerror = () => rej(new Error('No se pudo abrir ' + file.name)); src.src = url; });
  const max = 2000;
  const k = Math.min(1, max / Math.max(src.naturalWidth, src.naturalHeight));
  const w = Math.round(src.naturalWidth * k), h = Math.round(src.naturalHeight * k);
  const c = mkCanvas(w, h);
  c.getContext('2d').drawImage(src, 0, 0, w, h);
  URL.revokeObjectURL(url);
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
  c.width = c.height = 1;
  const purl = URL.createObjectURL(blob);
  const img = new Image();
  img.src = purl;
  try { await img.decode(); } catch (e) { await new Promise((r) => { img.onload = r; }); }
  // Fondo desenfocado precalculado (para fotos que no llenan el cuadro)
  const b1 = mkCanvas(32, Math.max(1, Math.round((32 * h) / w)));
  b1.getContext('2d').drawImage(img, 0, 0, b1.width, b1.height);
  const blur = mkCanvas(128, Math.max(1, Math.round((128 * h) / w)));
  const bx = blur.getContext('2d');
  bx.imageSmoothingQuality = 'high';
  bx.drawImage(b1, 0, 0, blur.width, blur.height);
  return { id: pid++, name: file.name, url: purl, img, blur, w, h };
}

export function freePhoto(p) { try { URL.revokeObjectURL(p.url); } catch (e) { /* */ } }

export function photosDuration(src) {
  const n = src.photos.length;
  if (!n) return 0;
  const d = src.photoDur, tr = Math.min(src.photoTr, d / 2);
  return n * d - (n - 1) * tr;
}

const KINDS = ['zoomIn', 'zoomOut', 'panLR', 'panRL', 'drift'];
function motion(preset, i, seed) {
  const r = rng(seed * 131 + i * 977 + 3);
  let kind = preset;
  if (preset === 'random') {
    const prev = i > 0 ? KINDS[Math.floor(rng(seed * 131 + (i - 1) * 977 + 3)() * KINDS.length)] : null;
    kind = KINDS[Math.floor(r() * KINDS.length)];
    if (kind === prev) kind = KINDS[(KINDS.indexOf(kind) + 1) % KINDS.length];
  } else if (preset === 'pan') kind = i % 2 ? 'panRL' : 'panLR';
  const fx = (r() - 0.5) * 0.8, fy = (r() - 0.5) * 0.8;
  switch (kind) {
    case 'zoomIn': return { z0: 1.0, z1: 1.16, x0: 0, x1: fx, y0: 0, y1: fy };
    case 'zoomOut': return { z0: 1.16, z1: 1.0, x0: fx, x1: 0, y0: fy, y1: 0 };
    case 'panLR': return { z0: 1.14, z1: 1.14, x0: -0.9, x1: 0.9, y0: fy * 0.5, y1: fy * 0.5 };
    case 'panRL': return { z0: 1.14, z1: 1.14, x0: 0.9, x1: -0.9, y0: fy * 0.5, y1: fy * 0.5 };
    case 'drift': return { z0: 1.05, z1: 1.1, x0: -fx * 0.6, x1: fx * 0.6, y0: -fy * 0.4, y1: fy * 0.4 };
    default: return { z0: 1, z1: 1, x0: 0, x1: 0, y0: 0, y1: 0 };
  }
}

function drawOne(ctx, ph, W, H, fit, m, p, alpha) {
  const iw = ph.w, ih = ph.h;
  const ar = iw / ih, AR = W / H;
  let mode = fit;
  if (mode === 'auto') mode = Math.abs(ar - AR) / AR < 0.12 ? 'cover' : 'blur';
  const pe = p * 0.6 + 0.4 * (0.5 - 0.5 * Math.cos(Math.PI * p)); // suave en extremos
  const z = m.z0 + (m.z1 - m.z0) * pe;
  const ox = m.x0 + (m.x1 - m.x0) * pe, oy = m.y0 + (m.y1 - m.y0) * pe;
  ctx.globalAlpha = alpha;
  if (mode === 'blur') {
    const bs = Math.max(W / ph.blur.width, H / ph.blur.height);
    const bw = ph.blur.width * bs, bh = ph.blur.height * bs;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(ph.blur, (W - bw) / 2, (H - bh) / 2, bw, bh);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
  }
  const base = mode === 'cover' ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
  const s = base * z;
  const w = iw * s, h = ih * s;
  const slackX = Math.abs(w - W) / 2, slackY = Math.abs(h - H) / 2;
  const x = (W - w) / 2 + ox * slackX;
  const y = (H - h) / 2 + oy * slackY;
  ctx.drawImage(ph.img, x, y, w, h);
}

export function drawPhotos(ctx, src, lt, W, H, fit, a) {
  const n = src.photos.length;
  if (!n) return;
  const d = src.photoDur, tr = Math.min(src.photoTr, d / 2), step = d - tr;
  const first = clamp(Math.floor((lt - tr) / step), 0, n - 1);
  for (let i = first; i < n; i++) {
    const st = i * step;
    if (st > lt) break;
    if (lt > st + d && i < n - 1) continue;
    const local = lt - st;
    const fadeIn = i > 0 ? clamp(local / tr) : 1;
    drawOne(ctx, src.photos[i], W, H, fit, motion(src.preset, i, src.seed || 1), clamp(local / d), a * fadeIn);
  }
  ctx.globalAlpha = 1;
}
