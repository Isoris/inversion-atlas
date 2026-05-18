// tests/test_catalogue_page21.js
//
// Sub-module + main re-export coverage + pure-helper exercises for the
// annotation_cockpit annotation cockpit page.
//
// Round 5 step 6 (chat 36, 2026-05-07): annotation_cockpit refactored from chat-33
// "single-file with const state = window.state || {}" pattern to the
// _pageState live-binding pattern + atlas-router mount/unmount lifecycle.
// Body kept as a single file (vs sub-module split) — matches stats_profile/marker_readiness
// (cohesive single-concern code, ~720 LOC base).
//
// Page21 has NO new cross-page imports (the 4 external helpers
// _gatherActiveCandidatesForInheritance, _wireCandidateHaplotypeAnnotations,
// candidateHaplotypeAnnotationsHtml, computeTrackedLinkageProjection are
// kept as runtime `typeof X === 'function'` guards — they will land
// naturally with page2/cross_species_breakpoints migration).

import * as annotation_cockpit from '../atlases/inversion/pages/catalogue/annotation_cockpit.js';
import * as state  from '../atlases/inversion/pages/catalogue/annotation_cockpit/_state.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('annotation_cockpit.js: lifecycle entry-points');
check('exports mount',                        typeof annotation_cockpit.mount === 'function');
check('exports unmount',                      typeof annotation_cockpit.unmount === 'function');
check('exports refreshAnnotationCockpit',     typeof annotation_cockpit.refreshAnnotationCockpit === 'function');

// -----------------------------------------------------------------------------
group('annotation_cockpit.js: cockpit-domain helpers');
const expectedHelpers = [
  '_annoCockpitInit',
  '_annoCockpitDraw',
  '_annoCockpitOnKey',
  '_annoCockpitOnClick',
  '_annoCockpitUpdateReadouts',
  '_annoCockpitCandidateAtCursor',
  '_annoCockpitChromExtent',
  '_annoCockpitRenderLinkagePanel',
  '_annoCockpitRenderHapPanel',
  '_ackBandColor',
  '_ackEnsureState',
];
for (const name of expectedHelpers) {
  check(`exports ${name}`, typeof annotation_cockpit[name] === 'function');
}

// -----------------------------------------------------------------------------
group('annotation_cockpit.js: constants');
check('_ACK_PAD is object',                       annotation_cockpit._ACK_PAD && typeof annotation_cockpit._ACK_PAD === 'object');
check('_ACK_PAD has l/r/t/b',                     'l' in annotation_cockpit._ACK_PAD && 'r' in annotation_cockpit._ACK_PAD
                                                  && 't' in annotation_cockpit._ACK_PAD && 'b' in annotation_cockpit._ACK_PAD);
check('_ACK_LINE_ALPHA is number',                typeof annotation_cockpit._ACK_LINE_ALPHA === 'number');
check('_ACK_HIGHLIGHT_ALPHA is number',           typeof annotation_cockpit._ACK_HIGHLIGHT_ALPHA === 'number');
check('_ACK_CURSOR_COLOR is string',              typeof annotation_cockpit._ACK_CURSOR_COLOR === 'string');
check('_ACK_BAND_PALETTE is array',               Array.isArray(annotation_cockpit._ACK_BAND_PALETTE));
check('_ACK_BAND_PALETTE has 6 colors',           annotation_cockpit._ACK_BAND_PALETTE.length === 6);

// -----------------------------------------------------------------------------
group('_state.js: live-binding pattern');
check('exports _pageState',                       '_pageState' in state);
check('exports _setActiveState',                  typeof state._setActiveState === 'function');
check('_pageState starts null',                   state._pageState === null);
state._setActiveState({ marker: 'A' });
check('_setActiveState mutates _pageState',       state._pageState && state._pageState.marker === 'A');
state._setActiveState(null);
check('_setActiveState(null) clears',             state._pageState === null);

// -----------------------------------------------------------------------------
group('Pure helpers: _ackBandColor');
// null/negative → grey, valid index → palette entry, wraps modulo
check('_ackBandColor(null) → grey',               annotation_cockpit._ackBandColor(null) === '#666');
check('_ackBandColor(-1) → grey',                 annotation_cockpit._ackBandColor(-1) === '#666');
check('_ackBandColor(0) → palette[0]',            annotation_cockpit._ackBandColor(0) === annotation_cockpit._ACK_BAND_PALETTE[0]);
check('_ackBandColor(7) wraps modulo palette',    annotation_cockpit._ackBandColor(7) === annotation_cockpit._ACK_BAND_PALETTE[1]);

// -----------------------------------------------------------------------------
group('Pure helpers: _annoCockpitCandidateAtCursor (cursor lookup)');
check('null mb → null',                           annotation_cockpit._annoCockpitCandidateAtCursor(null, []) === null);
check('null items → null',                        annotation_cockpit._annoCockpitCandidateAtCursor(5.0, null) === null);

const items = [
  { start_bp: 1_000_000, end_bp: 2_000_000, candidate_id: 'A' },
  { start_bp: 5_000_000, end_bp: 6_000_000, candidate_id: 'B' },
];
const hit = annotation_cockpit._annoCockpitCandidateAtCursor(1.5, items);  // 1.5 Mb -> A
check('cursor 1.5 Mb hits candidate A',           hit && hit.candidate_id === 'A');
const miss = annotation_cockpit._annoCockpitCandidateAtCursor(3.0, items); // gap
check('cursor 3 Mb (gap) → null',                 miss === null);
const hitB = annotation_cockpit._annoCockpitCandidateAtCursor(5.5, items);
check('cursor 5.5 Mb hits candidate B',           hitB && hitB.candidate_id === 'B');

// -----------------------------------------------------------------------------
group('Pure helpers: _annoCockpitChromExtent');
// chrom_len_bp present in state.data → use it
state._setActiveState({ data: { chrom_len_bp: 50_000_000 } });
const extentFromLen = annotation_cockpit._annoCockpitChromExtent([]);
check('chrom_len_bp drives extent',               extentFromLen && extentFromLen.mbMin === 0
                                                  && Math.abs(extentFromLen.mbMax - 50) < 1e-9);

// no data, fallback to candidate range
state._setActiveState({});
const extentFromItems = annotation_cockpit._annoCockpitChromExtent([
  { start_bp: 1_000_000, end_bp: 8_000_000 },
]);
check('fallback: candidate range drives extent',  extentFromItems && extentFromItems.mbMin === 0
                                                  && extentFromItems.mbMax > 8 && extentFromItems.mbMax < 9);

// no data + no items → null
const extentNull = annotation_cockpit._annoCockpitChromExtent([]);
check('no data and no items → null',              extentNull === null);

// reset
state._setActiveState(null);

// -----------------------------------------------------------------------------
group('Pure helpers: _ackEnsureState (lazy-inits cockpitCursor)');
state._setActiveState({ data: null });
const ensured = annotation_cockpit._ackEnsureState();
check('returns _pageState',                       ensured === state._pageState);
check('cockpitCursor lazy-initialized',           ensured.cockpitCursor && ensured.cockpitCursor.mb === null
                                                  && ensured.cockpitCursor.candidate_id === null);

// Calling again preserves cursor (doesn't re-init)
ensured.cockpitCursor.mb = 7.5;
const ensured2 = annotation_cockpit._ackEnsureState();
check('subsequent call preserves cursor',         ensured2.cockpitCursor.mb === 7.5);

state._setActiveState(null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
