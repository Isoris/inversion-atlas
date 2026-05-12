// tests/test_shared_k_bands.js

import {
  K6_PURITY_THRESHOLD_DEFAULT,
  K6_PARENT_VERDICTS,
  computeKBands,
  computeK6ParentMap,
} from '../atlases/inversion/shared/k_bands.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('constants');
check('K6_PURITY_THRESHOLD_DEFAULT = 0.80',   K6_PURITY_THRESHOLD_DEFAULT === 0.80);
check('K6_PARENT_VERDICTS frozen + 4',         Object.isFrozen(K6_PARENT_VERDICTS)
                                                && K6_PARENT_VERDICTS.length === 4);

// =====================================================================
// Fixture builder for computeKBands
//
// Cohort: 6 samples partitioned into 3 K-means clusters (2 samples each).
// Across N L2 envelopes, every L2 returns the SAME partition but with
// the cluster ids permuted (to exercise Hungarian alignment). Centers
// are set so PC1 rank = cluster id (ascending).
// =====================================================================
function makeKBandsFixture({ K = 3, n_intervals = 3, perCluster = 2 } = {}) {
  const n_samples = K * perCluster;
  // "True" band for each sample (PC1-rank order: 0 = low PC1 ... K-1 = high)
  const trueBand = new Int8Array(n_samples);
  for (let si = 0; si < n_samples; si++) trueBand[si] = Math.floor(si / perCluster);
  // Per-L2 random permutation: cluster id → physical label
  // L2 0 → identity, L2 1 → reverse (high PC1 = label 0, low PC1 = label K-1),
  // L2 2 → cyclic shift by 1
  const perms = [];
  perms.push((k) => k);              // identity
  perms.push((k) => K - 1 - k);      // reverse
  perms.push((k) => (k + 1) % K);    // cyclic
  while (perms.length < n_intervals) perms.push((k) => k);

  // Per-L2 clusters: labels mapped via the permutation, centers in PC1 order
  // (ascending). So PC1-rank-ordered cluster ids equal `physical_label`.
  // Wait — we want centers[id] = monotone function of PC1, where id is the
  // PHYSICAL label that L2 emitted. The mapping from physical label to rank
  // must equal the inverse permutation. Easiest: assign center[physical] =
  // <rank position> i.e. the rank of that physical label among centers.
  // To make computeKBands's rank-sort recover the true band:
  //    centers[physical_label] should = trueBand of any sample with that label.
  //  → set centers[perm(k)] = k for k in 0..K-1.
  const l2_clusters = perms.map((perm) => {
    const labels = new Int8Array(n_samples);
    for (let si = 0; si < n_samples; si++) labels[si] = perm(trueBand[si]);
    const centers = new Array(K);
    for (let k = 0; k < K; k++) centers[perm(k)] = k;
    return { labels, centers };
  });

  const getCluster = (l2idx, k) => {
    if (k !== K) return null;
    if (l2idx < 0 || l2idx >= l2_clusters.length) return null;
    return l2_clusters[l2idx];
  };
  return { getCluster, n_samples, K, n_intervals, trueBand, l2_clusters };
}

// =====================================================================
group('computeKBands — happy path K=3, 3 L2s');
{
  const f = makeKBandsFixture();
  const r = computeKBands({
    getCluster: f.getCluster,
    l2_indices: [0, 1, 2],
    n_samples:  f.n_samples,
    K:          f.K,
  });
  check('ok = true',                            r.ok === true);
  check('K = 3',                                r.K === 3);
  check('n_intervals = 3',                      r.n_intervals === 3);
  check('n_samples = 6',                        r.n_samples === 6);
  // anchor is middle (l2_indices[1] = 1)
  check('anchor = middle (1)',                  r.anchor === 1);
  check('anchorRanks length 6',                 r.anchorRanks.length === 6);
  // anchorRanks should == trueBand (PC1-rank ordering recovers true clusters)
  for (let si = 0; si < 6; si++) {
    check(`anchorRanks[${si}] = trueBand[${si}]`,
          r.anchorRanks[si] === f.trueBand[si]);
  }
  // After Hungarian alignment, every votes[si][p] should equal trueBand[si]
  // for the non-failing L2s (all 3 succeed here).
  let allMatch = true;
  for (let si = 0; si < 6; si++) {
    for (let p = 0; p < 3; p++) {
      if (r.votes[si][p] !== f.trueBand[si]) { allMatch = false; break; }
    }
    if (!allMatch) break;
  }
  check('votes round-trip through alignment',   allMatch);
  // per_l2_concord: anchor → 1.0, others → 1.0 (perfect alignment)
  check('per_l2_concord has 3 entries',         r.per_l2_concord.length === 3);
  for (let p = 0; p < 3; p++) {
    check(`L2 ${p} concord ≥ 0.99`,             r.per_l2_concord[p].concord_to_ref >= 0.99);
  }
  // Roles
  check('anchor role = core',                   r.roles.get(1) === 'core');
  check('non-anchor role = support',            r.roles.get(0) === 'support');
}

