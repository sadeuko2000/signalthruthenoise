// Silniki zewnętrzne (HOWL: Mono, Acid, Wavetable, licencja MIT od autora TAZI) jako głosy radarxxx.
// Moduł HOWL ma własny interfejs (create, note, setParam, silence, out); ten adapter dopasowuje go do tego, czego oczekuje Engine:
// parametry obwiedni radarxxx (fEnv, fDec, aAtk, aDec, aSus, aRel) są mapowane na parametry modułu, a globalne CUTOFF i RESO oraz
// przesunięcia obwiedni z SEQ MAIN działają jako mnożnik i przesunięcie względem ustawień silnika.
// Nie obsługiwane: pitch bend (oscylatory są ukryte w module) i globalny GLIDE (moduł ma własny parametr glide / slide).
import { engines as HOWL_ENGINES } from './external/howl/index.js';

const clampTo = (v, a, b) => Math.max(a, Math.min(b, v));
const GLOBAL_CUTOFF_REF = 600;      // cutoffHz(0.5): wartość globalnego filtra, przy której nie zmieniamy własnego cutoffu silnika

// Konfiguracja każdego silnika: nazwy na ekranie, mapowanie obwiedni radarxxx (fEnv, fDec, aAtk, aDec, aSus, aRel) na parametry modułu,
// parametry, na które działają globalne przesunięcia obwiedni z SEQ MAIN, oraz strony pokręteł na zakładce silnika w SYN (po sześć na stronę, każdy
// parametr modułu jest na jakiejś stronie). alias[id] = [parametr modułu, przeliczenie z jednostek radarxxx, przeliczenie odwrotne].
const unit = (v) => v;
const msToS = [(v) => v / 1000, (v) => v * 1000];
const CFG = {
  'howl-mono': {
    short: 'H.MONO', tab: 'H.MN',
    alias: { fEnv: ['filterEnv', (v) => clampTo(v / 2.4, -1, 1), (v) => v * 2.4], fDec: ['fD', unit, unit], aAtk: ['ampA', ...msToS], aDec: ['ampD', unit, unit], aSus: ['ampS', unit, unit], aRel: ['ampR', ...msToS] },
    off: { aAtk: ['ampA', 0, 0.04], aRel: ['ampR', 0.003, 0.3], fDec: ['fD', 0.03, 0.8], fAtk: ['fA', 0, 0.15] },
    pages: [
      ['cutoff', 'resonance', 'filterEnv', 'fD', 'drive', 'volume'],
      ['waveA', 'levelA', 'octaveA', 'waveB', 'levelB', 'octaveB'],
      ['fineB', 'sync', 'ring', 'pulseWidth', 'pwmRate', 'pwmDepth'],
      ['filterType', 'fA', 'fS', 'fR', 'glide', 'ampA'],
      ['ampD', 'ampS', 'ampR'],
    ],
  },
  'howl-acid': {
    short: 'H.ACID', tab: 'H.AC',
    alias: { fEnv: ['envMod', (v) => clampTo(v / 3, 0, 1), (v) => v * 3], fDec: ['decay', unit, unit] },
    off: { fDec: ['decay', 0.05, 1.2] },
    pages: [
      ['cutoff', 'resonance', 'envMod', 'decay', 'accent', 'drive'],
      ['waveform', 'pulseWidth', 'subWave', 'subOctave', 'subLevel', 'slideTime'],
      ['volume'],
    ],
  },
  'howl-wavetable': {
    short: 'H.WAVET', tab: 'H.WT',
    alias: { fEnv: ['filterEnv', (v) => clampTo(v / 2.4, -1, 1), (v) => v * 2.4], fDec: ['filterDecay', unit, unit], aAtk: ['ampA', ...msToS], aDec: ['ampD', unit, unit], aSus: ['ampS', unit, unit], aRel: ['ampR', ...msToS] },
    off: { aAtk: ['ampA', 0, 0.04], aRel: ['ampR', 0.003, 0.3], fDec: ['filterDecay', 0.03, 0.8] },
    pages: [
      ['cutoff', 'resonance', 'filterEnv', 'filterDecay', 'fold', 'volume'],
      ['table', 'position', 'table2', 'position2', 'tune2', 'fine2'],
      ['level2', 'ampA', 'ampD', 'ampS', 'ampR', 'glide'],
    ],
  },
};
// Krótkie nazwy parametrów na pokrętłach (module mają długie, z jednostkami).
const LABEL = {
  waveA: 'wave a', waveB: 'wave b', levelA: 'lvl a', levelB: 'lvl b', octaveA: 'oct a', octaveB: 'oct b', fineB: 'fine b', sync: 'sync', ring: 'ring',
  pulseWidth: 'pulse', pwmRate: 'pwm hz', pwmDepth: 'pwm amt', filterType: 'ftype', cutoff: 'cutoff', resonance: 'reso', drive: 'drive', glide: 'glide', volume: 'volume',
  waveform: 'wave', subWave: 'sub wav', subOctave: 'sub oct', subLevel: 'sub', accent: 'accent', slideTime: 'slide', envMod: 'env mod', decay: 'decay',
  table: 'table 1', position: 'pos 1', table2: 'table 2', position2: 'pos 2', tune2: 'tune 2', fine2: 'fine 2', level2: 'level 2', fold: 'fold',
  filterEnv: 'f.env', fA: 'f.atk', fD: 'f.dec', fS: 'f.sus', fR: 'f.rel', filterDecay: 'f.dec', ampA: 'a.atk', ampD: 'a.dec', ampS: 'a.sus', ampR: 'a.rel',
};
const ENV_IDS = ['fEnv', 'fDec', 'aAtk', 'aDec', 'aSus', 'aRel'];

