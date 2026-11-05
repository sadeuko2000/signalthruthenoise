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
- Sekcja globalna na wyjściu po miksie silników.
- Globalny filtr w **4 stylach**, każdy z **8 podstawowymi parametrami**.
- Efekty w **4 stylach**, także po 8 parametrów. Do ustalenia: czy to cztery style filtra i osobno cztery style efektu, czy jeden wspólny wybór.
- Stan: **do zrobienia**.

## Otwarte pytania
1. Które style filtra (propozycje robocze: drabinkowy, state-variable, rezonansowy typu MS-20, grzebieniowy/formantowy) i efektów (np. delay, pogłos, chorus, dystorsja).
2. Czy wszystkie sekwencery mają tę samą siatkę 16 kroków, czy każdy własną długość.
3. Co dzieje się z żyroskopem i interfejsem mobilnym (odłożone na później).
4. Perkusja i lead (odłożone na później).
