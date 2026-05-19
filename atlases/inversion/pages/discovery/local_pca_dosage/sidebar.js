// pages/discovery/local_pca_dosage/sidebar.js
//
// Wires every local_pca_dosage aside control (sidebar #fileInput .. #jumpPrevL1)
// to state mutations + redraw chains. Verbatim port from legacy
// Inversion_atlas.html (Atlas_round166). Each handler is annotated with
// its legacy line number.
//
// Architecture:
//   attachSidebarHandlers(state)
//     -> _setActiveState(state)
//     -> _wireDataSection / _wireSimMatSmoothing / _wireL3Clustering /
//        _wireDisplay / _wireTrackedSamples / _wireManualGroups /
//        _wireJump / _wireSidebarToggle
//
// Helpers the legacy called as if global (drawSim, renderL3Panel, ...) are
// imported from the existing panel sub-modules. Helpers introduced for the
// sidebar surface itself (pickFromFocalBand, clearPicks, jumpL1, jumpL2,
// jumpToValue) live in ./events.js — co-located alongside setCur (their
// only redraw entry point) per the round-4 split's "panels stay
// concern-focused" rule.
//
// Out-of-scope stubs:
//   - #fileInput change → loadMultipleJSONs (lives at legacy 55392, ~500
//     LOC, data-loading flow owned by the atlas-core shell now). Stubbed
//     with a console.warn + TODO.
//   - #chromSelect change → uses legacy private `_chromCache` + applyData;
//     stubbed because cache lives behind the shell.
//   - #clearJsonCacheBtn → depends on legacy `_idbClearAll` (IDB layer).
//     Stubbed.
//   - #promoteCandidateBtn → depends on `makeCandidateFromLock` (legacy
//     57533) + `setCandidate` (legacy 57562). Both ~200 LOC each. Stubbed.
//   - Manual-groups buttons → depend on `manualGroupFromTracked`,
//     `manualGroupFromBand`, `exportManualGroupsTSV`,
//     `importManualGroupsTSV`, `clearAllManualGroups`,
//     `toggleManualGroupScope`, `removeManualGroup`, `renameManualGroup`.
//     All defined at legacy 48050-48270; ~200 LOC total. Stubbed for now
//     — needs a separate port (mg_groups.js or similar).
//   - #lockColorsBtn label refresher (`refreshLockBtn`) calls shortId on
//     state.data.l2_envelopes[refL2].candidate_id — that part IS ported
//     because shortId is already in shared/page1_utils.js.

import { shortId } from '../../../shared/page1_utils.js';
import {
  bandTraceForFishSet,
  bandTraceRegimeRuns,
  bandTraceToTSV,
  bandTraceRunsToTSV,
} from '../../../shared/band_trace.js';
import {
  lassoLinkageGetOrCompute,
  lassoLinkageToTSV,
} from '../../../shared/lasso_linkage.js';

import { _setActiveState } from './_state.js';
import {
  bandTraceGetOrCompute,
  bandTraceFromFocalCandidate,
  setBandTraceOn,
} from './band_trace_state.js';
import { getL2Cluster, groupColor } from './_data.js';
import { drawSim, drawSimMini } from './sim_panel.js';
import { drawZ } from './z_panel.js';
import { drawLinesPanel, setLinesPanelCandidateBands } from './lines_panel.js';
// applyMainGrid recomputes main#local_pca_dosage's grid-template-rows from the
// current state + visible panels. Called from _setSimInMinimap (sim
// toggle changes which rows are present) and _applyLayoutMode (so the
// inline gridTemplateRows from fixed mode is cleared when switching
// to compact/free, letting their CSS-driven templates take over).
import { applyMainGrid } from './panel_resize.js';
import {
  autoPickRadial as _autoPickRadialBridge,
  cycleKAside,
  drawAnchorStrip,
  drawPCA,
  recomputeAnchorConcord,
  renderTrackedList,
} from './pca_panel.js';
import { renderL3Panel } from './l3_panel.js';
import { wireGPanel } from './g_panel.js';
import { wireLinesSettingsPanel } from './lines_settings_panel.js';
import {
  exportKLabelsTSV,
  makeCandidateFromLock,
  refreshBandPickBar,
  refreshCandidateUI,
  setCandidate,
} from './candidates.js';
import {
  _updateConcordBadge,
  clearPicks,
  drawTracks,
  jumpL1,
  jumpL2,
  jumpToValue,
  pickFromFocalBand,
  renderZoneBlock,
} from './events.js';
import {
  clearAllManualGroups,
  exportManualGroupsTSV,
  importManualGroupsTSV,
  manualGroupFromBand,
  manualGroupFromTracked,
  removeManualGroup,
  renameManualGroup,
  toggleManualGroupScope,
} from './manual_groups.js';

// =============================================================================
// Public entry point
// =============================================================================

export function attachSidebarHandlers(state) {
  _setActiveState(state);
  _wireDataSection(state);
  _wireSimMatSmoothing(state);
  _wireL3Clustering(state);
  _wireDisplay(state);
  _wireTrackedSamples(state);
  _wireManualGroups(state);
  _wireJump(state);
  _wireSidebarToggle(state);
  _wireLayoutMode(state);
  _wireViewMode(state);
  _wirePanelCollapseButtons(state);
  // 2026-05-19: lines-settings flying panel — must run BEFORE
  // _wireNewShellControls because the panel stamps
  // #linesHeaderMoreToggle.dataset.wiredAsSettings=1, which the legacy
  // ▾more click-handler at line ~492 reads to skip its own wiring.
  // If we wired AFTER, both handlers would attach and clicks would
  // double-fire (modal + legacy inline toggle).
  try { wireLinesSettingsPanel(state); }
  catch (e) { console.warn('[wireLinesSettingsPanel]', e); }
  _wireNewShellControls(state);
  _wireActiveModeBar(state);
  _wireL3Controls(state);
}

// =============================================================================
// L3 panel controls — layout / color-mode / K-mode / recluster (2026-05-20)
// =============================================================================
// The L3 contingency bar has 4 control surfaces that were rendered but
// never wired (Quentin's report: "when we push these buttons nothing
// happens. when we recluster with Kmeans nothing happens"). Each control
// mutates a `state.l3*` slot and calls renderL3Panel — the renderer
// already reads these state slots, so wiring is all that was missing.
function _wireL3Controls(state) {
  if (typeof document === 'undefined') return;
  const repaint = () => {
    try { renderL3Panel(state); }
    catch (e) { console.warn('[l3] renderL3Panel:', e); }
  };
  // Restore persisted state slots so a reload lands on the same selection.
  try {
    const saved = localStorage.getItem('pca_scrubber_v3.l3Layout');
    if (saved) state.l3Layout = saved;
  } catch (_) {}
  try {
    const saved = localStorage.getItem('pca_scrubber_v3.l3ColorMode');
    if (saved) state.l3ColorMode = saved;
  } catch (_) {}
  try {
    const saved = localStorage.getItem('pca_scrubber_v3.l3KMode');
    if (saved) state.l3KMode = saved;
  } catch (_) {}
  try {
    const saved = localStorage.getItem('pca_scrubber_v3.l3ReclusterMode');
    if (saved) state.l3ReclusterMode = saved;
  } catch (_) {}

  // Helper for click-bar wiring with idempotency + active-class mirror +
  // optional persist key.
  const wireBar = (containerSel, dataAttr, stateKey, persistKey) => {
    const container = document.querySelector(containerSel);
    if (!container) return;
    container.querySelectorAll('button[' + dataAttr + ']').forEach(btn => {
      if (btn.dataset.l3Wired === '1') return;
      btn.dataset.l3Wired = '1';
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const val = btn.getAttribute(dataAttr);
        state[stateKey] = val;
        if (persistKey) {
          try { localStorage.setItem(persistKey, val); } catch (_) {}
        }
        container.querySelectorAll('button[' + dataAttr + ']').forEach(b => {
          b.classList.toggle('active', b === btn);
        });
        // 2026-05-20: mirror state.l3Layout onto body[data-l3-layout]
        // so the CUSUM dual-pane CSS rules (and any future layout-aware
        // chrome) can react. Done here so every layout button stays in
        // sync; the restore branch below does the same after pageload.
        if (stateKey === 'l3Layout' && document.body && document.body.dataset) {
          document.body.dataset.l3Layout = val;
        }
        repaint();
      });
    });
    // Reflect restored state on the active class.
    const cur = state[stateKey];
    if (cur != null) {
      container.querySelectorAll('button[' + dataAttr + ']').forEach(b => {
        b.classList.toggle('active', b.getAttribute(dataAttr) === cur);
      });
      if (stateKey === 'l3Layout' && document.body && document.body.dataset) {
        document.body.dataset.l3Layout = cur;
      }
    }
  };

  wireBar('#l3Layout',    'data-layout',  'l3Layout',    'pca_scrubber_v3.l3Layout');
  wireBar('#l3ColorMode', 'data-l3color', 'l3ColorMode', 'pca_scrubber_v3.l3ColorMode');
  wireBar('#l3KMode',     'data-l3k',     'l3KMode',     'pca_scrubber_v3.l3KMode');

  // Recluster dropdown — change event sets state.l3ReclusterMode + repaints.
  const reclusterSel = document.getElementById('l3ReclusterSel');
  if (reclusterSel && reclusterSel.dataset.l3Wired !== '1') {
    reclusterSel.dataset.l3Wired = '1';
    if (state.l3ReclusterMode) reclusterSel.value = state.l3ReclusterMode;
    reclusterSel.addEventListener('change', (e) => {
      state.l3ReclusterMode = e.target.value;
      try { localStorage.setItem('pca_scrubber_v3.l3ReclusterMode', e.target.value); }
      catch (_) {}
      repaint();
    });
  }

  // L3 het-coloring toggle (#l3HetToggle) — flips state.l3HetColoring and
  // repaints. Persisted to its own key.
  const l3HetToggle = document.getElementById('l3HetToggle');
  if (l3HetToggle && l3HetToggle.dataset.l3Wired !== '1') {
    l3HetToggle.dataset.l3Wired = '1';
    try {
      const saved = localStorage.getItem('pca_scrubber_v3.l3HetColoring');
      if (saved === '1') state.l3HetColoring = true;
    } catch (_) {}
    l3HetToggle.checked = !!state.l3HetColoring;
    l3HetToggle.addEventListener('change', (e) => {
      state.l3HetColoring = !!e.target.checked;
      try { localStorage.setItem('pca_scrubber_v3.l3HetColoring', e.target.checked ? '1' : '0'); }
      catch (_) {}
      repaint();
    });
  }
}

// =============================================================================
// Active-mode bar (2026-05-19) — dosage / θπ / GHSL toggle
// =============================================================================
// Click each segment to switch the underlying data source for every
// panel; press 'M' to cycle forward. Buttons for modes whose data isn't
// loaded are disabled (state.data.theta_pi_view / .ghsl_view absent).
function _wireActiveModeBar(state) {
  const bar = document.getElementById('dataModeBar');
  if (!bar) return;
  bar.querySelectorAll('button[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = btn.dataset.mode;
      if (!m || btn.disabled) return;
      // Dynamic import to break a circular dep — sidebar.js is loaded
      // by local_pca_dosage.js itself.
      import('../local_pca_dosage.js').then(mod => {
        if (typeof mod.setActiveMode === 'function') mod.setActiveMode(state, m);
      });
    });
  });
  // 'M' hotkey — cycle forward through dosage → θπ → GHSL → dosage.
  // Skip when an input is focused (don't fight text entry).
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'm' && ev.key !== 'M') return;
    if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
    const t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    import('../local_pca_dosage.js').then(mod => {
      if (typeof mod.cycleActiveMode === 'function') mod.cycleActiveMode(state);
    });
  });
  // Initial render — highlights the right segment + greys out unavailable modes.
  _refreshActiveModeBar(state);
}

function _refreshActiveModeBar(state) {
  const bar = document.getElementById('dataModeBar');
  if (!bar) return;
  const mode = state.activeMode || 'dosage';
  for (const btn of bar.querySelectorAll('button[data-mode]')) {
    const m = btn.dataset.mode;
    btn.classList.toggle('active', m === mode);
    const available =
      m === 'dosage' ||
      (m === 'theta_pi' && !!(state.data && state.data.theta_pi_view)) ||
      (m === 'ghsl'     && !!(state.data && state.data.ghsl_view));
    btn.disabled = !available;
    btn.style.opacity = available ? '' : '0.4';
  }
}

