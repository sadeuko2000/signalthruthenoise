/**
 * HOWL MONO - monophonic two-oscillator engine, export for Web Audio
 * Author:  TAZI (HOWL project)
 * License: MIT - shared for use in the radarxxx project
 * Original Web Audio implementation that follows the behaviour and parameter set of HOWL's MONO engine
 * (two oscillators, sync, ring modulation, pulse width / PWM, filter and curved ADSR). It is not a port of
 * any third-party code.
 *
 * SOUND
 *   Classic analogue-style mono voice: bass, lead, sync lead, ring-modulated metallic tones, PWM pads.
 *
 * SIGNAL FLOW
 *   AudioWorklet "howl-mono-osc" (inlined, loaded from a Blob URL)
 *       oscillator A  (saw / pulse / triangle / sine, PolyBLEP anti-aliased)
 *       oscillator B  (same waves, tuned by octave + fine)   -- hard-synced to A when SYNC is on
 *       mix:  (1-ring)*(A*levelA + B*levelB) + ring * 2 * (A*levelA) * (B*levelB)
 *       pulse width (also modulated by a PWM LFO: OscillatorNode -> GainNode -> pulseWidth AudioParam)
 *   --> filter stage 1 --> filter stage 2 (two cascaded biquads: 24 dB/oct; resonance on stage 2)
 *       type: lowpass / highpass / bandpass / notch; cutoff moved by a filter ADSR envelope
 *   --> drive (WaveShaper tanh) --> amp GainNode (curved ADSR) --> voice.out
 *
 * IMPORTANT: this engine needs AudioWorklet (all current browsers). create(ctx) returns immediately and
 * queues notes until the worklet has loaded; call `await engine.prepare(ctx)` once at start-up (or
 * `await voice.ready`) to be sure the first note is not late.
 *
 * PARAMETERS (units)
 *   waveA, waveB   choice 0 saw, 1 pulse, 2 triangle, 3 sine
 *   levelA, levelB 0..1        oscillator levels
 *   octaveA/B      -2..2 oct   octave of each oscillator
 *   fineB          cents (-100..100) detune of B
 *   sync           0/1         hard sync: B restarts every time A completes a cycle
 *   ring           0..1        blend from normal A+B to ring modulation A x B
 *   pulseWidth     0..1        pulse wave duty: 0 = 50%, 1 = 5% (pulse waves only)
 *   pwmRate        Hz (0.05..12) speed of the PWM LFO
 *   pwmDepth       0..1        PWM amount (0 = off)
 *   filterType     choice 0 lowpass, 1 highpass, 2 bandpass, 3 notch
 *   cutoff         Hz (30..18000) base cutoff
 *   resonance      0..1
 *   filterEnv      -1..1       envelope amount (1 = +6 octaves, negative = downward)
 *   fA, fD, fS, fR s, s, 0..1, s  filter envelope (linear segments)
 *   ampA, ampD, ampS, ampR  s, s, 0..1, s  amplitude envelope (HOWL's curved shapes)
 *   drive          0..1        tanh drive after the filter
 *   glide          ms (0..500)  portamento time when a note has slide = true
 *   volume         0..1.5      output gain
 *
 * TYPICAL SOUND
 *   Sync lead: waveA = 0 (saw), waveB = 0 (saw), sync = 1, octaveB = 1, then sweep fineB (-100..100) or change
 *   octaveB to hear the classic sync sweep; cutoff = 3500 Hz, resonance = 0.25, filterEnv = 0.3, ampS = 0.8.
 *   PWM bass: waveA = 1 (pulse), levelB = 0, pulseWidth = 0.3, pwmRate = 0.6, pwmDepth = 0.5,
 *   cutoff = 700 Hz, resonance = 0.35, filterEnv = 0.5, fD = 0.25, fS = 0.
 */

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

