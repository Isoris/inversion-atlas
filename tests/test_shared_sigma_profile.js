// tests/test_shared_sigma_profile.js
//
// Unit coverage for shared/sigma_profile.js — σ-profile classifier
// (legacy lines 10406-10460).

import * as SP from '../atlases/inversion/shared/sigma_profile.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// Helper: build a synthetic state where sampleSpreadRange returns a
// known per-sample σ pattern by constructing windows so that PC1
// movement across windows produces the desired σ.
//
// Simple trick: for n_samples samples, K windows, set window[w].pc1[si] to
// `targets[si] * w` so each sample drifts at rate targets[si]. Then σ scales
// with |targets[si]|.
//
// But for our verdict tests we don't need to fight that — we use the
// sampleSpreadRange indirectly via fixture states designed to hit each
// verdict branch.

function _stateWithSigmas(sigmas) {
  // For each sample, generate pc1 values across 4 windows so that the
  // sample-σ matches `sigmas[si]`. Use values [-s, 0, +s, 0] (mean 0,
  // n=4, variance = (s²+0+s²+0)/(n-1) = 2s²/3, σ = s*sqrt(2/3)).
  const nW = 4;
  const nS = sigmas.length;
  const windows = [];
  for (let w = 0; w < nW; w++) {
    const pc1 = new Array(nS);
    for (let si = 0; si < nS; si++) {
      const s = sigmas[si] / Math.sqrt(2 / 3);
      // Pattern: w=0 → -s, w=1 → 0, w=2 → +s, w=3 → 0 (mean 0 over 4 windows)
      if (w === 0) pc1[si] = -s;
      else if (w === 1) pc1[si] = 0;
      else if (w === 2) pc1[si] = s;
      else pc1[si] = 0;
    }
    windows.push({ pc1 });
  }
  return { data: { n_samples: nS, windows } };
}

// -----------------------------------------------------------------------------
group('Constants');
check('Sarle BC threshold = 5/9',  SP.SIGMA_BIMODAL_BC_THRESHOLD === 5 / 9);
check('SIGMA_TOP_N = 12',          SP.SIGMA_TOP_N === 12);

// -----------------------------------------------------------------------------
group('Verdict: NA (K<=3)');
const stable10 = new Array(10).fill(0.01);
const stateNA = _stateWithSigmas(stable10);
const candK3 = { K: 3, start_w: 0, end_w: 3 };
const naResult = SP.sigmaProfileCandidate(stateNA, candK3);
check('K=3 → verdict NA',          naResult.verdict === 'NA');
check('reason mentions K=3',       naResult.reason.includes('K=3'));

// -----------------------------------------------------------------------------
group('Verdict: TWO_INVERSIONS');
// 20 stable samples (σ ≈ 0.01), K=4
const stable20 = new Array(20).fill(0.01);
const stateStable = _stateWithSigmas(stable20);
const stableResult = SP.sigmaProfileCandidate(stateStable, { K: 4, start_w: 0, end_w: 3 });
check('all-stable K=4: verdict TWO_INVERSIONS',
      stableResult.verdict === 'TWO_INVERSIONS');
check('q50 small',                  stableResult.q50 < 0.05);
check('ratio_high near 0',          stableResult.ratio_high < 0.10);

// -----------------------------------------------------------------------------
group('Verdict: NOISY_REGION');
// All-high σ: everyone drifts
const noisy = new Array(20).fill(0.3);
const stateNoisy = _stateWithSigmas(noisy);
const noisyResult = SP.sigmaProfileCandidate(stateNoisy, { K: 4, start_w: 0, end_w: 3 });
check('all-high σ: verdict NOISY_REGION',
      noisyResult.verdict === 'NOISY_REGION');
check('q50 > 0.10',                  noisyResult.q50 > 0.10);

// -----------------------------------------------------------------------------
group('Verdict: CROSSOVER_ARTIFACTS');
// 18 stable + 2 drifters → bimodal with small high tail (10% > 2*q50)
const crossover = new Array(20).fill(0.01);
crossover[18] = 0.5;
crossover[19] = 0.6;
const stateCross = _stateWithSigmas(crossover);
const crossResult = SP.sigmaProfileCandidate(stateCross, { K: 4, start_w: 0, end_w: 3 });
check('K=4 + few drifters: verdict CROSSOVER_ARTIFACTS',
      crossResult.verdict === 'CROSSOVER_ARTIFACTS');
check('is_bimodal',                  crossResult.is_bimodal);
check('ratio_high in (0.02, 0.25)',
      crossResult.ratio_high > 0.02 && crossResult.ratio_high < 0.25);
check('top_high contains the 2 drifters',
      crossResult.top_high.length === 2);
check('top_high sorted desc',
      crossResult.top_high[0].sigma >= crossResult.top_high[1].sigma);

// -----------------------------------------------------------------------------
group('Output fields');
check('sd is Float64Array',          stableResult.sd instanceof Float64Array);
check('q50 / q90 / q95 finite',
      Number.isFinite(stableResult.q50) && Number.isFinite(stableResult.q90)
      && Number.isFinite(stableResult.q95));
check('bimodality_coef finite',      Number.isFinite(stableResult.bimodality_coef));
check('reason is a string',          typeof stableResult.reason === 'string');

// top_high capped at SIGMA_TOP_N
const wideHigh = new Array(30).fill(0.01);
for (let i = 20; i < 30; i++) wideHigh[i] = 0.5;
const stateWide = _stateWithSigmas(wideHigh);
const wideResult = SP.sigmaProfileCandidate(stateWide, { K: 4, start_w: 0, end_w: 3 });
check('top_high capped at SIGMA_TOP_N',  wideResult.top_high.length <= SP.SIGMA_TOP_N);

// -----------------------------------------------------------------------------
group('Edge cases');
check('null cand → null',            SP.sigmaProfileCandidate(stateNA, null) === null);
check('missing start_w → null',
      SP.sigmaProfileCandidate(stateNA, { K: 4, end_w: 3 }) === null);
check('missing end_w → null',
      SP.sigmaProfileCandidate(stateNA, { K: 4, start_w: 0 }) === null);
check('non-integer start_w → null',
      SP.sigmaProfileCandidate(stateNA, { K: 4, start_w: 0.5, end_w: 3 }) === null);

// Too few samples for valid σ profile
const stateFew = _stateWithSigmas(new Array(5).fill(0.01));
check('< 10 finite σ → null',
      SP.sigmaProfileCandidate(stateFew, { K: 4, start_w: 0, end_w: 3 }) === null);

// Null state
check('null state → null',
      SP.sigmaProfileCandidate(null, { K: 4, start_w: 0, end_w: 3 }) === null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
