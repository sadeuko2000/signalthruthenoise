import { generateBass, mutate, DEFAULTS } from './generator.js';
import { Engine } from './audio.js';
import { Sensors } from './sensors.js';

const $ = (id) => document.getElementById(id);
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
    c.firstChild.style.height = s.on ? `${100 - Math.max(0, Math.min(100, (s.degree + 3) * 10))}%` : '0';
  });
}

function toggleStep(i) {
  const steps = pattern.steps.slice();
  const s = { ...steps[i] };
  s.on = !s.on;
  if (s.on) { s.vel = 85; s.gate = 0.35; }
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

// Pad XY: x = filtr, y = gęstość. To jedyne źródło prawdy dla obu parametrów;
// palec i żyroskop piszą w to samo miejsce.
const pad = $('pad'), dot = $('dot');
const padPos = { x: 0.35, y: 0.6 };
function setPad(x, y) {
  padPos.x = x; padPos.y = y;
  dot.style.left = `${x * 100}%`;
  dot.style.top = `${(1 - y) * 100}%`;
  engine.setCutoff(cutoffHz(x));
  // regeneracja tylko przy realnej zmianie, żeby nie mielić wzoru co klatkę
  const d = Math.round(y * 50) / 50;
  if (d !== state.density) { state.density = d; regen(); }
}
function padFromEvent(e) {
  const r = pad.getBoundingClientRect();
  setPad(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
         Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)));
}
let padDown = false;
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

// Przyciski
$('dice').addEventListener('click', () => { state.seed = (Math.random() * 1e9) | 0; regen(); });
$('mut').addEventListener('click', () => setPattern(mutate(pattern)));
$('mode').addEventListener('click', (e) => {
  state.mode = state.mode === 'minor' ? 'phrygian' : 'minor';
  e.target.textContent = state.mode === 'minor' ? 'moll' : 'frygijska';
  regen();
});
$('kick').addEventListener('click', (e) => { engine.kickOn = !engine.kickOn; e.target.classList.toggle('on', engine.kickOn); });
const setBpm = (v) => { engine.bpm = Math.max(70, Math.min(180, v)); $('bpm').textContent = engine.bpm; };
$('bpm-').addEventListener('click', () => setBpm(engine.bpm - 2));
$('bpm+').addEventListener('click', () => setBpm(engine.bpm + 2));

$('play').addEventListener('click', (e) => {
  if (engine.playing) { engine.stop(); e.target.textContent = '▶'; if (lastNow >= 0) cells[lastNow].classList.remove('now'); }
  else { engine.play(); e.target.textContent = '■'; }
});

// Start: odblokowuje audio (wymóg iOS/Chrome: gest użytkownika)
$('go').addEventListener('click', async () => {
  await engine.start();
  setPad(padPos.x, padPos.y);
  engine.setResonance(1 + $('reso').value * 22);
  $('start').hidden = true;
  $('app').hidden = false;
  render();
  engine.play();
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
