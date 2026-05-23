// tests/test_shared_inversion_classification_axes.js
//
// Unit coverage for shared/inversion_classification_axes.js — the
// per-candidate divergence + XP-EHH axis classifiers. Each axis
// produces one frozen-vocab label the classification page tiles
// across candidates.

import {
  DIVERGENCE_AXIS_LABELS,
  XPEHH_AXIS_LABELS,
  XPEHH_AXIS_DEFAULTS,
  classifyCandidateDivergence,
  classifyCandidateXpehhSignal,
} from '../atlases/inversion/shared/inversion_classification_axes.js';
import {
  DIVERGENCE_FST_WEAK_THRESHOLD,
  DIVERGENCE_FST_STRONG_THRESHOLD,
} from '../atlases/cross-species/shared/divergence_network.js';
import {
  storeXpehhPerWindow,
} from '../atlases/inversion/shared/xpehh_per_window.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab');

check('divergence labels frozen',     Object.isFrozen(DIVERGENCE_AXIS_LABELS));
check('xpehh labels frozen',          Object.isFrozen(XPEHH_AXIS_LABELS));
check('xpehh defaults frozen',        Object.isFrozen(XPEHH_AXIS_DEFAULTS));
check('mild_z = 2.0',                 XPEHH_AXIS_DEFAULTS.mild_z_threshold === 2.0);
check('strong_z = 4.0',               XPEHH_AXIS_DEFAULTS.strong_z_threshold === 4.0);
check('FST weak threshold = 0.10',    DIVERGENCE_FST_WEAK_THRESHOLD === 0.10);
check('FST strong threshold = 0.25',  DIVERGENCE_FST_STRONG_THRESHOLD === 0.25);

// =====================================================================
group('classifyCandidateDivergence');

// no_data — null / empty
check('null network → no_data',
      classifyCandidateDivergence(null) === DIVERGENCE_AXIS_LABELS.NO_DATA);
check('empty edges → no_data',
      classifyCandidateDivergence({ edges: [], meta: { metric: 'fst' } })
   === DIVERGENCE_AXIS_LABELS.NO_DATA);
check('distance metric → no_data (unsupported)',
      classifyCandidateDivergence({
        edges: [{ fst: 0.3, flag: 'strong' }],
        meta: { metric: 'distance' },
      }) === DIVERGENCE_AXIS_LABELS.NO_DATA);

// low_power — all edges are low-power
check('all-low-power edges → low_power',
      classifyCandidateDivergence({
        edges: [{ fst: 0.4, flag: 'low_power' }, { fst: 0.1, flag: 'low_power' }],
        meta: { metric: 'fst' },
      }) === DIVERGENCE_AXIS_LABELS.LOW_POWER);

// no_divergence
check('max FST < 0.10 → no_divergence',
      classifyCandidateDivergence({
        edges: [{ fst: 0.05 }, { fst: 0.08 }],
        meta: { metric: 'fst' },
      }) === DIVERGENCE_AXIS_LABELS.NO_DIVERGENCE);

// weak_divergence
check('FST in [0.10, 0.25) → weak',
      classifyCandidateDivergence({
        edges: [{ fst: 0.05 }, { fst: 0.15, flag: 'weak' }],
        meta: { metric: 'fst' },
      }) === DIVERGENCE_AXIS_LABELS.WEAK_DIVERGENCE);

// strong_divergence — max ≥ 0.25
check('FST ≥ 0.25 → strong',
      classifyCandidateDivergence({
        edges: [{ fst: 0.04 }, { fst: 0.28, flag: 'strong' }],
        meta: { metric: 'fst' },
      }) === DIVERGENCE_AXIS_LABELS.STRONG_DIVERGENCE);

// Mixed: one low_power edge + one usable strong edge → strong
check('mixed: 1 low_power + 1 strong usable → strong',
      classifyCandidateDivergence({
        edges: [{ fst: 0.45, flag: 'low_power' },
                { fst: 0.30, flag: 'strong'    }],
        meta: { metric: 'fst' },
      }) === DIVERGENCE_AXIS_LABELS.STRONG_DIVERGENCE);

// =====================================================================
group('classifyCandidateXpehhSignal — fixtures');

// Build a minimal `state` object the way xpehh_per_window expects it:
//   state.xpehhPerWindow = { tool, schema_version, windows: { chrom: { window_start_bp, window_end_bp, xpehh_mean, norm_xpehh_mean } } }
function mkXpehhState({ window_starts, window_ends, xpehh, norm_xpehh }) {
  const state = {};
  const ok = storeXpehhPerWindow(state, {
    tool: 'xpehh_per_window_v1',
    schema_version: 1,
    test_cohort_id: 'A',
    ref_cohort_id:  'B',
    n_test: 100, n_ref: 100,
    windows: {
      LG28: {
        window_start_bp: window_starts,
        window_end_bp:   window_ends,
        xpehh_mean:      xpehh,
        norm_xpehh_mean: norm_xpehh,
        xpehh_max_abs:   xpehh.map(v => Math.abs(v)),
        n_snps:          xpehh.map(() => 100),
      },
    },
  });
  if (!ok) throw new Error('test fixture failed xpehh validation');
  return state;
}

