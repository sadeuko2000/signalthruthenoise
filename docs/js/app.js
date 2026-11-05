import { generateBass, mutate, DEFAULTS, DEGREE_MIN, DEGREE_MAX } from './generator.js';
import { Engine } from './audio.js';
import { Sensors } from './sensors.js';
import { PARAM_SPECS, VOICE_NAMES, clampToDisc } from './engines.js';
import { FILTER_STYLES, FX_STYLES } from './fx.js';
import { makeKnob, initKnobs } from './knob.js';

const $ = (id) => document.getElementById(id);
initKnobs();                                    // pokrętła zapisane w HTML (data-*)

// ---------- widok: telefon / desktop, zakładki ----------
const appEl = $('app'), root = document.documentElement;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* tryb prywatny: bez zapamiętywania */ } },
};
function detectView() {
  const saved = store.get('stn.view');
  if (saved === 'phone' || saved === 'desktop') return saved;
  return matchMedia('(pointer: coarse)').matches || innerWidth < 900 ? 'phone' : 'desktop';
}
function setView(v) {
  root.dataset.view = v; appEl.dataset.view = v;
  $('viewsw').textContent = v === 'phone' ? 'widok: telefon' : 'widok: desktop';
  store.set('stn.view', v);
}
function setTab(t) {
  appEl.dataset.tab = t;
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.go === t));
  document.querySelector('.body').scrollTop = 0;
  store.set('stn.tab', t);
}
$('viewsw').addEventListener('click', () => setView(root.dataset.view === 'phone' ? 'desktop' : 'phone'));
document.querySelectorAll('#tabbar button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.go)));
setView(detectView());
setTab(['seq', 'synth', 'fx'].includes(store.get('stn.tab')) ? store.get('stn.tab') : 'seq');
const engine = new Engine();
const state = { ...DEFAULTS, seed: (Math.random() * 1e9) | 0 };
let pattern = generateBass(state);
engine.pattern = pattern;

const grid = $('grid');
const cells = [];
for (let i = 0; i < 16; i++) {
  const b = document.createElement('button');
  b.className = 'step';
  b.innerHTML = '<span class="bar"></span>';
  b.addEventListener('click', () => toggleStep(i));
  grid.appendChild(b);
  cells.push(b);
}

function setPattern(p) { pattern = p; engine.pattern = p; render(); }

function render() {
  pattern.steps.forEach((s, i) => {
    const c = cells[i];
    c.classList.toggle('on', s.on);
    c.classList.toggle('acc', s.on && s.vel >= 110);
    // wysokość słupka ~ stopień skali
    c.firstChild.style.height = s.on ? `${100 - Math.max(0, Math.min(100, ((s.degree - DEGREE_MIN) / (DEGREE_MAX - DEGREE_MIN)) * 100))}%` : '0';
  });
}

function toggleStep(i) {
  const steps = pattern.steps.slice();
  const s = { ...steps[i] };
  s.on = !s.on;
  if (s.on) { s.vel = 85; s.gate = 0.6; }
  steps[i] = s;
  setPattern({ ...pattern, steps });
}

function regen() { setPattern(generateBass(state)); }

// Podświetlenie bieżącego kroku zsynchronizowane z czasem audio.
let lastNow = -1;
engine.onStep = (i, t) => {
  const delay = Math.max(0, (t - engine.ctx.currentTime) * 1000);
  setTimeout(() => {
    if (lastNow >= 0) cells[lastNow].classList.remove('now');
    cells[i].classList.add('now');
    lastNow = i;
  }, delay);
};

// Suwaki
$('sync').addEventListener('input', (e) => { state.syncopation = +e.target.value; regen(); });
const cutoffHz = (v) => 60 * Math.pow(100, v);           // 60 Hz .. 6 kHz

// Pad XY miksuje cztery silniki basu: narożniki prophet / ms-20 (góra), dx / wavetable (dół).
// To jedyne źródło prawdy dla miksu; palec i żyroskop piszą w to samo miejsce.
const pad = $('pad'), dot = $('dot');
const corners = [...pad.querySelectorAll('.corner span')];
const padPos = { x: 0.25, y: 0.75 };
function setPad(x0, y0) {
  const { x, y } = clampToDisc(x0, y0);          // kropka zostaje wewnątrz okrągłego pada
  padPos.x = x; padPos.y = y;
  dot.style.left = `${x * 100}%`;
  dot.style.top = `${(1 - y) * 100}%`;
  engine.setBlend(x, y);
  engine.blend.forEach((w, i) => { corners[i].style.color = `rgba(57,255,176,${0.3 + 0.7 * w})`; });
}
$('density').addEventListener('input', (e) => { state.density = +e.target.value; regen(); });
$('gate').addEventListener('input', (e) => { engine.gateMul = +e.target.value; });
// Swing zmienia tylko timing: wzór zostaje (nie generujemy go od nowa).
$('swing').addEventListener('input', (e) => { state.swing = +e.target.value; setPattern({ ...pattern, swing: state.swing }); });
$('cutoff').addEventListener('input', (e) => engine.setCutoff(cutoffHz(+e.target.value)));
function padFromEvent(e) {
  const r = pad.getBoundingClientRect();
  setPad(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
         Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)));
}
let padDown = false;

