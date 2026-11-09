/**
 * HOWL DISTORTION (14 types) - export for Web Audio
 * Author:  TAZI (HOWL project)
 * License: MIT - shared for use in the radarxxx project
 * Original Web Audio implementation. The 14 type NAMES follow HOWL's "Acid Distortion" page, but each
 * transfer curve here is an independent textbook waveshaper written for this export; it is NOT the
 * HOWL native DSP, so the sound is similar in character, not identical.
 *
 * SOUND
 *   From mild crunch to destruction. Every type is a static waveshaper after a drive gain, with an
 *   optional hard clipper in front of it (the "clipper" stage) and a parallel dry/wet blend.
 *
 * SIGNAL FLOW
 *   input --> clipper gain --> hard clip (optional) --> drive gain --> WaveShaper (type curve, 4x oversampled)
 *         --> DC blocker (high-pass 15 Hz) --> level gain --> wet gain --\
 *   input ----------------------------------------------------> dry gain --+--> output
 *
 * PARAMETERS (real-world units, as passed to apply())
 *   type     choice index 0..13  CRUNCH, CRUSH, DESTROY, DIODE, DISTORTION, GERMANIUM, METAL,
 *                                 OVERDRIVE, SOFT CLIP, TAPE, TUBE, WAVEFOLDER, TRANSISTOR, THICK
 *   drive    0..1        amount of distortion (maps to 0..36 dB of gain into the curve)
 *   clipper  dB (-1..24) pre-gain into a hard clipper; -1 = clipper OFF
 *   mix      0..1        wet amount
 *   level    dB (-24..12) output level
 *
 * TYPICAL SOUND
 *   type = 7 (OVERDRIVE), drive = 0.4, clipper = -1 (off), mix = 1, level = -3 dB for a bass.
 *   For a broken-speaker lead: type = 6 (METAL), drive = 0.7, clipper = 6 dB, mix = 0.6.
 */

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const db = (x) => Math.pow(10, x / 20);
const sgn = (x) => (x < 0 ? -1 : 1);

const TYPES = [
  'CRUNCH', 'CRUSH', 'DESTROY', 'DIODE', 'DISTORTION', 'GERMANIUM', 'METAL',
  'OVERDRIVE', 'SOFT CLIP', 'TAPE', 'TUBE', 'WAVEFOLDER', 'TRANSISTOR', 'THICK',
];

// Each function maps an input in roughly -1..1 (already scaled by the drive gain) to the output.
const SHAPES = [
  (x) => Math.tanh(1.5 * x + 0.1 * x * x), // CRUNCH: soft clip with a touch of 2nd harmonic
  (x) => Math.round(x * 6) / 6, // CRUSH: coarse amplitude quantiser (about 3 bit)
  (x) => {
    // DESTROY: hard fold-back
    let y = x * 2;
    for (let i = 0; i < 6 && Math.abs(y) > 1; ++i) y = sgn(y) * 2 - y;
    return y;
  },
  (x) => (x >= 0 ? 1 - Math.exp(-3 * x) : -0.55 * (1 - Math.exp(3 * x * 1.2))), // DIODE: asymmetric exponential
  (x) => Math.tanh(4 * x), // DISTORTION: heavy symmetric tanh
  (x) => Math.tanh(2 * x + 0.35) - Math.tanh(0.35), // GERMANIUM: soft, biased
  (x) => {
    // METAL: fold then hard clip
    const y = Math.sin(x * 3.2);
    return Math.max(-0.7, Math.min(0.7, y * 1.6));
  },
  (x) => x / (1 + Math.abs(x) * 1.2) * 1.6, // OVERDRIVE: rational soft clip
  (x) => (Math.abs(x) < 1 ? 1.5 * x - 0.5 * x * x * x : sgn(x)), // SOFT CLIP: cubic
  (x) => Math.tanh(1.2 * x) * 0.9 + 0.1 * Math.tanh(4 * x), // TAPE: smooth with tight saturation
  (x) => {
    // TUBE: asymmetric, even-harmonic rich
    const y = x >= 0 ? Math.tanh(1.8 * x) : Math.tanh(1.1 * x) * 0.9;
    return y - 0.05 * x * x;
  },
  (x) => Math.sin(x * Math.PI * 1.25), // WAVEFOLDER: sine fold
  (x) => (x >= 0 ? x / Math.sqrt(1 + 4 * x * x) : 1.4 * x / Math.sqrt(1 + 5 * x * x)), // TRANSISTOR: asymmetric
  (x) => Math.tanh(x) + 0.35 * Math.tanh(3 * x), // THICK: stacked saturation
];

