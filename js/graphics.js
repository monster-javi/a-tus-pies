// Gráficas prearmadas: tarjeta de título (intro/outro generados), zócalos, títulos, mosca, marco, brillos
import { GoldText, drawGlint } from './gold.js';
import { Glitter, drawBurst } from './particles.js';
import { clamp, easeOutCubic, easeInOutCubic } from './util.js';

const textCache = new Map();
export function gold(lines, opts = {}) {
  const key = JSON.stringify([lines, opts]);
  let g = textCache.get(key);
  if (!g) {
    g = new GoldText(lines, opts);
    textCache.set(key, g);
    if (textCache.size > 48) textCache.delete(textCache.keys().next().value);
  }
  return g;
}
export function clearTextCache() { textCache.clear(); }

const glitters = new Map();
function glitter(key, opts) {
  let g = glitters.get(key);
  if (!g) { g = new Glitter(opts); glitters.set(key, g); }
  return g;
}

function drawLogo(ctx, img, cx, cy, w, alpha) {
  if (!img || !img.width || alpha <= 0) return 0;
  const h = (w * img.height) / img.width;
  const pa = ctx.globalAlpha, pg = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter'; // logo con fondo negro → modo "add"
  ctx.globalAlpha = pa * alpha;
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  ctx.globalAlpha = pa; ctx.globalCompositeOperation = pg;
  return h;
}

function logoSize(img, maxW, maxH) {
  if (!img || !img.width) return { w: 0, h: 0 };
  let w = maxW, h = (w * img.height) / img.width;
  if (h > maxH) { h = maxH; w = (h * img.width) / img.height; }
  return { w, h };
}

// ---------- Tarjeta de título (intro / outro generado) ----------
export function cardTitle(p) {
  return gold([
    { text: (p.line1 || '').toUpperCase(), size: 132 },
    { text: (p.line2 || '').toUpperCase(), size: 132 },
  ], { maxWidth: 940, gap: 0.2, glintCount: 18, seed: 11 });
}
export function cardSub(p) {
  return gold([{ text: (p.sub || '').toUpperCase(), size: 38, weight: 400, tracking: 0.22 }], { maxWidth: 900, glintCount: 3, flat: true, seed: 4 });
}

export function drawCard(ctx, t, W, H, p, alpha = 1, logo = null) {
  const s = W / 1080;
  const D = p.dur || 4;
  const pa = ctx.globalAlpha;
  ctx.globalAlpha = pa * alpha;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const rg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.6);
  rg.addColorStop(0, 'rgba(70,44,12,0.38)');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = pa;

  glitter('card' + (p.seed || 1), { seed: p.seed || 1, count: 230, speed: 0.022, stars: 0.18, bokeh: 5, size: [2, 7] })
    .draw(ctx, t, W, H, { alpha: alpha * clamp(t / 0.8), scale: s });

  const title = cardTitle(p), sub = cardSub(p);
  const tm = title.measure(s), sm = sub.measure(s);
  const useLogo = p.showLogo && logo && logo.width;
  const ls = useLogo ? logoSize(logo, 560 * s, H * (tm.h ? 0.26 : 0.4)) : { w: 0, h: 0 };
  const gap1 = useLogo && tm.h ? 70 * s : 0;
  const gap2 = sm.h ? (tm.h || ls.h ? 46 * s : 0) : 0;
  const total = ls.h + gap1 + tm.h + gap2 + sm.h;
  let y = H / 2 - total / 2;

  if (useLogo) {
    const la = easeOutCubic(clamp((t - 0.05) / 0.9));
    const z = 0.94 + 0.06 * la;
    drawLogo(ctx, logo, W / 2, y + ls.h / 2, ls.w * z, alpha * la);
    y += ls.h + gap1;
  }
  if (tm.h) {
    const ty = y + tm.h / 2;
    const rv = easeInOutCubic(clamp((t - 0.25) / 1.15));
    const zoom = 1.1 - 0.1 * easeOutCubic(clamp((t - 0.2) / 1.7));
    let sweep = null;
    if (t > 1.5 && t < 2.8) sweep = (t - 1.5) / 1.3;
    else if (D > 5.5 && t > D - 2.3 && t < D - 1.0) sweep = (t - (D - 2.3)) / 1.3;
    title.draw(ctx, W / 2, ty, s, {
      alpha: alpha * clamp((t - 0.2) / 0.4), reveal: rv, zoom, sweep,
      glow: 0.5 + 0.12 * Math.sin(t * 2.2), glints: t, glintAmount: clamp((t - 0.9) / 0.6), glintSize: 1.5,
    });
    drawBurst(ctx, t - 0.45, W / 2, ty, s, { spanW: tm.w * 0.8, alpha, seed: (p.seed || 1) + 7 });
    y += tm.h + gap2;
  }
  if (sm.h) {
    const sa = clamp((t - 1.25) / 0.7);
    sub.draw(ctx, W / 2, y + sm.h / 2 + (1 - easeOutCubic(sa)) * 24 * s, s, { alpha: alpha * sa, glow: 0.25, glints: t, glintAmount: 0.6 });
  }
}

