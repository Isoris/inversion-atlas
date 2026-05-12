// tests/test_shared_xpehh_per_window.js
//
// Unit coverage for shared/xpehh_per_window.js — schema validator +
// LS lifecycle + window accessors + outlier classifier + header +
// track alignment.

import {
  XPEHH_PER_WINDOW_TOOL,
  XPEHH_PER_WINDOW_SCHEMA_VERSION,
  XPEHH_PER_WINDOW_LS_KEY,
  XPEHH_OUTLIER_Z_DEFAULT,
  XPEHH_OUTLIER_PCT_DEFAULT,
  isXpehhPerWindowJSON,
  storeXpehhPerWindow,
  persistXpehhPerWindow,
  restoreXpehhPerWindow,
  clearXpehhPerWindow,
  xpehhWindowsForChrom,
  xpehhValueAtPosition,
  xpehhValuesInRange,
  xpehhOutliers,
  xpehhTrackHeader,
  xpehhAlignsWithTrack,
} from '../atlases/inversion/shared/xpehh_per_window.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('constants');

check('TOOL = xpehh_per_window_v1',
      XPEHH_PER_WINDOW_TOOL === 'xpehh_per_window_v1');
check('SCHEMA_VERSION = 1',         XPEHH_PER_WINDOW_SCHEMA_VERSION === 1);
check('LS_KEY namespaced',
      typeof XPEHH_PER_WINDOW_LS_KEY === 'string'
      && XPEHH_PER_WINDOW_LS_KEY.length > 0);
check('OUTLIER_Z_DEFAULT = 2.0',    XPEHH_OUTLIER_Z_DEFAULT === 2.0);
check('OUTLIER_PCT_DEFAULT = 0.01', XPEHH_OUTLIER_PCT_DEFAULT === 0.01);

// =====================================================================
// Fixture
// =====================================================================
function fixture() {
  return {
    schema_version: 1,
    generated_at: '2026-05-13',
    test_cohort_id: 'Gar_226_HOM_INV_at_LG28_inv',
    ref_cohort_id:  'Gar_226_HOM_REF_at_LG28_inv',
    n_test: 60,
    n_ref:  60,
    tool: 'selscan v2.0.x',
    tool_args: '--xpehh --vcf phased_226.vcf.gz',
    windows: {
      'LG28': {
        window_start_bp: [  100_000, 200_000, 300_000, 400_000, 500_000 ],
        window_end_bp:   [  199_999, 299_999, 399_999, 499_999, 599_999 ],
        xpehh_mean:      [    0.1,     0.5,     2.5,    -0.3,     0.0   ],
        xpehh_max_abs:   [    0.3,     0.8,     3.0,     0.6,     0.2   ],
        n_snps:          [   25,      30,      28,      31,      24     ],
        norm_xpehh_mean: [    0.3,     1.0,     3.0,    -2.2,     0.1   ],
      },
      'LG29': {
        window_start_bp: [ 1_000_000, 1_100_000 ],
        window_end_bp:   [ 1_099_999, 1_199_999 ],
        xpehh_mean:      [    0.05,     0.1     ],
        xpehh_max_abs:   [    0.1,      0.3     ],
        n_snps:          [   20,       22       ],
        norm_xpehh_mean: [    0.1,      0.4     ],
      },
    },
  };
}

// =====================================================================
group('isXpehhPerWindowJSON');

check('valid → ok',                  isXpehhPerWindowJSON(fixture()).ok === true);
check('null → ok=false',             isXpehhPerWindowJSON(null).ok === false);
check('wrong schema_version → fail',
      isXpehhPerWindowJSON({ ...fixture(), schema_version: 9 }).ok === false);
check('missing test_cohort_id → fail',
      isXpehhPerWindowJSON({ ...fixture(), test_cohort_id: '' }).ok === false);
check('missing n_test → fail',
      isXpehhPerWindowJSON({ ...fixture(), n_test: 'foo' }).ok === false);
check('missing windows → fail',
      isXpehhPerWindowJSON({ ...fixture(), windows: null }).ok === false);
check('empty windows → fail',
      isXpehhPerWindowJSON({ ...fixture(), windows: {} }).ok === false);
{
  const bad = fixture();
  bad.windows.LG28.window_end_bp = [1, 2];   // length mismatch with starts
  check('window start/end length mismatch → fail',
        isXpehhPerWindowJSON(bad).ok === false);
}
check('reasons populated on failure',
      Array.isArray(isXpehhPerWindowJSON(null).reasons));

// =====================================================================
group('storeXpehhPerWindow');