function shaperCurve(type) {
  const n = 4096;
  const out = new Float32Array(n);
  const f = SHAPES[clamp(Math.round(type), 0, 13)];
  for (let i = 0; i < n; ++i) {
    const x = (i / (n - 1)) * 2 - 1;
    out[i] = clamp(f(x * 2.2), -1.4, 1.4);
  }
  return out;
}

const clipCurve = (() => {
  const n = 1025;
  const out = new Float32Array(n);
  for (let i = 0; i < n; ++i) out[i] = (i / (n - 1)) * 2 - 1;
  return out; // identity inside -1..1; the WaveShaper clamps everything outside, which is the hard clip
})();

export const effect = {
  id: 'howl-distortion',
  name: 'HOWL Distortion',
  params: [
    { id: 'type', label: 'Type', def: 7 / 13, rand: [0, 1], min: 0, max: 13, curve: 'choice', choices: TYPES },
    { id: 'drive', label: 'Drive', def: 0.4, rand: [0.2, 0.8], min: 0, max: 1, curve: 'lin' },
    { id: 'clipper', label: 'Clipper', def: 0, rand: [0, 0.5], min: -1, max: 24, curve: 'lin' },
    { id: 'mix', label: 'Dry / Wet', def: 1, rand: [0.5, 1], min: 0, max: 1, curve: 'lin' },
    { id: 'level', label: 'Level', def: 0.6, rand: [0.5, 0.75], min: -24, max: 12, curve: 'lin' },
  ],
  create(ctx) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const clipGain = ctx.createGain();
    const clip = ctx.createWaveShaper();
    clip.oversample = '2x';
    const driveGain = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    shaper.oversample = '4x';
    const dc = ctx.createBiquadFilter();
    dc.type = 'highpass';
    dc.frequency.value = 15;
    dc.Q.value = 0.5;
    const level = ctx.createGain();
    const wet = ctx.createGain();
    const dry = ctx.createGain();
    let lastType = -1;
    let clipperOn = null;

    input.connect(dry);
    dry.connect(output);
    input.connect(clipGain);
    clipGain.connect(driveGain); // re-routed through the hard clipper when the clipper is on
    driveGain.connect(shaper);
    shaper.connect(dc);
    dc.connect(level);
    level.connect(wet);
    wet.connect(output);
    clip.curve = clipCurve;

    const route = (on) => {
      if (on === clipperOn) return;
      clipperOn = on;
      clipGain.disconnect();
      if (on) {
        clipGain.connect(clip);
        clip.connect(driveGain);
      } else {
        try { clip.disconnect(); } catch (e) { /* not connected yet */ }
        clipGain.connect(driveGain);
      }
    };

    return {
      input,
      output,
      apply(values, bpm, now) {
        const t = Number.isFinite(now) ? now : ctx.currentTime;
        const v = values || {};
        const type = clamp(Math.round(num(v.type, 7)), 0, 13);
        if (type !== lastType) {
          shaper.curve = shaperCurve(type);
          lastType = type;
        }
        const clipper = clamp(num(v.clipper, -1), -1, 24);
        route(clipper >= 0);
        clipGain.gain.setTargetAtTime(clipper >= 0 ? db(clipper) : 1, t, 0.02);
        // Drive: 0..1 -> 0..36 dB into the curve (curve input range is -1..1 scaled internally).
        driveGain.gain.setTargetAtTime(0.3 * db(clamp(num(v.drive, 0.4), 0, 1) * 36), t, 0.02);
        level.gain.setTargetAtTime(db(clamp(num(v.level, -3), -24, 12)) * 0.7, t, 0.02);
        const mix = clamp(num(v.mix, 1), 0, 1);
        wet.gain.setTargetAtTime(mix, t, 0.02);
        dry.gain.setTargetAtTime(1 - mix, t, 0.02);
      },
    };
  },
};
