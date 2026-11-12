// Interfaz: Argentina a tus pies · Editor de videos
import { Engine, FORMATS, makeVideo, decodeAudio, pickMime } from './engine.js';
import { makeShimmer } from './sound.js';
import { clearTextCache } from './graphics.js';
import { loadFonts, fmtTime, clamp } from './util.js';
import { loadPhoto, freePhoto, photosDuration, PHOTO_PRESETS } from './photos.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  kids.flat().forEach((c) => c != null && el.append(c.nodeType ? c : document.createTextNode(c)));
  return el;
};

const STORE = 'aatp:v1';
const DEFAULTS = {
  format: '9x16', fit: 'auto', trans: { type: 'crossfade', dur: 0.6 }, volume: 1,
  mode: 'video', photoDur: 3.5, photoTr: 0.9, preset: 'random',
  music: { vol: -3, bed: -16 },
  intro: { choice: null }, outro: { choice: null },
  gen: {
    intro: { line1: 'Argentina', line2: 'a tus pies', sub: 'Club de fans de Luis Miguel', sub2: '', dur: 4.5, showLogo: false, sound: true },
    outro: { line1: '¡Gracias!', line2: '', sub: 'Argentina a tus pies', sub2: 'Club de fans de Luis Miguel', dur: 4, showLogo: true, sound: true },
  },
  overlays: [
    { id: 1, type: 'zocalo', style: 'dorado', name: 'Argentina a tus pies', desc: 'Club de fans de Luis Miguel', start: 1, dur: 5, y: 0.8 },
  ],
};

let state;
try { state = { ...structuredClone(DEFAULTS), ...JSON.parse(localStorage.getItem(STORE) || '{}') }; }
catch (e) { state = structuredClone(DEFAULTS); }
state.music = { ...DEFAULTS.music, ...state.music };
state.gen = { intro: { ...DEFAULTS.gen.intro, ...state.gen?.intro }, outro: { ...DEFAULTS.gen.outro, ...state.gen?.outro } };
let saveT = 0;
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* */ } }, 300); };
let ovId = Math.max(0, ...state.overlays.map((o) => o.id || 0)) + 1;

const canvas = $('#preview');
const engine = new Engine(canvas);
engine.format = state.format;
engine.fit = state.fit;
engine.transition = { ...state.trans };
engine.overlays = state.overlays;
engine.setResolution(engine.previewScale);
let library = { intros: [], outros: [] };

// ---------- Utilidades UI ----------
function busy(text) {
  const b = $('#busy');
  if (text) { $('#busyText').textContent = text; b.hidden = false; } else b.hidden = true;
}
function toast(msg) { alert(msg); }

function setSeg(id, value, onPick) {
  const seg = $(id);
  const mark = (v) => $$('button', seg).forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));
  mark(value);
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    mark(b.dataset.v); onPick(b.dataset.v);
  });
}

function updateAspect() {
  const f = FORMATS[state.format];
  $('#canvasWrap').style.aspectRatio = `${f.w} / ${f.h}`;
}

function rebuild() {
  engine.rebuild();
  engine.refresh();
  updateTime(engine.t);
  updateSummary();
}

// ---------- Pestañas ----------
function goTab(name) {
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $$('.tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + name));
  if (name === 'exportar') updateSummary();
  if (name === 'musica') requestAnimationFrame(drawWave);
  if (name === 'intro' && engine.sources.intro) engine.seek(Math.min(1.8, engine.total));
  if (name === 'outro' && engine.sources.outro) { const s = engine.segments.find((x) => x.role === 'outro'); if (s) engine.seek(s.start + Math.min(1.8, s.dur)); }
  $('.panel').scrollIntoView({ block: 'nearest' });
}
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) goTab(b.dataset.tab); });
$$('[data-goto]').forEach((b) => b.addEventListener('click', () => goTab(b.dataset.goto)));

// ---------- Transporte ----------
const playBtn = $('#playBtn');
const scrub = $('#scrub');
let scrubbing = false, wasPlaying = false;

playBtn.addEventListener('click', () => {
  if (!engine.segments.length) { $(state.mode === 'fotos' ? '#photoFiles' : '#mainFile').click(); return; }
  if (engine.exporting) return;
  engine.unlock(); // sincrónico dentro del toque (iOS)
  engine.toggle();
});
engine.on('state', (p) => { playBtn.textContent = p ? '❚❚' : '▶'; });
engine.on('time', (t) => updateTime(t));
engine.on('timeline', () => updateTime(engine.t));

function updateTime(t) {
  $('#timeLbl').textContent = `${fmtTime(t)} / ${fmtTime(engine.total)}`;
  if (!scrubbing) scrub.value = engine.total ? Math.round((t / engine.total) * 1000) : 0;
}
const scrubTo = () => engine.seek((scrub.value / 1000) * engine.total);
scrub.addEventListener('pointerdown', () => { scrubbing = true; wasPlaying = engine.playing; if (wasPlaying) engine.pause(); });
scrub.addEventListener('input', () => { scrubbing = true; scrubTo(); $('#timeLbl').textContent = `${fmtTime((scrub.value / 1000) * engine.total)} / ${fmtTime(engine.total)}`; });
scrub.addEventListener('change', () => { scrubTo(); scrubbing = false; if (wasPlaying) { engine.unlock(); engine.play(); } wasPlaying = false; });

