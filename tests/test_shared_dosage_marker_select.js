// tests/test_shared_dosage_marker_select.js
//
// Unit coverage for shared/dosage_marker_select.js — top-marker
// picker + sample-order ranking.

import {
  DOSAGE_HEATMAP_DEFAULTS,
  selectTopMarkers,
  orderSamplesByGroupAndPC1,
} from '../atlases/inversion/shared/dosage_marker_select.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('defaults');

check('frozen',                       Object.isFrozen(DOSAGE_HEATMAP_DEFAULTS));
check('MISSING_THRESHOLD = 0.20',     DOSAGE_HEATMAP_DEFAULTS.MISSING_THRESHOLD === 0.20);
check('DEFAULT_CAP = 200',            DOSAGE_HEATMAP_DEFAULTS.DEFAULT_CAP === 200);
check('HARD_CAP = 500',               DOSAGE_HEATMAP_DEFAULTS.HARD_CAP === 500);
check('WINDOW_RADIUS = 5',            DOSAGE_HEATMAP_DEFAULTS.WINDOW_RADIUS === 5);

// =====================================================================
group('selectTopMarkers — null / empty');

check('null chunk → empty',
      selectTopMarkers(null, { start_bp: 0, end_bp: 100 }, 10).selected_indices.length === 0);
check('no region → empty',
      selectTopMarkers({ markers: [], dosage: [] }, null, 10).selected_indices.length === 0);
check('empty markers → total_in_region=0',
      selectTopMarkers({ markers: [], dosage: [] },
        { start_bp: 0, end_bp: 100 }, 10).total_in_region === 0);

// =====================================================================
group('selectTopMarkers — region subsetting');

const chunkBasic = {
  samples: ['s1', 's2', 's3'],
  markers: [
    { marker_id: 'm0', pos_bp:  5, missingness: 0 },
    { marker_id: 'm1', pos_bp: 15, missingness: 0 },
    { marker_id: 'm2', pos_bp: 25, missingness: 0 },
    { marker_id: 'm3', pos_bp: 50, missingness: 0 },
  ],
  dosage: [
    [0, 1, 2],
    [2, 1, 0],
    [0, 0, 1],
    [1, 1, 1],
  ],
};
const r1 = selectTopMarkers(chunkBasic, { start_bp: 10, end_bp: 30 }, 10);
check('region [10,30]: total_in_region = 2',  r1.total_in_region === 2);
check('region [10,30]: 2 selected',           r1.selected_indices.length === 2);
check('region [10,30]: includes m1, m2',
      r1.selected_indices.indexOf(1) >= 0 && r1.selected_indices.indexOf(2) >= 0);
check('left-to-right order preserved',
      r1.selected_indices[0] < r1.selected_indices[1]);

// =====================================================================
group('selectTopMarkers — missingness filter');

const chunkMiss = {
  samples: ['s1', 's2'],
  markers: [
    { marker_id: 'm0', pos_bp: 10, missingness: 0.10 },
    { marker_id: 'm1', pos_bp: 20, missingness: 0.50 },     // dropped (> 0.20)
    { marker_id: 'm2', pos_bp: 30, missingness: 0.10 },
  ],
  dosage: [[1, 2], [0, 1], [2, 0]],
};
const rM = selectTopMarkers(chunkMiss, { start_bp: 0, end_bp: 100 }, 10);
check('dropped_missingness = 1',     rM.dropped_missingness === 1);
check('m1 not selected',             rM.selected_indices.indexOf(1) === -1);
check('selected count = 2',          rM.selected_indices.length === 2);

// Custom threshold
const rMC = selectTopMarkers(chunkMiss, { start_bp: 0, end_bp: 100 }, 10,
  { missing_threshold: 0.60 });
check('custom threshold: 0 dropped', rMC.dropped_missingness === 0);

// =====================================================================
group('selectTopMarkers — diagnostic_score ranking');

const chunkDiag = {
  samples: ['s1', 's2'],
  markers: [
    { marker_id: 'm0', pos_bp: 10, missingness: 0, diagnostic_score: 0.1 },
    { marker_id: 'm1', pos_bp: 20, missingness: 0, diagnostic_score: 0.9 },
    { marker_id: 'm2', pos_bp: 30, missingness: 0, diagnostic_score: 0.5 },
    { marker_id: 'm3', pos_bp: 40, missingness: 0, diagnostic_score: 0.3 },
  ],
  dosage: [[0, 1], [1, 0], [2, 2], [1, 1]],
};
const rD = selectTopMarkers(chunkDiag, { start_bp: 0, end_bp: 50 }, 2);
check('uses diagnostic_score column', rD.used_diagnostic_score === true);
check('top 2 by score: m1, m2',
      rD.selected_indices.indexOf(1) >= 0
      && rD.selected_indices.indexOf(2) >= 0);
check('positional order preserved',  rD.selected_indices[0] < rD.selected_indices[1]);