// 5 windows, candidate covers windows 1..3 (mid-bp 1.5M..2.5M)
const window_starts = [0, 1_000_000, 1_500_000, 2_000_000, 2_500_000];
const window_ends   = [1_000_000, 1_500_000, 2_000_000, 2_500_000, 3_000_000];

// Case 1: no_signal — all values |xpehh| < 2
const state_nosig = mkXpehhState({
  window_starts, window_ends,
  xpehh:      [0.1, 0.5, -1.2, 1.0, 0.3],
  norm_xpehh: [0.1, 0.5, -1.2, 1.0, 0.3],
});
const cand_nosig = { chrom: 'LG28', start_bp: 1_200_000, end_bp: 2_400_000 };
check('all sub-threshold → no_signal',
      classifyCandidateXpehhSignal(state_nosig, cand_nosig)
   === XPEHH_AXIS_LABELS.NO_SIGNAL);

// Case 2: mild_outlier — one window |xpehh| in [2, 4)
const state_mild = mkXpehhState({
  window_starts, window_ends,
  xpehh:      [0.1, 0.5, -2.5, 1.0, 0.3],
  norm_xpehh: [0.1, 0.5, -2.5, 1.0, 0.3],
});
check('one |xpehh| ≥ 2 → mild_outlier',
      classifyCandidateXpehhSignal(state_mild, cand_nosig)
   === XPEHH_AXIS_LABELS.MILD_OUTLIER);

// Case 3: strong_outlier — one window |xpehh| ≥ 4
const state_strong = mkXpehhState({
  window_starts, window_ends,
  xpehh:      [0.1, 0.5, -4.2, 1.0, 0.3],
  norm_xpehh: [0.1, 0.5, -4.2, 1.0, 0.3],
});
check('one |xpehh| ≥ 4 → strong_outlier',
      classifyCandidateXpehhSignal(state_strong, cand_nosig)
   === XPEHH_AXIS_LABELS.STRONG_OUTLIER);

// Case 4: strong via count — ≥ 3 windows over 2
const window_starts4 = [0, 1_000_000, 1_500_000, 2_000_000, 2_500_000];
const window_ends4   = [1_000_000, 1_500_000, 2_000_000, 2_500_000, 3_000_000];
const state_n3 = mkXpehhState({
  window_starts: window_starts4, window_ends: window_ends4,
  xpehh:      [0.0, 2.1, -2.5, 2.3, 0.0],
  norm_xpehh: [0.0, 2.1, -2.5, 2.3, 0.0],
});
const cand_full = { chrom: 'LG28', start_bp: 500_000, end_bp: 2_900_000 };
check('3 windows ≥ 2 → strong_outlier (count rule)',
      classifyCandidateXpehhSignal(state_n3, cand_full)
   === XPEHH_AXIS_LABELS.STRONG_OUTLIER);

// Case 5: no_data — chrom missing
check('chrom not in layer → no_data',
      classifyCandidateXpehhSignal(state_nosig,
        { chrom: 'LG99', start_bp: 0, end_bp: 1_000_000 })
   === XPEHH_AXIS_LABELS.NO_DATA);

check('no state → no_data',
      classifyCandidateXpehhSignal(null, cand_nosig)
   === XPEHH_AXIS_LABELS.NO_DATA);

check('no candidate → no_data',
      classifyCandidateXpehhSignal(state_nosig, null)
   === XPEHH_AXIS_LABELS.NO_DATA);

check('bad bp → no_data',
      classifyCandidateXpehhSignal(state_nosig, { chrom: 'LG28' })
   === XPEHH_AXIS_LABELS.NO_DATA);

// Case 6: raw xpehh_mean used when norm_xpehh_mean is all null
const state_raw = mkXpehhState({
  window_starts, window_ends,
  xpehh:      [0.1, 0.5, -2.7, 1.0, 0.3],
  norm_xpehh: [null, null, null, null, null],
});
check('raw xpehh_mean used when norm missing → mild_outlier',
      classifyCandidateXpehhSignal(state_raw, cand_nosig)
   === XPEHH_AXIS_LABELS.MILD_OUTLIER);

// Custom thresholds
check('custom mild_z=3.0 → no_signal when |xpehh|=2.5',
      classifyCandidateXpehhSignal(state_mild, cand_nosig, { mild_z_threshold: 3.0 })
   === XPEHH_AXIS_LABELS.NO_SIGNAL);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
