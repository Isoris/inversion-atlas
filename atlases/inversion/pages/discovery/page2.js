// pages/discovery/page2.js
//
// Candidate-detail deep-dive page (chat 36 round 5 step 2, 2026-05-07).
// Multi-panel view of a single promoted candidate inversion. Built from
// 5 sub-modules under ./page2/ following the page1 round-4 pattern:
//
//   ./page2/_state.js          — _pageState + setter (page2's own; not shared with page1)
//   ./page2/_html_builders.js  — 16 candidate*Html builders
//   ./page2/_wires.js          — 7 wireCandidate* / _wireCandidate* handlers
//   ./page2/_list.js           — 8 list-management helpers (Sort/Index/JSON/etc.)
//   ./page2/_draw_panels.js    — 7 draw functions for the analytic panels
//
// This file (page2.js main) holds the 4 orchestrator entry points
// (renderCandidateMetadata, refreshCandidateUI, _navigateToCandidate,
// wireCandidateNav) plus the mount/unmount atlas-router lifecycle.
// The orchestrators live here because two of them call into one another
// (refreshCandidateUI → renderCandidateMetadata; _navigateToCandidate →
// both refresh*); putting them all in main avoids a parse-time cycle
// between _list.js and a hypothetical orchestrators sub-module.
//
// Every public entry point's first line is _setActiveState(state) so
// the helper bodies in the sub-modules see the active mount's state via
// ES module live-binding. Page2's _pageState is SEPARATE from page1's
// — each page mounts its own. Cross-page helpers (page1_data_helpers.js
// in shared/) take `state` as first arg and don't touch either page's
// _pageState; see HANDOFF_2026-05-07_chat36_round5_step1_done.md.
//
// Cross-shell imports:
//   - resolve / getState from atlas_api (atlas-core engine)
//   - escapeHtml from shared/page1_utils.js
// Cross-page imports (the page1+shared/ helpers used in the candidate
// deep-dive's analytic panels): page2/_draw_panels.js imports
// getL2Cluster, getPC, etc. from shared/page1_data_helpers.js when
// implementing the sub-band cluster recompute. (Not in main page2.js
// because those reads happen inside the per-panel draw functions.)

import { escapeHtml } from '../../shared/page1_utils.js';
import { resolve as _registryResolve, getState as _getState } from '../../../../core/atlas_api.js';

import { _setActiveState, _pageState } from './page2/_state.js';
import {
  candidateNavHtml, candidateHeaderHtml, candidateBlockChipsHtml,
  candidateRichCardHtml, candidateSummaryHtml, candidateSubbandHtml,
  candidateHetShapeHtml, candidateDosageHeatmapHtml,
  candidateProfileHtml, candidateSigmaChartHtml, candidateBandsHtml,
  candidateHaplotypeAnnotationsHtml, candidateAncestryConfoundHtml,
  candidateRegimeRowHtml, candidateAgeOriginHtml, candidateNotesHtml,
} from './page2/_html_builders.js';
import {
  wireCandidateButtons, _wireCandidateBlockChips,
  wireCandidateAncestryConfound, _wireCandidateHaplotypeAnnotations,
  _wireCandidateBandClicks, _wireCandidateRegimeRow,
  _wireCandidateDosageHeatmap,
} from './page2/_wires.js';
import {
  addCandidateToList, persistCandidateList, refreshCandidateListUI,
  candidateToJSON, candidateFromJSON,
  candidateListSortedByPos, candidateListIndexOf, candidateListClosestIndex,
} from './page2/_list.js';
import {
  sigmaProfileCandidate, candidateBandComposition,
  drawCandLocalPCA, drawCandLinesPanel, drawCandGHSLPerBand,
  drawCandidateSigmaChart, drawCandidateLocationStrip,
} from './page2/_draw_panels.js';