// ---------- Overlays sobre el video principal ----------
function inOut(lt, dur, tin = 0.6, tout = 0.45) {
  if (lt < 0 || lt > dur) return 0;
  return Math.min(clamp(lt / tin), clamp((dur - lt) / tout));
}

function drawZocalo(ctx, lt, W, H, z, alpha) {
  const dur = z.dur || 5;
  if (lt < 0 || lt > dur) return;
  const s = W / 1080;
  const vin = inOut(lt, dur, 0.7, 0.5);
  const out = clamp((dur - lt) / 0.5);
  const a = alpha * vin;
  if (a <= 0.001) return;
  const name = gold([{ text: (z.name || '').toUpperCase(), size: 64, tracking: 0.04 }], {
    align: z.style === 'placa' ? 'center' : 'left', maxWidth: 900, glintCount: 6, seed: 21,
  });
  const desc = z.desc || '';
  const nm = name.measure(s);
  const pa = ctx.globalAlpha;
  const yLine = H * (z.y ?? 0.8);

  if (z.style === 'placa') {
    const pw = Math.min(W * 0.9, Math.max(nm.w, measureDesc(ctx, desc, s)) + 120 * s);
    const ph = nm.h + (desc ? 70 * s : 0) + 70 * s;
    const top = yLine - ph / 2;
    const grow = easeOutCubic(clamp(lt / 0.6)) * out;
    ctx.globalAlpha = pa * a * 0.72;
    ctx.fillStyle = '#060402';
    ctx.fillRect(W / 2 - pw / 2, top, pw, ph);
    ctx.globalAlpha = pa * a;
    goldLine(ctx, W / 2 - (pw / 2) * grow, top, pw * grow, 3 * s);
    goldLine(ctx, W / 2 - (pw / 2) * grow, top + ph - 3 * s, pw * grow, 3 * s);
    ctx.globalAlpha = pa;
    const ny = top + 35 * s + nm.h / 2;
    name.draw(ctx, W / 2, ny, s, { alpha: a, reveal: easeInOutCubic(clamp((lt - 0.15) / 0.7)), sweep: lt > 0.9 && lt < 2.1 ? (lt - 0.9) / 1.2 : null, glow: 0.35, glints: lt, glintAmount: 0.7 });
    if (desc) drawDesc(ctx, desc, W / 2, ny + nm.h / 2 + 46 * s, s, a * clamp((lt - 0.35) / 0.5), 'center');
    return;
  }

  // Estilo "dorado" a la izquierda
  const x0 = 70 * s;
  ctx.globalAlpha = pa * a * 0.85;
  const pg = ctx.createLinearGradient(0, 0, W * 0.9, 0);
  pg.addColorStop(0, 'rgba(0,0,0,0.75)'); pg.addColorStop(0.6, 'rgba(0,0,0,0.4)'); pg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = pg;
  ctx.fillRect(0, yLine - nm.h - 60 * s, W * 0.9, nm.h + (desc ? 140 : 90) * s);
  ctx.globalAlpha = pa * alpha * out;
  const L = Math.max(nm.w, 420 * s) * 1.08 * easeOutCubic(clamp(lt / 0.65));
  goldLine(ctx, x0, yLine, L, 3.5 * s, true);
  if (lt < 0.8) {
    ctx.globalCompositeOperation = 'lighter';
    drawGlint(ctx, x0 + L, yLine + 1.5 * s, 46 * s, (1 - lt / 0.8) * alpha);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.globalAlpha = pa;
  name.draw(ctx, x0, yLine - 20 * s - nm.h / 2, s, {
    alpha: a, reveal: easeInOutCubic(clamp((lt - 0.12) / 0.7)),
    sweep: lt > 0.9 && lt < 2.1 ? (lt - 0.9) / 1.2 : null, glow: 0.35, glints: lt, glintAmount: 0.7,
  });
  if (desc) {
    const da = clamp((lt - 0.35) / 0.5);
    drawDesc(ctx, desc, x0, yLine + 50 * s + (1 - easeOutCubic(da)) * 14 * s, s, a * da, 'left');
  }
}

function measureDesc(ctx, txt, s) {
  ctx.save();
  ctx.font = `italic 600 ${46 * s}px "Cormorant Garamond", Georgia, serif`;
  const w = ctx.measureText(txt).width;
  ctx.restore();
  return w;
}
function drawDesc(ctx, txt, x, y, s, a, align) {
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha *= a;
  let px = 46 * s;
  ctx.font = `italic 600 ${px}px "Cormorant Garamond", Georgia, serif`;
  const maxW = ctx.canvas.width * 0.86;
  const w = ctx.measureText(txt).width;
  if (w > maxW) { px *= maxW / w; ctx.font = `italic 600 ${px}px "Cormorant Garamond", Georgia, serif`; }
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 10 * s; ctx.shadowOffsetY = 2 * s;
  ctx.fillStyle = '#f4e6c4';
  ctx.fillText(txt, x, y);
  ctx.restore();
}

function goldLine(ctx, x, y, w, h, fadeRight = false) {
  if (w <= 0) return;
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  if (fadeRight) {
    g.addColorStop(0, '#b8862f'); g.addColorStop(0.3, '#fff0b5'); g.addColorStop(0.7, '#d9aa4c'); g.addColorStop(1, 'rgba(217,170,76,0)');
  } else {
    g.addColorStop(0, 'rgba(184,134,47,0)'); g.addColorStop(0.2, '#d9aa4c'); g.addColorStop(0.5, '#fff0b5'); g.addColorStop(0.8, '#d9aa4c'); g.addColorStop(1, 'rgba(184,134,47,0)');
  }
  ctx.fillStyle = g;
  ctx.fillRect(x, y - h / 2, w, h);
}

function drawTitulo(ctx, lt, W, H, o, alpha) {
  const dur = o.dur || 4;
  if (lt < 0 || lt > dur) return;
  const s = W / 1080;
  const g = gold([{ text: (o.text || '').toUpperCase(), size: 112 }, { text: (o.text2 || '').toUpperCase(), size: 112 }], { maxWidth: 940, glintCount: 14, seed: 33 });
  const m = g.measure(s);
  if (!m.h) return;
  const y = o.pos === 'arriba' ? H * 0.17 + m.h / 2 : o.pos === 'abajo' ? H * 0.76 : H / 2;
  const a = alpha * clamp((dur - lt) / 0.5) * clamp(lt / 0.3);
  // velo oscuro suave detrás para legibilidad
  const pa = ctx.globalAlpha;
  const R = Math.max(m.w, m.h) * 0.7;
  const vg = ctx.createRadialGradient(W / 2, y, 0, W / 2, y, R);
  vg.addColorStop(0, 'rgba(0,0,0,0.5)'); vg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = pa * a; ctx.fillStyle = vg;
  ctx.save(); ctx.translate(W / 2, y); ctx.scale(1, 0.55); ctx.translate(-W / 2, -y);
  ctx.fillRect(W / 2 - R, y - R, 2 * R, 2 * R);
  ctx.restore();
  ctx.globalAlpha = pa;
  g.draw(ctx, W / 2, y, s, {
    alpha: a, reveal: easeInOutCubic(clamp((lt - 0.05) / 1.0)), zoom: 1.06 - 0.06 * easeOutCubic(lt / 1.6),
    sweep: lt > 1.2 && lt < 2.4 ? (lt - 1.2) / 1.2 : null, glints: lt, glintAmount: clamp((lt - 0.7) / 0.5),
  });
  drawBurst(ctx, lt - 0.25, W / 2, y, s, { spanW: m.w * 0.8, alpha: alpha * clamp((dur - lt) / 0.5), count: 60, seed: 41 });
}

function drawMosca(ctx, lt, W, H, o, alpha, logo) {
  const s = W / 1080;
  const sizeMul = o.size === 'grande' ? 1.45 : o.size === 'chica' ? 0.75 : 1;
  const m = 46 * s;
  const right = (o.corner || 'sup-der').endsWith('der');
  const top = (o.corner || 'sup-der').startsWith('sup');
  const a = alpha * (o.opacity ?? 0.9) * clamp(lt / 0.6);
  if (logo && logo.width && o.useLogo !== false) {
    const ls = logoSize(logo, 220 * s * sizeMul, 180 * s * sizeMul);
    const cx = right ? W - m - ls.w / 2 : m + ls.w / 2;
    const cy = top ? m + ls.h / 2 + (H > W * 1.5 ? 60 * s : 0) : H - m - ls.h / 2 - (H > W * 1.5 ? 170 * s : 0);
    drawLogo(ctx, logo, cx, cy, ls.w, a);
  } else {
    const g = gold([{ text: 'ARGENTINA', size: 34 * sizeMul, tracking: 0.08 }, { text: 'A TUS PIES', size: 34 * sizeMul, tracking: 0.12 }], { glintCount: 4, gap: 0.12, seed: 55 });
    const mm = g.measure(s);
    const cx = right ? W - m - mm.w / 2 : m + mm.w / 2;
    const cy = top ? m + mm.h / 2 + (H > W * 1.5 ? 60 * s : 0) : H - m - mm.h / 2 - (H > W * 1.5 ? 170 * s : 0);
    g.draw(ctx, cx, cy, s, { alpha: a, glow: 0.3, glints: lt, glintAmount: 0.5, sweep: ((lt % 9) - 1) / 1.5 });
  }
}

function drawMarco(ctx, lt, W, H, o, alpha) {
  const s = W / 1080;
  const a = alpha * clamp(lt / 0.8);
  if (a <= 0) return;
  const pa = ctx.globalAlpha;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#8a6020'); g.addColorStop(0.25, '#f6dc8c'); g.addColorStop(0.5, '#b8862f'); g.addColorStop(0.75, '#fff0b5'); g.addColorStop(1, '#8a6020');
  ctx.globalAlpha = pa * a;
  ctx.strokeStyle = g;
  const i1 = 30 * s, i2 = 42 * s;
  ctx.lineWidth = 4 * s; ctx.strokeRect(i1, i1, W - 2 * i1, H - 2 * i1);
  ctx.lineWidth = 1.5 * s; ctx.strokeRect(i2, i2, W - 2 * i2, H - 2 * i2);
  ctx.fillStyle = g;
  const corners = [[i1, i1], [W - i1, i1], [i1, H - i1], [W - i1, H - i1]];
  corners.forEach(([x, y]) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
    ctx.fillRect(-9 * s, -9 * s, 18 * s, 18 * s);
    ctx.restore();
  });
  ctx.globalCompositeOperation = 'lighter';
  corners.forEach(([x, y], i) => {
    const tw = Math.pow(Math.max(0, Math.sin(lt * 1.3 + i * 1.7)), 8);
    drawGlint(ctx, x, y, 50 * s * (0.6 + 0.6 * tw), a * tw);
  });
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = pa;
}

