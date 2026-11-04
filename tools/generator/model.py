"""Struktury danych generatora."""
from __future__ import annotations
from dataclasses import dataclass, field, replace

MODES = {
    "minor": (0, 2, 3, 5, 7, 8, 10),
    "phrygian": (0, 1, 3, 5, 7, 8, 10),
}


@dataclass(frozen=True)
class Step:
    on: bool = False
    degree: int = 0        # stopień skali (0 = pryma), może być ujemny/>6
    octave: int = 0        # przesunięcie oktawowe względem root
    vel: int = 90          # 1..127
    gate: float = 0.5      # 0..1 długości kroku
    tie: bool = False      # slide/legato do następnego kroku
    ratchet: int = 1       # 1..4 powtórzeń w kroku


@dataclass(frozen=True)
class Pattern:
    steps: tuple[Step, ...]
    swing: float = 0.0     # 0..0.5 opóźnienie kroków nieparzystych

    @property
    def length(self) -> int:
        return len(self.steps)

    def with_step(self, i: int, step: Step) -> "Pattern":
        s = list(self.steps)
        s[i] = step
        return replace(self, steps=tuple(s))


@dataclass(frozen=True)
class Scale:
    root: int = 36         # MIDI note (C2)
    mode: str = "minor"

    def pitch(self, degree: int, octave: int = 0) -> int:
        notes = MODES[self.mode]
        oct_extra, d = divmod(degree, len(notes))
        return self.root + notes[d] + 12 * (octave + oct_extra)


@dataclass(frozen=True)
class Params:
    length: int = 16
    density: float = 0.6       # szansa nuty na kroku (po ważeniu)
    syncopation: float = 0.5   # 0 = tylko mocne kroki, 1 = dużo off-beat
    accent_bias: float = 0.5   # szansa akcentu na mocnym kroku
    leap_prob: float = 0.1     # szansa skoku > 3 stopnie
    tie_prob: float = 0.0      # bas: zwykle 0; slide 303 opcjonalnie
    ratchet_prob: float = 0.0
    swing: float = 0.0
    seed: int = 0


@dataclass(frozen=True)
class Track:
    role: str                  # bass | kick | clap | hat | lead
    pattern: Pattern
    channel: int = 0
    scale: Scale = field(default_factory=Scale)
