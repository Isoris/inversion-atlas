// shared/mgl_event_tree.js
// =====================================================================
// Relative-ordering inference across multiple inversion candidates on
// the same chromosome. Given a per-sample carrier matrix (n_samples
// × n_candidates) + optional per-candidate divergence/diversity
// metrics, infers an "event tree": which inversion arose inside
// which background, which look independent, which look nested.
//
// Inputs:
//   carriers:        Uint8Array (n_samples × n_candidates)
//                    carriers[s * n_cand + c] = 1 if sample carries
//                    inversion c (homozygous or heterozygous)
//   n_samples / n_candidates
//   per_candidate?:  Array<{
//                     id, label?, pi_inv?, dxy?, fst?, private_inv?,
//                     fixed_differences?, outgroup_present?,
//                   }>
//
// Outputs:
//   pairs: Array<{a, b, relationship, confidence, evidence}>
//     relationship ∈ {
//       'nested',         // B carriers ⊂ A carriers
//       'sister',          // big overlap but not nested
//       'independent',    // little overlap
//       'mutual_exclusive' // never co-occur in same sample
//     }
//
//   per_candidate_age: Array<{id, age_rank, age_class}>
//     where age_rank is 0-based, smaller = likely older
//
// Pure compute. No DOM.
// =====================================================================

export const MGL_EVENT_TREE_DEFAULTS = Object.freeze({
  nested_min_overlap_frac: 0.85,  // B nested in A when ≥ 85% of B's
                                    // carriers also carry A
  sister_min_overlap_frac: 0.30,
  exclusive_max_overlap:   0,
});

// =====================================================================
// 1. Carrier overlap counts
// =====================================================================

/**
 * Pairwise carrier overlap counts.
 *
 * @param {Uint8Array} carriers   n_samples × n_candidates row-major
 * @param {number} n_samples
 * @param {number} n_candidates
 * @returns {{
 *   per_candidate_count:Int32Array,  length n_candidates
 *   pair_overlap:Int32Array,          n_candidates × n_candidates
 * }}
 */
export function carrierOverlap(carriers, n_samples, n_candidates) {
  const cnt = new Int32Array(n_candidates);
  const pair = new Int32Array(n_candidates * n_candidates);
  if (!carriers || carriers.length !== n_samples * n_candidates) {
    return { per_candidate_count: cnt, pair_overlap: pair };
  }
  for (let s = 0; s < n_samples; s++) {
    for (let c = 0; c < n_candidates; c++) {
      if (!carriers[s * n_candidates + c]) continue;
      cnt[c]++;
      for (let d = c + 1; d < n_candidates; d++) {
        if (carriers[s * n_candidates + d]) {
          pair[c * n_candidates + d]++;
          pair[d * n_candidates + c]++;
        }
      }
    }
  }
  return { per_candidate_count: cnt, pair_overlap: pair };
}

// =====================================================================
// 2. Pairwise relationship classifier
// =====================================================================

/**
 * Classify each ordered pair (a, b) where size(b) ≤ size(a):
 *   nested      → most of B's carriers also carry A
 *   sister      → moderate overlap, neither fully nests
 *   independent → small overlap consistent with independence
 *   mutual_exclusive → never co-occur
 *
 * @param {Object} overlap  output of carrierOverlap
 * @param {Object} [opts]   thresholds (defaults above)
 * @returns {Array<{a:number, b:number, relationship:string,
 *                  overlap:number, frac_of_b:number, confidence:number,
 *                  evidence:string}>}
 */
