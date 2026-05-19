// pages/discovery/local_pca_dosage/lines_settings_panel.js
//
// Per-sample-lines settings — flying overlay panel (2026-05-19).
//
// User request (chat 2026-05-19): "all of settings must be in a toggle
// tab that is replacing the collapse down arrow button change to
// settings ... it should be the same flying settings panel as the
// grouping panel of the legacy atlas in term of look and style as we
// pushed G ... by default it should be less and closed and only when
// we open that it unfolds it."
//
// Pattern mirrors g_panel.js (the karyotype/inheritance/manual modal):
//   - position: fixed; inset: 0 backdrop, z-index: 1000
//   - card with --good border, ✕ close, click-outside + Esc to close
//   - body fills with the existing controls
//
// Implementation note — DOM relocation, not re-render:
//   The existing per-sample-lines controls (#linesHeaderMoreGroup and
//   its SNP-density / trans-rate / regime / lineage / band-trace /
//   cusum / cand-bands / macrostripe children) carry years of wiring
//   in sidebar.js + lines_panel.js. Re-rendering them would have us
//   re-wire every handler. Instead we MOVE the existing DOM nodes
//   into the modal body on open and MOVE THEM BACK on close (snapshot
//   parentNode + nextSibling). All listeners stay attached to the same
//   element instances.
//
// Trigger: the existing #linesHeaderMoreToggle button. sidebar.js
// (_wireNewShellControls) previously toggled .display on
// #linesHeaderMoreGroup; that wiring is REPLACED by openLinesSettingsPanel
// when this module is wired (see _replaceLinesMoreButton below).

import { _pageState, _setActiveState } from './_state.js';

const _LINES_SETTINGS_OVERLAY_ID = 'linesSettingsPanelOverlay';

// Records the original DOM-position of each relocated element so we can
// restore them in the same order/parent on close. Cleared after each
// successful close-and-restore.
const _relocations = [];

/**
 * Open or focus the lines-settings modal. Builds the DOM lazily on
 * first call. Updates state.linesSettingsOpen.
 */
export function openLinesSettingsPanel(state) {
  if (state) _setActiveState(state);
  const s = _pageState;
  if (!s || typeof document === 'undefined') return;
  let overlay = document.getElementById(_LINES_SETTINGS_OVERLAY_ID);
  if (!overlay) overlay = _buildOverlay();
  s.linesSettingsOpen = true;
  _renderModal(s);
  _relocateControlsInto(overlay.querySelector('#linesSettingsPanelBody'));
  overlay.style.display = 'flex';
  // Persist the open-by-default user preference (off by default; toggling
  // it manually doesn't change the default, just the current open state.
  // We deliberately do NOT persist openness across reloads — the user said
  // "by default it should be less and closed").
}

export function closeLinesSettingsPanel(state) {
  if (state) _setActiveState(state);
  const s = _pageState;
  if (!s || typeof document === 'undefined') return;
  _restoreControls();
  const overlay = document.getElementById(_LINES_SETTINGS_OVERLAY_ID);
  if (overlay) overlay.style.display = 'none';
  s.linesSettingsOpen = false;
}

export function toggleLinesSettingsPanel(state) {
  if (state) _setActiveState(state);
  const s = _pageState;
  if (!s) return;
  s.linesSettingsOpen ? closeLinesSettingsPanel(s) : openLinesSettingsPanel(s);
}

/**
 * Wire the existing #linesHeaderMoreToggle button to open this modal
 * instead of toggling the inline #linesHeaderMoreGroup visibility.
 * Idempotent via dataset.wiredAsSettings. Also installs the Esc / 'L'
 * hotkey + click-outside handlers on the overlay (built lazily on
 * first open). Repurposes the existing `inversion_atlas.linesHeaderMoreOn`
 * localStorage key for back-compat ("open by default" stays off).
 *
 * Call from local_pca_dosage.js mount() after buildLinesPanel runs.
 */
export function wireLinesSettingsPanel(state) {
  if (typeof document === 'undefined') return;
  if (state) _setActiveState(state);

  // Re-label the existing "▾ more" button as "⚙ settings" and re-point
  // its click handler at the modal. sidebar.js's wiring (which toggles
  // an inline display) is bypassed by setting dataset.wiredAsSettings=1
  // before it runs — but sidebar.js wires inside _wireNewShellControls
  // which runs at applyData time, so we use a guard there too.
  const btn = document.getElementById('linesHeaderMoreToggle');
  if (btn) {
    btn.textContent = '⚙ settings';
    btn.title = 'Open the per-sample-lines settings panel (SNP density, '
              + 'trans-rate, regime, lineage, band-trace, cusum, cand-bands, '
              + 'macrostripe). Closes via the ✕ button, Esc, click-outside, '
              + 'or by clicking this button again. Hotkey: L.';
    if (btn.dataset.wiredAsSettings !== '1') {
      btn.dataset.wiredAsSettings = '1';
      // Don't preventDefault — the sidebar.js handler may still run; we
      // run AFTER so the modal opens on top of whatever the sidebar
      // toggle did. The modal contains the same #linesHeaderMoreGroup
      // children either way.
      btn.addEventListener('click', (e) => {
        e.stopImmediatePropagation();
        toggleLinesSettingsPanel(_pageState);
      }, true);  // capture phase — runs before the sidebar bubble handler
    }
  }

  // 'L' hotkey toggle.
  if (!document._linesSettingsHotkeyWired) {
    document._linesSettingsHotkeyWired = true;
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const pageEl = document.getElementById('local_pca_dosage');
      if (!pageEl || !pageEl.classList.contains('active')) return;
      if ((e.key === 'l' || e.key === 'L')
          && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        toggleLinesSettingsPanel(_pageState);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// DOM build / render
// ---------------------------------------------------------------------------

function _buildOverlay() {
  const overlay = document.createElement('div');
  overlay.id = _LINES_SETTINGS_OVERLAY_ID;
  overlay.style.cssText = 'display: none; position: fixed; inset: 0; '
                       + 'z-index: 1000; background: rgba(0,0,0,0.55); '
                       + 'align-items: flex-start; justify-content: center; '
                       + 'padding: 60px 20px 20px; overflow-y: auto;';
  // Click-outside closes — and triggers _restoreControls via close.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeLinesSettingsPanel(_pageState);
  });
  // Esc closes.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.style.display !== 'none') {
      closeLinesSettingsPanel(_pageState);
    }
  });
  document.body.appendChild(overlay);
  return overlay;
}

