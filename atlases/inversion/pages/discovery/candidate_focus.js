// pages/discovery/candidate_focus.js
//
// Candidate-detail deep-dive page (chat 36 round 5 step 2, 2026-05-07).
// Multi-panel view of a single promoted candidate inversion. Built from
// 5 sub-modules under ./candidate_focus/ following the local_pca_dosage round-4 pattern:
//
//   ./candidate_focus/_state.js          — _pageState + setter (candidate_focus's own; not shared with local_pca_dosage)
//   ./candidate_focus/_html_builders.js  — 16 candidate*Html builders
//   ./candidate_focus/_wires.js          — 7 wireCandidate* / _wireCandidate* handlers
//   ./candidate_focus/_list.js           — 8 list-management helpers (Sort/Index/JSON/etc.)
//   ./candidate_focus/_draw_panels.js    — 7 draw functions for the analytic panels
//
// This file (candidate_focus.js main) holds the 4 orchestrator entry points
// (renderCandidateMetadata, refreshCandidateUI, _navigateToCandidate,
// wireCandidateNav) plus the mount/unmount atlas-router lifecycle.
// The orchestrators live here because two of them call into one another
// (refreshCandidateUI → renderCandidateMetadata; _navigateToCandidate →
// both refresh*); putting them all in main avoids a parse-time cycle
// between _list.js and a hypothetical orchestrators sub-module.
//
// Every public entry point's first line is _setActiveState(state) so
// the helper bodies in the sub-modules see the active mount's state via
// ES module live-binding. Page2's _pageState is SEPARATE from local_pca_dosage's
// — each page mounts its own. Cross-page helpers (page1_data_helpers.js
// in shared/) take `state` as first arg and don't touch either page's
// _pageState; see HANDOFF_2026-05-07_chat36_round5_step1_done.md.
//
// Cross-shell imports:
//   - resolve / getState from atlas_api (atlas-core engine)
//   - escapeHtml from shared/page1_utils.js
// Cross-page imports (the local_pca_dosage+shared/ helpers used in the candidate
// deep-dive's analytic panels): candidate_focus/_draw_panels.js imports
// getL2Cluster, getPC, etc. from shared/page1_data_helpers.js when
// implementing the sub-band cluster recompute. (Not in main candidate_focus.js
// because those reads happen inside the per-panel draw functions.)

import { escapeHtml } from '../../shared/page1_utils.js';
import { persistActiveCandidateId } from '../../shared/active_candidate.js';
import { ensureChromTracks } from '../../shared/ensure_chrom_tracks.js';
import { resolve as _registryResolve, getState as _getState } from '../../../../core/atlas_api.js';
import { probeModeB, renderModeBBadge } from '../../../../core/mode_b_badge.js';
import { activatePopstatsPanels } from './candidate_focus/_popstats_panels.js';
import { getMacrostripeIdPerSample } from '../../shared/macrostripe.js';

