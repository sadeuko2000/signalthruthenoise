// radarxxx: ekran radarowy jako interfejs sekwencera i miksu silników basu.
// Przemiatająca linia = głowica odtwarzania (jedno okrążenie = jeden obieg wzoru), nuty = echa z poświatą.
import { generateBass, mutate, DEFAULTS } from './generator.js';
import { Engine } from './audio.js';
import { VOICE_NAMES, clampToDisc } from './engines.js';
import { FILTER_STYLES, FX_STYLES } from './fx.js';
import { makeKnob, initKnobs } from './knob.js';
import { TAU, DEG_MIN, DEG_MAX, R_OUT, degToR, rToDeg, angleOfStep, polar, stepFromAngle, sweepPos, echoAlpha, echoes, placeNote, clearNote, moveNote, resizeSteps } from './radargeo.js';

const el = (id) => document.getElementById(id);
initKnobs();

const engine = new Engine();
const state = { ...DEFAULTS, seed: (Math.random() * 1e9) | 0, length: 16 };
let pattern = generateBass(state);
engine.pattern = pattern;
let page = 'seq';
const hup = false;                            // tryb H-UP usunięty z interfejsu (zawsze N-UP)
const padPos = { x: 0.25, y: 0.75 };
const cv = el('scope'), g = cv.getContext('2d');
let lastStep = { i: 0, t: 0 }, heldPos = 0, lastRot = 0;
engine.onStep = (i, t) => { lastStep = { i, t }; };

const GREEN = '125,255,90', AMBER = '255,207,74', WHITE = '230,255,220';
const FONT = (px) => `${Math.round(px)}px 'Share Tech Mono', ui-monospace, Menlo, monospace`;
const cutoffHz = (v) => 60 * Math.pow(100, v);

// ---------- wzór ----------
function setSteps(steps) { pattern = { ...pattern, steps }; engine.pattern = pattern; }
function regen() { pattern = generateBass(state); engine.pattern = pattern; }

// ---------- pozycja linii ----------
function curPos() {
  const n = pattern.steps.length;
  if (!engine.playing || !engine.ctx) return heldPos;
  heldPos = sweepPos(lastStep.i, lastStep.t, engine.ctx.currentTime, 60 / engine.bpm / 4, n);
  return heldPos;
}

// ---------- rysowanie ----------
function fit() {
  const r = cv.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(r.width * d));
  if (cv.width !== w) { cv.width = w; cv.height = w; }
}
new ResizeObserver(fit).observe(cv);

function circle(cx, cy, r, stroke, lw, dash) {
  g.beginPath(); g.arc(cx, cy, r, 0, TAU);
  g.setLineDash(dash || []); g.lineWidth = lw; g.strokeStyle = stroke; g.stroke(); g.setLineDash([]);
}
const polarXY = (cx, cy, r, a) => [cx + Math.sin(a) * r, cy - Math.cos(a) * r];

let touch = null;   // aktywny dotyk: { i, deg, x, y } do rysowania linii namiaru (EBL)

