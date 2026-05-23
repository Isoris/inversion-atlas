// shared/ancestry_alignment.js
// =====================================================================
// Per-RF / per-window ancestry-label alignment for the fish-ancestry
// scroller (specs_todo/SPEC_fish_ancestry_scroller.md §"CRITICAL FIRST
// — the label-switching problem").
//
// NGSadmix (and any K-component EM admixture caller) emits Q + F
// matrices whose K columns are LABEL-INVARIANT: the column ordering
// of K components is arbitrary up to permutation. Two independent
// runs over overlapping data produce two valid solutions whose
// columns may be permuted relative to each other. If the scroller
// renders raw per-RF Q without alignment, every window boundary
// appears as a fake "ancestry switch" — pure numerical artefact.
//
// This module ships the ALIGNMENT primitives the scroller must run
// BEFORE rendering. The displayed track is `Q_aligned`, never `Q_raw`.
//
// Pipeline:
//   F-based alignment (preferred, when local F is stable)   →
//   Q-based alignment (fallback, FLANKING regions only — Q-alignment
//     is dangerous inside inversions because it can snap distinctive
//     local Q back to the global pattern, hiding the very inversion
//     signal we want to see)                                 →
//   Regime-aware neighbour smoothing (single-RF flips that don't
//     match adjacent windows → flag as numerical instability)
//
// Pure JS — no DOM, no fetch.

import { permutations } from '../../inversion/shared/hungarian.js';

// =====================================================================
// Vocab + defaults
// =====================================================================

/** Per-RF alignment status (spec §"Alignment-confidence output table"). */
export const ANCESTRY_ALIGN_STATUS = Object.freeze({
  PASS:      'PASS',
  WARN:      'WARN',
  FAIL:      'FAIL',
  SMOOTHED:  'SMOOTHED',     // post regime-aware smoothing
  AMBIGUOUS: 'ambiguous',    // legacy alias for FAIL when caller wants the
                              // distinction
});

/** Score thresholds + smoothing rule per spec §"Regime-aware
 *  neighbour smoothing". */
export const ANCESTRY_ALIGN_DEFAULTS = Object.freeze({
  pass_threshold:        0.85,
  warn_threshold:        0.70,
  // Centre RF score must trail BOTH neighbours by ≥ this margin
  // to qualify for smoothing override.
  smoothing_score_gap:   0.10,
  // Bail when K > 6 (720 permutations is fine; 5040 starts to hurt).
  max_K_for_bruteforce:  6,
});

/** Alignment method tag used in status records. */
export const ANCESTRY_ALIGN_METHOD = Object.freeze({
  F_BASED:    'F-based',
  Q_BASED:    'Q-based',
  AMBIGUOUS:  'ambiguous',
});

// =====================================================================
// 1. Brute-force best-permutation search on a K × K affinity matrix
// =====================================================================

/**
 * Given a K × K affinity matrix (row = local column, col = global
 * column), find the permutation `perm` of local columns that
 * maximises sum_k affinity[perm[k]][k]. Returns:
 *
 *   {
 *     perm:        [perm[0], perm[1], ..., perm[K-1]],
 *     score:       average per-K of the best permutation
 *                  (= total / K, so score ∈ [-1, 1] when affinity
 *                   is correlation)
 *     runner_up:   second-best permutation's score, or NaN when K=1
 *   }
 *
 * `perm[k] = i` means "local column i maps to global column k".
 *
 * @param {number[][]} affinity   K × K matrix
 * @param {number} K
 * @returns {{perm:number[], score:number, runner_up:number}|null}
 */
