// =============================================================================
// inversion_review/karyotype_tier.js — "7 karyotype / tier" tab
// =============================================================================
// Stage:        review (refinement)
// Legacy DOM:   <div id="karyotype_tier"> (legacy lines 7573–7645)
// Renderers:    renderCandidateKaryotype()       (legacy lines 62800–62836)
//               _renderCandidateKaryotypeBody()  (legacy lines 63091–63289)
//               renderCandidateTier()            (legacy lines 63411–63492)
//               _refreshSubviewButtonStyles()    (legacy lines 62840–62861)
//               _wireCandSubviewButtons()        (legacy line 63547)
//               karyoState (page-local UI state) (legacy lines 62508–62526)
//
// What this page does
// -------------------
// Two sub-views of the active candidate, toggleable with the buttons in
// #candKaryoSubviewBar:
//
//   (1) Karyotype — per-sample regime breakdown. Each row is one fish
//       showing its locked K=3 label (HOMO_1 / HET / HOMO_2 in the
//       operational H-system, ordered by median PC1). Two-track candidates
//       get the extra track-membership pills (active_bands per track).
//       Sortable, filterable, band-filterable.
//
//   (2) Tier — 14-axis classification view. Renders an empty-state card
//       until the cluster-side R-pipeline ships `final_classification.json`
//       (cross-references SCHEMA_V2.md §19; sources mentioned: §13 evidence
//       framework, §9 cluster-emit `classification` layer, candidate
//       schema §13 completion + characterization blocks).
//
// Left side of the page is the candidate list pane (#candListPane) with
// import/export/registry/manuscript-bundle/clear actions. The candidate-list
// rendering itself is `refreshCandidateListUI()` (legacy line 62528) — used
// by other tabs too, so it belongs in the merge chat's promotion list.
//
// Round-5-step-21 status (chat 39 cont., 2026-05-07): single-file-with-
// _state-module migration — pattern 2 ("single file with _state.js")
// applied. **First real review-stage migration** (review group: 3 of 5
// → 4 of 5). All 4 chat-33 exports preserved verbatim:
//   - renderCandidateKaryotype()       — main dispatcher
//   - _refreshSubviewButtonStyles(active) — pure helper
//   - renderCandidateTier()            — Tier sub-view renderer
//   - setKaryoSubview(next)            — subview-toggle wire
// Plus the page-private `karyoState` const (also preserved verbatim).
// New: _state.js sub-module + manual AST shim
// (`const state = _pageState;`) inserted into the 2 of 4 helpers that
// reference bare `state` (renderCandidateKaryotype + renderCandidateTier;
// _refreshSubviewButtonStyles + setKaryoSubview don't read state). Plus
// state-aware wrapper refreshPage4 + mount/unmount lifecycle.
//
// Registry mismatch FLAGGED for Quentin (third instance, distinct shape)
// ----------------------------------------------------------------------
// pages.registry.json declares karyotype_tier has
//   "requires_layers": ["candidate_sv_counts", "candidate_boundaries"]
//   "requires_slots":  ["activeCandidate"]
//   "preloads":        ["candidate_sv_counts", "candidate_boundaries"]
// **The activeCandidate slot is correct** — karyotype_tier IS a candidate-level
// view (reads state.candidate.id/.chrom/.start_bp/.end_bp/.K). But the
// requires_layers values look misplaced: candidate_sv_counts is
// sv_evidence's territory, candidate_boundaries looks like it
// belongs on a different (likely boundary_refinement boundaries) page. What karyotype_tier
// actually reads is state.data.final_classification (the planned R-
// pipeline output) plus state.data.classification (§9 cluster-emit
// layer) plus the candidate's own completion/characterization blocks.
// This is a NEW shape of mismatch (distinct from popstats + ancestry_per_window which
// were chromosome-level pages with candidate-* fields; here karyotype_tier is
// candidate-level with WRONG candidate-* layer references).
// **Round 21 does NOT change requires_layers / requires_slots /
// preloads** — same architectural-discipline rule established step 17.
// Quentin to decide whether requires_layers should be e.g.
// `final_classification` + `classification` (matching what karyotype_tier
// actually consumes), or whether the candidate_sv_counts +
// candidate_boundaries entries are intended (karyotype_tier supposed to be
// repurposed?).
//
// Extraction notes (Batch 2)
// --------------------------
// Three functions are extracted verbatim:
//   - renderCandidateKaryotype  (dispatcher: routes to body or tier)
//   - renderCandidateTier       (14-axis grid renderer + empty state)
//   - _refreshSubviewButtonStyles (idempotent button-style updater)
//
// `_renderCandidateKaryotypeBody` is ~200 lines of table-building logic
// that touches ~15 helpers (sigmaProfileCandidate, _isKaryoTwoTrack,
// getKaryotypeLabel, getKaryotypeLabelCaveat, groupColor, buildKaryotypeRows,
// ...). It's left as TODO_MISSING — it's a plain copy-port and the merge
// chat can pull it in en bloc. Likewise `_renderTierAxesGrid` (legacy
// ~63495). Both are still TODO_MISSING after step 21 — round 21 is a
// migration-only round, not an extraction-of-missing-helpers round.
//
// **mount() consequence**: with state.candidate=null (empty), both
// renderers exit cleanly via the `if (!state.candidate) return` branch.
// With state.candidate set + Karyotype subview active,
// _renderCandidateKaryotypeBody throws ReferenceError (still missing).
// With Tier subview active, _renderTierAxesGrid throws ReferenceError
// inside the template literal. mount() wraps the dispatcher call in
// try/catch (matching cross_species_breakpoints/multi_species_cockpit's pattern) so the empty-state path
// is exercisable while the populated path is still gated on the missing
// helpers landing.
// =============================================================================

