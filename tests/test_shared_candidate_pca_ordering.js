// tests/test_shared_candidate_pca_ordering.js

import {
  argsort,
  groupedArgsort,
  meanDosagePerSample,
  computeSampleOrder,
} from '../atlases/inversion/shared/candidate_pca_ordering.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('argsort');
check('basic ascending',
      JSON.stringify(argsort([0.5, 0.1, 0.3])) === JSON.stringify([1, 2, 0]));
check('already sorted',
      JSON.stringify(argsort([0, 1, 2])) === JSON.stringify([0, 1, 2]));
check('reverse sorted',
      JSON.stringify(argsort([2, 1, 0])) === JSON.stringify([2, 1, 0]));
{
  // With duplicates, JS Array.sort is stable for equal keys (ES2019+).
  // For [1, 0, 1, 0]: the two 0s (indices 1, 3) come first in input order,
  // then the two 1s (indices 0, 2).
  const r = argsort([1, 0, 1, 0]);
  check('with duplicates: stable for equal keys',
        JSON.stringify(r) === JSON.stringify([1, 3, 0, 2]));
}
check('NaN appended at end',
      JSON.stringify(argsort([1, NaN, 0])) === JSON.stringify([2, 0, 1]));
check('Infinity is non-finite → end',
      JSON.stringify(argsort([1, Infinity, 0])) === JSON.stringify([2, 0, 1]));
check('Float32Array input',
      JSON.stringify(argsort(Float32Array.from([0.5, 0.1, 0.3]))) === JSON.stringify([1, 2, 0]));
check('empty input → []',                      argsort([]).length === 0);
check('null input → []',                       argsort(null).length === 0);
check('undefined input → []',                  argsort(undefined).length === 0);

// =====================================================================
group('groupedArgsort');
check('basic groups: 1,0,1,0,2 → 1,3,0,2,4',
      JSON.stringify(groupedArgsort([1, 0, 1, 0, 2])) === JSON.stringify([1, 3, 0, 2, 4]));
check('preserves input order within group',
      JSON.stringify(groupedArgsort([1, 1, 0, 0])) === JSON.stringify([2, 3, 0, 1]));
check('null labels appended',
      JSON.stringify(groupedArgsort([0, null, 0, null])) === JSON.stringify([0, 2, 1, 3]));
check('negative labels appended (unclustered)',
      JSON.stringify(groupedArgsort([0, -1, 0])) === JSON.stringify([0, 2, 1]));
check('Int8Array input',
      JSON.stringify(groupedArgsort(Int8Array.from([1, 0, 1, 0]))) === JSON.stringify([1, 3, 0, 2]));
check('empty input → []',                      groupedArgsort([]).length === 0);
check('null input → []',                       groupedArgsort(null).length === 0);
check('all unclustered → identity order',
      JSON.stringify(groupedArgsort([-1, -1, -1])) === JSON.stringify([0, 1, 2]));

// =====================================================================
group('meanDosagePerSample');
{
  // 4 markers × 3 samples
  const markers = [
    { dosage_centered: new Float32Array([1, 2, 3]) },
    { dosage_centered: new Float32Array([2, 4, 6]) },
    { dosage_centered: new Float32Array([3, 6, 9]) },
    { dosage_centered: new Float32Array([4, 8, 12]) },
  ];
  const r = meanDosagePerSample(markers, 3);
  check('returns Float32Array(3)',              r instanceof Float32Array && r.length === 3);
  check('sample 0 mean ≈ 2.5',                  Math.abs(r[0] - 2.5) < 1e-5);
  check('sample 1 mean ≈ 5.0',                  Math.abs(r[1] - 5.0) < 1e-5);
  check('sample 2 mean ≈ 7.5',                  Math.abs(r[2] - 7.5) < 1e-5);
}
{
  // NaN markers ignored
  const markers = [
    { dosage_centered: new Float32Array([1, NaN, 3]) },
    { dosage_centered: new Float32Array([2, 4, 6]) },
  ];
  const r = meanDosagePerSample(markers, 3);
  check('sample 0 mean (no NaN)',               Math.abs(r[0] - 1.5) < 1e-5);
  check('sample 1 mean (NaN skipped)',          Math.abs(r[1] - 4) < 1e-5);
  check('sample 2 mean',                        Math.abs(r[2] - 4.5) < 1e-5);
}
{
  // All-NaN sample → NaN
  const markers = [
    { dosage_centered: new Float32Array([NaN, 4]) },
    { dosage_centered: new Float32Array([NaN, 6]) },
  ];
  const r = meanDosagePerSample(markers, 2);
  check('sample with no finite marker → NaN',   Number.isNaN(r[0]));
  check('other sample mean preserved',          Math.abs(r[1] - 5) < 1e-5);
}
{
  // Empty markers → all NaN
  const r = meanDosagePerSample([], 3);
  check('empty markers → all NaN (sample 0)',   Number.isNaN(r[0]));
  check('empty markers → all NaN (sample 1)',   Number.isNaN(r[1]));
}
{
  // Wrong length dosage_centered → skipped
  const markers = [
    { dosage_centered: new Float32Array([1]) },       // wrong length
    { dosage_centered: new Float32Array([2, 4, 6]) },
  ];
  const r = meanDosagePerSample(markers, 3);
  check('wrong-length marker skipped (sample 0)', Math.abs(r[0] - 2) < 1e-5);
}

