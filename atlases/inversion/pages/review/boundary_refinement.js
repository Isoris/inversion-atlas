// =============================================================================
// inversion_review/boundary_refinement.js — "boundaries" tab
// =============================================================================
// Stage:        review (refinement)
// Legacy DOM:   <div id="boundary_refinement"> (legacy lines 7906–7921)
// Renderer:     renderBoundariesPage()  (legacy lines 30175–30314)
// Hotkey hub:   _bndKeyHandler / _bndAttachHotkeys / _bndDetachHotkeys
//                (legacy lines 30318–30345)
//
// What this page does
// -------------------
// Refines a promoted candidate's [start_bp, end_bp] into approximate left/right
// boundary zones using multiple evidence tracks. Auto-propose runs the
// BOUNDARY_TRACK_WEIGHTS-weighted algorithm; manual override via E/F at the
// scrubber cursor. Save (B) persists onto the candidate; Reset (R) clears.
//
// Terminology contract (kept from legacy comments):
//   "boundary zone"   = default verdict; what auto-propose ever produces.
//   "exact breakpoint" = reserved for junction-level evidence only.
//
// Round-5-step-22 status (chat 39 cont., 2026-05-07): single-file-with-
// _state-module migration — pattern 2 ("single file with _state.js")
// applied. **THE FINAL MIGRATION** (review group: 4 of 5 → 5 of 5;
// **MIGRATION COMPLETE 21/21**). All 4 chat-33 exports preserved verbatim:
//   - renderBoundariesPage()  — public entry, called by tab dispatcher
//   - _bndKeyHandler(e)       — hotkey dispatcher
//   - _bndAttachHotkeys()     — install document-level keydown listener
//   - _bndDetachHotkeys()     — remove the listener
//
// **Zero AST shims needed.** None of the 4 chat-33 functions read bare
// `state.X` — they operate exclusively on DOM and on the closure-scoped
// `bs` object returned by `_ensureBoundariesState()` (TODO_MISSING).
// This is a stronger statement than karyotype_tier made (karyotype_tier needed shims into
// 2 of 4 helpers); boundary_refinement is even simpler than karyotype_tier in this dimension.
//
// New: _state.js sub-module + state-aware wrapper refreshPage11 +
// mount/unmount lifecycle. mount-time render wrapped in try/catch
// (matching cross_species_breakpoints/multi_species_cockpit/karyotype_tier) because the populated path hits 31
// TODO_MISSING `_bnd*` helpers which throw ReferenceError until a
// follow-up extraction round lands them. With state.candidate=null
// (typical empty mount), renderBoundariesPage early-returns at
// `_ensureBoundariesState()` (which itself is TODO_MISSING — i.e. the
// FIRST line that throws). The try/catch makes mount() never propagate.
//
// Registry mismatch FLAGGED for Quentin (FOURTH instance, NEW shape)
// ------------------------------------------------------------------
// pages.registry.json declares boundary_refinement has
//   "requires_layers": ["candidate_final_class", "candidate_breeding_card"]
//   "requires_slots":  ["activeCandidate"]
//   "preloads":        ["candidate_final_class", "candidate_breeding_card"]
// **The activeCandidate slot is correct** — boundary_refinement IS a candidate-level
// view (operates on a single promoted candidate's start_bp/end_bp). But
// the requires_layers values look misplaced: `candidate_final_class`
// looks like karyotype_tier's territory (karyotype_tier reads
// state.data.final_classification, the 14-axis classification), and
// `candidate_breeding_card` does not appear anywhere in boundary_refinement's source
// at all. What boundary_refinement actually consumes (per the trailing comment
// block) is state.candidate (and its sub-fields) +
// state.candidateList + state.repeatDensity + state.ncRNADensity +
// state.data — none of which match the declared layers.
//
// **Notable correlate**: karyotype_tier (step 21 flag) declared `candidate_boundaries`
// which the karyotype_tier handoff said "looks like boundary_refinement's territory" — yet
// boundary_refinement declares neither `candidate_boundaries` nor anything boundary-
// related. This is consistent with a SWAP pattern: karyotype_tier's declared
// `candidate_sv_counts` + `candidate_boundaries` may have been swapped
// with boundary_refinement's declared `candidate_final_class` + `candidate_breeding_card`.
// Quentin to decide whether the swap is real (and if so, which way to
// unwind it) at the renumbering round.
//
// **Round 22 does NOT change requires_layers / requires_slots /
// preloads** — same architectural-discipline rule established step 17.
// Recommendation: defer to renumbering round (Option C, same as the
// other three flags — karyotype_tier, popstats, ancestry_per_window).
//
// Extraction notes (Batch 2)
// --------------------------
// Only the page-level entry points are extracted here. The ~25 boundary
// helpers (`_bnd*`, `_ensureBoundariesState`, `_findSVAnchorsInZone`,
// `_buildBoundaryTrackScores`, `_computeBoundaryEdges`, `_buildBoundaryRecord`,
// `_renderCandidateNavInline`, the four `_wireRepeatDensity*` wirers, etc.)
// are marked TODO_MISSING below — the merge chat decides whether to promote
// them to shared/ or copy them in here.
// =============================================================================

