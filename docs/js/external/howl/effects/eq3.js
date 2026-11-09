/**
 * HOWL 3-BAND EQ - export for Web Audio
 * Author:  TAZI (HOWL project)
 * License: MIT - shared for use in the radarxxx project
 * Original Web Audio implementation (standard BiquadFilterNode shelves and a peaking band;
 * not a port of any third-party code). Modelled on the role of HOWL's master EQ.
 *
 * SOUND
 *   Broad, musical tone shaping: bass shelf, sweepable mid bell, treble shelf.
 *
 * SIGNAL FLOW
 *   input --> low shelf --> mid peaking --> high shelf --> output
 *
 * PARAMETERS (real-world units, as passed to apply())
 *   lowGain   dB (-15..15)    low shelf gain
 *   lowFreq   Hz (40..400)    low shelf corner
 *   midGain   dB (-15..15)    mid bell gain
 *   midFreq   Hz (200..5000)  mid bell centre
 *   midQ      0.3..6          mid bell width (higher = narrower)
 *   highGain  dB (-15..15)    high shelf gain
 *   highFreq  Hz (2000..16000) high shelf corner
 *
 * TYPICAL SOUND
 *   Warm: lowGain = +3 dB at 120 Hz, midGain = -2 dB at 400 Hz (Q 1), highGain = +2 dB at 8 kHz.
 */

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

export const effect = {
  id: 'howl-eq3',
  name: 'HOWL 3-Band EQ',
  params: [
    { id: 'lowGain', label: 'Low gain', def: 0.5, rand: [0.35, 0.65], min: -15, max: 15, curve: 'lin' },
    { id: 'lowFreq', label: 'Low freq', def: 0.45, rand: [0.2, 0.7], min: 40, max: 400, curve: 'exp' },
    { id: 'midGain', label: 'Mid gain', def: 0.5, rand: [0.35, 0.65], min: -15, max: 15, curve: 'lin' },
    { id: 'midFreq', label: 'Mid freq', def: 0.5, rand: [0.2, 0.8], min: 200, max: 5000, curve: 'exp' },
    { id: 'midQ', label: 'Mid Q', def: 0.45, rand: [0.2, 0.7], min: 0.3, max: 6, curve: 'exp' },
    { id: 'highGain', label: 'High gain', def: 0.5, rand: [0.35, 0.65], min: -15, max: 15, curve: 'lin' },
    { id: 'highFreq', label: 'High freq', def: 0.6, rand: [0.3, 0.9], min: 2000, max: 16000, curve: 'exp' },
  ],
  create(ctx) {
    const low = ctx.createBiquadFilter();
    low.type = 'lowshelf';
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking';
    const high = ctx.createBiquadFilter();
    high.type = 'highshelf';
    low.connect(mid);
    mid.connect(high);
    low.frequency.value = 120;
    mid.frequency.value = 1000;
    high.frequency.value = 8000;
    return {
      input: low,
      output: high,
      apply(values, bpm, now) {
        const t = Number.isFinite(now) ? now : ctx.currentTime;
        const v = values || {};
        low.gain.setTargetAtTime(clamp(num(v.lowGain, 0), -24, 24), t, 0.02);
        low.frequency.setTargetAtTime(clamp(num(v.lowFreq, 120), 20, 1000), t, 0.02);
        mid.gain.setTargetAtTime(clamp(num(v.midGain, 0), -24, 24), t, 0.02);
        mid.frequency.setTargetAtTime(clamp(num(v.midFreq, 1000), 100, 10000), t, 0.02);
        mid.Q.setTargetAtTime(clamp(num(v.midQ, 1), 0.1, 12), t, 0.02);
        high.gain.setTargetAtTime(clamp(num(v.highGain, 0), -24, 24), t, 0.02);
        high.frequency.setTargetAtTime(clamp(num(v.highFreq, 8000), 1000, 20000), t, 0.02);
      },
    };
  },
};
