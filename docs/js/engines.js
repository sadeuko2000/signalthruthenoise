import { buildExternal } from './extvoices.js';

// Cztery monofoniczne silniki basu, które dostają te same nuty. Proporcje głośności
// ustawia pad XY (miks dwuwymiarowy). Wszystko na natywnych węzłach Web Audio.
// Własne implementacje inspirowane typami syntezy (analog 3xVCO, MS-20, FM 2-op, wavetable).
// Każdy silnik ma własne obwiednie filtra i amplitudy (wspólna część PARAM_SPECS, grupa 'env').

// Okrągły pad: silniki leżą na obwodzie koła pod kątem 45° (lewy-góra, prawy-góra, lewy-dół, prawy-dół).
// (x, y) z kwadratu 0..1 jest rzutowane na koło, punkty poza kołem trafiają na jego brzeg.
// Wagi rosną gwałtownie przy zbliżaniu się do silnika (w jego punkcie gra tylko on), środek miesza po równo,
// a suma kwadratów wag wynosi 1 (miks równomocowy). `enabled` wyłącza silniki: ich waga jest 0, reszta się renormalizuje.
const ANCHORS = [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([a, b]) => [a * Math.SQRT1_2, b * Math.SQRT1_2]);

export function clampToDisc(x, y) {
  const u = 2 * x - 1, v = 2 * y - 1, r = Math.hypot(u, v);
  const k = r > 1 ? 1 / r : 1;
  return { x: (u * k + 1) / 2, y: (v * k + 1) / 2 };
}

export function blendWeights(x, y, enabled = [1, 1, 1, 1]) {
  const c = clampToDisc(x, y), u = 2 * c.x - 1, v = 2 * c.y - 1;
  const w = ANCHORS.map(([ax, ay], i) => {
    const d2 = (u - ax) ** 2 + (v - ay) ** 2;
    return enabled[i] ? 1 / ((d2 + 0.04) ** 2) : 0;
  });
  const norm = Math.sqrt(w.reduce((s, x) => s + x * x, 0));
  return norm ? w.map((x) => x / norm) : [0, 0, 0, 0];
}

const cl = (v, a, b) => Math.max(a, Math.min(b, v));
// Globalne przesunięcie parametru silnika, -1..+1: 0 = bez zmian, +1 = maksimum zakresu, -1 = minimum zakresu.
export const bip = (own, off, min, max) => (off >= 0 ? own + off * (max - own) : min + (own - min) * (1 + off));

// Obwiednie wspólne dla wszystkich silników.
// aAtk i aRel w milisekundach, pozostałe czasy w sekundach.
const ENV_SPECS = [
  { id: 'fEnv', label: 'filtr env', group: 'env', min: 0, max: 3, step: 0.01, def: 1.2, rand: [0.6, 2.0] },
  { id: 'fDec', label: 'filtr zan.', group: 'env', min: 0.03, max: 0.8, step: 0.01, def: 0.2, rand: [0.08, 0.4] },
  { id: 'aAtk', label: 'amp atak', group: 'env', min: 0, max: 40, step: 0.5, def: 2, rand: [0.5, 8] },
  { id: 'aDec', label: 'amp zanik', group: 'env', min: 0.03, max: 0.8, step: 0.01, def: 0.25, rand: [0.08, 0.4] },
  { id: 'aSus', label: 'amp sust.', group: 'env', min: 0, max: 1, step: 0.01, def: 0.85, rand: [0.5, 1] },
  { id: 'aRel', label: 'amp rel.', group: 'env', min: 3, max: 300, step: 1, def: 30, rand: [10, 120] },
];

