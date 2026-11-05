# Notatki projektowe

Plan rozwoju, spisany z ustaleń. Kod tylko inspirowany cudzymi pomysłami, nie kopiowany (patrz README, „Inspiracje”).

## 1. Syntezatory: od 1 do 4 równolegle
- Do czterech monofonicznych silników gra jednocześnie ten sam sygnał nutowy.
- Użytkownik wybiera, ile silników jest aktywnych (od 1 do 4); wyłączony silnik nie bierze udziału w miksie i nie obciąża CPU.
- Miks ustawia **okrągły pad XY**: cztery silniki na obwodzie koła, środek to miks po równo.
- Stan: **zrobione** (silniki prophet, ms-20, dx, wavetable; pad okrągły; przełączniki włącz/wyłącz).
- Do zrobienia: wybór innych silników do każdego miejsca na padzie.

## 2. Sekwencery: 2–3 rodzaje
Nazwy jako punkt odniesienia, bez kopiowania działania:
- **Behringer BQ-10** i **Behringer 1601 Sequencer System**: do sprawdzenia, jakie mają funkcje. W tej sesji nie zweryfikowano ich specyfikacji, więc nie zakładamy niczego ponad to, że chodzi o analogowe, krokowe sekwencery z ręcznym ustawianiem wysokości.
- **Trzeci, nowoczesny**: propozycja do ustalenia, np. euklidowy, probabilistyczny albo z parametrami per krok.
- Obecny sekwencer (16 kroków, gate, tie, ratchet, generator z rytmem ważonym) to punkt wyjścia dla pierwszego rodzaju.
- Stan: **do zrobienia**. Najpierw trzeba uzgodnić, jak każdy rodzaj wygląda i czym się różni.

## 3. Jeden globalny sekwencer albo do czterech osobnych
- Tryb prosty: jeden sekwencer steruje wszystkimi silnikami.
- Tryb rozszerzony: do czterech sekwencerów, każdy dowolnie przypisany do jednego lub kilku silników (macierz przypisań 4×4).
- Stan: **do zrobienia**. Wymaga przerobienia silnika audio tak, żeby nuty trafiały do wybranych silników, a nie do wszystkich naraz.

## 4. Globalne efekty i filtr
- Sekcja globalna na wyjściu po miksie silników: **filtr -> efekt -> wyjście**. Każda z dwóch kart ma bypass, 4 style (zakładki), 8 parametrów (z odczytem wartości) i losowanie w granicach rozsądku.
- Przyjęta interpretacja: cztery style filtra i, osobno, cztery style efektu (jeden aktywny w każdej karcie, ustawienia zapamiętane per styl). Wybór stylów to robocza propozycja do zmiany.
- **Filtr:** drabinkowy (24 dB, lfo), wielomodowy (LP→BP→HP), ms-20 (HP+LP, ostry drive), grzebień (feedback, lfo na czasie).
- **Efekt:** delay (ping-pong, zsynchronizowany z BPM), pogłos (generowana odpowiedź impulsowa), chorus/flanger, dystorsja (od miękkiej do fold, bitcrush).
- Efekty domyślnie mają mix = 0, a filtry są prawie otwarte i neutralne głośnościowo, więc po włączeniu nic nie zmieniają, dopóki się ich nie ruszy.
- Stan: **zrobione** (`docs/js/fx.js`). Do zrobienia: presety, podpięcie żyroskopu/pada do parametrów filtra.

## 5. Interfejs
- Potencjometry zamiast suwaków; dwa widoki (telefon / desktop) z przełącznikiem. **Zrobione.**
- Telefon: zakładki sekwencer / brzmienie / efekty, kroki 4×4, jedna karta silnika lub sekcji naraz.
- Do sprawdzenia na prawdziwym telefonie: wielkość pokręteł i pada, wygoda przewijania, żyroskop, tryb poziomy (orientacja pozioma nie ma osobnego układu).

## 6. radarxxx (interfejs radarowy)
- Inspiracja: radary morskie (okrągły ekran, pierścienie zakresu, przemiatająca linia, echa, przyciski kontekstowe na dole).
- Zrobione jako **osobna strona** (`docs/radar.html`) na tym samym silniku: sekwencer radarowy, miks silników z krzyżykiem, strona FX.
- Do rozstrzygnięcia: czy radar zastępuje siatkę kroków w głównej aplikacji, czy zostaje jako osobny tryb (pasuje jako „nowoczesny” rodzaj sekwencera z punktu 2).
- Pomysły na później: ślady (trails) powiązane z feedbackiem delaya, marker odległości (VRM) i linia namiaru (EBL) sterujące filtrem, cele z wektorami dla silników.

## 7. Generator uczony z pętli
- Generator uczony z 50 pętli basu electro (rytm Markowa, mała paleta wysokości, długie nuty, ghost notes). Do repo trafiają tylko statystyki, nie pętle.
- Zweryfikowano: statystyki wygenerowanych wzorów są bliskie źródłowym (nut na takt, udział toniki, długości, ciche nuty), a generator nie odtwarza dosłownie żadnego taktu z pętli.
- Pomysły na później: osobny model na kilka stylów (np. wiele pętli ≥ 2 taktów, „ewolucja” wzoru po kilku obiegach), akcent i slide jako osobne pokrętła, import własnego pliku MIDI do sekwencera.

