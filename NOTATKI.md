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
- Kontrolery są teraz ostatnią zakładką CTRL w każdej sekcji (SEQ, MIX, SYN, FX) zamiast przełącznika MODE nad pokrętłami. Na zakładce CTRL napis MODE:CONTROLLER wraca na MAIN, EDIT otwiera przypisania.
- CTRL dotyczy tylko parametrów danej sekcji: każda strona ma własną listę parametrów (`SECTION_CONT`), własne przełączniki (`SECTION_SW`) i własne ustawienia kontrolerów (zapis w localStorage v2 i w presetach). Okno EDIT pokazuje tylko to, co należy do sekcji.
- CTRL w SEQ obejmuje wszystko z zakładek MAIN, SEQ, SCALE i EXTRA (m.in. shift, oktawa, długość, base i key jako przyciski, double, half, clear). W MIX doszły oktawa i EQ każdego silnika oraz zmiana typu, w FX wszystkie osiem parametrów filtra i obu efektów (nazwy zależą od stylu). Przycisk RANDOM w wierszu CTRL losuje przypisania (pad XY, przyciski, suwaki, modulation) wyłącznie z parametrów danej sekcji.
- Przypisywalne zakładki (SEQ MAIN, SEQ EXTRA, MIX MAIN, SYN MAIN, FX MAIN): dziesięć miejsc, każde ma przypisany parametr albo przycisk z listy sekcji. MODE:ENCODER / MODE:SLIDER przełącza 10 pokręteł i 10 suwaków (FX: przełącznik w oknie EDIT). EDIT otwiera okienko z przypisaniami i przyciskiem DEFAULT (ustawienia początkowe), a tekst RANDOM pod siatką losuje przypisania. Ustawienia zapisują się w localStorage i w presetach, a pokrętła odświeżają się, gdy wartość zmienia się gdzie indziej (np. na radarze).

## 10. Pomysły na później