// =============================================================================
// New-shell mirror controls — 2026-05-15 bug-fix wires.
// =============================================================================
// The atlas-core shell exposes several controls in the right-side aside
// (#pcaTrackedAside / #pcaTrackedAsideCompact) and L3 toolbar that mirror
// the legacy hidden header controls. The legacy hidden controls (#flipPC1,
// #trailOn, ...) have working handlers (see _wireDisplay above). The
// VISIBLE aside / compact / L3 mirrors did NOT have handlers — clicking
// the user-visible checkbox did nothing because state.flipPC1 / .trailOn /
// .pcaLassoActive / .l3HetColoring were never written.
//
// This function wires those mirrors. Idempotent via dataset.wired.
//
// Bugs reported 2026-05-15 chat:
//   - "sign align PC1 its also not working"  → flipPC1Aside + flipPC1Compact
//   - "the lasso in local PCA its not working" → pcaLassoToggle + Compact
//   - "the heterozysity (dosage) its not working" → l3HetToggle
function _wireNewShellControls(state) {
  if (typeof document === 'undefined') return;
  const $ = (id) => document.getElementById(id);

  // Pair each visible checkbox with the same handler as its legacy
  // hidden sibling so toggling either reflects to all of them.
  // Mirror group: flipPC1 (sign-align PC1).
  const flipMirrors = ['flipPC1', 'flipPC1Aside', 'flipPC1Compact', 'flipPC1Popup'];
  const flipApply = (val) => {
    state.flipPC1 = !!val;
    state.l2GroupCache = null;
    state.cacheKey = null;
    for (const id of flipMirrors) {
      const el = $(id);
      if (el && el.checked !== !!val) el.checked = !!val;
    }
    try { drawPCA(state); } catch (e) { console.warn('[flipPC1] drawPCA:', e); }
    try { renderL3Panel(state); } catch (e) { console.warn('[flipPC1] renderL3Panel:', e); }
    try { drawLinesPanel(state); } catch (e) { console.warn('[flipPC1] drawLinesPanel:', e); }
  };
  for (const id of flipMirrors) {
    const el = $(id);
    if (!el || el.dataset.wired === '1') continue;
    el.checked = !!state.flipPC1;
    el.addEventListener('change', (e) => flipApply(e.target.checked));
    el.dataset.wired = '1';
  }

  // Mirror group: trailOn (PCA trails for tracked samples).
  const trailMirrors = ['trailOn', 'trailOnAside', 'trailOnCompact', 'trailOnPopup'];
  const trailApply = (val) => {
    state.trailOn = !!val;
    for (const id of trailMirrors) {
      const el = $(id);
      if (el && el.checked !== !!val) el.checked = !!val;
    }
    try { drawPCA(state); } catch (e) { console.warn('[trailOn] drawPCA:', e); }
  };
  for (const id of trailMirrors) {
    const el = $(id);
    if (!el || el.dataset.wired === '1') continue;
    el.checked = !!state.trailOn;
    el.addEventListener('change', (e) => trailApply(e.target.checked));
    el.dataset.wired = '1';
  }

  // Mirror group: pcaLassoToggle (lasso into tracked samples). Reads
  // state.pcaLassoActive — see local_pca_dosage/pca_panel.js#attachPcaLasso pointer-
  // down handler: when pcaLassoActive is true, plain drag activates the
  // tracked-lasso path; without it, only Shift+drag works.
  const lassoMirrors = ['pcaLassoToggle', 'pcaLassoToggleCompact', 'pcaLassoTogglePopup'];
  const lassoApply = (val) => {
    state.pcaLassoActive = !!val;
    for (const id of lassoMirrors) {
      const el = $(id);
      if (el && el.checked !== !!val) el.checked = !!val;
    }
  };
  for (const id of lassoMirrors) {
    const el = $(id);
    if (!el || el.dataset.wired === '1') continue;
    el.checked = !!state.pcaLassoActive;
    el.addEventListener('change', (e) => lassoApply(e.target.checked));
    el.dataset.wired = '1';
  }

  // Single control: l3HetToggle (L3 mini-PCA dots coloured by per-sample
  // het rate). See specs_done/SPEC_l3_het_dosage_coloring.md §3 — state
  // slot is state.l3HetColoring; persisted to localStorage; falls back
  // to K-cluster colour when dosage_chunks layer is absent.
  const hetEl = $('l3HetToggle');
  if (hetEl && hetEl.dataset.wired !== '1') {
    hetEl.checked = !!state.l3HetColoring;
    // Disable if dosage_chunks layer is absent.
    const dosageAvail = !!(state.layersPresent && state.layersPresent.has('dosage_chunks'));
    hetEl.disabled = !dosageAvail;
    hetEl.addEventListener('change', (e) => {
      state.l3HetColoring = !!e.target.checked;
      try {
        localStorage.setItem('pca_scrubber_v3.l3HetColoring',
                             state.l3HetColoring ? '1' : '0');
      } catch (_) {}
      try { renderL3Panel(state); }
      catch (err) { console.warn('[l3HetToggle] renderL3Panel:', err); }
    });
    hetEl.dataset.wired = '1';
  }

  // 2026-05-16 Group A.1: linesCandBandsToggle. The function
  // setLinesPanelCandidateBands(state, b) already exists in
  // lines_panel.js#1316 (writes state.linesPanelCandidateBands +
  // localStorage + redraws). The checkbox in local_pca_dosage.html line 747 had
  // no event listener anywhere — checked-by-default but flipping it
  // did nothing. WIRE_AUDIT_page1.md Group A entry.
  const candBandsEl = $('linesCandBandsToggle');
  if (candBandsEl && candBandsEl.dataset.wired !== '1') {
    // Default state: checked (per local_pca_dosage.html `checked` attribute). The
    // shipping default for state.linesPanelCandidateBands is true (per
    // SPEC_lines_panel_candidate_bands §3 "Toggle + persistence").
    candBandsEl.checked = (state.linesPanelCandidateBands !== false);
    candBandsEl.addEventListener('change', (e) => {
      try {
        setLinesPanelCandidateBands(state, e.target.checked);
      } catch (err) {
        console.warn('[linesCandBandsToggle] setLinesPanelCandidateBands:', err);
      }
    });
    candBandsEl.dataset.wired = '1';
  }

  // 2026-05-16 Group A.2 + A.3: linesTransRateToggle + linesRegimeBreadthToggle.
  // Both checkboxes (local_pca_dosage.html lines 628 / 639) gate the rendering
  // of strips in the |Z| panel (z_panel.js#_drawTransRateStrip /
  // _drawRegimeBreadthStrip). The strips early-return when their
  // state slot is false. No event listeners wired anywhere → toggling
  // the checkbox did nothing.
  // Same minimum-invasive pattern as the SPEC_l3_het_dosage_coloring
  // toggle wire above: flip state slot, drawZ() to re-render. Both
  // slots default false so the strips stay off until the user opts in.
  const transRateEl = $('linesTransRateToggle');
  if (transRateEl && transRateEl.dataset.wired !== '1') {
    transRateEl.checked = !!state.linesTransRateOn;
    transRateEl.addEventListener('change', (e) => {
      state.linesTransRateOn = !!e.target.checked;
      try { drawZ(state); } catch (err) { console.warn('[linesTransRateToggle] drawZ:', err); }
    });
    transRateEl.dataset.wired = '1';
  }
  const regimeBreadthEl = $('linesRegimeBreadthToggle');
  if (regimeBreadthEl && regimeBreadthEl.dataset.wired !== '1') {
    regimeBreadthEl.checked = !!state.linesRegimeBreadthOn;
    regimeBreadthEl.addEventListener('change', (e) => {
      state.linesRegimeBreadthOn = !!e.target.checked;
      try { drawZ(state); } catch (err) { console.warn('[linesRegimeBreadthToggle] drawZ:', err); }
    });
    regimeBreadthEl.dataset.wired = '1';
  }

  // 2026-05-18: macro / micro coloring toggle (SPEC_macrostripe_
  // microgroup_hierarchy.md Phase 1). When state.useMacrostripeColors
  // is true AND state.bandingResult is populated, drawPCA / lines /
  // L3 read per-sample color from shared/macrostripe.js#getMacrostripeColor.
  // When false (default) or banding absent, the existing K-means
  // microgroup coloring path stays in effect.
  const macroEl = $('linesMacrostripeToggle');
  if (macroEl && macroEl.dataset.wired !== '1') {
    macroEl.checked = !!state.useMacrostripeColors;
    macroEl.addEventListener('change', (e) => {
      state.useMacrostripeColors = !!e.target.checked;
      // Repaint chain — same surfaces the K-means microgroup coloring
      // touched. Wrapped in try/catch so one fail doesn't break the rest.
      try { drawPCA(state); }        catch (err) { console.warn('[macrostripeToggle] drawPCA:', err); }
      try { drawLinesPanel(state); } catch (err) { console.warn('[macrostripeToggle] drawLinesPanel:', err); }
      try { renderL3Panel(state); }  catch (err) { console.warn('[macrostripeToggle] renderL3Panel:', err); }
    });
    macroEl.dataset.wired = '1';
  }

  // 2026-05-18: Σ CUSUM panel toggle. Shows the dedicated cusumPanel
  // between #tracksContainer and #linesPanel; the painter
  // (drawCusumPanel) is a sibling repaint of drawLinesPanel so the
  // existing draw chain picks it up. Grid row toggles between 0px
  // and 70px via applyMainGrid (panel_resize.js).
  const cusumEl = $('linesCusumToggle');
  if (cusumEl && cusumEl.dataset.wired !== '1') {
    cusumEl.checked = !!state.cusumStripOn;
    cusumEl.addEventListener('change', (e) => {
      state.cusumStripOn = !!e.target.checked;
      // applyMainGrid reads getComputedStyle on #cusumPanel — set the
      // display flag here BEFORE the grid recalc so it picks up the
      // new state. drawCusumPanel will sync display too on next paint.
      const pan = document.getElementById('cusumPanel');
      if (pan) pan.style.display = state.cusumStripOn ? '' : 'none';
      try { applyMainGrid(state); } catch (err) {
        console.warn('[linesCusumToggle] applyMainGrid:', err);
      }
      try { drawLinesPanel(state); } catch (err) {
        console.warn('[linesCusumToggle] drawLinesPanel:', err);
      }
    });
    cusumEl.dataset.wired = '1';
  }

  // ===========================================================================
  // Lines-panel header "▾ more" disclosure (2026-05-18). The
  // #linesYsourceBar held ~10 inline secondary toggles (SNP-dens,
  // trans-rate, regime, lineage, band-trace cluster, cand-bands,
  // Σ-cusum) that wrapped to 2-3 rows and crowded the header. The
  // markup now wraps these in #linesHeaderMoreGroup (hidden by
  // default); the #linesHeaderMoreToggle button flips visibility
  // and persists the choice. User feedback (chat 2026-05-18): "in
  // the per sample lines the settings are still too many they
  // should be put under some toggle tab".
  // 2026-05-19: this inline "▾ more / ▴ less" toggle has been replaced
  // by the flying settings modal in lines_settings_panel.js. The button
  // text + click handler now belong to wireLinesSettingsPanel(); the
  // dataset.wiredAsSettings guard prevents the legacy click handler
  // below from also running. Kept here as a no-op default so older
  // builds (without lines_settings_panel.js loaded) keep working with
  // the inline collapse. When the panel module IS loaded, it sets
  // dataset.wiredAsSettings=1 on the button BEFORE this code runs
  // (page1 mount calls wireLinesSettingsPanel before applyData →
  // _wireNewShellControls), and we skip the legacy wiring entirely.
  const moreBtn = $('linesHeaderMoreToggle');
  const moreGroup = $('linesHeaderMoreGroup');
  if (moreBtn && moreGroup
      && moreBtn.dataset.wired !== '1'
      && moreBtn.dataset.wiredAsSettings !== '1') {
    let on = false;
    try { on = localStorage.getItem('inversion_atlas.linesHeaderMoreOn') === '1'; }
    catch (_) {}
    const apply = () => {
      moreGroup.style.display = on ? 'inline-flex' : 'none';
      moreBtn.textContent = on ? '▴ less' : '▾ more';
    };
    apply();
    moreBtn.addEventListener('click', () => {
      on = !on;
      try { localStorage.setItem('inversion_atlas.linesHeaderMoreOn', on ? '1' : '0'); }
      catch (_) {}
      apply();
    });
    moreBtn.dataset.wired = '1';
  }
  // When the settings modal is wired, force the inline group hidden so
  // its children only ever surface inside the modal. (Without this, the
  // group remains display:none from its inline HTML default, which is
  // already correct — but we set it explicitly here too as a belt &
  // braces guard.)
  if (moreBtn && moreGroup && moreBtn.dataset.wiredAsSettings === '1') {
    moreGroup.style.display = 'none';
  }

  // ===========================================================================
  // Lines-panel band-trace buttons (WIRE_AUDIT Group A — were never wired).
  // ===========================================================================
  _wireLinesBandTrace(state);

  // ===========================================================================
  // SNP-density buttons — redesigned 2026-05-18. "off" dropped per user
  // request; strip / shade are mutually-exclusive toggles, default off.
  // ===========================================================================
  _wireSnpDensityButtons(state);

  // ===========================================================================
  // Tracked-samples aside controls — kCycleBtnAside, [data-band-aside],
  // autoPickRadialAside, clearPicksAside, screeToggle mirrors. Legacy
  // sources cited inline.
  // ===========================================================================
  _wireTrackedAside(state);

  // ===========================================================================
  // T-panel (tracked-samples settings popup) — open/close + body controls.
  // ===========================================================================
  _wireTrackedSettingsPopup(state);

  // First paint of K-band button colors. _refreshBandPickAsideColors must
  // also be called on every K change (from kCycleBtnAside + kSelect).
  _refreshBandPickAsideColors(state);

  // ===========================================================================
  // N hotkey — cycle the PCA cluster-label notation overlay (Group H
  // from WIRE_AUDIT). State slot is state.pcaClusterLabelMode; the
  // overlay renders in pca_panel.js drawPCA when the mode is set.
  // ===========================================================================
  _wireClusterLabelHotkey(state);

  // ===========================================================================
  // U hotkey — toggle selection mode (Group G stage 1 from WIRE_AUDIT
  // + specs_todo/SPEC_cross_atlas_group_transfer.md). Boolean
  // state.selectionMode; Shift+drag on PCA scatter writes to
  // state.selectionGroup when this is true.
  // ===========================================================================
  _wireSelectionModeHotkey(state);

  // ===========================================================================
  // G hotkey + #gPanelOpenBtn click — open the unified-groups modal.
  // User feedback (chat 2026-05-18): "when I push G nothing happens".
  // Phase 0: hotkey + button + 3-tab scaffold; tab bodies are
  // placeholders pointing at the SPEC. Full per-tab ports land later.
  // ===========================================================================
  try { wireGPanel(state); } catch (e) { console.warn('[wireGPanel]', e); }

  // ===========================================================================
  // Tracked-samples compact panel collapse arrow — user-reported wire
  // gap (chat 2026-05-18): "the arrow down of settings in tracked
  // samples PCA it does nothing on page 1". The compact panel's head
  // has a ▼/▶ arrow that was supposed to toggle the body display
  // but no JS wired it.
  // ===========================================================================
  _wireCompactTrackedCollapse(state);

  // ===========================================================================
  // Collapsible sidebar sections (2026-05-19). Native <details> handles
  // the visual toggle; this helper just restores the persisted open/closed
  // state and writes back on user toggle. Each section opts in by carrying
  // a `data-persist-key` attribute on the <details>.
  // ===========================================================================
  _wireSidebarSectionPersist();

  // ===========================================================================
  // First-use attention pulses (v4 turn 80 — never wired in modular tree).
  // CSS classes `.attention-pulse` + `.attention-pulse-fade` already exist
  // in inversion.css (lines 143-172). Apply pulse to the key onboarding
  // buttons until first click; persist dismissal in localStorage.
  // ===========================================================================
  _initAttentionPulses();

  // ===========================================================================
  // ResizeObserver on the page root — re-fit + redraw every canvas when
  // the layout changes. User feedback 2026-05-18: "L3 panels still don't
  // refresh the PCA on resize like it's blurred". Without an observer,
  // canvases keep their old DPR-sized backing-store while CSS stretches
  // the box — browser scales the bitmap, producing blur. rAF-throttled
  // so a single drag triggers ONE redraw per frame, not one per
  // size-change event.
  // ===========================================================================
  _installPageResizeObserver(state);
}

// ---------------------------------------------------------------------------
// Page-level ResizeObserver. Every canvas on local_pca_dosage uses fitCanvas
// (shared/page1_utils.js#148) which sets the backing-store to
// `rect.width × DPR` based on the bounding rect AT PAINT TIME. If the
// layout reflows (window resize, seam drag, layout-mode switch, sim
// minimap toggle, scree-inset toggle, etc.) but no repaint fires, the
// canvases stretch their old bitmaps into the new box → blurred.
//
// Fix: observe the page root; on size change, rAF-throttle a full
// repaint chain. ResizeObserver coalesces multiple changes in the same
// frame; the rAF guard further collapses bursts during active drags.
//
// Idempotent via page.dataset.resizeObserverWired so re-mounts don't
// stack observers.
// ---------------------------------------------------------------------------
function _installPageResizeObserver(state) {
  if (typeof document === 'undefined') return;
  if (typeof ResizeObserver === 'undefined') return;
  const page = document.getElementById('local_pca_dosage');
  if (!page || page.dataset.resizeObserverWired === '1') return;
  let rafId = null;
  const repaint = () => {
    rafId = null;
    try { drawSim(state); }        catch (_) {}
    try { drawSimMini(state); }    catch (_) {}
    try { drawZ(state); }          catch (_) {}
    try { drawPCA(state); }        catch (_) {}
    try { drawAnchorStrip(state); }catch (_) {}
    try { drawLinesPanel(state); } catch (_) {}
    try { renderL3Panel(state); }  catch (_) {}
  };
  const ro = new ResizeObserver(() => {
    if (rafId != null) return;
    rafId = requestAnimationFrame(repaint);
  });
  ro.observe(page);
  page.dataset.resizeObserverWired = '1';
  // Stash so callers can disconnect on unmount (atlas-router lifecycle).
  if (typeof window !== 'undefined') window._local_pca_dosage_resizeObserver = ro;
}

// ---------------------------------------------------------------------------
// N hotkey — cycle the PCA cluster-label notation overlay.
//   default (off) → g_index → h_system → h_pair → off
// Persists state.pcaClusterLabelMode to localStorage so the choice
// survives reload. Hotkey is gated to not fire in INPUT/TEXTAREA/SELECT.
// ---------------------------------------------------------------------------
const _CLUSTER_LABEL_MODES = [null, 'g_index', 'h_system', 'h_pair'];
const _CLUSTER_LABEL_LS_KEY = 'inversion_atlas.pcaClusterLabelMode';

