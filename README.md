# signalthruthenoise

Mobilna aplikacja w przeglądarce do zabawy z electro: sekwencer basu acid (303) z generatorem
wzorów. Sterowanie padem XY i żyroskopem, vocoder z mikrofonu. Na razie tylko sekwencer i bas; perkusja i lead później.

## Uruchomienie
```bash
npm run serve     # http://localhost:8000 (mikrofon/czujniki na telefonie wymagają HTTPS, np. Pages)
npm test          # testy generatora (node:test)
```

## Struktura
- `docs/` – aplikacja (vanilla ES modules, bez buildu); publikowana przez GitHub Pages
  - `js/generator.js` – rytm ważony, skale, mutacje (czysta logika)
  - `js/engines.js` – 4 monofoniczne silniki basu (prophet, ms-20, dx/FM, wavetable) i miks równomocowy dla pada XY
  - `js/audio.js` – Web Audio: zegar z lookahead, rozsyłanie nut do silników, slide, ratchet
  - `js/vocoder.js` – vocoder kanałowy (16 pasm + tor szumu na spółgłoski); modulator = mikrofon, nośnik = bas
  - `js/sensors.js` – żyroskop (przechył → pad XY) i potrząśnięcie (→ mutacja)
  - `js/app.js` – UI; pad XY miksuje silniki (narożniki: prophet, ms-20, dx, wavetable), filtr i gęstość na suwakach
- `scripts/build-preview.mjs` – składa `docs/` w jeden plik HTML (makieta do artefaktu): `node scripts/build-preview.mjs out.html`.
- `tools/` – pierwotny prototyp w Pythonie (eksport MIDI), referencja; nie jest rozwijany.
- `.github/workflows/pages.yml` – testy + deploy `docs/` po wpisie do `main`.

## GitHub Pages
Settings → Pages → Source: **GitHub Actions**. Po merge do `main` aplikacja pojawi się pod
`https://<user>.github.io/signalthruthenoise/`.

## Inspiracje
Zasada: czerpiemy pomysły, nie kopiujemy cudzego kodu. Przed użyciem czegokolwiek z poniższych źródeł
sprawdzamy licencję.

- [aroum/fm1-custom-fw](https://github.com/aroum/fm1-custom-fw) – niestandardowe firmware'y do
  MWave FM1. Zbiór różnych silników syntezy, które mogą się przydać jako pomysły na kolejne brzmienia
  (lead, FM, perkusja). Do przejrzenia przy pracy nad leadem.
- Wtyczka Sting 2.2 (Max for Live) – pomysły na sekwencer: tie, store/recall, kierunki odtwarzania
  fwd/bwd/pend, poly.
