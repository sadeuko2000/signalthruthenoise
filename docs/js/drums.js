// Prosty moduł perkusji: generator wzorów w stylu electro i techno oraz syntezowane brzmienia (bez próbek):
// 808, 909 i nowoczesny „drum synth” (czysty sinus z szybkim zjazdem, szum i metaliczne hat-y). Własne implementacje inspirowane typami syntezy.
import { mulberry32 } from './generator.js';

export const DRUM_TRACKS = ['KICK', 'SNARE', 'CLAP', 'CH', 'OH'];          // stopa, werbel, klaskanie, hat zamknięty, hat otwarty
export const DRUM_KITS = ['808', '909', 'SYNTH'];
export const DRUM_STYLES = ['TECHNO', 'ELECTRO'];
export const DRUM_STEPS = 16;
export const emptyDrums = () => DRUM_TRACKS.map(() => Array(DRUM_STEPS).fill(0));    // 0 = cisza, 1 = uderzenie, 2 = akcent

// ---------- generator wzorów ----------
// style 0 = techno (stopa na każdą ćwierćnutę, hat-y w off-beatach), 1 = electro (łamana stopa, werbel na 2 i 4). density 0..1 = ile dodatkowych uderzeń.
export function generateDrums({ style = 0, density = 0.5, seed = 1 } = {}) {
  const r = mulberry32(seed >>> 0), d = density, steps = emptyDrums(), [K, S, C, H, O] = steps;
  const sample = (list, n) => { const a = list.slice(), out = []; while (out.length < n && a.length) out.push(a.splice(Math.floor(r() * a.length), 1)[0]); return out; };
  if (style === 0) {
    [0, 4, 8, 12].forEach((i) => { K[i] = i === 0 ? 2 : 1; });
    if (r() < 0.1 + 0.3 * d) K[r() < 0.5 ? 10 : 15] = 1;                       // rzadka dodatkowa stopa
    C[4] = 1; C[12] = 1;
    if (r() < 0.2 + 0.5 * d) S[r() < 0.5 ? 15 : 7] = 1;                         // cichy werbel-duch
    for (let i = 0; i < DRUM_STEPS; i++) {
      if (i % 4 === 2) H[i] = r() < 0.4 ? 2 : 1;                                // off-beat zawsze (akcenty losowo)
      else if (r() < 0.05 + 0.45 * d) H[i] = 1;                                // reszta 16-tek zależnie od gęstości
    }
    [2, 6, 10, 14].forEach((i) => { if (r() < 0.2 + 0.5 * d) { O[i] = 1; H[i] = 0; } });   // hat otwarty zastępuje zamknięty
  } else {
    K[0] = 2;
    sample([3, 6, 7, 10, 11, 13, 14, 15], 2 + Math.round(d * 3)).forEach((i) => { K[i] = 1; });
    S[4] = 2; S[12] = 2;
    if (r() < 0.3 + 0.5 * d) S[r() < 0.5 ? 9 : 15] = 1;
    if (r() < 0.7) C[12] = 1; if (r() < 0.4) C[4] = 1;
    for (let i = 0; i < DRUM_STEPS; i++) {
      if (i % 2 === 0) H[i] = i % 4 === 0 ? 2 : 1;                              // ósemki, akcent na ćwierćnutach
      else if (r() < 0.1 + 0.5 * d) H[i] = 1;
    }
    [6, 14].forEach((i) => { if (r() < 0.35 + 0.4 * d) { O[i] = 1; H[i] = 0; } });
  }
  return { steps, style, seed };
}

// ---------- brzmienia ----------
const METAL = {
  '808': [205.3, 304.4, 369.6, 522.7, 540.0, 800.0],
  '909': [263.0, 400.0, 421.0, 474.0, 587.0, 845.0],
};

