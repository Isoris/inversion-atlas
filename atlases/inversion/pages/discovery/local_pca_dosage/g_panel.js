// pages/discovery/local_pca_dosage/g_panel.js
//
// G-panel modal — Phase 0 minimal port of legacy 42790-44030
// (_renderGPanelModal + _gPanelClose + manual/karyotype/inheritance
// tabs). User feedback (chat 2026-05-18): "when I push G nothing
// happens".
//
// Phase 0 scope: hotkey + button click → modal opens with the 3-tab
// scaffold. Each tab body is a thin placeholder pointing at the
// SPEC for the real content. Phase 1+ ports the tab bodies
// (manual list / karyotype + inheritance per-candidate views).
//
// Trigger: #gPanelOpenBtn in the L3 toolbar, sibling to the L2-sweep
// inspect button. Hotkey 'g' (lowercase, no modifiers, not in input
// field) toggles open/closed. State: state.gPanelOpen +
// state.gPanelTab.
//
// Modal pattern mirrors the lasso-linkage popover (sidebar.js
// _openLassoLinkagePopover): build the modal DOM lazily on first
// open, position fixed/inset:0 backdrop, close via ✕ / Esc /
// click-outside / g hotkey.

import { _pageState, _setActiveState } from './_state.js';

const _GPANEL_TABS = [
  { key: 'karyotype',   label: 'karyotype' },
  { key: 'inheritance', label: 'inheritance' },
  { key: 'manual',      label: 'manual' },
];
const _GPANEL_OVERLAY_ID = 'gPanelOverlay';

/**
 * Open or focus the G-panel modal. Builds the DOM lazily on first
 * call. Updates state.gPanelOpen + state.gPanelTab.
 */
export function openGPanel(state) {
  if (state) _setActiveState(state);
  const s = _pageState;
  if (!s || typeof document === 'undefined') return;
  let overlay = document.getElementById(_GPANEL_OVERLAY_ID);
  if (!overlay) overlay = _buildOverlay();
  s.gPanelOpen = true;
  if (!s.gPanelTab) s.gPanelTab = 'manual';
  _renderModal(s);
  overlay.style.display = 'flex';
}

export function closeGPanel(state) {
  if (state) _setActiveState(state);
  const s = _pageState;
  if (!s || typeof document === 'undefined') return;
  const overlay = document.getElementById(_GPANEL_OVERLAY_ID);
  if (overlay) overlay.style.display = 'none';
  s.gPanelOpen = false;
}

export function toggleGPanel(state) {
  if (state) _setActiveState(state);
  const s = _pageState;
  if (!s) return;
  s.gPanelOpen ? closeGPanel(s) : openGPanel(s);
}

/**
 * Wire the document-level 'g' hotkey + the #gPanelOpenBtn click +
 * the close-button / Esc / click-outside handlers. Idempotent via
 * document._gPanelHotkeyWired.
 */
export function wireGPanel(state) {
  if (typeof document === 'undefined') return;
  if (state) _setActiveState(state);

  // Button click
  const btn = document.getElementById('gPanelOpenBtn');
  if (btn && btn.dataset.wired !== '1') {
    btn.addEventListener('click', () => toggleGPanel(_pageState));
    btn.dataset.wired = '1';
  }

  // Hotkey 'g'
  if (!document._gPanelHotkeyWired) {
    document._gPanelHotkeyWired = true;
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const pageEl = document.getElementById('local_pca_dosage');
      if (!pageEl || !pageEl.classList.contains('active')) return;
      if ((e.key === 'g' || e.key === 'G')
          && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        toggleGPanel(_pageState);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// DOM build / render
// ---------------------------------------------------------------------------

function _buildOverlay() {
  const overlay = document.createElement('div');
  overlay.id = _GPANEL_OVERLAY_ID;
  overlay.style.cssText = 'display: none; position: fixed; inset: 0; '
                       + 'z-index: 1000; background: rgba(0,0,0,0.55); '
                       + 'align-items: flex-start; justify-content: center; '
                       + 'padding: 40px 20px; overflow-y: auto;';
  // Click-outside closes.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeGPanel(_pageState);
  });
  // Esc closes.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.style.display !== 'none') {
      closeGPanel(_pageState);
    }
  });
  document.body.appendChild(overlay);
  return overlay;
}