{
  const state = {};
  check('store returns true on valid',
        storeXpehhPerWindow(state, fixture()) === true);
  check('state.xpehhPerWindow populated',
        state.xpehhPerWindow && state.xpehhPerWindow.windows
        && Object.keys(state.xpehhPerWindow.windows).length === 2);
  check('metadata propagated',
        state.xpehhPerWindow.test_cohort_id === 'Gar_226_HOM_INV_at_LG28_inv'
        && state.xpehhPerWindow.n_test === 60);
  // Deep clone — mutating fixture must not change state
  const f = fixture();
  storeXpehhPerWindow(state, f);
  f.windows.LG28.xpehh_mean[0] = 9999;
  check('deep-cloned (mutation immune)',
        state.xpehhPerWindow.windows.LG28.xpehh_mean[0] !== 9999);
}
check('store invalid → false',
      storeXpehhPerWindow({}, null) === false);
check('store with null state → false',
      storeXpehhPerWindow(null, fixture()) === false);

// =====================================================================
group('clearXpehhPerWindow');

{
  const state = {};
  storeXpehhPerWindow(state, fixture());
  clearXpehhPerWindow(state);
  check('after clear: state.xpehhPerWindow === null',
        state.xpehhPerWindow === null);
}
// null state no-throw
let safeClear = true;
try { clearXpehhPerWindow(null); } catch (_) { safeClear = false; }
check('clear(null) safe',            safeClear);

// =====================================================================
group('xpehhWindowsForChrom');

{
  const state = {};
  storeXpehhPerWindow(state, fixture());
  const w = xpehhWindowsForChrom(state, 'LG28');
  check('LG28 windows returned',       w && w.window_start_bp.length === 5);
  check('LG29 windows returned',       xpehhWindowsForChrom(state, 'LG29')
                                         .window_start_bp.length === 2);
  check('unknown chrom → null',        xpehhWindowsForChrom(state, 'LG99') === null);
  check('null state → null',           xpehhWindowsForChrom(null, 'LG28') === null);
}

// =====================================================================
group('xpehhValueAtPosition');

{
  const state = {};
  storeXpehhPerWindow(state, fixture());
  // pos in window [300_000, 399_999] → idx 2
  const v = xpehhValueAtPosition(state, 'LG28', 350_000);
  check('mid-window: returns record',  v && v.idx === 2);
  check('mid-window: bp range correct',
        v.start_bp === 300_000 && v.end_bp === 399_999);
  check('mid-window: xpehh_mean = 2.5', v.xpehh_mean === 2.5);
  check('mid-window: norm = 3.0',       v.norm_xpehh_mean === 3.0);
  // Boundary: pos = window_start_bp[1]
  const vBound = xpehhValueAtPosition(state, 'LG28', 200_000);
  check('boundary start: idx 1',       vBound && vBound.idx === 1);
  // Gap between LG28 windows: pos 199_999.5 doesn't exist as int but
  // 199_999 is in window 0 end_bp inclusive
  const vEnd = xpehhValueAtPosition(state, 'LG28', 199_999);
  check('window-end inclusive',         vEnd && vEnd.idx === 0);
  // Out-of-range → null
  check('before first window → null',
        xpehhValueAtPosition(state, 'LG28', 50_000) === null);
  check('after last window → null',
        xpehhValueAtPosition(state, 'LG28', 700_000) === null);
  check('unknown chrom → null',
        xpehhValueAtPosition(state, 'LG99', 100_000) === null);
  check('non-finite pos → null',
        xpehhValueAtPosition(state, 'LG28', NaN) === null);
}

// =====================================================================
group('xpehhValuesInRange');

{
  const state = {};
  storeXpehhPerWindow(state, fixture());
  // Midpoints are 149_999.5, 249_999.5, 349_999.5, 449_999.5, 549_999.5.
  // Range [249_000, 450_000] covers midpoints of windows 1, 2, 3.
  const slice = xpehhValuesInRange(state, 'LG28', 249_000, 450_000);
  check('range slice: 3 windows',       slice.window_start_bp.length === 3);
  check('xpehh_mean array length 3',    slice.xpehh_mean.length === 3);
  check('range slice: indices preserved',
        slice.indices[0] === 1 && slice.indices[2] === 3);
  // Empty range
  const empty = xpehhValuesInRange(state, 'LG28', 700_000, 900_000);
  check('out-of-bound range → empty',   empty.window_start_bp.length === 0);
  // Unknown chrom → null
  check('unknown chrom → null',         xpehhValuesInRange(state, 'LG99', 0, 1000) === null);
  // Invalid range → null
  check('NaN range → null',             xpehhValuesInRange(state, 'LG28', NaN, 100) === null);
}

