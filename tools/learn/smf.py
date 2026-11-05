"""Minimalny parser Standard MIDI File (format 0/1). Zwraca nuty: (start_tick, dur_tick, pitch, vel, channel, track)."""
import struct

def vlq(b, i):
    v = 0
    while True:
        c = b[i]; i += 1
        v = (v << 7) | (c & 0x7F)
        if not c & 0x80:
            return v, i

def parse(path):
    b = open(path, 'rb').read()
    assert b[:4] == b'MThd', 'nie jest plikiem MIDI'
    fmt, ntr, div = struct.unpack('>HHH', b[8:14])
    i = 14
    notes, tempos, tsigs, names = [], [], [], []
    for t in range(ntr):
        assert b[i:i+4] == b'MTrk'
        ln = struct.unpack('>I', b[i+4:i+8])[0]
        j, end = i + 8, i + 8 + ln
        tick, run, open_ = 0, 0, {}
        while j < end:
            d, j = vlq(b, j); tick += d
            st = b[j]
            if st == 0xFF:
                typ = b[j+1]; ml, j2 = vlq(b, j+2); data = b[j2:j2+ml]; j = j2 + ml
                if typ == 0x51: tempos.append((tick, int.from_bytes(data, 'big')))
                elif typ == 0x58: tsigs.append((tick, tuple(data)))
                elif typ == 0x03: names.append(data.decode('latin1'))
                continue
            if st in (0xF0, 0xF7):
                ml, j = vlq(b, j+1); j += ml; continue
            if st & 0x80: run = st; j += 1
            kind, ch = run & 0xF0, run & 0x0F
            if kind in (0x80, 0x90):
                p, v = b[j], b[j+1]; j += 2
                if kind == 0x90 and v > 0:
                    open_.setdefault((ch, p), []).append((tick, v))
                else:
                    q = open_.get((ch, p))
                    if q:
                        s, vel = q.pop(0)
                        notes.append((s, tick - s, p, vel, ch, t))
            elif kind in (0xA0, 0xB0, 0xE0): j += 2
            elif kind in (0xC0, 0xD0): j += 1
        i = end
    return dict(format=fmt, ppq=div, notes=sorted(notes), tempos=tempos, tsigs=tsigs, names=names)
