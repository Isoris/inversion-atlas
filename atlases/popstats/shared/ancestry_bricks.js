// shared/ancestry_bricks.js
// =====================================================================
// Ancestry-brick construction for the fish-ancestry scroller
// (specs_todo/SPEC_fish_ancestry_scroller.md §"Ancestry bricks —
// derived simplification layer (Layer 2 detail)").
//
// A brick is a contiguous run of RF windows where local ancestry is
// coherent AFTER label-switch correction (Q_aligned, not Q_raw).
// Bricks are a simplification layer on top of the per-RF aligned-Q
// painting — supporting evidence, not a separate discovery system.
//
// Construction rule per spec:
//   For each fish, walk RFs in genomic order. RF_n joins the current
//   brick iff
//     1. argmax(Q_aligned[fish, n]) == current_brick.dominant_K
//     2. Q_aligned[fish, n, dominant_K] >= min_purity (default 0.6)
//     3. alignment_status ∈ {PASS, WARN, SMOOTHED}
//     4. No Stage-4 regime boundary between RF_n and RF_{n-1}
//   FAIL status breaks bricks (gap markers).
//
// Pure JS — no DOM, no fetch.

import { ANCESTRY_ALIGN_STATUS } from './ancestry_alignment.js';

// =====================================================================
// Vocab + defaults
// =====================================================================

/** Status flag vocab per spec §"Per-brick annotation labels". */
export const ANCESTRY_BRICK_FLAGS = Object.freeze({
  COMMON:             'COMMON',
  RARE_ANCESTRY:      'RARE_ANCESTRY',
  HIGH_HET:           'HIGH_HET',
  LOW_HET:            'LOW_HET',
  ROH_LIKE:           'ROH_LIKE',
  HIGH_DELTA_Q:       'HIGH_DELTA_Q',
  LOW_CONFIDENCE:     'LOW_CONFIDENCE',
  REGIME_DISCORDANT:  'REGIME_DISCORDANT',
  DOSAGE_DISCORDANT:  'DOSAGE_DISCORDANT',
  BOUNDARY_BRICK:     'BOUNDARY_BRICK',
  RECOMBINANT_LIKE:   'RECOMBINANT_LIKE',
  FRAGMENT:           'FRAGMENT',
});

/** Construction + flag thresholds per spec §"Brick construction" +
 *  §"Per-brick annotation labels" table. */
export const ANCESTRY_BRICK_DEFAULTS = Object.freeze({
  min_purity:           0.6,
  min_brick_length:     3,            // RFs
  min_brick_bp:         50_000,
  rarity_common_below:  0.10,
  rarity_rare_above:    0.80,
  high_het_z_above:     2.0,
  low_het_z_below:     -2.0,
  roh_overlap_above:    0.5,
  roh_het_z_below:     -1.0,
  high_delta_q_above:   0.30,
  low_confidence_below: 0.70,
  boundary_window_rfs:  1,
  dosage_delta_q_above: 0.20,
});

/** Alignment statuses that are ELIGIBLE to join a brick. */
const JOIN_STATUSES = new Set([
  ANCESTRY_ALIGN_STATUS.PASS,
  ANCESTRY_ALIGN_STATUS.WARN,
  ANCESTRY_ALIGN_STATUS.SMOOTHED,
]);

// =====================================================================
// 1. Per-RF dominance helpers
// =====================================================================

/**
 * argmax of a Q-vector. Returns -1 if the vector is empty or all
 * non-finite.
 *
 * @param {number[]|Float32Array|Float64Array} q
 * @returns {number}
 */
export function dominantKFor(q) {
  if (!q || typeof q.length !== 'number' || q.length === 0) return -1;
  let bestK = -1, bestV = -Infinity;
  for (let k = 0; k < q.length; k++) {
    const v = q[k];
    if (Number.isFinite(v) && v > bestV) { bestV = v; bestK = k; }
  }
  return bestK;
}

/**
 * Shannon entropy of a Q-vector (in nats). Returns NaN for empty /
 * all-non-finite input. Zero-probability components contribute 0.
 *
 * @param {number[]|Float32Array|Float64Array} q
 * @returns {number}
 */
