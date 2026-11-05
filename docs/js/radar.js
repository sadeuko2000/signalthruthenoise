// radarxxx: ekran radarowy jako interfejs sekwencera i miksu silników basu.
// Przemiatająca linia = głowica odtwarzania (jedno okrążenie = jeden obieg wzoru), nuty = echa z poświatą.
import { generateBass, mutate, DEFAULTS, withAccent, withSlide } from './generator.js';
import { Engine } from './audio.js';
import { VOICE_NAMES, PARAM_SPECS, clampToDisc } from './engines.js';
import { FILTER_STYLES, FX_STYLES, mapValues } from './fx.js';
import { makeKnob, initKnobs } from './knob.js';
import { TAU, DEG_MIN, DEG_MAX, R_OUT, degToR, rToDeg, angleOfStep, polar, stepFromAngle, sweepPos, echoAlpha, echoes, placeNote, clearNote, moveNote, resizeSteps, nFromR, rFromN, nFromTheta, thetaFromN, delayCopies, bandPass } from './radargeo.js';

const el = (id) => document.getElementById(id);
initKnobs();

const engine = new Engine();
const state = { ...DEFAULTS, seed: (Math.random() * 1e9) | 0, length: 16, accent: 0.5, slide: 0.1 };
// Akcenty i ślizgi są ustawiane pokrętłami i nakładane na każdy wzór (nowy, edytowany, zmutowany), bez generowania go od nowa.
const finalize = (p) => withSlide(withAccent(p, state.accent), state.slide);
let pattern = finalize(generateBass(state));
engine.pattern = pattern;
let page = 'seq';
let synSel = 0, synView = 0;                    // strona SYN: wybrany silnik (0..3) i widok (0 brzmienie, 1 obwiednie)
let fxActive = 0;                              // sekcja FX, której pokrętła widać (0 filtr, 1 efekt)
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
}

const PAD_ANCHORS = [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([a, b]) => [a * Math.SQRT1_2, b * Math.SQRT1_2]);
const SHORT = ['PROPHET', 'MS-20', 'DX', 'WAVETBL'];
function drawMix() {
  const G = geo(), S = sweepState(), { cx, cy, R, dpr } = G, Rp = R * R_OUT;
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
    g.textAlign = ax < 0 ? 'left' : 'right';
    g.fillStyle = on ? `rgba(${INK},1)` : `rgba(${INK},.4)`;
    g.fillText(SHORT[i], ax < 0 ? cx - R * 0.97 : cx + R * 0.97, ay > 0 ? cy - R * 0.9 : cy + R * 0.9);
  });
  g.strokeStyle = `rgba(${ACC},1)`; g.lineWidth = 1.6 * dpr;
  g.beginPath(); g.arc(mx, my, R * 0.05, 0, TAU); g.moveTo(mx - R * 0.09, my); g.lineTo(mx + R * 0.09, my); g.moveTo(mx, my - R * 0.09); g.lineTo(mx, my + R * 0.09); g.stroke();
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
const macroOf = (j) => MACRO[j][fxSecs[j].slot.style];
const polarIds = (j, si) => [MACRO[j][si].r[0], MACRO[j][si].a[0]];     // parametry pokazywane kursorem
const mixFromR = (rN) => 0.08 + 0.84 * rN;                              // mix efektu rośnie od środka ku brzegowi

