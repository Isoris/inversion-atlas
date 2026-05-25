// pages/discovery/local_pca_dosage/panel_resize.js
//
// Panel resize handles — drag the bottom edge of sim / Z / lines / PCA / L3
// to adjust panel heights. Verbatim port from legacy
// Inversion_atlas.html lines 66824-67460 (subset: fixed-mode only).
//
// Each handle:
//   - pointerdown captures start position + current panel height
//   - pointermove updates state.<panel>H and rebuilds main#local_pca_dosage's
//     grid-template-rows via applyMainGrid
//   - pointerup releases the capture
//   - dblclick resets to the default height
//
// Compact / free layout modes bypass this — their grid templates are
// fully CSS-driven and the handles are hidden via CSS rule on
// body[data-layout-mode="compact"] in inversion.css.
//
// State slots used (initialised in _buildLegacyState defaults):
//   state.simPanelH    (default 520)
//   state.zPanelH      (default 100)
//   state.linesPanelH  (default 200)
//   state.pcaPanelH    (default 280)
//   state.l3PanelH     (default 360)
//   state.zCollapsed   (boolean — when true, Z row is 50px regardless)

import { _setActiveState } from './_state.js';
import { drawSim, drawSimMini } from './sim_panel.js';
import { drawZ } from './z_panel.js';
import { drawLinesPanel } from './lines_panel.js';
import { drawPCA, drawAnchorStrip } from './pca_panel.js';
import { renderL3Panel } from './l3_panel.js';
import { drawTracks } from './events.js';
import { persistDebounced } from '../../../shared/persist_debounced.js';

const DEFAULTS = {
  simPanelH:   520,
  zPanelH:     100,
  linesPanelH: 200,
  pcaPanelH:   280,
  l3PanelH:    360,
  // Default for #pcaTrackedAside flex-basis (fixed-mode horizontal split with
  // #pcaCanvasWrap). Matches the inline `flex: 0 0 30%` in the HTML — the
  // value is read at first drag and persisted from then on.
  pcaAsideWPct:        30,
  // CSS-variable defaults for compact-mode handles. Mirror the values in
  // inversion.css `body[data-layout-mode="compact"] main#local_pca_dosage`.
  compactLeftPct:      50,    // --compact-leftpct
  compactLeftUpperPct: 75,    // --compact-leftupperpct
  compactL3Fr:         1.4,   // --compact-l3fr (fr units)
};

const LS_KEY = {
  simPanelH:   'pca_scrubber_v3.simPanelH',
  zPanelH:     'pca_scrubber_v3.zPanelH',
  linesPanelH: 'pca_scrubber_v3.linesPanelH',
  pcaPanelH:   'pca_scrubber_v3.pcaPanelH',
  l3PanelH:    'pca_scrubber_v3.l3PanelH',
  pcaAsideWPct:        'pca_scrubber_v3.pcaAsideWPct',
  compactLeftPct:      'pca_scrubber_v3.compactLeftPct',
  compactLeftUpperPct: 'pca_scrubber_v3.compactLeftUpperPct',
  compactL3Fr:         'pca_scrubber_v3.compactL3Fr',
};

function _redrawAllPanels(state) {
  if (!state || !state.data) return;
  requestAnimationFrame(() => {
    try { drawSim(state); }        catch (_) {}
    try { drawSimMini(state); }    catch (_) {}
    try { drawZ(state); }          catch (_) {}
    try { drawTracks(state); }     catch (_) {}
    try { drawLinesPanel(state); } catch (_) {}
    try { drawPCA(state); }        catch (_) {}
    try { drawAnchorStrip(state); } catch (_) {}
    try { renderL3Panel(state); }  catch (_) {}
  });
}