export function shannonEntropyOfQ(q) {
  if (!q || typeof q.length !== 'number' || q.length === 0) return NaN;
  let sum = 0;
  for (let k = 0; k < q.length; k++) {
    if (Number.isFinite(q[k])) sum += q[k];
  }
  if (sum <= 0) return NaN;
  let H = 0;
  for (let k = 0; k < q.length; k++) {
    const v = q[k];
    if (!Number.isFinite(v) || v <= 0) continue;
    const p = v / sum;
    H -= p * Math.log(p);
  }
  return H;
}

// =====================================================================
// 2. Brick construction — per fish
// =====================================================================

/**
 * Build the brick list for ONE fish from per-RF aligned-Q vectors +
 * per-RF alignment statuses.
 *
 * Inputs:
 *   - aligned_Q_rows: Array<{Q:number[], alignment_status:string,
 *                            align_score:number, start_bp:number,
 *                            end_bp:number, regime_id?:any}>
 *     ordered by genomic position (left → right). One entry per RF.
 *
 * `regime_id` is the Stage-4 regime label the RF sits in; when two
 * adjacent RFs differ here, the brick breaks (regime-aware merging).
 * If `regime_id` is missing on every RF, the regime-boundary check
 * is skipped (no extra breaks).
 *
 * Returns a flat array of brick objects with the geometry fields
 * filled in. Metrics that need cohort context (rarity_score,
 * heterozygosity_z) and flags are added later via attachBrickMetrics.
 *
 * @param {Array<Object>} aligned_Q_rows
 * @param {Object} [opts]
 * @returns {Array<Object>}
 */
export function buildBricksForFish(aligned_Q_rows, opts) {
  if (!Array.isArray(aligned_Q_rows) || aligned_Q_rows.length === 0) return [];
  const o = opts || {};
  const minPurity = Number.isFinite(o.min_purity)
    ? o.min_purity : ANCESTRY_BRICK_DEFAULTS.min_purity;

  const bricks = [];
  let cur = null;

  const flushCurrent = () => {
    if (!cur) return;
    cur.length_bp = Math.max(0, cur.end_bp - cur.start_bp);
    bricks.push(cur);
    cur = null;
  };

  for (let i = 0; i < aligned_Q_rows.length; i++) {
    const rf = aligned_Q_rows[i];
    if (!rf || !Array.isArray(rf.Q)) { flushCurrent(); continue; }
    const status = rf.alignment_status;
    const Q = rf.Q;
    const eligible = JOIN_STATUSES.has(status);
    if (!eligible) { flushCurrent(); continue; }
    const k = dominantKFor(Q);
    if (k < 0) { flushCurrent(); continue; }
    const purity = Q[k];
    if (!Number.isFinite(purity) || purity < minPurity) {
      flushCurrent(); continue;
    }
    // Regime-aware boundary check: split when regime_id changes
    // between adjacent RFs.
    const prevRegime = i > 0
      ? (aligned_Q_rows[i - 1] && aligned_Q_rows[i - 1].regime_id)
      : null;
    const curRegime = rf.regime_id != null ? rf.regime_id : null;
    if (cur != null && prevRegime != null && curRegime != null
        && prevRegime !== curRegime) {
      flushCurrent();
    }
    // Decide: extend current brick or start a new one.
    if (cur != null && cur.dominant_K === k) {
      cur.end_bp = rf.end_bp;
      cur.n_RF_windows++;
      cur.rf_indices.push(i);
      cur.sum_Q.forEach((s, idx) => {
        cur.sum_Q[idx] += Number.isFinite(Q[idx]) ? Q[idx] : 0;
      });
      cur.min_align_score = Math.min(cur.min_align_score,
        Number.isFinite(rf.align_score) ? rf.align_score : Infinity);
      cur.rf_statuses.push(status);
    } else {
      flushCurrent();
      cur = {
        fish_id: o.fish_id != null ? o.fish_id : null,
        chrom:   rf.chrom != null ? rf.chrom : null,
        start_bp: rf.start_bp,
        end_bp:   rf.end_bp,
        length_bp: 0,
        n_RF_windows: 1,
        dominant_K: k,
        sum_Q: Array.from(Q, v => Number.isFinite(v) ? v : 0),
        rf_indices: [i],
        min_align_score: Number.isFinite(rf.align_score) ? rf.align_score : Infinity,
        rf_statuses: [status],
        regime_id: curRegime,
      };
    }
  }
  flushCurrent();

  // Finalise mean_local_Q + alignment_confidence on each brick.
  for (const b of bricks) {
    const n = b.n_RF_windows;
    b.mean_local_Q = b.sum_Q.map(s => n > 0 ? s / n : NaN);
    delete b.sum_Q;
    b.alignment_confidence = Number.isFinite(b.min_align_score)
      ? b.min_align_score : NaN;
    delete b.min_align_score;
    b.brick_id = [b.fish_id, b.chrom, b.start_bp, b.end_bp].join('__');
  }
  return bricks;
}

