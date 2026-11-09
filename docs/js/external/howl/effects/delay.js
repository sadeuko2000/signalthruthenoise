/**
 * HOWL DELAY - export for Web Audio
 * Author:  TAZI (HOWL project)
 * License: MIT - shared for use in the radarxxx project
 * Original Web Audio implementation (not a port of any third-party code).
 *
 * SOUND
 *   Clean-to-dark feedback delay. Echoes get progressively duller (low-pass in the
 *   feedback loop). Time is free (ms) or locked to the tempo (note divisions).
 *
 * SIGNAL FLOW
 *   input --+--------------------------------------------> output (dry, always full level)
 *           +--> DelayNode --> low-pass (tone) --> wet gain --> output
 *                    ^               |
 *                    +-- feedback <--+
 *
 * PARAMETERS (real-world units, as passed to apply())
 *   sync      choice index  0 free, 1 1/16, 2 1/8, 3 dotted 1/8, 4 1/4, 5 dotted 1/4, 6 1/2, 7 1/8 triplet, 8 1/4 triplet
 *   time      ms (10..1500) used only when sync is 0 (free)
 *   feedback  0..0.95       how much of each echo returns
 *   tone      Hz (400..12000) low-pass cutoff inside the loop (lower = darker echoes)
 *   mix       0..1          level of the echoes added to the dry signal
 *
 * TYPICAL SOUND
 *   sync = 3 (dotted 1/8), feedback = 0.4, tone = 4000 Hz, mix = 0.35 at 120 bpm.
 *   For a slapback: sync = 0, time = 90 ms, feedback = 0.1, mix = 0.3.
 *
 * USAGE
 *   const fx = effect.create(ctx); source.connect(fx.input); fx.output.connect(ctx.destination);
 *   fx.apply({ sync: 3, time: 300, feedback: 0.4, tone: 4000, mix: 0.35 }, 120, ctx.currentTime);
 */

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

const SYNC = ['free', '1/16', '1/8', '1/8.', '1/4', '1/4.', '1/2', '1/8T', '1/4T'];
const BEATS = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 1 / 3, 2 / 3]; // length in quarter-note beats

export const effect = {
  id: 'howl-delay',
  name: 'HOWL Delay',
  params: [
    { id: 'sync', label: 'Sync', def: 3 / 8, rand: [0, 1], min: 0, max: 8, curve: 'choice', choices: SYNC },
    { id: 'time', label: 'Time (free)', def: 0.68, rand: [0.2, 0.9], min: 10, max: 1500, curve: 'exp' },
    { id: 'feedback', label: 'Feedback', def: 0.42, rand: [0.15, 0.65], min: 0, max: 0.95, curve: 'lin' },
    { id: 'tone', label: 'Tone', def: 0.7, rand: [0.4, 0.9], min: 400, max: 12000, curve: 'exp' },
    { id: 'mix', label: 'Mix', def: 0.35, rand: [0.15, 0.55], min: 0, max: 1, curve: 'lin' },
  ],
  create(ctx) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const delay = ctx.createDelay(4);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.Q.value = -3.01; // low-pass Q is in dB: -3 dB = no resonance peak, so feedback < 1 stays stable
    const feedback = ctx.createGain();
    const wet = ctx.createGain();
    feedback.gain.value = 0;
    wet.gain.value = 0;
    delay.delayTime.value = 0.3;
    input.connect(output);
    input.connect(delay);
    delay.connect(tone);
    tone.connect(wet);
    wet.connect(output);
    tone.connect(feedback);
    feedback.connect(delay);

    return {
      input,
      output,
      apply(values, bpm, now) {
        const t = Number.isFinite(now) ? now : ctx.currentTime;
        const v = values || {};
        const sync = clamp(Math.round(num(v.sync, 0)), 0, SYNC.length - 1);
        const tempo = clamp(num(bpm, 120), 20, 400);
        const seconds = sync === 0 ? clamp(num(v.time, 300), 10, 1500) / 1000 : (BEATS[sync] * 60) / tempo;
        delay.delayTime.setTargetAtTime(clamp(seconds, 0.001, 4), t, 0.03);
        feedback.gain.setTargetAtTime(clamp(num(v.feedback, 0.4), 0, 0.95), t, 0.02);
        tone.frequency.setTargetAtTime(clamp(num(v.tone, 4000), 200, 20000), t, 0.02);
        wet.gain.setTargetAtTime(clamp(num(v.mix, 0.35), 0, 1), t, 0.02);
      },
    };
  },
};
