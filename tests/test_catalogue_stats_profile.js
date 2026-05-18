// tests/test_catalogue_page17.js
//
// Sub-module + main re-export coverage + pure-helper exercises for the
// stats_profile stats profile page.
//
// Round 5 step 5 (chat 36, 2026-05-07): stats_profile refactored from chat-33
// "single-file with const state = window.state || {}" pattern to the
// _pageState live-binding pattern + atlas-router mount/unmount lifecycle.
// Body kept as a single file (vs sub-module split) — matches the marker_readiness
// decision (cohesive single-concern code, ~939 LOC base).
//
// Page17 imports:
//   - _esc from shared/page1_data_helpers.js (HTML escape, 18 sites)
//   - _mpDeriveAutoPanel from marker_readiness.js (sibling synthesis page)
// Both were previously unresolved globals (fail-on-load) — now properly
// imported.

import * as stats_profile from '../atlases/inversion/pages/catalogue/stats_profile.js';
import * as state  from '../atlases/inversion/pages/catalogue/stats_profile/_state.js';
import * as marker_readiness from '../atlases/inversion/pages/catalogue/marker_readiness.js';
import * as cross_species_breakpoints from '../atlases/inversion/pages/comparative/cross_species_breakpoints.js';
import * as page16state from '../atlases/inversion/pages/comparative/cross_species_breakpoints/_state.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('stats_profile.js: lifecycle entry-points');
check('exports mount',                    typeof stats_profile.mount === 'function');
check('exports unmount',                  typeof stats_profile.unmount === 'function');
check('exports renderStatsProfilePage',   typeof stats_profile.renderStatsProfilePage === 'function');

// -----------------------------------------------------------------------------
group('stats_profile.js: stats-profile domain helpers');
const expectedHelpers = [
  '_spEnsureState',
  '_spRefreshDerivedRows',
  '_spDeriveAllRows',
  '_spDeriveCsPermutation',
  '_spDeriveRepeatFlankSpalax',
  '_spDeriveFusionFission',
  '_spDeriveMarkerability',
  '_spIsValidProfileJson',
  '_spMergeUserJson',
  '_spParseTsv',
  '_spExportCsv',
  '_spExportSvg',
  '_spIngestText',
];
for (const name of expectedHelpers) {
  check(`exports ${name}`, typeof stats_profile[name] === 'function');
}

// -----------------------------------------------------------------------------
group('stats_profile.js: constants');
check('SP_ALPHA = 0.05',                          stats_profile.SP_ALPHA === 0.05);
check('SP_EFFECT_COLORS is object',               typeof stats_profile.SP_EFFECT_COLORS === 'object');
check('SP_EFFECT_COLORS.enriched present',        'enriched' in stats_profile.SP_EFFECT_COLORS);
check('SP_EFFECT_COLORS.depleted present',        'depleted' in stats_profile.SP_EFFECT_COLORS);
check('SP_DEFAULT_ROWS is array',                 Array.isArray(stats_profile.SP_DEFAULT_ROWS));
check('SP_DEFAULT_ROWS non-empty',                stats_profile.SP_DEFAULT_ROWS.length > 0);

// -----------------------------------------------------------------------------
group('_state.js: live-binding pattern');
check('exports _pageState',          '_pageState' in state);
check('exports _setActiveState',     typeof state._setActiveState === 'function');
check('_pageState starts null',      state._pageState === null);
state._setActiveState({ marker: 'A' });
check('_setActiveState mutates _pageState',  state._pageState && state._pageState.marker === 'A');
state._setActiveState(null);
check('_setActiveState(null) clears',         state._pageState === null);

// -----------------------------------------------------------------------------
group('Cross-page import: marker_readiness._mpDeriveAutoPanel');
// Verify the import resolved — stats_profile should have imported it from marker_readiness.
// Indirect verification: the stats_profile module loads without ReferenceError,
// which it would throw if the import was unresolved.
check('marker_readiness._mpDeriveAutoPanel is function',
      typeof marker_readiness._mpDeriveAutoPanel === 'function');

// -----------------------------------------------------------------------------
group('Cross-page import: cross_species_breakpoints._csGetSyntenyBlocks + _csPermutationTest (round 5 step 12)');
// Round 5 step 12: stats_profile promoted its runtime guards
// (typeof _csGetSyntenyBlocks === 'function') to explicit imports from
// ../comparative/cross_species_breakpoints.js. Verify the imports resolved AND the bridge
// pattern (stats_profile calling cross_species_breakpoints's _setActiveState) actually wires
// crossSpecies through cross_species_breakpoints's _pageState.
check('cross_species_breakpoints._csGetSyntenyBlocks is function',
      typeof cross_species_breakpoints._csGetSyntenyBlocks === 'function');
check('cross_species_breakpoints._csPermutationTest is function',
      typeof cross_species_breakpoints._csPermutationTest === 'function');
check('cross_species_breakpoints._setActiveState is function',
      typeof page16state._setActiveState === 'function');

// Behavioural: cross_species_breakpoints._csGetSyntenyBlocks reads via cross_species_breakpoints's _pageState.
// Set cross_species_breakpoints's state to a legacy-shape object that mimics what
// stats_profile.mount's _buildLegacyState would produce, then verify
// _csGetSyntenyBlocks returns the bridged synteny_blocks.
const fakeBlocks = [
  { gar_chr: 'LG12', gar_start_bp: 5_000_000, gar_end_bp: 8_000_000,
    mac_chr: 'CMA01', mac_start_bp: 4_000_000, mac_end_bp: 7_000_000 },
];
page16state._setActiveState({
  crossSpecies: { synteny_blocks: fakeBlocks, breakpoints: [] },
  candidateList: [],
});
const blocks = cross_species_breakpoints._csGetSyntenyBlocks();
check('_csGetSyntenyBlocks returns bridged synteny_blocks',
      Array.isArray(blocks) && blocks.length === 1 && blocks[0].gar_chr === 'LG12');

// Verify null-safety: when crossSpecies missing, returns null (no throw).
page16state._setActiveState({ crossSpecies: null, candidateList: [] });
check('_csGetSyntenyBlocks returns null when crossSpecies missing',
      cross_species_breakpoints._csGetSyntenyBlocks() === null);

// Reset cross_species_breakpoints state for downstream tests.
page16state._setActiveState(null);


check('valid profile JSON shape accepted (metadata + summary_rows)',
      stats_profile._spIsValidProfileJson({ metadata: { schema: 'v1' }, summary_rows: [] }));
check('null returns false',                  !stats_profile._spIsValidProfileJson(null));
check('non-object returns false',            !stats_profile._spIsValidProfileJson('string'));
check('missing metadata returns false',      !stats_profile._spIsValidProfileJson({ summary_rows: [] }));
check('missing summary_rows returns false',  !stats_profile._spIsValidProfileJson({ metadata: {} }));
check('summary_rows not array returns false',
      !stats_profile._spIsValidProfileJson({ metadata: {}, summary_rows: 'oops' }));

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
