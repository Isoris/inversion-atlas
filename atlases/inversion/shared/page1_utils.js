// atlases/inversion/shared/page1_utils.js
//
// Utility functions extracted from legacy/Inversion_atlas.html during
// the local_pca_dosage migration. These are pure helpers — no state dependency —
// so they live in shared/ and can be reused by other pages.
//
// Origin: each function has its legacy line number in a comment for
// auditability. If you find a divergent definition elsewhere in legacy,
// flag it; we want a single source of truth for each.

// ---------------------------------------------------------------------
// Theme + color
// ---------------------------------------------------------------------

const _THEME_FALLBACK_DARK = Object.freeze({
  'bg':         '#0e1116',
  'panel':      '#151a22',
  'panel-2':    '#1c2330',
  'panel-3':    '#2a3242',
  'ink':        '#e7edf3',
  'ink-dim':    '#8a94a3',
  'ink-dimmer': '#5a6472',
  'rule':       '#2a3242',
  'accent':     '#f5a524',
  'dim':        '#8a94a3',
});

const _CSS_VAR_MAP = Object.freeze({
  'bg':         '--bg',
  'panel':      '--panel',
  'panel-2':    '--panel-2',
  'panel-3':    '--panel-3',
  'ink':        '--ink',
  'ink-dim':    '--ink-dim',
  'ink-dimmer': '--ink-dimmer',
  'rule':       '--rule',
  'accent':     '--accent',
  'dim':        '--ink-dim',
});

// Legacy: function themeColor(name)
export function themeColor(name) {
  const fallback = _THEME_FALLBACK_DARK[name] || name;
  if (typeof getComputedStyle !== 'function') return fallback;
  const cssVar = _CSS_VAR_MAP[name];
  if (!cssVar) return name;
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
    return v || fallback;
  } catch (e) {
    return fallback;
  }
}

