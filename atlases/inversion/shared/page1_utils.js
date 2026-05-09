// atlases/inversion/shared/page1_utils.js
//
// Utility functions extracted from legacy/Inversion_atlas.html during
// the page1 migration. These are pure helpers — no state dependency —
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
export function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width  = Math.floor(rect.width  * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: rect.width, h: rect.height };
}
