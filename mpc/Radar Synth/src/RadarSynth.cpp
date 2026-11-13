// Radar Synth - an MPC instrument plugin by Adam Brocki
//
// SPDX-License-Identifier: MIT
//
// Four synth engines that always play in parallel on every note, blended with an XY pad
// (the idea of the radarxxx browser instrument; own C++ implementations, see README.md).
//
//   Prophet   : 3 detuned PolyBLEP saws -> 2x SVF lowpass (24 dB) + sine "body" -> drive (tanh)
//   MS-20     : square/saw crossfade -> SVF highpass -> SVF lowpass -> pre-drive + tanh, + sine body
//   DX        : 2-operator FM (ratio, index decaying with the filter envelope) + sub sine
//   Wavetable : PolyBLEP saw morphing into a formant ("vowel") wavetable, morph sweeps on each note -> SVF lowpass
//
// XY pad corners: Prophet top-left, MS-20 top-right, DX bottom-left, Wavetable bottom-right.
// Each engine also has its own Level and Octave. An engine whose gain is zero is not rendered (costs no CPU).
// Shared: filter envelope (ADSR, amount in octaves), amp envelope, key tracking, velocity, drive, master volume.
// Accent: velocity >= 110 gives a stronger and longer filter envelope (like accents in the radarxxx sequencer).
// 6-voice poly (Voices parameter lowers the limit to save CPU), or mono with glide and last-note priority (releasing a key returns to the key still held).
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
        kMixX, kMixY,
        kCutoff, kResonance, kEnvAmount, kDrive,
        kFAttack, kFDecay, kFSustain, kFRelease,
        kAttack, kDecay, kSustain, kRelease,
        kPLevel, kPOct, kDetune, kBody,                         // Prophet
        kMLevel, kMOct, kHpFreq, kWaveMix,                      // MS-20
        kDLevel, kDOct, kFmRatio, kFmIndex, kSub,               // DX
        kWLevel, kWOct, kVowel, kMorph, kSweep,                 // Wavetable
        kMode, kGlide, kBendRange, kVelSens, kKeyTrack,
        kVoices,
        kNumParams
    };
    enum Engine { kProphet = 0, kMs20, kDx, kWavetable, kNumEngines };

    static mpc::PluginInfo makeInfo()
    {
        mpc::PluginInfo i;
        i.name = "Radar Synth";
        i.vendor = "Adam Brocki";
        i.uniqueId = MPC_FOURCC('R', 'd', 'X', '4');    // must match "uid" in plugin.json
        i.version = 2000;
        i.isInstrument = true;
        i.numInputs = 0;
        i.numOutputs = 2;
        return i;
    }

    RadarSynth() : mpc::Plugin(makeInfo())
    {
        using namespace mpc;
        addParam(floatParam ("vol",      "Volume",       -40.0f, 6.0f, -6.0f, "dB", 1));
        addParam(floatParam ("mixx",     "Mix X",        0.0f, 100.0f, 50.0f, "%", 0));
        addParam(floatParam ("mixy",     "Mix Y",        0.0f, 100.0f, 50.0f, "%", 0));
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
        addParam(floatParam ("plevel",   "Prophet Lvl",  0.0f, 100.0f, 100.0f, "%", 0));
        addParam(intParam   ("poct",     "Prophet Oct",  -2, 2, 0, "oct"));
        addParam(floatParam ("detune",   "Detune",       0.0f, 25.0f, 10.0f, "ct", 1));
        addParam(floatParam ("body",     "Body",         0.0f, 100.0f, 50.0f, "%", 0));
        addParam(floatParam ("mlevel",   "MS-20 Lvl",    0.0f, 100.0f, 100.0f, "%", 0));
        addParam(intParam   ("moct",     "MS-20 Oct",    -2, 2, 0, "oct"));
        addParam(logParam   ("hpf",      "HP Freq",      40.0f, 400.0f, 90.0f, "Hz", 0));
        addParam(floatParam ("wavemix",  "Wave Mix",     0.0f, 100.0f, 35.0f, "%", 0));
        addParam(floatParam ("dlevel",   "DX Lvl",       0.0f, 100.0f, 100.0f, "%", 0));
        addParam(intParam   ("doct",     "DX Oct",       -2, 2, 0, "oct"));
        addParam(choiceParam("fmratio",  "FM Ratio",     {"x0.5", "x1", "x2", "x3", "x4"}, 2));
        addParam(floatParam ("fmindex",  "FM Index",     0.2f, 6.0f, 3.0f, "", 2));
        addParam(floatParam ("sub",      "Sub",          0.0f, 100.0f, 25.0f, "%", 0));
        addParam(floatParam ("wlevel",   "Wave Lvl",     0.0f, 100.0f, 100.0f, "%", 0));
        addParam(intParam   ("woct",     "Wave Oct",     -2, 2, 0, "oct"));
        addParam(floatParam ("vowel",    "Vowel",        2.0f, 12.0f, 4.0f, "", 1));
        addParam(floatParam ("morph",    "Morph",        0.0f, 100.0f, 40.0f, "%", 0));
        addParam(floatParam ("sweep",    "Sweep",        -100.0f, 100.0f, 50.0f, "%", 0));
        addParam(choiceParam("mode",     "Mode",         {"Poly", "Mono"}, 0));
        addParam(floatParam ("glide",    "Glide",        0.0f, 1000.0f, 0.0f, "ms", 0, 0.5f));
        addParam(intParam   ("bend",     "Bend Range",   0, 24, 2, "st"));
        addParam(floatParam ("velsens",  "Velocity",     0.0f, 100.0f, 60.0f, "%", 0));
        addParam(floatParam ("keytrk",   "Key Track",    0.0f, 100.0f, 40.0f, "%", 0));
        addParam(intParam   ("voices",   "Voices",       1, 6, 6, ""));

        if (numParams() != kNumParams) mpc::log("RadarSynth: parameter count mismatch (%d vs %d)", numParams(), (int)kNumParams);

        // Factory programs: start from the defaults and override a few values (plain values, see the enum above).
        auto program = [this](const char* name, std::initializer_list<std::pair<int, float>> overrides)
        {
            std::vector<float> v((size_t)numParams());
            for (int i = 0; i < numParams(); ++i) v[(size_t)i] = param(i).def;
            for (const auto& o : overrides) v[(size_t)o.first] = o.second;
            addProgram(name, std::move(v));
        };
        program("Quad Init", {});                                                        // all four engines, pad in the centre
        program("Electro Bass", {{kMixX, 20}, {kMixY, 65}, {kCutoff, 500}, {kResonance, 35}, {kEnvAmount, 70}, {kDrive, 45}, {kFDecay, 200},
                                 {kDecay, 300}, {kSustain, 70}, {kRelease, 90}, {kDetune, 14}, {kBody, 70}, {kDOct, -1}, {kFmRatio, 1}, {kFmIndex, 1.5f},
                                 {kSub, 60}, {kMode, 1}, {kGlide, 40}});
        program("Acid Corner", {{kMixX, 100}, {kMixY, 100}, {kCutoff, 450}, {kResonance, 75}, {kEnvAmount, 90}, {kDrive, 55}, {kFDecay, 180},
                                {kDecay, 220}, {kSustain, 60}, {kRelease, 70}, {kWaveMix, 80}, {kHpFreq, 70}, {kMode, 1}, {kGlide, 60}});
        program("Prophet Poly", {{kMixX, 0}, {kMixY, 100}, {kCutoff, 1200}, {kResonance, 20}, {kEnvAmount, 45}, {kFDecay, 450}, {kFSustain, 10},
                                 {kAttack, 15}, {kDecay, 600}, {kSustain, 80}, {kRelease, 350}, {kDetune, 18}, {kBody, 40}});
        program("DX Pluck", {{kMixX, 0}, {kMixY, 0}, {kCutoff, 3000}, {kEnvAmount, 60}, {kFDecay, 160}, {kFmRatio, 2}, {kFmIndex, 3.2f}, {kSub, 30},
                             {kDecay, 350}, {kSustain, 0}, {kRelease, 150}});
        program("Vowel Pad", {{kMixX, 100}, {kMixY, 0}, {kCutoff, 2500}, {kResonance, 15}, {kEnvAmount, 30}, {kFAttack, 400}, {kFDecay, 1200}, {kFSustain, 40},
                              {kAttack, 500}, {kDecay, 900}, {kSustain, 90}, {kRelease, 900}, {kVowel, 5}, {kMorph, 30}, {kSweep, 70}});
        program("Saw Wall", {{kMixX, 50}, {kMixY, 100}, {kCutoff, 900}, {kResonance, 30}, {kEnvAmount, 55}, {kDrive, 50}, {kFDecay, 500}, {kFSustain, 20},
                             {kAttack, 8}, {kDecay, 700}, {kSustain, 85}, {kRelease, 300}, {kDetune, 20}, {kMOct, -1}, {kWaveMix, 100}});
        program("Glass Stack", {{kMixX, 50}, {kMixY, 0}, {kCutoff, 6000}, {kEnvAmount, 80}, {kFDecay, 900}, {kFmRatio, 3}, {kFmIndex, 4.5f}, {kSub, 0},
                                {kAttack, 2}, {kDecay, 1500}, {kSustain, 0}, {kRelease, 900}, {kWOct, 1}, {kVowel, 7}, {kMorph, 70}, {kSweep, -50}});
        program("Hollow Lead", {{kMixX, 80}, {kMixY, 30}, {kCutoff, 4000}, {kResonance, 30}, {kEnvAmount, 20}, {kFDecay, 500}, {kVowel, 8.5f},
                                {kMorph, 60}, {kSweep, -40}, {kMode, 1}, {kGlide, 80}});
        program("Octave Layers", {{kMixX, 50}, {kMixY, 50}, {kCutoff, 1500}, {kResonance, 30}, {kEnvAmount, 50}, {kFDecay, 350}, {kMOct, 1},
                                  {kDOct, -1}, {kFmRatio, 1}, {kSub, 50}, {kWOct, 1}, {kDecay, 500}, {kSustain, 70}, {kRelease, 250}});
    }

    // ----- lifecycle --------------------------------------------------------
    void prepare(double sampleRate, int /*maxBlockSize*/) override
    {
        sr_ = sampleRate;
        for (auto& v : voices_)
        {
            v.pS1.setSampleRate(sampleRate); v.pS2.setSampleRate(sampleRate); v.pS3.setSampleRate(sampleRate);
            v.mSq.setSampleRate(sampleRate); v.mSaw.setSampleRate(sampleRate); v.wSaw.setSampleRate(sampleRate);
            v.pS1.setWave(Wave::Saw); v.pS2.setWave(Wave::Saw); v.pS3.setWave(Wave::Saw);
            v.mSq.setWave(Wave::Square); v.mSaw.setWave(Wave::Saw); v.wSaw.setWave(Wave::Saw);
            v.pBody.setSampleRate(sampleRate); v.mBody.setSampleRate(sampleRate); v.wBody.setSampleRate(sampleRate);
            v.car.setSampleRate(sampleRate); v.mod.setSampleRate(sampleRate); v.subo.setSampleRate(sampleRate);
            v.pF1.setSampleRate(sampleRate); v.pF2.setSampleRate(sampleRate); v.mHp.setSampleRate(sampleRate);
            v.mLp.setSampleRate(sampleRate); v.wF.setSampleRate(sampleRate);
            v.ampEnv.setSampleRate(sampleRate); v.filtEnv.setSampleRate(sampleRate);
        }
        controllers_.prepare(sampleRate, 10.0f);
        volume_.setTime(10.0f, sampleRate);
        volume_.snap(dbToGain(get(kVolume)));
        for (auto& g : mixGain_) g.setTime(15.0f, sampleRate);
        computeMixTargets();
        for (int e = 0; e < kNumEngines; ++e) mixGain_[e].snap(mixTarget_[e]);
        buildFormant(get(kVowel));
    }

    void reset() override
    {
        for (auto& v : voices_) { v.ampEnv.reset(); v.filtEnv.reset(); resetFilters(v); v.note = -1; }
        poly_.reset();
        monoCount_ = 0; monoPending_ = false; monoLast_ = -1; sustain_ = false;
        controllers_.reset();
        volume_.snap(dbToGain(get(kVolume)));
        computeMixTargets();
        for (int e = 0; e < kNumEngines; ++e) mixGain_[e].snap(mixTarget_[e]);
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
            float x = L[i] * volume_.process();
            const float a = std::fabs(x);                     // soft limiter: transparent below 0.7, never above 1.0
            if (a > 0.7f) x = (x < 0.0f ? -1.0f : 1.0f) * (0.7f + 0.3f * fastTanh((a - 0.7f) * (1.0f / 0.3f)));
            L[i] = x;
            if (R) R[i] = x;
        }
    }

