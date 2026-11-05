// Składa docs/ w jeden samodzielny plik HTML (makieta do artefaktu / szybkiego podglądu).
// Użycie: node scripts/build-preview.mjs [wyjście.html]
import { readFileSync, writeFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../docs/${p}`, import.meta.url), 'utf8');
const out = process.argv[2] ?? 'preview.html';

const js = ['generator', 'vocoder', 'engines', 'fx', 'knob', 'audio', 'sensors', 'app']
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
  ['gotowe', 'Skróty klawiszowe (lista pod sekwencerem)'],
  ['gotowe', 'Okrągły pad XY i włączanie od 1 do 4 silników'],
  ['dalej', 'Sekwencery: 2–3 rodzaje, jeden globalny albo do czterech przypisywanych (notatki w repo)'],
  ['gotowe', 'Globalny filtr (4 style) i efekty (4 style), po 8 parametrów, bypass i losowanie'],
  ['gotowe', 'Dłuższe nuty (60–85% kroku zamiast 35–50%), suwaki długości nut i swingu, oversampling saturacji'],
  ['gotowe', 'Obwiednie filtra i amp w każdym silniku (sterowalne i losowane), nasycenie, nowy tor wyjściowy'],
  ['gotowe', 'Potencjometry zamiast suwaków, przełącznik widoku telefon / desktop'],
  ['gotowe', 'Widok telefon: trzy zakładki, duże cele dotykowe, ekran nie gaśnie, instalacja na ekranie głównym'],
  ['później', 'Żyroskop: kod jest, do sprawdzenia na prawdziwym telefonie'],
  ['gotowe', 'Vocoder: bas "mówi" głosem z mikrofonu'],
  ['dalej', 'Dostrojenie brzmienia silników i wzorów po odsłuchu'],
];
const progress = `
<aside id="progress">
  <h2>Postępy</h2>
  <ul>${stages.map(([s, t]) => `<li class="${s}"><b>${s}</b> ${t}</li>`).join('')}</ul>
  <p>Przełącznik „widok” w nagłówku pokazuje układ telefonu i komputera. Żyroskop i mikrofon nie działają w podglądzie, tylko po uruchomieniu aplikacji poza artefaktem.</p>
</aside>`;

const page = `<title>Signal Thru the Noise</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
:root{color-scheme:dark}
${css}
#progress{max-width:1240px;padding:0 16px;margin:8px auto 24px;color:var(--dim);font-size:13px;line-height:1.5}
#progress h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 8px;color:var(--fg)}
#progress ul{list-style:none;padding:0;margin:0 0 8px;display:grid;gap:4px}
#progress b{display:inline-block;min-width:5.5ch;font-size:11px;text-transform:uppercase;color:var(--acc)}
#progress li.gotowe b{color:var(--on)}
#progress li.później b{color:var(--dim)}
html[data-view=phone] #progress{display:none}
</style>
<div id="shell">${body}${progress}</div>
<script>
${js}
</script>
`;
writeFileSync(out, page);
console.log(`zapisano ${out} (${(page.length / 1024).toFixed(1)} kB)`);