const WORKLET = `
class HowlMonoOsc extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'frequency', defaultValue: 110, minValue: 0.01, maxValue: 22050, automationRate: 'a-rate' },
      { name: 'pulseWidth', defaultValue: 0, minValue: -1, maxValue: 2, automationRate: 'a-rate' },
      { name: 'ratioB', defaultValue: 1, minValue: 0.01, maxValue: 64, automationRate: 'k-rate' },
      { name: 'levelA', defaultValue: 0.7, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'levelB', defaultValue: 0.5, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'ring', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'sync', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'waveA', defaultValue: 0, minValue: 0, maxValue: 3, automationRate: 'k-rate' },
      { name: 'waveB', defaultValue: 0, minValue: 0, maxValue: 3, automationRate: 'k-rate' }
    ];
  }
  constructor() { super(); this.pa = 0; this.pb = 0; }
  static blep(t, dt) {
    if (t < dt) { t /= dt; return t + t - t * t - 1; }
    if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
    return 0;
  }
  static wave(shape, p, dt, duty) {
    if (shape === 0) return 2 * p - 1 - HowlMonoOsc.blep(p, dt);
    if (shape === 1) {
      let q = p + 1 - duty; q -= Math.floor(q);
      return (p < duty ? 1 : -1) + HowlMonoOsc.blep(p, dt) - HowlMonoOsc.blep(q, dt);
    }
    if (shape === 2) return 1 - 4 * Math.abs(p - 0.5);
    return Math.sin(6.283185307179586 * p);
  }
  process(inputs, outputs, parameters) {
    const out = outputs[0][0];
    const n = out.length;
    const f = parameters.frequency, pw = parameters.pulseWidth;
    const ratio = parameters.ratioB[0], la = parameters.levelA[0], lb = parameters.levelB[0];
    const ring = parameters.ring[0], sync = parameters.sync[0] >= 0.5;
    const wa = Math.round(parameters.waveA[0]), wb = Math.round(parameters.waveB[0]);
    for (let i = 0; i < n; ++i) {
      const fr = f.length > 1 ? f[i] : f[0];
      const w = pw.length > 1 ? pw[i] : pw[0];
      const duty = Math.min(0.97, Math.max(0.03, 0.5 - 0.45 * Math.min(1, Math.max(0, w))));
      const dta = Math.min(0.49, fr / sampleRate);
      const dtb = Math.min(0.49, dta * ratio);
      this.pa += dta;
      this.pb += dtb;
      if (this.pa >= 1) {
        this.pa -= 1;
        if (sync) this.pb = this.pa * ratio; // restart B at the matching fractional position
      }
      this.pb -= Math.floor(this.pb);
      const a = HowlMonoOsc.wave(wa, this.pa, dta, duty) * la;
      const b = HowlMonoOsc.wave(wb, this.pb, dtb, duty) * lb;
      const sum = a + b;
      out[i] = sum + ring * (2 * a * b - sum);
    }
    return true;
  }
}
registerProcessor('howl-mono-osc', HowlMonoOsc);
`;

const loaded = new WeakMap();
function loadWorklet(ctx) {
  if (!loaded.has(ctx)) {
    if (!ctx.audioWorklet) throw new Error('HOWL MONO needs AudioWorklet support');
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    loaded.set(ctx, ctx.audioWorklet.addModule(url));
  }
  return loaded.get(ctx);
}

// ---- envelope model (analytic, so segments can be re-scheduled mid-note) ------------------------------
// HOWL's curved amplitude shapes: attack x*(0.4+0.6x); fall y*(0.67+y*(-1.67+2y)) with y = 1-p.
const ampRise = (x) => x * (0.4 + 0.6 * x);
const ampFall = (p) => { const y = 1 - p; return y * (0.67 + y * (-1.67 + 2 * y)); };
const linRise = (x) => x;
const linFall = (p) => 1 - p;

function envLevel(m, time) {
  const u = time - m.t0;
  const held = (u2) => {
    if (u2 < m.a) return m.start + (1 - m.start) * m.rise(m.a > 0 ? u2 / m.a : 1);
    const d = u2 - m.a;
    if (d < m.d) return m.s + (1 - m.s) * m.fall(d / m.d);
    return m.s;
  };
  if (m.tRel !== null && time >= m.tRel) {
    const r = (time - m.tRel) / Math.max(1e-4, m.r);
    if (r >= 1) return 0;
    return held(m.tRel - m.t0) * m.fall(r);
  }
  return held(u);
}

