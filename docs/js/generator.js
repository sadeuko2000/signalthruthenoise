// Generator basu. Czysty JS, bez zależności od przeglądarki.
// Domyślny styl „electro” korzysta z modelu nauczonego z 50 pętli basu (rytm zależny od poprzedniej nuty,
// mała paleta wysokości z tonika i półtonem nad nią, długie nuty, kilka cichych nut). Styl „classic” to poprzedni, ręcznie
// strojony generator (schodkowe ruchy po skali).
import { ELECTRO_MODEL } from './electro-model.js';

export const MODES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  electro: [0, 1, 3, 5, 6, 10, 11],      // klasy wysokości najczęstsze w nauczonych pętlach (tonika, ♭2, ♭3, 4, ♭5, ♭7, 7)
};

// Zakres stopni skali używany w patternach (stopnie powyżej 6 to kolejna oktawa).
export const DEGREE_MIN = -2, DEGREE_MAX = 13;

export const DEFAULTS = {
  length: 16, density: 0.5, syncopation: 0.5, accentBias: 0.5,
  leapProb: 0.1, tieProb: 0.04, ratchetProb: 0.0, swing: 0.0, seed: 1,
  root: 36, mode: 'electro', style: 'electro',
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const emptyStep = () => ({ on: false, degree: 0, octave: 0, vel: 90, gate: 0.6, tie: false, ratchet: 1 });

export function pitch(root, mode, degree, octave = 0) {
  const notes = MODES[mode];
  const oct = Math.floor(degree / notes.length);
  const d = ((degree % notes.length) + notes.length) % notes.length;
  return root + notes[d] + 12 * (octave + oct);
}

// Waga kroku: mocne (0,4,8,12) > połówki > off-beat; syncopation przesuwa wagę na słabe kroki.
export function stepWeight(i, syncopation) {
  const strong = i % 4 === 0 ? 1.0 : i % 2 === 0 ? 0.6 : 0.3;
  return strong * (1 - syncopation) + (1 - strong) * syncopation * 0.8 + 0.1;
}

function nextDegree(prev, p, rng) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const d = rng() < p.leapProb
    ? prev + pick([-5, -4, 4, 5])
    : prev + pick([-2, -1, -1, 0, 0, 1, 1, 2]);
  return Math.max(-3, Math.min(7, d));
}

// Styl „classic”: poprzedni generator (zachowany do porównań i testów).
function generateClassic(p) {
  const rng = mulberry32(p.seed);
  const steps = [];
  let deg = 0;
  for (let i = 0; i < p.length; i++) {
    const w = stepWeight(i % 16, p.syncopation);
    // Zawsze zużywamy tę samą liczbę losowań na krok, żeby suwaki morfowały wzór zamiast go tasować.
    const rOn = rng(), rDeg = rng(), rAcc = rng(), rVel = rng(), rTie = rng(), rRat = rng();
    const on = i === 0 || rOn < p.density * w * 1.6;
    if (!on) { steps.push(emptyStep()); continue; }
    if (i > 0) deg = nextDegree(deg, p, mulberry32(Math.floor(rDeg * 4294967296)));
    const accent = i % 4 === 0 && rAcc < p.accentBias;
    steps.push({
      on: true, degree: deg, octave: 0,
      vel: accent ? 120 : 70 + Math.floor(rVel * 26),
      gate: accent ? 0.85 : 0.6,
      tie: rTie < p.tieProb,
      ratchet: rRat < p.ratchetProb ? 2 : 1,
    });
  }
  return { steps, swing: p.swing, root: p.root, mode: p.mode };
}

// ---------- styl „electro”: generator oparty na modelu nauczonym z pętli ----------
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const logit = (q) => Math.log(q / (1 - q));
function pickW(items, weights, r) {
  const total = weights.reduce((a, b) => a + b, 0);
  let u = r * total;
  for (let i = 0; i < items.length; i++) { u -= weights[i]; if (u <= 0) return items[i]; }
  return items[items.length - 1];
}

// Półtony względem toniki -> stopień skali „electro” (np. 12 -> 7, 13 -> 8, -2 -> -2).
export function relToDegree(rel) {
  const oct = Math.floor(rel / 12), pc = rel - 12 * oct, idx = MODES.electro.indexOf(pc);
  return idx < 0 ? null : idx + 7 * oct;
}