- **Presety jako kod QR.** Preset (wzór, silniki, efekty, przypisania, ustawienia globalne) zapisany w zwartej postaci (same wartości, bez domyślnych), skompresowany deflate i zakodowany tekstowo, najlepiej jako link do aplikacji z presetem w adresie (szacunek: kilkaset bajtów do ok. 1 KB, mieści się w czytelnym QR). Do rozstrzygnięcia: wersjonowanie formatu, skanowanie kamerą (wymaga dostępu do kamery, w artefakcie zablokowane, działałoby na GitHub Pages albo przez aparat telefonu) oraz prostsza alternatywa, czyli eksport presetu jako link albo tekst.
- TEMPO w przypisaniach to mnożnik tempa z okna tempa: ½×, ⅔×, ¾×, 1×, 4⁄3×, 1,5×, 2× (krokowo, `Engine.tempoMul`, realne tempo = `effBpm`). Mnożnik dotyczy tylko syntezatorów: perkusja ma własny zegar na globalnym tempie (`_scheduleDrum`, `Engine.bpm`). Delay zsynchronizowany z tempem i beat repeat też liczą się od globalnego BPM. Mnożnik zmienia ruch linii radaru.
- Przesunięcie wzorów między silnikami (SEQ, zakładka SEQ): cztery pokrętła (po jednym na silnik, podpis = rodzaj silnika) przesuwają wzór wysyłany do każdego silnika względem siebie o 0, 1/16, 1/12, 1/8, 1/6, 1/4 albo 1/2 całej nuty (1/16 = jeden krok, 1/12 i 1/6 to wartości trioli). Przesunięcie jest opóźnieniem czasu nuty danego silnika (`Engine.vOff`, w krokach), liczone od realnego tempa, więc działa razem z mnożnikiem TEMPO.
- **DRUM** (piąta zakładka w nagłówku, klawisz 5): prosty moduł perkusji w `docs/js/drums.js`. Pięć ścieżek (stopa, werbel, klaskanie, hat zamknięty i otwarty), 16 kroków, wzory generowane w stylu TECHNO (stopa na każdą ćwierćnutę, hat-y w off-beatach) albo ELECTRO (łamana stopa, werbel na 2 i 4), gęstość z parametru DENS. Brzmienia syntezowane bez próbek: 808, 909 i SYNTH (nowoczesny drum synth: sinus ze zjazdem, szum, hat-y z szumu). Zamiast radaru jest klasyczny sekwencer krokowy: 5 rzędów po 16 kroków w poziomie (z numerami ćwierćnut i ramką bieżącego kroku), dotknięcie kroku przełącza pusty, uderzenie, akcent, a przeciągnięcie po rzędzie wpisuje tę samą wartość w kolejne kroki. Kropki: RANDOM, KIT, STYLE, SC (sidechain). Zakładki: MAIN (10 przypisywalnych miejsc: poziomy ścieżek, stroik i zanik stopy, sidechain i inne), PTRN (CLEAR, obrót, FILL, RANDOM, wyciszanie ścieżek) i CTRL.
- **Sidechain**: stopa przycina sygnał syntezatora (po wszystkich efektach, na bramce `scGain` przed wspólnym wyjściem) o SC AMT, a powrót trwa SC REL. Perkusja ma własną szynę (poziom, drive) i wpada razem z syntezatorem do wspólnego wyjścia master (kompresor, ogranicznik). Ścieżka stopy grana przy wyciszeniu nie wywołuje sidechainu.
- Kropki w rogach mówią, co robią: na stronie DRUM mają opisy przy sobie (np. „KIT 909 / ZMIEŃ ZESTAW”, „SIDECH. WŁ. / STOPA PRZYCINA BAS”), a po dotknięciu każdej kropki na każdej stronie pojawia się komunikat z opisem akcji i nowym stanem.
- Przegląd po zmianach (pomiar offline w Chromium, `ScriptProcessor` na wyjściu): bez przesterowania (0% próbek >0,97), bez NaN i prawie bez DC; perkusja była ok. 8 dB cichsza od syntezatorów, więc tor perkusji (`drumBus`) ma stałe +3,5 dB (`1.5 * level`). Stopa przy mnożniku TEMPO 1× i 2× ma ten sam odstęp (0,5 s przy 120 BPM). Radar rysuje FX1 i FX2 w kolejności z ROUTING (pierwszy w łańcuchu mocniej). Ekrany niższe niż 700 px mają mniejszy radar i ciaśniejsze odstępy (bez przewijania na 360×640 i 320×568). Brzmienia nie oceniano na słuch, a telefonu nie sprawdzano na prawdziwym urządzeniu.
- Układ zwarty (decyzja po przeglądzie makiet): `.stage` układa elementy od góry, bez rozciągania na całą wysokość (`justify-content:flex-start`), radar rośnie z wysokością (do pełnej szerokości, max 380 px), wiersze i pokrętła panelu lekko rosną na wyższych ekranach (`clamp` z `cqh`), a wolne miejsce zostaje w jednym kawałku nad paskiem UNDO/SAVE. Wiersz MODE:ENCODER/EDIT usunięty: przypisywalne zakładki mają tylko potencjometry (bez trybu suwaków), wiersz zostaje tylko na FX (ROUTING, dotknięcie zmienia kolejność) i CTRL (MODE:CONTROLLER = powrót, RANDOM). Okienko EDIT (przypisania, DEFAULT, opisy parametrów) jest w kodzie, ale nie ma już do niego przycisku. Przypisania zmienia się losowo (RANDOM).
- DRUM: cztery kropki z opisami stoją w rzędzie pod siatką (`.dots.row`), siatka jest wyższa (`DG`: 0,11–0,77). Stopa dostała składową o oktawę wyżej (słyszalna na małych głośnikach telefonu), a domyślne poziomy ścieżek to [1, 1, 0,95, 0,9, 0,8]. Perkusja gra od razu po starcie (zmierzone w Chromium, także w emulacji dotyku); zgłoszona na telefonie cisza do wejścia w DRUM nie dała się odtworzyć, więc najpewniej wynikała z tego, że głośniczek telefonu nie oddaje podbasu stopy, a hat i werbel były ciche.

