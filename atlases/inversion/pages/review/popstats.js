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
import { renderCandidateNavInline } from '../../shared/candidate_nav.js';
import { candidateGroupsFromLabels } from '../../shared/candidate_groups.js';
import { fetchPopstatsGroupwise, stitchTracksFromGroupwise } from './popstats/_live.js';

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

  // Derive shared.activeGroups from the active candidate's locked label
  // vector. The candidate was promoted from the catalogue or the
  // haplotype_regimes page (or local_pca_dosage's K-means lock); whichever
  // producer it came from, the labels live on the candidate by the time
  // popstats sees it. Pushed to the cross-page slot so future consumers
  // (fish_ancestry_scroller, marker_readiness, …) pick up the same
  // partition. None of this overwrites a manually-set groups dict — only
  // fills it when null.
  const derived = candidateGroupsFromLabels(candidate, data, { labelStyle: 'server' });
  if (derived && derived.groups) {
    if (!atlasState.shared.activeGroups
        && typeof atlasState.setActiveGroups === 'function') {
      atlasState.setActiveGroups(derived.groups);
    }
  }

  _mountCandidateNav(root, atlasState, registry);
  renderPopstatsPage({ root, data, candidate, cur });

  // Fire the live POST /api/popstats/groupwise in the background. On
  // success, the per-metric columns get stitched into multi-series tracks
  // on `data.tracks.theta_invgt` / `fst_pairs` / `fst_hom1_hom2` / `dxy_pairs`
  // / etc., then we re-render. Single in-flight per (chrom, groups) signature
  // so navigating back to the page doesn't re-fire if the answer is already
  // in pageState._liveTracks.
  _maybeFetchLivePopstats(root, atlasState, pageState).catch(err =>
    console.warn('popstats: live-groupwise fetch failed —', err));
}

async function _maybeFetchLivePopstats(root, atlasState, pageState) {
  const sh = atlasState.shared || {};
  const groups = sh.activeGroups;
  if (!groups || Object.keys(groups).length < 2) return;

  // Server requires min_group_n=10 per group by default; skip if any group is
  // too small (the server would 400 anyway). Caller can override the floor
  // via a future popstats-config slot.
  const minN = 10;
  for (const g of Object.keys(groups)) {
    if (!Array.isArray(groups[g]) || groups[g].length < minN) return;
  }

  // Dedup: a previous mount with the same chrom + groups signature stashed
  // the response on pageState._liveTracks. Skip the re-fetch.
  const sig = `${pageState.chrom}|${_groupsSig(groups)}`;
  if (pageState._liveSig === sig) return;
  pageState._liveSig = sig;

  let envelope;
  try {
    envelope = await fetchPopstatsGroupwise({
      serverBaseUrl: sh.serverBaseUrl || '',
      chrom:         pageState.chrom,
      groups,
    });
  } catch (e) {
    console.warn('popstats: /api/popstats/groupwise →', e.message);
    return;
  }

  // Splice the per-metric multi-series tracks into data.tracks. The
  // existing auto-discover path in popstats/_tracks.js notices the new
  // names and adopts the static placeholders (theta_invgt / fst_hom1_hom2)
  // so their chips light up + canvases paint as multi-line.
  const stitched = stitchTracksFromGroupwise(envelope);
  if (Object.keys(stitched).length === 0) return;
  pageState.data.tracks = Object.assign({}, pageState.data.tracks || {}, stitched);
  pageState._liveTracks = stitched;

  // Re-render with the enriched data.
  renderPopstatsPage({
    root, data: pageState.data, candidate: pageState.candidate, cur: pageState.cur,
  });
}

function _groupsSig(groups) {
  return Object.keys(groups).sort()
    .map(k => `${k}=${(groups[k] || []).length}`)
    .join(',');
}

/**
 * Insert the prev/next candidate nav bar at the very top of #popstats via the
 * shared cartridge (shared/candidate_nav.js). The cartridge consumes a
 * legacy-shape `state` object — we build one from atlasState — and exposes
 * onNavigate / onClearActive callbacks. Each callback writes back to
 * atlasState via the convenience setters (so prewarm + sibling listeners stay
 * in sync) and re-runs mount() so the bar's counter + breakpoint overlay
 * refresh in one pass.
 */
function _mountCandidateNav(root, atlasState, registry) {
  const page = (root && root.querySelector) ? root.querySelector('#popstats') : null;
  if (!page) return;
  const old = page.querySelector('.cand-nav-inline');
  if (old) old.remove();

  const sh  = atlasState.shared    || {};
  const inv = atlasState.inversion || {};
  const legacyState = {
    candidate:     sh.activeCandidate || null,
    candidateList: inv.candidateList   || [],
    candidatePageMode: inv.candidatePageMode || null,
  };

  const apply = (target) => {
    if (target && target.chrom && target.chrom !== sh.activeChrom) {
      if (typeof atlasState.setActiveChrom === 'function') atlasState.setActiveChrom(target.chrom);
      else atlasState.shared.activeChrom = target.chrom;
    }
    if (typeof atlasState.setActiveCandidate === 'function') {
      atlasState.setActiveCandidate(target);
    } else {
      atlasState.shared.activeCandidate = target;
    }
    mount(root, atlasState, registry).catch(err =>
      console.warn('popstats: re-mount after candidate change threw —', err));
  };

  const bar = renderCandidateNavInline(legacyState, {
    idPrefix:      'ps',
    onNavigate:    (_st, target) => apply(target),
    onClearActive: ()             => apply(null),
  });
  if (bar) page.insertBefore(bar, page.firstChild);
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
