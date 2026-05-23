// shared/mgl_pca_compute.js
// =====================================================================
// Compute the SPEC_0 §8 per-window PCA result live from a dosage
// matrix (output of shared/mgl_beagle_parser.js). The output shape
// matches shared/mgl_pca_json.fromPrecomputedJson — the renderer
// doesn't care which path produced it.
//
// Why JS-side compute is feasible (SPEC_0 §8 noted this is normally
// producer-side):
//   - Sample-space PCA = eigendecomp of an n×n covariance, where
//     n = n_samples (~226 for the catfish cohort). At n=226 the
//     decomp is milliseconds even via plain power-iteration
//     deflation.
//   - The browser already loads the per-candidate Beagle (~10-50 MB)
//     for the live-render path; once that's in memory, compute is
//     trivial.
//
// What this module does:
//   1. Per-marker centering on a chosen sample subset (centering
//      anchor — 'all' / 'het' / 'hom1' / 'hom2' / 'custom')
//   2. Per-marker polarity flipping (SPEC_0 §10.4)
//   3. Anchor-mode PCA:
//        - bi_baseline: project onto a precomputed basis (caller
//          supplies V_anchor)
//        - view_self:   eigendecomp the view's own covariance
//        - none:        eigendecomp without any anchor
//        - both:        emit both bi_baseline + view_self variants
//   4. Per-window iteration (caller specifies window grid)
//
// Pure compute. No DOM, no I/O.
// =====================================================================

// =====================================================================
// 1. Eigendecomposition — power-iteration with deflation
// =====================================================================

/**
 * Top-K eigenvectors + eigenvalues of an n×n symmetric matrix.
 *
 * Uses simple power iteration with deflation:
 *   - For each k: start with a normalised random vector
 *   - Iterate v ← Av / ||Av|| until convergence
 *   - λ_k = v^T A v
 *   - Deflate: A ← A − λ_k v v^T
 *
 * Fast and stable for k≪n with well-separated top eigenvalues —
 * which is exactly the PCA-top-2 case for sample covariance.
 *
 * @param {Float64Array} A_flat   row-major n×n symmetric matrix
 *                                 (mutated! pass a copy if needed)
 * @param {number} n              dim
 * @param {number} k              number of eigenvectors to return
 *                                (default 2)
 * @param {Object} [opts]
 * @returns {{values: number[], vectors: Float64Array[]}}
 *   vectors[i] is a Float64Array of length n.
 */
export function topEigenvectorsSymmetric(A_flat, n, k, opts) {
  const o = opts || {};
  const max_iter = Number.isFinite(o.max_iter) ? o.max_iter : 200;
  const tol      = Number.isFinite(o.tol)      ? o.tol      : 1e-10;
  const K = k > 0 ? k | 0 : 2;
  const values  = new Array(K);
  const vectors = new Array(K);
  const A = A_flat;   // mutated
  const v = new Float64Array(n);
  const Av = new Float64Array(n);
  let seed = 1;       // deterministic across runs
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed % 1000) / 1000 - 0.5;
  };
  for (let kk = 0; kk < K; kk++) {
    // Initialise v with deterministic non-zero values.
    for (let i = 0; i < n; i++) v[i] = rng() + 1e-6;
    _normalise(v);
    let lambda = 0, lambda_prev = NaN;
    for (let iter = 0; iter < max_iter; iter++) {
      // Av = A · v
      for (let i = 0; i < n; i++) {
        let s = 0;
        const row = i * n;
        for (let j = 0; j < n; j++) s += A[row + j] * v[j];
        Av[i] = s;
      }
      // λ = v^T A v
      let l = 0;
      for (let i = 0; i < n; i++) l += v[i] * Av[i];
      // v ← Av / ||Av||
      let norm = 0;
      for (let i = 0; i < n; i++) norm += Av[i] * Av[i];
      norm = Math.sqrt(norm);
      if (norm < tol) { lambda = 0; break; }
      for (let i = 0; i < n; i++) v[i] = Av[i] / norm;
      lambda = l;
      if (Number.isFinite(lambda_prev) && Math.abs(lambda - lambda_prev) < tol) break;
      lambda_prev = lambda;
    }
    values[kk]  = lambda;
    vectors[kk] = v.slice();
    // Deflate: A ← A − λ v v^T
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) A[i * n + j] -= lambda * v[i] * v[j];
    }
  }
  return { values, vectors };
}

function _normalise(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  s = Math.sqrt(s);
  if (s > 0) for (let i = 0; i < v.length; i++) v[i] /= s;
  return v;
}

// =====================================================================
// 2. Per-marker centering on a sample subset
// =====================================================================

/**
 * Center each marker (row) of a dosage matrix on a chosen subset
 * of samples. Mutates the matrix in place.
 *
 * @param {Float64Array} dosage   row-major n_markers × n_samples
 * @param {number} n_markers
 * @param {number} n_samples
 * @param {number[]|null} subset_idx   sample indices defining the
 *   centering mean. null/undefined = use all samples.
 * @returns {Float64Array} the same matrix (mutated)
 */
