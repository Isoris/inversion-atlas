// shared/band_tracking/cross_seed_voting.js
// =====================================================================
// STAGE 2 — long-range cross-seed voting.
//
// Given the seed catalogue from Stage 1, every seed votes on every
// other seed by projecting its tracked-anchor labels onto the target
// seed's anchor labels. Each pairwise projection is classified into a
// pattern_class (SUBSET / SUBSET_SPLIT / SPLIT_TWO / FAN / SCATTER /
// SINGLE / EMPTY) using the same taxonomy already used by
// vote_evidence.js / partition_consensus.js.
//
// Output:
//   - N×N pattern_class matrix (seed_i votes on seed_j)
//   - per-seed reliability score (fraction of incoming votes that are
//     informative — SUBSET / SUBSET_SPLIT / SPLIT_TWO / SINGLE)
//   - linkage groups (connected components of mutual-SUBSET edges)
//
// Seeds with low reliability (universally voted FAN) are flagged as
// noise and dropped before downstream Stage 3 processing.
// =====================================================================

import { alignLabels } from '../hungarian.js';
import { PATTERN_CLASS } from './projection.js';

// ---------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------

export const CROSS_SEED_VOTING_DEFAULTS = Object.freeze({
  // Pattern-class thresholds — these are local definitions used to
  // classify the per-row projection of focal anchor samples onto target
  // anchor bands. They mirror the spirit of the existing band_tracking
  // pattern_class taxonomy but are computed directly from a contingency
  // table here (rather than from upstream projection objects).

  // SUBSET_purity: fraction of focal samples that must land in the
  // target's "visited" band-set for the projection to qualify as SUBSET.
  // 0.80 = ≥80% of the focal samples concentrate on a subset of target
  // bands and the rest are minor noise.
  subset_purity:           0.80,
  // SUBSET_max_visited_frac: the visited subset must be smaller than
  // this fraction of the target's K bands. K=3, default 0.67 → at most
  // 2 of 3 target bands visited (otherwise it's SINGLE or FAN).
  subset_max_visited_frac: 0.67,
  // SPLIT_TWO: the focal samples concentrate on exactly two target
  // bands with comparable mass. min_share = mass on the smaller side
  // expressed as a fraction of total focal samples; both sides ≥ this.
  split_two_min_share:     0.30,
  // SCATTER: mass is so spread that the largest target band only holds
  // < scatter_max_frac of the focal samples.
  scatter_max_frac:        0.40,
  // EMPTY/insufficient: minimum number of focal samples present at the
  // target's anchor sample set for the projection to be evaluated.
  min_n_overlap:           20,
  // Reliability threshold: a seed is "validated" if at least this
  // fraction of incoming votes (votes from OTHER seeds) is informative
  // (SUBSET, SUBSET_SPLIT, SPLIT_TWO, or SINGLE).
  min_reliability_frac:    0.30,
  // Minimum number of incoming informative votes required for the
  // reliability score to count. With < this many informative votes,
  // the seed is marked reliability="UNDETERMINED" rather than dropped.
  min_informative_votes:   3,
});

// ---------------------------------------------------------------------
// classifyProjection
//
// Given the K_a × K_b contingency table of focal anchor labels (rows)
// vs target anchor labels (cols), classify the relationship.
//
// Semantics: we want to know "do the K_a focal arrangement classes have
// a CLEAN projection onto the K_b target arrangement classes?" That is:
// does each focal row send its mass to a small target subset, AND does
// each target column receive its mass from a small focal subset?
//
// The right summary statistic is **per-row purity** (how concentrated
// is each focal row on a few target columns) rather than row-collapsed
// column mass. A K=3 vs K=3 perfect bijection has (60,0,0), (0,106,0),
// (0,0,60) — every row is SINGLE on its column. Cohort marginals
// (0.265, 0.469, 0.265) only emerge if you collapse, which throws away
// the structural information.
//
// Algorithm:
//   1. For each row r, compute the cumulative mass of its top-k target
//      columns. Call row r "clean" if it concentrates ≥ subset_purity
//      mass on a target subset smaller than subset_max_visited_frac × K_b.
//   2. The projection is SUBSET if ALL non-empty focal rows are clean.
//   3. SUBSET_SPLIT if MOST (≥ 0.7) but not all rows are clean.
//   4. SPLIT_TWO if K_a==2 (or only 2 non-empty rows) and they each
//      concentrate cleanly.
//   5. SCATTER if max row purity is below scatter_max_frac.
//   6. Otherwise FAN.
//
// Visited / excluded bands are computed as the UNION of clean rows'
// preferred targets — i.e. "the target bands the focal samples actually
// reach."
// ---------------------------------------------------------------------

