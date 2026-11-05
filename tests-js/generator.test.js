import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBass, mutate, pitch, mulberry32, relToDegree, DEGREE_MIN, DEGREE_MAX, MODES, withAccent, withSlide, stepHash } from '../docs/js/generator.js';
import { ELECTRO_MODEL as M } from '../docs/js/electro-model.js';

const many = (n, params = {}) => Array.from({ length: n }, (_, seed) => generateBass({ ...params, seed: seed + 1 }));
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const onSteps = (p) => p.steps.filter((s) => s.on);

test('deterministyczny dla seeda (oba style)', () => {
  assert.deepEqual(generateBass({ seed: 3 }), generateBass({ seed: 3 }));
  assert.deepEqual(generateBass({ seed: 3, style: 'classic' }), generateBass({ seed: 3, style: 'classic' }));
  assert.notDeepEqual(generateBass({ seed: 3 }), generateBass({ seed: 4 }));
});

test('długość wzoru i co najmniej jedna nuta', () => {
  for (const length of [8, 12, 16]) {
    for (const p of many(100, { length })) {
      assert.equal(p.steps.length, length);
      assert.ok(onSteps(p).length >= 1);
    }
  }
});

test('styl classic: krok 0 zawsze gra', () => {
  assert.ok(generateBass({ seed: 1, style: 'classic' }).steps[0].on);
});

test('wysokości w zakresie basu i stopnie w dozwolonym zakresie', () => {
  for (const p of many(300, { density: 1 })) {
    for (const s of onSteps(p)) {
      assert.ok(s.degree >= DEGREE_MIN && s.degree <= DEGREE_MAX, `degree ${s.degree}`);
      const m = pitch(p.root, p.mode, s.degree, s.octave);
      assert.ok(m >= 24 && m <= 72, `${m}`);
    }
  }
});

test('mutacja zmienia najwyżej jeden krok i trzyma się zakresu', () => {
  const p = generateBass({ seed: 2 });
  for (let seed = 0; seed < 200; seed++) {
    const m = mutate(p, mulberry32(seed));
    const diff = m.steps.filter((s, i) => JSON.stringify(s) !== JSON.stringify(p.steps[i])).length;
    assert.ok(diff <= 1);
    for (const s of m.steps) if (s.on) assert.ok(s.degree >= DEGREE_MIN && s.degree <= DEGREE_MAX);
  }
});

test('skale: frygijska ma małą sekundę, electro ma półton nad toniką i oktawę co 7 stopni', () => {
  assert.equal(pitch(0, 'phrygian', 1), 1);
  assert.equal(pitch(0, 'minor', 1), 2);
  assert.equal(pitch(0, 'electro', 1), 1);
  assert.equal(pitch(0, 'electro', 7), 12);
  assert.equal(pitch(0, 'electro', 8), 13);
  assert.equal(MODES.electro.length, 7);
});

test('półtony -> stopnie: tonika, półton, oktawa i poniżej toniki', () => {
  assert.equal(relToDegree(0), 0);
  assert.equal(relToDegree(1), 1);
  assert.equal(relToDegree(12), 7);
  assert.equal(relToDegree(13), 8);
  assert.equal(relToDegree(-2), -2);                     // ♭7 oktawę niżej
  assert.equal(relToDegree(2), null);                    // klasa spoza skali electro
});

// ----- statystyki: wygenerowane wzory mają odtwarzać nauczone rozkłady -----
const sample = many(1500);

test('średnia liczba nut na takt zgodna z nauczoną (± 15%)', () => {
  const avg = mean(sample.map((p) => onSteps(p).length));
  assert.ok(Math.abs(avg / M.meta.notesPerBar - 1) < 0.15, `${avg} vs ${M.meta.notesPerBar}`);
});

test('gęstość: więcej nut przy wyższym density, mniej przy niższym', () => {
  const at = (d) => mean(many(400, { density: d }).map((p) => onSteps(p).length));
  assert.ok(at(0.2) < at(0.5) && at(0.5) < at(0.8), `${at(0.2)} ${at(0.5)} ${at(0.8)}`);
});