import { _pageState, _setActiveState } from './boundary_refinement/_state.js';
import { renderCandidateNavInline as _renderCandidateNavInline } from '../../shared/candidate_nav.js';
import { ensureChromTracks } from '../../shared/ensure_chrom_tracks.js';
import { probeModeB, renderModeBBadge } from '../../../../core/mode_b_badge.js';
import {
  refreshBoundariesUi,
  wireBoundariesToolbar,
  teardownBoundariesToolbar,
  selectCandidate as _bndSelectCandidate,
  bndAutoPropose as _bndAutoProposeImpl,
  bndOverrideLeft as _bndOverrideLeftImpl,
  bndOverrideRight as _bndOverrideRightImpl,
  bndReset as _bndResetImpl,
  bndSave as _bndSaveImpl,
  populateCandidateSelect as _bndPopulateCandidateSelect,
  updateRadiusButtons as _bndUpdateRadiusButtons,
  updateSaveButton as _bndUpdateSaveButton,
  updateStatusSelect as _bndUpdateStatusSelect,
} from './boundary_refinement/boundaries_ui.js';
import {
  ensureBoundariesState as _ensureBoundariesState,
  bndFmtBp as _bndFmtBp,
  bndFindCandidate as _bndFindCandidate,
  boundaryScanRange as _boundaryScanRange,
  buildBoundaryRecord as _buildBoundaryRecord,
  buildBoundaryTrackScores as _buildBoundaryTrackScores,
  computeBoundaryEdges as _computeBoundaryEdges,
  findSVAnchorsInZone as _findSVAnchorsInZone,
  supportClass as _supportClass,
  bndCloneRecord as _bndCloneRecord,
  bndStageFromCandidate as _bndStageFromCandidate,
  BOUNDARY_DEFAULTS,
  BOUNDARY_TRACK_WEIGHTS,
  BOUNDARY_TRACK_POLARITY,
  BOUNDARY_TRACK_NAMES,
  SUPPORT_CLASS_COLORS,
} from './boundary_refinement/boundaries.js';

// Re-export the public surface so downstream consumers don't need to know
// about the split. Match legacy naming where possible (underscore-prefixed
// for page-private legacy helpers).
export {
  refreshBoundariesUi, wireBoundariesToolbar, teardownBoundariesToolbar,
} from './boundary_refinement/boundaries_ui.js';
export {
  ensureBoundariesState, boundaryScanRange, computeBoundaryEdges,
  buildBoundaryTrackScores, buildBoundaryRecord, findSVAnchorsInZone,
  supportClass, bndFindCandidate, bndFmtBp, bndCloneRecord,
  bndStageFromCandidate, resampleBoundaryEvidenceTrack,
  BOUNDARY_DEFAULTS, BOUNDARY_TRACK_WEIGHTS, BOUNDARY_TRACK_POLARITY,
  BOUNDARY_TRACK_NAMES, SUPPORT_CLASS_COLORS,
} from './boundary_refinement/boundaries.js';

