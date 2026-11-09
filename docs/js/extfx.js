// Efekty zewnętrzne (HOWL, licencja MIT od autora TAZI) jako style sekcji FX radarxxx.
// Moduł HOWL ma parametry znormalizowane 0..1 z krzywą (lin, exp, choice) i `apply(wartości, bpm, now)`: dokładnie to, czego używa FxSlot.
// Ten adapter zamienia je na styl o tym samym kształcie co style własne (id, label, def, rand, map, show) i pilnuje, żeby przełączenie stylu
// zatrzymało oscylatory LFO utworzone przez moduł. Ducker pominięty: radarxxx ma własny sidechain sterowany stopą z perkusji.
import { effects as HOWL_EFFECTS } from './external/howl/index.js';

// Krótka nazwa stylu, krótkie podpisy parametrów i parametry, którymi dotyk na radarze steruje (r = promień, a = kąt).
const EFX_CFG = {
  'howl-delay': { name: 'H.DELAY', macro: { r: ['feedback', 'mix'], a: ['sync'] } },
  'howl-reverb': { name: 'H.REVERB', macro: { r: ['size', 'mix'], a: ['tone'] } },
  'howl-flanger': { name: 'H.FLANGE', macro: { r: ['depth', 'mix'], a: ['rate'] } },
  'howl-chorus': { name: 'H.CHORUS', macro: { r: ['depth', 'mix'], a: ['rate'] } },
  'howl-warm-saturation': { name: 'H.SATUR', macro: { r: ['drive', 'mix'], a: ['bias'] } },
  'howl-distortion': { name: 'H.DISTO', macro: { r: ['drive', 'mix'], a: ['type'] } },
  'howl-compressor': { name: 'H.COMP', macro: { r: ['ratio', 'mix'], a: ['threshold'] } },
  'howl-eq3': { name: 'H.EQ3', macro: { r: ['midGain'], a: ['midFreq'] } },
};
const EFX_LABEL = { 'time (free)': 'time', 'pre-delay': 'predelay', asymmetry: 'asym', threshold: 'thresh', 'dry / wet': 'mix', 'make-up': 'makeup', 'low gain': 'lo g', 'high gain': 'hi g', 'low freq': 'lo f', 'high freq': 'hi f', 'mid gain': 'md g', 'mid freq': 'md f', 'mid q': 'md q' };   // EQ: cztery znaki, bo pełna nazwa w przypisaniach to „FX1 ...” (8 znaków)

// Krzywa jak w module (toRealValue w external/howl/index.js): lin, exp albo indeks wyboru.
const efxMap = (sp) => (n) => {
  const x = Math.min(1, Math.max(0, n));
  if (sp.curve === 'exp') return sp.min * Math.pow(sp.max / sp.min, x);
  if (sp.curve === 'choice') return Math.round(x * (sp.choices.length - 1));
  return sp.min + x * (sp.max - sp.min);
};
const efxShow = (sp) => (v) => {
  if (sp.curve === 'choice') return String(sp.choices[Math.round(v)] ?? v);
  const a = Math.abs(v);
  return a >= 1000 ? `${(v / 1000).toFixed(1)}k` : a >= 100 ? `${Math.round(v)}` : a >= 10 ? v.toFixed(1) : v.toFixed(2);
};

// Wykonuje fn (tworzenie efektu) i zbiera utworzone oscylatory, żeby stop() mógł je zatrzymać przy zmianie stylu.
function efxCapture(ctx, fn) {
  const made = [], orig = ctx.createOscillator.bind(ctx);
  ctx.createOscillator = (...a) => { const o = orig(...a); made.push(o); return o; };
  try { return { result: fn(), made }; } finally { delete ctx.createOscillator; }
}

export function buildExternalFx() {
  const styles = [];
  for (const mod of HOWL_EFFECTS) {
    const cfg = EFX_CFG[mod.id];
    if (!cfg) continue;
    const params = mod.params.slice(0, 8).map((sp) => {
      const isMix = sp.id === 'mix';
      return {
        id: sp.id, label: EFX_LABEL[sp.label.toLowerCase()] || sp.label.toLowerCase(),
        def: isMix ? 0 : sp.def, rand: sp.rand, map: efxMap(sp), show: efxShow(sp),     // mix zaczyna od zera: wybranie stylu nie zmienia dźwięku
      };
    });
    const ids = new Set(params.map((p) => p.id));
    styles.push({
      name: cfg.name, params, macro: { r: cfg.macro.r.filter((id) => ids.has(id)), a: cfg.macro.a.filter((id) => ids.has(id)) },
      build(ctx) {
        const { result: fx, made } = efxCapture(ctx, () => mod.create(ctx));
        return {
          input: fx.input, output: fx.output,
          apply: (v, bpm, now) => fx.apply(v, bpm, now),
          stop() { made.forEach((o) => { try { o.stop(); } catch (e) { /* już zatrzymany */ } }); },
        };
      },
    });
  }
  return styles;
}
