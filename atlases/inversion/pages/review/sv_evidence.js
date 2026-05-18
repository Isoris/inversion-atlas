// =============================================================================
// inversion_review/sv_evidence.js — "5b SV evidence" tab
// =============================================================================
// Stage:        review (refinement)
// Legacy DOM:   <div id="sv_evidence"> with inner #sv_evidence_root
//               (legacy lines 9329–9331)
// Renderer:     window.AtlasSVEvidence — loaded from js/atlas_sv_evidence.js
//               (external file, NOT inlined in legacy Inversion_atlas.html)
// Tab dispatch: Wired by the merge chat into the tab dispatcher (init when
//               the tab first activates, loadCandidate whenever
//               state.candidate changes).
// Spec:         specs_done/SPEC_sv_evidence_page.md (authored 2026-05-15
//               from shipped code — see SPECS_AUDIT.md recovery effort)
//
// What this page does
// -------------------
// Read-only view of SV calls clustered around a candidate's boundaries,
// scored against the karyotype groups. Loads `json/sv_genotype_counts/<cid>.json`
// per candidate. Renders three things stacked top-to-bottom:
//   - SV table (columns: caller, type, chrom, pos, len, support, gt-counts)
//   - UpSet plot of caller intersections
//   - dosage heatmap (step 6 spec)
//
// DOM contract:
//   #sv_evidence    — page wrapper (visibility toggled by router)
//   #sv_evidence_root    — single inner mount slot owned by AtlasSVEvidence
//
// Round-5-step-19 status (chat 39, 2026-05-07): thin-loader-stub
// migration — pattern 4 ("stub-preserving + one wired entry") applied as a
// **direct twin of ancestry_per_window + popstats** (the first two migrated review-stage
// pages, shipped steps 17 + 18). Both chat-33 exports preserved verbatim:
//   - showSvEvidencePage(state)  — main entry; tries window.AtlasSVEvidence,
//                                  falls back to a missing-renderer empty-state
//                                  message if absent. On the present path,
//                                  guards init via mod.__pageInitDone and
//                                  guards loadCandidate via mod.__lastCid (so
//                                  re-mount with the same candidate is a no-op).
//   - hideSvEvidencePage()       — teardown entry; calls mod.destroy() if
//                                  available. NB: this is a teardown, not a
//                                  refresh — semantically distinct from popstats's
//                                  refreshPopstatsPage and ancestry_per_window's
//                                  refreshAncestryPage.
// New: _state.js sub-module + state-aware wrapper refreshPageSvEvidence +
// mount/unmount lifecycle. mount() calls showSvEvidencePage(legacyState)
// so the fallback empty-state renders at mount time even if
// window.AtlasSVEvidence is absent. unmount() now also calls
// hideSvEvidencePage so the external module's destroy() runs.
//
// **Third (and final) review tier-1 thin-loader-stub migration.** After
// this round, review tier-1 is closed (only karyotype_tier, boundary_refinement, multi_species_cockpit
// remain across the whole project).
//
// Extraction notes (Batch 2)
// --------------------------
// Unlike the other review pages (popstats, ancestry_per_window), sv_evidence is NOT
// even *referenced* by a typeof-guard inside the legacy HTML — the whole
// renderer lives in `js/atlas_sv_evidence.js`, loaded as an external
// script and exposed as `window.AtlasSVEvidence`.
//
// Inside legacy Inversion_atlas.html the only references are:
//   - the mount slot DOM (lines 9329–9331)
//   - the script-tag inventory entry (line 54981) listing
//     `{ file: 'js/atlas_sv_evidence.js', global: 'AtlasSVEvidence' }`
//
// So this module:
//   1. Provides the lifecycle adapter the merge chat will wire into the
//      tab dispatcher (init when the tab first activates, loadCandidate
//      whenever state.candidate changes).
//   2. Treats `window.AtlasSVEvidence` as the contract surface — the
//      external JS file is shipped alongside the atlas as-is.
//
// Decision (BATCH_2_NOTES): kept as external-file dep for now. Promoting
// the SV evidence renderer to ES modules is out of scope for batch 2 — it
// touches IndexedDB caching and the UpSet plot lib, which deserves its own
// extraction pass.
//
// Registry alignment (NOT a mismatch — distinct from popstats/ancestry_per_window)
// ---------------------------------------------------------------
// pages.registry.json declares sv_evidence has
//   "requires_layers": ["candidate_sv_counts"]
//   "requires_slots":  ["activeCandidate"]
//   "preloads":        ["candidate_sv_counts"]
// **This MATCHES what the page actually does.** Unlike popstats and ancestry_per_window
// (both flagged with shape-of-mismatch entries in steps 17/18),
// sv_evidence is genuinely a candidate-level view: the chat-33
// renderer reads `state.candidate.id` and fetches
// `json/sv_genotype_counts/<cid>.json` per-candidate. So the round-19
// migration leaves the registry entry untouched (no `_doc` flag for
// Quentin needed on this entry). Documented in the round-19 handoff for
// completeness: only popstats + ancestry_per_window have the chromosome-vs-candidate
// mismatch shape; sv_evidence does not.
// =============================================================================


