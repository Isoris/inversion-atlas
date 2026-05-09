// tests/test_catalogue_page21.js
//
// Sub-module + main re-export coverage + pure-helper exercises for the
// page21 annotation cockpit page.
//
// Round 5 step 6 (chat 36, 2026-05-07): page21 refactored from chat-33
// "single-file with const state = window.state || {}" pattern to the
// _pageState live-binding pattern + atlas-router mount/unmount lifecycle.
// Body kept as a single file (vs sub-module split) — matches page17/page18
// (cohesive single-concern code, ~720 LOC base).
//
// Page21 has NO new cross-page imports (the 4 external helpers
// _gatherActiveCandidatesForInheritance, _wireCandidateHaplotypeAnnotations,
// candidateHaplotypeAnnotationsHtml, computeTrackedLinkageProjection are
// kept as runtime `typeof X === 'function'` guards — they will land
// naturally with page2/page16 migration).

import * as page21 from '../atlases/inversion/pages/catalogue/page21.js';
import * as state  from '../atlases/inversion/pages/catalogue/page21/_state.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('page21.js: lifecycle entry-points');
check('exports mount',                        typeof page21.mount === 'function');
check('exports unmount',                      typeof page21.unmount === 'function');
check('exports refreshAnnotationCockpit',     typeof page21.refreshAnnotationCockpit === 'function');

// -----------------------------------------------------------------------------
group('page21.js: cockpit-domain helpers');
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
  check(`exports ${name}`, typeof page21[name] === 'function');
}

// -----------------------------------------------------------------------------
group('page21.js: constants');
check('_ACK_PAD is object',                       page21._ACK_PAD && typeof page21._ACK_PAD === 'object');
check('_ACK_PAD has l/r/t/b',                     'l' in page21._ACK_PAD && 'r' in page21._ACK_PAD
                                                  && 't' in page21._ACK_PAD && 'b' in page21._ACK_PAD);
check('_ACK_LINE_ALPHA is number',                typeof page21._ACK_LINE_ALPHA === 'number');
check('_ACK_HIGHLIGHT_ALPHA is number',           typeof page21._ACK_HIGHLIGHT_ALPHA === 'number');
check('_ACK_CURSOR_COLOR is string',              typeof page21._ACK_CURSOR_COLOR === 'string');
check('_ACK_BAND_PALETTE is array',               Array.isArray(page21._ACK_BAND_PALETTE));
check('_ACK_BAND_PALETTE has 6 colors',           page21._ACK_BAND_PALETTE.length === 6);

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
check('_ackBandColor(null) → grey',               page21._ackBandColor(null) === '#666');
check('_ackBandColor(-1) → grey',                 page21._ackBandColor(-1) === '#666');
check('_ackBandColor(0) → palette[0]',            page21._ackBandColor(0) === page21._ACK_BAND_PALETTE[0]);
check('_ackBandColor(7) wraps modulo palette',    page21._ackBandColor(7) === page21._ACK_BAND_PALETTE[1]);

// -----------------------------------------------------------------------------
group('Pure helpers: _annoCockpitCandidateAtCursor (cursor lookup)');
check('null mb → null',                           page21._annoCockpitCandidateAtCursor(null, []) === null);
check('null items → null',                        page21._annoCockpitCandidateAtCursor(5.0, null) === null);

const items = [
  { start_bp: 1_000_000, end_bp: 2_000_000, candidate_id: 'A' },
  { start_bp: 5_000_000, end_bp: 6_000_000, candidate_id: 'B' },
];
const hit = page21._annoCockpitCandidateAtCursor(1.5, items);  // 1.5 Mb -> A
check('cursor 1.5 Mb hits candidate A',           hit && hit.candidate_id === 'A');
const miss = page21._annoCockpitCandidateAtCursor(3.0, items); // gap
check('cursor 3 Mb (gap) → null',                 miss === null);
const hitB = page21._annoCockpitCandidateAtCursor(5.5, items);
check('cursor 5.5 Mb hits candidate B',           hitB && hitB.candidate_id === 'B');

// -----------------------------------------------------------------------------
group('Pure helpers: _annoCockpitChromExtent');
// chrom_len_bp present in state.data → use it
state._setActiveState({ data: { chrom_len_bp: 50_000_000 } });
const extentFromLen = page21._annoCockpitChromExtent([]);
check('chrom_len_bp drives extent',               extentFromLen && extentFromLen.mbMin === 0
                                                  && Math.abs(extentFromLen.mbMax - 50) < 1e-9);

// no data, fallback to candidate range
state._setActiveState({});
const extentFromItems = page21._annoCockpitChromExtent([
  { start_bp: 1_000_000, end_bp: 8_000_000 },
]);
check('fallback: candidate range drives extent',  extentFromItems && extentFromItems.mbMin === 0
                                                  && extentFromItems.mbMax > 8 && extentFromItems.mbMax < 9);

// no data + no items → null
const extentNull = page21._annoCockpitChromExtent([]);
check('no data and no items → null',              extentNull === null);

// reset
state._setActiveState(null);

// -----------------------------------------------------------------------------
group('Pure helpers: _ackEnsureState (lazy-inits cockpitCursor)');
state._setActiveState({ data: null });
const ensured = page21._ackEnsureState();
check('returns _pageState',                       ensured === state._pageState);
check('cockpitCursor lazy-initialized',           ensured.cockpitCursor && ensured.cockpitCursor.mb === null
                                                  && ensured.cockpitCursor.candidate_id === null);

// Calling again preserves cursor (doesn't re-init)
ensured.cockpitCursor.mb = 7.5;
const ensured2 = page21._ackEnsureState();
check('subsequent call preserves cursor',         ensured2.cockpitCursor.mb === 7.5);

state._setActiveState(null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
