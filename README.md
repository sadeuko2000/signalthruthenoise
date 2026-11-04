# signalthruthenoise

Generator MIDI do electro. Etap 1: bas acid (303). Czysty Python, bez zależności.

```bash
python3 -m generator --seed 7 --mode phrygian -o out/bass.mid
python3 -m unittest -v
```

Struktura: `generator/model.py` (Step/Pattern/Track/Scale/Params), `acid.py` (rytm ważony,
prowadzenie głosu), `mutate.py` (jeden krok / jedna nuta), `midi.py` (eksport SMF).

Plan: perkusja (kick/clap/hat), lead, ruch kwinta/oktawa między blokami, port do JS dla „Szkicu”.