// -----------------------------------------------------------------------------
// Unresolved external deps — to be filled by the merge chat.
// (Round 22 status: still TODO_MISSING. Migration round did NOT
// implement the missing helpers; that's an extraction-of-legacy-
// helpers round, not a migration round. Cross-page guard-resolution
// audit performed step 22: NONE of the 31 markers are already
// exported in the migrated tree. Confirms these are genuinely
// boundary_refinement-private helpers awaiting a Batch-2 extraction round.)
// -----------------------------------------------------------------------------
//
// TODO_MISSING(_ensureBoundariesState)         — legacy line 17763
// TODO_MISSING(_boundaryScanRange)             — legacy line 17813
// TODO_MISSING(_findSVAnchorsInZone)           — legacy line 17895
// TODO_MISSING(_buildBoundaryTrackScores)      — legacy line 17942
// TODO_MISSING(_computeBoundaryEdges)          — legacy line 18127
// TODO_MISSING(_buildBoundaryRecord)           — legacy line 18256
// TODO_MISSING(_bndFindCandidate)              — legacy line 18297
// TODO_MISSING(_bndFmtBp)                      — legacy line 18308
// TODO_MISSING(_bndCloneRecord)                — legacy line 18317
// TODO_MISSING(_bndStageFromCandidate)         — legacy line 18337
// TODO_MISSING(_bndPopulateCandidateSelect)    — legacy line 18351
// TODO_MISSING(_bndUpdateRadiusButtons)        — legacy line 18383
// TODO_MISSING(_bndUpdateSaveButton)           — legacy line 18394
// TODO_MISSING(_bndUpdateStatusSelect)         — legacy line 18404
// TODO_MISSING(_bndSelectCandidate)            — legacy line 18415
// TODO_MISSING(_bndAutoPropose)                — legacy line 18424
// TODO_MISSING(_bndManualOverride)             — legacy line 18479
// TODO_MISSING(_bndOverrideLeft)               — legacy line 18622
// TODO_MISSING(_bndOverrideRight)              — legacy line 18623
// TODO_MISSING(_bndReset)                      — legacy line 18626
// TODO_MISSING(_bndSave)                       — legacy line 18640
// TODO_MISSING(_bndRefreshSummary)             — legacy line 18658
// TODO_MISSING(_bndDrawTracks)                 — legacy line 18726
// TODO_MISSING(_bndRefreshUI)                  — legacy line 18911
// TODO_MISSING(_renderBndFocalVsBg)            — legacy line 20507
// TODO_MISSING(_wireRepeatDensityEscapeReset)  — legacy line 20583
// TODO_MISSING(_wireRepeatDensityClassCycle)   — legacy line 20856
// TODO_MISSING(_wireRepeatDensityAllTeToggle)  — legacy line 20895
// TODO_MISSING(_wireRepeatDensityArrowNav)     — legacy line 20941
// TODO_MISSING(_renderCandidateNavInline)      — shared candidate-nav helper
//                                                (used by pages 4/6/7/11 too)
//
// All of the `_bnd*` helpers operate on a single closure-scoped `state`
// object (the legacy global). When porting, they should accept `state` as
// an explicit first argument. For now this module presumes the merge chat
// promotes a `state` symbol via the wrapper convention used in main.js.
// -----------------------------------------------------------------------------


