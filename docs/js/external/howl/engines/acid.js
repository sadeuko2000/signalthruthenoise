/**
 * HOWL ACID - monophonic acid bass engine, export for Web Audio
 * Author:  TAZI (HOWL project)
 * License: MIT - shared for use in the radarxxx project
 * Original Web Audio implementation of a classic 303-style bass voice, written from the widely documented
 * behaviour of that circuit family (saw/pulse oscillator, resonant 24 dB low-pass, decaying filter envelope,
 * accent and slide). It follows the parameter layout of HOWL's ACID page but it is NOT a port of HOWL's native
 * ACID engine, so the sound is similar in spirit, not identical.
 *
 * SOUND
 *   Squelchy resonant bass and lead. Filter envelope amount, decay and resonance define the "acid" character;
 *   accent makes selected notes louder, brighter and snappier; slide glides between legato notes.
 *
 * SIGNAL FLOW
 *   oscillator A (sawtooth) ---+--> saw gain ----------------------------+
 *   pulse = oscillator A  -  oscillator B delayed by (width / frequency) -+--> mix --> DC blocker (20 Hz)
 *   sub oscillator (sine / ramp / square, octave and dB level) ------------+
 *   --> low-pass stage 1 --> low-pass stage 2 (resonance) = 24 dB/oct, cutoff driven by a decaying envelope
 *   --> drive (WaveShaper) --> amp GainNode (fast attack, gate, short release) --> voice.out
 *
 * PARAMETERS (units)
 *   waveform    choice 0 saw, 1 pulse
 *   pulseWidth  0..1       pulse duty: 0 = 50%, 1 = 5%
 *   subWave     choice 0 sine, 1 ramp, 2 square
 *   subOctave   -2..0      sub oscillator octave relative to the note
 *   subLevel    dB (-70..6) sub level (-70 = off)
 *   cutoff      Hz (30..12000) base cutoff (the "knob" position)
 *   resonance   0..1
 *   envMod      0..1       how far the envelope opens the filter (1 = +5 octaves)
 *   decay       s (0.05..2.5)  filter envelope decay time
 *   accent      0..1       strength of accented notes (louder, more envelope, shorter decay)
 *   slideTime   ms (10..250) glide time for notes played with slide = true
 *   drive       0..1       post-filter tanh drive
 *   volume      0..1.5     output gain
 *
 * TYPICAL SOUND
 *   Classic acid line: waveform = 0 (saw), cutoff = 450 Hz, resonance = 0.75, envMod = 0.7, decay = 0.3 s,
 *   accent = 0.7, slideTime = 60 ms, drive = 0.3, then play 16th notes with accent and slide on a few steps.
 */

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const db = (x) => Math.pow(10, x / 20);

const PARAMS = [
  { id: 'waveform', label: 'Waveform', min: 0, max: 1, step: 1, def: 0, rand: [0, 1] },
  { id: 'pulseWidth', label: 'Pulse width', min: 0, max: 1, step: 0.01, def: 0.3, rand: [0, 0.8] },
  { id: 'subWave', label: 'Sub wave', min: 0, max: 2, step: 1, def: 0, rand: [0, 2] },
  { id: 'subOctave', label: 'Sub octave', min: -2, max: 0, step: 1, def: -1, rand: [-2, -1] },
  { id: 'subLevel', label: 'Sub level (dB)', min: -70, max: 6, step: 0.5, def: -70, rand: [-70, -6] },
  { id: 'cutoff', label: 'Cutoff (Hz)', min: 30, max: 12000, step: 1, def: 450, rand: [120, 1500] },
  { id: 'resonance', label: 'Resonance', min: 0, max: 1, step: 0.01, def: 0.7, rand: [0.35, 0.95] },
  { id: 'envMod', label: 'Env mod', min: 0, max: 1, step: 0.01, def: 0.65, rand: [0.3, 1] },
  { id: 'decay', label: 'Decay (s)', min: 0.05, max: 2.5, step: 0.01, def: 0.3, rand: [0.1, 1.2] },
  { id: 'accent', label: 'Accent', min: 0, max: 1, step: 0.01, def: 0.7, rand: [0.3, 1] },
  { id: 'slideTime', label: 'Slide (ms)', min: 10, max: 250, step: 1, def: 60, rand: [30, 120] },
  { id: 'drive', label: 'Drive', min: 0, max: 1, step: 0.01, def: 0.25, rand: [0, 0.7] },
  { id: 'volume', label: 'Volume', min: 0, max: 1.5, step: 0.01, def: 0.8, rand: [0.6, 1] },
];

function tanhCurve() {
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; ++i) c[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * 2.2);
  return c;
}

