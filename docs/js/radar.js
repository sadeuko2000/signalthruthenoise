// radarxxx: ekran radarowy jako interfejs sekwencera i miksu silników basu.
// Przemiatająca linia = głowica odtwarzania (jedno okrążenie = jeden obieg wzoru), nuty = echa z poświatą.
import { generateBass, mutate, DEFAULTS, withAccent, withSlide } from './generator.js';
import { Engine } from './audio.js';
import { VOICE_NAMES, PARAM_SPECS, clampToDisc, setGlideTime } from './engines.js';
import { FILTER_STYLES, FX_STYLES, mapValues } from './fx.js';
import { generateDrums, emptyDrums, DRUM_TRACKS, DRUM_KITS, DRUM_STYLES, DRUM_STEPS } from './drums.js';
import { makeKnob, initKnobs } from './knob.js';
import { TAU, DEG_MIN, DEG_MAX, R_OUT, degToR, rToDeg, angleOfStep, polar, stepFromAngle, sweepPos, echoAlpha, echoes, placeNote, clearNote, moveNote, resizeSteps, nFromR, rFromN, nFromTheta, thetaFromN, delayCopies, bandPass, rotateSteps, reverseSteps, invertSteps, clearSteps, doubleSteps, halveSteps } from './radargeo.js';

const el = (id) => document.getElementById(id);
initKnobs();

const engine = new Engine();
const state = { ...DEFAULTS, seed: (Math.random() * 1e9) | 0, length: 16, accent: 0.5, slide: 0.1, oct: 0, latch: false, mixMode: 'solo' };
// Akcenty i ślizgi są ustawiane pokrętłami i nakładane na każdy wzór (nowy, edytowany, zmutowany), bez generowania go od nowa.
const effRoot = () => Math.max(12, Math.min(83, state.root + 12 * (state.oct || 0)));   // tonika + przesunięcie oktawowe z pokrętła OKTAWA (−2..+2)
const finalize = (p) => withSlide(withAccent({ ...p, root: effRoot() }, state.accent), state.slide);
let pattern = finalize(generateBass(state));
engine.pattern = pattern;
let page = 'seq';
let view = 'classic';                            // widok: classic (strony SEQ/MIX/SYN/FX/DRUM), scenes (pole XY + pady scen), orbit (instrument jako orbity)
const tabSel = { seq: 0, mix: 0, syn: 0, fx: 0, drum: 0 };   // wybrana pod-zakładka każdej strony (0 = MAIN)
let synSel = 0;                                  // silnik edytowany na stronie SYN (0..3)
const globals = { cutoff: 0.5, reso: 0.5, master: 1, comp: 0.5, mdrive: 0, dj: 0, tape: 0, wow: 0, chorus: 0 };   // ustawienia wyjściowe i filtra globalnego (do zapisu w presetach)
const padPos = { x: 0.25, y: 0.75 };
const cv = el('scope'), g = cv.getContext('2d');
let lastStep = { i: 0, t: 0 }, heldPos = 0;
engine.onStep = (i, t) => { lastStep = { i, t }; };

const INK = '241,241,236', ACC = '198,255,26', PAPER = '#181818';      // paleta: biel i kwaśna limonka na prawie czarnym tle
const PAPER_TRAIL = 'rgba(24,24,24,0.38)';                              // przy efekcie CRT ekran nie jest czyszczony do końca: zostaje poświata luminoforu za ruchomymi liniami
let crtOn = false;
try { crtOn = localStorage.getItem('radarxxx.crt.v1') === '1'; } catch { /* domyślnie wyłączony */ }
const clearScope = (W) => { g.fillStyle = crtOn ? PAPER_TRAIL : PAPER; g.fillRect(0, 0, W, W); };
const FONT = (px) => `${Math.round(px)}px 'VT323', ui-monospace, Menlo, monospace`;
const cutoffHz = (v) => 60 * Math.pow(100, v);

// ---------- wzór ----------
function setSteps(steps) { pattern = finalize({ ...pattern, steps }); engine.pattern = pattern; }
function regen() { pattern = finalize(generateBass(state)); engine.pattern = pattern; }

// ---------- pozycja linii ----------
function curPos() {
  const n = pattern.steps.length;
  if (!engine.playing || !engine.ctx) return heldPos;
  heldPos = sweepPos(lastStep.i, lastStep.t, engine.ctx.currentTime, 60 / engine.effBpm / 4, n);
  return heldPos;
}

// ---------- rysowanie ----------
// Wszystkie strony (SEQ, MIX, FX) rysują na tym samym ekranie w tym samym miejscu i rozmiarze. Wspólny rdzeń to tło, pierścienie,
// obrzeże z kreskami, przemiatająca linia z poświatą i echa wzoru; każda strona dokłada swoje elementy.
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
const clamp01 = (v) => Math.max(0, Math.min(1, v));

let touch = null;   // aktywny dotyk na SEQ: { i, deg } do rysowania linii namiaru (EBL)

const RADAR_K = 0.91;      // średnica radaru jako ułamek pola ekranu: w rogach zostaje miejsce na kropki i napisy pod kątem 45°
const geo = () => { const W = cv.width; return { W, cx: W / 2, cy: W / 2, R: (W / 2) * RADAR_K, dpr: W / Math.max(1, cv.clientWidth) }; };
function sweepState() { const n = pattern.steps.length, pos = curPos(); return { n, pos, sw: (pos / n) * TAU }; }

function drawBase(G, S, o = {}) {
  const { W, cx, cy, R, dpr } = G;
  clearScope(W);
  // uproszczone tło: tylko pierścień toniki i oktawy oraz obrzeże, bez siatki stopni i bez drobnej podziałki
  if (!o.noRings) { circle(cx, cy, degToR(0) * R, `rgba(${INK},.5)`, dpr); circle(cx, cy, degToR(7) * R, `rgba(${INK},.5)`, dpr); }
  circle(cx, cy, R * 0.985, `rgba(${INK},1)`, dpr);
  const { n, pos } = S, hot = Math.floor(pos) % n;
  for (let k = 0; k < n; k += 4) {                         // krótka kreska co 4 kroki (ćwierćnuta)
    const a = angleOfStep(k, n), [x0, y0] = polarXY(cx, cy, R * 0.945, a), [x1, y1] = polarXY(cx, cy, R * 0.985, a);
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.strokeStyle = `rgba(${INK},1)`; g.lineWidth = dpr; g.stroke();
  }
  { const a = angleOfStep(hot, n), [x0, y0] = polarXY(cx, cy, R * 0.9, a), [x1, y1] = polarXY(cx, cy, R * 0.985, a);
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.strokeStyle = `rgba(${ACC},1)`; g.lineWidth = 3 * dpr; g.stroke(); }
  { const [x, y] = polarXY(cx, cy, R * 0.985, 0), [x2, y2] = polarXY(cx, cy, R * 0.94, -0.045), [x3, y3] = polarXY(cx, cy, R * 0.94, 0.045);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.lineTo(x3, y3); g.closePath(); g.fillStyle = `rgba(${ACC},1)`; g.fill(); }
  // ślad za linią: jedna miękka smuga zamiast kreskowania
  g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R * 0.93, S.sw - 0.5 - Math.PI / 2, S.sw - Math.PI / 2); g.closePath();
  g.fillStyle = `rgba(${INK},.07)`; g.fill();
}

// Jedno echo. o: r (promień w px zamiast wzorowego), da (przesunięcie kąta), lw (mnożnik grubości), col, noGlow.
function drawEcho(G, e, alpha, o = {}) {
  const { cx, cy, R, dpr } = G;
  const a = clamp01(o.raw ? alpha : 0.3 + 0.7 * alpha);        // na papierze echo nigdy nie znika zupełnie (wzór ma być zawsze czytelny)
  if (alpha < 0.01 && !o.raw) return;
  if (a < 0.01) return;
  const col = o.col || (e.accent ? ACC : INK);
  const a0 = e.a0 + (o.da || 0) - Math.PI / 2, rad = o.r ?? e.r * R, lw = e.w * dpr * (R / (170 * dpr)) * 0.9 * (o.lw || 1);
  g.lineCap = 'round';
  g.beginPath(); g.arc(cx, cy, rad, a0, a0 + e.len);
  g.strokeStyle = `rgba(${col},${a.toFixed(3)})`; g.lineWidth = lw; g.stroke();
  g.lineCap = 'butt';
}

function drawSweepLine(G, S) {
  const { cx, cy, R, dpr } = G, [lx, ly] = polarXY(cx, cy, R * 0.94, S.sw);
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(lx, ly); g.strokeStyle = `rgba(${INK},1)`; g.lineWidth = 1.6 * dpr; g.stroke();
  circle(cx, cy, R * 0.035, `rgba(${INK},1)`, 1.5 * dpr);
}

// Napis wzdłuż okręgu. ang: środek napisu (rad od góry, zgodnie z ruchem wskazówek), cw: czytany zgodnie z ruchem wskazówek
// (górne rogi) albo przeciwnie (dolne rogi, żeby czytało się od lewej do prawej). r: promień linii bazowej.
function arcText(txt, cx, cy, r, ang, cw, size, color) {
  g.font = FONT(size); g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  const chars = [...txt], ws = chars.map((ch) => g.measureText(ch).width + size * 0.06), total = ws.reduce((x, y) => x + y, 0), dir = cw ? 1 : -1;
  let a = ang - dir * (total / r) / 2;
  chars.forEach((ch, i) => {
    const half = ws[i] / r / 2; a += dir * half;
    g.save(); g.translate(cx + Math.sin(a) * r, cy - Math.cos(a) * r); g.rotate(cw ? a : a + Math.PI); g.fillText(ch, 0, 0); g.restore();
    a += dir * half;
  });
}
// Cztery kropki w rogach ekranu (przyciski o funkcji zależnej od strony), z napisami wygiętymi wzdłuż obrzeża radaru jak w szkicu.
// defs[i]: { label, sub, lit, bar, barHot, dim }. lit === false = pusta kropka (przełącznik wyłączony), w pozostałych przypadkach pełna.
function drawCorners(G, defs, flat = false) {
  const { W, cx, cy, R, dpr } = G, rd = W * 0.04, m = W * 0.088, size = W * 0.047, sz2 = W * 0.036;
  const ang = [-Math.PI / 4, Math.PI / 4, (5 * Math.PI) / 4, (3 * Math.PI) / 4];
  defs.forEach((d, i) => {
    if (!d) return;
    const top = i < 2, left = i % 2 === 0, x = flat ? ((i + 0.5) * W) / 4 : left ? m : W - m, y = flat ? W * 0.855 : top ? m : W - m, a = d.dim ? 0.4 : 1;
    g.beginPath(); g.arc(x, y, rd, 0, TAU);
    if (d.lit === false) { g.strokeStyle = `rgba(${ACC},${a})`; g.lineWidth = 2 * dpr; g.stroke(); }
    else { g.fillStyle = `rgba(${ACC},${a})`; g.fill(); }
    if (flat) {                                   // sekwencer perkusji: cztery kropki w rzędzie pod siatką, napis i podpis wyśrodkowane pod każdą
      const fs = W * 0.034, fs2 = W * 0.027;
      g.textBaseline = 'middle'; g.textAlign = 'center';
      g.font = FONT(fs); g.fillStyle = `rgba(${INK},${a})`; g.fillText(d.label, x, y + rd + fs * 0.95);
      if (d.sub) { g.font = FONT(fs2); g.fillStyle = `rgba(${INK},${0.65 * a})`; g.fillText(d.sub, x, y + rd + fs * 0.95 + fs2 * 1.5); }
      return;
    }
    // główny napis: tuż za obrzeżem radaru, na przekątnej, obrócony o 45° (styczny do okręgu), między radarem a kropką
    const sx = left ? -1 : 1, sy = top ? -1 : 1, dist = R * 1.089;
    g.save(); g.translate(cx + sx * dist * Math.SQRT1_2, cy + sy * dist * Math.SQRT1_2); g.rotate(sx * sy > 0 ? -Math.PI / 4 : Math.PI / 4);
    g.font = FONT(size); g.fillStyle = `rgba(${INK},${a})`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(d.label, 0, 0); g.restore();
    const rSub = R * (top ? 0.79 : 0.9);
    if (d.bar != null) {
      const span = 0.5, a0 = ang[i] - span / 2, a1 = ang[i] + span / 2, st = (v) => v - Math.PI / 2;
      g.lineCap = 'butt'; g.lineWidth = W * 0.012;
      g.beginPath(); g.arc(cx, cy, rSub, st(a0), st(a1)); g.strokeStyle = `rgba(${INK},.3)`; g.stroke();
      g.beginPath();
      if (top) g.arc(cx, cy, rSub, st(a0), st(a0 + span * d.bar)); else g.arc(cx, cy, rSub, st(a1 - span * d.bar), st(a1));
      g.strokeStyle = d.barHot ? `rgb(${ACC})` : `rgba(${INK},.8)`; g.stroke();
    } else if (d.sub) arcText(d.sub, cx, cy, rSub, ang[i], top, sz2, `rgba(${INK},${0.65 * a})`);
  });
}

function drawSeq() {
  const G = geo(), S = sweepState(), { cx, cy, R, dpr } = G;
  drawBase(G, S);
  for (const e of echoes(pattern.steps)) drawEcho(G, e, echoAlpha(e.i, S.pos, S.n));
  drawSweepLine(G, S);
  // namiar dotyku (EBL): linia od środka i znacznik w punkcie dotyku
  if (touch) {
    const a = angleOfStep(touch.i, S.n), [tx, ty] = polarXY(cx, cy, R * 0.94, a), [mx, my] = polarXY(cx, cy, degToR(touch.deg) * R, a);
    g.setLineDash([4 * dpr, 4 * dpr]); g.beginPath(); g.moveTo(cx, cy); g.lineTo(tx, ty); g.strokeStyle = `rgba(${ACC},.7)`; g.lineWidth = dpr; g.stroke(); g.setLineDash([]);
    g.beginPath(); g.arc(mx, my, 9 * dpr, 0, TAU); g.strokeStyle = `rgba(${ACC},.95)`; g.lineWidth = 1.5 * dpr; g.stroke();
  }
  drawCorners(G, dotDefs());
}

const PAD_R = 0.85;      // promień pada MIX (ułamek promienia radaru)
const PAD_ANCHORS = [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([a, b]) => [a * Math.SQRT1_2, b * Math.SQRT1_2]);
const SHORT = ['PROPHET', 'MS20', 'DX', 'WAVE'];                     // nazwy rodzajów silnika
const TAB_SHORT = ['PRO', 'MS20', 'DX', 'WAVE'];                     // krótkie nazwy na zakładkach
const typeName = (i) => SHORT[engine.types[i]];                      // nazwa silnika w miejscu i (rodzaje mogą się powtarzać)
function drawMix() {
  const G = geo(), S = sweepState(), { cx, cy, R, dpr } = G, Rp = R * PAD_R;
  drawBase(G, S);
  drawSweepLine(G, S);
  const mx = cx + (2 * padPos.x - 1) * Rp, my = cy - (2 * padPos.y - 1) * Rp;
  g.font = FONT(R * 0.085); g.textBaseline = 'middle';
  // linie od kursora w stronę czterech rogów (napisy w rogach mówią, który to silnik); grubość i jasność = udział silnika
  PAD_ANCHORS.forEach(([ax, ay], i) => {
    const x = cx + (ax / Math.SQRT1_2) * R * 0.93 * Math.SQRT1_2, y = cy - (ay / Math.SQRT1_2) * R * 0.93 * Math.SQRT1_2, w = engine.blend[i] || 0, on = engine.enabled[i];
    if (!on) return;
    const lead = w === Math.max(...engine.blend);
    g.beginPath(); g.moveTo(mx, my); g.lineTo(x, y); g.strokeStyle = lead ? `rgba(${ACC},${(0.35 + 0.6 * w).toFixed(3)})` : `rgba(${INK},${(0.12 + 0.5 * w).toFixed(3)})`;
    g.lineWidth = (1 + 2.5 * w) * dpr; g.setLineDash([5 * dpr, 4 * dpr]); g.stroke(); g.setLineDash([]);
  });
  g.strokeStyle = `rgba(${ACC},1)`; g.lineWidth = 1.6 * dpr;
  g.beginPath(); g.arc(mx, my, R * 0.05, 0, TAU); g.moveTo(mx - R * 0.09, my); g.lineTo(mx + R * 0.09, my); g.moveTo(mx, my - R * 0.09); g.lineTo(mx, my + R * 0.09); g.stroke();
  drawCorners(G, dotDefs());
}

// ---------- FX na ekranie radarowym ----------
// Dotyk to makro: jeden punkt (odległość od środka i kąt) ustawia naraz kilka parametrów FILTRA i EFEKTU.
// Odległość od środka to „intensywność” (np. cutoff filtra, feedback i mix efektu rosną razem), kąt to „charakter”
// (np. rezonans filtra i czas delaya). W środku jest sucho, na brzegu najmocniej. Nuty ze wzoru pokazują działanie obu naraz:
// echa przechodzą przez filtr (maska pasma), a potem przez efekt (kopie delaya, fale pogłosu, podwojenie chorusa, spłaszczenie dystorsji).
const MACRO = {
  0: [{ r: ['cutoff'], a: ['reso'] }, { r: ['cutoff'], a: ['mode'] }, { r: ['lpCut'], a: ['lpRes'] }, { r: ['freq'], a: ['feedback'] }],            // filtr: style 0..3
  1: [{ r: ['feedback', 'mix'], a: ['time'] }, { r: ['size', 'mix'], a: ['damping'] }, { r: ['depth', 'mix'], a: ['rate'] }, { r: ['drive', 'mix'], a: ['curve'] }],   // efekt
};
let fxCtl = 0;                                                  // czym steruje ekran: 0 oba, 1 tylko filtr, 2 tylko efekt
const CTL_LABEL = ['OBA', 'FILTR', 'EFEKT'];
const driven = () => (fxCtl === 0 ? [0, 1] : fxCtl === 1 ? [0] : [1]);
const macroOf = (j) => MACRO[Math.min(j, 1)][fxSecs[j].slot.style];         // drugi efekt (j = 2) ma te same makra co pierwszy
const polarIds = (j, si) => [MACRO[Math.min(j, 1)][si].r[0], MACRO[Math.min(j, 1)][si].a[0]];     // parametry pokazywane kursorem
const mixFromR = (rN) => 0.08 + 0.84 * rN;                              // mix efektu rośnie od środka ku brzegowi

