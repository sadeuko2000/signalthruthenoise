// Silniki zewnętrzne (HOWL: Mono, Acid, Wavetable, licencja MIT od autora TAZI) jako głosy radarxxx.
// Moduł HOWL ma własny interfejs (create, note, setParam, silence, out); ten adapter dopasowuje go do tego, czego oczekuje Engine:
// parametry obwiedni radarxxx (fEnv, fDec, aAtk, aDec, aSus, aRel) są mapowane na parametry modułu, a globalne CUTOFF i RESO oraz
// przesunięcia obwiedni z SEQ MAIN działają jako mnożnik i przesunięcie względem ustawień silnika.
// Nie obsługiwane: pitch bend (oscylatory są ukryte w module) i globalny GLIDE (moduł ma własny parametr glide / slide).
import { engines as HOWL_ENGINES } from './external/howl/index.js';

const clampTo = (v, a, b) => Math.max(a, Math.min(b, v));
const GLOBAL_CUTOFF_REF = 600;      // cutoffHz(0.5): wartość globalnego filtra, przy której nie zmieniamy własnego cutoffu silnika

// Konfiguracja każdego silnika: nazwy na ekranie, ukryte parametry modułu (zastąpione obwiedniami radarxxx), mapowanie obwiedni
// i siedem parametrów pokazywanych na zakładce silnika w SYN (kolejność = kolejność pokręteł).
const CFG = {
  'howl-mono': {
    short: 'H.MONO', tab: 'H.MN',
    hide: ['filterEnv', 'fA', 'fD', 'fS', 'fR', 'ampA', 'ampD', 'ampS', 'ampR'],
    alias: { fEnv: ['filterEnv', (v) => clampTo(v / 2.4, 0, 1)], fDec: ['fD', (v) => v], aAtk: ['ampA', (v) => v / 1000], aDec: ['ampD', (v) => v], aSus: ['ampS', (v) => v], aRel: ['ampR', (v) => v / 1000] },
    main: ['cutoff', 'resonance', 'fEnv', 'ring', 'pulseWidth', 'fineB', 'drive'],
  },
  'howl-acid': {
    short: 'H.ACID', tab: 'H.AC',
    hide: ['envMod', 'decay'],
    alias: { fEnv: ['envMod', (v) => clampTo(v / 3, 0, 1)], fDec: ['decay', (v) => v] },
    main: ['cutoff', 'resonance', 'fEnv', 'fDec', 'accent', 'subLevel', 'drive'],
  },
  'howl-wavetable': {
    short: 'H.WAVET', tab: 'H.WT',
    hide: ['filterEnv', 'filterDecay', 'ampA', 'ampD', 'ampS', 'ampR'],
    alias: { fEnv: ['filterEnv', (v) => clampTo(v / 2.4, 0, 1)], fDec: ['filterDecay', (v) => v], aAtk: ['ampA', (v) => v / 1000], aDec: ['ampD', (v) => v], aSus: ['ampS', (v) => v], aRel: ['ampR', (v) => v / 1000] },
    main: ['position', 'position2', 'fold', 'cutoff', 'resonance', 'fEnv', 'level2'],
  },
};
// Krótkie nazwy parametrów na pokrętłach (module mają długie, z jednostkami).
const LABEL = {
  waveA: 'wave a', waveB: 'wave b', levelA: 'lvl a', levelB: 'lvl b', octaveA: 'oct a', octaveB: 'oct b', fineB: 'fine b', sync: 'sync', ring: 'ring',
  pulseWidth: 'pulse', pwmRate: 'pwm hz', pwmDepth: 'pwm amt', filterType: 'ftype', cutoff: 'cutoff', resonance: 'reso', drive: 'drive', glide: 'glide', volume: 'volume',
  waveform: 'wave', subWave: 'sub wav', subOctave: 'sub oct', subLevel: 'sub', accent: 'accent', slideTime: 'slide',
  table: 'table 1', position: 'pos 1', table2: 'table 2', position2: 'pos 2', tune2: 'tune 2', fine2: 'fine 2', level2: 'level 2', fold: 'fold',
};
const ENV_IDS = ['fEnv', 'fDec', 'aAtk', 'aDec', 'aSus', 'aRel'];

