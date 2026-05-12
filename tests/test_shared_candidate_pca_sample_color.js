// tests/test_shared_candidate_pca_sample_color.js
//
// Unit coverage for shared/candidate_pca_sample_color.js — HANDOFF-2
// Component 7 color resolver shared between drawPCA + drawHeatmap.

import {
  DEFAULT_CLUSTER_PALETTE,
  DEFAULT_NA_COLOR,
  DIVERGING_LOW,
  DIVERGING_MID,
  DIVERGING_HIGH,
  divergingColor,
  clusterColor,
  dosageSummary,
  resolveCandidatePCAColor,
  resolveCandidatePCAColorsAll,
} from '../atlases/inversion/shared/candidate_pca_sample_color.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('palette constants');

check('cluster palette frozen',        Object.isFrozen(DEFAULT_CLUSTER_PALETTE));
check('cluster palette has 10 colors', DEFAULT_CLUSTER_PALETTE.length === 10);
check('DEFAULT_NA_COLOR defined',      typeof DEFAULT_NA_COLOR === 'string');
check('DIVERGING_LOW/MID/HIGH defined',
      DIVERGING_LOW.length === 7 && DIVERGING_MID.length === 7
      && DIVERGING_HIGH.length === 7);

// =====================================================================
group('clusterColor');

check('cluster 0 → palette[0]',         clusterColor(0) === DEFAULT_CLUSTER_PALETTE[0]);
check('cluster 9 → palette[9]',         clusterColor(9) === DEFAULT_CLUSTER_PALETTE[9]);
check('cluster 12 → palette[2] (wrap)', clusterColor(12) === DEFAULT_CLUSTER_PALETTE[2]);
check('cluster -1 → NA',                clusterColor(-1) === DEFAULT_NA_COLOR);
check('cluster null → NA',              clusterColor(null) === DEFAULT_NA_COLOR);
check('cluster NaN → NA',               clusterColor(NaN) === DEFAULT_NA_COLOR);
check('custom palette honoured',
      clusterColor(0, ['#ff0000', '#00ff00']) === '#ff0000');

// =====================================================================
group('divergingColor');