// Parametry silników. min/max = pełny zakres suwaka, rand = „rozsądny” zakres losowania
// (żeby preset nadal brzmiał jak electro), choices = dozwolone wartości przy losowaniu.
export const PARAM_SPECS = [
  [ // prophet
    { id: 'detune', label: 'detune', min: 0, max: 25, step: 0.5, def: 10, rand: [5, 18] },
    { id: 'body', label: 'ciało', min: 0, max: 1, step: 0.01, def: 0.5, rand: [0.2, 0.9] },
    { id: 'drive', label: 'drive', min: 0.5, max: 4, step: 0.05, def: 1.5, rand: [1, 2.8] },
    ...ENV_SPECS,
  ],
  [ // ms-20
    { id: 'drive', label: 'drive', min: 1, max: 8, step: 0.1, def: 3.5, rand: [2.5, 6] },
    { id: 'hpf', label: 'hp', min: 40, max: 400, step: 1, def: 90, rand: [60, 220] },
    { id: 'wave', label: 'kształt', min: 0, max: 1, step: 0.01, def: 0.35, rand: [0, 1] },
    ...ENV_SPECS,
  ],
  [ // dx
    { id: 'ratio', label: 'stosunek', min: 0.5, max: 4, step: 0.5, def: 2, choices: [0.5, 1, 1, 2, 2, 3] },
    { id: 'index', label: 'indeks', min: 0.2, max: 6, step: 0.05, def: 3, rand: [1.5, 4.5] },
    { id: 'sub', label: 'sub', min: 0, max: 1, step: 0.01, def: 0.25, rand: [0, 0.5] },
    ...ENV_SPECS,
  ],
  [ // wavetable
    { id: 'vowel', label: 'formant', min: 2, max: 12, step: 0.1, def: 4, rand: [2.5, 9] },
    { id: 'morph', label: 'pozycja', min: 0, max: 1, step: 0.01, def: 0.4, rand: [0, 0.8] },
    { id: 'sweep', label: 'przelot', min: -1, max: 1, step: 0.01, def: 0.5, rand: [-0.7, 0.9] },
    ...ENV_SPECS,
  ],
];

export function defaultParams(i) {
  return Object.fromEntries(PARAM_SPECS[i].map((sp) => [sp.id, sp.def]));
}

// Losuje parametry jednego silnika (łącznie z obwiedniami) w granicach `rand` albo z listy `choices`.
export function randomizeParams(i, rng = Math.random) {
  const out = {};
  for (const sp of PARAM_SPECS[i]) {
    if (sp.virtual) continue;                      // parametry wirtualne (obwiednie radarxxx w silnikach zewnętrznych) są widokiem parametrów modułu
    if (sp.choices) { out[sp.id] = sp.choices[Math.floor(rng() * sp.choices.length)]; continue; }
    const [lo, hi] = sp.rand;
    const v = lo + rng() * (hi - lo);
    out[sp.id] = Math.round(v / sp.step) * sp.step;
  }
  return out;
}

export const satCurve = (k) => {
  const n = 2048, c = new Float32Array(n), norm = Math.tanh(k);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(k * ((i / (n - 1)) * 2 - 1)) / norm;
  return c;
};

// Zatrzymuje automatykę parametru w chwili t (Chrome: cancelAndHold; reszta: zwykłe cancel).
function holdAt(g, t) {
  if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else g.cancelScheduledValues(t);
}

let glideTime = 0.05;                                  // czas ślizgu (s), ustawiany pokrętłem GLIDE
export const setGlideTime = (sec) => { glideTime = Math.max(0.005, sec); };
function glide(param, freq, t) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t);
  param.exponentialRampToValueAtTime(freq, t + glideTime);
}

class Voice {
  constructor(ctx, p, satK = 1.6) {
    this.ctx = ctx; this.p = p;
    this.out = ctx.createGain();
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    this.drv = ctx.createGain();                       // dosterowanie nasycenia
    this.sat = ctx.createWaveShaper(); this.sat.curve = satCurve(satK); this.sat.oversample = '4x';   // bez aliasingu   // dokłada harmoniczne
    this.amp.connect(this.drv).connect(this.sat).connect(this.out);
    this.params = defaultParams(this.constructor.specIndex);
  }
  setParam(id, v) { this.params[id] = v; this.apply(this.ctx.currentTime); }
  // Wartość parametru obwiedni z uwzględnieniem globalnych przesunięć (pokrętła w SEQ MAIN): atak i release amp oraz zanik filtra.
  effParam(id) {
    const o = this.p, v = this.params[id];
    if (id === 'aAtk') return bip(v, o.offAAtk || 0, 0, 40);
    if (id === 'aRel') return bip(v, o.offARel || 0, 3, 300);
    if (id === 'fDec') return bip(v, o.offFRel || 0, 0.03, 0.8);
    return v;
  }
  apply() {}
  refresh() {}   // silniki z filtrem nadpisują: przeliczenie cutoffu i rezonansu
  silence(t) { this.amp.gain.cancelScheduledValues(t); this.amp.gain.setTargetAtTime(0, t, 0.01); }
  peak(vel, accent) { return (vel / 127) * (accent ? 1.0 : 0.75); }

