// Potencjometr obrotowy (SVG). Sterowanie: przeciąganie w pionie (palec lub mysz), podwójne dotknięcie = wartość domyślna,
// kółko myszy i strzałki na klawiaturze. Element udaje suwak: ma właściwość `value` i wysyła zdarzenie 'input'.
// Matematyka jest w czystych funkcjach (testowana w node), DOM tylko w makeKnob().

export const SWEEP = 270;              // zakres obrotu w stopniach (od -135° do +135°, 0° = góra)
export const PX_FULL = 170;            // tyle pikseli przeciągnięcia = cały zakres
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function snap(v, min, max, step) {
  const s = Math.round((v - min) / step) * step + min;
  return clamp(+s.toFixed(6), min, max);
}
export const toNorm = (v, min, max) => (v - min) / (max - min);
export const fromNorm = (n, min, max) => min + clamp(n, 0, 1) * (max - min);

// Przeciągnięcie w górę zwiększa wartość. `fine` = 4x wolniej (shift na komputerze).
export function dragNorm(startNorm, dyPx, fine = false) {
  return clamp(startNorm - dyPx / (PX_FULL * (fine ? 4 : 1)), 0, 1);
}
export const angleFor = (n) => -SWEEP / 2 + SWEEP * clamp(n, 0, 1);

const pt = (cx, cy, r, a) => [cx + r * Math.sin((a * Math.PI) / 180), cy - r * Math.cos((a * Math.PI) / 180)];
export function arcPath(cx, cy, r, a0, a1) {
  if (a1 - a0 < 0.01) { const [x, y] = pt(cx, cy, r, a0); return `M${x.toFixed(2)} ${y.toFixed(2)}`; }
  const [x0, y0] = pt(cx, cy, r, a0), [x1, y1] = pt(cx, cy, r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export const FORMATS = {
  pct: (v) => `${Math.round(v * 100)}%`,
  num: (v) => (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2)),
  x: (v) => `${v.toFixed(2)}×`,
  ms: (v) => `${Math.round(v)} ms`,
};

// host: <div> (dostaje klasę knob). opts: label, min, max, step, value, def, fmt ('pct'|'num'|...) albo funkcja, show(v)->tekst.
export function makeKnob(host, opts) {
  const { label = '', min = 0, max = 1, step = 0.01 } = opts;
  const def = opts.def ?? opts.value ?? min;
  const fmt = typeof opts.fmt === 'function' ? opts.fmt : FORMATS[opts.fmt] ?? FORMATS.num;
  let val = snap(opts.value ?? def, min, max, step);

  host.classList.add('knob');
  host.tabIndex = 0;
  host.setAttribute('role', 'slider');
  host.setAttribute('aria-label', label);
  host.setAttribute('aria-valuemin', min);
  host.setAttribute('aria-valuemax', max);
  host.innerHTML = `<span class="kv"></span><svg viewBox="0 0 48 48" aria-hidden="true"><path class="tr"/><path class="va"/><line class="pt"/></svg><span class="kl"></span>`;
  const kv = host.querySelector('.kv'), tr = host.querySelector('.tr'), va = host.querySelector('.va'), ln = host.querySelector('.pt');
  host.querySelector('.kl').textContent = label;
  tr.setAttribute('d', arcPath(24, 24, 18, -SWEEP / 2, SWEEP / 2));

  function draw() {
    const n = toNorm(val, min, max), a = angleFor(n);
    va.setAttribute('d', arcPath(24, 24, 18, -SWEEP / 2, a));
    const [x0, y0] = pt(24, 24, 7, a), [x1, y1] = pt(24, 24, 14, a);
    ln.setAttribute('x1', x0); ln.setAttribute('y1', y0); ln.setAttribute('x2', x1); ln.setAttribute('y2', y1);
    kv.textContent = opts.show ? opts.show(val) : fmt(val);
    host.setAttribute('aria-valuenow', val);
    host.setAttribute('aria-valuetext', kv.textContent);
  }
  const emit = () => host.dispatchEvent(new Event('input', { bubbles: true }));
  function setUser(v) { const nv = snap(v, min, max, step); if (nv !== val) { val = nv; draw(); emit(); } }

  Object.defineProperty(host, 'value', {
    get: () => val,
    set: (v) => { val = snap(+v, min, max, step); draw(); },   // jak w suwaku: ustawienie z kodu nie wysyła 'input'
    configurable: true,
  });
  host.reset = () => setUser(def);

  // Podwójne dotknięcie = reset, ale tylko gdy oba dotknięcia były krótkie i bez ruchu.
  // Dwa szybkie przeciągnięcia pod rząd nie mogą zresetować pokrętła.
  const TAP_MOVE_PX = 6, DOUBLE_MS = 320;
  let startY = 0, startN = 0, dragging = false, lastTapEnd = 0;
  host.addEventListener('pointerdown', (e) => {
    // Dotyk na podpisie ma przewijać stronę (touch-action: pan-y), kręci się tylko za samo pokrętło i wartość.
    if (e.pointerType !== 'mouse' && !e.target.closest('svg, .kv')) return;
    if (e.timeStamp - lastTapEnd < DOUBLE_MS) { lastTapEnd = 0; host.reset(); return; }
    dragging = true; startY = e.clientY; startN = toNorm(val, min, max);
    host.setPointerCapture(e.pointerId); host.classList.add('drag');
  });
  host.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    setUser(fromNorm(dragNorm(startN, e.clientY - startY, e.shiftKey), min, max));
  });
  host.addEventListener('pointerup', (e) => {
    if (dragging) lastTapEnd = Math.abs(e.clientY - startY) < TAP_MOVE_PX ? e.timeStamp : 0;
    dragging = false; host.classList.remove('drag');
  });
  host.addEventListener('pointercancel', () => { dragging = false; lastTapEnd = 0; host.classList.remove('drag'); });
  host.addEventListener('dblclick', () => host.reset());
  host.addEventListener('wheel', (e) => { e.preventDefault(); setUser(val + (e.deltaY < 0 ? 1 : -1) * step * (e.shiftKey ? 1 : 5)); }, { passive: false });
  host.addEventListener('keydown', (e) => {
    const big = e.shiftKey ? 10 : 1;
    const k = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (k) { e.preventDefault(); setUser(val + k * step * big * Math.max(1, Math.round((max - min) / step / 50))); }
    else if (e.key === 'Home') { e.preventDefault(); setUser(min); }
    else if (e.key === 'End') { e.preventDefault(); setUser(max); }
    else if (e.key === 'Enter' || e.key === 'Backspace') host.reset();
  });
  draw();
  return host;
}

// Potencjometry zapisane w HTML: <div class="knob" id=".." data-label data-min data-max data-step data-value data-fmt>
export function initKnobs(root = document) {
  root.querySelectorAll('.knob[data-label]').forEach((el) => {
    const d = el.dataset;
    makeKnob(el, { label: d.label, min: +d.min, max: +d.max, step: +d.step, value: +d.value, fmt: d.fmt });
  });
}
