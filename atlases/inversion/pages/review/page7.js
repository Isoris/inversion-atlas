// =============================================================================
// inversion_review/page7.js — "9 ancestry" tab
// =============================================================================
// Stage:        review (per-window ancestry view)
// Legacy DOM:   <div id="page7"> (legacy lines 7660–7670)
// Renderer:     renderAncestryPage()  — referenced via typeof guard at legacy
//                                       lines 59629–59630, 59732–59733.
//                                       NOT defined inline in legacy HTML —
//                                       lives in an external sibling script
//                                       alongside js/atlas_page6_wiring.js.
//
// What this page does
// -------------------
// Per-window ancestry view for the active chromosome. Reuses the popstats
// stack architecture (canvas tracks gated by chip toggles in #ancViewChips).
//
// Three view chips (per legacy line 8974 description):
//   - K-cluster label   (per-window argmax-Q assignment)
//   - Q-value heatmap   (top-1 ancestry component intensity)
//   - delta12           (top-1 minus top-2 Q — confidence)
//
// Driven by a `<chrom>_phase4_ancestry.json` layer that the user drag-drops
// into the page. Renders sample × window heatmaps for whichever chips are
// active. The empty-state in #ancNoChrom prompts the user to load the
// precomp first, then the ancestry layer.
//
// DOM contract:
//   #ancToolbar      — sticky chip bar (<span id="ancViewChips">) + meta
//   #ancStack        — vertical canvas-section stack
//   #ancNoChrom      — empty state with drag-drop instructions
//
// Round-5-step-17 status (chat 38 cont., 2026-05-07): thin-loader-stub
// migration — pattern 4 ("stub-preserving + one wired entry") applied to
// a page where the wired entry is itself a loader for an external
// renderer. Both chat-33 exports preserved verbatim:
//   - showAncestryPage(state)    — main entry; tries window.renderAncestryPage,
//                                   falls back to a missing-renderer empty-state
//                                   message if absent.
//   - refreshAncestryPage()      — re-render entry; delegates to
//                                   showAncestryPage().
// New: _state.js sub-module + state-aware wrapper + mount/unmount
// lifecycle. mount() calls showAncestryPage(legacyState) so the
// fallback empty-state renders at mount time even if window.renderAncestryPage
// is absent.
//
// First migrated review-stage page (review group: 0 of 5 → 1 of 5).
//
// Extraction notes (Batch 2)
// --------------------------
// `renderAncestryPage` is called by the tab dispatcher but never defined
// inside Inversion_atlas.html. It must be in a sibling external script
// alongside the popstats wiring (page-6 and page-7 share the canvas-track
// architecture per the page-6 description: "Reuses the popstats stack
// architecture", legacy line 8974). The merge chat may wish to extract the
// canvas-track helpers shared between page6 and page7 into a sibling
// module under inversion_review/.
//
// Decision (BATCH_2_NOTES): same lifecycle-wrapper pattern as page6.js.
//
// Registry mismatch flagged for Quentin
// -------------------------------------
// pages.registry.json declares page7 has
//   "requires_layers": ["candidate_marker_primers"]
//   "requires_slots":  ["activeCandidate"]
// but the page7.js header (and the legacy DOM contract) clearly describe
// page7 as a CHROMOSOME-LEVEL ancestry view driven by a
// `<chrom>_phase4_ancestry.json` layer with `activeChrom` semantics. The
// `candidate_marker_primers` layer + `activeCandidate` slot look like
// they belong on a different (currently-non-existent) marker-primer page.
// **Round 17 does NOT change requires_layers / requires_slots** — that's a
// content decision Quentin owns. The migration only adds _label + _doc
// describing what the page actually does.
// =============================================================================


import { _pageState, _setActiveState } from './page7/_state.js';

// -----------------------------------------------------------------------------
// External-file deps
// -----------------------------------------------------------------------------
//
// TODO_MISSING(renderAncestryPage)         — external (sibling of atlas_page6_wiring)
//                                              (dispatched at legacy 59629 + 59732)
//
// Layer schema:
// TODO_MISSING(ancestry layer loader)      — drag-drop loader for
//                                            <chrom>_phase4_ancestry.json.
//                                            Likely lives in main bootstrap.
// -----------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Chat-33 exports — PRESERVED VERBATIM
// ---------------------------------------------------------------------------

/**
 * Show the ancestry page. The renderer is defined externally (sibling of
 * atlas_page6_wiring.js); this wrapper exists so the tab dispatcher has a
 * single ES-module entry to call.
 *
 * @param {object} state  shared state (not used directly here — the legacy
 *                        renderer reads window.state)
 * @returns {void}
 */
