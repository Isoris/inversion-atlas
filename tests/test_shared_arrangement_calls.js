// tests/test_shared_arrangement_calls.js
//
// Unit coverage for shared/arrangement_calls.js — decoder + per-sample
// voting + palette + JSON validator per
// SPEC_arrangement_color_mode_and_arrangement_calls_v1.md.

import {
  ARRANGEMENT_CALLS_SCHEMA_VERSION,
  ARRANGEMENT_UNCALLED,
  ARR_PALETTE,
  ARR_COLOR_UNCALLED,
  arrangementColor,
  decodeArrangementsFromPartition,
  assignArrangementPerSample,
  tabulateArrangementSizes,
  validateArrangementCallsJson,
} from '../atlases/inversion/shared/arrangement_calls.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab + palette');

check('schema_version = 1',           ARRANGEMENT_CALLS_SCHEMA_VERSION === 1);
check('ARR_PALETTE frozen',           Object.isFrozen(ARR_PALETTE));
check('palette has 6 colours',        ARR_PALETTE.length === 6);
check('ARRANGEMENT_UNCALLED = -1',    ARRANGEMENT_UNCALLED === -1);

check('arr 0 → palette[0]',           arrangementColor(0) === ARR_PALETTE[0]);
check('arr 5 → palette[5]',           arrangementColor(5) === ARR_PALETTE[5]);
check('arr 6 → golden HSL string',    arrangementColor(6).startsWith('hsl('));
check('arr -1 → uncalled grey',       arrangementColor(-1) === ARR_COLOR_UNCALLED);
check('arr NaN → uncalled grey',      arrangementColor(NaN) === ARR_COLOR_UNCALLED);
check('arr null → uncalled grey',     arrangementColor(null) === ARR_COLOR_UNCALLED);

// =====================================================================
group('decodeArrangementsFromPartition — 2 probes × K=3, clean');

// Probe 0 centers: [-0.10, 0.00, +0.10]
// Probe 1 centers: [-0.08, 0.02, +0.09]
// Global ids: 0..2 = probe 0, 3..5 = probe 1.
// Pair them so that K=3 blocks emerge sorted by ascending PC1:
//   block A = {p0.k0, p1.k0}    mean = -0.09 → arrangement 0
//   block B = {p0.k1, p1.k1}    mean =  0.01 → arrangement 1
//   block C = {p0.k2, p1.k2}    mean =  0.095 → arrangement 2
const cleanProbes = [
  { centers: [-0.10, 0.00, 0.10] },
  { centers: [-0.08, 0.02, 0.09] },
];
const cleanPartition = [
  [0, 3],   // probe0.k0 + probe1.k0
  [1, 4],   // probe0.k1 + probe1.k1
  [2, 5],   // probe0.k2 + probe1.k2
];
const dec1 = decodeArrangementsFromPartition(cleanPartition, cleanProbes);
check('n_arrangements = 3',           dec1.n_arrangements === 3);
check('arr_cluster_to_arrangement[0] = [0,1,2]',
      JSON.stringify(dec1.arr_cluster_to_arrangement[0]) === '[0,1,2]');
check('arr_cluster_to_arrangement[1] = [0,1,2]',
      JSON.stringify(dec1.arr_cluster_to_arrangement[1]) === '[0,1,2]');
check('block_mean_pc1 ascending',
      dec1.block_mean_pc1[0] < dec1.block_mean_pc1[1]
      && dec1.block_mean_pc1[1] < dec1.block_mean_pc1[2]);

// =====================================================================
group('decodeArrangementsFromPartition — permuted probe (label-switching)');

// Same probes, but the partition mixes probe 1's k labels into
// different blocks — simulating label permutation between probes.
//   block A = {p0.k0, p1.k1}    mean = (-0.10 + 0.02)/2 = -0.04  → arrangement 0
//   block B = {p0.k1, p1.k2}    mean = ( 0.00 + 0.09)/2 = +0.045 → arrangement 1
//   block C = {p0.k2, p1.k0}    mean = ( 0.10 - 0.08)/2 = +0.01  → arrangement ?
// Sorting by mean: -0.04, 0.01, 0.045
//   → arrangement 0 = block A
//   → arrangement 1 = block C
//   → arrangement 2 = block B
const permPartition = [
  [0, 4],   // p0.k0 + p1.k1  (block A)
  [1, 5],   // p0.k1 + p1.k2  (block B)
  [2, 3],   // p0.k2 + p1.k0  (block C)
];
const dec2 = decodeArrangementsFromPartition(permPartition, cleanProbes);
check('permuted: n_arrangements = 3', dec2.n_arrangements === 3);
// probe 0 mapping: k0 → arr 0 (block A), k1 → arr 2 (block B), k2 → arr 1 (block C)
check('permuted probe 0 map = [0,2,1]',
      JSON.stringify(dec2.arr_cluster_to_arrangement[0]) === '[0,2,1]');