function drawSeq() {
  const W = cv.width, cx = W / 2, cy = W / 2, R = W / 2, dpr = W / Math.max(1, cv.clientWidth);
  const n = pattern.steps.length, pos = curPos(), sw = (pos / n) * TAU;
  const rot = touch && hup ? lastRot : hup ? -sw : 0;
  lastRot = rot;

  // tło
  const bg = g.createRadialGradient(cx, cy, 0, cx, cy, R);
  bg.addColorStop(0, '#07210f'); bg.addColorStop(1, '#020604');
  g.fillStyle = bg; g.fillRect(0, 0, W, W);

  // pierścienie zakresu (bez opisów liczbowych)
  for (let d = DEG_MIN; d <= DEG_MAX - 1; d++) {
    if (d % 2 !== 0 && d !== 7) continue;                       // co drugi stopień; oktawa (7) osobno
    circle(cx, cy, degToR(d) * R, d === 0 || d === 7 ? 'rgba(125,255,90,.4)' : 'rgba(125,255,90,.14)', dpr);
  }
  circle(cx, cy, R * (R_OUT + 0.075), 'rgba(125,255,90,.28)', dpr, [3 * dpr, 5 * dpr]);

  // obrzeże: kreski kroków
  circle(cx, cy, R * 0.985, 'rgba(125,255,90,.55)', 1.5 * dpr);
  const hot = Math.floor(pos) % n;
  for (let k = 0; k < n * 4; k++) {
    const a = (k / (n * 4)) * TAU + rot, major = k % 4 === 0;
    const [x0, y0] = polarXY(cx, cy, R * (major ? 0.935 : 0.96), a), [x1, y1] = polarXY(cx, cy, R * 0.985, a);
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1);
    g.strokeStyle = major ? 'rgba(125,255,90,.8)' : 'rgba(125,255,90,.35)'; g.lineWidth = dpr; g.stroke();
  }
  // bieżący krok: wyraźniejsza, bursztynowa kreska na obrzeżu (zamiast numerów)
  { const a = angleOfStep(hot, n) + rot, [x0, y0] = polarXY(cx, cy, R * 0.9, a), [x1, y1] = polarXY(cx, cy, R * 0.985, a);
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.strokeStyle = `rgba(${AMBER},1)`; g.lineWidth = 3 * dpr; g.stroke(); }
  // znacznik północy (krok 1)
  { const a = rot, [x, y] = polarXY(cx, cy, R * 0.985, a), [x2, y2] = polarXY(cx, cy, R * 0.94, a - 0.045), [x3, y3] = polarXY(cx, cy, R * 0.94, a + 0.045);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.lineTo(x3, y3); g.closePath(); g.fillStyle = `rgba(${AMBER},1)`; g.fill(); }

  // poświata za linią (luminofor)
  for (let k = 0; k < 30; k++) {
    const a = sw + rot - k * (TAU / 240) - Math.PI / 2;
    g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R * 0.93, a - TAU / 240, a); g.closePath();
    g.fillStyle = `rgba(${GREEN},${(0.2 * Math.pow(1 - k / 30, 2)).toFixed(3)})`; g.fill();
  }

  // echa
  g.lineCap = 'round';
  for (const e of echoes(pattern.steps)) {
    const alpha = echoAlpha(e.i, pos, n), col = e.accent ? AMBER : GREEN;
    const a0 = e.a0 + rot - Math.PI / 2, lw = e.w * dpr * (R / (170 * dpr)) * 0.9;
    const fresh = alpha > 0.9;
    g.shadowColor = `rgba(${col},.9)`; g.shadowBlur = fresh ? 14 * dpr : alpha > 0.5 ? 6 * dpr : 0;
    g.beginPath(); g.arc(cx, cy, e.r * R, a0, a0 + e.len);
    g.strokeStyle = `rgba(${col},${alpha.toFixed(3)})`; g.lineWidth = lw; g.stroke();
    if (fresh) { g.shadowBlur = 0; g.beginPath(); g.arc(cx, cy, e.r * R, a0, a0 + e.len); g.strokeStyle = `rgba(${WHITE},${((alpha - 0.9) * 8).toFixed(3)})`; g.lineWidth = lw * 0.45; g.stroke(); }
  }
  g.shadowBlur = 0; g.lineCap = 'butt';

  // linia przemiatająca
  const [lx, ly] = polarXY(cx, cy, R * 0.94, sw + rot);
  g.shadowColor = `rgba(${GREEN},1)`; g.shadowBlur = 10 * dpr;
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(lx, ly); g.strokeStyle = `rgba(200,255,180,.95)`; g.lineWidth = 2 * dpr; g.stroke();
  g.shadowBlur = 0;

  // namiar dotyku (EBL): linia od środka i znacznik w punkcie dotyku
  if (touch) {
    const a = angleOfStep(touch.i, n) + rot, r = degToR(touch.deg) * R;
    const [tx, ty] = polarXY(cx, cy, R * 0.94, a), [mx, my] = polarXY(cx, cy, r, a);
    g.setLineDash([4 * dpr, 4 * dpr]); g.beginPath(); g.moveTo(cx, cy); g.lineTo(tx, ty); g.strokeStyle = `rgba(${AMBER},.7)`; g.lineWidth = dpr; g.stroke(); g.setLineDash([]);
    g.beginPath(); g.arc(mx, my, 9 * dpr, 0, TAU); g.strokeStyle = `rgba(${AMBER},.95)`; g.lineWidth = 1.5 * dpr; g.stroke();
  }
  // środek
  circle(cx, cy, R * 0.035, 'rgba(200,255,180,.9)', 1.5 * dpr);
}