check('v at lo → DIVERGING_LOW',        divergingColor(-1, -1, 1) === DIVERGING_LOW);
check('v at hi → DIVERGING_HIGH',       divergingColor(1, -1, 1) === DIVERGING_HIGH);
check('v at midpoint → DIVERGING_MID',  divergingColor(0, -1, 1) === DIVERGING_MID);
check('v < lo clamped',                 divergingColor(-99, -1, 1) === DIVERGING_LOW);
check('v > hi clamped',                 divergingColor(99, -1, 1) === DIVERGING_HIGH);
check('NaN → NA',                       divergingColor(NaN, -1, 1) === DEFAULT_NA_COLOR);
check('lo == hi → NA',                  divergingColor(0, 1, 1) === DEFAULT_NA_COLOR);
check('lo > hi → NA',                   divergingColor(0, 2, 1) === DEFAULT_NA_COLOR);
// Interpolation returns valid #rrggbb
const interp = divergingColor(-0.5, -1, 1);
check('interpolated returns #rrggbb',
      /^#[0-9a-f]{6}$/.test(interp));

// =====================================================================
group('dosageSummary — caching');

const markers = [
  { dosage_centered: [0.1, 0.5, 0.9] },
  { dosage_centered: [0.2, 0.4, 0.8] },
  { dosage_centered: [0.0, 0.6, 1.0] },
];

{
  const state = { cur: 0, data: { n_samples: 3 } };
  const m1 = dosageSummary(state, { heatmapMarkers: markers }, 'mean');
  const m2 = dosageSummary(state, { heatmapMarkers: markers }, 'mean');
  check('mean: returns Float32Array',     m1 instanceof Float32Array);
  check('mean: 3 entries',                m1.length === 3);
  check('mean: cached on second call',    m1 === m2);
  // sample 0 mean ≈ 0.1, sample 1 ≈ 0.5, sample 2 ≈ 0.9
  check('mean: sample 0 ≈ 0.1',           Math.abs(m1[0] - 0.1) < 0.01);
  check('mean: sample 2 ≈ 0.9',           Math.abs(m1[2] - 0.9) < 0.01);

  const med = dosageSummary(state, { heatmapMarkers: markers }, 'median');
  check('median: separate cache entry',    med !== m1);
  check('median: sample 0 ≈ 0.1',          Math.abs(med[0] - 0.1) < 0.01);
}
{
  // No markers → null
  const state = { cur: 0, data: { n_samples: 3 } };
  check('no markers → null',
        dosageSummary(state, {}, 'mean') === null);
  check('null state → null',
        dosageSummary(null, { heatmapMarkers: markers }, 'mean') === null);
}
{
  // Different markers array → cache invalidated
  const state = { cur: 0, data: { n_samples: 3 } };
  const m1 = dosageSummary(state, { heatmapMarkers: markers }, 'mean');
  const otherMarkers = [
    { dosage_centered: [9, 9, 9] },
    { dosage_centered: [9, 9, 9] },
  ];
  const m2 = dosageSummary(state, { heatmapMarkers: otherMarkers }, 'mean');
  check('different markers ref → fresh compute',
        m1 !== m2 && Math.abs(m2[0] - 9) < 0.001);
}

// =====================================================================
group('resolveCandidatePCAColor — cluster mode');

{
  const state = {
    cur: 0,
    candidatePCAMode: { sample_color_mode: 'cluster' },
    data: {
      n_samples: 3,
      windows: [
        { cluster_labels: [0, 1, 2] },
      ],
    },
  };
  check('cluster 0 → palette[0]',
        resolveCandidatePCAColor(state, 0) === DEFAULT_CLUSTER_PALETTE[0]);
  check('cluster 1 → palette[1]',
        resolveCandidatePCAColor(state, 1) === DEFAULT_CLUSTER_PALETTE[1]);
}
{
  // locked_labels precedence
  const state = {
    cur: 0,
    lockedLabels: [9, 5, 3],
    candidatePCAMode: { sample_color_mode: 'cluster' },
    data: {
      n_samples: 3,
      windows: [
        { cluster_labels: [0, 1, 2] },
      ],
    },
  };
  check('lockedLabels override cluster_labels',
        resolveCandidatePCAColor(state, 0) === DEFAULT_CLUSTER_PALETTE[9]);
}

// =====================================================================
group('resolveCandidatePCAColor — mean/median dosage mode');

{
  const state = {
    cur: 0,
    candidatePCAMode: { sample_color_mode: 'mean_dosage_window' },
    data: { n_samples: 3 },
  };
  const opts = {
    heatmapMarkers: [
      { dosage_centered: [-1, 0, 1] },
      { dosage_centered: [-1, 0, 1] },
    ],
    dosageRange: [-1, 1],
  };
  check('mean dosage: sample 0 (-1) → DIVERGING_LOW',
        resolveCandidatePCAColor(state, 0, opts) === DIVERGING_LOW);
  check('mean dosage: sample 2 (1) → DIVERGING_HIGH',
        resolveCandidatePCAColor(state, 2, opts) === DIVERGING_HIGH);
  check('mean dosage: sample 1 (0 midpoint) → DIVERGING_MID',
        resolveCandidatePCAColor(state, 1, opts) === DIVERGING_MID);
  // Out-of-range still maps to endpoints
  const optsCheck = Object.assign({}, opts, { dosageRange: [-0.5, 0.5] });
  check('mean dosage: out-of-range -1 → DIVERGING_LOW',
        resolveCandidatePCAColor(
          { cur: 0, candidatePCAMode: { sample_color_mode: 'mean_dosage_window' },
            data: { n_samples: 3 } },
          0, optsCheck) === DIVERGING_LOW);
}
{
  // Median mode
  const state = {
    cur: 0,
    candidatePCAMode: { sample_color_mode: 'median_dosage_window' },
    data: { n_samples: 3 },
  };
  const opts = {
    heatmapMarkers: [
      { dosage_centered: [-1, 0, 1] },
      { dosage_centered: [-1, 0, 1] },
      { dosage_centered: [-1, 0, 1] },
    ],
    dosageRange: [-1, 1],
  };
  check('median dosage: sample 0 → DIVERGING_LOW',
        resolveCandidatePCAColor(state, 0, opts) === DIVERGING_LOW);
  check('median dosage: sample 2 → DIVERGING_HIGH',
        resolveCandidatePCAColor(state, 2, opts) === DIVERGING_HIGH);
}
{
  // No markers → NA
  const state = {
    cur: 0,
    candidatePCAMode: { sample_color_mode: 'mean_dosage_window' },
    data: { n_samples: 3 },
  };
  check('no markers → NA',
        resolveCandidatePCAColor(state, 0, {}) === DEFAULT_NA_COLOR);
}

// =====================================================================
group('resolveCandidatePCAColor — pc1/pc2 score mode');

{
  const state = {
    cur: 0,
    candidatePCAMode: { sample_color_mode: 'pc1_score' },
    data: {
      n_samples: 3,
      windows: [{ pc1: [-3, 0, 3], pc2: [-1, 0, 1] }],
    },
  };
  check('pc1: -3 → DIVERGING_LOW',
        resolveCandidatePCAColor(state, 0, { pcRange: [-3, 3] }) === DIVERGING_LOW);
  check('pc1: 0 → DIVERGING_MID',
        resolveCandidatePCAColor(state, 1, { pcRange: [-3, 3] }) === DIVERGING_MID);
  check('pc1: 3 → DIVERGING_HIGH',
        resolveCandidatePCAColor(state, 2, { pcRange: [-3, 3] }) === DIVERGING_HIGH);
}
{
  const state = {
    cur: 0,
    candidatePCAMode: { sample_color_mode: 'pc2_score' },
    data: {
      n_samples: 3,
      windows: [{ pc1: [0, 0, 0], pc2: [-1, 0, 1] }],
    },
  };
  check('pc2 mode reads pc2',
        resolveCandidatePCAColor(state, 0, { pcRange: [-1, 1] }) === DIVERGING_LOW);
}
{
  // No window → NA
  const state = {
    cur: 0,
    candidatePCAMode: { sample_color_mode: 'pc1_score' },
    data: { n_samples: 3, windows: [] },
  };
  check('no window → NA',
        resolveCandidatePCAColor(state, 0) === DEFAULT_NA_COLOR);
}

// =====================================================================
group('resolveCandidatePCAColor — tracked_group mode');

{
  const state = {
    cur: 0,
    candidatePCAMode: { sample_color_mode: 'tracked_group' },
    trackedColors: { 0: '#ff0000', 2: '#00ff00' },
    data: { n_samples: 3 },
  };
  check('tracked sample 0 → red',
        resolveCandidatePCAColor(state, 0) === '#ff0000');
  check('tracked sample 2 → green',
        resolveCandidatePCAColor(state, 2) === '#00ff00');
  check('untracked sample → NA',
        resolveCandidatePCAColor(state, 1) === DEFAULT_NA_COLOR);
}
{
  // opts.trackedColors override
  const state = {
    cur: 0,
    candidatePCAMode: { sample_color_mode: 'tracked_group' },
    data: { n_samples: 1 },
  };
  check('opts.trackedColors override',
        resolveCandidatePCAColor(state, 0, { trackedColors: { 0: '#abcdef' } })
          === '#abcdef');
}

// =====================================================================
group('resolveCandidatePCAColor — opts.mode override');

{
  const state = {
    cur: 0,
    candidatePCAMode: { sample_color_mode: 'cluster' },
    data: {
      n_samples: 3,
      windows: [{ cluster_labels: [0, 1, 2] }],
    },
  };
  // override to tracked but no tracked colors → NA
  check('opts.mode override = tracked_group',
        resolveCandidatePCAColor(state, 0, { mode: 'tracked_group' })
          === DEFAULT_NA_COLOR);
}

// =====================================================================
group('resolveCandidatePCAColor — null / unknown');

check('null state → NA',
      resolveCandidatePCAColor(null, 0) === DEFAULT_NA_COLOR);
check('unknown mode → NA',
      resolveCandidatePCAColor(
        { candidatePCAMode: { sample_color_mode: 'whatever' } }, 0)
        === DEFAULT_NA_COLOR);

// =====================================================================
group('resolveCandidatePCAColorsAll');

{
  const state = {
    cur: 0,
    candidatePCAMode: { sample_color_mode: 'cluster' },
    data: {
      n_samples: 3,
      windows: [{ cluster_labels: [0, 1, 2] }],
    },
  };
  const all = resolveCandidatePCAColorsAll(state, 3);
  check('all returns array of 3',         all.length === 3);
  check('all[0] = palette[0]',            all[0] === DEFAULT_CLUSTER_PALETTE[0]);
  check('all[2] = palette[2]',            all[2] === DEFAULT_CLUSTER_PALETTE[2]);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