function drawFx(ts) {
  const G = geo(), S = sweepState(), { cx, cy, R, dpr } = G, { n, pos } = S;
  drawBase(G, S);
  const E = echoes(pattern.steps);
  const rp = (nn) => rFromN(nn) * R;
  const ring = (r, glow, a = 1) => circle(cx, cy, r, `rgba(${ACC},${a})`, (1.5 + glow * 5) * dpr);
  const read = (sec) => { const si = sec.slot.style, nv = sec.slot.values[si]; return { si, nv, m: mapValues(sec.styles[si], nv), on: !sec.slot.bypass }; };
  const F = read(fxSecs[0]), X = read(fxSecs[1]);
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

  // 2) efekt: działa na to, co przeszło przez filtr
  if (X.on) {
    const mix = clamp01(X.m.mix ?? 1);
    if (X.si === 0) {                              // delay: kolejne, coraz cichsze powtórzenia echa o `time` kroków dalej
      const copies = delayCopies(X.m.time, X.m.feedback, 4), f = 0.2 + 0.8 * mix;
      E.forEach((e) => copies.forEach((c) => drawEcho(G, e, echoAlpha(e.i + c.shift, pos, n) * c.gain * f * through(e), { da: (c.shift / n) * TAU, raw: true, lw: 0.8, col: INK })));
    } else if (X.si === 1) {                       // pogłos: fala rozchodzi się od echa po jego przemiataniu
      const life = n * (0.25 + 0.5 * X.nv.size), f = 0.15 + 0.7 * mix;
      E.forEach((e) => {
        const delta = (((pos - e.i) % n) + n) % n;
        if (delta > life) return;
        const t = delta / life, a = e.a0 + e.len / 2 - Math.PI / 2;
        circle(cx + Math.cos(a) * e.r * R, cy + Math.sin(a) * e.r * R, t * R * (0.12 + 0.5 * X.nv.size), `rgba(${INK},${((1 - t) * f * through(e)).toFixed(3)})`, 1.2 * dpr);
      });
    } else if (X.si === 2) {                       // chorus: echa podwojone i lekko rozstrojone, wahające się z tempem LFO
      const off = X.nv.depth * 0.07 * Math.sin((ts / 1000) * TAU * Math.min(X.m.rate, 4) * 0.5), f = 0.2 + 0.8 * mix;
      E.forEach((e) => { base(e, 0.55 * f * through(e), { da: off, raw: true, lw: 0.85 }); base(e, 0.4 * f * through(e), { da: -off * 1.3, raw: true, lw: 0.85 }); });
    } else {                                       // dystorsja: echa spłaszczone do pierścienia obcięcia (od miękkiej do „fold”)
      const dr = X.nv.drive, rc = R * (R_OUT - 0.4 * dr), f = 0.25 + 0.75 * mix;
      circle(cx, cy, rc, `rgba(${ACC},.6)`, dpr, [4 * dpr, 4 * dpr]);
      E.forEach((e) => {
        const r0 = e.r * R, r1 = r0 > rc ? (X.nv.curve > 0.5 ? rc - (r0 - rc) * 0.7 : rc) : r0;
        base(e, f * through(e), { r: r1, lw: 1 + dr * 0.9, col: ACC, noGlow: true });
      });
    }
  }
  rings.forEach((r) => ring(r, glow));
  drawSweepLine(G, S);

  // kursory: pełny krzyżyk = pierwsza sterowana sekcja, pusty znacznik = druga (widać, że oba parametry „podążają” za dotykiem)
  const cursorOf = (j) => { const sec = fxSecs[j], ids = polarIds(j, sec.slot.style), nv = sec.slot.values[sec.slot.style]; return { r: rp(nv[ids[0]]), a: thetaFromN(nv[ids[1]]) }; };
  const ds = driven(), c0 = cursorOf(ds[0]);
  const [bx, by] = polarXY(cx, cy, R * 0.94, c0.a), [kx, ky] = polarXY(cx, cy, c0.r, c0.a);
  g.setLineDash([4 * dpr, 4 * dpr]); g.beginPath(); g.moveTo(cx, cy); g.lineTo(bx, by); g.strokeStyle = `rgba(${ACC},.55)`; g.lineWidth = dpr; g.stroke(); g.setLineDash([]);
  g.strokeStyle = `rgba(${ACC},1)`; g.lineWidth = 1.6 * dpr;
  g.beginPath(); g.arc(kx, ky, R * 0.045, 0, TAU); g.moveTo(kx - R * 0.08, ky); g.lineTo(kx + R * 0.08, ky); g.moveTo(kx, ky - R * 0.08); g.lineTo(kx, ky + R * 0.08); g.stroke();
  // rogi: parametry modulowane dotykiem (r = odległość od środka, kąt = obrót). Sekcja niesterowana jest przygaszona.
  g.font = FONT(R * 0.085); g.textBaseline = 'middle';
  const nameOf = (j, id) => (fxSecs[j].styles[fxSecs[j].slot.style].params.find((sp) => sp.id === id)?.label || id).toUpperCase();
  const W = g.canvas.width, H = g.canvas.height, pad = 6 * dpr;
  [[0, 0], [1, 1]].forEach(([j]) => {
    const m = macroOf(j), on = ds.includes(j) ? 1 : 0.3, y = j === 0 ? pad + R * 0.05 : H - pad - R * 0.05;
    g.fillStyle = `rgba(${INK},${on})`;
    g.textAlign = 'left';  g.fillText(`${j === 0 ? 'F' : 'E'} r ${m.r.map((id) => nameOf(j, id)).join('+')}`, pad, y);
    g.textAlign = 'right'; g.fillText(`${j === 0 ? 'F' : 'E'} ∠ ${m.a.map((id) => nameOf(j, id)).join('+')}`, W - pad, y);
  });
  if (ds.length > 1) { const c1 = cursorOf(ds[1]), [hx, hy] = polarXY(cx, cy, c1.r, c1.a); g.beginPath(); g.arc(hx, hy, R * 0.03, 0, TAU); g.strokeStyle = `rgba(${ACC},.8)`; g.lineWidth = 1.4 * dpr; g.stroke(); }
}

