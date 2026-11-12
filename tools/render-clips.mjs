// Renderiza las intros/outros base de la biblioteca a MP4 (H.264 + AAC) usando el mismo motor de la app.
// Uso:  npm i puppeteer-core   &&   node tools/render-clips.mjs [ruta/al/repo] [ruta/a/chrome]
// Requiere ffmpeg en el PATH.
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname), '..'));
const CHROME = process.argv[3] || process.env.CHROME || '/usr/bin/google-chrome';
const FPS = 30;

const CLIPS = [
  { id: 'intro-aatp', role: 'intro', name: 'Argentina a tus pies', seed: 1, sound: 5,
    p: { line1: 'ARGENTINA', line2: 'A TUS PIES', sub: 'CLUB DE FANS DE LUIS MIGUEL', dur: 4.5 } },
  { id: 'intro-mickyfest', role: 'intro', name: 'Mickyfest por dentro', seed: 3, sound: 7,
    p: { line1: 'MICKYFEST', line2: 'POR DENTRO', sub: 'ARGENTINA A TUS PIES', dur: 4.5 } },
  { id: 'outro-gracias', role: 'outro', name: '¡Gracias!', seed: 2, sound: 9,
    p: { line1: '¡GRACIAS!', line2: '', sub: 'ARGENTINA A TUS PIES · CLUB DE FANS DE LUIS MIGUEL', dur: 4 } },
  { id: 'outro-hasta-pronto', role: 'outro', name: 'Hasta la próxima', seed: 4, sound: 11,
    p: { line1: 'HASTA LA', line2: 'PRÓXIMA', sub: 'ARGENTINA A TUS PIES', dur: 4 } },
];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.goto(`http://localhost:${port}/tools/render.html`);
await page.waitForFunction('window.ready === true');

const outDir = path.join(ROOT, 'assets/library');
fs.mkdirSync(outDir, { recursive: true });
const lib = { intros: [], outros: [] };

for (const c of CLIPS) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-'));
  await page.evaluate((p) => window.setup(p), { ...c.p, seed: c.seed });
  const n = Math.round(c.p.dur * FPS);
  for (let i = 0; i < n; i++) {
    const data = await page.evaluate((t) => window.frame(t), i / FPS);
    fs.writeFileSync(path.join(tmp, `f${String(i).padStart(4, '0')}.jpg`), Buffer.from(data.split(',')[1], 'base64'));
  }
  const wav = await page.evaluate((d, s) => window.wav(d, s), c.p.dur, c.sound);
  fs.writeFileSync(path.join(tmp, 'a.wav'), Buffer.from(wav, 'base64'));
  const mp4 = path.join(outDir, `${c.id}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(tmp, 'f%04d.jpg'), '-i', path.join(tmp, 'a.wav'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1',
    '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', mp4]);
  const posterIdx = Math.min(n - 1, Math.round(2.4 * FPS));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(tmp, `f${String(posterIdx).padStart(4, '0')}.jpg`), '-vf', 'scale=270:-2', '-q:v', '4', path.join(outDir, `${c.id}.jpg`)]);
  fs.rmSync(tmp, { recursive: true, force: true });
  lib[c.role + 's'].push({ id: c.id, name: c.name, src: `assets/library/${c.id}.mp4`, poster: `assets/library/${c.id}.jpg` });
  console.log('✓', mp4);
}

// Conserva entradas agregadas a mano en library.json
const libPath = path.join(ROOT, 'assets/library.json');
if (fs.existsSync(libPath)) {
  const old = JSON.parse(fs.readFileSync(libPath, 'utf8'));
  for (const k of ['intros', 'outros']) for (const it of old[k] || []) if (!lib[k].some((x) => x.id === it.id)) lib[k].push(it);
}
fs.writeFileSync(libPath, JSON.stringify(lib, null, 2) + '\n');
await browser.close();
server.close();
