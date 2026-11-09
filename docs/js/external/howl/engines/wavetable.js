/**
 * HOWL WAVETABLE - monophonic dual wavetable engine, export for Web Audio
 * Author:  TAZI (HOWL project)
 * License: MIT - shared for use in the radarxxx project
 * Original Web Audio implementation that follows the structure of HOWL's WAVETABLE engine (two table
 * oscillators with position, tune, level and a fold effect, then filter and envelope). HOWL's own tables are
 * audio files; this export generates four tables mathematically (additive harmonics), so it needs no files and
 * no external data. It is not a port of any third-party code.
 *
 * SOUND
 *   Evolving digital/analogue hybrids: morph a table with POSITION (or an LFO driving `position` via setParam),
 *   stack a second tuned oscillator, add FOLD for metallic harmonics, shape with filter and envelopes.
 *
 * TABLES (each has 6 frames; position 0..1 crossfades smoothly between frames)
 *   0 BASIC    sine -> triangle -> saw -> square -> pulse 25% -> pulse 10%
 *   1 FORMANT  six vowel-like spectra (two moving formant peaks)
 *   2 DIGITAL  six comb-like spectra (every n-th harmonic emphasised)
 *   3 GLASS    sparse bell-like partials that move from soft to bright
 *
 * SIGNAL FLOW
 *   per table: 6 OscillatorNodes (PeriodicWave frames) --> frame weight gains (triangular crossfade by position)
 *   table 1 + table 2 (level, tune in semitones + cents) --> mix --> fold WaveShaper (sine fold)
 *   --> filter stage 1 --> filter stage 2 (24 dB/oct low-pass, resonance on stage 2; cutoff via filter envelope)
 *   --> amp GainNode (curved ADSR) --> voice.out
 *
 * PARAMETERS (units)
 *   table, table2   choice 0..3  table for oscillator 1 / 2
 *   position, position2 0..1     where in the table each oscillator sits
 *   tune2           semitones (-24..24)  pitch of oscillator 2 relative to oscillator 1
 *   fine2           cents (-50..50)
 *   level2          0..1         oscillator 2 level (oscillator 1 is always full level)
 *   fold            0..1         sine wavefolding amount
 *   cutoff          Hz (30..18000), resonance 0..1, filterEnv -1..1 (1 = +6 octaves), filterDecay s (0.01..3)
 *   ampA, ampD, ampS, ampR  s, s, 0..1, s   amplitude envelope (HOWL's curved shapes)
 *   glide           ms (0..500) portamento for slide notes
 *   volume          0..1.5
 *
 * TYPICAL SOUND
 *   Evolving pad: table = 1 (FORMANT), position = 0.4, table2 = 3 (GLASS), position2 = 0.2, tune2 = +7,
 *   level2 = 0.4, fold = 0.2, cutoff = 4000 Hz, resonance = 0.2, ampA = 0.4, ampS = 0.8, ampR = 0.8.
 *   Bright digital lead: table = 0, position = 0.8, fold = 0.5, cutoff = 9000, filterEnv = 0.2.
 */

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

const FRAMES = 6;
const HARMONICS = 64;
const TABLE_NAMES = ['BASIC', 'FORMANT', 'DIGITAL', 'GLASS'];

