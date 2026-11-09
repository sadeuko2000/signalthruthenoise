/**
 * HOWL CHORUS - export for Web Audio
 * Author:  TAZI (HOWL project)
 * License: MIT - shared for use in the radarxxx project
 * Original Web Audio implementation (not a port of any third-party code).
 *
 * SOUND
 *   Wide, lush stereo chorus. Two modulated short delays run in opposite LFO phase (one per side),
 *   so detuning moves left against right. Output is stereo even from a mono input.
 *
 * SIGNAL FLOW
 *   input --> dry gain --------------------------------------------> output (L+R)
 *   input --> DelayNode L (base + LFO) --> wet L --\
 *   input --> DelayNode R (base - LFO) --> wet R ---+--> ChannelMerger (L,R) --> output
 *   LFO: one sine OscillatorNode, +depth to the left delay and -depth to the right delay.
 *
 * PARAMETERS (real-world units, as passed to apply())
 *   rate    Hz (0.1..8)       LFO speed
 *   depth   0..1              modulation width (1 = +-6 ms around the base delay)
 *   delay   ms (6..30)        base delay (longer = more obvious doubling)
 *   mix     0..1              wet level; dry is reduced so the total stays even
 *
 * TYPICAL SOUND
 *   rate = 0.8 Hz, depth = 0.5, delay = 14 ms, mix = 0.5 on pads or a lead.
 */

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

export const effect = {
  id: 'howl-chorus',
  name: 'HOWL Chorus',
  params: [
    { id: 'rate', label: 'Rate', def: 0.45, rand: [0.2, 0.75], min: 0.1, max: 8, curve: 'exp' },
    { id: 'depth', label: 'Depth', def: 0.5, rand: [0.2, 0.9], min: 0, max: 1, curve: 'lin' },
    { id: 'delay', label: 'Delay', def: 0.33, rand: [0.1, 0.7], min: 6, max: 30, curve: 'lin' },
    { id: 'mix', label: 'Mix', def: 0.5, rand: [0.3, 0.7], min: 0, max: 1, curve: 'lin' },
  ],
  create(ctx) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const dry = ctx.createGain();
    const merger = ctx.createChannelMerger(2);
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.8;
    const depthL = ctx.createGain();
    const depthR = ctx.createGain();
    depthL.gain.value = 0;
    depthR.gain.value = 0;
    const delays = [ctx.createDelay(0.06), ctx.createDelay(0.06)];
    const wets = [ctx.createGain(), ctx.createGain()];

    input.connect(dry);
    dry.connect(output);
    lfo.connect(depthL);
    lfo.connect(depthR);
    depthL.connect(delays[0].delayTime);
    depthR.connect(delays[1].delayTime);
    for (let i = 0; i < 2; ++i) {
      delays[i].delayTime.value = 0.014;
      wets[i].gain.value = 0;
      input.connect(delays[i]);
      delays[i].connect(wets[i]);
      wets[i].connect(merger, 0, i);
    }
    merger.connect(output);
    lfo.start();

    return {
      input,
      output,
      apply(values, bpm, now) {
        const t = Number.isFinite(now) ? now : ctx.currentTime;
        const v = values || {};
        const base = clamp(num(v.delay, 14), 6, 30) / 1000;
        const width = Math.min(clamp(num(v.depth, 0.5), 0, 1) * 0.006, base - 0.0005);
        lfo.frequency.setTargetAtTime(clamp(num(v.rate, 0.8), 0.01, 20), t, 0.03);
        depthL.gain.setTargetAtTime(width, t, 0.03);
        depthR.gain.setTargetAtTime(-width, t, 0.03);
        for (const d of delays) d.delayTime.setTargetAtTime(base, t, 0.03);
        const mix = clamp(num(v.mix, 0.5), 0, 1);
        dry.gain.setTargetAtTime(1 - mix * 0.5, t, 0.02);
        for (const w of wets) w.gain.setTargetAtTime(mix, t, 0.02);
      },
    };
  },
};
