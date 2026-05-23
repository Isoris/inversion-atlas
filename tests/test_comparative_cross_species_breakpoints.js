// tests/test_comparative_page16.js
//
// Sub-module + main re-export coverage + behavioural exercises for the
// cross_species_breakpoints cross-species breakpoints page.
//
// Round 5 step 11 (chat 36, 2026-05-07): cross_species_breakpoints refactored from chat-33
// "0 exports, bare-state, plain JS" pattern to atlas-router-compatible
// mount/unmount + _pageState live-binding. Same AST-aware patcher
// approach as stats_profile/marker_readiness (rounds 5 step 4-5): inject `const state =
// _pageState;` shim into every function body that reads bare `state`.
// 28 of 50 helpers got the shim (the other 22 are pure utilities not
// referencing state).
//
// Strategic value: cross_species_breakpoints owns _csGetSyntenyBlocks + _csPermutationTest,
// previously runtime-guarded in stats_profile. This round exports them
// explicitly so a follow-up round can promote stats_profile's guards to
// imports.

// 2026-05-23 Phase 1b: cross_species_breakpoints moved from inversion to cross-species atlas.
import * as cross_species_breakpoints from '../atlases/cross-species/pages/breakpoints/cross_species_breakpoints.js';
import * as state  from '../atlases/cross-species/pages/breakpoints/cross_species_breakpoints/_state.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('cross_species_breakpoints.js: lifecycle entry-points (NEW round 5 step 11)');
check('exports mount',                       typeof cross_species_breakpoints.mount === 'function');
check('exports unmount',                     typeof cross_species_breakpoints.unmount === 'function');
check('exports renderCrossSpeciesPage',      typeof cross_species_breakpoints.renderCrossSpeciesPage === 'function');

// -----------------------------------------------------------------------------
group('cross_species_breakpoints.js: render entry points (verbatim helpers, now exported)');
check('exports _renderCrossSpeciesPage',     typeof cross_species_breakpoints._renderCrossSpeciesPage === 'function');
check('exports _renderCrossSpeciesToolbar',  typeof cross_species_breakpoints._renderCrossSpeciesToolbar === 'function');
check('exports _renderCrossSpeciesCatalogue', typeof cross_species_breakpoints._renderCrossSpeciesCatalogue === 'function');
check('exports _renderCrossSpeciesFocus',    typeof cross_species_breakpoints._renderCrossSpeciesFocus === 'function');
check('exports _renderCrossSpeciesSynteny',  typeof cross_species_breakpoints._renderCrossSpeciesSynteny === 'function');
check('exports _renderCrossSpeciesDotplot',  typeof cross_species_breakpoints._renderCrossSpeciesDotplot === 'function');
check('exports _renderCrossSpeciesFocalVsBg', typeof cross_species_breakpoints._renderCrossSpeciesFocalVsBg === 'function');

// -----------------------------------------------------------------------------
group('cross_species_breakpoints.js: cross-page helpers (stats_profile reads via runtime guards)');
check('exports _csGetSyntenyBlocks (stats_profile guard target)',
      typeof cross_species_breakpoints._csGetSyntenyBlocks === 'function');
check('exports _csPermutationTest (stats_profile guard target)',
      typeof cross_species_breakpoints._csPermutationTest === 'function');
check('exports _csComputeSynteny',           typeof cross_species_breakpoints._csComputeSynteny === 'function');
check('exports _csSyntenyEdgesByChrom',      typeof cross_species_breakpoints._csSyntenyEdgesByChrom === 'function');
check('exports _csInversionContexts',        typeof cross_species_breakpoints._csInversionContexts === 'function');
check('exports _csBuildPermResultHtml',      typeof cross_species_breakpoints._csBuildPermResultHtml === 'function');

// -----------------------------------------------------------------------------
group('cross_species_breakpoints.js: IO helpers');
check('exports _isCrossSpeciesJSON',         typeof cross_species_breakpoints._isCrossSpeciesJSON === 'function');
check('exports _storeCrossSpecies',          typeof cross_species_breakpoints._storeCrossSpecies === 'function');
check('exports _persistCrossSpecies',        typeof cross_species_breakpoints._persistCrossSpecies === 'function');
check('exports _restoreCrossSpecies',        typeof cross_species_breakpoints._restoreCrossSpecies === 'function');
check('exports _clearCrossSpecies',          typeof cross_species_breakpoints._clearCrossSpecies === 'function');