export class DrumKit {
  constructor(ctx, out) {
    this.ctx = ctx; this.out = out; this.open = null;
    const len = ctx.sampleRate, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const cv = new Float32Array(1024); for (let i = 0; i < cv.length; i++) cv[i] = Math.tanh(2.5 * ((i / 1023) * 2 - 1));
    this.curve = cv;
  }
  _gain(t, peak, dec, atk = 0.002) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + atk); g.gain.exponentialRampToValueAtTime(0.0001, t + atk + dec);
    return g;
  }
  _osc(type, f, t, stop) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); o.stop(stop); return o; }
  _noise(t, stop) { const n = this.ctx.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true; n.start(t); n.stop(stop); return n; }
  _bq(type, f, q = 0.7) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }

  // track: 0 stopa, 1 werbel, 2 klaskanie, 3 hat zamknięty, 4 hat otwarty; vel: 1 uderzenie, 2 akcent; P: ustawienia (kit, levels, kt, kd, st, hd)
  trigger(track, t, vel, P) {
    const kit = DRUM_KITS[P.kit] || '808', lv = (P.levels[track] ?? 1) * (vel > 1 ? 1 : 0.8);
    if (lv <= 0.001) return;
    if (track === 0) this._kick(t, lv, kit, P);
    else if (track === 1) this._snare(t, lv, kit, P);
    else if (track === 2) this._clap(t, lv, kit);
    else this._hat(t, lv, kit, P, track === 4);
  }
  _kick(t, lv, kit, P) {
    const c = this.ctx, tune = P.kt, cfg = { '808': [150, 46, 0.09, 0.55], '909': [230, 52, 0.045, 0.34], SYNTH: [125, 40, 0.11, 0.3] }[kit];
    const dec = cfg[3] * P.kd, o = this._osc('sine', cfg[0] * tune, t, t + dec + 0.1);
    o.frequency.exponentialRampToValueAtTime(cfg[1] * tune, t + cfg[2]);
    const g = this._gain(t, 1.0 * lv, dec);
    if (kit === 'SYNTH') { const sh = c.createWaveShaper(); sh.curve = this.curve; o.connect(sh).connect(g); } else o.connect(g);
    g.connect(this.out);
    // składowa o oktawę wyżej, krótsza: stopa słyszalna także na małych głośnikach telefonu (bez niej to głównie podbas poniżej 60 Hz)
    const o2 = this._osc('triangle', cfg[0] * tune * 2, t, t + dec * 0.5 + 0.1);
    o2.frequency.exponentialRampToValueAtTime(cfg[1] * tune * 2, t + cfg[2]);
    o2.connect(this._gain(t, 0.38 * lv, dec * 0.45)).connect(this.out);
    if (kit === '909') {                              // krótki trzask przy uderzeniu
      const n = this._noise(t, t + 0.03), bp = this._bq('bandpass', 2600, 0.8), cg = this._gain(t, 0.35 * lv, 0.012);
      n.connect(bp).connect(cg).connect(this.out);
    }
  }
  _snare(t, lv, kit, P) {
    const c = this.ctx, tune = P.st, out = this.out;
    const cfg = { '808': { f: [180, 330], tdec: 0.13, ndec: 0.22, nf: 1800, nm: 0.7 }, '909': { f: [190, 300], tdec: 0.1, ndec: 0.2, nf: 1500, nm: 0.9 }, SYNTH: { f: [210, 140], tdec: 0.09, ndec: 0.15, nf: 4200, nm: 0.8 } }[kit];
    cfg.f.forEach((f, i) => { const o = this._osc(i === 0 ? 'triangle' : 'sine', f * tune, t, t + cfg.tdec + 0.08); if (kit !== '808') o.frequency.exponentialRampToValueAtTime(f * tune * 0.6, t + cfg.tdec); o.connect(this._gain(t, (i === 0 ? 0.7 : 0.3) * lv, cfg.tdec)).connect(out); });
    const n = this._noise(t, t + cfg.ndec + 0.08), hp = this._bq(kit === 'SYNTH' ? 'bandpass' : 'highpass', cfg.nf, 0.9);
    n.connect(hp).connect(this._gain(t, cfg.nm * lv, cfg.ndec)).connect(out);
  }
  _clap(t, lv, kit) {
    const f = { '808': 1000, '909': 1300, SYNTH: 1900 }[kit], tail = { '808': 0.2, '909': 0.17, SYNTH: 0.11 }[kit];
    const n = this._noise(t, t + tail + 0.1), bp = this._bq('bandpass', f, 0.9), g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    [0, 0.011, 0.023].forEach((dt) => { g.gain.setValueAtTime(0.9 * lv, t + dt); g.gain.exponentialRampToValueAtTime(0.1 * lv, t + dt + 0.009); });
    g.gain.setValueAtTime(0.8 * lv, t + 0.035); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035 + tail);
    n.connect(bp).connect(g).connect(this.out);
  }
  _hat(t, lv, kit, P, open) {
    const c = this.ctx, dec = (open ? 0.38 : 0.055) * P.hd, g = this._gain(t, 0.45 * lv, dec, 0.001);
    if (kit === 'SYNTH') {
      const n = this._noise(t, t + dec + 0.05), hp = this._bq('highpass', 7500, 0.7), bp = this._bq('bandpass', 11000, 0.6);
      n.connect(hp).connect(bp).connect(g);
    } else {
      const sum = c.createGain(); sum.gain.value = 0.17;
      METAL[kit].forEach((f) => this._osc('square', f, t, t + dec + 0.05).connect(sum));
      sum.connect(this._bq('bandpass', 10000, 1.0)).connect(this._bq('highpass', 7000, 0.7)).connect(g);
    }
    g.connect(this.out);
    if (open) { if (this.open) this._choke(this.open, t); this.open = { g, end: t + dec + 0.05 }; }
    else if (this.open) this._choke(this.open, t);   // hat zamknięty ucina otwarty
  }
  _choke(h, t) { if (t < h.end) { h.g.gain.cancelScheduledValues(t); h.g.gain.setTargetAtTime(0.0001, t, 0.006); } this.open = null; }
}
