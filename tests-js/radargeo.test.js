import test from 'node:test';
import assert from 'node:assert/strict';
import { TAU, degToR, rToDeg, polar, stepFromAngle, sweepPos, echoAlpha, echoes, placeNote, clearNote, moveNote, resizeSteps, R_IN, R_OUT, DEG_MIN, DEG_MAX } from '../docs/js/radargeo.js';

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);

test('promień <-> stopień skali są odwrotne w całym zakresie', () => {
  for (let d = DEG_MIN; d <= DEG_MAX; d++) assert.equal(rToDeg(degToR(d)), d);
  near(degToR(DEG_MIN), R_IN); near(degToR(DEG_MAX), R_OUT);
  assert.equal(rToDeg(0), DEG_MIN);     // poza zakresem: obcięcie
  assert.equal(rToDeg(5), DEG_MAX);
});

test('kąt od góry zgodnie z zegarem: góra 0, prawo 90°, dół 180°, lewo 270°', () => {
  near(polar(0, -10).theta, 0);
  near(polar(10, 0).theta, TAU / 4);
  near(polar(0, 10).theta, TAU / 2);
  near(polar(-10, 0).theta, (3 * TAU) / 4);
  near(polar(3, 4).r, 5);
});

test('sektory kroków: kreska kroku i cały sektor należą do tego samego kroku', () => {
  const n = 16;
  for (let i = 0; i < n; i++) {
    assert.equal(stepFromAngle((i / n) * TAU + 1e-6, n), i);
    assert.equal(stepFromAngle(((i + 0.99) / n) * TAU, n), i);
  }
  assert.equal(stepFromAngle(TAU - 1e-9, n), n - 1);
  assert.equal(stepFromAngle(-0.0001, n), n - 1);   // kąt ujemny zawija się
});

test('pozycja linii rośnie z czasem i zawija się po całym okrążeniu', () => {
  const dur = 0.1, n = 16;
  near(sweepPos(3, 1.0, 1.05, dur, n), 3.5);
  near(sweepPos(15, 1.0, 1.15, dur, n), 0.5);      // 15 + 1.5 = 16.5 -> 0.5
  near(sweepPos(0, 1.0, 0.95, dur, n), 15.5);      // tuż przed początkiem kroku: poprzedni krok
});

test('jasność echa: najjaśniejsze tuż po przemiataniu, najsłabsze tuż przed kolejnym, nigdy poniżej poziomu spoczynkowego', () => {
  const n = 16;
  near(echoAlpha(5, 5, n), 1);
  assert.ok(echoAlpha(5, 5.1, n) > echoAlpha(5, 9, n));
  assert.ok(echoAlpha(5, 4.99, n) < 0.3);
  for (let s = 0; s < n; s += 0.37) assert.ok(echoAlpha(5, s, n) >= 0.22 - 1e-9);
});

test('echa odpowiadają włączonym krokom, akcent wynika z głośności', () => {
  const steps = Array.from({ length: 8 }, () => ({ on: false, degree: 0, vel: 90, gate: 0.6 }));
  steps[2] = { on: true, degree: 4, vel: 120, gate: 0.85 };
  steps[5] = { on: true, degree: -1, vel: 80, gate: 0.4 };
  const e = echoes(steps);
  assert.equal(e.length, 2);
  assert.equal(e[0].i, 2); assert.ok(e[0].accent); assert.ok(e[1].r < e[0].r);
  near(e[0].a0, (2 / 8) * TAU);
  assert.ok(e[0].len > e[1].len);
});

test('edycja nie mutuje wzoru: dodanie, usunięcie i przesunięcie nuty', () => {
  const steps = Array.from({ length: 8 }, () => ({ on: false, degree: 0, octave: 0, vel: 90, gate: 0.6, tie: false, ratchet: 1 }));
  const a = placeNote(steps, 3, 4);
  assert.equal(steps[3].on, false); assert.equal(a[3].on, true); assert.equal(a[3].degree, 4);
  const b = clearNote(a, 3);
  assert.equal(b[3].on, false); assert.equal(a[3].on, true);
  const c = moveNote(a, 3, 6, 2);
  assert.equal(c[3].on, false); assert.equal(c[6].on, true); assert.equal(c[6].degree, 2);
  const d = moveNote(a, 3, 3, 1);
  assert.equal(d[3].degree, 1); assert.equal(d[3].on, true);
});

test('zmiana długości wzoru zachowuje nuty: skrócenie ucina, wydłużenie powtarza', () => {
  const steps = Array.from({ length: 8 }, (_, i) => ({ on: i % 3 === 0, degree: i, vel: 90, gate: 0.6 }));
  const short = resizeSteps(steps, 4);
  assert.equal(short.length, 4); assert.deepEqual(short, steps.slice(0, 4));
  const long = resizeSteps(steps, 16);
  assert.equal(long.length, 16);
  assert.deepEqual(long.slice(0, 8), steps); assert.deepEqual(long.slice(8), steps);
  assert.notEqual(long[0], long[8]);                    // kopie, nie te same obiekty
  assert.deepEqual(resizeSteps(steps, 8), steps);
});