// =============================================================================
// renderBoundariesPage — public entry, called by tab dispatcher
// =============================================================================
// Legacy: lines 30175–30314. Verbatim (no shim needed — reads no bare state).
// All bare `_bnd*`, `_renderCandidateNavInline`, `_ensureBoundariesState`
// references stay as global lookups; the merge chat patches them.
// =============================================================================
export function renderBoundariesPage() {
  const slot = document.getElementById('page11Content');
  if (!slot) return;
  const bs = _ensureBoundariesState(_pageState);
  // v3.99 turn 13 ask 1: candidate-nav bar above the existing toolbar. Always
  // re-rendered so prev/next button state stays in sync. Boundaries page also
  // has its own #bndCandSelect dropdown, but the prev/next buttons are
  // faster for stepping through; both stay in sync via _navigateToCandidate.
  // Candidate-nav inline bar — prev/next/whole-genome chevrons between
  // the header and toolbar. The shared cartridge implementation lives
  // in shared/candidate_nav.js. Wired with onNavigate that sets
  // state.candidate (the page-router's setActivePage flow takes over
  // from there).
  const boundary_refinement = document.getElementById('boundary_refinement');
  if (boundary_refinement) {
    const oldNav = boundary_refinement.querySelector && boundary_refinement.querySelector('.cand-nav-inline');
    if (oldNav && typeof oldNav.remove === 'function') oldNav.remove();
    const navBar = _renderCandidateNavInline(_pageState, {
      idPrefix: 'bnd',
      onNavigate: (st, target) => {
        if (st) st.candidate = target;
        renderBoundariesPage();
      },
      onClearActive: (st) => {
        if (st) st.candidate = null;
        renderBoundariesPage();
      },
    });
    if (navBar) {
      navBar.style.margin = '12px 32px 0';
      const header = document.getElementById('page11Header');
      if (header && header.nextSibling) {
        boundary_refinement.insertBefore(navBar, header.nextSibling);
      } else {
        boundary_refinement.appendChild(navBar);
      }
    }
  }
  // Build toolbar + structure once; populate dynamic parts each time
  if (!slot.__bndBuilt) {
    slot.innerHTML = `
      <div class="bnd-toolbar">
        <span class="bnd-lbl">candidate:</span>
        <select id="bndCandSelect"></select>
        <span class="bnd-lbl">scan radius:</span>
        <div class="bnd-radius-group">
          <button class="bnd-radius-btn" data-radius="1000"
                  title="±1 kb scan — for SV-supported breakpoints with split-read evidence; most PCA tracks won't render meaningfully at this scale">1 kb</button>
          <button class="bnd-radius-btn" data-radius="5000"
                  title="±5 kb scan — fine breakpoint inspection; matches MODULE_3 win5000.step1000 θπ scale">5 kb</button>
          <button class="bnd-radius-btn" data-radius="10000"
                  title="±10 kb scan — boundary zone refinement; matches MODULE_3 win10000.step2000 θπ scale">10 kb</button>
          <button class="bnd-radius-btn" data-radius="25000"
                  title="±25 kb scan — typical breakpoint working scale for boundary_zone_only verdicts">25 kb</button>
          <button class="bnd-radius-btn" data-radius="100000"
                  title="±100 kb scan — broader boundary context; matches the hobs_profile / fst_profile distances_kb default range in SCHEMA §21">100 kb</button>
          <span class="bnd-radius-sep"
                style="display: inline-block; width: 1px; height: 16px;
                       background: var(--rule); margin: 0 4px;
                       vertical-align: middle;"></span>
          <button class="bnd-radius-btn" data-radius="1000000"
                  title="±1 Mb scan — whole-region context, useful when SV calls and PCA boundaries disagree by hundreds of kb">1 Mb</button>
          <button class="bnd-radius-btn" data-radius="1500000"
                  title="±1.5 Mb scan">1.5 Mb</button>
          <button class="bnd-radius-btn" data-radius="2000000"
                  title="±2 Mb scan">2 Mb</button>
          <button class="bnd-radius-btn" data-radius="5000000"
                  title="±5 Mb scan — broadest context, useful for very large or hugely-asymmetric candidates (kicks in automatically at &gt;CANDIDATE_HUGE_BP via _boundaryScanRange)">5 Mb</button>
        </div>
        <button id="bndAutoProposeBtn" class="primary" title="Run the auto-propose algorithm (or hotkey A)">auto-propose</button>
        <button id="bndOverrideLBtn" title="Override LEFT boundary at the current focal window (hotkey E)">override left (E)</button>
        <button id="bndOverrideRBtn" title="Override RIGHT boundary at the current focal window (hotkey F)">override right (F)</button>
        <button id="bndResetBtn" title="Clear both boundaries (hotkey R)">reset (R)</button>
        <button id="bndSaveBtn" title="Persist boundary annotation onto the candidate (hotkey B)">save (B)</button>
        <span class="bnd-status-wrap">
          <span class="bnd-lbl">status:</span>
          <select id="bndStatusSel" title="Strongest available evidence — auto only ever sets boundary_zone_only; promote manually after reviewing SV/junction evidence.">
            <option value="boundary_zone_only">boundary_zone_only</option>
            <option value="SV_supported">SV_supported</option>
            <option value="junction_supported">junction_supported</option>
          </select>
        </span>
      </div>
      <div class="bnd-info" id="bndInfo">No candidate selected.</div>
      <div class="bnd-tracks" id="bndTracks"></div>
      <div class="bnd-summary" id="bndSummary"></div>
      <!-- v4 turn 25: class summary auto-scan -->
      <div class="bnd-class-summary" id="bndClassSummary"></div>
      <!-- v4 turn 18: repeat density panel -->
      <div class="bnd-repeat-density" id="bndRepeatDensity"></div>
      <!-- turn 116: ncRNA density panel (rRNA / tRNA / ncRNA-other) -->
      <div class="bnd-ncrna-density" id="bndNcRNADensity"></div>
      <!-- turn 117: focal-vs-background widget -->
      <div class="bnd-focal-vs-bg" id="bndFocalVsBg"></div>
    `;
    // Wire events via the boundaries_ui module. Cursor-window-idx
    // getter is supplied by the caller of mount() when the page-1
    // cursor is wired up; here we default to null so override-left/
    // right is a no-op until the cursor wire arrives.
    wireBoundariesToolbar(_pageState, {
      getCursorWindowIdx: () => (_pageState && _pageState.cur),
      onChange: () => refreshBoundariesUi(_pageState),
    });
    slot.__bndBuilt = true;
  }
  refreshBoundariesUi(_pageState);
}


