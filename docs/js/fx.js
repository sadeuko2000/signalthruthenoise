// Globalna sekcja po miksie silników: FILTR (4 style) -> EFEKT (4 style). Każdy styl ma 8 parametrów.
// Wszystkie parametry są znormalizowane 0..1 (suwak), a `map` zamienia je na wartość fizyczną.
// `rand` to „rozsądny” zakres losowania (też 0..1), żeby wylosowane ustawienie nadal pasowało do electro.
// Własne implementacje na natywnych węzłach Web Audio.

import { satCurve } from './engines.js';
import { buildExternalFx } from './extfx.js';

const lin = (a, b) => (n) => a + (b - a) * n;
const expm = (a, b) => (n) => a * Math.pow(b / a, n);
const choice = (list) => (n) => list[Math.min(list.length - 1, Math.floor(n * list.length))];

const hz = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`);
const pc = (v) => `${Math.round(v * 100)}%`;
const msf = (v) => `${v.toFixed(v < 10 ? 1 : 0)} ms`;
const num = (v) => v.toFixed(2);

const P = (id, label, def, rand, map, show = num) => ({ id, label, def, rand, map, show });
const MIX = (def, rand) => P('mix', 'mix', def, rand, lin(0, 1), pc);
const LEVEL = () => P('level', 'poziom', 0.67, [0.6, 0.75], lin(0, 1.5), pc);

const shaper = (ctx, curve) => { const s = ctx.createWaveShaper(); s.curve = curve; s.oversample = '4x'; return s; };
const gain = (ctx, v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
const bq = (ctx, type) => { const f = ctx.createBiquadFilter(); f.type = type; return f; };
const T = (param, v, now, k = 0.02) => param.setTargetAtTime(v, now, k);

function lfo(ctx, type = 'sine') {
  const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = 1;
  const g = ctx.createGain(); g.gain.value = 0;
  osc.connect(g); osc.start();
  return { osc, gain: g };
}

const SHAPES = ['sine', 'triangle', 'square', 'sawtooth'];

// ---------- FILTRY ----------
// Wspólny kształt: wejście -> (dry) + (tor mokry) -> poziom -> wyjście
function wetDry(ctx) {
  const input = gain(ctx), dry = gain(ctx, 0), wet = gain(ctx, 1), lvl = gain(ctx), output = gain(ctx);
  const tone = bq(ctx, 'highshelf'); tone.frequency.value = 3000;
  input.connect(dry).connect(lvl); wet.connect(lvl); lvl.connect(tone).connect(output);
  return { input, dry, wet, lvl, tone, output };
}
function setMix(w, m, level, now, tone = 0) { T(w.dry.gain, 1 - m, now); T(w.wet.gain, m, now); T(w.lvl.gain, level, now); T(w.tone.gain, tone, now); }

function buildLadder(ctx) {
  const w = wetDry(ctx);
  const pre = gain(ctx), sh = shaper(ctx, satCurve(2)), f1 = bq(ctx, 'lowpass'), f2 = bq(ctx, 'lowpass');
  w.input.connect(pre).connect(sh).connect(f1).connect(f2).connect(w.wet);
  const l = lfo(ctx); l.gain.connect(f1.detune); l.gain.connect(f2.detune);
  return {
    input: w.input, output: w.output,
    apply(v, bpm, now) {
      T(f1.frequency, v.cutoff, now); T(f2.frequency, v.cutoff, now);
      T(f1.Q, v.reso * 0.5, now); T(f2.Q, v.reso * 0.5, now);
      T(pre.gain, 1 + v.drive * 5, now);
      l.osc.type = v.lfoShape; T(l.osc.frequency, v.lfoRate, now); T(l.gain.gain, v.lfoDepth, now);
      setMix(w, v.mix, 0.78 / (1 + v.drive * 5), now, v.tone);   // kompensacja: domyślnie poziom bez zmian
    },
    stop() { l.osc.stop(); },
  };
}

function buildSvf(ctx) {
  const w = wetDry(ctx);
  const pre = gain(ctx), sh = shaper(ctx, satCurve(1.6));
  const lp = bq(ctx, 'lowpass'), bp = bq(ctx, 'bandpass'), hp = bq(ctx, 'highpass');
  const gl = gain(ctx), gb = gain(ctx), gh = gain(ctx);
  w.input.connect(pre).connect(sh);
  for (const [f, g] of [[lp, gl], [bp, gb], [hp, gh]]) { sh.connect(f).connect(g).connect(w.wet); }
  const l = lfo(ctx); for (const f of [lp, bp, hp]) l.gain.connect(f.detune);
  return {
    input: w.input, output: w.output,
    apply(v, bpm, now) {
      for (const f of [lp, bp, hp]) { T(f.frequency, v.cutoff, now); T(f.Q, v.reso, now); }
      const m = v.mode;
      T(gl.gain, Math.max(0, 1 - 2 * m), now); T(gb.gain, 1 - Math.abs(2 * m - 1), now); T(gh.gain, Math.max(0, 2 * m - 1), now);
      T(pre.gain, 1 + v.drive * 4, now);
      T(l.osc.frequency, v.lfoRate, now); T(l.gain.gain, v.lfoDepth, now);
      setMix(w, v.mix, 0.74 / (1 + v.drive * 4), now, v.tone);
    },
    stop() { l.osc.stop(); },
  };
}

function buildMs20(ctx) {
  const w = wetDry(ctx);
  const pre = gain(ctx), hp = bq(ctx, 'highpass'), lp = bq(ctx, 'lowpass'), sh = shaper(ctx, satCurve(3));
  w.input.connect(pre).connect(hp).connect(lp).connect(sh).connect(w.wet);
  const l = lfo(ctx); l.gain.connect(lp.detune);
  return {
    input: w.input, output: w.output,
    apply(v, bpm, now) {
      T(hp.frequency, v.hpCut, now); T(hp.Q, v.hpRes, now);
      T(lp.frequency, v.lpCut, now); T(lp.Q, v.lpRes, now);
      T(pre.gain, v.drive, now);
      T(l.osc.frequency, v.lfoRate, now); T(l.gain.gain, v.lfoDepth, now);
      setMix(w, v.mix, 0.47 / Math.sqrt(v.drive), now);
    },
    stop() { l.osc.stop(); },
  };
}

function buildComb(ctx) {
  const w = wetDry(ctx);
  const pre = gain(ctx), sum = gain(ctx), del = ctx.createDelay(0.1), damp = bq(ctx, 'lowpass'), fb = gain(ctx, 0), sat = shaper(ctx, satCurve(1.2));
  w.input.connect(pre).connect(sum);
  sum.connect(del).connect(damp).connect(fb).connect(sat).connect(sum);
  const out = gain(ctx); sum.connect(out).connect(w.wet);
  const l = lfo(ctx); l.gain.connect(del.delayTime);
  return {
    input: w.input, output: w.output,
    apply(v, bpm, now) {
      const t = 1 / v.freq;
      T(del.delayTime, t, now); T(fb.gain, v.feedback, now); T(damp.frequency, v.damping, now);
      T(pre.gain, 1 + v.drive * 3, now);
      T(l.osc.frequency, v.lfoRate, now); T(l.gain.gain, v.lfoDepth * t * 0.4, now);
      T(out.gain, 1 - v.feedback * 0.55, now);
      setMix(w, v.mix, 1 / (1 + v.drive * 0.9), now, v.tone);
    },
    stop() { l.osc.stop(); },
  };
}

export const FILTER_STYLES = [
  { name: 'drabinkowy', params: [
    P('cutoff', 'cutoff', 0.9, [0.45, 0.95], expm(40, 8000), hz),
    P('reso', 'rezonans', 0.15, [0.1, 0.55], lin(0, 30), (v) => `${v.toFixed(0)} dB`),
    P('drive', 'drive', 0.2, [0.1, 0.5], lin(0, 1), pc),
    P('lfoRate', 'lfo tempo', 0.3, [0.15, 0.55], expm(0.1, 12), (v) => `${v.toFixed(1)} Hz`),
    P('lfoDepth', 'lfo głębia', 0, [0, 0.4], lin(0, 2400), (v) => `${Math.round(v)} ct`),
    P('lfoShape', 'lfo kszt.', 0, [0, 0.99], choice(SHAPES), (v) => v),
    MIX(1, [0.8, 1]), 
    P('tone', 'jasność', 0.5, [0.35, 0.65], lin(-9, 9), (v) => `${v > 0 ? '+' : ''}${v.toFixed(0)} dB`),
  ], build: buildLadder },
  { name: 'wielomodowy', params: [
    P('cutoff', 'cutoff', 0.9, [0.4, 0.95], expm(40, 8000), hz),
    P('reso', 'rezonans', 0.15, [0.1, 0.5], lin(0.3, 20), (v) => `Q ${v.toFixed(1)}`),
    P('mode', 'tryb LP-HP', 0, [0, 0.15], lin(0, 1), pc),
    P('drive', 'drive', 0.15, [0.05, 0.4], lin(0, 1), pc),
    P('lfoRate', 'lfo tempo', 0.3, [0.15, 0.55], expm(0.1, 12), (v) => `${v.toFixed(1)} Hz`),
    P('lfoDepth', 'lfo głębia', 0, [0, 0.4], lin(0, 2400), (v) => `${Math.round(v)} ct`),
    MIX(1, [0.8, 1]), 
    P('tone', 'jasność', 0.5, [0.35, 0.65], lin(-9, 9), (v) => `${v > 0 ? '+' : ''}${v.toFixed(0)} dB`),
  ], build: buildSvf },
  { name: 'ms-20', params: [
    P('hpCut', 'hp częst.', 0.1, [0.05, 0.4], expm(30, 3000), hz),
    P('hpRes', 'hp rez.', 0.1, [0.05, 0.5], lin(0.5, 14), (v) => `Q ${v.toFixed(1)}`),
    P('lpCut', 'lp częst.', 0.9, [0.45, 0.95], expm(60, 9000), hz),
    P('lpRes', 'lp rez.', 0.2, [0.15, 0.6], lin(0.5, 24), (v) => `Q ${v.toFixed(1)}`),
    P('drive', 'drive', 0.2, [0.1, 0.6], expm(1, 8), (v) => `${v.toFixed(1)}×`),
    P('lfoRate', 'lfo tempo', 0.3, [0.15, 0.55], expm(0.1, 12), (v) => `${v.toFixed(1)} Hz`),
    P('lfoDepth', 'lfo głębia', 0, [0, 0.4], lin(0, 2400), (v) => `${Math.round(v)} ct`),
    MIX(1, [0.8, 1]),
  ], build: buildMs20 },
  { name: 'grzebień', params: [
    P('freq', 'ton', 0.45, [0.25, 0.65], expm(40, 2000), hz),
    P('feedback', 'feedback', 0.3, [0.2, 0.6], lin(0, 0.93), pc),
    P('damping', 'tłumienie', 0.6, [0.4, 0.8], expm(800, 12000), hz),
    P('lfoRate', 'lfo tempo', 0.3, [0.15, 0.55], expm(0.1, 12), (v) => `${v.toFixed(1)} Hz`),
    P('lfoDepth', 'lfo głębia', 0, [0, 0.4], lin(0, 1), pc),
    P('drive', 'drive', 0.1, [0.05, 0.4], lin(0, 1), pc),
    MIX(0, [0.2, 0.6]), 
    P('tone', 'jasność', 0.5, [0.35, 0.65], lin(-9, 9), (v) => `${v > 0 ? '+' : ''}${v.toFixed(0)} dB`),
  ], build: buildComb },
];

// ---------- EFEKTY ----------
function buildDelay(ctx) {
  const input = gain(ctx), output = gain(ctx), dry = gain(ctx, 1), wet = gain(ctx, 0);
  const dA = ctx.createDelay(2), dB = ctx.createDelay(2), lpA = bq(ctx, 'lowpass'), lpB = bq(ctx, 'lowpass'), fb = gain(ctx, 0);
  input.connect(dry).connect(output);
  input.connect(dA); dA.connect(lpA).connect(dB); dB.connect(lpB).connect(fb).connect(dA);   // ping-pong
  const merger = ctx.createChannelMerger(2);
  const aL = gain(ctx), aR = gain(ctx), bL = gain(ctx), bR = gain(ctx);
  dA.connect(aL).connect(merger, 0, 0); dA.connect(aR).connect(merger, 0, 1);
  dB.connect(bL).connect(merger, 0, 0); dB.connect(bR).connect(merger, 0, 1);
  merger.connect(wet).connect(output);
  const l = lfo(ctx); l.gain.connect(dA.delayTime); l.gain.connect(dB.delayTime);
  return {
    input, output,
    apply(v, bpm, now) {
      const t = Math.min(1.9, v.time * 60 / bpm / 4);
      T(dA.delayTime, t, now); T(dB.delayTime, t, now);
      T(fb.gain, v.feedback, now); T(lpA.frequency, v.tone, now); T(lpB.frequency, v.tone, now);
      const s = v.spread; T(aL.gain, 0.5 + 0.5 * s, now); T(aR.gain, 0.5 - 0.5 * s, now); T(bL.gain, 0.5 - 0.5 * s, now); T(bR.gain, 0.5 + 0.5 * s, now);
      T(l.osc.frequency, v.modRate, now); T(l.gain.gain, v.modDepth, now);
      T(wet.gain, v.mix, now); T(output.gain, v.level, now);
    },
    stop() { l.osc.stop(); },
  };
}

function makeIR(ctx, sec, damp, width) {
  const sr = ctx.sampleRate, len = Math.max(1, Math.floor(sr * sec)), ir = ctx.createBuffer(2, len, sr);
  const a = Math.min(0.999, 2 * Math.PI * damp / sr * 1.0), L = ir.getChannelData(0), R = ir.getChannelData(1);
  let yl = 0, yr = 0;
  for (let i = 0; i < len; i++) {
    const env = Math.pow(1 - i / len, 3.2);
    const nl = Math.random() * 2 - 1, nr = Math.random() * 2 - 1;
    const rr = width * nr + (1 - width) * nl;                 // width 0 = mono
    yl += a * (nl - yl); yr += a * (rr - yr);                 // wygładzenie = tłumienie wysokich
    L[i] = yl * env; R[i] = yr * env;
  }
  return ir;
}

function buildReverb(ctx) {
  const input = gain(ctx), output = gain(ctx), dry = gain(ctx, 1), wet = gain(ctx, 0);
  const hp = bq(ctx, 'highpass'), lp = bq(ctx, 'lowpass'), pre = ctx.createDelay(0.5), conv = ctx.createConvolver();
  input.connect(dry).connect(output);
  input.connect(hp).connect(lp).connect(pre).connect(conv).connect(wet).connect(output);
  let key = '', timer = 0;
  const regen = (v) => { conv.buffer = makeIR(ctx, v.size, v.damping, v.width); };
  return {
    input, output,
    apply(v, bpm, now) {
      T(hp.frequency, v.lowCut, now); T(lp.frequency, v.highCut, now); T(pre.delayTime, v.predelay, now);
      T(wet.gain, v.mix * 1.4, now); T(output.gain, v.level, now);
      const k = `${v.size.toFixed(2)}|${v.damping.toFixed(0)}|${v.width.toFixed(2)}`;
      if (k !== key) {
        const first = key === ''; key = k;
        if (first) regen(v); else { clearTimeout(timer); timer = setTimeout(() => regen(v), 120); }   // IR liczona po zatrzymaniu suwaka
      }
    },
    stop() { clearTimeout(timer); },
  };
}

function buildChorus(ctx) {
  const input = gain(ctx), output = gain(ctx), dry = gain(ctx, 1), wet = gain(ctx, 0);
  const dL = ctx.createDelay(0.1), dR = ctx.createDelay(0.1), fbL = gain(ctx, 0), fbR = gain(ctx, 0), tone = bq(ctx, 'lowpass');
  input.connect(dry).connect(output);
  input.connect(dL); input.connect(dR);
  dL.connect(fbL).connect(dL); dR.connect(fbR).connect(dR);
  const merger = ctx.createChannelMerger(2);
  dL.connect(merger, 0, 0); dR.connect(merger, 0, 1);
  merger.connect(tone).connect(wet).connect(output);
  const lL = lfo(ctx), lR = lfo(ctx); lL.gain.connect(dL.delayTime); lR.gain.connect(dR.delayTime);
  return {
    input, output,
    apply(v, bpm, now) {
      const base = v.delay / 1000;
      T(dL.delayTime, base, now); T(dR.delayTime, base, now);
      T(fbL.gain, v.feedback, now); T(fbR.gain, v.feedback, now);
      T(lL.osc.frequency, v.rate, now); T(lR.osc.frequency, v.rate * (1 + v.spread * 0.2), now);
      const amp = v.depth * base * 0.8; T(lL.gain.gain, amp, now); T(lR.gain.gain, amp, now);
      T(tone.frequency, v.tone, now); T(wet.gain, v.mix, now); T(output.gain, v.level, now);
    },
    stop() { lL.osc.stop(); lR.osc.stop(); },
  };
}

const BITS = [16, 12, 10, 8, 6, 5, 4, 3];
function distCurve(c, bias, bits) {
  const n = 4096, out = new Float32Array(n), levels = Math.pow(2, bits - 1);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, xb = x + bias * 0.35;
    const soft = Math.tanh(3 * xb) / Math.tanh(3), fold = Math.sin(2.4 * xb * Math.PI / 2);
    let y = (1 - c) * soft + c * fold;
    if (bits < 16) y = Math.round(y * levels) / levels;
    out[i] = y;
  }
  return out;
}

function buildDist(ctx) {
  const input = gain(ctx), output = gain(ctx), dry = gain(ctx, 1), wet = gain(ctx, 0);
  const hp = bq(ctx, 'highpass'), drv = gain(ctx), sh = ctx.createWaveShaper(), tone = bq(ctx, 'lowpass'), dc = bq(ctx, 'highpass');
  sh.oversample = '4x'; dc.frequency.value = 20;
  input.connect(dry).connect(output);
  input.connect(hp).connect(drv).connect(sh).connect(tone).connect(dc).connect(wet).connect(output);
  let key = '';
  return {
    input, output,
    apply(v, bpm, now) {
      const k = `${v.curve.toFixed(2)}|${v.bias.toFixed(2)}|${v.bits}`;
      if (k !== key) { key = k; sh.curve = distCurve(v.curve, v.bias, v.bits); }
      T(hp.frequency, v.lowCut, now); T(drv.gain, v.drive, now); T(tone.frequency, v.tone, now);
      T(dry.gain, 1 - v.mix * 0.7, now); T(wet.gain, v.mix / (1.8 * Math.sqrt(v.drive)), now); T(output.gain, v.level, now);
    },
    stop() {},
  };
}

export const FX_STYLES = [
  { name: 'delay', params: [
    P('time', 'czas', 0.4, [0.3, 0.75], choice([0.5, 1, 1.5, 2, 3, 4, 6, 8]), (v) => `${v}/16`),
    P('feedback', 'feedback', 0.4, [0.25, 0.6], lin(0, 0.9), pc),
    P('tone', 'barwa', 0.7, [0.45, 0.85], expm(500, 12000), hz),
    P('spread', 'ping-pong', 0.8, [0.4, 1], lin(0, 1), pc),
    P('modRate', 'mod tempo', 0.3, [0.1, 0.5], expm(0.1, 5), (v) => `${v.toFixed(1)} Hz`),
    P('modDepth', 'mod głębia', 0.1, [0, 0.4], lin(0, 0.006), (v) => msf(v * 1000)),
    MIX(0, [0.15, 0.4]), LEVEL(),
  ], build: buildDelay },
  { name: 'pogłos', params: [
    P('size', 'wielkość', 0.45, [0.25, 0.7], expm(0.3, 5), (v) => `${v.toFixed(1)} s`),
    P('predelay', 'predelay', 0.15, [0, 0.4], lin(0, 0.12), (v) => msf(v * 1000)),
    P('damping', 'tłumienie', 0.5, [0.3, 0.75], expm(1500, 14000), hz),
    P('lowCut', 'lowcut', 0.2, [0.1, 0.5], expm(40, 600), hz),
    P('highCut', 'highcut', 0.8, [0.5, 0.9], expm(1500, 16000), hz),
    P('width', 'szerokość', 0.8, [0.5, 1], lin(0, 1), pc),
    MIX(0, [0.1, 0.35]), LEVEL(),
  ], build: buildReverb },
  { name: 'chorus', params: [
    P('rate', 'tempo', 0.35, [0.15, 0.6], expm(0.05, 8), (v) => `${v.toFixed(2)} Hz`),
    P('depth', 'głębia', 0.4, [0.2, 0.7], lin(0, 1), pc),
    P('delay', 'opóźnienie', 0.5, [0.2, 0.75], expm(1, 25), msf),
    P('feedback', 'feedback', 0.15, [0, 0.45], lin(0, 0.85), pc),
    P('spread', 'szerokość', 0.5, [0.3, 0.9], lin(0, 1), pc),
    P('tone', 'barwa', 0.8, [0.5, 0.9], expm(800, 14000), hz),
    MIX(0, [0.2, 0.5]), LEVEL(),
  ], build: buildChorus },
  { name: 'dystorsja', params: [
    P('drive', 'drive', 0.3, [0.15, 0.55], expm(1, 12), (v) => `${v.toFixed(1)}×`),
    P('curve', 'fold', 0.2, [0, 0.5], lin(0, 1), pc),
    P('bias', 'asymetria', 0, [0, 0.4], lin(0, 1), pc),
    P('bits', 'bity', 0, [0, 0.45], choice(BITS), (v) => `${v} bit`),
    P('tone', 'barwa', 0.7, [0.4, 0.85], expm(600, 14000), hz),
    P('lowCut', 'lowcut', 0.1, [0.05, 0.4], expm(20, 500), hz),
    MIX(0, [0.15, 0.5]), LEVEL(),
  ], build: buildDist },
];

// Efekty zewnętrzne (HOWL) dołączane za czterema własnymi stylami.
FX_STYLES.push(...buildExternalFx());

// ---------- SLOT: jeden styl aktywny, parametry zapamiętane per styl ----------
export const defaultsN = (style) => Object.fromEntries(style.params.map((sp) => [sp.id, sp.def]));
export function randomN(style, rng = Math.random) {
  return Object.fromEntries(style.params.map((sp) => [sp.id, sp.rand[0] + rng() * (sp.rand[1] - sp.rand[0])]));
}
export const mapValues = (style, n) => Object.fromEntries(style.params.map((sp) => [sp.id, sp.map(n[sp.id])]));

export class FxSlot {
  constructor(ctx, styles, bpm) {
    this.ctx = ctx; this.styles = styles; this.bpm = bpm;
    this.input = ctx.createGain(); this.output = ctx.createGain();
    this.bypassGain = ctx.createGain(); this.bypassGain.gain.value = 0;
    this.wetOut = ctx.createGain();
    this.input.connect(this.bypassGain).connect(this.output);
    this.wetOut.connect(this.output);
    this.values = styles.map(defaultsN);
    this.bypass = false;
    this.style = -1;
    this.setStyle(0);
  }
  setStyle(i) {
    if (this.g) { this.input.disconnect(this.g.input); this.g.output.disconnect(); this.g.stop(); }
    this.style = i;
    this.g = this.styles[i].build(this.ctx);
    this.input.connect(this.g.input);
    this.g.output.connect(this.wetOut);
    this.refresh();
  }
  setParam(id, n) { this.values[this.style][id] = n; this.refresh(); }
  refresh() { this.g.apply(mapValues(this.styles[this.style], this.values[this.style]), this.bpm(), this.ctx.currentTime); }
  setBypass(b) {
    this.bypass = b;
    const t = this.ctx.currentTime;
    this.wetOut.gain.setTargetAtTime(b ? 0 : 1, t, 0.01);
    this.bypassGain.gain.setTargetAtTime(b ? 1 : 0, t, 0.01);
  }
  randomize(rng = Math.random) {
    this.values[this.style] = randomN(this.styles[this.style], rng);
    this.refresh();
    return { ...this.values[this.style] };
  }
}

export class GlobalFx {
  constructor(ctx, bpm) {
    this.input = ctx.createGain(); this.output = ctx.createGain();
    this.filter = new FxSlot(ctx, FILTER_STYLES, bpm);
    this.fx = new FxSlot(ctx, FX_STYLES, bpm);
    this.fx2 = new FxSlot(ctx, FX_STYLES, bpm);       // drugi efekt (FX2), domyślnie bez miksu, więc niesłyszalny
    this.slots = [this.filter, this.fx, this.fx2];
    this.order = [0, 1, 2];
    this.route(this.order);
  }
  // ROUTING: kolejność szeregowa trzech sekcji, np. [0, 1, 2] = FLT-FX1-FX2, [1, 0, 2] = FX1-FLT-FX2.
  route(order) {
    this.input.disconnect(); this.slots.forEach((x) => x.output.disconnect());
    const chain = order.map((i) => this.slots[i]);
    this.input.connect(chain[0].input);
    for (let k = 0; k < chain.length - 1; k++) chain[k].output.connect(chain[k + 1].input);
    chain[chain.length - 1].output.connect(this.output);
    this.order = order.slice();
  }
  refresh() { this.slots.forEach((x) => x.refresh()); }   // np. po zmianie BPM (delay zsynchronizowany z tempem)
}