// Build the grid-template-rows for main#local_pca_dosage from current state. Only
// applies in fixed mode — compact / free have their own CSS-driven rules.
//
// CSS Grid auto-placement assigns ONLY visible elements (display:none
// items are skipped entirely). So the row template must match the
// number of visible items in document order or rows will line up
// wrong — e.g. anchorStripPanel landing in the 0px linesPanel slot,
// or pcaPanel inheriting the 28px anchor slot after sim moves to
// minimap. Build the template dynamically from visibility.
//
// Visible elements in document order (children of main#local_pca_dosage):
//   1. ctrlBar              (always)             40px
//   2. simPanel             (hidden in minimap)  state.simPanelH
//   3. zPanel               (always)             state.zPanelH (or 50 collapsed)
//   4. tracksContainer      (always)             auto
//   5. linesPanel           (display:none by default) state.linesPanelH when visible
//   6. anchorStripPanel     (always)             28px
//   7. pcaPanel             (via compactLeftStack display:contents) 1fr or fixed
//   8. l3Panel              (always)             360px or user-resized
function applyMainGrid(state) {
  const main = document.getElementById('local_pca_dosage');
  if (!main) return;
  const mode = (document.body && document.body.dataset.layoutMode) || 'fixed';
  if (mode !== 'fixed') {
    main.style.gridTemplateRows = '';
    return;
  }
  const zH   = state.zCollapsed
               ? 50
               : Math.max(40, state.zPanelH | 0 || DEFAULTS.zPanelH);
  // Collapsed PCA = just the axis bar + a thin canvas (~32px). When the
  // user double-clicks the seam or clicks the ▼ button, l3 can grow to
  // fill the freed space.
  const pcaRow = state.pcaCollapsed
                 ? '32px'
                 : ((state._pcaPanelResized && state.pcaPanelH)
                    ? `${Math.max(60, state.pcaPanelH | 0)}px`
                    : '1fr');
  // Collapsed L3 = just the toolbar (~32px). PCA's 1fr grows into the
  // freed vertical space.
  const l3Row  = state.l3Collapsed
                 ? '32px'
                 : ((state._l3PanelResized && state.l3PanelH)
                    ? `${Math.max(60, state.l3PanelH | 0)}px`
                    : `${DEFAULTS.l3PanelH}px`);

  const simInMini  = document.body && document.body.dataset.simInMinimap === '1';
  const simEl      = main.querySelector('#simPanel');
  const linesEl    = main.querySelector('#linesPanel');
  const cusumEl    = main.querySelector('#cusumPanel');
  const simVisible = simEl && !simInMini && getComputedStyle(simEl).display !== 'none';
  const linesVisible = linesEl && getComputedStyle(linesEl).display !== 'none';
  const cusumVisible = cusumEl && getComputedStyle(cusumEl).display !== 'none';

  const rows = ['40px'];                                         // ctrlBar
  // Sim panel: ALWAYS emit a row so DOM-order grid placement keeps every
  // downstream panel at its correct row index. When sim is in the minimap
  // (or otherwise hidden) the row collapses to 0px — see inversion.css
  // `body[data-sim-in-minimap="1"] #simPanel` (v3.57 fix). Without this,
  // dropping the row entirely makes l3Panel fall off the explicit
  // gridTemplateRows into an implicit auto-row, so the freed sim_mat
  // height stays black instead of redistributing to pca + l3.
  rows.push(simVisible
    ? `${Math.max(60, state.simPanelH | 0 || DEFAULTS.simPanelH)}px`
    : '0px');
  rows.push(`${zH}px`);                                          // zPanel
  rows.push('auto');                                             // tracksContainer
  // CUSUM panel (2026-05-18): same 0px-when-hidden trick as sim + lines.
  // 70px when shown gives ~50px of plot room above + below the 0-baseline
  // for K=3 trajectories without crowding adjacent panels.
  rows.push(cusumVisible ? '70px' : '0px');                      // cusumPanel
  // Same reasoning for lines: keep the row, collapse to 0px when hidden,
  // so pcaPanel + l3Panel claim the rest of the column.
  rows.push(linesVisible
    ? `${Math.max(60, state.linesPanelH | 0 || DEFAULTS.linesPanelH)}px`
    : '0px');
  rows.push('28px');                                             // anchorStripPanel
  rows.push(pcaRow);                                             // pcaPanel
  rows.push(l3Row);                                              // l3Panel
  main.style.gridTemplateRows = rows.join(' ');
}

