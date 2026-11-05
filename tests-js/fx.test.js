import test from 'node:test';
import assert from 'node:assert/strict';
import { FILTER_STYLES, FX_STYLES, defaultsN, randomN, mapValues } from '../docs/js/fx.js';
import { mulberry32 } from '../docs/js/generator.js';

const ALL = [['filtr', FILTER_STYLES], ['efekt', FX_STYLES]];

test('4 style filtra i 4 style efektów, każdy z 8 parametrami o unikalnych id', () => {
  for (const [kind, styles] of ALL) {
    assert.equal(styles.length, 4, kind);
    for (const st of styles) {
      assert.equal(st.params.length, 8, `${kind} ${st.name}`);
      assert.equal(new Set(st.params.map((p) => p.id)).size, 8, `${kind} ${st.name}: id się powtarzają`);
      assert.equal(typeof st.build, 'function');
    }
  }
});

test('wartości domyślne i zakresy losowania mieszczą się w 0..1', () => {
  for (const [, styles] of ALL) for (const st of styles) for (const p of st.params) {
    assert.ok(p.def >= 0 && p.def <= 1, `${st.name}.${p.id} def`);
    assert.ok(p.rand[0] >= 0 && p.rand[1] <= 1 && p.rand[0] <= p.rand[1], `${st.name}.${p.id} rand`);
  }
});

test('mapowanie daje skończone wartości w całym zakresie 0..1', () => {
  for (const [, styles] of ALL) for (const st of styles) for (const p of st.params) {
    for (const n of [0, 0.25, 0.5, 0.75, 1]) {
      const v = p.map(n);
      assert.ok(typeof v === 'string' || Number.isFinite(v), `${st.name}.${p.id}(${n})`);
      assert.equal(typeof p.show(v), 'string');
    }
  }
});

test('losowanie zostaje w granicach rand i różni się między ziarnami', () => {
  for (const [, styles] of ALL) for (const st of styles) {
    for (let seed = 0; seed < 50; seed++) {
      const v = randomN(st, mulberry32(seed));
      for (const p of st.params) assert.ok(v[p.id] >= p.rand[0] - 1e-9 && v[p.id] <= p.rand[1] + 1e-9);
    }
    assert.notDeepEqual(randomN(st, mulberry32(1)), randomN(st, mulberry32(2)));
  }
});

test('domyślne ustawienia efektów nie zmieniają dźwięku (mix = 0), filtry są prawie otwarte', () => {
  for (const st of FX_STYLES) {
    const m = mapValues(st, defaultsN(st));
    assert.equal(m.mix, 0, st.name);
  }
  const f = mapValues(FILTER_STYLES[0], defaultsN(FILTER_STYLES[0]));
  assert.ok(f.cutoff > 3000);
});
