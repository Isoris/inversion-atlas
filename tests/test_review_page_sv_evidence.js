// tests/test_review_page_sv_evidence.js
//
// Sub-module + main re-export coverage for the page_sv_evidence
// SV-evidence view (lifecycle scaffolding + verbatim chat-33
// thin-loader exports).
//
// Round 5 step 19 (chat 39, 2026-05-07): page_sv_evidence promoted
// from chat-33 "thin loader stub for window.AtlasSVEvidence" to the
// _pageState live-binding pattern + atlas-router mount/unmount
// lifecycle + state-aware public wrapper. **Direct twin of
// page6 + page7** (the first two migrated review-stage pages,
// shipped steps 17 + 18). Third (and final) review tier-1 thin-
// loader-stub migration; review group: 2 of 5 → 3 of 5.
//
// page_sv_evidence is a thin loader stub for an external renderer
// OBJECT (window.AtlasSVEvidence, with .init / .loadCandidate /
// .destroy methods, defined in js/atlas_sv_evidence.js). NB:
// structurally distinct from page6/page7, where the external
// renderer is a single function (window.renderPopstatsPage /
// window.renderAncestryPage). The chat-33 module exports
// showSvEvidencePage(state) and hideSvEvidencePage(); both
// preserved verbatim because the merge chat wires them into the
// tab dispatcher symmetrically.
//
// This test verifies:
//   - Both chat-33 thin-loader exports survive unchanged.
//   - Lifecycle exports present (mount + unmount + refreshPageSvEvidence).
//   - _state.js live-binding pattern.
//   - showSvEvidencePage gracefully handles missing window.AtlasSVEvidence
//     (the "fallback empty-state" path in the chat-33 body).
//   - hideSvEvidencePage gracefully handles missing window.AtlasSVEvidence
//     (early return — no throw).
//   - refreshPageSvEvidence(state) sets _pageState as side effect.
//
// Replaces the chat-33 batch-2 test_review_page_sv_evidence.js, which
// imported from `../inversion_review/page_sv_evidence.js` (pre-migration
// path) and was not run by the harness.

import * as svEv from '../atlases/inversion/pages/review/page_sv_evidence.js';
import * as state from '../atlases/inversion/pages/review/page_sv_evidence/_state.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('page_sv_evidence.js: lifecycle entry-points');
check('exports mount',                              typeof svEv.mount === 'function');
check('exports unmount',                            typeof svEv.unmount === 'function');
check('exports refreshPageSvEvidence (wrapper)',    typeof svEv.refreshPageSvEvidence === 'function');
check('__MODULE_ID__ NOT exported',                 !('__MODULE_ID__' in svEv));

// -----------------------------------------------------------------------------
group('page_sv_evidence.js: chat-33 thin-loader exports preserved verbatim');
check('exports showSvEvidencePage',                 typeof svEv.showSvEvidencePage === 'function');
check('exports hideSvEvidencePage',                 typeof svEv.hideSvEvidencePage === 'function');

// -----------------------------------------------------------------------------
group('_state.js: live-binding pattern');
check('exports _pageState',                         '_pageState' in state);
check('exports _setActiveState',                    typeof state._setActiveState === 'function');
check('_pageState starts null',                     state._pageState === null);
state._setActiveState({ marker: 'A' });
check('_setActiveState mutates _pageState',         state._pageState && state._pageState.marker === 'A');
state._setActiveState(null);
check('_setActiveState(null) clears',               state._pageState === null);

// -----------------------------------------------------------------------------
group('Pure helpers: chat-33 loader behaviour without window');
// In Node without a window polyfill, showSvEvidencePage() should early-
// return cleanly (typeof window === 'undefined' check at top).
let runOK = true; let runErr = null;
try { svEv.showSvEvidencePage({ candidate: null }); }
catch (e) { runOK = false; runErr = e; }
check('showSvEvidencePage(state) no-window → early return',
      runOK, runErr ? runErr.message : '');

let runOK2 = true; let runErr2 = null;
try { svEv.hideSvEvidencePage(); }
catch (e) { runOK2 = false; runErr2 = e; }
check('hideSvEvidencePage() no-window → early return',
      runOK2, runErr2 ? runErr2.message : '');

// -----------------------------------------------------------------------------
group('refreshPageSvEvidence(state) wrapper sets _pageState as a side effect');
state._setActiveState(null);
const synthState = { marker: 'B', candidate: null };
svEv.refreshPageSvEvidence(synthState);
check('_pageState set after refreshPageSvEvidence(state)',
      state._pageState === synthState);

// -----------------------------------------------------------------------------
group('refreshPageSvEvidence() with no args: degenerate fallback (does not throw)');
state._setActiveState({ marker: 'C', candidate: null });
let fbOK = true; let fbErr = null;
try { svEv.refreshPageSvEvidence(); }
catch (e) { fbOK = false; fbErr = e; }
check('refreshPageSvEvidence() no-arg fallback runs without throwing',
      fbOK, fbErr ? fbErr.message : '');

state._setActiveState(null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