// =====================================================================
group('computeKBands — explicit ref_l2 override');
{
  const f = makeKBandsFixture();
  const r = computeKBands({
    getCluster: f.getCluster,
    l2_indices: [0, 1, 2],
    n_samples:  f.n_samples,
    K:          f.K,
    ref_l2:     2,
  });
  check('anchor = explicit ref_l2',             r.anchor === 2);
}
{
  // ref_l2 not in l2_indices → falls back to middle
  const f = makeKBandsFixture();
  const r = computeKBands({
    getCluster: f.getCluster,
    l2_indices: [0, 1, 2],
    n_samples:  f.n_samples,
    K:          f.K,
    ref_l2:     99,
  });
  check('ref_l2 not in list → fallback middle', r.anchor === 1);
}

// =====================================================================
group('computeKBands — getCluster returns null mid-stream');
{
  const f = makeKBandsFixture();
  const flakey = (l2idx, k) => (l2idx === 2 ? null : f.getCluster(l2idx, k));
  const r = computeKBands({
    getCluster: flakey,
    l2_indices: [0, 1, 2],
    n_samples:  f.n_samples,
    K:          f.K,
  });
  check('ok = true (partial)',                  r.ok === true);
  // L2 2 votes should be -1 for all samples
  let allNeg = true;
  for (let si = 0; si < 6; si++) if (r.votes[si][2] !== -1) { allNeg = false; break; }
  check('failed L2 votes = -1',                 allNeg);
  check('failed L2 concord = NaN',              Number.isNaN(r.per_l2_concord[2].concord_to_ref));
  // L2s 0 and 1 still succeed
  check('L2 0 concord finite',                  Number.isFinite(r.per_l2_concord[0].concord_to_ref));
}

// =====================================================================
group('computeKBands — input validation');
check('no getCluster → ok=false',
      computeKBands({ l2_indices: [0], n_samples: 2, K: 3 }).ok === false);
check('non-function getCluster → ok=false',
      computeKBands({ getCluster: 'nope', l2_indices: [0], n_samples: 2, K: 3 }).ok === false);
check('empty l2_indices → ok=false',
      computeKBands({ getCluster: () => null, l2_indices: [], n_samples: 2, K: 3 }).ok === false);
check('null l2_indices → ok=false',
      computeKBands({ getCluster: () => null, l2_indices: null, n_samples: 2, K: 3 }).ok === false);
check('n_samples = 0 → ok=false',
      computeKBands({ getCluster: () => null, l2_indices: [0], n_samples: 0, K: 3 }).ok === false);
check('K = null → ok=false',
      computeKBands({ getCluster: () => null, l2_indices: [0], n_samples: 2 }).ok === false);
check('K = 1 → ok=false',
      computeKBands({ getCluster: () => null, l2_indices: [0], n_samples: 2, K: 1 }).ok === false);
{
  // Anchor cluster failure → ok=false with ANCHOR_CLUSTER_FAILED
  const r = computeKBands({
    getCluster: () => null,
    l2_indices: [0], n_samples: 4, K: 3,
  });
  check('all-null getCluster: ANCHOR_CLUSTER_FAILED',
        r.ok === false && r.reason === 'ANCHOR_CLUSTER_FAILED');
}