  // Obwiednia amplitudy: atak -> zanik do sustain -> release po końcu bramki.
  ampEnv(t, peak, len, slide, hold) {
    const g = this.amp.gain, P = this.params;
    if (!slide) {
      holdAt(g, t);
      const atk = Math.max(0.001, this.effParam('aAtk') / 1000);
      g.linearRampToValueAtTime(peak, t + atk);
      g.linearRampToValueAtTime(peak * P.aSus, t + atk + P.aDec);
    }
    if (!hold) {
      holdAt(g, t + len);
      g.linearRampToValueAtTime(0, t + len + Math.max(0.003, this.effParam('aRel') / 1000));
    }
  }
  // Obwiednia filtra: skok do cutoff + 2500 Hz * fEnv, potem zanik do cutoffu.
  filtEnv(fps, t, base, accent, mul = 1) {
    const top = cl((base + 2500 * mul * this.params.fEnv * (accent ? 1.5 : 1)), 30, 18000);
    const d = this.effParam('fDec') * (accent ? 1.3 : 1);
    const atk = Math.max(0, this.p.offFAtk || 0) * 0.15;               // atak filtra: 0 = zryw od razu, +100% = 150 ms narastania
    for (const fp of fps) {
      fp.cancelScheduledValues(t);
      if (atk > 0.003) { fp.setValueAtTime(cl(base, 30, 18000), t); fp.exponentialRampToValueAtTime(top, t + atk); fp.exponentialRampToValueAtTime(cl(base, 30, 18000), t + atk + d); }
      else { fp.setValueAtTime(top, t); fp.exponentialRampToValueAtTime(cl(base, 30, 18000), t + d); }
    }
  }
}

// 1) „Prophet”: trzy rozstrojone saw, kaskada dwóch filtrów (24 dB) i sinus „ciała” obok filtra.
export class ProphetVoice extends Voice {
  static specIndex = 0;
  constructor(ctx, p) {
    super(ctx, p, 1.6);
    this.out.gain.value = 0.8;
    this.saws = [-1, 0, 1].map(() => { const o = ctx.createOscillator(); o.type = 'sawtooth'; return o; });
    const m = ctx.createGain(); m.gain.value = 0.38;
    this.f1 = ctx.createBiquadFilter(); this.f1.type = 'lowpass';
    this.f2 = ctx.createBiquadFilter(); this.f2.type = 'lowpass';
    this.saws.forEach((o) => o.connect(m));
    m.connect(this.f1).connect(this.f2).connect(this.amp);
    this.bodyOsc = ctx.createOscillator(); this.bodyOsc.type = 'sine';
    this.bodyGain = ctx.createGain();
    this.bodyOsc.connect(this.bodyGain).connect(this.amp);        // omija filtr: stały dół
    this.saws.forEach((o) => o.start()); this.bodyOsc.start();
    this.apply(ctx.currentTime); this.refresh(ctx.currentTime);
  }
  apply(now) {
    const d = this.params.detune;
    this.saws[0].detune.setTargetAtTime(-d, now, 0.02);
    this.saws[2].detune.setTargetAtTime(d, now, 0.02);
    this.bodyGain.gain.setTargetAtTime(this.params.body * 0.6, now, 0.02);
    this.drv.gain.setTargetAtTime(this.params.drive, now, 0.02);
  }
  refresh(now) {
    this.f1.frequency.setTargetAtTime(this.p.cutoff, now, 0.02);
    this.f2.frequency.setTargetAtTime(this.p.cutoff, now, 0.02);
    this.f1.Q.setTargetAtTime(this.p.res * 0.6, now, 0.02);
    this.f2.Q.setTargetAtTime(this.p.res * 0.4, now, 0.02);
  }
  note(t, freq, vel, accent, len, slide, hold) {
    for (const o of [...this.saws, this.bodyOsc]) slide ? glide(o.frequency, freq, t) : o.frequency.setValueAtTime(freq, t);
    if (!slide) this.filtEnv([this.f1.frequency, this.f2.frequency], t, this.p.cutoff, accent);
    this.ampEnv(t, this.peak(vel, accent), len, slide, hold);
  }
}

