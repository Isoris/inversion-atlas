// tests/test_discovery_dosage_index_aware.js
//
// Unit coverage for pages/discovery/dosage_heatmap/index_aware_cluster.js
// — position-aware haplotype clustering on ordered-bin trajectories.

import {
  buildSampleTrajectoryMatrix, smoothTrajectories, trajectoryDistance,
  clusterIndexAware, INDEX_AWARE_MAX_N,
} from '../atlases/inversion/pages/discovery/dosage_heatmap/index_aware_cluster.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }
function approx(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-9 : eps); }

// Canonical builder from a samples×markers dosage matrix (row-major).
function makeCanonical(rows, posBp) {
  const nS = rows.length, nM = rows[0].length;
  return {
    n_samples: nS, n_markers: nM,
    sample_labels: rows.map((_, i) => 's' + i),
    marker_pos_bp: posBp ? Float64Array.from(posBp) : null,
    cellValue: (m, s) => rows[s][m],
  };
}

// Two block-structured haplotypes + one mosaic that flips block by block.
//   left block (m0-2) | mid (m3-5) | right (m6-8)
const ABLOCK = [0, 0, 0, 1, 1, 1, 2, 2, 2];   // ascending blocks
const BBLOCK = [2, 2, 2, 1, 1, 1, 0, 0, 0];   // descending blocks
const MOSAIC = [0, 2, 0, 2, 0, 2, 0, 2, 0];   // flips every marker

// =====================================================================
group('buildSampleTrajectoryMatrix — bins + genomic ordering');

const canBlocks = makeCanonical([ABLOCK, ABLOCK.slice(), BBLOCK], null);
const traj = buildSampleTrajectoryMatrix(canBlocks, { binSize: 3, minBins: 3, maxBins: 3 });
check('returns matrix', !!traj && traj.nBins === 3 && traj.nS === 3);
check('sample0 bin means = [0,1,2]', traj
  && approx(traj.B[0], 0) && approx(traj.B[1], 1) && approx(traj.B[2], 2));
check('sample2 (B) bin means = [2,1,0]', traj
  && approx(traj.B[2 * 3 + 0], 2) && approx(traj.B[2 * 3 + 2], 0));

// Genomic ordering: shuffle marker positions and confirm bins follow bp.
const canPos = makeCanonical([[2, 0, 1, 2, 0, 1]], [30, 10, 20, 60, 40, 50]);
const trajPos = buildSampleTrajectoryMatrix(canPos, { binSize: 2, minBins: 3, maxBins: 3 });
// bp order → markers [1(0),2(1),0(2),4(0),5(1),3(2)] → bins [(0,1),(2,0),(1,2)] means [.5,1,1.5]
check('bins follow genomic position not column order', trajPos
  && approx(trajPos.B[0], 0.5) && approx(trajPos.B[1], 1) && approx(trajPos.B[2], 1.5));

// =====================================================================
group('smoothTrajectories');

// Single sample, spike in the middle bin — window 3 should damp it.
const Bspike = Float64Array.from([0, 0, 2, 0, 0]);
const sm = smoothTrajectories(Bspike, 1, 5, 3);
check('smoothing damps a one-bin spike', sm[2] < 2 && sm[2] > 0 && approx(sm[2], 2 / 3));
check('NaN bin filled from neighbours', (() => {
  const B = Float64Array.from([1, NaN, 1]);
  const s = smoothTrajectories(B, 1, 3, 3);
  return approx(s[1], 1);
})());

// =====================================================================
group('trajectoryDistance — fragmentation penalty');