// Re-export public entry points so the manifest's `module:` contract
// (atlas_router imports renderCandidateMetadata, wireCandidateNav, mount
// from this file) is preserved across the split.
export {
  candidateNavHtml, candidateHeaderHtml, candidateBlockChipsHtml,
  candidateRichCardHtml, candidateSummaryHtml, candidateSubbandHtml,
  candidateHetShapeHtml, candidateDosageHeatmapHtml,
  candidateProfileHtml, candidateSigmaChartHtml, candidateBandsHtml,
  candidateHaplotypeAnnotationsHtml, candidateAncestryConfoundHtml,
  candidateRegimeRowHtml, candidateAgeOriginHtml, candidateNotesHtml,
} from './page2/_html_builders.js';
export {
  wireCandidateButtons, _wireCandidateBlockChips,
  wireCandidateAncestryConfound, _wireCandidateHaplotypeAnnotations,
  _wireCandidateBandClicks, _wireCandidateRegimeRow,
  _wireCandidateDosageHeatmap,
} from './page2/_wires.js';
export {
  addCandidateToList, persistCandidateList, refreshCandidateListUI,
  candidateToJSON, candidateFromJSON,
  candidateListSortedByPos, candidateListIndexOf, candidateListClosestIndex,
} from './page2/_list.js';
export {
  sigmaProfileCandidate, candidateBandComposition,
  drawCandLocalPCA, drawCandLinesPanel, drawCandGHSLPerBand,
  drawCandidateSigmaChart, drawCandidateLocationStrip,
} from './page2/_draw_panels.js';

// ---------------------------------------------------------------------------
// Orchestrator entry points (the 4 functions that live in main)
// ---------------------------------------------------------------------------

// --- renderCandidateMetadata(state) — legacy lines 58421-58481 ---

