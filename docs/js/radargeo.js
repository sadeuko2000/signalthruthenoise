// Geometria ekranu radarowego (czyste funkcje, testowane w node).
// Kąty liczone od góry, zgodnie z ruchem wskazówek zegara. Krok i leży pod kątem i/n * 2π.
// Odległość od środka koduje wysokość dźwięku (stopień skali).

import { DEGREE_MIN, DEGREE_MAX } from './generator.js';

export const TAU = Math.PI * 2;
export const DEG_MIN = DEGREE_MIN, DEG_MAX = DEGREE_MAX;      // zakres stopni skali, jak w generatorze
export const R_IN = 0.22, R_OUT = 0.82;      // promień (ułamek promienia ekranu) dla najniższego i najwyższego stopnia

const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

// Skala promienia jest odcinkowo liniowa: pierwsza oktawa (stopnie 0-6, gdzie gra większość nut) dostaje najwięcej miejsca,
// stopnie poniżej toniki i druga oktawa mniej. Dzięki temu sąsiednie stopnie da się odróżnić palcem.
const KNOTS = [[DEG_MIN, R_IN], [0, 0.31], [7, 0.60], [DEG_MAX, R_OUT]];

export function degToR(d) {
  const x = clampN(d, DEG_MIN, DEG_MAX);
  for (let i = 0; i < KNOTS.length - 1; i++) {
    const [d0, r0] = KNOTS[i], [d1, r1] = KNOTS[i + 1];
    if (x <= d1) return r0 + ((x - d0) / (d1 - d0)) * (r1 - r0);
  }
  return R_OUT;
}

export function rToDeg(r) {
  const x = clampN(r, R_IN, R_OUT);
  for (let i = 0; i < KNOTS.length - 1; i++) {
    const [d0, r0] = KNOTS[i], [d1, r1] = KNOTS[i + 1];
    if (x <= r1) return clampN(Math.round(d0 + ((x - r0) / (r1 - r0)) * (d1 - d0)), DEG_MIN, DEG_MAX);
  }
  return DEG_MAX;
}

export const angleOfStep = (i, n) => (i / n) * TAU;

// Przesunięcie względem środka (dx w prawo, dy w dół) -> promień i kąt od góry.
export function polar(dx, dy) {
  const theta = Math.atan2(dx, -dy);
  return { r: Math.hypot(dx, dy), theta: (theta + TAU) % TAU };
}

// Sektor kroku to [i, i+1) / n okręgu, czyli echo zaczyna się na kresce kroku i biegnie do przodu.
export function stepFromAngle(theta, n) {
  const t = ((theta % TAU) + TAU) % TAU;
  return Math.min(n - 1, Math.floor((t / TAU) * n));
}

// Bieżąca pozycja przemiatającej linii w krokach (ciągła, 0..n). `t` to czas audio rozpoczęcia kroku i.
export function sweepPos(i, t, now, dur, n) {
  const p = i + (now - t) / dur;
  return ((p % n) + n) % n;
}

// Jasność echa: tuż po przemiataniu 1, potem gaśnie jak luminofor do poziomu spoczynkowego.
export function echoAlpha(i, sweep, n) {
  const delta = (((sweep - i) % n) + n) % n;           // ile kroków temu przeszła linia
  return 0.22 + 0.78 * Math.pow(1 - delta / n, 1.6);
}

// Wzór -> lista ech do narysowania (kąt początku, promień, długość łuku, grubość, akcent).
export function echoes(steps) {
  const n = steps.length, out = [];
  steps.forEach((s, i) => {
    if (!s.on) return;
    out.push({
      i, a0: angleOfStep(i, n), r: degToR(Math.max(DEG_MIN, Math.min(DEG_MAX, s.degree))),
      len: Math.max(0.25, Math.min(4, s.gate)) * (TAU / n) * 0.92,
      w: 4 + (s.vel / 127) * 7, accent: s.vel >= 110,
    });
  });
  return out;
}

// Edycja: dotknięcie w punkt (kąt, promień) ustawia nutę w kroku i na stopniu d.
export function placeNote(steps, i, degree, base = {}) {
  const next = steps.slice();
  next[i] = { on: true, degree, octave: 0, vel: 90, gate: 0.6, tie: false, ratchet: 1, ...base, on: true, degree };
  return next;
}
export function clearNote(steps, i) {
  const next = steps.slice();
  next[i] = { ...steps[i], on: false };
  return next;
}
export function moveNote(steps, from, to, degree) {
  if (from === to) return placeNote(steps, from, degree, steps[from]);
  const note = steps[from];
  const next = clearNote(steps, from);
  next[to] = { ...note, on: true, degree };
  return next;
}

// Zmiana długości wzoru bez kasowania nut: skrócenie ucina koniec, wydłużenie powtarza wzór od początku.
export function resizeSteps(steps, n) {
  if (n === steps.length) return steps.slice();
  if (n < steps.length) return steps.slice(0, n);
  return Array.from({ length: n }, (_, i) => ({ ...steps[i % steps.length] }));
}