function _wireClusterLabelHotkey(state) {
  if (typeof document === 'undefined') return;
  // Restore from localStorage on first wire.
  if (state.pcaClusterLabelMode === undefined || state.pcaClusterLabelMode == null) {
    try {
      const v = localStorage.getItem(_CLUSTER_LABEL_LS_KEY);
      if (v && _CLUSTER_LABEL_MODES.includes(v)) state.pcaClusterLabelMode = v;
    } catch (_) {}
  }
  if (document._clusterLabelHotkeyWired) return;
  document._clusterLabelHotkeyWired = true;
  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    // Only fire when local_pca_dosage is the active page.
    const pageEl = document.getElementById('local_pca_dosage');
    if (!pageEl || !pageEl.classList.contains('active')) return;
    if ((e.key === 'n' || e.key === 'N')
        && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      const cur = state.pcaClusterLabelMode || null;
      const idx = _CLUSTER_LABEL_MODES.indexOf(cur);
      const next = _CLUSTER_LABEL_MODES[(idx + 1) % _CLUSTER_LABEL_MODES.length];
      state.pcaClusterLabelMode = next;
      try { localStorage.setItem(_CLUSTER_LABEL_LS_KEY, next == null ? '' : next); }
      catch (_) {}
      try { drawPCA(state); } catch (_) {}
    }
  });
}

// ---------------------------------------------------------------------------
// U hotkey — toggle selection mode. Sets state.selectionMode boolean and
// stamps body[data-selection-mode] so CSS can change cursor / show hint.
// On entry, clears any stale state.selectionGroup so the new drag starts
// fresh. Hotkey is one-document-wide; gated to fire only when local_pca_dosage
// is the active page and the focus is not in a text input.
// ---------------------------------------------------------------------------
function _wireSelectionModeHotkey(state) {
  if (typeof document === 'undefined') return;
  const sync = () => {
    if (document.body && document.body.dataset) {
      document.body.dataset.selectionMode = state.selectionMode ? '1' : '0';
    }
  };
  sync();
  if (document._selectionModeHotkeyWired) return;
  document._selectionModeHotkeyWired = true;
  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const pageEl = document.getElementById('local_pca_dosage');
    if (!pageEl || !pageEl.classList.contains('active')) return;
    if ((e.key === 'u' || e.key === 'U')
        && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      state.selectionMode = !state.selectionMode;
      if (state.selectionMode) {
        // Fresh drag — clear any stale selection from a prior session.
        state.selectionGroup = null;
      }
      sync();
      try { drawPCA(state); } catch (_) {}
    }
  });
}

// ---------------------------------------------------------------------------
// Tracked-samples compact panel collapse arrow. The head + arrow live
// in #trackedSamplesPanelCompactHead / #trackedSamplesPanelCompactArrow;
// the CSS already supports body[data-tracked-compact-collapsed="1"]
// (inversion.css L733) but no JS was setting the attribute. Restore
// from localStorage on mount; flip on click. Idempotent.
// ---------------------------------------------------------------------------
const _TRACKED_COMPACT_LS_KEY = 'inversion_atlas.trackedCompactCollapsed';

function _wireCompactTrackedCollapse(state) {
  if (typeof document === 'undefined') return;
  const head = document.getElementById('trackedSamplesPanelCompactHead');
  const arrow = document.getElementById('trackedSamplesPanelCompactArrow');
  const body = document.getElementById('trackedSamplesPanelCompactBody');
  if (!head || !body) return;

  // Restore persisted state on first wire.
  // 2026-05-20: default to collapsed on fresh load. The compact tracked
  // panel hosts a long stack of controls (band picker, manual groups,
  // color-mode picker, ...) most users don't need open while scrubbing.
  // Returning users keep their saved choice.
  let collapsed = true;
  try {
    const v = localStorage.getItem(_TRACKED_COMPACT_LS_KEY);
    if (v === '0') collapsed = false;
    else if (v === '1') collapsed = true;
  } catch (_) {}

  const apply = () => {
    body.style.display = collapsed ? 'none' : '';
    if (arrow) arrow.textContent = collapsed ? '▶' : '▼';
    // The CSS rule body[data-tracked-compact-collapsed="1"] hides the
    // panel's grid row entirely so the adjacent PCA + lines grow into
    // the freed space.
    if (document.body && document.body.dataset) {
      document.body.dataset.trackedCompactCollapsed = collapsed ? '1' : '0';
    }
  };
  apply();

  if (head.dataset.wired === '1') return;
  head.addEventListener('click', () => {
    collapsed = !collapsed;
    try { localStorage.setItem(_TRACKED_COMPACT_LS_KEY, collapsed ? '1' : '0'); }
    catch (_) {}
    apply();
    // Repaint adjacent panels since the freed/claimed space changes
    // their bounds — same chain the ResizeObserver uses.
    requestAnimationFrame(() => {
      try { drawPCA(state); }        catch (_) {}
      try { drawLinesPanel(state); } catch (_) {}
    });
  });
  head.dataset.wired = '1';

  // 2026-05-20: clear-all button on the panel header. Stops propagation
  // so the header's collapse toggle doesn't fire. Mirrors the existing
  // #clearPicks (sidebar) handler — state.tracked = [], repaint chain.
  const clearBtn = document.getElementById('clearPicksHeaderBtn');
  if (clearBtn && clearBtn.dataset.wired !== '1') {
    clearBtn.dataset.wired = '1';
    clearBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      state.tracked = [];
      try { renderTrackedList(state); }  catch (_) {}
      try { drawPCA(state); }            catch (_) {}
      try { drawLinesPanel(state); }     catch (_) {}
      try { renderL3Panel(state); }      catch (_) {}
      _updateCompactHeaderCount(state);
    });
  }
  // Initial count paint.
  _updateCompactHeaderCount(state);
}

// Refresh the small `(n=N)` chip in the compact panel header so the
// user can read the tracked count without expanding the body. Called
// from _wireCompactTrackedCollapse + on any tracked-set mutation we
// can hook (clear-all here; future: pick / lasso confirm).
function _updateCompactHeaderCount(state) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('trackedSamplesPanelCompactCount');
  if (!el) return;
  const n = (state && Array.isArray(state.tracked)) ? state.tracked.length : 0;
  el.textContent = n > 0 ? `· ${n}` : '';
}

// ---------------------------------------------------------------------------
// Collapsible sidebar sections — persistence for native <details>.
//
// Sections opt in by carrying a `data-persist-key="<slug>"` attribute on
// the <details> element. The slug is appended to a shared localStorage
// prefix so multiple atlases can coexist. On mount we restore the saved
// open/closed state (default = closed for the Tracked-samples section,
// since the aside + popup carry the same controls); on toggle we save.
// Idempotent via dataset.persistWired.
// ---------------------------------------------------------------------------
const _SIDEBAR_SECTION_LS_PREFIX = 'inversion_atlas.sidebarSection.';

function _wireSidebarSectionPersist() {
  if (typeof document === 'undefined') return;
  const nodes = document.querySelectorAll('details.sidebar-section[data-persist-key]');
  nodes.forEach(node => {
    if (node.dataset.persistWired === '1') return;
    const key = _SIDEBAR_SECTION_LS_PREFIX + node.dataset.persistKey;
    // Restore — default is *closed*. If no entry exists, the section
    // starts collapsed; the user can open it once and the new state
    // persists from then on.
    try {
      const stored = localStorage.getItem(key);
      if (stored === '1') node.setAttribute('open', '');
      else if (stored === '0') node.removeAttribute('open');
      else node.removeAttribute('open');   // default = collapsed
    } catch (_) {}
    node.addEventListener('toggle', () => {
      try { localStorage.setItem(key, node.open ? '1' : '0'); } catch (_) {}
    });
    node.dataset.persistWired = '1';
  });
}

// Target buttons by ID. Picked from legacy turn-80 comment (inversion.css L135).
// Each entry: button-id → localStorage key suffix.
const _PULSE_TARGETS = [
  { id: 'fileInput',           key: 'fileInput'       },
  { id: 'simFitSquare',        key: 'simFitSquare'    },
  { id: 'simMoveMinimapBtn',   key: 'simMoveMinimap'  },
  { id: 'jumpToWindowsBtn',    key: 'jumpToWindows'   },
  { id: 'promoteCandidateBtn', key: 'promoteCand'     },
];

function _initAttentionPulses() {
  if (typeof document === 'undefined') return;
  for (const { id, key } of _PULSE_TARGETS) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.dataset.pulseWired === '1') continue;
    el.dataset.pulseWired = '1';

    const storeKey = `inversion_atlas.pulse.${key}.dismissed`;
    let dismissed = false;
    try { dismissed = localStorage.getItem(storeKey) === '1'; } catch (_) {}
    if (dismissed) continue;

    // <input type="file"> can't host the pulse directly (browsers won't paint
    // outlines on it); pulse the wrapping .ctl per the legacy CSS recipe.
    const target = (el.tagName === 'INPUT' && el.type === 'file')
                   ? (el.closest('.ctl') || el)
                   : el;
    target.classList.add('attention-pulse');

    const dismiss = () => {
      target.classList.remove('attention-pulse');
      target.classList.add('attention-pulse-fade');
      try { localStorage.setItem(storeKey, '1'); } catch (_) {}
      setTimeout(() => target.classList.remove('attention-pulse-fade'), 850);
    };
    // The dismissal fires once on any of: click / focus / change. We can't
    // use { once: true } because the *first* interaction across any of the
    // three handlers should dismiss — use a guard flag instead.
    let done = false;
    const onAny = () => { if (done) return; done = true; dismiss(); };
    el.addEventListener('click',  onAny);
    el.addEventListener('focus',  onAny);
    el.addEventListener('change', onAny);
  }
}

// ---------------------------------------------------------------------------
// Rebuild the linesBandTracePickSelect dropdown options from the focal
// candidate's per-band sample counts. Port of legacy 40363-40407.
// Idempotent — safe to call on every candidate change or every trace
// click. Preserves the user's current selection when it's still valid;
// falls back to "largest" otherwise.
// ---------------------------------------------------------------------------
function _updateBandTracePickOptions(state) {
  if (typeof document === 'undefined') return;
  const sel = document.getElementById('linesBandTracePickSelect');
  if (!sel) return;
  const c = state && state.candidate;
  const prevValue = sel.value;
  // Reset to just the "largest" sentinel.
  while (sel.options && sel.options.length > 1) sel.remove(1);
  if (!c || !c.locked_labels || !c.locked_labels.length) {
    sel.value = 'largest';
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  const K = c.K || (state && state.k) || 3;
  const counts = new Int32Array(K);
  const labels = c.locked_labels;
  for (let s = 0; s < labels.length; s++) {
    const lab = labels[s];
    if (lab >= 0 && lab < K) counts[lab]++;
  }
  for (let k = 0; k < K; k++) {
    const opt = document.createElement('option');
    opt.value = String(k);
    opt.textContent = `b${k} (n=${counts[k]})`;
    sel.appendChild(opt);
  }
  // Restore previous selection if still valid.
  if (prevValue === 'largest') {
    sel.value = 'largest';
  } else {
    const want = parseInt(prevValue, 10);
    sel.value = (Number.isInteger(want) && want >= 0 && want < K)
                ? String(want) : 'largest';
  }
}

// ---------------------------------------------------------------------------
// Lines-panel band-trace + linkage button wires. The HTML
// (linesBandTraceToggle / linesBandTraceFromCandBtn /
// linesBandTraceExportBtn / linesBandTraceExportRunsBtn /
// linesBandTraceLinkageBtn) was carried over from legacy but no handlers
// were ported. Idempotent via dataset.wired.
// ---------------------------------------------------------------------------
function _wireLinesBandTrace(state) {
  if (typeof document === 'undefined') return;
  const $ = (id) => document.getElementById(id);

  // 1. linesBandTraceToggle — show/hide the band-trace strip.
  const toggle = $('linesBandTraceToggle');
  if (toggle && toggle.dataset.wired !== '1') {
    toggle.checked = !!state.bandTraceOn;
    toggle.addEventListener('change', (e) => {
      setBandTraceOn(state, !!e.target.checked);
      try { drawLinesPanel(state); } catch (_) {}
    });
    toggle.dataset.wired = '1';
  }

  // 2. linesBandTracePickSelect — band-picker dropdown. Legacy
  // _updateBandTracePickOptions (40363-40407): rebuild options from the
  // focal candidate's locked_labels with per-band counts. Initial paint
  // on wire; refresh on candidate change is wired below via the trace
  // button + exposed window function.
  _updateBandTracePickOptions(state);
  // Expose so other code paths (lines_panel, events) can trigger a
  // refresh when state.candidate changes without importing this file.
  if (typeof window !== 'undefined') {
    window._updateBandTracePickOptions = () => _updateBandTracePickOptions(state);
  }

  // 3. linesBandTraceFromCandBtn — 🔍 trace.
  const traceBtn = $('linesBandTraceFromCandBtn');
  if (traceBtn && traceBtn.dataset.wired !== '1') {
    traceBtn.addEventListener('click', () => {
      // Rebuild the dropdown first so the per-band counts reflect the
      // *current* focal candidate (the user may have scrubbed since the
      // last rebuild).
      _updateBandTracePickOptions(state);
      const pick = $('linesBandTracePickSelect');
      const opts = {};
      if (pick && pick.value && pick.value !== 'largest') {
        const v = parseInt(pick.value, 10);
        if (Number.isFinite(v) && v >= 0) opts.bandIdx = v;
      }
      const result = bandTraceFromFocalCandidate(state, opts);
      if (result) {
        if (!state.bandTraceOn) {
          setBandTraceOn(state, true);
          if (toggle) toggle.checked = true;
        }
        try { drawLinesPanel(state); } catch (_) {}
      }
    });
    traceBtn.dataset.wired = '1';
  }

  // 3. linesBandTraceExportBtn — 📊 TSV: per-L2 export.
  const tsvBtn = $('linesBandTraceExportBtn');
  if (tsvBtn && tsvBtn.dataset.wired !== '1') {
    tsvBtn.addEventListener('click', () => {
      const fishSet = state.bandTraceFishSet;
      if (!fishSet || !fishSet.length) return;
      const d = state.data;
      if (!d) return;
      try {
        const ctx = (typeof window !== 'undefined' && window._contextFromState)
                    ? window._contextFromState(state) : null;
        // We have bandTraceGetOrCompute on the page-local helper; use it.
        const trace = bandTraceGetOrCompute(state);
        if (!trace) return;
        const tsv = bandTraceToTSV(trace, {
          chrom: d.chrom,
          envelopes: d.l2_envelopes,
        });
        if (!tsv) return;
        _downloadTSV(tsv,
          `band_trace_${d.chrom || 'unknown'}_n${trace.n_fish_selected | 0}_K${trace.K | 0}.tsv`);
      } catch (err) { console.warn('[bandTrace TSV]', err); }
    });
    tsvBtn.dataset.wired = '1';
  }

  // 4. linesBandTraceExportRunsBtn — 📊 runs: per-run export.
  const runsBtn = $('linesBandTraceExportRunsBtn');
  if (runsBtn && runsBtn.dataset.wired !== '1') {
    runsBtn.addEventListener('click', () => {
      const fishSet = state.bandTraceFishSet;
      if (!fishSet || !fishSet.length) return;
      const d = state.data;
      if (!d) return;
      try {
        const trace = bandTraceGetOrCompute(state);
        if (!trace) return;
        const runs = bandTraceRegimeRuns(trace);
        const tsv = bandTraceRunsToTSV(runs, {
          chrom: d.chrom,
          envelopes: d.l2_envelopes,
        });
        if (!tsv) return;
        _downloadTSV(tsv,
          `band_trace_runs_${d.chrom || 'unknown'}_n${trace.n_fish_selected | 0}_K${trace.K | 0}.tsv`);
      } catch (err) { console.warn('[bandTrace runs TSV]', err); }
    });
    runsBtn.dataset.wired = '1';
  }

  // 5. linesBandTraceLinkageBtn — 🔗 linkage: opens the per-candidate
  // purity-table modal. Legacy ref: _openLassoLinkagePopover (40861-40913).
  const linkBtn = $('linesBandTraceLinkageBtn');
  if (linkBtn && linkBtn.dataset.wired !== '1') {
    linkBtn.addEventListener('click', () => _openLassoLinkagePopover(state));
    linkBtn.dataset.wired = '1';
  }
}

// Download a TSV blob with the given filename. No-op in headless / blob-
// blocked environments. Matches the legacy pattern (40296-40310).
function _downloadTSV(tsv, filename) {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') return;
  try {
    const blob = new Blob([tsv], { type: 'text/tab-separated-values' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 200);
  } catch (_) { /* defensive */ }
}

// ---------------------------------------------------------------------------
// Lasso-linkage popover (port of legacy 40861-41008 + 41011-41020). Opens a
// modal showing, for the active fish-set (state.bandTraceFishSet), which
// confirmed candidates the set "links" to (purity per band). Click 🔗
// linkage on the lines panel to open.
// ---------------------------------------------------------------------------
const _LASSO_LINKAGE_MODAL_ID = 'lassoLinkagePopover';

function _openLassoLinkagePopover(state) {
  if (typeof document === 'undefined') return null;
  let modal = document.getElementById(_LASSO_LINKAGE_MODAL_ID);
  if (!modal) {
    modal = document.createElement('div');
    modal.id = _LASSO_LINKAGE_MODAL_ID;
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;'
                        + 'background:rgba(0,0,0,0.55);z-index:9999;display:none;'
                        + 'align-items:center;justify-content:center;';
    modal.innerHTML = ''
      + '<div style="background:var(--panel-2);border:1px solid var(--rule);'
      +              'border-radius:6px;padding:14px;max-width:780px;max-height:80vh;'
      +              'display:flex;flex-direction:column;gap:8px;'
      +              'font-family:var(--mono);overflow:hidden;">'
      +   '<div style="display:flex;align-items:center;gap:10px;flex:0 0 auto;">'
      +     '<span style="font-size:13px;color:var(--ink);"><b>Fish-set linkage</b></span>'
      +     '<span id="llTitle" style="font-size:11px;color:var(--ink-dim);"></span>'
      +     '<span style="margin-left:auto;display:flex;gap:6px;">'
      +       '<button id="llExportBtn" style="font-family:var(--mono);font-size:11px;'
      +                 'padding:3px 8px;background:var(--panel);border:1px solid var(--rule);'
      +                 'color:var(--ink);border-radius:2px;cursor:pointer;"'
      +                 ' title="Download the linkage table as TSV.">📊 TSV</button>'
      +       '<button id="llClose" style="font-family:var(--mono);font-size:11px;'
      +                 'padding:3px 8px;background:var(--panel);border:1px solid var(--rule);'
      +                 'color:var(--ink);border-radius:2px;cursor:pointer;">close ×</button>'
      +     '</span>'
      +   '</div>'
      +   '<div id="llStatus" style="font-size:11px;color:var(--ink-dim);line-height:1.4;'
      +              'flex:0 0 auto;"></div>'
      +   '<div id="llTableHost" style="overflow:auto;flex:1 1 auto;'
      +              'font-family:var(--mono);font-size:11px;color:var(--ink);"></div>'
      +   '<div style="font-size:10px;color:var(--ink-dim);max-width:760px;line-height:1.4;'
      +              'flex:0 0 auto;">'
      +     'For the current fish-set (state.bandTraceFishSet), each row shows a '
      +     'confirmed candidate and which of its bands the fish-set predominantly '
      +     'falls into. Strong links (purity ≥ 0.7 AND n_in_band ≥ 5) appear '
      +     'first. Click 🔍 trace on the lines panel to populate or change the '
      +     'fish-set. Observation-only — no candidate is labelled as "linked" or '
      +     '"unlinked"; the table reports purity numbers and the reader interprets.'
      +   '</div>'
      + '</div>';
    document.body.appendChild(modal);
    const closeBtn = document.getElementById('llClose');
    if (closeBtn) closeBtn.addEventListener('click', _closeLassoLinkagePopover);
    const expBtn = document.getElementById('llExportBtn');
    if (expBtn) expBtn.addEventListener('click', () => {
      try {
        const result = lassoLinkageGetOrCompute(state);
        if (!result) return;
        const tsv = lassoLinkageToTSV(result);
        if (!tsv) return;
        const chromTag = (state.data && state.data.chrom) || 'all';
        _downloadTSV(tsv,
          `lasso_linkage_${chromTag}_n${result.n_fish_selected | 0}.tsv`);
      } catch (_) {}
    });
    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) _closeLassoLinkagePopover();
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && modal.style.display !== 'none') {
        _closeLassoLinkagePopover();
      }
    });
  }
  modal.style.display = 'flex';
  _renderLassoLinkageTable(state);
  return modal;
}

