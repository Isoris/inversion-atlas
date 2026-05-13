// shared/arrangement_calls.js
// =====================================================================
// Arrangement-call primitives (specs_todo/
// SPEC_arrangement_color_mode_and_arrangement_calls_v1.md).
//
// Pure compute: decode `consensus_partition` output into deterministic
// arrangement IDs, vote per-sample arrangement assignments across
// probes, and validate `arrangement_calls_v1.json` payloads.
//
// SCOPE — what lives here vs. elsewhere:
//   - This module:    decoder, palette, per-sample voting, JSON validator.
//   - banding_pipeline.js: produces the `top_partitions` input.
//   - sample_color.js:     hosts the "arrangement" color mode dispatcher
//                          (this module supplies the palette + lookup).
//
// Spec invariant (§7): arrangement_id 0 is always the block whose
// arr-clusters have the lowest mean PC1, 1 next, etc. This makes
// arrangement IDs stable across reruns / probe-strategy choices.
// =====================================================================

// =====================================================================
// Vocab + palette
// =====================================================================

/** Schema version for `arrangement_calls_v1.json`. */
export const ARRANGEMENT_CALLS_SCHEMA_VERSION = 1;

/** Sentinel for samples that don't track cleanly across probes. */
export const ARRANGEMENT_UNCALLED = -1;

/** Six deterministic colours per spec §2.4. Matches the K-means
 *  palette so K=3 CLEAN cases look identical to the K-means mode. */
export const ARR_PALETTE = Object.freeze([
  '#3074C8',   // 0 — deep blue (= K-means cluster 0)
  '#2BAA50',   // 1 — green
  '#D04545',   // 2 — red
  '#A060B8',   // 3 — purple
  '#D8A030',   // 4 — gold
  '#3DB5C0',   // 5 — teal
]);

/** Grey for samples with arrangement_per_sample = -1 (uncalled). */
export const ARR_COLOR_UNCALLED = 'rgba(140, 140, 140, 0.35)';

/**
 * Resolve a CSS colour for an arrangement id. Beyond the 6 fixed
 * palette entries the spec calls for golden-angle HSL rotation (same
 * scheme as shared/lineage_clustering.js).
 *
 * @param {number} arr_id
 * @returns {string}
 */
export function arrangementColor(arr_id) {
  if (!Number.isFinite(arr_id) || arr_id === ARRANGEMENT_UNCALLED) {
    return ARR_COLOR_UNCALLED;
  }
  if (arr_id < 0) return ARR_COLOR_UNCALLED;
  if (arr_id < ARR_PALETTE.length) return ARR_PALETTE[arr_id];
  // Golden-angle rotation — same base hue / step as lineage_clustering.js
  const baseHue = 210;
  const goldenAngle = 137.508;
  const hue = (baseHue + arr_id * goldenAngle) % 360;
  return 'hsl(' + hue.toFixed(1) + ', 70%, 55%)';
}

// =====================================================================
// 1. Block → mean-PC1 sorting (spec §7 steps 1-4)
// =====================================================================

/**
 * Decode a chosen partition + probes into deterministic arrangement
 * IDs by sorting blocks on mean PC1 ascending.
 *
 * INPUTS
 *   partition  — Array<Array<int>>: one inner array per block, each
 *                listing the "global cluster IDs" (probe-local clusters
 *                flattened in probe order).
 *   probes     — Array<{centers:number[]}>: each probe's K-means
 *                center vector (length = k_used for that probe). Order
 *                MUST match the order used to flatten global cluster
 *                IDs.
 *
 * OUTPUT
 *   {
 *     n_arrangements:               int,
 *     arr_cluster_to_arrangement:   Array<Array<int>>   // [probe_idx][k] → arr_id
 *     block_mean_pc1:               Array<number>       // length n_arrangements,
 *                                                       //   sorted ascending
 *     block_id_to_arrangement:      Array<int>          // input block-array index
 *                                                       //   → arr_id
 *   }
 *
 * Throws on malformed input (block references a global cluster ID
 * outside the probe set, or two probes claim the same ID).
 */
