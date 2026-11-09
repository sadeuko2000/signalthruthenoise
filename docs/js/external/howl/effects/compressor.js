/**
 * HOWL COMPRESSOR - export for Web Audio
 * Author:  TAZI (HOWL project)
 * License: MIT - shared for use in the radarxxx project
 * Original Web Audio implementation built on the standard DynamicsCompressorNode (not a port of any
 * third-party code). Modelled on the role of HOWL's master compression: glue and loudness.
 *
 * SOUND
 *   Transparent bus glue to heavy pumping, with make-up gain and a parallel (New York style) blend.
 *
 * SIGNAL FLOW
 *   input --> DynamicsCompressorNode --> make-up gain --> wet gain --\
 *   input ----------------------------------------------> dry gain ---+--> output
 *
 * PARAMETERS (real-world units, as passed to apply())
 *   threshold  dB (-60..0)     level above which compression starts
 *   ratio      :1 (1..20)      compression ratio
 *   attack     ms (0.1..100)   how fast it clamps down
 *   release    ms (10..1000)   how fast it lets go
 *   knee       dB (0..40)      softness of the transition
 *   makeup     dB (0..24)      gain added after compression
 *   mix        0..1            parallel blend (1 = fully compressed)
 *
 * TYPICAL SOUND
 *   Drum bus glue: threshold = -18 dB, ratio = 4, attack = 10 ms, release = 120 ms, knee = 6 dB,
 *   makeup = 4 dB, mix = 1. Pumping: threshold = -30 dB, ratio = 12, attack = 1 ms, release = 80 ms.
 */

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const db = (x) => Math.pow(10, x / 20);

export const effect = {
  id: 'howl-compressor',
  name: 'HOWL Compressor',
  params: [
    { id: 'threshold', label: 'Threshold', def: 0.7, rand: [0.5, 0.85], min: -60, max: 0, curve: 'lin' },
    { id: 'ratio', label: 'Ratio', def: 0.2, rand: [0.1, 0.5], min: 1, max: 20, curve: 'exp' },
    { id: 'attack', label: 'Attack', def: 0.5, rand: [0.2, 0.8], min: 0.1, max: 100, curve: 'exp' },
    { id: 'release', label: 'Release', def: 0.5, rand: [0.2, 0.8], min: 10, max: 1000, curve: 'exp' },
    { id: 'knee', label: 'Knee', def: 0.2, rand: [0, 0.6], min: 0, max: 40, curve: 'lin' },
    { id: 'makeup', label: 'Make-up', def: 0.17, rand: [0.1, 0.4], min: 0, max: 24, curve: 'lin' },
    { id: 'mix', label: 'Mix', def: 1, rand: [0.5, 1], min: 0, max: 1, curve: 'lin' },
  ],
  create(ctx) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    const makeup = ctx.createGain();
    const wet = ctx.createGain();
    const dry = ctx.createGain();
    input.connect(dry);
    dry.connect(output);
    input.connect(comp);
    comp.connect(makeup);
    makeup.connect(wet);
    wet.connect(output);
    dry.gain.value = 0;

    return {
      input,
      output,
      apply(values, bpm, now) {
        const t = Number.isFinite(now) ? now : ctx.currentTime;
        const v = values || {};
        comp.threshold.setTargetAtTime(clamp(num(v.threshold, -18), -100, 0), t, 0.02);
        comp.ratio.setTargetAtTime(clamp(num(v.ratio, 4), 1, 20), t, 0.02);
        comp.attack.setTargetAtTime(clamp(num(v.attack, 10), 0.1, 1000) / 1000, t, 0.02);
        comp.release.setTargetAtTime(clamp(num(v.release, 120), 1, 1000) / 1000, t, 0.02);
        comp.knee.setTargetAtTime(clamp(num(v.knee, 6), 0, 40), t, 0.02);
        makeup.gain.setTargetAtTime(db(clamp(num(v.makeup, 4), 0, 24)), t, 0.02);
        const mix = clamp(num(v.mix, 1), 0, 1);
        wet.gain.setTargetAtTime(mix, t, 0.02);
        dry.gain.setTargetAtTime(1 - mix, t, 0.02);
      },
    };
  },
};