function _closeLassoLinkagePopover() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById(_LASSO_LINKAGE_MODAL_ID);
  if (modal) modal.style.display = 'none';
}

function _renderLassoLinkageTable(state) {
  if (typeof document === 'undefined') return;
  const host = document.getElementById('llTableHost');
  const status = document.getElementById('llStatus');
  const title  = document.getElementById('llTitle');
  if (!host) return;
  const result = lassoLinkageGetOrCompute(state);
  if (!result) {
    host.innerHTML = '<div style="padding:18px;color:var(--ink-dim);'
                   + 'font-style:italic;">No fish-set is active. Click 🔍 trace '
                   + 'on the lines panel first.</div>';
    if (status) status.textContent = '';
    if (title)  title.textContent  = '';
    return;
  }
  if (title) {
    title.textContent = `n_fish=${result.n_fish_selected} · n_candidates=`
                      + `${result.n_candidates_seen} · ${result.strong_links.length} `
                      + `strong link(s) (purity≥${result.purity_threshold})`;
  }
  if (status) {
    status.textContent = 'Sorted by best_purity descending. '
                       + 'Strong-link rows are highlighted; weak rows are dimmed.';
  }
  const all = Object.values(result.per_candidate).slice();
  all.sort((a, b) => {
    if (a.is_strong_link !== b.is_strong_link) return a.is_strong_link ? -1 : 1;
    if (b.best_purity !== a.best_purity) return b.best_purity - a.best_purity;
    if (b.n_in_best_band !== a.n_in_best_band) return b.n_in_best_band - a.n_in_best_band;
    return String(a.id).localeCompare(String(b.id));
  });
  const PAL = ['#3b6fb6', '#ffd866', '#d97a2c', '#7ad394', '#a76de2', '#e85a5a'];
  const bandColor = (k) => (k >= 0) ? PAL[k % PAL.length] : '#444';
  const esc = (s) => String(s).replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[ch]);
  let html = '<table style="width:100%;border-collapse:collapse;">';
  html += '<thead><tr style="border-bottom:1px solid var(--rule);color:var(--ink-dim);text-align:left;">';
  for (const h of ['candidate', 'chrom', 'span (Mb)', 'best band', 'purity', 'n in band', 'strong?']) {
    html += `<th style="padding:4px 8px;">${h}</th>`;
  }
  html += '</tr></thead><tbody>';
  for (const r of all) {
    const span = (r.start_bp != null && r.end_bp != null)
      ? `${(r.start_bp / 1e6).toFixed(2)}–${(r.end_bp / 1e6).toFixed(2)}`
      : '';
    const swatch = bandColor(r.best_band);
    const rowStyle = r.is_strong_link
      ? 'border-bottom:1px solid var(--rule);background:rgba(122,211,148,0.06);'
      : 'border-bottom:1px solid var(--rule);color:var(--ink-dim);';
    html += `<tr style="${rowStyle}">`
         +  `<td style="padding:4px 8px;">${esc(r.id)}</td>`
         +  `<td style="padding:4px 8px;">${esc(r.chrom || '')}</td>`
         +  `<td style="padding:4px 8px;">${span}</td>`
         +  `<td style="padding:4px 8px;">`
         +    `<span style="display:inline-block;width:8px;height:8px;`
         +    `background:${swatch};border-radius:1px;vertical-align:middle;`
         +    `margin-right:4px;"></span>b${r.best_band | 0}</td>`
         +  `<td style="padding:4px 8px;">${(r.best_purity * 100).toFixed(1)}%</td>`
         +  `<td style="padding:4px 8px;">${r.n_in_best_band | 0} / ${r.n_lasso_seen | 0}</td>`
         +  `<td style="padding:4px 8px;">${r.is_strong_link ? '✓' : '·'}</td>`
         +  '</tr>';
  }
  html += '</tbody></table>';
  host.innerHTML = html;
}

// ---------------------------------------------------------------------------
// SNP-density buttons. 2026-05-18 redesign per user request: dropped the
// "off" button; strip and shade are mutually-exclusive toggles. Click an
// inactive button → activate, deactivating the other. Click the active
// one → turn off (no button active).
// state.linesSnpDensityMode ∈ {null, 'strip', 'shade'}.
// ---------------------------------------------------------------------------
function _wireSnpDensityButtons(state) {
  if (typeof document === 'undefined') return;
  const bar = document.getElementById('linesSnpDensityBar');
  if (!bar || bar.dataset.wired === '1') return;

  const sync = () => {
    const mode = state.linesSnpDensityMode || null;
    bar.querySelectorAll('[data-snpdens-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.snpdensMode === mode);
    });
  };
  sync();

  bar.querySelectorAll('[data-snpdens-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const want = btn.dataset.snpdensMode;
      // Toggle off when re-clicking the active mode.
      state.linesSnpDensityMode = (state.linesSnpDensityMode === want) ? null : want;
      sync();
      try { drawLinesPanel(state); } catch (_) {}
    });
  });
  bar.dataset.wired = '1';
}

// ---------------------------------------------------------------------------
// K-band button painter — port of legacy 55977-55998. Colors each
// [data-k-band] button by groupColor(ki); disables + dims buttons whose
// k >= state.k.
// ---------------------------------------------------------------------------
function _refreshBandPickAsideColors(state) {
  if (typeof document === 'undefined') return;
  // Update the K-cycle button label on every refresh (legacy 55970-55974).
  for (const id of ['kCycleBtnAside', 'kCycleBtnCompact']) {
    const btn = document.getElementById(id);
    if (btn) btn.textContent = `K=${state.k}`;
  }
  document.querySelectorAll('[data-k-band]').forEach(b => {
    const ki = parseInt(b.dataset.kBand, 10);
    if (!isFinite(ki)) return;
    if (ki < state.k) {
      const col = groupColor(ki) || '#666';
      b.style.background = col;
      // Contrast text: light backgrounds get dark text.
      const isLight = /^#[bcdefBCDEF]/.test(col)
                    || /^rgb.*\b(2[2-5]\d|1[8-9]\d)/.test(col);
      b.style.color = isLight ? '#0e1116' : '#fff';
      b.style.borderColor = col;
      b.style.opacity = '1';
      b.disabled = false;
      b.style.cursor = 'pointer';
    } else {
      b.style.background = 'var(--panel-2)';
      b.style.color = 'var(--ink-dimmer)';
      b.style.borderColor = 'var(--rule)';
      b.style.opacity = '0.4';
      b.disabled = true;
      b.style.cursor = 'not-allowed';
    }
  });
}

// ---------------------------------------------------------------------------
// Aside-control wires that were never ported. Idempotent via dataset.wired.
// ---------------------------------------------------------------------------
function _wireTrackedAside(state) {
  if (typeof document === 'undefined') return;
  const $ = (id) => document.getElementById(id);

  // K-cycle button — legacy 56536-56565. Delegates to cycleKAside (already
  // exported from pca_panel.js — handles state.k bump, cache bust, kSelect
  // mirror, and full repaint), then repaints the K-band button colors.
  for (const id of ['kCycleBtnAside', 'kCycleBtnCompact']) {
    const btn = $(id);
    if (!btn || btn.dataset.wired === '1') continue;
    btn.addEventListener('click', () => {
      try { cycleKAside(state); } catch (e) {
        console.warn('[kCycleBtnAside] cycleKAside:', e);
      }
      _refreshBandPickAsideColors(state);
    });
    btn.dataset.wired = '1';
  }

  // [data-band-aside] band picker — legacy 56377-56389. Each button calls
  // pickFromFocalBand(state, 'all'|0..5) and visually marks the active one.
  document.querySelectorAll('[data-band-aside]').forEach(btn => {
    if (btn.dataset.wired === '1') return;
    btn.addEventListener('click', () => {
      const v = btn.dataset.bandAside;
      document.querySelectorAll('[data-band-aside]').forEach(b =>
        b.classList.remove('active'));
      btn.classList.add('active');
      if (v === 'all') pickFromFocalBand(state, 'all');
      else             pickFromFocalBand(state, parseInt(v, 10));
    });
    btn.dataset.wired = '1';
  });

  // Auto-pick / Clear — legacy 56571-56580.
  const autoPickAside = $('autoPickRadialAside');
  if (autoPickAside && autoPickAside.dataset.wired !== '1') {
    autoPickAside.addEventListener('click', () => {
      try { _autoPickRadialBridge(state, state.trackedN); } catch (_) {}
    });
    autoPickAside.dataset.wired = '1';
  }
  // 2026-05-18 — Auto-pick + Clear button mirrors for the COMPACT
  // tracked-samples panel. Previously only the fixed-mode aside copies
  // were wired; in compact mode (now the default), clicking Clear or
  // Auto-pick on the compact panel did nothing. User-reported chat
  // 2026-05-18: "in the settings or anywhere when we push the 'remove
  // the group' button or clear tracked samples. nothing happens."
  const compactClicks = [
    { id: 'clearPicksAside',       fn: () => clearPicks(state) },
    { id: 'clearPicksCompact',     fn: () => clearPicks(state) },
    { id: 'clearPicksCompact2',    fn: () => clearPicks(state) },
    { id: 'autoPickRadialAside',   fn: () => _autoPickRadialBridge(state, state.trackedN) },
    { id: 'autoPickRadialCompact', fn: () => _autoPickRadialBridge(state, state.trackedN) },
    { id: 'autoPickRadialCompact2',fn: () => _autoPickRadialBridge(state, state.trackedN) },
  ];
  for (const { id, fn } of compactClicks) {
    const btn = $(id);
    if (!btn || btn.dataset.wired === '1') continue;
    btn.addEventListener('click', () => { try { fn(); } catch (_) {} });
    btn.dataset.wired = '1';
  }
}