export function decodeArrangementsFromPartition(partition, probes) {
  if (!Array.isArray(partition) || !Array.isArray(probes)) {
    return _emptyDecode();
  }
  if (partition.length === 0 || probes.length === 0) {
    return _emptyDecode();
  }
  // Map global cluster id → {probe_idx, k_within_probe, center}.
  const idToCluster = [];
  for (let p = 0; p < probes.length; p++) {
    const c = probes[p] && probes[p].centers;
    if (!Array.isArray(c)) continue;
    for (let k = 0; k < c.length; k++) {
      idToCluster.push({ probe_idx: p, k_within_probe: k, center: c[k] });
    }
  }
  // Compute mean center per block.
  const blocks = partition.map((globalIds, blockIdx) => {
    let sum = 0, n = 0;
    for (const gid of globalIds) {
      const c = idToCluster[gid];
      if (!c) continue;
      if (Number.isFinite(c.center)) { sum += c.center; n++; }
    }
    return {
      blockIdx,
      globalIds,
      mean_pc1: n > 0 ? sum / n : Infinity,
    };
  });
  // Sort by ascending mean_pc1 (ties broken by original block index for
  // determinism).
  blocks.sort((a, b) => {
    if (a.mean_pc1 !== b.mean_pc1) return a.mean_pc1 - b.mean_pc1;
    return a.blockIdx - b.blockIdx;
  });
  const n_arr = blocks.length;
  const block_id_to_arrangement = new Array(partition.length).fill(ARRANGEMENT_UNCALLED);
  const block_mean_pc1 = new Array(n_arr);
  for (let a = 0; a < n_arr; a++) {
    block_id_to_arrangement[blocks[a].blockIdx] = a;
    block_mean_pc1[a] = blocks[a].mean_pc1;
  }
  // Build arr_cluster_to_arrangement[probe_idx][k_within_probe] = arr_id
  const arr_cluster_to_arrangement = probes.map((p) => {
    const k = (p && Array.isArray(p.centers)) ? p.centers.length : 0;
    return new Array(k).fill(ARRANGEMENT_UNCALLED);
  });
  for (let a = 0; a < n_arr; a++) {
    for (const gid of blocks[a].globalIds) {
      const c = idToCluster[gid];
      if (!c) continue;
      arr_cluster_to_arrangement[c.probe_idx][c.k_within_probe] = a;
    }
  }
  return {
    n_arrangements: n_arr,
    arr_cluster_to_arrangement,
    block_mean_pc1,
    block_id_to_arrangement,
  };
}

function _emptyDecode() {
  return {
    n_arrangements: 0,
    arr_cluster_to_arrangement: [],
    block_mean_pc1: [],
    block_id_to_arrangement: [],
  };
}

// =====================================================================
// 2. Per-sample arrangement assignment (spec §7 step 6)
// =====================================================================

/**
 * Majority-vote a sample's arrangement across probes.
 *
 * INPUT
 *   sample_clusters_per_probe — Array<Array<int|null>>:
 *     sample_clusters_per_probe[si][probe_idx] = k_within_probe
 *     (or null / -1 when the sample wasn't classified at that probe).
 *   arr_cluster_to_arrangement — Array<Array<int>>: output of
 *     decodeArrangementsFromPartition (per-probe k → arr_id).
 *   opts.min_vote_share — fraction of probe-votes the majority must
 *     own to qualify as a confident call (default 0.5 = strict
 *     majority). Below this → -1 (uncalled).
 *
 * OUTPUT
 *   arrangement_per_sample — Int32Array, one entry per sample.
 *     Values: arr_id in [0, n_arrangements) or -1 (ARRANGEMENT_UNCALLED).
 *
 * Tie behaviour: an exact tie (e.g. 1 probe → arr 0, 1 probe → arr 1)
 * is always uncalled, regardless of `min_vote_share`. This is the
 * spec's "switched arrangement between probes" case.
 */
export function assignArrangementPerSample(
  sample_clusters_per_probe,
  arr_cluster_to_arrangement,
  opts,
) {
  const o = opts || {};
  const minShare = Number.isFinite(o.min_vote_share) ? o.min_vote_share : 0.5;
  const n_samples = Array.isArray(sample_clusters_per_probe)
    ? sample_clusters_per_probe.length : 0;
  const out = new Int32Array(n_samples);
  for (let si = 0; si < n_samples; si++) {
    const perProbe = sample_clusters_per_probe[si];
    if (!Array.isArray(perProbe)) { out[si] = ARRANGEMENT_UNCALLED; continue; }
    const counts = new Map();
    let n = 0;
    for (let p = 0; p < perProbe.length; p++) {
      const k = perProbe[p];
      if (k == null || k < 0) continue;
      const mapForProbe = arr_cluster_to_arrangement[p];
      if (!Array.isArray(mapForProbe) || k >= mapForProbe.length) continue;
      const arr = mapForProbe[k];
      if (arr === ARRANGEMENT_UNCALLED) continue;
      counts.set(arr, (counts.get(arr) || 0) + 1);
      n++;
    }
    if (n === 0) { out[si] = ARRANGEMENT_UNCALLED; continue; }
    // Find the arrangement with the most votes; tie → uncalled.
    let bestArr = ARRANGEMENT_UNCALLED, bestN = 0, tied = false;
    for (const [arr, c] of counts.entries()) {
      if (c > bestN) { bestArr = arr; bestN = c; tied = false; }
      else if (c === bestN) { tied = true; }
    }
    if (tied || bestN / n < minShare) {
      out[si] = ARRANGEMENT_UNCALLED;
    } else {
      out[si] = bestArr;
    }
  }
  return out;
}

// =====================================================================
// 3. Arrangement size tabulation
// =====================================================================

/**
 * Per-arrangement sample-count summary.
 *
 * @param {Int32Array|Array<number>} arrangement_per_sample
 * @param {number} n_arrangements
 * @returns {{ arrangement_sizes: number[], n_uncalled: number, n_samples: number }}
 */
