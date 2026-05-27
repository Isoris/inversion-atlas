// pages/discovery/local_pca_dosage/_data.js
//
// Re-export shim. The bodies that used to live here were hoisted to
// `atlases/inversion/shared/page1_data_helpers.js` in chat 36 round 5
// step 1 (2026-05-07) so candidate_focus (and future pages) can import them
// directly without going through local_pca_dosage's directory tree.
//
// All local_pca_dosage panel sub-modules still import from `./_data.js`; this
// shim keeps those import paths stable. New code (candidate_focus.js et al.)
// should import from `../../shared/page1_data_helpers.js` directly.
//
// All of these helpers take `state` as first arg — they are pure or
// pure-from-state, no `_pageState` shim. See the shared module's
// header for the per-helper inventory.

export {
  getActiveSimScale,
  currentMbRange,
  _LINES_COLOR_MODES,
  _isLinesColorModeAvailable,
  detectSchemaAndLayers,
  listLayers,
  availablePCs,
  getPCRender,
  getPC,
  buildIndexes,
  computePC1Signs,
  computePC2Signs,
  populateSimScales,
  buildFamilyPalette,
  loadViewControls,
  reconcileViewControlsForData,
  setPcaXY,
  setViewControlsLinked,
  getL2Cluster,
  getL2ClusterAt,
  getLinesValuesAt,
  getLinesGrid,
  getLinesSignAt,
  allSampleIdx,
  sampleSpreadL2,
  sampleSpreadRange,
  _esc,
  _fmt4,
  _fmtP,
  groupColor,
  getActiveModeView,
  invalidateModeView,
  rebuildIndexesFromView,
} from '../../../shared/page1_data_helpers.js';