// =====================================================================
// 3. Per-brick metric attachment (delta_Q, entropy, het, flags)
// =====================================================================

/**
 * Attach cohort-context metrics + status flags to a list of bricks.
 *
 * `args.fish_global_Q` is the fish's whole-genome Q vector
 * (K-length). Used to compute mean_delta_Q per brick.
 *
 * Optional opts.cohort_context callbacks (each is a function or null):
 *   - hetForBrick(brick) → fish's observed HET fraction in brick
 *   - hetCohortMedianForBrick(brick) → cohort median HET at the
 *     brick's RFs (averaged across the brick)
 *   - hetCohortSdForBrick(brick) → cohort SD of HET across the
 *     brick's RFs
 *   - rohOverlapForBrick(brick) → fraction of brick overlapping ROH
 *   - cohortMajorityKForBrick(brick) → most common dominant_K in
 *     the cohort at brick's RFs
 *   - rarityScoreForBrick(brick) → fraction of cohort with
 *     dominant_K != this brick's K
 *   - regimeStateFishForBrick(brick) → fish-specific regime label
 *     (from Stage 4 + per-fish band membership)
 *   - cohortConsensusRegimeForBrick(brick) → cohort's consensus
 *     regime at the brick's position
 *   - dosageStateForBrick(brick) → HOM_REF / HET / HOM_INV /
 *     AMBIGUOUS for this fish at this brick
 *   - expectedKForDosageState(dosage_state, brick) → cohort's
 *     expected dominant K given the fish's dosage state at this brick
 *   - inversionBlockRangeForBrick(brick) → {start_bp, end_bp} or null
 *
 * @param {Array<Object>} bricks
 * @param {{fish_global_Q:number[], cohort_context?:Object}} args
 * @param {Object} [opts]
 * @returns {Array<Object>} same bricks with metrics + status_flags
 *                          fields populated.
 */