// ---------- SYN: parametry silników na ekranie radarowym ----------
// Dotyk ustawia „kształt dźwięku” wybranego silnika: odległość od środka = siła obwiedni filtra (zryw na początku nuty),
// kąt = jej zanik. Na ekranie echa dostają kolec (siła) i ogon (zanik) odpowiadające tym wartościom.
const specOf = (i, id) => PARAM_SPECS[i].find((x) => x.id === id);
const normParam = (i, id) => { const sp = specOf(i, id); return clamp01((engine.voices[i].params[id] - sp.min) / (sp.max - sp.min)); };
function setEngParam(i, id, nn) {
  const sp = specOf(i, id), raw = sp.min + clamp01(nn) * (sp.max - sp.min), v = Math.round(raw / sp.step) * sp.step;
  engine.setParam(i, id, v);
  if (i === synSel && synRefs[id]) synRefs[id].value = v;
}
function synFrom(p) { setEngParam(synSel, 'fEnv', nFromR(p.rn)); setEngParam(synSel, 'fDec', nFromTheta(p.theta)); }

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
  // proporcje głośności silników w rogach: długość paska = udział względem najgłośniejszego, najgłośniejszy na pomarańczowo, wybrany ze znacznikiem
  const eff = engine.eff.map((v, i) => (engine.enabled[i] ? v : 0)), top = Math.max(...eff, 1e-6), lead = eff.indexOf(Math.max(...eff));
  g.font = FONT(R * 0.085); g.textBaseline = 'middle';
  VOICE_NAMES.forEach((_, i) => {
    const left = i % 2 === 0, topRow = i < 2, x0 = left ? cx - R * 0.97 : cx + R * 0.97, share = eff[i] / top;
    const ty = topRow ? cy - R * 0.9 : cy + R * 0.9, by = topRow ? ty + R * 0.11 : ty - R * 0.11, bw = R * 0.5, bh = R * 0.045;
    g.textAlign = left ? 'left' : 'right';
    g.fillStyle = `rgba(${INK},${engine.enabled[i] ? 1 : 0.4})`;
    g.fillText((i === synSel ? '▸' : '') + SHORT[i], x0, ty);
    const bx = left ? x0 : x0 - bw;
    g.strokeStyle = `rgba(${INK},.35)`; g.lineWidth = dpr; g.strokeRect(bx, by - bh / 2, bw, bh);
    g.fillStyle = i === lead && eff[i] > 0 ? `rgb(${ACC})` : `rgba(${INK},.8)`;
    const fw = bw * share; g.fillRect(left ? bx : bx + bw - fw, by - bh / 2, fw, bh);
  });
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
function mixFrom(p) { const Rp = p.R * R_OUT; setPad((p.dx / Rp + 1) / 2, (-p.dy / Rp + 1) / 2); }
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

// ---------- pokrętła ----------
el('gate').addEventListener('input', (e) => { engine.gateMul = +e.target.value; });
el('accent').addEventListener('input', (e) => { state.accent = +e.target.value; pattern = finalize(pattern); engine.pattern = pattern; });
el('slide').addEventListener('input', (e) => { state.slide = +e.target.value; pattern = finalize(pattern); engine.pattern = pattern; });
// Swing zmienia tylko rytm (opóźnienie parzystych kroków), nuty zostają: wzór nie jest generowany od nowa.
el('swing').addEventListener('input', (e) => { state.swing = +e.target.value; pattern = { ...pattern, swing: state.swing }; engine.pattern = pattern; });
el('cutoff').addEventListener('input', (e) => engine.setCutoff(cutoffHz(+e.target.value)));
el('reso').addEventListener('input', (e) => engine.setResonance(1 + e.target.value * 22));

// ---------- akcje ----------
const between = (a, b) => a + Math.random() * (b - a);
const MODE_CYCLE = ['electro', 'phrygian', 'minor'];
const MODE_LABEL = { electro: 'ELEKTRO', phrygian: 'FRYG', minor: 'MOLL' };
const MODE_SHORT = { electro: 'ELEK', phrygian: 'FRYG', minor: 'MOLL' };
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
  mut: () => { pattern = finalize(mutate(pattern)); engine.pattern = pattern; },
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
// Tempo: na ekranie mały napis „xxx BPM”, po dotknięciu okienko z dużą wartością i przyciskami − / + (przytrzymanie powtarza).
const bpmPop = el('bpm-pop');
const showBpm = (on) => { bpmPop.hidden = !on; if (on) el('bpm-ok').focus(); };
el('bpm-open').addEventListener('click', () => showBpm(true));
el('bpm-ok').addEventListener('click', () => showBpm(false));
bpmPop.addEventListener('pointerdown', (e) => { if (e.target === bpmPop) showBpm(false); });   // dotknięcie tła zamyka
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