// =============================================================================
// Hotkey wiring — E (override left) / F (override right) / B (save)
//                  R (reset) / A (auto-propose). Only fires when boundary_refinement active.
// Legacy: lines 30318–30345. Verbatim (no shim needed — reads no bare state).
// =============================================================================
let _bndKeyHandlerAttached = false;

export function _bndKeyHandler(e) {
  // Visibility-gating used to check `.classList.contains('active')` but
  // atlas-core's router swaps `#app-root.innerHTML` per page — it never
  // sets `.active` on `.page` elements. Hotkeys E/F/B/R/A were therefore
  // permanently dead. Mount/unmount already gate via _bndAttach/Detach so
  // a simple element-present check is sufficient.
  const visible = document.getElementById('boundary_refinement');
  if (!visible) return;
  const ae = document.activeElement;
  if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
  // Don't trigger on Ctrl/Meta/Alt combos (those are reserved for browser shortcuts)
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = (e.key || '').toLowerCase();
  const cur = _pageState && _pageState.cur;
  if      (k === 'e') { e.preventDefault(); if (Number.isFinite(cur)) _bndOverrideLeftImpl(_pageState, cur); refreshBoundariesUi(_pageState); }
  else if (k === 'f') { e.preventDefault(); if (Number.isFinite(cur)) _bndOverrideRightImpl(_pageState, cur); refreshBoundariesUi(_pageState); }
  else if (k === 'b') { e.preventDefault(); _bndSaveImpl(_pageState); refreshBoundariesUi(_pageState); }
  else if (k === 'r') { e.preventDefault(); _bndResetImpl(_pageState); refreshBoundariesUi(_pageState); }
  else if (k === 'a') { e.preventDefault(); _bndAutoProposeImpl(_pageState); refreshBoundariesUi(_pageState); }
}

