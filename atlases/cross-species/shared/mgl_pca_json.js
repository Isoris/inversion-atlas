// shared/mgl_pca_json.js
// =====================================================================
// Validator + accessors for the SPEC_0 §8 producer-PCA JSON shape.
//
// Per (view × weighting × anchor_mode) combination, the producer
// emits one JSON. This module:
//   - validates the structural shape (required fields, types, lengths)
//   - emits a canonical `MglPcaResult` object the renderer + the
//     downstream rendering-state module consume
//   - exposes accessors for common queries (window by idx,
//     bi_baseline vs view_self anchor variant, per-window PC scores)
//
// Pure compute. No DOM, no fetch.
//
// Canonical output shape (also used by shared/mgl_pca_compute.js
// when computing live from a Beagle file — both paths feed the
// same renderer):
//
//   {
//     candidate_id, chrom, interval_start, interval_end,
//     view: { name, pairs_included, weighted, weight_mode,
//             weight_stat, filter_thresholds, anchor_mode,
//             anchor_self_basis_pair },
//     n_samples, samples,
//     window_def: { kind, size_bp, step_bp },
//     n_windows,
//     windows: Array<{
//       idx, start, end,
//       n_pair_rows, n_unique_sites,
//       n_biallelic_sites, n_triallelic_sites, n_quadallelic_sites,
//       lam1, lam2, pc1, pc2,
//       // anchor_mode='both' adds:
//       lam1_self?, lam2_self?, pc1_self?, pc2_self?,
//       mean_pair_count, median_pair_count,
//       polarity_flips_applied,
//     }>,
//     _source: 'precomputed_json' | 'live_compute',
//   }
// =====================================================================

// =====================================================================
// Vocab
// =====================================================================

export const MGL_PCA_SCHEMA_VERSION = 1;

export const MGL_PCA_VIEWS = Object.freeze([
  'bi_baseline', 'tri_extras', 'quad_extras', 'all_pairs',
]);

export const MGL_PCA_ANCHOR_MODES = Object.freeze([
  'bi_baseline', 'view_self', 'none', 'both',
]);

// =====================================================================
// 1. Validator
// =====================================================================

const _REQUIRED_TOP = [
  'candidate_id', 'chrom', 'interval_start', 'interval_end',
  'view', 'n_samples', 'samples', 'window_def', 'n_windows', 'windows',
];

const _REQUIRED_VIEW = ['name', 'weighted', 'anchor_mode'];

const _REQUIRED_WINDOW = [
  'idx', 'start', 'end', 'lam1', 'lam2', 'pc1', 'pc2',
];

/**
 * Validate the structural shape of a producer-PCA JSON payload.
 *
 * Returns `{ok, errors}`. `errors` is a list of human-readable
 * messages, empty when ok.
 *
 * Structural only — does NOT re-run any compute or check that
 * PC scores correlate sensibly across samples.
 *
 * @param {Object} obj
 * @returns {{ok:boolean, errors:string[]}}
 */
