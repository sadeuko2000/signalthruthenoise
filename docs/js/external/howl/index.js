/**
 * HOWL export - index
 * Author:  TAZI (HOWL project)
 * License: MIT - shared for use in the radarxxx project
 *
 * `engines` and `effects` list every module in this export. Nothing here creates an AudioContext.
 *
 *   import { engines, effects, toRealValue, paramFromNormalized } from './index.js';
 */
import { engine as mono } from './engines/mono.js';
import { engine as acid } from './engines/acid.js';
import { engine as wavetable } from './engines/wavetable.js';

import { effect as delay } from './effects/delay.js';
import { effect as reverb } from './effects/reverb.js';
import { effect as flanger } from './effects/flanger.js';
import { effect as chorus } from './effects/chorus.js';
import { effect as saturator } from './effects/saturator.js';
import { effect as distortion } from './effects/distortion.js';
import { effect as compressor } from './effects/compressor.js';
import { effect as eq3 } from './effects/eq3.js';
import { effect as ducker } from './effects/ducker.js';

export const engines = [mono, acid, wavetable];
export const effects = [delay, reverb, flanger, chorus, saturator, distortion, compressor, eq3, ducker];

/**
 * Convert a normalized 0..1 value of an EFFECT parameter into its real-world value.
 * curve 'lin': min + n*(max-min); 'exp': min*(max/min)^n; 'choice': index 0..choices.length-1.
 */
export function toRealValue(param, n) {
  const x = Math.min(1, Math.max(0, Number(n)));
  if (param.curve === 'exp') return param.min * Math.pow(param.max / param.min, x);
  if (param.curve === 'choice') return Math.round(x * (param.choices.length - 1));
  return param.min + x * (param.max - param.min);
}

/** Convert a normalized parameter object {id: 0..1} into the real-world values object that apply() expects. */
export function paramFromNormalized(effect, normalized) {
  const values = {};
  for (const p of effect.params) values[p.id] = toRealValue(p, normalized && p.id in normalized ? normalized[p.id] : p.def);
  return values;
}

/** Pick a random real-world value for each ENGINE parameter, using its `rand` range (snapped to `step`). */
export function randomEngineParams(engineModule, rng = Math.random) {
  const out = {};
  for (const p of engineModule.params) {
    const v = p.rand[0] + rng() * (p.rand[1] - p.rand[0]);
    out[p.id] = p.step ? Math.round(v / p.step) * p.step : v;
  }
  return out;
}

/** Pick random normalized values for an EFFECT, using each parameter's `rand` range. */
export function randomEffectNormalized(effectModule, rng = Math.random) {
  const out = {};
  for (const p of effectModule.params) out[p.id] = p.rand[0] + rng() * (p.rand[1] - p.rand[0]);
  return out;
}