// okienko BASE / KEY: nuta bazowa (półtony) i skala w jednym miejscu, zmiany słychać od razu
const keyPop = el('key-pop');
const refreshKeyPop = () => { el('kp-base').textContent = baseLabel(); el('kp-key').textContent = MODE_LABEL[state.mode]; };
function showKey(on) { keyPop.hidden = !on; if (on) { refreshKeyPop(); el('kp-ok').focus(); } else renderKeys(); }
keyPop.addEventListener('pointerdown', (e) => { if (e.target === keyPop) showKey(false); });
el('kp-ok').addEventListener('click', () => showKey(false));
const kpDo = (fn) => () => { fn(); refreshKeyPop(); };
el('kp-base-').addEventListener('click', kpDo(() => actions.base(-1)));
el('kp-base+').addEventListener('click', kpDo(() => actions.base(1)));
el('kp-key+').addEventListener('click', kpDo(() => actions.key()));
el('kp-key-').addEventListener('click', kpDo(() => { actions.key(); actions.key(); }));   // 3 skale: dwa kroki w przód = jeden w tył

// ---------- przyciski kontekstowe (zależne od strony) ----------
const rnd = (i) => { const vals = engine.randomizeVoice(i); return vals; };
const short8 = (t) => (t.length > 8 ? `${t.slice(0, 7)}.` : t);       // napis w przycisku mieści się w komórce (np. DRABINK.)
const KEYS = {
  seq: [
    { label: 'BASE/KEY', value: () => `${baseLabel()} ${MODE_SHORT[state.mode]}`, act: () => showKey(true) },
    { label: 'OKTAWA', value: () => String(rootParts().oct), act: () => actions.octave(1), alt: () => actions.octave(-1) },
    { label: 'RANDOM', value: () => 'LOSUJ', act: actions.random },
    { label: 'MUTATE', value: () => '1 KROK', act: actions.mut },
  ],
  mix: [
    ...VOICE_NAMES.map((n, i) => ({ label: SHORT[i], value: () => (engine.enabled[i] ? 'ON' : 'OFF'), lit: () => !!engine.enabled[i], act: () => { engine.setEnabled(i, !engine.enabled[i]); } })),
    { label: 'RND ENG', value: () => 'LOSUJ', act: () => { engine.enabled.forEach((on, i) => { if (on) rnd(i); }); } },
  ],
  syn: [
    { label: 'SILNIK', value: () => SHORT[synSel], act: () => { synSel = (synSel + 1) % 4; renderSyn(); } },
    { label: 'WIDOK', value: () => (synView === 0 ? 'SOUND' : 'ENV'), lit: () => synView === 1, act: () => { synView = 1 - synView; renderSyn(); } },
    { label: 'RND', value: () => 'LOSUJ', act: randomizeSyn },
    { label: 'SOLO', value: () => (engine.solo === synSel ? 'ON' : 'OFF'), lit: () => engine.solo === synSel, act: () => { engine.setSolo(engine.solo === synSel ? null : synSel); } },
    { label: 'STAN', value: () => (engine.enabled[synSel] ? 'ON' : 'OFF'), lit: () => !!engine.enabled[synSel], act: () => { engine.setEnabled(synSel, !engine.enabled[synSel]); } },
  ],
  fx: [
    { label: 'SEKCJA', value: () => (fxActive === 0 ? 'FILTR' : 'EFEKT'), act: () => { fxActive = 1 - fxActive; showFxSection(); } },
    { label: 'STYLE', value: () => short8(fxSecs[fxActive].styles[fxSecs[fxActive].slot.style].name.toUpperCase()), act: () => cycleStyle(fxActive) },
    { label: 'STAN', value: () => (fxSecs[fxActive].slot.bypass ? 'BYPASS' : 'ON'), lit: () => !fxSecs[fxActive].slot.bypass, act: () => bypass(fxActive) },
    { label: 'RND', value: () => 'LOSUJ', act: () => fxSecs[fxActive].randomize() },
    { label: 'STEROW.', value: () => CTL_LABEL[fxCtl], lit: () => fxCtl === 0, act: () => { fxCtl = (fxCtl + 1) % 3; } },
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

// ---------- strona SYN: pokrętła wybranego silnika ----------
const synRefs = {};
function synKnob(label, min, max, step, value, def, onInput) {
  const k = document.createElement('div');
  makeKnob(k, { label, min, max, step, value, def, fmt: 'num' });
  k.addEventListener('input', () => onInput(k.value));
  return k;
}
function renderSyn() {
  const grid = el('syngrid'), holder = el('synstatic');
  [el('cutoff'), el('reso')].forEach((k) => holder.appendChild(k));            // wyjmij globalne pokrętła, zanim wyczyścimy siatkę
  grid.innerHTML = ''; Object.keys(synRefs).forEach((k) => delete synRefs[k]);
  const i = synSel, pv = engine.voices[i].params, specs = PARAM_SPECS[i];
  const add = (sp) => { const k = synKnob(sp.label.toUpperCase(), sp.min, sp.max, sp.step, pv[sp.id], sp.def, (v) => engine.setParam(i, sp.id, v)); synRefs[sp.id] = k; grid.appendChild(k); };
  if (synView === 0) {
    specs.filter((x) => x.group !== 'env').forEach(add);
    grid.appendChild(el('cutoff')); grid.appendChild(el('reso'));               // globalne: wspólne dla silników
  } else specs.filter((x) => x.group === 'env').forEach(add);
}
function randomizeSyn() {
  const vals = engine.randomizeVoice(synSel);
  for (const [id, v] of Object.entries(vals)) if (synRefs[id]) synRefs[id].value = v;
}
// poziomy silników na stronie MIX
VOICE_NAMES.forEach((n, i) => el(`lv${i}`).addEventListener('input', (e) => engine.setLevel(i, +e.target.value)));

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
      get refs() { return refs; },
      randomize() { const v = slot.randomize(); for (const [id, n] of Object.entries(v)) refs[id].value = n; },
    });
    host.appendChild(sec);
  });
}
function showFxSection() { fxSecs.forEach((x, j) => { x.sec.hidden = j !== fxActive; }); }
function cycleStyle(j) { const s = fxSecs[j]; s.slot.setStyle((s.slot.style + 1) % s.styles.length); s.render(); }
function bypass(j) { const s = fxSecs[j]; s.slot.setBypass(!s.slot.bypass); s.sec.classList.toggle('off', s.slot.bypass); }