export function centerDosageOnSubset(dosage, n_markers, n_samples, subset_idx) {
  const idx = (Array.isArray(subset_idx) && subset_idx.length > 0)
    ? subset_idx : null;
  for (let r = 0; r < n_markers; r++) {
    const off = r * n_samples;
    let sum = 0, count = 0;
    if (idx) {
      for (const s of idx) {
        if (s >= 0 && s < n_samples) { sum += dosage[off + s]; count++; }
      }
    } else {
      for (let s = 0; s < n_samples; s++) { sum += dosage[off + s]; count++; }
    }
    if (count === 0) continue;
    const mean = sum / count;
    for (let s = 0; s < n_samples; s++) dosage[off + s] -= mean;
  }
  return dosage;
}

// =====================================================================
// 3. Per-marker polarity flipping
// =====================================================================

/**
 * Per-marker polarity flip rule (SPEC_0 §10.4 — reference =
 * 'pc1_correlation'): flip a marker's sign when its correlation
 * with a reference per-sample PC1 vector is negative.
 *
 * Mutates the dosage matrix in place. Returns the number of
 * markers flipped.
 *
 * @param {Float64Array} dosage      row-major n_markers × n_samples
 * @param {number} n_markers
 * @param {number} n_samples
 * @param {Float64Array} ref_pc1     length n_samples
 * @returns {number}                 count of markers flipped
 */
export function applyPolarityFlipsFromRefPC1(dosage, n_markers, n_samples, ref_pc1) {
  if (!ref_pc1 || ref_pc1.length !== n_samples) return 0;
  // Pre-center ref_pc1.
  let rmean = 0;
  for (let i = 0; i < n_samples; i++) rmean += ref_pc1[i];
  rmean /= n_samples;
  let flipped = 0;
  for (let r = 0; r < n_markers; r++) {
    const off = r * n_samples;
    let dot = 0, dm = 0;
    for (let s = 0; s < n_samples; s++) {
      dot += dosage[off + s] * (ref_pc1[s] - rmean);
      dm  += dosage[off + s];
    }
    if (dot < 0) {
      // Flip: x ← -x (we work on centered values, so just negate).
      for (let s = 0; s < n_samples; s++) dosage[off + s] = -dosage[off + s];
      flipped++;
    }
    void dm;
  }
  return flipped;
}

// =====================================================================
// 4. Sample-space covariance + per-sample PCA scores
// =====================================================================

/**
 * Build the n_samples × n_samples covariance C from a row-major
 * dosage matrix (markers × samples).
 *
 *   C_ij = (1/m) Σ_r D[r,i] · D[r,j]
 *
 * Returns a flat Float64Array of length n_samples * n_samples.
 */
export function buildSampleCovariance(dosage, n_markers, n_samples) {
  const C = new Float64Array(n_samples * n_samples);
  if (n_markers === 0 || n_samples === 0) return C;
  for (let r = 0; r < n_markers; r++) {
    const off = r * n_samples;
    for (let i = 0; i < n_samples; i++) {
      const di = dosage[off + i];
      if (di === 0) continue;
      const rowOff = i * n_samples;
      for (let j = i; j < n_samples; j++) {
        const c = di * dosage[off + j];
        C[rowOff + j] += c;
        if (j !== i) C[j * n_samples + i] += c;
      }
    }
  }
  const inv = 1 / n_markers;
  for (let i = 0; i < C.length; i++) C[i] *= inv;
  return C;
}

/**
 * Compute the per-window PCA result for one window, given a
 * centered + polarity-flipped dosage slice.
 *
 *   anchor_mode='view_self' or 'none' → eigendecomp the view's own
 *                                       covariance
 *   anchor_mode='bi_baseline'         → project onto the supplied
 *                                       basis V_anchor (n × k)
 *
 * Returns the canonical per-window struct matching the JSON shape.
 *
 * @param {Object} args
 * @param {Float64Array} args.dosage          row-major n_markers × n_samples
 *                                             (already centered + flipped)
 * @param {number} args.n_markers
 * @param {number} args.n_samples
 * @param {string} args.anchor_mode           'bi_baseline' | 'view_self' | 'none' | 'both'
 * @param {Float64Array[]|null} [args.anchor_vectors]  required for 'bi_baseline'
 * @param {number[]|null}       [args.anchor_values]   eigenvalues paired with anchor_vectors
 * @returns {{
 *   lam1:number, lam2:number, pc1:Float64Array, pc2:Float64Array,
 *   lam1_self?:number, lam2_self?:number,
 *   pc1_self?:Float64Array, pc2_self?:Float64Array,
 *   polarity_flips_applied:number,
 * }}
 */