function _renderModal(state) {
  const overlay = document.getElementById(_GPANEL_OVERLAY_ID);
  if (!overlay) return;
  const activeTab = state.gPanelTab || 'manual';

  let html = '';
  html += '<div style="background: var(--panel-2); border: 2px solid var(--good); '
       +              'border-radius: 6px; max-width: 900px; width: 100%; '
       +              'box-shadow: 0 12px 40px rgba(0,0,0,0.5); position: relative; '
       +              'font-family: var(--mono);">';
  // Header
  html += '<div style="display: flex; justify-content: space-between; align-items: baseline; '
       +              'padding: 18px 22px; border-bottom: 1px solid var(--rule);">';
  html += '<div>';
  html += '<div style="font-size: 14px; font-weight: 600; color: var(--good);">';
  html +=   'G · unified groups';
  html += '</div>';
  html += '<div style="font-size: 11px; color: var(--ink-dim); margin-top: 4px;">';
  html +=   'karyotype · inheritance · manual — three flavours of grouping. '
       +   'Phase 0 scaffold; full per-tab content ports from legacy '
       +   '42826-44030 in follow-up commits.';
  html += '</div>';
  html += '</div>';
  html += '<button id="gPanelClose" '
       +         'style="background: transparent; border: 1px solid var(--rule); '
       +                'color: var(--ink-dim); padding: 4px 12px; cursor: pointer; '
       +                'font-family: var(--mono); font-size: 12px; '
       +                'border-radius: 3px;" '
       +         'title="Close (Esc · g)">✕ close</button>';
  html += '</div>';
  // Tab strip
  html += '<div style="padding: 8px 22px; border-bottom: 1px solid var(--rule); '
       +              'display: flex; gap: 6px;">';
  for (const t of _GPANEL_TABS) {
    const isActive = (t.key === activeTab);
    html += '<button class="_gpTabBtn" data-gptab="' + t.key + '" '
         +          'style="background: ' + (isActive ? 'var(--panel)' : 'transparent') + '; '
         +                 'border: 1px solid ' + (isActive ? 'var(--good)' : 'var(--rule)') + '; '
         +                 'color: var(--ink); padding: 4px 12px; cursor: pointer; '
         +                 'font-family: var(--mono); font-size: 11.5px; '
         +                 'border-radius: 3px;">'
         + t.label + '</button>';
  }
  html += '</div>';
  // Body
  html += '<div style="padding: 22px; min-height: 220px;">';
  html += _renderTabBody(state, activeTab);
  html += '</div>';
  html += '</div>';

  overlay.innerHTML = html;

  // Wire tab buttons + close button.
  overlay.querySelectorAll('._gpTabBtn').forEach(b => {
    b.addEventListener('click', () => {
      state.gPanelTab = b.dataset.gptab;
      _renderModal(state);
    });
  });
  const closeBtn = overlay.querySelector('#gPanelClose');
  if (closeBtn) closeBtn.addEventListener('click', () => closeGPanel(state));

  // 2026-05-20 (SPEC_cross_atlas_group_transfer.md stage 1): promote a
  // staged selection into a manual group, or discard it. Both buttons
  // live in the manual tab's stagedBanner (rendered when
  // state.selectionGroup is non-empty); _renderTabBody emits them.
  // After mutation we re-render the modal so the banner disappears and
  // the new group appears in the list.
  const saveBtn = overlay.querySelector('#_gpSaveSelectionBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      _promoteStagedSelection(state);
      _renderModal(state);
      try { if (typeof window !== 'undefined' && window.drawPCA) window.drawPCA(state); }
      catch (_) {}
    });
  }
  const discardBtn = overlay.querySelector('#_gpDiscardSelectionBtn');
  if (discardBtn) {
    discardBtn.addEventListener('click', () => {
      state.selectionGroup = null;
      _renderModal(state);
      try { if (typeof window !== 'undefined' && window.drawPCA) window.drawPCA(state); }
      catch (_) {}
    });
  }
}

// Promote state.selectionGroup → a new entry in state.manualGroups,
// then clear the staged slot. Caller re-renders the modal.
function _promoteStagedSelection(state) {
  const sg = state && state.selectionGroup;
  if (!sg || !Array.isArray(sg.ids) || sg.ids.length === 0) return;
  if (!Array.isArray(state.manualGroups)) state.manualGroups = [];
  // Auto-name: lasso_<N> where N = existing count + 1.
  const n = state.manualGroups.length + 1;
  const name = 'lasso_' + n;
  state.manualGroups.push({
    name,
    ids:     sg.ids.slice(),
    source:  'selection_group',
    source_atlas:  sg.source_atlas  || null,
    source_page:   sg.source_page   || null,
    source_window: Number.isFinite(sg.source_window) ? sg.source_window : null,
    created_at:    Date.now(),
  });
  state.selectionGroup = null;
}