// Buduje listę specyfikacji i klas głosów w kolejności modułów HOWL. envSpecs i bip przychodzą z engines.js (bez importu w drugą stronę).
export function buildExternal(envSpecs, bip) {
  const out = { specs: [], voices: [], short: [], tab: [] };
  for (const mod of HOWL_ENGINES) {
    const cfg = CFG[mod.id];
    if (!cfg) continue;
    const own = mod.params.filter((sp) => !cfg.hide.includes(sp.id)).map((sp) => ({ ...sp, label: LABEL[sp.id] || sp.id.toLowerCase() }));
    const env = envSpecs.map((sp) => ({ ...sp }));
    const specs = [...own, ...env];
    const byId = Object.fromEntries(specs.map((sp) => [sp.id, sp]));
    specs.main = cfg.main.filter((id) => byId[id]);
    const innerSpec = Object.fromEntries(mod.params.map((sp) => [sp.id, sp]));

    class ExtVoice {
      // Czy silnik da się uruchomić w tym środowisku (Mono potrzebuje AudioWorklet z adresu blob:, którego część osadzeń, np. strona otwarta z pliku, nie dopuszcza).
      static probe(ctx) { return mod.prepare ? Promise.resolve(mod.prepare(ctx)).then(() => true, () => false) : Promise.resolve(true); }
      constructor(ctx, p) {
        this.ctx = ctx; this.p = p;
        this.inner = mod.create(ctx);
        if (mod.prepare) Promise.resolve(mod.prepare(ctx)).catch(() => {});
        this.out = this.inner.out;
        this.params = Object.fromEntries(specs.map((sp) => [sp.id, sp.def]));
        for (const sp of own) this._push(sp.id);
        this._pushEnv();
      }
      // Wartość dla modułu: globalne CUTOFF (mnożnik) i RESO (przesunięcie) nakładane na własne ustawienie silnika.
      _eff(id) {
        const v = this.params[id], P = this.p || {};
        if (id === 'cutoff' && P.cutoff) { const s = innerSpec.cutoff; return clampTo(v * (P.cutoff / GLOBAL_CUTOFF_REF), s.min, s.max); }
        if (id === 'resonance' && P.res) return clampTo(v + ((P.res - 1) / 22 - 0.5), 0, 1);
        return v;
      }
      _push(id) { if (innerSpec[id]) this.inner.setParam(id, this._eff(id)); }
      // Obwiednie radarxxx z globalnymi przesunięciami (atak i release amp, zanik filtra) przeliczone na parametry modułu.
      _pushEnv() {
        const P = this.p || {};
        for (const [id, [target, conv]] of Object.entries(cfg.alias)) {
          let v = this.params[id];
          if (id === 'aAtk') v = bip(v, P.offAAtk || 0, 0, 40);
          else if (id === 'aRel') v = bip(v, P.offARel || 0, 3, 300);
          else if (id === 'fDec') v = bip(v, P.offFRel || 0, 0.03, 0.8);
          const s = innerSpec[target];
          this.inner.setParam(target, clampTo(conv(v), s.min, s.max));
        }
      }
      setParam(id, v) {
        if (!(id in this.params)) return;
        this.params[id] = v;
        if (ENV_IDS.includes(id)) this._pushEnv(); else this._push(id);
      }
      apply() {}
      refresh() { this._push('cutoff'); this._push('resonance'); }
      note(t, freq, vel, accent, len, slide, hold) { this._pushEnv(); this.inner.note(t, freq, vel, accent, len, slide, hold); }
      silence(t) { this.inner.silence(t); }
    }
    Object.defineProperty(ExtVoice, 'name', { value: `Ext_${mod.id.replace(/\W/g, '_')}` });
    out.specs.push(specs); out.voices.push(ExtVoice); out.short.push(cfg.short); out.tab.push(cfg.tab);
  }
  return out;
}