// ---------------------------------------------------------------------------
// T-panel (tracked-samples settings popup). Modal pattern modeled on G-panel
// (legacy 43948-44030): #tPanelOverlay display:flex when open, ✕ close +
// click-outside + Esc + 't' hotkey.
// ---------------------------------------------------------------------------
function _wireTrackedSettingsPopup(state) {
  if (typeof document === 'undefined') return;
  const $ = (id) => document.getElementById(id);
  const overlay = $('tPanelOverlay');
  if (!overlay) return;

  const open = () => {
    overlay.style.display = 'flex';
    state.tPanelOpen = true;
  };
  const close = () => {
    overlay.style.display = 'none';
    state.tPanelOpen = false;
  };

  // 2026-05-18: dual open buttons — the fixed-mode aside header
  // hosts #tPanelOpenBtn; the compact-mode panel header hosts
  // #tPanelOpenBtnCompact. Both open the same #tPanelOverlay popup.
  for (const id of ['tPanelOpenBtn', 'tPanelOpenBtnCompact']) {
    const openBtn = $(id);
    if (!openBtn || openBtn.dataset.wired === '1') continue;
    openBtn.addEventListener('click', (e) => {
      // The compact-panel head also has a click handler (collapse arrow);
      // stop propagation so opening the popup doesn't collapse the body.
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
      state.tPanelOpen ? close() : open();
    });
    openBtn.dataset.wired = '1';
  }
  const closeBtn = $('tPanelClose');
  if (closeBtn && closeBtn.dataset.wired !== '1') {
    closeBtn.addEventListener('click', close);
    closeBtn.dataset.wired = '1';
  }
  if (overlay.dataset.wired !== '1') {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();        // click-outside
    });
    overlay.dataset.wired = '1';
  }
  if (!document._tPanelHotkeyWired) {
    document.addEventListener('keydown', (e) => {
      // Only when local_pca_dosage is the active page and we're not in a
      // text input. Esc always closes; 't' (no modifiers) toggles.
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape' && state.tPanelOpen) { e.preventDefault(); close(); return; }
      if (e.key === 't' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        state.tPanelOpen ? close() : open();
      }
    });
    document._tPanelHotkeyWired = true;
  }

  // ----- Popup body controls: trail-back slider + N-tracked slider -----
  // (the checkboxes — trails / sign-align PC1 / lasso / scree — share
  // mirror groups with the legacy hidden controls; see flipMirrors etc.)
  const trailNPopup = $('trailNPopup');
  if (trailNPopup && trailNPopup.dataset.wired !== '1') {
    if (state.trailN != null && isFinite(state.trailN)) {
      trailNPopup.value = String(state.trailN);
      const lbl = $('trailNValPopup');
      if (lbl) lbl.textContent = String(state.trailN);
    }
    trailNPopup.addEventListener('input', e => {
      state.trailN = +e.target.value;
      const lbl = $('trailNValPopup');
      if (lbl) lbl.textContent = String(state.trailN);
      // Also write to the legacy hidden #trailN if present, so sidebar stays
      // synced.
      const legacy = $('trailN');
      if (legacy) legacy.value = String(state.trailN);
      try { drawPCA(state); } catch (_) {}
    });
    trailNPopup.dataset.wired = '1';
  }
  const trackedNPopup = $('trackedNPopup');
  if (trackedNPopup && trackedNPopup.dataset.wired !== '1') {
    if (state.trackedN != null && isFinite(state.trackedN)) {
      trackedNPopup.value = String(state.trackedN);
      const lbl = $('trackedNValPopup');
      if (lbl) lbl.textContent = String(state.trackedN);
    }
    trackedNPopup.addEventListener('input', e => {
      state.trackedN = +e.target.value;
      const lbl = $('trackedNValPopup');
      if (lbl) lbl.textContent = String(state.trackedN);
      // Trim tracked list + sync sidebar slider.
      if (Array.isArray(state.tracked) && state.tracked.length > state.trackedN) {
        state.tracked = state.tracked.slice(0, state.trackedN);
      }
      const legacy = $('trackedN');
      if (legacy) legacy.value = String(state.trackedN);
      const legacyLbl = $('trackedNVal');
      if (legacyLbl) legacyLbl.textContent = String(state.trackedN);
      try { drawPCA(state); } catch (_) {}
      try { renderL3Panel(state); } catch (_) {}
    });
    trackedNPopup.dataset.wired = '1';
  }
  // Scree toggle — single-control wiring (no existing mirror group for it).
  const screeMirrors = ['screeToggle', 'screeToggleCompact', 'screeTogglePopup'];
  const screeApply = (val) => {
    state.screePlotEnabled = !!val;
    try { localStorage.setItem('inversion_atlas.screePlotEnabled',
                                state.screePlotEnabled ? '1' : '0'); } catch (_) {}
    for (const id of screeMirrors) {
      const el = $(id);
      if (el && el.checked !== !!val) el.checked = !!val;
    }
    try { if (typeof window !== 'undefined' && window._refreshScreeInset) {
      window._refreshScreeInset();
    } else { drawPCA(state); } } catch (_) {}
  };
  // 2026-05-20: default scree ON on fresh load. Quentin: "I think that
  // the scree plot in the tracked samples local PCA must be able to be
  // on By default". Returning users keep their saved choice; only the
  // unset case lands enabled. (The drag-to-reattach corner feature
  // mentioned in the same message is queued — for now the inset uses
  // its existing absolute-positioned upper-right corner, which the
  // smart-corner-placement logic in pca_panel.js handles by moving
  // away from dense scatter regions.)
  if (state.screePlotEnabled == null) {
    try {
      const v = localStorage.getItem('inversion_atlas.screePlotEnabled');
      if (v === '0') state.screePlotEnabled = false;
      else if (v === '1') state.screePlotEnabled = true;
      else state.screePlotEnabled = true;  // fresh-load default = on
    } catch (_) { state.screePlotEnabled = true; }
  }
  for (const id of screeMirrors) {
    const el = $(id);
    if (!el || el.dataset.wired === '1') continue;
    el.checked = !!state.screePlotEnabled;
    el.addEventListener('change', (e) => screeApply(e.target.checked));
    el.dataset.wired = '1';
  }
}

// =============================================================================
// Panel collapse buttons — pcaCollapseBtn / l3CollapseBtn / zCollapseBtn
// =============================================================================
// Each panel's header has a ▼ button. Clicking it flips state.<panel>Collapsed
// and re-runs applyMainGrid; the collapsed panel shrinks to a thin strip
// (~32px) showing just its toolbar / axis bar, and the adjacent 1fr panel
// grows into the freed space. State is persisted to localStorage.
function _wirePanelCollapseButtons(state) {
  const SPECS = [
    { btn: 'pcaCollapseBtn', slot: 'pcaCollapsed', lsKey: 'pca_scrubber_v3.pcacollapsed' },
    { btn: 'l3CollapseBtn',  slot: 'l3Collapsed',  lsKey: 'pca_scrubber_v3.l3collapsed' },
    { btn: 'zCollapseBtn',   slot: 'zCollapsed',   lsKey: 'pca_scrubber_v3.zcollapsed' },
  ];
  for (const s of SPECS) {
    const btn = $(s.btn);
    if (!btn) continue;
    // Restore persisted state
    try {
      if (localStorage.getItem(s.lsKey) === '1') state[s.slot] = true;
    } catch (_) {}
    // Reflect initial state in the arrow
    btn.textContent = state[s.slot] ? '▶' : '▼';
    btn.addEventListener('click', () => {
      state[s.slot] = !state[s.slot];
      btn.textContent = state[s.slot] ? '▶' : '▼';
      try { localStorage.setItem(s.lsKey, state[s.slot] ? '1' : '0'); } catch (_) {}
      try { applyMainGrid(state); } catch (_) {}
      // Re-fit canvases after the row resize.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        try { drawSim(state); }        catch (_) {}
        try { drawZ(state); }          catch (_) {}
        try { drawLinesPanel(state); } catch (_) {}
        try { drawPCA(state); }        catch (_) {}
        try { drawTracks(state); }     catch (_) {}
        try { renderL3Panel(state); }  catch (_) {}
      }));
    });
  }
  // Apply the restored state on first mount so the grid reflects it.
  if (state.pcaCollapsed || state.l3Collapsed || state.zCollapsed) {
    try { applyMainGrid(state); } catch (_) {}
  }
}

// =============================================================================
// View mode (ctrlBar) — legacy lines 67755-67791
// =============================================================================
// Genome / L1 zoom / L2 zoom buttons mutate state.viewMode + persist + redraw.
// jumpToWindowsBtn cycles arrow-key step size through win1 → win5 → win10.

const _VIEWMODE_STORAGE_KEY = 'pca_scrubber_v3.viewmode';
const _STEP_CYCLE_ORDER     = ['win1', 'win5', 'win10'];

function _applyViewMode(state, mode) {
  if (mode !== 'genome' && mode !== 'l1' && mode !== 'l2') mode = 'genome';
  state.viewMode = mode;
  document.querySelectorAll('#viewModeBar button[data-viewmode]').forEach(b => {
    b.classList.toggle('active', b.dataset.viewmode === mode);
  });
  // Auto-move sim_mat into the minimap when zooming to L1/L2 — the
  // heatmap shows the WHOLE chromosome so its scale stops matching the
  // zoomed Z panel below it. Move back to the main panel when returning
  // to genome scope. The user can still toggle manually via the panel
  // buttons; this just runs the natural default per viewMode.
  if (typeof state._setSimInMinimap === 'function') {
    const wantInMinimap = (mode === 'l1' || mode === 'l2');
    if (!!state.simInMinimap !== wantInMinimap) {
      try { state._setSimInMinimap(wantInMinimap); } catch (_) {}
    }
  }
  if (state.data) {
    requestAnimationFrame(() => {
      try { drawZ(state); }          catch (_) {}
      try { drawTracks(state); }     catch (_) {}
      try { drawLinesPanel(state); } catch (_) {}
    });
  }
}

function _stepSizeForMode(m) {
  if (m === 'win5')  return 5;
  if (m === 'win10') return 10;
  return 1;
}

function _refreshStepSizeBtn(state) {
  const btn = $('jumpToWindowsBtn');
  if (!btn) return;
  const m = state.stepMode;
  let label, lit, title;
  if (m === 'l2' || m == null) {
    label = '📊 Windows (—)';
    lit   = false;
    title = 'Arrow-step cycler. Currently inactive — arrow keys jump between L2 envelopes. '
          + 'Click to switch to 1-window steps; click again to cycle 1 → 5 → 10 → 1.';
  } else if (m === 'winN') {
    const n = Math.max(1, (state.stepModeN | 0) || 1);
    label = `📊 Windows (${n})`;
    lit   = true;
    title = `Arrow-step cycler. Currently ${n} windows per step (custom from sidebar).`;
  } else {
    const n = _stepSizeForMode(m);
    label = `📊 Windows (${n})`;
    lit   = true;
    title = `Arrow-step cycler. Currently ${n} window${n === 1 ? '' : 's'} per step. `
          + 'Click to advance (1 → 5 → 10 → 1).';
  }
  btn.textContent = label;
  btn.classList.toggle('is-active-step', lit);
  btn.title = title;
}

function _cycleStepSize(state) {
  const cur = state.stepMode;
  const i = _STEP_CYCLE_ORDER.indexOf(cur);
  const next = (i < 0)
    ? _STEP_CYCLE_ORDER[0]
    : _STEP_CYCLE_ORDER[(i + 1) % _STEP_CYCLE_ORDER.length];
  state.stepMode = next;
  // Mirror to sidebar #stepModeBar
  document.querySelectorAll('#stepModeBar button').forEach(b => {
    b.classList.toggle('active', b.dataset.step === next);
  });
  try { localStorage.setItem('pca_scrubber_v3.stepmode', next); } catch (_) {}
  _refreshStepSizeBtn(state);
}

function _wireViewMode(state) {
  document.querySelectorAll('#viewModeBar button[data-viewmode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = btn.dataset.viewmode;
      if (m && m !== state.viewMode) {
        try { localStorage.setItem(_VIEWMODE_STORAGE_KEY, m); } catch (_) {}
        _applyViewMode(state, m);
      }
    });
  });
  // Restore persisted viewMode
  try {
    const v = localStorage.getItem(_VIEWMODE_STORAGE_KEY);
    if (v === 'l1' || v === 'l2' || v === 'genome') _applyViewMode(state, v);
    else _applyViewMode(state, state.viewMode || 'genome');
  } catch (_) {
    _applyViewMode(state, state.viewMode || 'genome');
  }

  // jumpToWindowsBtn (📊 Windows) — cycles arrow-key step size
  const stepBtn = $('jumpToWindowsBtn');
  if (stepBtn) {
    stepBtn.addEventListener('click', () => _cycleStepSize(state));
    _refreshStepSizeBtn(state);
  }
}

// =============================================================================
// Layout mode (ctrlBar) — legacy lines 4801, 75575-75623
// =============================================================================
// Cycles state.layoutMode through fixed → free → compact → fixed. Drives the
// `body[data-layout-mode]` attribute that the CSS grid rules read.

const _LAYOUT_MODE_KEY = 'pca_scrubber_v3.layoutmode';
const _LAYOUT_MODES = ['fixed', 'free', 'compact'];

function _applyLayoutMode(state, mode) {
  if (!_LAYOUT_MODES.includes(mode)) mode = 'fixed';
  state.layoutMode = mode;
  if (document.body && document.body.dataset) {
    document.body.dataset.layoutMode = mode;
  }
  const btn = $('layoutModeBtn');
  if (btn) {
    if (btn.dataset) btn.dataset.mode = mode;
    btn.textContent = (mode === 'free')    ? '📜 free'
                    : (mode === 'compact') ? '🪟 compact'
                                           : '📐 fixed';
    btn.title = (mode === 'free')
      ? 'Layout: FREE — panels at natural height, scroll with mouse wheel. Click for compact.'
      : (mode === 'compact')
      ? 'Layout: COMPACT — 2×2 upper grid + L3 below. Click for fixed.'
      : 'Layout: FIXED — single-column grid, fits one screen. Click for free.';
  }
  try { localStorage.setItem(_LAYOUT_MODE_KEY, mode); } catch (_) {}
  // Recompute the inline grid template. In compact/free mode the
  // function clears `main.style.gridTemplateRows = ''` so the CSS-driven
  // template for those modes takes over. Without this, the inline rows
  // baked in by fixed mode persist and the compact mode panels end up
  // sized wrong (L3 / Z / anchor strip squashed or missing).
  try { applyMainGrid(state); } catch (_) {}
  // Redraw — fitCanvas re-measures the new heights. Defer two rAFs so
  // the new grid resolves before canvases re-measure.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try { drawSim(state); }        catch (_) {}
    try { drawZ(state); }          catch (_) {}
    try { drawLinesPanel(state); } catch (_) {}
    try { drawPCA(state); }        catch (_) {}
    try { drawTracks(state); }     catch (_) {}
    try { renderL3Panel(state); }  catch (_) {}
  }));
}

// --- setCandidateMode — legacy lines 67915-67956 ---
// Toggles state.candidateMode + updates button + persists + re-renders.
// Drops the in-progress draft when toggling off so stale state doesn't
// surface on next toggle-on. _refreshCmActionButtons and renderL3Panel
// re-renders are guarded with typeof since the former is still stubbed.
const _CANDIDATE_MODE_KEY = 'pca_scrubber_v3.candidatemode';
function _setCandidateMode(state, b) {
  state.candidateMode = !!b;
  const btn = $('candidateModeBtn');
  if (btn) {
    btn.dataset.active = b ? '1' : '0';
    btn.title = b
      ? 'Candidate mode ON. Arrow-up extends focal L2 to include next neighbor (right). Arrow-down shrinks. Enter commits to candidate list. Esc cancels.'
      : 'Toggle candidate mode. When ON: arrow-up merges focal L2 with the next neighbor (right) into a draft candidate; arrow-down shrinks.';
  }
  const editTools = document.getElementById('candidateEditRow');
  if (editTools) editTools.style.display = b ? 'flex' : 'none';
  if (typeof _refreshCmActionButtons === 'function') {
    try { _refreshCmActionButtons(); } catch (_) {}
  }
  if (!b) {
    state.l3Draft = null;
    state.activeTrackIdx = 0;
  }
  try { localStorage.setItem(_CANDIDATE_MODE_KEY, b ? '1' : '0'); } catch (_) {}
  if (typeof refreshL3BcScopeButtons === 'function') refreshL3BcScopeButtons();
  try { renderL3Panel(state); } catch (_) {}
  if (state.data) {
    try { drawZ(state); } catch (_) {}
  }
}

