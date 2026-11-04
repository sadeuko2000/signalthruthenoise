# signalthruthenoise

Mobilna aplikacja w przeglądarce do zabawy z electro: sekwencer basu acid (303) z generatorem
wzorów. Plan: żyroskop jako sterowanie parametrami, vocoder z mikrofonu, perkusja i lead.

## Uruchomienie
```bash
npm run serve     # http://localhost:8000 (mikrofon/czujniki na telefonie wymagają HTTPS, np. Pages)
npm test          # testy generatora (node:test)
```

## Struktura
- `docs/` – aplikacja (vanilla ES modules, bez buildu); publikowana przez GitHub Pages
  - `js/generator.js` – rytm ważony, skale, mutacje (czysta logika)
  - `js/audio.js` – Web Audio: bas saw→lowpass z obwiednią, slide, ratchet, kick, zegar z lookahead
  - `js/app.js` – UI
- `tools/` – pierwotny prototyp w Pythonie (eksport MIDI), referencja; nie jest rozwijany.
- `.github/workflows/pages.yml` – testy + deploy `docs/` po wpisie do `main`.

## GitHub Pages
Settings → Pages → Source: **GitHub Actions**. Po merge do `main` aplikacja pojawi się pod
`https://<user>.github.io/signalthruthenoise/`.
