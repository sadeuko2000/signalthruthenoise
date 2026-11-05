import test from 'node:test';
import assert from 'node:assert/strict';
import { snap, toNorm, fromNorm, dragNorm, angleFor, arcPath, FORMATS, SWEEP } from '../docs/js/knob.js';

test('snap: zaokrągla do kroku i trzyma się zakresu', () => {
  assert.equal(snap(0.234, 0, 1, 0.05), 0.25);
  assert.equal(snap(1.7, 0, 1, 0.01), 1);
  assert.equal(snap(-3, 0.4, 1.6, 0.01), 0.4);
  assert.equal(snap(0.1 + 0.2, 0, 1, 0.01), 0.3);       // bez śmieci zmiennoprzecinkowych
});

test('toNorm i fromNorm są odwrotne', () => {
  for (const v of [0.4, 0.7, 1.6]) assert.ok(Math.abs(fromNorm(toNorm(v, 0.4, 1.6), 0.4, 1.6) - v) < 1e-9);
  assert.equal(fromNorm(2, 0, 10), 10);
});

test('przeciągnięcie w górę zwiększa wartość, w dół zmniejsza, w całości daje cały zakres', () => {
  assert.ok(dragNorm(0.5, -40) > 0.5);
  assert.ok(dragNorm(0.5, 40) < 0.5);
  assert.equal(dragNorm(0.2, -10000), 1);
  assert.equal(dragNorm(0.8, 10000), 0);
  assert.ok(Math.abs(dragNorm(0, -170) - 1) < 1e-9);
});

test('tryb dokładny (shift) jest 4x wolniejszy', () => {
  const normal = dragNorm(0.5, -40) - 0.5, fine = dragNorm(0.5, -40, true) - 0.5;
  assert.ok(Math.abs(normal / fine - 4) < 1e-9);
});

test('kąt: początek -135°, środek 0°, koniec +135°', () => {
  assert.equal(angleFor(0), -SWEEP / 2);
  assert.equal(angleFor(0.5), 0);
  assert.equal(angleFor(1), SWEEP / 2);
});

test('łuk SVG: poprawna flaga dużego łuku i punkt dla zerowej długości', () => {
  assert.match(arcPath(24, 24, 18, -135, 135), / 0 1 1 /);     // 270° > 180°: duży łuk
  assert.match(arcPath(24, 24, 18, -135, -45), / 0 0 1 /);     // 90°: mały łuk
  assert.match(arcPath(24, 24, 18, -135, -135), /^M[\d.\- ]+$/);
});

test('formaty wartości', () => {
  assert.equal(FORMATS.pct(0.456), '46%');
  assert.equal(FORMATS.num(12.3), '12');
  assert.equal(FORMATS.num(0.5), '0.50');
  assert.equal(FORMATS.x(1), '1.00×');
});
