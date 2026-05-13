// shared/band_tracking/karyotype_model.js
// =====================================================================
// Karyotype-model combiner — folds three independent evidence streams
// into a single per-band macro-group assignment + a candidate-level
// karyotype-model verdict.
//
// The three streams (all already implemented in band_tracking/):
//
//   1. Trajectory evidence  (trajectory.js#band_group_by_trajectory_similarity)
//        → bands grouped by PC1-trajectory similarity (sign-aware).
//   2. Projection evidence  (projection.js#classifyProjection /
//                            #classifyProjectionWithStability)
//        → seed-to-seed PATTERN_CLASS (SINGLE / SPLIT / MERGE / ...).
//   3. Vote evidence       (vote_evidence.js + band_voters.js +
//                            partition_consensus.js)
//        → per-band partition consensus class.
//
// Three exports:
//
//   kt_combine_trajectory_and_projection_evidence(...)
//      Per-band evidence row stitching: for each band, attach its
//      trajectory group + sign + projection pattern class + vote
//      consensus class + agreement flags.
//
//   kt_infer_macro_band_groups(combinedRows, opts?)
//      Aggregate the per-band rows into MACRO band groups using
//      trajectory-group as the primary partition; refine by projection
//      pattern when it disagrees.
//
//   kt_resolve_karyotype_model({macroGroups, ivCallSummary, ...})
//      Final candidate-level verdict:
//        BIALLELIC      — exactly 2 macro groups + IV calls dominated
//                          by STD/STD + INV/INV + HET
//        MULTI_ALLELIC  — ≥ 3 macro groups OR groups with sign-split
//                          subgroups
//        COMPLEX        — high projection-pattern inconsistency or
//                          vote-consensus contradictions
//        AMBIGUOUS      — insufficient evidence
//
// Pure JS — no DOM, no fetch.

/** Final karyotype-model verdicts. */
export const KARYOTYPE_MODEL_VERDICTS = Object.freeze({
  BIALLELIC:     'BIALLELIC',
  MULTI_ALLELIC: 'MULTI_ALLELIC',
  COMPLEX:       'COMPLEX',
  AMBIGUOUS:     'AMBIGUOUS',
});

/** Per-band agreement flags. */
export const KT_AGREEMENT_FLAGS = Object.freeze({
  ALL_AGREE:           'all_agree',
  TRAJ_PROJ_AGREE:     'traj_proj_agree',
  TRAJ_VOTE_AGREE:     'traj_vote_agree',
  PROJ_VOTE_AGREE:     'proj_vote_agree',
  DISAGREE:            'disagree',
  INSUFFICIENT:        'insufficient',
});

/** Defaults for the verdict thresholds. */
export const KT_DEFAULTS = Object.freeze({
  // Minimum fraction of bands that must agree with the trajectory
  // grouping for the verdict to be BIALLELIC / MULTI_ALLELIC.
  min_agreement_frac: 0.66,
  // Maximum allowed sign-split fraction within a single trajectory
  // group before the verdict escalates from BIALLELIC →
  // MULTI_ALLELIC.
  max_sign_split_frac: 0.20,
  // Minimum bands required for any non-AMBIGUOUS verdict.
  min_bands: 3,
});

/**
 * Combine per-band trajectory + projection + vote evidence into a
 * flat array of evidence rows.
 *
 * Inputs:
 *   - bandIds[i]              external identifier for band i (e.g.
 *                             "seed12_k1"). Pure pass-through.
 *   - trajectoryGroupOf[i]    int — trajectory group id from
 *                             band_group_by_trajectory_similarity.
 *   - trajectorySignOf[i]     ±1 — sign relative to group root.
 *   - projectionClassOf[i]    string | null — pattern class from
 *                             classifyProjection (e.g. 'SINGLE',
 *                             'SPLIT', 'MERGE').
 *   - voteConsensusClassOf[i] string | null — partition consensus
 *                             class from partition_consensus.js.
 *
 * Each row carries:
 *   {
 *     band_id, trajectory_group, trajectory_sign,
 *     projection_class, vote_consensus_class,
 *     agreement: KT_AGREEMENT_FLAGS.*,
 *   }
 *
 * Agreement rules (pairwise on three streams):
 *   - traj & proj agree iff both are non-null AND the projection
 *     pattern doesn't suggest band reassignment (SINGLE → no split;
 *     SPLIT / MERGE → ambiguous; the per-band consumer can be
 *     stricter — we just flag at the high level).
 *   - traj & vote agree iff vote consensus class is non-null and not
 *     CONFLICT.
 *   - all_agree only when all three pairwise checks pass.
 *
 * @param {Object} args
 * @returns {Array<Object>}
 */