function _wireOne(state, handleId, stateKey, defaultH, minH) {
  const handle = document.getElementById(handleId);
  if (!handle) return;
  // pcaPanelH / l3PanelH start as defaults (PCA = 1fr semantics, L3 = 360);
  // tracking _<x>Resized flips when the user explicitly drags, switching
  // applyMainGrid to a fixed-px row for that panel.
  const resizedFlag = (stateKey === 'pcaPanelH') ? '_pcaPanelResized'
                    : (stateKey === 'l3PanelH')  ? '_l3PanelResized'
                    : null;
  let dragging = false, startY = 0, startH = 0;
  handle.addEventListener('pointerdown', e => {
    dragging = true;
    startY = e.clientY;
    startH = (state[stateKey] | 0) || defaultH;
    handle.classList.add('dragging');
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    const next = Math.max(minH, Math.min(1200, startH + (e.clientY - startY)));
    state[stateKey] = next;
    if (resizedFlag) state[resizedFlag] = true;
    persistDebounced(LS_KEY[stateKey], String(next));
    applyMainGrid(state);
  });
  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
    _redrawAllPanels(state);
  }
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
  handle.addEventListener('dblclick', () => {
    state[stateKey] = defaultH;
    if (resizedFlag) state[resizedFlag] = false;
    try { localStorage.removeItem(LS_KEY[stateKey]); } catch (_) {}
    applyMainGrid(state);
    _redrawAllPanels(state);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Horizontal flex-basis drag (fixed-mode pcaAsideResize seam).
//
// Geometry (see local_pca_dosage.html ~line 929-1037):
//   #pcaPanel  ┐
//     ├ #pcaCanvasWrap          flex: 1 1 70%   (scatter)
//     ├ #pcaAsideResize         flex: 0 0 4px   (this handle)
//     └ #pcaTrackedAside        flex: 0 0 30%   (tracked-samples settings)
//
// Drag right ⇒ shrink the aside; drag left ⇒ grow it. We store a *percent*
// of pcaPanel's width so the layout stays responsive when the window
// resizes. dblclick restores DEFAULTS.pcaAsideWPct.
//
// Bug history: v3.99 shipped the handle DOM + CSS hover-affordance but
// never wired pointerdown — drags did nothing. Fixed 2026-05-19.
// ─────────────────────────────────────────────────────────────────────────────
function _wireAsideHoriz(state) {
  const handle = document.getElementById('pcaAsideResize');
  const aside  = document.getElementById('pcaTrackedAside');
  const pane   = document.getElementById('pcaPanel');
  if (!handle || !aside || !pane) return;

  const applyPct = (pct) => {
    const p = Math.max(15, Math.min(60, pct));
    aside.style.flex = `0 0 ${p}%`;
    state.pcaAsideWPct = p;
  };

  // Restore on mount.
  if (Number.isFinite(state.pcaAsideWPct)) applyPct(state.pcaAsideWPct);

  let dragging = false, startX = 0, startPct = 0, paneW = 0;
  handle.addEventListener('pointerdown', e => {
    dragging = true;
    startX   = e.clientX;
    paneW    = pane.getBoundingClientRect().width || 1;
    startPct = Number.isFinite(state.pcaAsideWPct)
                 ? state.pcaAsideWPct
                 : ((aside.getBoundingClientRect().width / paneW) * 100) || DEFAULTS.pcaAsideWPct;
    handle.classList.add('dragging');
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    // Drag right = mouse +X = aside shrinks.
    const dxPct = ((e.clientX - startX) / paneW) * 100;
    const next  = startPct - dxPct;
    applyPct(next);
    persistDebounced(LS_KEY.pcaAsideWPct, String(state.pcaAsideWPct));
  });
  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
    _redrawAllPanels(state);
  }
  handle.addEventListener('pointerup',     endDrag);
  handle.addEventListener('pointercancel', endDrag);
  handle.addEventListener('dblclick', () => {
    applyPct(DEFAULTS.pcaAsideWPct);
    try { localStorage.removeItem(LS_KEY.pcaAsideWPct); } catch (_) {}
    _redrawAllPanels(state);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS-variable drag wirer for the 3 compact-mode seams.
//
//   compactColumnResize  → --compact-leftpct      (left vs right columns, ew-resize)
//   compactStackResize   → --compact-leftupperpct (PCA above vs tracked below, ns-resize)
//   compactL3Resize      → --compact-l3fr         (L3 row fraction, ns-resize)
//
// Same pointerdown / pointermove / pointerup / dblclick contract as the
// flex-basis fixed-mode helpers. Drags read from getComputedStyle and write
// back via setProperty on main#local_pca_dosage so the value is scoped to
// the page (not the global :root).
// ─────────────────────────────────────────────────────────────────────────────
function _wireCssVar(state, handleId, opts) {
  const handle = document.getElementById(handleId);
  const main   = document.getElementById('local_pca_dosage');
  if (!handle || !main) return;
  const { cssVar, stateKey, axis, defaultVal, minVal, maxVal, unit, sign = 1 } = opts;

  const apply = (val) => {
    const v = Math.max(minVal, Math.min(maxVal, val));
    main.style.setProperty(cssVar, `${v}${unit}`);
    state[stateKey] = v;
  };
  if (Number.isFinite(state[stateKey])) apply(state[stateKey]);

  let dragging = false, startCoord = 0, startVal = 0, dimPx = 0;
  handle.addEventListener('pointerdown', e => {
    dragging   = true;
    startCoord = (axis === 'x') ? e.clientX : e.clientY;
    const rect = main.getBoundingClientRect();
    dimPx      = (axis === 'x' ? rect.width : rect.height) || 1;
    startVal   = Number.isFinite(state[stateKey]) ? state[stateKey] : defaultVal;
    handle.classList.add('dragging');
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    const cur  = (axis === 'x') ? e.clientX : e.clientY;
    const dPx  = cur - startCoord;
    let delta;
    if (unit === '%')  delta = (dPx / dimPx) * 100 * sign;
    else if (unit === 'fr') delta = (dPx / dimPx) * 3 * sign; // 1 main-axis = ~3fr feel
    else               delta = dPx * sign;
    apply(startVal + delta);
    persistDebounced(LS_KEY[stateKey], String(state[stateKey]));
  });
  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
    _redrawAllPanels(state);
  }
  handle.addEventListener('pointerup',     endDrag);
  handle.addEventListener('pointercancel', endDrag);
  handle.addEventListener('dblclick', () => {
    apply(defaultVal);
    try { localStorage.removeItem(LS_KEY[stateKey]); } catch (_) {}
    _redrawAllPanels(state);
  });
}

// Restore persisted heights / widths on mount. Accepts integers OR floats so
// pcaAsideWPct (percent) and compactL3Fr (fr units) round-trip cleanly.
function _restorePersisted(state) {
  const FLOAT_KEYS = new Set(['pcaAsideWPct', 'compactLeftPct',
                              'compactLeftUpperPct', 'compactL3Fr']);
  for (const [key, lsKey] of Object.entries(LS_KEY)) {
    try {
      const v = localStorage.getItem(lsKey);
      if (v == null) continue;
      const n = FLOAT_KEYS.has(key) ? parseFloat(v) : parseInt(v, 10);
      if (FLOAT_KEYS.has(key)) {
        if (Number.isFinite(n) && n > 0 && n < 200) state[key] = n;
      } else {
        if (Number.isFinite(n) && n > 40 && n < 2000) state[key] = n;
      }
    } catch (_) {}
  }
}

export function attachPanelResize(state) {
  _setActiveState(state);
  _restorePersisted(state);
  _wireOne(state, 'simResize',    'simPanelH',   DEFAULTS.simPanelH,   80);
  _wireOne(state, 'zResize',      'zPanelH',     DEFAULTS.zPanelH,     40);
  _wireOne(state, 'linesResize',  'linesPanelH', DEFAULTS.linesPanelH, 40);
  _wireOne(state, 'pcaResize',    'pcaPanelH',   DEFAULTS.pcaPanelH,   80);
  _wireOne(state, 'l3Resize',     'l3PanelH',    DEFAULTS.l3PanelH,    80);

  // Fixed-mode horizontal seam between PCA scatter and tracked-samples aside.
  _wireAsideHoriz(state);

  // Compact-mode seams (CSS-variable driven; CSS hides them in other modes).
  _wireCssVar(state, 'compactColumnResize', {
    cssVar: '--compact-leftpct', stateKey: 'compactLeftPct',
    axis: 'x', defaultVal: DEFAULTS.compactLeftPct,
    minVal: 20, maxVal: 80, unit: '%', sign: 1,
  });
  _wireCssVar(state, 'compactStackResize',  {
    cssVar: '--compact-leftupperpct', stateKey: 'compactLeftUpperPct',
    axis: 'y', defaultVal: DEFAULTS.compactLeftUpperPct,
    minVal: 20, maxVal: 90, unit: '%', sign: 1,
  });
  _wireCssVar(state, 'compactL3Resize',     {
    cssVar: '--compact-l3fr', stateKey: 'compactL3Fr',
    // Drag DOWN should shrink L3 (it's the bottom row of the grid),
    // drag UP should grow it. axis=y with sign=-1.
    axis: 'y', defaultVal: DEFAULTS.compactL3Fr,
    minVal: 0.2, maxVal: 6.0, unit: 'fr', sign: -1,
  });

  applyMainGrid(state);
}

// Re-export for callers that need to recompute the grid (e.g. setSimInMinimap
// when the sim panel collapses to 0, layoutMode change, etc.).
export { applyMainGrid };
