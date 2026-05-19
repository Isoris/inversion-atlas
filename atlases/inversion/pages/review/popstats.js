// =============================================================================
// inversion_review/popstats.js — "8 popstats" tab
// =============================================================================
// Stage:        review (per-window popstats track stack)
// DOM contract: <div id="popstats"> with #psToolbar / #psChips / #psStack /
//               #psNoChrom / #psGalleryTray
//
// Architecture (2026-05-20 — native ES-module port)
// -------------------------------------------------
// Round-5-step-18 left this page as a thin loader stub that called
// window.renderPopstatsPage from the (never-shipped) legacy
// `js/atlas_page6_wiring.js` bundle. The fallback empty-state was what
// surfaced to the user on every mount.
//
// This rewrite ports the legacy renderPopstatsPage() + collectPopstatsTracks()
// + drawPopstatsTracks() + canvas primitives directly into ES modules under
// `./popstats/`:
//
//   _canvas.js  — fitCanvas / themeColor / drawIdeogram / drawSimCollapse /
//                 drawLine + frame/breakpoint/crosshair helpers
//   _tracks.js  — STATIC_TRACKS list + auto-discover from data.tracks
//   _view.js    — chip-toggle persistence (scrubber_v3_popstats localStorage)
//   _render.js  — renderPopstatsPage({ root, data, candidate, cur })
//   _live.js    — POST /api/popstats/groupwise (FST/dxy/theta_pi) +
//                 POST /api/popstats/hobs_groupwise wrappers. Wired for
//                 future group-aware overlays; not invoked on the static
//                 paint path.
//   _state.js   — _pageState handle, unchanged
//
// Data source: `registry.resolve('scrubber_main', { chrom: activeChrom })`,
// which is the same per-chrom precomp JSON every other review page consumes.
// =============================================================================

import { _pageState, _setActiveState } from './popstats/_state.js';
import { renderPopstatsPage } from './popstats/_render.js';
import { renderCandidateNav } from './popstats/_candidate_nav.js';

export async function mount(root, atlasState, registry) {
  const chrom = atlasState.shared && atlasState.shared.activeChrom;
  if (!chrom) {
    _showStatus(root, 'No chromosome selected — pick one from the scopebar.');
    _setActiveState({ data: null, candidate: null, cur: null });
    return;
  }

  let data;
  try {
    data = await registry.resolve('scrubber_main', { chrom });
  } catch (e) {
    _showStatus(root, `Failed to load scrubber_main for ${chrom}: ${e && e.message ? e.message : e}`);
    _setActiveState({ data: null, candidate: null, cur: null });
    return;
  }

  const candidate = (atlasState.shared && atlasState.shared.activeCandidate) || null;
  const cur = _resolveCurrentWindow(data, candidate);

  const pageState = { chrom, data, candidate, cur };
  _setActiveState(pageState);
  if (atlasState.inversion) atlasState.inversion._page6State = pageState;

  _mountCandidateNav(root, atlasState, registry);
  renderPopstatsPage({ root, data, candidate, cur });
}

/**
 * Insert the prev/next candidate nav bar at the very top of #popstats.
 * onChange flips activeCandidate via the AtlasState convenience setter
 * AND re-runs mount() so the breakpoint overlay, candidate label, and
 * "candidate N / M" position counter all refresh in one pass.
 */
function _mountCandidateNav(root, atlasState, registry) {
  const page = (root && root.querySelector) ? root.querySelector('#popstats') : null;
  if (!page) return;
  const old = page.querySelector('.cand-nav-inline');
  if (old) old.remove();
  const bar = renderCandidateNav({
    atlasState,
    idPrefix: 'ps',
    onChange: () => {
      mount(root, atlasState, registry).catch(err =>
        console.warn('popstats: re-mount after candidate change threw —', err));
    },
  });
  page.insertBefore(bar, page.firstChild);
}

export async function unmount(root) {
  _setActiveState(null);
}

/**
 * Re-render entry. Called by the legacy export name `refreshPage6` so any
 * caller that still imports it keeps working. Reads the most-recent
 * pageState from _state.js so chrom + data don't have to be threaded again.
 */
export function refreshPage6() {
  if (!_pageState) return;
  const root = document.getElementById('app-root') || document;
  renderPopstatsPage({
    root,
    data:      _pageState.data,
    candidate: _pageState.candidate,
    cur:       _pageState.cur,
  });
}

// Back-compat aliases for the chat-33 export names. Other modules that import
// these from outside still resolve; the legacy thin-loader fallback message
// is gone — both names now delegate to the native renderer.
export const showPopstatsPage     = refreshPage6;
export const refreshPopstatsPage  = refreshPage6;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _showStatus(root, msg) {
  const noChrom = root && root.querySelector ? root.querySelector('#psNoChrom') : null;
  const stack   = root && root.querySelector ? root.querySelector('#psStack')   : null;
  const chips   = root && root.querySelector ? root.querySelector('#psChips')   : null;
  if (noChrom) {
    noChrom.style.display = 'block';
    noChrom.textContent = msg;
  }
  if (stack) stack.innerHTML = '';
  if (chips) chips.innerHTML = '';
}

/**
 * Pick a default current-window index for the crosshair. Prefers the active
 * candidate's center; falls back to the chromosome midpoint. Returns null if
 * no windows array is available.
 */
function _resolveCurrentWindow(data, candidate) {
  if (!data || !Array.isArray(data.windows) || data.windows.length === 0) return null;
  if (candidate && isFinite(candidate.start_mb) && isFinite(candidate.end_mb)) {
    const target = (candidate.start_mb + candidate.end_mb) / 2;
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < data.windows.length; i++) {
      const c = data.windows[i].center_mb;
      const d = Math.abs(c - target);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return bestIdx;
  }
  return Math.floor(data.windows.length / 2);
}
