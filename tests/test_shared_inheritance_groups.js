// tests/test_shared_inheritance_groups.js
//
// Unit tests for shared/inheritance_groups.js — cross-candidate band
// clustering by Jaccard distance over fish-membership masks.

import {
  IGC_DEFAULT_DIST_THRESHOLD,
  IGC_MIN_BANDS_FOR_CLUSTERING,
  buildBandFishMask,
  jaccardDistance,
  inheritanceGroupClustering,
} from '../atlases/popstats/shared/inheritance_groups.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function approx(a, b, tol = 1e-9) {
  return Math.abs(a - b) <= tol;
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('constants');
check('DEFAULT_DIST_THRESHOLD = 0.15',  IGC_DEFAULT_DIST_THRESHOLD === 0.15);
check('MIN_BANDS_FOR_CLUSTERING = 2',   IGC_MIN_BANDS_FOR_CLUSTERING === 2);

// =====================================================================
group('jaccardDistance');
check('mismatched lengths → NaN', Number.isNaN(jaccardDistance(new Uint8Array(3), new Uint8Array(4))));
check('null mask → NaN',           Number.isNaN(jaccardDistance(null, new Uint8Array(3))));
check('both empty → distance = 1',
      jaccardDistance(new Uint8Array(4), new Uint8Array(4)) === 1);
{
  // Identical masks: distance = 0
  const m = new Uint8Array([1, 1, 0, 0]);
  check('identical masks → 0', jaccardDistance(m, m) === 0);
}
{
  // Disjoint masks: distance = 1
  const a = new Uint8Array([1, 1, 0, 0]);
  const b = new Uint8Array([0, 0, 1, 1]);
  check('disjoint masks → 1', jaccardDistance(a, b) === 1);
}
{
  // 50% overlap: |A∩B|=1, |A∪B|=3 → Jaccard sim 1/3 → distance 2/3
  const a = new Uint8Array([1, 1, 0, 0]);
  const b = new Uint8Array([1, 0, 1, 0]);
  check('|A|=|B|=2, |∩|=1 → 2/3', approx(jaccardDistance(a, b), 2 / 3, 1e-6));
}

// =====================================================================
group('buildBandFishMask');
{
  const items = [{ labels: [0, 0, 1, 2, 1] }];   // K=3 implied
  const m0 = buildBandFishMask(items, [3], 0, 0);
  check('band 0: positions 0,1', m0[0] === 1 && m0[1] === 1 && m0[2] === 0 && m0[3] === 0 && m0[4] === 0);
  check('band 0 count = 2',      m0._count === 2);
  const m1 = buildBandFishMask(items, [3], 0, 1);
  check('band 1: positions 2,4', m1[2] === 1 && m1[4] === 1 && m1[0] === 0 && m1[1] === 0 && m1[3] === 0);
  const m2 = buildBandFishMask(items, [3], 0, 2);
  check('band 2: position 3',    m2[3] === 1 && m2._count === 1);
  // Out-of-range band
  check('band 99: null',         buildBandFishMask(items, [3], 0, 99) === null);
  check('band -1: null',         buildBandFishMask(items, [3], 0, -1) === null);
  // Missing item
  check('null item: null',       buildBandFishMask([null], [3], 0, 0) === null);
}

// =====================================================================
group('inheritanceGroupClustering — input validation');
check('null items → null',        inheritanceGroupClustering(null) === null);
check('empty items → null',       inheritanceGroupClustering([]) === null);
check('single item → null',       inheritanceGroupClustering([{ K: 3, labels: [0, 1] }]) === null);

