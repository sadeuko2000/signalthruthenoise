# Radar Synth

One synth layer with four engines, for Akai MPC standalone (made for the **MPC Key 37, Gen 1**, 32-bit build). By Adam Brocki.
The engines are ported from the radarxxx browser instrument (own implementations in C++, no third-party code): Prophet-style, MS-20-style, 2-operator FM ("DX") and Wavetable.
8-voice polyphonic or mono with glide.

## Engines

| Engine | Sound | Own controls (ENGINE page) |
|---|---|---|
| Prophet | 3 detuned saws, 24 dB lowpass, sine "body" | Detune, Body |
| MS-20 | square/saw blend, highpass + resonant lowpass, hard drive | HP Freq, Wave Mix |
| DX | 2-operator FM, index decays with the filter envelope, sub sine | FM Ratio, FM Index, Sub |
| Wavetable | saw morphing into a formant ("vowel") wave, morph sweeps on every note | Vowel, Morph, Sweep |

Shared: Cutoff, Resonance, Env Amt (filter envelope, +-5 octaves), Drive, filter ADSR, amp ADSR, Key Track, Velocity, Volume, Mode (Poly/Mono), Glide, Bend Range.
A velocity of 110 or more is an accent: stronger and longer filter envelope (like accents in the radarxxx sequencer).

## Pages and Q-Links

- **FILTER**: Cutoff, Resonance, Env Amt, Drive / Filt Attack, Decay, Sustain, Release / Key Track.
- **AMP**: Amp Attack, Decay, Sustain, Release / Volume, Velocity.
- **ENGINE**: Engine, Mode, Glide, Bend Range, then the controls of the selected engine (others are hidden).

Eight factory programs: Init Prophet, Electro Bass, MS-20 Acid, DX Pluck, FM Bell, Vowel Pad, Hollow Lead, Fat Poly.

## Status (honest)

- Built for arm32 and arm64 with the SDK, validated; the host simulator passes all checks (block sizes 32/512, parameter sweep, state round-trip, no NaN/denormals/clipping).
- Every parameter at its minimum and maximum, on every engine, with eight notes: no NaN, no runaway levels.
- **Not tested on real hardware.** Sound quality was not judged by ear. CPU on a desktop: about 0.8% of a 128-frame block with all 8 voices sounding; the SDK suggests multiplying by roughly 15-25 for the older 32-bit MPCs, so up to about 20% of a block with eight sustained notes. Use Mono mode or short releases if it gets tight.
- Not in this prototype: pitch-bend works (range parameter), mod wheel, aftertouch and the LFO are not used; no multi-layer (this is the single-layer prototype); no effects.
- Note: the Wavetable "Vowel" knob rebuilds a small table on the audio thread when it moves, which is cheap but not free.

## Install

MPC OS 3.10.1 or later, with External Plugin Support enabled (Preferences > Enhancements (Beta) > Enable Enhancements and External Plugin Support). Copy the folder `Adam Brocki - VST - Radar Synth` into a folder named `VST2 Plugins` on a USB drive or SD card. See `INSTALL.txt` in the zip. Third-party plugins run unprotected inside the MPC application: a bug can freeze or restart it, so save your project first.

## Build

Needs the [MPC Plugin Builder SDK](https://github.com/inmusic-software/mpc-plugin-builder-sdk) (MIT; built against commit `febd2ca5bd9eb16c4a412837196e145566bc981b`). From a clone of the SDK:

```
python tools/build.py "/path/to/radarxxx/mpc/Radar Synth"
python tools/package.py "/path/to/radarxxx/mpc/Radar Synth"
```

The first build installs the Zig compiler into the SDK's `.sdk-tools` folder (needs network).

## Project layout

- `plugin.json` - manifest (name, manufacturer, uid `AJ1i`). The `uid` must match `MPC_FOURCC` in the C++; parameter order and ids are permanent once projects exist, so only append new parameters at the end.
- `src/RadarSynth.cpp` - the plugin source.
- `ui.json` - pages and widgets (kit "lime").
- `dist/` - the packaged zip for copying to the MPC.

Licence: MIT.
