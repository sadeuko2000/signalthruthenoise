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
**Wygląd: wariant „Specimen”** (wybrany spośród czterech propozycji): szary papier `#a6abad`, czarny druk `#0b0b0b`, pomarańczowy akcent `#ff4b1f`,
pikselowy krój VT323 (Google Fonts). Struktura ekranu wzorowana na Ableton Note: tytuł, pasek zakładek SEQ / MIX / FX na całą szerokość,
ekran radarowy, cienki pasek przeglądu wzoru (kroki w poziomie, wysokość w pionie), pokrętła z **samą nazwą nad pokrętłem, bez liczb**,
przyciski kontekstowe jako komórki rozdzielone linią (aktywny = odwrócony). Pomarańcz tylko na grafice i akcentach (na szarości ma kontrast ok. 2:1, więc nie na małym tekście).

Osobna strona `docs/radar.html` (jeden układ jak aplikacja na telefon, na komputerze wyśrodkowany, proporcje zablokowane jak na telefonie) (wersja do artefaktu: `node scripts/build-radar.mjs out.html`), ten sam silnik dźwięku, inny interfejs
zainspirowany radarem morskim:
- **SEQ:** przemiatająca linia to głowica odtwarzania (jedno okrążenie = jeden obieg wzoru), nuty to echa na obwodzie
  (kąt = krok, odległość od środka = wysokość dźwięku), które gasną jak luminofor. Dotknięcie dodaje echo, przeciągnięcie je przesuwa,
  dotknięcie istniejącego usuwa. Przyciski kontekstowe: BASE (nuta bazowa, tap = +1 półton, przytrzymanie = −1), OKTAWA (tap = w górę, przytrzymanie = w dół),
  KEY (elektro / frygijska / moll), RANDOM, MUTATE. Zmiana nuty bazowej, oktawy i tonacji nie kasuje wzoru.
- **MIX:** cztery silniki jako cele na obwodzie, krzyżyk to punkt miksu; wzór blado w tle.
- Wszystkie trzy strony (SEQ, MIX, FX) rysują na tym samym ekranie, w tym samym miejscu i rozmiarze, z jedną wspólną przemiatającą linią (tempo skanowania wynika z BPM i długości wzoru).
- Tempo: mały napis „xxx BPM” w nagłówku, po dotknięciu okienko z dużą wartością i przyciskami −5 / − / + / +5.
- **FX:** filtr i efekty (4 style po 8 parametrów), jedna sekcja naraz (przycisk SEKCJA). Dotyk w ekran to makro: jeden punkt (odległość od środka = intensywność, kąt = charakter) ustawia naraz kilka parametrów filtra i efektu (np. cutoff + rezonans oraz feedback + mix + czas delaya; mix efektu rośnie od środka ku brzegowi). Przycisk STEROW. przełącza, czym steruje ekran: oba, tylko filtr, tylko efekt. Nuty ze wzoru przechodzą przez filtr (maska pasma), a potem przez efekt (kopie delaya, fale pogłosu, podwojenie chorusa, spłaszczenie dystorsji).
- Pokrętła **ACCENT** (ile mocnych nut dostaje akcent) i **SLIDE** (ile ślizgów między sąsiednimi nutami o różnej wysokości) działają na żywo na wzorze, bez generowania go od nowa; RANDOM i edycja je zachowują.
- Wzór generuje przycisk RANDOM (losowa gęstość i synkopa w rozsądnych granicach). SWING, KEY, BASE i OKTAWA zmieniają tylko rytm, tonację i wysokość toniki, nie kasują nut.
- Dolny rząd przycisków kontekstowych zmienia się zależnie od strony. Geometria jest w `docs/js/radargeo.js` (testowana).

## Generator uczony z pętli MIDI
Domyślny generator (`style: 'electro'` w `docs/js/generator.js`) korzysta z modelu `docs/js/electro-model.js`, nauczonego z 50 pętli basu electro:
- **rytm:** łańcuch Markowa po 16 krokach (prawdopodobieństwo nuty zależy od pozycji w takcie i od tego, czy poprzedni krok grał),
  `density` przesuwa gęstość (0,5 = średnia z pętli, ok. 8,7 nuty na takt), `syncopation` przenosi nuty z mocnych kroków na słabe;
- **wysokości:** mała paleta na wzór (1-5 dźwięków: tonika, półton nad nią, rzadziej ♭3, kwarta, ♭7, oktawa), nuta powtarza się ok. połowy razy;
  skala `electro` (półtony 0, 1, 3, 5, 6, 10, 11);
- **długości:** nuty długie (średnio ok. 0,85 kroku), zależne od odstępu do następnej nuty; **głośność:** większość mocna, ok. 10% cichych nut.
Wzory poprzedniego generatora nadal dostępne jako `style: 'classic'`.

Do repo trafiają **tylko zagregowane statystyki** (tablice prawdopodobieństw, ok. 2 kB), nie same pętle. Źródłowe pliki MIDI nie są częścią repo
(`.gitignore`), bo pakiety loopów mają własne licencje. Ponowne uczenie z własnego katalogu z plikami `NNN_<bpm>_..._<TONACJA>_....mid`:
```bash
python3 -I tools/learn/learn_model.py <katalog_z_mid> docs/js/electro-model.js
```

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
