"""Uczy model generatora basu z katalogu pętli MIDI i zapisuje ZAGREGOWANE statystyki jako moduł JS.

Użycie (z katalogu głównego repo):
    python3 -I tools/learn/learn_model.py <katalog_z_plikami_mid> docs/js/electro-model.js

Wejście: pliki *.mid z nazwą w formacie `NNN_<bpm>_..._<TONACJA>_...mid` (tonacja = nazwa dźwięku, np. G#).
Wynik zawiera wyłącznie tablice prawdopodobieństw (rytm, wysokości, długości, głośności). Nie zawiera żadnej pętli
ani jej fragmentu, a pliki źródłowe nie są częścią repo.
"""
import collections, glob, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import smf

PC = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}
ELECTRO_PCS = (0, 1, 3, 5, 6, 10, 11)      # półtony skali „electro” (patrz generator.js); inne klasy wysokości są pomijane
IOI_CLASSES = (1, 2, 3, 4, 5)               # 5 = pięć kroków i więcej
DUR_CAP = 4.0
r3 = lambda x: round(float(x), 3)


def load_loops(folder):
    loops = []
    for f in sorted(glob.glob(os.path.join(folder, '*.mid'))):
        m = re.match(r'\d+_(\d+)_.*_([A-G]#?)_', os.path.basename(f))
        if not m:
            continue
        data = smf.parse(f)
        step = data['ppq'] / 4
        notes = sorted((round(s / step), d / step, p, v) for s, d, p, v, *_ in data['notes'])
        if not notes:
            continue
        end = max(round((s + d) / step) for s, d, *_ in [(n[0], n[1]) for n in notes]) if notes else 16
        bars = max(1, round(max(n[0] + n[1] for n in notes) / 16))
        loops.append({'key': PC[m.group(2)], 'notes': notes, 'bars': bars})
    return loops


