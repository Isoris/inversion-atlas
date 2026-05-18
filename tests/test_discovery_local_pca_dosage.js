// Atlas/tests/test_discovery_page1.js
//
// Minimal smoke test — verify local_pca_dosage.js loads as ESM and exports the expected names.
// Per HANDOFF_BATCH_1: extracted bodies are not exercised here (they need DOM + state).
// The merge chat will add behavioural tests once the wiring lands.
//
// 2026-05-06 round 4: local_pca_dosage.js was split into 10 sub-modules under
// pages/discovery/local_pca_dosage/. The main local_pca_dosage.js re-exports the 26 public
// entry points (plus mount/unmount), preserving the manifest contract.
// This test must be invoked against an assembled atlas-core+inversion
// workspace because local_pca_dosage.js statically imports from
// '../../../../core/atlas_api.js' (the atlas-core shell).

import * as local_pca_dosage from '../atlases/inversion/pages/discovery/local_pca_dosage.js';

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else      { console.log(`  ✗ ${name}  ${detail}`); fail++; }
}

console.log("--- local_pca_dosage module loads ---");
check("module imports as object", typeof local_pca_dosage === "object" && local_pca_dosage !== null);

// 26 expected exports
check("drawSim exported as function", typeof local_pca_dosage.drawSim === "function");
check("drawSimMini exported as function", typeof local_pca_dosage.drawSimMini === "function");
check("drawZ exported as function", typeof local_pca_dosage.drawZ === "function");
check("drawLinesPanel exported as function", typeof local_pca_dosage.drawLinesPanel === "function");
check("drawPCA exported as function", typeof local_pca_dosage.drawPCA === "function");
check("drawAnchorStrip exported as function", typeof local_pca_dosage.drawAnchorStrip === "function");
check("renderL3Panel exported as function", typeof local_pca_dosage.renderL3Panel === "function");
check("renderL3PanelSlab exported as function", typeof local_pca_dosage.renderL3PanelSlab === "function");
check("renderL3PanelScaleStability exported as function", typeof local_pca_dosage.renderL3PanelScaleStability === "function");
check("updateWinLabel exported as function", typeof local_pca_dosage.updateWinLabel === "function");
check("setCur exported as function", typeof local_pca_dosage.setCur === "function");
check("autoPickRadial exported as function", typeof local_pca_dosage.autoPickRadial === "function");
check("applyData exported as function", typeof local_pca_dosage.applyData === "function");
check("onSimClick exported as function", typeof local_pca_dosage.onSimClick === "function");
check("onZClick exported as function", typeof local_pca_dosage.onZClick === "function");
check("onPCAClick exported as function", typeof local_pca_dosage.onPCAClick === "function");
check("togglePlay exported as function", typeof local_pca_dosage.togglePlay === "function");
check("cycleKAside exported as function", typeof local_pca_dosage.cycleKAside === "function");
check("renderTrackedList exported as function", typeof local_pca_dosage.renderTrackedList === "function");
check("renderManualGroupsList exported as function", typeof local_pca_dosage.renderManualGroupsList === "function");
check("buildLinesPanelCheckboxes exported as function", typeof local_pca_dosage.buildLinesPanelCheckboxes === "function");
check("buildLinesPanel exported as function", typeof local_pca_dosage.buildLinesPanel === "function");
check("buildTrackPanels exported as function", typeof local_pca_dosage.buildTrackPanels === "function");
check("drawTracks exported as function", typeof local_pca_dosage.drawTracks === "function");
check("refreshLinesColorMode exported as function", typeof local_pca_dosage.refreshLinesColorMode === "function");
check("setLinesPanelCandidateBands exported as function", typeof local_pca_dosage.setLinesPanelCandidateBands === "function");

// Round 4 (2026-05-06) additions: mount/unmount as the manifest entry points.
check("mount exported as function", typeof local_pca_dosage.mount === "function");
check("unmount exported as function", typeof local_pca_dosage.unmount === "function");

// Round 4: confirm the 9 sub-modules under pages/discovery/local_pca_dosage/ all
// load and export at least one expected name. This catches regressions
// where a panel module's imports break (cross-module typos, missing
// `export`, etc.) without us having to mount the page.
//
// Round 5 step 1 (chat 36, 2026-05-07): the data helpers were hoisted
// to atlases/inversion/shared/page1_data_helpers.js. local_pca_dosage/_data.js is
// now a re-export shim. Both ends of the shim are checked below.
const subModules = [
  ['_state.js',       ['_pageState','_setActiveState','trackedColor','getSampleColor']],
  ['_data.js',        ['detectSchemaAndLayers','buildIndexes','currentMbRange','getActiveSimScale']],
  ['sim_panel.js',    ['drawSim','drawSimMini']],
  ['z_panel.js',      ['drawZ','_drawSnpDensityStrip','_drawLineageStrip']],
  ['lines_panel.js',  ['drawLinesPanel','buildLinesPanel','setLinesPanelCandidateBands']],
  ['pca_panel.js',    ['drawPCA','drawAnchorStrip','autoPickRadial','togglePlay','cycleKAside']],
  ['l3_panel.js',     ['renderL3Panel','renderL3PanelSlab','renderL3PanelScaleStability']],
  ['candidates.js',   ['drawCandidateBar','_assignCandidateLanes','refreshCandidateUI']],
  ['events.js',       ['onSimClick','onZClick','onPCAClick','setCur','updateWinLabel']],
];
for (const [fname, names] of subModules) {
  const mod = await import(`../atlases/inversion/pages/discovery/local_pca_dosage/${fname}`);
  for (const n of names) {
    check(`local_pca_dosage/${fname}: exports ${n}`, mod[n] !== undefined);
  }
}

// Round 5 step 1: shared/page1_data_helpers.js should expose every
// public name from the (now-shim) _data.js, and the shim should
// re-export the same identities (live re-export).
const sharedHelpers = await import('../atlases/inversion/shared/page1_data_helpers.js');
const dataShim = await import('../atlases/inversion/pages/discovery/local_pca_dosage/_data.js');
const HOISTED_PUBLIC = [
  'getActiveSimScale','currentMbRange',
  '_LINES_COLOR_MODES','_isLinesColorModeAvailable',
  'detectSchemaAndLayers','listLayers',
  'availablePCs','getPCRender','getPC',
  'buildIndexes','computePC1Signs','populateSimScales','buildFamilyPalette',
  'loadViewControls','reconcileViewControlsForData',
  'getL2Cluster','getL2ClusterAt',
  'getLinesValuesAt','getLinesGrid','getLinesSignAt','allSampleIdx',
];
for (const n of HOISTED_PUBLIC) {
  check(`shared/page1_data_helpers.js: exports ${n}`, typeof sharedHelpers[n] !== 'undefined');
  check(`local_pca_dosage/_data.js shim: re-exports ${n} from shared`, dataShim[n] === sharedHelpers[n]);
}

console.log("");
console.log("=================");
console.log(`pass: ${pass}   fail: ${fail}`);
console.log("=================");
process.exit(fail === 0 ? 0 : 1);