function drawFx(ts) {
  const G = geo(), S = sweepState(), { cx, cy, R, dpr } = G, { n, pos } = S;
  drawBase(G, S);
  const E = echoes(pattern.steps);
  const rp = (nn) => rFromN(nn) * R;
  const ring = (r, glow, a = 1) => circle(cx, cy, r, `rgba(${ACC},${a})`, (1.5 + glow * 5) * dpr);
  const read = (sec) => { const si = sec.slot.style, nv = sec.slot.values[si]; return { si, nv, m: mapValues(sec.styles[si], nv), on: !sec.slot.bypass }; };
  const F = read(fxSecs[0]), X = read(fxSecs[1]), X2 = read(fxSecs[2]);
  const base = (e, mul = 1, o = {}) => drawEcho(G, e, echoAlpha(e.i, pos, n) * mul, o);

  // 1) filtr: promień = częstotliwość. Echa (wysokość dźwięku = promień) poza pasmem są przytłumione.
  const soft = 0.14 * R, mixF = clamp01(F.m.mix ?? 1);
  let pass = () => 1, rings = [], glow = 0;
  if (F.on) {
    if (F.si === 0) { const c = rp(F.nv.cutoff); pass = (r) => bandPass(r, 0, c, soft); rings = [c]; glow = F.nv.reso; }
    else if (F.si === 1) {
      const c = rp(F.nv.cutoff), md = F.nv.mode, lp = Math.max(0, 1 - 2 * md), bp = 1 - Math.abs(2 * md - 1), hp = Math.max(0, 2 * md - 1);
      pass = (r) => lp * bandPass(r, 0, c, soft) + bp * bandPass(r, c - 0.1 * R, c + 0.1 * R, soft) + hp * bandPass(r, c, 2 * R, soft);
      rings = [c]; glow = 0.3;
    } else if (F.si === 2) { let lo = rp(F.nv.hpCut), hi = rp(F.nv.lpCut); if (lo > hi) [lo, hi] = [hi, lo]; pass = (r) => bandPass(r, lo, hi, soft); rings = [lo, hi]; glow = F.nv.lpRes; }
    else { const c = rp(F.nv.freq); for (let k = -2; k <= 2; k++) ring(c + k * 0.09 * R, 0, (1 - Math.abs(k) * 0.3) * (0.25 + 0.75 * F.nv.feedback)); }
  }
  const through = (e) => (F.on ? (1 - mixF) + mixF * pass(e.r * R) : 1);       // ile echa przechodzi przez filtr
  E.forEach((e) => base(e, through(e)));

  // 2) efekty (FX1, potem FX2): każdy działa na to, co przeszło przez filtr; drugi rysowany nieco słabiej i cieniej
  const stage = (X, k) => {
    if (!X.on) return;
    const mix = clamp01(X.m.mix ?? 1);
    if (mix < 0.02) return;                        // bez miksu efekt jest niesłyszalny, więc nic nie rysujemy
    if (X.si === 0) {                              // delay: kolejne, coraz cichsze powtórzenia echa o `time` kroków dalej
      const copies = delayCopies(X.m.time, X.m.feedback, 4), f = (0.2 + 0.8 * mix) * k;
      E.forEach((e) => copies.forEach((c) => drawEcho(G, e, echoAlpha(e.i + c.shift, pos, n) * c.gain * f * through(e), { da: (c.shift / n) * TAU, raw: true, lw: 0.8, col: INK })));
    } else if (X.si === 1) {                       // pogłos: fala rozchodzi się od echa po jego przemiataniu
      const life = n * (0.25 + 0.5 * X.nv.size), f = (0.15 + 0.7 * mix) * k;
      E.forEach((e) => {
        const delta = (((pos - e.i) % n) + n) % n;
        if (delta > life) return;
        const t = delta / life, a = e.a0 + e.len / 2 - Math.PI / 2;
        circle(cx + Math.cos(a) * e.r * R, cy + Math.sin(a) * e.r * R, t * R * (0.12 + 0.5 * X.nv.size), `rgba(${INK},${((1 - t) * f * through(e)).toFixed(3)})`, 1.2 * dpr);
      });
    } else if (X.si === 2) {                       // chorus: echa podwojone i lekko rozstrojone, wahające się z tempem LFO
      const off = X.nv.depth * 0.07 * Math.sin((ts / 1000) * TAU * Math.min(X.m.rate, 4) * 0.5), f = (0.2 + 0.8 * mix) * k;
      E.forEach((e) => { base(e, 0.55 * f * through(e), { da: off, raw: true, lw: 0.85 }); base(e, 0.4 * f * through(e), { da: -off * 1.3, raw: true, lw: 0.85 }); });
    } else {                                       // dystorsja: echa spłaszczone do pierścienia obcięcia (od miękkiej do „fold”)
      const dr = X.nv.drive, rc = R * (R_OUT - 0.4 * dr), f = (0.25 + 0.75 * mix) * k;
      circle(cx, cy, rc, `rgba(${ACC},.6)`, dpr, [4 * dpr, 4 * dpr]);
      E.forEach((e) => {
        const r0 = e.r * R, r1 = r0 > rc ? (X.nv.curve > 0.5 ? rc - (r0 - rc) * 0.7 : rc) : r0;
        base(e, f * through(e), { r: r1, lw: 1 + dr * 0.9, col: ACC, noGlow: true });
      });
    }
    };
  // kolejność efektów jak w ROUTING: pierwszy w łańcuchu rysowany pełną mocą, drugi słabiej
  engine.fx.order.filter((i) => i > 0).forEach((i, k) => stage(i === 1 ? X : X2, k ? 0.7 : 1));
  rings.forEach((r) => ring(r, glow));
  drawSweepLine(G, S);

  // kursory: pełny krzyżyk = pierwsza sterowana sekcja, pusty znacznik = druga (widać, że oba parametry „podążają” za dotykiem)
  const cursorOf = (j) => { const sec = fxSecs[j], ids = polarIds(j, sec.slot.style), nv = sec.slot.values[sec.slot.style]; return { r: rp(nv[ids[0]]), a: thetaFromN(nv[ids[1]]) }; };
  const ds = driven(), c0 = cursorOf(ds[0]);
  const [bx, by] = polarXY(cx, cy, R * 0.94, c0.a), [kx, ky] = polarXY(cx, cy, c0.r, c0.a);
  g.setLineDash([4 * dpr, 4 * dpr]); g.beginPath(); g.moveTo(cx, cy); g.lineTo(bx, by); g.strokeStyle = `rgba(${ACC},.55)`; g.lineWidth = dpr; g.stroke(); g.setLineDash([]);
  g.strokeStyle = `rgba(${ACC},1)`; g.lineWidth = 1.6 * dpr;
  g.beginPath(); g.arc(kx, ky, R * 0.045, 0, TAU); g.moveTo(kx - R * 0.08, ky); g.lineTo(kx + R * 0.08, ky); g.moveTo(kx, ky - R * 0.08); g.lineTo(kx, ky + R * 0.08); g.stroke();
  drawCorners(G, dotDefs());
  if (ds.length > 1) { const c1 = cursorOf(ds[1]), [hx, hy] = polarXY(cx, cy, c1.r, c1.a); g.beginPath(); g.arc(hx, hy, R * 0.03, 0, TAU); g.strokeStyle = `rgba(${ACC},.8)`; g.lineWidth = 1.4 * dpr; g.stroke(); }
}

// ---------- SYN: parametry silników na ekranie radarowym ----------
// Dotyk ustawia „kształt dźwięku” wybranego silnika: odległość od środka = siła obwiedni filtra (zryw na początku nuty),
// kąt = jej zanik. Na ekranie echa dostają kolec (siła) i ogon (zanik) odpowiadające tym wartościom.
const specOf = (i, id) => PARAM_SPECS[engine.types[i]].find((x) => x.id === id);
const normParam = (i, id) => { const sp = specOf(i, id); return clamp01((engine.voices[i].params[id] - sp.min) / (sp.max - sp.min)); };
function setEngParam(i, id, nn) {
  const sp = specOf(i, id), raw = sp.min + clamp01(nn) * (sp.max - sp.min), v = Math.round(raw / sp.step) * sp.step;
  engine.setParam(i, id, v);
  if (tabSel.syn === 0) { if (macroRefs[id]) macroRefs[id].value = v; }
  else if (i === synSel && synRefs[id]) synRefs[id].value = v;
}
// Na zakładce MAIN dotyk ustawia zryw i zanik filtra we wszystkich silnikach naraz, na zakładce silnika tylko w tym silniku.
function synFrom(p) {
  const all = tabSel.syn === 0 ? VOICE_NAMES.map((_, i) => i) : [synSel];
  all.forEach((i) => { setEngParam(i, 'fEnv', nFromR(p.rn)); setEngParam(i, 'fDec', nFromTheta(p.theta)); });
}

function drawSyn() {
  const G = geo(), S = sweepState(), { cx, cy, R, dpr } = G, { n, pos } = S;
  drawBase(G, S);
  const fE = normParam(synSel, 'fEnv'), fD = normParam(synSel, 'fDec'), live = engine.enabled[synSel] ? 1 : 0.4;
  for (const e of echoes(pattern.steps)) {
    const al = echoAlpha(e.i, pos, n) * live, r0 = e.r * R;
    drawEcho(G, e, al);
    const [x0, y0] = polarXY(cx, cy, r0, e.a0), [x1, y1] = polarXY(cx, cy, r0 + (0.03 + fE * 0.15) * R, e.a0);     // kolec: siła obwiedni filtra
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.strokeStyle = `rgba(${INK},${(0.35 + 0.5 * al).toFixed(3)})`; g.lineWidth = 1.4 * dpr; g.stroke();
    const tail = fD * 3 * (TAU / n), start = e.a0 + e.len - Math.PI / 2;                                              // ogon: zanik
    for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(cx, cy, r0, start + (k * tail) / 6, start + ((k + 1) * tail) / 6); g.strokeStyle = `rgba(${INK},${((1 - k / 6) * 0.5 * al).toFixed(3)})`; g.lineWidth = Math.max(dpr, e.w * 0.5 * dpr); g.stroke(); }
  }
  drawSweepLine(G, S);
  drawCorners(G, dotDefs());
  const kr = rFromN(fE) * R, ka = thetaFromN(fD), [bx, by] = polarXY(cx, cy, R * 0.94, ka), [kx, ky] = polarXY(cx, cy, kr, ka);
  g.setLineDash([4 * dpr, 4 * dpr]); g.beginPath(); g.moveTo(cx, cy); g.lineTo(bx, by); g.strokeStyle = `rgba(${ACC},.55)`; g.lineWidth = dpr; g.stroke(); g.setLineDash([]);
  g.strokeStyle = `rgba(${ACC},1)`; g.lineWidth = 1.6 * dpr;
  g.beginPath(); g.arc(kx, ky, R * 0.045, 0, TAU); g.moveTo(kx - R * 0.08, ky); g.lineTo(kx + R * 0.08, ky); g.moveTo(kx, ky - R * 0.08); g.lineTo(kx, ky + R * 0.08); g.stroke();
}

// ---------- DRUM: klasyczny sekwencer krokowy ----------
// Pięć rzędów (stopa, werbel, klaskanie, hat zamknięty, hat otwarty) i 16 kroków w poziomie, w miejscu radaru. Dotknięcie przełącza: pusty, uderzenie, akcent;
// przeciągnięcie po rzędzie wpisuje tę samą wartość w kolejne kroki.
const DG = { x0: 0.095, x1: 0.975, y0: 0.11, y1: 0.77 };            // pole siatki jako ułamek kwadratu ekranu
function drawDrum() {
  const G = geo(), S0 = sweepState(), { W, dpr } = G;
  const p16 = S0.pos % DRUM_STEPS, hot = Math.floor(p16), gx = DG.x0 * W, gw = (DG.x1 - DG.x0) * W, gy = DG.y0 * W, gh = (DG.y1 - DG.y0) * W, cw = gw / DRUM_STEPS, rh = gh / DRUM_TRACKS.length;
  clearScope(W);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let k = 0; k < DRUM_TRACKS.length; k++) {
    const muted = engine.drum.mute[k], a = muted ? 0.35 : 1, y = gy + k * rh;
    g.font = FONT(rh * 0.3); g.fillStyle = `rgba(${INK},${0.8 * a})`; g.fillText(['K', 'S', 'C', 'H', 'O'][k], gx * 0.5, y + rh / 2);
    for (let s = 0; s < DRUM_STEPS; s++) {
      const v = engine.drumPattern.steps[k][s], x = gx + s * cw, pad = Math.max(1.5 * dpr, cw * 0.1), cx0 = x + pad, cy0 = y + pad, w = cw - 2 * pad, h = rh - 2 * pad;
      if (!v) { g.fillStyle = `rgba(${INK},${(s % 4 === 0 ? 0.16 : 0.09) * a})`; g.fillRect(cx0, cy0, w, h); }
      else { g.fillStyle = v > 1 ? `rgba(${ACC},${a})` : `rgba(${INK},${a})`; g.fillRect(cx0, cy0, w, h); }
    }
  }
  if (engine.playing) {                                           // bieżący krok: ramka wokół kolumny
    const x = gx + hot * cw;
    g.strokeStyle = `rgba(${ACC},1)`; g.lineWidth = 1.6 * dpr; g.strokeRect(x + 0.5 * dpr, gy - 4 * dpr, cw - dpr, gh + 8 * dpr);
  }
  g.font = FONT(W * 0.036); g.fillStyle = `rgba(${INK},.6)`; [1, 5, 9, 13].forEach((n) => g.fillText(String(n), gx + (n - 0.5) * cw, gy - 12 * dpr));   // numery uderzeń (ćwierćnut)
  drawCorners(G, dotDefs(), true);
}
function drumCell(e) {
  const r = cv.getBoundingClientRect(), u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
  if (u < DG.x0 || u >= DG.x1 || v < DG.y0 || v >= DG.y1) return null;
  return { k: Math.floor(((v - DG.y0) / (DG.y1 - DG.y0)) * DRUM_TRACKS.length), s: Math.floor(((u - DG.x0) / (DG.x1 - DG.x0)) * DRUM_STEPS) };
}
function drumDown(e) {
  cv.setPointerCapture(e.pointerId);
  const c = drumCell(e); if (!c) return;
  const row = engine.drumPattern.steps[c.k], val = (row[c.s] + 1) % 3;
  drag = { mode: 'drum', val, last: `${c.k}:${c.s}` };
  row[c.s] = val; if (val) engine.auditionDrum(c.k);
}
function drumMove(e) {
  const c = drumCell(e); if (!c) return;
  const key = `${c.k}:${c.s}`; if (key === drag.last) return;
  drag.last = key;
  const row = engine.drumPattern.steps[c.k];
  if (row[c.s] !== drag.val) { row[c.s] = drag.val; if (drag.val) engine.auditionDrum(c.k); }
}
function drumRandom() { engine.drumPattern = generateDrums({ style: engine.drum.style, density: engine.drum.density, seed: (Math.random() * 1e9) | 0 }); }

let raf = 0, lastSync = 0;
function loop(ts) {
  if (ts - lastSync > 120) { lastSync = ts; if (typeof syncAssign === 'function') syncAssign(); }
  if (!el('radar').hidden && view === 'orbit') drawOrbit(ts);
  else if (!el('radar').hidden && view === 'scenes') syncScenes();
  else if (!el('radar').hidden) { if (page === 'mix') drawMix(); else if (page === 'fx') drawFx(ts); else if (page === 'syn') drawSyn(); else if (page === 'drum') drawDrum(); else drawSeq(); }
  if (crtOn && view !== 'scenes' && !el('radar').hidden) bloom();
  raf = requestAnimationFrame(loop);
}
// poświata: zmniejszona kopia ekranu (bez tła) rysowana na drugim płótnie, które CSS rozmywa i nakłada trybem screen
const glowCv = el('glow'), gg = glowCv.getContext('2d');
function bloom() {
  const gw = Math.max(1, cv.width >> 2); if (glowCv.width !== gw) { glowCv.width = gw; glowCv.height = gw; }
  gg.globalCompositeOperation = 'source-over'; gg.clearRect(0, 0, gw, gw); gg.drawImage(cv, 0, 0, gw, gw);
  gg.globalCompositeOperation = 'difference'; gg.fillStyle = PAPER; gg.fillRect(0, 0, gw, gw); gg.globalCompositeOperation = 'source-over';
}
function setCrt(on) { crtOn = on; el('radar').classList.toggle('crt', on); try { localStorage.setItem('radarxxx.crt.v1', on ? '1' : '0'); } catch { /* brak pamięci */ } }

