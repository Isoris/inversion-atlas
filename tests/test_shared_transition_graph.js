// tests/test_shared_transition_graph.js
//
// Unit coverage for shared/transition_graph.js — structural-haplotype
// transition graph computation (legacy lines 38020-38150).

import * as TG from '../atlases/inversion/shared/transition_graph.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('Constants');
check('hotspot threshold = 0.30',          TG.SHTG_HOTSPOT_THRESHOLD === 0.30);
check('min samples = 5',                   TG.SHTG_MIN_SAMPLES === 5);

// -----------------------------------------------------------------------------
group('computeShtgBoundaryStats: stable boundary (no transitions)');
// 10 samples, all stay in same band, identity perm
const cl = { labels: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1] };
const cr = { labels: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1] };
const identityPerm = [0, 1];
const stable = TG.computeShtgBoundaryStats(cl, cr, identityPerm, {
  leftIdx: 0, rightIdx: 1,
});
check('stable: n_samples = 10',            stable.n_samples === 10);
check('stable: n_changed = 0',             stable.n_changed === 0);
check('stable: transition_rate = 0',       stable.transition_rate === 0);
check('stable: edges array present',       Array.isArray(stable.edges));
check('stable: edges sorted desc',
      stable.edges[0].count >= stable.edges[stable.edges.length - 1].count);

// -----------------------------------------------------------------------------
group('computeShtgBoundaryStats: high transitions');
// Half the fish change bands
const cl2 = { labels: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1] };
const cr2 = { labels: [0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1] };
const hot = TG.computeShtgBoundaryStats(cl2, cr2, identityPerm);
check('hot: n_samples = 12',               hot.n_samples === 12);
check('hot: n_changed = 6',                hot.n_changed === 6);
check('hot: transition_rate = 0.5',        hot.transition_rate === 0.5);
check('hot: 4 edge entries',               hot.edges.length === 4);

// -----------------------------------------------------------------------------
group('computeShtgBoundaryStats: Hungarian perm');
// Right side is band-relabeled: 0↔1. Perm [1, 0] aligns them.
const cl3 = { labels: [0, 0, 0, 1, 1, 1, 0, 0, 1, 1] };
const cr3 = { labels: [1, 1, 1, 0, 0, 0, 1, 1, 0, 0] };  // exact same partition, just renamed
const aligned = TG.computeShtgBoundaryStats(cl3, cr3, [1, 0]);
check('perm: aligned → no transitions',    aligned.transition_rate === 0);

// Without perm (identity) → all "changed"
const unaligned = TG.computeShtgBoundaryStats(cl3, cr3, null);
check('no perm: all changed → rate 1',     unaligned.transition_rate === 1);

// -----------------------------------------------------------------------------
group('computeShtgBoundaryStats: edge cases');
check('null left → null',                  TG.computeShtgBoundaryStats(null, cr, identityPerm) === null);
check('null right → null',                 TG.computeShtgBoundaryStats(cl, null, identityPerm) === null);
check('label-length mismatch → null',
      TG.computeShtgBoundaryStats({ labels: [0] }, { labels: [0, 1] }, identityPerm) === null);

// Below min samples
const tiny = TG.computeShtgBoundaryStats({ labels: [0, 1] }, { labels: [0, 1] }, identityPerm);
check('below min_samples → null',          tiny === null);

// Negative labels excluded
const withNeg = TG.computeShtgBoundaryStats(
  { labels: [0, 0, -1, 1, 1, -1, 0, 0, 1, 1, 0, 0] },
  { labels: [0, 0, -1, 1, 1,  0, 0, 0, 1, 1, 0, 0] },
  identityPerm,
);
check('negative labels excluded: n_samples = 10',
      withNeg.n_samples === 10);

// fixedKLabels used when present
const withFixed = TG.computeShtgBoundaryStats(
  { labels: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], fixedKLabels: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
  { labels: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
  identityPerm,
);
check('fixedKLabels preferred (rate=0 after identity)',
      withFixed.transition_rate === 0);

// Envelope position
const withEnv = TG.computeShtgBoundaryStats(cl, cr, identityPerm, {
  leftEnvelope:  { end_bp: 1_000_000 },
  rightEnvelope: { start_bp: 2_000_000 },
});
check('position_mb derived: 1.5',          withEnv.position_mb === 1.5);

// -----------------------------------------------------------------------------
group('computeStructuralHaplotypeTransitionGraph');
const clusters = [
  { labels: [0, 1, 0, 1, 0, 1, 0, 1] },                 // L2 0
  { labels: [0, 1, 0, 1, 0, 1, 0, 1] },                 // L2 1 (stable)
  { labels: [1, 0, 1, 0, 1, 0, 1, 0] },                 // L2 2 (50% diff, identity perm)
  { labels: [1, 0, 1, 0, 1, 0, 1, 0] },                 // L2 3 (stable)
];
const envs = [
  { start_bp: 0,         end_bp: 1_000_000 },
  { start_bp: 1_000_000, end_bp: 2_000_000 },
  { start_bp: 2_000_000, end_bp: 3_000_000 },
  { start_bp: 3_000_000, end_bp: 4_000_000 },
];
const state = { data: { l2_envelopes: envs } };
const graph = TG.computeStructuralHaplotypeTransitionGraph(state, {
  getCluster: (i) => clusters[i],
  getPerm: () => [0, 1],
});
check('graph: 3 boundaries',               graph.boundaries.length === 3);
check('graph: middle boundary is hotspot (>0.30)',
      graph.boundaries[1].transition_rate >= TG.SHTG_HOTSPOT_THRESHOLD);
check('graph: hotspots contains middle',
      graph.hotspots.length === 1 && graph.hotspots[0].l2_left === 1);
check('graph: stable boundaries not hotspot',
      graph.boundaries[0].transition_rate === 0);

// Empty / no envelopes
check('graph: no envelopes → empty',
      TG.computeStructuralHaplotypeTransitionGraph({}, { getCluster: () => null }).boundaries.length === 0);
check('graph: no getCluster → empty',
      TG.computeStructuralHaplotypeTransitionGraph(state, {}).boundaries.length === 0);

// Custom threshold
const graphLow = TG.computeStructuralHaplotypeTransitionGraph(state, {
  getCluster: (i) => clusters[i],
  getPerm: () => [0, 1],
  hotspotThreshold: 0.01,
});
check('custom threshold: 1 hotspot (middle has rate 1)',
      graphLow.hotspots.length === 1);

// -----------------------------------------------------------------------------
group('summarizeTransitionBoundary');
const stats = graph.boundaries[1];
const summary = TG.summarizeTransitionBoundary(stats);
check('summary: position_mb forwarded',    summary.position_mb === stats.position_mb);
check('summary: rate forwarded',           summary.transition_rate === stats.transition_rate);
check('summary: is_hotspot true',          summary.is_hotspot === true);
check('summary: top_edges_label format',   /^B\d+→B\d+:\d+/.test(summary.top_edges_label));

// Stable boundary → not a hotspot
const stableSummary = TG.summarizeTransitionBoundary(graph.boundaries[0]);
check('summary stable: is_hotspot false',  stableSummary.is_hotspot === false);

check('summary: null stats → null',        TG.summarizeTransitionBoundary(null) === null);

// Custom threshold
const cs = TG.summarizeTransitionBoundary(graph.boundaries[0], 0.01);
check('summary custom threshold: stable=false vs 0.01',  cs.is_hotspot === false);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