// One marker missing score → falls back to variance
const chunkPartialDiag = {
  samples: ['s1', 's2'],
  markers: [
    { marker_id: 'm0', pos_bp: 10, missingness: 0, diagnostic_score: 0.9 },
    { marker_id: 'm1', pos_bp: 20, missingness: 0 /* no score */ },
  ],
  dosage: [[0, 1], [2, 0]],
};
const rPD = selectTopMarkers(chunkPartialDiag, { start_bp: 0, end_bp: 50 }, 10);
check('partial diagnostic_score: NOT used',  rPD.used_diagnostic_score === false);

// =====================================================================
group('selectTopMarkers — variance fallback');

// All values constant in m0 → variance 0; m1 has variation; pick m1.
const chunkVar = {
  samples: ['s1', 's2', 's3'],
  markers: [
    { marker_id: 'm0', pos_bp: 10, missingness: 0 },
    { marker_id: 'm1', pos_bp: 20, missingness: 0 },
    { marker_id: 'm2', pos_bp: 30, missingness: 0 },
  ],
  dosage: [
    [1, 1, 1],    // var 0
    [0, 1, 2],    // var 2/3
    [0, 0, 2],    // var 8/9 (highest)
  ],
};
const rV = selectTopMarkers(chunkVar, { start_bp: 0, end_bp: 100 }, 2);
check('variance fallback: m2 (highest) selected',
      rV.selected_indices.indexOf(2) >= 0);
check('variance fallback: NOT used_diagnostic_score',
      rV.used_diagnostic_score === false);

// NA encoded as -1 skipped in variance
const chunkNA = {
  samples: ['s1', 's2', 's3', 's4'],
  markers: [
    { marker_id: 'm0', pos_bp: 10, missingness: 0 },
  ],
  dosage: [
    [-1, -1, 1, 2],    // n=2 valid, variance non-zero
  ],
};
const rNA = selectTopMarkers(chunkNA, { start_bp: 0, end_bp: 50 }, 10);
check('NA (-1) skipped: marker still selected',
      rNA.selected_indices[0] === 0);

// =====================================================================
group('selectTopMarkers — cap');

const chunkBig = {
  samples: ['s1', 's2'],
  markers: Array.from({ length: 20 }, (_, i) => ({
    marker_id: 'm' + i, pos_bp: i * 10, missingness: 0,
    diagnostic_score: i / 20,
  })),
  dosage: Array.from({ length: 20 }, (_, i) => [i, 19 - i]),
};
const rCap = selectTopMarkers(chunkBig, { start_bp: 0, end_bp: 1000 }, 5);
check('cap N=5 honoured',            rCap.selected_indices.length === 5);

// HARD_CAP enforced
const rHard = selectTopMarkers(chunkBig, { start_bp: 0, end_bp: 1000 }, 999);
check('HARD_CAP enforced',           rHard.selected_indices.length <= 500);

// Cap = 0 → coerced to 1
const rZero = selectTopMarkers(chunkBig, { start_bp: 0, end_bp: 1000 }, 0);
check('capN=0 coerced to 1',         rZero.selected_indices.length === 1);

// =====================================================================
group('orderSamplesByGroupAndPC1');

const groups = ['HOMO_1', 'HET', 'HOMO_2', 'HOMO_2', 'HET', 'HOMO_1'];
const pc1s   = [1.0,       0.0,    2.0,      1.5,      -0.5,   0.5];
const groupOf = i => groups[i];
const pc1Of   = i => pc1s[i];
const order = orderSamplesByGroupAndPC1(6, groupOf, pc1Of,
  ['HOMO_1', 'HET', 'HOMO_2']);
check('first 2 are HOMO_1',
      groups[order[0]] === 'HOMO_1' && groups[order[1]] === 'HOMO_1');
check('HOMO_1 ordered by PC1 asc',
      pc1s[order[0]] < pc1s[order[1]]);
check('middle 2 are HET',
      groups[order[2]] === 'HET' && groups[order[3]] === 'HET');
check('HET ordered by PC1 asc',
      pc1s[order[2]] < pc1s[order[3]]);
check('last 2 are HOMO_2',
      groups[order[4]] === 'HOMO_2' && groups[order[5]] === 'HOMO_2');

// Unknown group → goes to end
const orderWithUnknown = orderSamplesByGroupAndPC1(3,
  i => (['HOMO_1', 'UNKNOWN', 'HOMO_2'][i]),
  i => 0,
  ['HOMO_1', 'HOMO_2']);
check('unknown group placed last',
      orderWithUnknown[2] === 1);

// Non-finite PC1 sorts as 0 inside a group
const orderNanPC1 = orderSamplesByGroupAndPC1(3,
  () => 'G',
  i => [NaN, -1, 1][i],
  ['G']);
check('NaN PC1 placed at value 0 (between -1 and 1)',
      orderNanPC1[0] === 1 && orderNanPC1[1] === 0 && orderNanPC1[2] === 2);

// Zero samples → empty
check('nSamples=0 → []',
      orderSamplesByGroupAndPC1(0, () => null, () => 0, []).length === 0);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