const BRILLOS = { suave: 60, medio: 120, mucho: 220 };
function drawBrillos(ctx, lt, W, H, o, alpha) {
  const n = BRILLOS[o.amount] || 120;
  glitter('ov' + n, { seed: 77 + n, count: n, speed: 0.03, stars: 0.14, bokeh: Math.round(n / 25), size: [1.5, 5.5] })
    .draw(ctx, lt, W, H, { alpha: alpha * 0.85 * clamp(lt / 1), scale: W / 1080 });
}

const ORDER = { marco: 0, brillos: 1, mosca: 2, titulo: 3, zocalo: 4 };
export function drawOverlays(ctx, lt, W, H, overlays, alpha, logo) {
  if (!overlays || !overlays.length || alpha <= 0) return;
  const list = [...overlays].sort((a, b) => (ORDER[a.type] ?? 9) - (ORDER[b.type] ?? 9));
  for (const o of list) {
    if (o.enabled === false) continue;
    const st = o.start || 0;
    switch (o.type) {
      case 'zocalo': drawZocalo(ctx, lt - st, W, H, o, alpha); break;
      case 'titulo': drawTitulo(ctx, lt - st, W, H, o, alpha); break;
      case 'mosca': drawMosca(ctx, lt, W, H, o, alpha, logo); break;
      case 'marco': drawMarco(ctx, lt, W, H, o, alpha); break;
      case 'brillos': drawBrillos(ctx, lt, W, H, o, alpha); break;
    }
  }
}