import { _pageState, _setActiveState } from './karyotype_tier/_state.js';
import { renderCandidateNavInline } from '../../shared/candidate_nav.js';
// 2026-05-21 dead-button audit Group 4: wire the candListPane bulk-action
// buttons. Pull the canonical list-management helpers from the page that
// OWNS the candidate list (local_pca_dosage), so import/export/clear go
// through the same persistCandidateList + addCandidateToList paths users
// already trust on the discovery scrubber.
import {
  candidateToJSON, candidateFromJSON,
  persistCandidateList, addCandidateToList, makeCandidateId,
} from '../discovery/local_pca_dosage/candidates.js';
import { renderTierAxesGrid as _renderTierAxesGrid, TIER_AXES, TIER_GROUPS, tierAxisValueColor } from './karyotype_tier/tier_axes.js';
import {
  renderKaryotypeBody as _renderCandidateKaryotypeBody,
  renderKaryotypeBodyHtml,
  wireKaryotypeToolbar,
  teardownKaryotypeToolbar,
  exportKaryotypeTSV,
} from './karyotype_tier/karyo_body.js';
import {
  buildKaryotypeRows,
  filterKaryoRows,
  sortKaryoRows,
  isKaryoTwoTrack,
  karyoBandToTrackMap,
} from './karyotype_tier/karyo_rows.js';
import {
  KARYO_LABEL_VOCABS,
  KARYO_DETAILED_LABELS,
  KARYO_LEGACY_LABELS_K3,
  ensureKaryoLabelVocab,
  setKaryoLabelVocab,
  getKaryotypeLabel,
  getKaryotypeLabelCaveat,
} from './karyotype_tier/karyo_labels.js';

// Re-export sub-module public surface so downstream consumers don't need
// to know about the split.
export {
  TIER_AXES, TIER_GROUPS, tierAxisValueColor,
  renderTierAxesGrid,
} from './karyotype_tier/tier_axes.js';
export {
  buildKaryotypeRows, filterKaryoRows, sortKaryoRows,
  isKaryoTwoTrack, karyoBandToTrackMap,
} from './karyotype_tier/karyo_rows.js';
export {
  KARYO_LABEL_VOCABS, KARYO_DETAILED_LABELS, KARYO_LEGACY_LABELS_K3,
  ensureKaryoLabelVocab, setKaryoLabelVocab,
  getKaryotypeLabel, getKaryotypeLabelCaveat,
} from './karyotype_tier/karyo_labels.js';
export {
  renderKaryotypeBody, renderKaryotypeBodyHtml,
  wireKaryotypeToolbar, teardownKaryotypeToolbar,
  exportKaryotypeTSV,
} from './karyotype_tier/karyo_body.js';

function _wireCandSubviewButtons() {
  if (typeof document === 'undefined') return;
  const kBtn = document.getElementById('candSubviewKaryoBtn');
  const tBtn = document.getElementById('candSubviewTierBtn');
  if (kBtn && !kBtn.__sub_wired) {
    kBtn.addEventListener('click', () => setKaryoSubview('karyotype'));
    kBtn.__sub_wired = true;
  }
  if (tBtn && !tBtn.__sub_wired) {
    tBtn.addEventListener('click', () => setKaryoSubview('tier'));
    tBtn.__sub_wired = true;
  }
}

// -----------------------------------------------------------------------------
// Page-local UI state (not in SLOT_REGISTRY — page-private)
// Legacy: lines 62508–62526
// -----------------------------------------------------------------------------
const _CAND_SUBVIEW_KEY = 'pca_scrubber_v3.candSubview';

export const karyoState = {
  sortKey: 'k_label',     // 'cga' | 'k_label' | 'sigma' | 'family_id'
  sortAsc: true,
  filter: '',
  bandFilter: '',         // '' = all bands; 'k0', 'k1', ...
  // Page-4 sub-view toggle. 'karyotype' (default) = existing per-sample
  // regime table. 'tier' = 14-axis classification view (cluster-side
  // R-pipeline output, planned). When set to 'tier' and no
  // final_classification layer is loaded, renders an empty state.
  subview: 'karyotype',
};

// Restore persisted subview choice
try {
  const saved = (typeof localStorage !== 'undefined') ? localStorage.getItem(_CAND_SUBVIEW_KEY) : null;
  if (saved === 'karyotype' || saved === 'tier') karyoState.subview = saved;
} catch (_) { /* no-op */ }