// ---------- Video principal ----------
let mainToken = 0;
$('#mainFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  engine.unlock();
  const tok = ++mainToken;
  busy('Cargando video…');
  try {
    if (videoSrc) { try { URL.revokeObjectURL(videoSrc.el.src); videoSrc.el.remove(); } catch (x) { /* */ } }
    engine.pause();
    const url = URL.createObjectURL(file);
    const el = await makeVideo(url);
    if (tok !== mainToken) return;
    const src = { kind: 'video', el, file, duration: el.duration, in: 0, out: el.duration, volume: state.volume };
    videoSrc = src;
    applyMode();
    engine.unlockElement(el);
    $('#mainFileName').textContent = file.name || 'Video cargado';
    $('#mainControls').classList.remove('disabled');
    $('#inRange').value = 0; $('#outRange').value = 1000;
    updateTrimLabels();
    busy('Preparando el audio…');
    if (file.size < 380 * 1024 * 1024) {
      try { src.audioBuffer = await decodeAudio(await file.arrayBuffer()); } catch (x) { src.useElementAudio = true; }
    } else src.useElementAudio = true;
    if (tok !== mainToken) return;
    rebuild();
    const m = engine.mainSeg();
    engine.seek(m ? m.start + Math.min(0.5, m.dur / 2) : 0);
  } catch (err) {
    console.error(err);
    toast('No pude abrir ese video. Probá con otro archivo (MP4 o MOV del celular).');
  } finally { if (tok === mainToken) busy(null); }
});

function updateTrimLabels() {
  const m = videoSrc; if (!m) return;
  $('#inLbl').textContent = fmtTime(m.in);
  $('#outLbl').textContent = fmtTime(m.out);
}
function trim(which) {
  const m = videoSrc; if (!m) return;
  const d = m.duration;
  let a = ($('#inRange').value / 1000) * d, b = ($('#outRange').value / 1000) * d;
  const minLen = Math.min(1, d);
  if (b - a < minLen) {
    if (which === 'in') { a = Math.max(0, b - minLen); $('#inRange').value = Math.round((a / d) * 1000); }
    else { b = Math.min(d, a + minLen); $('#outRange').value = Math.round((b / d) * 1000); }
  }
  m.in = a; m.out = b;
  updateTrimLabels();
  engine.rebuild();
  const seg = engine.mainSeg();
  if (seg) engine.seek(which === 'in' ? seg.start : seg.end - 0.05);
  updateSummary();
}
$('#inRange').addEventListener('input', () => trim('in'));
$('#outRange').addEventListener('input', () => trim('out'));
$('#volRange').value = Math.round(state.volume * 100);
$('#volLbl').textContent = $('#volRange').value + '%';
$('#volRange').addEventListener('input', (e) => {
  state.volume = e.target.value / 100;
  $('#volLbl').textContent = e.target.value + '%';
  if (videoSrc) { videoSrc.volume = state.volume; engine.rebuild(); if (engine.playing) engine.play(engine.t); }
  save();
});

setSeg('#formatSeg', state.format, (v) => { state.format = v; engine.setFormat(v); updateAspect(); save(); updateSummary(); });
setSeg('#fitSeg', state.fit, (v) => { state.fit = v; engine.fit = v; engine.refresh(); save(); });
setSeg('#transSeg', state.trans.type, (v) => { state.trans.type = v; engine.transition.type = v; save(); rebuild(); });
setSeg('#transDurSeg', String(state.trans.dur.toFixed(1) === '1.0' ? '1.0' : state.trans.dur), (v) => { state.trans.dur = +v; engine.transition.dur = +v; save(); rebuild(); });

// ---------- Modo: video o fotos ----------
let videoSrc = null;
const photoSrc = { kind: 'photos', photos: [], photoDur: state.photoDur, photoTr: state.photoTr, preset: state.preset, seed: 1, in: 0, out: 0, duration: 0, volume: 1 };

function syncPhotoSrc() {
  photoSrc.photoDur = state.photoDur; photoSrc.photoTr = state.photoTr; photoSrc.preset = state.preset;
  photoSrc.duration = photosDuration(photoSrc);
  photoSrc.in = 0; photoSrc.out = photoSrc.duration;
}

function applyMode() {
  const fotos = state.mode === 'fotos';
  $('#videoPanel').hidden = fotos;
  $('#photosPanel').hidden = !fotos;
  syncPhotoSrc();
  if (engine.playing) engine.pause();
  engine.sources.main = fotos ? (photoSrc.photos.length ? photoSrc : null) : videoSrc;
  const eh = $('#emptyHint');
  eh.hidden = !!engine.sources.main;
  eh.setAttribute('for', fotos ? 'photoFiles' : 'mainFile');
  $('span:nth-child(2)', eh).textContent = fotos ? 'Tocá acá para agregar tus fotos' : 'Tocá acá para subir tu video';
  $('small', eh).textContent = fotos ? 'Se animan solas, en el orden que elijas' : 'Filmado con el celular, vertical idealmente';
  updateMusicUi();
  rebuild();
}