function generateElectro(p) {
  const M = ELECTRO_MODEL, n = p.length, seed = p.seed | 0;
  const rp = mulberry32(seed ^ 0x51ed270b);

  // Paleta: kilka różnych wysokości na cały wzór (tonika zawsze), dobierane z nauczonego rozkładu.
  const sizes = Object.keys(M.pitch.palette).map(Number);
  const size = pickW(sizes, sizes.map((k) => M.pitch.palette[k]), rp());
  const cands = M.pitch.weights.map((x) => ({ deg: relToDegree(x.rel), w: x.w }))
    .filter((c) => c.deg !== null && c.deg >= DEGREE_MIN && c.deg <= DEGREE_MAX);
  const weightOf = (d) => (cands.find((c) => c.deg === d) || { w: 0.01 }).w;
  const palette = [0], pool = cands.filter((c) => c.deg !== 0);
  while (palette.length < size && pool.length) {
    const c = pickW(pool, pool.map((x) => x.w), rp());
    palette.push(c.deg); pool.splice(pool.indexOf(c), 1);
  }

  // Rytm: łańcuch Markowa po krokach (prawdopodobieństwo nuty zależy od pozycji i od tego, czy poprzedni krok grał).
  // `density` przesuwa prawdopodobieństwa (0.5 = średnia z pętli), `syncopation` przenosi nuty z mocnych na słabe kroki.
  const ru = mulberry32(seed ^ 0x2545f491), u = Array.from({ length: n }, () => ru()), u0 = ru();
  const dens = 4 * (p.density - 0.5);
  let prev = u0 < M.rhythm.startOn;
  const on = [];
  for (let i = 0; i < n; i++) {
    const pos = i % 16, base = M.rhythm.pOn[prev ? 1 : 0][pos];
    const sync = (pos % 4 === 0 ? -1 : pos % 2 === 1 ? 1 : 0) * 3 * (p.syncopation - 0.5);
    on.push(u[i] < sigmoid(logit(base) + dens + sync));
    prev = on[i];
  }
  if (!on.some(Boolean)) on[0] = true;

  const idxOn = on.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  const steps = on.map(() => emptyStep());
  let prevDeg = null;
  idxOn.forEach((i, k) => {
    const r = mulberry32((seed * 31 + i * 7919 + 17) >>> 0);       // osobny strumień na krok: suwaki nie tasują reszty
    // wysokość: zostań, skocz o oktawę albo zmień dźwięk w palecie
    let deg;
    if (prevDeg === null) deg = r() < M.pitch.firstTonic ? 0 : pickW(palette, palette.map(weightOf), r());
    else if (palette.length === 1 || r() < M.pitch.stay) deg = prevDeg;
    else {
      const others = palette.filter((d) => d !== prevDeg);
      const same = others.filter((d) => (d - prevDeg) % 7 === 0), diff = others.filter((d) => (d - prevDeg) % 7 !== 0);
      const useSame = same.length && (!diff.length || r() < M.pitch.octavePair);
      const group = useSame ? same : diff.length ? diff : same;
      deg = pickW(group, group.map(weightOf), r());
    }
    prevDeg = deg;
    // długość nuty zależy od odstępu do następnej nuty (cyklicznie)
    const next = idxOn[(k + 1) % idxOn.length], ioi = next > i ? next - i : next + n - i;
    const table = M.gate[String(Math.min(ioi, 5))] || [[0.75, 1]];
    const dur = pickW(table.map((t) => t[0]), table.map((t) => t[1]), r());
    // głośność: klasa (cicha / średnia / pełna) zależna od pozycji; część pełnych nut to akcenty
    const pos = i % 16, [pg, pm] = M.velocity.byPos[pos], rv = r(), ra = r(), rt = r(), rr = r();
    const cls = rv < pg ? 0 : rv < pg + pm ? 1 : 2;
    const accent = cls === 2 && ra < Math.min(0.95, p.accentBias * 0.7 * (pos % 4 === 0 ? 1.4 : 0.7));
    const vel = accent ? 120 : cls === 0 ? 48 + Math.floor(r() * 19) : cls === 1 ? 80 + Math.floor(r() * 17) : 100 + Math.floor(r() * 8);
    steps[i] = {
      on: true, degree: deg, octave: 0, vel, gate: dur,
      tie: ioi === 1 && rt < p.tieProb,
      ratchet: rr < p.ratchetProb ? 2 : 1,
    };
  });
  return { steps, swing: p.swing, root: p.root, mode: p.mode, palette };
}

export function generateBass(params = {}) {
  const p = { ...DEFAULTS, ...params };
  return p.style === 'classic' ? generateClassic(p) : generateElectro(p);
}

// Kontrolowana mutacja: jeden krok. Zwraca nowy wzór.
export function mutate(pattern, rng = Math.random, kind) {
  const kinds = ['toggle', 'pitch', 'accent', 'gate'];
  kind = kind ?? kinds[Math.floor(rng() * kinds.length)];
  const i = Math.floor(rng() * pattern.steps.length);
  const s = { ...pattern.steps[i] };
  const pal = pattern.palette && pattern.palette.length ? pattern.palette : null;
  if (kind === 'toggle') {
    s.on = !s.on;
    if (s.on) { s.vel = 100; s.gate = 0.75; if (pal) s.degree = pal[Math.floor(rng() * pal.length)]; }
  } else if (!s.on) {
    return pattern;
  } else if (kind === 'pitch') {
    // częściej inny dźwięk z palety wzoru, rzadziej krok o 1-2 stopnie; zawsze w dozwolonym zakresie
    const others = pal ? pal.filter((d) => d !== s.degree) : [];
    s.degree = others.length && rng() < 0.7
      ? others[Math.floor(rng() * others.length)]
      : Math.max(DEGREE_MIN, Math.min(DEGREE_MAX, s.degree + [-2, -1, 1, 2][Math.floor(rng() * 4)]));
  } else if (kind === 'accent') {
    s.vel = s.vel >= 110 ? 85 : 120;
  } else if (kind === 'gate') {
    s.gate = [0.5, 0.75, 1, 1.5][Math.floor(rng() * 4)];
  }
  const steps = pattern.steps.slice();
  steps[i] = s;
  return { ...pattern, steps };
}
