// tests/test_shared_band_reach.js
//
// Unit coverage for shared/band_reach.js — per-fish band-reach across
// L2 chain + bimodality verdict on the reach histogram (legacy lines
// 38190-38330 + 47640-47820).

import * as BR from '../atlases/inversion/shared/band_reach.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('Constants');
check('BREACH_NARROW_THRESHOLD = 2',       BR.BREACH_NARROW_THRESHOLD === 2);
check('BREACH_NARROW_FRAC_HIGH = 0.70',    BR.BREACH_NARROW_FRAC_HIGH === 0.70);
check('BREACH_NARROW_FRAC_LOW = 0.30',     BR.BREACH_NARROW_FRAC_LOW === 0.30);
check('BREACH_MIN_FISH_PER_BAND = 5',      BR.BREACH_MIN_FISH_PER_BAND === 5);
check('BR_MIN_VALID_FISH = 10',            BR.BR_MIN_VALID_FISH === 10);
check('BR_TROUGH_REACH = 3',               BR.BR_TROUGH_REACH === 3);

// -----------------------------------------------------------------------------
group('projectChainToLeftmost');
// 3 L2s, 6 samples, K=4.
// L2[0]: identity.
// L2[1]: same partition (after invert).
const chain = [
  { labels: [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2] },
  { labels: [2, 1, 0, 2, 1, 0, 2, 1, 0, 2, 1, 0] },  // permuted 0↔2
];
const projected = BR.projectChainToLeftmost(chain, 3);
check('projected: 2 arrays',               projected.length === 2);
check('projected: first is identity',      projected[0] === chain[0].labels);
// After Hungarian alignment + invert, the projected L2[1] should match
// L2[0]'s partition exactly.
check('projected: alignment recovers L2[0] partition',
      Array.from(projected[1]).every((v, i) => v === chain[0].labels[i]));

check('empty chain → []',
      BR.projectChainToLeftmost([], 3).length === 0);

// Negative labels propagate as -1
const chainNeg = [
  { labels: [0, -1, 1, 0, -1, 1] },
  { labels: [0, -1, 1, 0, -1, 1] },
];
const projNeg = BR.projectChainToLeftmost(chainNeg, 2);
check('projected: -1 preserved',           projNeg[1][1] === -1);

// -----------------------------------------------------------------------------
group('computeBandReachAcrossL2s');
// All-stable fixture: 30 fish across 3 L2s, every fish stays in same band.
const nS = 30;
function _makeStableChain(nL2, K) {
  const out = [];
  for (let i = 0; i < nL2; i++) {
    const labels = new Array(nS);
    for (let s = 0; s < nS; s++) labels[s] = s % K;
    out.push({ labels, usedK: K });
  }
  return out;
}
const stable = BR.computeBandReachAcrossL2s(_makeStableChain(3, 3), { K: 3 });
check('stable: returns object',            stable !== null);
check('stable: K = 3',                     stable.K === 3);
check('stable: every fish reach = 1',
      Array.from(stable.per_sample_band_reach).every(r => r === 1));
check('stable: narrow_fraction = 1.0',     stable.narrow_fraction === 1.0);
check('stable: bands_populated = 3',       stable.bands_populated === 3);
check('stable: regime = narrow',           stable.regime_breadth === 'narrow');

// "Wide" fixture: 3 L2s, each "wandering" fish ends up in a different
// band in each L2. 32 fish per band, 4 bands. Within each L2[0] band:
//   half the fish stay across all 3 L2s   (reach 1)
//   half the fish hop +1 in L2[1] then +1 again in L2[2] (reach 3)
function _makeWideChain(K) {
  const wideNS = 32;
  const out = [];
  // L2[0]: 8 fish per band, in order
  const l0 = new Array(wideNS);
  for (let s = 0; s < wideNS; s++) l0[s] = Math.floor(s / 8);
  out.push({ labels: l0, usedK: K });
  // L2[1]: half the fish in each band hop +1
  const l1 = new Array(wideNS);
  for (let s = 0; s < wideNS; s++) {
    const b0 = Math.floor(s / 8);
    const inBand = s % 8;
    l1[s] = (inBand < 4) ? b0 : (b0 + 1) % K;
  }
  out.push({ labels: l1, usedK: K });
  // L2[2]: same hop fish go +1 again (so reach=3)
  const l2 = new Array(wideNS);
  for (let s = 0; s < wideNS; s++) {
    const b0 = Math.floor(s / 8);
    const inBand = s % 8;
    l2[s] = (inBand < 4) ? b0 : (b0 + 2) % K;
  }
  out.push({ labels: l2, usedK: K });
  return out;
}
const wide = BR.computeBandReachAcrossL2s(_makeWideChain(4), { K: 4 });
// Mix of reach 1 (stable half) and reach 3+ (wandering half)
check('wide: some fish reach ≥ 3',
      Array.from(wide.per_sample_band_reach).some(r => r >= 3));
check('wide: narrow_fraction is partial (0 < f < 1)',
      wide.narrow_fraction > 0 && wide.narrow_fraction < 1.0);
check('wide: regime not "no_signal"',     wide.regime_breadth !== 'no_signal');

// Empty / null
check('null clusters → null',              BR.computeBandReachAcrossL2s(null) === null);
check('empty chain → null',                BR.computeBandReachAcrossL2s([]) === null);