// 2) „MS-20”: prostokąt/piła, rezonansowe HP i LP, ostre przesterowanie i odrobina ciała.
export class MS20Voice extends Voice {
  static specIndex = 1;
  constructor(ctx, p) {
    super(ctx, p, 1.3);
    this.out.gain.value = 0.55;
    this.o1 = ctx.createOscillator(); this.o1.type = 'square';
    this.o2 = ctx.createOscillator(); this.o2.type = 'sawtooth';
    this.g1 = ctx.createGain(); this.g2 = ctx.createGain();
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.Q.value = 3;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass';
    this.pre = ctx.createGain();
    const sh = ctx.createWaveShaper(); sh.curve = satCurve(3); sh.oversample = '4x';
    this.o1.connect(this.g1).connect(this.hp); this.o2.connect(this.g2).connect(this.hp);
    this.hp.connect(this.lp).connect(this.pre).connect(sh).connect(this.amp);
    this.bodyOsc = ctx.createOscillator(); this.bodyOsc.type = 'sine';
    const bg = ctx.createGain(); bg.gain.value = 0.3;
    this.bodyOsc.connect(bg).connect(this.amp);
    this.o1.start(); this.o2.start(); this.bodyOsc.start();
    this.apply(ctx.currentTime); this.refresh(ctx.currentTime);
  }
  apply(now) {
    this.hp.frequency.setTargetAtTime(this.params.hpf, now, 0.02);
    this.pre.gain.setTargetAtTime(this.params.drive / 3, now, 0.02);
    this.g1.gain.setTargetAtTime(0.7 * (1 - this.params.wave), now, 0.02);
    this.g2.gain.setTargetAtTime(0.7 * this.params.wave, now, 0.02);
  }
  refresh(now) {
    this.lp.frequency.setTargetAtTime(this.p.cutoff, now, 0.02);
    this.lp.Q.setTargetAtTime(cl(this.p.res * 1.3, 0, 28), now, 0.02);
  }
  note(t, freq, vel, accent, len, slide, hold) {
    for (const o of [this.o1, this.o2, this.bodyOsc]) slide ? glide(o.frequency, freq, t) : o.frequency.setValueAtTime(freq, t);
    if (!slide) this.filtEnv([this.lp.frequency], t, this.p.cutoff, accent, 1.2);
    this.ampEnv(t, this.peak(vel, accent), len, slide, hold);
  }
}