export function buildExternal(envSpecs, bip) {
  const out = { specs: [], voices: [], short: [], tab: [] };
  for (const mod of HOWL_ENGINES) {
    const cfg = CFG[mod.id];
    if (!cfg) continue;
    // Wszystkie parametry modułu jako własne parametry silnika, a obwiednie radarxxx jako parametry „wirtualne” (oznaczone, nie losowane):
    // ustawienie wirtualnego zapisuje przeliczoną wartość do odpowiedniego parametru modułu, odczyt przelicza z powrotem.
    const own = mod.params.map((sp) => ({ ...sp, label: LABEL[sp.id] || sp.id.toLowerCase() }));
    const virt = envSpecs.map((sp) => ({ ...sp, virtual: true }));
    const specs = [...own, ...virt];
    specs.pages = cfg.pages;
    const raw = Object.fromEntries(mod.params.map((sp) => [sp.id, sp]));
    const offTargets = Object.values(cfg.off).map(([id]) => id);

    class ExtVoice {
      // Czy silnik da się uruchomić w tym środowisku (Mono potrzebuje AudioWorklet z adresu blob:, którego część osadzeń, np. strona otwarta z pliku, nie dopuszcza).
      static probe(ctx) { return mod.prepare ? Promise.resolve(mod.prepare(ctx)).then(() => true, () => false) : Promise.resolve(true); }
      constructor(ctx, p) {
        this.ctx = ctx; this.p = p; this._v = Object.fromEntries(envSpecs.map((sp) => [sp.id, sp.def]));
        this.inner = mod.create(ctx);
        if (mod.prepare) Promise.resolve(mod.prepare(ctx)).catch(() => {});
        this.out = this.inner.out;
        this.params = Object.fromEntries(own.map((sp) => [sp.id, sp.def]));
        for (const id of ENV_IDS) {            // parametry wirtualne: widoczne po id, ale niewyliczane przy zapisie (nieenumerowalne)
          Object.defineProperty(this.params, id, {
            enumerable: false, configurable: true,
            get: () => { const a = cfg.alias[id]; if (!a) return this._v[id]; const sp = envSpecs.find((x) => x.id === id); return clampTo(a[2](this.params[a[0]]), sp.min, sp.max); },
            set: () => {},
          });
        }
        for (const sp of own) this._push(sp.id);
      }
      // Wartość dla modułu: globalne CUTOFF (mnożnik) i RESO (przesunięcie) oraz przesunięcia obwiedni z SEQ MAIN nałożone na własne ustawienie silnika.
      _eff(id) {
        const v = this.params[id], P = this.p || {};
        if (id === 'cutoff' && P.cutoff) return clampTo(v * (P.cutoff / GLOBAL_CUTOFF_REF), raw.cutoff.min, raw.cutoff.max);
        if (id === 'resonance' && P.res) return clampTo(v + ((P.res - 1) / 22 - 0.5), 0, 1);
        for (const [k, [target, lo, hi]] of Object.entries(cfg.off)) {
          if (target !== id) continue;
          const off = P[{ aAtk: 'offAAtk', aRel: 'offARel', fDec: 'offFRel', fAtk: 'offFAtk' }[k]] || 0;
          return off ? clampTo(bip(v, off, Math.min(lo, v), Math.max(hi, v)), raw[id].min, raw[id].max) : v;
        }
        return v;
      }
      _push(id) { if (raw[id]) this.inner.setParam(id, this._eff(id)); }
      setParam(id, v) {
        const a = cfg.alias[id];
        if (a && ENV_IDS.includes(id)) { this.params[a[0]] = clampTo(a[1](v), raw[a[0]].min, raw[a[0]].max); this._push(a[0]); return; }
        if (ENV_IDS.includes(id)) { this._v[id] = v; return; }
        if (!(id in this.params)) return;
        this.params[id] = v; this._push(id);
      }
      apply() {}
      refresh() { this._push('cutoff'); this._push('resonance'); }
      note(t, freq, vel, accent, len, slide, hold) { for (const id of offTargets) this._push(id); this.inner.note(t, freq, vel, accent, len, slide, hold); }
      silence(t) { this.inner.silence(t); }
    }
    Object.defineProperty(ExtVoice, 'name', { value: `Ext_${mod.id.replace(/\W/g, '_')}` });
    out.specs.push(specs); out.voices.push(ExtVoice); out.short.push(cfg.short); out.tab.push(cfg.tab);
  }
  return out;
}
