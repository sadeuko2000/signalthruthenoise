"""Generator basu acid (303) z rytmem ważonym."""
from __future__ import annotations
import random
from .model import Step, Pattern, Track, Scale, Params

# Waga kroku w siatce 16: mocne (0,4,8,12) > połówki (2,6,10,14) > off-beat
def step_weight(i: int, syncopation: float) -> float:
    if i % 4 == 0:
        strong = 1.0
    elif i % 2 == 0:
        strong = 0.6
    else:
        strong = 0.3
    # syncopation podbija słabe kroki kosztem mocnych
    return strong * (1 - syncopation) + (1 - strong) * syncopation * 0.8 + 0.1


def _next_degree(prev: int, p: Params, rng: random.Random) -> int:
    if rng.random() < p.leap_prob:
        return prev + rng.choice((-5, -4, 4, 5))
    # ruch krokowy, preferuje powrót do prymy/kwinty
    d = prev + rng.choice((-2, -1, -1, 0, 0, 1, 1, 2))
    return max(-3, min(7, d))


def generate_bass(p: Params, scale: Scale | None = None) -> Track:
    scale = scale or Scale()
    rng = random.Random(p.seed)
    steps: list[Step] = []
    deg = 0
    for i in range(p.length):
        w = step_weight(i % 16, p.syncopation)
        # krok 0 zawsze gra (kotwica frazy)
        on = i == 0 or rng.random() < p.density * w * 1.6
        if not on:
            steps.append(Step())
            continue
        deg = 0 if i == 0 else _next_degree(deg, p, rng)
        accent = (i % 4 == 0) and rng.random() < p.accent_bias
        vel = 120 if accent else rng.randint(70, 95)
        steps.append(Step(
            on=True, degree=deg, octave=0, vel=vel,
            gate=0.35 if not accent else 0.5,
            tie=rng.random() < p.tie_prob,
            ratchet=2 if rng.random() < p.ratchet_prob else 1,
        ))
    return Track("bass", Pattern(tuple(steps), p.swing), channel=0, scale=scale)
