// tests/test_shared_mgl_haplotype_network.js

import {
  buildCarrierMatrix,
  pairwiseHamming,
  clusterByHammingRadius,
  interClusterDistance,
  minimumSpanningTree,
  forceLayout,
  buildHaplotypeNetwork,
  MGL_HAPNET_DEFAULTS,
} from '../atlases/evolution/shared/mgl_haplotype_network.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('exports');
check('defaults frozen',                       Object.isFrozen(MGL_HAPNET_DEFAULTS));
check('buildCarrierMatrix fn',                 typeof buildCarrierMatrix === 'function');
check('pairwiseHamming fn',                    typeof pairwiseHamming === 'function');
check('clusterByHammingRadius fn',             typeof clusterByHammingRadius === 'function');
check('interClusterDistance fn',               typeof interClusterDistance === 'function');
check('minimumSpanningTree fn',                typeof minimumSpanningTree === 'function');
check('forceLayout fn',                        typeof forceLayout === 'function');
check('buildHaplotypeNetwork fn',              typeof buildHaplotypeNetwork === 'function');

// =====================================================================
group('buildCarrierMatrix');
// 6 samples × 4 markers. inv_idx = [0,1,2,3]. carrier_threshold default 0.5.
const dosage = [
  Float64Array.from([2, 2, 0, 0, 0, 0]),  // M0
  Float64Array.from([0, 0, 2, 2, 0, 0]),  // M1
  Float64Array.from([2, 0, 2, 0, 0, 0]),  // M2
  Float64Array.from([1, 1, 1, 1, 0, 0]),  // M3 — HET inv, no STD
];
const carriers = buildCarrierMatrix({
  dosage, n_markers: 4, n_samples: 6, inv_idx: [0, 1, 2, 3],
});
check('carriers length = 4*4',                 carriers.length === 16);
check('sample 0 M0 = 1',                       carriers[0 * 4 + 0] === 1);
check('sample 0 M1 = 0',                       carriers[0 * 4 + 1] === 0);
check('sample 0 M3 = 1 (HET counts)',          carriers[0 * 4 + 3] === 1);
// Null safety.
check('null args → empty',                     buildCarrierMatrix(null).length === 0);

// =====================================================================
group('pairwiseHamming');
const dist = pairwiseHamming(carriers, 4, 4);
check('diagonal = 0',                          dist[0 * 4 + 0] === 0);
check('symmetric',                             dist[0 * 4 + 1] === dist[1 * 4 + 0]);
// sample 0 carriers: [1, 0, 1, 1]; sample 1 carriers: [1, 0, 0, 1]; diff at M2 → 1
check('d(0,1) = 1',                            dist[0 * 4 + 1] === 1);
// sample 2 carriers: [0, 1, 1, 1]; sample 0: [1, 0, 1, 1]; diff at M0, M1 → 2
check('d(0,2) = 2',                            dist[0 * 4 + 2] === 2);

// =====================================================================
group('clusterByHammingRadius');
// With radius 1: samples 0 and 1 join (d=1); sample 2 starts new (d=2 to 0); sample 3?
//   3 carriers: [0, 1, 0, 1]; d to 0 = 3, d to 1 = 2, d to 2 = 1 → joins cluster with 2.
const cl = clusterByHammingRadius(dist, 4, 1);
check('cluster 0/1 share',                     cl.labels[0] === cl.labels[1]);
check('cluster 2/3 share',                     cl.labels[2] === cl.labels[3]);
check('two clusters total',                    cl.clusters.length === 2);
// Radius 4 (very wide) → single cluster.
const clBig = clusterByHammingRadius(dist, 4, 4);
check('big radius → 1 cluster',                clBig.clusters.length === 1);
// Radius 0 (strict) → each sample its own cluster.
const clTight = clusterByHammingRadius(dist, 4, 0);
check('radius=0 → 4 clusters',                 clTight.clusters.length === 4);

// =====================================================================
group('interClusterDistance');
const interD = interClusterDistance(dist, 4, cl.clusters);
check('inter K = 2',                           interD.length === 4);
check('inter diagonal = 0',                    interD[0 * 2 + 0] === 0);
check('inter symmetric',                       interD[0 * 2 + 1] === interD[1 * 2 + 0]);
check('inter d(0,1) > 0',                      interD[0 * 2 + 1] > 0);

// =====================================================================
group('minimumSpanningTree');
const mst = minimumSpanningTree(interD, 2);
check('K=2: 1 edge',                           mst.length === 1);
check('edge connects 0 and 1',
      (mst[0].a === 0 && mst[0].b === 1) || (mst[0].a === 1 && mst[0].b === 0));
check('edge carries dist',                     Number.isFinite(mst[0].dist));
// K=1 → no edges.
check('K=1: 0 edges',                          minimumSpanningTree(new Float64Array([0]), 1).length === 0);
check('K=0: 0 edges',                          minimumSpanningTree(new Float64Array(0), 0).length === 0);

// More-cluster sanity check: K=4 with manual distance, MST should have 3 edges.
const m4 = Float64Array.from([
  0, 1, 4, 5,
  1, 0, 3, 4,
  4, 3, 0, 2,
  5, 4, 2, 0,
]);
const mst4 = minimumSpanningTree(m4, 4);
check('K=4: 3 MST edges',                      mst4.length === 3);
let totalCost = 0;
for (const e of mst4) totalCost += e.dist;
check('MST total cost = 1 + 3 + 2 = 6',        totalCost === 6);

// =====================================================================
group('forceLayout');
const pos = forceLayout(3, [{ a: 0, b: 1, dist: 1 }, { a: 1, b: 2, dist: 1 }],
  { width: 200, height: 200, iterations: 30, seed: 42 });
check('3 positions returned',                  pos.length === 3);
check('positions within [10..190]',
      pos.every(p => p.x >= 10 && p.x <= 190 && p.y >= 10 && p.y <= 190));
// Deterministic — same seed → same layout.
const pos2 = forceLayout(3, [{ a: 0, b: 1, dist: 1 }, { a: 1, b: 2, dist: 1 }],
  { width: 200, height: 200, iterations: 30, seed: 42 });
check('deterministic for same seed',
      Math.abs(pos[0].x - pos2[0].x) < 1e-9
   && Math.abs(pos[1].y - pos2[1].y) < 1e-9);
// K=0 → empty.
check('K=0 → empty positions',                 forceLayout(0, []).length === 0);

// =====================================================================
group('buildHaplotypeNetwork');
const net = buildHaplotypeNetwork({
  dosage, n_markers: 4, n_samples: 6, inv_idx: [0, 1, 2, 3],
  opts: { hamming_radius: 1, layout_iterations: 20, layout_seed: 7 },
});
check('K nodes returned',                      net.nodes.length === 2);
check('MST edges = K-1',                       net.edges.length === 1);
check('per-sample labels = inv_idx length',    net.sample_labels.length === 4);
check('every node has x/y',
      net.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));
check('every node has size > 0',
      net.nodes.every(n => n.size > 0));
check('carrier_matrix length = n × m',         net.carrier_matrix.length === 16);

// Empty / null safety.
check('null args → empty',
      buildHaplotypeNetwork(null).nodes.length === 0);
check('inv_idx empty → empty',
      buildHaplotypeNetwork({ dosage, n_markers: 4, n_samples: 6, inv_idx: [] }).nodes.length === 0);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