setSeg('#modeSeg', state.mode, (v) => {
  state.mode = v; save(); applyMode();
  const m = engine.mainSeg(); if (m) engine.seek(m.start + Math.min(1, m.dur / 2));
});

// ---------- Fotos ----------
$('#presetSeg').append(...PHOTO_PRESETS.map(([v, l]) => h('button', { type: 'button', 'data-v': v }, l)));
setSeg('#presetSeg', state.preset, (v) => { state.preset = v; save(); syncPhotoSrc(); engine.refresh(); });
setSeg('#photoTrSeg', String(state.photoTr), (v) => { state.photoTr = +v; save(); syncPhotoSrc(); rebuild(); });
$('#photoDur').value = state.photoDur;
$('#photoDurLbl').textContent = state.photoDur + ' s';
$('#photoDur').addEventListener('input', (e) => {
  state.photoDur = +e.target.value; $('#photoDurLbl').textContent = state.photoDur + ' s';
  save(); syncPhotoSrc(); rebuild();
});

$('#photoFiles').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  engine.unlock();
  if (state.mode !== 'fotos') { state.mode = 'fotos'; save(); $$('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === 'fotos')); }
  let bad = 0;
  for (let i = 0; i < files.length; i++) {
    busy(`Preparando fotos… ${i + 1} de ${files.length}`);
    try { photoSrc.photos.push(await loadPhoto(files[i])); } catch (err) { bad++; }
  }
  busy(null);
  if (bad) toast(`No pude abrir ${bad} ${bad === 1 ? 'foto' : 'fotos'}.`);
  renderPhotos();
  applyMode();
  const m = engine.mainSeg(); if (m) engine.seek(m.start + Math.min(1, m.dur / 2));
});

function photoStart(i) { const m = engine.mainSeg(); return m ? m.start + i * (photoSrc.photoDur - Math.min(photoSrc.photoTr, photoSrc.photoDur / 2)) : 0; }

function renderPhotos() {
  const g = $('#photoGrid');
  g.innerHTML = '';
  const n = photoSrc.photos.length;
  $('#photoCount').textContent = n
    ? `${n} ${n === 1 ? 'foto' : 'fotos'} · ${fmtTime(photosDuration(photoSrc))}. Usá ◀ ▶ para cambiar el orden. Tocá una foto para verla.`
    : 'Todavía no agregaste fotos. El orden en que las subís es el orden del video.';
  photoSrc.photos.forEach((p, i) => {
    const move = (d) => {
      const j = i + d; if (j < 0 || j >= n) return;
      [photoSrc.photos[i], photoSrc.photos[j]] = [photoSrc.photos[j], photoSrc.photos[i]];
      renderPhotos(); engine.seek(photoStart(j) + 0.8);
    };
    const bL = h('button', { type: 'button', title: 'Antes', disabled: i === 0 }, '◀');
    const bR = h('button', { type: 'button', title: 'Después', disabled: i === n - 1 }, '▶');
    const bX = h('button', { type: 'button', title: 'Quitar' }, '✕');
    bL.addEventListener('click', (e) => { e.stopPropagation(); move(-1); });
    bR.addEventListener('click', (e) => { e.stopPropagation(); move(1); });
    bX.addEventListener('click', (e) => {
      e.stopPropagation();
      freePhoto(photoSrc.photos.splice(i, 1)[0]);
      renderPhotos(); applyMode();
    });
    const el = h('div', { class: 'photo' }, h('span', { class: 'num' }, String(i + 1)), h('div', { class: 'bar' }, bL, bR, bX));
    el.style.backgroundImage = `url("${p.url}")`;
    el.addEventListener('click', () => engine.seek(photoStart(i) + Math.min(1.2, photoSrc.photoDur / 2)));
    g.append(el);
  });
}

// ---------- Música ----------
let musicInfo = null; // { name, buffer, peaks }
const dbToGain = (db) => Math.pow(10, db / 20);

function pushMusic() {
  if (!musicInfo) { engine.setMusic(null); return; }
  engine.setMusic({ buffer: musicInfo.buffer, offset: musicInfo.offset, vol: dbToGain(state.music.vol), bed: dbToGain(state.music.bed) });
}

function updateMusicUi() {
  const fotos = state.mode === 'fotos';
  $('#musicNag').hidden = !!musicInfo;
  $('#tabMusica').classList.toggle('nag', fotos && !musicInfo);
  $('#bedField').hidden = fotos;
  $('#musicPhotoHint').hidden = !fotos;
  if (musicInfo) {
    const left = musicInfo.buffer.duration - musicInfo.offset;
    const sh = $('#musicShort');
    sh.hidden = !(engine.total && left < engine.total - 0.5);
    sh.textContent = sh.hidden ? '' : `Desde este punto la canción dura ${fmtTime(left)} y el clip ${fmtTime(engine.total)}: se va a apagar antes del final. Elegí un tramo más temprano.`;
    drawWave();
  }
}

