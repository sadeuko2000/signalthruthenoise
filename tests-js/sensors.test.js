import test from 'node:test';
import assert from 'node:assert/strict';
import { tiltToXY, isShake, RANGE_DEG } from '../docs/js/sensors.js';

const base = { beta: 40, gamma: 0 };

test('pozycja zerowa daje środek pada', () => {
  assert.deepEqual(tiltToXY(40, 0, base), { x: 0.5, y: 0.5 });
});

test('przechył w prawo zwiększa x, do przodu zwiększa y', () => {
  assert.ok(tiltToXY(40, 15, base).x > 0.5);
  assert.ok(tiltToXY(25, 0, base).y > 0.5);
});

test('pełny zakres przy ±RANGE_DEG i obcięcie do 0..1', () => {
  assert.equal(tiltToXY(40, RANGE_DEG, base).x, 1);
  assert.equal(tiltToXY(40, -90, base).x, 0);
  assert.equal(tiltToXY(-90, 0, base).y, 1);
});

test('potrząśnięcie: spoczynek nie, mocny ruch tak', () => {
  assert.equal(isShake(0, 0, 9.8), false);
  assert.equal(isShake(20, 15, 9.8), true);
});