test('synkopa przenosi nuty z mocnych na słabe kroki', () => {
  const share = (s) => {
    const ps = many(500, { syncopation: s });
    const strong = ps.reduce((a, p) => a + p.steps.filter((x, i) => x.on && i % 4 === 0).length, 0);
    const all = ps.reduce((a, p) => a + onSteps(p).length, 0);
    return strong / all;
  };
  assert.ok(share(0) > share(0.5) && share(0.5) > share(1), `${share(0)} ${share(0.5)} ${share(1)}`);
});

test('pierwszy krok zwykle gra, jak w nauczonych pętlach', () => {
  const rate = mean(sample.map((p) => (p.steps[0].on ? 1 : 0)));
  assert.ok(rate > 0.75 && rate < 0.97, `${rate}`);
});

test('wysokości: dominuje tonika, na drugim miejscu półton nad nią, rzadkie skoki oktawowe', () => {
  const notes = sample.flatMap(onSteps).map((s) => s.degree);
  const share = (f) => notes.filter(f).length / notes.length;
  const tonic = share((d) => d === 0), semi = share((d) => d === 1), high = share((d) => d >= 7);
  assert.ok(tonic > 0.45 && tonic < 0.8, `tonika ${tonic}`);
  assert.ok(semi > 0.08 && semi < 0.3, `półton ${semi}`);
  assert.ok(high > 0.05 && high < 0.3, `oktawa wyżej ${high}`);
  assert.ok(share((d) => d < 0) < 0.08);
});

test('w jednym wzorze gra tylko kilka różnych wysokości (paleta)', () => {
  const sizes = sample.map((p) => new Set(onSteps(p).map((s) => s.degree)).size);
  assert.ok(mean(sizes) > 1.5 && mean(sizes) < 4.2, `${mean(sizes)}`);
  assert.ok(Math.max(...sizes) <= 5);
});

test('nuty są długie: średnia długość 0,6-1,0 kroku, brak nakładania na następną nutę', () => {
  const gates = [];
  for (const p of sample) {
    const idx = p.steps.map((s, i) => (s.on ? i : -1)).filter((i) => i >= 0);
    idx.forEach((i, k) => {
      const next = idx[(k + 1) % idx.length], ioi = next > i ? next - i : next + 16 - i;
      assert.ok(p.steps[i].gate <= ioi + 1e-9, `gate ${p.steps[i].gate} > odstęp ${ioi}`);
      gates.push(p.steps[i].gate);
    });
  }
  assert.ok(mean(gates) > 0.6 && mean(gates) < 1.0, `${mean(gates)}`);
});

test('głośność: większość nut mocna, część cicha (ghost), akcenty tylko wśród mocnych', () => {
  const vels = sample.flatMap(onSteps).map((s) => s.vel);
  const ghost = vels.filter((v) => v < 70).length / vels.length;
  assert.ok(ghost > 0.04 && ghost < 0.2, `ghost ${ghost}`);
  assert.ok(vels.filter((v) => v >= 100).length / vels.length > 0.6);
  assert.ok(vels.every((v) => v >= 40 && v <= 127));
});

