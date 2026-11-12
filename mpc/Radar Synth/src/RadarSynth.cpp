// Radar Synth - an MPC instrument plugin by Adam Brocki
//
// SPDX-License-Identifier: MIT
//
// One synth layer with four selectable engines, ported from the radarxxx browser instrument
// (own implementations; see README.md). Polyphonic (8 voices) or mono with glide.
//
// Signal flow per voice (Engine parameter selects one of four):
//   Prophet   : 3 detuned PolyBLEP saws -> 2x SVF lowpass (24 dB) + sine "body" -> amp ADSR -> drive (tanh)
//   MS-20     : square/saw crossfade -> SVF highpass -> SVF lowpass -> pre-drive + tanh -> amp ADSR + sine body
//   DX        : 2-operator FM (carrier + modulator, ratio, index decaying with the filter envelope) + sub sine
//   Wavetable : PolyBLEP saw morphing into a formant ("vowel") wavetable, morph sweeps on each note -> SVF lowpass
// Shared: filter envelope (ADSR, amount in octaves), key tracking, velocity, master volume.
// Accent: velocity >= 110 gives a stronger and longer filter envelope (like accents in the radarxxx sequencer).
//
// Parameter order is permanent (see AGENTS.md "Identity is permanent"): append new parameters at the end.

#include "mpc_plugin.h"
#include "dsp/math.h"
#include "dsp/oscillator.h"
#include "dsp/svf.h"
#include "dsp/adsr.h"
#include "dsp/smoother.h"
#include "dsp/voice.h"
#include "dsp/midi_cc.h"

#include <cmath>

using namespace mpc::dsp;

class RadarSynth : public mpc::Plugin
{
public:
    // One entry per parameter, in the order they are added in the constructor.
    enum Params
    {
        kVolume = 0,                                            // parameter 0 must be harmless (master volume)
        kEngine, kCutoff, kResonance, kEnvAmount, kDrive,
        kFAttack, kFDecay, kFSustain, kFRelease,
        kAttack, kDecay, kSustain, kRelease,
        kDetune, kBody,                                         // Prophet
        kHpFreq, kWaveMix,                                      // MS-20
        kFmRatio, kFmIndex, kSub,                               // DX
        kVowel, kMorph, kSweep,                                 // Wavetable
        kMode, kGlide, kBendRange, kVelSens, kKeyTrack,
        kNumParams
    };
    enum Engine { kProphet = 0, kMs20, kDx, kWavetable };

    static mpc::PluginInfo makeInfo()
    {
        mpc::PluginInfo i;
        i.name = "Radar Synth";
        i.vendor = "Adam Brocki";
        i.uniqueId = MPC_FOURCC('A', 'J', '1', 'i');    // must match "uid" in plugin.json
        i.version = 1000;
        i.isInstrument = true;
        i.numInputs = 0;
        i.numOutputs = 2;
        return i;
    }

