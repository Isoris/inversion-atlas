// =============================================================================
// inversion_review/page6.js — "8 popstats" tab
// =============================================================================
// Stage:        review (per-window popstats track stack)
// Legacy DOM:   <div id="page6"> (legacy lines 7647–7658)
// Renderer:     renderPopstatsPage()  — defined in external js/atlas_page6_wiring.js
// Tab dispatch: legacy lines 59626–59627, 59729–59730
//
// What this page does
// -------------------
// Stack of population-genetic tracks aligned to the chromosome:
//   - |Z| / score
//   - SNP density
//   - BEAGLE imputation uncertainty
//   - depth / coverage
//   - θπ (Tajima's per-window pi)
//   - F_ST (between karyotype groups)
//   - Hobs / Hexp (observed vs expected heterozygosity)
//   - ancestry Δ12 (top-1 minus top-2 Q)
//
// The track inventory lives in the request layer (atlas_request_layer.js)
// which talks to a popstats live server (POST /api/popstats/*); the page-6
// wiring (atlas_page6_wiring.js) wraps that with track-def slot-combine UI
// and tooltips. Click chips in #psChips to toggle visibility.
//
// DOM contract:
//   #psToolbar    — sticky chip bar (<span id="psChips">)
//   #psStack      — vertical canvas-track stack
//   #psNoChrom    — empty state when no precomp loaded
//   #psGalleryTray — collapsible track-discovery sidebar (turn 6.5)
//
// Round-5-step-18 status (chat 38 cont., 2026-05-07): thin-loader-stub
// migration — pattern 4 ("stub-preserving + one wired entry") applied.
// **Direct twin of page7** (the first migrated review-stage page,
// shipped step 17). Both chat-33 exports preserved verbatim:
//   - showPopstatsPage(state)    — main entry; tries window.renderPopstatsPage,
//                                   falls back to a missing-renderer empty-state
//                                   message if absent.
//   - refreshPopstatsPage()      — re-render entry; delegates to
//                                   showPopstatsPage().
// New: _state.js sub-module + state-aware wrapper refreshPage6 +
// mount/unmount lifecycle. mount() calls showPopstatsPage(legacyState)
// so the fallback empty-state renders at mount time even if
// window.renderPopstatsPage is absent.
//
// Second migrated review-stage page (review group: 1 of 5 → 2 of 5).
//
// Extraction notes (Batch 2)
// --------------------------
// The popstats stack is driven entirely by external JS files (per the script
// inventory at legacy line 54963–54972):
//   - js/atlas_request_layer.js  → window.popgenLive
//   - js/atlas_page6_wiring.js   → window.popgenPage6
//   - js/atlas_track_gallery.js  → window.popgenGallery
//
// Inside Inversion_atlas.html itself there is NO `function renderPopstatsPage`
// — the legacy code only references it via `if (typeof renderPopstatsPage
// === 'function')` guards. So the page module here is a thin lifecycle
// wrapper, like sv_evidence.js + page7.js.
//
// Decision (BATCH_2_NOTES): kept the popstats stack as an external-script
// dep rather than promoting to shared. The whole thing depends on a
// popstats live server and IndexedDB caching that doesn't fit the
// "pure-helper" shape of the shared/ modules.
//
// Registry mismatch flagged for Quentin
// -------------------------------------
// pages.registry.json declares page6 has
//   "requires_layers": ["candidate_gene_cargo"]
//   "requires_slots":  ["activeCandidate"]
//   "preloads":        ["candidate_gene_cargo"]
// but the page6.js header + DOM contract clearly describe page6 as a
// CHROMOSOME-LEVEL popstats track stack driven by per-window metrics
// (theta_pi, fst, hobs/hexp, depth, ancestry delta12, etc.) keyed on
// activeChrom + group_set_id. The popstats renderer reads
// state.popstatsLive (cache), state.popstatsTracksOn (chip set),
// state.popstatsGalleryOpen, state.candidate (cursor band only), and
// state.data (per-window layers). The `candidate_gene_cargo` layer +
// `activeCandidate` slot look like they belong on a different
// (currently-non-existent) candidate-gene-cargo page, not on the
// popstats track stack.
// **Round 18 does NOT change requires_layers / requires_slots** —
// this is the same architectural-discipline rule established in step
// 17 for page7: registry content is Quentin's design decision, not a
// migration concern. The migration only adds _label + _doc describing
// what the page actually does; the mismatch is documented in the
// pages.registry.json _doc + here for Quentin's decision (defer to
// renumbering round recommended).
// =============================================================================


import { _pageState, _setActiveState } from './page6/_state.js';

// -----------------------------------------------------------------------------
// External-file deps
// -----------------------------------------------------------------------------
//
// TODO_MISSING(renderPopstatsPage)        — js/atlas_page6_wiring.js
//                                            (dispatched at legacy 59626 + 59729)
// TODO_MISSING(popgenLive)                — js/atlas_request_layer.js
//                                            (POST /api/popstats/* wrappers)
// TODO_MISSING(popgenPage6)               — js/atlas_page6_wiring.js
// TODO_MISSING(popgenGallery)             — js/atlas_track_gallery.js
// -----------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Chat-33 exports — PRESERVED VERBATIM
// ---------------------------------------------------------------------------

