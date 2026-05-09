// tests/test_comparative_page16.js
//
// Sub-module + main re-export coverage + behavioural exercises for the
// page16 cross-species breakpoints page.
//
// Round 5 step 11 (chat 36, 2026-05-07): page16 refactored from chat-33
// "0 exports, bare-state, plain JS" pattern to atlas-router-compatible
// mount/unmount + _pageState live-binding. Same AST-aware patcher
// approach as page17/page18 (rounds 5 step 4-5): inject `const state =
// _pageState;` shim into every function body that reads bare `state`.
// 28 of 50 helpers got the shim (the other 22 are pure utilities not
// referencing state).
//
// Strategic value: page16 owns _csGetSyntenyBlocks + _csPermutationTest,
// previously runtime-guarded in page17. This round exports them
// explicitly so a follow-up round can promote page17's guards to
// imports.

import * as page16 from '../atlases/inversion/pages/comparative/page16.js';
import * as state  from '../atlases/inversion/pages/comparative/page16/_state.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('page16.js: lifecycle entry-points (NEW round 5 step 11)');
check('exports mount',                       typeof page16.mount === 'function');
check('exports unmount',                     typeof page16.unmount === 'function');
check('exports renderCrossSpeciesPage',      typeof page16.renderCrossSpeciesPage === 'function');

// -----------------------------------------------------------------------------
group('page16.js: render entry points (verbatim helpers, now exported)');
check('exports _renderCrossSpeciesPage',     typeof page16._renderCrossSpeciesPage === 'function');
check('exports _renderCrossSpeciesToolbar',  typeof page16._renderCrossSpeciesToolbar === 'function');
check('exports _renderCrossSpeciesCatalogue', typeof page16._renderCrossSpeciesCatalogue === 'function');
check('exports _renderCrossSpeciesFocus',    typeof page16._renderCrossSpeciesFocus === 'function');
check('exports _renderCrossSpeciesSynteny',  typeof page16._renderCrossSpeciesSynteny === 'function');
check('exports _renderCrossSpeciesDotplot',  typeof page16._renderCrossSpeciesDotplot === 'function');
check('exports _renderCrossSpeciesFocalVsBg', typeof page16._renderCrossSpeciesFocalVsBg === 'function');

// -----------------------------------------------------------------------------
group('page16.js: cross-page helpers (page17 reads via runtime guards)');
check('exports _csGetSyntenyBlocks (page17 guard target)',
      typeof page16._csGetSyntenyBlocks === 'function');
check('exports _csPermutationTest (page17 guard target)',
      typeof page16._csPermutationTest === 'function');
check('exports _csComputeSynteny',           typeof page16._csComputeSynteny === 'function');
check('exports _csSyntenyEdgesByChrom',      typeof page16._csSyntenyEdgesByChrom === 'function');
check('exports _csInversionContexts',        typeof page16._csInversionContexts === 'function');
check('exports _csBuildPermResultHtml',      typeof page16._csBuildPermResultHtml === 'function');

// -----------------------------------------------------------------------------
group('page16.js: IO helpers');
check('exports _isCrossSpeciesJSON',         typeof page16._isCrossSpeciesJSON === 'function');
check('exports _storeCrossSpecies',          typeof page16._storeCrossSpecies === 'function');
check('exports _persistCrossSpecies',        typeof page16._persistCrossSpecies === 'function');
check('exports _restoreCrossSpecies',        typeof page16._restoreCrossSpecies === 'function');
check('exports _clearCrossSpecies',          typeof page16._clearCrossSpecies === 'function');

// -----------------------------------------------------------------------------
group('page16.js: hover/event-wiring helpers');
check('exports _wireCsBpHoverOnCanvas',      typeof page16._wireCsBpHoverOnCanvas === 'function');
check('exports _wireCrossSpeciesKeys',       typeof page16._wireCrossSpeciesKeys === 'function');

// -----------------------------------------------------------------------------
group('page16.js: constants');
check('exports CROSS_SPECIES_LS_KEY',        typeof page16.CROSS_SPECIES_LS_KEY === 'string');
check('exports CROSS_SPECIES_TOOL',          page16.CROSS_SPECIES_TOOL === 'cross_species_breakpoints_v1');
check('exports CROSS_SPECIES_FLANK_DEFAULT_BP', page16.CROSS_SPECIES_FLANK_DEFAULT_BP === 100000);
check('exports CS_EVENT_DEF (object map)',   page16.CS_EVENT_DEF && typeof page16.CS_EVENT_DEF === 'object');
check('CS_EVENT_DEF has inversion key',      page16.CS_EVENT_DEF && page16.CS_EVENT_DEF.inversion);

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
check('rejects null',                        page16._isCrossSpeciesJSON(null) === false);
check('rejects empty object',                page16._isCrossSpeciesJSON({}) === false);
check('rejects wrong tool',                  page16._isCrossSpeciesJSON({ tool: 'wrong', schema_version: 1 }) === false);
check('accepts valid v1 shape',
      page16._isCrossSpeciesJSON({
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
try { page16.renderCrossSpeciesPage(probeState); } catch (e) { threw = true; }
// Whether it threw or not, _pageState should have been set first.
check('renderCrossSpeciesPage(state) sets _pageState as side-effect (even if render throws)',
      state._pageState === probeState);

if (savedDoc !== undefined) globalThis.document = savedDoc; else delete globalThis.document;
state._setActiveState(null);

// -----------------------------------------------------------------------------
group('Behavioural: _csGetSyntenyBlocks reads via _pageState (live-binding)');
state._setActiveState({ crossSpecies: null });
check('returns null when crossSpecies missing', page16._csGetSyntenyBlocks() === null);

state._setActiveState({ crossSpecies: { synteny_blocks: 'not-array' } });
check('returns null when synteny_blocks not array', page16._csGetSyntenyBlocks() === null);

const blocks = [{ gar_chr: 'LG12', mac_chr: 'CMA1', gar_start: 1e6, gar_end: 5e6 }];
state._setActiveState({ crossSpecies: { synteny_blocks: blocks } });
check('returns synteny_blocks array when present',
      page16._csGetSyntenyBlocks() === blocks);

state._setActiveState(null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