/**
 * @param {Int32Array|number[]} table   K_a × K_b row-major contingency
 * @param {number} K_a
 * @param {number} K_b
 * @param {object} [opts]
 * @returns {{
 *   pattern_class: string,
 *   row_purities:  Float64Array,       // per-row purity (top-1 fraction)
 *   row_clean:     Uint8Array,         // 1 if row r is "clean", else 0
 *   total:         number,
 *   visited_bands: number[],           // union of clean rows' top targets
 *   excluded_bands: number[],
 * }}
 */
export function classifyProjection(table, K_a, K_b, opts) {
  const o = Object.assign({}, CROSS_SEED_VOTING_DEFAULTS, opts || {});
  // Row sums + total
  const row_sums = new Float64Array(K_a);
  let total = 0;
  for (let r = 0; r < K_a; r++) {
    let s = 0;
    for (let c = 0; c < K_b; c++) s += table[r * K_b + c];
    row_sums[r] = s;
    total += s;
  }
  if (total < o.min_n_overlap) {
    return {
      pattern_class: PATTERN_CLASS.EMPTY,
      row_purities: new Float64Array(K_a), row_clean: new Uint8Array(K_a),
      total, visited_bands: [], excluded_bands: [],
    };
  }
  // Per-row analysis: how concentrated is each row on its top columns?
  const row_purities = new Float64Array(K_a);
  const row_top_col  = new Int32Array(K_a).fill(-1);
  const row_top_visited = new Array(K_a).fill(null);   // per-row visited subset
  const row_clean = new Uint8Array(K_a);
  let n_nonempty_rows = 0;
  let n_clean_rows = 0;
  let max_purity = 0;
  for (let r = 0; r < K_a; r++) {
    if (row_sums[r] === 0) continue;
    n_nonempty_rows++;
    // Sort columns by mass desc within this row
    const cols = Array.from({ length: K_b }, (_, c) => c)
      .sort((a, b) => table[r * K_b + b] - table[r * K_b + a]);
    const top1_frac = table[r * K_b + cols[0]] / row_sums[r];
    row_purities[r] = top1_frac;
    row_top_col[r]  = cols[0];
    if (top1_frac > max_purity) max_purity = top1_frac;
    // Find smallest visited subset that crosses subset_purity for this row
    let cum = 0;
    for (let i = 0; i < K_b; i++) {
      cum += table[r * K_b + cols[i]] / row_sums[r];
      if (cum >= o.subset_purity) {
        const visited_frac_K = (i + 1) / K_b;
        if (visited_frac_K <= o.subset_max_visited_frac) {
          row_top_visited[r] = cols.slice(0, i + 1);
          row_clean[r] = 1;
          n_clean_rows++;
        }
        break;
      }
    }
  }
  // Aggregate row decisions into a projection-level pattern_class.
  if (n_nonempty_rows === 0) {
    return {
      pattern_class: PATTERN_CLASS.EMPTY,
      row_purities, row_clean, total,
      visited_bands: [], excluded_bands: [],
    };
  }
  // Build union of clean rows' visited targets
  const visited_set = new Set();
  for (let r = 0; r < K_a; r++) {
    if (row_clean[r] && row_top_visited[r]) {
      for (const c of row_top_visited[r]) visited_set.add(c);
    }
  }
  const visited_bands = Array.from(visited_set).sort((a, b) => a - b);
  const excluded_bands = [];
  for (let c = 0; c < K_b; c++) if (!visited_set.has(c)) excluded_bands.push(c);

  // SINGLE: only one non-empty row, and it's clean and concentrates on one target
  if (n_nonempty_rows === 1 && n_clean_rows === 1) {
    const r = row_clean.indexOf(1);
    if (row_purities[r] >= o.subset_purity && row_top_visited[r].length === 1) {
      return { pattern_class: PATTERN_CLASS.SINGLE,
               row_purities, row_clean, total, visited_bands, excluded_bands };
    }
  }
  // SUBSET: all non-empty rows clean
  if (n_clean_rows === n_nonempty_rows) {
    // SUBSET if every clean row's visited set is small (size 1 or 2 typical).
    // SUBSET_SPLIT specifically applies when a row's top1_frac is low but
    // top-k cumulative is high — the row "splits" within the visited subset.
    let any_split = false;
    for (let r = 0; r < K_a; r++) {
      if (row_clean[r] && row_purities[r] < 0.6 && row_top_visited[r].length >= 2) {
        any_split = true;
      }
    }
    if (any_split) {
      return { pattern_class: PATTERN_CLASS.SUBSET_SPLIT,
               row_purities, row_clean, total, visited_bands, excluded_bands };
    }
    // K_a==2 with 2 non-empty clean rows is the canonical SPLIT_TWO case
    // ONLY if the visited targets overlap (both rows hit roughly the same
    // 2-band subset). Otherwise it's a clean SUBSET.
    return { pattern_class: PATTERN_CLASS.SUBSET,
             row_purities, row_clean, total, visited_bands, excluded_bands };
  }
  // Some rows clean, some not — partial structure
  const clean_frac = n_clean_rows / n_nonempty_rows;
  if (clean_frac >= 0.7) {
    return { pattern_class: PATTERN_CLASS.SUBSET_SPLIT,
             row_purities, row_clean, total, visited_bands, excluded_bands };
  }
  // SPLIT_TWO: exactly 2 clean rows, even if other rows aren't clean
  if (n_clean_rows === 2 && n_nonempty_rows >= 2 && n_nonempty_rows <= 3) {
    return { pattern_class: PATTERN_CLASS.SPLIT_TWO,
             row_purities, row_clean, total, visited_bands, excluded_bands };
  }
  // SCATTER: every row has low max purity
  if (max_purity < o.scatter_max_frac) {
    return { pattern_class: PATTERN_CLASS.SCATTER,
             row_purities, row_clean, total,
             visited_bands: [], excluded_bands: [] };
  }
  // FAN: moderate row purity but no clean structure
  return { pattern_class: PATTERN_CLASS.FAN,
           row_purities, row_clean, total,
           visited_bands: [], excluded_bands: [] };
}