// --- renderCandidateMetadata — extracted from legacy ---
//
// Round-5-step-2 note: the legacy body composed sub-panels in a single
// innerHTML concatenation. If any builder throws (e.g. on a missing legacy
// global like _ancCombinedVerdict that hasn't been migrated yet), the
// whole render aborts. Defensive `_safeBuild()` wraps each call so a
// single broken panel renders empty rather than killing the whole page.
// Mirrors the per-wire `try { ... } catch` pattern that already existed
// below for the post-DOM wires. As more legacy helpers are migrated in
// subsequent rounds, fewer panels will degrade.
function _safeBuild(name, fn) {
  try { return fn(); }
  catch (e) {
    console.warn(`page2.${name}:`, e.message);
    return '';
  }
}
export function renderCandidateMetadata(state) {
  _setActiveState(state);
  // Full deep-dive view (Turn B). Composes:
  //   - candidate header (chrom, span, source, K, action buttons)
  //   - σ across candidate verdict + chart + drifters
  //   - per-band composition cards
  //   - notes textarea
  const slot = document.getElementById('candidateMeta');
  const empty = document.getElementById('candidateEmpty');
  if (!slot) return;
  if (!state.candidate) {
    slot.innerHTML = '';
    slot.style.display = 'none';
    if (empty) empty.style.display = 'block';
    return;
  }
  const c = state.candidate;
  if (empty) empty.style.display = 'none';
  slot.style.display = 'block';

  const profile = _safeBuild('sigmaProfileCandidate', () => sigmaProfileCandidate(c));
  const bands = _safeBuild('candidateBandComposition', () => candidateBandComposition(c));

  slot.innerHTML =
    _safeBuild('candidateNavHtml',                    () => candidateNavHtml(c)) +
    _safeBuild('candidateHeaderHtml',                 () => candidateHeaderHtml(c)) +
    _safeBuild('candidateBlockChipsHtml',             () => candidateBlockChipsHtml(c)) +
    _safeBuild('candidateRichCardHtml',               () => candidateRichCardHtml(c)) +
    _safeBuild('candidateSummaryHtml',                () => candidateSummaryHtml(c, profile, bands)) +
    _safeBuild('candidateSubbandHtml',                () => candidateSubbandHtml(c)) +
    _safeBuild('candidateHetShapeHtml',               () => candidateHetShapeHtml(c)) +
    _safeBuild('candidateDosageHeatmapHtml',          () => candidateDosageHeatmapHtml(c)) +
    _safeBuild('candidateProfileHtml',                () => candidateProfileHtml(c, profile)) +
    _safeBuild('candidateSigmaChartHtml',             () => candidateSigmaChartHtml(c, profile)) +
    _safeBuild('candidateBandsHtml',                  () => candidateBandsHtml(c, bands)) +
    _safeBuild('candidateHaplotypeAnnotationsHtml',   () => candidateHaplotypeAnnotationsHtml(c)) +
    _safeBuild('candidateAncestryConfoundHtml',       () => candidateAncestryConfoundHtml(c)) +
    _safeBuild('candidateRegimeRowHtml',              () => candidateRegimeRowHtml(c)) +
    _safeBuild('candidateAgeOriginHtml',              () => candidateAgeOriginHtml(c)) +
    _safeBuild('candidateNotesHtml',                  () => candidateNotesHtml(c));

  // Wire interactions after DOM insertion
  try { wireCandidateButtons(c, profile); } catch (e) { console.warn('wireCandidateButtons:', e.message); }
  try { wireCandidateNav(state, c); } catch (e) { console.warn('wireCandidateNav:', e.message); }
  try { _wireCandidateBlockChips(); } catch (e) { console.warn('_wireCandidateBlockChips:', e.message); }
  try { wireCandidateAncestryConfound(c); } catch (e) { console.warn('wireCandidateAncestryConfound:', e.message); }
  try { _wireCandidateHaplotypeAnnotations(c); } catch (e) { console.warn('haplotype annotations:', e.message); }
  try { _wireCandidateBandClicks(c, bands); } catch (e) { console.warn('band clicks:', e.message); }
  try { _wireCandidateRegimeRow(c); } catch (e) { console.warn('_wireCandidateRegimeRow:', e.message); }
  try { drawCandidateLocationStrip(c); } catch (e) { console.warn('drawCandidateLocationStrip:', e.message); }
  // v3.48: ready-data analysis panels
  requestAnimationFrame(() => {
    try { drawCandLocalPCA(c); } catch (e) { console.warn('drawCandLocalPCA:', e.message); }
    try { drawCandLinesPanel(c); } catch (e) { console.warn('drawCandLinesPanel:', e.message); }
    try { drawCandGHSLPerBand(c); } catch (e) { console.warn('drawCandGHSLPerBand:', e.message); }
    // v3.94: dosage heatmap (static view) — wired after DOM mount
    try { _wireCandidateDosageHeatmap(c); } catch (e) { console.warn('dosage heatmap:', e.message); }
  });
  if (profile && profile.sd) {
    try { drawCandidateSigmaChart(c, profile); } catch (e) { console.warn('drawCandidateSigmaChart:', e.message); }
  }
}
// --- refreshCandidateUI — extracted from legacy ---
export function refreshCandidateUI(state) {
  _setActiveState(state);
  // Update the "page 2" tab to show a small dot when a candidate is active
  const tabBtn = document.querySelector('#tabBar button[data-page="page2"]');
  if (tabBtn) {
    if (state.candidate) {
      if (!tabBtn.querySelector('.cand-dot')) {
        const dot = document.createElement('span');
        dot.className = 'cand-dot';
        dot.style.cssText =
          'display:inline-block;width:6px;height:6px;border-radius:50%;' +
          'background:var(--accent);margin-left:5px;vertical-align:middle;';
        tabBtn.appendChild(dot);
      }
    } else {
      const dot = tabBtn.querySelector('.cand-dot');
      if (dot) dot.remove();
    }
  }
  // Render the page 2 metadata block (provisional, replaced in turn B)
  renderCandidateMetadata(state);
  // Refresh the promote-to-candidate button enabled state on page 1
  const promoteBtn = document.getElementById('promoteCandidateBtn');
  if (promoteBtn) {
    const canPromote = state.lockedLabels && state.lockedRefL2 != null;
    promoteBtn.disabled = !canPromote;
    promoteBtn.title = canPromote
      ? 'Promote the currently-locked L2 to a candidate (page 2)'
      : 'Lock colors on an L2 first (🔒 button above)';
  }
  // v3.84: refresh the candidate overlay badge in the per-sample-lines header
  if (typeof _refreshCandOverlayBadge === 'function') _refreshCandOverlayBadge();
  // v3.84: redraw the lines panel so the candidate-span overlay updates
  if (typeof drawLinesPanel === 'function') {
    try { drawLinesPanel(); } catch (e) {}
  }
}
// --- _navigateToCandidate — extracted from legacy ---
export function _navigateToCandidate(state, targetCand) {
  _setActiveState(state);
  // Make a deep copy so the saved-list entry stays separate from the active
  // (matches the existing pattern in refreshCandidateListUI click handler)
  state.candidate = candidateFromJSON(candidateToJSON(targetCand));
  // v4 turn 56: persist the active candidate ID so reloads can restore
  // focus to whichever candidate the user was last navigated to.
  if (typeof _persistActiveCandidate === 'function' && targetCand) {
    _persistActiveCandidate(targetCand.id || '');
  }
  refreshCandidateUI(state);
  refreshCandidateListUI(state);
  // v3.99 turn 13 ask 1: also center the scrubber cursor on the candidate's
  // middle window so popstats / ancestry / boundaries pages reflect the
  // navigation when the user is viewing them. setCur is defined later in
  // the file; guard with typeof.
  if (typeof setCur === 'function' && targetCand && state.data && state.data.windows) {
    const wins = state.data.windows;
    // Find window indices that bracket the candidate's bp interval, take midpoint
    let s0 = 0, e0 = wins.length - 1;
    for (let i = 0; i < wins.length; i++) {
      if (wins[i].start_bp >= targetCand.start_bp) { s0 = i; break; }
    }
    for (let i = wins.length - 1; i >= 0; i--) {
      if (wins[i].end_bp <= targetCand.end_bp) { e0 = i; break; }
    }
    const mid = Math.max(0, Math.min(wins.length - 1, Math.floor((s0 + e0) / 2)));
    try { setCur(mid); } catch (_) {}
  }
  // Refresh popstats / ancestry / boundaries IF currently visible
  if (typeof renderPopstatsPage === 'function') {
    try { renderPopstatsPage(); } catch (_) {}
  }
  if (typeof renderAncestryPage === 'function') {
    try { renderAncestryPage(); } catch (_) {}
  }
  if (typeof renderBoundariesPage === 'function') {
    try { renderBoundariesPage(); } catch (_) {}
  }
}
// --- wireCandidateNav — extracted from legacy ---
export function wireCandidateNav(state, c) {
  _setActiveState(state);
  const prevBtn = document.getElementById('candNavPrev');
  const nextBtn = document.getElementById('candNavNext');
  const confirmBtn = document.getElementById('candConfirmedToggle');
  const sorted = candidateListSortedByPos();
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (sorted.length === 0) return;
      let idx = candidateListIndexOf(c);
      if (idx < 0) {
        // Active candidate not in list; jump to nearest neighbor on the LEFT
        // of cur position, falling back to closest if no left neighbor.
        const nearest = candidateListClosestIndex(c);
        idx = (nearest > 0 && sorted[nearest].start_bp > c.start_bp) ? nearest - 1 : nearest;
      } else {
        idx = Math.max(0, idx - 1);
      }
      const target = sorted[idx];
      if (target) _navigateToCandidate(state, target);
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (sorted.length === 0) return;
      let idx = candidateListIndexOf(c);
      if (idx < 0) {
        const nearest = candidateListClosestIndex(c);
        idx = (nearest < sorted.length - 1 && sorted[nearest].start_bp < c.start_bp)
              ? nearest + 1 : nearest;
      } else {
        idx = Math.min(sorted.length - 1, idx + 1);
      }
      const target = sorted[idx];
      if (target) _navigateToCandidate(state, target);
    });
  }
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      // Mutate active candidate's confirmed flag
      c.confirmed = !c.confirmed;
      // v3.99 turn 12 fix: if the candidate isn't in the saved list yet (e.g.
      // it was opened via catalogue "view as candidate" without explicit save),
      // auto-add it now when the user confirms. Without this, "mark confirmed"
      // had no effect on the saved list — the page-9 confirmed walkthrough
      // would never see the candidate. We only auto-add on confirm=true; on
      // un-confirm of an unsaved candidate we keep the list untouched (the
      // user clearly never wanted this in the list).
      let inList = state.candidateList.find(x => x.id === c.id);
      if (!inList && c.confirmed) {
        // Snapshot mirrors the page-2 list-toggle path
        const snapshot = candidateFromJSON(candidateToJSON(c));
        snapshot.confirmed = true;
        addCandidateToList(snapshot);
        inList = state.candidateList.find(x => x.id === c.id);
      }
      // Mirror the flag onto the saved copy
      if (inList) inList.confirmed = c.confirmed;
      persistCandidateList();
      // v3.99 turn 12: refresh the catalogue so the new ✓ green tint + ID
      // chip on confirmed rows reflects the change immediately. Cheap re-render.
      if (typeof renderCatalogue === 'function') {
        try { renderCatalogue(); } catch (_) {}
      }
      // v3.56: if we're in confirmed-only mode (page 8) and the user just
      // UN-confirmed the current candidate, it disappears from the navigation.
      // Advance to the next confirmed candidate, or show the empty state if
      // none remain.
      if (state.candidatePageMode === 'confirmed' && !c.confirmed) {
        const remaining = state.candidateList.filter(x => x && x.confirmed);
        if (remaining.length > 0) {
          // Pick the closest by position to the candidate we just unconfirmed
          const cMid = (c.start_bp + c.end_bp) / 2;
          let bestI = 0, bestD = Infinity;
          for (let i = 0; i < remaining.length; i++) {
            const mid = (remaining[i].start_bp + remaining[i].end_bp) / 2;
            const d = Math.abs(mid - cMid);
            if (d < bestD) { bestD = d; bestI = i; }
          }
          _navigateToCandidate(state, remaining[bestI]);
          refreshCandidateListUI(state);
          return;
        } else {
          // No more confirmed candidates — show the page-8 empty state
          state.candidate = null;
          const slot = document.getElementById('candidateMeta');
          const empty = document.getElementById('candidateEmpty');
          if (slot) { slot.innerHTML = ''; slot.style.display = 'none'; }
          if (empty) {
            empty.style.display = 'block';
            empty.innerHTML =
              '<div style="font-size:14px; margin-bottom:14px;">' +
              'No more confirmed candidates.</div>' +
              '<div style="font-size:12px; line-height:1.7; max-width:540px; margin:0 auto;">' +
              'Confirm candidates from <b>page 2 candidate focus</b> to populate this view.' +
              '</div>';
          }
          refreshCandidateListUI(state);
          return;
        }
      }
      refreshCandidateUI(state);
      refreshCandidateListUI(state);
    });
  }
}

