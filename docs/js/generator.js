// Generator basu acid (port z tools/generator). Czysty JS, bez zależności od przeglądarki.

export const MODES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};

export const DEFAULTS = {
  length: 16, density: 0.6, syncopation: 0.5, accentBias: 0.5,
  leapProb: 0.1, tieProb: 0.12, ratchetProb: 0.0, swing: 0.0, seed: 1,
  root: 36, mode: 'minor',
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

export function generateBass(params = {}) {
  const p = { ...DEFAULTS, ...params };
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

// Kontrolowana mutacja: jeden krok. Zwraca nowy wzór.
export function mutate(pattern, rng = Math.random, kind) {
  const kinds = ['toggle', 'pitch', 'accent', 'gate'];
  kind = kind ?? kinds[Math.floor(rng() * kinds.length)];
  const i = Math.floor(rng() * pattern.steps.length);
  const s = { ...pattern.steps[i] };
  if (kind === 'toggle') {
    s.on = !s.on;
    if (s.on) { s.vel = 85; s.gate = 0.6; }
  } else if (!s.on) {
    return pattern;
  } else if (kind === 'pitch') {
    s.degree += [-2, -1, 1, 2][Math.floor(rng() * 4)];
  } else if (kind === 'accent') {
    s.vel = s.vel >= 110 ? 85 : 120;
  } else if (kind === 'gate') {
    s.gate = [0.4, 0.6, 0.8, 0.95][Math.floor(rng() * 4)];
  }
  const steps = pattern.steps.slice();
  steps[i] = s;
  return { ...pattern, steps };
}