// ---------------------------------------------------------------------
// projectSeedOntoSeed
//
// For seed F (focal) and seed T (target), build the K_F × K_T
// contingency on the samples present in both seeds' anchor labelings,
// then classify.
// ---------------------------------------------------------------------

/**
 * @param {object} F                    focal seed
 * @param {object} T                    target seed
 * @param {object} [opts]
 * @returns {{ pattern_class:string, table:Int32Array, n_overlap:number,
 *            visited_bands:number[], excluded_bands:number[] }}
 */
export function projectSeedOntoSeed(F, T, opts) {
  const K_F = F.K_a;
  const K_T = T.K_a;
  const table = new Int32Array(K_F * K_T);
  let n_overlap = 0;
  // Iterate over F's anchor samples; find each in T's anchor.
  for (const [si, lbl_F] of F.anchor_labels) {
    const lbl_T = T.anchor_labels.get(si);
    if (lbl_T == null) continue;
    if (lbl_F < 0 || lbl_F >= K_F) continue;
    if (lbl_T < 0 || lbl_T >= K_T) continue;
    table[lbl_F * K_T + lbl_T]++;
    n_overlap++;
  }
  // Hungarian-align the rectangular table for canonical column order.
  // We pad to max(K_F, K_T) only for the alignment step, then read the
  // K_F × K_T region back. This preserves the row interpretation
  // (focal bands stay as rows) while letting alignLabels pick the best
  // diagonal for the V-style interpretation downstream.
  // But for the column-mass-based pattern classifier, alignment doesn't
  // matter — col_mass is permutation-invariant. So we skip alignment
  // and classify directly. (The voted-on visited_bands / excluded_bands
  // are reported in the target's NATIVE band ordering, which is what
  // downstream linkage analysis expects.)
  const cls = classifyProjection(table, K_F, K_T, opts);
  return {
    pattern_class: cls.pattern_class,
    table,
    n_overlap,
    visited_bands: cls.visited_bands,
    excluded_bands: cls.excluded_bands,
    row_purities: cls.row_purities,
    row_clean: cls.row_clean,
  };
}

