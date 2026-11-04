import { generateBass, mutate, DEFAULTS } from './generator.js';
import { Engine } from './audio.js';

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
$('density').addEventListener('input', (e) => { state.density = +e.target.value; regen(); });
$('sync').addEventListener('input', (e) => { state.syncopation = +e.target.value; regen(); });
const cutoffHz = (v) => 60 * Math.pow(100, v);           // 60 Hz .. 6 kHz
$('cutoff').addEventListener('input', (e) => engine.setCutoff(cutoffHz(+e.target.value)));
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
  engine.setCutoff(cutoffHz(+$('cutoff').value));
  engine.setResonance(1 + $('reso').value * 22);
  $('start').hidden = true;
  $('app').hidden = false;
  render();
  engine.play();
  $('play').textContent = '■';
});
