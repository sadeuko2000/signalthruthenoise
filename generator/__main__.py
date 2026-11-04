import argparse, os
from . import generate_bass, export_midi
from .model import Params, Scale


def main() -> None:
    ap = argparse.ArgumentParser(description="Generator basu acid -> MIDI")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--bpm", type=int, default=130)
    ap.add_argument("--bars", type=int, default=4)
    ap.add_argument("--mode", default="minor", choices=("minor", "phrygian"))
    ap.add_argument("--density", type=float, default=0.6)
    ap.add_argument("--syncopation", type=float, default=0.5)
    ap.add_argument("-o", "--out", default="out/bass.mid")
    a = ap.parse_args()
    t = generate_bass(Params(seed=a.seed, density=a.density, syncopation=a.syncopation),
                      Scale(mode=a.mode))
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    export_midi(t, a.out, a.bpm, a.bars)
    print("".join("x" if s.on else "." for s in t.pattern.steps), "->", a.out)


main()