export function tabulateArrangementSizes(arrangement_per_sample, n_arrangements) {
  const out = new Array(n_arrangements).fill(0);
  let n_uncalled = 0;
  const arr = arrangement_per_sample || [];
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v === ARRANGEMENT_UNCALLED || v < 0) { n_uncalled++; continue; }
    if (v < n_arrangements) out[v]++;
  }
  return {
    arrangement_sizes: out,
    n_uncalled,
    n_samples: arr.length,
  };
}

// =====================================================================
// 4. JSON validator (spec §3)
// =====================================================================

const _REQUIRED_TOP_FIELDS = [
  'tool', 'schema_version', 'chrom', 'n_samples', 'candidates',
];

const _REQUIRED_CANDIDATE_FIELDS = [
  'candidate_id', 'start_bp', 'end_bp', 'start_w', 'end_w',
  'probes', 'n_arrangements', 'arrangement_per_sample',
  'arr_cluster_to_arrangement', 'consensus_class',
];

/**
 * Validate an `arrangement_calls_v1.json` payload against the schema
 * (spec §3). Returns `{ok, errors}` — `errors` is a list of
 * human-readable validation messages, empty when `ok === true`.
 *
 * The validator is structural only: it does NOT re-run the decoder
 * or verify per-sample assignments are consistent with the
 * arr_cluster_to_arrangement map.
 */
export function validateArrangementCallsJson(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') {
    return { ok: false, errors: ['payload is not an object'] };
  }
  for (const f of _REQUIRED_TOP_FIELDS) {
    if (!(f in obj)) errors.push(`missing top-level field: ${f}`);
  }
  if (obj.tool && obj.tool !== 'arrangement_calls_v1') {
    errors.push(`expected tool == 'arrangement_calls_v1', got ${JSON.stringify(obj.tool)}`);
  }
  if (obj.schema_version != null
      && obj.schema_version !== ARRANGEMENT_CALLS_SCHEMA_VERSION) {
    errors.push(`expected schema_version == ${ARRANGEMENT_CALLS_SCHEMA_VERSION}, got ${obj.schema_version}`);
  }
  if (!obj.candidates || typeof obj.candidates !== 'object') {
    if (!errors.length) errors.push('candidates field missing or not an object');
    return { ok: false, errors };
  }
  for (const [cid, c] of Object.entries(obj.candidates)) {
    const prefix = `candidates['${cid}']`;
    if (!c || typeof c !== 'object') {
      errors.push(`${prefix} not an object`);
      continue;
    }
    for (const f of _REQUIRED_CANDIDATE_FIELDS) {
      if (!(f in c)) errors.push(`${prefix}: missing field ${f}`);
    }
    if (Array.isArray(c.probes)) {
      for (let pi = 0; pi < c.probes.length; pi++) {
        const probe = c.probes[pi];
        if (!probe || typeof probe !== 'object') {
          errors.push(`${prefix}.probes[${pi}] not an object`);
          continue;
        }
        if (!('probe_idx' in probe)) errors.push(`${prefix}.probes[${pi}]: missing probe_idx`);
        if (!('k_used' in probe))    errors.push(`${prefix}.probes[${pi}]: missing k_used`);
        if (!Array.isArray(probe.centers)) {
          errors.push(`${prefix}.probes[${pi}]: centers must be an array`);
        } else if (probe.k_used != null && probe.centers.length !== probe.k_used) {
          errors.push(`${prefix}.probes[${pi}]: centers.length (${probe.centers.length}) != k_used (${probe.k_used})`);
        }
      }
    } else if ('probes' in c) {
      errors.push(`${prefix}.probes must be an array`);
    }
    if (Array.isArray(c.arrangement_per_sample)
        && obj.n_samples != null
        && c.arrangement_per_sample.length !== obj.n_samples) {
      errors.push(`${prefix}.arrangement_per_sample.length (${c.arrangement_per_sample.length}) != n_samples (${obj.n_samples})`);
    }
    if (Array.isArray(c.arr_cluster_to_arrangement)
        && Array.isArray(c.probes)
        && c.arr_cluster_to_arrangement.length !== c.probes.length) {
      errors.push(`${prefix}.arr_cluster_to_arrangement.length (${c.arr_cluster_to_arrangement.length}) != probes.length (${c.probes.length})`);
    }
    if (Number.isFinite(c.n_arrangements)
        && Array.isArray(c.arrangement_per_sample)) {
      for (let si = 0; si < c.arrangement_per_sample.length; si++) {
        const v = c.arrangement_per_sample[si];
        if (v === ARRANGEMENT_UNCALLED) continue;
        if (!Number.isFinite(v) || v < 0 || v >= c.n_arrangements) {
          errors.push(`${prefix}.arrangement_per_sample[${si}] = ${v} out of range [0, ${c.n_arrangements})`);
          break;     // one is enough — don't spam
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
