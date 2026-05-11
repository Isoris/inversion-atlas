// pages/discovery/page1/panel_resize.js
//
// Panel resize handles — drag the bottom edge of sim / Z / lines / PCA / L3
// to adjust panel heights. Verbatim port from legacy
// Inversion_atlas.html lines 66824-67460 (subset: fixed-mode only).
//
// Each handle:
//   - pointerdown captures start position + current panel height
//   - pointermove updates state.<panel>H and rebuilds main#page1's
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

const DEFAULTS = {
  simPanelH:   520,
  zPanelH:     100,
  linesPanelH: 200,
  pcaPanelH:   280,
  l3PanelH:    360,
};

const LS_KEY = {
  simPanelH:   'pca_scrubber_v3.simPanelH',
  zPanelH:     'pca_scrubber_v3.zPanelH',
  linesPanelH: 'pca_scrubber_v3.linesPanelH',
  pcaPanelH:   'pca_scrubber_v3.pcaPanelH',
  l3PanelH:    'pca_scrubber_v3.l3PanelH',
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

// Build the grid-template-rows for main#page1 from current state. Only
// applies in fixed mode — compact / free have their own CSS-driven rules.
// Matches legacy 8-row template: ctrlBar / sim / Z / tracks / spacer /
// anchorStrip / pca(1fr) / l3. linesPanel defaults to display:none and
// doesn't get a row; if visible it slots in via grid auto-placement.
function applyMainGrid(state) {
  const main = document.getElementById('page1');
  if (!main) return;
  const mode = (document.body && document.body.dataset.layoutMode) || 'fixed';
  if (mode !== 'fixed') {
    main.style.gridTemplateRows = '';
    return;
  }
  // Row sizes:
  //   sim  : 0 when in minimap; else state.simPanelH
  //   z    : 50 when collapsed; else state.zPanelH
  //   tracks: auto (empty by default → 0)
  //   spacer: 0 (compactColumnResize handle, fixed-mode invisible)
  //   anchor: 28 (state.anchorStripH)
  //   pca  : 1fr by default; fixed px iff user resized away from default
  //   l3   : default fixed 360, or user-resized
  const simH = (document.body && document.body.dataset.simInMinimap === '1')
               ? 0
               : Math.max(60, state.simPanelH | 0 || DEFAULTS.simPanelH);
  const zH   = state.zCollapsed
               ? 50
               : Math.max(40, state.zPanelH | 0 || DEFAULTS.zPanelH);
  const pcaRow = (state._pcaPanelResized && state.pcaPanelH)
                 ? `${Math.max(60, state.pcaPanelH | 0)}px`
                 : '1fr';
  const l3Row  = (state._l3PanelResized && state.l3PanelH)
                 ? `${Math.max(60, state.l3PanelH | 0)}px`
                 : `${DEFAULTS.l3PanelH}px`;
  main.style.gridTemplateRows =
    `40px ${simH}px ${zH}px auto 0px 28px ${pcaRow} ${l3Row}`;
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
    try { localStorage.setItem(LS_KEY[stateKey], String(next)); } catch (_) {}
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

// Restore persisted heights on mount.
function _restorePersisted(state) {
  for (const [key, lsKey] of Object.entries(LS_KEY)) {
    try {
      const v = localStorage.getItem(lsKey);
      const n = parseInt(v, 10);
      if (Number.isFinite(n) && n > 40 && n < 2000) state[key] = n;
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
  applyMainGrid(state);
}

// Re-export for callers that need to recompute the grid (e.g. setSimInMinimap
// when the sim panel collapses to 0, layoutMode change, etc.).
export { applyMainGrid };
