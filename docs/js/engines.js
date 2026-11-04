// Cztery monofoniczne silniki basu, które dostają te same nuty. Proporcje głośności
// ustawia pad XY (miks dwuwymiarowy). Wszystko na natywnych węzłach Web Audio, lekkie dla CPU.
// Własne implementacje inspirowane typami syntezy (analog 2xVCO, MS-20, FM 2-op, wavetable).

// Narożniki pada: lewy-góra, prawy-góra, lewy-dół, prawy-dół. Miks równomocowy (suma kwadratów = 1).
export function blendWeights(x, y) {
  const w = [(1 - x) * y, x * y, (1 - x) * (1 - y), x * (1 - y)];
  return w.map(Math.sqrt);
}

const cl = (v, a, b) => Math.max(a, Math.min(b, v));

// Parametry silników. min/max = pełny zakres suwaka, rand = „rozsądny” zakres losowania
// (żeby preset nadal brzmiał jak electro), choices = dozwolone wartości przy losowaniu.
export const PARAM_SPECS = [
  [ // prophet
    { id: 'detune', label: 'detune', min: 0, max: 25, step: 0.5, def: 9, rand: [4, 16] },
    { id: 'sub', label: 'sub', min: 0, max: 1, step: 0.01, def: 0.3, rand: [0, 0.7] },
    { id: 'envAmt', label: 'filtr env', min: 0.3, max: 2, step: 0.01, def: 1, rand: [0.6, 1.6] },
  ],
  [ // ms-20
    { id: 'drive', label: 'drive', min: 1, max: 8, step: 0.1, def: 3, rand: [2, 6] },
    { id: 'hpf', label: 'hp', min: 40, max: 400, step: 1, def: 90, rand: [60, 220] },
    { id: 'envAmt', label: 'filtr env', min: 0.3, max: 2, step: 0.01, def: 1.2, rand: [0.8, 1.8] },
  ],
  [ // dx
    { id: 'ratio', label: 'stosunek', min: 0.5, max: 4, step: 0.5, def: 1, choices: [0.5, 1, 1, 2, 3] },
    { id: 'index', label: 'indeks', min: 0.2, max: 5, step: 0.05, def: 2, rand: [0.8, 3.5] },
    { id: 'fmDecay', label: 'zanik fm', min: 0.3, max: 2.5, step: 0.05, def: 1.2, rand: [0.5, 1.8] },
  ],
  [ // wavetable
    { id: 'vowel', label: 'formant', min: 2, max: 12, step: 0.1, def: 4, rand: [2.5, 9] },
    { id: 'morph', label: 'pozycja', min: 0, max: 1, step: 0.01, def: 0.4, rand: [0, 0.8] },
    { id: 'sweep', label: 'przelot', min: -1, max: 1, step: 0.01, def: 0.5, rand: [-0.7, 0.9] },
  ],
];

export function defaultParams(i) {
  return Object.fromEntries(PARAM_SPECS[i].map((sp) => [sp.id, sp.def]));
}

// Losuje parametry jednego silnika w granicach `rand` (albo z listy `choices`).
export function randomizeParams(i, rng = Math.random) {
  const out = {};
  for (const sp of PARAM_SPECS[i]) {
    if (sp.choices) { out[sp.id] = sp.choices[Math.floor(rng() * sp.choices.length)]; continue; }
    const [lo, hi] = sp.rand;
    const v = lo + rng() * (hi - lo);
    out[sp.id] = Math.round(v / sp.step) * sp.step;
  }
  return out;
}

function ampEnv(g, t, peak, len, slide, hold) {
  if (!slide) {
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(peak, t + 0.004);
  }
  if (!hold) {
    g.setValueAtTime(peak, t + len);
    g.linearRampToValueAtTime(0, t + len + 0.012);
  }
}

function filtEnv(params, t, base, top, decay) {
  for (const fp of params) {
    fp.cancelScheduledValues(t);
    fp.setValueAtTime(cl(top, 30, 18000), t);
    fp.exponentialRampToValueAtTime(cl(base, 30, 18000), t + decay);
  }
}

function glide(param, freq, t) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t);
  param.exponentialRampToValueAtTime(freq, t + 0.05);
}

class Voice {
  constructor(ctx, p) {
    this.ctx = ctx; this.p = p;
    this.out = ctx.createGain();
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    this.amp.connect(this.out);
    this.params = defaultParams(this.constructor.specIndex);
  }
  setParam(id, v) { this.params[id] = v; this.apply(this.ctx.currentTime); }
  apply() {}
  silence(t) { this.amp.gain.cancelScheduledValues(t); this.amp.gain.setTargetAtTime(0, t, 0.01); }
  peak(vel, accent) { return (vel / 127) * (accent ? 1.0 : 0.7); }
  top(accent, amt = 1) { return this.p.cutoff + this.p.envMod * amt * (accent ? 1.6 : 1); }
  dec(accent) { return this.p.decay * (accent ? 1.3 : 1); }
}