function _renderTabBody(state, key) {
  if (key === 'manual') {
    const groups = (state && Array.isArray(state.manualGroups)) ? state.manualGroups : [];
    // 2026-05-20 (SPEC_cross_atlas_group_transfer.md stage 1): when the
    // user has a staged selection in state.selectionGroup (from U-key
    // selection mode + Shift+drag lasso), surface a one-click promote
    // button at the top of the manual tab. Clicking it builds a new
    // manualGroup entry from selectionGroup.ids and clears the staged
    // slot so the next drag starts fresh.
    const sg = state && state.selectionGroup;
    const hasStaged = sg && Array.isArray(sg.ids) && sg.ids.length > 0;
    let stagedBanner = '';
    if (hasStaged) {
      stagedBanner =
        '<div id="_gpStagedSelection" style="' +
          'margin: 0 0 12px 0; padding: 8px 12px;' +
          'background: rgba(245,165,36,0.10); ' +
          'border: 1px solid rgba(245,165,36,0.45);' +
          'border-radius: 4px; color: var(--ink);' +
          'font-size: 12px; display: flex; align-items: center; gap: 10px;">' +
          '<div style="flex: 1;">' +
            '<b>staged selection</b>: ' +
            '<span style="color: var(--ink-dim);">' + (sg.ids.length | 0) +
              ' sample' + (sg.ids.length === 1 ? '' : 's') + '</span>' +
            '<span style="color: var(--ink-dimmer); font-size: 10.5px; margin-left: 8px;">' +
              'from ' + _esc(sg.source_page || '?') +
              (Number.isFinite(sg.source_window) ? ' · w' + (sg.source_window | 0) : '') +
            '</span>' +
          '</div>' +
          '<button id="_gpSaveSelectionBtn" type="button" ' +
            'title="Save the staged selection as a new manual group. Clears the staged slot." ' +
            'style="background: var(--accent); color: #0b0e13; border: 0; ' +
                   'border-radius: 3px; padding: 4px 10px; ' +
                   'font-family: var(--mono); font-size: 11px; cursor: pointer;">' +
            'save as group' +
          '</button>' +
          '<button id="_gpDiscardSelectionBtn" type="button" ' +
            'title="Discard the staged selection without promoting." ' +
            'style="background: transparent; color: var(--ink-dim); ' +
                   'border: 1px solid var(--rule); border-radius: 3px; ' +
                   'padding: 4px 8px; font-family: var(--mono); font-size: 11px; ' +
                   'cursor: pointer;">' +
            'discard' +
          '</button>' +
        '</div>';
    }
    if (groups.length === 0) {
      return stagedBanner
           + '<div style="color: var(--ink-dim); font-size: 12px; line-height: 1.6;">'
           + '<p><b>No manual groups yet.</b></p>'
           + '<p>Create one via:</p>'
           + '<ul style="margin: 8px 0 0 20px;">'
           + '<li>Shift-drag on the PCA scatter (auto-named <code>lasso_N</code>)</li>'
           + '<li>U then Shift-drag (selection mode — promotes via this panel)</li>'
           + '</ul>'
           + '<p style="margin-top: 14px; color: var(--ink-dimmer); font-size: 11px;">'
           + 'Full manual-list rendering ports in Phase 1 (legacy 42820-42960).</p>'
           + '</div>';
    }
    let s = stagedBanner + '<div style="color: var(--ink); font-size: 12px;">';
    s += '<div style="margin-bottom: 8px; color: var(--ink-dim);">'
       + groups.length + ' manual group' + (groups.length === 1 ? '' : 's') + ':</div>';
    s += '<ul style="margin: 0; padding-left: 18px;">';
    for (const g of groups) {
      const n = (g && Array.isArray(g.ids)) ? g.ids.length : 0;
      const name = g && g.name ? g.name : '(unnamed)';
      s += '<li>' + _esc(name) + ' — <span style="color: var(--ink-dim);">'
         + n + ' samples</span></li>';
    }
    s += '</ul></div>';
    return s;
  }
  if (key === 'karyotype') {
    const cand = state && state.candidate;
    if (!cand) {
      return '<div style="color: var(--ink-dim); font-size: 12px; line-height: 1.6;">'
           + '<p><b>No focused candidate.</b></p>'
           + '<p>Focus a candidate (from the catalogue or by promoting a draft) to see '
           + 'its per-band karyotype tiles here.</p>'
           + '<p style="margin-top: 14px; color: var(--ink-dimmer); font-size: 11px;">'
           + 'Full per-band rendering ports in Phase 1 (legacy 42850-43320).</p>'
           + '</div>';
    }
    return '<div style="color: var(--ink); font-size: 12px;">'
         + '<p>Focused candidate: <code>' + _esc(cand.id || '?') + '</code></p>'
         + '<p style="margin-top: 12px; color: var(--ink-dim);">'
         + 'Full per-band karyotype rendering ports in Phase 1.</p>'
         + '</div>';
  }
  if (key === 'inheritance') {
    return '<div style="color: var(--ink-dim); font-size: 12px; line-height: 1.6;">'
         + '<p><b>Inheritance groups</b> — cross-candidate Jaccard clusters of '
         + 'co-segregating fish. Requires ≥2 confirmed candidates with locked '
         + 'labels.</p>'
         + '<p style="margin-top: 14px; color: var(--ink-dimmer); font-size: 11px;">'
         + 'Full content ports in Phase 1 (legacy 43400-43800).</p>'
         + '</div>';
  }
  return '<div style="color: var(--ink-dim);">unknown tab: ' + _esc(key) + '</div>';
}

function _esc(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  })[ch]);
}