// Build one frame's spectrum as {real, imag} Float32Arrays (index 0 = DC, unused).
function frameSpectrum(table, f) {
  const real = new Float32Array(HARMONICS + 1);
  const imag = new Float32Array(HARMONICS + 1);
  const x = f / (FRAMES - 1);
  for (let h = 1; h <= HARMONICS; ++h) {
    if (table === 0) {
      // sine, triangle, saw, square, pulse 25 %, pulse 10 %
      const duty = [0, 0, 0, 0.5, 0.25, 0.1][f];
      if (f === 0) imag[h] = h === 1 ? 1 : 0;
      else if (f === 1) imag[h] = h % 2 ? ((((h - 1) / 2) % 2 ? -1 : 1) * 8) / (Math.PI * Math.PI * h * h) : 0;
      else if (f === 2) imag[h] = 1 / h;
      else {
        // pulse of the given duty: difference of two saws, shifted by the duty
        const a = (2 * Math.PI * h * duty);
        imag[h] = (1 - Math.cos(a)) / h;
        real[h] = Math.sin(a) / h;
      }
    } else if (table === 1) {
      const c1 = [3, 4, 2.5, 3.5, 2, 5][f];
      const c2 = [8, 13, 18, 6.5, 9, 11][f];
      const w = 1.6 + 0.4 * Math.sin(f);
      imag[h] = (1 / Math.pow(h, 0.55)) * (Math.exp(-Math.pow((h - c1) / w, 2)) + 0.7 * Math.exp(-Math.pow((h - c2) / (w + 0.8), 2)));
    } else if (table === 2) {
      const k = f + 1;
      imag[h] = (1 / Math.pow(h, 0.7)) * (h % k === 0 ? 1 : 0.12);
      real[h] = h % (k + 1) === 0 ? 0.35 / Math.pow(h, 0.7) : 0;
    } else {
      const bright = 3 + x * 24;
      const prime = h === 1 || [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61].includes(h);
      imag[h] = prime ? Math.exp(-h / bright) * (h === 1 ? 1 : 0.8) : 0;
    }
  }
  return { real, imag };
}

const waveCache = new WeakMap();
function tableWaves(ctx, table) {
  let perCtx = waveCache.get(ctx);
  if (!perCtx) waveCache.set(ctx, (perCtx = []));
  if (!perCtx[table]) {
    perCtx[table] = [];
    for (let f = 0; f < FRAMES; ++f) {
      const s = frameSpectrum(table, f);
      perCtx[table].push(ctx.createPeriodicWave(s.real, s.imag, { disableNormalization: false }));
    }
  }
  return perCtx[table];
}

function foldCurve(amount) {
  const n = 2048;
  const c = new Float32Array(n);
  const k = 1 + amount * 6;
  for (let i = 0; i < n; ++i) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = amount < 0.001 ? x : Math.sin(x * k * (Math.PI / 2)) / Math.max(1, Math.sqrt(k) * 0.9);
  }
  return c;
}

// ---- envelope model (analytic; see mono.js for the same machinery) ------------------------------------
const ampRise = (x) => x * (0.4 + 0.6 * x);
const ampFall = (p) => { const y = 1 - p; return y * (0.67 + y * (-1.67 + 2 * y)); };
const linRise = (x) => x;
const linFall = (p) => 1 - p;
function envLevel(m, time) {
  const held = (u) => {
    if (u < m.a) return m.start + (1 - m.start) * m.rise(m.a > 0 ? u / m.a : 1);
    const d = u - m.a;
    return d < m.d ? m.s + (1 - m.s) * m.fall(d / m.d) : m.s;
  };
  if (m.tRel !== null && time >= m.tRel) {
    const r = (time - m.tRel) / Math.max(1e-4, m.r);
    return r >= 1 ? 0 : held(m.tRel - m.t0) * m.fall(r);
  }
  return held(time - m.t0);
}
function schedule(param, m, from, map) {
  param.cancelScheduledValues(from);
  param.setValueAtTime(map(envLevel(m, from)), from);
  const ea = m.t0 + m.a, ed = ea + m.d, rel = m.tRel === null ? Infinity : m.tRel;
  const segments = [[m.t0, Math.min(ea, rel)], [ea, Math.min(ed, rel)]];
  if (m.tRel !== null) segments.push([rel, rel + m.r]);
  for (const [x0raw, x1] of segments) {
    const x0 = Math.max(x0raw, from);
    if (!(x1 - x0 > 0.0008)) continue;
    const n = 40;
    const values = new Float32Array(n);
    for (let i = 0; i < n; ++i) values[i] = map(envLevel(m, x0 + 0.0002 + ((x1 - x0 - 0.0004) * i) / (n - 1)));
    param.setValueCurveAtTime(values, x0 + 0.0001, x1 - x0 - 0.0002);
  }
}