// ---------------------------------------------------------------------------
// Atlas-router lifecycle
// ---------------------------------------------------------------------------

/**
 * Mount: called by atlas_router when the user navigates to page2.
 *
 * Page2 reads the active candidate from atlasState.shared.activeCandidate
 * (the registry slot established by promote-from-page-1 or view-from-page-3).
 * If no candidate is set, the empty state defined in page2.html is shown.
 * Otherwise renderCandidateMetadata composes the multi-panel deep-dive.
 *
 * Page2 does NOT load the chromosome data layer itself (unlike page1 mount
 * which awaits resolve('scrubber_main')). The candidate's deep-dive
 * displays summary metadata + per-band stats from data already on the
 * candidate object; if a panel needs precomp it resolves it on demand.
 */
export async function mount(root, atlasState, registry) {
  // Build a legacy-shaped state object (same shape page1 uses).
  const legacyState = _buildLegacyState(atlasState);

  // Page2 is a candidate-detail page — _setActiveState makes the
  // sub-module helpers see this state via ES module live-binding.
  _setActiveState(legacyState);

  // Initial render — guarded so a single broken panel doesn't hide the rest.
  // (Same defensive pattern page1 uses.)
  try { renderCandidateMetadata(legacyState); }
  catch (e) { console.warn('page2.mount: renderCandidateMetadata threw —', e); }

  // Stash for inter-mount lookups.
  if (atlasState.inversion) atlasState.inversion._page2State = legacyState;
}