// ---------------------------------------------------------------------
// buildVoteMatrix
//
// Run all-vs-all projection on the seed catalogue. Output is an N×N
// matrix of pattern_class strings; matrix[i][j] is "seed i's projection
// onto seed j" = how seed i votes on seed j.
//
// Self-votes (i==j) are SINGLE by convention (a seed always votes
// itself as a clean single arrangement).
// ---------------------------------------------------------------------

/**
 * @param {object[]} seeds      output of Stage 1 (seed records)
 * @param {object} [opts]
 * @returns {{
 *   N:                  number,
 *   pattern_class_mat:  string[][],
 *   n_overlap_mat:      Int32Array,    // flat, row-major
 *   visited_bands_mat:  number[][][],  // [i][j][...] target band ids
 * }}
 */
export function buildVoteMatrix(seeds, opts) {
  const N = seeds.length;
  const pattern_class_mat = Array.from({ length: N },
                                       () => new Array(N).fill(PATTERN_CLASS.EMPTY));
  const n_overlap_mat = new Int32Array(N * N);
  const visited_bands_mat = Array.from({ length: N },
                                        () => new Array(N).fill(null));
  for (let i = 0; i < N; i++) {
    pattern_class_mat[i][i] = PATTERN_CLASS.SINGLE;
    n_overlap_mat[i * N + i] = seeds[i].n_tracked;
    visited_bands_mat[i][i] = [];
    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const proj = projectSeedOntoSeed(seeds[i], seeds[j], opts);
      pattern_class_mat[i][j] = proj.pattern_class;
      n_overlap_mat[i * N + j] = proj.n_overlap;
      visited_bands_mat[i][j] = proj.visited_bands.slice();
    }
  }
  return { N, pattern_class_mat, n_overlap_mat, visited_bands_mat };
}

// ---------------------------------------------------------------------
// Reliability + linkage groups
// ---------------------------------------------------------------------

const INFORMATIVE_PATTERNS = new Set([
  PATTERN_CLASS.SINGLE,
  PATTERN_CLASS.SUBSET,
  PATTERN_CLASS.SUBSET_SPLIT,
  PATTERN_CLASS.SPLIT_TWO,
]);

/**
 * Per-seed reliability: fraction of INCOMING votes (column j of
 * pattern_class_mat — how others voted on seed j) that are informative.
 * Seeds whose reliability is below min_reliability_frac AND whose
 * informative-vote count is at least min_informative_votes are flagged
 * as NOISE; below min_informative_votes the verdict is UNDETERMINED.
 *
 * @param {object} matResult     output of buildVoteMatrix
 * @param {object} [opts]
 * @returns {{
 *   reliability_frac:  Float32Array,   // length N
 *   n_informative_in:  Int32Array,
 *   n_total_in:        Int32Array,
 *   verdict:           string[],       // VALID / NOISE / UNDETERMINED
 * }}
 */
