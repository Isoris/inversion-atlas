// pages/catalogue/page3.js
//
// Catalogue page (chat 36 round 5 step 3, 2026-05-07).
//
// Page3 = "5 catalogue" in legacy (line 5051): "Sortable, filterable
// catalogue of all L2 envelopes (or L1-merged inversions). Hover any
// column header for definition. Export selected rows as TSV or Markdown."
//
// Built from 2 sub-modules under ./page3/:
//   ./page3/_state.js            — _pageState + setter (page3's own)
//   ./page3/_breeding_export.js  — Turn-146 bulk breeding-card exports
//                                  (HTML, JSON; tier-gated). 17 functions
//                                  + 1 constant table, 1106 LOC.
//
// IMPORTANT — what this round did NOT migrate:
//
// The catalogue's main rendering pipeline (`renderCatalogue`,
// `_buildCatalogueRows`, `_filterCatalogueRows`, `_sortCatalogueRows`,
// `_paintCatalogueRow`, the TSV/Markdown/JSON/SVG/PNG/PDF gallery
// exports, and the regime-assign UI) is REFERENCED in legacy but never
// DEFINED. Every call site uses `typeof renderCatalogue === 'function'`
// guards, meaning the legacy build expects an external script to install
// `window.renderCatalogue` at runtime. None of the legacy JS does so.
//
// Verification:
//   $ grep -nE 'function renderCatalogue|var renderCatalogue|let renderCatalogue|const renderCatalogue|renderCatalogue\\s*=|window\\.renderCatalogue' legacy/Inversion_atlas.html
//   (only `typeof renderCatalogue === 'function'` guards match)
//
// Consequence: this file mounts the catalogue page in its EMPTY STATE
// (toolbar visible but inert; table empty with the "Load a JSON to
// populate the catalogue." message). The breeding-card export is the
// only catalogue-toolbar action that's actually wired and functional —
// because it's the only one that has implementation in legacy.
//
// To make the catalogue table render, a future round must implement
// the missing functions. They were called out in detail in the chat-33
// stub of this file (preserved in audit log under
// HANDOFF_2026-05-07_chat36_round5_step3_done.md).

import { _setActiveState } from './page3/_state.js';
import {
  _exportBreedingCardsHTML,
  _exportBreedingCardsJSON,
  _wireCatalogueBreedingExportBtns,
} from './page3/_breeding_export.js';
import {
  renderCatalogue,
  wireCatalogueToolbar,
  teardownCatalogueToolbar,
} from './page3/catalogue.js';

// Re-export the public set so the manifest's module: contract is preserved
// across the split.
export {
  _exportBreedingCardsHTML,
  _exportBreedingCardsJSON,
  _wireCatalogueBreedingExportBtns,
} from './page3/_breeding_export.js';
export {
  CAT_COLUMNS,
  CAT_VIEW_MODES,
  buildCatalogueRows,
  filterCatalogueRows,
  sortCatalogueRows,
  visibleColumns,
  renderCatHeaderHtml,
  renderCatBodyHtml,
  renderCatalogue,
  exportCatalogueTSV,
  exportCatalogueMarkdown,
  exportCatalogueJSON,
  wireCatalogueToolbar,
  teardownCatalogueToolbar,
} from './page3/catalogue.js';

// ---------------------------------------------------------------------------
// Public entry: render the catalogue page
// ---------------------------------------------------------------------------

/**
 * Public entry: render the catalogue page (currently empty-state only).
 *
 * Once a renderer ships, this will be replaced with:
 *   _setActiveState(state);
 *   _buildCatalogueRows(state)  →  rows
 *   _filterCatalogueRows(state, rows)  →  filtered
 *   _sortCatalogueRows(state, filtered)  →  sorted
 *   slot.innerHTML = sorted.map(_paintCatalogueRow).join('')
 *   _wireCatalogueToolbar(state)
 *   _wireCatalogueBreedingExportBtns()  // already implemented
 *
 * Until then: show the empty-state hint.
 */
export function renderCataloguePage(state) {
  _setActiveState(state);
  renderCatalogue(state);
}

/**
 * Public entry: idempotent toolbar wiring.
 *
 * Currently wires only the breeding-export buttons (HTML / JSON / tier
 * dropdown). The other catalogue toolbar buttons (view-mode, display-mode,
 * diamond-mode, filter, verdict-filter, select-all, clear-selection,
 * regime-registry, regime-assign, view-as-candidate, TSV/MD/JSON/gallery
 * exports) are toolbar UI only — their handlers are not in legacy and
 * are TODO_MISSING.
 */