export function kt_combine_trajectory_and_projection_evidence(args) {
  const a = args || {};
  const bandIds = a.bandIds || [];
  const N = bandIds.length;
  const trGroup = a.trajectoryGroupOf || [];
  const trSign  = a.trajectorySignOf  || [];
  const projCls = a.projectionClassOf || [];
  const voteCls = a.voteConsensusClassOf || [];
  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    const row = {
      band_id: bandIds[i],
      trajectory_group: Number.isFinite(trGroup[i]) ? trGroup[i] : null,
      trajectory_sign:  trSign[i] === -1 ? -1 : 1,
      projection_class: projCls[i] || null,
      vote_consensus_class: voteCls[i] || null,
      agreement: KT_AGREEMENT_FLAGS.INSUFFICIENT,
    };
    const trajOk = row.trajectory_group != null;
    const projOk = !!row.projection_class
                    && row.projection_class !== 'EMPTY'
                    && row.projection_class !== 'NOISE';
    const voteOk = !!row.vote_consensus_class
                    && row.vote_consensus_class !== 'CONFLICT'
                    && row.vote_consensus_class !== 'NO_DATA';
    const tpAgree = trajOk && projOk && row.projection_class !== 'SPLIT'
                                     && row.projection_class !== 'MERGE';
    const tvAgree = trajOk && voteOk;
    const pvAgree = projOk && voteOk;
    if (tpAgree && tvAgree && pvAgree) {
      row.agreement = KT_AGREEMENT_FLAGS.ALL_AGREE;
    } else if (tpAgree) {
      row.agreement = KT_AGREEMENT_FLAGS.TRAJ_PROJ_AGREE;
    } else if (tvAgree) {
      row.agreement = KT_AGREEMENT_FLAGS.TRAJ_VOTE_AGREE;
    } else if (pvAgree) {
      row.agreement = KT_AGREEMENT_FLAGS.PROJ_VOTE_AGREE;
    } else if (trajOk || projOk || voteOk) {
      row.agreement = KT_AGREEMENT_FLAGS.DISAGREE;
    } else {
      row.agreement = KT_AGREEMENT_FLAGS.INSUFFICIENT;
    }
    out[i] = row;
  }
  return out;
}

/**
 * Aggregate per-band evidence rows into MACRO band groups. The macro
 * group id is initially the trajectory group; a sign-split refinement
 * may split a single trajectory group into two macro groups when the
 * sign-split fraction within the group exceeds `opts.max_sign_split_frac`.
 *
 * Returns:
 *   {
 *     macro_group_of: Array<number>      — per band; dense 0..M-1
 *     group_meta:     Array<{
 *       n_bands, n_positive, n_negative,
 *       n_all_agree, n_disagree,
 *       trajectory_group, sign_dominant ∈ {+1, -1}
 *     }>
 *     n_groups:       int
 *   }
 *
 * @param {Array<Object>} combinedRows  output of
 *                                       kt_combine_trajectory_and_projection_evidence
 * @param {{max_sign_split_frac?:number}} [opts]
 * @returns {Object}
 */