// -----------------------------------------------------------------------------
// Unresolved external deps — to be filled by the merge chat.
// (Round 21 status: still TODO_MISSING. Migration round did NOT
// implement the missing helpers; that's an extraction-of-legacy-
// helpers round, not a migration round.)
// -----------------------------------------------------------------------------
//
// Karyotype body + supporting helpers:
// TODO_MISSING(_renderCandidateKaryotypeBody)        — legacy line 63091
// TODO_MISSING(buildKaryotypeRows)                   — legacy line 62703
// TODO_MISSING(_isKaryoTwoTrack)                     — likely sigma helpers
// TODO_MISSING(sigmaProfileCandidate)                — sigma-profile helper
// TODO_MISSING(getKaryotypeLabel)                    — legacy line 37022
// TODO_MISSING(getKaryotypeLabelCaveat)              — legacy line 37040
// TODO_MISSING(groupColor)                           — palette helper
// TODO_MISSING(refreshCandidateListUI)               — legacy line 62528
//                                                       (used by every page
//                                                        with a cand-list pane)
//                                                       NOTE: refreshCandidateListUI
//                                                       IS exported by
//                                                       pages/discovery/candidate_focus/_list.js
//                                                       in the migrated tree —
//                                                       wiring as an import is
//                                                       a post-migration cleanup
//                                                       opportunity.
//
// Tier-specific:
// TODO_MISSING(_renderTierAxesGrid)                  — legacy ~63495 (right
//                                                       after renderCandidateTier)
// -----------------------------------------------------------------------------


// =============================================================================
// renderCandidateKaryotype — public entry, dispatcher
// =============================================================================
// Legacy: lines 62800–62836. Verbatim except for the import-time karyoState.
// =============================================================================
export function renderCandidateKaryotype() {
  const state = _pageState;

  const empty = document.getElementById('candKaryoEmpty');
  const content = document.getElementById('candKaryoContent');
  const tierContent = document.getElementById('candTierContent');
  const subviewBar = document.getElementById('candKaryoSubviewBar');
  if (!empty || !content) return;
  if (!state.candidate) {
    empty.style.display = 'block';
    content.style.display = 'none';
    if (tierContent) { tierContent.style.display = 'none'; tierContent.innerHTML = ''; }
    if (subviewBar) subviewBar.style.display = 'none';
    content.innerHTML = '';
    return;
  }
  empty.style.display = 'none';
  if (subviewBar) subviewBar.style.display = 'flex';
  // Ensure the subview-toggle buttons are wired (idempotent guard inside)
  if (typeof _wireCandSubviewButtons === 'function') {
    try { _wireCandSubviewButtons(); } catch (_) { /* swallow */ }
  }

  // Subview routing. Show karyotype or tier panel based on karyoState.subview.
  const subview = (karyoState.subview === 'tier') ? 'tier' : 'karyotype';
  if (subview === 'tier') {
    content.style.display = 'none';
    if (tierContent) tierContent.style.display = 'block';
    _refreshSubviewButtonStyles(subview);
    renderCandidateTier();
    return;
  }
  // Karyotype (default): existing render path
  content.style.display = 'block';
  if (tierContent) tierContent.style.display = 'none';
  _refreshSubviewButtonStyles(subview);
  _renderCandidateKaryotypeBody();
}


// =============================================================================
// _refreshSubviewButtonStyles — idempotent button-state updater
// =============================================================================
// Legacy: lines 62840–62861. Verbatim.
// =============================================================================
export function _refreshSubviewButtonStyles(active) {
  const kBtn = document.getElementById('candSubviewKaryoBtn');
  const tBtn = document.getElementById('candSubviewTierBtn');
  const setActive = (btn, isActive) => {
    if (!btn || !btn.style) return;
    if (isActive) {
      btn.classList && btn.classList.add('active');
      btn.style.background = 'rgba(245,165,36,0.15)';
      btn.style.borderColor = 'var(--accent, #f5a524)';
      btn.style.color = 'var(--ink)';
      btn.style.fontWeight = '600';
    } else {
      btn.classList && btn.classList.remove('active');
      btn.style.background = 'var(--panel-2)';
      btn.style.borderColor = 'var(--rule)';
      btn.style.color = 'var(--ink-dim)';
      btn.style.fontWeight = '400';
    }
  };
  setActive(kBtn, active === 'karyotype');
  setActive(tBtn, active === 'tier');
}


