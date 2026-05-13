// tests/test_shared_band_tracking_haplotype_regime.js
//
// Unit coverage for shared/band_tracking/haplotype_regime.js — Layer 2
// long-range refinement.

import {
  HAPLOTYPE_REGIME_RELATIONSHIPS,
  HAPLOTYPE_REGIME_DEFAULTS,
  intervalSampleCore,
  relateIntervals,
  buildHaplotypeRegimeGraph,
  clusterHaplotypeRegimes,
  refineRegimesFromIntervals,
} from '../atlases/inversion/shared/band_tracking/haplotype_regime.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab');

check('relationships frozen',
      Object.isFrozen(HAPLOTYPE_REGIME_RELATIONSHIPS));
check('defaults frozen',          Object.isFrozen(HAPLOTYPE_REGIME_DEFAULTS));
check('EXTENSION constant',
      HAPLOTYPE_REGIME_RELATIONSHIPS.EXTENSION === 'extension');
check('SWAPPED constant',
      HAPLOTYPE_REGIME_RELATIONSHIPS.SWAPPED === 'swapped');
check('default extension threshold = 0.70',
      HAPLOTYPE_REGIME_DEFAULTS.extension_min_mean_jaccard === 0.70);

// =====================================================================
group('intervalSampleCore');

const iv1 = intervalSampleCore({
  hom_a_consensus: new Set([0, 1, 2]),
  hom_b_consensus: new Set([3, 4, 5]),
  het_core: new Set([6, 7, 8]),
  start_bp: 1_000_000, end_bp: 2_000_000, id: 'iv1',
});
check('consensus shape parsed',     iv1 !== null && iv1.hom_a.size === 3);
check('het size = 3',               iv1.het.size === 3);
check('id propagated',              iv1.id === 'iv1');

// Alternative shape with arrays
const iv2 = intervalSampleCore({
  hom_a: [0, 1], hom_b: [2, 3], het: [4, 5],
  start_bp: 0, end_bp: 100,
});
check('array shape parsed',         iv2.hom_a instanceof Set && iv2.hom_a.size === 2);

// Null + empty
check('null → null',                intervalSampleCore(null) === null);
check('no sample sets → null',
      intervalSampleCore({ start_bp: 0, end_bp: 100 }) === null);

// =====================================================================
group('relateIntervals — EXTENSION (overlapping bp, same cores)');

const A = {
  hom_a_consensus: new Set([0, 1, 2, 3]),
  hom_b_consensus: new Set([4, 5, 6, 7]),
  het_core: new Set([8, 9, 10]),
  start_bp: 1_000_000, end_bp: 2_000_000, id: 'A',
};
const B = {  // overlapping bp, near-identical sets
  hom_a_consensus: new Set([0, 1, 2, 3]),
  hom_b_consensus: new Set([4, 5, 6, 7]),
  het_core: new Set([8, 9, 10]),
  start_bp: 1_900_000, end_bp: 3_000_000, id: 'B',
};
const rExt = relateIntervals(A, B);
check('EXTENSION relationship',
      rExt.relationship === HAPLOTYPE_REGIME_RELATIONSHIPS.EXTENSION);
check('affinity ≈ 1',               rExt.affinity > 0.95);
check('sign = +1',                  rExt.sign === 1);
check('gap_bp = 0 (overlapping)',   rExt.gap_bp === 0);

// =====================================================================
group('relateIntervals — SWAPPED (orientation flip)');

const C = {  // A.hom_a → B.hom_b; A.hom_b → B.hom_a
  hom_a_consensus: new Set([4, 5, 6, 7]),
  hom_b_consensus: new Set([0, 1, 2, 3]),
  het_core: new Set([8, 9, 10]),
  start_bp: 2_100_000, end_bp: 3_000_000, id: 'C',
};
const rSwap = relateIntervals(A, C);
check('SWAPPED relationship',
      rSwap.relationship === HAPLOTYPE_REGIME_RELATIONSHIPS.SWAPPED);