// -----------------------------------------------------------------------------
group('cross_species_breakpoints.js: hover/event-wiring helpers');
check('exports _wireCsBpHoverOnCanvas',      typeof cross_species_breakpoints._wireCsBpHoverOnCanvas === 'function');
check('exports _wireCrossSpeciesKeys',       typeof cross_species_breakpoints._wireCrossSpeciesKeys === 'function');

// -----------------------------------------------------------------------------
group('cross_species_breakpoints.js: constants');
check('exports CROSS_SPECIES_LS_KEY',        typeof cross_species_breakpoints.CROSS_SPECIES_LS_KEY === 'string');
check('exports CROSS_SPECIES_TOOL',          cross_species_breakpoints.CROSS_SPECIES_TOOL === 'cross_species_breakpoints_v1');
check('exports CROSS_SPECIES_FLANK_DEFAULT_BP', cross_species_breakpoints.CROSS_SPECIES_FLANK_DEFAULT_BP === 100000);
check('exports CS_EVENT_DEF (object map)',   cross_species_breakpoints.CS_EVENT_DEF && typeof cross_species_breakpoints.CS_EVENT_DEF === 'object');
check('CS_EVENT_DEF has inversion key',      cross_species_breakpoints.CS_EVENT_DEF && cross_species_breakpoints.CS_EVENT_DEF.inversion);

// -----------------------------------------------------------------------------
group('_state.js: live-binding pattern');
check('exports _pageState',                  '_pageState' in state);
check('exports _setActiveState',             typeof state._setActiveState === 'function');
state._setActiveState(null);
check('_pageState clearable',                state._pageState === null);
state._setActiveState({ marker: 'P16' });
check('_setActiveState mutates _pageState',  state._pageState && state._pageState.marker === 'P16');
state._setActiveState(null);

// -----------------------------------------------------------------------------
group('Behavioural: _isCrossSpeciesJSON (verbatim, no state needed)');
check('rejects null',                        cross_species_breakpoints._isCrossSpeciesJSON(null) === false);
check('rejects empty object',                cross_species_breakpoints._isCrossSpeciesJSON({}) === false);
check('rejects wrong tool',                  cross_species_breakpoints._isCrossSpeciesJSON({ tool: 'wrong', schema_version: 1 }) === false);
check('accepts valid v1 shape',
      cross_species_breakpoints._isCrossSpeciesJSON({
        tool: 'cross_species_breakpoints_v1',
        schema_version: 1,
        breakpoints: [],
      }) === true);

// -----------------------------------------------------------------------------
group('State-aware wrapper: renderCrossSpeciesPage(state) sets _pageState');
state._setActiveState(null);

// We pass a state object that has just enough to keep render functions
// from throwing. A real document is needed for the actual DOM writes,
// but for this assertion we only care that _pageState is wired up.
const probeState = {
  crossSpecies: null,
  candidateList: [],
  _crossSpeciesUI: { active_id: null, sort: 'pos', filter: { search: '' } },
};
// renderCrossSpeciesPage will throw without document, so we stub it.
const savedDoc = (typeof globalThis.document !== 'undefined') ? globalThis.document : undefined;
globalThis.document = {
  getElementById: () => null,
  querySelector:  () => null,
  querySelectorAll: () => [],
  createElement: () => ({
    style: {},
    setAttribute: () => {},
    appendChild: () => {},
    innerHTML: '',
    textContent: '',
    addEventListener: () => {},
  }),
};
let threw = false;
try { cross_species_breakpoints.renderCrossSpeciesPage(probeState); } catch (e) { threw = true; }
// Whether it threw or not, _pageState should have been set first.
check('renderCrossSpeciesPage(state) sets _pageState as side-effect (even if render throws)',
      state._pageState === probeState);

if (savedDoc !== undefined) globalThis.document = savedDoc; else delete globalThis.document;
state._setActiveState(null);

// -----------------------------------------------------------------------------
group('Behavioural: _csGetSyntenyBlocks reads via _pageState (live-binding)');
state._setActiveState({ crossSpecies: null });
check('returns null when crossSpecies missing', cross_species_breakpoints._csGetSyntenyBlocks() === null);

state._setActiveState({ crossSpecies: { synteny_blocks: 'not-array' } });
check('returns null when synteny_blocks not array', cross_species_breakpoints._csGetSyntenyBlocks() === null);

const blocks = [{ gar_chr: 'LG12', mac_chr: 'CMA1', gar_start: 1e6, gar_end: 5e6 }];
state._setActiveState({ crossSpecies: { synteny_blocks: blocks } });
check('returns synteny_blocks array when present',
      cross_species_breakpoints._csGetSyntenyBlocks() === blocks);

state._setActiveState(null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