$('#musicVol').value = state.music.vol; $('#musicVolLbl').textContent = state.music.vol + ' dB';
$('#musicBed').value = state.music.bed; $('#musicBedLbl').textContent = state.music.bed + ' dB';
$('#musicVol').addEventListener('input', (e) => { state.music.vol = +e.target.value; $('#musicVolLbl').textContent = e.target.value + ' dB'; save(); pushMusic(); });
$('#musicBed').addEventListener('input', (e) => { state.music.bed = +e.target.value; $('#musicBedLbl').textContent = e.target.value + ' dB'; save(); pushMusic(); });

$('#musicFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  engine.unlock();
  busy('Leyendo la música…');
  try {
    const buffer = await decodeAudio(await f.arrayBuffer());
    const ch = buffer.getChannelData(0), N = 600, step = Math.max(1, Math.floor(ch.length / N));
    const peaks = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let mx = 0; const st = i * step;
      for (let j = 0; j < step && st + j < ch.length; j += 16) { const v = Math.abs(ch[st + j]); if (v > mx) mx = v; }
      peaks[i] = mx;
    }
    const top = Math.max(0.01, ...peaks);
    for (let i = 0; i < N; i++) peaks[i] /= top;
    musicInfo = { name: f.name, buffer, peaks, offset: 0 };
    $('#musicName').textContent = f.name;
    $('#musicControls').hidden = false;
    $('#musicOffLbl').textContent = fmtTime(0);
    pushMusic(); updateMusicUi(); updateSummary();
  } catch (err) {
    console.error(err);
    toast('No pude leer el sonido de ese archivo. Probá con un MP3 o un MP4 con audio.');
  } finally { busy(null); }
});
$('#musicClear').addEventListener('click', () => {
  engine.stopMusicPreview();
  musicInfo = null; pushMusic();
  $('#musicControls').hidden = true;
  $('#musicName').textContent = 'Elegir música (MP3, o un MP4 del que se usa solo el sonido)';
  updateMusicUi(); updateSummary();
});
$('#musicListen').addEventListener('click', () => {
  if (!musicInfo) return;
  engine.unlock();
  if (engine._mprev) { engine.stopMusicPreview(); return; }
  engine.previewMusic(musicInfo.offset, Math.min(10, musicInfo.buffer.duration - musicInfo.offset));
  animWave();
});

const wave = $('#wave');
function drawWave() {
  if (!musicInfo) return;
  const r = window.devicePixelRatio || 1;
  const W = Math.max(100, wave.clientWidth) * r, H = 90 * r;
  if (wave.width !== W) wave.width = W;
  wave.height = H;
  const x = wave.getContext('2d');
  const D = musicInfo.buffer.duration;
  const winLen = Math.min(D, engine.total || 15);
  const ws = (musicInfo.offset / D) * W, ww = Math.max(4 * r, (winLen / D) * W);
  x.clearRect(0, 0, W, H);
  x.fillStyle = 'rgba(212,169,74,0.16)';
  x.fillRect(ws, 0, ww, H);
  const N = musicInfo.peaks.length, bw = W / N;
  for (let i = 0; i < N; i++) {
    const px = i * bw, v = musicInfo.peaks[i];
    const bh = Math.max(1, v * (H * 0.8));
    x.fillStyle = px >= ws && px <= ws + ww ? '#f3dc94' : 'rgba(163,150,122,0.45)';
    x.fillRect(px, (H - bh) / 2, Math.max(1, bw - 0.5 * r), bh);
  }
  x.strokeStyle = '#d4a94a'; x.lineWidth = 2 * r;
  x.strokeRect(ws + r, r, ww - 2 * r, H - 2 * r);
  const pos = engine.musicPreviewPos();
  if (pos != null) { x.fillStyle = '#fff'; x.fillRect((pos / D) * W, 0, 2 * r, H); }
}
function animWave() { drawWave(); if (engine._mprev) requestAnimationFrame(animWave); else drawWave(); }
let dragX = null, dragOff = 0;
wave.parentElement.addEventListener('pointerdown', (e) => {
  if (!musicInfo) return;
  engine.stopMusicPreview();
  wave.parentElement.setPointerCapture(e.pointerId);
  const rect = wave.getBoundingClientRect(), D = musicInfo.buffer.duration;
  const winLen = Math.min(D, engine.total || 15);
  const t = ((e.clientX - rect.left) / rect.width) * D;
  // si se toca fuera de la ventana, la centra ahí
  if (t < musicInfo.offset || t > musicInfo.offset + winLen) musicInfo.offset = clamp(t - winLen / 2, 0, Math.max(0, D - winLen));
  dragX = e.clientX; dragOff = musicInfo.offset;
  $('#musicOffLbl').textContent = fmtTime(musicInfo.offset);
  drawWave();
});
wave.parentElement.addEventListener('pointermove', (e) => {
  if (dragX == null || !musicInfo) return;
  const rect = wave.getBoundingClientRect(), D = musicInfo.buffer.duration;
  const winLen = Math.min(D, engine.total || 15);
  musicInfo.offset = clamp(dragOff + ((e.clientX - dragX) / rect.width) * D, 0, Math.max(0, D - winLen));
  $('#musicOffLbl').textContent = fmtTime(musicInfo.offset);
  drawWave();
});
const endDrag = () => {
  if (dragX == null || !musicInfo) return;
  dragX = null;
  pushMusic(); updateMusicUi();
  engine.previewMusic(musicInfo.offset, Math.min(6, musicInfo.buffer.duration - musicInfo.offset));
  animWave();
};
wave.parentElement.addEventListener('pointerup', endDrag);
wave.parentElement.addEventListener('pointercancel', endDrag);
window.addEventListener('resize', () => drawWave());
engine.on('timeline', () => { if (musicInfo) updateMusicUi(); });