def learn(loops):
    # --- rytm: P(nuta na kroku | czy poprzedni krok miał nutę), osobno dla każdej z 16 pozycji w takcie
    cnt = [[[0, 0] for _ in range(16)] for _ in range(2)]     # cnt[prev][pos] = [bez nuty, z nutą]
    on15 = [0, 0]; total_steps = 0; notes_total = 0; bars_total = 0
    first_on = [0, 0]
    for L in loops:
        n = L['bars'] * 16
        on = [False] * n
        for i, *_ in L['notes']:
            if 0 <= i < n:
                on[i] = True
        for i in range(n):
            prev = on[(i - 1) % n]
            cnt[int(prev)][i % 16][int(on[i])] += 1
        notes_total += sum(on); bars_total += L['bars']; total_steps += n
        on15[int(on[15 % n])] += 1
    alpha = 1.0
    p_on = [[r3((c[1] + alpha) / (c[0] + c[1] + 2 * alpha)) for c in row] for row in cnt]

    # --- wysokości: półtony względem najniższej toniki w pętli; paleta = zbiór różnych wysokości w pętli
    pitch_w = collections.Counter(); palette_size = collections.Counter(); first_tonic = [0, 0]
    stay = [0, 0]; octave_pair = [0, 0]; has_tonic = [0, 0]
    for L in loops:
        key = L['key']
        tonics = [p for _, _, p, _ in L['notes'] if (p - key) % 12 == 0]
        base = min(tonics) if tonics else min(p for _, _, p, _ in L['notes'])
        has_tonic[int(bool(tonics))] += 1
        rel = [p - base for _, _, p, _ in L['notes']]
        usable = [r for r in rel if (r % 12) in ELECTRO_PCS]
        for r in usable:
            pitch_w[r] += 1
        palette_size[min(len(set(usable)), 5)] += 1
        first_tonic[int(rel[0] == 0)] += 1
        if len(set(usable)) >= 2:
            for a, b in zip(rel, rel[1:]):
                stay[int(a == b)] += 1
                if a != b:
                    octave_pair[int((a - b) % 12 == 0)] += 1
    tot_p = sum(pitch_w.values())
    pitches = [{'rel': k, 'w': r3(v / tot_p)} for k, v in sorted(pitch_w.items(), key=lambda kv: -kv[1]) if v / tot_p >= 0.002]
    norm = sum(x['w'] for x in pitches)
    for x in pitches:
        x['w'] = r3(x['w'] / norm)
    tot_ps = sum(palette_size.values())

    # --- długości nut zależnie od odstępu do następnej nuty (w krokach); ostatnia nuta liczy się cyklicznie
    dur = {c: collections.Counter() for c in IOI_CLASSES}
    for L in loops:
        n = L['bars'] * 16
        ns = sorted({i: (d, v) for i, d, _, v in L['notes']}.items())
        for k, (i, (d, v)) in enumerate(ns):
            nxt = ns[(k + 1) % len(ns)][0] + (n if k + 1 == len(ns) else 0)
            ioi = max(1, nxt - i)
            q = min(DUR_CAP, max(0.25, round(d * 4) / 4))
            dur[min(ioi, 5)][min(q, ioi if ioi < 5 else DUR_CAP)] += 1
    gate = {}
    for c, cn in dur.items():
        t = sum(cn.values()) or 1
        gate[str(c)] = [[r3(k), r3(v / t)] for k, v in sorted(cn.items())]

    # --- głośność: klasy (cicha / średnia / pełna) w zależności od pozycji w takcie
    vcls = [[0, 0, 0] for _ in range(16)]
    for L in loops:
        for i, d, p, v in L['notes']:
            vcls[i % 16][0 if v < 64 else 1 if v < 112 else 2] += 1
    vel_by_pos = []
    for row in vcls:
        t = sum(row) or 1
        vel_by_pos.append([r3(x / t) for x in row])

    return {
        'meta': {'loops': len(loops), 'notes': notes_total, 'bars': bars_total,
                 'notesPerBar': r3(notes_total / bars_total), 'source': 'zagregowane statystyki 50 pętli basu electro (bez pętli źródłowych)'},
        'rhythm': {'pOn': p_on, 'startOn': r3((on15[1] + 1) / (sum(on15) + 2))},
        'pitch': {
            'palette': {str(k): r3(palette_size[k] / tot_ps) for k in sorted(palette_size)},
            'weights': pitches,
            'firstTonic': r3(first_tonic[1] / sum(first_tonic)),
            'stay': r3(stay[1] / sum(stay)),
            'octavePair': r3(octave_pair[1] / sum(octave_pair)),
        },
        'gate': gate,
        'velocity': {'byPos': vel_by_pos},      # prawdopodobieństwa klas [cicha, średnia, pełna] na każdej z 16 pozycji
    }


def js_module(model):
    body = json.dumps(model, ensure_ascii=False, separators=(',', ':'))
    return ('// Model generatora basu electro: ZAGREGOWANE statystyki nauczone z 50 pętli (rytm, wysokości, długości, głośności).\n'
            '// Nie zawiera żadnej pętli ani jej fragmentu. Generowany przez tools/learn/learn_model.py, nie edytować ręcznie.\n'
            f'export const ELECTRO_MODEL = {body};\n')


if __name__ == '__main__':
    folder, out = sys.argv[1], sys.argv[2]
    loops = load_loops(folder)
    model = learn(loops)
    with open(out, 'w', encoding='utf-8') as fh:
        fh.write(js_module(model))
    m = model
    print(f"pętle: {m['meta']['loops']}, nuty: {m['meta']['notes']}, takty: {m['meta']['bars']}, nut/takt: {m['meta']['notesPerBar']}")
    print('paleta (liczba różnych wysokości):', m['pitch']['palette'])
    print('wysokości:', [(x['rel'], x['w']) for x in m['pitch']['weights']])
    print('stay:', m['pitch']['stay'], 'octavePair:', m['pitch']['octavePair'], 'firstTonic:', m['pitch']['firstTonic'])
    print('rozmiar pliku:', os.path.getsize(out), 'B')