// ---------- dotyk na ekranie ----------
let drag = null;
function pointerPolar(e) {
  const r = cv.getBoundingClientRect(), R = (Math.min(r.width, r.height) / 2) * RADAR_K;
  const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  return { ...polar(dx, dy), rn: Math.hypot(dx, dy) / R, dx, dy, R };
}
function setPad(x0, y0) {
  const { x, y } = clampToDisc(x0, y0);
  padPos.x = x; padPos.y = y;
  engine.setBlend(x, y);
}
function mixFrom(p) { const Rp = p.R * PAD_R; setPad((p.dx / Rp + 1) / 2, (-p.dy / Rp + 1) / 2); }
// Ustawia parametr aktywnej sekcji FX i odświeża jego pokrętło.
function setFxParam(sec, id, nn) { sec.slot.setParam(id, nn); const k = sec.refs[id]; if (k) k.value = nn; }
function fxFrom(p) {
  const rN = nFromR(p.rn), aN = nFromTheta(p.theta);
  for (const j of driven()) {
    const sec = fxSecs[j];
    if (sec.slot.bypass) continue;
    const m = macroOf(j);
    m.r.forEach((id) => setFxParam(sec, id, id === 'mix' ? mixFromR(rN) : rN));
    m.a.forEach((id) => setFxParam(sec, id, aN));
  }
}
cv.addEventListener('pointerdown', (e) => {
  const p = pointerPolar(e);
  cv.setPointerCapture(e.pointerId);
  if (view === 'orbit') { orbitDown(e); return; }
  if (page === 'drum') { drumDown(e); return; }
  if (page === 'mix') { drag = { mode: 'mix' }; mixFrom(p); return; }
  if (page === 'fx') { drag = { mode: 'fx' }; fxFrom(p); return; }
  if (page === 'syn') { drag = { mode: 'syn' }; synFrom(p); return; }
  if (p.rn < 0.09 || p.rn > 0.98) return;
  const n = pattern.steps.length, i = stepFromAngle(p.theta, n), deg = rToDeg(p.rn);
  const st = pattern.steps[i];
  const grabbed = st.on && Math.abs(st.degree - deg) <= 1;
  drag = { mode: 'seq', i, deg, grabbed, moved: false };
  touch = { i, deg };
  if (!grabbed) { setSteps(placeNote(pattern.steps, i, deg, st)); engine.audition(pattern.steps[i]); }
  else engine.audition(st);
});
cv.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (drag.mode === 'drum') { drumMove(e); return; }
  if (drag.mode === 'orbit') { orbitMove(e); return; }
  const p = pointerPolar(e);
  if (drag.mode === 'mix') { mixFrom(p); return; }
  if (drag.mode === 'fx') { fxFrom(p); return; }
  if (drag.mode === 'syn') { synFrom(p); return; }
  if (p.rn < 0.09) return;
  const n = pattern.steps.length, i = stepFromAngle(p.theta, n), deg = rToDeg(Math.min(p.rn, 0.96));
  touch = { i, deg };
  if (i !== drag.i || deg !== drag.deg) {
    setSteps(moveNote(pattern.steps, drag.i, i, deg));
    drag.i = i; drag.deg = deg; drag.moved = true;
    engine.audition(pattern.steps[i]);
  }
});
function endDrag() {
  if (drag && drag.mode === 'orbit') commitSoon();
  if (drag && drag.mode === 'seq' && drag.grabbed && !drag.moved) setSteps(clearNote(pattern.steps, drag.i));   // dotknięcie istniejącego echa usuwa je
  drag = null; touch = null;
}
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', () => { drag = null; touch = null; });


// ============================================================================
// Interfejs pod radarem: zakładki, siatka 5x2 pokręteł i przycisków, kropki w rogach, dolny pasek
// ============================================================================
const toastEl = el('toast');
function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => toastEl.classList.remove('on'), 1800); }

// ---------- historia (cofnij / ponów) i presety ----------
const snapshot = () => JSON.parse(JSON.stringify({
  pattern,
  state: { root: state.root, mode: state.mode, accent: state.accent, slide: state.slide, oct: state.oct, swing: state.swing, seed: state.seed, density: state.density, syncopation: state.syncopation, latch: state.latch, mixMode: state.mixMode },
  audio: { offs: { offFAtk: engine.p.offFAtk, offFRel: engine.p.offFRel, offAAtk: engine.p.offAAtk, offARel: engine.p.offARel }, drum: engine.drum, dpat: engine.drumPattern, bpm: engine.bpm, tmul: engine.tempoMul, vOff: engine.vOff, gate: engine.gateMul, human: engine.human, ghost: engine.ghost, velo: engine.velo, types: engine.types, enabled: engine.enabled, levels: engine.levels, solo: engine.solo, xy: engine.xy, eq: engine.eq, vOct: engine.vOct, vTune: engine.vTune, vEq: engine.vEq, params: engine.voices.map((v) => v.params) },
  globals, ctl: fxCtl, warp: warpIdx, ctrl, assign, route: engine.fx.order,
  fx: [engine.fx.filter, engine.fx.fx, engine.fx.fx2].map((x) => ({ style: x.style, values: x.values, bypass: x.bypass })),
}));
function applyGlobals() {
  engine.setCutoff(cutoffHz(globals.cutoff)); engine.setResonance(1 + globals.reso * 22);
  engine.setMaster(globals.master); engine.setComp(globals.comp); engine.setDrive(globals.mdrive);
  engine.setDj(globals.dj); engine.setTape(globals.tape); engine.setWow(globals.wow); engine.setChorus(globals.chorus);
}
function restore(sn) {
  pattern = sn.pattern; engine.pattern = pattern;
  Object.assign(state, sn.state); engine.latch = state.latch;
  const a = sn.audio;
  Object.assign(engine.p, a.offs || {});
  if (a.drum) { Object.assign(engine.drum, a.drum); engine.drumPattern = JSON.parse(JSON.stringify(a.dpat || engine.drumPattern)); engine.applyDrum(); }
  engine.setBpm(a.bpm); engine.setTempoMul(a.tmul || 1); (a.vOff || [0, 0, 0, 0]).forEach((v, i) => { engine.vOff[i] = v; }); engine.gateMul = a.gate; engine.human = a.human; engine.ghost = a.ghost; engine.velo = a.velo;
  a.types.forEach((t, i) => { if (engine.types[i] !== t) engine.setType(i, t); });
  a.params.forEach((pr, i) => Object.entries(pr).forEach(([id, v]) => { if (id in engine.voices[i].params) engine.setParam(i, id, v); }));
  a.enabled.forEach((on, i) => engine.setEnabled(i, on)); a.levels.forEach((v, i) => engine.setLevel(i, v)); engine.setSolo(a.solo);
  a.eq.forEach((v, b) => engine.setEq(b, v));
  a.vOct.forEach((v, i) => { engine.vOct[i] = v; }); a.vTune.forEach((v, i) => { engine.vTune[i] = v; });
  a.vEq.forEach((pair, i) => pair.forEach((v, b) => engine.setVoiceEq(i, b, v)));
  setPad(a.xy[0], a.xy[1]);
  Object.assign(globals, sn.globals); applyGlobals();
  fxCtl = sn.ctl; warpIdx = sn.warp || 0;
  if (sn.ctrl) { ctrl = mergeCtrl(ctrlDefault(), sn.ctrl); saveCtrl(); }
  if (sn.assign) { assign = JSON.parse(JSON.stringify(sn.assign)); saveAssign(); }
  if (sn.route) engine.fx.route(sn.route);
  sn.fx.forEach((x, j) => {
    const sec = fxSecs[j]; if (!sec) return;
    const slot = sec.slot;
    if (slot.style !== x.style) slot.setStyle(x.style);
    slot.values = x.values.map((o) => ({ ...o })); slot.refresh(); slot.setBypass(x.bypass);
    sec.sec.classList.toggle('off', x.bypass); sec.render();
  });
  el('bpm-v').textContent = engine.bpm;
  renderSub(); renderPanel();
}
let hist = [], histIdx = -1, commitTimer = 0;
function pushHistory() {
  const sn = snapshot(), last = hist[histIdx];
  if (last && JSON.stringify(last) === JSON.stringify(sn)) return;
  hist = hist.slice(0, histIdx + 1); hist.push(sn); if (hist.length > 60) hist.shift();
  histIdx = hist.length - 1; updateBar();
}
function commitSoon() { clearTimeout(commitTimer); commitTimer = setTimeout(pushHistory, 350); }
function flushCommit() { if (commitTimer) { clearTimeout(commitTimer); commitTimer = 0; pushHistory(); } }
function updateBar() { el('undo').disabled = histIdx <= 0; el('redo').disabled = histIdx >= hist.length - 1; }
function stepHistory(d) {
  flushCommit();
  const ni = histIdx + d; if (ni < 0 || ni >= hist.length) return;
  histIdx = ni; restore(hist[histIdx]); updateBar(); toast(d < 0 ? 'COFNIĘTO' : 'PONOWIONO');
}
el('undo').addEventListener('click', () => stepHistory(-1));
el('redo').addEventListener('click', () => stepHistory(1));

const PRESET_KEY = 'radarxxx.presets.v1';
const loadPresets = () => { try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '[]'); } catch { return []; } };
const storePresets = (list) => { try { localStorage.setItem(PRESET_KEY, JSON.stringify(list)); return true; } catch { return false; } };
el('save').addEventListener('click', () => {
  flushCommit();
  const list = loadPresets(), n = list.reduce((m, p) => Math.max(m, p.n), 0) + 1, name = `PRESET ${String(n).padStart(2, '0')}`;
  list.push({ n, name, t: Date.now(), snap: snapshot() });
  toast(storePresets(list) ? `ZAPISANO: ${name}` : 'NIE UDAŁO SIĘ ZAPISAĆ');
});
el('rec').addEventListener('click', () => toast('NAGRYWANIE: W PRZYGOTOWANIU'));

// ---------- menu ----------
const menuPop = el('menu-pop');
function renderMenu(view = 'main') {
  const body = el('menu-body'), row = (txt, fn, dim) => { const r = document.createElement('div'); r.className = 'mrow' + (dim ? ' dim' : ''); const b = document.createElement('button'); b.textContent = txt; if (fn) b.addEventListener('click', fn); r.appendChild(b); body.appendChild(r); return r; };
  body.innerHTML = '';
  if (view === 'main') {
    row(`PRESETY (${loadPresets().length}) ›`, () => renderMenu('presets'));
    row(`EFEKT KINESKOPU: ${crtOn ? 'WŁ.' : 'WYŁ.'}`, () => { setCrt(!crtOn); renderMenu('main'); });
    row('USTAWIENIA MIDI (WKRÓTCE)', null, true);
    row('NAGRANIA (WKRÓTCE)', null, true);
  } else {
    row('‹ WSTECZ', () => renderMenu('main'));
    const list = loadPresets();
    if (!list.length) { const m = document.createElement('div'); m.className = 'msub'; m.textContent = 'BRAK PRESETÓW. UŻYJ SAVE.'; body.appendChild(m); }
    list.slice().reverse().forEach((p) => {
      const r = row(`${p.name}`, () => { flushCommit(); restore(p.snap); pushHistory(); showMenu(false); toast(`WCZYTANO: ${p.name}`); });
      const x = document.createElement('button'); x.className = 'x'; x.textContent = '×'; x.setAttribute('aria-label', `Usuń ${p.name}`);
      x.addEventListener('click', () => { storePresets(loadPresets().filter((q) => q.n !== p.n)); renderMenu('presets'); });
      r.appendChild(x);
    });
  }
}
const showMenu = (on) => { menuPop.hidden = !on; if (on) { renderMenu('main'); el('menu-ok').focus(); } };
el('menu-open').addEventListener('click', () => showMenu(true));
el('menu-ok').addEventListener('click', () => showMenu(false));
menuPop.addEventListener('pointerdown', (e) => { if (e.target === menuPop) showMenu(false); });

// ---------- akcje ----------
const between = (a, b) => a + Math.random() * (b - a);
const MODE_CYCLE = ['electro', 'phrygian', 'minor'];
const MODE_LABEL = { electro: 'ELEKTRO', phrygian: 'FRYG', minor: 'MOLL' };
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ROOT_MIN = 24, ROOT_MAX = 59;                           // tonika od C1 do B3 (36 półtonów)
const rootParts = () => ({ pc: effRoot() % 12, oct: Math.floor(effRoot() / 12) - 1 });
const baseLabel = () => { const r = rootParts(); return `${NOTE_NAMES[r.pc]}${r.oct}`; };
const wrapRoot = (r) => (r > ROOT_MAX ? r - 36 : r < ROOT_MIN ? r + 36 : r);   // zawijanie w całym zakresie, nuta zostaje
const refin = () => { pattern = finalize(pattern); engine.pattern = pattern; };
// Zmiana nuty bazowej działa na żywo: wzór (stopnie skali) zostaje, zmienia się tylko wysokość toniki. Słychać ją od razu.
function setRoot(r) { state.root = r; refin(); engine.audition({ degree: 0, octave: 0, vel: 100 }); }
const WARP_OPS = [['OBRÓT', (st) => rotateSteps(st, 1)], ['ODBICIE', invertSteps], ['WSPAK', reverseSteps]];
let warpIdx = 0;
const actions = {
  base: (dir) => setRoot(wrapRoot(state.root + dir)),            // transpozycja o półton
  key: (dir = 1) => { const n = MODE_CYCLE.length; state.mode = MODE_CYCLE[(MODE_CYCLE.indexOf(state.mode) + dir + n) % n]; pattern = { ...pattern, mode: state.mode }; engine.pattern = pattern; },
  // RANDOM: nowy wzór z losową gęstością i synkopą w rozsądnych granicach (swing i nuta bazowa zostają).
  random: () => { state.seed = (Math.random() * 1e9) | 0; state.density = between(0.3, 0.7); state.syncopation = between(0.25, 0.75); regen(); },
  // MUTATE: losuje ustawienia syntezatorów (parametry i obwiednie włączonych silników, w rozsądnych granicach) i zmienia wysokość kilku nut.
  // Oprócz brzmienia zmienia też wysokości: około 40% nut (3 do 8) dostaje nowy dźwięk z palety wzoru (albo o 1-2 stopnie skali obok).
  mut: () => {
    engine.enabled.forEach((on, i) => { if (on) engine.randomizeVoice(i); });
    const want = Math.max(3, Math.min(8, Math.round(pattern.steps.filter((x) => x.on).length * 0.4)));   // ok. 40% nut wzoru, od 3 do 8
    const diffs = (a, b) => a.steps.reduce((n, x, i) => n + (x.on && x.degree !== b.steps[i].degree ? 1 : 0), 0);
    let p = pattern, changed = 0;
    for (let t = 0; t < 120 && changed < want; t++) { p = mutate(p, Math.random, 'pitch'); changed = diffs(pattern, p); }   // liczymy nuty, które faktycznie zmieniły wysokość
    if (changed) { pattern = finalize(p); engine.pattern = pattern; }
    renderPanel();
  },
  latch: () => { state.latch = !state.latch; engine.latch = state.latch; toast(state.latch ? 'LATCH: WŁ.' : 'LATCH: WYŁ.'); },
  // WARP: kolejne dotknięcia przekształcają wzór: obrót o krok, odbicie wysokości, odwrócenie kolejności
  warp: () => { const [name, fn] = WARP_OPS[warpIdx % WARP_OPS.length]; warpIdx++; setSteps(fn(pattern.steps)); toast(`WARP: ${name}`); },
  steps: (fn, name) => () => { setSteps(fn(pattern.steps)); if (name) toast(name); },
};
let wake = null;
async function lockScreen() { try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch { /* odmowa */ } }
function unlockScreen() { try { if (wake) wake.release(); } catch { /* nic */ } wake = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && engine.playing) lockScreen(); });
// Przycisk start/stop rysowany jako SVG (a nie znakiem z czcionki): kwadrat = stop (gra), trójkąt = play (stoi).
const GLYPH_STOP = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" fill="currentColor"/></svg>';
const GLYPH_PLAY = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 1.5v13l11-6.5z" fill="currentColor"/></svg>';
function showPlayState() { el('play').innerHTML = engine.playing ? GLYPH_STOP : GLYPH_PLAY; el('play').classList.toggle('on', engine.playing); el('play').setAttribute('aria-label', engine.playing ? 'stop' : 'play'); }
function togglePlay() {
  if (engine.playing) { engine.stop(); unlockScreen(); } else { engine.play(); lockScreen(); }
  showPlayState();
}
const setBpm = (v) => { engine.setBpm(Math.max(70, Math.min(180, Math.round(v)))); el('bpm-v').textContent = engine.bpm; };
// Tempo: ikona nutki otwiera okienko z dużą wartością i przyciskami − / + (przytrzymanie powtarza).
const bpmPop = el('bpm-pop');
const showBpm = (on) => { bpmPop.hidden = !on; if (on) el('bpm-ok').focus(); else commitSoon(); };
el('bpm-open').addEventListener('click', () => showBpm(true));
el('bpm-ok').addEventListener('click', () => showBpm(false));
bpmPop.addEventListener('pointerdown', (e) => { if (e.target === bpmPop) showBpm(false); });
function holdRepeat(btn, step) {
  let t = 0, iv = 0;
  const stop = () => { clearTimeout(t); clearInterval(iv); };
  btn.addEventListener('pointerdown', () => { setBpm(engine.bpm + step); t = setTimeout(() => { iv = setInterval(() => setBpm(engine.bpm + step), 70); }, 400); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, stop));
  btn.addEventListener('click', (e) => { if (e.detail === 0) setBpm(engine.bpm + step); });   // klawiatura (Enter / spacja)
}
holdRepeat(el('bpm-'), -1); holdRepeat(el('bpm+'), 1);
el('bpm-5').addEventListener('click', () => setBpm(engine.bpm - 5));
el('bpm+5').addEventListener('click', () => setBpm(engine.bpm + 5));
el('play').addEventListener('click', togglePlay);

// ---------- FX: sekcje filtra i efektu (pokrętła budowane raz, pokazywane na zakładkach FLT i FX) ----------
const fxSecs = [];
const fxMainRefs = {};
const short8 = (t) => (t.length > 8 ? `${t.slice(0, 7)}.` : t);
// Nazwy pokręteł mieszczą się nad pokrętłem (najwyżej 8 znaków): znane długie nazwy mają własne skróty, reszta jest ucinana z kropką.
const LABELS = { 'PING-PONG': 'PINGPONG', 'MOD TEMPO': 'M.TEMPO', 'MOD GŁĘBIA': 'M.GŁĘB.', 'LFO TEMPO': 'LFO TEM.', 'LFO GŁĘBIA': 'LFO GŁ.', 'LFO KSZT.': 'LFO KSZ.',
  'OPÓŹNIENIE': 'OPÓŹN.', 'TŁUMIENIE': 'TŁUM.', 'SZEROKOŚĆ': 'SZEROK.', 'ASYMETRIA': 'ASYM.', 'HP CZĘST.': 'HP CZĘS.', 'LP CZĘST.': 'LP CZĘS.', 'TRYB LP-HP': 'TRYB' };
