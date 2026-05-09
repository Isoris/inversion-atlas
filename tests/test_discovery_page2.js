// Atlas/tests/test_discovery_page2.js
//
// Smoke test — verify page2.js loads as ESM and exports the expected
// names. Per HANDOFF_BATCH_1: extracted bodies are not exercised here
// (they need DOM + state). The smoke_discovery_page2_round5.mjs harness
// exercises mount() / renderCandidateMetadata / unmount under a fake DOM.
//
// 2026-05-07 chat 36 round 5 step 1: stale path
// `../inversion_discovery/page2.js` (chat-32 layout) corrected to
// `../atlases/inversion/pages/discovery/page2.js`.
//
// 2026-05-07 chat 36 round 5 step 2: page2.js was split into 5
// sub-modules under pages/discovery/page2/ (mirroring round-4's page1
// split). The main page2.js re-exports the 38 public entry points
// from the sub-modules plus mount/unmount and the 4 orchestrators
// it owns. This test now also verifies the sub-modules load and
// export the expected names.

import * as page2 from '../atlases/inversion/pages/discovery/page2.js';

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else      { console.log(`  ✗ ${name}  ${detail}`); fail++; }
}

console.log("--- page2 module loads ---");
check("module imports as object", typeof page2 === "object" && page2 !== null);

// Atlas-router lifecycle (round 5 step 2 additions)
check("mount exported as function", typeof page2.mount === "function");
check("unmount exported as function", typeof page2.unmount === "function");

// Orchestrator entry points (live in main page2.js)
check("renderCandidateMetadata exported as function", typeof page2.renderCandidateMetadata === "function");
check("wireCandidateNav exported as function", typeof page2.wireCandidateNav === "function");
check("refreshCandidateUI exported as function", typeof page2.refreshCandidateUI === "function");
check("_navigateToCandidate exported as function", typeof page2._navigateToCandidate === "function");

// 16 HTML builders (re-exported from page2/_html_builders.js)
const HTML_BUILDERS = [
  'candidateNavHtml', 'candidateHeaderHtml', 'candidateBlockChipsHtml',
  'candidateRichCardHtml', 'candidateSummaryHtml', 'candidateSubbandHtml',
  'candidateHetShapeHtml', 'candidateDosageHeatmapHtml',
  'candidateProfileHtml', 'candidateSigmaChartHtml', 'candidateBandsHtml',
  'candidateHaplotypeAnnotationsHtml', 'candidateAncestryConfoundHtml',
  'candidateRegimeRowHtml', 'candidateAgeOriginHtml', 'candidateNotesHtml',
];
for (const n of HTML_BUILDERS) {
  check(`page2 re-exports ${n} (HTML builder)`, typeof page2[n] === "function");
}

// 7 wires
const WIRES = [
  'wireCandidateButtons', '_wireCandidateBlockChips',
  'wireCandidateAncestryConfound', '_wireCandidateHaplotypeAnnotations',
  '_wireCandidateBandClicks', '_wireCandidateRegimeRow',
  '_wireCandidateDosageHeatmap',
];
for (const n of WIRES) {
  check(`page2 re-exports ${n} (wire)`, typeof page2[n] === "function");
}

// 8 list helpers
const LIST = [
  'addCandidateToList', 'persistCandidateList', 'refreshCandidateListUI',
  'candidateToJSON', 'candidateFromJSON',
  'candidateListSortedByPos', 'candidateListIndexOf', 'candidateListClosestIndex',
];
for (const n of LIST) {
  check(`page2 re-exports ${n} (list)`, typeof page2[n] === "function");
}

// 7 draw panels + support helpers
const DRAW = [
  'sigmaProfileCandidate', 'candidateBandComposition',
  'drawCandLocalPCA', 'drawCandLinesPanel', 'drawCandGHSLPerBand',
  'drawCandidateSigmaChart', 'drawCandidateLocationStrip',
];
for (const n of DRAW) {
  check(`page2 re-exports ${n} (draw)`, typeof page2[n] === "function");
}

// Round 5 step 2: confirm the 5 sub-modules under pages/discovery/page2/
// all load and export at least one expected name. This catches regressions
// where a sub-module's imports break (cross-module typos, missing `export`,
// circular import resolution issue, etc.) without us having to mount the
// page.
const subModules = [
  ['_state.js',          ['_pageState', '_setActiveState']],
  ['_html_builders.js',  ['candidateNavHtml', 'candidateHeaderHtml', 'candidateNotesHtml']],
  ['_wires.js',          ['wireCandidateButtons', '_wireCandidateBlockChips']],
  ['_list.js',           ['addCandidateToList', 'candidateToJSON', 'candidateListSortedByPos']],
  ['_draw_panels.js',    ['sigmaProfileCandidate', 'drawCandLocalPCA', 'drawCandidateSigmaChart']],
];
for (const [fname, names] of subModules) {
  const mod = await import(`../atlases/inversion/pages/discovery/page2/${fname}`);
  for (const n of names) {
    check(`page2/${fname}: exports ${n}`, mod[n] !== undefined);
  }
}

console.log("");
console.log("=================");
console.log(`pass: ${pass}   fail: ${fail}`);
console.log("=================");
process.exit(fail === 0 ? 0 : 1);