// =====================================================================
// computeK6ParentMap
// =====================================================================
//
// Build two synthetic passes: K=3 with each sample in a fixed group,
// K=6 nested inside K=3 (samples 0-1 → K3=0/K6=0, 2-3 → K3=0/K6=1,
// 4-5 → K3=1/K6=2, 6-7 → K3=1/K6=3, 8-9 → K3=2/K6=4, 10-11 → K3=2/K6=5).
// 1 L2 interval for simplicity.
function makeNestedPasses() {
  const n_samples = 12, n_intervals = 1;
  const k3Votes = new Array(n_samples);
  const k6Votes = new Array(n_samples);
  const k3OfSample = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2];
  const k6OfSample = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5];
  for (let si = 0; si < n_samples; si++) {
    k3Votes[si] = new Int8Array([k3OfSample[si]]);
    k6Votes[si] = new Int8Array([k6OfSample[si]]);
  }
  return {
    k3Pass: { K: 3, n_samples, n_intervals, votes: k3Votes },
    k6Pass: { K: 6, n_samples, n_intervals, votes: k6Votes },
  };
}

group('computeK6ParentMap — NESTED');
{
  const { k3Pass, k6Pass } = makeNestedPasses();
  const r = computeK6ParentMap(k3Pass, k6Pass);
  check('verdict = NESTED',                     r.verdict === 'NESTED');
  check('K3 = 3, K6 = 6',                       r.K3 === 3 && r.K6 === 6);
  check('parent_of_k6 0,1 → 0',                 r.parent_of_k6[0] === 0 && r.parent_of_k6[1] === 0);
  check('parent_of_k6 2,3 → 1',                 r.parent_of_k6[2] === 1 && r.parent_of_k6[3] === 1);
  check('parent_of_k6 4,5 → 2',                 r.parent_of_k6[4] === 2 && r.parent_of_k6[5] === 2);
  // Purity should all be 1.0
  let allPure = true;
  for (let k = 0; k < 6; k++) if (r.purity[k] !== 1) { allPure = false; break; }
  check('all purity = 1.0',                     allPure);
  check('n_pure = 6',                           r.n_pure === 6);
  check('n_with_data = 6',                      r.n_with_data === 6);
  // subband labels: g0a, g0b, g1a, g1b, g2a, g2b
  check('subband_label(0) = g0a',               r.subband_label(0) === 'g0a');
  check('subband_label(1) = g0b',               r.subband_label(1) === 'g0b');
  check('subband_label(2) = g1a',               r.subband_label(2) === 'g1a');
  check('subband_label(5) = g2b',               r.subband_label(5) === 'g2b');
  check('subband_label out-of-range → null',    r.subband_label(99) === null);
  check('subband_label negative → null',        r.subband_label(-1) === null);
}

group('computeK6ParentMap — CROSS_CUTTING');
{
  // K6 group 0 splits 50/50 between K3 group 0 and K3 group 1
  // K6 group 1 splits 50/50 between K3 group 0 and K3 group 2 etc.
  const n_samples = 6, n_intervals = 1;
  const k3Votes = new Array(n_samples);
  const k6Votes = new Array(n_samples);
  const k3OfSample = [0, 1, 0, 1, 0, 1];  // alternating
  const k6OfSample = [0, 0, 0, 0, 0, 0];  // all in K6 group 0
  for (let si = 0; si < n_samples; si++) {
    k3Votes[si] = new Int8Array([k3OfSample[si]]);
    k6Votes[si] = new Int8Array([k6OfSample[si]]);
  }
  const k3Pass = { K: 2, n_samples, n_intervals, votes: k3Votes };
  const k6Pass = { K: 1, n_samples, n_intervals, votes: k6Votes };
  // K6 group 0 has 50/50 split → purity 0.5 < 0.80 → CROSS_CUTTING
  const r = computeK6ParentMap(k3Pass, k6Pass);
  check('verdict = CROSS_CUTTING (purity 0.5)', r.verdict === 'CROSS_CUTTING');
  check('purity ≈ 0.5',                          Math.abs(r.purity[0] - 0.5) < 1e-6);
  check('n_pure = 0',                            r.n_pure === 0);
}