export function reliabilityScores(matResult, opts) {
  const o = Object.assign({}, CROSS_SEED_VOTING_DEFAULTS, opts || {});
  const N = matResult.N;
  const M = matResult.pattern_class_mat;
  const reliability_frac = new Float32Array(N);
  const n_informative_in = new Int32Array(N);
  const n_total_in = new Int32Array(N);
  const verdict = new Array(N);
  for (let j = 0; j < N; j++) {
    let n_inf = 0, n_total = 0;
    for (let i = 0; i < N; i++) {
      if (i === j) continue;
      const cls = M[i][j];
      if (cls === PATTERN_CLASS.EMPTY) continue;  // no overlap, can't vote
      n_total++;
      if (INFORMATIVE_PATTERNS.has(cls)) n_inf++;
    }
    n_informative_in[j] = n_inf;
    n_total_in[j] = n_total;
    reliability_frac[j] = n_total > 0 ? n_inf / n_total : 0;
    if (n_inf < o.min_informative_votes) verdict[j] = 'UNDETERMINED';
    else if (reliability_frac[j] >= o.min_reliability_frac) verdict[j] = 'VALID';
    else verdict[j] = 'NOISE';
  }
  return { reliability_frac, n_informative_in, n_total_in, verdict };
}

/**
 * Linkage groups: connected components of "mutual SUBSET-or-stronger"
 * edges. Edge (i, j) exists iff M[i][j] ∈ informative AND M[j][i] ∈
 * informative.
 *
 * @param {object} matResult
 * @returns {{ group_id:Int32Array, n_groups:number }}
 */
export function linkageGroups(matResult) {
  const N = matResult.N;
  const M = matResult.pattern_class_mat;
  // Adjacency: mutual informative
  const adj = Array.from({ length: N }, () => []);
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const ij = INFORMATIVE_PATTERNS.has(M[i][j]);
      const ji = INFORMATIVE_PATTERNS.has(M[j][i]);
      if (ij && ji) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }
  // Union-find via BFS
  const group_id = new Int32Array(N).fill(-1);
  let n_groups = 0;
  for (let s = 0; s < N; s++) {
    if (group_id[s] >= 0) continue;
    const stack = [s];
    while (stack.length > 0) {
      const u = stack.pop();
      if (group_id[u] >= 0) continue;
      group_id[u] = n_groups;
      for (const v of adj[u]) if (group_id[v] < 0) stack.push(v);
    }
    n_groups++;
  }
  return { group_id, n_groups };
}

// ---------------------------------------------------------------------
// runStage2
//
// Convenience driver: takes seed catalogue, returns the full Stage 2
// summary.
// ---------------------------------------------------------------------

/**
 * @param {object[]} seeds
 * @param {object} [opts]
 * @returns {{
 *   matrix:      object,    // buildVoteMatrix output
 *   reliability: object,    // reliabilityScores output
 *   linkage:     object,    // linkageGroups output
 *   valid_seed_ids: number[],
 * }}
 */
export function runStage2(seeds, opts) {
  const matrix = buildVoteMatrix(seeds, opts);
  const reliability = reliabilityScores(matrix, opts);
  const linkage = linkageGroups(matrix);
  const valid_seed_ids = [];
  for (let i = 0; i < seeds.length; i++) {
    if (reliability.verdict[i] !== 'NOISE') valid_seed_ids.push(i);
  }
  return { matrix, reliability, linkage, valid_seed_ids };
}

// Console-debug
if (typeof window !== 'undefined') {
  window._classifyProjection         = classifyProjection;
  window._projectSeedOntoSeed        = projectSeedOntoSeed;
  window._buildVoteMatrix            = buildVoteMatrix;
  window._reliabilityScores          = reliabilityScores;
  window._linkageGroups              = linkageGroups;
  window._runStage2                  = runStage2;
  window._CROSS_SEED_VOTING_DEFAULTS = CROSS_SEED_VOTING_DEFAULTS;
}
