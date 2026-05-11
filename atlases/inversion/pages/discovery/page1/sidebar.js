// pages/discovery/page1/sidebar.js
//
// Wires every page1 aside control (sidebar #fileInput .. #jumpPrevL1)
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

import { _setActiveState } from './_state.js';
import { getL2Cluster } from './_data.js';
import { drawSim } from './sim_panel.js';
import { drawZ } from './z_panel.js';
import { drawLinesPanel } from './lines_panel.js';
import {
  autoPickRadial as _autoPickRadialBridge,
  drawAnchorStrip,
  drawPCA,
  recomputeAnchorConcord,
  renderTrackedList,
} from './pca_panel.js';
import { renderL3Panel } from './l3_panel.js';
import { refreshBandPickBar, refreshCandidateUI } from './candidates.js';
import {
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
import {
  buildKLabelsTSV,
  exportKLabelsTSV,
  makeCandidateFromLock,
  setCandidate,
} from './candidates.js';

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
  // Redraw — fitCanvas re-measures the new heights.
  requestAnimationFrame(() => {
    try { drawSim(state); }        catch (_) {}
    try { drawZ(state); }          catch (_) {}
    try { drawLinesPanel(state); } catch (_) {}
    try { drawPCA(state); }        catch (_) {}
    try { drawTracks(state); }     catch (_) {}
    try { renderL3Panel(state); }  catch (_) {}
  });
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
  // persists. Drops the slide animation and the applyMainGrid call (the
  // body attribute is sufficient to drive the CSS in the new shell).
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
    // Redraw the panels whose canvas sizes changed.
    try { drawSim(state); }   catch (_) {}
    try { drawZ(state); }     catch (_) {}
    try { drawLinesPanel(state); } catch (_) {}
    try { drawPCA(state); }   catch (_) {}
    try { renderL3Panel(state); }  catch (_) {}
  };
  if (moveBtn)    moveBtn.addEventListener('click', () => _setSimInMinimap(true));
  if (restoreBtn) restoreBtn.addEventListener('click', () => _setSimInMinimap(false));
  // Restore persisted state on first wire-up.
  try {
    if (localStorage.getItem('pca_scrubber_v3.siminminimap') === '1') {
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
      if (typeof recomputeAnchorConcord === 'function') {
        try { recomputeAnchorConcord(); } catch (_) {}
      }
      drawPCA(state); renderZoneBlock(state); renderL3Panel(state);
      if (typeof drawAnchorStrip === 'function') {
        try { drawAnchorStrip(state); } catch (_) {}
      }
      // v3.71: K change → anchor reset → badge needs refresh
      if (typeof _updateConcordBadge === 'function') {
        try { _updateConcordBadge(); } catch (_) {}
      }
    });
  }

  // --- #aggMethod change — legacy lines 66441-66445 ---
  const aggMethod = $('aggMethod');
  if (aggMethod) {
    aggMethod.addEventListener('change', e => {
      state.aggMethod = e.target.value;
      state.l2GroupCache = null; state.cacheKey = null;
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
  // --- #colorModeBar button click — legacy lines 66470-66493 ---
  document.querySelectorAll('#colorModeBar button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      document.querySelectorAll('#colorModeBar button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.colorMode = btn.dataset.mode;
      state.colorByL2 = (state.colorMode === 'cluster');   // legacy alias
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
      renderL3Panel(state);
    });
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
  // in ./candidates.js. The page2 install path is fail-soft when running
  // under the new shell where page2 may not be mounted.
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
      // Switch to page 2 FIRST so the canvas has non-zero bounding rect.
      // Under the new atlas-core shell the tabBar may not exist; we
      // tolerate a missing DOM and just install the candidate.
      document.querySelectorAll('#tabBar button').forEach(b => b.classList.remove('active'));
      const p2Btn = document.querySelector('#tabBar button[data-page="page2"]');
      if (p2Btn) p2Btn.classList.add('active');
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      const p2 = document.getElementById('page2');
      if (p2) p2.classList.add('active');
      // Now install the candidate (this triggers render + drawCandidateSigmaChart)
      const _setCand = () => {
        try { setCandidate(state, cand); }
        catch (e) { console.warn('[promote] setCandidate failed:', e); }
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(_setCand);
      else _setCand();
    });
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
  // which are out of scope for the page1 SIDEBAR wiring surface.
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
  // --- #manualGroupsList delegation — legacy lines 56626-56664 ---
  // Wires click (pin/delete), blur (rename), keydown (enter/escape) on the
  // sidebar list. The helpers (toggleManualGroupScope, removeManualGroup,
  // renameManualGroup) live in ./manual_groups.js.
  const list = $('manualGroupsList');
  if (list) {
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
  const wrap = (typeof document !== 'undefined') ? document.getElementById('appWrap') : null;
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
  // Restore saved sidebar state on load (default: expanded)
  // --- legacy lines 75465-75471 ---
  let savedCollapsed = false;
  try {
    const v = localStorage.getItem(_SIDEBAR_STORAGE_KEY);
    if (v === 'true') savedCollapsed = true;
  } catch (e) {}
  _applySidebarState(state, savedCollapsed);

  // --- #sidebarToggleBtn click — legacy lines 75473-75480 ---
  const btn = $('sidebarToggleBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      const wrap = document.getElementById('appWrap');
      const isCollapsed = wrap && wrap.getAttribute('data-sidebar') === 'collapsed';
      const next = !isCollapsed;
      try { localStorage.setItem(_SIDEBAR_STORAGE_KEY, String(next)); } catch (e) {}
      _applySidebarState(state, next);
    });
  }
}