export function bestPermutationByAffinity(affinity, K) {
  if (!Array.isArray(affinity) || !(K >= 1)) return null;
  if (K > ANCESTRY_ALIGN_DEFAULTS.max_K_for_bruteforce) {
    return null;   // caller should fall back to Hungarian for large K
  }
  const perms = permutations(K);
  let bestPerm = null, bestScore = -Infinity, runnerUp = -Infinity;
  for (const p of perms) {
    let s = 0;
    for (let k = 0; k < K; k++) {
      const row = affinity[p[k]];
      if (!row) { s = -Infinity; break; }
      const v = row[k];
      s += Number.isFinite(v) ? v : 0;
    }
    s /= K;
    if (s > bestScore) {
      runnerUp = bestScore;
      bestScore = s;
      bestPerm = p.slice();
    } else if (s > runnerUp) {
      runnerUp = s;
    }
  }
  return {
    perm: bestPerm,
    score: bestScore,
    runner_up: Number.isFinite(runnerUp) ? runnerUp : NaN,
  };
}

// =====================================================================
// 2. Pearson correlation between two equal-length arrays (NaN-tolerant)
// =====================================================================

function _pearson(a, b) {
  if (!a || !b || a.length !== b.length) return NaN;
  const n = a.length;
  let n_used = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(a[i]) && Number.isFinite(b[i])) {
      sa += a[i]; sb += b[i]; n_used++;
    }
  }
  if (n_used < 2) return NaN;
  const ma = sa / n_used, mb = sb / n_used;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
    const ai = a[i] - ma, bi = b[i] - mb;
    num += ai * bi; da += ai * ai; db += bi * bi;
  }
  if (da === 0 || db === 0) return NaN;
  const r = num / Math.sqrt(da * db);
  if (!Number.isFinite(r)) return NaN;
  return Math.max(-1, Math.min(1, r));
}

// =====================================================================
// 3. F-based alignment (preferred path)
// =====================================================================

/**
 * F-based alignment per spec §"Level 1: F-based alignment".
 *
 * For each (local_k, global_k) pair, compute the Pearson correlation
 * between local_F[:, local_k] and global_F[:, global_k] across the
 * shared SNPs. Then brute-force-search for the K × K permutation
 * that maximises the diagonal sum.
 *
 * Inputs:
 *   - local_F:  SNP × K array of local allele frequencies (rows =
 *               SNPs, cols = K components). Caller has already
 *               restricted SNPs to those with both local and global
 *               F values.
 *   - global_F: SNP × K array of global allele frequencies.
 *   - K:        number of admixture components.
 *
 * Returns:
 *   {
 *     ok:           bool
 *     reason?:      string when ok=false
 *     perm:         length-K permutation; perm[global_k] = local_k
 *     score:        average best-pair correlation across K
 *     runner_up:    second-best permutation score
 *     n_snps_used:  rows from local_F + global_F (rows must equal)
 *   }
 *
 * @param {number[][]} local_F
 * @param {number[][]} global_F
 * @param {number} K
 * @param {Object} [opts]
 * @returns {Object}
 */
export function alignAncestryColumnsByF(local_F, global_F, K, opts) {
  if (!Array.isArray(local_F) || !Array.isArray(global_F)
      || !(K >= 1)) {
    return { ok: false, reason: 'invalid_inputs' };
  }
  if (local_F.length === 0 || global_F.length === 0) {
    return { ok: false, reason: 'no_snps' };
  }
  if (local_F.length !== global_F.length) {
    return { ok: false, reason: 'snp_count_mismatch',
              n_local: local_F.length, n_global: global_F.length };
  }
  if (K > ANCESTRY_ALIGN_DEFAULTS.max_K_for_bruteforce) {
    return { ok: false, reason: 'K_too_large_for_bruteforce' };
  }
  // Build K × K correlation matrix.
  const n_snps = local_F.length;
  const affinity = Array.from({ length: K }, () => new Array(K).fill(0));
  for (let lk = 0; lk < K; lk++) {
    const lcol = new Float64Array(n_snps);
    for (let i = 0; i < n_snps; i++) {
      lcol[i] = local_F[i] && Number.isFinite(local_F[i][lk])
        ? local_F[i][lk] : NaN;
    }
    for (let gk = 0; gk < K; gk++) {
      const gcol = new Float64Array(n_snps);
      for (let i = 0; i < n_snps; i++) {
        gcol[i] = global_F[i] && Number.isFinite(global_F[i][gk])
          ? global_F[i][gk] : NaN;
      }
      affinity[lk][gk] = _pearson(lcol, gcol);
    }
  }
  const best = bestPermutationByAffinity(affinity, K);
  if (!best || best.perm == null) {
    return { ok: false, reason: 'no_valid_permutation' };
  }
  return {
    ok: true,
    method: ANCESTRY_ALIGN_METHOD.F_BASED,
    perm: best.perm,
    score: best.score,
    runner_up: best.runner_up,
    affinity,
    n_snps_used: n_snps,
  };
}