// =====================================================================
group('inheritanceGroupClustering — two candidates, identical labels');
{
  // Two candidates with K=3 and identical fish-band assignments →
  // each candidate's band b maps to the other's band b.
  // Expect 3 inheritance groups; each pairs (0,b) ↔ (1,b).
  const items = [
    { id: 'cand_A', K: 3, labels: [0, 0, 1, 1, 2, 2] },
    { id: 'cand_B', K: 3, labels: [0, 0, 1, 1, 2, 2] },
  ];
  const result = inheritanceGroupClustering(items);
  check('non-null result',                 result !== null);
  check('n_items = 2',                     result.n_items === 2);
  check('n_bands_total = 6',               result.n_bands_total === 6);
  check('ids reflect input',               result.ids[0] === 'cand_A' && result.ids[1] === 'cand_B');
  check('3 inheritance groups',            result.rtab.group_ids.length === 3);
  check('per_item_n_groups = [3, 3]',
        result.rtab.per_item_n_groups[0] === 3
        && result.rtab.per_item_n_groups[1] === 3);
  // Each group should contain band b from cand_A and band b from cand_B
  // (band labels may be permuted; key invariant: each group has 2 entries).
  let allPaired = true;
  for (const g of result.rtab.group_ids) {
    const itemIdxs = Object.keys(result.rtab.per_group[g]);
    if (itemIdxs.length !== 2) allPaired = false;
  }
  check('each group joins both candidates', allPaired);
}

// =====================================================================
group('inheritanceGroupClustering — disjoint candidates');
{
  // cand_A's labels (0,0,1,1,2,2) vs cand_B's (2,2,0,0,1,1) — the
  // band IDs are permuted, but the fish memberships are still pairable.
  // Jaccard groups should pair (A band 0 ~ B band 2), etc.
  const items = [
    { id: 'A', K: 3, labels: [0, 0, 1, 1, 2, 2] },
    { id: 'B', K: 3, labels: [2, 2, 0, 0, 1, 1] },
  ];
  const result = inheritanceGroupClustering(items);
  check('permuted labels: 3 groups',     result.rtab.group_ids.length === 3);
  check('per_item_n_groups = [3, 3]',
        result.rtab.per_item_n_groups[0] === 3
        && result.rtab.per_item_n_groups[1] === 3);
}

// =====================================================================
group('inheritanceGroupClustering — partial overlap');
{
  // cand_A: samples 0-1 in band 0, 2-3 in band 1, 4-5 in band 2
  // cand_B: samples 0-3 in band 0, 4-5 in band 1
  // Jaccard distance A0 vs B0: |∩|=2, |∪|=4 → 0.5 (NOT merged at 0.15)
  // Jaccard A2 vs B1: |∩|=2, |∪|=2 → 0 (perfect merge)
  // → 4 groups expected (A0, A1, A2~B1, B0)
  const items = [
    { id: 'A', K: 3, labels: [0, 0, 1, 1, 2, 2] },
    { id: 'B', K: 2, labels: [0, 0, 0, 0, 1, 1] },
  ];
  const result = inheritanceGroupClustering(items);
  check('partial-overlap: 4 groups (one merged)',
        result.rtab.group_ids.length === 4);
}

// =====================================================================
group('inheritanceGroupClustering — threshold semantics');
{
  // cutDendrogram uses strict `<` against the threshold. With the two
  // pairs perfectly overlapping (A0↔B1 dist 0, A1↔B0 dist 0) but every
  // cross-pair at dist 1, threshold 1.0 still leaves us with 2 groups
  // (the inter-cluster average-linkage distance is exactly 1).
  const items = [
    { id: 'A', K: 2, labels: [0, 0, 1, 1] },
    { id: 'B', K: 2, labels: [1, 1, 0, 0] },
  ];
  const result = inheritanceGroupClustering(items, { threshold: 1.0 });
  check('threshold 1.0: 2 groups (pairs merge at d=0; pairs themselves at d=1, strict <)',
        result.rtab.group_ids.length === 2);
  // threshold above 1 collapses everything into a single group.
  const all = inheritanceGroupClustering(items, { threshold: 1.5 });
  check('threshold 1.5: 1 group containing all 4 bands',
        all.rtab.group_ids.length === 1);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