const PARAMS = [
  { id: 'table', label: 'Table 1', min: 0, max: 3, step: 1, def: 0, rand: [0, 3] },
  { id: 'position', label: 'Position 1', min: 0, max: 1, step: 0.01, def: 0.5, rand: [0, 1] },
  { id: 'table2', label: 'Table 2', min: 0, max: 3, step: 1, def: 1, rand: [0, 3] },
  { id: 'position2', label: 'Position 2', min: 0, max: 1, step: 0.01, def: 0.3, rand: [0, 1] },
  { id: 'tune2', label: 'Tune 2 (st)', min: -24, max: 24, step: 1, def: 0, rand: [-12, 12] },
  { id: 'fine2', label: 'Fine 2 (cents)', min: -50, max: 50, step: 1, def: 6, rand: [-20, 20] },
  { id: 'level2', label: 'Level 2', min: 0, max: 1, step: 0.01, def: 0.4, rand: [0, 0.8] },
  { id: 'fold', label: 'Fold', min: 0, max: 1, step: 0.01, def: 0.15, rand: [0, 0.7] },
  { id: 'cutoff', label: 'Cutoff (Hz)', min: 30, max: 18000, step: 1, def: 5000, rand: [800, 12000] },
  { id: 'resonance', label: 'Resonance', min: 0, max: 1, step: 0.01, def: 0.15, rand: [0, 0.6] },
  { id: 'filterEnv', label: 'Filter env', min: -1, max: 1, step: 0.01, def: 0.25, rand: [-0.2, 0.7] },
  { id: 'filterDecay', label: 'Filter decay (s)', min: 0.01, max: 3, step: 0.001, def: 0.4, rand: [0.08, 1.5] },
  { id: 'ampA', label: 'Amp attack (s)', min: 0, max: 2, step: 0.001, def: 0.01, rand: [0, 0.5] },
  { id: 'ampD', label: 'Amp decay (s)', min: 0.01, max: 3, step: 0.001, def: 0.4, rand: [0.1, 1.2] },
  { id: 'ampS', label: 'Amp sustain', min: 0, max: 1, step: 0.01, def: 0.7, rand: [0.3, 1] },
  { id: 'ampR', label: 'Amp release (s)', min: 0.005, max: 3, step: 0.001, def: 0.3, rand: [0.05, 1.2] },
  { id: 'glide', label: 'Glide (ms)', min: 0, max: 500, step: 1, def: 60, rand: [20, 200] },
  { id: 'volume', label: 'Volume', min: 0, max: 1.5, step: 0.01, def: 0.7, rand: [0.5, 0.9] },
];