// Schedule `param` from time `from` onward for envelope model m; map converts level 0..1 to the param value.
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
  { id: 'waveA', label: 'Wave A', min: 0, max: 3, step: 1, def: 0, rand: [0, 3] },
  { id: 'waveB', label: 'Wave B', min: 0, max: 3, step: 1, def: 0, rand: [0, 3] },
  { id: 'levelA', label: 'Level A', min: 0, max: 1, step: 0.01, def: 0.7, rand: [0.5, 1] },
  { id: 'levelB', label: 'Level B', min: 0, max: 1, step: 0.01, def: 0.5, rand: [0, 0.8] },
  { id: 'octaveA', label: 'Octave A', min: -2, max: 2, step: 1, def: 0, rand: [-1, 1] },
  { id: 'octaveB', label: 'Octave B', min: -2, max: 2, step: 1, def: 0, rand: [-1, 1] },
  { id: 'fineB', label: 'Fine B (cents)', min: -100, max: 100, step: 1, def: 7, rand: [-30, 30] },
  { id: 'sync', label: 'Osc sync', min: 0, max: 1, step: 1, def: 0, rand: [0, 1] },
  { id: 'ring', label: 'Ring mod', min: 0, max: 1, step: 0.01, def: 0, rand: [0, 0.6] },
  { id: 'pulseWidth', label: 'Pulse width', min: 0, max: 1, step: 0.01, def: 0, rand: [0, 0.8] },
  { id: 'pwmRate', label: 'PWM rate (Hz)', min: 0.05, max: 12, step: 0.05, def: 0.6, rand: [0.2, 4] },
  { id: 'pwmDepth', label: 'PWM depth', min: 0, max: 1, step: 0.01, def: 0, rand: [0, 0.7] },
  { id: 'filterType', label: 'Filter type', min: 0, max: 3, step: 1, def: 0, rand: [0, 1] },
  { id: 'cutoff', label: 'Cutoff (Hz)', min: 30, max: 18000, step: 1, def: 1800, rand: [300, 6000] },
  { id: 'resonance', label: 'Resonance', min: 0, max: 1, step: 0.01, def: 0.25, rand: [0.05, 0.7] },
  { id: 'filterEnv', label: 'Filter env', min: -1, max: 1, step: 0.01, def: 0.35, rand: [-0.2, 0.8] },
  { id: 'fA', label: 'Filter attack (s)', min: 0, max: 2, step: 0.001, def: 0.002, rand: [0, 0.1] },
  { id: 'fD', label: 'Filter decay (s)', min: 0.01, max: 3, step: 0.001, def: 0.25, rand: [0.05, 0.8] },
  { id: 'fS', label: 'Filter sustain', min: 0, max: 1, step: 0.01, def: 0.2, rand: [0, 0.7] },
  { id: 'fR', label: 'Filter release (s)', min: 0.005, max: 3, step: 0.001, def: 0.15, rand: [0.03, 0.8] },
  { id: 'ampA', label: 'Amp attack (s)', min: 0, max: 2, step: 0.001, def: 0.003, rand: [0, 0.15] },
  { id: 'ampD', label: 'Amp decay (s)', min: 0.01, max: 3, step: 0.001, def: 0.3, rand: [0.08, 1] },
  { id: 'ampS', label: 'Amp sustain', min: 0, max: 1, step: 0.01, def: 0.75, rand: [0.3, 1] },
  { id: 'ampR', label: 'Amp release (s)', min: 0.005, max: 3, step: 0.001, def: 0.12, rand: [0.03, 0.8] },
  { id: 'drive', label: 'Drive', min: 0, max: 1, step: 0.01, def: 0.1, rand: [0, 0.5] },
  { id: 'glide', label: 'Glide (ms)', min: 0, max: 500, step: 1, def: 60, rand: [20, 200] },
  { id: 'volume', label: 'Volume', min: 0, max: 1.5, step: 0.01, def: 0.8, rand: [0.6, 1] },
];

function tanhCurve() {
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; ++i) c[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * 2.2);
  return c;
}

