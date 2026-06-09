// pages/discovery/dosage_heatmap/marker_select.js
// =====================================================================
// Marker-axis selection + viewport for the dosage heatmap:
//
//   - per-marker dosage variance across samples
//   - SNP "views": all / random / high-variance / low-variance, with
//     an optional subsample count
//   - a cursor-centred viewport window (the "zoom" + ←/→ cursor)
//
// Selected markers are always returned in ASCENDING canonical-index
// (≈ genomic) order so the matrix reads left→right along the chromosome
// regardless of which view picked them.
//
// Pure compute. No DOM, no state mutation.
// =====================================================================

/**
 * Per-marker variance of dosage across samples (NA cells skipped).
 * @param {Object} canonical  adapter output ({ n_samples, n_markers, cellValue })
 * @returns {Float64Array}  length n_markers (NaN for all-NA markers)
 */
export function computeMarkerVariance(canonical) {
  const nS = (canonical && canonical.n_samples | 0) || 0;
  const nM = (canonical && canonical.n_markers | 0) || 0;
  const out = new Float64Array(nM);
  if (!canonical || typeof canonical.cellValue !== 'function' || nS <= 0 || nM <= 0) {
    out.fill(NaN);
    return out;
  }
  const cv = canonical.cellValue;
  for (let m = 0; m < nM; m++) {
    let sum = 0, sq = 0, n = 0;
    for (let s = 0; s < nS; s++) {
      const v = cv(m, s);
      if (v == null || !Number.isFinite(v)) continue;
      sum += v; sq += v * v; n++;
    }
    if (n < 1) { out[m] = NaN; continue; }
    const mean = sum / n;
    out[m] = Math.max(0, sq / n - mean * mean);
  }
  return out;
}

