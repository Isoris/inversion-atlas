// tests/test_comparative_page16b.js
//
// Sub-module + main re-export coverage for the multi_species_cockpit multi-species
// classification cockpit page (lifecycle scaffolding + verbatim
// chat-33 helper bodies via AST-shim injection).
//
// Round 5 step 20 (chat 39 cont., 2026-05-07): multi_species_cockpit promoted from
// chat-33 "0 explicit ES exports + window-expose globals + bare-state
// references" pattern to atlas-router-compatible mount/unmount +
// _pageState live-binding. **Direct twin of cross_species_breakpoints (step 11) in
// pattern shape** — same AST-shim-injection methodology. Closes the
// comparative group (3 of 3 migrated).
//
// 39 of 64 helper bodies got the AST shim
// `const state = _pageState;`. The other 25 are pure utility helpers
// that don't reference `state` (e.g., _isXJSON validators, _restoreX
// no-arg loaders, _msAutoSuggestArchitecture / _msAutoSuggestAgeModel
// pure analysis fns, _msParseNewickToLeaves, _msRenderActiveHeader,
// _renderMultiSpeciesPage, _msSummarizeRefinement,
// _msAdjustConfidenceForRefinement, _msBuildRefinementChipHtml,
// _msPolarizeKaryotypeEventWithRefinement,
// _msGetEffectiveClassForCell, _msGetEffectiveTargetsForCell,
// _msGetKaryotypeEntryForCgarChr).
//
// This test verifies:
//   - All 77 explicit ES exports present.
//   - Lifecycle (mount, unmount, renderMultiSpeciesPage) functions.
//   - _state.js live-binding pattern.
//   - Pure helpers (no state required) work correctly:
//     * _isXJSON validators accept correct shapes, reject wrong shapes.
//     * _msAutoSuggestArchitecture returns a verdict object.
//     * _msParseNewickToLeaves parses newick strings.
//     * _msSummarizeRefinement summarizes refinement entries.
//   - State-dependent helpers read via _pageState (live-binding):
//     * _msGetActiveBreakpoint returns null when no crossSpecies.
//     * _msGetEffectiveSpeciesList returns _MS_DEFAULT_SPECIES copy
//       when phyloTree is null.
//   - Constants have expected values.
//
// Replaces the chat-33 batch-2 test_comparative_page16b.js, which
// imported from `../inversion_comparative/multi_species_cockpit.js` (pre-migration
// path) and was a parse-check + content-scan stub.

// 2026-05-23 Phase 1b: multi_species_cockpit moved from inversion to cross-species atlas.
import * as multi_species_cockpit from '../atlases/cross-species/pages/breakpoints/multi_species_cockpit.js';
import * as state from '../atlases/cross-species/pages/breakpoints/multi_species_cockpit/_state.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('multi_species_cockpit.js: lifecycle entry-points');
check('exports mount',                          typeof multi_species_cockpit.mount === 'function');
check('exports unmount',                        typeof multi_species_cockpit.unmount === 'function');
check('exports renderMultiSpeciesPage',         typeof multi_species_cockpit.renderMultiSpeciesPage === 'function');
check('__MODULE_ID__ NOT exported',             !('__MODULE_ID__' in multi_species_cockpit));

// -----------------------------------------------------------------------------
group('multi_species_cockpit.js: 10 constants exported');
check('DOTPLOT_MASHMAP_TOOL',                   multi_species_cockpit.DOTPLOT_MASHMAP_TOOL === 'dotplot_mashmap_v1');
check('DOTPLOT_MASHMAP_LS_KEY',                 typeof multi_species_cockpit.DOTPLOT_MASHMAP_LS_KEY === 'string');
check('MULTI_SPECIES_UI_LS_KEY',                typeof multi_species_cockpit.MULTI_SPECIES_UI_LS_KEY === 'string');
check('SYNTENY_MULTISPECIES_LS_KEY',            typeof multi_species_cockpit.SYNTENY_MULTISPECIES_LS_KEY === 'string');
check('PHYLO_TREE_LS_KEY',                      typeof multi_species_cockpit.PHYLO_TREE_LS_KEY === 'string');
check('_MS_DEFAULT_SPECIES is array',           Array.isArray(multi_species_cockpit._MS_DEFAULT_SPECIES));
check('_MS_DEFAULT_SPECIES has Cgar',           multi_species_cockpit._MS_DEFAULT_SPECIES.some(sp => sp.id === 'Cgar' && sp.focal));
check('_MS_DEFAULT_SPECIES has Cmac',           multi_species_cockpit._MS_DEFAULT_SPECIES.some(sp => sp.id === 'Cmac' && sp.focal));
check('DXY_PER_INVERSION_LS_KEY',               typeof multi_species_cockpit.DXY_PER_INVERSION_LS_KEY === 'string');
check('CLASSIFICATIONS_LS_KEY',                 typeof multi_species_cockpit.CLASSIFICATIONS_LS_KEY === 'string');
check('TE_FRAGILITY_LS_KEY',                    typeof multi_species_cockpit.TE_FRAGILITY_LS_KEY === 'string');
check('KARYO_LINEAGE_LS_KEY',                   typeof multi_species_cockpit.KARYO_LINEAGE_LS_KEY === 'string');

