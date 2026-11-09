/**
 * HOWL REVERB - export for Web Audio
 * Author:  TAZI (HOWL project)
 * License: MIT - shared for use in the radarxxx project
 * Original Web Audio implementation (a classic Schroeder/Moorer-style algorithmic reverb,
 * written from the published structure; not a port of any third-party code).
 *
 * SOUND
 *   Smooth, dense room-to-hall reverb with a darkening tail. Stereo output from a mono-summed input.
 *
 * SIGNAL FLOW
 *   input --> pre-delay --> 8 parallel feedback combs per side (each with a damping low-pass)
 *         --> 3 series Schroeder all-passes per side --> left / right --> wet gain --> output
 *   input --------------------------------------------------------------------> dry gain --> output
 *   (right side uses slightly longer delay times than left, which creates the stereo width)
 *
 * PARAMETERS (real-world units, as passed to apply())
 *   size      0..1       room size / decay length (0 = small room ~0.3 s, 1 = long hall ~8 s)
 *   tone      Hz (1500..16000)  damping low-pass in the loop (lower = darker tail)
 *   predelay  ms (0..120)       gap before the reverb starts
 *   mix       0..1       wet amount (equal-power crossfade with the dry signal)
 *
 * TYPICAL SOUND
 *   size = 0.6, tone = 6000 Hz, predelay = 20 ms, mix = 0.3 on drums or pads.
 */

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

// Delay lengths in seconds (classic 44.1 kHz sample counts converted to time).
const COMB = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((n) => n / 44100);
const ALLPASS = [556, 441, 341].map((n) => n / 44100);
const SPREAD = 23 / 44100;

export const effect = {
  id: 'howl-reverb',
  name: 'HOWL Reverb',
  params: [
    { id: 'size', label: 'Size', def: 0.6, rand: [0.25, 0.85], min: 0, max: 1, curve: 'lin' },
    { id: 'tone', label: 'Tone', def: 0.65, rand: [0.35, 0.9], min: 1500, max: 16000, curve: 'exp' },
    { id: 'predelay', label: 'Pre-delay', def: 0.17, rand: [0, 0.5], min: 0, max: 120, curve: 'lin' },
    { id: 'mix', label: 'Mix', def: 0.3, rand: [0.1, 0.5], min: 0, max: 1, curve: 'lin' },
  ],
  create(ctx) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const pre = ctx.createDelay(0.5);
    const merger = ctx.createChannelMerger(2);
    input.connect(dry);
    dry.connect(output);
    input.connect(pre);
    wet.connect(output);

    const feedbackGains = [];
    const dampers = [];

    // One reverb side: parallel combs summed, then series all-passes.
    const side = (extra, channel) => {
      const sum = ctx.createGain();
      sum.gain.value = 0.11;
      for (const base of COMB) {
        const merge = ctx.createGain();
        const d = ctx.createDelay(0.2);
        d.delayTime.value = base + extra;
        const damp = ctx.createBiquadFilter();
        damp.type = 'lowpass';
        // Biquad low-pass Q is in dB: -3 dB = flat (no resonance peak), so the loop gain can never exceed `fb`.
        damp.Q.value = -3.01;
        const fb = ctx.createGain();
        fb.gain.value = 0.84;
        pre.connect(merge);
        merge.connect(d);
        d.connect(damp);
        damp.connect(fb);
        fb.connect(merge);
        damp.connect(sum);
        feedbackGains.push(fb);
        dampers.push(damp);
      }
      let node = sum;
      for (const base of ALLPASS) {
        // Schroeder all-pass: w = x + g*D(w); y = -g*w + D(w)
        const g = 0.5;
        const s = ctx.createGain();
        const d = ctx.createDelay(0.1);
        d.delayTime.value = base + extra * 0.5;
        const back = ctx.createGain();
        back.gain.value = g;
        const neg = ctx.createGain();
        neg.gain.value = -g;
        const y = ctx.createGain();
        node.connect(s);
        s.connect(d);
        d.connect(back);
        back.connect(s);
        s.connect(neg);
        neg.connect(y);
        d.connect(y);
        node = y;
      }
      node.connect(merger, 0, channel);
    };
    side(0, 0);
    side(SPREAD, 1);
    merger.connect(wet);
    dry.gain.value = 1;
    wet.gain.value = 0;

    return {
      input,
      output,
      apply(values, bpm, now) {
        const t = Number.isFinite(now) ? now : ctx.currentTime;
        const v = values || {};
        const size = clamp(num(v.size, 0.6), 0, 1);
        const feedback = 0.7 + size * 0.285; // 0.7 .. 0.985
        for (const g of feedbackGains) g.gain.setTargetAtTime(feedback, t, 0.05);
        const tone = clamp(num(v.tone, 6000), 500, 20000);
        for (const d of dampers) d.frequency.setTargetAtTime(tone, t, 0.05);
        pre.delayTime.setTargetAtTime(clamp(num(v.predelay, 20), 0, 120) / 1000, t, 0.03);
        const mix = clamp(num(v.mix, 0.3), 0, 1);
        dry.gain.setTargetAtTime(Math.cos((mix * Math.PI) / 2), t, 0.02);
        wet.gain.setTargetAtTime(Math.sin((mix * Math.PI) / 2) * 1.6, t, 0.02);
      },
    };
  },
};
