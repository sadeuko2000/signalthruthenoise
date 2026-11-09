/**
 * HOWL FLANGER - export for Web Audio
 * Author:  TAZI (HOWL project)
 * License: MIT - shared for use in the radarxxx project
 * Original Web Audio implementation (not a port of any third-party code).
 *
 * SOUND
 *   Classic through-zero-style jet sweep: a very short modulated delay mixed with the dry signal,
 *   with positive or negative feedback for hollow, metallic resonances.
 *
 * SIGNAL FLOW
 *   input --+------------------------------------------> output (dry)
 *           +--> DelayNode (manual + LFO*depth) --> wet gain --> output
 *                    ^            |
 *                    +-- feedback + (high-pass 40 Hz to keep the loop clean)
 *   LFO (sine OscillatorNode) --> depth gain (ms) --> DelayNode.delayTime
 *
 * PARAMETERS (real-world units, as passed to apply())
 *   rate      Hz (0.05..10)     LFO speed
 *   depth     0..1              sweep width (1 = +-4 ms)
 *   manual    ms (0.5..10)      centre delay of the sweep (lower = higher-pitched jet)
 *   feedback  -0.95..0.95       negative inverts the loop (different harmonic series)
 *   mix       0..1              wet level (dry stays full)
 *
 * TYPICAL SOUND
 *   rate = 0.25 Hz, depth = 0.7, manual = 3 ms, feedback = 0.6, mix = 0.5 on a pad or hi-hats.
 */

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

export const effect = {
  id: 'howl-flanger',
  name: 'HOWL Flanger',
  params: [
    { id: 'rate', label: 'Rate', def: 0.4, rand: [0.15, 0.7], min: 0.05, max: 10, curve: 'exp' },
    { id: 'depth', label: 'Depth', def: 0.7, rand: [0.3, 1], min: 0, max: 1, curve: 'lin' },
    { id: 'manual', label: 'Manual', def: 0.3, rand: [0.1, 0.7], min: 0.5, max: 10, curve: 'exp' },
    { id: 'feedback', label: 'Feedback', def: 0.8, rand: [0.2, 0.95], min: -0.95, max: 0.95, curve: 'lin' },
    { id: 'mix', label: 'Mix', def: 0.5, rand: [0.3, 0.7], min: 0, max: 1, curve: 'lin' },
  ],
  create(ctx) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const delay = ctx.createDelay(0.05);
    const wet = ctx.createGain();
    const feedback = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 40;
    hp.Q.value = -3.01; // high-pass Q is in dB: flat response, so the loop gain never exceeds `feedback`
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.3;
    const depthGain = ctx.createGain();
    depthGain.gain.value = 0;
    delay.delayTime.value = 0.003;
    feedback.gain.value = 0;
    wet.gain.value = 0;

    input.connect(output);
    input.connect(delay);
    delay.connect(wet);
    wet.connect(output);
    delay.connect(hp);
    hp.connect(feedback);
    feedback.connect(delay);
    lfo.connect(depthGain);
    depthGain.connect(delay.delayTime);
    lfo.start();

    return {
      input,
      output,
      apply(values, bpm, now) {
        const t = Number.isFinite(now) ? now : ctx.currentTime;
        const v = values || {};
        const manual = clamp(num(v.manual, 3), 0.5, 10) / 1000;
        const depth = clamp(num(v.depth, 0.7), 0, 1) * 0.004;
        lfo.frequency.setTargetAtTime(clamp(num(v.rate, 0.3), 0.01, 20), t, 0.03);
        // Keep the sweep inside the DelayNode range so the delay never goes negative.
        const width = Math.min(depth, manual - 0.0002);
        depthGain.gain.setTargetAtTime(Math.max(0, width), t, 0.03);
        delay.delayTime.setTargetAtTime(manual, t, 0.03);
        feedback.gain.setTargetAtTime(clamp(num(v.feedback, 0.5), -0.95, 0.95), t, 0.02);
        wet.gain.setTargetAtTime(clamp(num(v.mix, 0.5), 0, 1), t, 0.02);
      },
    };
  },
};
