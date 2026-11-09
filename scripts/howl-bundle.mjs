// Moduły HOWL (docs/js/external/howl, MIT) mają w każdym pliku te same nazwy najwyższego poziomu (PARAMS, clamp, engine...).
// W pakiecie z jednym skryptem każdy plik trafia więc do osobnej funkcji, a na zewnątrz wychodzą tylko tablice HOWL_ENGINES i HOWL_EFFECTS.
const ENGINES = ['mono', 'acid', 'wavetable'];
const EFFECTS = ['delay', 'reverb', 'flanger', 'chorus', 'saturator', 'distortion', 'compressor', 'eq3', 'ducker'];

export function howlBundle(read) {
  const wrap = (kind, name) => {
    const src = read(`js/external/howl/${kind}s/${name}.js`).replace(/^export const (engine|effect)\b/m, 'const $1');
    return `const HOWL_${kind.toUpperCase()}_${name} = (() => {\n${src}\nreturn ${kind};\n})();`;
  };
  return [
    ...ENGINES.map((n) => wrap('engine', n)), ...EFFECTS.map((n) => wrap('effect', n)),
    `const HOWL_ENGINES = [${ENGINES.map((n) => `HOWL_ENGINE_${n}`).join(', ')}];`,
    `const HOWL_EFFECTS = [${EFFECTS.map((n) => `HOWL_EFFECT_${n}`).join(', ')}];`,
  ].join('\n');
}