// ---------- Intro / Outro ----------
const clipCache = new Map();

async function loadVideoClip(key, urlOrFile) {
  if (clipCache.has(key)) return clipCache.get(key);
  let buf, blobUrl;
  if (typeof urlOrFile === 'string') {
    const r = await fetch(urlOrFile);
    if (!r.ok) throw new Error('No se encontró ' + urlOrFile);
    buf = await r.arrayBuffer();
    blobUrl = URL.createObjectURL(new Blob([buf], { type: 'video/mp4' }));
  } else {
    blobUrl = URL.createObjectURL(urlOrFile);
    buf = await urlOrFile.arrayBuffer();
  }
  const el = await makeVideo(blobUrl);
  engine.unlockElement(el);
  const src = { kind: 'video', el, duration: el.duration, volume: 1 };
  try { src.audioBuffer = await decodeAudio(buf); } catch (e) { src.useElementAudio = true; }
  clipCache.set(key, src);
  return src;
}

const genSrc = { intro: null, outro: null };
const genAudioKey = { intro: '', outro: '' };
async function makeGenSource(role) {
  const p = state.gen[role];
  if (!genSrc[role]) genSrc[role] = { kind: 'card', params: p, duration: p.dur, audioBuffer: null, volume: 1 };
  const src = genSrc[role];
  src.params = p; p.seed = role === 'intro' ? 1 : 2;
  src.duration = p.dur;
  const key = `${p.dur}|${p.sound}`;
  if (genAudioKey[role] !== key) {
    genAudioKey[role] = key;
    src.audioBuffer = p.sound ? await makeShimmer(p.dur, role === 'intro' ? 5 : 9) : null;
  }
  return src;
}

const roleToken = { intro: 0, outro: 0 };
async function applyChoice(role, choice, file) {
  const tok = ++roleToken[role];
  state[role].choice = choice;
  if (choice !== 'upload') save();
  let src = null;
  try {
    if (choice === 'gen') src = await makeGenSource(role);
    else if (choice && choice.startsWith('lib:')) {
      const item = library[role + 's'].find((x) => 'lib:' + x.id === choice);
      if (item) { busy('Cargando ' + item.name + '…'); src = await loadVideoClip(choice, item.src); }
    } else if (choice === 'upload' && file) {
      busy('Cargando tu ' + (role === 'intro' ? 'intro' : 'final') + '…');
      src = await loadVideoClip('up:' + role + ':' + file.name + file.size, file);
    }
  } catch (e) {
    console.error(e);
    toast('No se pudo cargar ese clip.');
  } finally { busy(null); }
  if (tok !== roleToken[role]) return;
  if (engine.playing) engine.pause();
  engine.sources[role] = src;
  engine.rebuild();
  const seg = engine.segments.find((s) => s.role === role);
  if (seg) engine.seek(seg.start + Math.min(1.8, seg.dur * 0.6)); else engine.refresh();
  renderPicker(role);
  updateSummary();
}

function renderPicker(role) {
  const root = $(`.clip-picker[data-role="${role}"]`);
  if (!root.firstChild) root.append($('#clipPickerTpl').content.cloneNode(true));
  const cards = $('.cards', root);
  cards.innerHTML = '';
  const cur = state[role].choice;
  const card = (choice, name, thumb, extra = {}) => {
    const th = h('div', { class: 'thumb' }, thumb.img ? '' : thumb.icon);
    if (thumb.img) th.style.backgroundImage = `url("${thumb.img}")`;
    const c = h('button', { class: 'card' + (cur === choice ? ' on' : ''), type: 'button', ...extra }, th, h('div', { class: 'name' }, name));
    c.addEventListener('click', () => {
      if (choice === 'upload') { upInput.click(); return; }
      applyChoice(role, choice);
    });
    return c;
  };
  cards.append(card('none', role === 'intro' ? 'Sin intro' : 'Sin final', { icon: '—' }));
  for (const it of library[role + 's']) cards.append(card('lib:' + it.id, it.name, { img: it.poster, icon: '🎞' }));
  cards.append(card('gen', 'Título dorado (editable)', { icon: '✨' }));
  const upInput = h('input', { type: 'file', accept: 'video/*', hidden: true });
  upInput.addEventListener('change', () => { const f = upInput.files[0]; if (f) { upName[role] = f.name; applyChoice(role, 'upload', f); } upInput.value = ''; });
  cards.append(card('upload', upName[role] ? 'Mío: ' + upName[role] : 'Subir mi propio MP4', { icon: '⤒' }));
  cards.append(upInput);

  const gp = $('.gen-panel', root);
  gp.hidden = cur !== 'gen';
  if (!gp.dataset.wired) wireGenPanel(role, gp);
}
const upName = { intro: '', outro: '' };

