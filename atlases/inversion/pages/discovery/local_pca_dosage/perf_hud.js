// pages/discovery/local_pca_dosage/perf_hud.js
//
// Live performance HUD for the inversion-atlas scrub loop.
//
// 2026-05-19. Lets you toggle the per-scrub timing (window.__perfDbg)
// AND see a small floating readout in the bottom-right corner without
// retyping console commands. Pairs with the timing instrumentation in
// events.js setCur (the source of the data) and window.__perfSummary
// (full table on click).
//
// Surfaces:
//   - Hotkey `Shift+P` — toggles HUD visibility + window.__perfDbg flag.
//                        Not in input fields. Page must be active.
//   - Click the HUD     — opens window.__perfSummary() in the console
//                        (full per-panel table).
//   - Right-click HUD   — clears the scrub log (window.__perfScrubLog).
//
// Persistence: HUD on/off state lives in localStorage
//              'inversion_atlas.perfHudOn' so the user's preference
//              survives reloads.
//
// Display:
//   ┌──────────────────────────┐
//   │ perf · 12.3ms  (drawZ 8) │   ← last total + dominant panel
//   │ p50 9.1  p95 22.4  n=15  │   ← rolling aggregate (last 50)
//   └──────────────────────────┘
//
// The HUD updates only when a scrub fires (cheap; no idle polling).
// setCur calls _perfHudUpdate() at the end of its instrumentation
// block when window.__perfDbg is on.

import { _pageState, _setActiveState } from './_state.js';
import { persistDebounced } from '../../../shared/persist_debounced.js';

const HUD_ID = 'perfHudOverlay';
const LS_KEY = 'inversion_atlas.perfHudOn';
const ROLLING_WINDOW = 50;    // how many scrubs the p50/p95 line covers

/**
 * Show the HUD + enable perf logging. Idempotent.
 */
export function openPerfHud() {
  if (typeof document === 'undefined') return;
  window.__perfDbg = true;
  persistDebounced(LS_KEY, '1');
  let hud = document.getElementById(HUD_ID);
  if (!hud) hud = _buildHud();
  hud.style.display = 'block';
  _perfHudUpdate();   // initial paint with whatever log we have
}

export function closePerfHud() {
  if (typeof document === 'undefined') return;
  window.__perfDbg = false;
  persistDebounced(LS_KEY, '0');
  const hud = document.getElementById(HUD_ID);
  if (hud) hud.style.display = 'none';
}

export function togglePerfHud() {
  if (typeof document === 'undefined') return;
  const hud = document.getElementById(HUD_ID);
  const isOn = hud && hud.style.display !== 'none' && window.__perfDbg === true;
  isOn ? closePerfHud() : openPerfHud();
}

/**
 * Wire the Shift+P hotkey + restore persisted state on mount.
 * Idempotent via document._perfHudHotkeyWired.
 *
 * Called from sidebar.js's master wire() entry alongside wireGPanel and
 * wireLinesSettingsPanel.
 */
export function wirePerfHud(state) {
  if (typeof document === 'undefined') return;
  if (state) _setActiveState(state);

  // Restore persisted on/off (default OFF — perf is a dev tool, shouldn't
  // be on by default for a fresh user).
  let wantOn = false;
  try { wantOn = localStorage.getItem(LS_KEY) === '1'; } catch (_) {}
  if (wantOn) openPerfHud();

  // Hotkey: Shift+P toggles. We use Shift to avoid the bare 'p' which
  // is taken by previous-L2 navigation in events.js. Same input-guard /
  // active-page pattern as wireGPanel.
  if (!document._perfHudHotkeyWired) {
    document._perfHudHotkeyWired = true;
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const pageEl = document.getElementById('local_pca_dosage');
      if (!pageEl || !pageEl.classList.contains('active')) return;
      if ((e.key === 'P' || e.code === 'KeyP') && e.shiftKey
          && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        togglePerfHud();
      }
    });
  }
}