// =============================================================================
// renderCandidateTier — 14-axis classification view + empty state
// =============================================================================
// Legacy: lines 63411–63492. Verbatim.
//
// Reads:    state.candidate, state.data.final_classification[<cid>]
// Renders:  empty-state card if final_classification not loaded, else the
//           14-axis grid via _renderTierAxesGrid (TODO_MISSING).
// =============================================================================
export function renderCandidateTier() {
  const state = _pageState;

  const tierContent = document.getElementById('candTierContent');
  const layerStatus = document.getElementById('candTierLayerStatus');
  if (!tierContent) return;
  if (!state.candidate) {
    tierContent.innerHTML = '';
    return;
  }
  const c = state.candidate;
  const layer = (state.data && state.data.final_classification) || null;
  const layerLoaded = !!layer && typeof layer === 'object';
  // Each candidate's classification keyed by candidate id (preferred) or
  // fallback to ref_l2. The R-side spec uses `candidate_id` as the key.
  const candKey = c.id || (c.ref_l2 != null ? `ref_l2_${c.ref_l2}` : null);
  const candEntry = (layerLoaded && candKey) ? (layer[candKey] || layer[c.id] || null) : null;

  // Update the small "layer status" text in the subview bar
  if (layerStatus) {
    if (layerLoaded && candEntry) {
      layerStatus.textContent = `final_classification: loaded · ${Object.keys(candEntry).length} axes for this candidate`;
      layerStatus.style.color = 'var(--good, #3cc08a)';
    } else if (layerLoaded) {
      layerStatus.textContent = 'final_classification: loaded · no entry for this candidate';
      layerStatus.style.color = 'var(--ink-dim)';
    } else {
      layerStatus.textContent = 'final_classification: NOT LOADED — render empty';
      layerStatus.style.color = 'var(--ink-dim)';
    }
  }

  if (!layerLoaded || !candEntry) {
    // EMPTY STATE — explain the contract
    tierContent.innerHTML = `
      <div style="padding: 32px 28px; max-width: 880px; margin: 0 auto;">
        <h3 style="margin: 0 0 6px; font-family: var(--serif); font-weight: 500;">
          14-axis classification for this candidate
        </h3>
        <div style="color: var(--ink-dim); font-size: 12px; margin-bottom: 16px;">
          candidate ${c.id ? c.id.replace(/^cand_/, '') : '?'} · ${c.chrom} ${(c.start_bp/1e6).toFixed(2)}–${(c.end_bp/1e6).toFixed(2)} Mb
        </div>
        <div style="background: var(--panel); border: 1px solid var(--rule); border-radius: 6px;
                    padding: 16px 20px; font-size: 12px; line-height: 1.6; color: var(--ink-dim);">
          <div style="font-weight: 600; color: var(--ink); margin-bottom: 8px;">
            ⚠ The <code>final_classification</code> JSON layer isn't loaded yet.
          </div>
          <p style="margin: 0 0 8px;">The Tier view consumes a per-candidate classification produced by the cluster-side R-pipeline (<code>characterize_candidate.R</code> + <code>classify_inversions.R</code>, planned). When that pipeline emits its output, the scrubber reads it as <code>state.data.final_classification</code> (an optional top-level JSON layer) and renders the 14 axes here.</p>
          <p style="margin: 0 0 8px;">Until then, this view shows the axis schema only — <b>no values</b>. See SCHEMA_V2.md §19 for the full contract.</p>
          <p style="margin: 0;">In the meantime, partial information lives in <code>state.data.classification</code> (§9 cluster-emit layer) and the candidate's own <code>completion</code> + <code>characterization</code> blocks (schema 2.12 §13). The Tier view will eventually unify all three sources into one read-only display.</p>
        </div>

        <h4 style="margin: 22px 0 8px; font-size: 12px; text-transform: uppercase;
                   letter-spacing: 0.08em; color: var(--ink-dim);
                   font-family: var(--mono); font-weight: 600;">
          14-axis schema (read-only preview)
        </h4>
        ${_renderTierAxesGrid(null)}
      </div>
    `;
    return;
  }

  // VALUE STATE — render the 14 axes with their values
  const span_mb = (c.end_bp - c.start_bp) / 1e6;
  tierContent.innerHTML = `
    <div style="padding: 32px 28px; max-width: 1080px; margin: 0 auto;">
      <h3 style="margin: 0 0 6px; font-family: var(--serif); font-weight: 500;">
        14-axis classification
      </h3>
      <div style="color: var(--ink-dim); font-size: 12px; margin-bottom: 16px;">
        candidate ${c.id ? c.id.replace(/^cand_/, '') : '?'} · ${c.chrom}
        ${(c.start_bp/1e6).toFixed(2)}–${(c.end_bp/1e6).toFixed(2)} Mb · ${span_mb.toFixed(2)} Mb · K=${c.K}
      </div>
      ${_renderTierAxesGrid(candEntry)}
      <div style="margin-top: 20px; padding: 12px 16px; background: var(--panel);
                  border: 1px solid var(--rule); border-radius: 4px;
                  font-size: 11px; color: var(--ink-dim); line-height: 1.5;">
        <div><b>Source</b>: <code>state.data.final_classification[${candKey || '?'}]</code></div>
        <div><b>Schema</b>: SCHEMA_V2.md §19 (planned schema 2.16 — cluster-side emit) · cross-references §13 (three-axis evidence framework).</div>
      </div>
    </div>
  `;
}


// -----------------------------------------------------------------------------
// Persist subview-toggle helper. Called from the wire-buttons hook (legacy
// 63547) when the user clicks the karyotype/tier chip. Exposed here so the
// merge chat can stitch it into the dispatcher.
// -----------------------------------------------------------------------------
export function setKaryoSubview(next) {
  if (next !== 'karyotype' && next !== 'tier') return;
  karyoState.subview = next;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(_CAND_SUBVIEW_KEY, next);
    }
  } catch (_) { /* no-op */ }
  renderCandidateKaryotype();
}