// =====================================================================
// 4. Q-based alignment (fallback, FLANKING ONLY)
// =====================================================================

/**
 * Q-based alignment per spec §"Level 2: Q-based alignment fallback".
 * Inputs:
 *   - local_Q:  fish × K array of local admixture proportions
 *   - global_Q: fish × K array of global admixture proportions
 *
 * Returns the same shape as alignAncestryColumnsByF; method tag
 * is 'Q-based'.
 *
 * Caveat from the spec (echoed in inline comments at the call site):
 * Q-alignment is risky for inversion regions because local Q
 * *should* differ from global Q inside inversions; aligning by Q
 * snaps the distinctive inversion signal back to the global
 * pattern. Use only for flanking-region RFs.
 *
 * @param {number[][]} local_Q
 * @param {number[][]} global_Q
 * @param {number} K
 * @param {Object} [opts]
 * @returns {Object}
 */
export function alignAncestryColumnsByQ(local_Q, global_Q, K, opts) {
  if (!Array.isArray(local_Q) || !Array.isArray(global_Q)
      || !(K >= 1)) {
    return { ok: false, reason: 'invalid_inputs' };
  }
  if (local_Q.length === 0 || global_Q.length === 0) {
    return { ok: false, reason: 'no_fish' };
  }
  if (local_Q.length !== global_Q.length) {
    return { ok: false, reason: 'fish_count_mismatch',
              n_local: local_Q.length, n_global: global_Q.length };
  }
  if (K > ANCESTRY_ALIGN_DEFAULTS.max_K_for_bruteforce) {
    return { ok: false, reason: 'K_too_large_for_bruteforce' };
  }
  const n_fish = local_Q.length;
  const affinity = Array.from({ length: K }, () => new Array(K).fill(0));
  for (let lk = 0; lk < K; lk++) {
    const lcol = new Float64Array(n_fish);
    for (let i = 0; i < n_fish; i++) {
      lcol[i] = local_Q[i] && Number.isFinite(local_Q[i][lk])
        ? local_Q[i][lk] : NaN;
    }
    for (let gk = 0; gk < K; gk++) {
      const gcol = new Float64Array(n_fish);
      for (let i = 0; i < n_fish; i++) {
        gcol[i] = global_Q[i] && Number.isFinite(global_Q[i][gk])
          ? global_Q[i][gk] : NaN;
      }
      affinity[lk][gk] = _pearson(lcol, gcol);
    }
  }
  const best = bestPermutationByAffinity(affinity, K);
  if (!best || best.perm == null) {
    return { ok: false, reason: 'no_valid_permutation' };
  }
  return {
    ok: true,
    method: ANCESTRY_ALIGN_METHOD.Q_BASED,
    perm: best.perm,
    score: best.score,
    runner_up: best.runner_up,
    affinity,
    n_fish_used: n_fish,
  };
}

// =====================================================================
// 5. Apply the permutation to a raw Q matrix
// =====================================================================