check('sign = -1',                  rSwap.sign === -1);
check('cross-Jaccards high',
      rSwap.jaccards.cross_a_b > 0.9 && rSwap.jaccards.cross_b_a > 0.9);

// =====================================================================
group('relateIntervals — UNRELATED (high bp gap)');

const D = {
  hom_a_consensus: new Set([0, 1, 2, 3]),
  hom_b_consensus: new Set([4, 5, 6, 7]),
  het_core: new Set([8, 9, 10]),
  start_bp: 10_000_000, end_bp: 11_000_000, id: 'D',  // way past A
};
const rGap = relateIntervals(A, D, { max_gap_bp: 500_000 });
check('huge bp gap → UNRELATED',
      rGap.relationship === HAPLOTYPE_REGIME_RELATIONSHIPS.UNRELATED);
check('gap_bp > 0',                 rGap.gap_bp > 0);

// =====================================================================
group('relateIntervals — SHARED_HET');

const E = {
  hom_a_consensus: new Set([100, 101, 102]),
  hom_b_consensus: new Set([200, 201, 202]),
  het_core: new Set([8, 9, 10]),          // same het as A
  start_bp: 1_500_000, end_bp: 2_500_000, id: 'E',
};
const rShared = relateIntervals(A, E);
check('SHARED_HET relationship',
      rShared.relationship === HAPLOTYPE_REGIME_RELATIONSHIPS.SHARED_HET);
check('het Jaccard = 1',            rShared.jaccards.het === 1);

// =====================================================================
group('relateIntervals — UNRELATED (disjoint cores)');

const F = {
  hom_a_consensus: new Set([100, 101]),
  hom_b_consensus: new Set([200, 201]),
  het_core: new Set([300, 301]),
  start_bp: 1_500_000, end_bp: 2_500_000, id: 'F',
};
const rUn = relateIntervals(A, F);
check('disjoint → UNRELATED',
      rUn.relationship === HAPLOTYPE_REGIME_RELATIONSHIPS.UNRELATED);

// =====================================================================
group('relateIntervals — null inputs');

const rNull = relateIntervals(null, A);
check('null → UNRELATED + affinity 0',
      rNull.relationship === HAPLOTYPE_REGIME_RELATIONSHIPS.UNRELATED
      && rNull.affinity === 0);

// =====================================================================
group('buildHaplotypeRegimeGraph');

const intervals1 = [A, B, C, E, F];   // labels: 0=A, 1=B, 2=C, 3=E, 4=F
const graph1 = buildHaplotypeRegimeGraph(intervals1);
check('n_intervals = 5',            graph1.n_intervals === 5);
check('edges present',              graph1.edges.length > 0);
check('affinity matrix size',       graph1.affinity_matrix.length === 25);
check('matrix diagonal = 1',
      graph1.affinity_matrix[0] === 1 && graph1.affinity_matrix[6] === 1);
check('relationship_matrix symmetric',
      graph1.relationship_matrix[0][1] === graph1.relationship_matrix[1][0]);

// A-B should be EXTENSION; A-C should be SWAPPED; A-E SHARED_HET
const edgeAB = graph1.edges.find(e => (e.i === 0 && e.j === 1));
const edgeAC = graph1.edges.find(e => (e.i === 0 && e.j === 2));
check('A-B edge = EXTENSION',
      edgeAB && edgeAB.relationship === HAPLOTYPE_REGIME_RELATIONSHIPS.EXTENSION);
check('A-C edge = SWAPPED',
      edgeAC && edgeAC.relationship === HAPLOTYPE_REGIME_RELATIONSHIPS.SWAPPED);

// edges sorted by affinity desc
check('edges sorted by affinity desc',
      graph1.edges.length < 2
      || graph1.edges[0].affinity >= graph1.edges[1].affinity);

// =====================================================================
group('buildHaplotypeRegimeGraph — empty input');

