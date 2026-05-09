// tests/test_catalogue_page17.js
//
// Sub-module + main re-export coverage + pure-helper exercises for the
// page17 stats profile page.
//
// Round 5 step 5 (chat 36, 2026-05-07): page17 refactored from chat-33
// "single-file with const state = window.state || {}" pattern to the
// _pageState live-binding pattern + atlas-router mount/unmount lifecycle.
// Body kept as a single file (vs sub-module split) — matches the page18
// decision (cohesive single-concern code, ~939 LOC base).
//
// Page17 imports:
//   - _esc from shared/page1_data_helpers.js (HTML escape, 18 sites)
//   - _mpDeriveAutoPanel from page18.js (sibling synthesis page)
// Both were previously unresolved globals (fail-on-load) — now properly
// imported.

import * as page17 from '../atlases/inversion/pages/catalogue/page17.js';
import * as state  from '../atlases/inversion/pages/catalogue/page17/_state.js';
import * as page18 from '../atlases/inversion/pages/catalogue/page18.js';
import * as page16 from '../atlases/inversion/pages/comparative/page16.js';
import * as page16state from '../atlases/inversion/pages/comparative/page16/_state.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('page17.js: lifecycle entry-points');
check('exports mount',                    typeof page17.mount === 'function');
check('exports unmount',                  typeof page17.unmount === 'function');
check('exports renderStatsProfilePage',   typeof page17.renderStatsProfilePage === 'function');

// -----------------------------------------------------------------------------
group('page17.js: stats-profile domain helpers');
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
  check(`exports ${name}`, typeof page17[name] === 'function');
}

// -----------------------------------------------------------------------------
group('page17.js: constants');
check('SP_ALPHA = 0.05',                          page17.SP_ALPHA === 0.05);
check('SP_EFFECT_COLORS is object',               typeof page17.SP_EFFECT_COLORS === 'object');
check('SP_EFFECT_COLORS.enriched present',        'enriched' in page17.SP_EFFECT_COLORS);
check('SP_EFFECT_COLORS.depleted present',        'depleted' in page17.SP_EFFECT_COLORS);
check('SP_DEFAULT_ROWS is array',                 Array.isArray(page17.SP_DEFAULT_ROWS));
check('SP_DEFAULT_ROWS non-empty',                page17.SP_DEFAULT_ROWS.length > 0);

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
group('Cross-page import: page18._mpDeriveAutoPanel');
// Verify the import resolved — page17 should have imported it from page18.
// Indirect verification: the page17 module loads without ReferenceError,
// which it would throw if the import was unresolved.
check('page18._mpDeriveAutoPanel is function',
      typeof page18._mpDeriveAutoPanel === 'function');

// -----------------------------------------------------------------------------
group('Cross-page import: page16._csGetSyntenyBlocks + _csPermutationTest (round 5 step 12)');
// Round 5 step 12: page17 promoted its runtime guards
// (typeof _csGetSyntenyBlocks === 'function') to explicit imports from
// ../comparative/page16.js. Verify the imports resolved AND the bridge
// pattern (page17 calling page16's _setActiveState) actually wires
// crossSpecies through page16's _pageState.
check('page16._csGetSyntenyBlocks is function',
      typeof page16._csGetSyntenyBlocks === 'function');
check('page16._csPermutationTest is function',
      typeof page16._csPermutationTest === 'function');
check('page16._setActiveState is function',
      typeof page16state._setActiveState === 'function');

// Behavioural: page16._csGetSyntenyBlocks reads via page16's _pageState.
// Set page16's state to a legacy-shape object that mimics what
// page17.mount's _buildLegacyState would produce, then verify
// _csGetSyntenyBlocks returns the bridged synteny_blocks.
const fakeBlocks = [
  { gar_chr: 'LG12', gar_start_bp: 5_000_000, gar_end_bp: 8_000_000,
    mac_chr: 'CMA01', mac_start_bp: 4_000_000, mac_end_bp: 7_000_000 },
];
page16state._setActiveState({
  crossSpecies: { synteny_blocks: fakeBlocks, breakpoints: [] },
  candidateList: [],
});
const blocks = page16._csGetSyntenyBlocks();
check('_csGetSyntenyBlocks returns bridged synteny_blocks',
      Array.isArray(blocks) && blocks.length === 1 && blocks[0].gar_chr === 'LG12');

// Verify null-safety: when crossSpecies missing, returns null (no throw).
page16state._setActiveState({ crossSpecies: null, candidateList: [] });
check('_csGetSyntenyBlocks returns null when crossSpecies missing',
      page16._csGetSyntenyBlocks() === null);

// Reset page16 state for downstream tests.
page16state._setActiveState(null);


check('valid profile JSON shape accepted (metadata + summary_rows)',
      page17._spIsValidProfileJson({ metadata: { schema: 'v1' }, summary_rows: [] }));
check('null returns false',                  !page17._spIsValidProfileJson(null));
check('non-object returns false',            !page17._spIsValidProfileJson('string'));
check('missing metadata returns false',      !page17._spIsValidProfileJson({ summary_rows: [] }));
check('missing summary_rows returns false',  !page17._spIsValidProfileJson({ metadata: {} }));
check('summary_rows not array returns false',
      !page17._spIsValidProfileJson({ metadata: {}, summary_rows: 'oops' }));

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