// probe 1 mapping: k0 → arr 1 (block C), k1 → arr 0 (block A), k2 → arr 2 (block B)
check('permuted probe 1 map = [1,0,2]',
      JSON.stringify(dec2.arr_cluster_to_arrangement[1]) === '[1,0,2]');

// =====================================================================
group('decodeArrangementsFromPartition — edge cases');

const e1 = decodeArrangementsFromPartition([], cleanProbes);
check('empty partition → 0 arrangements', e1.n_arrangements === 0);
const e2 = decodeArrangementsFromPartition(cleanPartition, []);
check('empty probes → 0 arrangements',    e2.n_arrangements === 0);
const e3 = decodeArrangementsFromPartition(null, null);
check('null inputs → 0 arrangements',     e3.n_arrangements === 0);

// =====================================================================
group('assignArrangementPerSample — clean majority');

// arr_cluster_to_arrangement from dec1 (no permutation, [[0,1,2],[0,1,2]]).
// Sample 0: probe 0 → k0, probe 1 → k0 → arr 0 unanimous
// Sample 1: probe 0 → k1, probe 1 → k1 → arr 1
// Sample 2: probe 0 → k2, probe 1 → k2 → arr 2
// Sample 3: probe 0 → k0, probe 1 → k1 → tie → uncalled
// Sample 4: probe 0 → -1, probe 1 → k2 → arr 2 (only 1 vote, full share)
// Sample 5: probe 0 → k1, probe 1 → null → arr 1 (only 1 vote, full share)
// Sample 6: probe 0 → null, probe 1 → null → uncalled
const samples = [
  [0, 0],
  [1, 1],
  [2, 2],
  [0, 1],
  [-1, 2],
  [1, null],
  [null, null],
];
const aps = assignArrangementPerSample(samples, dec1.arr_cluster_to_arrangement);
check('s0 → arr 0',                     aps[0] === 0);
check('s1 → arr 1',                     aps[1] === 1);
check('s2 → arr 2',                     aps[2] === 2);
check('s3 (tie) → uncalled',            aps[3] === ARRANGEMENT_UNCALLED);
check('s4 (1 vote) → arr 2',            aps[4] === 2);
check('s5 (1 vote) → arr 1',            aps[5] === 1);
check('s6 (no votes) → uncalled',       aps[6] === ARRANGEMENT_UNCALLED);

// =====================================================================
group('assignArrangementPerSample — 3-probe majority');

// 3 probes, K=3. Decoder gives identity mapping per probe.
const probes3 = [
  { centers: [-0.10, 0.00, 0.10] },
  { centers: [-0.10, 0.00, 0.10] },
  { centers: [-0.10, 0.00, 0.10] },
];
const partition3 = [[0,3,6], [1,4,7], [2,5,8]];
const dec3 = decodeArrangementsFromPartition(partition3, probes3);
const samples3 = [
  [0, 0, 0],   // s0: unanimous → arr 0
  [0, 0, 1],   // s1: 2/3 = 0.67 → arr 0 (above default 0.5)
  [0, 1, 2],   // s2: 1/1/1 → 3-way tie → uncalled
  [1, 1, 2],   // s3: 2/3 → arr 1
];
const aps3 = assignArrangementPerSample(samples3, dec3.arr_cluster_to_arrangement);
check('3-probe unanimous',              aps3[0] === 0);
check('3-probe 2/3 majority',           aps3[1] === 0);
check('3-probe 3-way tie → uncalled',   aps3[2] === ARRANGEMENT_UNCALLED);
check('3-probe 2/3 majority arr 1',     aps3[3] === 1);

// =====================================================================
group('assignArrangementPerSample — min_vote_share threshold');

// 4 probes, default min_vote_share = 0.5
const samples4 = [ [0, 0, 1, 2] ];   // 2/4 = 0.5 — exactly threshold → arr 0
const dec4 = decodeArrangementsFromPartition(
  [[0,4,8,12], [1,5,9,13], [2,6,10,14], [3,7,11,15]],
  [{centers:[-1,0,1]}, {centers:[-1,0,1]}, {centers:[-1,0,1]}, {centers:[-1,0,1]}],
);
// Wait — that decoder gives K=4 (4 blocks). Redo with K=3 by collapsing
// to 12 global ids in 3 blocks:
const probes4 = [{centers:[-1,0,1]}, {centers:[-1,0,1]}, {centers:[-1,0,1]}, {centers:[-1,0,1]}];
const partition4 = [[0,3,6,9], [1,4,7,10], [2,5,8,11]];
const dec4b = decodeArrangementsFromPartition(partition4, probes4);
const aps4_low = assignArrangementPerSample(
  [[0, 0, 1, 2]],   // 2/4 = 0.5 → arr 0 at exactly threshold
  dec4b.arr_cluster_to_arrangement,
);
check('exactly min_vote_share (0.5) → arr 0',  aps4_low[0] === 0);
const aps4_strict = assignArrangementPerSample(
  [[0, 0, 1, 2]],
  dec4b.arr_cluster_to_arrangement,
  { min_vote_share: 0.75 },
);
check('share=0.5 < 0.75 → uncalled',           aps4_strict[0] === ARRANGEMENT_UNCALLED);

