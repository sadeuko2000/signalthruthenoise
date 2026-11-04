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
