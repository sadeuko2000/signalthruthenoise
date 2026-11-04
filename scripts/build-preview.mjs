// Składa docs/ w jeden samodzielny plik HTML (makieta do artefaktu / szybkiego podglądu).
// Użycie: node scripts/build-preview.mjs [wyjście.html]
import { readFileSync, writeFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../docs/${p}`, import.meta.url), 'utf8');
const out = process.argv[2] ?? 'preview.html';

const js = ['generator', 'vocoder', 'engines', 'audio', 'sensors', 'app']
  .map((m) => read(`js/${m}.js`)
    .replace(/^import .*$/gm, '')
    .replace(/^export (async |const |function |class )/gm, '$1'))
  .join('\n');

const html = read('index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"')).trim();
const css = read('style.css');

const stages = [
  ['gotowe', 'Bas acid: generator, sekwencer 16 kroków'],
  ['gotowe', 'Bas z 4 silników (prophet, ms-20, dx, wavetable) miksowanych padem XY'],
  ['gotowe', 'Układ na komputer: sekwencer po lewej, pad i karty silników po prawej'],
  ['gotowe', 'Karty silników: głośność, solo, parametry i losowanie w granicach electro'],
  ['później', 'Żyroskop i interfejs mobilny (kod jest, nie rozwijamy go teraz)'],
  ['gotowe', 'Vocoder: bas "mówi" głosem z mikrofonu'],
  ['dalej', 'Dostrojenie brzmienia silników i wzorów po odsłuchu'],
];
const progress = `
<aside id="progress">
  <h2>Postępy</h2>
  <ul>${stages.map(([s, t]) => `<li class="${s}"><b>${s}</b> ${t}</li>`).join('')}</ul>
  <p>Makieta jest zrobiona pod komputer. Żyroskop i mikrofon nie działają w podglądzie, tylko po uruchomieniu aplikacji poza artefaktem.</p>
</aside>`;

const page = `<title>Signal Thru the Noise</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
:root{color-scheme:dark}
body{padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
${css}
main{padding-left:0;padding-right:0}
#progress{max-width:1240px;padding:0 16px;margin:8px auto 24px;color:var(--dim);font-size:13px;line-height:1.5}
#progress h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 8px;color:var(--fg)}
#progress ul{list-style:none;padding:0;margin:0 0 8px;display:grid;gap:4px}
#progress b{display:inline-block;min-width:5.5ch;font-size:11px;text-transform:uppercase;color:var(--acc)}
#progress li.gotowe b{color:var(--on)}
#progress li.później b{color:var(--dim)}
html,body{height:auto;min-height:100%}
</style>
<div id="shell">${body}${progress}</div>
<script>
${js}
</script>
`;
writeFileSync(out, page);
console.log(`zapisano ${out} (${(page.length / 1024).toFixed(1)} kB)`);