const knobLabel = (t) => { const u = String(t).toUpperCase(); return LABELS[u] || short8(u); };
function buildFx() {
  [[engine.fx.filter, FILTER_STYLES], [engine.fx.fx, FX_STYLES], [engine.fx.fx2, FX_STYLES]].forEach(([slot, styles], j) => {
    const sec = document.createElement('section');
    sec.className = 'fxsec';
    const grid = document.createElement('div'); grid.className = 'pgrid'; sec.appendChild(grid);
    let refs = {};
    const entry = {
      slot, styles, sec, render,
      get refs() { return refs; },
      randomize() { const v = slot.randomize(); for (const [id, n] of Object.entries(v)) if (refs[id]) refs[id].value = n; },
    };
    function render() {
      grid.innerHTML = ''; refs = {};
      for (const sp of styles[slot.style].params) {
        const k = document.createElement('div');
        makeKnob(k, { label: knobLabel(sp.label), min: 0, max: 1, step: 0.001, value: slot.values[slot.style][sp.id], def: sp.def, show: (n) => sp.show(sp.map(n)) });
        k.addEventListener('input', () => slot.setParam(sp.id, k.value));
        grid.appendChild(k); refs[sp.id] = k;
      }
      const used = styles[slot.style].params.length;
      for (let i = used; i < 8; i++) { const sp = document.createElement('div'); sp.className = 'spacer'; grid.appendChild(sp); }
      cellButton(grid, { kind: 'act', label: () => short8(styles[slot.style].name.toUpperCase()), act: () => { slot.setStyle((slot.style + 1) % styles.length); render(); } });
      cellButton(grid, { kind: 'act', label: () => 'RANDOM', act: () => entry.randomize() });
    }
    fxSecs.push(entry);
    render();
  });
}
function cycleStyle(j) { const s = fxSecs[j]; s.slot.setStyle((s.slot.style + 1) % s.styles.length); s.render(); if (page === 'fx') renderPanel(); }
function bypass(j) { const s = fxSecs[j]; s.slot.setBypass(!s.slot.bypass); s.sec.classList.toggle('off', s.slot.bypass); }
const fxStyleTarget = () => (tabSel.fx === 2 ? 1 : tabSel.fx === 3 ? 2 : 0);

// ---------- elementy siatki ----------
const synRefs = {}, macroRefs = {};
function synKnob(label, min, max, step, value, def, onInput) {
  const k = document.createElement('div');
  makeKnob(k, { label: knobLabel(label), min, max, step, value, def, fmt: 'num' });
  k.addEventListener('input', () => onInput(k.value));
  return k;
}
// Ikony przycisków narzędzi wzoru (zakładka SEQ): proste piktogramy w duchu OP-1 i Elektrona, siatka 24 px, kreska 2 px, ostre rogi.
const ICONS = {
  clear: '<rect x="4" y="4" width="16" height="16"/><path d="M8 8l8 8M16 8l-8 8"/>',
  reverse: '<path d="M11 5v14L3 12z" fill="currentColor"/><path d="M21 5v14l-8-7z" fill="currentColor"/>',
  invert: '<path d="M12 3l7 7H5z" fill="currentColor"/><path d="M12 21l-7-7h14z"/><path d="M2 12h20" stroke-dasharray="2 3"/>',
  rotl: '<path d="M3 5h4v4H3zM10 5h4v4h-4zM17 5h4v4h-4z" fill="currentColor"/><path d="M20 17H5M9 13l-4 4 4 4"/>',
  rotr: '<path d="M3 5h4v4H3zM10 5h4v4h-4zM17 5h4v4h-4z" fill="currentColor"/><path d="M4 17h15M15 13l4 4-4 4"/>',
  double: '<rect x="3" y="8" width="12" height="12"/><rect x="9" y="4" width="12" height="12" fill="var(--paper)"/>',
  half: '<rect x="3" y="6" width="18" height="12"/><rect x="3" y="6" width="9" height="12" fill="currentColor"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

// Okrągły przycisk z nazwą nad nim. kind: 'act' (pomarańczowy, jednorazowy) albo 'tog' (zapalony = włączony).
function cellButton(parent, { kind, label, on, act, icon: ic }) {
  const c = document.createElement('div'), b = document.createElement('button'), l = document.createElement('span');
  c.className = `cellbtn ${ic ? 'ico' : kind === 'tog' ? 'tog' : 'act'}`; if (ic) b.innerHTML = icon(ic); l.className = 'cl'; c.appendChild(l); c.appendChild(b);
  const refresh = () => { l.textContent = label(); b.setAttribute('aria-label', label()); if (kind === 'tog') c.classList.toggle('on', !!on()); };
  b.addEventListener('click', () => { act(); refresh(); commitSoon(); });
  refresh(); parent.appendChild(c); return c;
}
const spacer = (parent) => { const d = document.createElement('div'); d.className = 'spacer'; parent.appendChild(d); };
// Wiersz „nazwa − wartość +” (zakładka SCALE).
function stepRow(parent, name, value, minus, plus) {
  const r = document.createElement('div'); r.className = 'steprow';
  r.innerHTML = `<span>${name}</span><button aria-label="mniej">−</button><b></b><button aria-label="więcej">+</button>`;
  const v = r.querySelector('b'), [bm, bp] = r.querySelectorAll('button');
  const upd = () => { v.textContent = value(); };
  bm.addEventListener('click', () => { minus(); upd(); commitSoon(); }); bp.addEventListener('click', () => { plus(); upd(); commitSoon(); });
  upd(); parent.appendChild(r);
}


// ============================================================================
// Tryb CONTROLLER: zestaw dwóch kontrolerów zamiast siatki pokręteł (przełącznik MODE w zakładkach).
// Każdy z dwóch boksów to jeden z typów: XY PAD (oś X steruje dwoma parametrami, oś Y dwoma innymi), 4 PRZYCISKI, 4 SUWAKI albo PITCH + MOD.
// Co steruje czym, wybiera się w okienku EDIT.
// ============================================================================
// Kontrolery to ostatnia zakładka każdej strony (CTRL).
const isCtl = () => tabSel[page] === tabNames(page).length - 1;
const lin2 = (n, a, b) => a + n * (b - a);
// TEMPO to mnożnik tempa wyznaczonego w oknie tempa: ½×, ⅔×, ¾×, 1×, 4⁄3×, 1,5× i 2× (krokowo, zawsze w prostej relacji do tempa)
// Przesunięcie wzoru wysyłanego do silników względem silnika 1: ułamki całej nuty (1/16 = jeden krok), od 0 do 1/2
const OFFSETS = [[0, '0'], [1, '1/16'], [4 / 3, '1/12'], [2, '1/8'], [8 / 3, '1/6'], [4, '1/4'], [8, '1/2']];
const offIdx = (n) => Math.max(0, Math.min(OFFSETS.length - 1, Math.round(n * (OFFSETS.length - 1))));
const offN = (i) => () => { const k = OFFSETS.findIndex(([v]) => Math.abs(v - engine.vOff[i]) < 1e-6); return (k < 0 ? 0 : k) / (OFFSETS.length - 1); };
const offSet = (i) => (n) => { const [v, t] = OFFSETS[offIdx(n)]; if (v !== engine.vOff[i]) { engine.vOff[i] = v; toast(`SILNIK ${i + 1}: ${t === '0' ? 'BEZ PRZESUNIĘCIA' : `+${t}`}`); } };
const TEMPO_MULS = [[0.5, '½×'], [2 / 3, '⅔×'], [0.75, '¾×'], [1, '1×'], [4 / 3, '4⁄3×'], [1.5, '1,5×'], [2, '2×']];
const tempoIdx = (n) => Math.max(0, Math.min(TEMPO_MULS.length - 1, Math.round(n * (TEMPO_MULS.length - 1))));
const tempoN = () => { const i = TEMPO_MULS.findIndex(([m]) => Math.abs(m - engine.tempoMul) < 1e-6); return (i < 0 ? 3 : i) / (TEMPO_MULS.length - 1); };
const envAll = (id) => (n) => { const sp = specOfType(engine.types[0], id); const v = Math.round(lin2(n, sp.min, sp.max) / sp.step) * sp.step; VOICE_NAMES.forEach((_, i) => engine.setParam(i, id, v)); };
const fxIdx = (j, idx) => (n) => { const sec = fxSecs[j], sp = sec.styles[sec.slot.style].params[idx]; if (sp) setFxParam(sec, sp.id, n); };
const offsetT = (key) => (n) => { engine.p[key] = n * 2 - 1; };
const CONT = {
  cutoff: ['CUTOFF', (n) => { globals.cutoff = n; engine.setCutoff(cutoffHz(n)); }],
  reso: ['RESO', (n) => { globals.reso = n; engine.setResonance(1 + n * 22); }],
  fenv: ['F.ENV', envAll('fEnv')], fdec: ['F.ZAN.', envAll('fDec')], adec: ['A.ZAN.', envAll('aDec')], asus: ['A.SUST.', envAll('aSus')], aatk: ['A.ATAK', envAll('aAtk')], arel: ['A.REL.', envAll('aRel')],
  tune1: ['TUNE 1', (n) => { engine.vTune[0] = lin2(n, -100, 100); }], tune2: ['TUNE 2', (n) => { engine.vTune[1] = lin2(n, -100, 100); }], tune3: ['TUNE 3', (n) => { engine.vTune[2] = lin2(n, -100, 100); }], tune4: ['TUNE 4', (n) => { engine.vTune[3] = lin2(n, -100, 100); }],
  offfatk: ['F.ATK', offsetT('offFAtk')], offfrel: ['F.REL', offsetT('offFRel')], offaatk: ['A.ATK', offsetT('offAAtk')], offarel: ['A.REL', offsetT('offARel')],
  gate: ['GATE', (n) => { engine.gateMul = lin2(n, 0.4, 1.6); }],
  accent: ['ACCENT', (n) => { state.accent = n; refin(); }],
  slide: ['SLIDE', (n) => { state.slide = n; refin(); }],
  swing: ['SWING', (n) => { state.swing = lin2(n, 0, 0.4); pattern = { ...pattern, swing: state.swing }; engine.pattern = pattern; }],
  human: ['HUMAN', (n) => { engine.human = n; }], ghost: ['GHOST', (n) => { engine.ghost = n; }], velo: ['VELO', (n) => { engine.velo = lin2(n, 0.4, 1); }],
  glide: ['GLIDE', (n) => { glideMs = n * 200; setGlideTime(glideMs / 1000); }],
  tempo: ['TEMPO', (n) => { const i = tempoIdx(n), [m, t] = TEMPO_MULS[i]; if (m !== engine.tempoMul) { engine.setTempoMul(m); toast(`TEMPO ${t}`); } }],
  master: ['MASTER', (n) => { globals.master = lin2(n, 0, 1.2); engine.setMaster(globals.master); }],
  comp: ['COMP', (n) => { globals.comp = n; engine.setComp(n); }], mdrive: ['DRIVE', (n) => { globals.mdrive = n; engine.setDrive(n); }],
  eqlow: ['EQ LOW', (n) => engine.setEq(0, lin2(n, -12, 12))], eqmid: ['EQ MID', (n) => engine.setEq(1, lin2(n, -12, 12))], eqhigh: ['EQ HIGH', (n) => engine.setEq(2, lin2(n, -12, 12))],
  fmix: ['FLT MIX', (n) => setFxParam(fxSecs[0], 'mix', n)], fx1mix: ['FX1 MIX', (n) => setFxParam(fxSecs[1], 'mix', n)], fx2mix: ['FX2 MIX', (n) => setFxParam(fxSecs[2], 'mix', n)],
  djf: ['DJ FLT', (n) => { globals.dj = n * 2 - 1; engine.setDj(globals.dj); }], tape: ['TAPE', (n) => { globals.tape = n; engine.setTape(n); }], wow: ['WOW', (n) => { globals.wow = n; engine.setWow(n); }], chorusm: ['CHORUS', (n) => { globals.chorus = n; engine.setChorus(n); }],
  padx: ['PAD X', (n) => setPad(n, padPos.y)], pady: ['PAD Y', (n) => setPad(padPos.x, n)],
  lv1: ['LEVEL 1', (n) => engine.setLevel(0, n * 1.5)], lv2: ['LEVEL 2', (n) => engine.setLevel(1, n * 1.5)], lv3: ['LEVEL 3', (n) => engine.setLevel(2, n * 1.5)], lv4: ['LEVEL 4', (n) => engine.setLevel(3, n * 1.5)],
};

// Parametry sekcji FX: osiem na filtr i na każdy z efektów, nazwa zależy od wybranego stylu (np. „FLT CUTOFF”).
[['flt', 0, 'FLT'], ['fx1p', 1, 'FX1'], ['fx2p', 2, 'FX2']].forEach(([pre, j, nm]) => {
  for (let i = 0; i < 8; i++) CONT[`${pre}${i + 1}`] = [() => { const sp = fxSecs[j] && fxSecs[j].styles[fxSecs[j].slot.style].params[i]; return sp ? `${nm} ${knobLabel(sp.label)}` : `${nm} P${i + 1}`; }, fxIdx(j, i)];
});
// MIX: oktawa i EQ każdego silnika
for (let i = 0; i < 4; i++) {
  CONT[`oct${i + 1}`] = [`OCT ${i + 1}`, (n) => { engine.vOct[i] = Math.round(lin2(n, -2, 2)); }];
  CONT[`vlo${i + 1}`] = [`LOW ${i + 1}`, (n) => engine.setVoiceEq(i, 0, lin2(n, -12, 12))];
  CONT[`vhi${i + 1}`] = [`HIGH ${i + 1}`, (n) => engine.setVoiceEq(i, 1, lin2(n, -12, 12))];
}
// SEQ: te, których brakowało (oktawa, shift, długość wzoru)
CONT.ofs1 = ['OFS 1', offSet(0)]; CONT.ofs2 = ['OFS 2', offSet(1)]; CONT.ofs3 = ['OFS 3', offSet(2)]; CONT.ofs4 = ['OFS 4', offSet(3)];
CONT.oct = ['OKTAWA', (n) => { state.oct = Math.round(lin2(n, -2, 2)); refin(); }];
CONT.shift = ['SHIFT', (() => { let last = 0; return (n) => { const v = Math.round(lin2(n, -4, 4)); const d = v - last; last = v; if (d) setSteps(rotateSteps(pattern.steps, d)); }; })()];
CONT.length = ['LENGTH', (n) => { const len = 8 + 4 * Math.round(n * 6); if (len !== pattern.steps.length) setSteps(resizeSteps(pattern.steps, len)); }];
const SW = {
  fbyp: ['FLT BYP', () => fxSecs[0].slot.bypass, () => bypass(0)], f1byp: ['FX1 BYP', () => fxSecs[1].slot.bypass, () => bypass(1)], f2byp: ['FX2 BYP', () => fxSecs[2].slot.bypass, () => bypass(2)],
  latch: ['LATCH', () => state.latch, actions.latch],
  mute1: ['MUTE 1', () => !engine.enabled[0], () => engine.setEnabled(0, !engine.enabled[0])], mute2: ['MUTE 2', () => !engine.enabled[1], () => engine.setEnabled(1, !engine.enabled[1])],
  mute3: ['MUTE 3', () => !engine.enabled[2], () => engine.setEnabled(2, !engine.enabled[2])], mute4: ['MUTE 4', () => !engine.enabled[3], () => engine.setEnabled(3, !engine.enabled[3])],
  solo1: ['SOLO 1', () => engine.solo === 0, () => engine.setSolo(engine.solo === 0 ? null : 0)], solo2: ['SOLO 2', () => engine.solo === 1, () => engine.setSolo(engine.solo === 1 ? null : 1)],
  solo3: ['SOLO 3', () => engine.solo === 2, () => engine.setSolo(engine.solo === 2 ? null : 2)], solo4: ['SOLO 4', () => engine.solo === 3, () => engine.setSolo(engine.solo === 3 ? null : 3)],
  rndeng: ['RND ENG', () => false, () => engine.enabled.forEach((on, i) => { if (on) engine.randomizeVoice(i); })], rndsyn: ['RND SYN', () => false, () => engine.enabled.forEach((on, i) => { if (on) engine.randomizeVoice(i); })],
  rndfx: ['RND FX', () => false, () => fxSecs.slice(0, 2).forEach((x) => x.randomize())],
  route: ['ROUTING', () => false, () => { const k = PERMS.findIndex((p) => p.join() === engine.fx.order.join()); engine.fx.route(PERMS[(k + 1) % PERMS.length]); toast(routeText()); }],
  clear: ['CLEAR', () => false, actions.steps(clearSteps)], double: ['DOUBLE', () => false, actions.steps(doubleSteps)], half: ['HALF', () => false, actions.steps(halveSteps)],
  basem: ['BASE −', () => false, () => actions.base(-1)], basep: ['BASE +', () => false, () => actions.base(1)], keyn: ['KEY', () => false, () => { actions.key(1); toast(MODE_LABEL[state.mode]); }],
  type1: ['TYPE 1', () => false, () => engine.setType(0, (engine.types[0] + 1) % SHORT.length)], type2: ['TYPE 2', () => false, () => engine.setType(1, (engine.types[1] + 1) % SHORT.length)],
  type3: ['TYPE 3', () => false, () => engine.setType(2, (engine.types[2] + 1) % SHORT.length)], type4: ['TYPE 4', () => false, () => engine.setType(3, (engine.types[3] + 1) % SHORT.length)],
  dotmode: [() => state.mixMode.toUpperCase(), () => state.mixMode === 'solo', () => { state.mixMode = state.mixMode === 'solo' ? 'mute' : 'solo'; }],
  random: ['RANDOM', () => false, actions.random], mutate: ['MUTATE', () => false, actions.mut], warp: ['WARP', () => false, actions.warp],
  reverse: ['REVERSE', () => false, actions.steps(reverseSteps)], invert: ['INVERT', () => false, actions.steps(invertSteps)],
  rotl: ['ROT ←', () => false, actions.steps((st) => rotateSteps(st, -1))], rotr: ['ROT →', () => false, actions.steps((st) => rotateSteps(st, 1))],
};

// Odczyt aktualnej wartości (0..1) każdego celu: pokrętła i suwaki przypisywalnych zakładek pokazują stan, nie tylko go ustawiają.
const envN = (id) => () => { const sp = specOfType(engine.types[0], id); return clamp01((engine.voices[0].params[id] - sp.min) / (sp.max - sp.min)); };
const fxN = (j, i) => () => { const sec = fxSecs[j], sp = sec && sec.styles[sec.slot.style].params[i]; return sp ? sec.slot.values[sec.slot.style][sp.id] : 0; };
const mixN = (j) => () => { const sec = fxSecs[j]; return sec ? (sec.slot.values[sec.slot.style].mix ?? 0) : 0; };
const CONTG = {
  cutoff: () => globals.cutoff, reso: () => globals.reso,
  fenv: envN('fEnv'), fdec: envN('fDec'), adec: envN('aDec'), asus: envN('aSus'), aatk: envN('aAtk'), arel: envN('aRel'),
  offfatk: () => (engine.p.offFAtk + 1) / 2, offfrel: () => (engine.p.offFRel + 1) / 2, offaatk: () => (engine.p.offAAtk + 1) / 2, offarel: () => (engine.p.offARel + 1) / 2,
  gate: () => (engine.gateMul - 0.4) / 1.2, accent: () => state.accent, slide: () => state.slide, swing: () => state.swing / 0.4,
  human: () => engine.human, ghost: () => engine.ghost, velo: () => (engine.velo - 0.4) / 0.6, glide: () => glideMs / 200, tempo: tempoN,
  master: () => globals.master / 1.2, comp: () => globals.comp, mdrive: () => globals.mdrive,
  eqlow: () => (engine.eq[0] + 12) / 24, eqmid: () => (engine.eq[1] + 12) / 24, eqhigh: () => (engine.eq[2] + 12) / 24,
  fmix: mixN(0), fx1mix: mixN(1), fx2mix: mixN(2),
  djf: () => (globals.dj + 1) / 2, tape: () => globals.tape, wow: () => globals.wow, chorusm: () => globals.chorus,
  padx: () => padPos.x, pady: () => padPos.y,
  ofs1: offN(0), ofs2: offN(1), ofs3: offN(2), ofs4: offN(3),
  oct: () => (state.oct + 2) / 4, shift: () => 0.5, length: () => (pattern.steps.length - 8) / 24,
};
for (let i = 0; i < 4; i++) {
  CONTG[`lv${i + 1}`] = () => engine.levels[i] / 1.5; CONTG[`tune${i + 1}`] = () => (engine.vTune[i] + 100) / 200; CONTG[`oct${i + 1}`] = () => (engine.vOct[i] + 2) / 4;
  CONTG[`vlo${i + 1}`] = () => (engine.vEq[i][0] + 12) / 24; CONTG[`vhi${i + 1}`] = () => (engine.vEq[i][1] + 12) / 24;
}
[['flt', 0], ['fx1p', 1], ['fx2p', 2]].forEach(([pre, j]) => { for (let i = 0; i < 8; i++) CONTG[`${pre}${i + 1}`] = fxN(j, i); });
const CSTEP = { tempo: 1 / 6, ofs1: 1 / 6, ofs2: 1 / 6, ofs3: 1 / 6, ofs4: 1 / 6, oct: 0.25, shift: 0.125, length: 1 / 6, oct1: 0.25, oct2: 0.25, oct3: 0.25, oct4: 0.25 };      // wartości dyskretne
const TOGGLES = new Set(['dron', 'dsc', 'dm0', 'dm1', 'dm2', 'dm3', 'dm4', 'fbyp', 'f1byp', 'f2byp', 'latch', 'dotmode', 'mute1', 'mute2', 'mute3', 'mute4', 'solo1', 'solo2', 'solo3', 'solo4']);
const nameOfSW = (id) => { if (!SW[id]) return id; const l = SW[id][0]; return typeof l === 'function' ? l() : l; };

// DRUM: poziomy ścieżek, stroiki i zaniki, drive, sidechain i gęstość losowanych wzorów
const D = () => engine.drum;
CONT.dlevel = ['DRUMS', (n) => { D().level = n * 1.2; engine.applyDrum(); }];
CONT.dkick = ['KICK', (n) => { D().levels[0] = n; }]; CONT.dsnare = ['SNARE', (n) => { D().levels[1] = n; }]; CONT.dclap = ['CLAP', (n) => { D().levels[2] = n; }];
CONT.dhat = ['HAT', (n) => { D().levels[3] = n; }]; CONT.dopen = ['O.HAT', (n) => { D().levels[4] = n; }];
CONT.dkt = ['K.TUNE', (n) => { D().kt = lin2(n, 0.7, 1.4); }]; CONT.dkd = ['K.DEC', (n) => { D().kd = lin2(n, 0.5, 1.6); }];
CONT.dst = ['S.TUNE', (n) => { D().st = lin2(n, 0.7, 1.4); }]; CONT.dhd = ['H.DEC', (n) => { D().hd = lin2(n, 0.5, 1.8); }];
CONT.ddrive = ['D.DRIVE', (n) => { D().drive = n; engine.applyDrum(); }];
CONT.dscamt = ['SC AMT', (n) => { D().scAmt = n * 0.95; }]; CONT.dscrel = ['SC REL', (n) => { D().scRel = lin2(n, 0.04, 0.4); }];
CONT.ddens = ['DENS', (n) => { D().density = n; }];
Object.assign(CONTG, {
  dlevel: () => D().level / 1.2, dkick: () => D().levels[0], dsnare: () => D().levels[1], dclap: () => D().levels[2], dhat: () => D().levels[3], dopen: () => D().levels[4],
  dkt: () => (D().kt - 0.7) / 0.7, dkd: () => (D().kd - 0.5) / 1.1, dst: () => (D().st - 0.7) / 0.7, dhd: () => (D().hd - 0.5) / 1.3,
  ddrive: () => D().drive, dscamt: () => D().scAmt / 0.95, dscrel: () => (D().scRel - 0.04) / 0.36, ddens: () => D().density,
});

const drumToggle = (k) => () => { D().mute[k] = !D().mute[k]; };
Object.assign(SW, {
  dron: ['DRUMS', () => D().on, () => { D().on = !D().on; }],
  dsc: ['SIDECH.', () => D().sc, () => { D().sc = !D().sc; toast(D().sc ? 'SIDECHAIN: WŁ.' : 'SIDECHAIN: WYŁ.'); }],
  dkit: [() => DRUM_KITS[D().kit], () => false, () => { D().kit = (D().kit + 1) % DRUM_KITS.length; engine.auditionDrum(0); }],
  dstyle: [() => DRUM_STYLES[D().style], () => false, () => { D().style = (D().style + 1) % DRUM_STYLES.length; drumRandom(); }],
  drandom: ['RANDOM', () => false, () => drumRandom()], dclear: ['CLEAR', () => false, () => { engine.drumPattern = { ...engine.drumPattern, steps: emptyDrums() }; }],
  dm0: ['MUTE K', () => D().mute[0], drumToggle(0)], dm1: ['MUTE S', () => D().mute[1], drumToggle(1)], dm2: ['MUTE C', () => D().mute[2], drumToggle(2)],
  dm3: ['MUTE CH', () => D().mute[3], drumToggle(3)], dm4: ['MUTE OH', () => D().mute[4], drumToggle(4)],
});
const CTL_TYPES = { xy: 'XY PAD', pads: '4 PRZYCISKI', faders: '4 SUWAKI', wheels: 'PITCH + MOD' };
const CTL_KEY = 'radarxxx.ctrl.v2';
// Kontrolery (zakładka CTRL) sterują tylko tym, co jest w danej sekcji: każda strona ma własną listę parametrów, własne przełączniki i własne ustawienia.
const SECTION_CONT = {
  seq: ['cutoff', 'reso', 'offfatk', 'offfrel', 'offaatk', 'offarel', 'gate', 'accent', 'shift', 'oct', 'tempo', 'length', 'swing', 'human', 'ghost', 'slide', 'glide', 'velo', 'ofs1', 'ofs2', 'ofs3', 'ofs4'],
  mix: ['eqlow', 'eqmid', 'eqhigh', 'fx1mix', 'master', 'lv1', 'lv2', 'lv3', 'lv4', 'tune1', 'tune2', 'tune3', 'tune4', 'oct1', 'oct2', 'oct3', 'oct4', 'vlo1', 'vlo2', 'vlo3', 'vlo4', 'vhi1', 'vhi2', 'vhi3', 'vhi4', 'padx', 'pady'],
  syn: ['cutoff', 'reso', 'fenv', 'fdec', 'aatk', 'adec', 'asus', 'arel', 'lv1', 'lv2', 'lv3', 'lv4'],
  drum: ['dlevel', 'dkick', 'dsnare', 'dclap', 'dhat', 'dopen', 'dkt', 'dkd', 'dst', 'dhd', 'ddrive', 'dscamt', 'dscrel', 'ddens'],
  fx: [...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `flt${i}`), ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `fx1p${i}`), ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `fx2p${i}`), 'djf', 'tape', 'wow', 'chorusm', 'master', 'comp', 'mdrive'],
};
const SECTION_SW = {
  seq: ['latch', 'random', 'mutate', 'warp', 'reverse', 'invert', 'rotl', 'rotr', 'double', 'half', 'clear', 'basem', 'basep', 'keyn'],
  mix: ['fbyp', 'dotmode', 'mute1', 'mute2', 'mute3', 'mute4', 'solo1', 'solo2', 'solo3', 'solo4', 'type1', 'type2', 'type3', 'type4', 'rndeng'],
  syn: ['rndsyn', 'mute1', 'mute2', 'mute3', 'mute4', 'solo1', 'solo2', 'solo3', 'solo4'],
  fx: ['fbyp', 'f1byp', 'f2byp', 'route', 'rndfx'],
  drum: ['dron', 'dsc', 'dkit', 'dstyle', 'drandom', 'dclear', 'dm0', 'dm1', 'dm2', 'dm3', 'dm4'],
};
const ctrlDefault = () => ({
  seq: { left: 'xy', right: 'pads', xy: ['cutoff', 'offfrel', 'reso', 'offarel'], pads: ['latch', 'warp', 'mutate', 'random'], faders: ['cutoff', 'reso', 'gate', 'accent'], mod: 'cutoff' },
  mix: { left: 'xy', right: 'faders', xy: ['eqlow', 'eqmid', 'eqhigh', 'fx1mix'], pads: ['solo1', 'solo2', 'solo3', 'solo4'], faders: ['lv1', 'lv2', 'lv3', 'lv4'], mod: 'eqhigh' },
  syn: { left: 'xy', right: 'faders', xy: ['cutoff', 'fenv', 'reso', 'fdec'], pads: ['rndsyn', 'mute1', 'mute2', 'solo1'], faders: ['cutoff', 'reso', 'fenv', 'fdec'], mod: 'cutoff' },
  drum: { left: 'xy', right: 'pads', xy: ['dkt', 'dkd', 'dscamt', 'dscrel'], pads: ['dsc', 'dkit', 'dstyle', 'drandom'], faders: ['dkick', 'dsnare', 'dhat', 'dlevel'], mod: 'ddrive' },
  fx: { left: 'xy', right: 'pads', xy: ['fmix', 'fx1mix', 'flt1', 'fx1p1'], pads: ['fbyp', 'f1byp', 'f2byp', 'route'], faders: ['djf', 'tape', 'wow', 'chorusm'], mod: 'djf' },
});
const mergeCtrl = (base, sv) => { const out = {}; for (const p of Object.keys(base)) out[p] = { ...base[p], ...((sv && sv[p]) || {}) }; return out; };
let ctrl = ctrlDefault();
try { const sv = JSON.parse(localStorage.getItem(CTL_KEY) || 'null'); if (sv) ctrl = mergeCtrl(ctrl, sv); } catch { /* brak zapisu */ }
const saveCtrl = () => { try { localStorage.setItem(CTL_KEY, JSON.stringify(ctrl)); } catch { /* brak pamięci */ } };
const C = () => ctrl[page];
const ctrlVals = { x: 0.5, y: 0.5, faders: [0.5, 0.5, 0.5, 0.5], pitch: 0.5, mod: 0 };

