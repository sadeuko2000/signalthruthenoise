// Składa stronę radar (docs/radar.html + radar.css + moduły) w jeden plik HTML pod artefakt.
// Użycie: node scripts/build-radar.mjs [wyjście.html]
import { readFileSync, writeFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../docs/${p}`, import.meta.url), 'utf8');
const out = process.argv[2] ?? 'radar-preview.html';

export const RADAR_MODULES = ['electro-model', 'generator', 'vocoder', 'engines', 'fx', 'knob', 'audio', 'radargeo', 'radar'];
const js = RADAR_MODULES
  .map((m) => read(`js/${m}.js`).replace(/^import .*$/gm, '').replace(/^export (async |const |function |class )/gm, '$1'))
  .join('\n');

const html = read('radar.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"')).trim();
// W artefakcie strona jest jednym ekranem: wysokość z rodzica zamiast jednostek dvh.
const css = read('radar.css')
  .replace('height:100dvh;max-width:430px', 'height:100%;max-width:430px')
  .replace('height:clamp(680px,100dvh,745px)', 'height:clamp(680px,100%,745px)');

const page = `<title>radarxxx</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=VT323&display=swap">
<style>
${css}
</style>
${body}
<script>
${js}
</script>
`;
writeFileSync(out, page);
console.log(`zapisano ${out} (${(page.length / 1024).toFixed(1)} kB)`);