    RadarSynth() : mpc::Plugin(makeInfo())
    {
        using namespace mpc;
        addParam(floatParam ("vol",      "Volume",       -40.0f, 6.0f, -6.0f, "dB", 1));
        addParam(choiceParam("engine",   "Engine",       {"Prophet", "MS-20", "DX", "Wavetable"}, 0));
        addParam(logParam   ("cutoff",   "Cutoff",       20.0f, 18000.0f, 1800.0f, "Hz", 0));
        addParam(floatParam ("reso",     "Resonance",    0.0f, 100.0f, 25.0f, "%", 0));
        addParam(floatParam ("envamt",   "Env Amt",      -100.0f, 100.0f, 40.0f, "%", 0));
        addParam(floatParam ("drive",    "Drive",        0.0f, 100.0f, 30.0f, "%", 0));
        addParam(logParam   ("fatk",     "Filt Attack",  1.0f, 2000.0f, 2.0f, "ms", 0));
        addParam(logParam   ("fdec",     "Filt Decay",   5.0f, 3000.0f, 250.0f, "ms", 0));
        addParam(floatParam ("fsus",     "Filt Sustain", 0.0f, 100.0f, 0.0f, "%", 0));
        addParam(logParam   ("frel",     "Filt Release", 5.0f, 3000.0f, 150.0f, "ms", 0));
        addParam(logParam   ("atk",      "Amp Attack",   1.0f, 3000.0f, 3.0f, "ms", 0));
        addParam(logParam   ("dec",      "Amp Decay",    5.0f, 3000.0f, 250.0f, "ms", 0));
        addParam(floatParam ("sus",      "Amp Sustain",  0.0f, 100.0f, 85.0f, "%", 0));
        addParam(logParam   ("rel",      "Amp Release",  5.0f, 3000.0f, 120.0f, "ms", 0));
        addParam(floatParam ("detune",   "Detune",       0.0f, 25.0f, 10.0f, "ct", 1));
        addParam(floatParam ("body",     "Body",         0.0f, 100.0f, 50.0f, "%", 0));
        addParam(logParam   ("hpf",      "HP Freq",      40.0f, 400.0f, 90.0f, "Hz", 0));
        addParam(floatParam ("wavemix",  "Wave Mix",     0.0f, 100.0f, 35.0f, "%", 0));
        addParam(choiceParam("fmratio",  "FM Ratio",     {"x0.5", "x1", "x2", "x3", "x4"}, 2));
        addParam(floatParam ("fmindex",  "FM Index",     0.2f, 6.0f, 3.0f, "", 2));
        addParam(floatParam ("sub",      "Sub",          0.0f, 100.0f, 25.0f, "%", 0));
        addParam(floatParam ("vowel",    "Vowel",        2.0f, 12.0f, 4.0f, "", 1));
        addParam(floatParam ("morph",    "Morph",        0.0f, 100.0f, 40.0f, "%", 0));
        addParam(floatParam ("sweep",    "Sweep",        -100.0f, 100.0f, 50.0f, "%", 0));
        addParam(choiceParam("mode",     "Mode",         {"Poly", "Mono"}, 0));
        addParam(floatParam ("glide",    "Glide",        0.0f, 1000.0f, 0.0f, "ms", 0, 0.5f));
        addParam(intParam   ("bend",     "Bend Range",   0, 24, 2, "st"));
        addParam(floatParam ("velsens",  "Velocity",     0.0f, 100.0f, 60.0f, "%", 0));
        addParam(floatParam ("keytrk",   "Key Track",    0.0f, 100.0f, 40.0f, "%", 0));

        if (numParams() != kNumParams) mpc::log("RadarSynth: parameter count mismatch (%d vs %d)", numParams(), (int)kNumParams);

        // Factory programs: start from the defaults and override a few values (plain values, see the enum above).
        auto program = [this](const char* name, std::initializer_list<std::pair<int, float>> overrides)
        {
            std::vector<float> v((size_t)numParams());
            for (int i = 0; i < numParams(); ++i) v[(size_t)i] = param(i).def;
            for (const auto& o : overrides) v[(size_t)o.first] = o.second;
            addProgram(name, std::move(v));
        };
        program("Init Prophet", {});
        program("Electro Bass", {{kEngine, kProphet}, {kCutoff, 500}, {kResonance, 35}, {kEnvAmount, 70}, {kDrive, 45}, {kFDecay, 200},
                                 {kDecay, 300}, {kSustain, 70}, {kRelease, 90}, {kDetune, 14}, {kBody, 70}, {kMode, 1}, {kGlide, 40}});
        program("MS-20 Acid", {{kEngine, kMs20}, {kCutoff, 450}, {kResonance, 75}, {kEnvAmount, 90}, {kDrive, 55}, {kFDecay, 180},
                               {kDecay, 220}, {kSustain, 60}, {kRelease, 70}, {kWaveMix, 80}, {kHpFreq, 70}, {kMode, 1}, {kGlide, 60}});
        program("DX Pluck", {{kEngine, kDx}, {kCutoff, 3000}, {kEnvAmount, 60}, {kFDecay, 160}, {kFmRatio, 2}, {kFmIndex, 3.2f}, {kSub, 30},
                             {kDecay, 350}, {kSustain, 0}, {kRelease, 150}});
        program("FM Bell", {{kEngine, kDx}, {kCutoff, 6000}, {kEnvAmount, 80}, {kFDecay, 900}, {kFmRatio, 3}, {kFmIndex, 4.5f}, {kSub, 0},
                            {kAttack, 2}, {kDecay, 1500}, {kSustain, 0}, {kRelease, 900}});
        program("Vowel Pad", {{kEngine, kWavetable}, {kCutoff, 2500}, {kResonance, 15}, {kEnvAmount, 30}, {kFAttack, 400}, {kFDecay, 1200}, {kFSustain, 40},
                              {kAttack, 500}, {kDecay, 900}, {kSustain, 90}, {kRelease, 900}, {kVowel, 5}, {kMorph, 30}, {kSweep, 70}});
        program("Hollow Lead", {{kEngine, kWavetable}, {kCutoff, 4000}, {kResonance, 30}, {kEnvAmount, 20}, {kFDecay, 500}, {kVowel, 8.5f},
                                {kMorph, 60}, {kSweep, -40}, {kMode, 1}, {kGlide, 80}});
        program("Fat Poly", {{kEngine, kProphet}, {kCutoff, 1200}, {kResonance, 20}, {kEnvAmount, 45}, {kFDecay, 450}, {kFSustain, 10},
                             {kAttack, 15}, {kDecay, 600}, {kSustain, 80}, {kRelease, 350}, {kDetune, 18}, {kBody, 40}});
    }

