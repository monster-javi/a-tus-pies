// Letras doradas con bisel, brillo, barrido de luz y destellos tipo lens-flare
import { mkCanvas, rng } from './util.js';

const GOLD_STOPS = [
  [0, '#fff8dc'], [0.14, '#f8df8f'], [0.36, '#d1a046'], [0.5, '#875c18'],
  [0.57, '#b9852d'], [0.74, '#f2d27c'], [0.88, '#fff0b8'], [1, '#a3732a'],
];

let glintSprite = null;
let streakSprite = null;

function getGlint() {
  if (glintSprite) return glintSprite;
  const S = 256, m = S / 2;
  const c = mkCanvas(S, S), x = c.getContext('2d');
  const g = x.createRadialGradient(m, m, 0, m, m, m);
  g.addColorStop(0, 'rgba(255,255,250,1)');
  g.addColorStop(0.06, 'rgba(255,246,215,0.95)');
  g.addColorStop(0.18, 'rgba(255,210,120,0.35)');
  g.addColorStop(0.45, 'rgba(255,170,60,0.07)');
  g.addColorStop(1, 'rgba(255,150,40,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  x.globalCompositeOperation = 'lighter';
  const ray = (ang, len, w) => {
    x.save(); x.translate(m, m); x.rotate(ang);
    const lg = x.createLinearGradient(0, 0, len, 0);
    lg.addColorStop(0, 'rgba(255,252,235,1)');
    lg.addColorStop(0.35, 'rgba(255,225,150,0.5)');
    lg.addColorStop(1, 'rgba(255,190,90,0)');
    x.fillStyle = lg;
    x.beginPath(); x.moveTo(0, -w); x.lineTo(len, 0); x.lineTo(0, w); x.closePath(); x.fill();
    x.restore();
  };
  for (let i = 0; i < 4; i++) ray(i * Math.PI / 2, i % 2 ? m * 0.75 : m, 4.5);
  for (let i = 0; i < 4; i++) ray(Math.PI / 4 + i * Math.PI / 2, m * 0.3, 2);
  glintSprite = c;
  return c;
}

function getStreak() {
  if (streakSprite) return streakSprite;
  const c = mkCanvas(512, 48), x = c.getContext('2d');
  x.save(); x.translate(256, 24); x.scale(1, 0.07);
  const g = x.createRadialGradient(0, 0, 0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,250,230,0.95)');
  g.addColorStop(0.2, 'rgba(255,215,140,0.45)');
  g.addColorStop(1, 'rgba(255,170,70,0)');
  x.fillStyle = g; x.fillRect(-256, -400, 512, 800);
  x.restore();
  streakSprite = c;
  return c;
}

// Destello (usar con globalCompositeOperation = 'lighter')
export function drawGlint(ctx, x, y, r, a, streak = true) {
  if (a <= 0.01 || r <= 0.5) return;
  const pa = ctx.globalAlpha;
  ctx.globalAlpha = pa * Math.min(1, a);
  ctx.drawImage(getGlint(), x - r, y - r, 2 * r, 2 * r);
  if (streak) {
    ctx.globalAlpha = pa * Math.min(1, a) * 0.7;
    ctx.drawImage(getStreak(), x - r * 3.4, y - r * 0.32, r * 6.8, r * 0.64);
  }
  ctx.globalAlpha = pa;
}

const fontStr = (l, px) => `${l.italic ? 'italic ' : ''}${l.weight} ${px.toFixed(2)}px ${l.family}`;

export class GoldText {
  // lines: [{ text, size (px a 1080 de ancho), family, weight, tracking (em) }]
  constructor(lines, opts = {}) {
    this.lines = (lines || [])
      .filter((l) => l && l.text && String(l.text).trim())
      .map((l) => ({ family: 'Cinzel', weight: 700, tracking: 0.03, size: 100, italic: false, ...l, text: String(l.text) }));
    this.opts = { gap: 0.18, maxWidth: 0, align: 'center', glintCount: 16, seed: 7, flat: false, ...opts };
    this.builds = new Map();
  }

  get empty() { return this.lines.length === 0; }

  build(scale) {
    const key = Math.round(scale * 1000);
    if (this.builds.has(key)) return this.builds.get(key);
    const o = this.opts;
    const mc = mkCanvas(4, 4).getContext('2d');

    const measureLine = (l, px) => {
      mc.font = fontStr(l, px);
      const tr = l.tracking * px;
      const chars = [...l.text];
      let w = 0;
      const ws = chars.map((ch) => mc.measureText(ch).width);
      ws.forEach((cw, i) => { w += cw + (i < ws.length - 1 ? tr : 0); });
      const m = mc.measureText(l.text);
      const asc = m.actualBoundingBoxAscent || px * 0.72;
      const desc = m.actualBoundingBoxDescent || px * 0.05;
      return { chars, ws, w, asc, desc, tr };
    };

    let maxW = 0;
    for (const l of this.lines) maxW = Math.max(maxW, measureLine(l, l.size * scale).w);
    const fit = o.maxWidth > 0 && maxW > o.maxWidth * scale ? (o.maxWidth * scale) / maxW : 1;

    const lay = this.lines.map((l) => {
      const px = l.size * scale * fit;
      return { l, px, font: fontStr(l, px), ...measureLine(l, px) };
    });
    const maxPx = Math.max(...lay.map((L) => L.px));
    const P = Math.ceil(maxPx * 0.6);
    const lw = Math.max(...lay.map((L) => L.w));
    let y = P;
    lay.forEach((L, i) => {
      if (i > 0) y += lay[i - 1].px * o.gap;
      L.baseline = y + L.asc;
      y = L.baseline + L.desc;
    });
    const W = Math.ceil(lw + 2 * P);
    const H = Math.ceil(y + P);
    lay.forEach((L) => {
      L.x0 = o.align === 'left' ? P : (W - L.w) / 2;
      let x = L.x0;
      L.pos = L.ws.map((cw, i) => { const p = x; x += cw + L.tr; return p; });
    });

    const each = (ctx, fn) => {
      ctx.textBaseline = 'alphabetic';
      for (const L of lay) { ctx.font = L.font; L.chars.forEach((ch, i) => fn(ctx, L, ch, L.pos[i])); }
    };

    // Máscara
    const M = mkCanvas(W, H), m = M.getContext('2d');
    m.fillStyle = '#fff';
    each(m, (x, L, ch, px) => x.fillText(ch, px, L.baseline));

    // Sprite principal
    const S = mkCanvas(W, H), c = S.getContext('2d');
    if (!o.flat) {
      c.save();
      c.shadowColor = 'rgba(0,0,0,0.85)';
      c.shadowBlur = maxPx * 0.05;
      c.shadowOffsetY = maxPx * 0.025;
      c.lineJoin = 'round';
      for (const L of lay) {
        const g = c.createLinearGradient(0, L.baseline - L.asc, 0, L.baseline + L.desc);
        g.addColorStop(0, '#a87a2a'); g.addColorStop(1, '#3a2405');
        c.strokeStyle = g; c.lineWidth = L.px * 0.045; c.font = L.font;
        L.chars.forEach((ch, i) => c.strokeText(ch, L.pos[i], L.baseline));
      }
      c.restore();
    }
    for (const L of lay) {
      const g = c.createLinearGradient(0, L.baseline - L.asc, 0, L.baseline + L.desc * 0.3);
      GOLD_STOPS.forEach(([s, col]) => g.addColorStop(s, col));
      c.fillStyle = g; c.font = L.font;
      if (o.flat) { c.shadowColor = 'rgba(0,0,0,0.8)'; c.shadowBlur = L.px * 0.12; c.shadowOffsetY = L.px * 0.04; }
      L.chars.forEach((ch, i) => c.fillText(ch, L.pos[i], L.baseline));
    }
    c.shadowColor = 'transparent';

    if (!o.flat) {
      // Bisel: borde superior claro / inferior oscuro
      const E = mkCanvas(W, H), e = E.getContext('2d');
      const edge = (dy, color, alpha) => {
        e.globalCompositeOperation = 'source-over'; e.clearRect(0, 0, W, H); e.drawImage(M, 0, 0);
        e.globalCompositeOperation = 'destination-out'; e.drawImage(M, 0, dy);
        e.globalCompositeOperation = 'source-in'; e.fillStyle = color; e.fillRect(0, 0, W, H);
        c.globalAlpha = alpha; c.drawImage(E, 0, 0); c.globalAlpha = 1;
      };
      const d = Math.max(1, maxPx * 0.022);
      edge(d, '#fffbe8', 0.85);
      edge(-d, '#4a2c06', 0.5);
    }

    // Halo
    const G = mkCanvas(W, H), gx = G.getContext('2d');
    const off = W + H + 2000;
    gx.shadowOffsetX = off;
    gx.shadowColor = 'rgba(255,175,60,1)'; gx.shadowBlur = maxPx * 0.45; gx.drawImage(M, -off, 0);
    gx.shadowColor = 'rgba(255,220,140,0.9)'; gx.shadowBlur = maxPx * 0.12; gx.drawImage(M, -off, 0);

    // Puntos candidatos a destello (bordes superiores de las letras)
    const points = [];
    if (o.glintCount > 0) {
      const data = m.getImageData(0, 0, W, H).data;
      const A = (x, y) => data[(y * W + x) * 4 + 3];
      const step = Math.max(2, Math.round(maxPx * 0.03));
      const cand = [];
      for (let y = step; y < H - step; y += step) {
        for (let x = step; x < W - step; x += step) {
          if (A(x, y) > 200 && (A(x, y - step) < 30 || A(x - step, y) < 30 || A(x + step, y) < 30)) cand.push([x, y]);
        }
      }
      const r = rng(o.seed);
      for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
      const minD = maxPx * 0.45;
      for (const [x, y] of cand) {
        if (points.length >= o.glintCount) break;
        if (points.some((p) => Math.hypot(p.x - x, p.y - y) < minD)) continue;
        points.push({ x, y, r: maxPx * (0.28 + r() * 0.3), f: 1.1 + r() * 1.6, ph: r() * Math.PI * 2, streak: r() < 0.65 });
      }
    }

    const b = { W, H, P, S, G, points, sc: mkCanvas(W, H), textW: lw, textH: H - 2 * P, maxPx };
    this.builds.set(key, b);
    return b;
  }

  measure(scale) {
    if (this.empty) return { w: 0, h: 0 };
    const b = this.build(scale);
    return { w: b.textW, h: b.textH, b };
  }

  // x,y: centro del bloque (align center) o borde izquierdo + centro vertical (align left)
  draw(ctx, x, y, scale, o = {}) {
    if (this.empty) return null;
    const b = this.build(scale);
    const a = o.alpha ?? 1;
    if (a <= 0.001) return b;
    const z = o.zoom || 1;
    const w = b.W * z, h = b.H * z;
    const left = this.opts.align === 'left' ? x - b.P * z : x - w / 2;
    const top = y - h / 2;
    const reveal = o.reveal ?? 1;
    const glow = o.glow ?? 0.55;
    const pa = ctx.globalAlpha, pg = ctx.globalCompositeOperation;
    const soft = b.W * 0.18;
    const edgePx = -soft + reveal * (b.W + soft);

    if (glow > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = pa * a * glow * Math.min(1, reveal * 1.2);
      ctx.drawImage(b.G, left, top, w, h);
    }

    let src = b.S;
    const sweep = o.sweep;
    if (reveal < 1 || (sweep != null && sweep > -0.2 && sweep < 1.2)) {
      const c = b.sc.getContext('2d');
      c.globalCompositeOperation = 'source-over';
      c.clearRect(0, 0, b.W, b.H);
      c.drawImage(b.S, 0, 0);
      if (sweep != null) {
        c.globalCompositeOperation = 'source-atop';
        const bw = b.H * 0.8;
        const cx = -bw + sweep * (b.W + 2 * bw);
        const g = c.createLinearGradient(cx - bw * 0.5, b.H * 0.5 + bw * 0.4, cx + bw * 0.5, b.H * 0.5 - bw * 0.4);
        g.addColorStop(0, 'rgba(255,250,225,0)');
        g.addColorStop(0.5, 'rgba(255,253,240,0.92)');
        g.addColorStop(1, 'rgba(255,250,225,0)');
        c.fillStyle = g; c.fillRect(0, 0, b.W, b.H);
      }
      if (reveal < 1) {
        c.globalCompositeOperation = 'destination-in';
        const g = c.createLinearGradient(edgePx, 0, edgePx + soft, 0);
        g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g; c.fillRect(0, 0, b.W, b.H);
      }
      c.globalCompositeOperation = 'source-over';
      src = b.sc;
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = pa * a;
    ctx.drawImage(src, left, top, w, h);

    if (o.glints != null && b.points.length) {
      ctx.globalCompositeOperation = 'lighter';
      const t = o.glints, amt = o.glintAmount ?? 1;
      for (const p of b.points) {
        if (p.x > edgePx) continue;
        const tw = Math.pow(Math.max(0, Math.sin(t * p.f + p.ph)), 6);
        const inten = tw * amt;
        if (inten < 0.02) continue;
        drawGlint(ctx, left + p.x * z, top + p.y * z, p.r * z * (0.6 + 0.6 * tw) * (o.glintSize || 1), inten * a, p.streak);
      }
    }
    ctx.globalAlpha = pa;
    ctx.globalCompositeOperation = pg;
    return b;
  }
}