// Karty silników: głośność, solo, parametry i losowanie „w granicach rozsądku”. Na telefonie widać jedną kartę naraz.
const engHost = $('engines');
const sliderRefs = VOICE_NAMES.map(() => ({}));   // id parametru -> pokrętło (do odświeżenia po losowaniu)
const cards = [];
function mkKnob(label, min, max, step, val, onInput, fmt = 'num') {
  const el = document.createElement('div');
  makeKnob(el, { label, min, max, step, value: val, def: val, fmt });
  el.addEventListener('input', () => onInput(el.value));
  return el;
}
const engSel = $('engsel');
function selEngine(i) {
  cards.forEach((c, j) => c.classList.toggle('cur', j === i));
  engSel.querySelectorAll('button').forEach((b, j) => b.classList.toggle('on', j === i));
}
VOICE_NAMES.forEach((name, i) => {
  const card = document.createElement('article');
  card.className = 'eng';
  card.innerHTML = `<header><b>${name}</b><button class="pwr on" title="włącz / wyłącz silnik">⏻</button><button class="solo" title="solo">S</button><button class="rnd" title="losuj parametry">🎲</button></header><div class="kgrid main"></div>`;
  const main = card.querySelector('.main');
  const lv = mkKnob('głośność', 0, 1.5, 0.01, 1, (v) => engine.setLevel(i, v), 'pct');
  main.appendChild(lv); sliderRefs[i].level = lv;
  // Parametry brzmienia na wierzchu, obwiednie (filtr i amp) w rozwijanej sekcji.
  const env = document.createElement('details');
  env.className = 'env';
  env.innerHTML = '<summary>obwiednie</summary><div class="kgrid env3"></div>';
  const envGrid = env.querySelector('.env3');
  for (const sp of PARAM_SPECS[i]) {
    const k = mkKnob(sp.label, sp.min, sp.max, sp.step, sp.def, (v) => engine.setParam(i, sp.id, v));
    (sp.group === 'env' ? envGrid : main).appendChild(k);
    sliderRefs[i][sp.id] = k;
  }
  card.appendChild(env);
  card.querySelector('.pwr').addEventListener('click', (e) => {
    const on = !e.currentTarget.classList.contains('on');
    e.currentTarget.classList.toggle('on', on);
    card.classList.toggle('off', !on);
    engSel.children[i].classList.toggle('off', !on);
    engine.setEnabled(i, on);
    setPad(padPos.x, padPos.y);                   // odśwież podświetlenie narożników
  });
  card.querySelector('.solo').addEventListener('click', () => setSolo(engine.solo === i ? null : i));
  card.querySelector('.rnd').addEventListener('click', () => randomizeVoice(i));
  engHost.appendChild(card);
  cards.push(card);
  const sb = document.createElement('button');
  sb.textContent = name;
  sb.addEventListener('click', () => selEngine(i));
  engSel.appendChild(sb);
});
selEngine(0);
function setSolo(i) {
  engine.setSolo(i);
  cards.forEach((c, j) => {
    c.querySelector('.solo').classList.toggle('on', j === i);
    c.classList.toggle('dim', i != null && j !== i);
  });
}
function randomizeVoice(i) {
  const vals = engine.randomizeVoice(i);
  for (const [id, v] of Object.entries(vals)) sliderRefs[i][id].value = v;
}
// Przyciski losowania w narożnikach pada nie mogą uruchamiać przeciągania pada.
pad.querySelectorAll('.cdice').forEach((b) => {
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('click', () => randomizeVoice(+b.dataset.v));
});
pad.addEventListener('pointerdown', (e) => { padDown = true; pad.setPointerCapture(e.pointerId); padFromEvent(e); });
pad.addEventListener('pointermove', (e) => { if (padDown) padFromEvent(e); });
pad.addEventListener('pointerup', () => { padDown = false; });
pad.addEventListener('pointercancel', () => { padDown = false; });