const graphEmpty = buildHaplotypeRegimeGraph([]);
check('empty intervals: 0 edges',   graphEmpty.edges.length === 0);
check('empty intervals: n=0',       graphEmpty.n_intervals === 0);

// =====================================================================
group('clusterHaplotypeRegimes');

// A, B, C should collapse into one regime (A-B EXTENSION + A-C SWAPPED).
// E, F are separate.
const clus1 = clusterHaplotypeRegimes(graph1);
check('3+ regimes total',           clus1.n_regimes >= 3);
check('A and B in same regime',
      clus1.regime_of[0] === clus1.regime_of[1]);
check('A and C in same regime (swapped)',
      clus1.regime_of[0] === clus1.regime_of[2]);
check('C has sign = -1 relative to A',
      clus1.regime_sign[2] === -1);
check('A has sign = +1',             clus1.regime_sign[0] === 1);

// E and F should be separate regimes
check('F is its own regime',
      clus1.regime_of[4] !== clus1.regime_of[0]);

// regime_meta length matches n_regimes
check('regime_meta length',         clus1.regime_meta.length === clus1.n_regimes);

// Sign-split flag
const regimeAC = clus1.regime_meta.find(m =>
  m.member_ids.includes(0) && m.member_ids.includes(2));
check('regime A/B/C has sign_split = true',
      regimeAC && regimeAC.sign_split === true);

// =====================================================================
group('clusterHaplotypeRegimes — merge_nested + merge_shared_het opts');

// E shares het with A but not homs. With merge_shared_het=false (default),
// they're separate; with merge_shared_het=true they collapse.
const clusDefault = clusterHaplotypeRegimes(graph1);
const clusMergeShared = clusterHaplotypeRegimes(graph1, {
  merge_shared_het: true,
});
check('default: A and E in different regimes',
      clusDefault.regime_of[0] !== clusDefault.regime_of[3]);
check('merge_shared_het: A and E in same regime',
      clusMergeShared.regime_of[0] === clusMergeShared.regime_of[3]);

// =====================================================================
group('refineRegimesFromIntervals — orchestrator');

const refined = refineRegimesFromIntervals(intervals1);
check('ok = true',                  refined.ok === true);
check('n_intervals = 5',            refined.n_intervals === 5);
check('regimes array populated',    refined.regimes.length > 0);
// First regime should span A's start to B/C's end
const regime0 = refined.regimes.find(r => r.member_ids.includes(0));
check('regime 0 start_bp = A start', regime0.start_bp === A.start_bp);
check('regime 0 end_bp ≥ C end',     regime0.end_bp >= C.end_bp);
check('regime 0 has hom_a intersect',
      regime0.hom_a_intersect.size > 0);
check('regime 0 het_union populated',
      regime0.het_union.size > 0);

// =====================================================================
group('refineRegimesFromIntervals — sign-flip intersection');

// In the regime spanning A, B, C — A's hom_a should intersect with
// C's hom_b (because C is SWAPPED). After sign-flip, the regime's
// hom_a_intersect should = A.hom_a ∩ B.hom_a ∩ C.hom_b.
// A.hom_a = {0,1,2,3}; B.hom_a = {0,1,2,3}; C.hom_b = {0,1,2,3}.
// So the intersection should be {0, 1, 2, 3}.
const ABCregime = refined.regimes.find(r =>
  r.member_ids.includes(0) && r.member_ids.includes(1)
  && r.member_ids.includes(2));
check('sign-flipped intersection = {0,1,2,3}',
      ABCregime.hom_a_intersect.size === 4
      && ABCregime.hom_a_intersect.has(0)
      && ABCregime.hom_a_intersect.has(3));

// =====================================================================
group('refineRegimesFromIntervals — empty / null');

check('null → ok=false',
      refineRegimesFromIntervals(null).ok === false);
check('empty array → ok=true, no regimes',
      refineRegimesFromIntervals([]).n_regimes === 0);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