test('model nie zawiera pętli źródłowych: tylko małe tablice zagregowanych liczb', () => {
  const json = JSON.stringify(M);
  assert.ok(json.length < 6000, `rozmiar ${json.length}`);
  assert.equal(M.rhythm.pOn.length, 2);
  assert.equal(M.rhythm.pOn[0].length, 16);
  assert.ok(M.pitch.weights.length <= 20);
  for (const key of Object.keys(M)) assert.ok(['meta', 'rhythm', 'pitch', 'gate', 'velocity'].includes(key), key);
  // żadnej tablicy dłuższej niż 16 elementów (pętla miałaby 128 kroków)
  const walk = (v) => { if (Array.isArray(v)) { assert.ok(v.length <= 20); v.forEach(walk); } else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(M);
});

test('styl classic nadal morfuje przy zmianie density (nuty z niższej gęstości zostają)', () => {
  const a = generateBass({ seed: 9, density: 0.4, style: 'classic' });
  const b = generateBass({ seed: 9, density: 0.5, style: 'classic' });
  a.steps.forEach((s, i) => { if (s.on) assert.ok(b.steps[i].on); });
});

// ----- ACCENT i SLIDE: operacje na żywo na gotowym wzorze -----
const accents = (p) => p.steps.map((s, i) => (s.on && s.vel >= 110 ? i : -1)).filter((i) => i >= 0);
const slides = (p) => p.steps.map((s, i) => (s.on && s.tie ? i : -1)).filter((i) => i >= 0);
const strip = (p) => p.steps.map((s) => ({ on: s.on, degree: s.degree, gate: s.gate }));

test('ACCENT: 0 = brak akcentów, 1 = akcent na każdej mocnej nucie, ciche nuty bez zmian', () => {
  for (const p of many(100)) {
    const none = withAccent(p, 0), all = withAccent(p, 1);
    assert.equal(accents(none).length, 0);
    p.steps.forEach((s, i) => {
      if (s.on && s.vel < 100) { assert.equal(none.steps[i].vel, s.vel); assert.equal(all.steps[i].vel, s.vel); }
      if (s.on && s.vel >= 100) assert.equal(all.steps[i].vel, 120);
    });
  }
});

test('ACCENT: więcej na pokrętle = nadzbiór akcentów (stabilnie), mocne kroki chętniej', () => {
  for (const p of many(60)) {
    let prev = new Set();
    for (const a of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const cur = new Set(accents(withAccent(p, a)));
      prev.forEach((i) => assert.ok(cur.has(i)));
      prev = cur;
    }
  }
  const share = (strong) => {
    let acc = 0, all = 0;
    for (const p of many(400)) p.steps.forEach((s, i) => { if (s.on && s.vel >= 100 && (i % 4 === 0) === strong) { all++; if (withAccent(p, 0.4).steps[i].vel === 120) acc++; } });
    return acc / all;
  };
  assert.ok(share(true) > share(false), `${share(true)} ${share(false)}`);
});

test('ACCENT i SLIDE nie zmieniają liczby nut, wysokości ani długości; są idempotentne', () => {
  for (const p of many(60)) {
    const q = withSlide(withAccent(p, 0.6), 0.5);
    assert.deepEqual(strip(q), strip(p));
    assert.deepEqual(withSlide(withAccent(q, 0.6), 0.5), q);
  }
});

test('SLIDE: tylko między sąsiednimi nutami o różnej wysokości; 0 = brak, 1 = wszystkie takie pary', () => {
  for (const p of many(100)) {
    assert.equal(slides(withSlide(p, 0)).length, 0);
    const all = withSlide(p, 1), n = p.steps.length;
    p.steps.forEach((s, i) => {
      const next = p.steps[(i + 1) % n];
      const eligible = s.on && next.on && next.degree !== s.degree;
      assert.equal(!!all.steps[i].tie, !!eligible, `krok ${i}`);
    });
  }
});

test('SLIDE: więcej na pokrętle = nadzbiór ślizgów', () => {
  for (const p of many(60)) {
    let prev = new Set();
    for (const a of [0, 0.25, 0.5, 0.75, 1]) {
      const cur = new Set(slides(withSlide(p, a)));
      prev.forEach((i) => assert.ok(cur.has(i)));
      prev = cur;
    }
  }
});

test('stabilność: los kroku zależy tylko od jego numeru i ziarna wzoru', () => {
  assert.equal(stepHash(5, 7), stepHash(5, 7));
  assert.notEqual(stepHash(5, 7), stepHash(5, 8));
  assert.notEqual(stepHash(5, 7), stepHash(6, 7));
  const v = Array.from({ length: 2000 }, (_, i) => stepHash(i, 3));
  assert.ok(v.every((x) => x >= 0 && x < 1));
  assert.ok(Math.abs(mean(v) - 0.5) < 0.03);
});