// =====================================================================
group('xpehhOutliers — z-threshold path (norm_xpehh_mean present)');

{
  const state = {};
  storeXpehhPerWindow(state, fixture());
  // LG28 norm: 0.3, 1.0, 3.0, -2.2, 0.1 → |·| ≥ 2.0 → indices 2, 3
  const out = xpehhOutliers(state, 'LG28');
  check('2 outliers',                   out.length === 2);
  check('outlier 0: idx 2, sign +',     out[0].idx === 2 && out[0].sign === 1);
  check('outlier 1: idx 3, sign -',     out[1].idx === 3 && out[1].sign === -1);
  check('outlier values populated',
        out[0].value === 3.0 && out[1].value === -2.2);
  // Custom z_threshold
  const out1 = xpehhOutliers(state, 'LG28', { z_threshold: 0.5 });
  check('z=0.5: more outliers',         out1.length > 2);
  const outHigh = xpehhOutliers(state, 'LG28', { z_threshold: 100 });
  check('z=100: no outliers',           outHigh.length === 0);
}

// =====================================================================
group('xpehhOutliers — top-pct fallback (norm absent)');

{
  const data = fixture();
  // Drop norm column on LG28
  delete data.windows.LG28.norm_xpehh_mean;
  const state = {};
  storeXpehhPerWindow(state, data);
  const out = xpehhOutliers(state, 'LG28', { pct: 0.4 });
  // 5 windows × 0.4 = 2 outliers; sorted by |xpehh_mean| desc
  // values: 0.1, 0.5, 2.5, -0.3, 0.0 → top 2 by abs: 2.5 (idx 2), 0.5 (idx 1)
  check('top-pct: 2 outliers',          out.length === 2);
  check('top-pct: positional order kept',
        out[0].idx < out[1].idx);
  check('top-pct: includes idx 2 (largest |val|)',
        out.some(o => o.idx === 2));
}

// =====================================================================
group('xpehhOutliers — edge cases');

check('null state → []',              xpehhOutliers(null, 'LG28').length === 0);
{
  const state = {};
  storeXpehhPerWindow(state, fixture());
  check('unknown chrom → []',         xpehhOutliers(state, 'LG99').length === 0);
}

// =====================================================================
group('xpehhTrackHeader');

{
  const state = {};
  storeXpehhPerWindow(state, fixture());
  const h = xpehhTrackHeader(state);
  check('contains test cohort',         h.indexOf('HOM_INV') >= 0);
  check('contains ref cohort',          h.indexOf('HOM_REF') >= 0);
  check('contains sample counts',       h.indexOf('60/60') >= 0);
}
check('no layer → null',                xpehhTrackHeader({}) === null);
check('null state → null',              xpehhTrackHeader(null) === null);

// =====================================================================
group('xpehhAlignsWithTrack');

{
  const state = {};
  storeXpehhPerWindow(state, fixture());
  // Exact match
  const ok = xpehhAlignsWithTrack(state, 'LG28', {
    window_start_bp: [100_000, 200_000, 300_000, 400_000, 500_000],
    window_end_bp:   [199_999, 299_999, 399_999, 499_999, 599_999],
  });
  check('exact match: ok=true',         ok.ok === true);
  check('counts echoed',                ok.n_xpehh === 5 && ok.n_other === 5);
  // Length mismatch
  const mismatch = xpehhAlignsWithTrack(state, 'LG28', {
    window_start_bp: [100_000, 200_000, 300_000],
    window_end_bp:   [199_999, 299_999, 399_999],
  });
  check('length mismatch: ok=false',    mismatch.ok === false);
  check('reason = length_mismatch',     mismatch.reason === 'length_mismatch');
  // Shifted grid
  const shifted = xpehhAlignsWithTrack(state, 'LG28', {
    window_start_bp: [100_000, 200_500, 300_000, 400_000, 500_000],
    window_end_bp:   [199_999, 299_999, 399_999, 499_999, 599_999],
  });
  check('shifted grid: ok=false',       shifted.ok === false);
  check('reason names the index',
        shifted.reason.indexOf('window_grid_mismatch_at_1') >= 0);
  // Unknown chrom
  check('unknown chrom: xpehh_chrom_missing',
        xpehhAlignsWithTrack(state, 'LG99',
          { window_start_bp: [], window_end_bp: [] }).reason
            === 'xpehh_chrom_missing');
  // Malformed other windows
  check('other malformed: other_windows_malformed',
        xpehhAlignsWithTrack(state, 'LG28', null).reason
          === 'other_windows_malformed');
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
