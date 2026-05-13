// shared/mgl_heatmap_json.js
// =====================================================================
// Validator + accessors + live-compute for the SPEC_0 §9 heatmap
// JSON shape. Per (view × weighting × centering) combination, the
// producer emits one JSON. This module:
//   - validates the structural shape
//   - emits a canonical `MglHeatmapResult` object
//   - exposes accessors (marker lookup, dosage row/col, marker
//     ordering)
//   - LIVE-COMPUTE path: build the same shape from a parsed Beagle
//     dosage matrix without any pre-computed JSON
//
// Both paths emit the same shape; the renderer doesn't care.
//
// Canonical output:
//
//   {
//     candidate_id, view_name, weighted,
//     centering: { anchor, polarity_reference, polarity_anchor_view },
//     n_samples, samples,
//     n_markers, markers: Array<{
//       marker, chrom, pos, role_a, role_b, allele_a, allele_b,
//       n_alleles_obs, pair_count,
//       polarity_flipped,
//       dosage:          Float64Array,   // raw posterior dosage
//       dosage_centered: Float64Array,   // (dosage − subset mean)
//     }>,
//     _source: 'precomputed_json' | 'live_compute',
//   }
// =====================================================================

import { centerDosageOnSubset, applyPolarityFlipsFromRefPC1 }
  from './mgl_pca_compute.js';

// =====================================================================
// Vocab
// =====================================================================

export const MGL_HEATMAP_SCHEMA_VERSION = 1;

/** Centering-anchor enum (matches SPEC_0 §10.3). */
export const MGL_CENTERING_ANCHORS = Object.freeze([
  'all', 'het', 'hom1', 'hom2', 'custom',
]);

/** Polarity-reference enum (SPEC_0 §10.4). */
export const MGL_POLARITY_REFERENCES = Object.freeze([
  'pc1_correlation', 'band_membership', 'fixed_sample', 'none',
]);

// =====================================================================
// 1. Validator
// =====================================================================

const _REQUIRED_TOP = [
  'candidate_id', 'view_name', 'n_samples', 'samples',
  'n_markers', 'markers',
];

const _REQUIRED_MARKER = ['marker', 'dosage'];

/**
 * Structural validator for the SPEC_0 §9 heatmap JSON.
 *
 * @param {Object} obj
 * @returns {{ok:boolean, errors:string[]}}
 */
export function isMglHeatmapJson(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') {
    return { ok: false, errors: ['payload is not an object'] };
  }
  for (const f of _REQUIRED_TOP) {
    if (!(f in obj)) errors.push(`missing top-level field: ${f}`);
  }
  if (obj.centering && typeof obj.centering === 'object') {
    if (obj.centering.anchor != null
        && !MGL_CENTERING_ANCHORS.includes(obj.centering.anchor)) {
      errors.push(`centering.anchor "${obj.centering.anchor}" not in vocab`);
    }
    if (obj.centering.polarity_reference != null
        && !MGL_POLARITY_REFERENCES.includes(obj.centering.polarity_reference)) {
      errors.push(`centering.polarity_reference "${obj.centering.polarity_reference}" not in vocab`);
    }
  } else if ('centering' in obj) {
    errors.push('centering must be an object');
  }
  if (Array.isArray(obj.samples) && Number.isFinite(obj.n_samples)
      && obj.samples.length !== obj.n_samples) {
    errors.push(`samples.length (${obj.samples.length}) != n_samples (${obj.n_samples})`);
  } else if ('samples' in obj && !Array.isArray(obj.samples)) {
    errors.push('samples must be an array');
  }
  if (Array.isArray(obj.markers)) {
    if (Number.isFinite(obj.n_markers) && obj.markers.length !== obj.n_markers) {
      errors.push(`markers.length (${obj.markers.length}) != n_markers (${obj.n_markers})`);
    }
    for (let i = 0; i < Math.min(obj.markers.length, 32); i++) {
      const m = obj.markers[i];
      if (!m || typeof m !== 'object') {
        errors.push(`markers[${i}] not an object`);
        continue;
      }
      for (const f of _REQUIRED_MARKER) {
        if (!(f in m)) errors.push(`markers[${i}]: missing ${f}`);
      }
      if (Array.isArray(m.dosage) && Number.isFinite(obj.n_samples)
          && m.dosage.length !== obj.n_samples) {
        errors.push(`markers[${i}].dosage.length (${m.dosage.length}) != n_samples (${obj.n_samples})`);
        break;
      }
    }
  } else if ('markers' in obj) {
    errors.push('markers must be an array');
  }
  return { ok: errors.length === 0, errors };
}

// =====================================================================
// 2. From precomputed JSON
// =====================================================================