// Deterministic LCG (so 'random' view is stable across repaints).
function _lcg(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * Select + order the markers to display.
 *
 * @param {Object} canonical
 * @param {Object} [opts]
 *   view?:  'all' | 'random' | 'high_var' | 'low_var'   default 'all'
 *   n?:     number   subsample count (0/absent → all markers for the view)
 *   seed?:  number   RNG seed for the 'random' view (default 1)
 * @returns {Int32Array}  canonical marker indices, ascending
 */
export function selectMarkers(canonical, opts) {
  const o = opts || {};
  const nM = (canonical && canonical.n_markers | 0) || 0;
  if (nM <= 0) return new Int32Array(0);
  const view = o.view || 'all';
  const n = Number.isFinite(o.n) ? Math.max(0, o.n | 0) : 0;
  const want = (n > 0 && n < nM) ? n : nM;

  let picked;
  if (view === 'all' || (want >= nM && view === 'random')) {
    picked = Array.from({ length: nM }, (_, i) => i);
    if (want < nM) picked = _randomPick(nM, want, o.seed);
  } else if (view === 'random') {
    picked = _randomPick(nM, want, o.seed);
  } else if (view === 'high_var' || view === 'low_var') {
    const varr = computeMarkerVariance(canonical);
    const order = Array.from({ length: nM }, (_, i) => i)
      .filter(i => Number.isFinite(varr[i]))
      .sort((a, b) => (view === 'high_var' ? varr[b] - varr[a] : varr[a] - varr[b]));
    picked = order.slice(0, Math.min(want, order.length));
  } else if (view === 'even_bp') {
    // Approximately equal genomic spacing across the whole candidate
    // interval — the "whole-region figure" view. Picks `want` markers
    // nearest to evenly-spaced genomic targets over [minBp, maxBp].
    picked = pickEvenlySpacedByBp(canonical && canonical.marker_pos_bp, nM, want);
  } else {
    picked = Array.from({ length: nM }, (_, i) => i);
    if (want < nM) picked = picked.slice(0, want);
  }
  picked.sort((a, b) => a - b);
  return Int32Array.from(picked);
}

/**
 * Pick ~`want` markers at approximately equal genomic distances over the
 * whole interval spanned by `posBp`. For each of `want` evenly-spaced
 * genomic targets it takes the nearest not-yet-picked marker, so the
 * result is roughly uniform in bp even when markers cluster. Falls back to
 * even INDEX spacing when positions are missing.
 *
 * @param {Float64Array|number[]} posBp  per-marker genomic position (bp)
 * @param {number} nM                    total markers
 * @param {number} want                  target count (≥ nM → all)
 * @returns {number[]} sorted marker indices
 */
export function pickEvenlySpacedByBp(posBp, nM, want) {
  if (!(nM > 0)) return [];
  if (!(want > 0) || want >= nM) return Array.from({ length: nM }, (_, i) => i);

  // Markers with a finite position, sorted by position.
  const withPos = [];
  if (posBp && posBp.length) {
    for (let i = 0; i < nM; i++) { const p = posBp[i]; if (Number.isFinite(p)) withPos.push(i); }
  }
  if (withPos.length < 2) {                       // no usable bp → even index
    const out = [];
    for (let k = 0; k < want; k++) out.push(Math.min(nM - 1, Math.round((k + 0.5) * nM / want)));
    return Array.from(new Set(out)).sort((a, b) => a - b);
  }
  withPos.sort((a, b) => posBp[a] - posBp[b]);
  const lo = posBp[withPos[0]];
  const hi = posBp[withPos[withPos.length - 1]];
  const span = (hi > lo) ? (hi - lo) : 1;

  const used = new Set();
  for (let k = 0; k < want; k++) {
    const target = lo + ((k + 0.5) / want) * span;
    // Nearest marker to `target` by binary search over sorted positions.
    let blo = 0, bhi = withPos.length - 1;
    while (blo < bhi) {
      const mid = (blo + bhi) >> 1;
      if (posBp[withPos[mid]] < target) blo = mid + 1; else bhi = mid;
    }
    // Check the neighbour on the low side too; take whichever is closer
    // and not yet used (walk outward to break ties / collisions).
    let best = -1, bestD = Infinity;
    for (let j = blo - 1; j <= blo + 1; j++) {
      if (j < 0 || j >= withPos.length) continue;
      const mi = withPos[j];
      if (used.has(mi)) continue;
      const d = Math.abs(posBp[mi] - target);
      if (d < bestD) { bestD = d; best = j; }
    }
    if (best < 0) {                               // local cell exhausted → scan out
      for (let r = 2; r < withPos.length && best < 0; r++) {
        for (const j of [blo - r, blo + r]) {
          if (j < 0 || j >= withPos.length) continue;
          if (!used.has(withPos[j])) { best = j; break; }
        }
      }
    }
    if (best >= 0) used.add(withPos[best]);
  }
  return Array.from(used).sort((a, b) => a - b);
}

function _randomPick(nM, want, seed) {
  const idx = Array.from({ length: nM }, (_, i) => i);
  const rnd = _lcg(Number.isFinite(seed) ? seed : 1);
  // Fisher–Yates partial shuffle for the first `want` slots.
  for (let i = 0; i < want; i++) {
    const j = i + Math.floor(rnd() * (nM - i));
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  return idx.slice(0, want);
}

/**
 * Cursor-centred viewport into an ordered list. Zoom z shows
 * ceil(len / z) entries centred on `cursor`, clamped to [0, len).
 *
 * @param {number} len     length of the working (selected) marker list
 * @param {number} cursor  cursor position (index into the list)
 * @param {number} zoom    >=1; 1 = whole list, 2 = half, …
 * @returns {{ start:number, count:number }}
 */
export function viewportWindow(len, cursor, zoom) {
  const L = Math.max(0, len | 0);
  if (L === 0) return { start: 0, count: 0 };
  const z = Number.isFinite(zoom) && zoom >= 1 ? zoom : 1;
  const count = Math.max(1, Math.min(L, Math.ceil(L / z)));
  let c = Number.isFinite(cursor) ? (cursor | 0) : 0;
  c = Math.max(0, Math.min(L - 1, c));
  let start = c - Math.floor(count / 2);
  start = Math.max(0, Math.min(L - count, start));
  return { start, count };
}

/**
 * Compose the selected-marker list with a viewport window into a
 * display marker_order (canonical indices) for the painter.
 *
 * @param {Int32Array} selected  selectMarkers() output
 * @param {number} cursor
 * @param {number} zoom
 * @returns {{ order:Int32Array, start:number, count:number }}
 */
export function markerViewport(selected, cursor, zoom) {
  const sel = (selected instanceof Int32Array) ? selected : Int32Array.from(selected || []);
  const { start, count } = viewportWindow(sel.length, cursor, zoom);
  return { order: sel.subarray(start, start + count), start, count };
}