export function _bndAttachHotkeys() {
  if (_bndKeyHandlerAttached) return;
  if (typeof document === 'undefined') return;
  document.addEventListener('keydown', _bndKeyHandler);
  _bndKeyHandlerAttached = true;
}

export function _bndDetachHotkeys() {
  if (!_bndKeyHandlerAttached) return;
  if (typeof document === 'undefined') return;
  document.removeEventListener('keydown', _bndKeyHandler);
  _bndKeyHandlerAttached = false;
}


// =============================================================================
// state references not in SLOT_REGISTRY (caught at extraction time)
// =============================================================================
//
// state.repeatDensity   — per-chrom transposable-element density layer; used
//                         by `_wireRepeatDensity*` wirers and the bnd repeat
//                         density panel. Lazily created by data loader.
// state.ncRNADensity    — per-chrom ncRNA (rRNA/tRNA) density layer; same
//                         pattern as repeatDensity.
// state.candidate.*     — IS in SLOT_REGISTRY, but the `.locked_labels`,
//                         `.K`, `.tracks`, `.ref_l2`, `.start_bp`, `.end_bp`,
//                         `.id` sub-fields are intra-candidate schema (see
//                         shared/state_io.js KNOWN_LAYERS for canonical shape).
// state.candidateList   — IS in SLOT_REGISTRY (cross_atlas array); used by
//                         _bndPopulateCandidateSelect.
// state.data            — IS in SLOT_REGISTRY (transient); used as
//                         state.data.final_classification consumer (karyotype_tier too).
//
// (No genuine SLOT_REGISTRY-missing slots in renderBoundariesPage itself —
// all the cache/anchor business is keyed off the closure-scoped `bs` object
// from _ensureBoundariesState, not state.)
// =============================================================================


// ===========================================================================
// Atlas-router lifecycle (chat 39 cont. round 5 step 22, 2026-05-07).
//
// Explicit ES exports for the public surface of the boundaries refinement
// page. Round 22 added:
//   - import { _pageState, _setActiveState } from './boundary_refinement/_state.js'
//     (replacing the unused chat-33 SLOT_REGISTRY import)
//   - state-aware wrapper refreshPage11
//   - mount(root, atlasState, registry) lifecycle entry
//   - unmount(root) lifecycle exit
//   - _buildLegacyState(atlasState) helper
//
// **Zero AST shims needed** — none of the 4 chat-33 functions read bare
// `state.X`. They operate exclusively on DOM and on the closure-scoped
// `bs` object returned by `_ensureBoundariesState()` (TODO_MISSING).
//
// The 4 chat-33 export entries (renderBoundariesPage, _bndKeyHandler,
// _bndAttachHotkeys, _bndDetachHotkeys) are PRESERVED VERBATIM.
// ===========================================================================

/**
 * Public entry — state-aware wrapper around renderBoundariesPage.
 * Sets _pageState before delegating so future bare `state.X` reads
 * (once the 31 TODO_MISSING `_bnd*` helpers land) resolve to the
 * active mount's state.
 */
export function refreshPage11(state) {
  if (state) _setActiveState(state);
  return renderBoundariesPage();
}