/**
 * Show the popstats page. The renderer is defined in atlas_page6_wiring.js;
 * this wrapper exists so the tab dispatcher has a single ES-module entry
 * to call.
 *
 * @param {object} state  shared state (not used directly here — the legacy
 *                        renderer reads window.state)
 * @returns {void}
 */
export function showPopstatsPage(state) {
  if (typeof window === 'undefined') return;
  const fn = /** @type {any} */ (window).renderPopstatsPage;
  if (typeof fn === 'function') {
    try {
      // TODO_MISSING(renderPopstatsPage)
      fn();
    } catch (err) {
      console.warn('[page6] renderPopstatsPage threw:', err);
    }
    return;
  }

  // Fallback empty state — surfaces the missing-dep clearly to the user.
  const stack = document.getElementById('psStack');
  const noChrom = document.getElementById('psNoChrom');
  if (noChrom) {
    noChrom.style.display = 'block';
    noChrom.innerHTML =
      'Popstats wiring (<code>atlas_page6_wiring.js</code>) not loaded. ' +
      'Drop the page-6 script bundle alongside this HTML and reload.';
  }
  if (stack) stack.innerHTML = '';
}


/**
 * Re-render the popstats page after state changes (e.g. chrom switch,
 * candidate change). Idempotent — safe to call repeatedly.
 *
 * @returns {void}
 */
export function refreshPopstatsPage() {
  // Same dispatch as show — the legacy renderer is itself idempotent.
  showPopstatsPage();
}


// ---------------------------------------------------------------------------
// State-aware public wrapper (round 5 step 18)
// ---------------------------------------------------------------------------

/**
 * Public entry — state-aware wrapper around showPopstatsPage.
 *
 * If `state` is passed, sets _pageState as a side effect before delegating
 * (mirrors page7/confirmed_carousel/page15/help wrapper pattern). The chat-33
 * showPopstatsPage signature already takes state as an explicit arg, so
 * the wrapper just threads _pageState into it.
 */
export function refreshPage6(state) {
  if (state) _setActiveState(state);
  return showPopstatsPage(state || _pageState || {});
}

// ---------------------------------------------------------------------------
// Atlas-router lifecycle (chat 38 cont. round 5 step 18, 2026-05-07).
// ---------------------------------------------------------------------------

/**
 * Mount: called by atlas_router when the user navigates to page6.
 *
 * Builds a legacy-shape state with the slots page6 will eventually need
 * (data — per-window popstats layers; popstatsLive — IndexedDB cache;
 * popstatsTracksOn — chip Set; popstatsGalleryOpen — gallery tray flag;
 * candidate — for the cursor band). Calls refreshPage6 to render the
 * popstats stack (or the missing-renderer empty state if
 * window.renderPopstatsPage is absent).
 */
export async function mount(root, atlasState, registry) {
  const legacyState = _buildLegacyState(atlasState);
  _setActiveState(legacyState);

  try { refreshPage6(legacyState); }
  catch (e) { console.warn('page6.mount: refreshPage6 threw —', e); }

  if (atlasState.inversion) atlasState.inversion._page6State = legacyState;
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
  // state.data — IS in SLOT_REGISTRY (transient). The popstats renderer
  // reads its layers (theta_pi, fst, hobs/hexp, depth, ancestry delta12,
  // etc.) from inside state.data. Default empty object so layer access
  // doesn't throw if data is absent.
  legacy.data = inv.data || {};
  // state.popstatsLive — page-6 cache (IndexedDB-backed responses keyed by
  // {chrom, group_set_id, metric}). Owned by atlas_request_layer.js;
  // page-private. Default empty object — populated lazily by the request
  // layer.
  legacy.popstatsLive = inv.popstatsLive || {};
  // state.popstatsTracksOn — Set of currently-active chip IDs. Page-6
  // private; default empty Set so `.has(chipId)` is safe.
  legacy.popstatsTracksOn = inv.popstatsTracksOn || new Set();
  // state.popstatsGalleryOpen — gallery tray collapsed/expanded flag.
  // Page-6 private; default false (tray collapsed).
  legacy.popstatsGalleryOpen = inv.popstatsGalleryOpen || false;
  // state.candidate — IS in SLOT_REGISTRY (cross_atlas). Used for the
  // "selected candidate" cursor band on each popstats track. Default
  // null (no candidate selected).
  legacy.candidate = inv.candidate || null;
  return legacy;
}


// =============================================================================
// state references not in SLOT_REGISTRY
// =============================================================================
//
// state.data                 — IS in SLOT_REGISTRY (transient). The popstats
//                              renderer reads its layers (theta_pi, fst,
//                              hobs/hexp, etc.) from inside state.data.
// state.candidate            — IS in SLOT_REGISTRY (cross_atlas).
// state.popstatsLive         — page-6 cache, NOT in SLOT_REGISTRY. Holds
//                              IndexedDB-backed responses keyed by
//                              { chrom, group_set_id, metric }. Owned by
//                              atlas_request_layer.js. Recommendation:
//                              keep page-private; do NOT promote.
// state.popstatsTracksOn     — Set of currently-active chip IDs. Page-6
//                              private. Recommendation: keep page-private.
// state.popstatsGalleryOpen  — gallery tray collapsed/expanded flag. Page-6
//                              private.
//
// All three popstats-* state slots are page-private and intentionally
// stay outside SLOT_REGISTRY (they're caches/UI flags, not data).
// =============================================================================