const PAD_ANCHORS = [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([a, b]) => [a * Math.SQRT1_2, b * Math.SQRT1_2]);
const SHORT = ['PROPHET', 'MS-20', 'DX', 'WAVETBL'];
function drawMix(ts) {
  const W = cv.width, cx = W / 2, cy = W / 2, R = W / 2, dpr = W / Math.max(1, cv.clientWidth), Rp = R * 0.74;
  const bg = g.createRadialGradient(cx, cy, 0, cx, cy, R);
  bg.addColorStop(0, '#07210f'); bg.addColorStop(1, '#020604');
  g.fillStyle = bg; g.fillRect(0, 0, W, W);
  for (let k = 1; k <= 4; k++) circle(cx, cy, Rp * (k / 4), k === 4 ? 'rgba(125,255,90,.5)' : 'rgba(125,255,90,.2)', dpr);
  g.strokeStyle = 'rgba(125,255,90,.15)'; g.lineWidth = dpr;
  g.beginPath(); g.moveTo(cx - R * 0.97, cy); g.lineTo(cx + R * 0.97, cy); g.moveTo(cx, cy - R * 0.97); g.lineTo(cx, cy + R * 0.97); g.stroke();
  // wolna linia przemiatająca dla klimatu
  const a = ((ts / 4000) % 1) * TAU;
  for (let k = 0; k < 24; k++) {
    const b = a - k * (TAU / 200) - Math.PI / 2;
    g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R * 0.97, b - TAU / 200, b); g.closePath();
    g.fillStyle = `rgba(${GREEN},${(0.1 * Math.pow(1 - k / 24, 2)).toFixed(3)})`; g.fill();
  }
  const mx = cx + (2 * padPos.x - 1) * Rp, my = cy - (2 * padPos.y - 1) * Rp;
  g.font = FONT(R * 0.055); g.textBaseline = 'middle';
  PAD_ANCHORS.forEach(([ax, ay], i) => {
    const x = cx + ax * Rp, y = cy - ay * Rp, w = engine.blend[i] || 0, on = engine.enabled[i];
    if (on) { g.beginPath(); g.moveTo(mx, my); g.lineTo(x, y); g.strokeStyle = `rgba(${AMBER},${(0.15 + 0.7 * w).toFixed(3)})`; g.lineWidth = (1 + 2 * w) * dpr; g.setLineDash([5 * dpr, 4 * dpr]); g.stroke(); g.setLineDash([]); }
    const s = R * (0.04 + 0.03 * w);
    g.save(); g.translate(x, y); g.rotate(Math.PI / 4);
    g.strokeStyle = on ? `rgba(${GREEN},1)` : 'rgba(79,122,72,.8)'; g.lineWidth = 1.6 * dpr; g.strokeRect(-s, -s, 2 * s, 2 * s);
    if (on) { g.fillStyle = `rgba(${GREEN},${(0.25 + 0.6 * w).toFixed(3)})`; g.fillRect(-s, -s, 2 * s, 2 * s); }
    g.restore();
    g.textAlign = ax < 0 ? 'left' : 'right';
    g.fillStyle = on ? `rgba(${GREEN},.95)` : 'rgba(79,122,72,.9)';
    g.fillText(SHORT[i], ax < 0 ? cx - R * 0.97 : cx + R * 0.97, ay > 0 ? cy - R * 0.9 : cy + R * 0.9);
  });
  // krzyżyk miksu
  g.strokeStyle = `rgba(${AMBER},1)`; g.lineWidth = 1.6 * dpr;
  g.beginPath(); g.arc(mx, my, R * 0.05, 0, TAU); g.moveTo(mx - R * 0.09, my); g.lineTo(mx + R * 0.09, my); g.moveTo(mx, my - R * 0.09); g.lineTo(mx, my + R * 0.09); g.stroke();
}

let raf = 0;
function loop(ts) {
  if (!el('radar').hidden && page !== 'fx') { if (page === 'mix') drawMix(ts); else drawSeq(); }
  raf = requestAnimationFrame(loop);
}