// ---------- strony ----------
function setPage(p) {
  page = p;
  document.querySelectorAll('#pages button').forEach((b) => b.classList.toggle('on', b.dataset.page === p));
  el('scopewrap').hidden = false;
  el('side').hidden = p === 'fx' || p === 'syn';
  el('knobs-seq').hidden = p !== 'seq';
  el('knobs-mix').hidden = true;                    // poziomy silników nie są potrzebne: zostają na 100%, bez pokręteł
  el('synpage').hidden = p !== 'syn';
  el('fxpage').hidden = p !== 'fx';
  if (p === 'syn') renderSyn();
  if (p === 'fx') showFxSection();
  fit(); renderKeys(); updateInfo();
}
document.querySelectorAll('#pages button').forEach((b) => b.addEventListener('click', () => setPage(b.dataset.page)));

// ---------- odczyty ----------
function updateInfo() {
  const n = pattern.steps.length, pos = curPos(), brg = Math.floor((pos / n) * 360) % 360;
  const on = pattern.steps.filter((s) => s.on), acc = on.filter((s) => s.vel >= 110).length;
  el('readout').textContent = [
    'RADARXXX', '',
    `BPM     ${engine.bpm}`,
    `BASE    ${baseLabel()}`,
    `KEY     ${MODE_LABEL[state.mode]}`,
    `STEPS   ${String(on.length).padStart(2, '0')}/${n}`,
    `ACCENT  ${Math.round(state.accent * 100)}% (${acc})`,
    `SLIDE   ${Math.round(state.slide * 100)}% (${pattern.steps.filter((x) => x.on && x.tie).length})`,
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
  if (!keyPop.hidden) { if (e.code === 'Escape') { e.preventDefault(); showKey(false); } return; }
  if (!bpmPop.hidden) { if (e.code === 'Escape') { e.preventDefault(); showBpm(false); } else if (e.code === 'ArrowUp') { e.preventDefault(); setBpm(engine.bpm + 1); } else if (e.code === 'ArrowDown') { e.preventDefault(); setBpm(engine.bpm - 1); } return; }
  const map = { Space: togglePlay, KeyR: () => { actions.random(); renderKeys(); }, KeyM: () => { actions.mut(); },
    Digit1: () => setPage('seq'), Digit2: () => setPage('mix'), Digit3: () => setPage('syn'), Digit4: () => setPage('fx'),
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