export function isMglPcaJson(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') {
    return { ok: false, errors: ['payload is not an object'] };
  }
  for (const f of _REQUIRED_TOP) {
    if (!(f in obj)) errors.push(`missing top-level field: ${f}`);
  }
  if (obj.view && typeof obj.view === 'object') {
    for (const f of _REQUIRED_VIEW) {
      if (!(f in obj.view)) errors.push(`view: missing field ${f}`);
    }
    if (obj.view.name && !MGL_PCA_VIEWS.includes(obj.view.name)) {
      errors.push(`view.name "${obj.view.name}" not in ${MGL_PCA_VIEWS.join(' / ')}`);
    }
    if (obj.view.anchor_mode
        && !MGL_PCA_ANCHOR_MODES.includes(obj.view.anchor_mode)) {
      errors.push(`view.anchor_mode "${obj.view.anchor_mode}" not in ${MGL_PCA_ANCHOR_MODES.join(' / ')}`);
    }
  } else if ('view' in obj) {
    errors.push('view must be an object');
  }
  if (Array.isArray(obj.samples)) {
    if (Number.isFinite(obj.n_samples) && obj.samples.length !== obj.n_samples) {
      errors.push(`samples.length (${obj.samples.length}) != n_samples (${obj.n_samples})`);
    }
  } else if ('samples' in obj) {
    errors.push('samples must be an array');
  }
  if (Array.isArray(obj.windows)) {
    if (Number.isFinite(obj.n_windows) && obj.windows.length !== obj.n_windows) {
      errors.push(`windows.length (${obj.windows.length}) != n_windows (${obj.n_windows})`);
    }
    for (let i = 0; i < obj.windows.length; i++) {
      const w = obj.windows[i];
      if (!w || typeof w !== 'object') {
        errors.push(`windows[${i}] not an object`);
        continue;
      }
      for (const f of _REQUIRED_WINDOW) {
        if (!(f in w)) errors.push(`windows[${i}]: missing ${f}`);
      }
      if (Array.isArray(w.pc1) && Number.isFinite(obj.n_samples)
          && w.pc1.length !== obj.n_samples) {
        errors.push(`windows[${i}].pc1.length (${w.pc1.length}) != n_samples (${obj.n_samples})`);
        break;
      }
      if (Array.isArray(w.pc2) && Number.isFinite(obj.n_samples)
          && w.pc2.length !== obj.n_samples) {
        errors.push(`windows[${i}].pc2.length (${w.pc2.length}) != n_samples (${obj.n_samples})`);
        break;
      }
      // anchor_mode='both' — surface mismatched _self lengths
      if (Array.isArray(w.pc1_self) && Number.isFinite(obj.n_samples)
          && w.pc1_self.length !== obj.n_samples) {
        errors.push(`windows[${i}].pc1_self.length != n_samples`);
        break;
      }
    }
  } else if ('windows' in obj) {
    errors.push('windows must be an array');
  }
  return { ok: errors.length === 0, errors };
}

// =====================================================================
// 2. From precomputed JSON → canonical MglPcaResult
// =====================================================================

/**
 * Parse a validated PCA JSON into the canonical MglPcaResult shape.
 * Returns null when the payload fails validation.
 *
 * The returned object is the SAME shape mgl_pca_compute.js emits
 * when computing live from a Beagle file. Renderers consume both
 * indifferently.
 *
 * @param {Object} obj   raw JSON payload (string-parsed)
 * @returns {Object|null}
 */
export function fromPrecomputedJson(obj) {
  const v = isMglPcaJson(obj);
  if (!v.ok) return null;
  return {
    candidate_id:    obj.candidate_id,
    chrom:           obj.chrom,
    interval_start:  obj.interval_start,
    interval_end:    obj.interval_end,
    view:            obj.view,
    n_samples:       obj.n_samples,
    samples:         obj.samples.slice(),
    window_def:      obj.window_def,
    n_windows:       obj.n_windows,
    windows:         obj.windows.map(_cloneWindow),
    _source:         'precomputed_json',
  };
}

function _cloneWindow(w) {
  const out = Object.assign({}, w);
  if (Array.isArray(w.pc1))      out.pc1      = w.pc1.slice();
  if (Array.isArray(w.pc2))      out.pc2      = w.pc2.slice();
  if (Array.isArray(w.pc1_self)) out.pc1_self = w.pc1_self.slice();
  if (Array.isArray(w.pc2_self)) out.pc2_self = w.pc2_self.slice();
  return out;
}

// =====================================================================
// 3. Accessors (work on either source — precomputed or live)
// =====================================================================

/** Get a window by index (clamped to range). */
export function getWindowAt(result, idx) {
  if (!result || !Array.isArray(result.windows)) return null;
  const n = result.windows.length;
  if (n === 0) return null;
  const i = Math.max(0, Math.min(n - 1, idx | 0));
  return result.windows[i];
}

