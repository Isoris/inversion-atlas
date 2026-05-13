// tests/test_shared_band_tracking_regime_topology.js
//
// Unit coverage for shared/band_tracking/regime_topology.js — Layer 3.

import {
  REGIME_TOPOLOGY_RELATIONSHIPS,
  REGIME_TOPOLOGY_DEFAULTS,
  regimeBpFootprint,
  regimePairwiseTopology,
  buildRegimeTopologyGraph,
  findChromosomeRegimeChains,
  serializeRegimesToJson,
} from '../atlases/inversion/shared/band_tracking/regime_topology.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab + defaults');

check('relationships frozen',
      Object.isFrozen(REGIME_TOPOLOGY_RELATIONSHIPS));
check('defaults frozen',
      Object.isFrozen(REGIME_TOPOLOGY_DEFAULTS));
check('NESTED constant',
      REGIME_TOPOLOGY_RELATIONSHIPS.NESTED === 'nested');
check('CHAINED constant',
      REGIME_TOPOLOGY_RELATIONSHIPS.CHAINED === 'chained');
check('adjacent_max_gap_bp default = 2 Mb',
      REGIME_TOPOLOGY_DEFAULTS.adjacent_max_gap_bp === 2_000_000);

// =====================================================================
group('regimeBpFootprint');

const f = regimeBpFootprint({ start_bp: 1_000_000, end_bp: 5_000_000 });
check('start propagated',           f.start_bp === 1_000_000);
check('end propagated',             f.end_bp === 5_000_000);
check('length = end - start',       f.length_bp === 4_000_000);

check('null → null',                regimeBpFootprint(null) === null);
check('missing bp → null',
      regimeBpFootprint({ start_bp: 1 }) === null);

// =====================================================================
// Fixture regimes
// =====================================================================
function mk(start, end, homA, homB, het, id) {
  return {
    regime_id: id != null ? id : 0,
    member_ids: [], sign_split: false,
    start_bp: start, end_bp: end,
    n_intervals: 1,
    hom_a_intersect: new Set(homA),
    hom_b_intersect: new Set(homB),
    het_union:       new Set(het),
  };
}

// =====================================================================
group('regimePairwiseTopology — NESTED');

// B sits entirely inside A; sample-cores match.
const RA = mk(1_000_000, 10_000_000,
              [0, 1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 11],
              [12, 13, 14], 0);
const RB = mk(3_000_000, 5_000_000,
              [0, 1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 11],
              [12, 13, 14], 1);
const rNest = regimePairwiseTopology(RA, RB);
check('B inside A → NESTED',
      rNest.relationship === REGIME_TOPOLOGY_RELATIONSHIPS.NESTED);
check('high containment',           rNest.bp_containment_frac >= 0.99);
check('hom_a_jaccard = 1',          rNest.hom_a_jaccard === 1);

// =====================================================================
group('regimePairwiseTopology — OVERLAPPING_CONFLICT');

// Overlap bp but disjoint sample-cores.
const RC = mk(2_000_000, 8_000_000,
              [100, 101, 102], [200, 201, 202], [300, 301], 2);
const rConf = regimePairwiseTopology(RA, RC);
check('disjoint cores + bp overlap → OVERLAPPING_CONFLICT',
      rConf.relationship === REGIME_TOPOLOGY_RELATIONSHIPS.OVERLAPPING_CONFLICT);
check('bp_overlap_bp > 0',           rConf.bp_overlap_bp > 0);
check('hom_a_jaccard = 0',           rConf.hom_a_jaccard === 0);

// =====================================================================
group('regimePairwiseTopology — CHAINED');

// Adjacent (no bp overlap) but HOM_A samples are mostly shared.
const RD = mk(11_000_000, 15_000_000,
              [0, 1, 2, 3, 4, 5], [60, 61, 62, 63, 64, 65],
              [80, 81, 82], 3);
const rChain = regimePairwiseTopology(RA, RD);
check('adjacent + shared HOM_A → CHAINED',
      rChain.relationship === REGIME_TOPOLOGY_RELATIONSHIPS.CHAINED);
check('chained_shared_hom = 6',     rChain.chained_shared_hom === 6);
check('hom_a_jaccard = 1',           rChain.hom_a_jaccard === 1);
check('bp_gap_bp = 1 Mb',            rChain.bp_gap_bp === 1_000_000);

// =====================================================================
group('regimePairwiseTopology — ADJACENT (no shared cores)');

const RE = mk(11_000_000, 15_000_000,
              [200, 201, 202], [300, 301, 302], [400, 401], 4);
const rAdj = regimePairwiseTopology(RA, RE);
check('adjacent + disjoint cores → ADJACENT',
      rAdj.relationship === REGIME_TOPOLOGY_RELATIONSHIPS.ADJACENT);

// =====================================================================
group('regimePairwiseTopology — INDEPENDENT (far apart)');

const RFar = mk(50_000_000, 55_000_000,
                [200, 201, 202], [300, 301, 302], [400, 401], 5);
const rInd = regimePairwiseTopology(RA, RFar);
check('huge bp gap → INDEPENDENT',
      rInd.relationship === REGIME_TOPOLOGY_RELATIONSHIPS.INDEPENDENT);
check('bp_gap_bp > adjacent_max_gap_bp',
      rInd.bp_gap_bp > REGIME_TOPOLOGY_DEFAULTS.adjacent_max_gap_bp);

// =====================================================================
group('regimePairwiseTopology — null inputs');

const rNull = regimePairwiseTopology(null, RA);
check('null → INDEPENDENT',
      rNull.relationship === REGIME_TOPOLOGY_RELATIONSHIPS.INDEPENDENT);
check('null: bp_overlap = 0',       rNull.bp_overlap_bp === 0);