// Żyroskop: przechył steruje padem, potrząśnięcie mutuje. Palec na padzie ma pierwszeństwo.
const sensors = new Sensors({
  onTilt: ({ x, y }) => { if (!padDown) setPad(x, y); },
  onShake: () => setPattern(mutate(pattern)),
});
const gyroBtn = $('gyro'), zeroBtn = $('zero');
gyroBtn.addEventListener('click', async () => {
  if (sensors.active) {
    sensors.disable();
    gyroBtn.classList.remove('on'); zeroBtn.hidden = true; gyroBtn.textContent = 'żyro';
    return;
  }
  gyroBtn.textContent = '…';
  const ok = await sensors.enable();
  gyroBtn.textContent = ok ? 'żyro' : 'brak czujnika';
  gyroBtn.classList.toggle('on', ok);
  zeroBtn.hidden = !ok;
  if (!ok) setTimeout(() => { gyroBtn.textContent = 'żyro'; }, 2000);
});
zeroBtn.addEventListener('click', () => sensors.zero());
$('reso').addEventListener('input', (e) => engine.setResonance(1 + e.target.value * 22));

// Akcje (wspólne dla przycisków i skrótów klawiszowych)
function doDice() { state.seed = (Math.random() * 1e9) | 0; regen(); }
function doMutate() { setPattern(mutate(pattern)); }
const MODE_CYCLE = ['electro', 'phrygian', 'minor'], MODE_LABEL = { electro: 'elektro', phrygian: 'frygijska', minor: 'moll' };
function doMode() {
  state.mode = MODE_CYCLE[(MODE_CYCLE.indexOf(state.mode) + 1) % MODE_CYCLE.length];
  $('mode').textContent = MODE_LABEL[state.mode];
  setPattern({ ...pattern, mode: state.mode });                      // tonacja nie kasuje nut
}
const setBpm = (v) => { engine.setBpm(Math.max(70, Math.min(180, v))); $('bpm').textContent = engine.bpm; };
// Ekran nie gaśnie podczas grania (telefon). Brak API albo odmowa nie szkodzi.
let wake = null;
async function lockScreen() {
  try {
    if ('wakeLock' in navigator && !wake) {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    }
  } catch { /* odmowa: ekran może zgasnąć */ }
}
function unlockScreen() { try { if (wake) wake.release(); } catch { /* nic */ } wake = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && engine.playing) lockScreen(); });
function togglePlay() {
  const btn = $('play');
  if (engine.playing) { engine.stop(); unlockScreen(); btn.textContent = '▶'; if (lastNow >= 0) cells[lastNow].classList.remove('now'); }
  else { engine.play(); lockScreen(); btn.textContent = '■'; }
}
$('dice').addEventListener('click', doDice);
$('mut').addEventListener('click', doMutate);
$('mode').textContent = MODE_LABEL[state.mode];
$('mode').addEventListener('click', doMode);
$('bpm-').addEventListener('click', () => setBpm(engine.bpm - 2));
$('bpm+').addEventListener('click', () => setBpm(engine.bpm + 2));
$('play').addEventListener('click', togglePlay);

// Skróty klawiszowe. Jedna tabela: z niej działa obsługa i powstaje podpowiedź pod sekwencerem.
const KEYS = [
  { code: 'Space', label: 'spacja', what: 'play / stop', run: togglePlay },
  { code: 'KeyR', label: 'R', what: 'losuj wzór', run: doDice },
  { code: 'KeyM', label: 'M', what: 'mutuj', run: doMutate },
  { code: 'KeyT', label: 'T', what: 'tonacja (elektro / frygijska / moll)', run: doMode },
  { code: 'ArrowUp', label: '↑ ↓', what: 'BPM ±2', run: () => setBpm(engine.bpm + 2), alt: { code: 'ArrowDown', run: () => setBpm(engine.bpm - 2) }, skipInRange: true },
  ...VOICE_NAMES.map((n, i) => ({
    code: `Digit${i + 1}`, label: String(i + 1), what: i === 0 ? 'solo silnika (shift = losuj parametry)' : null,
    run: () => setSolo(engine.solo === i ? null : i), shift: () => randomizeVoice(i),
  })),
];
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat && e.code !== 'ArrowUp' && e.code !== 'ArrowDown') return;
  if ($('app').hidden) return;
  const t = e.target;
  const typing = t instanceof HTMLInputElement;
  const onKnob = t instanceof HTMLElement && t.classList.contains('knob');
  if (typing) return;
  for (const k of KEYS) {
    const hit = e.code === k.code ? k : (k.alt && e.code === k.alt.code ? k.alt : null);
    if (!hit) continue;
    // strzałki na zaznaczonym pokrętle zostają pokrętłu
    if (k.skipInRange && onKnob) return;
    e.preventDefault();
    if (e.code === 'Space' && t instanceof HTMLButtonElement) t.blur();   // spacja nie ma kliknąć też zaznaczonego przycisku
    (e.shiftKey && k.shift ? k.shift : hit.run)();
    return;
  }
});
const help = document.createElement('p');
help.innerHTML = KEYS.filter((k) => k.what).map((k) => `<kbd>${k.label}</kbd> ${k.what}`).join(' · ')
  .replace('<kbd>1</kbd>', '<kbd>1–4</kbd>');