    // ----- lifecycle --------------------------------------------------------
    void prepare(double sampleRate, int /*maxBlockSize*/) override
    {
        sr_ = sampleRate;
        for (auto& v : voices_)
        {
            v.o1.setSampleRate(sampleRate); v.o2.setSampleRate(sampleRate); v.o3.setSampleRate(sampleRate);
            v.car.setSampleRate(sampleRate); v.mod.setSampleRate(sampleRate); v.body.setSampleRate(sampleRate); v.subo.setSampleRate(sampleRate);
            v.f1.setSampleRate(sampleRate); v.f2.setSampleRate(sampleRate);
            v.ampEnv.setSampleRate(sampleRate); v.filtEnv.setSampleRate(sampleRate);
        }
        controllers_.prepare(sampleRate, 10.0f);
        volume_.setTime(10.0f, sampleRate);
        volume_.snap(dbToGain(get(kVolume)));
        buildFormant(get(kVowel));
    }

    void reset() override
    {
        for (auto& v : voices_) { v.ampEnv.reset(); v.filtEnv.reset(); v.f1.reset(); v.f2.reset(); v.note = -1; }
        poly_.reset(); mono_.reset();
        controllers_.reset();
        volume_.snap(dbToGain(get(kVolume)));
    }

    // ----- audio ------------------------------------------------------------
    void process(mpc::ProcessContext& ctx) override
    {
        updateBlockSettings(ctx);
        int pos = 0;
        for (int e = 0; e < ctx.numMidiEvents; ++e)
        {
            const mpc::MidiEvent& ev = ctx.midi[e];
            if (ev.sampleOffset > pos) { render(ctx, pos, ev.sampleOffset); pos = ev.sampleOffset; }
            handleMidi(ev);
        }
        render(ctx, pos, ctx.numFrames);

        float* L = ctx.outputs[0];
        float* R = ctx.numOutputs > 1 ? ctx.outputs[1] : nullptr;
        for (int i = 0; i < ctx.numFrames; ++i)
        {
            const float g = volume_.process();
            L[i] *= g;
            if (R) R[i] = L[i];
        }
    }

private:
    static constexpr int kNumVoices = 8;
    static constexpr int kChunk = 64;         // max samples rendered per inner loop
    static constexpr int kCtrlInterval = 32;  // samples between coefficient updates (0.7 ms: tan/pow cost is spread thinly)
    static constexpr int kTabSize = 1024;
    static constexpr int kTabLevels = 5;      // harmonic limits 48, 24, 12, 6, 3 (band-limiting by pitch)