function _wireLayoutMode(state) {
  const btn = $('layoutModeBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      const cur = state.layoutMode || 'fixed';
      const next = _LAYOUT_MODES[(_LAYOUT_MODES.indexOf(cur) + 1) % _LAYOUT_MODES.length];
      _applyLayoutMode(state, next);
    });
    // Sync button label to whatever mode mount() set on body
    _applyLayoutMode(state, state.layoutMode || 'fixed');
  }
  // --- #candidateModeBtn click — legacy line 4819 / 67915-67956 ---
  const candBtn = $('candidateModeBtn');
  if (candBtn) {
    candBtn.addEventListener('click', () => {
      _setCandidateMode(state, !state.candidateMode);
    });
    // Restore persisted state at first wire-up.
    try {
      if (localStorage.getItem(_CANDIDATE_MODE_KEY) === '1') {
        _setCandidateMode(state, true);
      }
    } catch (_) {}
  }
  const resetBtn = $('resetLayoutBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      _applyLayoutMode(state, 'fixed');
      // Also restore sidebar visibility + remove sim-minimap state
      try { localStorage.removeItem('pca_scrubber_v3.sidebar_collapsed'); } catch (_) {}
      try { localStorage.removeItem('pca_scrubber_v3.siminminimap'); } catch (_) {}
      const wrap = document.querySelector('.wrap');
      if (wrap) wrap.removeAttribute('data-sidebar');
      if (document.body && document.body.dataset) {
        document.body.dataset.simInMinimap = '0';
      }
      const mini = $('simMinimap');
      if (mini) mini.classList.remove('active');
    });
  }
}

// =============================================================================
// Helpers
// =============================================================================

// Shorthand mirroring the legacy `const $ = id => document.getElementById(id);`
// from legacy line 55870.
const $ = id => document.getElementById(id);

// =============================================================================
// Data
// =============================================================================

function _wireDataSection(state) {
  // --- #fileInput change — legacy lines 55871-55873 ---
  // OUT-OF-SCOPE STUB: loadMultipleJSONs (legacy 55392) is the legacy
  // data-loading pipeline (~500 LOC: schema detect → applyData fan-out).
  // The atlas-core shell owns data loading now. Wire a console.warn so
  // the surface still attaches cleanly.
  const fileInput = $('fileInput');
  if (fileInput) {
    fileInput.addEventListener('change', e => {
      if (e.target.files && e.target.files.length > 0) {
        console.warn('[sidebar TODO] #fileInput → loadMultipleJSONs not ported '
                   + '(legacy line 55392). The atlas-core shell owns data '
                   + 'loading; route through there.');
      }
    });
  }

  // --- #chromSelect change — legacy lines 55890-55895 ---
  // OUT-OF-SCOPE STUB: depends on legacy private `_chromCache` (legacy
  // line 52534) + applyData. The atlas-core shell owns chrom switching now.
  const chromSelect = $('chromSelect');
  if (chromSelect) {
    chromSelect.addEventListener('change', e => {
      const chrom = e.target.value;
      if (!chrom) return;
      console.warn('[sidebar TODO] #chromSelect → _chromCache+applyData not '
                 + 'ported (legacy lines 55890-55895, cache at 52534). '
                 + 'Route through atlas-core shell.');
    });
  }

  // --- #clearJsonCacheBtn click — legacy lines 69882-69899 ---
  // OUT-OF-SCOPE STUB: depends on legacy private `_idbClearAll` (IDB layer).
  const clearBtn = $('clearJsonCacheBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      console.warn('[sidebar TODO] #clearJsonCacheBtn → _idbClearAll not '
                 + 'ported (legacy lines 69882-69899). IDB layer needs '
                 + 'separate port.');
    });
  }

  // --- #simMinimapRestoreBtn + #simMoveMinimapBtn — legacy lines 67611-67619 ---
  // Minimal port of setSimInMinimap: toggles state.simInMinimap, the body
  // data-sim-in-minimap attribute, the .active class on #simMinimap, and
  // persists. Re-runs applyMainGrid so the main#local_pca_dosage grid template
  // drops the simPanel row — without that, panels stay locked in their
  // original grid rows and an empty band appears above zPanel.
  const moveBtn    = $('simMoveMinimapBtn');
  const restoreBtn = $('simMinimapRestoreBtn');
  const _setSimInMinimap = (on) => {
    state.simInMinimap = !!on;
    if (document.body && document.body.dataset) {
      document.body.dataset.simInMinimap = on ? '1' : '0';
    }
    const mini = $('simMinimap');
    if (mini) {
      if (on && !state.data) mini.classList.remove('active');
      else mini.classList.toggle('active', !!on);
    }
    try { localStorage.setItem('pca_scrubber_v3.siminminimap', on ? '1' : '0'); } catch (_) {}
    try { applyMainGrid(state); } catch (_) {}
    // Redraw the panels whose canvas sizes changed. Defer one frame so the
    // CSS reflow (display:none / .active toggle) settles before fitCanvas
    // re-measures the heights; otherwise minimap renders at 0×0 on the
    // first paint and stays empty until something else triggers a redraw.
    requestAnimationFrame(() => {
      try { drawSim(state); }        catch (_) {}
      try { drawZ(state); }          catch (_) {}
      try { drawLinesPanel(state); } catch (_) {}
      try { drawPCA(state); }        catch (_) {}
      try { renderL3Panel(state); }  catch (_) {}
      // When sim is in the minimap, draw THERE; the main #simCanvas is
      // hidden by CSS but drawSim above still touched it harmlessly.
      if (state.simInMinimap && state.data) {
        try { drawSimMini(state); } catch (_) {}
      }
    });
  };
  if (moveBtn)    moveBtn.addEventListener('click', () => _setSimInMinimap(true));
  if (restoreBtn) restoreBtn.addEventListener('click', () => _setSimInMinimap(false));
  // Expose the setter on state so non-sidebar code (e.g. _applyViewMode)
  // can move sim to/from the minimap without re-implementing the logic.
  state._setSimInMinimap = _setSimInMinimap;
  // 2026-05-20: default the sim heatmap into the minimap on fresh load
  // so the main panel area opens up. Returning users keep their saved
  // choice; only the unset case flips to '1'. Quentin: "by default we
  // try to toggle the minimap".
  try {
    const cur = localStorage.getItem('pca_scrubber_v3.siminminimap');
    if (cur == null) {
      requestAnimationFrame(() => _setSimInMinimap(true));
    } else if (cur === '1') {
      requestAnimationFrame(() => _setSimInMinimap(true));
    }
  } catch (_) {}
}

// =============================================================================
// Sim_mat smoothing
// =============================================================================

function _wireSimMatSmoothing(state) {
  // --- #simScaleSelect change — legacy lines 66405-66408 ---
  const simScale = $('simScaleSelect');
  if (simScale) {
    simScale.addEventListener('change', e => {
      state.simScale = e.target.value;
      drawSim(state);
    });
  }

  // --- #pdfStyle change — legacy lines 66409-66412 ---
  const pdf = $('pdfStyle');
  if (pdf) {
    pdf.addEventListener('change', e => {
      state.pdfStyle = e.target.checked;
      drawSim(state);
    });
  }
}

// =============================================================================
// L3 clustering
// =============================================================================

function _wireL3Clustering(state) {
  // --- #kSelect change — legacy lines 66414-66440 ---
  const kSel = $('kSelect');
  if (kSel) {
    kSel.addEventListener('change', e => {
      const v = e.target.value;
      if (v === 'adaptive') {
        state.kMode = 'adaptive';
        // state.k is the fallback if adaptive can't decide; default to 3
        state.k = 3;
      } else {
        state.kMode = 'fixed';
        state.k = +v;
      }
      state.l2GroupCache = null; state.cacheKey = null;
      refreshBandPickBar(state);
      // v3.52: K changed → anchor labels are stale (different cluster
      // assignments). Re-anchor at current scrubber position with new K labels
      if (state.trackingAnchor) state.trackingAnchor = null;
      try { recomputeAnchorConcord(); } catch (_) {}
      drawPCA(state); renderZoneBlock(state); renderL3Panel(state);
      try { drawAnchorStrip(state); } catch (_) {}
      // v3.71: K change → anchor reset → badge needs refresh
      try { _updateConcordBadge(state); } catch (_) {}
      // 2026-05-18: repaint the K-band button colors (kBand button is
      // disabled+dim when ki >= state.k; enabled+colored otherwise).
      _refreshBandPickAsideColors(state);
    });
  }

  // --- #aggMethod change — legacy lines 66441-66445 ---
  const aggMethod = $('aggMethod');
  if (aggMethod) {
    aggMethod.addEventListener('change', e => {
      state.aggMethod = e.target.value;
      state.l2GroupCache = null; state.cacheKey = null;
      state.slabGroupCache = null;
      drawPCA(state); renderZoneBlock(state); renderL3Panel(state);
    });
  }

  // --- #silScoreOn change (2026-05-18: separates fit dim from score dim) ---
  const silScoreOn = $('silScoreOn');
  if (silScoreOn) {
    if (state.silScoreOn) silScoreOn.value = state.silScoreOn;
    silScoreOn.addEventListener('change', e => {
      state.silScoreOn = e.target.value;
      state.l2GroupCache = null; state.cacheKey = null;
      state.slabGroupCache = null;
      drawPCA(state); renderZoneBlock(state); renderL3Panel(state);
    });
  }

  // --- #mergeThr input — legacy lines 66446-66450 ---
  const mergeThr = $('mergeThr');
  if (mergeThr) {
    // Init from state so the UI matches state on mount (legacy rule 7).
    if (state.mergeThr != null && isFinite(state.mergeThr)) {
      mergeThr.value = state.mergeThr;
      const lbl = $('mergeThrVal');
      if (lbl) lbl.textContent = (+state.mergeThr).toFixed(2);
    }
    mergeThr.addEventListener('input', e => {
      state.mergeThr = +e.target.value;
      $('mergeThrVal').textContent = state.mergeThr.toFixed(2);
      renderL3Panel(state);
    });
  }

  // --- #alphaThr input — legacy lines 66451-66455 ---
  const alphaThr = $('alphaThr');
  if (alphaThr) {
    if (state.alpha != null && isFinite(state.alpha)) {
      alphaThr.value = state.alpha;
      const lbl = $('alphaThrVal');
      if (lbl) lbl.textContent = (+state.alpha).toFixed(3);
    }
    alphaThr.addEventListener('input', e => {
      state.alpha = +e.target.value;
      $('alphaThrVal').textContent = state.alpha.toFixed(3);
      renderL3Panel(state);
    });
  }

  // --- #minNGroup input — legacy lines 66456-66461 ---
  const minNGroup = $('minNGroup');
  if (minNGroup) {
    if (state.minNGroup != null && isFinite(state.minNGroup)) {
      minNGroup.value = state.minNGroup;
      const lbl = $('minNGroupVal');
      if (lbl) lbl.textContent = String(state.minNGroup);
    }
    minNGroup.addEventListener('input', e => {
      state.minNGroup = +e.target.value;
      $('minNGroupVal').textContent = state.minNGroup;
      state.l2GroupCache = null; state.cacheKey = null;
      drawPCA(state); renderZoneBlock(state); renderL3Panel(state);
    });
  }

  // --- #minNWin input — legacy lines 66462-66467 ---
  const minNWin = $('minNWin');
  if (minNWin) {
    if (state.minNWin != null && isFinite(state.minNWin)) {
      minNWin.value = state.minNWin;
      const lbl = $('minNWinVal');
      if (lbl) lbl.textContent = String(state.minNWin);
    }
    minNWin.addEventListener('input', e => {
      state.minNWin = +e.target.value;
      $('minNWinVal').textContent = state.minNWin;
      state.l2GroupCache = null; state.cacheKey = null;
      renderZoneBlock(state); renderL3Panel(state);
    });
  }
}

// =============================================================================
// Display
// =============================================================================

