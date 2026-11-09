import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Pakiety (scripts/build-preview.mjs, scripts/build-radar.mjs) skleja moduły w jeden skrypt. Zdublowana nazwa najwyższego poziomu
// w dwóch modułach dałaby tam błąd składni, którego nie widać w wersji z modułami.
const BUNDLES = {
  app: ['electro-model', 'generator', 'vocoder', 'extvoices', 'engines', 'drums', 'extfx', 'fx', 'knob', 'audio', 'sensors', 'app'],
  radar: ['electro-model', 'generator', 'vocoder', 'extvoices', 'engines', 'drums', 'extfx', 'fx', 'knob', 'audio', 'radargeo', 'radar'],
};

for (const [bundle, MODULES] of Object.entries(BUNDLES)) {
  test(`pakiet ${bundle}: nazwy najwyższego poziomu nie powtarzają się między modułami`, () => {
    const seen = {};
    for (const m of MODULES) {
      const src = readFileSync(new URL(`../docs/js/${m}.js`, import.meta.url), 'utf8');
      for (const mt of src.matchAll(/^(?:export\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
        (seen[mt[1]] ||= []).push(m);
      }
    }
    const dups = Object.entries(seen).filter(([, v]) => v.length > 1).map(([k, v]) => `${k}: ${v.join(', ')}`);
    assert.deepEqual(dups, []);
  });
}

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync as rd } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
test('pakiety (radar i podgląd) kompilują się jako jeden skrypt razem z modułami HOWL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'radar-build-'));
  for (const script of ['build-radar.mjs', 'build-preview.mjs']) {
    const out = join(dir, `${script}.html`);
    execFileSync(process.execPath, [new URL(`../scripts/${script}`, import.meta.url).pathname, out], { stdio: 'pipe' });
    const html = rd(out, 'utf8'), i = html.lastIndexOf('<script>'), j = html.lastIndexOf('</script>');
    assert.doesNotThrow(() => new vm.Script(html.slice(i + 8, j)), `${script}: błąd składni w pakiecie`);
  }
});