function wireGenPanel(role, gp) {
  gp.dataset.wired = '1';
  const p = state.gen[role];
  const durLbl = $('[data-lbl="dur"]', gp);
  $$('[data-g]', gp).forEach((inp) => {
    const k = inp.dataset.g;
    if (inp.type === 'checkbox') inp.checked = !!p[k]; else inp.value = p[k];
    if (k === 'dur') durLbl.textContent = p.dur + ' s';
    let t = 0;
    inp.addEventListener('input', () => {
      if (inp.type === 'checkbox') p[k] = inp.checked;
      else if (k === 'dur') { p[k] = +inp.value; durLbl.textContent = p.dur + ' s'; }
      else p[k] = inp.value;
      save();
      if (k === 'dur' || k === 'sound') {
        clearTimeout(t);
        t = setTimeout(async () => { await makeGenSource(role); if (state[role].choice === 'gen') { engine.rebuild(); engine.refresh(); updateSummary(); } }, 250);
      } else {
        const seg = engine.segments.find((s) => s.role === role);
        if (seg && !engine.playing) { engine.t = seg.start + Math.min(2.2, seg.dur * 0.7); }
        engine.refresh();
      }
    });
  });
  $('[data-act="dl-gen"]', gp).addEventListener('click', async () => {
    engine.unlock();
    const src = await makeGenSource(role);
    busy('Creando el título… 0%');
    try {
      const blob = await engine.export({ only: { role, src }, onProgress: (f) => busy(`Creando el título… ${Math.round(f * 100)}%`) });
      const name = `titulo-${slug(p.line1 + ' ' + p.line2)}.${extFor(blob.type)}`;
      deliver(blob, name);
    } catch (e) { if (e.message !== 'cancelado') toast(e.message); }
    finally { busy(null); }
  });
}

// ---------- Logo ----------
function setLogo(dataUrl) {
  if (!dataUrl) {
    engine.logo = null;
    $('#logoPrev').style.backgroundImage = '';
    $('#logoPrev').innerHTML = '<span>Sin logo</span>';
    $('#logoClear').hidden = true;
    engine.refresh(); renderOverlays();
    return;
  }
  const img = new Image();
  img.onload = () => {
    engine.logo = img;
    $('#logoPrev').style.backgroundImage = `url("${dataUrl}")`;
    $('#logoPrev').innerHTML = '';
    $('#logoClear').hidden = false;
    engine.refresh(); renderOverlays();
  };
  img.src = dataUrl;
}
$('#logoFile').addEventListener('change', (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  const img = new Image();
  const url = URL.createObjectURL(f);
  img.onload = () => {
    const max = 900;
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height); // transparencias → negro (modo add)
    x.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    const data = c.toDataURL('image/png');
    try { localStorage.setItem('aatp:logo', data); } catch (err) { /* muy grande para guardar */ }
    setLogo(data);
  };
  img.onerror = () => toast('No pude abrir esa imagen.');
  img.src = url;
});
$('#logoClear').addEventListener('click', () => { localStorage.removeItem('aatp:logo'); setLogo(null); });

// ---------- Gráficas (overlays) ----------
const OV_NAMES = { zocalo: 'Zócalo', titulo: 'Título dorado', mosca: 'Mosca / logo', brillos: 'Brillos', marco: 'Marco dorado' };
const OV_NEW = {
  zocalo: () => ({ style: 'dorado', name: 'Nombre', desc: 'Descripción', dur: 5, y: 0.8 }),
  titulo: () => ({ text: 'Mickyfest', text2: 'por dentro', pos: 'centro', dur: 4 }),
  mosca: () => ({ corner: 'sup-der', size: 'mediana', useLogo: true, opacity: 0.9 }),
  brillos: () => ({ amount: 'medio' }),
  marco: () => ({}),
};

$$('[data-add]').forEach((b) => b.addEventListener('click', () => {
  const type = b.dataset.add;
  const mt = engine.mainSeg() ? engine.mainTime() : 0;
  const o = { id: ovId++, type, start: +mt.toFixed(1), ...OV_NEW[type]() };
  if (type === 'mosca' || type === 'brillos' || type === 'marco') o.start = 0;
  state.overlays.push(o);
  save(); renderOverlays(); previewOverlay(o);
}));