document.querySelector('.keys').innerHTML = help.innerHTML;

// Globalny filtr i efekty: karta ze stylami (zakładki), 8 pokrętłami, bypassem i losowaniem.
const fxCards = [];
function selFx(j) {
  fxCards.forEach((c, k) => c.classList.toggle('cur', k === j));
  $('fxsel').querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === j));
}
function buildFxCard(host, title, slot, styles) {
  const card = document.createElement('article');
  card.className = 'eng fxcard';
  card.innerHTML = `<header><b>${title}</b><button class="pwr on" title="włącz / wyłącz">⏻</button><button class="rnd" title="losuj parametry w granicach rozsądku">🎲</button></header><div class="tabs"></div><div class="kgrid fxgrid"></div>`;
  const tabs = card.querySelector('.tabs'), grid = card.querySelector('.fxgrid');
  let refs = {};
  function renderParams() {
    grid.innerHTML = ''; refs = {};
    const st = styles[slot.style], vals = slot.values[slot.style];
    for (const sp of st.params) {
      const k = document.createElement('div');
      makeKnob(k, { label: sp.label, min: 0, max: 1, step: 0.001, value: vals[sp.id], def: sp.def, show: (n) => sp.show(sp.map(n)) });
      k.addEventListener('input', () => slot.setParam(sp.id, k.value));
      grid.appendChild(k); refs[sp.id] = k;
    }
  }
  styles.forEach((st, i) => {
    const b = document.createElement('button');
    b.className = 'tab'; b.textContent = st.name;
    b.addEventListener('click', () => { slot.setStyle(i); tabs.querySelectorAll('.tab').forEach((t, j) => t.classList.toggle('on', j === i)); renderParams(); });
    tabs.appendChild(b);
  });
  tabs.firstElementChild.classList.add('on');
  card.querySelector('.pwr').addEventListener('click', (e) => {
    const on = !e.currentTarget.classList.contains('on');
    e.currentTarget.classList.toggle('on', on); card.classList.toggle('off', !on); slot.setBypass(!on);
  });
  card.querySelector('.rnd').addEventListener('click', () => {
    const vals = slot.randomize();
    for (const [id, n] of Object.entries(vals)) refs[id].value = n;
  });
  renderParams();
  host.appendChild(card);
  fxCards.push(card);
}
let fxBuilt = false;
function buildFxUi() {
  if (fxBuilt) return; fxBuilt = true;
  const host = $('globalfx');
  buildFxCard(host, 'globalny filtr', engine.fx.filter, FILTER_STYLES);
  buildFxCard(host, 'efekty', engine.fx.fx, FX_STYLES);
  ['filtr', 'efekty'].forEach((name, j) => {
    const b = document.createElement('button');
    b.textContent = name; b.addEventListener('click', () => selFx(j));
    $('fxsel').appendChild(b);
  });
  selFx(0);
}

// Start: odblokowuje audio (wymóg iOS/Chrome: gest użytkownika)
$('go').addEventListener('click', async () => {
  await engine.start();
  engine.setCutoff(cutoffHz(+$('cutoff').value));
  setPad(padPos.x, padPos.y);
  engine.setResonance(1 + $('reso').value * 22);
  buildFxUi();
  $('start').hidden = true;
  $('app').hidden = false;
  render();
  engine.play();
  lockScreen();
  $('play').textContent = '■';
});

// Głos: bas przechodzi przez vocoder, a modulatorem jest mikrofon.
const voiceBtn = $('voice'), vocBox = $('voc'), meter = $('meter').firstElementChild;
let meterRaf = 0;
let meterLevel = 0;
function drawMeter() {
  meterLevel = Math.max(engine.voc.level(), meterLevel * 0.92);   // szczyt opada powoli
  meter.style.width = `${Math.round(meterLevel * 100)}%`;
  meterRaf = requestAnimationFrame(drawMeter);
}
voiceBtn.addEventListener('click', async () => {
  if (engine.voiceOn) {
    cancelAnimationFrame(meterRaf);
    engine.disableVoice();
    voiceBtn.classList.remove('on'); vocBox.hidden = true; voiceBtn.textContent = 'głos';
    return;
  }
  voiceBtn.textContent = '…';
  try {
    await engine.enableVoice();
    engine.voc.setSensitivity(+$('sens').value);
    voiceBtn.classList.add('on'); vocBox.hidden = false; voiceBtn.textContent = 'głos';
    drawMeter();
  } catch (err) {
    voiceBtn.textContent = err && err.name === 'NotAllowedError' ? 'brak zgody' : 'brak mikrofonu';
    setTimeout(() => { voiceBtn.textContent = 'głos'; }, 2500);
  }
});
$('sens').addEventListener('input', (e) => { if (engine.voc) engine.voc.setSensitivity(+e.target.value); });

$('go').focus();