// 1) „Prophet”: dwa lekko rozstrojone saw i kaskada dwóch filtrów dolnoprzepustowych (24 dB).
export class ProphetVoice extends Voice {
  static specIndex = 0;
  constructor(ctx, p) {
    super(ctx, p);
    this.out.gain.value = 0.9;
    this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = ctx.createOscillator(); this.o2.type = 'sawtooth';
    this.o3 = ctx.createOscillator(); this.o3.type = 'triangle';      // sub o oktawę niżej
    this.subGain = ctx.createGain();
    const m = ctx.createGain(); m.gain.value = 0.5;
    this.f1 = ctx.createBiquadFilter(); this.f1.type = 'lowpass';
    this.f2 = ctx.createBiquadFilter(); this.f2.type = 'lowpass';
    this.o1.connect(m); this.o2.connect(m); this.o3.connect(this.subGain).connect(m);
    m.connect(this.f1).connect(this.f2).connect(this.amp);
    this.o1.start(); this.o2.start(); this.o3.start();
    this.apply(ctx.currentTime);
    this.refresh(ctx.currentTime);
  }
  apply(now) {
    this.o2.detune.setTargetAtTime(this.params.detune, now, 0.02);
    this.subGain.gain.setTargetAtTime(this.params.sub * 0.8, now, 0.02);
  }
  refresh(now) {
    this.f1.frequency.setTargetAtTime(this.p.cutoff, now, 0.02);
    this.f2.frequency.setTargetAtTime(this.p.cutoff, now, 0.02);
    this.f1.Q.setTargetAtTime(this.p.res * 0.6, now, 0.02);
    this.f2.Q.setTargetAtTime(this.p.res * 0.4, now, 0.02);
  }
  note(t, freq, vel, accent, len, slide, hold) {
    for (const [o, mul] of [[this.o1, 1], [this.o2, 1], [this.o3, 0.5]]) {
      slide ? glide(o.frequency, freq * mul, t) : o.frequency.setValueAtTime(freq * mul, t);
    }
    if (!slide) filtEnv([this.f1.frequency, this.f2.frequency], t, this.p.cutoff, this.top(accent, this.params.envAmt), this.dec(accent));
    ampEnv(this.amp.gain, t, this.peak(vel, accent), len, slide, hold);
  }
}

// 2) „MS-20”: prostokąt, rezonansowy filtr górno- i dolnoprzepustowy, ostre przesterowanie.
export class MS20Voice extends Voice {
  static specIndex = 1;
  constructor(ctx, p) {
    super(ctx, p);
    this.out.gain.value = 0.45;
    this.o = ctx.createOscillator(); this.o.type = 'square';
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.Q.value = 3;
    this.drv = ctx.createGain();
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass';
    const sh = ctx.createWaveShaper();
    const c = new Float32Array(1024);
    for (let i = 0; i < c.length; i++) { const x = (i / 511.5) - 1; c[i] = Math.tanh(3 * x); }
    sh.curve = c;
    this.o.connect(this.hp).connect(this.lp).connect(this.drv).connect(sh).connect(this.amp);
    this.o.start();
    this.apply(ctx.currentTime);
    this.refresh(ctx.currentTime);
  }
  apply(now) {
    this.hp.frequency.setTargetAtTime(this.params.hpf, now, 0.02);
    this.drv.gain.setTargetAtTime(this.params.drive / 3, now, 0.02);   // 3 = przesterowanie bazowe krzywej
  }
  refresh(now) {
    this.lp.frequency.setTargetAtTime(this.p.cutoff, now, 0.02);
    this.lp.Q.setTargetAtTime(cl(this.p.res * 1.3, 0, 28), now, 0.02);
  }
  note(t, freq, vel, accent, len, slide, hold) {
    slide ? glide(this.o.frequency, freq, t) : this.o.frequency.setValueAtTime(freq, t);
    if (!slide) filtEnv([this.lp.frequency], t, this.p.cutoff, this.top(accent, this.params.envAmt), this.dec(accent) * 0.8);
    ampEnv(this.amp.gain, t, this.peak(vel, accent), len, slide, hold);
  }
}