export const engine = {
  id: 'howl-mono',
  name: 'HOWL Mono',
  params: PARAMS,
  prepare(ctx) {
    return loadWorklet(ctx);
  },
  create(ctx) {
    const params = {};
    for (const p of PARAMS) params[p.id] = p.def;
    const out = ctx.createGain();
    const queue = []; // calls made before the worklet is ready
    let node = null;
    let lfo = null;
    let lfoGain = null;
    const filters = [ctx.createBiquadFilter(), ctx.createBiquadFilter()];
    const shaper = ctx.createWaveShaper();
    shaper.curve = tanhCurve();
    shaper.oversample = '2x';
    const preDrive = ctx.createGain();
    const amp = ctx.createGain();
    amp.gain.value = 0;
    filters[0].connect(filters[1]);
    filters[1].connect(preDrive);
    preDrive.connect(shaper);
    shaper.connect(amp);
    amp.connect(out);

    let ampModel = null;
    let filtModel = null;
    let lastFreq = 110;

    const stageSetup = (t) => {
      const type = ['lowpass', 'highpass', 'bandpass', 'notch'][clamp(Math.round(params.filterType), 0, 3)];
      const res = clamp(params.resonance, 0, 1);
      filters[0].type = type;
      filters[1].type = type;
      filters[0].Q.setTargetAtTime(0.707, t, 0.01);
      filters[1].Q.setTargetAtTime(type === 'lowpass' || type === 'highpass' ? 0.6 + res * 14 : 0.6 + res * 6, t, 0.01);
      preDrive.gain.setTargetAtTime(1 + params.drive * 5, t, 0.01);
    };
    const oscSetup = (t) => {
      if (!node) return;
      const P = (name) => node.parameters.get(name);
      P('levelA').setTargetAtTime(params.levelA, t, 0.005);
      P('levelB').setTargetAtTime(params.levelB, t, 0.005);
      P('ring').setTargetAtTime(params.ring, t, 0.005);
      P('sync').setValueAtTime(params.sync >= 0.5 ? 1 : 0, t);
      P('waveA').setValueAtTime(params.waveA, t);
      P('waveB').setValueAtTime(params.waveB, t);
      P('ratioB').setTargetAtTime(Math.pow(2, params.octaveB - params.octaveA + params.fineB / 1200), t, 0.005);
      P('pulseWidth').setTargetAtTime(params.pulseWidth, t, 0.005);
      lfo.frequency.setTargetAtTime(params.pwmRate, t, 0.01);
      lfoGain.gain.setTargetAtTime(params.pwmDepth * 0.5, t, 0.01);
    };

    const build = () => {
      node = new AudioWorkletNode(ctx, 'howl-mono-osc', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
      lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfoGain = ctx.createGain();
      lfoGain.gain.value = 0;
      lfo.connect(lfoGain);
      lfoGain.connect(node.parameters.get('pulseWidth'));
      lfo.start();
      node.connect(filters[0]);
      stageSetup(ctx.currentTime);
      oscSetup(ctx.currentTime);
      node.parameters.get('frequency').value = lastFreq;
      for (const fn of queue.splice(0)) fn();
    };
    const ready = loadWorklet(ctx).then(build);
    const run = (fn) => (node ? fn() : queue.push(fn));

    const voice = {
      out,
      params,
      ready,
      setParam(id, v) {
        const meta = PARAMS.find((p) => p.id === id);
        if (!meta) return;
        params[id] = clamp(num(v, meta.def), meta.min, meta.max);
        const t = ctx.currentTime;
        stageSetup(t);
        run(() => oscSetup(t));
      },
      note(t, freq, vel, accent, len, slide, hold) {
        run(() => {
          t = Math.max(num(t, ctx.currentTime), ctx.currentTime);
          freq = clamp(num(freq, 110), 8, 12000);
          const p = params;
          const peak = clamp((num(vel, 100) / 127) * (accent ? 1.35 : 1), 0, 1.4);
          const open = ampModel !== null && (ampModel.tRel === null || ampModel.tRel + ampModel.r > t) && envLevel(ampModel, t) > 0.001;
          const legato = !!slide && open;
          const base = freq * Math.pow(2, p.octaveA);
          const f = node.parameters.get('frequency');
          if (legato && p.glide > 0) {
            f.cancelScheduledValues(t);
            f.setValueAtTime(lastFreq * Math.pow(2, p.octaveA) || base, t);
            f.setTargetAtTime(base, t, Math.max(0.001, p.glide / 1000 / 3));
          } else {
            f.cancelScheduledValues(t);
            f.setValueAtTime(base, t);
          }
          lastFreq = freq;
          const tRel = hold ? null : t + Math.max(0.005, num(len, 0.2));
          if (legato) {
            ampModel.tRel = tRel;
            filtModel.tRel = tRel;
          } else {
            const startAmp = ampModel ? clamp(envLevel(ampModel, t), 0, 1) : 0;
            ampModel = { t0: t, a: p.ampA, d: p.ampD, s: p.ampS, r: p.ampR, tRel, start: startAmp, rise: ampRise, fall: ampFall };
            const startF = filtModel ? clamp(envLevel(filtModel, t), 0, 1) : 0;
            filtModel = { t0: t, a: p.fA, d: p.fD, s: p.fS, r: p.fR, tRel, start: startF, rise: linRise, fall: linFall };
          }
          const gainMap = (l) => l * peak * p.volume;
          const octaves = p.filterEnv * 6 * (accent ? 1.25 : 1);
          const cutMap = (l) => clamp(p.cutoff * Math.pow(2, octaves * l), 20, 20000);
          schedule(amp.gain, ampModel, t, gainMap);
          schedule(filters[0].frequency, filtModel, t, cutMap);
          schedule(filters[1].frequency, filtModel, t, cutMap);
        });
      },
      silence(t) {
        run(() => {
          t = Math.max(num(t, ctx.currentTime), ctx.currentTime);
          amp.gain.cancelScheduledValues(t);
          amp.gain.setTargetAtTime(0, t, 0.004);
          ampModel = null;
          filtModel = null;
        });
      },
    };
    return voice;
  },
};
