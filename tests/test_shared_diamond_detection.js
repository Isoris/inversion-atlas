// tests/test_shared_diamond_detection.js
//
// Unit coverage for shared/diamond_detection.js — per-candidate split-
// and-re-merge ("diamond") detection (legacy lines 37820-38010).

import * as DD from '../atlases/inversion/shared/diamond_detection.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('Constants');
check('thresholds frozen-style numeric',     DD.DD_SPLIT_RATIO_THRESHOLD === 1.5);
check('min diamond windows = 3',             DD.DD_MIN_DIAMOND_WINDOWS === 3);
check('stable variance frac = 0.05',         DD.DD_STABLE_VARIANCE_FRAC === 0.05);
check('min band samples = 4',                DD.DD_MIN_BAND_SAMPLES === 4);
check('strictness vocab frozen',             Object.isFrozen(DD.DIAMOND_STRICTNESS));
check('strictness has 3 entries',
      DD.DIAMOND_STRICTNESS.includes('loose') &&
      DD.DIAMOND_STRICTNESS.includes('strict') &&
      DD.DIAMOND_STRICTNESS.includes('strict2'));

// -----------------------------------------------------------------------------
// Fixture: 3 bands × N windows, with band 0 doing a clean split-and-merge
// across windows 5-9. Band 1 stays flat. Band 2 stays flat.
// Each band has 6 samples per window so n >= MIN_BAND_SAMPLES.
// -----------------------------------------------------------------------------

const nSamples = 18;
const nWindows = 16;
// locked_labels: 6 samples per band
const labels = [];
for (let si = 0; si < nSamples; si++) labels.push(si % 3);

function _stableBand(bandMean, sd) {
  // Generate pc1 values with the given mean ± sd jitter for a band's samples.
  return (siInBand) => bandMean + (siInBand - 2.5) * sd / 2;  // deterministic spread
}

function _windowsWithSplit(splitLo, splitHi, peakSd) {
  const wins = [];
  for (let wi = 0; wi < nWindows; wi++) {
    const inSplit = (wi >= splitLo && wi <= splitHi);
    const pc1 = new Array(nSamples);
    for (let si = 0; si < nSamples; si++) {
      const band = labels[si];
      const inBandIdx = Math.floor(si / 3);  // 0..5 within each band
      if (band === 0) {
        // Band 0: spread balloons inside the split range
        const baseMean = 0;
        const sd = inSplit ? peakSd : 0.05;
        pc1[si] = baseMean + (inBandIdx - 2.5) * sd;
      } else if (band === 1) {
        pc1[si] = 0.5 + (inBandIdx - 2.5) * 0.01;  // tight flat band
      } else {
        pc1[si] = -0.5 + (inBandIdx - 2.5) * 0.01;
      }
    }
    wins.push({ pc1 });
  }
  return wins;
}

// -----------------------------------------------------------------------------
group('ddComputeBandStats');
const cand = { start_w: 0, end_w: nWindows - 1, K: 3, locked_labels: labels };
const wins = _windowsWithSplit(5, 9, 0.4);
const stats = DD.ddComputeBandStats(cand, wins);
check('stats: 3 bands',                stats.bandStats.length === 3);
check('stats: each band has n_windows entries',
      stats.bandStats.every(b => b.perWindow.length === nWindows));
check('stats: band 0 sd peaks inside split range',
      stats.bandStats[0].perWindow[7].sd > stats.bandStats[0].perWindow[1].sd);
check('stats: band 1 sd stays low everywhere',
      stats.bandStats[1].perWindow.every(p => p.sd < 0.1));

// Bad inputs
check('null candidate → null',         DD.ddComputeBandStats(null, wins) === null);
check('null windows → null',           DD.ddComputeBandStats(cand, null) === null);

// Few samples → band entry exists but mean/sd are NaN
const candFew = { start_w: 0, end_w: 1, K: 1, locked_labels: [0, 0, 0] };
const winsFew = [
  { pc1: [0.1, 0.2, 0.3] },
  { pc1: [0.1, 0.2, 0.3] },
];
const statsFew = DD.ddComputeBandStats(candFew, winsFew);
check('few samples: mean is NaN',      Number.isNaN(statsFew.bandStats[0].perWindow[0].mean));