## 11. Widoki: KLASYCZNY, SCENY, ORBITY
- Pasek widoku pod nagłówkiem (`#viewbar`, `setView`): KLASYCZNY (dotychczasowe strony SEQ/MIX/SYN/FX/DRUM), SCENY i ORBITY. Dotknięcie zakładki strony w nagłówku wraca do widoku klasycznego. Pasek zabiera 26 px, więc promień radaru liczy się teraz z `100cqh - 420px`, a `.stage` ma mniejsze odstępy.
- SCENY: pole XY (X = cutoff, Y = rezonans, przez `CONT.cutoff/reso`) i 16 padów ze scenami (A–P). Scena to pełna migawka (`snapshot()`/`restore()`, jak w historii i presetach), zapisana w localStorage `radarxxx.scenes.v1`. Pusty pad zapisuje bieżący stan, pełny go wczytuje, przytrzymanie 600 ms usuwa. Przyciski RANDOM, MUTATE, ZAPISZ SCENĘ (nadpisuje aktywny pad).
- ORBITY: ten sam canvas co radar. Zewnętrzna orbita = kroki wzoru (dotyk włącza i wyłącza nutę), środkowa = cztery silniki i perkusja (rozmiar = głośność), wewnętrzna = FLT, FX1, FX2, w środku MASTER. Dotknięcie obiektu przybliża go animacją (zbliżenie `1 + 0,9·z` na wybrany obiekt) i pokazuje cztery satelity wzięte z rejestrów `CONT`/`CONTG`/`SW`: parametry przeciąga się w górę i w dół, przełączniki dotyka. Silnik: LEVEL, TUNE, OCT, MUTE. Perkusja: DRUMS, KICK, SC AMT, SIDECH. Efekt: dwa pierwsze parametry stylu, MIX, bypass. MASTER: MASTER, COMP, DRIVE, TEMPO. Dotknięcie pustego pola albo przycisk WSTECZ cofa zbliżenie.
- Zbliżanie jest dotykiem, nie szczypaniem palcami (szczypanie można dodać osobno).

## 12. Paleta i efekt kineskopu
- Nowa paleta (z logo „AMIR”): tło `#181818`, biel `#f1f1ec`, kwaśna limonka `#c6ff1a` (`--paper`, `--ink`, `--acc`, tekst na limonce `--on-acc`; w JS `INK`, `ACC`, `PAPER`).
- Efekt kineskopu (klasa `.crt` na `#radar`, przełącznik w MENU, `localStorage radarxxx.crt.v1`, domyślnie WYŁĄCZONY, bo na razie bez mgiełki): (1) poświata ekranu: zmniejszona 4× kopia płótna bez tła (`bloom()`, tryb `difference`) na drugim płótnie `#glow`, rozmywana CSS i nakładana trybem `screen`; (2) smuga luminoforu: ekran czyszczony półprzezroczystym tłem (`PAPER_TRAIL`), więc za ruchomymi liniami zostaje ślad; (3) linie skanowania, winieta i lekkie mruganie (`#radar.crt::after`, wyłączane przy `prefers-reduced-motion`); (4) poświata tekstu, łuków pokręteł i limonkowych przycisków (`text-shadow`, `drop-shadow`, `box-shadow`).
- Nie zrobiono (możliwe dalej): podwójne, rozsunięte linie jak na animacji (aberracja chromatyczna), rozmycie głębi ostrości, pojawianie się interfejsu smugą światła.