// =====================================================================
group('buildRegimeTopologyGraph');

const regimes1 = [RA, RB, RC, RD, RE, RFar];
const graph1 = buildRegimeTopologyGraph(regimes1);
check('n_regimes = 6',              graph1.n_regimes === 6);
check('edges array',                graph1.edges.length > 0);
check('matrix size 6×6',            graph1.relationship_matrix.length === 6
                                      && graph1.relationship_matrix[0].length === 6);
check('matrix symmetric',
      graph1.relationship_matrix[0][3] === graph1.relationship_matrix[3][0]);
// RA-RB should be NESTED
const eNest = graph1.edges.find(e => (e.i === 0 && e.j === 1));
check('RA-RB edge: NESTED',
      eNest && eNest.relationship === REGIME_TOPOLOGY_RELATIONSHIPS.NESTED);
// RA-RD should be CHAINED
const eChain = graph1.edges.find(e => (e.i === 0 && e.j === 3));
check('RA-RD edge: CHAINED',
      eChain && eChain.relationship === REGIME_TOPOLOGY_RELATIONSHIPS.CHAINED);
// RFar should produce no edges
check('RFar produces no edges',
      graph1.edges.every(e => e.i !== 5 && e.j !== 5));

// =====================================================================
group('buildRegimeTopologyGraph — empty');

const graphEmpty = buildRegimeTopologyGraph([]);
check('empty: n_regimes = 0',       graphEmpty.n_regimes === 0);
check('empty: no edges',            graphEmpty.edges.length === 0);

// =====================================================================
group('findChromosomeRegimeChains');

// Build a 3-regime CHAINED structure: P → Q → R
const RP = mk( 1_000_000,  5_000_000,
              [0, 1, 2, 3, 4, 5], [10, 11, 12, 13, 14, 15],
              [50, 51], 0);
const RQ = mk( 6_000_000, 10_000_000,
              [0, 1, 2, 3, 4, 5], [20, 21, 22, 23, 24, 25],
              [60, 61], 1);
const RR = mk(11_000_000, 15_000_000,
              [0, 1, 2, 3, 4, 5], [30, 31, 32, 33, 34, 35],
              [70, 71], 2);
const regimes2 = [RP, RQ, RR];
const graph2 = buildRegimeTopologyGraph(regimes2);
const chainsRes = findChromosomeRegimeChains(graph2, regimes2);
check('1 chain over 3 regimes',     chainsRes.n_chains === 1);
check('chain contains all 3 regime indices',
      chainsRes.chains[0].regime_ids.length === 3
      && chainsRes.chains[0].regime_ids.includes(0)
      && chainsRes.chains[0].regime_ids.includes(2));
check('chain ordered by start_bp',
      chainsRes.chains[0].regime_ids[0] === 0);
check('regime_in_chain = [0, 0, 0]',
      Array.from(chainsRes.regime_in_chain).every(v => v === 0));
check('shared_homs_along has 2 steps',
      chainsRes.chains[0].shared_homs_along.length === 2);
check('chain span correct',
      chainsRes.chains[0].start_bp === 1_000_000
      && chainsRes.chains[0].end_bp === 15_000_000);

// Two singletons + one chain
const regimes3 = [RP, RQ, RC];     // RP-RQ CHAINED; RC = independent (disjoint cores)
const graph3 = buildRegimeTopologyGraph(regimes3);
const chains3 = findChromosomeRegimeChains(graph3, regimes3);
check('2 chains: one CHAINED + one singleton',
      chains3.n_chains === 2);

// Empty
const chainsEmpty = findChromosomeRegimeChains({ n_regimes: 0, edges: [] }, []);
check('empty: 0 chains',            chainsEmpty.n_chains === 0);

// =====================================================================
group('serializeRegimesToJson');

const refinedFixture = {
  ok: true,
  n_intervals: 3,
  n_regimes: 1,
  regimes: [{
    regime_id: 0, member_ids: [0, 1, 2], sign_split: false,
    start_bp: 1_000_000, end_bp: 5_000_000, n_intervals: 3,
    hom_a_intersect: new Set([2, 0, 1]),   // out-of-order to test sort
    hom_b_intersect: new Set([10, 11]),
    het_union: new Set([50]),
  }],
  regime_of: new Int32Array([0, 0, 0]),
  regime_sign: new Int8Array([1, 1, 1]),
};
const ser = serializeRegimesToJson(refinedFixture);
check('ok = true',                  ser.ok === true);
check('regimes count = 1',          ser.regimes.length === 1);
check('hom_a sorted array',
      JSON.stringify(ser.regimes[0].hom_a_intersect) === '[0,1,2]');
check('hom_b sorted array',
      JSON.stringify(ser.regimes[0].hom_b_intersect) === '[10,11]');
check('het as array',
      JSON.stringify(ser.regimes[0].het_union) === '[50]');

// Round-trip via JSON.stringify shouldn't throw or lose data
const roundtrip = JSON.parse(JSON.stringify(ser));
check('JSON round-trip preserves regime_id',
      roundtrip.regimes[0].regime_id === 0);
check('JSON round-trip preserves bp',
      roundtrip.regimes[0].start_bp === 1_000_000);

// With topology + chains extras
const serFull = serializeRegimesToJson(refinedFixture, {
  topology: graph2,
  chains: chainsRes,
});
check('topology included',          serFull.topology && Array.isArray(serFull.topology.edges));
check('chains included',            serFull.chains && serFull.chains.n_chains > 0);
check('regime_in_chain as plain array',
      Array.isArray(serFull.chains.regime_in_chain));

// Empty refined output
const serEmpty = serializeRegimesToJson({ ok: false });
check('not ok → ok=false',          serEmpty.ok === false);
check('not ok → no regimes',        serEmpty.regimes.length === 0);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