import { _pageState, _setActiveState } from './sv_evidence/_state.js';

// -----------------------------------------------------------------------------
// External-file dep — the page renderer lives in atlas_sv_evidence.js
// -----------------------------------------------------------------------------
//
// TODO_MISSING(AtlasSVEvidence.init)            — js/atlas_sv_evidence.js
// TODO_MISSING(AtlasSVEvidence.loadCandidate)   — js/atlas_sv_evidence.js
// TODO_MISSING(AtlasSVEvidence.destroy)         — js/atlas_sv_evidence.js
//
// These are not in the legacy HTML at all — the merge chat needs to either
// (a) bundle js/atlas_sv_evidence.js as a sibling module, or
// (b) port its contents into shared/ if we go fully ES-module.
// -----------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Chat-33 exports — PRESERVED VERBATIM
// ---------------------------------------------------------------------------

/**
 * Show the SV-evidence page. Initialises the AtlasSVEvidence module on
 * first activation and dispatches a candidate-load if one is selected.
 *
 * Called by the tab dispatcher when the user clicks the "5b SV evidence"
 * chip. Idempotent: subsequent activations only re-render if the active
 * candidate has changed.
 *
 * @param {object} state   shared state object (not used directly here;
 *                         AtlasSVEvidence reads from window.state in legacy)
 * @returns {void}
 */
export function showSvEvidencePage(state) {
  if (typeof window === 'undefined') return;
  const mod = /** @type {any} */ (window).AtlasSVEvidence;
  if (!mod) {
    // External script not loaded — leave a friendly empty-state in the slot
    const root = document.getElementById('sv_evidence_root');
    if (root && !root.__svInitFailed) {
      root.innerHTML =
        '<div style="padding:32px 28px;color:var(--ink-dim);font-family:var(--mono);font-size:11.5px;line-height:1.6;">' +
        '<div style="font-weight:600;color:var(--ink);margin-bottom:8px;">SV evidence module not loaded</div>' +
        '<p style="margin:0;max-width:720px;">' +
        'The <code>AtlasSVEvidence</code> renderer ships in <code>js/atlas_sv_evidence.js</code>, ' +
        'an external script that wasn\'t included in this build. Drop the file alongside ' +
        '<code>inversion_review.html</code> and reload to enable this page.' +
        '</p></div>';
      root.__svInitFailed = true;
    }
    return;
  }

  // First-activation init. The legacy module owns its own init guard, but
  // we double-guard here so the dispatcher never has to care.
  if (!mod.__pageInitDone) {
    try {
      // TODO_MISSING(AtlasSVEvidence.init)
      mod.init({ rootSelector: '#sv_evidence_root' });
      mod.__pageInitDone = true;
    } catch (err) {
      console.warn('[sv_evidence] AtlasSVEvidence.init failed:', err);
      return;
    }
  }

  // Re-load whenever the active candidate changed since last activation.
  const cand = state && state.candidate;
  const cid = cand ? (cand.id || null) : null;
  if (mod.__lastCid !== cid) {
    try {
      // TODO_MISSING(AtlasSVEvidence.loadCandidate)
      mod.loadCandidate(cid);
      mod.__lastCid = cid;
    } catch (err) {
      console.warn('[sv_evidence] AtlasSVEvidence.loadCandidate failed:', err);
    }
  }
}