export function kt_infer_macro_band_groups(combinedRows, opts) {
  const o = opts || {};
  const maxSplit = Number.isFinite(o.max_sign_split_frac)
    ? o.max_sign_split_frac : KT_DEFAULTS.max_sign_split_frac;
  const N = Array.isArray(combinedRows) ? combinedRows.length : 0;
  const macro_group_of = new Array(N).fill(-1);
  if (N === 0) {
    return { macro_group_of, group_meta: [], n_groups: 0 };
  }
  // Bucket bands by trajectory group.
  const byTraj = new Map();
  for (let i = 0; i < N; i++) {
    const t = combinedRows[i].trajectory_group;
    if (t == null) continue;
    if (!byTraj.has(t)) byTraj.set(t, []);
    byTraj.get(t).push(i);
  }
  let nextGroup = 0;
  const group_meta = [];
  // For each trajectory bucket, check sign-split. When minor-sign
  // fraction >= maxSplit, split into two macro groups (one per sign).
  const sortedKeys = Array.from(byTraj.keys()).sort((a, b) => a - b);
  for (const t of sortedKeys) {
    const idxs = byTraj.get(t);
    let nPos = 0, nNeg = 0;
    for (const i of idxs) {
      if (combinedRows[i].trajectory_sign === -1) nNeg++; else nPos++;
    }
    const total = nPos + nNeg;
    const minorFrac = total > 0 ? Math.min(nPos, nNeg) / total : 0;
    if (minorFrac >= maxSplit && nPos > 0 && nNeg > 0) {
      // Split: positives → one group, negatives → another.
      const gPos = nextGroup++;
      const gNeg = nextGroup++;
      let nAgreePos = 0, nDisagreePos = 0;
      let nAgreeNeg = 0, nDisagreeNeg = 0;
      for (const i of idxs) {
        if (combinedRows[i].trajectory_sign === -1) {
          macro_group_of[i] = gNeg;
          if (combinedRows[i].agreement === KT_AGREEMENT_FLAGS.ALL_AGREE) nAgreeNeg++;
          if (combinedRows[i].agreement === KT_AGREEMENT_FLAGS.DISAGREE)  nDisagreeNeg++;
        } else {
          macro_group_of[i] = gPos;
          if (combinedRows[i].agreement === KT_AGREEMENT_FLAGS.ALL_AGREE) nAgreePos++;
          if (combinedRows[i].agreement === KT_AGREEMENT_FLAGS.DISAGREE)  nDisagreePos++;
        }
      }
      group_meta.push({
        n_bands: nPos, n_positive: nPos, n_negative: 0,
        n_all_agree: nAgreePos, n_disagree: nDisagreePos,
        trajectory_group: t, sign_dominant: 1,
      });
      group_meta.push({
        n_bands: nNeg, n_positive: 0, n_negative: nNeg,
        n_all_agree: nAgreeNeg, n_disagree: nDisagreeNeg,
        trajectory_group: t, sign_dominant: -1,
      });
    } else {
      // Single macro group covering the whole trajectory bucket.
      const g = nextGroup++;
      let nAgree = 0, nDisagree = 0;
      for (const i of idxs) {
        macro_group_of[i] = g;
        if (combinedRows[i].agreement === KT_AGREEMENT_FLAGS.ALL_AGREE) nAgree++;
        if (combinedRows[i].agreement === KT_AGREEMENT_FLAGS.DISAGREE)  nDisagree++;
      }
      group_meta.push({
        n_bands: total, n_positive: nPos, n_negative: nNeg,
        n_all_agree: nAgree, n_disagree: nDisagree,
        trajectory_group: t,
        sign_dominant: nPos >= nNeg ? 1 : -1,
      });
    }
  }
  return { macro_group_of, group_meta, n_groups: nextGroup };
}

/**
 * Final candidate-level karyotype-model verdict.
 *
 * Inputs:
 *   - macroGroups    output of kt_infer_macro_band_groups
 *   - ivCallSummary  output of iv_call_samples_from_skeleton.summary,
 *                    or null when no skeleton is available
 *
 * Decision tree:
 *   1. n_bands < min_bands → AMBIGUOUS.
 *   2. disagree-fraction across bands > 1 - min_agreement_frac
 *      → COMPLEX.
 *   3. n_macro_groups <= 2 AND IV calls have STD/STD + INV/INV + HET
 *      → BIALLELIC.
 *   4. n_macro_groups > 2 → MULTI_ALLELIC.
 *   5. Else → AMBIGUOUS.
 *
 * Returns:
 *   {
 *     verdict: KARYOTYPE_MODEL_VERDICTS.*,
 *     n_bands, n_macro_groups,
 *     n_agree, n_disagree, agreement_frac,
 *     iv_summary,
 *     reasons: Array<string>,
 *   }
 *
 * @param {Object} args
 * @param {Object} args.macroGroups
 * @param {Object|null} [args.ivCallSummary]
 * @param {Array<Object>} args.combinedRows
 * @param {Object} [opts]
 * @returns {Object}
 */