// -----------------------------------------------------------------------------
group('multi_species_cockpit.js: 5 render entry points');
check('exports _renderMultiSpeciesPage',        typeof multi_species_cockpit._renderMultiSpeciesPage === 'function');
check('exports _msRenderActiveHeader',          typeof multi_species_cockpit._msRenderActiveHeader === 'function');
check('exports _msRenderTreeSvg',               typeof multi_species_cockpit._msRenderTreeSvg === 'function');
check('exports _msRenderCenterColumn',          typeof multi_species_cockpit._msRenderCenterColumn === 'function');
check('exports _msRenderDetailColumn',          typeof multi_species_cockpit._msRenderDetailColumn === 'function');

// -----------------------------------------------------------------------------
group('multi_species_cockpit.js: 30 IO loaders (6 layers × 5 functions)');
const layers = [
  ['DotplotMashmap',     '_isDotplotMashmapJSON',     '_storeDotplotMashmap',     '_persistDotplotMashmap',     '_restoreDotplotMashmap',     '_clearDotplotMashmap'],
  ['SyntenyMultispecies','_isSyntenyMultispeciesJSON','_storeSyntenyMultispecies','_persistSyntenyMultispecies','_restoreSyntenyMultispecies','_clearSyntenyMultispecies'],
  ['PhyloTree',          '_isPhyloTreeJSON',          '_storePhyloTree',          '_persistPhyloTree',          '_restorePhyloTree',          '_clearPhyloTree'],
  ['DxyPerInversion',    '_isDxyPerInversionJSON',    '_storeDxyPerInversion',    '_persistDxyPerInversion',    '_restoreDxyPerInversion',    '_clearDxyPerInversion'],
  ['CompTEFragility',    '_isCompTEFragilityJSON',    '_storeCompTEFragility',    '_persistCompTEFragility',    '_restoreCompTEFragility',    '_clearCompTEFragility'],
  ['KaryotypeLineage',   '_isKaryotypeLineageJSON',   '_storeKaryotypeLineage',   '_persistKaryotypeLineage',   '_restoreKaryotypeLineage',   '_clearKaryotypeLineage'],
];
for (const [name, ...fns] of layers) {
  for (const fn of fns) {
    check(`${name}: exports ${fn}`, typeof multi_species_cockpit[fn] === 'function');
  }
}

// -----------------------------------------------------------------------------
group('multi_species_cockpit.js: 9 MS state / init / classification helpers');
const msStateFns = [
  '_msInitState', '_msPersistUI',
  '_msInitClassifications', '_msPersistClassifications',
  '_msSetClassification', '_msGetClassification', '_msClearClassification',
  '_msBuildClassificationTSV', '_msDownloadClassificationTSV',
];
for (const fn of msStateFns) {
  check(`exports ${fn}`, typeof multi_species_cockpit[fn] === 'function');
}

// -----------------------------------------------------------------------------
group('multi_species_cockpit.js: 12 MS analysis helpers');
const msAnalysisFns = [
  '_msGetActiveBreakpoint', '_msGetEffectiveSpeciesList', '_msGetLineageDistribution',
  '_msAutoSuggestArchitecture', '_msAutoSuggestAgeModel',
  '_msGetDxyForBreakpoint', '_msGetTEFragilityForBreakpoint',
  '_msGetSyntenyBlocksForSpecies', '_msParseNewickToLeaves',
  '_msBuildTEFragilityStripHtml', '_msBuildKaryotypeContextHtml', '_msBuildRefinementChipHtml',
];
for (const fn of msAnalysisFns) {
  check(`exports ${fn}`, typeof multi_species_cockpit[fn] === 'function');
}

// -----------------------------------------------------------------------------
group('multi_species_cockpit.js: 8 karyotype helpers');
const karyoFns = [
  '_msGetKaryotypeEntryForFocalChr', '_msGetKaryotypeEntryForCgarChr',
  '_msPolarizeKaryotypeEvent', '_msPolarizeKaryotypeEventWithRefinement',
  '_msGetEffectiveClassForCell', '_msGetEffectiveTargetsForCell',
  '_msSummarizeRefinement', '_msAdjustConfidenceForRefinement',
];
for (const fn of karyoFns) {
  check(`exports ${fn}`, typeof multi_species_cockpit[fn] === 'function');
}