/** Window covering a given bp position (first overlap). Null when none. */
export function getWindowAtBp(result, bp) {
  if (!result || !Array.isArray(result.windows)) return null;
  if (!Number.isFinite(bp)) return null;
  for (const w of result.windows) {
    if (w && w.start <= bp && bp <= w.end) return w;
  }
  return null;
}

/**
 * Per-window PC1/PC2 for a given sample by index. Returns
 * `[{idx, start, end, pc1, pc2}]` for every window, or `null` when
 * sample_idx is out of range.
 *
 * Respects anchor_mode='both': when both bi_baseline and view_self
 * variants exist, the caller chooses which via `opts.anchor`
 * (default: 'bi_baseline' / canonical).
 */
export function pcTrajectoryForSample(result, sample_idx, opts) {
  if (!result || !Array.isArray(result.windows)) return null;
  const i = sample_idx | 0;
  if (i < 0 || (result.n_samples != null && i >= result.n_samples)) return null;
  const o = opts || {};
  const wantSelf = o.anchor === 'view_self';
  const out = new Array(result.windows.length);
  for (let k = 0; k < result.windows.length; k++) {
    const w = result.windows[k];
    if (!w) { out[k] = null; continue; }
    const pc1 = wantSelf && Array.isArray(w.pc1_self) ? w.pc1_self : w.pc1;
    const pc2 = wantSelf && Array.isArray(w.pc2_self) ? w.pc2_self : w.pc2;
    out[k] = {
      idx:   w.idx,
      start: w.start,
      end:   w.end,
      pc1:   pc1 ? pc1[i] : null,
      pc2:   pc2 ? pc2[i] : null,
    };
  }
  return out;
}

/**
 * Find a sample's index in the result. Returns -1 when not found.
 *
 * @param {Object} result
 * @param {string} sample_id
 * @returns {number}
 */
export function sampleIndexOf(result, sample_id) {
  if (!result || !Array.isArray(result.samples)) return -1;
  return result.samples.indexOf(sample_id);
}

/**
 * Aggregate per-window lambda ratios into a summary across the
 * candidate. Useful as a "how dominant is PC1?" gauge.
 *
 * @returns {{
 *   mean_lam1: number, mean_lam2: number,
 *   mean_ratio: number, max_ratio: number,
 *   n_windows_with_data: number,
 * }}
 */
export function summariseLambdaRatios(result) {
  const out = {
    mean_lam1: NaN, mean_lam2: NaN,
    mean_ratio: NaN, max_ratio: -Infinity,
    n_windows_with_data: 0,
  };
  if (!result || !Array.isArray(result.windows)) return out;
  let sumL1 = 0, sumL2 = 0, sumR = 0, n = 0, maxR = -Infinity;
  for (const w of result.windows) {
    if (!w) continue;
    if (!Number.isFinite(w.lam1) || !Number.isFinite(w.lam2)) continue;
    sumL1 += w.lam1; sumL2 += w.lam2; n++;
    if (w.lam2 > 0) {
      const r = w.lam1 / w.lam2;
      sumR += r;
      if (r > maxR) maxR = r;
    }
  }
  if (n === 0) return out;
  out.mean_lam1 = sumL1 / n;
  out.mean_lam2 = sumL2 / n;
  out.mean_ratio = sumR / n;
  out.max_ratio  = Number.isFinite(maxR) ? maxR : NaN;
  out.n_windows_with_data = n;
  return out;
}

/**
 * Build the canonical filename for a (view × weighting × anchor)
 * triple, matching the producer's naming convention:
 *
 *   pca_<view>_<weighting>_<anchor>.json
 *
 * @param {string} view
 * @param {string} weighting   'weighted' | 'unweighted'
 * @param {string} anchor
 * @returns {string}
 */
export function pcaFilenameFor(view, weighting, anchor) {
  return `pca_${view}_${weighting}_${anchor}.json`;
}