export const engine = {
  id: 'howl-wavetable',
  name: 'HOWL Wavetable',
  params: PARAMS,
  create(ctx) {
    const params = {};
    for (const p of PARAMS) params[p.id] = p.def;
    const out = ctx.createGain();
    const mix = ctx.createGain();
    mix.gain.value = 0.3;
    const fold = ctx.createWaveShaper();
    fold.oversample = '2x';
    fold.curve = foldCurve(params.fold);
    const f1 = ctx.createBiquadFilter();
    const f2 = ctx.createBiquadFilter();
    f1.type = 'lowpass';
    f2.type = 'lowpass';
    const amp = ctx.createGain();
    amp.gain.value = 0;
    mix.connect(fold);
    fold.connect(f1);
    f1.connect(f2);
    f2.connect(amp);
    amp.connect(out);

    // Two banks of FRAMES oscillators each.
    const banks = [0, 1].map((which) => {
      const level = ctx.createGain();
      level.gain.value = which === 0 ? 1 : params.level2;
      level.connect(mix);
      const oscs = [];
      const gains = [];
      for (let f = 0; f < FRAMES; ++f) {
        const o = ctx.createOscillator();
        o.frequency.value = 110;
        const g = ctx.createGain();
        g.gain.value = 0;
        o.connect(g);
        g.connect(level);
        o.start();
        oscs.push(o);
        gains.push(g);
      }
      return { level, oscs, gains };
    });

    let ampModel = null;
    let filtModel = null;
    let lastFold = params.fold;

    const apply = (t) => {
      const p = params;
      for (let which = 0; which < 2; ++which) {
        const table = Math.round(which === 0 ? p.table : p.table2);
        const position = which === 0 ? p.position : p.position2;
        const waves = tableWaves(ctx, clamp(table, 0, 3));
        banks[which].oscs.forEach((o, f) => o.setPeriodicWave(waves[f]));
        banks[which].gains.forEach((g, f) => {
          const w = Math.max(0, 1 - Math.abs(clamp(position, 0, 1) * (FRAMES - 1) - f));
          g.gain.setTargetAtTime(w, t, 0.01);
        });
      }
      banks[1].level.gain.setTargetAtTime(p.level2, t, 0.01);
      if (Math.abs(p.fold - lastFold) > 0.002) {
        fold.curve = foldCurve(p.fold);
        lastFold = p.fold;
      }
      f1.Q.setTargetAtTime(0.707, t, 0.01);
      f2.Q.setTargetAtTime(0.7 + clamp(p.resonance, 0, 1) * 12, t, 0.01);
    };
    apply(ctx.currentTime);

    const setFreq = (param, value, t, legato, tc) => {
      param.cancelScheduledValues(t);
      if (legato) {
        param.setValueAtTime(param.value, t);
        param.setTargetAtTime(value, t, tc);
      } else param.setValueAtTime(value, t);
    };

    return {
      out,
      params,
      setParam(id, v) {
        const meta = PARAMS.find((q) => q.id === id);
        if (!meta) return;
        params[id] = clamp(num(v, meta.def), meta.min, meta.max);
        apply(ctx.currentTime);
      },
      note(t, freq, vel, accent, len, slide, hold) {
        t = Math.max(num(t, ctx.currentTime), ctx.currentTime);
        freq = clamp(num(freq, 110), 8, 12000);
        const p = params;
        const peak = clamp((num(vel, 100) / 127) * (accent ? 1.35 : 1), 0, 1.4);
        const legato = !!slide && ampModel !== null && (ampModel.tRel === null || ampModel.tRel + ampModel.r > t) && envLevel(ampModel, t) > 0.001;
        const tc = Math.max(0.001, p.glide / 1000 / 3);
        const ratio2 = Math.pow(2, p.tune2 / 12 + p.fine2 / 1200);
        banks[0].oscs.forEach((o) => setFreq(o.frequency, freq, t, legato && p.glide > 0, tc));
        banks[1].oscs.forEach((o) => setFreq(o.frequency, freq * ratio2, t, legato && p.glide > 0, tc));
        const tRel = hold ? null : t + Math.max(0.005, num(len, 0.2));
        if (legato) {
          ampModel.tRel = tRel;
          filtModel.tRel = tRel;
        } else {
          const sa = ampModel ? clamp(envLevel(ampModel, t), 0, 1) : 0;
          ampModel = { t0: t, a: p.ampA, d: p.ampD, s: p.ampS, r: p.ampR, tRel, start: sa, rise: ampRise, fall: ampFall };
          const sf = filtModel ? clamp(envLevel(filtModel, t), 0, 1) : 0;
          filtModel = { t0: t, a: 0.001, d: p.filterDecay, s: 0, r: p.ampR, tRel, start: sf, rise: linRise, fall: linFall };
        }
        const octaves = p.filterEnv * 6 * (accent ? 1.25 : 1);
        const cutMap = (l) => clamp(p.cutoff * Math.pow(2, octaves * l), 20, 20000);
        schedule(amp.gain, ampModel, t, (l) => l * peak * p.volume);
        schedule(f1.frequency, filtModel, t, cutMap);
        schedule(f2.frequency, filtModel, t, cutMap);
      },
      silence(t) {
        t = Math.max(num(t, ctx.currentTime), ctx.currentTime);
        amp.gain.cancelScheduledValues(t);
        amp.gain.setTargetAtTime(0, t, 0.004);
        ampModel = null;
        filtModel = null;
      },
    };
  },
};