    struct Voice
    {
        PolyBlepOsc o1, o2, o3;               // Prophet saws / MS-20 square + saw / Wavetable saw
        WavetableSine car, mod, body, subo;   // DX carrier + modulator, "body" sine, sub sine
        SVF f1, f2;
        ADSR ampEnv, filtEnv;
        Smoother glide;                       // smooths the MIDI note number
        int note = -1;
        bool accent = false;
        float velGain = 1.0f;
        int ctrl = 0;
        float wtPhase = 0.0f;                 // formant oscillator phase
        float morphPos = 0.0f, morphInc = 0.0f, morphTarget = 0.0f;
        float hz = 110.0f;
    };

    struct Settings
    {
        int engine = 0;
        float cutoff, reso, envAmt, driveN, keyTrack, velSens, glideMs;
        float detune, body, hpf, waveMix, fmIndex, sub, vowel, morph, sweep;
        float fmRatio;
        bool mono;
    } s_{};

    void updateBlockSettings(mpc::ProcessContext& ctx)
    {
        static const float kRatios[5] = {0.5f, 1.0f, 2.0f, 3.0f, 4.0f};
        s_.engine = getInt(kEngine);
        s_.cutoff = get(kCutoff); s_.reso = get(kResonance) * 0.01f; s_.envAmt = get(kEnvAmount) * 0.01f;
        s_.driveN = get(kDrive) * 0.01f; s_.keyTrack = get(kKeyTrack) * 0.01f; s_.velSens = get(kVelSens) * 0.01f;
        s_.glideMs = get(kGlide); s_.mono = getInt(kMode) == 1;
        s_.detune = get(kDetune); s_.body = get(kBody) * 0.01f; s_.hpf = get(kHpFreq); s_.waveMix = get(kWaveMix) * 0.01f;
        s_.fmRatio = kRatios[clamp(getInt(kFmRatio), 0, 4)];
        s_.fmIndex = get(kFmIndex); s_.sub = get(kSub) * 0.01f;
        s_.vowel = get(kVowel); s_.morph = get(kMorph) * 0.01f; s_.sweep = get(kSweep) * 0.01f;

        poly_.setBendRange((float)getInt(kBendRange)); mono_.setBendRange((float)getInt(kBendRange));
        volume_.setTarget(dbToGain(get(kVolume)));
        if (s_.engine == kWavetable && std::fabs(s_.vowel - tabVowel_) > 0.05f) buildFormant(s_.vowel);

        const float fa = get(kFAttack), fd = get(kFDecay), fs = get(kFSustain) * 0.01f, fr = get(kFRelease);
        const float aa = get(kAttack),  ad = get(kDecay),  as = get(kSustain) * 0.01f,  ar = get(kRelease);
        for (auto& v : voices_)
        {
            v.ampEnv.set(aa, ad, as, ar);
            v.filtEnv.set(fa, fd * (v.accent ? 1.3f : 1.0f), fs, fr);
            v.glide.setTime(s_.glideMs, ctx.sampleRate);
        }
        (void)ctx;
    }

    // ----- MIDI -------------------------------------------------------------
    void handleMidi(const mpc::MidiEvent& ev)
    {
        if (s_.mono) handleWith(mono_, ev, true); else handleWith(poly_, ev, false);
        if (ev.isPitchBend()) { poly_.setPitchBend(ev.pitchBend()); mono_.setPitchBend(ev.pitchBend()); }
        else if (!ev.isNoteOn() && !ev.isNoteOff() && !ev.isAllNotesOff() && !(ev.isController() && ev.controller() == cc::Sustain))
            controllers_.handle(ev);
    }