// =============================================================================
// state references not in SLOT_REGISTRY
// =============================================================================
//
// state.candidate            — IS in SLOT_REGISTRY (cross_atlas).
// state.data                 — IS in SLOT_REGISTRY (transient).
// state.data.classification  — sub-field, §9 cluster-emit layer
//                               (loaded into state.data by data IO; not a
//                                top-level slot).
// state.data.final_classification
//                            — sub-field of state.data; the R-pipeline
//                              output keyed by candidate_id. Read-only.
//                              NOT a SLOT_REGISTRY slot; it's a layer
//                              attached to the precomp JSON.
// state.activeMode           — referenced inside _renderCandidateKaryotypeBody
//                              (filtered out as TODO_MISSING).
//                              Legacy two-mode toggle ("simple" vs "detailed").
//                              NOT in current SLOT_REGISTRY.
//
// Recommendation for merge chat: state.activeMode is a candidate for being
// promoted to SLOT_REGISTRY as a `persisted` slot (key `inversion_atlas.activeMode`).
// =============================================================================


// ===========================================================================
// Atlas-router lifecycle (chat 39 cont. round 5 step 21, 2026-05-07).
//
// Explicit ES exports for the public surface of the karyotype/tier review
// page. Round 21 added:
//   - import { _pageState, _setActiveState } from './karyotype_tier/_state.js'
//   - manual AST shim `const state = _pageState;` into the 2 of 4 helpers
//     that read bare state (renderCandidateKaryotype + renderCandidateTier).
//     The other 2 (_refreshSubviewButtonStyles, setKaryoSubview) don't read
//     state — left untouched.
//   - state-aware wrapper refreshPage4 + mount/unmount lifecycle.
//
// The 4 chat-33 export entries (renderCandidateKaryotype,
// _refreshSubviewButtonStyles, renderCandidateTier, setKaryoSubview) and
// the page-private `karyoState` const are all PRESERVED VERBATIM (apart
// from the one-line shim insertion in 2 of 4 functions).
// ===========================================================================

/**
 * Public entry — state-aware wrapper around renderCandidateKaryotype.
 * Sets _pageState before delegating so the verbatim body's bare
 * `state.X` reads (now `const state = _pageState;` shimmed) resolve
 * to the active mount's state.
 */
export function refreshPage4(state) {
  if (state) _setActiveState(state);
  return renderCandidateKaryotype();
}

/**
 * Mount: called by atlas_router when the user navigates to karyotype_tier.
 *
 * Builds a legacy-shape state with the slots karyotype_tier reads:
 *   - state.candidate (cross-atlas slot, may be null)
 *   - state.data (transient slot, sub-fields .final_classification +
 *     .classification consumed by renderCandidateTier)
 *
 * mount-time render: try/catch wraps the dispatcher call (matching
 * cross_species_breakpoints/multi_species_cockpit). Rationale: with state.candidate=null (typical
 * empty mount), both renderers exit cleanly via the
 * `if (!state.candidate) return` branch. With state.candidate set
 * AND Karyotype subview active, _renderCandidateKaryotypeBody is
 * called and throws ReferenceError (still TODO_MISSING). With
 * Tier subview active, _renderTierAxesGrid throws ReferenceError
 * inside the template literal. The try/catch guards the populated
 * path so mount() never throws to the router.
 */
export async function mount(root, atlasState, registry) {
  const legacyState = _buildLegacyState(atlasState);
  _setActiveState(legacyState);

  _mountCandidateNav(root, atlasState, registry);

  try { renderCandidateKaryotype(); }
  catch (e) { console.warn('karyotype_tier.mount: renderCandidateKaryotype threw —', e); }

  // 2026-05-21 dead-button audit (Group 4): wire the 7 bulk-action
  // buttons in #candListPane. 4 ship with real handlers (import / export
  // / clear / bundle); 3 are explicitly disabled with explanatory titles
  // because they require registry / enrichment schemas not yet shipped.
  try { _wireCandListActions(root, legacyState, atlasState); }
  catch (e) { console.warn('karyotype_tier.mount: _wireCandListActions threw —', e); }

  // Same audit: pop-out floating mode for the candidate-management pane.
  // Detaches #candListPane from the page grid so the user can keep the
  // bulk-action toolbar visible while navigating to other pages in the
  // same tab (e.g. promoting on haplotype_regimes). Persists position
  // + floating state across page mounts.
  try { _wireCandListPaneFloater(); }
  catch (e) { console.warn('karyotype_tier.mount: _wireCandListPaneFloater threw —', e); }

  if (atlasState.inversion) atlasState.inversion._page4State = legacyState;
}