import { _setActiveState, _pageState } from './candidate_focus/_state.js';
import {
  candidateNavHtml, candidateHeaderHtml, candidateBlockChipsHtml,
  candidateRichCardHtml, candidateSummaryHtml, candidateSubbandHtml,
  candidateHetShapeHtml, candidateDosageHeatmapHtml,
  candidateProfileHtml, candidateSigmaChartHtml, candidateBandsHtml,
  candidateHaplotypeAnnotationsHtml, candidateAncestryConfoundHtml,
  candidateRegimeRowHtml, candidateAgeOriginHtml, candidateNotesHtml,
} from './candidate_focus/_html_builders.js';
import {
  wireCandidateButtons, _wireCandidateBlockChips,
  wireCandidateAncestryConfound, _wireCandidateHaplotypeAnnotations,
  _wireCandidateBandClicks, _wireCandidateRegimeRow,
  _wireCandidateDosageHeatmap,
} from './candidate_focus/_wires.js';
import {
  addCandidateToList, persistCandidateList, refreshCandidateListUI,
  candidateToJSON, candidateFromJSON,
  candidateListSortedByPos, candidateListIndexOf, candidateListClosestIndex,
} from './candidate_focus/_list.js';
import {
  sigmaProfileCandidate, candidateBandComposition,
  drawCandLocalPCA, drawCandLinesPanel, drawCandGHSLPerBand,
  drawCandidateSigmaChart, drawCandidateLocationStrip,
} from './candidate_focus/_draw_panels.js';
import { computePC1Signs, computePC2Signs } from '../../shared/page1_data_helpers.js';

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
} from './candidate_focus/_html_builders.js';
export {
  wireCandidateButtons, _wireCandidateBlockChips,
  wireCandidateAncestryConfound, _wireCandidateHaplotypeAnnotations,
  _wireCandidateBandClicks, _wireCandidateRegimeRow,
  _wireCandidateDosageHeatmap,
} from './candidate_focus/_wires.js';
export {
  addCandidateToList, persistCandidateList, refreshCandidateListUI,
  candidateToJSON, candidateFromJSON,
  candidateListSortedByPos, candidateListIndexOf, candidateListClosestIndex,
} from './candidate_focus/_list.js';
export {
  sigmaProfileCandidate, candidateBandComposition,
  drawCandLocalPCA, drawCandLinesPanel, drawCandGHSLPerBand,
  drawCandidateSigmaChart, drawCandidateLocationStrip,
} from './candidate_focus/_draw_panels.js';

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
    console.warn(`candidate_focus.${name}:`, e.message);
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
  const tabBtn = document.querySelector('#tabBar button[data-page="candidate_focus"]');
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
  if (targetCand) {
    persistActiveCandidateId(targetCand.id || '');
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
  // 2026-05-20 (SPEC_haplotype_burden_coloring.md Phase 1 deliverable #3):
  // export per-sample group labels TSV. microgroup_id comes from
  // cand.locked_labels (per-candidate K-band assignment); macrostripe_id
  // comes from getMacrostripeIdPerSample which folds Stage 3
  // band-tracking results onto the cohort. Both fall back to empty
  // strings when the upstream computation hasn't run, so the column
  // skeleton is always emittable — matches the SPEC's stated weekly
  // goal: "make sure the atlas can export the group labels cleanly.
  // That is enough."
  const exportBtn = document.getElementById('candExportGroupLabelsBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      try { _exportGroupLabelsTsv(state, c); }
      catch (e) {
        console.error('export group labels failed:', e);
        alert('Export failed: ' + (e && e.message ? e.message : e));
      }
    });
  }
}