// 3) „DX”: FM z dwoma operatorami. Indeks modulacji startuje wysoko i opada (obwiednia „filtra”).
export class DXVoice extends Voice {
  static specIndex = 2;
  constructor(ctx, p) {
    super(ctx, p, 2.0);
    this.out.gain.value = 0.7;
    this.car = ctx.createOscillator(); this.car.type = 'sine';
    this.mod = ctx.createOscillator(); this.mod.type = 'sine';
    this.mg = ctx.createGain(); this.mg.gain.value = 0;
    this.mod.connect(this.mg).connect(this.car.frequency);
    this.car.connect(this.amp);
    this.subOsc = ctx.createOscillator(); this.subOsc.type = 'sine';      // oktawa niżej
    this.subGain = ctx.createGain();
    this.subOsc.connect(this.subGain).connect(this.amp);
    this.car.start(); this.mod.start(); this.subOsc.start();
    this.apply(ctx.currentTime);
  }
  apply(now) { this.subGain.gain.setTargetAtTime(this.params.sub * 0.8, now, 0.02); }
  get ratio() { return this.params.ratio; }
  // Baza indeksu: parametr + jasność z suwaka filtra. Start obwiedni = baza * (0.5 + 0.8 fEnv).
  baseIndex() { return this.params.index + 3 * this.p.bright; }
  note(t, freq, vel, accent, len, slide, hold) {
    const I = this.baseIndex(), P = this.params;
    if (slide) {
      glide(this.car.frequency, freq, t); glide(this.mod.frequency, freq * this.ratio, t); glide(this.subOsc.frequency, freq / 2, t);
      this.mg.gain.cancelScheduledValues(t);
      this.mg.gain.setValueAtTime(this.mg.gain.value, t);
      this.mg.gain.exponentialRampToValueAtTime(Math.max(0.001, freq * I * 0.3), t + 0.05);
    } else {
      this.car.frequency.setValueAtTime(freq, t);
      this.mod.frequency.setValueAtTime(freq * this.ratio, t);
      this.subOsc.frequency.setValueAtTime(freq / 2, t);
      const start = I * (0.5 + 0.8 * P.fEnv) * (accent ? 1.4 : 1);
      this.mg.gain.cancelScheduledValues(t);
      this.mg.gain.setValueAtTime(Math.max(0.001, freq * start), t);
      this.mg.gain.exponentialRampToValueAtTime(Math.max(0.001, freq * I * 0.3), t + this.effParam('fDec') * 1.5);
    }
    this.ampEnv(t, this.peak(vel, accent), len, slide, hold);
  }
}

// 4) „Wavetable”: płynny przelot z fali piłokształtnej do „samogłoskowej”, sterowany obwiednią.
export class WavetableVoice extends Voice {
  static specIndex = 3;
  constructor(ctx, p) {
    super(ctx, p, 1.8);
    this.out.gain.value = 0.8;
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
    this.bodyOsc = ctx.createOscillator(); this.bodyOsc.type = 'sine';
    const bg = ctx.createGain(); bg.gain.value = 0.35;
    this.bodyOsc.connect(bg).connect(this.amp);
    this.oa.start(); this.ob.start(); this.bodyOsc.start();
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
    for (const o of [this.oa, this.ob, this.bodyOsc]) slide ? glide(o.frequency, freq, t) : o.frequency.setValueAtTime(freq, t);
    if (!slide) {
      const d = this.effParam('fDec') * (accent ? 1.3 : 1) * 2;
      const from = this.params.morph, to = cl(from + this.params.sweep * 0.8, 0, 1);   // przelot między tablicami
      this.gb.gain.cancelScheduledValues(t); this.ga.gain.cancelScheduledValues(t);
      this.gb.gain.setValueAtTime(from, t); this.gb.gain.linearRampToValueAtTime(to, t + d);
      this.ga.gain.setValueAtTime(1 - from, t); this.ga.gain.linearRampToValueAtTime(1 - to, t + d);
      this.filtEnv([this.lp.frequency], t, this.p.cutoff * 2, accent, 2);
    }
    this.ampEnv(t, this.peak(vel, accent), len, slide, hold);
  }
}

export const VOICES = [ProphetVoice, MS20Voice, DXVoice, WavetableVoice];
export const VOICE_NAMES = ['prophet', 'ms-20', 'dx', 'wavetable'];

// Silniki zewnętrzne (HOWL) dołączane za czterema własnymi: ich specyfikacje i klasy głosów lądują w tych samych tablicach.
// VOICE_NAMES zostaje listą czterech miejsc (slotów), a nie rodzajów silnika.
const EXT = buildExternal(ENV_SPECS, bip);
PARAM_SPECS.push(...EXT.specs);
VOICES.push(...EXT.voices);
export const ENGINE_SHORT = ['PROPHET', 'MS20', 'DX', 'WAVE', ...EXT.short];      // nazwy rodzajów silnika
export const ENGINE_TAB = ['PRO', 'MS20', 'DX', 'WAVE', ...EXT.tab];              // krótkie nazwy na zakładkach
// Sprawdza, które rodzaje silnika działają w tym środowisku (własne zawsze, zewnętrzne po próbie wczytania ich AudioWorklet).
export async function probeEngines(ctx) {
  return Promise.all(VOICES.map((V) => (V.probe ? V.probe(ctx) : true)));
}