// pionowy suwak: value 0..1 od dołu; spring = wraca na środek po puszczeniu (pitch bend); bipolar = bez wypełnienia
function vSlider({ label, value, onInput, spring, rest = 0.5, compact }) {
  const el0 = document.createElement('div'); el0.className = `vs${spring ? ' spring' : ''}${spring && rest === 0.5 ? ' bipolar' : ''}${compact ? ' cmp' : ''}`;
  el0.innerHTML = '<div class="vt"><div class="vf"></div><div class="vk"></div></div><span class="vl"></span>';
  const t = el0.querySelector('.vt'), f = el0.querySelector('.vf'), k = el0.querySelector('.vk'), l = el0.querySelector('.vl');
  const setLabel = (t) => { l.textContent = ''; String(t).split(' ').forEach((part, i, arr) => { l.appendChild(document.createTextNode(part)); if (i < arr.length - 1 && (i === 0)) l.appendChild(document.createElement('br')); else if (i < arr.length - 1) l.appendChild(document.createTextNode(' ')); }); };
  setLabel(label);
  let v = value; const paint = () => { f.style.height = `${v * 100}%`; k.style.top = `${(1 - v) * 100}%`; }; paint();
  const say = (r) => { if (typeof r === 'string') setLabel(r || label); };      // onInput może zwrócić nowy podpis (np. długość pętli)
  const from = (e) => { const r = t.getBoundingClientRect(); v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)); paint(); say(onInput(v)); };
  el0.setValue = (nv) => { v = nv; paint(); };                           // ustawienie z kodu (odświeżenie), bez zdarzenia
  let on = false;
  el0.addEventListener('pointerdown', (e) => { on = true; el0.classList.add('hold'); el0.setPointerCapture(e.pointerId); from(e); });
  el0.addEventListener('pointermove', (e) => { if (on) from(e); });
  const end = () => { if (!on) return; on = false; el0.classList.remove('hold'); if (spring) { v = rest; paint(); say(onInput(rest)); } else commitSoon(); };
  el0.addEventListener('pointerup', end); el0.addEventListener('pointercancel', end);
  return el0;
}
const nameOfC = (id) => { if (!CONT[id]) return id; const l = CONT[id][0]; return typeof l === 'function' ? l() : l; };
function buildXY(box) {
  box.classList.add('xy');
  box.innerHTML = '<div class="hx"></div><div class="hy"></div><div class="puck"></div><span class="cname"></span>';
  const puck = box.querySelector('.puck'), hx = box.querySelector('.hx'), hy = box.querySelector('.hy');
  box.querySelector('.cname').innerHTML = `X ${nameOfC(C().xy[0])}·${nameOfC(C().xy[1])}<br>Y ${nameOfC(C().xy[2])}·${nameOfC(C().xy[3])}`;   // dwie linie: oś X i oś Y
  const paint = () => { puck.style.left = `${ctrlVals.x * 100}%`; puck.style.top = `${(1 - ctrlVals.y) * 100}%`; hx.style.top = `${(1 - ctrlVals.y) * 100}%`; hy.style.left = `${ctrlVals.x * 100}%`; }; paint();
  const apply = (e) => {
    const r = box.getBoundingClientRect(); ctrlVals.x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); ctrlVals.y = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)); paint();
    [C().xy[0], C().xy[1]].forEach((id) => CONT[id] && CONT[id][1](ctrlVals.x)); [C().xy[2], C().xy[3]].forEach((id) => CONT[id] && CONT[id][1](ctrlVals.y));
  };
  let on = false;
  box.addEventListener('pointerdown', (e) => { on = true; box.setPointerCapture(e.pointerId); apply(e); });
  box.addEventListener('pointermove', (e) => { if (on) apply(e); });
  box.addEventListener('pointerup', () => { on = false; commitSoon(); }); box.addEventListener('pointercancel', () => { on = false; });
}
function buildPads(box) {
  box.classList.add('pads');
  C().pads.forEach((id) => {
    const d = SW[id], b = document.createElement('button'); if (!d) return;
    b.textContent = nameOfSW(id); const upd = () => b.classList.toggle('lit', !!d[1]());
    b.addEventListener('click', () => { d[2](); upd(); commitSoon(); }); upd(); box.appendChild(b);
  });
}
function buildFaders(box) {
  box.classList.add('sliders');
  C().faders.forEach((id, i) => box.appendChild(vSlider({ label: nameOfC(id), value: ctrlVals.faders[i], onInput: (v) => { ctrlVals.faders[i] = v; CONT[id] && CONT[id][1](v); } })));
}
function buildWheels(box) {
  box.classList.add('sliders');
  box.appendChild(vSlider({ label: 'PITCH', value: 0.5, spring: true, onInput: (v) => engine.setBend((v - 0.5) * 400) }));      // ±200 cent
  box.appendChild(vSlider({ label: nameOfC(C().mod), value: ctrlVals.mod, onInput: (v) => { ctrlVals.mod = v; CONT[C().mod] && CONT[C().mod][1](v); } }));
}
const CTL_BUILD = { xy: buildXY, pads: buildPads, faders: buildFaders, wheels: buildWheels };
function renderControllers() {
  const wrap = document.createElement('div'); wrap.className = 'ctlwrap';
  ['left', 'right'].forEach((side) => { const box = document.createElement('div'); box.className = 'cbox'; CTL_BUILD[C()[side]](box); wrap.appendChild(box); });
  panelEl.appendChild(wrap);
}
// RANDOM w CTRL: losuje, czym sterują pad XY (4 parametry), przyciski, suwaki i modulation, wyłącznie spośród parametrów tej sekcji
function randomizeCtrl() {
  const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [b[i], b[k]] = [b[k], b[i]]; } return b; };
  const c = C(), cont = shuffle(SECTION_CONT[page]);
  c.xy = cont.slice(0, 4); c.faders = shuffle(SECTION_CONT[page]).slice(0, 4); c.mod = shuffle(SECTION_CONT[page])[0]; c.pads = shuffle(SECTION_SW[page]).slice(0, 4);
  saveCtrl();
}
const FX_NAMES = ['FLT', 'FX1', 'FX2'];
const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
const routeText = () => `ROUTING:${engine.fx.order.map((i) => FX_NAMES[i]).join('-')}`;
function moderow() {
  // wiersz tylko tam, gdzie ma pracę: CTRL (powrót do pokręteł + RANDOM) i FX (kolejność efektów); reszta zakładek ma same pokrętła
  const ctl = isCtl(), fxp = page === 'fx';
  if (!ctl && !fxp) return null;
  const r = document.createElement('div'), m = document.createElement('button'); r.className = 'moderow';
  r.appendChild(m);
  if (ctl) {
    m.textContent = 'MODE:CONTROLLER'; m.setAttribute('aria-label', 'Wróć do pokręteł');
    m.addEventListener('click', () => { tabSel[page] = 0; renderSub(); renderPanel(); });
    const rnd = document.createElement('button'); rnd.className = 'rnd'; rnd.textContent = 'RANDOM'; rnd.setAttribute('aria-label', 'Losuj przypisania kontrolerów');
    rnd.addEventListener('click', () => { randomizeCtrl(); renderPanel(); commitSoon(); toast('LOSOWO PRZYPISANO'); });
    r.appendChild(rnd);
  } else {
    m.textContent = routeText(); m.setAttribute('aria-label', 'Zmień kolejność efektów');
    m.addEventListener('click', () => { const k = PERMS.findIndex((p) => p.join() === engine.fx.order.join()); engine.fx.route(PERMS[(k + 1) % PERMS.length]); m.textContent = routeText(); commitSoon(); });
  }
  return r;
}
// ============================================================================
// Przypisywalne zakładki (SEQ MAIN, SEQ EXTRA, MIX MAIN, SYN MAIN, FX MAIN): dziesięć miejsc, każde ma wybrany parametr albo przycisk.
// Wybierasz 10 potencjometrów albo 10 suwaków (MODE), w okienku EDIT zmieniasz przypisania i wracasz do ustawień początkowych (DEFAULT), RANDOM losuje przypisania.
// ============================================================================
const ASSIGN_DEFAULT = {
  'seq:0': ['cutoff', 'reso', 'offfatk', 'offfrel', 'offaatk', 'offarel', 'gate', 'accent', 'shift', 'oct'],
  'seq:3': ['tempo', 'length', 'swing', 'human', 'ghost', 'slide', 'glide', 'velo', null, null],
  'mix:0': ['eqlow', 'eqmid', 'eqhigh', 'fx1mix', 'fbyp', 'master', 'dotmode', null, null, null],
  'syn:0': ['cutoff', 'reso', 'fenv', 'fdec', 'adec', 'asus', 'arel', 'aatk', null, null],
  'drum:0': ['dlevel', 'dkick', 'dsnare', 'dclap', 'dhat', 'dopen', 'dkt', 'dkd', 'dscamt', 'dscrel'],
  'fx:0': ['flt1', 'flt2', 'flt3', 'fmix', 'flt4', 'fx1p1', 'fx1p2', 'fx1p3', 'fx1mix', 'fx2mix'],
};
const ASSIGN_KEY = 'radarxxx.assign.v1';
let assign = {};
try { assign = JSON.parse(localStorage.getItem(ASSIGN_KEY) || '{}') || {}; } catch { assign = {}; }
const saveAssign = () => { try { localStorage.setItem(ASSIGN_KEY, JSON.stringify(assign)); } catch { /* brak pamięci */ } };
const assignKey = () => `${page}:${tabSel[page]}`;
const isAssign = () => ASSIGN_DEFAULT[assignKey()] !== undefined;
const getAssign = () => {
  const k = assignKey(), cur = assign[k], def = ASSIGN_DEFAULT[k];
  if (!cur || !Array.isArray(cur.slots) || cur.slots.length !== 10) assign[k] = { slots: def.slice() };
  return assign[k];
};
const resetAssign = () => { delete assign[assignKey()]; saveAssign(); };
function randomizeAssign() {
  const a = getAssign(), pool = SECTION_CONT[page].slice();
  for (let i = pool.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [pool[i], pool[k]] = [pool[k], pool[i]]; }
  a.slots = Array.from({ length: 10 }, (_, i) => pool[i] || null);
  saveAssign();
}
// odświeża pokrętła i suwaki, gdy wartość zmieniła się gdzie indziej (np. dotykiem na radarze); pomija ten, który właśnie trzymasz
const assignRefs = [];
function syncAssign() {
  assignRefs.forEach(({ id, el: kn, kind }) => {
    if (!kn.isConnected || id === 'shift' || !CONTG[id]) return;
    if (kn.classList.contains('drag') || kn.classList.contains('hold')) return;
    const v = clamp01(CONTG[id]());
    if (kind === 'knob') { if (Math.abs(kn.value - v) > 0.004) kn.value = v; } else if (kn.setValue) kn.setValue(v);
  });
}
function renderAssign() {
  const a = getAssign(), grid = document.createElement('div'); assignRefs.length = 0;
  grid.className = 'pgrid';
  a.slots.forEach((id) => {
    if (!id) { spacer(grid); return; }
    if (SW[id]) { cellButton(grid, { kind: TOGGLES.has(id) ? 'tog' : 'act', label: () => knobLabel(nameOfSW(id)), on: () => !!SW[id][1](), act: () => SW[id][2]() }); return; }
    const step = CSTEP[id] || 0.001, k = document.createElement('div');
    makeKnob(k, { label: knobLabel(nameOfC(id)), min: 0, max: 1, step, value: CONTG[id] ? clamp01(CONTG[id]()) : 0, def: CONTG[id] ? clamp01(CONTG[id]()) : 0, fmt: 'pct' });
    k.addEventListener('input', () => CONT[id][1](k.value));
    assignRefs.push({ id, el: k, kind: 'knob' }); grid.appendChild(k);
  });
  panelEl.appendChild(grid);
  const rt = document.createElement('div'); rt.className = 'randrow';
  const rb = document.createElement('button'); rb.className = 'randtext'; rb.textContent = 'RANDOM'; rb.setAttribute('aria-label', 'Losuj przypisania');
  rb.addEventListener('click', () => { randomizeAssign(); renderPanel(); commitSoon(); toast('LOSOWO PRZYPISANO'); });
  rt.appendChild(rb); panelEl.appendChild(rt);
}
// okienko EDIT: typ obu boksów i przypisania parametrów (listy rozwijane)
const ctlPop = el('ctl-pop');
let ctlView = 'ctl';
function renderRouteEdit() {
  const body = el('ctl-body'); body.innerHTML = ''; el('ctl-title').textContent = isAssign() ? 'ROUTING I STEROWANIE' : 'ROUTING';
  const info = document.createElement('div'); info.className = 'csec'; info.textContent = `WEJŚCIE › ${engine.fx.order.map((i) => FX_NAMES[i]).join(' › ')} › WYJŚCIE`; body.appendChild(info);
  engine.fx.order.forEach((cur, pos) => {
    const r = document.createElement('div'); r.className = 'crow'; const sp = document.createElement('span'); sp.textContent = `MIEJSCE ${pos + 1}`;
    const sel = document.createElement('select'); sel.setAttribute('aria-label', `Miejsce ${pos + 1}`);
    FX_NAMES.forEach((n, i) => { const o = document.createElement('option'); o.value = i; o.textContent = n; if (i === cur) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', () => { const o = engine.fx.order.slice(), want = +sel.value, from = o.indexOf(want); o[from] = o[pos]; o[pos] = want; engine.fx.route(o); renderRouteEdit(); renderPanel(); commitSoon(); });   // wybór zamienia miejscami z dotychczasowym właścicielem
    r.appendChild(sp); r.appendChild(sel); body.appendChild(r);
  });
  if (isAssign()) appendAssignEditor(body);
}

// Opisy parametrów i przycisków pokazywane w oknie EDIT pod listą wyboru (krótkie nazwy na pokrętłach bywają zagadkowe).
const DESC = {
  cutoff: 'filtr globalny: częstotliwość odcięcia', reso: 'filtr globalny: rezonans',
  fenv: 'siła zrywu filtra (wszystkie silniki)', fdec: 'zanik zrywu filtra (wszystkie silniki)', adec: 'zanik głośności (wszystkie silniki)',
  asus: 'sustain głośności (wszystkie silniki)', aatk: 'atak głośności (wszystkie silniki)', arel: 'release głośności (wszystkie silniki)',
  offfatk: 'atak obwiedni filtra, −100…+100%', offfrel: 'release (zanik) obwiedni filtra, −100…+100%', offaatk: 'atak obwiedni głośności, −100…+100%', offarel: 'release obwiedni głośności, −100…+100%',
  gate: 'długość wszystkich nut', accent: 'ile nut dostaje akcent', slide: 'ile ślizgów między nutami', swing: 'opóźnienie parzystych kroków',
  human: 'losowe drobne wahania czasu i siły', ghost: 'ciche nuty-duchy w pustych krokach', velo: 'siła uderzenia nut', glide: 'czas ślizgu przy SLIDE',
  ofs1: 'przesunięcie wzoru silnika 1 (0, 1/16 … 1/2)', ofs2: 'przesunięcie wzoru silnika 2 (0, 1/16 … 1/2)', ofs3: 'przesunięcie wzoru silnika 3', ofs4: 'przesunięcie wzoru silnika 4',
  tempo: 'mnożnik tempa: ½×, ⅔×, ¾×, 1×, 4⁄3×, 1,5×, 2× (krokowo)', shift: 'obrót wzoru o kroki', oct: 'oktawa całego wzoru (−2…+2)', length: 'długość wzoru w krokach (8–32)',
  master: 'głośność wyjścia', comp: 'siła kompresji na wyjściu', mdrive: 'przester wyjściowy', eqlow: 'EQ: niskie tony', eqmid: 'EQ: środek', eqhigh: 'EQ: wysokie tony',
  fmix: 'filtr: ile sygnału przechodzi przez filtr', fx1mix: 'FX1: ilość efektu (send)', fx2mix: 'FX2: ilość efektu',
  djf: 'DJ filtr: w lewo dolnoprzepustowy, w prawo górnoprzepustowy', tape: 'taśma: nasycenie, ciemniejsza góra, szum', wow: 'taśma: wahanie wysokości', chorusm: 'chorus: ilość efektu',
  padx: 'pad MIX: oś X (pozycja kursora)', pady: 'pad MIX: oś Y (pozycja kursora)',
  fbyp: 'włącza i omija filtr', f1byp: 'włącza i omija FX1', f2byp: 'włącza i omija FX2', latch: 'nuty trzymają się do następnej', dotmode: 'kropki na MIX: SOLO albo MUTE',
  rndeng: 'losuje brzmienie silników', rndsyn: 'losuje brzmienie silników', rndfx: 'losuje ustawienia filtra i efektów', route: 'zmienia kolejność FLT, FX1, FX2',
  random: 'nowy losowy wzór', mutate: 'zmienia brzmienie i wysokość części nut', warp: 'przekształca wzór: obrót, odbicie, wspak',
  reverse: 'odwraca kolejność nut', invert: 'odbija wysokości nut w pionie', rotl: 'przesuwa wzór o krok wstecz', rotr: 'przesuwa wzór o krok do przodu',
  double: 'kopiuje pierwszą połowę wzoru na drugą', half: 'skraca wzór o połowę', clear: 'czyści wzór', basem: 'nuta bazowa o półton niżej', basep: 'nuta bazowa o półton wyżej', keyn: 'następna skala (electro, fryg, moll)',
  dlevel: 'głośność całej perkusji', dkick: 'głośność stopy', dsnare: 'głośność werbla', dclap: 'głośność klaskania', dhat: 'głośność hatu zamkniętego', dopen: 'głośność hatu otwartego',
  dkt: 'strojenie stopy', dkd: 'długość wybrzmiewania stopy', dst: 'strojenie werbla', dhd: 'długość hatów', ddrive: 'nasycenie perkusji', dscamt: 'sidechain: ile stopa przycina syntezator', dscrel: 'sidechain: czas powrotu syntezatora', ddens: 'gęstość losowanych wzorów',
  dron: 'włącza i wyłącza perkusję', dsc: 'włącza i wyłącza sidechain stopy', dkit: 'następny zestaw brzmień: 808, 909, SYNTH', dstyle: 'następny styl wzorów: TECHNO, ELECTRO', drandom: 'nowy losowy wzór perkusji', dclear: 'czyści wzór perkusji',
  dm0: 'wycisza stopę', dm1: 'wycisza werbel', dm2: 'wycisza klaskanie', dm3: 'wycisza hat zamknięty', dm4: 'wycisza hat otwarty',
  xy: 'oś X steruje dwoma parametrami, oś Y dwoma innymi', pads: 'cztery przyciski: przełączniki i akcje', faders: 'cztery pionowe suwaki', wheels: 'pitch bend (±2 półtony) i modulation',
  knob: 'dziesięć pokręteł', slider: 'dziesięć pionowych suwaków',
};
for (let i = 1; i <= 4; i++) Object.assign(DESC, { [`lv${i}`]: `głośność silnika ${i}`, [`tune${i}`]: `strojenie silnika ${i} (±100 cent)`, [`oct${i}`]: `oktawa silnika ${i}`, [`vlo${i}`]: `EQ silnika ${i}: niskie`, [`vhi${i}`]: `EQ silnika ${i}: wysokie`,
  [`mute${i}`]: `wycisza silnik ${i}`, [`solo${i}`]: `gra tylko silnik ${i}`, [`type${i}`]: `zmienia rodzaj silnika ${i}` });
const descOf = (id) => { if (!id) return 'puste miejsce'; if (DESC[id]) return DESC[id]; const m = /^(flt|fx1p|fx2p)(\d)$/.exec(id); return m ? `parametr ${m[2]} sekcji ${m[1] === 'flt' ? 'filtra' : m[1] === 'fx1p' ? 'FX1' : 'FX2'} (nazwa zależy od stylu)` : ''; };
const withCap = (sel, r, sp) => {            // lista wyboru z podpisem pod spodem, odświeżanym przy zmianie
  const rc = document.createElement('div'); rc.className = 'rc'; const cap = document.createElement('small'); cap.className = 'cap'; cap.textContent = descOf(sel.value);
  sel.addEventListener('change', () => { cap.textContent = descOf(sel.value); });
  rc.appendChild(sel); rc.appendChild(cap); r.appendChild(sp); r.appendChild(rc);
};
function appendAssignEditor(body) {
  const a = getAssign(), cont = SECTION_CONT[page].map((k) => [k, nameOfC(k)]), sw = SECTION_SW[page].map((k) => [k, nameOfSW(k)]);
  const sec = document.createElement('div'); sec.className = 'csec'; sec.textContent = `STEROWANIE: ${page.toUpperCase()} ${tabNames(page)[tabSel[page]]} (10 MIEJSC)`; body.appendChild(sec);
  const mk = (lab, fill, cur, set) => {
    const r = document.createElement('div'); r.className = 'crow'; const sp = document.createElement('span'); sp.textContent = lab;
    const sel = document.createElement('select'); sel.setAttribute('aria-label', lab); fill(sel, cur);
    sel.addEventListener('change', () => { set(sel.value); saveAssign(); renderPanel(); commitSoon(); });
    withCap(sel, r, sp); body.appendChild(r);
  };
  mk('TYP', (sel, cur) => [['knob', '10 POTENCJOMETRÓW'], ['slider', '10 SUWAKÓW']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; if (v === cur) o.selected = true; sel.appendChild(o); }), a.kind, (v) => { a.kind = v; });
  a.slots.forEach((cur, i) => mk(`${i + 1}`, (sel, c) => {
    const add = (parent, v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; if (v === (c || '')) o.selected = true; parent.appendChild(o); };
    add(sel, '', '—'); cont.forEach(([v, t]) => add(sel, v, t));
    const g = document.createElement('optgroup'); g.label = 'PRZYCISKI'; sw.forEach(([v, t]) => add(g, v, t)); sel.appendChild(g);
  }, cur, (v) => { a.slots[i] = v || null; }));
}
function renderAssignEdit() {
  const body = el('ctl-body'); body.innerHTML = ''; el('ctl-title').textContent = 'STEROWANIE';
  appendAssignEditor(body);
}
function renderCtlEdit() {
  if (ctlView === 'assign') { renderAssignEdit(); return; }
  if (ctlView === 'route') { renderRouteEdit(); return; }
  const body = el('ctl-body'); body.innerHTML = ''; el('ctl-title').textContent = 'KONTROLERY';
  const row = (lab, opts, cur, set) => {
    const r = document.createElement('div'); r.className = 'crow'; const sp = document.createElement('span'); sp.textContent = lab;
    const sel = document.createElement('select'); sel.setAttribute('aria-label', lab);
    opts.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; if (v === cur) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', () => { set(sel.value); saveCtrl(); renderCtlEdit(); renderPanel(); commitSoon(); });
    withCap(sel, r, sp); body.appendChild(r);
  };
  const sec = (t) => { const d = document.createElement('div'); d.className = 'csec'; d.textContent = t; body.appendChild(d); };
  const types = Object.entries(CTL_TYPES), cont = SECTION_CONT[page].map((k) => [k, nameOfC(k)]), sw = SECTION_SW[page].map((k) => [k, nameOfSW(k)]);   // tylko parametry tej sekcji
  el('ctl-title').textContent = `KONTROLERY: ${page.toUpperCase()}`;
  row('LEWY', types, C().left, (v) => { C().left = v; }); row('PRAWY', types, C().right, (v) => { C().right = v; });
  const used = new Set([C().left, C().right]);
  if (used.has('xy')) { sec('XY PAD: OŚ X (2 PARAMETRY), OŚ Y (2 PARAMETRY)'); ['X1', 'X2', 'Y1', 'Y2'].forEach((n, i) => row(n, cont, C().xy[i], (v) => { C().xy[i] = v; })); }
  if (used.has('pads')) { sec('4 PRZYCISKI'); [1, 2, 3, 4].forEach((n, i) => row(`P${n}`, sw, C().pads[i], (v) => { C().pads[i] = v; })); }
  if (used.has('faders')) { sec('4 SUWAKI'); [1, 2, 3, 4].forEach((n, i) => row(`S${n}`, cont, C().faders[i], (v) => { C().faders[i] = v; })); }
  if (used.has('wheels')) { sec('PITCH BEND (±2 PÓŁTONY) I MODULATION'); row('MOD', cont, C().mod, (v) => { C().mod = v; }); }
}
const showCtl = (on, view = 'ctl') => { ctlPop.hidden = !on; if (on) { ctlView = view; renderCtlEdit(); el('ctl-ok').focus(); } };
// DEFAULT: wraca do ustawień początkowych tego, co aktualnie edytujesz (kontrolery sekcji, przypisania zakładki, routing)
el('ctl-default').addEventListener('click', () => {
  if (ctlView === 'ctl') { ctrl[page] = ctrlDefault()[page]; saveCtrl(); }
  else { if (ctlView === 'route') engine.fx.route([0, 1, 2]); if (isAssign()) resetAssign(); }
  renderCtlEdit(); renderPanel(); commitSoon(); toast('USTAWIENIA DOMYŚLNE');
});
el('ctl-ok').addEventListener('click', () => showCtl(false));
ctlPop.addEventListener('pointerdown', (e) => { if (e.target === ctlPop) showCtl(false); });

// ---------- zawartość zakładek ----------
const panelEl = el('panel');
const tabNames = (p) => ({
  seq: ['MAIN', 'SEQ', 'SCALE', 'EXTRA', 'CTRL'],
  mix: ['MAIN', ...VOICE_NAMES.map((_, i) => TAB_SHORT[engine.types[i]]), 'CTRL'],
  syn: ['MAIN', ...VOICE_NAMES.map((_, i) => TAB_SHORT[engine.types[i]]), 'CTRL'],
  fx: ['MAIN', 'FLT', 'FX1', 'FX2', 'MSTR', 'CTRL'],
  drum: ['MAIN', 'PTRN', 'CTRL'],
})[p];
function renderSub() {
  const host = el('subtabs'), names = tabNames(page);
  host.innerHTML = ''; host.classList.toggle('five', names.length > 4);
  names.forEach((n, i) => {
    const b = document.createElement('button'); b.textContent = n; b.className = i === tabSel[page] ? 'on' : '';
    b.addEventListener('click', () => { tabSel[page] = i; if (page === 'syn' && i > 0 && i < names.length - 1) synSel = i - 1; renderSub(); renderPanel(); });
    host.appendChild(b);
  });
}
const specOfType = (t, id) => PARAM_SPECS[t].find((x) => x.id === id);
const SHORT_LAB = { fEnv: 'F.ENV', fDec: 'F.ZAN.', aDec: 'A.ZAN.', aRel: 'A.REL.', aSus: 'A.SUST.', aAtk: 'A.ATAK' };   // krótkie nazwy, żeby mieściły się nad pokrętłem
const labOf = (sp) => SHORT_LAB[sp.id] || sp.label.toUpperCase();

function renderPanel() {
  panelEl.replaceChildren();
  Object.keys(synRefs).forEach((k) => delete synRefs[k]); Object.keys(macroRefs).forEach((k) => delete macroRefs[k]); Object.keys(fxMainRefs).forEach((k) => delete fxMainRefs[k]);
  // zakładka CTRL: kontrolery u góry, a wiersz MODE:CONTROLLER / EDIT pod nimi; na pozostałych zakładkach wiersz (routing na FX, na innych pusty) jest nad pokrętłami
  const mr = moderow();
  if (isCtl()) { renderControllers(); panelEl.appendChild(mr); return; }
  if (mr) panelEl.appendChild(mr);
  const grid = document.createElement('div'); grid.className = 'pgrid';
  const tab = tabSel[page], B = (o) => cellButton(grid, o), Kn = (...a) => grid.appendChild(synKnob(...a)), Sp = () => spacer(grid);

  if (isAssign()) { renderAssign(); return; }       // zakładki z dziesięcioma przypisywalnymi miejscami (patrz wyżej)

  if (page === 'drum') {
    // PTRN: narzędzia wzoru perkusji i wyciszanie ścieżek
    panelEl.appendChild(grid);
    const rot = (k) => { engine.drumPattern = { ...engine.drumPattern, steps: engine.drumPattern.steps.map((row) => row.map((_, i) => row[(((i - k) % DRUM_STEPS) + DRUM_STEPS) % DRUM_STEPS])) }; };
    B({ kind: 'act', icon: 'clear', label: () => 'CLEAR', act: () => SW.dclear[2]() });
    B({ kind: 'act', icon: 'rotl', label: () => 'ROT ←', act: () => rot(-1) }); B({ kind: 'act', icon: 'rotr', label: () => 'ROT →', act: () => rot(1) });
    B({ kind: 'act', label: () => 'FILL', act: () => { const st = engine.drumPattern.steps.map((r) => r.slice()); [13, 14, 15].forEach((i, n) => { st[1][i] = n === 2 ? 2 : 1; }); st[3][15] = 0; engine.drumPattern = { ...engine.drumPattern, steps: st }; } });
    B({ kind: 'act', label: () => 'RANDOM', act: drumRandom });
    DRUM_TRACKS.forEach((n, k) => B({ kind: 'tog', label: () => n, on: () => !engine.drum.mute[k], act: () => { engine.drum.mute[k] = !engine.drum.mute[k]; } }));
    return;
  }
  if (page === 'seq') {
    panelEl.appendChild(grid);
    if (tab === 1) {
      const A = (name, ic, fn) => B({ kind: 'act', icon: ic, label: () => name, act: actions.steps(fn) });
      A('CLEAR', 'clear', clearSteps); A('REVERSE', 'reverse', reverseSteps); A('INVERT', 'invert', invertSteps);
      A('DOUBLE', 'double', doubleSteps); A('HALF', 'half', halveSteps);
      // przesunięcie wzoru wysyłanego do każdego z czterech silników (względem siebie): 0, 1/16, 1/12, 1/8, 1/6, 1/4, 1/2; podpis = rodzaj silnika
      [0, 1, 2, 3].forEach((i) => { const k = synKnob(`${TAB_SHORT[engine.types[i]]} +`, 0, 1, 1 / 6, offN(i)(), 0, (v) => offSet(i)(v)); grid.appendChild(k); });
    } else {
      stepRow(grid, 'BASE', baseLabel, () => actions.base(-1), () => actions.base(1));
      stepRow(grid, 'KEY', () => MODE_LABEL[state.mode], () => actions.key(-1), () => actions.key(1));
    }
  } else if (page === 'mix') {
    panelEl.appendChild(grid);
    const i = tab - 1;
    Kn('LEVEL', 0, 1.5, 0.01, engine.levels[i], 1, (v) => engine.setLevel(i, v));
    Kn('TUNE', -100, 100, 1, engine.vTune[i], 0, (v) => { engine.vTune[i] = v; });
    Kn('OCT', -2, 2, 1, engine.vOct[i], 0, (v) => { engine.vOct[i] = Math.round(v); });
    Kn('EQ LOW', -12, 12, 0.5, engine.vEq[i][0], 0, (v) => engine.setVoiceEq(i, 0, v));
    Kn('EQ HIGH', -12, 12, 0.5, engine.vEq[i][1], 0, (v) => engine.setVoiceEq(i, 1, v));
    B({ kind: 'act', label: () => typeName(i), act: () => { engine.setType(i, (engine.types[i] + 1) % SHORT.length); renderSub(); renderPanel(); } });
    B({ kind: 'tog', label: () => 'ON', on: () => !!engine.enabled[i], act: () => engine.setEnabled(i, !engine.enabled[i]) });
    B({ kind: 'tog', label: () => 'SOLO', on: () => engine.solo === i, act: () => engine.setSolo(engine.solo === i ? null : i) });
    Sp(); B({ kind: 'act', label: () => 'RANDOM', act: () => engine.randomizeVoice(i) });
  } else if (page === 'syn') {
    panelEl.appendChild(grid);
    const i = synSel, t = engine.types[i], pv = engine.voices[i].params;
    grid.classList.add('model');
    // komórka MODEL po lewej (dotknięcie zmienia rodzaj silnika), obok osiem pokręteł w dwóch rzędach po cztery
    const mc = document.createElement('button'); mc.className = 'modelcell';
    mc.innerHTML = `<span class="cl">MODEL</span><b>${TAB_SHORT[t]}</b>`; mc.setAttribute('aria-label', 'Zmień rodzaj silnika');
    mc.addEventListener('click', () => { engine.setType(i, (engine.types[i] + 1) % SHORT.length); renderSub(); renderPanel(); commitSoon(); });
    grid.appendChild(mc);
    const own = PARAM_SPECS[t].filter((x) => x.group !== 'env').slice(0, 3);
    const add = (sp) => { const k = synKnob(labOf(sp), sp.min, sp.max, sp.step, pv[sp.id], sp.def, (v) => engine.setParam(i, sp.id, v)); synRefs[sp.id] = k; grid.appendChild(k); };
    own.forEach(add); add(specOfType(t, 'fEnv'));
    ['fDec', 'aDec', 'aRel'].forEach((id) => add(specOfType(t, id)));
    B({ kind: 'act', label: () => 'RANDOM', act: () => { const vals = engine.randomizeVoice(i); for (const [id, v] of Object.entries(vals)) if (synRefs[id]) synRefs[id].value = v; } });
  } else if (tab === 4) {
    // MSTR: master (głośność, kompresja, drive) i efekty na sumie: DJ filter, tape (TAPE + WOW), chorus oraz beat repeat jako pionowy suwak
    panelEl.appendChild(grid); grid.classList.add('mstr');
    Kn('MASTER', 0, 1.2, 0.01, globals.master, 1, (v) => { globals.master = v; engine.setMaster(v); });
    Kn('COMP', 0, 1, 0.01, globals.comp, 0.5, (v) => { globals.comp = v; engine.setComp(v); });
    Kn('DRIVE', 0, 1, 0.01, globals.mdrive, 0, (v) => { globals.mdrive = v; engine.setDrive(v); });
    Kn('DJ FLT', -1, 1, 0.01, globals.dj, 0, (v) => { globals.dj = v; engine.setDj(v); });
    Kn('TAPE', 0, 1, 0.01, globals.tape, 0, (v) => { globals.tape = v; engine.setTape(v); });
    Kn('WOW', 0, 1, 0.01, globals.wow, 0, (v) => { globals.wow = v; engine.setWow(v); });
    Kn('CHORUS', 0, 1, 0.01, globals.chorus, 0, (v) => { globals.chorus = v; engine.setChorus(v); });
    Sp();
    const rs = vSlider({ label: 'REPEAT', value: 0, spring: true, rest: 0, onInput: (v) => engine.setRepeat(v) });   // chwilowy: puszczenie wyłącza pętlę
    rs.classList.add('repeat'); grid.appendChild(rs);
  } else {
    panelEl.appendChild(fxSecs[tab - 1].sec);
  }
}

// ---------- kropki w rogach ----------
const ctlLabel = ['OBA', 'FILTR', 'EFEKT'];
function dotList() {
  // say: komunikat po dotknięciu kropki (co robi i w jakim jest stanie); na stronie DRUM opisy są też widoczne przy kropkach
  if (page === 'drum') {
    const d = engine.drum;
    return [
      { label: 'RANDOM', sub: 'NOWY WZÓR', act: drumRandom, say: () => 'RANDOM: nowy losowy wzór perkusji' },
      { label: `KIT ${DRUM_KITS[d.kit]}`, sub: 'ZMIEŃ ZESTAW', act: () => { d.kit = (d.kit + 1) % DRUM_KITS.length; engine.auditionDrum(0); }, say: () => `KIT: zestaw brzmień ${DRUM_KITS[d.kit]}` },
      { label: `STYLE ${DRUM_STYLES[d.style]}`, sub: 'ZMIEŃ STYL', act: () => { d.style = (d.style + 1) % DRUM_STYLES.length; drumRandom(); }, say: () => `STYLE: ${DRUM_STYLES[d.style]}, nowy wzór w tym stylu` },
      { label: `SIDECH. ${d.sc ? 'WŁ.' : 'WYŁ.'}`, sub: 'PRZYCINA BAS', lit: d.sc, act: () => { d.sc = !d.sc; }, say: () => `SIDECHAIN ${d.sc ? 'WŁ.' : 'WYŁ.'}: stopa ${d.sc ? 'przycina syntezator' : 'nie przycina syntezatora'}` },
    ];
  }
  if (page === 'seq') return [
    { label: 'RANDOM', act: actions.random, say: () => 'RANDOM: nowy losowy wzór basu' },
    { label: 'MUTATE', act: actions.mut, say: () => 'MUTATE: nowe brzmienie i wysokość części nut' },
    { label: 'LATCH', lit: state.latch, act: actions.latch, say: () => `LATCH ${state.latch ? 'WŁ.' : 'WYŁ.'}: nuty trzymają się do następnej` },
    { label: 'WARP', sub: `› ${WARP_OPS[warpIdx % WARP_OPS.length][0]}`, act: actions.warp, say: () => `WARP: ${WARP_OPS[(warpIdx + WARP_OPS.length - 1) % WARP_OPS.length][0]} (przekształcenie wzoru)` },
  ];
  if (page === 'mix') {
    // kropki na MIX działają jako SOLO albo MUTE (przełącznik na zakładce MAIN)
    const solo = state.mixMode === 'solo';
    return VOICE_NAMES.map((_, i) => solo
      ? { label: typeName(i), lit: engine.solo == null ? !!engine.enabled[i] : engine.solo === i, dim: engine.solo != null && engine.solo !== i, act: () => engine.setSolo(engine.solo === i ? null : i), say: () => (engine.solo === i ? `SOLO ${typeName(i)}: gra tylko ten silnik` : 'SOLO wyłączone: grają wszystkie silniki') }
      : { label: typeName(i), lit: !!engine.enabled[i], dim: !engine.enabled[i], act: () => engine.setEnabled(i, !engine.enabled[i]), say: () => `MUTE ${typeName(i)}: ${engine.enabled[i] ? 'silnik gra' : 'silnik wyciszony'}` });
  }
  if (page === 'syn') {
    const eff = engine.eff.map((v, i) => (engine.enabled[i] ? v : 0)), top = Math.max(...eff, 1e-6), lead = eff.indexOf(Math.max(...eff));
    return VOICE_NAMES.map((_, i) => ({ label: typeName(i), lit: tabSel.syn !== 0 && i === synSel, dim: !engine.enabled[i], bar: eff[i] / top, barHot: i === lead && eff[i] > 0, act: () => { synSel = i; tabSel.syn = i + 1; renderSub(); renderPanel(); }, say: () => `${typeName(i)}: edycja tego silnika` }));
  }
  const nameOf = (j, id) => (fxSecs[j].styles[fxSecs[j].slot.style].params.find((sp) => sp.id === id)?.label || id).toUpperCase();
  const hint = (j) => { const m = macroOf(j); return `r ${m.r.map((id) => nameOf(j, id)).join('+')} ∠ ${m.a.map((id) => nameOf(j, id)).join('+')}`; };
  return [
    { label: 'FILTR', sub: hint(0), lit: !fxSecs[0].slot.bypass, dim: !driven().includes(0), act: () => bypass(0), say: () => `FILTR ${fxSecs[0].slot.bypass ? 'omijany (bypass)' : 'włączony'}` },
    { label: 'EFEKT', sub: hint(1), lit: !fxSecs[1].slot.bypass, dim: !driven().includes(1), act: () => bypass(1), say: () => `EFEKT FX1 ${fxSecs[1].slot.bypass ? 'omijany (bypass)' : 'włączony'}` },
    { label: ctlLabel[fxCtl], sub: 'STEROW.', act: () => { fxCtl = (fxCtl + 1) % 3; }, say: () => `STEROW.: dotyk na radarze zmienia ${fxCtl === 0 ? 'filtr i efekt' : fxCtl === 1 ? 'tylko filtr' : 'tylko efekt'}` },
    { label: 'STYLE', sub: short8(fxSecs[fxStyleTarget()].styles[fxSecs[fxStyleTarget()].slot.style].name.toUpperCase()), act: () => cycleStyle(fxStyleTarget()), say: () => `STYLE: ${['filtr', 'FX1', 'FX2'][fxStyleTarget()]} ${fxSecs[fxStyleTarget()].styles[fxSecs[fxStyleTarget()].slot.style].name}` },
  ];
}
function dotDefs() { return dotList(); }
el('dots').addEventListener('click', (e) => {
  const b = e.target.closest('.dot'); if (!b) return;
  const d = dotList()[+b.dataset.i]; d.act(); const m = d.say && d.say(); if (m) toast(m); commitSoon();
});
el('dots').addEventListener('pointerdown', (e) => e.stopPropagation());

// zmiany pokręteł i dotyk na radarze zapisują się w historii z opóźnieniem
panelEl.addEventListener('input', commitSoon);
cv.addEventListener('pointerup', commitSoon);


// ============================================================================
// Widoki: KLASYCZNY (dotychczasowy), SCENY (pole XY i 16 padów ze scenami) oraz ORBITY (cały instrument jako układ orbit)
// ============================================================================
function setView(v) {
  view = v;
  document.querySelectorAll('#viewbar button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  document.querySelectorAll('#pages button').forEach((b) => b.classList.toggle('on', v === 'classic' && b.dataset.page === page));
  el('scopewrap').hidden = v === 'scenes';
  el('subtabs').hidden = el('panel').hidden = v !== 'classic';
  el('scenes').hidden = v !== 'scenes';
  el('orbitbar').hidden = v !== 'orbit';
  document.querySelector('.scopebox').classList.toggle('plain', v === 'orbit');
  if (v !== 'orbit') { orbSel = null; orbZ = 0; }
  if (v === 'orbit') orbInfo();
  if (v === 'scenes') renderScenes();
  fit();
}
el('viewbar').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setView(b.dataset.view); });