// =============================================================================
// _wireCandListActions — bulk-action toolbar (Group 4 of dead-button audit)
// =============================================================================
// 4 of the 7 buttons get real handlers using the discovery scrubber's
// canonical list-management helpers (persistCandidateList, addCandidateToList,
// candidateToJSON, candidateFromJSON, makeCandidateId). The remaining 3
// (registry-export, registry-load, enrichment-import) are explicitly
// disabled with explanatory titles — they need server-side schemas that
// haven't shipped. Better to show them dimmed-and-tooltipped than dead.
// =============================================================================
function _wireCandListActions(root, state, atlasState) {
  if (typeof document === 'undefined') return;
  const $ = (id) => document.getElementById(id);

  // ----- Group 4a: SAFELY WIRED (4 buttons) -----

  // ⬇ export JSON — serialize state.candidateList to JSON + download
  const exp = $('candListExportBtn');
  if (exp && exp.dataset.wired !== '1') {
    exp.addEventListener('click', () => {
      try {
        const list = (state && state.candidateList) || [];
        const arr  = list.map(candidateToJSON).filter(Boolean);
        const chrom = (state && state.data && state.data.chrom) || 'unknown_chrom';
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const name  = `candidates_${chrom}_${stamp}.json`;
        _downloadBlob(name, JSON.stringify(arr, null, 2), 'application/json');
      } catch (e) { console.warn('candListExportBtn:', e); }
    });
    exp.dataset.wired = '1';
  }

  // ⬆ import JSON — pick file → parse → addCandidateToList for each entry
  const imp = $('candListImportBtn');
  const impInput = $('candListImportInput');
  if (imp && impInput && imp.dataset.wired !== '1') {
    imp.addEventListener('click', () => impInput.click());
    impInput.addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const arr = JSON.parse(reader.result);
          if (!Array.isArray(arr)) {
            console.warn('candListImportBtn: file did not contain a JSON array');
            return;
          }
          let added = 0;
          for (const raw of arr) {
            const c = candidateFromJSON(raw);
            if (!c) continue;
            // makeCandidateId only when the imported entry has no id —
            // preserves cross-session identity when the user re-imports
            // their own previous export.
            if (!c.id) c.id = makeCandidateId();
            addCandidateToList(state, c);   // dedup'd by id internally
            added++;
          }
          console.log(`[candListImportBtn] imported ${added} of ${arr.length} entries`);
        } catch (e) { console.warn('candListImportBtn parse:', e); }
        // Reset so re-importing the same file fires a fresh change event.
        ev.target.value = '';
      };
      reader.readAsText(f);
    });
    imp.dataset.wired = '1';
  }

  // ✕ clear all — confirm + clear + persist
  const clr = $('candListClearBtn');
  if (clr && clr.dataset.wired !== '1') {
    clr.addEventListener('click', () => {
      const n = (state && state.candidateList && state.candidateList.length) || 0;
      if (n === 0) return;
      const chrom = (state && state.data && state.data.chrom) || 'this chromosome';
      if (typeof window !== 'undefined' && window.confirm
          && !window.confirm(`Clear all ${n} saved candidates for ${chrom}?`)) return;
      state.candidateList = [];
      try { persistCandidateList(state); } catch (e) { console.warn('persistCandidateList:', e); }
      // Refresh the inline candidate list panel + the karyotype body
      // (which goes empty when no candidate is active).
      try { renderCandidateKaryotype(); } catch (_) {}
    });
    clr.dataset.wired = '1';
  }

  // 📝 manuscript bundle — markdown + TSV bundle for paste-into-LLM
  const bdl = $('candListBundleBtn');
  if (bdl && bdl.dataset.wired !== '1') {
    bdl.addEventListener('click', () => {
      try {
        const list = (state && state.candidateList) || [];
        const chrom = (state && state.data && state.data.chrom) || 'unknown_chrom';
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const md  = _buildBundleMarkdown(chrom, list);
        const tsv = _buildBundleTSV(list);
        const name = `manuscript_bundle_${chrom}_${stamp}.md`;
        _downloadBlob(name,
          md + '\n\n## TSV (paste into a spreadsheet)\n\n```tsv\n' + tsv + '\n```\n',
          'text/markdown');
      } catch (e) { console.warn('candListBundleBtn:', e); }
    });
    bdl.dataset.wired = '1';
  }

  // ----- Group 4b: DISABLED WITH EXPLANATION (3 buttons) -----
  // These three need server-side schemas / cluster artifacts that haven't
  // shipped. Better to show them as "soon" with the reason in the
  // tooltip than as dead buttons users click in vain.
  const _disabled = [
    ['candListRegistryBtn',
      'Not yet wired: needs the per-cohort candidate registry schema (SCHEMA §20). ' +
      'Use ⬇ export JSON for the per-chrom list in the meantime.'],
    ['loadRegistryBtn',
      'Not yet wired: needs the multi-file registry loader (sample_groups.tsv, ' +
      'candidate_intervals.tsv, results_registry/manifest.tsv, evidence_registry/...). ' +
      'Tracked in registry loader spec.'],
    ['enrichmentImportBtn',
      'Not yet wired: needs the enrichment JSON schema (cluster phases 6+: ' +
      'breakpoints_refined, groups_validated). Load the corresponding raw ' +
      'JSON via /file/ if you need to inspect it today.'],
  ];
  for (const [id, why] of _disabled) {
    const b = $(id);
    if (!b) continue;
    b.disabled = true;
    b.title = '(not yet wired) ' + why;
    b.style.opacity = '0.45';
    b.style.cursor = 'not-allowed';
  }
}

// =============================================================================
// Bundle + download helpers (Group 4 wiring support)
// =============================================================================