// ---------- dotyk na ekranie ----------
let drag = null;
function pointerPolar(e) {
  const r = cv.getBoundingClientRect(), R = Math.min(r.width, r.height) / 2;
  const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  return { ...polar(dx, dy), rn: Math.hypot(dx, dy) / R, dx, dy, R };
}
function setPad(x0, y0) {
  const { x, y } = clampToDisc(x0, y0);
  padPos.x = x; padPos.y = y;
  engine.setBlend(x, y);
}
cv.addEventListener('pointerdown', (e) => {
  const p = pointerPolar(e);
  cv.setPointerCapture(e.pointerId);
  if (page === 'mix') { drag = { mode: 'mix' }; mixFrom(p); return; }
  if (p.rn < 0.09 || p.rn > 0.98) return;
  const n = pattern.steps.length, i = stepFromAngle(p.theta - lastRot, n), deg = rToDeg(p.rn);
  const st = pattern.steps[i];
  const grabbed = st.on && Math.abs(st.degree - deg) <= 1;
  drag = { mode: 'seq', i, deg, grabbed, moved: false };
  touch = { i, deg };
  if (!grabbed) { setSteps(placeNote(pattern.steps, i, deg, st)); engine.audition(pattern.steps[i]); }
  else engine.audition(st);
});
cv.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = pointerPolar(e);
  if (drag.mode === 'mix') { mixFrom(p); return; }
  if (p.rn < 0.09) return;
  const n = pattern.steps.length, i = stepFromAngle(p.theta - lastRot, n), deg = rToDeg(Math.min(p.rn, 0.96));
  touch = { i, deg };
  if (i !== drag.i || deg !== drag.deg) {
    setSteps(moveNote(pattern.steps, drag.i, i, deg));
    drag.i = i; drag.deg = deg; drag.moved = true;
    engine.audition(pattern.steps[i]);
  }
});
function endDrag() {
  if (drag && drag.mode === 'seq' && drag.grabbed && !drag.moved) setSteps(clearNote(pattern.steps, drag.i));   // dotknięcie istniejącego echa usuwa je
  drag = null; touch = null;
}
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', () => { drag = null; touch = null; });
function mixFrom(p) {
  const Rp = p.R * 0.74;
  setPad((p.dx / Rp + 1) / 2, (-p.dy / Rp + 1) / 2);
}

// ---------- pokrętła ----------
el('gate').addEventListener('input', (e) => { engine.gateMul = +e.target.value; });
// Swing zmienia tylko rytm (opóźnienie parzystych kroków), nuty zostają: wzór nie jest generowany od nowa.
el('swing').addEventListener('input', (e) => { state.swing = +e.target.value; pattern = { ...pattern, swing: state.swing }; engine.pattern = pattern; });
el('cutoff').addEventListener('input', (e) => engine.setCutoff(cutoffHz(+e.target.value)));
el('reso').addEventListener('input', (e) => engine.setResonance(1 + e.target.value * 22));

// ---------- akcje ----------
const between = (a, b) => a + Math.random() * (b - a);
const MODE_CYCLE = ['electro', 'phrygian', 'minor'];
const MODE_LABEL = { electro: 'ELEKTRO', phrygian: 'FRYG', minor: 'MOLL' };
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ROOT_MIN = 24, ROOT_MAX = 59;                           // tonika od C1 do B3 (36 półtonów)
const rootParts = () => ({ pc: state.root % 12, oct: Math.floor(state.root / 12) - 1 });
const baseLabel = () => { const r = rootParts(); return `${NOTE_NAMES[r.pc]}${r.oct}`; };
const wrapRoot = (r) => (r > ROOT_MAX ? r - 36 : r < ROOT_MIN ? r + 36 : r);   // zawijanie w całym zakresie, nuta zostaje
// Zmiana nuty bazowej działa na żywo: wzór (stopnie skali) zostaje, zmienia się tylko wysokość toniki. Słychać ją od razu.
function setRoot(r) {
  state.root = r;
  pattern = { ...pattern, root: r }; engine.pattern = pattern;
  engine.audition({ degree: 0, octave: 0, vel: 100 });
}
const actions = {
  base: (dir) => setRoot(wrapRoot(state.root + dir)),            // transpozycja o półton
  octave: (dir) => setRoot(wrapRoot(state.root + 12 * dir)),     // skok o oktawę
  key: () => { state.mode = MODE_CYCLE[(MODE_CYCLE.indexOf(state.mode) + 1) % MODE_CYCLE.length]; pattern = { ...pattern, mode: state.mode }; engine.pattern = pattern; },
  // RANDOM: nowy wzór z losową gęstością i synkopą w rozsądnych granicach (swing i nuta bazowa zostają).
  random: () => { state.seed = (Math.random() * 1e9) | 0; state.density = between(0.3, 0.7); state.syncopation = between(0.25, 0.75); regen(); },
  mut: () => { pattern = mutate(pattern); engine.pattern = pattern; },
};
let wake = null;
async function lockScreen() { try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch { /* odmowa */ } }
function unlockScreen() { try { if (wake) wake.release(); } catch { /* nic */ } wake = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && engine.playing) lockScreen(); });
function togglePlay() {
  if (engine.playing) { engine.stop(); unlockScreen(); } else { engine.play(); lockScreen(); }
  el('play').textContent = engine.playing ? '■' : '▶';
  el('play').classList.toggle('on', engine.playing);
}
const setBpm = (v) => { engine.setBpm(Math.max(70, Math.min(180, v))); el('bpm').textContent = engine.bpm; };
el('bpm-').addEventListener('click', () => setBpm(engine.bpm - 2));
el('bpm+').addEventListener('click', () => setBpm(engine.bpm + 2));
el('play').addEventListener('click', togglePlay);

