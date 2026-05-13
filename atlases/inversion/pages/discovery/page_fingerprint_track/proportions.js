// pages/discovery/page_fingerprint_track/proportions.js
// =====================================================================
// Small treemap-style plot of regime fragment proportions. Same
// colour palette as the main fingerprint strip — each rectangle
// shows the fraction of windows in that regime.
//
//   regimeId 1 ████████  47%
//   regimeId 2 █████     22%
//   regimeId 3 ████      18%
//
// Pure compute + canvas paint. No state mutation.
// =====================================================================

// =====================================================================
// 1. Tally regimes
// =====================================================================

/**
 * Count the number of windows per regime id. Regimes are returned
 * sorted by count descending. Regime 0 (missing-data marker) is
 * included by default so its share is visible; pass
 * `include_zero: false` to drop it.
 *
 * @param {Object} fingerprint_result   shared/mgl_fingerprinter output
 * @param {Object} [opts]
 *   include_zero?: boolean   default true
 * @returns {Array<{regime_id:number, count:number, fraction:number}>}
 */
export function regimeProportions(fingerprint_result, opts) {
  const o = opts || {};
  const includeZero = (o.include_zero !== false);
  if (!fingerprint_result
      || !Array.isArray(fingerprint_result.windows)
      || fingerprint_result.windows.length === 0) {
    return [];
  }
  const counts = new Map();
  for (const w of fingerprint_result.windows) {
    const r = (w.regime_id | 0);
    if (!includeZero && r === 0) continue;
    counts.set(r, (counts.get(r) || 0) + 1);
  }
  const total = Array.from(counts.values()).reduce((s, v) => s + v, 0);
  if (total === 0) return [];
  const out = [];
  for (const [regime_id, count] of counts.entries()) {
    out.push({ regime_id, count, fraction: count / total });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

// =====================================================================
// 2. Squarified treemap layout (Bruls et al. 2000)
// =====================================================================

/**
 * Lay out a list of items (with a `value` field) inside a rectangle
 * using the squarified treemap algorithm. The returned items have
 * additional `x`, `y`, `w`, `h` fields.
 *
 * @param {Array<{value:number}>} items
 * @param {number} W   container width
 * @param {number} H   container height
 * @returns {Array<{value:number, x:number, y:number, w:number, h:number}>}
 */
export function squarifyTreemap(items, W, H) {
  if (!Array.isArray(items) || items.length === 0 || W <= 0 || H <= 0) return [];
  const total = items.reduce((s, it) => s + (Number(it.value) || 0), 0);
  if (total <= 0) {
    return items.map(it => Object.assign({}, it, { x: 0, y: 0, w: 0, h: 0 }));
  }
  const scale = (W * H) / total;
  // Scale areas, sort desc by area (preserve original index).
  const scaled = items.map((it, i) => Object.assign({}, it, {
    _area:    (Number(it.value) || 0) * scale,
    _origIdx: i,
  }));
  scaled.sort((a, b) => b._area - a._area);

  const result = new Array(items.length);
  // Remaining-rect state.
  let x = 0, y = 0, w = W, h = H;
  let row = [];
  let i = 0;
  while (i < scaled.length) {
    const candidate = row.slice();
    candidate.push(scaled[i]);
    const shortSide = Math.min(w, h);
    if (row.length === 0
        || _worstRatio(candidate, shortSide) <= _worstRatio(row, shortSide)) {
      row = candidate;
      i++;
    } else {
      const advance = _layoutRow(row, x, y, w, h, result);
      x = advance.x; y = advance.y; w = advance.w; h = advance.h;
      row = [];
    }
  }
  if (row.length > 0) _layoutRow(row, x, y, w, h, result);
  // Strip the bookkeeping fields.
  for (let k = 0; k < result.length; k++) {
    if (result[k]) {
      delete result[k]._area;
      delete result[k]._origIdx;
    }
  }
  return result;
}

function _worstRatio(row, sideLen) {
  if (row.length === 0 || sideLen <= 0) return Infinity;
  const total = row.reduce((s, it) => s + it._area, 0);
  if (total <= 0) return Infinity;
  let worst = 0;
  const s2 = sideLen * sideLen;
  for (const it of row) {
    const r = Math.max(
      (s2 * it._area)    / (total * total),
      (total * total)    / (s2 * it._area),
    );
    if (r > worst) worst = r;
  }
  return worst;
}

function _layoutRow(row, x, y, w, h, result) {
  const total = row.reduce((s, it) => s + it._area, 0);
  if (w >= h) {
    // Pack row vertically inside a column of width = total / h.
    const colW = total / h;
    let cy = y;
    for (const it of row) {
      const ih = it._area / colW;
      result[it._origIdx] = Object.assign({}, it, { x, y: cy, w: colW, h: ih });
      cy += ih;
    }
    return { x: x + colW, y, w: Math.max(0, w - colW), h };
  } else {
    // Pack row horizontally inside a strip of height = total / w.
    const rowH = total / w;
    let cx = x;
    for (const it of row) {
      const iw = it._area / rowH;
      result[it._origIdx] = Object.assign({}, it, { x: cx, y, w: iw, h: rowH });
      cx += iw;
    }
    return { x, y: y + rowH, w, h: Math.max(0, h - rowH) };
  }
}

// =====================================================================
// 3. Painter
// =====================================================================

/**
 * Paint the regime-proportions treemap on a canvas. Uses the same
 * colour map as the main fingerprint strip.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Object} fingerprint_result
 * @param {Object} [opts]
 *   regime_colors_by_id?: Object<number,string>
 *   include_zero?:        boolean   default true
 *   show_labels?:         boolean   default true
 *   font_size?:           number
 *   hovered_regime?:      number|null
 * @returns {{
 *   regime_hit_regions: Array<{regime_id:number, x:number, y:number,
 *                              w:number, h:number, fraction:number}>,
 * }}
 */
export function paintRegimeProportions(canvas, fingerprint_result, opts) {
  const o = opts || {};
  if (!canvas || typeof canvas.getContext !== 'function') {
    return { regime_hit_regions: [] };
  }
  const ctx = canvas.getContext('2d');
  const W = canvas.width || 200;
  const H = canvas.height || 100;
  if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, W, H);

  const props = regimeProportions(fingerprint_result, {
    include_zero: o.include_zero !== false,
  });
  if (props.length === 0) return { regime_hit_regions: [] };

  const pad = 2;
  const innerW = Math.max(1, W - 2 * pad);
  const innerH = Math.max(1, H - 2 * pad);
  const tiles = squarifyTreemap(
    props.map(p => ({ regime_id: p.regime_id, fraction: p.fraction, value: p.count })),
    innerW, innerH,
  );

  const colors = o.regime_colors_by_id || {};
  const fontSize = Number.isFinite(o.font_size) ? o.font_size : 9;
  const hovered = Number.isFinite(o.hovered_regime) ? o.hovered_regime : null;
  ctx.font = fontSize + 'px sans-serif';
  ctx.textBaseline = 'top';

  const hits = [];
  for (const t of tiles) {
    const fillCol = colors[t.regime_id] || '#888888';
    const tx = pad + t.x, ty = pad + t.y, tw = t.w, th = t.h;
    ctx.fillStyle = fillCol;
    if (typeof ctx.fillRect === 'function') ctx.fillRect(tx, ty, tw, th);
    // Border.
    ctx.strokeStyle = (t.regime_id === hovered)
      ? '#f5a524' : 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = (t.regime_id === hovered) ? 2 : 1;
    if (typeof ctx.strokeRect === 'function') {
      ctx.strokeRect(tx + 0.5, ty + 0.5, Math.max(0, tw - 1), Math.max(0, th - 1));
    }
    ctx.lineWidth = 1;
    // Label only if the tile is big enough.
    if (o.show_labels !== false && tw > 28 && th > 14) {
      const pct = Math.round(t.fraction * 100);
      const label = `R${t.regime_id} · ${pct}%`;
      ctx.fillStyle = 'rgba(20, 20, 20, 0.9)';
      if (typeof ctx.fillText === 'function') {
        ctx.fillText(label, tx + 3, ty + 2);
      }
    }
    hits.push({
      regime_id: t.regime_id,
      x: tx, y: ty, w: tw, h: th,
      fraction: t.fraction,
    });
  }
  return { regime_hit_regions: hits };
}

/**
 * Find the regime under a canvas pixel, or null.
 *
 * @param {Array<{regime_id:number, x:number, y:number, w:number, h:number}>} hits
 * @param {number} px
 * @param {number} py
 * @returns {number|null}
 */
export function findRegimeAtPixel(hits, px, py) {
  if (!Array.isArray(hits)) return null;
  for (const h of hits) {
    if (px >= h.x && px <= h.x + h.w
        && py >= h.y && py <= h.y + h.h) {
      return h.regime_id;
    }
  }
  return null;
}