    template <typename Alloc>
    void handleWith(Alloc& alloc, const mpc::MidiEvent& ev, bool mono)
    {
        if (ev.isNoteOn())
        {
            const int lastNote = alloc.lastNote();
            const int vi = alloc.noteOn(ev.note(), ev.velocity());
            Voice& v = voices_[vi];
            const bool wasSounding = v.ampEnv.isActive(), wasHeld = v.ampEnv.isHeld();
            v.note = ev.note();
            v.accent = ev.velocity() >= 110;
            v.velGain = lerp(1.0f, ev.velocity() / 127.0f, s_.velSens);
            if (s_.glideMs > 0.0f && lastNote >= 0) { if (!wasSounding) v.glide.snap((float)lastNote); v.glide.setTarget((float)ev.note()); }
            else v.glide.snap((float)ev.note());
            if (!wasSounding)
            {
                v.o1.resetPhase(); v.o2.resetPhase(0.25f); v.o3.resetPhase(0.5f);
                v.car.resetPhase(); v.mod.resetPhase(); v.body.resetPhase(); v.subo.resetPhase(); v.wtPhase = 0.0f;
                v.f1.reset(); v.f2.reset();
            }
            if (!(mono && wasHeld))      // mono legato: a new note while another is held only glides, no envelope retrigger
            {
                v.ampEnv.noteOn(); v.filtEnv.noteOn();
                startMorph(v);
            }
            v.ctrl = 0;
        }
        else if (ev.isNoteOff())
        {
            const int vi = alloc.noteOff(ev.note());
            if (vi >= 0) releaseVoice(vi);
        }
        else if (ev.isAllNotesOff()) alloc.allNotesOff([this](int vi) { releaseVoice(vi); });
        else if (ev.isController() && ev.controller() == cc::Sustain)
        {
            controllers_.handle(ev);
            alloc.setSustain(ev.controllerValue() >= 64, [this](int vi) { releaseVoice(vi); });
        }
    }

    void releaseVoice(int vi) { voices_[vi].ampEnv.noteOff(); voices_[vi].filtEnv.noteOff(); }

    // Wavetable morph: from the Morph position towards Morph + Sweep over twice the filter decay.
    void startMorph(Voice& v)
    {
        const float to = clamp(s_.morph + s_.sweep * 0.8f, 0.0f, 1.0f);
        const float dur = std::fmax(0.01f, get(kFDecay) * 0.001f * (v.accent ? 1.3f : 1.0f) * 2.0f);
        v.morphPos = s_.morph; v.morphTarget = to;
        v.morphInc = (to - s_.morph) / (dur * (float)sr_);
    }

    // ----- rendering --------------------------------------------------------
    void render(mpc::ProcessContext& ctx, int from, int to)
    {
        float* out = ctx.outputs[0];
        while (from < to)
        {
            const int n = (to - from) < kChunk ? (to - from) : kChunk;
            for (int i = 0; i < n; ++i) controllers_.tick();
            for (int vi = 0; vi < kNumVoices; ++vi)
            {
                Voice& v = voices_[vi];
                if (!v.ampEnv.isActive()) continue;
                switch (s_.engine)
                {
                    case kMs20:      renderMs20(v, out + from, n); break;
                    case kDx:        renderDx(v, out + from, n); break;
                    case kWavetable: renderWavetable(v, out + from, n); break;
                    case kProphet:
                    default:         renderProphet(v, out + from, n); break;
                }
                if (!v.ampEnv.isActive()) { poly_.voiceFinished(vi); mono_.voiceFinished(vi); }
            }
            from += n;
        }
    }

    // Per-voice control-rate values shared by all engines: pitch (with bend), cutoff after envelope and key tracking.
    void controlRate(Voice& v, float fenv, float& cutoff, float& hz)
    {
        const float note = v.glide.value();
        hz = poly_.noteToHz(note);
        const float amt = s_.envAmt * (v.accent ? 1.5f : 1.0f);
        const float octaves = amt * fenv * 5.0f + s_.keyTrack * (note - 60.0f) / 12.0f;
        cutoff = s_.cutoff * std::pow(2.0f, clamp(octaves, -8.0f, 8.0f));
        v.hz = hz;
    }

    static float sat(float x, float k, float norm) { return fastTanh(k * x) * norm; }