export const engine = {
  id: 'howl-acid',
  name: 'HOWL Acid',
  params: PARAMS,
  create(ctx) {
    const params = {};
    for (const p of PARAMS) params[p.id] = p.def;
    const out = ctx.createGain();

    const oscA = ctx.createOscillator();
    oscA.type = 'sawtooth';
    const oscB = ctx.createOscillator();
    oscB.type = 'sawtooth';
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    const pulseDelay = ctx.createDelay(0.1);
    const sawGain = ctx.createGain();
    const pulseA = ctx.createGain();
    const pulseB = ctx.createGain();
    pulseB.gain.value = -0.5;
    const subGain = ctx.createGain();
    const mix = ctx.createGain();
    mix.gain.value = 0.5;
    const dc = ctx.createBiquadFilter();
    dc.type = 'highpass';
    dc.frequency.value = 20;
    const f1 = ctx.createBiquadFilter();
    const f2 = ctx.createBiquadFilter();
    f1.type = 'lowpass';
    f2.type = 'lowpass';
    const preDrive = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    shaper.curve = tanhCurve();
    shaper.oversample = '2x';
    const amp = ctx.createGain();
    amp.gain.value = 0;

    // pulse = A - delayed B
    oscA.connect(sawGain);
    oscA.connect(pulseA);
    oscB.connect(pulseDelay);
    pulseDelay.connect(pulseB);
    sawGain.connect(mix);
    pulseA.connect(mix);
    pulseB.connect(mix);
    sub.connect(subGain);
    subGain.connect(mix);
    mix.connect(dc);
    dc.connect(f1);
    f1.connect(f2);
    f2.connect(preDrive);
    preDrive.connect(shaper);
    shaper.connect(amp);
    amp.connect(out);
    oscA.start();
    oscB.start();
    sub.start();

    let gateEnd = -1; // time the previous note's gate closes (Infinity while held)
    let lastFreq = 110;
    let envStart = -1;

    const apply = (t) => {
      const p = params;
      const pulse = p.waveform >= 0.5;
      sawGain.gain.setTargetAtTime(pulse ? 0 : 1, t, 0.005);
      pulseA.gain.setTargetAtTime(pulse ? 0.5 : 0, t, 0.005);
      pulseB.gain.setTargetAtTime(pulse ? -0.5 : 0, t, 0.005);
      sub.type = ['sine', 'sawtooth', 'square'][clamp(Math.round(p.subWave), 0, 2)];
      subGain.gain.setTargetAtTime(p.subLevel <= -69 ? 0 : db(p.subLevel) * 0.8, t, 0.01);
      f1.Q.setTargetAtTime(0.707, t, 0.01);
      f2.Q.setTargetAtTime(0.7 + clamp(p.resonance, 0, 1) * 16, t, 0.01);
      preDrive.gain.setTargetAtTime(1 + p.drive * 5, t, 0.01);
    };
    apply(ctx.currentTime);

    return {
      out,
      params,
      setParam(id, v) {
        const meta = PARAMS.find((p) => p.id === id);
        if (!meta) return;
        params[id] = clamp(num(v, meta.def), meta.min, meta.max);
        apply(ctx.currentTime);
      },
      note(t, freq, vel, accent, len, slide, hold) {
        t = Math.max(num(t, ctx.currentTime), ctx.currentTime);
        freq = clamp(num(freq, 110), 8, 6000);
        const p = params;
        const legato = !!slide && gateEnd > t;
        const accentAmt = accent ? clamp(p.accent, 0, 1) : 0;
        const peak = clamp(num(vel, 100) / 127, 0, 1) * (1 + accentAmt * 0.6) * p.volume;
        const duty = 0.5 - 0.45 * clamp(p.pulseWidth, 0, 1);
        const subFreq = freq * Math.pow(2, Math.round(p.subOctave));
        const tc = Math.max(0.002, p.slideTime / 1000 / 3);
        for (const [param, value] of [[oscA.frequency, freq], [oscB.frequency, freq], [sub.frequency, subFreq]]) {
          param.cancelScheduledValues(t);
          if (legato) {
            param.setValueAtTime(param.value, t);
            param.setTargetAtTime(value, t, tc);
          } else {
            param.setValueAtTime(value, t);
          }
        }
        pulseDelay.delayTime.cancelScheduledValues(t);
        if (legato) {
          pulseDelay.delayTime.setValueAtTime(pulseDelay.delayTime.value, t);
          pulseDelay.delayTime.setTargetAtTime(duty / freq, t, tc);
        } else {
          pulseDelay.delayTime.setValueAtTime(duty / freq, t);
        }
        lastFreq = freq;

        // Amplitude gate: 3 ms attack, held until the gate closes, 8 ms release. A legato note keeps the gate open.
        const end = hold ? Infinity : t + Math.max(0.01, num(len, 0.2));
        amp.gain.cancelScheduledValues(t);
        if (legato) {
          amp.gain.setTargetAtTime(peak, t, 0.004);
        } else {
          amp.gain.setValueAtTime(Math.min(amp.gain.value, peak * 0.2), t);
          amp.gain.linearRampToValueAtTime(peak, t + 0.003);
        }
        if (end !== Infinity) {
          amp.gain.setValueAtTime(peak, end);
          amp.gain.linearRampToValueAtTime(0, end + 0.008);
        }
        gateEnd = end;

        // Filter envelope: a decaying exponential from (cutoff * 2^(envMod*5*boost)) down to the base cutoff.
        // A slid note does not retrigger the envelope (like the original circuit family).
        if (!legato) {
          const boost = 1 + accentAmt * 0.5;
          const octaves = clamp(p.envMod, 0, 1) * 5 * boost;
          const decay = clamp(p.decay * (1 - accentAmt * 0.4), 0.04, 3);
          const n = 40;
          const values = new Float32Array(n);
          for (let i = 0; i < n; ++i) {
            const x = (i / (n - 1)) * Math.min(decay * 4, 4); // four time constants
            values[i] = clamp(p.cutoff * Math.pow(2, octaves * Math.exp(-x / (decay * 0.8))), 20, 20000);
          }
          for (const f of [f1, f2]) {
            f.frequency.cancelScheduledValues(t);
            f.frequency.setValueAtTime(values[0], t);
            f.frequency.setValueCurveAtTime(values, t + 0.0001, Math.min(decay * 4, 4));
          }
          envStart = t;
        }
      },
      silence(t) {
        t = Math.max(num(t, ctx.currentTime), ctx.currentTime);
        amp.gain.cancelScheduledValues(t);
        amp.gain.setTargetAtTime(0, t, 0.004);
        gateEnd = -1;
      },
    };
  },
};