## 8. Wygląd radarxxx
- Wybrany wariant A „Specimen” z czterech propozycji (kolory i pismo ze zdjęcia, układ jak Ableton Note, pokrętła bez wartości). Pozostałe warianty (B negatyw, C siatka pikseli, D pomarańczowa tarcza) zostają jako opcje.
- Do ustalenia: krój Tronica Mono (wymaga pliku i licencji; na razie VT323), ewentualne wartości na pokrętłach na czas przeciągania (nie dodane).

## Otwarte pytania
1. Czy wybrane style filtra i efektów (patrz punkt 4) są właściwe, czy zmienić któryś.
2. Czy wszystkie sekwencery mają tę samą siatkę 16 kroków, czy każdy własną długość.
3. Co dzieje się z żyroskopem i interfejsem mobilnym (odłożone na później).
4. Perkusja i lead (odłożone na później).

## 9. radarxxx: nowy układ (wersja z zakładkami)

- Pod radarem: pasek pod-zakładek, siatka 5×2 pokręteł i przycisków (ostatnie miejsce to zwykle RANDOM), na dole ← → (cofnij/ponów), duże kółko REC (na razie tylko komunikat), SAVE (preset do localStorage), MENU (presety, MIDI i nagrania w przygotowaniu).
- Cztery kropki w rogach radaru to przyciski zależne od strony. SEQ: RANDOM, MUTATE (losuje ustawienia syntezatorów), LATCH (nuty trzymają się do następnej), WARP (kolejno: obrót o krok, odbicie wysokości, wspak). MIX: skok pada do silnika. SYN: wybór silnika (pasek = udział w miksie). FX: bypass filtra, bypass efektu, STEROW., STYLE.
- Zakładki: SEQ (MAIN, SEQ, SCALE, EXTRA), MIX (MAIN i po jednej na silnik), SYN (MAIN = makra na wszystkie silniki, potem silniki), FX (MAIN, FLT, FX).
- Obsada pokręteł to propozycja z dokumentu „Obsada pokręteł”; można ją zmieniać w `renderPanel()` w `docs/js/radar.js`.
- Dopisane w silniku: master, kompresja i drive wyjściowy, oktawa/strojenie/EQ każdego silnika, glide, velo, human, ghost, latch.
- Dopasowanie do szkicu z Figmy: zakładki FX to MAIN, FLT, FX1, FX2, MSTR (drugi efekt w łańcuchu, MSTR = master, kompresja, drive), widok silnika w SYN ma komórkę MODEL po lewej i 4×2 pokrętła, domyślna kolejność silników MS20, PROPHET, DX, WAVE.
- SEQ MAIN: CUTOFF, RESO, F.ATK, F.REL, A.ATK, A.REL (globalne przesunięcia obwiedni -100%…+100% względem ustawień każdego silnika, `engine.p.off*` i `Voice.effParam`), GATE, ACCENT, SHIFT, OKTAWA. EXTRA: TEMPO, LENGTH, SWING, HUMAN, GHOST, SLIDE, GLIDE, VELO, RANDOM. Atak filtra to nowa rzecz: 0 = zryw od razu, +100% = 150 ms narastania (DX go nie używa).
- Tryb CONTROLLER (przełącznik MODE:ENCODER / MODE:CONTROLLER nad siatką pokręteł, na zakładkach MAIN oraz silników MIX i SYN): zamiast pokręteł dwa boksy, każdy to XY PAD (oś X dwa parametry, oś Y dwa), 4 PRZYCISKI (przełączniki i akcje), 4 SUWAKI albo PITCH + MOD. EDIT otwiera okienko wyboru typów i przypisań (zapis w localStorage i w presetach). Pitch bend to ±2 półtony przez wspólne źródło stałe podłączone do detune wszystkich oscylatorów.
- ROUTING efektów (strona FX, wiersz nad pokrętłami): kolejność szeregowa FLT, FX1, FX2 w dowolnej permutacji (`GlobalFx.route`). Dotknięcie napisu przełącza kolejne układy, EDIT otwiera okienko z trzema miejscami. Kolejność trafia do presetów i UNDO. Radar rysuje nadal filtr przed efektami niezależnie od ustawionej kolejności.
- MSTR (strona FX, ostatnia zakładka): MASTER, COMP, DRIVE oraz efekty na sumie (`Engine._buildMasterFx`): DJ FLT (jedna gałka, lewo = dolnoprzepustowy, prawo = górnoprzepustowy), TAPE (nasycenie, ciemniejsza góra, szum), WOW (wahanie wysokości), CHORUS (mix) i pionowy suwak REPEAT (beat repeat: pętla ostatniego kawałka dźwięku o długości 1/2…1/32 zależnej od wysokości suwaka, chwilowy, puszczenie wyłącza). Wszystkie te cele są też dostępne w oknie EDIT kontrolerów.
