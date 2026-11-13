# Radar Synth

Four synth engines that always play together, blended with an XY pad. For Akai MPC standalone, made for the **MPC Key 37, Gen 1** (32-bit build; a 64-bit build is included too). By Adam Brocki.
The engines come from the radarxxx browser instrument (own implementations in C++, no third-party code).

## How it works

Every note plays up to four engines at once. The XY pad on the MIX tab sets how much of each you hear:

| Pad corner | Engine | Sound | Own controls |
|---|---|---|---|
| top left | Prophet | 3 detuned saws, 24 dB lowpass, sine "body" | Prophet Lvl, Prophet Oct, Detune, Body |
| top right | MS-20 | square/saw blend, highpass + resonant lowpass, hard drive | MS-20 Lvl, MS-20 Oct, HP Freq, Wave Mix |
| bottom left | DX | 2-operator FM, index decays with the filter envelope, sub sine | DX Lvl, DX Oct, FM Ratio, FM Index, Sub |
| bottom right | Wavetable | saw morphing into a formant ("vowel") wave, morph sweeps on every note | Wave Lvl, Wave Oct, Vowel, Morph, Sweep |

In a corner you hear one engine, on an edge two, in the centre all four. The same mix is on the **Mix X** and **Mix Y** knobs (Q-Links 1 and 2 on the MIX tab), so the pad is a shortcut, not the only way.
An engine at zero gain is not computed, so corners and edges cost less CPU than the centre.

Shared by all engines: Cutoff, Resonance, Env Amt (filter envelope, +-5 octaves), Drive, filter ADSR, amp ADSR, Key Track, Velocity, Volume.
A velocity of 110 or more is an accent: stronger and longer filter envelope (like accents in the radarxxx sequencer).
Mode: Poly (6 voices) or Mono with glide; in Mono, releasing a key returns to the key you still hold. **Voices** (1-6) lowers the polyphony if the MPC runs out of CPU.
A soft limiter on the output keeps loud chords from clipping.

## Tabs

- **MIX**: Mix X, Mix Y / Volume, Mode / Glide, Bend Range / Velocity, Voices, and the XY pad on the right.
- **TONE**: Cutoff, Resonance, Env Amt, Drive / filter ADSR / amp ADSR / Key Track.
- **PRO/MS**: Prophet and MS-20 controls.
- **DX/WAVE**: DX and Wavetable controls.

Ten factory programs: Quad Init, Electro Bass, Acid Corner, Prophet Poly, DX Pluck, Vowel Pad, Saw Wall, Glass Stack, Hollow Lead, Octave Layers.

## Two packages

- `dist/radar-synth-2.0.0-mpc.zip` - with the XY pad. Use this one first.
- `dist/radar-synth-2.0.0-mpc-bez-xy.zip` - the same plugin without the pad (Mix X / Mix Y knobs only). The SDK marks the XY pad widget as "less tested", so if the MIX tab looks wrong or the plugin shows no tabs on your MPC, use this package instead. Install only one of the two.

## Status (honest)

- Built for arm32 and arm64 with the SDK and validated (0 errors, 0 warnings); the SDK host simulator passes all 19 checks.
- Own test program: every program, every pad corner and the centre in mono with glide, jumps across the whole pad while a note sounds (no clicks), the mono key stack, and every parameter at minimum and maximum: no NaN, no clipping.
- **Not tested on real hardware and not judged by ear.** In particular, nobody has yet seen the XY pad on an MPC: whether it draws and reacts as documented, and whether "up" on the pad means a higher Mix Y. If the engine names turn out upside down (DX and WAVE at the top), that is a one-line fix in `tools/make_skins.py`.
- CPU on a desktop, six sustained notes: about 1% of a 128-frame block with one engine, about 2.3% with all four. The SDK suggests multiplying by 15-25 for the older 32-bit MPCs, so roughly 15-25% in a corner and 35-60% in the centre with six notes held. If you hear crackles: lower Voices, or move the pad towards an edge.
- Not included: mod wheel, aftertouch, LFO, effects. Pitch bend works (Bend Range).
- The Wavetable "Vowel" knob rebuilds a small table on the audio thread when it moves, which is cheap but not free.

## Install

MPC OS 3.10.1 or later, with External Plugin Support enabled (Preferences > Enhancements (Beta) > Enable Enhancements and External Plugin Support). Unzip, then copy the folder `Adam Brocki - VST - Radar Synth` into a folder named `VST2 Plugins` on a USB drive or SD card. See `INSTALL.txt` in the zip.
Third-party plugins run unprotected inside the MPC application: a bug can freeze or restart it, so save your project first.
If you installed the earlier 1.0.0 prototype, delete its folder first: version 2 is a different plugin (new id `RdX4`), and projects saved with 1.0.0 will not load into it.

## Build

Needs the [MPC Plugin Builder SDK](https://github.com/inmusic-software/mpc-plugin-builder-sdk) (MIT; built against commit `febd2ca`). From a clone of the SDK:

```
python tools/build.py "/path/to/radarxxx/mpc/Radar Synth"
python tools/package.py "/path/to/radarxxx/mpc/Radar Synth"
```

The first build installs the Zig compiler into the SDK's `.sdk-tools` folder (needs network).
`skins/` holds the finished skin (generated from `ui.json`, plus the XY pad). After changing `ui.json` or the parameters, rebuild it with `python tools/make_skins.py --sdk /path/to/sdk` (needs Pillow) and build again. Without the `skins/` folder the SDK generates the skin without the pad.

## Project layout

- `plugin.json` - manifest (name, manufacturer, uid `RdX4`). The `uid` must match `MPC_FOURCC` in the C++; parameter order and ids are permanent once projects exist, so only append new parameters at the end.
- `src/RadarSynth.cpp` - the plugin source.
- `ui.json` - tabs and widgets (kit "lime"); `tools/make_skins.py` adds the XY pad; `skins/` is the result.
- `dist/` - the packaged zips for copying to the MPC.

Licence: MIT.