/**
 * Parse a validated heatmap JSON into canonical MglHeatmapResult.
 *
 * @param {Object} obj
 * @returns {Object|null}
 */
export function fromPrecomputedJson(obj) {
  const v = isMglHeatmapJson(obj);
  if (!v.ok) return null;
  const markers = obj.markers.map(_cloneMarker);
  return {
    candidate_id:  obj.candidate_id,
    view_name:     obj.view_name,
    weighted:      !!obj.weighted,
    centering:     obj.centering || null,
    n_samples:     obj.n_samples,
    samples:       obj.samples.slice(),
    n_markers:     obj.n_markers,
    markers,
    _source:       'precomputed_json',
  };
}

function _cloneMarker(m) {
  const out = Object.assign({}, m);
  if (Array.isArray(m.dosage)) {
    out.dosage = m.dosage instanceof Float64Array
      ? m.dosage.slice()
      : Float64Array.from(m.dosage);
  }
  if (Array.isArray(m.dosage_centered)) {
    out.dosage_centered = m.dosage_centered instanceof Float64Array
      ? m.dosage_centered.slice()
      : Float64Array.from(m.dosage_centered);
  }
  return out;
}

// =====================================================================
// 3. Live-compute: from a parsed Beagle dosage matrix
// =====================================================================

/**
 * Build the canonical heatmap result from a parsed dosage matrix
 * (output of shared/mgl_beagle_parser.parseBeagleToDosage).
 *
 * Applies the requested centering (subset mean) per marker. When
 * `polarity_ref_pc1` is provided, also applies the per-marker
 * polarity flip (SPEC_0 §10.4 pc1_correlation rule) and records
 * `polarity_flipped` per marker.
 *
 * @param {Object} args
 * @param {Object} args.dosage_result       output of parseBeagleToDosage
 * @param {string} args.candidate_id
 * @param {string} args.view_name
 * @param {boolean} [args.weighted=false]
 * @param {string} [args.centering_anchor='all']
 * @param {number[]|null} [args.centering_subset]  sample indices
 *   defining the centering mean. Required when centering_anchor !=
 *   'all'.
 * @param {Float64Array|null} [args.polarity_ref_pc1]  triggers flip
 * @param {string} [args.polarity_reference='none']
 * @returns {Object|null}    canonical MglHeatmapResult
 */
export function buildHeatmapFromDosage(args) {
  const a = args || {};
  const d = a.dosage_result;
  if (!d || !d.dosage_matrix) return null;
  const n_markers = d.n_markers;
  const n_samples = d.n_samples;
  // Work on a copy — we'll mutate during centering / polarity flip.
  const working = d.dosage_matrix.slice();
  // 1. Centering.
  const subset = (a.centering_anchor && a.centering_anchor !== 'all')
    ? (a.centering_subset || null) : null;
  // Build a SEPARATE centered copy so we can keep raw dosage in the
  // output (display-time transformations need both).
  const centered = working.slice();
  centerDosageOnSubset(centered, n_markers, n_samples, subset);
  // 2. Polarity flip (mutates `centered`; track per-marker flip state).
  const flipped = new Uint8Array(n_markers);
  if (a.polarity_ref_pc1) {
    // We need to know which markers got flipped. Apply marker-by-
    // marker by re-running the small loop with bookkeeping.
    _applyAndRecordPolarityFlips(centered, n_markers, n_samples,
                                 a.polarity_ref_pc1, flipped);
  }
  // 3. Build markers[].
  const markers = new Array(n_markers);
  for (let r = 0; r < n_markers; r++) {
    const off = r * n_samples;
    const raw = working.subarray(off, off + n_samples);
    const cen = centered.subarray(off, off + n_samples);
    // Sidecar metadata if present.
    const md = (d.metadata && d.metadata[r]) || null;
    markers[r] = {
      marker:           d.markers[r],
      chrom:            md ? md.chrom : null,
      pos:              md && Number.isFinite(md.pos) ? md.pos : null,
      role_a:           md ? md.role_a : null,
      role_b:           md ? md.role_b : null,
      allele_a:         md ? md.allele_a : _alleleCode(d.allele1[r]),
      allele_b:         md ? md.allele_b : _alleleCode(d.allele2[r]),
      n_alleles_obs:    md && Number.isFinite(md.n_alleles_obs) ? md.n_alleles_obs : null,
      pair_count:       md && Number.isFinite(md.pair_count)    ? md.pair_count    : null,
      polarity_flipped: !!flipped[r],
      dosage:           new Float64Array(raw),
      dosage_centered:  new Float64Array(cen),
    };
  }
  return {
    candidate_id:    a.candidate_id || null,
    view_name:       a.view_name || null,
    weighted:        !!a.weighted,
    centering: {
      anchor:                a.centering_anchor || 'all',
      polarity_reference:    a.polarity_reference || 'none',
      polarity_anchor_view:  a.polarity_anchor_view || null,
    },
    n_samples,
    samples:         d.samples.slice(),
    n_markers,
    markers,
    _source:         'live_compute',
  };
}

