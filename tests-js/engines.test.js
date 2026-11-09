import test from 'node:test';
import assert from 'node:assert/strict';
import { blendWeights, clampToDisc } from '../docs/js/engines.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('narożniki pada wybierają jeden silnik (pad okrągły, kotwice na 45°)', () => {
  const pure = (w, i) => { assert.ok(w[i] > 0.999, `w[${i}]=${w[i]}`); };
  pure(blendWeights(0, 1), 0);   // prophet
  pure(blendWeights(1, 1), 1);   // ms-20
  pure(blendWeights(0, 0), 2);   // dx
  pure(blendWeights(1, 0), 3);   // wavetable
});

test('środek miesza po równo', () => {
  blendWeights(0.5, 0.5).forEach((w) => near(w, 0.5));
});

test('punkty poza kołem trafiają na brzeg koła', () => {
  const c = clampToDisc(1, 1);
  near(Math.hypot(2 * c.x - 1, 2 * c.y - 1), 1);
  const inside = clampToDisc(0.6, 0.55);
  near(inside.x, 0.6); near(inside.y, 0.55);
});

test('wyłączone silniki dostają wagę 0, reszta zostaje równomocowa', () => {
  const w = blendWeights(0.5, 0.5, [1, 0, 1, 0]);
  assert.equal(w[1], 0); assert.equal(w[3], 0);
  near(w[0] ** 2 + w[2] ** 2, 1);
  assert.deepEqual(blendWeights(0.5, 0.5, [0, 0, 0, 0]), [0, 0, 0, 0]);
  const solo = blendWeights(0.9, 0.1, [0, 0, 1, 0]);   // jedyny aktywny silnik gra pełnym poziomem niezależnie od pada
  near(solo[2], 1);
});

test('miks jest równomocowy w każdym punkcie', () => {
  for (let x = 0; x <= 1; x += 0.1) for (let y = 0; y <= 1; y += 0.1) {
    near(blendWeights(x, y).reduce((s, w) => s + w * w, 0), 1);
  }
});

import { PARAM_SPECS, defaultParams, randomizeParams } from '../docs/js/engines.js';
import { mulberry32 } from '../docs/js/generator.js';

test('losowanie zostaje w granicach rand i w zakresie suwaka', () => {
  for (let i = 0; i < PARAM_SPECS.length; i++) {
    for (let seed = 0; seed < 200; seed++) {
      const vals = randomizeParams(i, mulberry32(seed));
      for (const sp of PARAM_SPECS[i]) {
        const v = vals[sp.id];
        assert.ok(v >= sp.min && v <= sp.max, `${sp.id}=${v} poza suwakiem`);
        if (sp.choices) assert.ok(sp.choices.includes(v), `${sp.id}=${v} spoza choices`);
        else assert.ok(v >= sp.rand[0] - sp.step && v <= sp.rand[1] + sp.step, `${sp.id}=${v} poza rand`);
      }
    }
  }
});

test('losowanie daje różne wyniki dla różnych ziaren', () => {
  const a = JSON.stringify(randomizeParams(0, mulberry32(1)));
  const b = JSON.stringify(randomizeParams(0, mulberry32(2)));
  assert.notEqual(a, b);
});

test('domyślne parametry mieszczą się w zakresach', () => {
  PARAM_SPECS.forEach((specs, i) => {
    const d = defaultParams(i);
    for (const sp of specs) assert.ok(d[sp.id] >= sp.min && d[sp.id] <= sp.max);
  });
});

test('każdy silnik ma wszystkie obwiednie filtra i amp, losowane i sterowalne', () => {
  const need = ['fEnv', 'fDec', 'aAtk', 'aDec', 'aSus', 'aRel'];
  PARAM_SPECS.forEach((specs) => {
    for (const id of need) {
      const sp = specs.find((x) => x.id === id);
      assert.ok(sp, `brak ${id}`);
      assert.equal(sp.group, 'env');
    }
  });
  // losowanie rusza także obwiednie
  const a = randomizeParams(1, mulberry32(10)), b = randomizeParams(1, mulberry32(11));
  assert.ok(need.some((id) => a[id] !== b[id]));
});

import { VOICES } from '../docs/js/engines.js';
test('każdy silnik ma interfejs wymagany przez Engine (refresh, apply, setParam, note, silence)', () => {
  for (const V of VOICES) {
    for (const m of ['refresh', 'apply', 'setParam', 'note', 'silence']) {
      assert.equal(typeof V.prototype[m], 'function', `${V.name}.${m}`);
    }
  }
});

import { bip } from '../docs/js/engines.js';
test('bip: przesunięcie globalne -1..+1 względem wartości silnika', () => {
  assert.equal(bip(10, 0, 0, 40), 10);          // 0 = bez zmian
  assert.equal(bip(10, 1, 0, 40), 40);          // +100% = maksimum zakresu
  assert.equal(bip(10, -1, 0, 40), 0);          // -100% = minimum zakresu
  assert.equal(bip(10, 0.5, 0, 40), 25);        // pół drogi do maksimum
  assert.equal(bip(10, -0.5, 0, 40), 5);        // pół drogi do minimum
  assert.equal(bip(3, -1, 3, 300), 3);          // wartość na minimum zostaje na minimum
});

import { ENGINE_SHORT, ENGINE_TAB } from '../docs/js/engines.js';
test('silniki zewnętrzne (HOWL) dołączone do tablic: nazwy, specyfikacje, lista siedmiu pokręteł', () => {
  assert.equal(PARAM_SPECS.length, 7);
  assert.equal(VOICES.length, 7);
  assert.equal(ENGINE_SHORT.length, 7);
  assert.equal(ENGINE_TAB.length, 7);
  for (let t = 4; t < 7; t++) {
    const specs = PARAM_SPECS[t];
    assert.equal(specs.main.length, 7, `${ENGINE_SHORT[t]}: siedem pokręteł na zakładce silnika`);
    for (const id of specs.main) assert.ok(specs.find((x) => x.id === id), `${ENGINE_SHORT[t]}: brak ${id}`);
    assert.ok(ENGINE_TAB[t].length <= 5, 'nazwa na zakładce mieści się');
    for (const sp of specs) assert.ok(sp.label.length <= 8 || sp.group === 'env', `${sp.id}: za długi podpis pokrętła`);
  }
});
