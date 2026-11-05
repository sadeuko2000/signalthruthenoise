import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Makieta (scripts/build-preview.mjs) skleja moduły w jeden skrypt. Zdublowana nazwa najwyższego poziomu
// w dwóch modułach dałaby tam błąd składni, którego nie widać w wersji z modułami.
const MODULES = ['generator', 'vocoder', 'engines', 'fx', 'audio', 'sensors', 'app'];

test('nazwy najwyższego poziomu nie powtarzają się między modułami', () => {
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
