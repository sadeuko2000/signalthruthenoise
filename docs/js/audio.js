// Silnik audio: bas acid (saw -> lowpass z obwiednią), kick i zegar z lookahead.
import { pitch } from './generator.js';

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Engine {
  constructor() {
    this.ctx = null;
    this.bpm = 130;
    this.kickOn = true;
    this.cutoff = 600;     // Hz
    this.resonance = 12;   // Q
    this.envMod = 2500;    // Hz
    this.decay = 0.22;     // s
    this.pattern = null;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.onStep = null;    // (stepIndex, time) => void
    this.lastTied = false;
  }

  async start() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this._build();
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  _build() {
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.8;
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp).connect(c.destination);

    this.osc = c.createOscillator();
    this.osc.type = 'sawtooth';
    this.osc.frequency.value = 55;
    this.filter = c.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = this.cutoff;
    this.filter.Q.value = this.resonance;
    this.amp = c.createGain();
    this.amp.gain.value = 0;
    this.osc.connect(this.filter).connect(this.amp).connect(this.master);
    this.osc.start();
  }

  setCutoff(hz) { this.cutoff = hz; if (this.filter) this.filter.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.02); }
  setResonance(q) { this.resonance = q; if (this.filter) this.filter.Q.setTargetAtTime(q, this.ctx.currentTime, 0.02); }

  play() {
    if (this.timer || !this.ctx) return;
    this.step = 0;
    this.lastTied = false;
    this.nextTime = this.ctx.currentTime + 0.06;
    this.timer = setInterval(() => this._tick(), 25);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.ctx) this.amp.gain.cancelScheduledValues(this.ctx.currentTime), this.amp.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01);
  }

  get playing() { return !!this.timer; }

  _tick() {
    const ahead = this.ctx.currentTime + 0.12;
    while (this.nextTime < ahead) {
      this._scheduleStep(this.step, this.nextTime);
      const n = this.pattern.steps.length;
      this.step = (this.step + 1) % n;
      this.nextTime += 60 / this.bpm / 4;
    }
  }

  _scheduleStep(i, t) {
    const pat = this.pattern;
    const dur = 60 / this.bpm / 4;
    const s = pat.steps[i];
    const tt = t + (i % 2 === 1 ? pat.swing * dur : 0);
    if (this.onStep) this.onStep(i, t);
    if (this.kickOn && i % 4 === 0) this._kick(t);
    if (!s.on) { this.lastTied = false; return; }

    const next = pat.steps[(i + 1) % pat.steps.length];
    const tiedOut = s.tie && next.on;
    const freq = midiToHz(pitch(pat.root, pat.mode, s.degree, s.octave) );
    const accent = s.vel >= 110;
    const r = Math.max(1, s.ratchet);
    const part = dur / r;
    for (let k = 0; k < r; k++) {
      const t0 = tt + k * part;
      const len = r === 1 ? dur * s.gate : part * 0.5;
      const slide = k === 0 && this.lastTied;
      this._note(t0, freq, s.vel, accent, len, slide, tiedOut && k === r - 1, dur);
    }
    this.lastTied = tiedOut;
  }

  _note(t, freq, vel, accent, len, slide, holdOn, stepDur) {
    const f = this.osc.frequency, g = this.amp.gain, fc = this.filter.frequency;
    if (slide) {
      f.cancelScheduledValues(t);
      f.setValueAtTime(f.value, t);
      f.exponentialRampToValueAtTime(freq, t + 0.05);   // glide 303
    } else {
      f.setValueAtTime(freq, t);
      const peak = (vel / 127) * (accent ? 1.0 : 0.7);
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(peak, t + 0.004);
      const base = this.cutoff;
      const top = base + this.envMod * (accent ? 1.6 : 1);
      fc.cancelScheduledValues(t);
      fc.setValueAtTime(Math.min(top, 18000), t);
      fc.exponentialRampToValueAtTime(Math.max(base, 30), t + this.decay * (accent ? 1.3 : 1));
    }
    if (!holdOn) {
      g.setValueAtTime(g.value, t + len);
      g.linearRampToValueAtTime(0, t + len + 0.012);
    }
  }

  _kick(t) {
    const c = this.ctx;
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.3);
  }
}
