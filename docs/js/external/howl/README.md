# HOWL Web Audio export

Synth engines and effects from the HOWL groovebox, rewritten as **ES modules for the Web Audio API**.
No dependencies, no global state, nothing here creates an `AudioContext` (you pass `ctx` in).

* Author: TAZI (HOWL project)
* License: MIT - shared for use in the radarxxx project
* Every file is an **original Web Audio implementation**. None of it is translated from HOWL's native C++ or from
  any third-party source. Where a module follows a HOWL engine's behaviour, it says so in its header.

## What is in here

```
index.js                 exports  engines[]  and  effects[]  (+ small helpers)
engines/mono.js          HOWL Mono       two oscillators, sync, ring mod, PWM, 24 dB filter, curved ADSR
engines/acid.js          HOWL Acid       303-style bass: saw/pulse + sub, resonant 24 dB filter, accent, slide
engines/wavetable.js     HOWL Wavetable  two generated wavetables, position morph, fold, filter, ADSR
effects/delay.js         HOWL Delay      tempo-syncable feedback delay with darkening echoes
effects/reverb.js        HOWL Reverb     algorithmic stereo reverb (8 combs + 3 all-passes per side)
effects/flanger.js       HOWL Flanger    modulated short delay with positive/negative feedback
effects/chorus.js        HOWL Chorus     stereo two-voice chorus
effects/saturator.js     HOWL Warm Saturation   asymmetric tanh saturation with DC blocking
effects/distortion.js    HOWL Distortion 14 waveshaper types + optional hard clipper
effects/compressor.js    HOWL Compressor DynamicsCompressor with make-up gain and parallel mix
effects/eq3.js           HOWL 3-Band EQ  low shelf, mid bell, high shelf
effects/ducker.js        HOWL Kick Ducker  sidechain-style pump, triggered by you (duck / pump)
test/index.html          offline render tests (see "Testing")
```

Each file starts with a header comment that documents the **sound**, the **signal flow**, the **units of every
parameter** and **what to set to hear a typical sound**.

## Using an engine

```js
import { engines } from './index.js';

const ctx = new AudioContext();
const mono = engines.find(e => e.id === 'howl-mono');
if (mono.prepare) await mono.prepare(ctx);       // loads the inlined AudioWorklet (Mono only)

const voice = mono.create(ctx);
voice.out.connect(ctx.destination);
voice.setParam('cutoff', 900);

// note(t, freq, vel, accent, len, slide, hold)
voice.note(ctx.currentTime + 0.05, 110, 100, false, 0.4, false, false);
voice.note(ctx.currentTime + 0.55, 165, 100, true, 0.3, true, false);   // slide = glide from the previous note
voice.silence(ctx.currentTime + 2);
```

Contract (all engines): `id`, `name`, `params[{id,label,min,max,step,def,rand:[lo,hi]}]`, `create(ctx)` returning
`{ out, params, setParam(id,v), note(t,freq,vel,accent,len,slide,hold), silence(t) }`.
`t` is in ctx seconds, `freq` in Hz, `vel` 1-127, `len` in seconds. `hold = true` leaves the gate open until the
next note or `silence()`.

`mono.js` is the only module that needs an `AudioWorklet` (for hard sync, ring mod and PWM, which the native nodes
cannot do). Its code is inlined and loaded from a Blob URL. `create(ctx)` works immediately and queues notes until the
worklet is loaded; `await engine.prepare(ctx)` (or `await voice.ready`) makes the first note on time.

## Using an effect

```js
import { effects, paramFromNormalized } from './index.js';

const reverb = effects.find(e => e.id === 'howl-reverb');
const fx = reverb.create(ctx);
source.connect(fx.input);
fx.output.connect(ctx.destination);

// `def` and `rand` are normalized 0..1; min/max are real-world values (curve 'lin' | 'exp' | 'choice').
fx.apply(paramFromNormalized(reverb, { size: 0.7, mix: 0.3 }), /* bpm */ 120, ctx.currentTime);
```

Contract (all effects): `id`, `name`, `params[{id,label,def,rand,min,max,curve,choices?}]`, `create(ctx)` returning
`{ input, output, apply(values, bpm, now) }`. `values` is already in real-world units; `bpm` is used by the
tempo-synced delay. Choice parameters take the choice **index**. `ducker` also has `duck(time)` and
`pump(startTime, beats, bpm)`.

`index.js` also exports `toRealValue(param, n)`, `paramFromNormalized(effect, {id: 0..1})`,
`randomEngineParams(engine)` and `randomEffectNormalized(effect)` for randomization.

## What is NOT included, and why

HOWL contains more engines and effects than are in this folder. These were left out on purpose:

| HOWL part | Why it is not exported |
|---|---|
| **TRX** drum engines (13 models) | A port of GPL-3.0 code (Hortator). Re-licensing it as MIT or "shared for radarxxx" is not possible without making the receiving project GPL. |
| **MNM** synth engines (23 models) and **MNM FX** (30 models) | A port of GPL-3.0 code (Monomachine firmware port). Same reason. |
| HOWL's native **ACID** engine and **Acid Distortion** | They are built on code from HOWL's `research/acid-v` folder, whose licence for reuse could not be confirmed. `engines/acid.js` and `effects/distortion.js` are *new, independent* designs with similar controls, not ports. |
| HOWL's chorus, saturation | HOWL uses third-party MIT code there (credited in HOWL). `chorus.js` and `saturator.js` are fresh implementations. |
| **SAMPLE**, **EXT** | Not synthesis: sample playback needs audio files, EXT drives outside MIDI hardware. |

If you want drum or FM-style voices in this package, they can be written as new original modules (not derived from the
GPL ports); say which sounds you need.

## Differences from HOWL itself

* These modules are modelled on HOWL's parameters and behaviour but are **not bit-identical** to the native C++ engines.
* Filters are two cascaded `BiquadFilterNode`s (24 dB/oct), not HOWL's native ladder.
* Web Audio's low-pass/high-pass **Q is in dB**, so feedback loops here use -3 dB (no resonance peak). If you add your
  own filters inside a feedback loop, keep their Q at or below -3 dB or the loop can run away.

## Testing

```
node -e "require('http').createServer((q,r)=>require('fs').readFile('.'+q.url.split('?')[0],(e,d)=>{r.writeHead(e?404:200,{'Content-Type':q.url.includes('.html')?'text/html':'text/javascript'});r.end(d)})).listen(8765)"
# then open  http://127.0.0.1:8765/test/index.html
```

`test/index.html` renders every module with an `OfflineAudioContext` and checks that it produces sound, stays finite,
falls silent after `silence()`, survives each parameter at its minimum and maximum, survives random patches, and
(for Mono) that sync, ring mod and PWM really change the waveform. It reports `ALL CHECKS PASSED` on success.
These tests prove the modules work and are stable; they cannot judge how they sound, so listen before relying on a
preset.