/**
 * Mount: called by atlas_router when the user navigates to boundary_refinement.
 *
 * Builds a legacy-shape state with the slots boundary_refinement reads (per the
 * trailing comment block above):
 *   - state.candidate     (cross-atlas, may be null)
 *   - state.candidateList (cross-atlas array, used by populate select)
 *   - state.data          (transient, sub-field .final_classification)
 *   - state.repeatDensity (lazily-created TE density layer)
 *   - state.ncRNADensity  (ncRNA density layer)
 *
 * mount-time render: try/catch wraps the dispatcher call (matching
 * cross_species_breakpoints/multi_species_cockpit/karyotype_tier). Rationale: even with state.candidate=null,
 * renderBoundariesPage's first non-DOM-guard line is
 * `_ensureBoundariesState()` — which is TODO_MISSING and throws
 * ReferenceError. The try/catch guards mount() so it never propagates.
 * Once `_ensureBoundariesState` lands in a follow-up extraction round,
 * the empty-state path will paint the toolbar + "No candidate
 * selected." placeholder cleanly.
 */
export async function mount(root, atlasState, registry) {
  let legacyState = _buildLegacyState(atlasState);
  _setActiveState(legacyState);

  try { renderBoundariesPage(); }
  catch (e) { console.warn('boundary_refinement.mount: renderBoundariesPage threw —', e); }

  // Hotkeys — install document-level keydown listener. Idempotent;
  // _bndAttachHotkeys guards against double-install.
  try { _bndAttachHotkeys(); }
  catch (e) { console.warn('boundary_refinement.mount: _bndAttachHotkeys threw —', e); }

  if (atlasState.inversion) atlasState.inversion._page11State = legacyState;

  // 2026-05-26: self-bootstrap scrubber_main via the shared helper so the
  // boundary editor / scored-track panels render on direct navigation
  // — without this, legacy.data falls back to `{}` and every renderer
  // that iterates state.data.windows / state.data.l1_envelopes bails.
  const bootstrap = await ensureChromTracks(atlasState, registry);
  if (bootstrap.ok) {
    legacyState = _buildLegacyState(atlasState);
    _setActiveState(legacyState);
    try { renderBoundariesPage(); }
    catch (e) { console.warn('boundary_refinement.mount: post-bootstrap render threw —', e); }
    if (atlasState.inversion) atlasState.inversion._page11State = legacyState;
  }

  // Mode-B probe — non-blocking. Resolves lineage + active-version
  // boundaries so the reviewer can see what they'd overwrite on save.
  _renderBoundaryRefinementBadge(atlasState, registry).catch((e) => {
    console.warn('boundary_refinement.mount: badge probe threw —', e);
  });
}