// Mismatched label lengths
check('mismatched lengths → null',
      BR.computeBandReachAcrossL2s([
        { labels: [0, 1, 2] }, { labels: [0, 1] },
      ]) === null);

// l2_indices propagation
const stableIdx = BR.computeBandReachAcrossL2s(_makeStableChain(3, 3), {
  K: 3, l2_indices: [10, 11, 12],
});
check('l2_indices propagated',
      stableIdx.l2_indices && stableIdx.l2_indices.length === 3);

// fixedKLabels preferred
const fixed = BR.computeBandReachAcrossL2s([
  { labels: new Array(nS).fill(0), fixedKLabels: Array.from({length: nS}, (_, i) => i % 3), usedK: 3 },
  { labels: new Array(nS).fill(0), fixedKLabels: Array.from({length: nS}, (_, i) => i % 3), usedK: 3 },
], { K: 3 });
check('fixedKLabels preferred over labels',
      fixed.bands_populated === 3);

// -----------------------------------------------------------------------------
group('bandReachBimodalityFromReach: NA');
const reachLowK = {
  per_sample_band_reach: new Int8Array(nS).fill(1),
  K: 3, n_samples: nS,
};
const verdictNA = BR.bandReachBimodalityFromReach(reachLowK);
check('K<4 → verdict NA',                  verdictNA.verdict === 'NA');

const reachFew = {
  per_sample_band_reach: new Int8Array(5).fill(1),
  K: 4, n_samples: 5,
};
const verdictFew = BR.bandReachBimodalityFromReach(reachFew);
check('n_valid < min → verdict NA',        verdictFew.verdict === 'NA');

// -----------------------------------------------------------------------------
group('bandReachBimodalityFromReach: UNIMODAL_NARROW');
// 80% of fish at reach=1, 20% at reach=2 → narrow
const reachNarrow = {
  per_sample_band_reach: (() => {
    const r = new Int8Array(20);
    for (let i = 0; i < 16; i++) r[i] = 1;
    for (let i = 16; i < 20; i++) r[i] = 2;
    return r;
  })(),
  K: 4, n_samples: 20,
};
const vNarrow = BR.bandReachBimodalityFromReach(reachNarrow);
check('narrow fixture: verdict = UNIMODAL_NARROW',
      vNarrow.verdict === 'UNIMODAL_NARROW');
check('narrow fixture: narrow_fraction = 1.0',
      vNarrow.narrow_fraction === 1.0);

// -----------------------------------------------------------------------------
group('bandReachBimodalityFromReach: UNIMODAL_WIDE');
const reachWide = {
  per_sample_band_reach: new Int8Array(20).fill(4),
  K: 4, n_samples: 20,
};
const vWide = BR.bandReachBimodalityFromReach(reachWide);
check('wide fixture: verdict = UNIMODAL_WIDE',
      vWide.verdict === 'UNIMODAL_WIDE');
check('wide fixture: wide_fraction = 1.0',
      vWide.wide_fraction === 1.0);

// -----------------------------------------------------------------------------
group('bandReachBimodalityFromReach: BIMODAL_STACKED');
// Half fish at reach=1 (narrow), half at reach=4 (wide), no trough
const reachBimodal = {
  per_sample_band_reach: (() => {
    const r = new Int8Array(20);
    for (let i = 0; i < 10; i++) r[i] = 1;       // narrow
    for (let i = 10; i < 20; i++) r[i] = 4;      // wide
    return r;
  })(),
  K: 4, n_samples: 20,
};
const vBi = BR.bandReachBimodalityFromReach(reachBimodal);
check('bimodal fixture: verdict = BIMODAL_STACKED',
      vBi.verdict === 'BIMODAL_STACKED');
check('bimodal: narrow_fraction = 0.5',    vBi.narrow_fraction === 0.5);
check('bimodal: wide_fraction = 0.5',      vBi.wide_fraction === 0.5);
check('bimodal: trough_below_both = true', vBi.trough_below_both === true);
check('bimodal: histogram is Array',       Array.isArray(vBi.reach_histogram));

// -----------------------------------------------------------------------------
group('bandReachBimodalityFromReach: UNDETERMINED');
// Spread: 20% narrow, 20% wide — neither side dominates
const reachMixed = {
  per_sample_band_reach: (() => {
    const r = new Int8Array(20);
    for (let i = 0; i < 4; i++) r[i] = 1;        // 20% narrow
    for (let i = 4; i < 12; i++) r[i] = 3;       // 40% trough
    for (let i = 12; i < 16; i++) r[i] = 4;      // 20% wide
    for (let i = 16; i < 20; i++) r[i] = 2;
    return r;
  })(),
  K: 4, n_samples: 20,
};
const vUnd = BR.bandReachBimodalityFromReach(reachMixed);
check('mixed fixture: verdict = UNDETERMINED',
      vUnd.verdict === 'UNDETERMINED');

// -----------------------------------------------------------------------------
group('bandReachBimodality (full pipeline)');
const combined = BR.bandReachBimodality(_makeStableChain(3, 4), { K: 4 });
check('combined: verdict UNIMODAL_NARROW (stable fixture)',
      combined.verdict === 'UNIMODAL_NARROW');
check('combined: K propagated',            combined.K === 4);

check('combined: null clusters → null',    BR.bandReachBimodality(null) === null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
