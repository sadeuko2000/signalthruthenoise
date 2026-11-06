import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDrums, emptyDrums, DRUM_TRACKS, DRUM_STEPS } from '../docs/js/drums.js';

const hits = (row) => row.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);

test('emptyDrums: pięć ścieżek po 16 kroków, same zera', () => {
  const e = emptyDrums();
  assert.equal(e.length, DRUM_TRACKS.length);
  assert.ok(e.every((row) => row.length === DRUM_STEPS && row.every((v) => v === 0)));
});

test('generateDrums techno: stopa na każdą ćwierćnutę, klaskanie na 2 i 4, off-beaty w hatach', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { steps } = generateDrums({ style: 0, density: 0.5, seed });
    const [K, S, C, H, O] = steps;
    for (const i of [0, 4, 8, 12]) assert.ok(K[i] > 0, `stopa na kroku ${i}, seed ${seed}`);
    assert.ok(C[4] > 0 && C[12] > 0);
    for (const i of [2, 6, 10, 14]) assert.ok(H[i] > 0 || O[i] > 0, `off-beat ${i} gra hat, seed ${seed}`);
    for (let i = 0; i < DRUM_STEPS; i++) assert.ok(!(H[i] && O[i]), 'hat otwarty zastępuje zamknięty');
  }
});

test('generateDrums electro: łamana stopa (więcej niż cztery uderzenia na takt nie jest wymagane, ale jest start i dodatki), werbel na 2 i 4', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { steps } = generateDrums({ style: 1, density: 0.7, seed });
    const [K, S] = steps;
    assert.ok(K[0] > 0);
    assert.ok(hits(K).length >= 3, `stopa ma dodatkowe uderzenia, seed ${seed}`);
    assert.ok(S[4] > 0 && S[12] > 0);
  }
});

test('generateDrums jest deterministyczny i gęstość dodaje uderzeń', () => {
  assert.deepEqual(generateDrums({ style: 1, density: 0.5, seed: 7 }), generateDrums({ style: 1, density: 0.5, seed: 7 }));
  const count = (d) => { let n = 0; for (let seed = 1; seed <= 60; seed++) n += generateDrums({ style: 0, density: d, seed }).steps.flat().filter(Boolean).length; return n; };
  assert.ok(count(0.9) > count(0.1));
  const { steps } = generateDrums({ style: 0, density: 1, seed: 3 });
  assert.ok(steps.every((row) => row.every((v) => v === 0 || v === 1 || v === 2)));
});
