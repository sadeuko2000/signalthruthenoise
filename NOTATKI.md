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

## Otwarte pytania
1. Czy wybrane style filtra i efektów (patrz punkt 4) są właściwe, czy zmienić któryś.
2. Czy wszystkie sekwencery mają tę samą siatkę 16 kroków, czy każdy własną długość.
3. Co dzieje się z żyroskopem i interfejsem mobilnym (odłożone na później).
4. Perkusja i lead (odłożone na później).
