// Interfaz: Argentina a tus pies · Editor de videos
import { Engine, FORMATS, makeVideo, decodeAudio, pickMime } from './engine.js';
import { makeShimmer } from './sound.js';
import { clearTextCache } from './graphics.js';
import { loadFonts, fmtTime, clamp } from './util.js';

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
  intro: { choice: null }, outro: { choice: null },
  gen: {
    intro: { line1: 'Argentina', line2: 'a tus pies', sub: 'Club de fans de Luis Miguel', dur: 4.5, showLogo: false, sound: true },
    outro: { line1: '¡Gracias!', line2: '', sub: 'Argentina a tus pies', dur: 4, showLogo: true, sound: true },
  },
  overlays: [
    { id: 1, type: 'zocalo', style: 'dorado', name: 'Argentina a tus pies', desc: 'Club de fans de Luis Miguel', start: 1, dur: 5, y: 0.8 },
  ],
};

let state;
try { state = { ...structuredClone(DEFAULTS), ...JSON.parse(localStorage.getItem(STORE) || '{}') }; }
catch (e) { state = structuredClone(DEFAULTS); }
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
  if (!engine.segments.length) { $('#mainFile').click(); return; }
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
    if (engine.sources.main) { try { URL.revokeObjectURL(engine.sources.main.el.src); engine.sources.main.el.remove(); } catch (x) { /* */ } }
    engine.pause();
    const url = URL.createObjectURL(file);
    const el = await makeVideo(url);
    if (tok !== mainToken) return;
    const src = { kind: 'video', el, file, duration: el.duration, in: 0, out: el.duration, volume: state.volume };
    engine.sources.main = src;
    engine.unlockElement(el);
    $('#mainFileName').textContent = file.name || 'Video cargado';
    $('#emptyHint').hidden = true;
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
  const m = engine.sources.main; if (!m) return;
  $('#inLbl').textContent = fmtTime(m.in);
  $('#outLbl').textContent = fmtTime(m.out);
}
function trim(which) {
  const m = engine.sources.main; if (!m) return;
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
  if (engine.sources.main) { engine.sources.main.volume = state.volume; engine.rebuild(); if (engine.playing) engine.play(engine.t); }
  save();
});

setSeg('#formatSeg', state.format, (v) => { state.format = v; engine.setFormat(v); updateAspect(); save(); updateSummary(); });
setSeg('#fitSeg', state.fit, (v) => { state.fit = v; engine.fit = v; engine.refresh(); save(); });
setSeg('#transSeg', state.trans.type, (v) => { state.trans.type = v; engine.transition.type = v; save(); rebuild(); });
setSeg('#transDurSeg', String(state.trans.dur.toFixed(1) === '1.0' ? '1.0' : state.trans.dur), (v) => { state.trans.dur = +v; engine.transition.dur = +v; save(); rebuild(); });

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
    ['Tu video', m ? fmtTime((m.out ?? m.duration) - (m.in || 0)) : 'Falta subirlo'],
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
  if (!engine.sources.main) { toast('Primero subí tu video en el paso 1.'); return; }
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
  await Promise.all(['intro', 'outro'].map((r) => applyChoice(r, state[r].choice)));
  engine.seek(Math.min(1.8, engine.total));
})();

// Para pruebas automatizadas
window.__aatp = { engine, state };
