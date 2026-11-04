// Cztery monofoniczne silniki basu, które dostają te same nuty. Proporcje głośności
// ustawia pad XY (miks dwuwymiarowy). Wszystko na natywnych węzłach Web Audio, lekkie dla CPU.
// Własne implementacje inspirowane typami syntezy (analog 2xVCO, MS-20, FM 2-op, wavetable).

// Narożniki pada: lewy-góra, prawy-góra, lewy-dół, prawy-dół. Miks równomocowy (suma kwadratów = 1).
export function blendWeights(x, y) {
  const w = [(1 - x) * y, x * y, (1 - x) * (1 - y), x * (1 - y)];
  return w.map(Math.sqrt);
}

const cl = (v, a, b) => Math.max(a, Math.min(b, v));

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
  }
  silence(t) { this.amp.gain.cancelScheduledValues(t); this.amp.gain.setTargetAtTime(0, t, 0.01); }
  peak(vel, accent) { return (vel / 127) * (accent ? 1.0 : 0.7); }
  top(accent) { return this.p.cutoff + this.p.envMod * (accent ? 1.6 : 1); }
  dec(accent) { return this.p.decay * (accent ? 1.3 : 1); }
}

// 1) „Prophet”: dwa lekko rozstrojone saw i kaskada dwóch filtrów dolnoprzepustowych (24 dB).
export class ProphetVoice extends Voice {
  constructor(ctx, p) {
    super(ctx, p);
    this.out.gain.value = 0.9;
    this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = ctx.createOscillator(); this.o2.type = 'sawtooth'; this.o2.detune.value = 9;
    const m = ctx.createGain(); m.gain.value = 0.5;
    this.f1 = ctx.createBiquadFilter(); this.f1.type = 'lowpass';
    this.f2 = ctx.createBiquadFilter(); this.f2.type = 'lowpass';
    this.o1.connect(m); this.o2.connect(m);
    m.connect(this.f1).connect(this.f2).connect(this.amp);
    this.o1.start(); this.o2.start();
    this.refresh(ctx.currentTime);
  }
  refresh(now) {
    this.f1.frequency.setTargetAtTime(this.p.cutoff, now, 0.02);
    this.f2.frequency.setTargetAtTime(this.p.cutoff, now, 0.02);
    this.f1.Q.setTargetAtTime(this.p.res * 0.6, now, 0.02);
    this.f2.Q.setTargetAtTime(this.p.res * 0.4, now, 0.02);
  }
  note(t, freq, vel, accent, len, slide, hold) {
    for (const o of [this.o1, this.o2]) slide ? glide(o.frequency, freq, t) : o.frequency.setValueAtTime(freq, t);
    if (!slide) filtEnv([this.f1.frequency, this.f2.frequency], t, this.p.cutoff, this.top(accent), this.dec(accent));
    ampEnv(this.amp.gain, t, this.peak(vel, accent), len, slide, hold);
  }
}

// 2) „MS-20”: prostokąt, rezonansowy filtr górno- i dolnoprzepustowy, ostre przesterowanie.
export class MS20Voice extends Voice {
  constructor(ctx, p) {
    super(ctx, p);
    this.out.gain.value = 0.45;
    this.o = ctx.createOscillator(); this.o.type = 'square';
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 90; this.hp.Q.value = 3;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass';
    const sh = ctx.createWaveShaper();
    const c = new Float32Array(1024);
    for (let i = 0; i < c.length; i++) { const x = (i / 511.5) - 1; c[i] = Math.tanh(3 * x); }
    sh.curve = c;
    this.o.connect(this.hp).connect(this.lp).connect(sh).connect(this.amp);
    this.o.start();
    this.refresh(ctx.currentTime);
  }
  refresh(now) {
    this.lp.frequency.setTargetAtTime(this.p.cutoff, now, 0.02);
    this.lp.Q.setTargetAtTime(cl(this.p.res * 1.3, 0, 28), now, 0.02);
  }
  note(t, freq, vel, accent, len, slide, hold) {
    slide ? glide(this.o.frequency, freq, t) : this.o.frequency.setValueAtTime(freq, t);
    if (!slide) filtEnv([this.lp.frequency], t, this.p.cutoff, this.top(accent) * 1.2, this.dec(accent) * 0.8);
    ampEnv(this.amp.gain, t, this.peak(vel, accent), len, slide, hold);
  }
}

// 3) „DX”: FM z dwoma operatorami; indeks modulacji opada z obwiednią, jasność z suwaka filtra.
export class DXVoice extends Voice {
  constructor(ctx, p) {
    super(ctx, p);
    this.out.gain.value = 0.57;
    this.ratio = 1;
    this.car = ctx.createOscillator(); this.car.type = 'sine';
    this.mod = ctx.createOscillator(); this.mod.type = 'sine';
    this.mg = ctx.createGain(); this.mg.gain.value = 0;
    this.mod.connect(this.mg).connect(this.car.frequency);
    this.car.connect(this.amp);
    this.car.start(); this.mod.start();
  }
  refresh() {}
  index(accent) { return (0.6 + 4 * this.p.bright) * (accent ? 1.5 : 1); }
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
      this.mg.gain.exponentialRampToValueAtTime(Math.max(0.001, freq * idx * 0.15), t + this.p.decay * 1.2);
    }
    ampEnv(this.amp.gain, t, this.peak(vel, accent), len, slide, hold);
  }
}

// 4) „Wavetable”: płynny przelot z fali piłokształtnej do „samogłoskowej”, sterowany obwiednią.
export class WavetableVoice extends Voice {
  constructor(ctx, p) {
    super(ctx, p);
    this.out.gain.value = 0.95;
    const N = 48, re = new Float32Array(N + 1), A = new Float32Array(N + 1), B = new Float32Array(N + 1);
    for (let n = 1; n <= N; n++) {
      A[n] = 1 / n;
      const peak = Math.exp(-Math.pow(n - 4, 2) / 3) + 0.6 * Math.exp(-Math.pow(n - 10, 2) / 6);  // dwa „formanty”
      B[n] = peak / Math.sqrt(n);
    }
    this.oa = ctx.createOscillator(); this.oa.setPeriodicWave(ctx.createPeriodicWave(re, A));
    this.ob = ctx.createOscillator(); this.ob.setPeriodicWave(ctx.createPeriodicWave(re, B));
    this.ga = ctx.createGain(); this.gb = ctx.createGain();
    this.ga.gain.value = 1; this.gb.gain.value = 0;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass';
    this.oa.connect(this.ga).connect(this.lp); this.ob.connect(this.gb).connect(this.lp);
    this.lp.connect(this.amp);
    this.oa.start(); this.ob.start();
    this.refresh(ctx.currentTime);
  }
  refresh(now) {
    this.lp.frequency.setTargetAtTime(this.p.cutoff * 2, now, 0.02);
    this.lp.Q.setTargetAtTime(this.p.res * 0.3, now, 0.02);
  }
  note(t, freq, vel, accent, len, slide, hold) {
    for (const o of [this.oa, this.ob]) slide ? glide(o.frequency, freq, t) : o.frequency.setValueAtTime(freq, t);
    if (!slide) {
      const d = this.dec(accent) * 2;
      const from = this.p.bright, to = 1 - this.p.bright * 0.6;       // kierunek przelotu zależy od jasności
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
