# signalthruthenoise

Mobilna aplikacja w przeglądarce do zabawy z electro: sekwencer basu acid (303) z generatorem
wzorów. Sterowanie padem XY i żyroskopem, vocoder z mikrofonu. Na razie tylko sekwencer i bas; perkusja i lead później.

Plan rozwoju i otwarte pytania: [NOTATKI.md](NOTATKI.md).

## Uruchomienie
```bash
npm run serve     # http://localhost:8000 (mikrofon/czujniki na telefonie wymagają HTTPS, np. Pages)
npm test          # testy generatora (node:test)
```

## Widoki: telefon i desktop
Przycisk „widok” w nagłówku przełącza układ (wybór jest zapamiętywany; domyślnie telefon wykrywany po dotyku i szerokości ekranu).
- **Telefon:** jeden ekran na zakładkę (sekwencer / brzmienie / efekty), kroki w siatce 4×4, duże pokrętła i przyciski (min. 44 px),
  jedna karta silnika lub sekcji naraz (wybór u góry), ekran nie gaśnie podczas grania. Na telefonie można „dodać do ekranu głównego”
  (manifest + ikony), wtedy aplikacja działa pełnoekranowo.
- **Desktop:** sekwencer po lewej, pad, silniki, filtr i efekty po prawej; skróty klawiszowe.

## radarxxx: interfejs radarowy
Osobna strona `docs/radar.html` (jeden układ jak aplikacja na telefon, na komputerze wyśrodkowany) (wersja do artefaktu: `node scripts/build-radar.mjs out.html`), ten sam silnik dźwięku, inny interfejs
zainspirowany radarem morskim:
- **SEQ:** przemiatająca linia to głowica odtwarzania (jedno okrążenie = jeden obieg wzoru), nuty to echa na obwodzie
  (kąt = krok, odległość od środka = wysokość dźwięku), które gasną jak luminofor. Dotknięcie dodaje echo, przeciągnięcie je przesuwa,
  dotknięcie istniejącego usuwa. Przycisk HDG MODE przełącza N-UP (linia się obraca) i H-UP (linia stoi, obraca się wzór).
- **MIX:** cztery silniki jako cele na obwodzie, krzyżyk to punkt miksu.
- **FX:** filtr i efekty (4 style po 8 parametrów).
- Wzór generuje przycisk RANDOM (losowa gęstość i synkopa w rozsądnych granicach). SWING, KEY i RANGE zmieniają tylko rytm, tonację i długość, nie kasują nut.
- Dolny rząd przycisków kontekstowych zmienia się zależnie od strony. Geometria jest w `docs/js/radargeo.js` (testowana).

## Skróty klawiszowe
`spacja` play/stop · `R` losuj wzór · `M` mutuj · `T` moll/frygijska · `↑` `↓` BPM ±2 ·
`1`–`4` solo silnika (z `shift` losuje jego parametry). Definicje są w tablicy `KEYS` w `docs/js/app.js`.

## Struktura
- `docs/` – aplikacja (vanilla ES modules, bez buildu); publikowana przez GitHub Pages
  - `js/generator.js` – rytm ważony, skale, mutacje (czysta logika)
  - `js/engines.js` – 4 monofoniczne silniki basu (prophet, ms-20, dx/FM, wavetable), ich parametry i obwiednie filtra/amp (`PARAM_SPECS`), losowanie w granicach rozsądku i miks równomocowy dla pada XY
  - `js/fx.js` – globalny filtr i efekty: 4 style + 4 style, po 8 parametrów (`FILTER_STYLES`, `FX_STYLES`), losowanie w granicach rozsądku
  - `js/knob.js` – potencjometr obrotowy (SVG): przeciąganie w pionie, podwójne dotknięcie = reset, kółko, klawiatura
  - `js/audio.js` – Web Audio: zegar z lookahead, rozsyłanie nut do silników, slide, ratchet
  - `js/vocoder.js` – vocoder kanałowy (16 pasm + tor szumu na spółgłoski); modulator = mikrofon, nośnik = bas
  - `js/sensors.js` – żyroskop (przechył → pad XY) i potrząśnięcie (→ mutacja)
  - `js/app.js` – UI; okrągły pad XY miksuje silniki (kotwice na 45°: prophet, ms-20, dx, wavetable), filtr i gęstość na suwakach
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
