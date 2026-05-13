// tests/test_shared_band_tracking_het.js
//
// Unit coverage for shared/band_tracking/het.js — Layer 1b of the
// band-tracking pipeline.

import {
  HET_DEFAULTS,
  meanPc1PerBand,
  het_detect_candidate_band,
  het_track_skeleton,
  het_define_interval,
  iv_merge_het_tracks,
} from '../atlases/inversion/shared/band_tracking/het.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('defaults');

check('frozen',                     Object.isFrozen(HET_DEFAULTS));
check('min_span_frac = 0.20',       HET_DEFAULTS.min_span_frac === 0.20);

// =====================================================================
group('meanPc1PerBand');

const labels = Int8Array.of(0, 0, 1, 1, 2, 2);
const pc1    = Float32Array.of(-1, -2, 0, 0.5, 3, 4);
const m = meanPc1PerBand(labels, pc1, 3);
check('band 0 mean = -1.5',         approx(m[0], -1.5));
check('band 1 mean = 0.25',         approx(m[1], 0.25));
check('band 2 mean = 3.5',          approx(m[2], 3.5));

const mEmpty = meanPc1PerBand(Int8Array.of(0, 0), pc1, 3);
check('band 1 with no members: NaN', Number.isNaN(mEmpty[1]));

check('null labels → all NaN',
      Array.from(meanPc1PerBand(null, pc1, 2)).every(v => Number.isNaN(v)));

// =====================================================================
group('het_detect_candidate_band');

// 3 bands: low (pc1 ~ -1), mid (pc1 ~ 0.25), high (pc1 ~ 3.5)
// Midpoint of range = (4 - 1.5)/2 = 1; mid-band PC1 0.25 is closer
// to midpoint than the other two → k_het = 1
const det = het_detect_candidate_band(labels, pc1, 3);
check('detected ok',                det !== null);
check('k_het = 1',                  det.k_het === 1);
check('k_hom_low = 0',              det.k_hom_low === 0);
check('k_hom_high = 2',             det.k_hom_high === 2);
check('het_span_frac in (0.20, 0.80)',
      det.het_span_frac > 0.20 && det.het_span_frac < 0.80);

// K < 3 → null
check('K=2 → null',
      het_detect_candidate_band(Int8Array.of(0, 1, 0, 1),
        Float32Array.of(0, 1, 0, 1), 2) === null);

// Het band too close to an edge (span_frac < 0.20)
const labelsEdge = Int8Array.of(0, 0, 1, 1, 2, 2);
const pc1Edge    = Float32Array.of(-1, -1, -0.95, -0.95, 3, 3);
// Range = 4; mid-band at -0.95 → spanFrac = (−0.95 - (−1)) / 4 = 0.0125 → reject
check('edge het → null',
      het_detect_candidate_band(labelsEdge, pc1Edge, 3) === null);

// =====================================================================
group('het_track_skeleton — clean run');

// 5 windows, K=3, het band consistently at k=1
const windowsClean = {};
for (let w = 0; w < 5; w++) {
  windowsClean[w] = {
    labels: Int8Array.of(0, 0, 1, 1, 2, 2),
    pc1: Float32Array.of(-1, -1, 0, 0, 3, 3),
  };
}
const skel = het_track_skeleton({
  getLabels: (w) => windowsClean[w] ? windowsClean[w].labels : null,
  getPc1:    (w) => windowsClean[w] ? windowsClean[w].pc1    : null,
  getK:      () => 3,
  chr_s_window: 0, chr_e_window: 4,
  seed_w: 2,
});
check('skeleton ok',                skel.ok === true);
check('5 windows tracked',          skel.windows.length === 5);
check('all k_het = 1',              skel.windows.every(w => w.k === 1));
check('mean_continuity = 1',        skel.mean_continuity === 1);
check('k_hom_low_at_seed = 0',      skel.k_hom_low_at_seed === 0);
check('k_hom_high_at_seed = 2',     skel.k_hom_high_at_seed === 2);
check('het_span_frac populated per window',
      skel.windows.every(w => Number.isFinite(w.het_span_frac)));

// =====================================================================
group('het_track_skeleton — error paths');

check('no callbacks → ok=false',
      het_track_skeleton({}).ok === false);
check('no het at seed → ok=false',
      het_track_skeleton({
        getLabels: () => Int8Array.of(0, 0, 1, 1),
        getPc1:    () => Float32Array.of(-1, -1, 1, 1),
        getK:      () => 2,           // K=2 → no het detection
        chr_s_window: 0, chr_e_window: 0,
        seed_w: 0,
      }).ok === false);

// =====================================================================
group('het_define_interval');

const getBpFor = (w) => ({ start_bp: w * 100_000, end_bp: w * 100_000 + 99_999 });
const iv = het_define_interval(skel, getBpFor);
check('interval ok',                iv !== null);
check('start_bp = 0',               iv.start_bp === 0);
check('end_bp = 499_999',           iv.end_bp === 499_999);
check('n_windows = 5',              iv.n_windows === 5);

check('null skeleton → null',
      het_define_interval({ ok: false }, getBpFor) === null);
check('no getBpFor → null',
      het_define_interval(skel, null) === null);

// =====================================================================
group('iv_merge_het_tracks');

const A = {
  start_bp: 0, end_bp: 1_000_000,
  sample_core: new Set([0, 1, 2, 3]),
};
const Bnear = {
  start_bp: 1_050_000, end_bp: 2_000_000,
  sample_core: new Set([0, 1, 2, 4]),    // 3/5 overlap → 0.6 ≥ 0.5 → merge
};
const Cfar = {
  start_bp: 3_500_000, end_bp: 4_000_000,
  sample_core: new Set([0, 1, 2, 3]),    // > max_gap_bp away → no merge
};
const D = {
  start_bp: 4_050_000, end_bp: 5_000_000,
  sample_core: new Set([99, 100]),       // close in bp but disjoint cores
};
const merged = iv_merge_het_tracks([A, Bnear, Cfar, D]);
check('A + Bnear merged → 3 intervals',  merged.length === 3);
check('first merged spans 0..2_000_000',
      merged[0].start_bp === 0 && merged[0].end_bp === 2_000_000);
check('first merged has merged_count=2',  merged[0].merged_count === 2);
check('Cfar preserved separately',
      merged[1].start_bp === 3_500_000);
check('D preserved (disjoint cores)',
      merged[2].sample_core.has(99));

check('empty input → []',           iv_merge_het_tracks([]).length === 0);
check('non-array → []',             iv_merge_het_tracks(null).length === 0);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
