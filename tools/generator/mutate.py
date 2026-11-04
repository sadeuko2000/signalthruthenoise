"""Kontrolowane mutacje: jeden krok, jedna nuta."""
from __future__ import annotations
import random
from dataclasses import replace
from .model import Track, Step

KINDS = ("toggle", "pitch", "accent", "gate")


def mutate(track: Track, rng: random.Random, kind: str | None = None) -> Track:
    kind = kind or rng.choice(KINDS)
    pat = track.pattern
    i = rng.randrange(pat.length)
    s = pat.steps[i]
    if kind == "toggle":
        s = Step(degree=s.degree) if s.on else Step(on=True, degree=s.degree, vel=85, gate=0.35)
    elif not s.on:
        return track  # pozostałe mutacje dotyczą tylko grających kroków
    elif kind == "pitch":
        s = replace(s, degree=s.degree + rng.choice((-2, -1, 1, 2)))
    elif kind == "accent":
        s = replace(s, vel=85 if s.vel >= 110 else 120)
    elif kind == "gate":
        s = replace(s, gate=rng.choice((0.25, 0.35, 0.5, 0.75)))
    else:
        raise ValueError(kind)
    return replace(track, pattern=pat.with_step(i, s))