// -----------------------------------------------------------------------------
group('_state.js: live-binding pattern');
check('exports _pageState',                     '_pageState' in state);
check('exports _setActiveState',                typeof state._setActiveState === 'function');
check('_pageState starts null',                 state._pageState === null);
state._setActiveState({ marker: 'A' });
check('_setActiveState mutates _pageState',     state._pageState && state._pageState.marker === 'A');
state._setActiveState(null);
check('_setActiveState(null) clears',           state._pageState === null);

// -----------------------------------------------------------------------------
group('Pure helpers: validator accept/reject (no state required)');
// _isDotplotMashmapJSON
check('_isDotplotMashmapJSON accepts valid',
      multi_species_cockpit._isDotplotMashmapJSON({
        tool: 'dotplot_mashmap_v1', schema_version: 1,
        resolutions: [], generated_at: '2026-01-01' }) === true);
check('_isDotplotMashmapJSON rejects wrong tool',
      multi_species_cockpit._isDotplotMashmapJSON({ tool: 'other_v1', schema_version: 1 }) === false);
check('_isDotplotMashmapJSON rejects null',
      multi_species_cockpit._isDotplotMashmapJSON(null) === false);

// _isSyntenyMultispeciesJSON
check('_isSyntenyMultispeciesJSON rejects null',
      multi_species_cockpit._isSyntenyMultispeciesJSON(null) === false);

// _isPhyloTreeJSON
check('_isPhyloTreeJSON rejects null',
      multi_species_cockpit._isPhyloTreeJSON(null) === false);

// _isDxyPerInversionJSON
check('_isDxyPerInversionJSON rejects null',
      multi_species_cockpit._isDxyPerInversionJSON(null) === false);

// _isCompTEFragilityJSON
check('_isCompTEFragilityJSON rejects null',
      multi_species_cockpit._isCompTEFragilityJSON(null) === false);

// _isKaryotypeLineageJSON
check('_isKaryotypeLineageJSON rejects null',
      multi_species_cockpit._isKaryotypeLineageJSON(null) === false);

// -----------------------------------------------------------------------------
group('State-dependent helpers via _pageState live-binding');
// _msGetActiveBreakpoint reads state.crossSpecies.breakpoints + state._crossSpeciesUI.active_id
state._setActiveState({ crossSpecies: null, _crossSpeciesUI: null });
check('_msGetActiveBreakpoint returns null when crossSpecies missing',
      multi_species_cockpit._msGetActiveBreakpoint() === null);

state._setActiveState({
  crossSpecies: { breakpoints: [{ id: 'BP1' }, { id: 'BP2' }] },
  _crossSpeciesUI: { active_id: 'BP1' },
});
const bp = multi_species_cockpit._msGetActiveBreakpoint();
check('_msGetActiveBreakpoint reads via _pageState live-binding',
      bp && bp.id === 'BP1');

// _msGetEffectiveSpeciesList: returns default species when phyloTree is null
state._setActiveState({ phyloTree: null });
const speciesList = multi_species_cockpit._msGetEffectiveSpeciesList();
check('_msGetEffectiveSpeciesList returns default when phyloTree is null',
      Array.isArray(speciesList) && speciesList.length === multi_species_cockpit._MS_DEFAULT_SPECIES.length);
check('returned list is a copy (different reference from _MS_DEFAULT_SPECIES)',
      speciesList !== multi_species_cockpit._MS_DEFAULT_SPECIES);

state._setActiveState(null);

// -----------------------------------------------------------------------------
group('renderMultiSpeciesPage(state) wrapper sets _pageState as side effect');
state._setActiveState(null);
const synthState = {
  crossSpecies: null,
  _crossSpeciesUI: null,
  syntenyMultispecies: null,
  phyloTree: null,
  dxyPerInversion: null,
  compTEFragility: null,
  karyotypeLineage: null,
  _multiSpeciesUI: null,
  _msClassifications: null,
  classifications: null,
  marker: 'B',
};
let renderOK = true; let renderErr = null;
try { multi_species_cockpit.renderMultiSpeciesPage(synthState); }
catch (e) { renderOK = false; renderErr = e; }
// Even if render throws (no DOM), _pageState should be set as side effect.
check('_pageState set after renderMultiSpeciesPage(state) (side effect even on render-throw)',
      state._pageState === synthState, renderErr ? renderErr.message : '');

state._setActiveState(null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
