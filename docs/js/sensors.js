// Czujniki: żyroskop (deviceorientation) i potrząśnięcie (devicemotion).
// Mapowanie jest czystą funkcją, żeby dało się je testować bez przeglądarki.

export const RANGE_DEG = 30;   // ±30° od pozycji zerowej = pełny zakres pada

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// base = {beta, gamma} z chwili zerowania. Zwraca pozycję pada 0..1 (y: góra = 1).
export function tiltToXY(beta, gamma, base) {
  const x = 0.5 + (gamma - base.gamma) / (2 * RANGE_DEG);
  const y = 0.5 - (beta - base.beta) / (2 * RANGE_DEG);
  return { x: clamp01(x), y: clamp01(y) };
}

export function isShake(ax, ay, az, threshold = 22) {
  return Math.hypot(ax, ay, az) > threshold;   // m/s², z grawitacją ≈ 9.8 w spoczynku
}

export class Sensors {
  constructor({ onTilt, onShake }) {
    this.onTilt = onTilt;
    this.onShake = onShake;
    this.active = false;
    this.base = null;
    this.last = null;
    this.smooth = null;
    this.lastShake = 0;
    this._ori = (e) => this._handleOrientation(e);
    this._mot = (e) => this._handleMotion(e);
  }

  static supported() {
    return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  }

  // Musi być wywołane z gestu użytkownika (wymóg iOS). Zwraca true, gdy dane naprawdę płyną.
  async enable() {
    const needsPerm = (C) => C && typeof C.requestPermission === 'function';
    try {
      if (needsPerm(window.DeviceOrientationEvent)) {
        const r = await window.DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') return false;
      }
      if (needsPerm(window.DeviceMotionEvent)) {
        await window.DeviceMotionEvent.requestPermission().catch(() => {});
      }
    } catch { return false; }

    this.base = null; this.smooth = null; this.last = null;
    window.addEventListener('deviceorientation', this._ori);
    window.addEventListener('devicemotion', this._mot);
    this.active = true;

    // Komputery wystawiają API, ale nie wysyłają zdarzeń z wartościami.
    const ok = await new Promise((res) => {
      const t0 = performance.now();
      const poll = () => {
        if (this.last) return res(true);
        if (performance.now() - t0 > 1500) return res(false);
        setTimeout(poll, 50);
      };
      poll();
    });
    if (!ok) this.disable();
    return ok;
  }

  disable() {
    window.removeEventListener('deviceorientation', this._ori);
    window.removeEventListener('devicemotion', this._mot);
    this.active = false;
  }

  zero() { if (this.last) this.base = { ...this.last }; this.smooth = null; }

  _handleOrientation(e) {
    if (e.beta == null || e.gamma == null) return;
    this.last = { beta: e.beta, gamma: e.gamma };
    if (!this.base) this.base = { ...this.last };
    const t = tiltToXY(e.beta, e.gamma, this.base);
    // wygładzanie, żeby drżenie ręki nie szarpało filtrem
    this.smooth = this.smooth
      ? { x: this.smooth.x + (t.x - this.smooth.x) * 0.2, y: this.smooth.y + (t.y - this.smooth.y) * 0.2 }
      : t;
    this.onTilt(this.smooth);
  }

  _handleMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a) return;
    const now = performance.now();
    if (now - this.lastShake > 600 && isShake(a.x || 0, a.y || 0, a.z || 0)) {
      this.lastShake = now;
      this.onShake();
    }
  }
}
