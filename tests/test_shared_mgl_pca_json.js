// tests/test_shared_mgl_pca_json.js
//
// Unit coverage for shared/mgl_pca_json.js — validator + accessors
// for the SPEC_0 §8 producer-PCA JSON shape.

import {
  MGL_PCA_SCHEMA_VERSION,
  MGL_PCA_VIEWS,
  MGL_PCA_ANCHOR_MODES,
  isMglPcaJson,
  fromPrecomputedJson,
  getWindowAt,
  getWindowAtBp,
  pcTrajectoryForSample,
  sampleIndexOf,
  summariseLambdaRatios,
  pcaFilenameFor,
} from '../atlases/cross-species/shared/mgl_pca_json.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab');

check('schema_version = 1',          MGL_PCA_SCHEMA_VERSION === 1);
check('4 views defined',             MGL_PCA_VIEWS.length === 4);
check('all_pairs in views',          MGL_PCA_VIEWS.includes('all_pairs'));
check('4 anchor modes',              MGL_PCA_ANCHOR_MODES.length === 4);
check('both mode listed',            MGL_PCA_ANCHOR_MODES.includes('both'));

// =====================================================================
group('isMglPcaJson — valid payload');

const goodJson = {
  candidate_id: 'LG28_15.115_18.005',
  chrom: 'C_gar_LG28',
  interval_start: 15115000,
  interval_end:   18005000,
  view: {
    name: 'all_pairs',
    weighted: true,
    anchor_mode: 'bi_baseline',
  },
  n_samples: 3,
  samples: ['S0001', 'S0002', 'S0003'],
  window_def: { kind: 'bp_span', size_bp: 50000, step_bp: 50000 },
  n_windows: 2,
  windows: [
    {
      idx: 0, start: 15115000, end: 15165000,
      lam1: 0.84, lam2: 0.05,
      pc1: [0.1, -0.2, 0.1],
      pc2: [0.0, 0.1, -0.1],
    },
    {
      idx: 1, start: 15165000, end: 15215000,
      lam1: 0.79, lam2: 0.06,
      pc1: [0.12, -0.25, 0.13],
      pc2: [0.01, 0.15, -0.16],
    },
  ],
};
check('valid payload → ok',          isMglPcaJson(goodJson).ok);
check('valid payload: empty errors', isMglPcaJson(goodJson).errors.length === 0);

// =====================================================================
group('isMglPcaJson — failure modes');

check('null → !ok',                  !isMglPcaJson(null).ok);
check('missing field → !ok',
      !isMglPcaJson({ candidate_id: 'X' }).ok);
check('wrong view name flagged',
      !isMglPcaJson({ ...goodJson, view: { ...goodJson.view, name: 'fake' } }).ok);
check('wrong anchor_mode flagged',
      !isMglPcaJson({ ...goodJson, view: { ...goodJson.view, anchor_mode: 'fake' } }).ok);

// samples.length != n_samples
const bad_samples = { ...goodJson, samples: ['S1', 'S2'] };
const v_bs = isMglPcaJson(bad_samples);
check('samples length mismatch flagged',
      !v_bs.ok && v_bs.errors.some(e => e.includes('samples.length')));

// windows.length != n_windows
const bad_n_windows = { ...goodJson, n_windows: 99 };
const v_bw = isMglPcaJson(bad_n_windows);
check('n_windows mismatch flagged',
      !v_bw.ok && v_bw.errors.some(e => e.includes('windows.length')));

// per-window pc1 length mismatch
const bad_pc_len = JSON.parse(JSON.stringify(goodJson));
bad_pc_len.windows[0].pc1 = [0.1, -0.2];
const v_pl = isMglPcaJson(bad_pc_len);
check('per-window pc1 length mismatch flagged',
      !v_pl.ok && v_pl.errors.some(e => e.includes('pc1.length')));

// =====================================================================
group('fromPrecomputedJson');

const r = fromPrecomputedJson(goodJson);
check('returns non-null',            r !== null);
check('_source = precomputed_json',  r._source === 'precomputed_json');
check('windows cloned, not aliased',
      r.windows[0] !== goodJson.windows[0]);
check('windows are deep-copied (pc1 arrays)',
      r.windows[0].pc1 !== goodJson.windows[0].pc1
   && r.windows[0].pc1[0] === goodJson.windows[0].pc1[0]);

check('bad payload → null',          fromPrecomputedJson(null) === null);
check('missing-fields payload → null',
      fromPrecomputedJson({ candidate_id: 'X' }) === null);

// =====================================================================
group('getWindowAt + getWindowAtBp');

check('getWindowAt(0)',              getWindowAt(r, 0).idx === 0);
check('getWindowAt(1)',              getWindowAt(r, 1).idx === 1);
check('getWindowAt clamps below 0',  getWindowAt(r, -5).idx === 0);
check('getWindowAt clamps above',    getWindowAt(r, 999).idx === 1);
check('getWindowAt on empty → null',
      getWindowAt({windows: []}, 0) === null);

check('getWindowAtBp finds the right window',
      getWindowAtBp(r, 15120000).idx === 0);
check('getWindowAtBp out-of-range → null',
      getWindowAtBp(r, 99999999) === null);

// =====================================================================
group('pcTrajectoryForSample');

const traj = pcTrajectoryForSample(r, 0);
check('traj has 2 entries',          traj.length === 2);
check('traj[0].pc1 = 0.1',           Math.abs(traj[0].pc1 - 0.1) < 1e-9);
check('traj[1].pc2 = 0.01',          Math.abs(traj[1].pc2 - 0.01) < 1e-9);
check('out-of-range sample → null',  pcTrajectoryForSample(r, 999) === null);

// Verify _self anchor variant
const jsonBoth = JSON.parse(JSON.stringify(goodJson));
jsonBoth.view.anchor_mode = 'both';
for (const w of jsonBoth.windows) {
  w.pc1_self = w.pc1.map(v => v * 2);
  w.pc2_self = w.pc2.map(v => v * 2);
  w.lam1_self = w.lam1 * 1.5;
  w.lam2_self = w.lam2 * 1.5;
}
const rBoth = fromPrecomputedJson(jsonBoth);
const trajSelf = pcTrajectoryForSample(rBoth, 0, { anchor: 'view_self' });
check('view_self traj[0].pc1 = 0.2 (2× base)',
      Math.abs(trajSelf[0].pc1 - 0.2) < 1e-9);

// =====================================================================
group('sampleIndexOf');

check('S0002 → 1',                   sampleIndexOf(r, 'S0002') === 1);
check('unknown → -1',                sampleIndexOf(r, 'fake') === -1);

// =====================================================================
group('summariseLambdaRatios');

const lambdas = summariseLambdaRatios(r);
check('n_windows_with_data = 2',     lambdas.n_windows_with_data === 2);
check('mean_lam1 ≈ 0.815',           Math.abs(lambdas.mean_lam1 - 0.815) < 1e-3);
check('max_ratio = lam1/lam2 max',
      Math.abs(lambdas.max_ratio - (0.84 / 0.05)) < 1e-3);

// =====================================================================
group('pcaFilenameFor');

check('filename pattern correct',
      pcaFilenameFor('all_pairs', 'weighted', 'bi_baseline')
   === 'pca_all_pairs_weighted_bi_baseline.json');

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