function _downloadBlob(filename, content, mime) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const blob = new Blob([content], { type: mime || 'application/octet-stream' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function _buildBundleMarkdown(chrom, list) {
  const n = list.length;
  const lines = [];
  lines.push(`# Candidate inventory — ${chrom}`);
  lines.push('');
  lines.push(`${n} candidate${n === 1 ? '' : 's'} saved as of ` +
             new Date().toISOString());
  lines.push('');
  if (n === 0) {
    lines.push('_No candidates saved on this chromosome._');
    return lines.join('\n');
  }
  lines.push('## Summary');
  lines.push('');
  lines.push('| # | id | chrom | start (Mb) | end (Mb) | span (Mb) | K | source | confirmed |');
  lines.push('|---|----|-------|-----------:|---------:|----------:|--:|--------|:---------:|');
  list.forEach((c, i) => {
    const startMb = Number.isFinite(c.start_bp) ? (c.start_bp / 1e6).toFixed(2) : '?';
    const endMb   = Number.isFinite(c.end_bp)   ? (c.end_bp   / 1e6).toFixed(2) : '?';
    const span    = (Number.isFinite(c.start_bp) && Number.isFinite(c.end_bp))
      ? ((c.end_bp - c.start_bp) / 1e6).toFixed(2) : '—';
    const src = c.source || '—';
    const conf = c.confirmed ? '✓' : '';
    lines.push(`| ${i + 1} | ${c.id || '?'} | ${c.chrom || '?'} | ${startMb} | ${endMb} | ${span} | ${c.K | 0} | ${src} | ${conf} |`);
  });
  return lines.join('\n');
}

// =============================================================================
// _wireCandListPaneFloater — pop-out floating mode for #candListPane
// =============================================================================
// Injects a 📌 toggle into the candListPane header. Click → flip
// `data-floating="1"` on the aside + style it as `position: fixed` so
// the user can drag it around. Position + floating state persist in
// localStorage. Drag handle = the .cand-list-head element (cursor:grab).
//
// Pattern mirrors atlas-core/core/sidebar_floating.js (same LS shape:
// {left, top}) but scoped to this one aside instead of the generic
// `.wrap > aside`. We don't reuse sidebar_floating.js directly because
// it queries a different DOM tree. If a future audit identifies a
// second aside that wants the same behaviour, the right call is to
// parameterise sidebar_floating to accept a custom aside selector + LS
// key namespace; for now, a 60-line local wirer is the right size.
// =============================================================================

const _CL_FLOAT_LS_MODE = 'atlas.candListFloat.mode';   // 'docked' | 'floating'
const _CL_FLOAT_LS_POS  = 'atlas.candListFloat.pos';    // JSON {left, top}

function _wireCandListPaneFloater() {
  if (typeof document === 'undefined') return;
  const aside = document.getElementById('candListPane');
  if (!aside) return;
  const head  = aside.querySelector('.cand-list-head');
  if (!head) return;

  _ensureCandListFloatCss();

  // Inject the toggle button into the header once per aside instance.
  let btn = document.getElementById('candListFloatBtn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'candListFloatBtn';
    btn.type = 'button';
    btn.title = 'Detach the candidate-management pane so you can keep ' +
                'it open while working in another tab. Drag the header to ' +
                'reposition. Click again to re-dock.';
    btn.textContent = '📌';
    btn.style.cssText =
      'margin-left: auto; padding: 1px 6px; font-size: 11px; ' +
      'background: transparent; border: 1px solid var(--rule); ' +
      'border-radius: 3px; color: var(--ink-dim); cursor: pointer;';
    head.appendChild(btn);
  }

  // Restore persisted mode + position on every mount.
  const mode = _clReadMode();
  _clApplyMode(aside, mode);
  btn.textContent = (mode === 'floating') ? '📍' : '📌';

  if (btn.dataset.wired !== '1') {
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      const next = (aside.dataset.floating === '1') ? 'docked' : 'floating';
      _clWriteMode(next);
      _clApplyMode(aside, next);
      btn.textContent = (next === 'floating') ? '📍' : '📌';
    });
  }
  if (head.dataset.dragWired !== '1') {
    _clInstallDrag(aside, head);
    head.dataset.dragWired = '1';
  }
}

function _ensureCandListFloatCss() {
  if (document.getElementById('candListFloatCss')) return;
  const style = document.createElement('style');
  style.id = 'candListFloatCss';
  style.textContent = `
    #candListPane[data-floating="1"] {
      position: fixed;
      z-index: 9000;
      width: 320px;
      max-height: 80vh;
      overflow: auto;
      box-shadow: 0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px var(--accent, #f5a524);
      background: var(--bg-card, #161a22);
      border-radius: 4px;
    }
    #candListPane[data-floating="1"] .cand-list-head { cursor: grab; }
    #candListPane[data-floating="1"] .cand-list-head:active { cursor: grabbing; }
  `;
  document.head.appendChild(style);
}

function _clReadMode() {
  try {
    return localStorage.getItem(_CL_FLOAT_LS_MODE) === 'floating'
      ? 'floating' : 'docked';
  } catch (_) { return 'docked'; }
}

function _clWriteMode(mode) {
  try { localStorage.setItem(_CL_FLOAT_LS_MODE, mode); } catch (_) {}
}

