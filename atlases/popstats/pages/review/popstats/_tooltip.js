// =============================================================================
// popstats/_tooltip.js
// =============================================================================
// Pointer-tracking tooltip for the popstats track canvases. Ported from
// atlas_page6_wiring.js (turn-6 wiring) but de-globalized: each canvas's
// listener closes over its own payload, so there's no shared WeakMap cache.
//
// Public API
//   attachTooltip(canvas, payload)
//     payload: {
//       trackDef,        // { label, color, yLabel, ... }
//       data,            // { mb: number[], values: number[], series?: [...] }
//       padL, padR,      // canvas padding so we know where the plot starts
//       mbMin, mbMax,    // X-axis range matching the renderer's toX()
//     }
//
//   Re-call this on every renderer pass — the renderer rebuilds canvases
//   each time, so listeners install fresh against the latest payload.
// =============================================================================

let _tooltipEl = null;

function _ensureTooltipEl() {
  if (typeof document === 'undefined') return null;
  if (_tooltipEl && document.body.contains(_tooltipEl)) return _tooltipEl;
  const el = document.createElement('div');
  el.id = 'popstats-hover-tooltip';
  el.style.cssText =
    'position:fixed; pointer-events:none; z-index:9500; ' +
    'background: var(--panel, #fbfcfd); border: 1px solid var(--rule, #c8cdd2); ' +
    'border-radius: 4px; padding: 5px 7px; font-family: var(--mono, monospace); ' +
    'font-size: 10.5px; color: var(--ink, #0e1116); display: none; ' +
    'box-shadow: 0 2px 8px rgba(0,0,0,0.18); max-width: 240px; line-height: 1.45;';
  document.body.appendChild(el);
  _tooltipEl = el;
  return el;
}

export function attachTooltip(canvas, payload) {
  if (!canvas || !payload || !payload.data) return;
  const { data, trackDef, padL = 80, padR = 60, mbMin, mbMax } = payload;
  if (!Array.isArray(data.mb) || data.mb.length === 0) return;

  const onMove = (e) => {
    const rect  = canvas.getBoundingClientRect();
    const x     = e.clientX - rect.left;
    const plotW = rect.width - padL - padR;
    if (plotW <= 0 || x < padL || x > padL + plotW) { _hide(); return; }
    const mbAtX = mbMin + ((x - padL) / plotW) * (mbMax - mbMin);
    let nearest = 0, nearestD = Infinity;
    for (let i = 0; i < data.mb.length; i++) {
      const d = Math.abs(data.mb[i] - mbAtX);
      if (d < nearestD) { nearestD = d; nearest = i; }
    }
    _show(e.clientX, e.clientY, trackDef, data, nearest);
  };
  canvas.addEventListener('pointermove',  onMove);
  canvas.addEventListener('pointerleave', _hide);
}

function _show(x, y, trackDef, data, idx) {
  const el = _ensureTooltipEl();
  if (!el) return;
  const mb = data.mb[idx];
  const lines = [`<span style="opacity:0.7">${_fmtMb(mb)}</span>`];
  if (Array.isArray(data.series)) {
    for (const s of data.series) {
      const v = s.values && s.values[idx];
      const dot = `<span style="display:inline-block;width:8px;height:8px;`
        + `background:${s.color || '#999'};border-radius:2px;margin-right:5px;`
        + `vertical-align:baseline;"></span>`;
      lines.push(`${dot}${s.name}: <b>${_fmtVal(v)}</b>`);
    }
  } else if (Array.isArray(data.values)) {
    const v = data.values[idx];
    const label = (trackDef && (trackDef.label || trackDef.id)) || 'value';
    lines.push(`${label}: <b>${_fmtVal(v)}</b>`);
  }
  el.innerHTML = lines.join('<br>');
  el.style.display = 'block';

  const tw = el.offsetWidth  || 180;
  const th = el.offsetHeight || 60;
  const vw = (typeof window !== 'undefined') ? window.innerWidth  : 1280;
  const vh = (typeof window !== 'undefined') ? window.innerHeight : 800;
  let lx = x + 12, ly = y + 12;
  if (lx + tw > vw - 8) lx = x - tw - 12;
  if (ly + th > vh - 8) ly = y - th - 12;
  el.style.left = `${lx}px`;
  el.style.top  = `${ly}px`;
}

function _hide() {
  if (_tooltipEl) _tooltipEl.style.display = 'none';
}

function _fmtMb(mb) {
  if (!isFinite(mb)) return '?';
  return mb.toFixed(3) + ' Mb';
}
function _fmtVal(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 100)   return n.toFixed(1);
  if (a >= 1)     return n.toFixed(3);
  if (a >= 0.001) return n.toFixed(4);
  if (a === 0)    return '0';
  return n.toExponential(2);
}