// Build the TSV string for a single candidate and trigger a browser
// download. Pure-function-ish: only side-effects are document.createElement +
// URL.createObjectURL + a brief anchor click. SPEC column order:
//   sample_id   macrostripe_id   microgroup_id   stability_score
function _exportGroupLabelsTsv(state, c) {
  if (!state || !state.data || !c) {
    alert('No candidate or data loaded.');
    return;
  }
  const data = state.data;
  const samples = Array.isArray(data.samples) ? data.samples : [];
  const nS = (data.n_samples | 0) || samples.length || 0;
  if (nS === 0) {
    alert('No samples in dataset.');
    return;
  }
  const sampleId = (si) => {
    const s = samples[si];
    if (typeof s === 'string') return s;
    if (s && typeof s === 'object') {
      return s.sample_id || s.id || s.cga || s.ind || s.name || ('S' + si);
    }
    return 'S' + si;
  };
  // macrostripe ids — chrom-wide band assignment at the candidate's
  // ref_window (folds Stage 3 results). Null when banding hasn't run.
  let macro = null;
  try {
    const savedCur = state.cur;
    if (Number.isFinite(c.ref_window)) state.cur = c.ref_window | 0;
    macro = getMacrostripeIdPerSample(state);
    state.cur = savedCur;
  } catch (_) { macro = null; }
  // microgroup ids — the candidate's own K-band assignment from
  // locked_labels. -1 means sample not assigned.
  const locked = (c.locked_labels && c.locked_labels.length === nS)
    ? c.locked_labels : null;
  // stability_score — per-sample Hungarian-chain agreement within the
  // candidate range. Stub for now (SPEC notes this lives in
  // shared/lineage_clustering.js band-tracking); leave blank until that
  // path is wired into candidate_focus.
  const stability = null;

  const header = ['sample_id', 'macrostripe_id', 'microgroup_id', 'stability_score'].join('\t');
  const out = [header];
  for (let si = 0; si < nS; si++) {
    const sid = String(sampleId(si)).replace(/[\t\r\n]/g, ' ');
    const m   = (macro && macro[si] != null && macro[si] >= 0) ? String(macro[si]) : '';
    const u   = (locked && locked[si] != null && locked[si] >= 0) ? String(locked[si]) : '';
    const s2  = (stability && stability[si] != null && Number.isFinite(stability[si]))
                ? stability[si].toFixed(3) : '';
    out.push(`${sid}\t${m}\t${u}\t${s2}`);
  }
  const chrom = c.chrom || data.chrom || 'unknown';
  const candId = c.id || c.candidate_id || 'unknown';
  const filename = `macrostripe_groups.${chrom}.${candId}.tsv`;
  const blob = new Blob([out.join('\n') + '\n'], { type: 'text/tab-separated-values' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Atlas-router lifecycle
// ---------------------------------------------------------------------------

/**
 * Mount: called by atlas_router when the user navigates to candidate_focus.
 *
 * Page2 reads the active candidate from atlasState.shared.activeCandidate
 * (the registry slot established by promote-from-page-1 or view-from-page-3).
 * If no candidate is set, the empty state defined in candidate_focus.html is shown.
 * Otherwise renderCandidateMetadata composes the multi-panel deep-dive.
 *
 * Page2 does NOT load the chromosome data layer itself (unlike local_pca_dosage mount
 * which awaits resolve('scrubber_main')). The candidate's deep-dive
 * displays summary metadata + per-band stats from data already on the
 * candidate object; if a panel needs precomp it resolves it on demand.
 */
export async function mount(root, atlasState, registry) {
  // Build a legacy-shaped state object (same shape local_pca_dosage uses).
  let legacyState = _buildLegacyState(atlasState);

  // Page2 is a candidate-detail page — _setActiveState makes the
  // sub-module helpers see this state via ES module live-binding.
  _setActiveState(legacyState);

  // Initial render — guarded so a single broken panel doesn't hide the rest.
  // (Same defensive pattern local_pca_dosage uses.)
  try { renderCandidateMetadata(legacyState); }
  catch (e) { console.warn('candidate_focus.mount: renderCandidateMetadata threw —', e); }

  // Stash for inter-mount lookups.
  if (atlasState.inversion) atlasState.inversion._page2State = legacyState;

  // 2026-05-26: self-bootstrap scrubber_main via the shared helper so the
  // deep-dive canvases (Local PCA, PC1 track per sample, lines panel,
  // SIMDAT snapshot, L1 envelope, karyogram) render on direct navigation
  // from the catalogue / a saved link — without this, they all silently
  // bail on `if (!state.data) return` and the user sees empty panels.
  const bootstrap = await ensureChromTracks(atlasState, registry);
  if (bootstrap.ok) {
    legacyState = _buildLegacyState(atlasState);
    _setActiveState(legacyState);
    try { renderCandidateMetadata(legacyState); }
    catch (e) { console.warn('candidate_focus.mount: post-bootstrap render threw —', e); }
    if (atlasState.inversion) atlasState.inversion._page2State = legacyState;
  }

  // Mode-B lineage probe — non-blocking. Only fires when an active
  // candidate is selected; the badge stays hidden otherwise (matches
  // the candidateEmpty/candidateMeta visibility pattern). Fail-soft.
  _renderCandidateLineageBadge(atlasState, registry).catch((e) => {
    console.warn('candidate_focus.mount: lineage badge probe threw —', e);
  });

  // 2026-05-26: activate the four pop-stats stub panels (θ per band,
  // heterozygosity per band, Fst Hom1/Hom2, θπ IVGT). Fires after the
  // candidate has rendered + scrubber_main has bootstrapped (sample IDs
  // come from state.data.samples). Each panel is fail-soft — server
  // unreachable → the stub fallback stays in place.
  try { activatePopstatsPanels(legacyState); }
  catch (e) { console.warn('candidate_focus.mount: activatePopstatsPanels threw —', e); }
}

async function _renderCandidateLineageBadge(atlasState, registry) {
  const slot = document.getElementById('cfModeBBadge');
  if (!slot) return;
  const cand = (atlasState && atlasState.shared && atlasState.shared.candidate) || null;
  const candidate_id = cand && (cand.candidate_id || cand.id) || null;
  if (!candidate_id) {
    slot.style.display = 'none';
    return;
  }
  slot.style.display = 'block';

  const probe = await probeModeB(registry, 'candidate_lineage', { candidate_id }, {
    extractRows: (p) => {
      // lineage.versions is a map { version_id -> metadata }; flatten
      // to entries so probeModeB's row-array contract is satisfied.
      if (!p || !p.versions || typeof p.versions !== 'object') return null;
      return Object.entries(p.versions).map(([version_id, meta]) =>
        Object.assign({ version_id }, meta || {}));
    },
  });

  renderModeBBadge('cfModeBBadge', probe, {
    label:    'candidate lineage',
    layerKey: 'candidate_lineage',
    context:  candidate_id,
    compare:  (probeResult) => {
      const active = probeResult.payload && probeResult.payload.active_version_id;
      const status = probeResult.payload && probeResult.payload.status;
      const activeRow = active
        ? probeResult.rows.find((r) => r.version_id === active)
        : null;
      const refinedAt = activeRow && (activeRow.refined_at || activeRow.created_at);
      const pass = !!active && probeResult.n >= 1;
      const versionsList = probeResult.rows.map((r) => r.version_id).join(', ');
      const summary = `${probeResult.n} version${probeResult.n === 1 ? '' : 's'} ` +
        `(${versionsList}) · ` +
        (active ? `active = ${active}` : 'no active_version_id!') +
        (refinedAt ? ` · ${refinedAt}` : '') +
        (status ? ` · status: ${status}` : '');
      return { pass, summary };
    },
  });
}

/**
 * Unmount: called by atlas_router before navigating away.
 */
export async function unmount(root) {
  const state = _getState();
  if (state && state.inversion) {
    delete state.inversion._page2State;
  }
  // Clear the candidate_focus-private _pageState binding so a stale state can't
  // be observed if a sub-module fires after unmount (e.g. a debounced
  // requestAnimationFrame from drawCandLinesPanel).
  _setActiveState(null);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _buildLegacyState(atlasState) {
  // Same shape as local_pca_dosage's _buildLegacyState. Page2's helper bodies read
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
  // state.data is the chromosome precomp (n_windows, samples, l2_envelopes,
  // per-window pc1 …). It's stashed on inv._local_pca_dosage_state by
  // local_pca_dosage's mount. The legacy `inv.tracks[chrom]` slot was a stale
  // contract — nothing writes it — and meant this page silently lost
  // state.data even when local_pca_dosage HAD mounted. 2026-05-27 fix:
  // pull from inv._local_pca_dosage_state.data, fall back to the legacy
  // slot for back-compat.
  const chrom = sh.activeChrom;
  const stashedData = inv._local_pca_dosage_state && inv._local_pca_dosage_state.data;
  if (chrom && stashedData && stashedData.chrom === chrom) {
    legacy.data = stashedData;
  } else if (chrom && inv.tracks && inv.tracks[chrom]) {
    legacy.data = inv.tracks[chrom];               // legacy slot (back-compat)
  } else {
    legacy.data = null;
  }

  // 2026-05-29: PC1/PC2 sign-alignment for the per-sample lines panel.
  // drawCandLinesPanel (candidate_focus/_draw_panels.js) plots pc1[si] * sign,
  // where `sign` = state.pc1Sign[w] via getPC(). The pc1Sign / pc2Sign arrays
  // are produced by computePC1Signs() on the LOCAL_PCA_DOSAGE page state — NOT
  // on the `inv` bucket — so the Object.assign({}, inv) above never carried
  // them. getPC() then fell back to sign=1 and each window kept its arbitrary
  // raw PCA polarity, so the per-sample PC1 traces braid / flip across windows
  // even though the panel is labelled "sign-aligned PC1". Reuse the discovery
  // page's already-computed signs when they belong to THIS data object
  // (identical windows → identical alignment); otherwise compute fresh.
  if (legacy.data && Array.isArray(legacy.data.windows)) {
    if (legacy.flipPC1 == null) legacy.flipPC1 = true;
    const lp = inv._local_pca_dosage_state;
    if (lp && lp.data === legacy.data && lp.pc1Sign) {
      legacy.pc1Sign = lp.pc1Sign;
      legacy.pc2Sign = lp.pc2Sign || null;
    } else {
      computePC1Signs(legacy);
      computePC2Signs(legacy);
    }
  }
  // candidatePageMode controls "confirmed-only" navigation. The slot is
  // candidate_focus-private and gets set on the inversion bucket by tab transitions.
  legacy.candidatePageMode = inv.candidatePageMode || null;

  return legacy;
}