export function classifyPairRelationships(overlap, opts) {
  const o = opts || {};
  const D = MGL_EVENT_TREE_DEFAULTS;
  const nestThr = Number.isFinite(o.nested_min_overlap_frac)
    ? o.nested_min_overlap_frac : D.nested_min_overlap_frac;
  const sisThr = Number.isFinite(o.sister_min_overlap_frac)
    ? o.sister_min_overlap_frac : D.sister_min_overlap_frac;
  const exclMax = Number.isFinite(o.exclusive_max_overlap)
    ? o.exclusive_max_overlap : D.exclusive_max_overlap;
  const cnt = overlap.per_candidate_count;
  const pair = overlap.pair_overlap;
  const n = cnt.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const oij = pair[i * n + j];
      const ci = cnt[i], cj = cnt[j];
      // Re-orient so a is the larger.
      const a = ci >= cj ? i : j;
      const b = ci >= cj ? j : i;
      const oa = pair[a * n + b];
      const ca = cnt[a], cb = cnt[b];
      const frac_of_b = cb > 0 ? oa / cb : 0;
      const frac_of_a = ca > 0 ? oa / ca : 0;
      let relationship, evidence, confidence;
      if (oa <= exclMax) {
        relationship = 'mutual_exclusive';
        evidence = 'no carrier-overlap observed';
        confidence = 0.9;
      } else if (frac_of_b >= nestThr) {
        relationship = 'nested';
        evidence = `${(frac_of_b * 100).toFixed(0)}% of ${b} carriers also carry ${a}`;
        confidence = frac_of_b;
      } else if (frac_of_b >= sisThr) {
        relationship = 'sister';
        evidence = `partial overlap (${(frac_of_b * 100).toFixed(0)}%)`;
        confidence = 0.5;
      } else {
        relationship = 'independent';
        evidence = `low overlap (${(frac_of_b * 100).toFixed(0)}%)`;
        confidence = 1 - frac_of_b;
      }
      out.push({
        a, b, relationship,
        overlap: oa,
        frac_of_b,
        frac_of_a,
        confidence,
        evidence,
      });
    }
  }
  return out;
}

// =====================================================================
// 3. Per-candidate age ranking
// =====================================================================

/**
 * Rank candidates by likely age, smaller rank = older. Heuristic
 * scoring:
 *   + outgroup_present       (+3)
 *   + many private variants  (private_inv > 30, +2)
 *   + high dXY               (dxy > 0.012, +2)
 *   + high pi_inv            (pi_inv > 0.008, +1)
 *
 * Sort descending → smallest rank index is highest score.
 *
 * @param {Array<Object>} per_candidate
 * @returns {Array<{id:*, age_rank:number, age_score:number}>}
 */
export function ageRank(per_candidate) {
  if (!Array.isArray(per_candidate)) return [];
  const scored = per_candidate.map((c, idx) => {
    let s = 0;
    if (c) {
      if (c.outgroup_present) s += 3;
      if (Number.isFinite(c.private_inv) && c.private_inv > 30) s += 2;
      if (Number.isFinite(c.dxy) && c.dxy > 0.012)               s += 2;
      if (Number.isFinite(c.pi_inv) && c.pi_inv > 0.008)         s += 1;
    }
    return { id: c ? c.id : idx, idx, age_score: s };
  });
  // Sort: higher score → older → smaller rank.
  scored.sort((a, b) => b.age_score - a.age_score);
  return scored.map((row, rank) => ({ id: row.id, age_rank: rank, age_score: row.age_score }));
}

// =====================================================================
// 4. End-to-end orchestrator
// =====================================================================

/**
 * Build the full event tree summary.
 *
 * @param {Object} args
 *   carriers, n_samples, n_candidates, per_candidate?, opts?
 * @returns {{
 *   per_candidate_count:Int32Array, pair_overlap:Int32Array,
 *   pairs:Array<Object>, age_rank:Array<Object>,
 * }}
 */
export function buildEventTree(args) {
  const a = args || {};
  if (!a.carriers || !(a.n_samples > 0) || !(a.n_candidates > 0)) {
    return {
      per_candidate_count: new Int32Array(0),
      pair_overlap: new Int32Array(0),
      pairs: [], age_rank: [],
    };
  }
  const overlap = carrierOverlap(a.carriers, a.n_samples, a.n_candidates);
  const pairs = classifyPairRelationships(overlap, a.opts);
  const ages = ageRank(a.per_candidate);
  return Object.assign({}, overlap, { pairs, age_rank: ages });
}