## 13. Silniki zewnętrzne (HOWL, MIT)
- Paczka od TAZI (projekt HOWL) leży w `docs/js/external/howl/` bez zmian (silniki Mono, Acid, Wavetable i 9 efektów, na licencji MIT udostępnionej dla radarxxx; patrz `LICENSE-NOTE.md`). Tylko ta paczka jest używana. Archiwa natywnego HOWL (`Archive.zip`, `native.zip`) są na GPL-3.0 i NIE trafiają do repozytorium.
- Silniki są dołączone jako rodzaje 4, 5 i 6 (`H.MONO`, `H.ACID`, `H.WAVET`) obok czterech własnych. Zmiana rodzaju w MIX (przycisk z nazwą) albo SYN (komórka MODEL) przechodzi przez wszystkie siedem. `VOICE_NAMES` nadal oznacza cztery miejsca (sloty), a nie rodzaje.
- Adapter `docs/js/extvoices.js`: owija moduł HOWL w głos zgodny z `Engine` (`out`, `params`, `setParam`, `note`, `silence`, `refresh`). Obwiednie radarxxx (F.ENV, F.ZAN., A.ATAK, A.ZAN., A.SUST., A.REL.) są mapowane na parametry modułu (np. `aAtk` ms → `ampA` s), więc globalne pokrętła z SEQ MAIN i przesunięcia obwiedni działają na nowe silniki. Globalne CUTOFF to mnożnik własnego cutoffu silnika (odniesienie 600 Hz), globalne RESO przesuwa rezonans. Acid ma tylko F.ENV i F.ZAN. (reszta obwiedni nie ma wpływu).
- Strona SYN, zakładka silnika zewnętrznego: siedem pokręteł z listy `main` w `extvoices.js` (Mono: cutoff, reso, f.env, ring, pulse, fine b, drive; Acid: cutoff, reso, f.env, f.zan., accent, sub, drive; Wavetable: pos 1, pos 2, fold, cutoff, reso, f.env, level 2). Pozostałe parametry modułu (fale, sync, PWM, tablice) są dostępne tylko przez RANDOM, MUTATE i presety.
- Ograniczenia: pitch bend i globalny GLIDE nie działają na silniki zewnętrzne (oscylatory są ukryte w module; każdy ma własny glide). Mono wymaga AudioWorklet z adresu blob:. Po starcie `probeEngines` sprawdza, które rodzaje działają, a niedostępne są pomijane przy przełączaniu (toast „NIEKTÓRE SILNIKI HOWL NIEDOSTĘPNE”). Strona otwarta z pliku (adres `file://`) nie wczytuje worklet, przez http działa.
- Pakiet jednoskryptowy: moduły HOWL mają te same nazwy najwyższego poziomu, więc `scripts/howl-bundle.mjs` owija każdy w osobną funkcję. Test `modules.test.js` kompiluje oba pakiety. Efekty HOWL są w repozytorium, ale jeszcze niepodłączone.
- Sprawdzone: testy HOWL (`test/index.html`, ALL CHECKS PASSED), oraz w Chromium przez http: wszystkie trzy silniki grają (RMS ok. -13 dB, bez NaN), przełączanie, RANDOM, globalne pokrętła i snapshot działają. Nie oceniano brzmienia na słuch.

## 14. Efekty zewnętrzne (HOWL, MIT)
- Osiem efektów kolegi (delay, reverb, flanger, chorus, saturator, distortion, compressor, EQ 3-pasmowy) jest dołączonych jako style 5–12 sekcji FX1 i FX2 (`H.DELAY`, `H.REVERB`, `H.FLANGE`, `H.CHORUS`, `H.SATUR`, `H.DISTO`, `H.COMP`, `H.EQ3`). Przełącza się je przyciskiem STYLE (kropka na FX albo komórka stylu w zakładkach FX1 i FX2). Filtr (FLT) zostaje przy własnych czterech stylach. Ducker pominięty, bo radarxxx ma własny sidechain z perkusji.
- Adapter `docs/js/extfx.js` zamienia moduł na styl o kształcie własnych stylów: krzywe lin, exp i choice jak w module, `mix` zaczyna od zera (wybór stylu nie zmienia dźwięku), a przy zmianie stylu zatrzymuje oscylatory LFO utworzone przez moduł. Style mają od 4 do 8 parametrów (reszta pól pusta). Każdy niesie `macro` (parametry sterowane dotykiem na radarze: promień i kąt), a radar rysuje dla nich duchy echa rozsunięte w kącie.
- Starsze zapisy (presety, historia) mają tylko cztery style: przy wczytaniu brakujące dostają wartości domyślne (`restore`).
- Sprawdzone w Chromium przez http: wszystkie osiem gra po przełączeniu, bez NaN i błędów, z miksem 60% poziom zmienia się o ok. 0–3 dB. Brzmienia nie oceniano na słuch.
