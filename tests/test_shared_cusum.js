// tests/test_shared_cusum.js

import {
  perSampleCusum,
  cusumGroupAggregate,
  perSampleCusumByKaryotype,
} from '../atlases/inversion/shared/cusum.js';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else      { fail++; console.log('  ✗', name, detail ? '— ' + detail : ''); }
}
function group(label) { console.log('\n--- ' + label + ' ---'); }
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

// =====================================================================
// Fixture builder. Synthetic 3-band data:
//   - 6 samples (2 per band: HOM1, HET, HOM2)
//   - 5 windows
//   - Each window's per-sample PC1 vector spreads samples 3-symmetric
//     around 0, so the per-window cohort mean is exactly 0.
// =====================================================================
function makeState() {
  // Per-window PC1 layout: 6 samples, 5 windows.
  // Window w → sample si gets value (label - 1) + w * 0.1  where label ∈ {0,1,2}
  // so samples 0/1 (band 0) get value -1 + 0.1w, samples 2/3 (band 1) get 0 + 0.1w,
  // samples 4/5 (band 2) get +1 + 0.1w.
  // Cohort mean per window = (2·(-1 + 0.1w) + 2·(0 + 0.1w) + 2·(1 + 0.1w)) / 6
  //                        = 0 + 0.1w
  // So the per-window cohort mean shifts by 0.1 each window.
  const nS = 6;
  const nW = 5;
  const labels = [0, 0, 1, 1, 2, 2];
  const windows = [];
  for (let w = 0; w < nW; w++) {
    const pc1 = new Float64Array(nS);
    for (let si = 0; si < nS; si++) {
      const lab = labels[si];
      pc1[si] = (lab - 1) + 0.1 * w;
    }
    windows.push({ pc1 });
  }
  return {
    state: { data: { n_samples: nS, n_windows: nW, windows } },
    labels, nS, nW,
  };
}

// =====================================================================
group('perSampleCusum — cohort_mean residual');
{
  const { state, labels, nS, nW } = makeState();
  const cusums = perSampleCusum(state, 'pc1', { residual: 'cohort_mean' });
  check('returns array of length nS',  cusums && cusums.length === nS);
  check('each entry is Float64Array of length nW',
        cusums.every(arr => arr instanceof Float64Array && arr.length === nW));
  // For sample si in band lab: value(w) − cohortMean(w) = (lab - 1).
  // So CUSUM at window w = (lab - 1) * (w + 1).
  // Sample 0 (band 0, lab-1=-1) at w=4 → CUSUM = -5
  // Sample 2 (band 1, lab-1= 0) at w=4 → CUSUM =  0
  // Sample 4 (band 2, lab-1=+1) at w=4 → CUSUM = +5
  check('band-0 sample CUSUM at end is -5', approx(cusums[0][4], -5));
  check('band-1 sample CUSUM at end is  0', approx(cusums[2][4],  0));
  check('band-2 sample CUSUM at end is +5', approx(cusums[4][4],  5));
}

group('perSampleCusum — zero residual (raw cumulative)');
{
  const { state, nS, nW } = makeState();
  const cusums = perSampleCusum(state, 'pc1', { residual: 'zero' });
  // Sample 0 (always value = -1 + 0.1w) — sum across w∈[0,4] = -5 + 0.1*10 = -4
  check('sample 0 raw cumulative ≈ -4 at end', approx(cusums[0][4], -4));
}

group('perSampleCusum — band_mean residual gives zero-mean within band');
{
  const { state, labels, nS, nW } = makeState();
  const cusums = perSampleCusum(state, 'pc1', {
    residual: 'band_mean', labels, K: 3,
  });
  // All samples in a band have the SAME PC1 (no jitter in the
  // fixture), so the band mean equals each sample's value → residual
  // = 0 everywhere → CUSUM stays 0.
  check('band_mean residual: every CUSUM ≈ 0',
        cusums.every(arr => arr.every(v => approx(v, 0))));
}

group('perSampleCusum — guards');
{
  check('null state → null',         perSampleCusum(null, 'pc1') === null);
  check('no data → null',            perSampleCusum({}, 'pc1') === null);
  check('endW < startW → null',
        perSampleCusum(makeState().state, 'pc1', { startW: 4, endW: 0 }) === null);
  check('band_mean without labels → null',
        perSampleCusum(makeState().state, 'pc1', { residual: 'band_mean' }) === null);
}

// =====================================================================
group('cusumGroupAggregate — mean');
{
  const { state, labels, nS, nW } = makeState();
  const cusums = perSampleCusum(state, 'pc1', { residual: 'cohort_mean' });
  const bandTraj = cusumGroupAggregate(cusums, labels, 3, { op: 'mean' });
  check('returns K arrays',                bandTraj.length === 3);
  check('each is Float64Array of length nW',
        bandTraj.every(a => a instanceof Float64Array && a.length === nW));
  // Per band, both samples have identical CUSUM trajectories so mean
  // = the single trajectory.
  // band 0: trajectory [-1, -2, -3, -4, -5]
  check('band 0 mean trajectory at w=4 = -5', approx(bandTraj[0][4], -5));
  check('band 2 mean trajectory at w=2 = +3', approx(bandTraj[2][2],  3));
}

group('cusumGroupAggregate — median');
{
  const { state, labels } = makeState();
  const cusums = perSampleCusum(state, 'pc1', { residual: 'cohort_mean' });
  const bandTraj = cusumGroupAggregate(cusums, labels, 3, { op: 'median' });
  // Both samples in each band have identical traj → median equals it.
  check('band 1 median trajectory at w=2 = 0', approx(bandTraj[1][2], 0));
}

group('cusumGroupAggregate — NaN handling');
{
  // Inject one sample with NaN PC1 at one window.
  const { state, labels, nS, nW } = makeState();
  state.data.windows[2].pc1[0] = NaN;
  const cusums = perSampleCusum(state, 'pc1', { residual: 'cohort_mean' });
  // Sample 0 should carry forward at window 2 (no increment).
  check('NaN sample carries forward',
        approx(cusums[0][2], cusums[0][1]));
  // Band 0 aggregate: sample 0 contributes its carry-forward, sample 1
  // contributes a real value — mean should be finite.
  const bandTraj = cusumGroupAggregate(cusums, labels, 3, { op: 'mean' });
  check('band aggregate stays finite when one sample has NaN gap',
        Number.isFinite(bandTraj[0][2]));
}

// =====================================================================
group('perSampleCusumByKaryotype convenience');
{
  const { state, labels } = makeState();
  const r = perSampleCusumByKaryotype(state, 'pc1', labels, 3, { op: 'mean' });
  check('returns { cusums, bandTraj }',
        r && r.cusums && r.bandTraj);
  check('cusums length = nS',     r.cusums.length === 6);
  check('bandTraj length = K',    r.bandTraj.length === 3);
  check('end-of-chrom band 2 ≈ +5', approx(r.bandTraj[2][4], 5));
}

console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