// 3) „DX”: FM z dwoma operatorami; indeks modulacji opada z obwiednią, jasność z suwaka filtra.
export class DXVoice extends Voice {
  static specIndex = 2;
  constructor(ctx, p) {
    super(ctx, p);
    this.out.gain.value = 0.57;
    this.car = ctx.createOscillator(); this.car.type = 'sine';
    this.mod = ctx.createOscillator(); this.mod.type = 'sine';
    this.mg = ctx.createGain(); this.mg.gain.value = 0;
    this.mod.connect(this.mg).connect(this.car.frequency);
    this.car.connect(this.amp);
    this.car.start(); this.mod.start();
  }
  refresh() {}
  get ratio() { return this.params.ratio; }
  index(accent) { return (this.params.index * 0.5 + 3 * this.p.bright) * (accent ? 1.5 : 1); }
  note(t, freq, vel, accent, len, slide, hold) {
    const idx = this.index(accent);
    if (slide) {
      glide(this.car.frequency, freq, t);
      glide(this.mod.frequency, freq * this.ratio, t);
      this.mg.gain.cancelScheduledValues(t);
      this.mg.gain.setValueAtTime(this.mg.gain.value, t);
      this.mg.gain.exponentialRampToValueAtTime(Math.max(0.001, freq * idx * 0.3), t + 0.05);
    } else {
      this.car.frequency.setValueAtTime(freq, t);
      this.mod.frequency.setValueAtTime(freq * this.ratio, t);
      this.mg.gain.cancelScheduledValues(t);
      this.mg.gain.setValueAtTime(freq * idx, t);
      this.mg.gain.exponentialRampToValueAtTime(Math.max(0.001, freq * idx * 0.15), t + this.p.decay * this.params.fmDecay);
    }
    ampEnv(this.amp.gain, t, this.peak(vel, accent), len, slide, hold);
  }
}

// 4) „Wavetable”: płynny przelot z fali piłokształtnej do „samogłoskowej”, sterowany obwiednią.
export class WavetableVoice extends Voice {
  static specIndex = 3;
  constructor(ctx, p) {
    super(ctx, p);
    this.out.gain.value = 0.95;
    this.N = 48;
    this.re = new Float32Array(this.N + 1);
    const A = new Float32Array(this.N + 1);
    for (let n = 1; n <= this.N; n++) A[n] = 1 / n;
    this.oa = ctx.createOscillator(); this.oa.setPeriodicWave(ctx.createPeriodicWave(this.re, A));
    this.ob = ctx.createOscillator();
    this._buildVowel();
    this.ga = ctx.createGain(); this.gb = ctx.createGain();
    this.ga.gain.value = 1; this.gb.gain.value = 0;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass';
    this.oa.connect(this.ga).connect(this.lp); this.ob.connect(this.gb).connect(this.lp);
    this.lp.connect(this.amp);
    this.oa.start(); this.ob.start();
    this.refresh(ctx.currentTime);
  }
  // Druga tablica: dwa „formanty” – pierwszy w harmonicznej `vowel`, drugi wyżej.
  _buildVowel() {
    const B = new Float32Array(this.N + 1), v = this.params.vowel;
    for (let n = 1; n <= this.N; n++) {
      B[n] = (Math.exp(-Math.pow(n - v, 2) / 3) + 0.6 * Math.exp(-Math.pow(n - v * 2.5, 2) / 6)) / Math.sqrt(n);
    }
    this.ob.setPeriodicWave(this.ctx.createPeriodicWave(this.re, B));
  }
  setParam(id, v) { this.params[id] = v; if (id === 'vowel') this._buildVowel(); }
  refresh(now) {
    this.lp.frequency.setTargetAtTime(this.p.cutoff * 2, now, 0.02);
    this.lp.Q.setTargetAtTime(this.p.res * 0.3, now, 0.02);
  }
  note(t, freq, vel, accent, len, slide, hold) {
    for (const o of [this.oa, this.ob]) slide ? glide(o.frequency, freq, t) : o.frequency.setValueAtTime(freq, t);
    if (!slide) {
      const d = this.dec(accent) * 2;
      const from = this.params.morph, to = cl(from + this.params.sweep * 0.8, 0, 1);   // przelot między tablicami
      this.gb.gain.cancelScheduledValues(t); this.ga.gain.cancelScheduledValues(t);
      this.gb.gain.setValueAtTime(from, t); this.gb.gain.linearRampToValueAtTime(to, t + d);
      this.ga.gain.setValueAtTime(1 - from, t); this.ga.gain.linearRampToValueAtTime(1 - to, t + d);
      filtEnv([this.lp.frequency], t, this.p.cutoff * 2, this.top(accent) * 2, this.dec(accent));
    }
    ampEnv(this.amp.gain, t, this.peak(vel, accent), len, slide, hold);
  }
}

export const VOICES = [ProphetVoice, MS20Voice, DXVoice, WavetableVoice];
export const VOICE_NAMES = ['prophet', 'ms-20', 'dx', 'wavetable'];