function _wireDisplay(state) {
  // 2026-05-19: shared apply-color-mode routine called from BOTH the
  // sidebar #colorModeBar and the in-PCA-panel #colorModeBarCompact.
  // The two bars were drifting because only the sidebar was wired —
  // the compact buttons looked clickable but did nothing. This factors
  // out the shared logic so the two surfaces stay in lock-step and
  // either one repaints the PCA / lines / L3 strip.
  const applyColorMode = (newMode) => {
    state.colorMode = newMode;
    state.colorByL2 = (state.colorMode === 'cluster');   // legacy alias
    // Mirror the active class onto BOTH bars so the highlight stays in sync.
    document.querySelectorAll('#colorModeBar button').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === newMode);
    });
    document.querySelectorAll('#colorModeBarCompact button').forEach(b => {
      b.classList.toggle('active', b.dataset.modeCompact === newMode);
    });
    // v4 turn 86: show/hide Q-ancestry sub-controls when mode toggles
    // to/from q_ancestry. Refresh the K dropdown options from the
    // registered set each time the panel is shown.
    const qaSubs = document.getElementById('qAncestrySubControls');
    if (qaSubs) {
      if (state.colorMode === 'q_ancestry') {
        qaSubs.style.display = 'flex';
        if (typeof _qaPopulateKSelect === 'function') _qaPopulateKSelect();
      } else {
        qaSubs.style.display = 'none';
      }
    }
    if (typeof updateColorModeInfo === 'function') {
      try { updateColorModeInfo(); } catch (_) {}
    }
    drawPCA(state);
    // 2026-05-18: also redraw the per-sample lines panel — many modes
    // (family, lineage) affect both surfaces. The lines panel reads its
    // own state.linesColorMode, so this is a no-op when the lines mode
    // is independent (kmeans default), but it picks up changes to the
    // shared scope-color modes (family/lineage) cleanly.
    try { drawLinesPanel(state); } catch (_) {}
    renderL3Panel(state);
  };

  // --- #colorModeBar button click — legacy lines 66470-66493 ---
  document.querySelectorAll('#colorModeBar button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      applyColorMode(btn.dataset.mode);
    });
  });
  // --- #colorModeBarCompact button click (2026-05-19) ---
  // The compact bar lives inside the PCA panel card; it has its own
  // `data-mode-compact` attribute (sidebar uses `data-mode`). Without
  // this loop, clicking any of the 6 compact buttons fired no handler
  // — the user saw the buttons but the PCA scatter never recoloured.
  document.querySelectorAll('#colorModeBarCompact button').forEach(btn => {
    if (btn.dataset.wired === '1') return;
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const mode = btn.dataset.modeCompact;
      if (!mode) return;
      applyColorMode(mode);
    });
    btn.dataset.wired = '1';
  });

  // --- #qAncestrySubControls widgets — legacy lines 66495-66548 ---
  // K-select wiring is also done by _qaPopulateKSelect when the user
  // switches to q_ancestry; we wire the two display/legend button bars
  // here (idempotent via dataset.wired). The K-select dropdown wires
  // itself on first populate.
  document.querySelectorAll('#qAncestrySubControls button[data-q-display]').forEach(btn => {
    if (btn.dataset.wired) return;
    btn.addEventListener('click', () => {
      document.querySelectorAll('#qAncestrySubControls button[data-q-display]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.qDisplayMode = btn.dataset.qDisplay;
      drawPCA(state);
    });
    btn.dataset.wired = '1';
  });
  document.querySelectorAll('#qAncestrySubControls button[data-q-legend]').forEach(btn => {
    if (btn.dataset.wired) return;
    btn.addEventListener('click', () => {
      document.querySelectorAll('#qAncestrySubControls button[data-q-legend]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.qLegendMode = btn.dataset.qLegend;
      drawPCA(state);
    });
    btn.dataset.wired = '1';
  });

  // --- #labelVocabBar button click — legacy lines 66566-66582 ---
  // The vocabulary toggle is handled by legacy globals (_karyoLabelSetVocab,
  // _karyoLabelRefreshButtons, _renderCandidateKaryotypeBody). We preserve
  // the click handler shape verbatim; if the helpers aren't loaded, the
  // typeof guards no-op.
  document.querySelectorAll('#labelVocabBar button[data-vocab]').forEach(btn => {
    if (btn.dataset.wired) return;
    btn.addEventListener('click', () => {
      const newVocab = btn.dataset.vocab;
      if (typeof _karyoLabelSetVocab === 'function') _karyoLabelSetVocab(newVocab);
      document.querySelectorAll('#labelVocabBar button[data-vocab]').forEach(
        b => b.classList.remove('active'));
      btn.classList.add('active');
      if (typeof _karyoLabelRefreshButtons === 'function') _karyoLabelRefreshButtons();
      drawPCA(state);
      if (typeof _renderCandidateKaryotypeBody === 'function' && state.candidate) {
        try { _renderCandidateKaryotypeBody(); }
        catch (e) { console.warn('[labelVocab] karyotype rerender failed:', e); }
      }
    });
    btn.dataset.wired = '1';
  });

  // --- #activeModeBar button click — legacy lines 66613-66638 ---
  document.querySelectorAll('#activeModeBar button[data-mode]').forEach(btn => {
    if (btn.dataset.wired) return;
    btn.addEventListener('click', () => {
      const newMode = btn.dataset.mode;
      if (typeof setActiveMode !== 'function') return;
      if (!setActiveMode(newMode)) return;
      // First-time switch to detailed: seed the detailed registry from default.
      if (newMode === 'detailed' && typeof initDetailedFromDefault === 'function') {
        try { initDetailedFromDefault(); } catch (e) { console.warn('[activeMode] init failed:', e); }
      }
      if (typeof _activeModeApplyToButtons === 'function') _activeModeApplyToButtons();
      if (typeof _activeModeRefreshBanner === 'function') _activeModeRefreshBanner();
      try { drawPCA(state); } catch (e) { console.warn('[activeMode] drawPCA failed:', e); }
      if (typeof _renderCandidateKaryotypeBody === 'function') {
        try { _renderCandidateKaryotypeBody(); }
        catch (e) { console.warn('[activeMode] karyotype rerender failed:', e); }
      }
    });
    btn.dataset.wired = '1';
  });

  // --- #lockColorsBtn click — legacy lines 56694-56735 ---
  // The label refresher (refreshLockBtn) is defined inline below since it
  // also needs to run on mount (and downstream code like the K-select
  // handler may call it indirectly via refreshCandidateUI).
  const lockBtn = $('lockColorsBtn');
  function refreshLockBtn() {
    if (!lockBtn) return;
    if (state.lockedLabels) {
      const refL2 = state.lockedRefL2;
      const env = refL2 != null && state.data ? state.data.l2_envelopes[refL2] : null;
      const id = env ? shortId(env.candidate_id) : '?';
      lockBtn.innerHTML = `🔓 unlock (frozen to ${id})`;
      lockBtn.style.background = 'var(--accent)';
      lockBtn.style.color = '#0e1116';
      lockBtn.style.borderColor = 'var(--accent)';
    } else {
      lockBtn.innerHTML = '🔒 lock colors to current L2';
      lockBtn.style.background = '';
      lockBtn.style.color = '';
      lockBtn.style.borderColor = '';
    }
  }
  if (lockBtn) {
    lockBtn.addEventListener('click', () => {
      if (state.lockedLabels) {
        state.lockedLabels = null;
        state.lockedRefL2 = null;
      } else {
        const curL2 = state.windowToL2 ? state.windowToL2[state.cur] : -1;
        if (curL2 < 0) return;
        const cl = getL2Cluster(state, curL2);
        if (!cl || !cl.labels) return;
        // Snapshot the labels so subsequent K-means cache invalidations
        // don't change them
        state.lockedLabels = new Int8Array(cl.labels);
        state.lockedRefL2 = curL2;
      }
      refreshLockBtn();
      refreshCandidateUI(state);   // enable/disable the promote button
      drawPCA(state);
      renderL3Panel(state);
      // v3.99 turn 14d ask 2: also redraw the per-sample lines panel so the
      // tracked-sample colors update immediately when the user locks/unlocks
      // bands.
      drawLinesPanel(state);
    });
    // Initial label sync at mount (legacy rule 7).
    refreshLockBtn();
  }

  // --- #promoteCandidateBtn click — legacy lines 56738-56758 ---
  // makeCandidateFromLock (legacy 57533) + setCandidate (legacy 57562) live
  // in ./candidates.js. The candidate_focus install path is fail-soft when running
  // under the new shell where candidate_focus may not be mounted.
  const promoteBtn = $('promoteCandidateBtn');
  if (promoteBtn) {
    promoteBtn.addEventListener('click', () => {
      const cand = makeCandidateFromLock(state);
      if (!cand) {
        alert('Lock colors on an L2 first (🔒 button above), then click promote.');
        return;
      }
      // v4 turn 7 ask 2: green-flash the button to confirm the action was
      // accepted. Guarded — legacy helper, may or may not be loaded.
      if (typeof _flashPromoteGreen === 'function') {
        try { _flashPromoteGreen(promoteBtn); } catch (_) {}
      }
      // 2026-05-19: install the candidate FIRST, then navigate. The old
      // code twiddled #tabBar / .page.active (atlas-core has neither),
      // wrapped setCandidate in rAF, and hoped the DOM would re-resolve
      // — under the new shell the rAF fired against the still-active
      // local_pca_dosage DOM, not candidate_focus's. New flow:
      //   1. setCandidate on the current page's state so the candidate
      //      list / promote chain runs in its proper home;
      //   2. hash-navigate to candidate_focus so the router mounts it
      //      against fresh DOM with the candidate already in state.
      try { setCandidate(state, cand); }
      catch (e) { console.warn('[promote] setCandidate failed:', e); }
      try { window.location.hash = '#/inversion/candidate_focus'; } catch (_) {}
    });
  }

  // --- #openDosageHeatmapBtn click (2026-05-18, rewired 2026-05-19) ---
  // Quick jump from local_pca_dosage to the dosage_heatmap page for the
  // active candidate. The dosage_heatmap page reads its rich payload
  // from atlasState.inversion.dosage_heatmap_state.
  //
  // 2026-05-19 — the prior version relied on the LEGACY tab bar's DOM
  // (#tabBar + .page elements) which doesn't exist under atlas-core.
  // Clicking did nothing — the page never navigated. New flow:
  //   1. fetch a dosage chunk covering the candidate's bp span via
  //      the same /api/dosage/chunk endpoint the lines panel uses
  //   2. stash it on inv.dosage_heatmap_state as `legacy_chunk` (the
  //      adapter the page already understands)
  //   3. navigate by setting window.location.hash — the router picks
  //      it up and mounts dosage_heatmap.
  const dhBtn = $('openDosageHeatmapBtn');
  if (dhBtn) {
    const _syncDhBtnEnabled = () => { dhBtn.disabled = !state.candidate; };
    _syncDhBtnEnabled();
    dhBtn.addEventListener('click', async () => {
      const cand = state.candidate;
      if (!cand) {
        alert('Focus a candidate first (promote one above, or pick from the saved list).');
        return;
      }
      const chrom = (state.data && state.data.chrom) || cand.chrom;
      // Bp span: prefer the candidate's own start/end; fall back to its
      // start_w/end_w mapped to the window centres if absent.
      let startBp = Number.isFinite(cand.start_bp) ? cand.start_bp : null;
      let endBp   = Number.isFinite(cand.end_bp)   ? cand.end_bp   : null;
      const wins  = state.data && state.data.windows;
      if ((startBp == null || endBp == null) && wins && Array.isArray(wins)) {
        const ws = Number.isFinite(cand.start_w) ? cand.start_w | 0 : 0;
        const we = Number.isFinite(cand.end_w)   ? cand.end_w   | 0 : wins.length - 1;
        const w0 = wins[Math.max(0, Math.min(wins.length - 1, ws))];
        const w1 = wins[Math.max(0, Math.min(wins.length - 1, we))];
        if (w0 && w1) {
          if (startBp == null) startBp = w0.start_bp != null ? w0.start_bp : w0.center_bp;
          if (endBp   == null) endBp   = w1.end_bp   != null ? w1.end_bp   : w1.center_bp;
        }
      }
      // Stash candidate label + a placeholder so the page mount can
      // render the header even while the chunk fetch is in flight.
      if (typeof window !== 'undefined' && window.atlasState) {
        const inv = window.atlasState.inversion || (window.atlasState.inversion = {});
        const prev = inv.dosage_heatmap_state || {};
        inv.dosage_heatmap_state = Object.assign({}, prev, {
          candidate_label: cand.label || cand.id || null,
        });
      }
      // Fire the fetch BEFORE navigating so the data lands on the inv
      // bucket the next mount reads. If it fails, the page still mounts
      // and shows its empty state. Re-uses the templated URL from the
      // synthetic dosage_chunks layer so we don't have to know the
      // server's host/port here.
      try {
        const dc = state.data && state.data.dosage_chunks;
        const template = dc && Array.isArray(dc.chunks) && dc.chunks[0] && (dc.chunks[0].url || dc._endpoint);
        if (template && Number.isFinite(startBp) && Number.isFinite(endBp) && chrom) {
          const cap = (dc.cap_default | 0) || 1000;
          const url = template
            .replace('__CHROM__', encodeURIComponent(chrom))
            .replace('__START__', String(startBp | 0))
            .replace('__END__',   String(endBp | 0))
            .replace('__CAP__',   String(cap));
          const r = await fetch(url);
          if (r.ok) {
            const chunk = await r.json();
            if (typeof window !== 'undefined' && window.atlasState) {
              const inv = window.atlasState.inversion;
              inv.dosage_heatmap_state = Object.assign({}, inv.dosage_heatmap_state, {
                legacy_chunk: chunk,
              });
            }
          } else {
            console.warn('open dosage heatmap: chunk fetch HTTP', r.status, url);
          }
        }
      } catch (e) {
        console.warn('open dosage heatmap: chunk fetch failed:', e);
      }
      // Navigate via the router's hash-based URL contract.
      try {
        window.location.hash = '#/inversion/dosage_heatmap';
      } catch (_) {}
    });
    // Expose so other code paths (promoteCandidate, candidate-list
    // selection) can re-sync the disabled state when state.candidate
    // changes. Idempotent.
    if (typeof window !== 'undefined') window._syncDosageHeatmapBtnEnabled = _syncDhBtnEnabled;
  }

  // --- #exportKLabelsBtn click — legacy lines 66189-66209 ---
  // buildKLabelsTSV (legacy 66147) lives in ./candidates.js (it's
  // candidate-adjacent — produces the per-(L2, sample) K-means label
  // matrix the C++ pop-stats engine groups against).
  const exportKBtn = $('exportKLabelsBtn');
  if (exportKBtn) {
    exportKBtn.addEventListener('click', () => {
      try { exportKLabelsTSV(state); }
      catch (e) { console.warn('[exportKLabels] failed:', e); }
    });
  }

  // --- #trailOn change — legacy lines 66805 ---
  const trailOn = $('trailOn');
  if (trailOn) {
    trailOn.checked = !!state.trailOn;
    trailOn.addEventListener('change', e => {
      state.trailOn = e.target.checked;
      drawPCA(state);
    });
  }

  // --- #flipPC1 change — legacy lines 66806-66810 ---
  const flipPC1 = $('flipPC1');
  if (flipPC1) {
    flipPC1.checked = !!state.flipPC1;
    flipPC1.addEventListener('change', e => {
      state.flipPC1 = e.target.checked;
      state.l2GroupCache = null; state.cacheKey = null;
      drawPCA(state); renderL3Panel(state);
    });
  }

  // --- #trailN input — legacy lines 66811-66815 ---
  const trailN = $('trailN');
  if (trailN) {
    if (state.trailN != null && isFinite(state.trailN)) {
      trailN.value = String(state.trailN);
      const lbl = $('trailNVal');
      if (lbl) lbl.textContent = String(state.trailN);
    }
    trailN.addEventListener('input', e => {
      state.trailN = +e.target.value;
      $('trailNVal').textContent = state.trailN;
      drawPCA(state);
    });
  }
}

// =============================================================================
// Tracked samples
// =============================================================================

function _wireTrackedSamples(state) {
  // --- #trackedN input — legacy lines 66210-66220 ---
  const trackedN = $('trackedN');
  if (trackedN) {
    if (state.trackedN != null && isFinite(state.trackedN)) {
      trackedN.value = String(state.trackedN);
      const lbl = $('trackedNVal');
      if (lbl) lbl.textContent = String(state.trackedN);
    }
    trackedN.addEventListener('input', e => {
      state.trackedN = +e.target.value;
      $('trackedNVal').textContent = state.trackedN;
      // Trim if currently over the new cap
      if (state.tracked.length > state.trackedN) {
        state.tracked = state.tracked.slice(0, state.trackedN);
      }
      renderTrackedList(state);
      drawPCA(state);
      renderL3Panel(state);
    });
  }

  // --- #bandPickBar button click — legacy lines 55899-55907 ---
  document.querySelectorAll('#bandPickBar button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#bandPickBar button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const v = btn.dataset.band;
      if (v === 'all') pickFromFocalBand(state, 'all');
      else pickFromFocalBand(state, parseInt(v, 10));
    });
  });

  // --- #autoPickRadial click — legacy line 55908 ---
  // The sidebar's autoPickRadial button — distinct from the PCA-aside
  // copies (autoPickRadialAside, autoPickRadialCompact, autoPickRadialCompact2)
  // which are out of scope for the local_pca_dosage SIDEBAR wiring surface.
  // Bridge import (_autoPickRadialBridge) is aliased from pca_panel.js at
  // the top of this file to disambiguate from no-op shadowing.
  const autoPick = $('autoPickRadial');
  if (autoPick) {
    autoPick.addEventListener('click', () => {
      _autoPickRadialBridge(state, state.trackedN);
    });
  }

  // --- #clearPicks click — legacy line 55909 ---
  const clearPicksBtn = $('clearPicks');
  if (clearPicksBtn) {
    clearPicksBtn.addEventListener('click', () => clearPicks(state));
  }
}

// =============================================================================
// Manual groups
// =============================================================================