group('computeK6ParentMap — MIXED');
{
  // 2 K6 groups: one pure (purity 1), one impure (purity 0.5).
  // Use purity_threshold = 0.80.
  const n_samples = 8, n_intervals = 1;
  const k3OfSample = [0, 0, 0, 0, 0, 0, 0, 0];          // all in K3 group 0
  const k6OfSample = [0, 0, 0, 0, 1, 1, 1, 1];          // half each in K6 0, K6 1
  // But: change K3 for the K6=1 samples → make them split
  // K3: [0, 0, 0, 0, 0, 0, 1, 1]  → K6 group 1 has 2 in K3=0, 2 in K3=1 → purity 0.5
  const k3OfSample2 = [0, 0, 0, 0, 0, 0, 1, 1];
  const k3Votes = new Array(n_samples), k6Votes = new Array(n_samples);
  for (let si = 0; si < n_samples; si++) {
    k3Votes[si] = new Int8Array([k3OfSample2[si]]);
    k6Votes[si] = new Int8Array([k6OfSample[si]]);
  }
  const k3Pass = { K: 2, n_samples, n_intervals, votes: k3Votes };
  const k6Pass = { K: 2, n_samples, n_intervals, votes: k6Votes };
  const r = computeK6ParentMap(k3Pass, k6Pass);
  check('verdict = MIXED',                       r.verdict === 'MIXED');
  check('K6 group 0 purity 1',                   r.purity[0] === 1);
  check('K6 group 1 purity 0.5',                 Math.abs(r.purity[1] - 0.5) < 1e-6);
  check('n_pure = 1, n_with_data = 2',           r.n_pure === 1 && r.n_with_data === 2);
}

group('computeK6ParentMap — NO_DATA');
{
  // All votes = -1 (every L2 failed in both passes)
  const n_samples = 4, n_intervals = 1;
  const k3Votes = new Array(n_samples);
  const k6Votes = new Array(n_samples);
  for (let si = 0; si < n_samples; si++) {
    k3Votes[si] = new Int8Array([-1]);
    k6Votes[si] = new Int8Array([-1]);
  }
  const k3Pass = { K: 3, n_samples, n_intervals, votes: k3Votes };
  const k6Pass = { K: 6, n_samples, n_intervals, votes: k6Votes };
  const r = computeK6ParentMap(k3Pass, k6Pass);
  check('verdict = NO_DATA',                     r.verdict === 'NO_DATA');
  check('n_with_data = 0',                       r.n_with_data === 0);
}

group('computeK6ParentMap — custom purity_threshold');
{
  // Same MIXED fixture but with thr = 0.4 → both groups pure → NESTED
  const n_samples = 8, n_intervals = 1;
  const k6OfSample = [0, 0, 0, 0, 1, 1, 1, 1];
  const k3OfSample = [0, 0, 0, 0, 0, 0, 1, 1];
  const k3Votes = new Array(n_samples), k6Votes = new Array(n_samples);
  for (let si = 0; si < n_samples; si++) {
    k3Votes[si] = new Int8Array([k3OfSample[si]]);
    k6Votes[si] = new Int8Array([k6OfSample[si]]);
  }
  const k3Pass = { K: 2, n_samples, n_intervals, votes: k3Votes };
  const k6Pass = { K: 2, n_samples, n_intervals, votes: k6Votes };
  const r = computeK6ParentMap(k3Pass, k6Pass, 0.4);
  check('lower thr → NESTED',                    r.verdict === 'NESTED');
  check('thr stored in result',                  r.purity_threshold === 0.4);
}

group('computeK6ParentMap — null inputs');
{
  const r = computeK6ParentMap(null, null);
  check('null+null → NO_DATA',                  r.verdict === 'NO_DATA');
  check('null+null subband_label returns null', r.subband_label(0) === null);
}
{
  const r = computeK6ParentMap({ K: 3, n_samples: 1, n_intervals: 1 }, null);
  check('one-null → NO_DATA',                   r.verdict === 'NO_DATA');
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
