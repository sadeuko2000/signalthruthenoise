// Silnik audio: zegar z lookahead, rozsyłanie nut do silników basu, vocoder.
import { pitch } from './generator.js';
import { Vocoder } from './vocoder.js';
import { VOICES, blendWeights, randomizeParams } from './engines.js';
import { GlobalFx } from './fx.js';

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Engine {
  constructor() {
    this.ctx = null;
    this.bpm = 130;
    this.gateMul = 1;      // mnożnik długości nut (suwak „długość nut”)
    // parametry wspólne dla wszystkich silników (silniki trzymają referencję do tego obiektu)
    this.p = { cutoff: 600, res: 12, bright: 0.35 };
    this.blend = [1, 0, 0, 0];
    this.xy = [0.25, 0.75];       // pozycja na padzie
    this.enabled = [1, 1, 1, 1];  // które silniki biorą udział w miksie
    this.levels = [1, 1, 1, 1];   // głośność każdego silnika (niezależnie od pada)
    this.solo = null;             // indeks silnika solo albo null
    this.eff = [1, 0, 0, 0];      // efektywna waga = pad lub solo, razy głośność
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
    // Tor wyjściowy: kompresor -> makeup -> miękki clipper -> wyjście (gęstość i głośność bez przesterowania cyfrowego)
    this.master = c.createGain();
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 8; comp.ratio.value = 5;
    comp.attack.value = 0.003; comp.release.value = 0.12;
    const makeup = c.createGain(); makeup.gain.value = 0.7;
    const clip = c.createWaveShaper();
    const cc = new Float32Array(2048), k = 1.3;
    for (let i = 0; i < cc.length; i++) cc[i] = Math.tanh(k * ((i / 2047) * 2 - 1)) / Math.tanh(k);
    clip.curve = cc; clip.oversample = '4x';
    const outGain = c.createGain(); outGain.gain.value = 0.9;
    this.master.connect(comp).connect(makeup).connect(clip).connect(outGain).connect(c.destination);

    this.dry = c.createGain();
    this.mix = c.createGain();
    // po miksie silników: globalny filtr -> globalny efekt -> wyjście
    this.fx = new GlobalFx(c, () => this.bpm);
    this.mix.connect(this.dry).connect(this.fx.input);
    this.fx.output.connect(this.master);
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
  setBlend(x, y) { this.xy = [x, y]; this._applyGains(); }
  setEnabled(i, on) { this.enabled[i] = on ? 1 : 0; this._applyGains(); }
  setLevel(i, v) { this.levels[i] = v; this._applyGains(); }
  setSolo(i) { this.solo = i; this._applyGains(); }
  _applyGains() {
    this.blend = blendWeights(this.xy[0], this.xy[1], this.enabled);
    const base = this.solo == null ? this.blend : this.blend.map((_, i) => (i === this.solo ? 1 : 0));
    this.eff = base.map((w, i) => w * this.levels[i]);
    if (this.vgains) this.vgains.forEach((g, i) => g.gain.setTargetAtTime(this.eff[i], this.ctx.currentTime, 0.03));
  }
  setParam(i, id, v) { this.voices[i].setParam(id, v); }
  // Losuje parametry jednego silnika w „rozsądnych” granicach i zwraca nowe wartości.
  randomizeVoice(i, rng = Math.random) {
    const vals = randomizeParams(i, rng);
    for (const [id, v] of Object.entries(vals)) this.voices[i].setParam(id, v);
    return vals;
  }

  // Tryb głosu: bas -> vocoder (modulator: mikrofon). Rzuca wyjątek, gdy brak zgody/mikrofonu.
  async enableVoice() {
    if (!this.voc) this.voc = new Vocoder(this.ctx);
    await this.voc.connectMic();
    this.mix.connect(this.voc.input);
    this.voc.output.connect(this.fx.input);
    this.dry.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
    this.octMul = 2;
    this.voiceOn = true;
  }

  disableVoice() {
    if (!this.voc || !this.voiceOn) return;
    this.voc.disconnectMic();
    this.mix.disconnect(this.voc.input);
    this.voc.output.disconnect(this.fx.input);
    this.dry.gain.setTargetAtTime(1, this.ctx.currentTime, 0.02);
    this.octMul = 1;
    this.voiceOn = false;
  }

  // Pojedyncza nuta „na próbę” (np. przy układaniu wzoru dotykiem), niezależnie od zegara sekwencera.
  audition(step) {
    if (!this.ctx || !this.pattern) return;
    const pat = this.pattern, t = this.ctx.currentTime + 0.01;
    const freq = midiToHz(pitch(pat.root, pat.mode, step.degree, step.octave || 0)) * this.octMul;
    this.voices.forEach((v, vi) => { if (this.eff[vi] > 0.02) v.note(t, freq, step.vel || 100, false, 0.16, false, false); });
  }

  setBpm(v) { this.bpm = v; if (this.fx) this.fx.refresh(); }   // delay zsynchronizowany z tempem

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
    if (this.step >= this.pattern.steps.length) this.step = 0;   // wzór mógł się skrócić (zmiana długości)
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
      const len = r === 1 ? dur * Math.min(4, s.gate * this.gateMul) : part * 0.5;
      const slide = k === 0 && this.lastTied;
      const hold = tiedOut && k === r - 1;
      this.voices.forEach((v, vi) => { if (this.eff[vi] > 0.02) v.note(t0, freq, s.vel, accent, len, slide, hold); });
    }
    this.lastTied = tiedOut;
  }
}
