"""Eksport do Standard MIDI File (format 0), bez zależności zewnętrznych."""
from __future__ import annotations
from .model import Track

PPQ = 480
STEP_TICKS = PPQ // 4  # 16-tki


def _vlq(n: int) -> bytes:
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    return bytes(reversed(out))


def track_events(track: Track, bars: int = 1) -> list[tuple[int, bytes]]:
    """Lista (tick_absolutny, bajty zdarzenia) dla nut."""
    pat, ch = track.pattern, track.channel & 0x0F
    ev: list[tuple[int, bytes]] = []
    n = pat.length
    for bar in range(bars):
        for i, s in enumerate(pat.steps):
            if not s.on:
                continue
            start = (bar * n + i) * STEP_TICKS
            if i % 2 == 1:
                start += int(pat.swing * STEP_TICKS)
            pitch = track.scale.pitch(s.degree, s.octave)
            nxt = pat.steps[(i + 1) % n]
            length = STEP_TICKS * (1.0 if s.tie and nxt.on else s.gate)
            # ratchet dzieli krok na r równych części
            r = max(1, s.ratchet)
            part = STEP_TICKS // r
            for k in range(r):
                t0 = start + k * part
                t1 = t0 + max(1, int(length if r == 1 else part * 0.6))
                ev.append((t0, bytes([0x90 | ch, pitch, s.vel])))
                ev.append((t1, bytes([0x80 | ch, pitch, 0])))
    # note-off przed note-on przy tym samym ticku
    ev.sort(key=lambda e: (e[0], e[1][0] & 0xF0 == 0x90))
    return ev


def export_midi(track: Track, path: str, bpm: int = 130, bars: int = 4) -> None:
    events = track_events(track, bars)
    data = bytearray()
    tempo = int(60_000_000 / bpm)
    data += b"\x00\xff\x51\x03" + tempo.to_bytes(3, "big")
    last = 0
    for t, msg in events:
        data += _vlq(t - last) + msg
        last = t
    data += b"\x00\xff\x2f\x00"
    header = b"MThd" + (6).to_bytes(4, "big") + (0).to_bytes(2, "big") \
        + (1).to_bytes(2, "big") + PPQ.to_bytes(2, "big")
    trk = b"MTrk" + len(data).to_bytes(4, "big") + bytes(data)
    with open(path, "wb") as f:
        f.write(header + trk)