/**
 * Reorder the columns of a raw Q matrix according to a permutation.
 *
 * `perm[global_k] = local_k` (as returned by alignAncestryColumnsByF
 * / alignAncestryColumnsByQ). Output column g gets values from
 * input column perm[g] — i.e. Q_aligned[i, g] = Q_raw[i, perm[g]].
 *
 * @param {number[][]} Q_raw
 * @param {number[]} perm
 * @returns {number[][]}
 */
export function applyAncestryPermutation(Q_raw, perm) {
  if (!Array.isArray(Q_raw) || !Array.isArray(perm)) return [];
  const K = perm.length;
  const out = new Array(Q_raw.length);
  for (let i = 0; i < Q_raw.length; i++) {
    const row = Q_raw[i];
    if (!row) { out[i] = null; continue; }
    const o = new Array(K);
    for (let g = 0; g < K; g++) {
      const idx = perm[g];
      o[g] = (idx >= 0 && idx < row.length) ? row[idx] : NaN;
    }
    out[i] = o;
  }
  return out;
}

// =====================================================================
// 6. Score → status classification
// =====================================================================

/**
 * Classify an alignment score per spec table:
 *   ≥ pass_threshold  → PASS
 *   ≥ warn_threshold  → WARN
 *   else              → FAIL
 *
 * @param {number} score
 * @param {Object} [opts]
 * @returns {string}  ANCESTRY_ALIGN_STATUS value
 */
export function classifyAncestryAlignmentStatus(score, opts) {
  const o = opts || {};
  const pass = Number.isFinite(o.pass_threshold)
    ? o.pass_threshold : ANCESTRY_ALIGN_DEFAULTS.pass_threshold;
  const warn = Number.isFinite(o.warn_threshold)
    ? o.warn_threshold : ANCESTRY_ALIGN_DEFAULTS.warn_threshold;
  if (!Number.isFinite(score)) return ANCESTRY_ALIGN_STATUS.FAIL;
  if (score >= pass) return ANCESTRY_ALIGN_STATUS.PASS;
  if (score >= warn) return ANCESTRY_ALIGN_STATUS.WARN;
  return ANCESTRY_ALIGN_STATUS.FAIL;
}

// =====================================================================
// 7. alignPerRFAncestry — top-level orchestrator
// =====================================================================

/**
 * Run the F-first / Q-fallback pipeline for one RF. Returns a
 * status record + an aligned Q matrix (or null when ambiguous).
 *
 *   {
 *     RF_id,
 *     method:      'F-based' | 'Q-based' | 'ambiguous'
 *     perm:        [perm[0], ..., perm[K-1]] or null
 *     align_score: number
 *     status:      ANCESTRY_ALIGN_STATUS.*
 *     Q_aligned:   reordered Q matrix or null
 *   }
 *
 * Per the spec, Q-fallback is risky inside inversion regions. The
 * caller passes `is_inside_inversion: true` to disable Q fallback
 * for that RF.
 *
 * @param {Object} args
 * @param {Object} [opts]
 * @returns {Object}
 */
