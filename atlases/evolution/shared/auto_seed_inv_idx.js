// shared/auto_seed_inv_idx.js
// =====================================================================
// Opportunistic helper that fabricates the `inv_idx` / `std_idx`
// sample partitions evolution pages need from data the inversion
// atlas's local_pca_dosage page already has on the shared state.
//
// Why this exists: the evolution-atlas pages (haplotype_network,
// age_divergence, inv_internal_substructure, mosaicism_leakage, etc.)
// document an input contract that requires `inv_idx` (the indices of
// the samples in the INV arrangement class). No upstream producer in
// this repo populates that field, so the pages used to land on the
// empty state unless an external caller manually set it. Today most
// users never see real data on these pages.
//
// Heuristic (no cross-atlas dependencies, no cluster cache):
//   1. Require an active candidate with bp / window range.
//   2. Take the chrom-wide per-window PC1 (state.data.windows[w].pc1)
//      across the candidate's window range.
//   3. Mean each sample's PC1 across that range.
//   4. Split samples by the median of those means: above-median =
//      inv_idx, below-median = std_idx. The sign is arbitrary but
//      stable per candidate, which is all the downstream metrics
//      (dXY, FST, haplotype network) need.
//
// This is intentionally a default, not a substitute for a real
// karyotype caller. Pages should overwrite `haplotype_network_state`
// (etc.) with curated partitions when they become available.
// =====================================================================

/**
 * @typedef {Object} InvIdxResult
 * @property {Int32Array} inv_idx
 * @property {Int32Array} std_idx
 * @property {string[]}   sample_labels
 * @property {string}     candidate_label
 * @property {Object}     chrom_data   reference to the upstream chrom data
 */

/**
 * Try to derive an INV vs STD sample partition from upstream
 * inversion-atlas state. Returns null when there isn't enough data.
 *
 * @param {Object} atlasState
 * @returns {InvIdxResult|null}
 */
export function autoSeedInvIdx(atlasState) {
  const inv = (atlasState && atlasState.inversion) || null;
  const shared = (atlasState && atlasState.shared) || null;
  if (!inv || !shared) return null;

  const lpd = inv._local_pca_dosage_state;
  const data = lpd && lpd.data;
  if (!data || !Array.isArray(data.windows) || !Array.isArray(data.samples)) return null;
  const cand = shared.activeCandidate || null;
  if (!cand) return null;

  const nS = data.samples.length;
  if (nS < 4) return null;

  // Resolve the window range for the candidate.
  const wStart = _resolveWindow(cand, 'start_w', 'ref_window', 0);
  const wEnd   = _resolveWindow(cand, 'end_w',   'ref_window', wStart);
  if (!(wEnd >= wStart) || wEnd < 0) return null;

  // Mean PC1 per sample across the candidate window range.
  const mean = new Float64Array(nS);
  const n    = new Int32Array(nS);
  for (let w = wStart; w <= wEnd; w++) {
    const win = data.windows[w];
    if (!win || !win.pc1 || win.pc1.length !== nS) continue;
    for (let s = 0; s < nS; s++) {
      const v = win.pc1[s];
      if (Number.isFinite(v)) { mean[s] += v; n[s]++; }
    }
  }
  let goodCount = 0;
  for (let s = 0; s < nS; s++) {
    if (n[s] > 0) { mean[s] /= n[s]; goodCount++; }
    else          { mean[s] = NaN; }
  }
  if (goodCount < 4) return null;

  // Median of the finite means.
  const finite = [];
  for (let s = 0; s < nS; s++) if (Number.isFinite(mean[s])) finite.push(mean[s]);
  finite.sort((a, b) => a - b);
  const m = finite.length;
  const median = (m & 1) ? finite[(m - 1) >> 1] : 0.5 * (finite[m / 2 - 1] + finite[m / 2]);

  // Partition by sign of (mean - median). We pick the smaller class
  // (typically the rarer arrangement) as INV; downstream metrics are
  // symmetric in inv/std so this convention only matters for labels.
  const above = [], below = [];
  for (let s = 0; s < nS; s++) {
    if (!Number.isFinite(mean[s])) continue;
    if (mean[s] >= median) above.push(s);
    else below.push(s);
  }
  let inv_arr, std_arr;
  if (above.length <= below.length) {
    inv_arr = above; std_arr = below;
  } else {
    inv_arr = below; std_arr = above;
  }
  if (inv_arr.length < 2 || std_arr.length < 2) return null;

  return {
    inv_idx:        Int32Array.from(inv_arr),
    std_idx:        Int32Array.from(std_arr),
    sample_labels:  data.samples.map((s) => s && (s.cga || s.ind || String(s)) || ''),
    candidate_label: _candidateLabel(cand, data, wStart, wEnd),
    chrom_data:     data,
  };
}