/**
 * Hide / tear down the SV-evidence page when the user navigates away.
 * Optional — most legacy code just leaves the DOM in place. Provided so the
 * dispatcher can call it symmetrically alongside show().
 *
 * @returns {void}
 */
export function hideSvEvidencePage() {
  if (typeof window === 'undefined') return;
  const mod = /** @type {any} */ (window).AtlasSVEvidence;
  if (mod && typeof mod.destroy === 'function') {
    try {
      // TODO_MISSING(AtlasSVEvidence.destroy)
      mod.destroy();
    } catch (_) { /* swallow */ }
  }
}


// ---------------------------------------------------------------------------
// State-aware public wrapper (round 5 step 19)
// ---------------------------------------------------------------------------

/**
 * Public entry — state-aware wrapper around showSvEvidencePage.
 *
 * If `state` is passed, sets _pageState as a side effect before delegating
 * (mirrors ancestry_per_window/popstats/confirmed_carousel/page15/help wrapper pattern). The chat-33
 * showSvEvidencePage signature already takes state as an explicit arg, so
 * the wrapper just threads _pageState into it.
 */
export function refreshPageSvEvidence(state) {
  if (state) _setActiveState(state);
  return showSvEvidencePage(state || _pageState || {});
}

// ---------------------------------------------------------------------------
// Atlas-router lifecycle (chat 39 round 5 step 19, 2026-05-07).
// ---------------------------------------------------------------------------

/**
 * Mount: called by atlas_router when the user navigates to sv_evidence.
 *
 * Builds a legacy-shape state with the slot sv_evidence reads
 * (candidate — the renderer reads `.id` to fetch
 * json/sv_genotype_counts/<cid>.json). Calls refreshPageSvEvidence to
 * render the SV-evidence view (or the missing-module empty state if
 * window.AtlasSVEvidence is absent).
 */
export async function mount(root, atlasState, registry) {
  const legacyState = _buildLegacyState(atlasState);
  _setActiveState(legacyState);

  try { refreshPageSvEvidence(legacyState); }
  catch (e) { console.warn('sv_evidence.mount: refreshPageSvEvidence threw —', e); }

  if (atlasState.inversion) atlasState.inversion._pageSvEvidenceState = legacyState;
}

/**
 * Unmount: tear down the external renderer (if loaded) and clear
 * _pageState so post-unmount callbacks see null.
 */
export async function unmount(root) {
  try { hideSvEvidencePage(); }
  catch (e) { console.warn('sv_evidence.unmount: hideSvEvidencePage threw —', e); }
  _setActiveState(null);
}

function _buildLegacyState(atlasState) {
  const inv = atlasState.inversion || {};
  const legacy = Object.assign({}, inv);
  // state.candidate — IS in SLOT_REGISTRY (cross_atlas). The SV-evidence
  // renderer reads `.id` to fetch json/sv_genotype_counts/<cid>.json.
  // Default null (no candidate selected — renderer gets null cid and
  // shows an empty SV table).
  legacy.candidate = inv.candidate || null;
  return legacy;
}


// =============================================================================
// state references not in SLOT_REGISTRY
// =============================================================================
//
// state.candidate    — IS in SLOT_REGISTRY (cross_atlas). The renderer reads
//                      `.id` to fetch json/sv_genotype_counts/<cid>.json.
//
// (AtlasSVEvidence also reads its own internal state via window.state in the
//  legacy build — that's the closure-scoped legacy global, not anything new.
//  No new SLOT_REGISTRY entries are introduced by this page.)
// =============================================================================