export function initCataloguePage(state) {
  _setActiveState(state);
  // Breeding-card export (legacy implementation, already wired).
  try { _wireCatalogueBreedingExportBtns(); }
  catch (e) { console.warn('_wireCatalogueBreedingExportBtns:', e.message); }
  // Filter / sort / view-mode / disp-mode / select-all / clear / TSV / MD / JSON.
  try { wireCatalogueToolbar(state, { onChange: () => renderCatalogue(state) }); }
  catch (e) { console.warn('wireCatalogueToolbar:', e.message); }
  // TODO_MISSING(_wireCatalogueRegimeBtns) — registry, assign-sel
  // TODO_MISSING(_wireCatalogueCandidatePromote) — view-as-candidate
  // TODO_MISSING(_wireCatalogueDiamondMode) — diamond strictness toggle
  // TODO_MISSING(_wireCatalogueGalleryExports) — SVG / PNG / PDF
}

// ---------------------------------------------------------------------------
// Atlas-router lifecycle
// ---------------------------------------------------------------------------

/**
 * Mount: called by atlas_router when the user navigates to page3.
 *
 * Reads activeChrom from atlasState. Like page2, page3 doesn't itself
 * load the chromosome data layer — it reads what page1's mount already
 * pinned to atlasState.inversion.tracks[chrom]. If page1 hasn't mounted
 * yet, the catalogue shows its empty state.
 */
export async function mount(root, atlasState, registry) {
  const legacyState = _buildLegacyState(atlasState);
  _setActiveState(legacyState);

  // Render empty state (or the future catalogue table).
  try { renderCataloguePage(legacyState); }
  catch (e) { console.warn('page3.mount: renderCataloguePage threw —', e); }

  // Wire idempotent handlers (breeding-card export only at this round).
  try { initCataloguePage(legacyState); }
  catch (e) { console.warn('page3.mount: initCataloguePage threw —', e); }

  // Stash for inter-mount lookups.
  if (atlasState.inversion) atlasState.inversion._page3State = legacyState;
}

/**
 * Unmount: called by atlas_router before navigating away.
 */
export async function unmount(root) {
  try { teardownCatalogueToolbar(); }
  catch (e) { console.warn('page3.unmount: teardownCatalogueToolbar —', e); }
  _setActiveState(null);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _buildLegacyState(atlasState) {
  // Same shape page1/page2 use. The breeding-export pipeline reads
  // state.candidateList, state.cohortDiversity, state.data, state.k.
  const inv = atlasState.inversion || {};
  const sh = atlasState.shared || {};

  const legacy = Object.assign({}, inv);

  legacy.candidate              = sh.activeCandidate || null;
  legacy.candidateList          = inv.candidateList || [];
  legacy.activeSampleSet        = sh.activeSampleSet || null;
  legacy.candidate_review_decisions = inv.candidate_review_decisions || {};
  legacy.locked_karyotype_groups    = inv.locked_karyotype_groups || {};
  // Page3 reads state.data the same way page2 does — the chromosome
  // precomp pinned by page1's mount.
  const chrom = sh.activeChrom;
  if (chrom && inv.tracks && inv.tracks[chrom]) {
    legacy.data = inv.tracks[chrom];
  } else {
    legacy.data = null;
  }
  // cohortDiversity slot — populated by atlas_turn7's makeShelfLDPanel
  // when that ships. Default empty for now.
  legacy.cohortDiversity = inv.cohortDiversity || null;

  // Catalogue rows — supplied either directly via inv.catalogueRows (from
  // a future JSON-loader) or derived from inv.tracks[chrom].l2_envelopes
  // when available. Falls back to empty array → empty-state hint.
  if (Array.isArray(inv.catalogueRows)) {
    legacy.catalogueRows = inv.catalogueRows;
  } else if (legacy.data && Array.isArray(legacy.data.l2_envelopes)) {
    legacy.catalogueRows = legacy.data.l2_envelopes;
  } else {
    legacy.catalogueRows = [];
  }
  // Seed slots that the renderer expects (so the first render-pass
  // doesn't have to back-fill them).
  legacy.catFavorites      = inv.catFavorites      instanceof Set ? inv.catFavorites      : new Set();
  legacy.catSelection      = inv.catSelection      instanceof Set ? inv.catSelection      : new Set();
  legacy.catFilter         = typeof inv.catFilter         === 'string' ? inv.catFilter         : '';
  legacy.catVerdictFilter  = typeof inv.catVerdictFilter  === 'string' ? inv.catVerdictFilter  : '';
  legacy.catViewMode       = typeof inv.catViewMode       === 'string' ? inv.catViewMode       : 'l2_raw';
  legacy.catDispMode       = typeof inv.catDispMode       === 'string' ? inv.catDispMode       : 'detailed';
  legacy.catSortKey        = typeof inv.catSortKey        === 'string' ? inv.catSortKey        : 'id';
  legacy.catSortDir        = typeof inv.catSortDir        === 'string' ? inv.catSortDir        : 'asc';
  legacy.activeChrom       = chrom || null;

  return legacy;
}