// =====================================================================
group('tabulateArrangementSizes');

const tab = tabulateArrangementSizes([0, 0, 0, 1, 1, 2, -1, -1], 3);
check('arrangement_sizes = [3,2,1]',  JSON.stringify(tab.arrangement_sizes) === '[3,2,1]');
check('n_uncalled = 2',               tab.n_uncalled === 2);
check('n_samples = 8',                tab.n_samples === 8);

const tabEmpty = tabulateArrangementSizes([], 3);
check('empty → sizes [0,0,0]',        JSON.stringify(tabEmpty.arrangement_sizes) === '[0,0,0]');
check('empty → n_uncalled = 0',       tabEmpty.n_uncalled === 0);

// =====================================================================
group('validateArrangementCallsJson');

const goodJson = {
  tool: 'arrangement_calls_v1',
  schema_version: 1,
  chrom: 'C_gar_LG28',
  n_samples: 3,
  candidates: {
    cand_15Mb: {
      candidate_id: 'cand_15Mb',
      start_bp: 15000000, end_bp: 18000000,
      start_w: 3000, end_w: 4000,
      probes: [
        { probe_idx: 0, k_used: 3, centers: [-0.1, 0, 0.1] },
        { probe_idx: 1, k_used: 3, centers: [-0.1, 0, 0.1] },
      ],
      n_arrangements: 3,
      arrangement_per_sample: [0, 1, -1],
      arr_cluster_to_arrangement: [[0,1,2], [0,1,2]],
      consensus_class: 'CLEAN_PARTITION',
    },
  },
};
const vg = validateArrangementCallsJson(goodJson);
check('good payload → ok',           vg.ok === true);
check('good payload → no errors',    vg.errors.length === 0);

// Bad: wrong tool name
const v_bad_tool = validateArrangementCallsJson({ ...goodJson, tool: 'something_else' });
check('wrong tool → !ok',            v_bad_tool.ok === false);
check('wrong tool → reports tool',   v_bad_tool.errors.some(e => e.includes('tool')));

// Bad: missing top field
const v_miss = validateArrangementCallsJson({ tool: 'arrangement_calls_v1' });
check('missing fields → errors',     v_miss.ok === false && v_miss.errors.length > 0);

// Bad: arrangement_per_sample length mismatch
const v_bad_aps_len = JSON.parse(JSON.stringify(goodJson));
v_bad_aps_len.candidates.cand_15Mb.arrangement_per_sample = [0, 1];   // length 2 ≠ n_samples 3
const v_l = validateArrangementCallsJson(v_bad_aps_len);
check('arrangement_per_sample.length mismatch flagged',
      !v_l.ok && v_l.errors.some(e => e.includes('arrangement_per_sample.length')));

// Bad: arrangement_per_sample value out of range
const v_bad_aps_val = JSON.parse(JSON.stringify(goodJson));
v_bad_aps_val.candidates.cand_15Mb.arrangement_per_sample = [0, 1, 99];
const v_v = validateArrangementCallsJson(v_bad_aps_val);
check('arrangement_per_sample value out of range flagged',
      !v_v.ok && v_v.errors.some(e => e.includes('out of range')));

// Bad: arr_cluster_to_arrangement length mismatch
const v_bad_acta = JSON.parse(JSON.stringify(goodJson));
v_bad_acta.candidates.cand_15Mb.arr_cluster_to_arrangement = [[0,1,2]];   // 1 probe, but 2 probes registered
const v_a = validateArrangementCallsJson(v_bad_acta);
check('arr_cluster_to_arrangement length mismatch flagged',
      !v_a.ok && v_a.errors.some(e => e.includes('arr_cluster_to_arrangement.length')));

// Bad: probe.centers length != k_used
const v_bad_centers = JSON.parse(JSON.stringify(goodJson));
v_bad_centers.candidates.cand_15Mb.probes[0].centers = [-0.1, 0.0];   // length 2 ≠ k_used 3
const v_c = validateArrangementCallsJson(v_bad_centers);
check('probe centers length != k_used flagged',
      !v_c.ok && v_c.errors.some(e => e.includes('centers')));

// Bad: null payload
check('null payload → !ok',         validateArrangementCallsJson(null).ok === false);
check('non-object payload → !ok',   validateArrangementCallsJson('x').ok === false);

// =====================================================================
group('integration — decode + assign + tabulate round-trip');

const dec = decodeArrangementsFromPartition(cleanPartition, cleanProbes);
const aps_rt = assignArrangementPerSample(
  [[0,0], [1,1], [2,2], [0,1], [2,2]],
  dec.arr_cluster_to_arrangement,
);
const tab_rt = tabulateArrangementSizes(aps_rt, dec.n_arrangements);
check('round-trip: 5 samples, 4 called',
      tab_rt.n_samples === 5 && tab_rt.n_uncalled === 1);
check('round-trip: sizes = [1,1,2]',
      JSON.stringify(tab_rt.arrangement_sizes) === '[1,1,2]');

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
