// tests/test_discovery_haplotype_regimes.js (renamed from
// test_discovery_page22.js 2026-05-16 alongside page22 → haplotype_regimes).
//
// Unit coverage for the haplotype_regimes page — long-range haplotype regimes
// (Stage 4 bruteforce projection). Verifies the page module loads cleanly,
// exposes the atlas-router lifecycle (mount/unmount), and that its panel
// sub-modules export the surface the page wires together at runtime.
//
// The page keeps `_pageState` as a module-local closure (not exported via a
// `_state.js` partner — that pattern is the one used by page1/12/16/16b/17/18/21
// which expose a `_setActiveState` setter). So state-side coverage here is
// limited to lifecycle smoke; pipeline behaviour is exercised by the
// underlying shared/band_tracking/ tests (test_band_consensus.js).

import * as haplotypeRegimes from '../atlases/inversion/pages/discovery/haplotype_regimes.js';
import * as regimesPage from '../atlases/inversion/pages/discovery/haplotype_regimes/regimes_page.js';
import * as regimesPanel from '../atlases/inversion/pages/discovery/haplotype_regimes/regimes_panel.js';
import * as regimesPC1 from '../atlases/inversion/pages/discovery/haplotype_regimes/regimes_pc1_panel.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('haplotype_regimes.js: atlas-router lifecycle');
check('exports mount',   typeof haplotypeRegimes.mount === 'function');
check('exports unmount', typeof haplotypeRegimes.unmount === 'function');

// -----------------------------------------------------------------------------
group('regimes_page.js: orchestrator');
check('exports initRegimesPage',  typeof regimesPage.initRegimesPage === 'function');
check('exports computeGenomeView', typeof regimesPage.computeGenomeView === 'function');

// -----------------------------------------------------------------------------
group('regimes_panel.js: drawing + state surface');
const panelExports = [
  'PATTERN_CLASS_COLORS', 'DOSAGE_CLASS_COLOURS',
  'enumerateBandSubsets', 'maskToBands', 'maskLabel',
  'enumerateAdditiveBandSubsets', 'enumerateInformativeBandSubsets',
  'getActiveBandSubsets',
  'buildFocalVoter', 'buildFocalVoterTrack',
  'buildGenomeWindowList',
  '_dosageClassColour',
  'drawRegimesPanel', 'ensureRegimesTrack',
  'installRegimesKeyboardNav',
  'buildRegimesPanel', 'initRegimesPanelFromBandingResult',
];
for (const name of panelExports) {
  check(`exports ${name}`, name in regimesPanel,
    `missing from regimes_panel.js`);
}

// -----------------------------------------------------------------------------
group('regimes_pc1_panel.js: PC1 panel');
check('exports drawRegimesPC1Panel',  typeof regimesPC1.drawRegimesPC1Panel === 'function');
check('exports buildRegimesPC1Panel', typeof regimesPC1.buildRegimesPC1Panel === 'function');

// -----------------------------------------------------------------------------
group('Behavioural: pure helpers (no DOM)');

// maskToBands + maskLabel + enumerateBandSubsets are pure bit-math.
{
  const K = 3;
  // 2^3 - 1 = 7 non-empty subsets, plus full-mask = 8 total in enumerate.
  const subsets = regimesPanel.enumerateBandSubsets(K);
  check('enumerateBandSubsets(3) returns 7 non-empty subsets',
        Array.isArray(subsets) && subsets.length === 7,
        `got length=${subsets && subsets.length}`);

  const bands = regimesPanel.maskToBands(0b101, K);
  check('maskToBands(0b101, 3) → [0, 2]',
        Array.isArray(bands) && bands.length === 2 && bands[0] === 0 && bands[1] === 2,
        JSON.stringify(bands));

  const label = regimesPanel.maskLabel(0b101, K);
  check('maskLabel(0b101, 3) is a non-empty string',
        typeof label === 'string' && label.length > 0,
        `got "${label}"`);
}

// _dosageClassColour returns a string (CSS colour) for known classes.
{
  const c = regimesPanel._dosageClassColour('HET', 1);
  check('_dosageClassColour("HET", 1) returns a string',
        typeof c === 'string' && c.length > 0,
        `got "${c}"`);
}

// -----------------------------------------------------------------------------
group('Behavioural: PATTERN_CLASS_COLORS taxonomy');
// The taxonomy must be frozen and include the core classes that the
// projection layer can produce.
const requiredClasses = ['SINGLE', 'SUBSET', 'SUBSET_SPLIT', 'SPLIT_TWO',
                          'COHERENT_SPLIT', 'RANDOM_FAN', 'SCATTER', 'EMPTY'];
for (const klass of requiredClasses) {
  check(`PATTERN_CLASS_COLORS has entry for ${klass}`,
        klass in regimesPanel.PATTERN_CLASS_COLORS,
        `missing — not in taxonomy`);
}
check('PATTERN_CLASS_COLORS is frozen',
      Object.isFrozen(regimesPanel.PATTERN_CLASS_COLORS));

// -----------------------------------------------------------------------------
group('Behavioural: unmount tolerates being called without a prior mount');
// unmount nulls the module-local _pageState; calling it stand-alone should
// not throw (haplotypeRegimes stores no Set-of-listeners that needs teardown).
{
  let threw = false;
  try { await haplotypeRegimes.unmount(/* root */ null); }
  catch (e) { threw = true; }
  check('unmount(null) does not throw', !threw);
}

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