function _alleleCode(code) {
  return 'ACGT'[code] || null;
}

function _applyAndRecordPolarityFlips(dosage, n_m, n_s, ref_pc1, flipped) {
  if (!ref_pc1 || ref_pc1.length !== n_s) return 0;
  let rmean = 0;
  for (let i = 0; i < n_s; i++) rmean += ref_pc1[i];
  rmean /= n_s;
  let cnt = 0;
  for (let r = 0; r < n_m; r++) {
    const off = r * n_s;
    let dot = 0;
    for (let s = 0; s < n_s; s++) {
      dot += dosage[off + s] * (ref_pc1[s] - rmean);
    }
    if (dot < 0) {
      for (let s = 0; s < n_s; s++) dosage[off + s] = -dosage[off + s];
      flipped[r] = 1;
      cnt++;
    }
  }
  return cnt;
}

// =====================================================================
// 4. Accessors
// =====================================================================

/** Find a marker by its name (strings; the marker field of each row). */
export function markerIndexOf(result, marker_name) {
  if (!result || !Array.isArray(result.markers)) return -1;
  for (let i = 0; i < result.markers.length; i++) {
    if (result.markers[i] && result.markers[i].marker === marker_name) return i;
  }
  return -1;
}

/** Find a sample by id. Returns -1 when not found. */
export function sampleIndexOf(result, sample_id) {
  if (!result || !Array.isArray(result.samples)) return -1;
  return result.samples.indexOf(sample_id);
}

/**
 * Order marker indices for column-display. SPEC_0 §10.6 four modes:
 *   - 'genomic'      — by chrom, pos (default)
 *   - 'pc1_loading'  — by |corr(marker, ref_pc1)| descending
 *   - 'pc2_loading'  — by |corr(marker, ref_pc2)| descending
 *   - 'manual'       — caller supplies index order
 *
 * For pc1_loading / pc2_loading, ref_pc1 / ref_pc2 are Float64Arrays
 * of length n_samples. Markers with missing chrom/pos sort to the
 * end of the genomic order.
 *
 * Returns a new Array<number> of marker indices.
 *
 * @param {Object} result
 * @param {string} mode
 * @param {{ref_pc1?:Float64Array, ref_pc2?:Float64Array}} [opts]
 * @returns {number[]}
 */
export function orderMarkerIndices(result, mode, opts) {
  const N = result && result.n_markers ? result.n_markers : 0;
  const out = new Array(N);
  for (let i = 0; i < N; i++) out[i] = i;
  if (N === 0) return out;
  const o = opts || {};
  if (mode === 'pc1_loading' && o.ref_pc1) {
    return _orderByCorrelation(result, out, o.ref_pc1);
  }
  if (mode === 'pc2_loading' && o.ref_pc2) {
    return _orderByCorrelation(result, out, o.ref_pc2);
  }
  // 'manual' — caller supplies order; we don't compute it.
  // 'genomic' — by chrom, pos.
  out.sort((ai, bi) => {
    const a = result.markers[ai], b = result.markers[bi];
    if (!a || !b) return 0;
    const ac = a.chrom || '~';
    const bc = b.chrom || '~';
    if (ac !== bc) return ac < bc ? -1 : 1;
    const ap = Number.isFinite(a.pos) ? a.pos : Infinity;
    const bp = Number.isFinite(b.pos) ? b.pos : Infinity;
    return ap - bp;
  });
  return out;
}

function _orderByCorrelation(result, indices, ref) {
  const n_s = result.n_samples;
  // Pre-center ref.
  let m = 0;
  for (let i = 0; i < n_s; i++) m += ref[i];
  m /= n_s;
  const scored = indices.map(i => {
    const dos = result.markers[i] && result.markers[i].dosage;
    if (!dos || dos.length !== n_s) return { i, score: 0 };
    let dm = 0;
    for (let s = 0; s < n_s; s++) dm += dos[s];
    dm /= n_s;
    let num = 0, dx = 0, dy = 0;
    for (let s = 0; s < n_s; s++) {
      const a = dos[s] - dm;
      const b = ref[s] - m;
      num += a * b; dx += a * a; dy += b * b;
    }
    const denom = Math.sqrt(dx * dy);
    return { i, score: denom > 0 ? Math.abs(num / denom) : 0 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map(x => x.i);
}

/** Canonical filename pattern for the producer JSON. */
export function heatmapFilenameFor(view, weighting, centering_anchor) {
  return `heatmap_${view}_${weighting}_${centering_anchor}.json`;
}