function _clApplyMode(aside, mode) {
  if (mode === 'floating') {
    aside.dataset.floating = '1';
    // Apply persisted position, defaulting to top-right if absent or off-screen.
    let pos = null;
    try { pos = JSON.parse(localStorage.getItem(_CL_FLOAT_LS_POS) || 'null'); }
    catch (_) {}
    const ww = window.innerWidth  || 1200;
    const wh = window.innerHeight || 800;
    let left = (pos && Number.isFinite(pos.left)) ? pos.left : (ww - 340);
    let top  = (pos && Number.isFinite(pos.top))  ? pos.top  : 80;
    // Off-screen guard (window resized between sessions).
    if (left < 0 || left > ww - 60) left = ww - 340;
    if (top  < 0 || top  > wh - 60) top  = 80;
    aside.style.left = left + 'px';
    aside.style.top  = top + 'px';
  } else {
    aside.dataset.floating = '';
    aside.style.left = '';
    aside.style.top  = '';
  }
}

function _clInstallDrag(aside, head) {
  let dragging = false;
  let dx = 0, dy = 0;
  head.addEventListener('pointerdown', (ev) => {
    if (aside.dataset.floating !== '1') return;
    // Don't start drag on the toggle button itself or other interactives.
    if (ev.target && ev.target.closest('button, input, select, a')) return;
    dragging = true;
    const r = aside.getBoundingClientRect();
    dx = ev.clientX - r.left;
    dy = ev.clientY - r.top;
    try { head.setPointerCapture(ev.pointerId); } catch (_) {}
  });
  head.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const left = Math.max(0, Math.min(window.innerWidth  - 60, ev.clientX - dx));
    const top  = Math.max(0, Math.min(window.innerHeight - 60, ev.clientY - dy));
    aside.style.left = left + 'px';
    aside.style.top  = top + 'px';
  });
  const _release = (ev) => {
    if (!dragging) return;
    dragging = false;
    try { head.releasePointerCapture(ev.pointerId); } catch (_) {}
    // Persist the final position.
    try {
      const r = aside.getBoundingClientRect();
      localStorage.setItem(_CL_FLOAT_LS_POS,
        JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top) }));
    } catch (_) {}
  };
  head.addEventListener('pointerup',     _release);
  head.addEventListener('pointercancel', _release);
}

function _buildBundleTSV(list) {
  const headers = ['idx', 'id', 'chrom', 'start_bp', 'end_bp', 'span_bp', 'K',
                   'source', 'confirmed', 'ref_window', 'notes'];
  const rows = [headers.join('\t')];
  list.forEach((c, i) => {
    const span = (Number.isFinite(c.start_bp) && Number.isFinite(c.end_bp))
      ? (c.end_bp - c.start_bp) : '';
    const row = [
      i + 1, c.id || '', c.chrom || '',
      c.start_bp ?? '', c.end_bp ?? '', span,
      c.K | 0, c.source || '', c.confirmed ? '1' : '0',
      c.ref_window ?? '',
      (c.notes || '').replace(/[\t\r\n]/g, ' '),
    ];
    rows.push(row.join('\t'));
  });
  return rows.join('\n');
}

/**
 * Insert the prev/next candidate nav bar at the very top of
 * #karyotype_tier via the shared cartridge (shared/candidate_nav.js).
 * Karyotype/tier is candidate-level — prev/next is the right primary
 * navigation, more discoverable than the inline candidate list pane.
 */
function _mountCandidateNav(root, atlasState, registry) {
  const page = (root && root.querySelector) ? root.querySelector('#karyotype_tier') : null;
  if (!page) return;
  const old = page.querySelector('.cand-nav-inline');
  if (old) old.remove();

  const sh  = atlasState.shared    || {};
  const inv = atlasState.inversion || {};
  const navState = {
    candidate:         sh.activeCandidate || null,
    candidateList:     inv.candidateList   || [],
    candidatePageMode: inv.candidatePageMode || null,
  };

  const apply = (target) => {
    if (target && target.chrom && target.chrom !== sh.activeChrom) {
      if (typeof atlasState.setActiveChrom === 'function') atlasState.setActiveChrom(target.chrom);
      else atlasState.shared.activeChrom = target.chrom;
    }
    if (typeof atlasState.setActiveCandidate === 'function') {
      atlasState.setActiveCandidate(target);
    } else {
      atlasState.shared.activeCandidate = target;
    }
    mount(root, atlasState, registry).catch(err =>
      console.warn('karyotype_tier: re-mount after candidate change threw —', err));
  };

  const bar = renderCandidateNavInline(navState, {
    idPrefix:      'kt',
    onNavigate:    (_st, target) => apply(target),
    onClearActive: ()             => apply(null),
  });
  if (bar) page.insertBefore(bar, page.firstChild);
}

/**
 * Unmount: clear _pageState so post-unmount callbacks see null.
 */
export async function unmount(root) {
  try { teardownKaryotypeToolbar(); }
  catch (e) { console.warn('karyotype_tier.unmount: teardownKaryotypeToolbar threw —', e); }
  _setActiveState(null);
}

function _buildLegacyState(atlasState) {
  const inv = atlasState.inversion || {};
  const sh  = atlasState.shared    || {};
  const legacy = Object.assign({}, inv);

  // Cross-atlas slots
  legacy.candidate = sh.activeCandidate || null;

  // Transient slot — karyotype_tier reads state.data.final_classification +
  // state.data.classification (both sub-fields of state.data, not
  // top-level slots). Default empty object so sub-field access doesn't
  // throw.
  legacy.data = inv.data || {};

  return legacy;
}