function previewOverlay(o) {
  const m = engine.mainSeg();
  if (!m) return;
  const off = o.type === 'zocalo' || o.type === 'titulo' ? Math.min(1.6, (o.dur || 4) * 0.6) : 1;
  engine.seek(m.start + clamp((o.start || 0) + off, 0, m.dur));
}

function renderOverlays() {
  const list = $('#ovList');
  list.innerHTML = '';
  if (!state.overlays.length) list.append(h('p', { class: 'hint' }, 'Todavía no agregaste gráficas.'));
  state.overlays.forEach((o, idx) => {
    const changed = () => { save(); engine.refresh(); };
    const text = (label, key, ph = '') => {
      const i = h('input', { type: 'text', value: o[key] ?? '', placeholder: ph, maxlength: 60 });
      i.addEventListener('input', () => { o[key] = i.value; changed(); });
      i.addEventListener('focus', () => previewOverlay(o));
      return h('div', { class: 'field' }, h('label', {}, label), i);
    };
    const seg = (label, key, opts) => {
      const s = h('div', { class: 'seg small' }, opts.map(([v, l]) => h('button', { type: 'button', class: String(o[key]) === String(v) ? 'on' : '', 'data-v': v }, l)));
      s.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        $$('button', s).forEach((x) => x.classList.toggle('on', x === b));
        const v = b.dataset.v; o[key] = isNaN(+v) ? v : +v; changed(); previewOverlay(o);
      });
      return h('div', { class: 'field' }, h('label', {}, label), s);
    };
    const num = (label, key, step = 0.1) => {
      const i = h('input', { type: 'number', step, min: 0, value: o[key] ?? 0, inputmode: 'decimal' });
      i.addEventListener('input', () => { o[key] = Math.max(0, parseFloat(i.value) || 0); changed(); });
      i.addEventListener('change', () => previewOverlay(o));
      return [h('div', { class: 'field' }, h('label', {}, label), i), i];
    };
    const timing = () => {
      const [sf, si] = num('Aparece (seg.)', 'start');
      const [df] = num('Dura (seg.)', 'dur');
      const now = h('button', { type: 'button', class: 'btn-sm ghost' }, '⏱ En este momento');
      now.addEventListener('click', () => { o.start = +engine.mainTime().toFixed(1); si.value = o.start; changed(); previewOverlay(o); });
      return h('div', { class: 'time-row' }, sf, df, now);
    };

    const body = [];
    if (o.type === 'zocalo') {
      body.push(text('Nombre / título', 'name'), text('Descripción', 'desc'));
      body.push(seg('Estilo', 'style', [['dorado', 'Dorado izquierda'], ['placa', 'Placa centrada']]));
      body.push(seg('Altura', 'y', [[0.8, 'Abajo'], [0.68, 'Medio-bajo'], [0.22, 'Arriba']]));
      body.push(timing());
    } else if (o.type === 'titulo') {
      body.push(h('div', { class: 'grid2' }, text('Línea 1', 'text'), text('Línea 2', 'text2')));
      body.push(seg('Posición', 'pos', [['arriba', 'Arriba'], ['centro', 'Centro'], ['abajo', 'Abajo']]));
      body.push(timing());
    } else if (o.type === 'mosca') {
      body.push(seg('Esquina', 'corner', [['sup-izq', '↖'], ['sup-der', '↗'], ['inf-izq', '↙'], ['inf-der', '↘']]));
      body.push(seg('Tamaño', 'size', [['chica', 'Chica'], ['mediana', 'Mediana'], ['grande', 'Grande']]));
      body.push(h('p', { class: 'hint' }, engine.logo ? 'Usa el logo del club que subiste.' : 'Sin logo subido: muestra “Argentina a tus pies” en dorado.'));
    } else if (o.type === 'brillos') {
      body.push(seg('Cantidad', 'amount', [['suave', 'Suave'], ['medio', 'Medio'], ['mucho', 'Mucho']]));
      body.push(h('p', { class: 'hint' }, 'Partículas doradas durante todo el video.'));
    } else if (o.type === 'marco') {
      body.push(h('p', { class: 'hint' }, 'Marco dorado fino durante todo el video.'));
    }

    const view = h('button', { type: 'button', title: 'Ver' }, '👁');
    view.addEventListener('click', () => previewOverlay(o));
    const del = h('button', { type: 'button', title: 'Quitar' }, '✕');
    del.addEventListener('click', () => { state.overlays.splice(idx, 1); save(); renderOverlays(); engine.refresh(); });
    list.append(h('div', { class: 'ov' }, h('div', { class: 'ov-head' }, h('b', {}, OV_NAMES[o.type]), view, del), ...body));
  });
  engine.overlays = state.overlays;
  updateSummary();
}