// ---------- przyciski kontekstowe (zależne od strony) ----------
const rnd = (i) => { const vals = engine.randomizeVoice(i); return vals; };
const KEYS = {
  seq: [
    { label: 'BASE', value: () => baseLabel(), act: () => actions.base(1), alt: () => actions.base(-1) },
    { label: 'OKTAWA', value: () => String(rootParts().oct), act: () => actions.octave(1), alt: () => actions.octave(-1) },
    { label: 'KEY', value: () => MODE_LABEL[state.mode], act: actions.key },
    { label: 'RANDOM', value: () => 'LOSUJ', act: actions.random },
    { label: 'MUTATE', value: () => '1 KROK', act: actions.mut },
  ],
  mix: [
    ...VOICE_NAMES.map((n, i) => ({ label: SHORT[i], value: () => (engine.enabled[i] ? 'ON' : 'OFF'), lit: () => !!engine.enabled[i], act: () => { engine.setEnabled(i, !engine.enabled[i]); } })),
    { label: 'RND ENG', value: () => 'LOSUJ', act: () => { engine.enabled.forEach((on, i) => { if (on) rnd(i); }); } },
  ],
  fx: [
    { label: 'FLT STYLE', value: () => FILTER_STYLES[engine.fx.filter.style].name.toUpperCase(), act: () => cycleStyle(0) },
    { label: 'FX STYLE', value: () => FX_STYLES[engine.fx.fx.style].name.toUpperCase(), act: () => cycleStyle(1) },
    { label: 'FLT', value: () => (engine.fx.filter.bypass ? 'BYPASS' : 'ON'), lit: () => !engine.fx.filter.bypass, act: () => bypass(0) },
    { label: 'FX', value: () => (engine.fx.fx.bypass ? 'BYPASS' : 'ON'), lit: () => !engine.fx.fx.bypass, act: () => bypass(1) },
    { label: 'RND', value: () => 'FLT+FX', act: () => { fxSecs.forEach((s) => s.randomize()); } },
  ],
};
function renderKeys() {
  const host = el('softkeys');
  host.innerHTML = '';
  for (const k of KEYS[page]) {
    const b = document.createElement('button');
    b.className = k.lit && k.lit() ? 'lit' : '';
    b.innerHTML = `<span class="l">${k.label}</span><span class="v">${k.value()}</span>`;
    let hold = 0, held = false;
    if (k.alt) {                                                  // przytrzymanie (0,45 s) = zmiana w drugą stronę
      b.addEventListener('pointerdown', () => { held = false; hold = setTimeout(() => { held = true; k.alt(); renderKeys(); updateInfo(); }, 450); });
      const cancel = () => clearTimeout(hold);
      b.addEventListener('pointerup', cancel); b.addEventListener('pointerleave', cancel); b.addEventListener('pointercancel', cancel);
    }
    b.addEventListener('click', () => { if (held) { held = false; return; } k.act(); renderKeys(); updateInfo(); });
    host.appendChild(b);
  }
}

// ---------- strona FX ----------
const fxSecs = [];
function buildFx() {
  const host = el('fxpage');
  [[engine.fx.filter, FILTER_STYLES, 'FILTR'], [engine.fx.fx, FX_STYLES, 'EFEKT']].forEach(([slot, styles, title]) => {
    const sec = document.createElement('section');
    sec.className = 'fxsec';
    sec.innerHTML = `<h2><span>${title}</span><b></b></h2><div class="kgrid"></div>`;
    const grid = sec.querySelector('.kgrid'), label = sec.querySelector('b');
    let refs = {};
    const render = () => {
      grid.innerHTML = ''; refs = {};
      label.textContent = styles[slot.style].name.toUpperCase();
      for (const sp of styles[slot.style].params) {
        const k = document.createElement('div');
        makeKnob(k, { label: sp.label.toUpperCase(), min: 0, max: 1, step: 0.001, value: slot.values[slot.style][sp.id], def: sp.def, show: (n) => sp.show(sp.map(n)) });
        k.addEventListener('input', () => slot.setParam(sp.id, k.value));
        grid.appendChild(k); refs[sp.id] = k;
      }
    };
    render();
    fxSecs.push({
      slot, styles, sec, render,
      randomize() { const v = slot.randomize(); for (const [id, n] of Object.entries(v)) refs[id].value = n; },
    });
    host.appendChild(sec);
  });
}
function cycleStyle(j) { const s = fxSecs[j]; s.slot.setStyle((s.slot.style + 1) % s.styles.length); s.render(); }
function bypass(j) { const s = fxSecs[j]; s.slot.setBypass(!s.slot.bypass); s.sec.classList.toggle('off', s.slot.bypass); }