export function showAncestryPage(state) {
  if (typeof window === 'undefined') return;
  const fn = /** @type {any} */ (window).renderAncestryPage;
  if (typeof fn === 'function') {
    try {
      // TODO_MISSING(renderAncestryPage)
      fn();
    } catch (err) {
      console.warn('[page7] renderAncestryPage threw:', err);
    }
    return;
  }

  // Fallback empty state — surfaces the missing-dep clearly to the user.
  const stack = document.getElementById('ancStack');
  const noChrom = document.getElementById('ancNoChrom');
  if (noChrom) {
    noChrom.style.display = 'block';
    noChrom.innerHTML =
      'Ancestry renderer not loaded. The renderer is the sibling of ' +
      '<code>atlas_page6_wiring.js</code>; drop the ancestry script ' +
      'alongside this HTML and reload.';
  }
  if (stack) stack.innerHTML = '';
}


/**
 * Re-render the ancestry page after state changes (e.g. ancestry layer
 * loaded, chrom switch). Idempotent.
 *
 * @returns {void}
 */
export function refreshAncestryPage() {
  showAncestryPage();
}


// ---------------------------------------------------------------------------
// State-aware public wrapper (round 5 step 17)
// ---------------------------------------------------------------------------

/**
 * Public entry — state-aware wrapper around showAncestryPage.
 *
 * If `state` is passed, sets _pageState as a side effect before delegating
 * (mirrors page9/page15/page5 wrapper pattern). The chat-33
 * showAncestryPage signature already takes state as an explicit arg, so
 * the wrapper just threads _pageState into it.
 */
export function refreshPage7(state) {
  if (state) _setActiveState(state);
  return showAncestryPage(state || _pageState || {});
}

// ---------------------------------------------------------------------------
// Atlas-router lifecycle (chat 38 round 5 step 17, 2026-05-07).
// ---------------------------------------------------------------------------

/**
 * Mount: called by atlas_router when the user navigates to page7.
 *
 * Builds a legacy-shape state with the slots page7 will eventually need
 * (data.ancestry — the loaded ancestry layer; ancestryViewChips — the
 * Set of currently-active view chips; candidate — for the cursor band).
 * Calls refreshPage7 to render the ancestry view (or the missing-renderer
 * empty state if window.renderAncestryPage is absent).
 */
export async function mount(root, atlasState, registry) {
  const legacyState = _buildLegacyState(atlasState);
  _setActiveState(legacyState);

  try { refreshPage7(legacyState); }
  catch (e) { console.warn('page7.mount: refreshPage7 threw —', e); }

  if (atlasState.inversion) atlasState.inversion._page7State = legacyState;
}

/**
 * Unmount: clear _pageState so post-unmount callbacks see null.
 */
export async function unmount(root) {
  _setActiveState(null);
}

function _buildLegacyState(atlasState) {
  const inv = atlasState.inversion || {};
  const legacy = Object.assign({}, inv);
  // state.data — IS in SLOT_REGISTRY (transient). The ancestry renderer
  // reads state.data.ancestry (an optional sub-layer) for per-window K
  // labels, Q-values, and delta12. Default to empty object so
  // `state.data.ancestry` doesn't throw if data is absent.
  legacy.data = inv.data || {};
  // state.ancestryViewChips — Set of currently-active view chips (e.g.
  // 'label', 'qvalue', 'delta12'). Page-7 private; not in
  // SLOT_REGISTRY. Default to empty Set so `.has(chip)` is safe.
  legacy.ancestryViewChips = inv.ancestryViewChips || new Set();
  // state.candidate — IS in SLOT_REGISTRY. Used for the "selected
  // candidate" cursor band. Default null (no candidate selected).
  legacy.candidate = inv.candidate || null;
  return legacy;
}


// =============================================================================
// state references not in SLOT_REGISTRY
// =============================================================================
//
// state.data                 — IS in SLOT_REGISTRY (transient). The ancestry
//                              renderer reads state.data.ancestry (an
//                              optional sub-layer) for per-window K labels,
//                              Q-values, and delta12.
// state.ancestryViewChips    — Set of currently-active view chips (e.g.
//                              'label', 'qvalue', 'delta12'). Page-7
//                              private; not in SLOT_REGISTRY. Recommendation:
//                              keep page-private (UI state, transient).
// state.candidate            — IS in SLOT_REGISTRY. Used for the "selected
//                              candidate" cursor band on each ancestry section.
//
// No new SLOT_REGISTRY entries are introduced by this page.
// =============================================================================