/**
 * Unmount: called by atlas_router before navigating away.
 */
export async function unmount(root) {
  const state = _getState();
  if (state && state.inversion) {
    delete state.inversion._page2State;
  }
  // Clear the page2-private _pageState binding so a stale state can't
  // be observed if a sub-module fires after unmount (e.g. a debounced
  // requestAnimationFrame from drawCandLinesPanel).
  _setActiveState(null);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _buildLegacyState(atlasState) {
  // Same shape as page1's _buildLegacyState. Page2's helper bodies read
  // many of the same slots (state.candidate, state.candidateList, state.data,
  // state.locked_karyotype_groups, etc.).
  const inv = atlasState.inversion || {};
  const sh = atlasState.shared || {};

  const legacy = Object.assign({}, inv);

  legacy.candidate              = sh.activeCandidate || null;
  legacy.candidateList          = inv.candidateList || [];
  legacy.activeSampleSet        = sh.activeSampleSet || null;
  legacy.candidate_review_decisions = inv.candidate_review_decisions || {};
  legacy.locked_karyotype_groups    = inv.locked_karyotype_groups || {};
  // Page2 reads state.data the same way page1 does (chromosome precomp).
  // It's stashed on inv.tracks[chrom] by page1's mount; if page1 hasn't
  // mounted yet (user navigates to page2 first), state.data stays null
  // and the helpers degrade gracefully (each guards with state.data tests).
  const chrom = sh.activeChrom;
  if (chrom && inv.tracks && inv.tracks[chrom]) {
    legacy.data = inv.tracks[chrom];
  } else {
    legacy.data = null;
  }
  // candidatePageMode controls "confirmed-only" navigation. The slot is
  // page2-private and gets set on the inversion bucket by tab transitions.
  legacy.candidatePageMode = inv.candidatePageMode || null;

  return legacy;
}