// ---------- Exportar ----------
function choiceName(role) {
  const c = state[role].choice;
  if (!engine.sources[role]) return 'Ninguno';
  if (c === 'gen') return 'Título: ' + [state.gen[role].line1, state.gen[role].line2].filter(Boolean).join(' ');
  if (c === 'upload') return upName[role] || 'Propio';
  const it = library[role + 's'].find((x) => 'lib:' + x.id === c);
  return it ? it.name : '—';
}
function updateSummary() {
  const sm = $('#summary'); if (!sm) return;
  const m = engine.sources.main;
  const rows = [
    ['Formato', FORMATS[state.format].label],
    ['Intro', choiceName('intro')],
    state.mode === 'fotos'
      ? ['Fotos', m ? `${m.photos.length} fotos · ${fmtTime(m.duration)}` : 'Falta subirlas']
      : ['Tu video', m ? fmtTime((m.out ?? m.duration) - (m.in || 0)) : 'Falta subirlo'],
    ['Música', musicInfo ? musicInfo.name : (state.mode === 'fotos' ? '⚠️ Sin música (recomendado sumar una)' : 'Sin música')],
    ['Final', choiceName('outro')],
    ['Gráficas', state.overlays.length ? state.overlays.map((o) => OV_NAMES[o.type]).join(', ') : 'Ninguna'],
    ['Duración total', fmtTime(engine.total)],
  ];
  sm.innerHTML = '';
  rows.forEach(([a, b]) => sm.append(h('div', {}, h('span', {}, a), h('span', {}, b))));
  $('#exportBtn').disabled = !m;
}

const slug = (s) => (s || 'video').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'video';
const extFor = (type) => (type.includes('mp4') ? 'mp4' : type.includes('quicktime') ? 'mov' : 'webm');

let lastUrl = null;
function deliver(blob, name) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

let resultBlob = null, resultName = '';
$('#exportBtn').addEventListener('click', async () => {
  if (!engine.sources.main) { toast(state.mode === 'fotos' ? 'Primero agregá tus fotos en el paso 1.' : 'Primero subí tu video en el paso 1.'); return; }
  if (state.mode === 'fotos' && !musicInfo && !confirm('Tu clip de fotos no tiene música. ¿Querés crear el video igual?')) return;
  engine.unlock();
  $('#exportBtn').disabled = true;
  $('#progress').hidden = false; $('#result').hidden = true;
  $('#progBar').style.width = '0%'; $('#progText').textContent = 'Preparando…';
  try {
    const blob = await engine.export({
      onProgress: (f) => { const p = Math.round(f * 100); $('#progBar').style.width = p + '%'; $('#progText').textContent = p + '%'; },
    });
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    resultBlob = blob;
    resultName = `argentina-a-tus-pies-${stamp}.${extFor(blob.type)}`;
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(blob);
    $('#resultVideo').src = lastUrl;
    $('#downloadBtn').href = lastUrl;
    $('#downloadBtn').download = resultName;
    $('#resultInfo').textContent = `${resultName} · ${(blob.size / 1048576).toFixed(1)} MB` + (extFor(blob.type) === 'webm' || /vp8|vp9|av01|opus/i.test(blob.codecs || '') ? ' · Ojo: este navegador no grabó en H.264; si Instagram lo rechaza, exportá desde Chrome o Safari actualizados.' : '');
    $('#result').hidden = false;
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) {
    if (e.message !== 'cancelado') toast(e.message || 'Algo falló al crear el video.');
  } finally {
    $('#progress').hidden = true;
    $('#exportBtn').disabled = !engine.sources.main;
  }
});
$('#cancelBtn').addEventListener('click', () => engine.cancelExport());
$('#shareBtn').addEventListener('click', async () => {
  if (!resultBlob) return;
  const file = new File([resultBlob], resultName, { type: resultBlob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Argentina a tus pies' }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  deliver(resultBlob, resultName);
});

// ---------- Inicio ----------
(async function init() {
  updateAspect();
  engine.renderAt(0);
  const mime = pickMime();
  $('#browserInfo').textContent = mime === null || !canvas.captureStream
    ? 'Este navegador no puede crear videos. Abrí la página en Chrome (Android/PC) o Safari (iPhone).'
    : (mime && mime.includes('mp4') ? '' : 'Este navegador exporta en WebM. Para Instagram conviene Chrome o Safari actualizados, que exportan MP4.');
  await loadFonts();
  clearTextCache();
  const logo = localStorage.getItem('aatp:logo');
  if (logo) setLogo(logo);
  try { library = await (await fetch('assets/library.json', { cache: 'no-cache' })).json(); } catch (e) { library = { intros: [], outros: [] }; }
  library.intros ||= []; library.outros ||= [];
  for (const role of ['intro', 'outro']) {
    let c = state[role].choice;
    const valid = c === 'none' || c === 'gen' || (c && c.startsWith('lib:') && library[role + 's'].some((x) => 'lib:' + x.id === c));
    if (!valid) c = library[role + 's'][0] ? 'lib:' + library[role + 's'][0].id : 'gen';
    state[role].choice = c;
    renderPicker(role);
  }
  renderOverlays();
  renderPhotos();
  applyMode();
  await Promise.all(['intro', 'outro'].map((r) => applyChoice(r, state[r].choice)));
  engine.seek(Math.min(1.8, engine.total));
})();

// Para pruebas automatizadas
window.__aatp = { engine, state, photoSrc, get music() { return musicInfo; } };