    void renderProphet(Voice& v, float* out, int n)
    {
        const float drv = 0.5f + 3.5f * s_.driveN, norm = 1.0f / fastTanh(1.6f);
        float cutoff = s_.cutoff, hz = v.hz;
        for (int i = 0; i < n; ++i)
        {
            const float fenv = v.filtEnv.process(), aenv = v.ampEnv.process();
            if ((v.ctrl++ % kCtrlInterval) == 0)
            {
                controlRate(v, fenv, cutoff, hz);
                v.o1.setFrequency(hz * centsToRatio(-s_.detune)); v.o2.setFrequency(hz); v.o3.setFrequency(hz * centsToRatio(s_.detune));
                v.body.setFrequency(hz);
                v.f1.set(cutoff, s_.reso * 0.7f); v.f2.set(cutoff, s_.reso * 0.4f);
            }
            v.glide.process();
            const float saws = (v.o1.process() + v.o2.process() + v.o3.process()) * 0.38f;
            const float filt = v.f2.process(v.f1.process(saws, SVF::Mode::Lowpass), SVF::Mode::Lowpass);
            const float x = (filt + v.body.process() * s_.body * 0.6f) * aenv;
            out[i] += sat(x * drv, 1.6f, norm) * v.velGain * 0.4f;
        }
    }

    void renderMs20(Voice& v, float* out, int n)
    {
        const float pre = (1.0f + 7.0f * s_.driveN) / 3.0f, norm = 1.0f / fastTanh(3.0f);
        float cutoff = s_.cutoff, hz = v.hz;
        for (int i = 0; i < n; ++i)
        {
            const float fenv = v.filtEnv.process(), aenv = v.ampEnv.process();
            if ((v.ctrl++ % kCtrlInterval) == 0)
            {
                controlRate(v, fenv, cutoff, hz);
                v.o1.setWave(Wave::Square); v.o2.setWave(Wave::Saw);
                v.o1.setFrequency(hz); v.o2.setFrequency(hz); v.body.setFrequency(hz);
                v.f1.set(s_.hpf, 0.55f); v.f2.set(cutoff, clamp(s_.reso * 1.3f, 0.0f, 1.0f));
            }
            v.glide.process();
            const float mix = (v.o1.process() * (1.0f - s_.waveMix) + v.o2.process() * s_.waveMix) * 0.7f;
            const float hp = v.f1.process(mix, SVF::Mode::Highpass);
            const float lp = v.f2.process(hp, SVF::Mode::Lowpass);
            const float x = sat(lp * pre, 3.0f, norm) + v.body.process() * 0.3f;
            out[i] += x * aenv * v.velGain * 0.3f;
        }
    }

    void renderDx(Voice& v, float* out, int n)
    {
        const float drv = 0.5f + 3.5f * s_.driveN, norm = 1.0f / fastTanh(2.0f);
        float cutoff = s_.cutoff, hz = v.hz, betaEnd = 1.0f, betaStart = 1.0f;
        for (int i = 0; i < n; ++i)
        {
            const float fenv = v.filtEnv.process(), aenv = v.ampEnv.process();
            if ((v.ctrl++ % kCtrlInterval) == 0)
            {
                controlRate(v, fenv, cutoff, hz);
                // Index: parameter plus brightness from the cutoff (as in radarxxx); the filter envelope shapes it.
                const float bright = clamp(std::log(s_.cutoff / 60.0f) / std::log(100.0f), 0.0f, 1.0f);
                const float idx = s_.fmIndex + 3.0f * bright;
                betaEnd = 0.3f * idx / s_.fmRatio;
                betaStart = idx * (0.5f + 0.8f * 3.0f * clamp(s_.envAmt, 0.0f, 1.0f)) * (v.accent ? 1.4f : 1.0f) / s_.fmRatio;
                v.car.setFrequency(hz); v.mod.setFrequency(hz * s_.fmRatio); v.subo.setFrequency(hz * 0.5f);
            }
            v.glide.process();
            const float beta = betaEnd + (betaStart - betaEnd) * fenv;
            const float y = v.car.process(beta * (1.0f / kTwoPi) * v.mod.process()) + v.subo.process() * s_.sub * 0.8f;
            out[i] += sat(y * aenv * drv, 2.0f, norm) * v.velGain * 0.35f;
        }
    }

