// tests/test_shared_cusum.js

import {
  perSampleCusum,
  cusumGroupAggregate,
  perSampleCusumByKaryotype,
  perSampleCusumPanel,
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

// =====================================================================
// perSampleCusumPanel — θπ / GHSL panel layers (sparse, multi-scale).
// Fixture builds a fake state.data.theta_pi_panel with:
//   3 samples × 4 panel columns at scale 'win5'
//   per-column cohort mean is exactly 0 by construction
// =====================================================================
function makePanelState() {
  const nS = 3;
  const nCols = 4;
  // Per-column values per sample chosen so the column-cohort mean is 0
  // (sample 0 = -1, sample 1 = 0, sample 2 = +1) and the per-column
  // sample residual stays constant across columns → CUSUMs are linear.
  const M = [
    new Float64Array(nCols),  // sample 0 (band 0)
    new Float64Array(nCols),  // sample 1 (band 1)
    new Float64Array(nCols),  // sample 2 (band 2)
  ];
  for (let c = 0; c < nCols; c++) {
    M[0][c] = -1;
    M[1][c] =  0;
    M[2][c] = +1;
  }
  const panel = {
    primary_scale: 'win5',
    scales: ['win5', 'win10'],
    div_roll: { win5: M },
    start_bp: new Float64Array([1000, 2000, 3000, 4000]),
    end_bp:   new Float64Array([2000, 3000, 4000, 5000]),
  };
  return {
    state: { data: { n_samples: nS, n_windows: 99, windows: [], theta_pi_panel: panel } },
    labels: [0, 1, 2],
    panel,
    nS, nCols,
  };
}

group('perSampleCusumPanel — cohort_mean residual');
{
  const { state, nS, nCols } = makePanelState();
  const r = perSampleCusumPanel(state, 'theta_pi_panel', { residual: 'cohort_mean' });
  check('returns { cusums, colStartBp, colEndBp, scale, nCols }',
        r && r.cusums && r.colStartBp && r.colEndBp && r.scale === 'win5' && r.nCols === 4);
  check('cusums length = nS',           r.cusums.length === nS);
  check('per-sample length = nCols',    r.cusums[0].length === nCols);
  // Sample 0 (residual=-1 every col) → CUSUMs = -1, -2, -3, -4
  check('sample 0 CUSUM at last col = -4', approx(r.cusums[0][3], -4));
  check('sample 1 CUSUM at last col = 0',  approx(r.cusums[1][3],  0));
  check('sample 2 CUSUM at last col = +4', approx(r.cusums[2][3],  4));
  // Column bp metadata preserved
  check('colStartBp[0] = 1000',          r.colStartBp[0] === 1000);
  check('colEndBp[3]   = 5000',          r.colEndBp[3]   === 5000);
}

group('perSampleCusumPanel — bp-range filter');
{
  const { state } = makePanelState();
  // Restrict to the middle 2 columns (bp range ~2000-4000)
  const r = perSampleCusumPanel(state, 'theta_pi_panel', {
    residual: 'cohort_mean',
    startBp: 2000, endBp: 4000,
  });
  check('range filter narrows to 2 columns', r && r.nCols === 2);
  check('sample 0 CUSUM at last filtered col = -2',
        r && approx(r.cusums[0][1], -2));
}

group('perSampleCusumPanel — scale selection');
{
  const { state, panel } = makePanelState();
  // Add a denser scale (win1) with 8 columns; user can opt into it.
  panel.div_roll.win1 = [
    new Float64Array(8), new Float64Array(8), new Float64Array(8),
  ];
  // Same per-sample pattern (-1 / 0 / +1) across all 8 cols
  for (let c = 0; c < 8; c++) {
    panel.div_roll.win1[0][c] = -1;
    panel.div_roll.win1[1][c] =  0;
    panel.div_roll.win1[2][c] = +1;
  }
  // Need start_bp/end_bp arrays matching the win1 column count
  // (the panel keeps a single bp axis — these tests work because
  // the panel uses the same axis for every scale; in real precomp
  // sparse panels would carry separate axes). We don't model that
  // here — perSampleCusumPanel uses panel.start_bp.length to size
  // the column iteration, which on a real multi-axis panel would
  // require the producer to expose per-scale bp axes. Caveat
  // documented in the SPEC.
  panel.start_bp = new Float64Array(8);
  panel.end_bp   = new Float64Array(8);
  for (let i = 0; i < 8; i++) {
    panel.start_bp[i] = 1000 + i * 500;
    panel.end_bp[i]   = 1500 + i * 500;
  }
  const r = perSampleCusumPanel(state, 'theta_pi_panel', {
    residual: 'cohort_mean', scale: 'win1',
  });
  check('scale=win1 selects 8 columns', r && r.nCols === 8);
  check('scale resolved correctly',     r && r.scale === 'win1');
  check('sample 0 CUSUM at last (8th) col = -8',
        r && approx(r.cusums[0][7], -8));
}

group('perSampleCusumPanel — guards');
{
  check('null state → null',         perSampleCusumPanel(null, 'theta_pi_panel') === null);
  check('no panel → null',
        perSampleCusumPanel({ data: {} }, 'theta_pi_panel') === null);
  check('band_mean without labels → null',
        perSampleCusumPanel(makePanelState().state, 'theta_pi_panel',
                            { residual: 'band_mean' }) === null);
}

console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