// =====================================================================
// Build a state.candidatePCAMode + state.data fixture for computeSampleOrder
// =====================================================================
function fixtureState({ row_order, n_samples = 4, cur = 0 }) {
  return {
    cur,
    data: {
      n_samples,
      windows: [{
        pc1: [0.5, 0.1, 0.3, 0.2],
        cluster_labels: [1, 0, 1, 0],
      }],
    },
    candidatePCAMode: {
      row_order,
      loaded_pca: {
        bi_baseline_unweighted_bi_baseline: {
          windows: [{ pc1: [0.4, 0.9, 0.1, 0.6] }],
        },
      },
      manual_order: [3, 2, 1, 0],
    },
  };
}

// =====================================================================
group('computeSampleOrder');
{
  const s = fixtureState({ row_order: 'pc1_anchor' });
  const r = computeSampleOrder(s);
  // anchor pc1 = [0.4, 0.9, 0.1, 0.6] → argsort = [2, 0, 3, 1]
  check('pc1_anchor: uses anchor PC1',          JSON.stringify(r) === JSON.stringify([2, 0, 3, 1]));
}
{
  const s = fixtureState({ row_order: 'pc1_view' });
  const r = computeSampleOrder(s);
  // view pc1 = [0.5, 0.1, 0.3, 0.2] → argsort = [1, 3, 2, 0]
  check('pc1_view: uses view PC1',              JSON.stringify(r) === JSON.stringify([1, 3, 2, 0]));
}
{
  const s = fixtureState({ row_order: 'cluster' });
  const r = computeSampleOrder(s);
  // cluster_labels = [1, 0, 1, 0] → groupedArgsort = [1, 3, 0, 2]
  check('cluster: uses groupedArgsort',         JSON.stringify(r) === JSON.stringify([1, 3, 0, 2]));
}
{
  const s = fixtureState({ row_order: 'manual' });
  const r = computeSampleOrder(s);
  check('manual: copies manual_order',          JSON.stringify(r) === JSON.stringify([3, 2, 1, 0]));
  check('manual: returns a copy (not same ref)', r !== s.candidatePCAMode.manual_order);
}
{
  // manual_order wrong length → identity fallback
  const s = fixtureState({ row_order: 'manual' });
  s.candidatePCAMode.manual_order = [0, 1];   // wrong length
  const r = computeSampleOrder(s);
  check('manual: bad length → identity',         JSON.stringify(r) === JSON.stringify([0, 1, 2, 3]));
}
{
  const s = fixtureState({ row_order: 'mean_dosage' });
  const markers = [
    { dosage_centered: new Float32Array([1, 2, 0, 3]) },
    { dosage_centered: new Float32Array([1, 2, 0, 3]) },
  ];
  const r = computeSampleOrder(s, { heatmapMarkers: markers });
  // means: [1, 2, 0, 3] → argsort = [2, 0, 1, 3]
  check('mean_dosage: uses marker means',       JSON.stringify(r) === JSON.stringify([2, 0, 1, 3]));
}
{
  const s = fixtureState({ row_order: 'mean_dosage' });
  const r = computeSampleOrder(s);  // no markers passed
  check('mean_dosage no markers → identity',    JSON.stringify(r) === JSON.stringify([0, 1, 2, 3]));
}
{
  // No anchor JSON loaded → identity fallback
  const s = fixtureState({ row_order: 'pc1_anchor' });
  s.candidatePCAMode.loaded_pca = {};
  const r = computeSampleOrder(s);
  check('pc1_anchor missing anchor → identity', JSON.stringify(r) === JSON.stringify([0, 1, 2, 3]));
}
{
  // No view data → identity
  const s = fixtureState({ row_order: 'pc1_view' });
  s.data.windows[0] = {};
  const r = computeSampleOrder(s);
  check('pc1_view missing PC1 → identity',      JSON.stringify(r) === JSON.stringify([0, 1, 2, 3]));
}
{
  // No state.candidatePCAMode → []
  const r = computeSampleOrder({ data: { n_samples: 3 } });
  check('no candidatePCAMode → []',             r.length === 0);
}
{
  // opts.n_samples override
  const s = fixtureState({ row_order: 'pc1_anchor', n_samples: 4 });
  const r = computeSampleOrder(s, { n_samples: 4 });
  check('opts.n_samples override works',        r.length === 4);
}
{
  // Unknown row_order → identity
  const s = fixtureState({ row_order: 'whatever' });
  const r = computeSampleOrder(s);
  check('unknown row_order → identity',         JSON.stringify(r) === JSON.stringify([0, 1, 2, 3]));
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
