// Partículas doradas con glitter (posición = función del tiempo → render determinístico)
import { rng, mkCanvas, fract } from './util.js';
import { drawGlint } from './gold.js';

let dotSprite = null, bokehSprite = null;
function getDot() {
  if (dotSprite) return dotSprite;
  const c = mkCanvas(64, 64), x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,250,228,1)');
  g.addColorStop(0.22, 'rgba(255,218,125,0.85)');
  g.addColorStop(0.55, 'rgba(220,150,50,0.18)');
  g.addColorStop(1, 'rgba(200,120,30,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  dotSprite = c; return c;
}
function getBokeh() {
  if (bokehSprite) return bokehSprite;
  const c = mkCanvas(128, 128), x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,205,120,0.16)');
  g.addColorStop(0.6, 'rgba(255,195,105,0.09)');
  g.addColorStop(1, 'rgba(255,200,120,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  bokehSprite = c; return c;
}

export class Glitter {
  constructor({ seed = 1, count = 140, speed = 0.025, dir = -1, size = [1.5, 5], stars = 0.1, bokeh = 6 } = {}) {
    const r = rng(seed);
    this.p = [];
    for (let i = 0; i < count; i++) {
      this.p.push({
        x: r(), y: r(), vx: (r() - 0.5) * 0.012, vy: dir * speed * (0.3 + 0.7 * r()),
        sw: r() * 0.012, sf: 0.3 + r() * 0.8, s: size[0] + (size[1] - size[0]) * Math.pow(r(), 2.2),
        f: 1 + r() * 4, ph: r() * 6.283, star: r() < stars,
      });
    }
    this.b = [];
    for (let i = 0; i < bokeh; i++) {
      this.b.push({ x: r(), y: r(), vy: dir * speed * 0.3 * (0.4 + r()), s: 40 + r() * 90, f: 0.3 + r() * 0.6, ph: r() * 6.283 });
    }
  }

  draw(ctx, t, W, H, { alpha = 1, scale = W / 1080 } = {}) {
    if (alpha <= 0.001) return;
    const pa = ctx.globalAlpha, pg = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    const bk = getBokeh(), dot = getDot();
    for (const b of this.b) {
      const x = fract(b.x) * W, y = (fract(b.y + b.vy * t) * 1.2 - 0.1) * H;
      const s = b.s * scale;
      ctx.globalAlpha = pa * alpha * (0.3 + 0.25 * Math.sin(t * b.f + b.ph));
      ctx.drawImage(bk, x - s, y - s, s * 2, s * 2);
    }
    for (const p of this.p) {
      const x = (fract(p.x + p.vx * t + p.sw * Math.sin(t * p.sf + p.ph)) * 1.1 - 0.05) * W;
      const y = (fract(p.y + p.vy * t) * 1.1 - 0.05) * H;
      const tw = 0.5 + 0.5 * Math.sin(t * p.f + p.ph);
      const s = p.s * scale;
      if (p.star) {
        const k = Math.pow(tw, 6);
        drawGlint(ctx, x, y, s * (3 + 6 * k), alpha * (0.25 + 0.75 * k), k > 0.4);
      } else {
        ctx.globalAlpha = pa * alpha * (0.2 + 0.8 * Math.pow(tw, 3));
        const d = s * 3.4;
        ctx.drawImage(dot, x - d / 2, y - d / 2, d, d);
      }
    }
    ctx.globalAlpha = pa;
    ctx.globalCompositeOperation = pg;
  }
}

// Explosión de polvo dorado (t = tiempo desde el disparo)
export function drawBurst(ctx, t, cx, cy, scale, { seed = 3, count = 80, life = 1.8, speed = 560, spanW = 600, alpha = 1 } = {}) {
  if (t < 0 || t > life || alpha <= 0) return;
  const r = rng(seed);
  const pa = ctx.globalAlpha, pg = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  const dot = getDot();
  for (let i = 0; i < count; i++) {
    const ang = r() * Math.PI * 2;
    const sp = speed * (0.15 + 0.85 * r()) * scale;
    const ox = (r() - 0.5) * spanW;
    const lf = life * (0.5 + 0.5 * r());
    const sz = (1.5 + r() * 4) * scale;
    const isStar = r() < 0.15;
    const ph = r() * 6.28;
    if (t > lf) continue;
    const k = 2.4;
    const d = (sp * (1 - Math.exp(-k * t))) / k;
    const x = cx + ox + Math.cos(ang) * d;
    const y = cy + Math.sin(ang) * d * 0.6 + 70 * scale * t * t;
    const a = Math.pow(1 - t / lf, 1.6) * (0.6 + 0.4 * Math.sin(t * 14 + ph)) * alpha;
    if (isStar) drawGlint(ctx, x, y, sz * 5, a, false);
    else { ctx.globalAlpha = pa * a; ctx.drawImage(dot, x - sz * 1.5, y - sz * 1.5, sz * 3, sz * 3); }
  }
  ctx.globalAlpha = pa;
  ctx.globalCompositeOperation = pg;
}