function _renderModal(state) {
  const overlay = document.getElementById(_LINES_SETTINGS_OVERLAY_ID);
  if (!overlay) return;

  // Rebuild the chrome each open (header + close button only); the
  // body container is empty and will be populated by _relocateControlsInto.
  let html = '';
  html += '<div style="background: var(--panel-2); border: 2px solid var(--good); '
       +              'border-radius: 6px; max-width: 920px; width: 100%; '
       +              'box-shadow: 0 12px 40px rgba(0,0,0,0.5); position: relative; '
       +              'font-family: var(--mono);">';
  // Header
  html += '<div style="display: flex; justify-content: space-between; align-items: baseline; '
       +              'padding: 16px 22px; border-bottom: 1px solid var(--rule);">';
  html += '<div>';
  html += '<div style="font-size: 14px; font-weight: 600; color: var(--good);">';
  html +=   '⚙ Per-sample lines · settings';
  html += '</div>';
  html += '<div style="font-size: 11px; color: var(--ink-dim); margin-top: 4px;">';
  html +=   'PC sources · color mode · lasso · SNP density · trans-rate · '
       +   'regime · lineage · band-trace · cusum · cand-bands · macrostripe. '
       +   'All controls live here; the lines header bar stays uncluttered.';
  html += '</div>';
  html += '</div>';
  html += '<button id="linesSettingsClose" '
       +         'style="background: transparent; border: 1px solid var(--rule); '
       +                'color: var(--ink-dim); padding: 4px 12px; cursor: pointer; '
       +                'font-family: var(--mono); font-size: 12px; '
       +                'border-radius: 3px;" '
       +         'title="Close (Esc · L · ⚙ settings again)">✕ close</button>';
  html += '</div>';
  // Body — controls relocate here.
  html += '<div id="linesSettingsPanelBody" style="padding: 18px 22px; min-height: 80px; '
       +              'display: flex; flex-wrap: wrap; gap: 10px 14px; '
       +              'align-items: center;">';
  html += '</div>';
  html += '</div>';

  overlay.innerHTML = html;

  const closeBtn = overlay.querySelector('#linesSettingsClose');
  if (closeBtn) closeBtn.addEventListener('click', () => closeLinesSettingsPanel(state));
}

// ---------------------------------------------------------------------------
// DOM relocation — preserves wiring by moving (not rebuilding) controls.
// ---------------------------------------------------------------------------

// Which control containers belong inside the settings panel? We move
// the children OF these IDs (not the wrappers themselves, so the
// wrappers' CSS selectors in the inline bar still match). When the
// modal closes, each child returns to its original parent at its
// original position.
const _RELOCATE_TARGETS = [
  // The "more" group container (SNP-density, trans-rate, regime, etc.).
  // Its children move OUT of inline-flex and INTO the modal body.
  'linesHeaderMoreGroup',
];

function _relocateControlsInto(modalBody) {
  if (!modalBody) return;
  _relocations.length = 0;
  for (const containerId of _RELOCATE_TARGETS) {
    const src = document.getElementById(containerId);
    if (!src) continue;
    // Force the source container visible (in case the legacy sidebar.js
    // wiring left it display:none) so its children are reachable.
    src.style.display = '';
    const children = Array.from(src.children);
    for (const child of children) {
      _relocations.push({
        node: child,
        originalParent: src,
        originalNextSibling: child.nextSibling,
      });
      modalBody.appendChild(child);
    }
  }
}

function _restoreControls() {
  // Restore in reverse order so insertBefore(nextSibling) lands each
  // element back at its original spot even if multiple from the same
  // parent were moved.
  while (_relocations.length > 0) {
    const rec = _relocations.pop();
    if (!rec || !rec.node || !rec.originalParent) continue;
    try {
      rec.originalParent.insertBefore(rec.node, rec.originalNextSibling || null);
    } catch (_) {
      // Original parent gone (e.g. unmount during open) — leave the
      // node where it is; the modal will be garbage-collected with the
      // overlay on next page mount.
    }
  }
}