// ---------- SCENY ----------
// Scena = pełna migawka (wzór, brzmienie, efekty, perkusja), jak w historii i presetach. Pusty pad zapisuje bieżący stan, pełny go wczytuje, długie przytrzymanie usuwa.
const SCENE_KEY = 'radarxxx.scenes.v1', SC_NAMES = 'ABCDEFGHIJKLMNOP';
let scenes = Array(16).fill(null), scAct = -1;
try { const sv = JSON.parse(localStorage.getItem(SCENE_KEY) || 'null'); if (Array.isArray(sv) && sv.length === 16) scenes = sv; } catch { /* brak zapisu */ }
const saveScenes = () => { try { localStorage.setItem(SCENE_KEY, JSON.stringify(scenes)); return true; } catch { return false; } };
function renderScenes() {
  const host = el('spads'); host.innerHTML = '';
  scenes.forEach((sc, i) => { const b = document.createElement('button'); b.className = `spad ${sc ? 'has' : 'empty'}${i === scAct ? ' act' : ''}`; b.textContent = SC_NAMES[i]; b.dataset.i = i; b.setAttribute('aria-label', `Scena ${SC_NAMES[i]}`); host.appendChild(b); });
  el('schint').textContent = 'PUSTY PAD: ZAPISZ TU · PEŁNY: WCZYTAJ · DŁUGO: USUŃ';
  syncScenes();
}
function saveScene(i) {
  flushCommit(); scenes[i] = snapshot(); scAct = i;
  toast(saveScenes() ? `SCENA ${SC_NAMES[i]} ZAPISANA` : 'NIE UDAŁO SIĘ ZAPISAĆ'); renderScenes();
}
function sceneTap(i) {
  if (!scenes[i]) { saveScene(i); return; }
  flushCommit(); restore(scenes[i]); scAct = i; pushHistory(); toast(`SCENA ${SC_NAMES[i]}`); renderScenes();
}
let padTimer = 0, padLong = false;
el('spads').addEventListener('pointerdown', (e) => {
  const b = e.target.closest('.spad'); if (!b) return;
  padLong = false; clearTimeout(padTimer);
  const i = +b.dataset.i;
  if (scenes[i]) padTimer = setTimeout(() => { padLong = true; scenes[i] = null; if (scAct === i) scAct = -1; saveScenes(); renderScenes(); toast(`SCENA ${SC_NAMES[i]} USUNIĘTA`); }, 600);
});
['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => el('spads').addEventListener(t, () => clearTimeout(padTimer)));
el('spads').addEventListener('click', (e) => { const b = e.target.closest('.spad'); if (!b) return; if (padLong) { padLong = false; return; } sceneTap(+b.dataset.i); });
el('sc-rand').addEventListener('click', () => { actions.random(); commitSoon(); });
el('sc-mut').addEventListener('click', () => { actions.mut(); commitSoon(); });
el('sc-save').addEventListener('click', () => { const i = scAct >= 0 ? scAct : scenes.findIndex((x) => !x); if (i < 0) toast('WYBIERZ PAD DO NADPISANIA'); else saveScene(i); });
const xyEl = el('xy'), xyd = el('xyd');
let xyDrag = false;
const xyFrom = (e) => { const r = xyEl.getBoundingClientRect(); CONT.cutoff[1](clamp01((e.clientX - r.left) / r.width)); CONT.reso[1](1 - clamp01((e.clientY - r.top) / r.height)); syncScenes(); };
xyEl.addEventListener('pointerdown', (e) => { xyDrag = true; xyEl.setPointerCapture(e.pointerId); xyFrom(e); });
xyEl.addEventListener('pointermove', (e) => { if (xyDrag) xyFrom(e); });
const xyEnd = () => { if (xyDrag) { xyDrag = false; commitSoon(); } };
xyEl.addEventListener('pointerup', xyEnd); xyEl.addEventListener('pointercancel', xyEnd);
function syncScenes() { xyd.style.left = `${CONTG.cutoff() * 100}%`; xyd.style.top = `${(1 - CONTG.reso()) * 100}%`; }

// ---------- ORBITY ----------
// Trzy orbity: zewnętrzna = kroki wzoru (dotyk włącza i wyłącza), środkowa = silniki i perkusja, wewnętrzna = filtr i efekty, w środku MASTER.
// Dotknięcie obiektu przybliża go i pokazuje cztery satelity: przeciągnij kropkę w górę lub w dół, żeby zmienić parametr, dotknij przełącznik, żeby go włączyć.
const ORB_R = [0.86, 0.58, 0.29];
let orbSel = null, orbZ = 0, orbLast = { x: 0, y: 0 }, orbTf = { s: 1, tx: 0, ty: 0 }, orbHit = { items: [], sats: [] };
const SAT_DEG = [45, 135, 225, 315];
function orbItems(G) {
  const { cx, cy, R } = G, at = (r, deg) => ({ x: cx + Math.sin((deg * Math.PI) / 180) * r * R, y: cy - Math.cos((deg * Math.PI) / 180) * r * R }), items = [];
  for (let i = 0; i < 4; i++) items.push({ kind: 'eng', i, ...at(ORB_R[1], i * 72 + 36), r: R * (0.045 + 0.05 * clamp01(engine.levels[i] / 1.5)), label: typeName(i), on: !!engine.enabled[i] });
  items.push({ kind: 'drum', i: 0, ...at(ORB_R[1], 4 * 72 + 36), r: R * (0.045 + 0.05 * clamp01(CONTG.dlevel())), label: 'DRUM', on: !!engine.drum.on });
  for (let j = 0; j < 3; j++) items.push({ kind: 'fx', i: j, ...at(ORB_R[2], 60 + j * 120), r: R * 0.055, label: ['FLT', 'FX1', 'FX2'][j], on: !fxSecs[j].slot.bypass });
  items.push({ kind: 'master', i: 0, x: cx, y: cy, r: R * 0.05, label: 'MASTER', on: true });
  return items;
}
function orbSats(it) {
  if (it.kind === 'eng') return [['c', `lv${it.i + 1}`], ['c', `tune${it.i + 1}`], ['c', `oct${it.i + 1}`], ['s', `mute${it.i + 1}`]];
  if (it.kind === 'drum') return [['c', 'dlevel'], ['c', 'dkick'], ['c', 'dscamt'], ['s', 'dsc']];
  if (it.kind === 'fx') { const j = it.i; return [['c', `${['flt', 'fx1p', 'fx2p'][j]}1`], ['c', `${['flt', 'fx1p', 'fx2p'][j]}2`], ['c', ['fmix', 'fx1mix', 'fx2mix'][j]], ['s', ['fbyp', 'f1byp', 'f2byp'][j]]]; }
  return [['c', 'master'], ['c', 'comp'], ['c', 'mdrive'], ['c', 'tempo']];
}
function orbInfo() {
  el('orb-back').hidden = !orbSel;
  const it = orbSel && orbHit.items.find((x) => x.kind === orbSel.kind && x.i === orbSel.i);
  el('orbinfo').textContent = it ? `${it.label}: PRZECIĄGNIJ KROPKĘ W GÓRĘ LUB W DÓŁ` : 'DOTKNIJ PLANETĘ, ŻEBY JĄ ZBLIŻYĆ · DOTKNIJ KROPKĘ NA ZEWNĘTRZNEJ ORBICIE, ŻEBY ZMIENIĆ NUTĘ';
}
function drawOrbit(ts) {
  const G = geo(), { W, cx, cy, R, dpr } = G, S = sweepState(), n = S.n;
  g.setTransform(1, 0, 0, 1, 0, 0); clearScope(W);
  const items = orbItems(G), sel = orbSel && items.find((x) => x.kind === orbSel.kind && x.i === orbSel.i);
  const tgt = sel ? 1 : 0; orbZ += (tgt - orbZ) * 0.22; if (Math.abs(tgt - orbZ) < 0.003) orbZ = tgt;
  const z = orbZ, s = 1 + 0.9 * z; if (sel) orbLast = { x: sel.x - cx, y: sel.y - cy };
  orbTf = { s, tx: cx * (1 - s) - z * s * orbLast.x, ty: cy * (1 - s) - z * s * orbLast.y };
  g.setTransform(s, 0, 0, s, orbTf.tx, orbTf.ty);
  const dimA = 1 - 0.7 * z;
  // orbity i podpisy
  ORB_R.forEach((r, k) => { circle(cx, cy, r * R, `rgba(${INK},${k === 0 ? 1 : 0.55 * dimA + 0.2})`, (k === 0 ? 1.4 : 1) * dpr, k === 0 ? null : [3 * dpr, 4 * dpr]); });
  g.font = FONT(R * 0.062); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = `rgba(${INK},${0.6 * dimA})`;
  ['WZÓR', 'SILNIKI', 'EFEKTY'].forEach((t, k) => g.fillText(t, cx, cy - ORB_R[k] * R + R * 0.05));
  // zewnętrzna orbita: kroki wzoru i głowica
  g.globalAlpha = dimA;
  const hot = Math.floor(S.pos) % n;
  for (let i = 0; i < n; i++) {
    const st = pattern.steps[i], [x, y] = polarXY(cx, cy, R * ORB_R[0], angleOfStep(i, n));
    g.beginPath();
    if (st.on) { g.arc(x, y, R * 0.027, 0, TAU); g.fillStyle = st.vel >= 110 ? `rgb(${ACC})` : `rgb(${INK})`; g.fill(); }
    else { g.arc(x, y, R * 0.011, 0, TAU); g.strokeStyle = `rgba(${INK},.55)`; g.lineWidth = dpr; g.stroke(); }
    if (i === hot && engine.playing) { g.beginPath(); g.arc(x, y, R * 0.045, 0, TAU); g.strokeStyle = `rgb(${ACC})`; g.lineWidth = 2 * dpr; g.stroke(); }
  }
  const [lx, ly] = polarXY(cx, cy, R * ORB_R[0], S.sw);
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(lx, ly); g.strokeStyle = `rgba(${INK},.8)`; g.lineWidth = 1.4 * dpr; g.stroke();
  g.globalAlpha = 1;
  // obiekty: silniki i perkusja (koła), filtr i efekty (kwadraty), master (środek)
  items.forEach((it) => {
    const a = sel && it !== sel ? 0.3 : 1; g.globalAlpha = a;
    g.beginPath();
    if (it.kind === 'fx') g.rect(it.x - it.r, it.y - it.r, it.r * 2, it.r * 2); else g.arc(it.x, it.y, it.r, 0, TAU);
    if (it.on) { g.fillStyle = it.kind === 'master' ? `rgb(${INK})` : `rgb(${ACC})`; g.fill(); }
    g.strokeStyle = `rgb(${INK})`; g.lineWidth = 1.4 * dpr; g.stroke();
    if (it.kind === 'drum') { g.beginPath(); g.arc(it.x, it.y, it.r * 0.4, 0, TAU); g.fillStyle = `rgb(${INK})`; g.fill(); }
    if (it !== sel || z < 0.5) { g.font = FONT(R * 0.065); g.fillStyle = `rgb(${INK})`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(it.label, it.x, it.y + it.r + R * 0.06); }
    g.globalAlpha = 1;
  });
  // satelity wybranego obiektu
  const sats = [];
  if (sel && z > 0.05) {
    const ds = R * 0.2, rs = R * 0.062; g.globalAlpha = z;
    orbSats(sel).forEach(([type, id], k) => {
      const a = (SAT_DEG[k] * Math.PI) / 180, x = sel.x + Math.sin(a) * ds, y = sel.y - Math.cos(a) * ds;
      sats.push({ x, y, r: rs, type, id });
      g.beginPath(); g.arc(x, y, rs, 0, TAU);
      if (type === 's') {
        const lit = !!SW[id][1](); if (lit) { g.fillStyle = `rgb(${ACC})`; g.fill(); }
        g.strokeStyle = `rgb(${INK})`; g.lineWidth = 1.4 * dpr; g.stroke();
      } else {
        const v = clamp01(CONTG[id]());
        g.strokeStyle = `rgba(${INK},.25)`; g.lineWidth = R * 0.016; g.stroke();
        g.beginPath(); g.arc(x, y, rs, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * Math.max(0.001, v)); g.strokeStyle = `rgb(${INK})`; g.lineCap = 'round'; g.stroke(); g.lineCap = 'butt';
        g.beginPath(); g.arc(x, y, R * 0.012, 0, TAU); g.fillStyle = `rgb(${ACC})`; g.fill();
      }
      g.font = FONT(R * 0.055); g.fillStyle = `rgb(${INK})`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(type === 's' ? nameOfSW(id) : knobLabel(nameOfC(id)), x, y + rs + R * 0.055);
    });
    g.globalAlpha = 1;
  }
  orbHit = { items, sats };
  g.setTransform(1, 0, 0, 1, 0, 0);
}
function orbWorld(e) {
  const r = cv.getBoundingClientRect(), k = cv.width / r.width;
  return { x: ((e.clientX - r.left) * k - orbTf.tx) / orbTf.s, y: ((e.clientY - r.top) * k - orbTf.ty) / orbTf.s };
}
function orbitDown(e) {
  const w = orbWorld(e), G = geo(), { items, sats } = orbHit, hitItem = items.find((it) => Math.hypot(w.x - it.x, w.y - it.y) <= Math.max(it.r * 1.5, G.R * 0.075));
  if (orbSel) {
    const st = sats.find((x) => Math.hypot(w.x - x.x, w.y - x.y) <= x.r * 1.6);
    if (st) {
      if (st.type === 's') { SW[st.id][2](); commitSoon(); }
      else drag = { mode: 'orbit', id: st.id, y0: e.clientY, v0: clamp01(CONTG[st.id]()), span: cv.getBoundingClientRect().width * 0.45 };
      return;
    }
    orbSel = hitItem && !(hitItem.kind === orbSel.kind && hitItem.i === orbSel.i) ? { kind: hitItem.kind, i: hitItem.i } : null;
    orbInfo(); return;
  }
  if (hitItem) { orbSel = { kind: hitItem.kind, i: hitItem.i }; orbInfo(); return; }
  const dx = w.x - G.cx, dy = w.y - G.cy;
  if (Math.abs(Math.hypot(dx, dy) - ORB_R[0] * G.R) < 0.09 * G.R) {
    const n = pattern.steps.length; let th = Math.atan2(dx, -dy); if (th < 0) th += TAU;
    const i = stepFromAngle(th, n), st = pattern.steps[i];
    if (st.on) setSteps(clearNote(pattern.steps, i));
    else { setSteps(placeNote(pattern.steps, i, st.degree ?? 0, st)); engine.audition(pattern.steps[i]); }
    commitSoon();
  }
}
function orbitMove(e) {
  const v = clamp01(drag.v0 + (drag.y0 - e.clientY) / drag.span);
  CONT[drag.id][1](v);
}
el('orb-back').addEventListener('click', () => { orbSel = null; orbInfo(); });
el('orb-rand').addEventListener('click', () => { actions.random(); commitSoon(); });
el('orb-mut').addEventListener('click', () => { actions.mut(); commitSoon(); });

// ---------- strony ----------
let glideMs = 50;
function setPage(p) {
  page = p; if (view !== 'classic') setView('classic'); el('dots').classList.toggle('row', p === 'drum');
  document.querySelectorAll('#pages button').forEach((b) => b.classList.toggle('on', b.dataset.page === p));
  if (p === 'syn' && tabSel.syn > 0 && tabSel.syn < tabNames('syn').length - 1) synSel = tabSel.syn - 1;
  renderSub(); renderPanel();
  fit(); updateInfo();
}
document.querySelectorAll('#pages button').forEach((b) => b.addEventListener('click', () => setPage(b.dataset.page)));

// ---------- odczyty ----------
function updateInfo() {
  const n = pattern.steps.length, pos = curPos();
  el('readout').textContent = `BPM ${engine.bpm}  BASE ${baseLabel()}  KEY ${MODE_LABEL[state.mode]}  STEP ${String(Math.floor(pos) + 1).padStart(2, '0')}/${n}`;
}
setInterval(() => { if (!el('radar').hidden) updateInfo(); }, 250);

// ---------- skróty (komputer) ----------
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || el('radar').hidden || (e.target instanceof HTMLElement && e.target.classList.contains('knob'))) return;
  if (!ctlPop.hidden) { if (e.code === 'Escape') { e.preventDefault(); showCtl(false); } return; }
  if (!menuPop.hidden) { if (e.code === 'Escape') { e.preventDefault(); showMenu(false); } return; }
  if (!bpmPop.hidden) { if (e.code === 'Escape') { e.preventDefault(); showBpm(false); } else if (e.code === 'ArrowUp') { e.preventDefault(); setBpm(engine.bpm + 1); } else if (e.code === 'ArrowDown') { e.preventDefault(); setBpm(engine.bpm - 1); } return; }
  const map = { Space: togglePlay, KeyR: () => { actions.random(); commitSoon(); }, KeyM: () => { actions.mut(); commitSoon(); },
    KeyZ: () => stepHistory(e.shiftKey ? 1 : -1),
    Digit1: () => setPage('seq'), Digit2: () => setPage('mix'), Digit3: () => setPage('syn'), Digit4: () => setPage('fx'), Digit5: () => setPage('drum'),
    ArrowUp: () => setBpm(engine.bpm + 2), ArrowDown: () => setBpm(engine.bpm - 2) };
  if (map[e.code]) { e.preventDefault(); if (e.target instanceof HTMLButtonElement) e.target.blur(); map[e.code](); }
});

// ---------- start ----------
el('go').addEventListener('click', async () => {
  await engine.start();
  applyGlobals();
  setPad(padPos.x, padPos.y);
  buildFx();
  el('start').hidden = true;
  el('radar').hidden = false; el('radar').classList.toggle('crt', crtOn);
  setPage('seq');
  pushHistory();
  engine.play(); lockScreen();
  showPlayState();
  cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
});
el('go').focus();