// ---------- strony ----------
function setPage(p) {
  page = p;
  document.querySelectorAll('#pages button').forEach((b) => b.classList.toggle('on', b.dataset.page === p));
  el('scopewrap').hidden = p === 'fx';
  el('side').hidden = p === 'fx';
  el('knobs-seq').hidden = p !== 'seq';
  el('knobs-mix').hidden = p !== 'mix';
  el('fxpage').hidden = p !== 'fx';
  fit(); renderKeys(); updateInfo();
}
document.querySelectorAll('#pages button').forEach((b) => b.addEventListener('click', () => setPage(b.dataset.page)));

// ---------- odczyty ----------
function updateInfo() {
  const n = pattern.steps.length, pos = curPos(), brg = Math.floor((pos / n) * 360) % 360;
  const on = pattern.steps.filter((s) => s.on), acc = on.filter((s) => s.vel >= 110).length;
  const info = page === 'seq'
    ? [`SEQ ${n}ST`, `BASE ${baseLabel()}`, MODE_LABEL[state.mode], `BRG ${String(brg).padStart(3, '0')}°`]
    : page === 'mix' ? ['MIX', `X ${(padPos.x * 100) | 0}`, `Y ${(padPos.y * 100) | 0}`, `FLT ${(cutoffHz(+el('cutoff').value) | 0)} Hz`]
      : ['FX', `FLT ${FILTER_STYLES[engine.fx.filter.style].name.toUpperCase()}`, `FX ${FX_STYLES[engine.fx.fx.style].name.toUpperCase()}`];
  el('info').innerHTML = info.map((t, i) => `<span${i === 0 ? ' class="amb"' : ''}>${t}</span>`).join('');
  el('readout').textContent = [
    'RADARXXX', '',
    `BPM     ${engine.bpm}`,
    `BASE    ${baseLabel()}`,
    `KEY     ${MODE_LABEL[state.mode]}`,
    `STEPS   ${String(on.length).padStart(2, '0')}/${n}`,
    `ACCENT  ${String(acc).padStart(2, '0')}`,
    `GATE    ${engine.gateMul.toFixed(2)}×`,
    `SWING   ${Math.round(state.swing * 100)}%`,
    `BRG     ${String(brg).padStart(3, '0')}°`,
    `STEP    ${String(Math.floor(pos) + 1).padStart(2, '0')}`,
    `ENG     ${engine.enabled.map((e, i) => (e ? SHORT[i][0] : '-')).join(' ')}`,
  ].join('\n');
}
setInterval(() => { if (!el('radar').hidden) updateInfo(); }, 120);

// ---------- skróty (komputer) ----------
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || el('radar').hidden || (e.target instanceof HTMLElement && e.target.classList.contains('knob'))) return;
  const map = { Space: togglePlay, KeyR: () => { actions.random(); renderKeys(); }, KeyM: () => { actions.mut(); },
    Digit1: () => setPage('seq'), Digit2: () => setPage('mix'), Digit3: () => setPage('fx'),
    ArrowUp: () => setBpm(engine.bpm + 2), ArrowDown: () => setBpm(engine.bpm - 2) };
  if (map[e.code]) { e.preventDefault(); if (e.target instanceof HTMLButtonElement) e.target.blur(); map[e.code](); }
});

// ---------- start ----------
el('go').addEventListener('click', async () => {
  await engine.start();
  engine.setCutoff(cutoffHz(+el('cutoff').value));
  engine.setResonance(1 + el('reso').value * 22);
  setPad(padPos.x, padPos.y);
  buildFx();
  el('start').hidden = true;
  el('radar').hidden = false;
  setPage('seq');
  engine.play(); lockScreen();
  el('play').textContent = '■'; el('play').classList.add('on');
  cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
});
el('go').focus();
