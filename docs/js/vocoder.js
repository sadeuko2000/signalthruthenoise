// Vocoder kanałowy na natywnych węzłach Web Audio (bez AudioWorklet).
// Głos (modulator) przechodzi przez bank filtrów pasmowych; obwiednia każdego pasma
// (|x| -> lowpass) steruje głośnością tego samego pasma sygnału nośnego (bas/lead).
// Dodatkowy tor szumu wysokich częstotliwości dodaje spółgłoski (s, t, k), bez których mowa jest nieczytelna.

export class Vocoder {
  constructor(ctx, { bands = 16, lo = 110, hi = 7000, qScale = 1.5 } = {}) {
    this.ctx = ctx;
    this.input = ctx.createGain();      // tu wchodzi nośnik
    this.output = ctx.createGain();     // tu wychodzi zsyntezowany głos
    this.output.gain.value = 3;         // kompensacja strat po filtracji pasmowej
    this.micIn = ctx.createGain();      // wejście modulatora (mikrofon)
    this.micIn.gain.value = 1;
    this.sens = 40;                     // czułość obwiedni
    this._sensNodes = [];
    this.source = null;
    this.stream = null;

    const r = Math.pow(hi / lo, 1 / bands);
    const q = (1 / (Math.sqrt(r) - 1 / Math.sqrt(r))) * qScale;
    const absCurve = new Float32Array([1, 0, 1]);   // prostownik: -1..1 -> |x|

    for (let i = 0; i < bands; i++) {
      const f = lo * Math.pow(r, i + 0.5);
      const mod = ctx.createBiquadFilter(); mod.type = 'bandpass'; mod.frequency.value = f; mod.Q.value = q;
      const rect = ctx.createWaveShaper(); rect.curve = absCurve;
      const env = ctx.createBiquadFilter(); env.type = 'lowpass'; env.frequency.value = 40;
      const sens = ctx.createGain(); sens.gain.value = this.sens;
      const car = ctx.createBiquadFilter(); car.type = 'bandpass'; car.frequency.value = f; car.Q.value = q;
      const vca = ctx.createGain(); vca.gain.value = 0;   // wartość bazowa 0: całość robi sygnał obwiedni
      this.micIn.connect(mod).connect(rect).connect(env).connect(sens).connect(vca.gain);
      this.input.connect(car).connect(vca).connect(this.output);
      this._sensNodes.push(sens);
    }

    // Tor spółgłosek: szum przepuszczany tylko, gdy w głosie są wysokie częstotliwości.
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource(); this.noise.buffer = noiseBuf; this.noise.loop = true;
    const nhp = ctx.createBiquadFilter(); nhp.type = 'highpass'; nhp.frequency.value = 5000;
    const nvca = ctx.createGain(); nvca.gain.value = 0;
    const mhp = ctx.createBiquadFilter(); mhp.type = 'highpass'; mhp.frequency.value = 5000;
    const mrect = ctx.createWaveShaper(); mrect.curve = absCurve;
    const menv = ctx.createBiquadFilter(); menv.type = 'lowpass'; menv.frequency.value = 40;
    const msens = ctx.createGain(); msens.gain.value = this.sens * 0.5;
    this.micIn.connect(mhp).connect(mrect).connect(menv).connect(msens).connect(nvca.gain);
    this.noise.connect(nhp).connect(nvca).connect(this.output);
    this._sensNodes.push(msens);
    this._noiseSens = msens;
    this.noise.start();

    // Miernik poziomu mikrofonu
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.micIn.connect(this.analyser);
    this._buf = new Float32Array(this.analyser.fftSize);
  }

  // Mikrofon z wyłączoną obróbką: echoCancellation/noiseSuppression/AGC zniekształcają głos
  // i psują działanie vocodera. Musi być wywołane z gestu użytkownika, na HTTPS.
  async connectMic() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    this.stream = stream;
    this.source = this.ctx.createMediaStreamSource(stream);
    this.source.connect(this.micIn);
  }

  disconnectMic() {
    if (this.source) this.source.disconnect();
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.source = this.stream = null;
  }

  setSensitivity(v) {   // v 0..1 -> 8..160
    this.sens = 8 * Math.pow(20, v);
    this._sensNodes.forEach((n) => { n.gain.value = n === this._noiseSens ? this.sens * 0.5 : this.sens; });
  }

  level() {   // RMS 0..1 (przybliżone) do miernika
    this.analyser.getFloatTimeDomainData(this._buf);
    let s = 0;
    for (const x of this._buf) s += x * x;
    return Math.min(1, Math.sqrt(s / this._buf.length) * 6);
  }
}