function _wireManualGroups(state) {
  // --- manual-groups click/blur/keydown delegation ---
  // 2026-05-18: dual-write mirror parity. renderManualGroupsList fills
  // THREE containers (#manualGroupsList sidebar, #manualGroupsListCompact
  // compact panel, #manualGroupsListPopup G-panel manual tab). Only the
  // sidebar had its event delegation wired — so in compact mode (now
  // the default) and in the G-panel modal, clicking ✕ to delete a
  // group did nothing. User-reported chat 2026-05-18: "when we push
  // the 'remove the group' button ... nothing happens".
  //
  // Each container gets the SAME set of handlers; idempotent via
  // dataset.wired.
  const listIds = ['manualGroupsList', 'manualGroupsListCompact', 'manualGroupsListPopup'];
  for (const id of listIds) {
    const list = $(id);
    if (!list || list.dataset.wired === '1') continue;
    list.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || !t.dataset || !t.dataset.mgid) return;
      const id = t.dataset.mgid;
      if (t.classList.contains('mg-pin')) {
        toggleManualGroupScope(id);
      } else if (t.classList.contains('mg-del')) {
        const g = (state.manualGroups || []).find(x => x.id === id);
        if (g && confirm(`Delete group "${g.name}" (n=${g.members.length})?`)) {
          removeManualGroup(id);
        }
      }
    });
    // Inline rename via contenteditable on .mg-name. Commit on blur or Enter.
    list.addEventListener('blur', (e) => {
      const t = e.target;
      if (!t || !t.classList || !t.classList.contains('mg-name')) return;
      const id = t.dataset.mgid;
      const newName = (t.textContent || '').trim();
      if (id && newName) {
        renameManualGroup(id, newName);
      }
    }, true);   // capture (blur doesn't bubble)
    list.addEventListener('keydown', (e) => {
      const t = e.target;
      if (!t || !t.classList || !t.classList.contains('mg-name')) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        t.blur();   // triggers the blur handler above
      } else if (e.key === 'Escape') {
        e.preventDefault();
        // Restore from state
        const id = t.dataset.mgid;
        const g = (state.manualGroups || []).find(x => x.id === id);
        if (g) t.textContent = g.name;
        t.blur();
      }
    });
    list.dataset.wired = '1';
  }

  // --- #mgAddBtn click — legacy lines 56584-56587 ---
  const addBtn = $('mgAddBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => { manualGroupFromTracked(); });
  }

  // --- #mgBandPickBar button click — legacy lines 56589-56594 ---
  document.querySelectorAll('#mgBandPickBar button').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = parseInt(btn.dataset.mgband, 10);
      if (!isFinite(k)) return;
      manualGroupFromBand(k);
    });
  });

  // --- #mgExportBtn / #mgImportBtn / #mgImportFile — legacy lines 56596-56615 ---
  const expBtn = $('mgExportBtn');
  if (expBtn) {
    expBtn.addEventListener('click', () => { exportManualGroupsTSV(); });
  }
  const impBtn = $('mgImportBtn');
  const impFile = $('mgImportFile');
  if (impBtn && impFile) {
    impBtn.addEventListener('click', () => impFile.click());
    impFile.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try { importManualGroupsTSV(String(ev.target.result || '')); }
        catch (err) { alert('Failed to import TSV: ' + err.message); }
      };
      reader.readAsText(f);
      // Reset so the same file re-imports if picked again
      e.target.value = '';
    });
  }

  // --- #mgClearAllBtn click — legacy lines 56617-56624 ---
  const clrBtn = $('mgClearAllBtn');
  if (clrBtn) {
    clrBtn.addEventListener('click', () => {
      const groups = state.manualGroups || [];
      if (groups.length === 0) return;
      if (confirm(`Clear all ${groups.length} manual groups? Per-chrom AND cohort. This cannot be undone unless you exported a TSV.`)) {
        clearAllManualGroups();
      }
    });
  }
}

// =============================================================================
// Jump
// =============================================================================

// Step-mode label table — legacy lines 66252-66258 ---
const _STEP_MODE_LABELS = {
  l2:    '←/→ jump between L2 envelopes · Shift+arrow = 20-window skip',
  win1:  '←/→ step 1 window · Shift+arrow = 20-window skip',
  win5:  '←/→ step 5 windows (refine slab default) · Shift+arrow = 20-window skip',
  win10: '←/→ step 10 windows · Shift+arrow = 20-window skip',
  winN:  null,    // computed at render time — see _stepModeLabel()
};
function _stepModeLabel(state, mode) {
  if (mode !== 'winN') return _STEP_MODE_LABELS[mode] || '';
  // When sync is on, the active N is whichever side was last touched —
  // compareUnitN if L3 was the source, stepModeN if sidebar was. Because
  // sync mirrors them, they're identical, so we read whichever is set.
  const n = state.stepModeSync
    ? Math.max(1, (state.compareUnitN | 0) || (state.stepModeN | 0) || 1)
    : Math.max(1, (state.stepModeN | 0) || 1);
  const sync = state.stepModeSync ? ' · synced with L3 N' : '';
  return `←/→ step ${n} windows${sync} · Shift+arrow = 20-window skip`;
}

// Sidebar → L3 sync (legacy lines 66272-66294). Called by the sidebar
// stepMode handlers when state.stepModeSync is on.
function _syncStepModeToCompareUnit(state) {
  if (!state.stepModeSync) return;
  // Map stepMode -> compareUnit
  const mapToCompare = { l2: 'L2', win1: 'win1', win5: 'win5', win10: 'win10', winN: 'winN' };
  const newCompare = mapToCompare[state.stepMode];
  if (newCompare && newCompare !== state.compareUnit) {
    state.compareUnit = newCompare;
    document.querySelectorAll('#l3CompareUnit button').forEach(b =>
      b.classList.toggle('active', b.dataset.l3unit === newCompare));
    try { localStorage.setItem('pca_scrubber_v3.compareunit', newCompare); } catch (_) {}
  }
  // Mirror N value into compareUnitN if winN
  if (state.stepMode === 'winN') {
    const n = Math.max(1, state.stepModeN | 0);
    if (n !== state.compareUnitN) {
      state.compareUnitN = n;
      const cuInput = document.getElementById('l3CompareUnitN');
      if (cuInput) cuInput.value = String(n);
    }
  }
  renderL3Panel(state);
}

function _wireJump(state) {
  // --- #jumpBtn click — legacy line 66221 ---
  const jumpBtn = $('jumpBtn');
  if (jumpBtn) {
    jumpBtn.addEventListener('click', () => jumpToValue(state));
  }

  // --- #jumpVal keydown — legacy line 66222 ---
  const jumpVal = $('jumpVal');
  if (jumpVal) {
    jumpVal.addEventListener('keydown', e => {
      if (e.key === 'Enter') jumpToValue(state);
    });
  }

  // --- #jumpUnit change — legacy lines 66223-66228 ---
  const jumpUnit = $('jumpUnit');
  if (jumpUnit) {
    jumpUnit.addEventListener('change', () => {
      // Update placeholder
      const unit = $('jumpUnit').value;
      const ph = unit === 'mb' ? 'Mb' : (unit === 'win' ? 'window (1-based)' : 'bp');
      $('jumpVal').placeholder = ph;
    });
  }

  // --- #jumpToL2 / #jumpPrevL2 / #jumpToL1 / #jumpPrevL1 — legacy lines 66229-66232 ---
  const j2N = $('jumpToL2');   if (j2N) j2N.addEventListener('click', () => jumpL2(state, +1));
  const j2P = $('jumpPrevL2'); if (j2P) j2P.addEventListener('click', () => jumpL2(state, -1));
  const j1N = $('jumpToL1');   if (j1N) j1N.addEventListener('click', () => jumpL1(state, +1));
  const j1P = $('jumpPrevL1'); if (j1P) j1P.addEventListener('click', () => jumpL1(state, -1));

  // --- #travelModeBar button click — legacy lines 66235-66247 ---
  document.querySelectorAll('#travelModeBar button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#travelModeBar button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.travelMode = btn.dataset.mode;
      const info = document.getElementById('travelModeInfo');
      if (info) {
        info.textContent = state.travelMode === 'L1'
          ? 'n/p jump between L1 zones'
          : 'n/p jump between L2 envelopes';
      }
    });
  });

  // --- #l3CompareUnit button click (2026-05-18 wire gap fix) ---
  // The L3 toolbar's L2/1w/5w/10w/Nw buttons had a sync hook from the
  // sidebar's #stepModeBar (_syncStepModeToCompareUnit) but no click
  // handler of their own — clicking L2/1w/5w/10w/Nw did nothing.
  // User-reported chat 2026-05-18: "the L2 1w 5w 10w and Nw buttons
  // don't work. when we click nothing happens."
  document.querySelectorAll('#l3CompareUnit button[data-l3unit]').forEach(btn => {
    if (btn.dataset.wired === '1') return;
    btn.addEventListener('click', () => {
      const want = btn.dataset.l3unit;
      if (!want) return;
      document.querySelectorAll('#l3CompareUnit button[data-l3unit]').forEach(b =>
        b.classList.toggle('active', b.dataset.l3unit === want));
      state.compareUnit = want;
      try { localStorage.setItem('pca_scrubber_v3.compareunit', want); } catch (_) {}
      // Reverse-sync to #stepModeBar so the sidebar shows the same
      // resolution when stepModeSync is on.
      if (state.stepModeSync) {
        const mapToStep = { L2: 'l2', win1: 'win1', win5: 'win5', win10: 'win10', winN: 'winN' };
        const newStep = mapToStep[want];
        if (newStep && newStep !== state.stepMode) {
          state.stepMode = newStep;
          document.querySelectorAll('#stepModeBar button').forEach(b =>
            b.classList.toggle('active', b.dataset.step === newStep));
          try { localStorage.setItem('pca_scrubber_v3.stepmode', newStep); } catch (_) {}
          const info = document.getElementById('stepModeInfo');
          if (info) info.textContent = _stepModeLabel(state, newStep);
          if (typeof _refreshStepSizeBtn === 'function') {
            try { _refreshStepSizeBtn(); } catch (_) {}
          }
        }
      }
      try { renderL3Panel(state); } catch (e) {
        console.warn('[l3CompareUnit] renderL3Panel:', e);
      }
    });
    btn.dataset.wired = '1';
  });
  // The matching N-value input next to the Nw button.
  const l3UnitN = $('l3CompareUnitN');
  if (l3UnitN && l3UnitN.dataset.wired !== '1') {
    l3UnitN.addEventListener('input', (e) => {
      const v = parseInt(e.target.value, 10);
      if (!Number.isFinite(v) || v < 1) return;
      state.compareUnitN = v;
      try { localStorage.setItem('pca_scrubber_v3.compareunitn', String(v)); } catch (_) {}
      // Mirror to sidebar stepModeN when sync is on.
      if (state.stepModeSync) {
        state.stepModeN = v;
        const sin = document.getElementById('stepModeNInput');
        if (sin) sin.value = String(v);
      }
      if (state.compareUnit === 'winN') {
        try { renderL3Panel(state); } catch (_) {}
      }
    });
    l3UnitN.dataset.wired = '1';
  }

  // --- #stepModeBar button click — legacy lines 66323-66341 ---
  document.querySelectorAll('#stepModeBar button').forEach(btn => {
    btn.addEventListener('click', () => {
      const newMode = btn.dataset.step;
      if (!(newMode in _STEP_MODE_LABELS)) return;
      document.querySelectorAll('#stepModeBar button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.stepMode = newMode;
      const info = document.getElementById('stepModeInfo');
      if (info) info.textContent = _stepModeLabel(state, newMode);
      try { localStorage.setItem('pca_scrubber_v3.stepmode', newMode); } catch (e) {}
      // Sync the L3 toolbar if enabled
      _syncStepModeToCompareUnit(state);
      // turn 128: also refresh the header cycler so its text + lit state
      // reflect the new mode immediately.
      if (typeof _refreshStepSizeBtn === 'function') {
        try { _refreshStepSizeBtn(); } catch (_) {}
      }
    });
  });

  // --- #stepModeNInput input — legacy lines 66343-66366 ---
  const stepModeNInput = $('stepModeNInput');
  if (stepModeNInput) {
    stepModeNInput.addEventListener('click', e => e.stopPropagation());
    stepModeNInput.addEventListener('input', e => {
      e.stopPropagation();
      const v = parseInt(stepModeNInput.value, 10);
      if (isFinite(v) && v >= 1 && v <= 200) {
        state.stepModeN = v;
        try { localStorage.setItem('pca_scrubber_v3.stepmoden', String(v)); } catch (_) {}
        // Refresh label if winN active
        if (state.stepMode === 'winN') {
          const info = document.getElementById('stepModeInfo');
          if (info) info.textContent = _stepModeLabel(state, 'winN');
        }
        // Sync the L3 toolbar
        _syncStepModeToCompareUnit(state);
        // turn 147 — refresh the header cycler so the "(N)" label reflects
        // the new custom value immediately.
        if (typeof _refreshStepSizeBtn === 'function') {
          try { _refreshStepSizeBtn(); } catch (_) {}
        }
      }
    });
  }

  // --- #stepModeSync change — legacy lines 66368-66382 ---
  const stepModeSync = $('stepModeSync');
  if (stepModeSync) {
    stepModeSync.addEventListener('change', () => {
      state.stepModeSync = !!stepModeSync.checked;
      try { localStorage.setItem('pca_scrubber_v3.stepmodesync',
                                  state.stepModeSync ? '1' : '0'); } catch (_) {}
      // If turning sync ON, immediately reconcile the two by pushing sidebar -> L3
      if (state.stepModeSync) _syncStepModeToCompareUnit(state);
      // Refresh label (it shows " · synced with L3 N" suffix)
      if (state.stepMode === 'winN') {
        const info = document.getElementById('stepModeInfo');
        if (info) info.textContent = _stepModeLabel(state, 'winN');
      }
    });
  }

  // Initial label sync (legacy rule 7). The legacy file resolves the
  // step-mode info text from a stored preference at script-load — see
  // legacy line 66400-66403 (the try/catch block that ran at the end of
  // the wire-up section). Replicate that here so the UI matches state on
  // mount.
  try {
    const info = document.getElementById('stepModeInfo');
    if (info && state.stepMode) info.textContent = _stepModeLabel(state, state.stepMode);
  } catch (e) {}
}

// =============================================================================
// Sidebar toggle
// =============================================================================

// Legacy applySidebarState (lines 75431-75462) reaches into drawSim, drawZ,
// drawTracks, drawPCA, renderL3Panel + the panel-reorder widget. The shell
// owns the panel-reorder widget. We preserve the localStorage key + the
// canvas-fit redraw, and drop the widget-reposition (out of scope).
const _SIDEBAR_STORAGE_KEY = 'pca_scrubber_v3.sidebar_collapsed';

function _applySidebarState(state, collapsed) {
  const wrap = (typeof document !== 'undefined') ? document.querySelector('.wrap') : null;
  const btn = (typeof document !== 'undefined') ? document.getElementById('sidebarToggleBtn') : null;
  if (wrap && typeof wrap.setAttribute === 'function') {
    if (collapsed) wrap.setAttribute('data-sidebar', 'collapsed');
    else if (typeof wrap.removeAttribute === 'function') wrap.removeAttribute('data-sidebar');
  }
  if (btn) btn.textContent = collapsed ? '›' : '‹';
  if (btn) btn.title = collapsed ? 'Expand the parameters pane' : 'Collapse the parameters pane';
  // Re-fit canvases after the resize transition (190ms; we wait 220ms to be safe).
  // Legacy at this point also calls drawTracks, _repositionPanelReorderInGutter;
  // drawTracks lives in events.js (imported via setCur fan-out) — call it
  // explicitly here for verbatim parity. The reorder-widget reposition
  // call is out of scope (lives in atlas-core shell now).
  if (state.data && typeof setTimeout === 'function') {
    setTimeout(() => {
      try { drawSim(state); } catch (e) {}
      try { drawZ(state); } catch (e) {}
      try { drawTracks(state); } catch (e) {}
      try { drawPCA(state); } catch (e) {}
      try { renderL3Panel(state); } catch (e) {}
    }, 220);
  }
}

function _wireSidebarToggle(state) {
  // 2026-05-20: default-collapse the parameters pane on first load. The
  // sidebar carries 20+ controls but most users land on the page wanting
  // to see the canvases, not the knobs (Quentin: "close the settings
  // panel on the left ... too messy"). The wheel button on the sidebar
  // header stays as the toggle. Returning users get whatever they last
  // saved — only the unset / fresh-install case flips to collapsed.
  let savedCollapsed = true;
  try {
    const v = localStorage.getItem(_SIDEBAR_STORAGE_KEY);
    if (v === 'false') savedCollapsed = false;
    else if (v === 'true') savedCollapsed = true;
    // null / undefined → keep the new default (true).
  } catch (e) {}
  _applySidebarState(state, savedCollapsed);

  // --- #sidebarToggleBtn click — legacy lines 75473-75480 ---
  const btn = $('sidebarToggleBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      const wrap = document.querySelector('.wrap');
      const isCollapsed = wrap && wrap.getAttribute('data-sidebar') === 'collapsed';
      const next = !isCollapsed;
      try { localStorage.setItem(_SIDEBAR_STORAGE_KEY, String(next)); } catch (e) {}
      _applySidebarState(state, next);
    });
  }
}
