// Silnik audio: zegar z lookahead, rozsyłanie nut do silników basu, vocoder.
import { pitch } from './generator.js';
import { Vocoder } from './vocoder.js';
import { VOICES, blendWeights } from './engines.js';

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Engine {
  constructor() {
    this.ctx = null;
    this.bpm = 130;
    // parametry wspólne dla wszystkich silników (silniki trzymają referencję do tego obiektu)
    this.p = { cutoff: 600, res: 12, envMod: 2500, decay: 0.22, bright: 0.35 };
    this.blend = [1, 0, 0, 0];
    this.pattern = null;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.onStep = null;    // (stepIndex, time) => void
    this.lastTied = false;
    this.octMul = 1;       // vocoder gra nośnik oktawę wyżej, żeby było co filtrować
    this.voc = null;
    this.voiceOn = false;
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

    this.dry = c.createGain();
    this.mix = c.createGain();
    this.mix.connect(this.dry).connect(this.master);
    this.voices = VOICES.map((V) => new V(c, this.p));
    this.vgains = this.voices.map((v) => { const g = c.createGain(); v.out.connect(g).connect(this.mix); return g; });
    this.setBlend(0.25, 0.75);
  }

  setCutoff(hz) {
    this.p.cutoff = hz;
    this.p.bright = Math.max(0, Math.min(1, Math.log(hz / 60) / Math.log(100)));
    if (this.voices) this.voices.forEach((v) => v.refresh(this.ctx.currentTime));
  }
  setResonance(q) {
    this.p.res = q;
    if (this.voices) this.voices.forEach((v) => v.refresh(this.ctx.currentTime));
  }

  // Pad XY: miks czterech silników (narożniki: prophet, ms-20, dx, wavetable).
  setBlend(x, y) {
    this.blend = blendWeights(x, y);
    if (this.vgains) this.vgains.forEach((g, i) => g.gain.setTargetAtTime(this.blend[i], this.ctx.currentTime, 0.03));
  }

  // Tryb głosu: bas -> vocoder (modulator: mikrofon). Rzuca wyjątek, gdy brak zgody/mikrofonu.
  async enableVoice() {
    if (!this.voc) this.voc = new Vocoder(this.ctx);
    await this.voc.connectMic();
    this.mix.connect(this.voc.input);
    this.voc.output.connect(this.master);
    this.dry.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
    this.octMul = 2;
    this.voiceOn = true;
  }

  disableVoice() {
    if (!this.voc || !this.voiceOn) return;
    this.voc.disconnectMic();
    this.mix.disconnect(this.voc.input);
    this.voc.output.disconnect(this.master);
    this.dry.gain.setTargetAtTime(1, this.ctx.currentTime, 0.02);
    this.octMul = 1;
    this.voiceOn = false;
  }

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
    if (this.ctx) this.voices.forEach((v) => v.silence(this.ctx.currentTime));
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
    if (!s.on) { this.lastTied = false; return; }

    const next = pat.steps[(i + 1) % pat.steps.length];
    const tiedOut = s.tie && next.on;
    const freq = midiToHz(pitch(pat.root, pat.mode, s.degree, s.octave)) * this.octMul;
    const accent = s.vel >= 110;
    const r = Math.max(1, s.ratchet);
    const part = dur / r;
    for (let k = 0; k < r; k++) {
      const t0 = tt + k * part;
      const len = r === 1 ? dur * s.gate : part * 0.5;
      const slide = k === 0 && this.lastTied;
      const hold = tiedOut && k === r - 1;
      this.voices.forEach((v, vi) => { if (this.blend[vi] > 0.02) v.note(t0, freq, s.vel, accent, len, slide, hold); });
    }
    this.lastTied = tiedOut;
  }
}
