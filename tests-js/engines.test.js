import test from 'node:test';
import assert from 'node:assert/strict';
import { blendWeights } from '../docs/js/engines.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('narożniki pada wybierają jeden silnik', () => {
  assert.deepEqual(blendWeights(0, 1), [1, 0, 0, 0]);   // prophet
  assert.deepEqual(blendWeights(1, 1), [0, 1, 0, 0]);   // ms-20
  assert.deepEqual(blendWeights(0, 0), [0, 0, 1, 0]);   // dx
  assert.deepEqual(blendWeights(1, 0), [0, 0, 0, 1]);   // wavetable
});

test('środek miesza po równo', () => {
  blendWeights(0.5, 0.5).forEach((w) => near(w, 0.5));
});

test('miks jest równomocowy w każdym punkcie', () => {
  for (let x = 0; x <= 1; x += 0.1) for (let y = 0; y <= 1; y += 0.1) {
    near(blendWeights(x, y).reduce((s, w) => s + w * w, 0), 1);
  }
});
