// radarxxx: ekran radarowy jako interfejs sekwencera i miksu silników basu.
// Przemiatająca linia = głowica odtwarzania (jedno okrążenie = jeden obieg wzoru), nuty = echa z poświatą.
import { generateBass, mutate, DEFAULTS, withAccent, withSlide } from './generator.js';
import { Engine } from './audio.js';
import { VOICE_NAMES, PARAM_SPECS, clampToDisc, setGlideTime } from './engines.js';
import { FILTER_STYLES, FX_STYLES, mapValues } from './fx.js';
import { makeKnob, initKnobs } from './knob.js';
import { TAU, DEG_MIN, DEG_MAX, R_OUT, degToR, rToDeg, angleOfStep, polar, stepFromAngle, sweepPos, echoAlpha, echoes, placeNote, clearNote, moveNote, resizeSteps, nFromR, rFromN, nFromTheta, thetaFromN, delayCopies, bandPass, rotateSteps, reverseSteps, invertSteps, clearSteps, doubleSteps, halveSteps } from './radargeo.js';

const el = (id) => document.getElementById(id);
initKnobs();

const engine = new Engine();
const state = { ...DEFAULTS, seed: (Math.random() * 1e9) | 0, length: 16, accent: 0.5, slide: 0.1, oct: 0, latch: false };
// Akcenty i ślizgi są ustawiane pokrętłami i nakładane na każdy wzór (nowy, edytowany, zmutowany), bez generowania go od nowa.
const effRoot = () => Math.max(12, Math.min(83, state.root + 12 * (state.oct || 0)));   // tonika + przesunięcie oktawowe z pokrętła OKTAWA (−2..+2)
const finalize = (p) => withSlide(withAccent({ ...p, root: effRoot() }, state.accent), state.slide);
let pattern = finalize(generateBass(state));
engine.pattern = pattern;
let page = 'seq';
const tabSel = { seq: 0, mix: 0, syn: 0, fx: 0 };   // wybrana pod-zakładka każdej strony (0 = MAIN)
let synSel = 0;                                  // silnik edytowany na stronie SYN (0..3)
const globals = { cutoff: 0.5, reso: 0.5, master: 1, comp: 0.5, mdrive: 0 };   // ustawienia wyjściowe i filtra globalnego (do zapisu w presetach)
const padPos = { x: 0.25, y: 0.75 };
const cv = el('scope'), g = cv.getContext('2d');
let lastStep = { i: 0, t: 0 }, heldPos = 0;
engine.onStep = (i, t) => { lastStep = { i, t }; };

const INK = '11,11,11', ACC = '255,75,31', PAPER = '#a6abad';      // wariant „Specimen”: czarna kreska na szarym papierze, pomarańczowy akcent
const FONT = (px) => `${Math.round(px)}px 'VT323', ui-monospace, Menlo, monospace`;
const cutoffHz = (v) => 60 * Math.pow(100, v);

// ---------- wzór ----------
function setSteps(steps) { pattern = finalize({ ...pattern, steps }); engine.pattern = pattern; }
function regen() { pattern = finalize(generateBass(state)); engine.pattern = pattern; }