    void renderWavetable(Voice& v, float* out, int n)
    {
        const float drv = 0.5f + 3.5f * s_.driveN, norm = 1.0f / fastTanh(1.8f);
        float cutoff = s_.cutoff, hz = v.hz, inc = 0.0f;
        int level = 0;
        for (int i = 0; i < n; ++i)
        {
            const float fenv = v.filtEnv.process(), aenv = v.ampEnv.process();
            if ((v.ctrl++ % kCtrlInterval) == 0)
            {
                controlRate(v, fenv, cutoff, hz);
                v.o1.setWave(Wave::Saw); v.o1.setFrequency(hz); v.body.setFrequency(hz);
                inc = hz / (float)sr_;
                const int maxHarm = (int)(0.45f * (float)sr_ / std::fmax(hz, 20.0f));
                level = maxHarm >= 48 ? 0 : maxHarm >= 24 ? 1 : maxHarm >= 12 ? 2 : maxHarm >= 6 ? 3 : 4;
                v.f1.set(cutoff, s_.reso * 0.5f);
            }
            v.glide.process();
            // Morph moves linearly from its start towards its target during the note.
            if (v.morphInc != 0.0f)
            {
                v.morphPos += v.morphInc;
                if ((v.morphInc > 0.0f && v.morphPos >= v.morphTarget) || (v.morphInc < 0.0f && v.morphPos <= v.morphTarget)) { v.morphPos = v.morphTarget; v.morphInc = 0.0f; }
            }
            const float m = v.morphPos;
            const float vow = formant(level, v.wtPhase);
            v.wtPhase += inc; if (v.wtPhase >= 1.0f) v.wtPhase -= 1.0f;
            const float sig = v.o1.process() * (1.0f - m) * 0.8f + vow * m * 0.8f;
            const float filt = v.f1.process(sig, SVF::Mode::Lowpass);
            const float x = (filt + v.body.process() * 0.25f) * aenv;
            out[i] += sat(x * drv, 1.8f, norm) * v.velGain * 0.4f;
        }
    }

    // ----- formant wavetable (shared by all voices) --------------------------
    // Table k holds harmonics up to 48 >> k with two formant peaks (like radarxxx: one at harmonic `vowel`, one at 2.5x).
    // Built with the Chebyshev recurrence (no sin() in the loops) and rebuilt only when the Vowel parameter moves.
    void buildFormant(float vowel)
    {
        tabVowel_ = vowel;
        for (int k = 0; k < kTabLevels; ++k)
        {
            const int harm = 48 >> k;
            float amp[49];
            for (int h = 1; h <= harm; ++h)
            {
                const float d1 = (float)h - vowel, d2 = (float)h - vowel * 2.5f;
                amp[h] = (std::exp(-d1 * d1 / 3.0f) + 0.6f * std::exp(-d2 * d2 / 6.0f)) / std::sqrt((float)h);
            }
            float peak = 1.0e-6f;
            for (int i = 0; i < kTabSize; ++i)
            {
                const float x = kTwoPi * (float)i / (float)kTabSize, c2 = 2.0f * std::cos(x);
                float s0 = std::sin(x), sm1 = 0.0f, acc = 0.0f;       // sin(1x), sin(0x); recurrence gives sin(hx)
                for (int h = 1; h <= harm; ++h)
                {
                    acc += amp[h] * s0;
                    const float sn = c2 * s0 - sm1; sm1 = s0; s0 = sn;
                }
                formantTab_[k][i] = acc;
                peak = std::fmax(peak, std::fabs(acc));
            }
            for (int i = 0; i < kTabSize; ++i) formantTab_[k][i] /= peak;
            formantTab_[k][kTabSize] = formantTab_[k][0];
        }
    }

    float formant(int level, float phase) const
    {
        const float p = phase * (float)kTabSize;
        const int i = (int)p;
        const float f = p - (float)i;
        const float* t = formantTab_[level];
        return t[i] + f * (t[i + 1] - t[i]);
    }

    Voice voices_[kNumVoices];
    VoiceAllocator<kNumVoices> poly_;
    VoiceAllocator<1> mono_;
    MidiControllers controllers_;
    Smoother volume_;
    double sr_ = 44100.0;
    float tabVowel_ = -1.0f;
    float formantTab_[kTabLevels][kTabSize + 1] = {};
};

MPC_PLUGIN_ENTRY(RadarSynth)