export function alignPerRFAncestry(args, opts) {
  const a = args || {};
  const o = opts || {};
  const K = a.K;
  const out = {
    RF_id: a.RF_id != null ? a.RF_id : null,
    method: null,
    perm: null,
    align_score: NaN,
    runner_up: NaN,
    status: ANCESTRY_ALIGN_STATUS.FAIL,
    Q_aligned: null,
  };

  // Step 1 — try F-based alignment.
  if (Array.isArray(a.local_F) && Array.isArray(a.global_F)
      && K >= 1) {
    const fa = alignAncestryColumnsByF(a.local_F, a.global_F, K, o);
    if (fa.ok) {
      out.method = ANCESTRY_ALIGN_METHOD.F_BASED;
      out.perm = fa.perm;
      out.align_score = fa.score;
      out.runner_up = fa.runner_up;
      out.status = classifyAncestryAlignmentStatus(fa.score, o);
      if (out.status !== ANCESTRY_ALIGN_STATUS.FAIL
          && Array.isArray(a.Q_raw)) {
        out.Q_aligned = applyAncestryPermutation(a.Q_raw, fa.perm);
      }
      // Return on PASS / WARN; FAIL → try Q fallback below.
      if (out.status !== ANCESTRY_ALIGN_STATUS.FAIL) return out;
    }
  }

  // Step 2 — Q-based fallback (only when NOT inside an inversion).
  if (a.is_inside_inversion === true) {
    out.method = ANCESTRY_ALIGN_METHOD.AMBIGUOUS;
    return out;
  }
  if (Array.isArray(a.local_Q) && Array.isArray(a.global_Q)
      && K >= 1) {
    const qa = alignAncestryColumnsByQ(a.local_Q, a.global_Q, K, o);
    if (qa.ok) {
      out.method = ANCESTRY_ALIGN_METHOD.Q_BASED;
      out.perm = qa.perm;
      out.align_score = qa.score;
      out.runner_up = qa.runner_up;
      out.status = classifyAncestryAlignmentStatus(qa.score, o);
      if (out.status !== ANCESTRY_ALIGN_STATUS.FAIL
          && Array.isArray(a.Q_raw)) {
        out.Q_aligned = applyAncestryPermutation(a.Q_raw, qa.perm);
      }
      return out;
    }
  }
  // Neither path worked.
  out.method = ANCESTRY_ALIGN_METHOD.AMBIGUOUS;
  return out;
}

// =====================================================================
// 8. applyRegimeAwareSmoothing — neighbour-consensus override
// =====================================================================

/**
 * Apply regime-aware neighbour smoothing per spec §"Regime-aware
 * neighbour smoothing":
 *
 *   if  RF_n.perm   != RF_{n-1}.perm
 *   and RF_n.perm   != RF_{n+1}.perm
 *   and RF_{n-1}.perm == RF_{n+1}.perm
 *   and RF_n.score  <  min(RF_{n-1}, RF_{n+1}).score - smoothing_score_gap
 *   then override RF_n.perm with neighbour consensus
 *        mark RF_n.status as SMOOTHED
 *
 * Returns a NEW array of alignment records (input is not mutated).
 *
 * @param {Array<Object>} perRFAlignments  output of alignPerRFAncestry
 *                                          for consecutive RFs, in
 *                                          genomic order
 * @param {Object} [opts]
 * @returns {Array<Object>}
 */
export function applyRegimeAwareSmoothing(perRFAlignments, opts) {
  if (!Array.isArray(perRFAlignments) || perRFAlignments.length < 3) {
    return Array.isArray(perRFAlignments) ? perRFAlignments.slice() : [];
  }
  const o = opts || {};
  const gap = Number.isFinite(o.smoothing_score_gap)
    ? o.smoothing_score_gap
    : ANCESTRY_ALIGN_DEFAULTS.smoothing_score_gap;

  function permEq(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  const out = perRFAlignments.map(r => Object.assign({}, r));
  for (let i = 1; i < out.length - 1; i++) {
    const prev = out[i - 1], cur = out[i], next = out[i + 1];
    if (!cur || !prev || !next) continue;
    if (!permEq(prev.perm, next.perm)) continue;        // neighbours don't agree
    if (permEq(cur.perm, prev.perm)) continue;          // cur already matches
    const sCur = cur.align_score;
    const sPrev = prev.align_score, sNext = next.align_score;
    if (!Number.isFinite(sCur) || !Number.isFinite(sPrev)
        || !Number.isFinite(sNext)) continue;
    if (sCur >= Math.min(sPrev, sNext) - gap) continue; // not low enough
    // Override.
    cur.perm = prev.perm.slice();
    cur.status = ANCESTRY_ALIGN_STATUS.SMOOTHED;
    cur.smoothed_from_score = sCur;
    cur.smoothed_to_perm = prev.perm.slice();
  }
  return out;
}