export function pcaForWindow(args) {
  const a = args || {};
  const C = buildSampleCovariance(a.dosage, a.n_markers, a.n_samples);

  const mode = a.anchor_mode || 'view_self';
  const wantBi   = mode === 'bi_baseline' || mode === 'both';
  const wantSelf = mode === 'view_self'   || mode === 'none' || mode === 'both';

  const out = {
    lam1: NaN, lam2: NaN,
    pc1: null, pc2: null,
    polarity_flips_applied: 0,
  };

  if (wantSelf) {
    const eig = topEigenvectorsSymmetric(C.slice(), a.n_samples, 2);
    out.lam1 = eig.values[0];
    out.lam2 = eig.values[1];
    // Per-sample PC scores. For sample-space PCA where each sample
    // is a row of D (n_samples × n_markers), the score is just the
    // eigenvector entry (the eigvec IS the per-sample loading).
    out.pc1 = eig.vectors[0];
    out.pc2 = eig.vectors[1];
    if (mode === 'view_self' || mode === 'none') return out;
    // 'both' — preserve as _self, will overwrite default below.
    out.lam1_self = out.lam1; out.lam2_self = out.lam2;
    out.pc1_self  = out.pc1;  out.pc2_self  = out.pc2;
  }
  if (wantBi) {
    if (!Array.isArray(a.anchor_vectors) || a.anchor_vectors.length < 2) {
      // Anchor missing — fall back to self.
      if (out.pc1) return out;
      const eig = topEigenvectorsSymmetric(C.slice(), a.n_samples, 2);
      out.lam1 = eig.values[0]; out.lam2 = eig.values[1];
      out.pc1  = eig.vectors[0]; out.pc2 = eig.vectors[1];
      return out;
    }
    // Project: score = anchor_vec · normalised(C · anchor_vec) ... but
    // the simpler atlas pattern is just: PC1_proj = anchor_vec[0]
    // re-applied. We compute "displacement along the anchor axes":
    //   pc_proj_k[i] = anchor_vec[k][i]  (already a sample-space basis)
    //   lam_proj_k  = anchor_vec[k]^T C anchor_vec[k]
    const lam_proj_1 = _quadForm(C, a.anchor_vectors[0], a.n_samples);
    const lam_proj_2 = _quadForm(C, a.anchor_vectors[1], a.n_samples);
    out.lam1 = lam_proj_1; out.lam2 = lam_proj_2;
    out.pc1  = a.anchor_vectors[0].slice();
    out.pc2  = a.anchor_vectors[1].slice();
  }
  return out;
}

function _quadForm(M, v, n) {
  // v^T M v
  let s = 0;
  for (let i = 0; i < n; i++) {
    let row = 0;
    const off = i * n;
    for (let j = 0; j < n; j++) row += M[off + j] * v[j];
    s += v[i] * row;
  }
  return s;
}

// =====================================================================
// 5. End-to-end: dosage matrix → per-window PCA result list
// =====================================================================

/**
 * Top-level helper: turn a parsed dosage matrix (output of
 * mgl_beagle_parser.parseBeagleToDosage) into the per-window PCA
 * result list. Each window must come with a marker-index range
 * `[start_marker_idx, end_marker_idx)` selecting which markers go
 * into its PCA.
 *
 * @param {Object} args
 * @param {Object} args.dosage_result     parser output
 * @param {Array<{start_idx:number, end_idx:number,
 *                start_bp?:number, end_bp?:number, idx?:number}>} args.windows
 * @param {string} [args.anchor_mode='view_self']
 * @param {Float64Array[]|null} [args.anchor_vectors]
 * @param {number[]|null}       [args.centering_subset]  sample indices
 * @param {Float64Array|null}   [args.polarity_ref_pc1]  if set, flip markers
 *                                                       to align with this
 * @returns {Array<Object>}   one struct per window (canonical shape)
 */
export function computePcaForWindowList(args) {
  const a = args || {};
  const d = a.dosage_result;
  if (!d || !d.dosage_matrix) return [];
  const windows = Array.isArray(a.windows) ? a.windows : [];
  const out = new Array(windows.length);
  for (let wi = 0; wi < windows.length; wi++) {
    const w = windows[wi];
    if (!w) { out[wi] = null; continue; }
    const s = Math.max(0, w.start_idx | 0);
    const e = Math.max(s, Math.min(d.n_markers, (w.end_idx | 0)));
    const n_w_markers = e - s;
    // Slice dosage rows [s..e) into a fresh contiguous matrix
    // (centering + polarity-flipping mutates it, so we don't want
    // to touch the original).
    const slice = d.dosage_matrix.slice(s * d.n_samples, e * d.n_samples);
    centerDosageOnSubset(slice, n_w_markers, d.n_samples, a.centering_subset);
    let flips = 0;
    if (a.polarity_ref_pc1) {
      flips = applyPolarityFlipsFromRefPC1(slice, n_w_markers, d.n_samples, a.polarity_ref_pc1);
    }
    const pca = pcaForWindow({
      dosage:         slice,
      n_markers:      n_w_markers,
      n_samples:      d.n_samples,
      anchor_mode:    a.anchor_mode || 'view_self',
      anchor_vectors: a.anchor_vectors,
    });
    out[wi] = Object.assign({}, pca, {
      idx:                    Number.isFinite(w.idx) ? w.idx : wi,
      start:                  w.start_bp != null ? w.start_bp : null,
      end:                    w.end_bp   != null ? w.end_bp   : null,
      n_pair_rows:            n_w_markers,
      polarity_flips_applied: flips,
    });
  }
  return out;
}
