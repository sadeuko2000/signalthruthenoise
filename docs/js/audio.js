// Silnik audio: zegar z lookahead, rozsyłanie nut do silników basu, vocoder.
import { pitch } from './generator.js';
import { Vocoder } from './vocoder.js';
import { VOICES, blendWeights, randomizeParams } from './engines.js';
import { stepHash } from './generator.js';
import { GlobalFx } from './fx.js';

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Engine {
  constructor() {
    this.ctx = null;
    this.bpm = 130;
    this.gateMul = 1;      // mnożnik długości nut (suwak „długość nut”)
    // parametry wspólne dla wszystkich silników (silniki trzymają referencję do tego obiektu)
    this.p = { cutoff: 600, res: 12, bright: 0.35, offFAtk: 0, offFRel: 0, offAAtk: 0, offARel: 0 };   // + globalne przesunięcia obwiedni (-1..+1)
    this.blend = [1, 0, 0, 0];
    this.xy = [0.25, 0.75];       // pozycja na padzie
    this.enabled = [1, 1, 1, 1];  // które silniki biorą udział w miksie
    this.types = [1, 0, 2, 3];    // rodzaj silnika w każdym z 4 miejsc (0 prophet, 1 ms-20, 2 dx, 3 wavetable); mogą się powtarzać. Domyślnie jak w szkicu: MS20, PROPHET, DX, WAVE
    this.latch = false;           // LATCH: nuty trzymają się aż do następnej
    this.human = 0;               // 0..1: losowe drobne przesunięcia czasu i głośności
    this.ghost = 0;               // 0..1: ciche nuty-duchy w pustych krokach
    this.velo = 1;                // mnożnik siły uderzenia (nie wpływa na akcenty)
    this.vOct = [0, 0, 0, 0];     // oktawa każdego silnika
    this.vTune = [0, 0, 0, 0];    // dostrojenie każdego silnika (cent)
    this.vEq = [[0, 0], [0, 0], [0, 0], [0, 0]];   // EQ każdego silnika: niskie, wysokie (dB)
    this.eq = [0, 0, 0];          // korektor 3-pasmowy po miksie silników: niskie, środek, wysokie (dB)
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
    this.comp = comp;
    this.drvIn = c.createGain(); this.drvIn.gain.value = 1;                    // DRIVE wyjściowy przed ogranicznikiem
    const clip = c.createWaveShaper();
    const cc = new Float32Array(2048), k = 1.3;
    for (let i = 0; i < cc.length; i++) cc[i] = Math.tanh(k * ((i / 2047) * 2 - 1)) / Math.tanh(k);
    clip.curve = cc; clip.oversample = '4x';
    const outGain = c.createGain(); outGain.gain.value = 0.9;
    this.outGain = outGain;
    this.master.connect(comp).connect(makeup).connect(this.drvIn).connect(clip).connect(outGain).connect(c.destination);

    this.dry = c.createGain();
    this.mix = c.createGain();
    // po miksie silników: globalny filtr -> globalny efekt -> wyjście
    this.fx = new GlobalFx(c, () => this.bpm);
    this.mix.connect(this.dry).connect(this.fx.input);
    const mfx = this._buildMasterFx(c);             // efekty master: DJ filter, tape, chorus, beat repeat
    this.fx.output.connect(mfx.input); mfx.output.connect(this.master);
    // korektor 3-pasmowy między silnikami a resztą toru
    this.eqIn = c.createGain();
    const lo = c.createBiquadFilter(), md = c.createBiquadFilter(), hi = c.createBiquadFilter();
    lo.type = 'lowshelf'; lo.frequency.value = 150;
    md.type = 'peaking'; md.frequency.value = 1000; md.Q.value = 0.8;
    hi.type = 'highshelf'; hi.frequency.value = 4500;
    this.eqNodes = [lo, md, hi];
    this.eqIn.connect(lo).connect(md).connect(hi).connect(this.mix);
    this.eqNodes.forEach((n, k) => { n.gain.value = this.eq[k]; });
    this.voices = this.types.map((t) => new VOICES[t](c, this.p));
    // pitch bend: jedno źródło stałe (cent) podłączone do detune wszystkich oscylatorów wszystkich silników
    this.bendSrc = c.createConstantSource(); this.bendSrc.offset.value = 0; this.bendSrc.start();
    this.voices.forEach((v) => this._wireBend(v));
    this.vgains = this.voices.map((v) => { const g = c.createGain(); g.connect(this.eqIn); return g; });
    // EQ każdego silnika (półka niskich i wysokich) między silnikiem a jego głośnością
    this.veq = this.voices.map((v, i) => {
      const lo = c.createBiquadFilter(), hi = c.createBiquadFilter();
      lo.type = 'lowshelf'; lo.frequency.value = 150; hi.type = 'highshelf'; hi.frequency.value = 4500;
      lo.gain.value = this.vEq[i][0]; hi.gain.value = this.vEq[i][1];
      v.out.connect(lo).connect(hi).connect(this.vgains[i]);
      return { lo, hi };
    });
    this.setBlend(0.25, 0.75);
  }


  // ---------- efekty na sumie (strona FX, zakładka MSTR) ----------
  _buildMasterFx(c) {
    const g = (v = 1) => { const n = c.createGain(); n.gain.value = v; return n; };
    const bq = (type, f, q = 0.7) => { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
    const lfo = (type, f, depth, target) => { const o = c.createOscillator(); o.type = type; o.frequency.value = f; const d = g(depth); o.connect(d).connect(target); o.start(); return d; };
    const input = g(), output = g();
    // 1) DJ filter: jedna gałka, w lewo dolnoprzepustowy (zamyka górę), w prawo górnoprzepustowy (zabiera dół), środek = otwarte
    const hp = bq('highpass', 20, 1.1), lp = bq('lowpass', 20000, 1.1);
    // 2) tape: wow (wahanie wysokości przez modulowane opóźnienie), potem nasycenie, przycięcie góry i szum (mieszane suchy/mokry)
    const wow = c.createDelay(0.05); wow.delayTime.value = 0.012;
    const wowDepth = lfo('sine', 0.55, 0, wow.delayTime), flutDepth = lfo('triangle', 6.3, 0, wow.delayTime);
    const sat = c.createWaveShaper(), cv = new Float32Array(2048), k = 1.6; for (let i = 0; i < cv.length; i++) cv[i] = Math.tanh(k * ((i / 2047) * 2 - 1)) / Math.tanh(k); sat.curve = cv; sat.oversample = '2x';
    const pre = g(1), post = g(1), tlp = bq('lowpass', 18000, 0.5), tdry = g(1), twet = g(0);
    const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const ns = c.createBufferSource(); ns.buffer = nb; ns.loop = true; const nhp = bq('highpass', 2500, 0.5), hiss = g(0); ns.connect(nhp).connect(hiss); ns.start();
    // 3) chorus: dwie modulowane linie opóźnienia
    const d1 = c.createDelay(0.05), d2 = c.createDelay(0.05); d1.delayTime.value = 0.0075; d2.delayTime.value = 0.0115;
    const cd1 = lfo('sine', 0.8, 0.0025, d1.delayTime), cd2 = lfo('sine', 0.63, 0.0030, d2.delayTime);
    const cdry = g(1), cwet = g(0);
    // 4) beat repeat: pętla ostatniego kawałka dźwięku (długość zsynchronizowana z tempem), przy puszczeniu wraca zwykły dźwięk
    const rdry = g(1), rwet = g(0), rin = g(1), rdel = c.createDelay(3), rfb = g(0); rdel.delayTime.value = 0.25;
    input.connect(hp).connect(lp).connect(wow);
    wow.connect(tdry); wow.connect(pre).connect(sat).connect(post).connect(tlp).connect(twet); hiss.connect(twet);
    const tapeOut = g(); tdry.connect(tapeOut); twet.connect(tapeOut);
    tapeOut.connect(cdry); tapeOut.connect(d1); tapeOut.connect(d2); d1.connect(cwet); d2.connect(cwet);
    const chOut = g(); cdry.connect(chOut); cwet.connect(chOut);
    chOut.connect(rdry).connect(output); chOut.connect(rin).connect(rdel); rdel.connect(rfb).connect(rdel); rdel.connect(rwet).connect(output);
    this.mfx = { hp, lp, wowDepth, flutDepth, pre, post, tlp, tdry, twet, hiss, cdry, cwet, rdry, rwet, rin, rdel, rfb, cd1, cd2 };
    return { input, output };
  }
  setDj(v) {                                    // v: -1 (dolnoprzepustowy do końca) … +1 (górnoprzepustowy do końca)
    if (!this.mfx) return;
    const t = this.ctx.currentTime, a = Math.abs(v) < 0.03 ? 0 : v;
    this.mfx.lp.frequency.setTargetAtTime(a < 0 ? 20000 * Math.pow(150 / 20000, -a) : 20000, t, 0.02);
    this.mfx.hp.frequency.setTargetAtTime(a > 0 ? 20 * Math.pow(300, a) : 20, t, 0.02);
  }
  setTape(a) {                                  // 0..1: nasycenie, ciemniejsza góra, szum
    if (!this.mfx) return;
    const t = this.ctx.currentTime, m = this.mfx;
    m.twet.gain.setTargetAtTime(a, t, 0.02); m.tdry.gain.setTargetAtTime(1 - a, t, 0.02);
    m.pre.gain.setTargetAtTime(1 + 3 * a, t, 0.02); m.post.gain.setTargetAtTime(1 / (1 + 1.8 * a), t, 0.02);
    m.tlp.frequency.setTargetAtTime(18000 * Math.pow(3800 / 18000, a), t, 0.02); m.hiss.gain.setTargetAtTime(0.012 * a, t, 0.02);
  }
  setWow(w) { if (!this.mfx) return; const t = this.ctx.currentTime; this.mfx.wowDepth.gain.setTargetAtTime(0.0035 * w, t, 0.05); this.mfx.flutDepth.gain.setTargetAtTime(0.0006 * w, t, 0.05); }
  setChorus(m) { if (!this.mfx) return; const t = this.ctx.currentTime; this.mfx.cwet.gain.setTargetAtTime(0.27 * m, t, 0.03); this.mfx.cdry.gain.setTargetAtTime(1 - 0.3 * m, t, 0.03); }
  // beat repeat: v 0 = wyłączony, 0..1 wybiera długość pętli (1/2, 1/4, 1/8, 1/16, 1/32). Zwraca nazwę długości albo ''.
  setRepeat(v) {
    if (!this.mfx) return '';
    const m = this.mfx, t = this.ctx.currentTime, on = v > 0.02;
    if (on) {
      const DIV = [['1/2', 2], ['1/4', 1], ['1/8', 0.5], ['1/16', 0.25], ['1/32', 0.125]], d = DIV[Math.min(DIV.length - 1, Math.floor(v * DIV.length))];
      m.rdel.delayTime.setTargetAtTime(Math.min(2.9, (60 / this.bpm) * d[1]), t, 0.01);
      if (!this._rep) { m.rin.gain.setTargetAtTime(0, t, 0.004); m.rfb.gain.setTargetAtTime(0.999, t, 0.004); m.rdry.gain.setTargetAtTime(0, t, 0.006); m.rwet.gain.setTargetAtTime(1, t, 0.006); this._rep = true; }
      return d[0];
    }
    if (this._rep) { m.rin.gain.setTargetAtTime(1, t, 0.01); m.rfb.gain.setTargetAtTime(0, t, 0.01); m.rdry.gain.setTargetAtTime(1, t, 0.01); m.rwet.gain.setTargetAtTime(0, t, 0.01); this._rep = false; }
    return '';
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
  setEq(band, db) { this.eq[band] = db; if (this.eqNodes) this.eqNodes[band].gain.setTargetAtTime(db, this.ctx.currentTime, 0.02); }
  // Zmiana rodzaju silnika w danym miejscu: stary cichnie i jest zatrzymany, nowy startuje z parametrami domyślnymi.
  setType(i, t) {
    this.types[i] = t;
    if (!this.ctx || !this.voices) return;
    const now = this.ctx.currentTime, old = this.voices[i];
    old.silence(now); old.out.disconnect();
    const nodes = Object.values(old).flatMap((x) => (Array.isArray(x) ? x : [x]));
    setTimeout(() => nodes.forEach((n) => { if (n && n.stop && n.frequency) { try { n.stop(); this.bendSrc.disconnect(n.detune); } catch (e) { /* już zatrzymany */ } } }), 400);
    const v = new VOICES[t](this.ctx, this.p);
    this._wireBend(v);
    v.out.connect(this.veq[i].lo);
    this.voices[i] = v;
  }
  setVoiceEq(i, band, db) { this.vEq[i][band] = db; if (this.veq) (band === 0 ? this.veq[i].lo : this.veq[i].hi).gain.setTargetAtTime(db, this.ctx.currentTime, 0.02); }
  _oscillators(v) { const out = []; for (const x of Object.values(v)) (Array.isArray(x) ? x : [x]).forEach((o) => { if (o && typeof OscillatorNode !== 'undefined' && o instanceof OscillatorNode) out.push(o); }); return out; }
  _wireBend(v) { this._oscillators(v).forEach((o) => this.bendSrc.connect(o.detune)); }
  setBend(cents) { if (this.bendSrc) this.bendSrc.offset.setTargetAtTime(cents, this.ctx.currentTime, 0.015); }
  setMaster(v) { if (this.outGain) this.outGain.gain.setTargetAtTime(0.9 * v, this.ctx.currentTime, 0.02); }
  // COMP 0..1: próg i stosunek kompresji (0,5 = dotychczasowe ustawienie: -18 dB, 5:1)
  setComp(a) { if (!this.comp) return; const t = this.ctx.currentTime; this.comp.threshold.setTargetAtTime(-4 - 28 * a, t, 0.02); this.comp.ratio.setTargetAtTime(1 + 8 * a, t, 0.02); }
  setDrive(d) { if (this.drvIn) this.drvIn.gain.setTargetAtTime(1 + 3 * d, this.ctx.currentTime, 0.02); }
  _voiceFreq(vi, f) { return f * Math.pow(2, this.vOct[vi] + this.vTune[vi] / 1200); }
  setParam(i, id, v) { this.voices[i].setParam(id, v); }
  // Losuje parametry jednego silnika w „rozsądnych” granicach i zwraca nowe wartości.
  randomizeVoice(i, rng = Math.random) {
    const vals = randomizeParams(this.types[i], rng);
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
    this.voices.forEach((v, vi) => { if (this.eff[vi] > 0.02) v.note(t, this._voiceFreq(vi, freq), step.vel || 100, false, 0.16, false, false); });
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
    const pat = this.pattern, n = pat.steps.length;
    const dur = 60 / this.bpm / 4;
    const s = pat.steps[i];
    const jitter = this.human > 0 ? (Math.random() - 0.5) * dur * 0.3 * this.human : 0;
    const tt = t + (i % 2 === 1 ? pat.swing * dur : 0) + Math.max(-0.01, jitter);
    if (this.onStep) this.onStep(i, t);
    if (!s.on) {
      this.lastTied = false;
      // GHOST: ciche nuty-duchy (tonika) w części pustych kroków, stałe dla danego kroku
      if (this.ghost > 0 && stepHash(i, 777) < this.ghost * 0.35) {
        const gf = midiToHz(pitch(pat.root, pat.mode, 0, 0)) * this.octMul;
        this.voices.forEach((v, vi) => { if (this.eff[vi] > 0.02) v.note(tt, this._voiceFreq(vi, gf), Math.round(46 * this.velo), false, dur * 0.35, false, false); });
      }
      return;
    }

    const next = pat.steps[(i + 1) % n];
    const tiedOut = s.tie && next.on;
    const freq = midiToHz(pitch(pat.root, pat.mode, s.degree, s.octave)) * this.octMul;
    const accent = s.vel >= 110;
    const vel = Math.max(1, Math.min(127, Math.round(s.vel * this.velo + (this.human > 0 ? (Math.random() - 0.5) * 24 * this.human : 0))));
    const r = Math.max(1, s.ratchet);
    const part = dur / r;
    // LATCH: nuta trwa do następnej (najwyżej 4 kroki)
    let gate = s.gate * this.gateMul;
    if (this.latch) { let k = 1; while (k < n && !pat.steps[(i + k) % n].on) k++; gate = Math.max(gate, Math.min(4, k) * 0.98); }
    for (let k = 0; k < r; k++) {
      const t0 = tt + k * part;
      const len = r === 1 ? dur * Math.min(4, gate) : part * 0.5;
      const slide = k === 0 && this.lastTied;
      const hold = tiedOut && k === r - 1;
      this.voices.forEach((v, vi) => { if (this.eff[vi] > 0.02) v.note(t0, this._voiceFreq(vi, freq), vel, accent, len, slide, hold); });
    }
    this.lastTied = tiedOut;
  }
}