// Build smoothed trajectories for A, A, B, MOSAIC (binSize 1 → 9 bins, no smoothing).
const can4 = makeCanonical([ABLOCK, ABLOCK.slice(), BBLOCK, MOSAIC], null);
const t4 = buildSampleTrajectoryMatrix(can4, { binSize: 1, minBins: 9, maxBins: 9 });
const B4 = t4.B;   // 4×9, identical to dosages (binSize 1)
const dAA = trajectoryDistance(B4, 9, 0, 1, {});   // identical
const dAB = trajectoryDistance(B4, 9, 0, 2, {});   // block-opposite, continuous
const dAM = trajectoryDistance(B4, 9, 0, 3, {});   // mosaic: fragmented
check('identical samples → distance 0', approx(dAA, 0));
check('A vs B > 0', dAB > 0);
check('mosaic incurs larger fragmentation penalty than a blocky pair', (() => {
  // Penalty SHARE = D(lambda=1) − D(lambda=0). A-vs-B switches twice
  // (F F F T T T F F F); A-vs-MOSAIC switches five times → larger share.
  const abPenalty  = trajectoryDistance(B4, 9, 0, 2, { lambda: 1, mu: 0 })
                   - trajectoryDistance(B4, 9, 0, 2, { lambda: 0, mu: 0 });
  const mosPenalty = trajectoryDistance(B4, 9, 0, 3, { lambda: 1, mu: 0 })
                   - trajectoryDistance(B4, 9, 0, 3, { lambda: 0, mu: 0 });
  return abPenalty > 0 && mosPenalty > abPenalty;
})());
check('continuity bonus lowers distance for long stable runs', (() => {
  const noBonus = trajectoryDistance(B4, 9, 0, 1, { mu: 0 });        // identical, 0 anyway
  // Use a near-identical pair with one differing bin to see the bonus.
  const Bn = Float64Array.from([0, 0, 0, 0, 0, 0, 0, 0, 2,   0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const withBonus = trajectoryDistance(Bn, 9, 0, 1, { mu: 0.15, threshold: 0.5 });
  const without   = trajectoryDistance(Bn, 9, 0, 1, { mu: 0,    threshold: 0.5 });
  return withBonus < without;
})());

// =====================================================================
group('clusterIndexAware — recovers block haplotypes');

// 6 samples: 3 A-type, 3 B-type. Should split into 2 clean groups.
const canCluster = makeCanonical([
  ABLOCK, ABLOCK.slice(), ABLOCK.slice(),
  BBLOCK, BBLOCK.slice(), BBLOCK.slice(),
], null);
const res = clusterIndexAware(canCluster, { k: 2, binSize: 3, minBins: 3, maxBins: 3, minNGroup: 1 });
check('returns detect-shaped result', !!res && res.mode === 'index_aware' && res.k === 2);
check('A-type samples share a label', res && res.labels[0] === res.labels[1] && res.labels[1] === res.labels[2]);
check('B-type samples share a label', res && res.labels[3] === res.labels[4] && res.labels[4] === res.labels[5]);
check('A and B are different labels', res && res.labels[0] !== res.labels[3]);
check('cluster 0 is lower mean dosage (relabelled ascending)', res && res.labels[0] === 0);
check('sample_group names carry tier', res && /hap \d+ \(/.test(res.sample_group[0]));
check('order is full-length permutation', (() => {
  if (!res || !res.order || res.order.length !== 6) return false;
  const seen = new Set(Array.from(res.order));
  return seen.size === 6;
})());
check('order groups same-label rows contiguously', (() => {
  const labsInOrder = Array.from(res.order).map(s => res.labels[s]);
  // no label should reappear after a different one (i.e., runs are contiguous)
  let switches = 0;
  for (let i = 1; i < labsInOrder.length; i++) if (labsInOrder[i] !== labsInOrder[i - 1]) switches++;
  return switches === 1;   // exactly one boundary between the two clusters
})());
check('groups summary present with per-group n', res && Array.isArray(res.groups)
  && res.groups.length === 2 && res.groups[0].n === 3 && res.groups[1].n === 3);
check('exports a margin + silhouette array', res
  && res.margin.length === 6 && res.silhouette.length === 6);

// =====================================================================
group('clusterIndexAware — auto-K + degenerate guards');

const auto = clusterIndexAware(canCluster, { k: 'auto', kMin: 2, kMax: 4, binSize: 3, minBins: 3, maxBins: 3, minNGroup: 2 });
check('auto-K finds the 2-group split', auto && auto.k === 2);

check('null on empty', clusterIndexAware(null) === null);
check('null when fewer samples than kMin', (() => {
  const c = makeCanonical([ABLOCK], null);
  return clusterIndexAware(c, { kMin: 2 }) === null;
})());
check('INDEX_AWARE_MAX_N exported', Number.isFinite(INDEX_AWARE_MAX_N) && INDEX_AWARE_MAX_N > 0);
check('NaN samples excluded (labelled -1)', (() => {
  const rows = [ABLOCK, ABLOCK.slice(), BBLOCK, BBLOCK.slice(), new Array(9).fill(NaN)];
  const c = makeCanonical(rows, null);
  const r = clusterIndexAware(c, { k: 2, binSize: 3, minBins: 3, maxBins: 3, minNGroup: 1 });
  return r && r.labels[4] === -1 && r.sample_group[4] === null;
})());

// =====================================================================
console.log('\n=================');
console.log('pass: ' + pass + '   fail: ' + fail);
console.log('=================');
if (fail > 0 && typeof process !== 'undefined') process.exitCode = 1;