// Legacy: function withAlpha(col, a)
// Adds alpha to a hex (#rrggbb), 'rgb(...)', or rgba color.
export function withAlpha(col, a) {
  if (!col) return `rgba(160,160,160,${a})`;
  if (col[0] === '#' && col.length === 7) {
    const r = parseInt(col.slice(1, 3), 16);
    const g = parseInt(col.slice(3, 5), 16);
    const b = parseInt(col.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  if (col.indexOf('rgb(') === 0) {
    return col.replace(/^rgb\(/, 'rgba(').replace(/\)$/, `,${a})`);
  }
  return col;
}

// ---------------------------------------------------------------------
// Numeric formatting
// ---------------------------------------------------------------------

// Legacy: function niceTicks(mn, mx, n)
// Returns evenly-spaced ticks at "nice" round values.
export function niceTicks(mn, mx, n) {
  const range = mx - mn, raw = range / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let step;
  if (norm < 1.5) step = 1 * mag;
  else if (norm < 3) step = 2 * mag;
  else if (norm < 7) step = 5 * mag;
  else step = 10 * mag;
  const first = Math.ceil(mn / step) * step;
  const ticks = [];
  for (let t = first; t <= mx; t += step) ticks.push(t);
  return ticks;
}

// Legacy: function formatTrackVal(v)
// Compact numeric formatter for per-window scalar tracks.
export function formatTrackVal(v) {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1000 || (a < 0.01 && a > 0)) return v.toExponential(2);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

// Legacy: function fmt(v, p=3) — line 31231
// General scalar formatter used by the sidebar info block and L3 pane headers.
export function fmt(v, p = 3) {
  if (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) return '—';
  if (typeof v !== 'number') return String(v);
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10)  return v.toFixed(1);
  return v.toFixed(p);
}

// Legacy: function fmtMb(bp) — line 31243
export function fmtMb(bp) {
  return (bp / 1e6).toFixed(3);
}

// Legacy: function shortId(id) — line 48319
// Collapses a candidate_id like C_gar_LG28_d17L2_0008_03 -> "L2 0008/03".
export function shortId(id) {
  if (!id) return '—';
  const m = String(id).match(/d17L2_(\d+)_(\d+)$/);
  if (m) return `L2 ${m[1]}/${m[2]}`;
  const m2 = String(id).match(/d17L1_(\d+)$/);
  if (m2) return `L1 ${m2[1]}`;
  return id;
}

// ---------------------------------------------------------------------
// HTML / DOM
// ---------------------------------------------------------------------

// Legacy: function escapeHtml(s)
export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------

// Legacy: function fitCanvas(canvas)
// HiDPI-aware canvas sizing. Returns { ctx, w, h } in CSS pixels.
//
// 2026-05-21: measure the PARENT's client rect (not the canvas's own
// boundingClientRect). Reading the canvas's own rect after a paint
// creates a positive-feedback loop on retina displays: each paint sets
// canvas.width = cssW * dpr, which becomes the canvas's intrinsic
// max-content size; CSS Grid / flex containers with min-width: auto
// honour that as the column's min-content; the column widens a
// fraction of a pixel per paint; the canvas's `width: 100%` follows;
// rect.width comes back larger on the next paint; backing store grows
// further — runaway growth (Quentin: "the plots are not in their
// panels", "the PCA panels keep increasing in width"). Reading the
// parent's clientWidth/Height (sized by the grid/flex track, invariant
// per layout) breaks the loop. Also pin canvas.style.width/height to
// the measured pixel value so the canvas's intrinsic `width` attr
// cannot leak into ancestor min-content even if the parent isn't the
// limiting container.
export function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const parent = canvas.parentNode;
  const measureW = (parent && parent.clientWidth)  || canvas.clientWidth
                 || canvas.getBoundingClientRect().width  || 1;
  const measureH = (parent && parent.clientHeight) || canvas.clientHeight
                 || canvas.getBoundingClientRect().height || 1;
  const cssW = Math.max(1, Math.floor(measureW));
  const cssH = Math.max(1, Math.floor(measureH));
  const targetW = Math.max(1, Math.floor(cssW * dpr));
  const targetH = Math.max(1, Math.floor(cssH * dpr));
  if (canvas.width  !== targetW) canvas.width  = targetW;
  if (canvas.height !== targetH) canvas.height = targetH;
  const pxW = cssW + 'px';
  const pxH = cssH + 'px';
  if (canvas.style.width  !== pxW) canvas.style.width  = pxW;
  if (canvas.style.height !== pxH) canvas.style.height = pxH;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: cssW, h: cssH };
}

// ---------------------------------------------------------------------
// Candidate-lane layout (legacy lines 32503-32536)
// ---------------------------------------------------------------------

/**
 * Assign candidates to non-overlapping lanes for the z-panel candidate
 * bar. Greedy first-fit on start_w, sorted ascending. Touch
 * (start_w === prev.end_w) counts as non-overlapping — matches the
 * L1/L2 rendering convention which uses _s0/_e0 as inclusive endpoints.
 *
 * @param {Array<{id?: string, start_w: number, end_w: number}>} candList
 * @returns {{assignments: Map<string, number>, n_lanes: number}}
 */
export function assignCandidateLanes(candList) {
  if (!Array.isArray(candList) || candList.length === 0) {
    return { assignments: new Map(), n_lanes: 1 };
  }
  const sorted = candList.slice().filter(c => c && c.start_w != null && c.end_w != null)
    .sort((a, b) => {
      if (a.start_w !== b.start_w) return a.start_w - b.start_w;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  const lanes = [];
  const assignments = new Map();
  for (const c of sorted) {
    let placed = -1;
    for (let i = 0; i < lanes.length; i++) {
      if (c.start_w > lanes[i]) {
        lanes[i] = c.end_w;
        placed = i;
        break;
      }
    }
    if (placed < 0) {
      lanes.push(c.end_w);
      placed = lanes.length - 1;
    }
    assignments.set(c.id, placed);
  }
  return { assignments, n_lanes: Math.max(1, lanes.length) };
}