async function _renderBoundaryRefinementBadge(atlasState, registry) {
  const slot = document.getElementById('brModeBBadge');
  if (!slot) return;
  const cand = (atlasState && atlasState.shared && atlasState.shared.activeCandidate) || null;
  const candidate_id = cand && (cand.candidate_id || cand.id) || null;
  if (!candidate_id) {
    slot.style.display = 'none';
    return;
  }
  slot.style.display = 'block';

  // Step 1: resolve lineage to discover active_version_id.
  const lineageProbe = await probeModeB(registry, 'candidate_lineage', { candidate_id }, {
    extractRows: (p) => {
      if (!p || !p.versions || typeof p.versions !== 'object') return null;
      return Object.entries(p.versions).map(([version_id, meta]) =>
        Object.assign({ version_id }, meta || {}));
    },
  });

  if (!lineageProbe.ok) {
    renderModeBBadge('brModeBBadge', lineageProbe, {
      label:    'boundaries on disk',
      layerKey: 'candidate_lineage',
      context:  candidate_id,
    });
    return;
  }

  const active_version_id = lineageProbe.payload && lineageProbe.payload.active_version_id;
  if (!active_version_id) {
    renderModeBBadge('brModeBBadge',
      { ok: false, reason: 'empty-result' },
      { label: 'boundaries on disk', layerKey: 'candidate_lineage', context: candidate_id });
    return;
  }

  // Step 2: resolve candidate_boundaries for the active version. The
  // boundaries file may not exist yet (first-time refinement); fall
  // back to a lineage-only summary in that case.
  const boundsProbe = await probeModeB(registry, 'candidate_boundaries',
    { candidate_id, version_id: active_version_id },
    { extractRows: (p) => {
        // boundaries_refined.json shape is loosely { boundary_blocks: [{...}], ... }
        // per toolkit_registries' boundary_refined.schema.json. Surface
        // whichever array is present; fall through with null if neither.
        if (!p) return null;
        if (Array.isArray(p.boundary_blocks)) return p.boundary_blocks;
        if (Array.isArray(p.blocks))          return p.blocks;
        if (Array.isArray(p.zones))           return p.zones;
        return null;
      } });

  const nVersions = lineageProbe.n;
  const versionsList = lineageProbe.rows.map((r) => r.version_id).join(', ');

  if (!boundsProbe.ok) {
    // Lineage exists but boundaries_refined.json doesn't — a normal
    // pre-first-save state. Render as drift (⚠) with a clear summary.
    renderModeBBadge('brModeBBadge',
      { ok: true, rows: lineageProbe.rows, payload: lineageProbe.payload,
        n: nVersions, sample_keys: lineageProbe.sample_keys },
      {
        label:    'boundaries on disk',
        layerKey: 'candidate_boundaries',
        context:  candidate_id,
        compare:  () => ({
          pass: false,
          summary: `lineage active = ${active_version_id} (${nVersions} version${nVersions === 1 ? '' : 's'}: ${versionsList}) · ` +
                   `no boundaries_refined.json yet for this version — save will create one`,
        }),
      });
    return;
  }

  const nBlocks = boundsProbe.n;
  renderModeBBadge('brModeBBadge', boundsProbe, {
    label:    'boundaries on disk',
    layerKey: 'candidate_boundaries',
    context:  `${candidate_id} / ${active_version_id}`,
    compare:  () => ({
      pass: nBlocks > 0,
      summary: `${nBlocks} boundary block${nBlocks === 1 ? '' : 's'} in active version ` +
               `(lineage: ${nVersions} version${nVersions === 1 ? '' : 's'}: ${versionsList}) · ` +
               'save here writes a NEW version_id',
    }),
  });
}

/**
 * Unmount: detach hotkeys + clear _pageState so post-unmount callbacks
 * see null.
 */
export async function unmount(root) {
  try { _bndDetachHotkeys(); }
  catch (e) { console.warn('boundary_refinement.unmount: _bndDetachHotkeys threw —', e); }
  try { teardownBoundariesToolbar(); }
  catch (e) { console.warn('boundary_refinement.unmount: teardownBoundariesToolbar threw —', e); }
  _setActiveState(null);
}

function _buildLegacyState(atlasState) {
  const inv = atlasState.inversion || {};
  const sh  = atlasState.shared    || {};
  const legacy = Object.assign({}, inv);

  // Cross-atlas slots
  legacy.candidate     = sh.activeCandidate || null;
  legacy.candidateList = sh.candidateList || inv.candidateList || [];

  // Per-chromosome data lives at inv.tracks[chrom], not inv.data — the
  // legacy `inv.data` slot is never populated by the loader. Without
  // pulling from inv.tracks[activeChrom], _buildBoundaryTrackScores
  // (boundaries.js:444+) saw `data.windows = undefined` and produced no
  // tracks. Matches stats_profile.js:1207 pattern.
  const chrom = sh.activeChrom;
  legacy.data = (chrom && inv.tracks && inv.tracks[chrom]) || inv.data || {};

  // Page-internal density layers — lazily created by data IO; expose as
  // empty objects by default so wirer helpers (TODO_MISSING) can probe
  // existence without ReferenceError on the slot itself.
  legacy.repeatDensity = inv.repeatDensity || {};
  legacy.ncRNADensity  = inv.ncRNADensity  || {};

  return legacy;
}