// ---------- pozycja linii ----------
function curPos() {
  const n = pattern.steps.length;
  if (!engine.playing || !engine.ctx) return heldPos;
  heldPos = sweepPos(lastStep.i, lastStep.t, engine.ctx.currentTime, 60 / engine.bpm / 4, n);
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

const geo = () => { const W = cv.width; return { W, cx: W / 2, cy: W / 2, R: W / 2, dpr: W / Math.max(1, cv.clientWidth) }; };
function sweepState() { const n = pattern.steps.length, pos = curPos(); return { n, pos, sw: (pos / n) * TAU }; }

function drawBase(G, S) {
  const { W, cx, cy, R, dpr } = G;
  g.fillStyle = PAPER; g.fillRect(0, 0, W, W);
  // pierścienie zakresu (bez opisów liczbowych): co drugi stopień skali, oktawa i tonika mocniej
  for (let d = DEG_MIN; d <= DEG_MAX - 1; d++) {
    if (d % 2 !== 0 && d !== 7) continue;
    circle(cx, cy, degToR(d) * R, d === 0 || d === 7 ? `rgba(${INK},.75)` : `rgba(${INK},.22)`, dpr);
  }
  circle(cx, cy, R * (R_OUT + 0.075), `rgba(${INK},.3)`, dpr, [3 * dpr, 5 * dpr]);
  // obrzeże: kreski kroków i bieżący krok
  circle(cx, cy, R * 0.985, `rgba(${INK},1)`, dpr);
  const { n, pos } = S, hot = Math.floor(pos) % n;
  for (let k = 0; k < n * 4; k++) {
    const a = (k / (n * 4)) * TAU, major = k % 4 === 0;
    const [x0, y0] = polarXY(cx, cy, R * (major ? 0.935 : 0.96), a), [x1, y1] = polarXY(cx, cy, R * 0.985, a);
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1);
    g.strokeStyle = major ? `rgba(${INK},1)` : `rgba(${INK},.35)`; g.lineWidth = dpr; g.stroke();
  }
  { const a = angleOfStep(hot, n), [x0, y0] = polarXY(cx, cy, R * 0.9, a), [x1, y1] = polarXY(cx, cy, R * 0.985, a);
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.strokeStyle = `rgba(${ACC},1)`; g.lineWidth = 3 * dpr; g.stroke(); }
  { const [x, y] = polarXY(cx, cy, R * 0.985, 0), [x2, y2] = polarXY(cx, cy, R * 0.94, -0.045), [x3, y3] = polarXY(cx, cy, R * 0.94, 0.045);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.lineTo(x3, y3); g.closePath(); g.fillStyle = `rgba(${ACC},1)`; g.fill(); }
  // ślad za linią: cienkie kreski, coraz słabsze (jak kreskowanie w druku)
  for (let k = 0; k < 14; k++) {
    const a = S.sw - k * (TAU / 90), [x0, y0] = polarXY(cx, cy, R * 0.12, a), [x1, y1] = polarXY(cx, cy, R * 0.93, a);
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1);
    g.strokeStyle = `rgba(${INK},${(0.22 * (1 - k / 14)).toFixed(3)})`; g.lineWidth = dpr; g.stroke();
  }
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
function drawCorners(G, defs) {
  const { W, cx, cy, R, dpr } = G, rd = W * 0.044, size = W * 0.047, sz2 = W * 0.036;
  const ang = [-Math.PI / 4, Math.PI / 4, (5 * Math.PI) / 4, (3 * Math.PI) / 4];
  defs.forEach((d, i) => {
    if (!d) return;
    const top = i < 2, left = i % 2 === 0, x = left ? rd : W - rd, y = top ? rd : W - rd, a = d.dim ? 0.4 : 1;
    g.beginPath(); g.arc(x, y, rd, 0, TAU);
    if (d.lit === false) { g.strokeStyle = `rgba(${ACC},${a})`; g.lineWidth = 2 * dpr; g.stroke(); }
    else { g.fillStyle = `rgba(${ACC},${a})`; g.fill(); }
    const rMain = R * (top ? 0.79 : 0.9), rSub = R * (top ? 0.68 : 0.79);
    arcText(d.label, cx, cy, rMain, ang[i], top, size, `rgba(${INK},${a})`);
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

const PAD_R = 0.68;      // promień pada MIX (ułamek promienia radaru): diamenty silników stoją wewnątrz napisów w rogach
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
  PAD_ANCHORS.forEach(([ax, ay], i) => {
    const x = cx + ax * Rp, y = cy - ay * Rp, w = engine.blend[i] || 0, on = engine.enabled[i];
    if (on) { g.beginPath(); g.moveTo(mx, my); g.lineTo(x, y); g.strokeStyle = `rgba(${ACC},${(0.15 + 0.7 * w).toFixed(3)})`; g.lineWidth = (1 + 2 * w) * dpr; g.setLineDash([5 * dpr, 4 * dpr]); g.stroke(); g.setLineDash([]); }
    const sz = R * (0.04 + 0.03 * w);
    g.save(); g.translate(x, y); g.rotate(Math.PI / 4);
    g.strokeStyle = on ? `rgba(${INK},1)` : `rgba(${INK},.35)`; g.lineWidth = 1.6 * dpr; g.strokeRect(-sz, -sz, 2 * sz, 2 * sz);
    if (on) { g.fillStyle = w === Math.max(...engine.blend) ? `rgb(${ACC})` : `rgba(${INK},${(0.25 + 0.6 * w).toFixed(3)})`; g.fillRect(-sz, -sz, 2 * sz, 2 * sz); }   // najsilniejszy silnik na pomarańczowo
    g.restore();
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
  stage(X, 1); stage(X2, 0.7);
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

let raf = 0;
function loop(ts) {
  if (!el('radar').hidden) { if (page === 'mix') drawMix(); else if (page === 'fx') drawFx(ts); else if (page === 'syn') drawSyn(); else drawSeq(); }
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
  state: { root: state.root, mode: state.mode, accent: state.accent, slide: state.slide, oct: state.oct, swing: state.swing, seed: state.seed, density: state.density, syncopation: state.syncopation, latch: state.latch },
  audio: { bpm: engine.bpm, gate: engine.gateMul, human: engine.human, ghost: engine.ghost, velo: engine.velo, types: engine.types, enabled: engine.enabled, levels: engine.levels, solo: engine.solo, xy: engine.xy, eq: engine.eq, vOct: engine.vOct, vTune: engine.vTune, vEq: engine.vEq, params: engine.voices.map((v) => v.params) },
  globals, ctl: fxCtl, warp: warpIdx,
  fx: [engine.fx.filter, engine.fx.fx, engine.fx.fx2].map((x) => ({ style: x.style, values: x.values, bypass: x.bypass })),
}));
function applyGlobals() {
  engine.setCutoff(cutoffHz(globals.cutoff)); engine.setResonance(1 + globals.reso * 22);
  engine.setMaster(globals.master); engine.setComp(globals.comp); engine.setDrive(globals.mdrive);
}
function restore(sn) {
  pattern = sn.pattern; engine.pattern = pattern;
  Object.assign(state, sn.state); engine.latch = state.latch;
  const a = sn.audio;
  engine.setBpm(a.bpm); engine.gateMul = a.gate; engine.human = a.human; engine.ghost = a.ghost; engine.velo = a.velo;
  a.types.forEach((t, i) => { if (engine.types[i] !== t) engine.setType(i, t); });
  a.params.forEach((pr, i) => Object.entries(pr).forEach(([id, v]) => { if (id in engine.voices[i].params) engine.setParam(i, id, v); }));
  a.enabled.forEach((on, i) => engine.setEnabled(i, on)); a.levels.forEach((v, i) => engine.setLevel(i, v)); engine.setSolo(a.solo);
  a.eq.forEach((v, b) => engine.setEq(b, v));
  a.vOct.forEach((v, i) => { engine.vOct[i] = v; }); a.vTune.forEach((v, i) => { engine.vTune[i] = v; });
  a.vEq.forEach((pair, i) => pair.forEach((v, b) => engine.setVoiceEq(i, b, v)));
  setPad(a.xy[0], a.xy[1]);
  Object.assign(globals, sn.globals); applyGlobals();
  fxCtl = sn.ctl; warpIdx = sn.warp || 0;
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
  // MUTATE: losuje ustawienia syntezatorów (parametry i obwiednie włączonych silników, w rozsądnych granicach). Wzór nut zostaje.
  mut: () => { engine.enabled.forEach((on, i) => { if (on) engine.randomizeVoice(i); }); renderPanel(); },
  latch: () => { state.latch = !state.latch; engine.latch = state.latch; toast(state.latch ? 'LATCH: WŁ.' : 'LATCH: WYŁ.'); },
  // WARP: kolejne dotknięcia przekształcają wzór: obrót o krok, odbicie wysokości, odwrócenie kolejności
  warp: () => { const [name, fn] = WARP_OPS[warpIdx % WARP_OPS.length]; warpIdx++; setSteps(fn(pattern.steps)); toast(`WARP: ${name}`); },
  steps: (fn, name) => () => { setSteps(fn(pattern.steps)); if (name) toast(name); },
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
        makeKnob(k, { label: sp.label.toUpperCase(), min: 0, max: 1, step: 0.001, value: slot.values[slot.style][sp.id], def: sp.def, show: (n) => sp.show(sp.map(n)) });
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
  makeKnob(k, { label, min, max, step, value, def, fmt: 'num' });
  k.addEventListener('input', () => onInput(k.value));
  return k;
}
// Okrągły przycisk z nazwą nad nim. kind: 'act' (pomarańczowy, jednorazowy) albo 'tog' (zapalony = włączony).
function cellButton(parent, { kind, label, on, act }) {
  const c = document.createElement('div'), b = document.createElement('button'), l = document.createElement('span');
  c.className = `cellbtn ${kind === 'tog' ? 'tog' : 'act'}`; l.className = 'cl'; c.appendChild(l); c.appendChild(b);
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

// ---------- zawartość zakładek ----------
const panelEl = el('panel');
const tabNames = (p) => ({
  seq: ['MAIN', 'SEQ', 'SCALE', 'EXTRA'],
  mix: ['MAIN', ...VOICE_NAMES.map((_, i) => TAB_SHORT[engine.types[i]])],
  syn: ['MAIN', ...VOICE_NAMES.map((_, i) => TAB_SHORT[engine.types[i]])],
  fx: ['MAIN', 'FLT', 'FX1', 'FX2', 'MSTR'],
})[p];
function renderSub() {
  const host = el('subtabs'), names = tabNames(page);
  host.innerHTML = ''; host.classList.toggle('five', names.length > 4);
  names.forEach((n, i) => {
    const b = document.createElement('button'); b.textContent = n; b.className = i === tabSel[page] ? 'on' : '';
    b.addEventListener('click', () => { tabSel[page] = i; if (page === 'syn' && i > 0) synSel = i - 1; renderSub(); renderPanel(); });
    host.appendChild(b);
  });
}
const specOfType = (t, id) => PARAM_SPECS[t].find((x) => x.id === id);
const SHORT_LAB = { fEnv: 'F.ENV', fDec: 'F.ZAN.', aDec: 'A.ZAN.', aRel: 'A.REL.', aSus: 'A.SUST.', aAtk: 'A.ATAK' };   // krótkie nazwy, żeby mieściły się nad pokrętłem
const labOf = (sp) => SHORT_LAB[sp.id] || sp.label.toUpperCase();

function renderPanel() {
  panelEl.replaceChildren();
  Object.keys(synRefs).forEach((k) => delete synRefs[k]); Object.keys(macroRefs).forEach((k) => delete macroRefs[k]); Object.keys(fxMainRefs).forEach((k) => delete fxMainRefs[k]);
  const grid = document.createElement('div'); grid.className = 'pgrid';
  const tab = tabSel[page], B = (o) => cellButton(grid, o), Kn = (...a) => grid.appendChild(synKnob(...a)), Sp = () => spacer(grid);

  if (page === 'seq') {
    panelEl.appendChild(grid);
    if (tab === 0) {
      Kn('GATE', 0.4, 1.6, 0.01, engine.gateMul, 1, (v) => { engine.gateMul = v; });
      Kn('SWING', 0, 0.4, 0.01, state.swing, 0, (v) => { state.swing = v; pattern = { ...pattern, swing: v }; engine.pattern = pattern; });
      Kn('ACCENT', 0, 1, 0.01, state.accent, 0.5, (v) => { state.accent = v; refin(); });
      Kn('SLIDE', 0, 1, 0.01, state.slide, 0.1, (v) => { state.slide = v; refin(); });
      Kn('OKTAWA', -2, 2, 1, state.oct, 0, (v) => { state.oct = Math.round(v); refin(); engine.audition({ degree: 0, octave: 0, vel: 100 }); });
      Kn('TEMPO', 70, 180, 1, engine.bpm, 130, (v) => setBpm(v));
      Kn('LENGTH', 8, 32, 4, pattern.steps.length, 16, (v) => { const n = Math.round(v); if (n !== pattern.steps.length) setSteps(resizeSteps(pattern.steps, n)); });
      let last = 0; Kn('SHIFT', -4, 4, 1, 0, 0, (v) => { const d = Math.round(v) - last; last = Math.round(v); if (d) setSteps(rotateSteps(pattern.steps, d)); });
      Kn('HUMAN', 0, 1, 0.01, engine.human, 0, (v) => { engine.human = v; });
      B({ kind: 'act', label: () => 'RANDOM', act: actions.random });
    } else if (tab === 1) {
      const A = (name, fn) => B({ kind: 'act', label: () => name, act: actions.steps(fn) });
      A('CLEAR', clearSteps); A('REVERSE', reverseSteps); A('INVERT', invertSteps); A('ROT ←', (st) => rotateSteps(st, -1)); A('ROT →', (st) => rotateSteps(st, 1));
      A('DOUBLE', doubleSteps); A('HALF', halveSteps);
      Kn('GHOST', 0, 1, 0.01, engine.ghost, 0, (v) => { engine.ghost = v; });
      Sp(); B({ kind: 'act', label: () => 'RANDOM', act: actions.random });
    } else if (tab === 2) {
      stepRow(grid, 'BASE', baseLabel, () => actions.base(-1), () => actions.base(1));
      stepRow(grid, 'KEY', () => MODE_LABEL[state.mode], () => actions.key(-1), () => actions.key(1));
    } else {
      Kn('CUTOFF', 0, 1, 0.001, globals.cutoff, 0.5, (v) => { globals.cutoff = v; engine.setCutoff(cutoffHz(v)); });
      Kn('RESO', 0, 1, 0.01, globals.reso, 0.5, (v) => { globals.reso = v; engine.setResonance(1 + v * 22); });
      Kn('GLIDE', 0, 200, 5, glideMs, 50, (v) => { glideMs = v; setGlideTime(v / 1000); });
      Kn('VELO', 0.4, 1, 0.01, engine.velo, 1, (v) => { engine.velo = v; });
    }
  } else if (page === 'mix') {
    panelEl.appendChild(grid);
    if (tab === 0) {
      ['LOW', 'MID', 'HIGH'].forEach((n, b) => Kn(n, -12, 12, 0.5, engine.eq[b], 0, (v) => engine.setEq(b, v)));
      const sec = fxSecs[1];
      Kn('SEND', 0, 1, 0.01, sec.slot.values[sec.slot.style].mix, 0, (v) => setFxParam(sec, 'mix', v));
      B({ kind: 'tog', label: () => 'FILTR', on: () => !fxSecs[0].slot.bypass, act: () => bypass(0) });
      Kn('MASTER', 0, 1.2, 0.01, globals.master, 1, (v) => { globals.master = v; engine.setMaster(v); });
      Sp(); Sp(); Sp(); B({ kind: 'act', label: () => 'RANDOM', act: () => { engine.enabled.forEach((on, i) => { if (on) engine.randomizeVoice(i); }); } });
    } else {
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
    }
  } else if (page === 'syn') {
    panelEl.appendChild(grid);
    if (tab === 0) {
      // makra: jedno pokrętło ustawia ten parametr we wszystkich czterech silnikach
      const macro = (label, id) => { const sp = specOfType(engine.types[0], id); const k = synKnob(label, sp.min, sp.max, sp.step, engine.voices[0].params[id], sp.def, (v) => VOICE_NAMES.forEach((_, i) => engine.setParam(i, id, v))); macroRefs[id] = k; grid.appendChild(k); };
      Kn('CUTOFF', 0, 1, 0.001, globals.cutoff, 0.5, (v) => { globals.cutoff = v; engine.setCutoff(cutoffHz(v)); });
      Kn('RESO', 0, 1, 0.01, globals.reso, 0.5, (v) => { globals.reso = v; engine.setResonance(1 + v * 22); });
      macro('F.ENV', 'fEnv'); macro('F.ZAN.', 'fDec'); macro('A.ZAN.', 'aDec');
      macro('A.SUST.', 'aSus'); macro('A.REL.', 'aRel'); macro('A.ATAK', 'aAtk');
      Sp(); B({ kind: 'act', label: () => 'RANDOM', act: () => { engine.enabled.forEach((on, i) => { if (on) engine.randomizeVoice(i); }); renderPanel(); } });
    } else {
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
    }
  } else {
    if (tab === 0) {
      panelEl.appendChild(grid);
      const fk = (j, id) => { const sec = fxSecs[j], si = sec.slot.style, sp = sec.styles[si].params.find((x) => x.id === id); if (!sp) return Sp(); const k = document.createElement('div'); makeKnob(k, { label: sp.label.toUpperCase(), min: 0, max: 1, step: 0.001, value: sec.slot.values[si][id], def: sp.def, show: (n) => sp.show(sp.map(n)) }); k.addEventListener('input', () => setFxParam(sec, id, k.value)); fxMainRefs[`${j}:${id}`] = k; grid.appendChild(k); };
      const fp = fxSecs[0].styles[fxSecs[0].slot.style].params.map((x) => x.id), ep = fxSecs[1].styles[fxSecs[1].slot.style].params.map((x) => x.id);
      [fp[0], fp[1], fp[2], 'mix', fp.includes('tone') ? 'tone' : fp[3]].forEach((id) => fk(0, id));
      [ep[0], ep[1], ep[2], 'mix'].forEach((id) => fk(1, id));
      B({ kind: 'act', label: () => 'RANDOM', act: () => { fxSecs.slice(0, 2).forEach((x) => x.randomize()); renderPanel(); } });
    } else if (tab === 4) {
      panelEl.appendChild(grid);
      Kn('MASTER', 0, 1.2, 0.01, globals.master, 1, (v) => { globals.master = v; engine.setMaster(v); });
      Kn('COMP', 0, 1, 0.01, globals.comp, 0.5, (v) => { globals.comp = v; engine.setComp(v); });
      Kn('DRIVE', 0, 1, 0.01, globals.mdrive, 0, (v) => { globals.mdrive = v; engine.setDrive(v); });
    } else {
      panelEl.appendChild(fxSecs[tab - 1].sec);
    }
  }
}

// ---------- kropki w rogach ----------
const ctlLabel = ['OBA', 'FILTR', 'EFEKT'];
function dotList() {
  if (page === 'seq') return [
    { label: 'RANDOM', act: actions.random }, { label: 'MUTATE', act: actions.mut },
    { label: 'LATCH', lit: state.latch, act: actions.latch }, { label: 'WARP', sub: `› ${WARP_OPS[warpIdx % WARP_OPS.length][0]}`, act: actions.warp },
  ];
  if (page === 'mix') {
    const top = Math.max(...engine.blend);
    return VOICE_NAMES.map((_, i) => ({ label: typeName(i), lit: !!engine.enabled[i] && engine.blend[i] === top, dim: !engine.enabled[i], act: () => setPad(i % 2 === 0 ? 0 : 1, i < 2 ? 1 : 0) }));
  }
  if (page === 'syn') {
    const eff = engine.eff.map((v, i) => (engine.enabled[i] ? v : 0)), top = Math.max(...eff, 1e-6), lead = eff.indexOf(Math.max(...eff));
    return VOICE_NAMES.map((_, i) => ({ label: typeName(i), lit: tabSel.syn !== 0 && i === synSel, dim: !engine.enabled[i], bar: eff[i] / top, barHot: i === lead && eff[i] > 0, act: () => { synSel = i; tabSel.syn = i + 1; renderSub(); renderPanel(); } }));
  }
  const nameOf = (j, id) => (fxSecs[j].styles[fxSecs[j].slot.style].params.find((sp) => sp.id === id)?.label || id).toUpperCase();
  const hint = (j) => { const m = macroOf(j); return `r ${m.r.map((id) => nameOf(j, id)).join('+')} ∠ ${m.a.map((id) => nameOf(j, id)).join('+')}`; };
  return [
    { label: 'FILTR', sub: hint(0), lit: !fxSecs[0].slot.bypass, dim: !driven().includes(0), act: () => bypass(0) },
    { label: 'EFEKT', sub: hint(1), lit: !fxSecs[1].slot.bypass, dim: !driven().includes(1), act: () => bypass(1) },
    { label: ctlLabel[fxCtl], sub: 'STEROW.', act: () => { fxCtl = (fxCtl + 1) % 3; } },
    { label: 'STYLE', sub: short8(fxSecs[fxStyleTarget()].styles[fxSecs[fxStyleTarget()].slot.style].name.toUpperCase()), act: () => cycleStyle(fxStyleTarget()) },
  ];
}
function dotDefs() { return dotList(); }
el('dots').addEventListener('click', (e) => {
  const b = e.target.closest('.dot'); if (!b) return;
  dotList()[+b.dataset.i].act(); commitSoon();
});
el('dots').addEventListener('pointerdown', (e) => e.stopPropagation());

// zmiany pokręteł i dotyk na radarze zapisują się w historii z opóźnieniem
panelEl.addEventListener('input', commitSoon);
cv.addEventListener('pointerup', commitSoon);

// ---------- strony ----------
let glideMs = 50;
function setPage(p) {
  page = p;
  document.querySelectorAll('#pages button').forEach((b) => b.classList.toggle('on', b.dataset.page === p));
  if (p === 'syn' && tabSel.syn > 0) synSel = tabSel.syn - 1;
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
  if (!menuPop.hidden) { if (e.code === 'Escape') { e.preventDefault(); showMenu(false); } return; }
  if (!bpmPop.hidden) { if (e.code === 'Escape') { e.preventDefault(); showBpm(false); } else if (e.code === 'ArrowUp') { e.preventDefault(); setBpm(engine.bpm + 1); } else if (e.code === 'ArrowDown') { e.preventDefault(); setBpm(engine.bpm - 1); } return; }
  const map = { Space: togglePlay, KeyR: () => { actions.random(); commitSoon(); }, KeyM: () => { actions.mut(); commitSoon(); },
    KeyZ: () => stepHistory(e.shiftKey ? 1 : -1),
    Digit1: () => setPage('seq'), Digit2: () => setPage('mix'), Digit3: () => setPage('syn'), Digit4: () => setPage('fx'),
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
  el('radar').hidden = false;
  setPage('seq');
  pushHistory();
  engine.play(); lockScreen();
  el('play').textContent = '■'; el('play').classList.add('on');
  cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
});
el('go').focus();
