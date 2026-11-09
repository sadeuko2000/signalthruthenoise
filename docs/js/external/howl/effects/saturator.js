/**
 * HOWL WARM SATURATION - export for Web Audio
 * Author:  TAZI (HOWL project)
 * License: MIT - shared for use in the radarxxx project
 * Original Web Audio implementation: an asymmetric tanh saturator (written from the general
 * technique of biasing a soft clipper; not a port of any third-party code).
 *
 * SOUND
 *   Gentle analogue-style warmth. Even harmonics from the asymmetry thicken low and mid material;
 *   high drive turns into soft, rounded distortion without harsh edges.
 *
 * SIGNAL FLOW
 *   input --> drive gain --> WaveShaper (4x oversampled, y = tanh(x + bias) - tanh(bias))
 *         --> DC blocker (high-pass 12 Hz) --> trim gain --> wet gain --\
 *   input ------------------------------------------------> dry gain ---+--> output
 *
 * PARAMETERS (real-world units, as passed to apply())
 *   drive   dB (0..30)     level pushed into the saturator
 *   bias    0..1           asymmetry; 0 = symmetric (odd harmonics), 1 = strongly asymmetric (even harmonics)
 *   trim    dB (-18..6)    output level compensation
 *   mix     0..1           parallel blend (1 = fully saturated)
 *
 * TYPICAL SOUND
 *   drive = 9 dB, bias = 0.35, trim = -4 dB, mix = 1 on a bass or drum bus.
 */

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const db = (x) => Math.pow(10, x / 20);

function curve(bias) {
  // y = tanh(k*x + b) - tanh(b), normalised so the larger of the two peaks is 1 (asymmetry never adds level). The shaper input range is -1..1,
  // so a signal pushed beyond full scale by the drive gain simply sits on the flat, saturated ends.
  const b = bias * 0.9;
  const k = 1.5;
  const n = 4096;
  const out = new Float32Array(n);
  const offset = Math.tanh(b);
  const peak = Math.max(Math.tanh(k + b) - offset, offset - Math.tanh(-k + b));
  for (let i = 0; i < n; ++i) {
    const x = (i / (n - 1)) * 2 - 1;
    out[i] = (Math.tanh(k * x + b) - offset) / peak;
  }
  return out;
}

export const effect = {
  id: 'howl-warm-saturation',
  name: 'HOWL Warm Saturation',
  params: [
    { id: 'drive', label: 'Drive', def: 0.3, rand: [0.1, 0.6], min: 0, max: 30, curve: 'lin' },
    { id: 'bias', label: 'Asymmetry', def: 0.35, rand: [0.1, 0.8], min: 0, max: 1, curve: 'lin' },
    { id: 'trim', label: 'Trim', def: 0.7, rand: [0.5, 0.85], min: -18, max: 6, curve: 'lin' },
    { id: 'mix', label: 'Mix', def: 1, rand: [0.6, 1], min: 0, max: 1, curve: 'lin' },
  ],
  create(ctx) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const driveGain = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    shaper.oversample = '4x';
    const dc = ctx.createBiquadFilter();
    dc.type = 'highpass';
    dc.frequency.value = 12;
    dc.Q.value = 0.5;
    const trim = ctx.createGain();
    const wet = ctx.createGain();
    const dry = ctx.createGain();
    let lastBias = -1;
    shaper.curve = curve(0.3);
    lastBias = 0.3;

    input.connect(dry);
    dry.connect(output);
    input.connect(driveGain);
    driveGain.connect(shaper);
    shaper.connect(dc);
    dc.connect(trim);
    trim.connect(wet);
    wet.connect(output);

    return {
      input,
      output,
      apply(values, bpm, now) {
        const t = Number.isFinite(now) ? now : ctx.currentTime;
        const v = values || {};
        const bias = clamp(num(v.bias, 0.35), 0, 1);
        if (Math.abs(bias - lastBias) > 1e-3) {
          shaper.curve = curve(bias);
          lastBias = bias;
        }
        driveGain.gain.setTargetAtTime(db(clamp(num(v.drive, 9), 0, 30)), t, 0.02);
        trim.gain.setTargetAtTime(db(clamp(num(v.trim, -4), -18, 6)), t, 0.02);
        const mix = clamp(num(v.mix, 1), 0, 1);
        wet.gain.setTargetAtTime(mix, t, 0.02);
        dry.gain.setTargetAtTime(1 - mix, t, 0.02);
      },
    };
  },
};
