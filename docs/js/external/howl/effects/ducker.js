/**
 * HOWL KICK DUCKER (sidechain-style pumping) - export for Web Audio
 * Author:  TAZI (HOWL project)
 * License: MIT - shared for use in the radarxxx project
 * Original Web Audio implementation (not a port of any third-party code). Modelled on HOWL's
 * "kick ducking": the signal dips every time a kick fires and recovers smoothly.
 *
 * SOUND
 *   The classic sidechain pump for pads, basses and whole mixes, without needing a real sidechain
 *   input: you tell the ducker WHEN the kick happens (duck(time) / pump(...)), and it shapes a gain
 *   envelope on the audio that passes through it.
 *
 * SIGNAL FLOW
 *   input --> duck gain (automated: dip then exponential-style recovery) --> output
 *
 * PARAMETERS (real-world units, as passed to apply())
 *   depth    0..1         how deep the dip is (1 = silence at the kick)
 *   attack   ms (0..30)   fall time of the dip (0 = instant)
 *   release  ms (30..800) recovery time back to full level
 *   curve    0..1         recovery shape: 0 = linear, 1 = fast-then-slow (more "pumping")
 *
 * EXTRA METHODS (beyond input/output/apply)
 *   fx.duck(time, strength = 1)       dip at an absolute ctx time (call once per kick)
 *   fx.pump(startTime, beats, bpm)    dip on every beat, for `beats` beats from startTime
 *
 * TYPICAL SOUND
 *   depth = 0.7, attack = 3 ms, release = 220 ms, curve = 0.6, then call fx.pump(ctx.currentTime, 16, 120)
 *   to hear a four-on-the-floor pump on whatever is routed through the ducker.
 */

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

export const effect = {
  id: 'howl-ducker',
  name: 'HOWL Kick Ducker',
  params: [
    { id: 'depth', label: 'Depth', def: 0.7, rand: [0.4, 0.95], min: 0, max: 1, curve: 'lin' },
    { id: 'attack', label: 'Attack', def: 0.1, rand: [0, 0.4], min: 0, max: 30, curve: 'lin' },
    { id: 'release', label: 'Release', def: 0.5, rand: [0.2, 0.8], min: 30, max: 800, curve: 'exp' },
    { id: 'curve', label: 'Curve', def: 0.6, rand: [0.2, 1], min: 0, max: 1, curve: 'lin' },
  ],
  create(ctx) {
    const input = ctx.createGain();
    const duck = ctx.createGain();
    const output = ctx.createGain();
    input.connect(duck);
    duck.connect(output);
    const state = { depth: 0.7, attack: 3, release: 220, curve: 0.6 };

    const dip = (time, strength) => {
      const g = duck.gain;
      const t = Math.max(time, ctx.currentTime);
      const low = clamp(1 - state.depth * clamp(strength, 0, 1), 0, 1);
      const a = Math.max(0.0005, state.attack / 1000);
      const r = Math.max(0.01, state.release / 1000);
      g.cancelScheduledValues(t);
      g.setValueAtTime(1, t);
      g.linearRampToValueAtTime(low, t + a);
      // Recovery curve sampled so it can blend between linear (curve 0) and a fast-then-slow shape (curve 1).
      const n = 48;
      const values = new Float32Array(n);
      for (let i = 0; i < n; ++i) {
        const x = i / (n - 1);
        const shaped = (1 - state.curve) * x + state.curve * (1 - Math.pow(1 - x, 3));
        values[i] = low + (1 - low) * shaped;
      }
      g.setValueCurveAtTime(values, t + a, r);
      g.setValueAtTime(1, t + a + r + 0.001);
    };

    return {
      input,
      output,
      apply(values, bpm, now) {
        const v = values || {};
        state.depth = clamp(num(v.depth, 0.7), 0, 1);
        state.attack = clamp(num(v.attack, 3), 0, 30);
        state.release = clamp(num(v.release, 220), 30, 800);
        state.curve = clamp(num(v.curve, 0.6), 0, 1);
      },
      duck(time, strength = 1) {
        dip(num(time, ctx.currentTime), num(strength, 1));
      },
      pump(startTime, beats, bpm) {
        const step = 60 / clamp(num(bpm, 120), 20, 400);
        const first = num(startTime, ctx.currentTime);
        for (let i = 0; i < clamp(Math.floor(num(beats, 4)), 0, 256); ++i) dip(first + i * step, 1);
      },
    };
  },
};