function _resolveWindow(cand, primary, fallback, def) {
  if (!cand) return def | 0;
  const a = cand[primary];
  if (Number.isFinite(a)) return a | 0;
  const b = cand[fallback];
  if (Number.isFinite(b)) return b | 0;
  return def | 0;
}

function _candidateLabel(cand, data, wStart, wEnd) {
  const chrom = (data && data.chrom) || (cand && cand.chrom) || '';
  const id    = (cand && (cand.label || cand.id)) || `w=${wStart}–${wEnd}`;
  return chrom ? `${chrom} · ${id}` : id;
}

/**
 * Pull a (n_markers × n_samples) dosage matrix out of upstream chrom
 * data. Returns either `data.dosage_matrix` directly when present, or
 * assembles one from per-window `windows[w].dosage` rows. Falls back
 * to null when neither is available.
 *
 * @param {Object} data    upstream chrom precomp (atlas-side stash)
 * @returns {{ values: Float64Array, n_markers: number, n_samples: number }|null}
 */
export function chromDosageMatrix(data) {
  if (!data) return null;
  if (data.dosage_matrix && Number.isFinite(data.n_markers) && Number.isFinite(data.n_samples)) {
    return {
      values:    data.dosage_matrix,
      n_markers: data.n_markers | 0,
      n_samples: data.n_samples | 0,
    };
  }
  const samples = data.samples;
  const windows = data.windows;
  if (!Array.isArray(samples) || !Array.isArray(windows)) return null;
  const nS = samples.length;
  let nM = 0;
  for (let w = 0; w < windows.length; w++) {
    if (windows[w] && windows[w].dosage && windows[w].dosage.length === nS) nM++;
  }
  if (nM < 10) return null;
  const flat = new Float64Array(nM * nS);
  let row = 0;
  for (let w = 0; w < windows.length; w++) {
    const d = windows[w] && windows[w].dosage;
    if (!d || d.length !== nS) continue;
    for (let s = 0; s < nS; s++) {
      const v = d[s];
      flat[row * nS + s] = Number.isFinite(v) ? v : 0;
    }
    row++;
  }
  return { values: flat, n_markers: nM, n_samples: nS };
}

/**
 * One-call wrapper: combine `autoSeedInvIdx` + `chromDosageMatrix`
 * into a ready-to-consume input shape for pages whose contract is
 * `{ dosage, n_markers, n_samples, inv_idx, std_idx, candidate_label,
 *    sample_labels }`. Returns null when any piece is unavailable.
 *
 * @param {Object} atlasState
 * @returns {Object|null}
 */
export function autoSeedDosageInput(atlasState) {
  const seed = autoSeedInvIdx(atlasState);
  if (!seed) return null;
  const dosage = chromDosageMatrix(seed.chrom_data);
  if (!dosage) return null;
  return {
    dosage:          dosage.values,
    n_markers:       dosage.n_markers,
    n_samples:       dosage.n_samples,
    inv_idx:         Array.from(seed.inv_idx),
    std_idx:         Array.from(seed.std_idx),
    sample_labels:   seed.sample_labels,
    candidate_label: seed.candidate_label + '  (auto-derived inv/std_idx)',
    _auto_seeded:    true,
  };
}