// -----------------------------------------------------------------------------
group('ddDetectSplittingRange');
const ranges = DD.ddDetectSplittingRange(stats.bandStats[0].perWindow);
check('detect: at least one range found',  ranges.length >= 1);
check('detect: range starts near split bound',
      ranges[0].start_w >= 4 && ranges[0].start_w <= 6);
check('detect: range ends near split bound',
      ranges[0].end_w >= 8 && ranges[0].end_w <= 10);
check('detect: peak_ratio > threshold',     ranges[0].peak_ratio > DD.DD_SPLIT_RATIO_THRESHOLD);

// No splitting → empty ranges (band 1 stays flat)
check('detect: flat band → []',
      DD.ddDetectSplittingRange(stats.bandStats[1].perWindow).length === 0);

// Too few windows
check('detect: too-few-windows → []',
      DD.ddDetectSplittingRange([{ wi: 0, sd: 0.1 }, { wi: 1, sd: 0.5 }]).length === 0);

// -----------------------------------------------------------------------------
group('ddTotalSpread + ddIsBandStable');
const totalSpread = DD.ddTotalSpread(stats.bandStats);
check('total spread > 0',              totalSpread > 0.5);

const stab1 = DD.ddIsBandStable(stats.bandStats[1].perWindow, 5, 9, totalSpread);
check('flat band 1 is stable',         stab1.stable === true);
check('flat band 1 mean_drift small',  stab1.mean_drift < 0.05);

const stab0 = DD.ddIsBandStable(stats.bandStats[0].perWindow, 5, 9, totalSpread);
check('splitting band may or may not stable',  typeof stab0.stable === 'boolean');

// Empty band → not stable
const stabEmpty = DD.ddIsBandStable([], 0, 0, totalSpread);
check('empty band: stable false',      stabEmpty.stable === false);

// -----------------------------------------------------------------------------
group('detectDiamonds');
const diamonds = DD.detectDiamonds(cand, wins);
check('1+ diamond detected',           diamonds.length >= 1);
check('diamond has splitting_band',    diamonds[0].splitting_band === 0);
check('diamond has stable_bands',
      Array.isArray(diamonds[0].stable_bands) &&
      diamonds[0].stable_bands.length >= 2);
check('diamond.strict = true (≥1 stable)',  diamonds[0].strict === true);
check('diamond.strict2 = true (≥2 stable)', diamonds[0].strict2 === true);
check('peak_spread_ratio > threshold', diamonds[0].peak_spread_ratio > DD.DD_SPLIT_RATIO_THRESHOLD);

// No-diamond candidate (no splitting anywhere)
const winsFlat = _windowsWithSplit(99, 99, 0);  // never enters split range
const noDiamonds = DD.detectDiamonds(cand, winsFlat);
check('flat candidate: no diamonds',   noDiamonds.length === 0);

// Bad inputs
check('null candidate: []',            DD.detectDiamonds(null, wins).length === 0);
check('null windows: []',              DD.detectDiamonds(cand, null).length === 0);

// -----------------------------------------------------------------------------
group('summarizeDiamonds');
const summary = DD.summarizeDiamonds(cand, wins);
check('summary: n_diamonds >= 1',      summary.n_diamonds >= 1);
check('summary: has_loose true',       summary.has_loose === true);
check('summary: has_strict true',      summary.has_strict === true);
check('summary: has_strict2 true',     summary.has_strict2 === true);
check('summary: n_loose === n_diamonds', summary.n_loose === summary.n_diamonds);
check('summary: diamonds array',       Array.isArray(summary.diamonds));

const summaryFlat = DD.summarizeDiamonds(cand, winsFlat);
check('flat: n_diamonds = 0',          summaryFlat.n_diamonds === 0);
check('flat: has_loose = false',       summaryFlat.has_loose === false);

// -----------------------------------------------------------------------------
group('diamondCountFor');
check('loose mode → n_loose',          DD.diamondCountFor(summary, 'loose') === summary.n_loose);
check('strict mode → n_strict',        DD.diamondCountFor(summary, 'strict') === summary.n_strict);
check('strict2 mode → n_strict2',      DD.diamondCountFor(summary, 'strict2') === summary.n_strict2);
check('null summary → 0',              DD.diamondCountFor(null, 'loose') === 0);
check('unknown mode → loose count',    DD.diamondCountFor(summary, 'unknown') === summary.n_loose);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