export function kt_resolve_karyotype_model(args, opts) {
  const o = opts || {};
  const minAgree = Number.isFinite(o.min_agreement_frac)
    ? o.min_agreement_frac : KT_DEFAULTS.min_agreement_frac;
  const minBands = Number.isFinite(o.min_bands)
    ? o.min_bands : KT_DEFAULTS.min_bands;
  const a = args || {};
  const rows = Array.isArray(a.combinedRows) ? a.combinedRows : [];
  const macro = a.macroGroups || { n_groups: 0, group_meta: [] };
  const iv    = a.ivCallSummary || null;
  const N = rows.length;
  const reasons = [];
  let nAgree = 0, nDisagree = 0;
  for (const r of rows) {
    if (r.agreement === KT_AGREEMENT_FLAGS.ALL_AGREE) nAgree++;
    if (r.agreement === KT_AGREEMENT_FLAGS.DISAGREE)  nDisagree++;
  }
  const agreementFrac = N > 0 ? nAgree / N : 0;
  if (N < minBands) {
    reasons.push('too_few_bands');
    return {
      verdict: KARYOTYPE_MODEL_VERDICTS.AMBIGUOUS,
      n_bands: N, n_macro_groups: macro.n_groups,
      n_agree: nAgree, n_disagree: nDisagree,
      agreement_frac: agreementFrac,
      iv_summary: iv, reasons,
    };
  }
  const disagreeFrac = N > 0 ? nDisagree / N : 0;
  if (disagreeFrac > 1 - minAgree) {
    reasons.push('high_disagreement');
    return {
      verdict: KARYOTYPE_MODEL_VERDICTS.COMPLEX,
      n_bands: N, n_macro_groups: macro.n_groups,
      n_agree: nAgree, n_disagree: nDisagree,
      agreement_frac: agreementFrac,
      iv_summary: iv, reasons,
    };
  }
  if (macro.n_groups > 2) {
    reasons.push('more_than_2_macro_groups');
    return {
      verdict: KARYOTYPE_MODEL_VERDICTS.MULTI_ALLELIC,
      n_bands: N, n_macro_groups: macro.n_groups,
      n_agree: nAgree, n_disagree: nDisagree,
      agreement_frac: agreementFrac,
      iv_summary: iv, reasons,
    };
  }
  // 1 or 2 macro groups + IV calls populated → BIALLELIC.
  // We require at least two non-empty karyotype-class counts in the
  // IV summary (otherwise the per-sample evidence is too sparse to
  // confirm a biallelic model).
  if (iv) {
    const nonZero = [iv.n_std_std, iv.n_het, iv.n_inv_inv]
      .filter(v => v > 0).length;
    if (nonZero >= 2) {
      reasons.push('iv_classes_present');
      return {
        verdict: KARYOTYPE_MODEL_VERDICTS.BIALLELIC,
        n_bands: N, n_macro_groups: macro.n_groups,
        n_agree: nAgree, n_disagree: nDisagree,
        agreement_frac: agreementFrac,
        iv_summary: iv, reasons,
      };
    }
    reasons.push('iv_classes_too_sparse');
  } else {
    reasons.push('no_iv_summary');
  }
  return {
    verdict: KARYOTYPE_MODEL_VERDICTS.AMBIGUOUS,
    n_bands: N, n_macro_groups: macro.n_groups,
    n_agree: nAgree, n_disagree: nDisagree,
    agreement_frac: agreementFrac,
    iv_summary: iv, reasons,
  };
}