private:
    static constexpr int kNumVoices = 6;
    static constexpr int kChunk = 32;         // samples per control update (0.7 ms): filter/pitch coefficients once per chunk
    static constexpr int kTabSize = 1024;
    static constexpr int kTabLevels = 5;      // harmonic limits 48, 24, 12, 6, 3 (band-limiting by pitch)
    static constexpr int kMonoStack = 16;

    struct Voice
    {
        PolyBlepOsc pS1, pS2, pS3;            // Prophet saws
        PolyBlepOsc mSq, mSaw;                // MS-20 square + saw
        PolyBlepOsc wSaw;                     // Wavetable saw
        WavetableSine pBody, mBody, wBody;    // "body" sines
        WavetableSine car, mod, subo;         // DX carrier + modulator + sub
        SVF pF1, pF2, mHp, mLp, wF;
        ADSR ampEnv, filtEnv;
        Smoother glide;                       // smooths the MIDI note number
        int note = -1;
        bool accent = false, choke = false;   // choke: being faded out quickly because the Voices limit was reached
        unsigned age = 0;
        float velGain = 1.0f;
        float wtPhase = 0.0f;                 // formant oscillator phase
        float morphPos = 0.0f, morphInc = 0.0f, morphTarget = 0.0f;
    };

    struct Settings
    {
        float cutoff, reso, envAmt, driveN, keyTrack, velSens, glideMs;
        float detune, body, hpf, waveMix, fmIndex, sub, vowel, morph, sweep;
        float fmRatio;
        float octMul[kNumEngines];
        int maxVoices;
        bool mono;
    } s_{};

    struct Ctl { float cutoff, hz; };        // per-voice values for one chunk

    // XY pad -> four gains. Bilinear weights to the power 0.75: the centre (all four) is about 3 dB louder than one corner
    // alone, like four unrelated sources; times Level.
    void computeMixTargets()
    {
        const float x = get(kMixX) * 0.01f, y = get(kMixY) * 0.01f;
        const float w[kNumEngines] = {(1.0f - x) * y, x * y, (1.0f - x) * (1.0f - y), x * (1.0f - y)};
        const float lvl[kNumEngines] = {get(kPLevel) * 0.01f, get(kMLevel) * 0.01f, get(kDLevel) * 0.01f, get(kWLevel) * 0.01f};
        for (int e = 0; e < kNumEngines; ++e) { const float r = std::sqrt(w[e]); mixTarget_[e] = r * std::sqrt(r) * lvl[e]; }   // w^0.75
    }

    void updateBlockSettings(mpc::ProcessContext& ctx)
    {
        static const float kRatios[5] = {0.5f, 1.0f, 2.0f, 3.0f, 4.0f};
        static const float kOct[5] = {0.25f, 0.5f, 1.0f, 2.0f, 4.0f};
        s_.cutoff = get(kCutoff); s_.reso = get(kResonance) * 0.01f; s_.envAmt = get(kEnvAmount) * 0.01f;
        s_.driveN = get(kDrive) * 0.01f; s_.keyTrack = get(kKeyTrack) * 0.01f; s_.velSens = get(kVelSens) * 0.01f;
        s_.glideMs = get(kGlide); s_.maxVoices = clamp(getInt(kVoices), 1, kNumVoices);
        s_.detune = get(kDetune); s_.body = get(kBody) * 0.01f; s_.hpf = get(kHpFreq); s_.waveMix = get(kWaveMix) * 0.01f;
        s_.fmRatio = kRatios[clamp(getInt(kFmRatio), 0, 4)];
        s_.fmIndex = get(kFmIndex); s_.sub = get(kSub) * 0.01f;
        s_.vowel = get(kVowel); s_.morph = get(kMorph) * 0.01f; s_.sweep = get(kSweep) * 0.01f;
        s_.octMul[kProphet] = kOct[clamp(getInt(kPOct), -2, 2) + 2]; s_.octMul[kMs20] = kOct[clamp(getInt(kMOct), -2, 2) + 2];
        s_.octMul[kDx] = kOct[clamp(getInt(kDOct), -2, 2) + 2];      s_.octMul[kWavetable] = kOct[clamp(getInt(kWOct), -2, 2) + 2];

        const bool mono = getInt(kMode) == 1;
        if (mono != s_.mono)                  // switching Poly <-> Mono: let everything ring out, start clean
        {
            for (int vi = 0; vi < kNumVoices; ++vi) releaseVoice(vi);
            poly_.reset(); monoCount_ = 0; monoPending_ = false; monoLast_ = -1;
            s_.mono = mono;
        }

        poly_.setBendRange((float)getInt(kBendRange));
        volume_.setTarget(dbToGain(get(kVolume)));
        computeMixTargets();
        for (int e = 0; e < kNumEngines; ++e) mixGain_[e].setTarget(mixTarget_[e]);
        if (mixTarget_[kWavetable] > 0.0f && std::fabs(s_.vowel - tabVowel_) > 0.05f) buildFormant(s_.vowel);

        const float fa = get(kFAttack), fd = get(kFDecay), fs = get(kFSustain) * 0.01f, fr = get(kFRelease);
        const float aa = get(kAttack),  ad = get(kDecay),  as = get(kSustain) * 0.01f,  ar = get(kRelease);
        for (auto& v : voices_)
        {
            v.ampEnv.set(aa, ad, as, v.choke ? 8.0f : ar);
            v.filtEnv.set(fa, fd * (v.accent ? 1.3f : 1.0f), fs, fr);
            v.glide.setTime(s_.glideMs, ctx.sampleRate);
        }
    }

    // ----- MIDI -------------------------------------------------------------
    void handleMidi(const mpc::MidiEvent& ev)
    {
        if (ev.isNoteOn())
        {
            if (s_.mono) monoNoteOn(ev.note(), ev.velocity());
            else
            {
                const int lastNote = poly_.lastNote();
                const int vi = poly_.noteOn(ev.note(), ev.velocity());
                startVoice(voices_[vi], ev.note(), ev.velocity(), lastNote, false);
                limitVoices(vi);
            }
        }
        else if (ev.isNoteOff())
        {
            if (s_.mono) monoNoteOff(ev.note());
            else { const int vi = poly_.noteOff(ev.note()); if (vi >= 0) releaseVoice(vi); }
        }
        else if (ev.isAllNotesOff())
        {
            poly_.allNotesOff([this](int vi) { releaseVoice(vi); });
            monoCount_ = 0; monoPending_ = false;
            releaseVoice(0);
        }
        else if (ev.isController() && ev.controller() == cc::Sustain)
        {
            controllers_.handle(ev);
            sustain_ = ev.controllerValue() >= 64;
            poly_.setSustain(sustain_, [this](int vi) { releaseVoice(vi); });
            if (!sustain_ && s_.mono && monoPending_ && monoCount_ == 0) { monoPending_ = false; releaseVoice(0); }
        }
        else if (ev.isPitchBend()) poly_.setPitchBend(ev.pitchBend());
        else controllers_.handle(ev);
    }

    // legato = true: only glide to the new note, no envelope retrigger.
    void startVoice(Voice& v, int note, int velocity, int lastNote, bool legato)
    {
        const bool wasSounding = v.ampEnv.isActive();
        v.note = note; v.choke = false; v.age = ++ageCounter_;
        if (s_.glideMs > 0.0f && lastNote >= 0) { if (!wasSounding) v.glide.snap((float)lastNote); v.glide.setTarget((float)note); }
        else v.glide.snap((float)note);
        if (legato && wasSounding) return;
        v.accent = velocity >= 110;
        v.velGain = lerp(1.0f, (float)velocity / 127.0f, s_.velSens);
        if (!wasSounding)
        {
            v.pS1.resetPhase(); v.pS2.resetPhase(0.25f); v.pS3.resetPhase(0.5f);
            v.mSq.resetPhase(); v.mSaw.resetPhase(0.25f); v.wSaw.resetPhase();
            v.pBody.resetPhase(); v.mBody.resetPhase(); v.wBody.resetPhase();
            v.car.resetPhase(); v.mod.resetPhase(); v.subo.resetPhase(); v.wtPhase = 0.0f;
            resetFilters(v);
        }
        v.ampEnv.noteOn(); v.filtEnv.noteOn();
        startMorph(v);
    }

    // Voices parameter: when more voices sound than allowed, the oldest ones fade out in a few milliseconds.
    void limitVoices(int keep)
    {
        for (;;)
        {
            int count = 0, oldest = -1;
            for (int vi = 0; vi < kNumVoices; ++vi)
            {
                const Voice& v = voices_[vi];
                if (!v.ampEnv.isActive() || v.choke) continue;
                ++count;
                if (vi != keep && (oldest < 0 || v.age < voices_[oldest].age)) oldest = vi;
            }
            if (count <= s_.maxVoices || oldest < 0) return;
            voices_[oldest].choke = true;
            voices_[oldest].ampEnv.setRelease(8.0f);
            releaseVoice(oldest);
        }
    }

    // Mono: own key stack (last-note priority). A new key while another is held glides without retriggering;
    // releasing the sounding key returns to the most recent key that is still held.
    void monoNoteOn(int note, int velocity)
    {
        monoRemove(note);
        if (monoCount_ == kMonoStack) { for (int i = 1; i < kMonoStack; ++i) monoStack_[i - 1] = monoStack_[i]; --monoCount_; }
        const bool legato = monoCount_ > 0 && voices_[0].ampEnv.isHeld();
        monoStack_[monoCount_++] = note;
        monoPending_ = false;
        startVoice(voices_[0], note, velocity, monoLast_, legato);
        monoLast_ = note;
    }

    void monoNoteOff(int note)
    {
        if (!monoRemove(note)) return;
        Voice& v = voices_[0];
        if (monoCount_ > 0)
        {
            const int back = monoStack_[monoCount_ - 1];
            if (v.note == note) { v.note = back; monoLast_ = back; if (s_.glideMs > 0.0f) v.glide.setTarget((float)back); else v.glide.snap((float)back); }
        }
        else if (sustain_) monoPending_ = true;
        else releaseVoice(0);
    }

    bool monoRemove(int note)
    {
        for (int i = 0; i < monoCount_; ++i)
            if (monoStack_[i] == note)
            {
                for (int k = i + 1; k < monoCount_; ++k) monoStack_[k - 1] = monoStack_[k];
                --monoCount_;
                return true;
            }
        return false;
    }

    void releaseVoice(int vi) { voices_[vi].ampEnv.noteOff(); voices_[vi].filtEnv.noteOff(); }
    static void resetFilters(Voice& v) { v.pF1.reset(); v.pF2.reset(); v.mHp.reset(); v.mLp.reset(); v.wF.reset(); }

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
        float fenv[kChunk], aenv[kChunk];
        while (from < to)
        {
            const int n = (to - from) < kChunk ? (to - from) : kChunk;
            for (int i = 0; i < n; ++i) controllers_.tick();

            // Engine gains ramp linearly across the chunk (no zipper noise when the pad moves).
            float g0[kNumEngines], gStep[kNumEngines];
            bool on[kNumEngines];
            for (int e = 0; e < kNumEngines; ++e)
            {
                g0[e] = mixGain_[e].value();
                for (int i = 0; i < n; ++i) mixGain_[e].process();
                const float g1 = mixGain_[e].value();
                gStep[e] = (g1 - g0[e]) / (float)n;
                on[e] = g0[e] > 1.0e-4f || g1 > 1.0e-4f;
            }

            for (int vi = 0; vi < kNumVoices; ++vi)
            {
                Voice& v = voices_[vi];
                if (!v.ampEnv.isActive()) continue;

                // Per-voice control values, once per chunk: pitch (with bend and glide), cutoff after envelope and key tracking.
                const float note = v.glide.value();
                for (int i = 0; i < n; ++i) { fenv[i] = v.filtEnv.process(); aenv[i] = v.ampEnv.process() * v.velGain; v.glide.process(); }
                Ctl c;
                c.hz = poly_.noteToHz(note);
                const float octaves = s_.envAmt * (v.accent ? 1.5f : 1.0f) * fenv[0] * 5.0f + s_.keyTrack * (note - 60.0f) / 12.0f;
                c.cutoff = s_.cutoff * std::pow(2.0f, clamp(octaves, -8.0f, 8.0f));

                float* o = out + from;
                if (on[kProphet])   renderProphet(v, c, fenv, aenv, o, n, g0[kProphet], gStep[kProphet]);
                if (on[kMs20])      renderMs20(v, c, fenv, aenv, o, n, g0[kMs20], gStep[kMs20]);
                if (on[kDx])        renderDx(v, c, fenv, aenv, o, n, g0[kDx], gStep[kDx]);
                if (on[kWavetable]) renderWavetable(v, c, fenv, aenv, o, n, g0[kWavetable], gStep[kWavetable]);
                else advanceMorph(v, n);

                if (!v.ampEnv.isActive()) poly_.voiceFinished(vi);
            }
            from += n;
        }
    }

    static float sat(float x, float k, float norm) { return fastTanh(k * x) * norm; }
    static float topHz(float hz) { return hz < 12000.0f ? hz : 12000.0f; }       // octave shifts must stay below Nyquist

    void renderProphet(Voice& v, const Ctl& c, const float*, const float* aenv, float* out, int n, float g, float gStep)
    {
        const float drv = 0.5f + 3.5f * s_.driveN, norm = 0.4f / fastTanh(1.6f);
        const float hz = topHz(c.hz * s_.octMul[kProphet]), body = s_.body * 0.6f;
        v.pS1.setFrequency(hz * centsToRatio(-s_.detune)); v.pS2.setFrequency(hz); v.pS3.setFrequency(hz * centsToRatio(s_.detune));
        v.pBody.setFrequency(hz);
        v.pF1.set(c.cutoff, s_.reso * 0.7f); v.pF2.set(c.cutoff, s_.reso * 0.4f);
        for (int i = 0; i < n; ++i, g += gStep)
        {
            const float saws = (v.pS1.process() + v.pS2.process() + v.pS3.process()) * 0.38f;
            const float filt = v.pF2.process(v.pF1.process(saws, SVF::Mode::Lowpass), SVF::Mode::Lowpass);
            const float x = (filt + v.pBody.process() * body) * aenv[i];
            out[i] += sat(x * drv, 1.6f, norm) * g;
        }
    }

    void renderMs20(Voice& v, const Ctl& c, const float*, const float* aenv, float* out, int n, float g, float gStep)
    {
        const float pre = (1.0f + 7.0f * s_.driveN) / 3.0f, norm = 1.0f / fastTanh(3.0f);
        const float hz = topHz(c.hz * s_.octMul[kMs20]);
        const float wSq = (1.0f - s_.waveMix) * 0.7f, wSaw = s_.waveMix * 0.7f;
        v.mSq.setFrequency(hz); v.mSaw.setFrequency(hz); v.mBody.setFrequency(hz);
        v.mHp.set(s_.hpf, 0.55f); v.mLp.set(c.cutoff, clamp(s_.reso * 1.3f, 0.0f, 1.0f));
        for (int i = 0; i < n; ++i, g += gStep)
        {
            const float mix = v.mSq.process() * wSq + v.mSaw.process() * wSaw;
            const float lp = v.mLp.process(v.mHp.process(mix, SVF::Mode::Highpass), SVF::Mode::Lowpass);
            const float x = sat(lp * pre, 3.0f, norm) + v.mBody.process() * 0.3f;
            out[i] += x * aenv[i] * 0.3f * g;
        }
    }

    void renderDx(Voice& v, const Ctl& c, const float* fenv, const float* aenv, float* out, int n, float g, float gStep)
    {
        const float drv = 0.5f + 3.5f * s_.driveN, norm = 0.35f / fastTanh(2.0f);
        const float hz = topHz(c.hz * s_.octMul[kDx]), sub = s_.sub * 0.8f;
        // Index: parameter plus brightness from the cutoff (as in radarxxx); the filter envelope shapes it.
        const float bright = clamp(std::log(s_.cutoff / 60.0f) / std::log(100.0f), 0.0f, 1.0f);
        const float idx = s_.fmIndex + 3.0f * bright;
        const float betaEnd = 0.3f * idx / s_.fmRatio * (1.0f / kTwoPi);
        const float betaStart = idx * (0.5f + 0.8f * 3.0f * clamp(s_.envAmt, 0.0f, 1.0f)) * (v.accent ? 1.4f : 1.0f) / s_.fmRatio * (1.0f / kTwoPi);
        v.car.setFrequency(hz); v.mod.setFrequency(topHz(hz * s_.fmRatio)); v.subo.setFrequency(hz * 0.5f);
        for (int i = 0; i < n; ++i, g += gStep)
        {
            const float beta = betaEnd + (betaStart - betaEnd) * fenv[i];
            const float y = v.car.process(beta * v.mod.process()) + v.subo.process() * sub;
            out[i] += sat(y * aenv[i] * drv, 2.0f, norm) * g;
        }
    }

    void advanceMorph(Voice& v, int n)        // keeps the morph sweep in time while the Wavetable engine is muted
    {
        if (v.morphInc == 0.0f) return;
        v.morphPos += v.morphInc * (float)n;
        if ((v.morphInc > 0.0f && v.morphPos >= v.morphTarget) || (v.morphInc < 0.0f && v.morphPos <= v.morphTarget)) { v.morphPos = v.morphTarget; v.morphInc = 0.0f; }
    }

    void renderWavetable(Voice& v, const Ctl& c, const float*, const float* aenv, float* out, int n, float g, float gStep)
    {
        const float drv = 0.5f + 3.5f * s_.driveN, norm = 0.4f / fastTanh(1.8f);
        const float hz = topHz(c.hz * s_.octMul[kWavetable]);
        v.wSaw.setFrequency(hz); v.wBody.setFrequency(hz);
        const float inc = hz / (float)sr_;
        const int maxHarm = (int)(0.45f * (float)sr_ / std::fmax(hz, 20.0f));
        const int level = maxHarm >= 48 ? 0 : maxHarm >= 24 ? 1 : maxHarm >= 12 ? 2 : maxHarm >= 6 ? 3 : 4;
        v.wF.set(c.cutoff, s_.reso * 0.5f);
        const float m0 = v.morphPos;
        advanceMorph(v, n);
        const float mStep = (v.morphPos - m0) / (float)n;
        float m = m0;
        for (int i = 0; i < n; ++i, g += gStep, m += mStep)
        {
            const float vow = formant(level, v.wtPhase);
            v.wtPhase += inc; if (v.wtPhase >= 1.0f) v.wtPhase -= 1.0f;
            const float sig = (v.wSaw.process() * (1.0f - m) + vow * m) * 0.8f;
            const float x = (v.wF.process(sig, SVF::Mode::Lowpass) + v.wBody.process() * 0.25f) * aenv[i];
            out[i] += sat(x * drv, 1.8f, norm) * g;
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
    int monoStack_[kMonoStack] = {};
    int monoCount_ = 0, monoLast_ = -1;
    bool monoPending_ = false, sustain_ = false;
    unsigned ageCounter_ = 0;
    MidiControllers controllers_;
    Smoother volume_;
    Smoother mixGain_[kNumEngines];
    float mixTarget_[kNumEngines] = {};
    double sr_ = 44100.0;
    float tabVowel_ = -1.0f;
    float formantTab_[kTabLevels][kTabSize + 1] = {};
};

MPC_PLUGIN_ENTRY(RadarSynth)