/**
 * Called by setCur after each scrub when perf mode is on. Updates the
 * HUD's last-scrub line and rolling aggregate from window.__perfScrubLog.
 * Exposed on `window._perfHudUpdate` so the events.js instrumentation
 * can call it without importing this module (keeps the perf path
 * dependency-free when the HUD isn't loaded).
 */
export function _perfHudUpdate() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const hud = document.getElementById(HUD_ID);
  if (!hud || hud.style.display === 'none') return;
  const log = window.__perfScrubLog || [];
  if (log.length === 0) {
    hud.querySelector('.perf-hud-last').textContent = 'perf · waiting for scrub…';
    hud.querySelector('.perf-hud-agg').textContent  = '';
    return;
  }
  const latest = log[log.length - 1];
  // Find dominant panel in latest scrub.
  let domKey = '?', domMs = 0;
  for (const [k, v] of Object.entries(latest.ts || {})) {
    if (v > domMs) { domKey = k; domMs = v; }
  }
  hud.querySelector('.perf-hud-last').innerHTML =
    `<b>perf</b> · ${latest.total.toFixed(1)}ms ` +
    `<span class="perf-hud-dim">(${domKey} ${domMs.toFixed(1)})</span>`;
  // Rolling p50/p95 over last ROLLING_WINDOW scrubs.
  const recent = log.slice(-ROLLING_WINDOW).map(r => r.total).sort((a, b) => a - b);
  const p50 = recent[Math.floor(recent.length * 0.50)] || 0;
  const p95 = recent[Math.floor(recent.length * 0.95)] || 0;
  hud.querySelector('.perf-hud-agg').innerHTML =
    `p50 ${p50.toFixed(1)}  p95 ${p95.toFixed(1)}  ` +
    `<span class="perf-hud-dim">n=${log.length}</span>`;
}

// ---------------------------------------------------------------------------
// DOM build
// ---------------------------------------------------------------------------

function _buildHud() {
  const hud = document.createElement('div');
  hud.id = HUD_ID;
  hud.style.cssText = [
    'position: fixed',
    'bottom: 14px',
    'right: 14px',
    'z-index: 9998',
    'background: rgba(20, 24, 32, 0.92)',
    'border: 1px solid #f5a524',
    'border-radius: 4px',
    'padding: 6px 10px',
    'min-width: 220px',
    'font-family: ui-monospace, monospace',
    'font-size: 11px',
    'color: #f0f0f0',
    'box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5)',
    'cursor: pointer',
    'user-select: none',
    'line-height: 1.4',
    'display: none',
  ].join(';');
  hud.title = 'Click: print full perf table to console · '
            + 'Right-click: clear scrub log · '
            + 'Shift+P: hide HUD + disable perf logging';

  const last = document.createElement('div');
  last.className = 'perf-hud-last';
  last.textContent = 'perf · waiting for scrub…';
  hud.appendChild(last);

  const agg = document.createElement('div');
  agg.className = 'perf-hud-agg';
  agg.style.cssText = 'color: #b0b8c4; font-size: 10px; margin-top: 2px;';
  hud.appendChild(agg);

  // Inject the dim helper class once (cheap; idempotent).
  if (!document.getElementById('perf-hud-styles')) {
    const st = document.createElement('style');
    st.id = 'perf-hud-styles';
    st.textContent = '.perf-hud-dim { color: #8a93a3; font-weight: 400; }';
    document.head.appendChild(st);
  }

  hud.addEventListener('click', (e) => {
    e.preventDefault();
    if (typeof window.__perfSummary === 'function') window.__perfSummary();
    else console.log('[perf] __perfSummary not yet defined — scrub at least once with __perfDbg=true');
  });
  hud.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.__perfScrubLog = [];
    _perfHudUpdate();
  });

  document.body.appendChild(hud);
  return hud;
}

// Expose the update hook on window so events.js can poke it after each
// scrub without an import dependency. Defined eagerly so the FIRST scrub
// after openPerfHud() picks up the call.
if (typeof window !== 'undefined') {
  window._perfHudUpdate = _perfHudUpdate;
}
