import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBass, mutate, pitch, mulberry32 } from '../docs/js/generator.js';

test('deterministyczny dla seeda', () => {
  assert.deepEqual(generateBass({ seed: 3 }), generateBass({ seed: 3 }));
});

test('krok 0 gra, długość 16', () => {
  const p = generateBass({ seed: 1 });
  assert.equal(p.steps.length, 16);
  assert.ok(p.steps[0].on);
});

test('wysokości w zakresie basu', () => {
  for (let seed = 0; seed < 50; seed++) {
    const p = generateBass({ seed, density: 1 });
    for (const s of p.steps) if (s.on) {
      const m = pitch(p.root, p.mode, s.degree, s.octave);
      assert.ok(m >= 24 && m <= 72, `${m}`);
    }
  }
});

test('mutacja zmienia najwyżej jeden krok', () => {
  const p = generateBass({ seed: 2 });
  for (let seed = 0; seed < 100; seed++) {
    const m = mutate(p, mulberry32(seed));
    const diff = m.steps.filter((s, i) => JSON.stringify(s) !== JSON.stringify(p.steps[i])).length;
    assert.ok(diff <= 1);
  }
});

test('frygijska ma małą sekundę', () => {
  assert.equal(pitch(0, 'phrygian', 1), 1);
  assert.equal(pitch(0, 'minor', 1), 2);
});

test('zmiana density morfuje wzór (większość kroków bez zmian pozycji nut)', () => {
  const a = generateBass({ seed: 9, density: 0.4 });
  const b = generateBass({ seed: 9, density: 0.5 });
  const onA = a.steps.map((s) => s.on);
  const onB = b.steps.map((s) => s.on);
  // wszystkie nuty z niższej gęstości zostają przy wyższej
  onA.forEach((v, i) => { if (v) assert.ok(onB[i]); });
});