export function attachBrickMetrics(bricks, args, opts) {
  const a = args || {};
  const o = opts || {};
  const cc = a.cohort_context || {};
  const globalQ = Array.isArray(a.fish_global_Q) ? a.fish_global_Q : null;

  const cfg = {
    rarity_common_below:  numOr(o.rarity_common_below,  ANCESTRY_BRICK_DEFAULTS.rarity_common_below),
    rarity_rare_above:    numOr(o.rarity_rare_above,    ANCESTRY_BRICK_DEFAULTS.rarity_rare_above),
    high_het_z_above:     numOr(o.high_het_z_above,     ANCESTRY_BRICK_DEFAULTS.high_het_z_above),
    low_het_z_below:      numOr(o.low_het_z_below,      ANCESTRY_BRICK_DEFAULTS.low_het_z_below),
    roh_overlap_above:    numOr(o.roh_overlap_above,    ANCESTRY_BRICK_DEFAULTS.roh_overlap_above),
    roh_het_z_below:      numOr(o.roh_het_z_below,      ANCESTRY_BRICK_DEFAULTS.roh_het_z_below),
    high_delta_q_above:   numOr(o.high_delta_q_above,   ANCESTRY_BRICK_DEFAULTS.high_delta_q_above),
    low_confidence_below: numOr(o.low_confidence_below, ANCESTRY_BRICK_DEFAULTS.low_confidence_below),
    min_brick_length:     numOr(o.min_brick_length,     ANCESTRY_BRICK_DEFAULTS.min_brick_length),
    min_brick_bp:         numOr(o.min_brick_bp,         ANCESTRY_BRICK_DEFAULTS.min_brick_bp),
    boundary_window_rfs:  numOr(o.boundary_window_rfs,  ANCESTRY_BRICK_DEFAULTS.boundary_window_rfs),
    dosage_delta_q_above: numOr(o.dosage_delta_q_above, ANCESTRY_BRICK_DEFAULTS.dosage_delta_q_above),
  };

  for (const b of bricks) {
    // mean_delta_Q vs the fish's global Q
    if (globalQ && Array.isArray(b.mean_local_Q)
        && globalQ.length === b.mean_local_Q.length) {
      let sumAbs = 0, n = 0;
      for (let k = 0; k < globalQ.length; k++) {
        const l = b.mean_local_Q[k], g = globalQ[k];
        if (Number.isFinite(l) && Number.isFinite(g)) {
          sumAbs += Math.abs(l - g); n++;
        }
      }
      b.mean_delta_Q = n > 0 ? sumAbs / n : NaN;
      b.global_Q = globalQ.slice();
    } else {
      b.mean_delta_Q = NaN;
      b.global_Q = null;
    }
    // mean_entropy
    b.mean_entropy = shannonEntropyOfQ(b.mean_local_Q);

    // Heterozygosity (per-fish + per-cohort baseline → z)
    b.heterozygosity = cc.hetForBrick
      ? safeCall(cc.hetForBrick, b) : NaN;
    const med = cc.hetCohortMedianForBrick
      ? safeCall(cc.hetCohortMedianForBrick, b) : NaN;
    const sd  = cc.hetCohortSdForBrick
      ? safeCall(cc.hetCohortSdForBrick, b) : NaN;
    if (Number.isFinite(b.heterozygosity)
        && Number.isFinite(med) && Number.isFinite(sd) && sd > 0) {
      b.heterozygosity_z = (b.heterozygosity - med) / sd;
    } else {
      b.heterozygosity_z = NaN;
    }
    b.ROH_overlap_fraction = cc.rohOverlapForBrick
      ? safeCall(cc.rohOverlapForBrick, b) : NaN;

    // Cohort comparison
    b.cohort_majority_K = cc.cohortMajorityKForBrick
      ? safeCall(cc.cohortMajorityKForBrick, b) : null;
    b.rarity_score = cc.rarityScoreForBrick
      ? safeCall(cc.rarityScoreForBrick, b) : NaN;

    // Regime / dosage state
    b.regime_state_fish = cc.regimeStateFishForBrick
      ? safeCall(cc.regimeStateFishForBrick, b) : null;
    const cohortRegime = cc.cohortConsensusRegimeForBrick
      ? safeCall(cc.cohortConsensusRegimeForBrick, b) : null;
    b.dosage_state = cc.dosageStateForBrick
      ? safeCall(cc.dosageStateForBrick, b) : null;
    const expectedK = (cc.expectedKForDosageState && b.dosage_state != null)
      ? safeCall(cc.expectedKForDosageState, b.dosage_state, b) : null;

    // Inversion overlap
    const invRange = cc.inversionBlockRangeForBrick
      ? safeCall(cc.inversionBlockRangeForBrick, b) : null;
    if (invRange && Number.isFinite(invRange.start_bp)
        && Number.isFinite(invRange.end_bp)) {
      const overlap_start = Math.max(invRange.start_bp, b.start_bp);
      const overlap_end   = Math.min(invRange.end_bp,   b.end_bp);
      const overlap_len   = Math.max(0, overlap_end - overlap_start);
      b.overlap_with_inversion = b.length_bp > 0
        ? overlap_len / b.length_bp : 0;
      // boundary brick: within ±1 RF of the inversion edge
      b.is_boundary_brick =
        Math.abs(b.start_bp - invRange.start_bp) <= cfg.boundary_window_rfs * (b.length_bp / Math.max(1, b.n_RF_windows))
        || Math.abs(b.end_bp - invRange.end_bp)   <= cfg.boundary_window_rfs * (b.length_bp / Math.max(1, b.n_RF_windows));
    } else {
      b.overlap_with_inversion = 0;
      b.is_boundary_brick = false;
    }

    // Status flags
    const flags = [];
    if (Number.isFinite(b.rarity_score)) {
      if (b.rarity_score < cfg.rarity_common_below) flags.push(ANCESTRY_BRICK_FLAGS.COMMON);
      if (b.rarity_score >= cfg.rarity_rare_above)  flags.push(ANCESTRY_BRICK_FLAGS.RARE_ANCESTRY);
    }
    if (Number.isFinite(b.heterozygosity_z)) {
      if (b.heterozygosity_z >= cfg.high_het_z_above)  flags.push(ANCESTRY_BRICK_FLAGS.HIGH_HET);
      if (b.heterozygosity_z <= cfg.low_het_z_below)   flags.push(ANCESTRY_BRICK_FLAGS.LOW_HET);
    }
    if (Number.isFinite(b.ROH_overlap_fraction) && Number.isFinite(b.heterozygosity_z)
        && b.ROH_overlap_fraction >= cfg.roh_overlap_above
        && b.heterozygosity_z <= cfg.roh_het_z_below) {
      flags.push(ANCESTRY_BRICK_FLAGS.ROH_LIKE);
    }
    if (Number.isFinite(b.mean_delta_Q) && b.mean_delta_Q >= cfg.high_delta_q_above) {
      flags.push(ANCESTRY_BRICK_FLAGS.HIGH_DELTA_Q);
    }
    if (Number.isFinite(b.alignment_confidence)
        && b.alignment_confidence < cfg.low_confidence_below) {
      flags.push(ANCESTRY_BRICK_FLAGS.LOW_CONFIDENCE);
    }
    if (cohortRegime != null && b.regime_state_fish != null
        && cohortRegime !== b.regime_state_fish) {
      flags.push(ANCESTRY_BRICK_FLAGS.REGIME_DISCORDANT);
    }
    if (expectedK != null && Number.isFinite(b.mean_delta_Q)
        && expectedK !== b.dominant_K
        && b.mean_delta_Q >= cfg.dosage_delta_q_above) {
      flags.push(ANCESTRY_BRICK_FLAGS.DOSAGE_DISCORDANT);
    }
    if (b.is_boundary_brick) flags.push(ANCESTRY_BRICK_FLAGS.BOUNDARY_BRICK);
    if (b.n_RF_windows < cfg.min_brick_length
        || b.length_bp   < cfg.min_brick_bp) {
      flags.push(ANCESTRY_BRICK_FLAGS.FRAGMENT);
    }
    b.status_flags = flags;
  }

  // RECOMBINANT_LIKE — needs a second pass with full brick context.
  // A brick is recombinant-like iff it starts AND ends inside the
  // inversion AND is sandwiched between two bricks of a different K.
  for (let i = 0; i < bricks.length; i++) {
    const b = bricks[i];
    if (b.overlap_with_inversion < 0.99) continue;   // must be fully inside
    const prev = i > 0 ? bricks[i - 1] : null;
    const next = i + 1 < bricks.length ? bricks[i + 1] : null;
    if (!prev || !next) continue;
    if (prev.dominant_K !== next.dominant_K) continue;
    if (prev.dominant_K === b.dominant_K) continue;
    b.status_flags.push(ANCESTRY_BRICK_FLAGS.RECOMBINANT_LIKE);
  }

  return bricks;
}

// =====================================================================
// 4. Convenience: build + attach in one shot
// =====================================================================

/**
 * One-call builder: construct bricks for one fish from aligned-Q
 * rows AND attach cohort-context metrics in a single pass.
 *
 * @param {Array<Object>} aligned_Q_rows
 * @param {Object} args   {fish_id, fish_global_Q, cohort_context}
 * @param {Object} [opts]
 * @returns {Array<Object>}
 */
export function buildAndAnnotateBricks(aligned_Q_rows, args, opts) {
  const a = args || {};
  const bricks = buildBricksForFish(aligned_Q_rows,
    Object.assign({ fish_id: a.fish_id }, opts || {}));
  return attachBrickMetrics(bricks, a, opts);
}

// =====================================================================
// Internal helpers
// =====================================================================

function numOr(v, fallback) {
  return Number.isFinite(v) ? v : fallback;
}

function safeCall(fn, ...args) {
  try { return fn(...args); }
  catch (_) { return null; }
}
