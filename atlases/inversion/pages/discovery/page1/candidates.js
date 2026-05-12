// pages/discovery/page1/candidates.js
//
// Candidate-overlay primitives + refresh helpers (round 4 split, 2026-05-06).
//
// _assignCandidateLanes:   non-overlapping lane layout for the candidate bar.
// _paintCandidateBands:    candidate-aware band paint inside lines panel.
// _ensureCsOverlayIndex:   per-window cached overlay index (which candidate
//                          covers each window).
// drawCandidateBar:        the candidate bar above the |Z| panel.
// refreshBandPickBar / refreshCandidateUI: state-driven UI refreshers.
// _winNavBand / _wRowBand / _drawWRow / _drawWinNavLane: forever-stubs.
//   These four are referenced-but-never-defined in legacy itself (line
//   52173 has a `typeof _winNavBand === "function"` guard proving it).
//   Keeping them stubbed IS legacy parity.
//
// Bodies extracted verbatim from the pre-split page1.js (eighth pass).

import { withAlpha } from '../../../shared/page1_utils.js';
import { getState } from '../../../../../core/atlas_api.js';

import { _pageState, _setActiveState } from './_state.js';
import { drawLinesPanel } from './lines_panel.js';
import { getL2Cluster, groupColor } from './_data.js';
// Note: events.js imports several symbols from this file (mutual cycle),
// but ES live-bindings make this safe at runtime because every reference
// here is from inside a function body invoked AFTER both modules have
// finished evaluating.
import { setCur } from './events.js';
import { drawZ } from './z_panel.js';
import { renderL3Panel } from './l3_panel.js';
import { assignCandidateLanes as _sharedAssignCandidateLanes }
  from '../../../shared/page1_utils.js';

// --- _assignCandidateLanes — re-exported from shared/page1_utils.js ---
// The canonical implementation (legacy lines 32503-32536) lives in shared.
// The underscore-prefixed name is preserved so existing imports in z_panel,
// lines_panel, and this file's own draw helpers keep working unchanged.
export const _assignCandidateLanes = _sharedAssignCandidateLanes;

// --- _paintCandidateBands — legacy lines 33945-33992 ---
export function _paintCandidateBands(ctx, opts) {
  if (!ctx || !opts) return 0;
  const { pad, plotW, plotH, toX, mbMin, mbMax, candidates, chrom } = opts;
  if (!pad || !(plotW > 0) || !(plotH > 0) || typeof toX !== 'function') return 0;
  if (!Array.isArray(candidates) || candidates.length === 0) return 0;
  if (!isFinite(mbMin) || !isFinite(mbMax) || mbMax <= mbMin) return 0;
  const alpha = (typeof opts.alpha === 'number' && isFinite(opts.alpha)) ? opts.alpha : 0.10;

  let painted = 0;
  // Walk candidateList in array order so the leftmost-saved candidate
  // gets idx 0 (yellow) — matches the candidate-strip ordering the
  // user already reads. SPEC §6.3 default.
  let chromIdx = 0;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!c || c.confirmed !== true) continue;
    if (chrom && c.chrom && c.chrom !== chrom) continue;
    const sb = c.start_bp, eb = c.end_bp;
    if (typeof sb !== 'number' || typeof eb !== 'number') continue;
    if (!isFinite(sb) || !isFinite(eb) || eb <= sb) continue;

    const candStartMb = sb / 1e6;
    const candEndMb   = eb / 1e6;
    const visStartMb  = Math.max(candStartMb, mbMin);
    const visEndMb    = Math.min(candEndMb, mbMax);
    if (visEndMb <= visStartMb) {
      // Off-screen: still bump chromIdx so palette assignment stays
      // stable across zoom changes (the user shouldn't see "yellow"
      // jump from candidate 1 to candidate 2 when scrolling).
      chromIdx++;
      continue;
    }
    const xLo = toX(visStartMb);
    const xHi = toX(visEndMb);
    if (!isFinite(xLo) || !isFinite(xHi) || xHi <= xLo) {
      chromIdx++;
      continue;
    }

    ctx.save();
    ctx.fillStyle = _candidateBandColor(chromIdx, alpha);
    ctx.fillRect(xLo, pad.t, xHi - xLo, plotH);
    ctx.restore();
    chromIdx++;
    painted++;
  }
  return painted;
}

// --- _ensureCsOverlayIndex — legacy lines 23741-23818 ---
export function _ensureCsOverlayIndex() {
  const state = _pageState;
  if (state._csOverlayIndex) return state._csOverlayIndex;
  if (!state.data || !state.crossSpecies) return null;
  const cs = state.crossSpecies;
  if (!Array.isArray(cs.breakpoints) || cs.breakpoints.length === 0) return null;
  const chrom = state.data.chrom;
  if (!chrom) return null;
  // Match cs-breakpoints to the loaded chrom. We tolerate exact match or
  // a case-insensitive match on the gar_chr field (the precomp chrom is
  // always Gar reference per project convention).
  const norm = (s) => (typeof s === 'string') ? s.trim() : '';
  const want = norm(chrom).toLowerCase();
  const wins = state.data.windows;
  if (!Array.isArray(wins) || wins.length === 0) return null;

  // Pre-compute a sorted ascending array of window start_bp for binary search
  // (windows are already in genomic order in standard precomp output, but we
  // don't assume — we re-derive). Each window is [start_bp, end_bp); some
  // older precomps use start_bp / end_bp keys, others use start / end.
  const winStart = new Float64Array(wins.length);
  const winEnd   = new Float64Array(wins.length);
  for (let i = 0; i < wins.length; i++) {
    const w = wins[i];
    winStart[i] = (typeof w.start_bp === 'number') ? w.start_bp
                : (typeof w.start === 'number') ? w.start : 0;
    winEnd[i]   = (typeof w.end_bp === 'number') ? w.end_bp
                : (typeof w.end === 'number') ? w.end
                : (winStart[i] + 50000);  // fall-back 50 kb step if absent
  }
  // Binary search: returns the window index that contains pos, or -1 if pos
  // is outside the chrom range. Searches for the largest i with winStart[i]
  // <= pos AND winEnd[i] > pos. If pos beyond last window's end_bp, returns -1.
  const _bpToWindow = (pos) => {
    if (!Number.isFinite(pos)) return -1;
    if (pos < winStart[0]) return -1;
    if (pos >= winEnd[winEnd.length - 1]) return -1;
    let lo = 0, hi = winStart.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (pos < winStart[mid]) {
        hi = mid - 1;
      } else if (pos >= winEnd[mid]) {
        lo = mid + 1;
      } else {
        return mid;
      }
    }
    // Edge case: position fell into a gap between windows. Return the
    // closest preceding window so the overlay still shows roughly there.
    return Math.max(0, Math.min(winStart.length - 1, lo - 1));
  };

  const out = { chrom, bps: [], byWindow: new Map(), bpToWindow: _bpToWindow };
  for (const bp of cs.breakpoints) {
    if (norm(bp.gar_chr).toLowerCase() !== want) continue;
    // Use gar_pos_start as primary anchor (start of breakpoint interval).
    // gar_pos_mb is also available; fall back to it × 1e6 if needed.
    let pos = (typeof bp.gar_pos_start === 'number') ? bp.gar_pos_start
            : (typeof bp.gar_pos_bp === 'number') ? bp.gar_pos_bp
            : (typeof bp.gar_pos_mb === 'number') ? bp.gar_pos_mb * 1e6
            : NaN;
    const wi = _bpToWindow(pos);
    if (wi < 0) continue;
    const entry = {
      id: bp.id,
      win: wi,
      pos_bp: pos,
      mb: pos / 1e6,
      event_type: _csEventTypeOf(bp),
      raw: bp,
    };
    out.bps.push(entry);
    if (!out.byWindow.has(wi)) out.byWindow.set(wi, []);
    out.byWindow.get(wi).push(entry);
  }
  state._csOverlayIndex = out;
  return out;
}

// --- drawCandidateBar — legacy lines 32563-32775 ---
export function drawCandidateBar(ctx, d, toX, y0, h, opts) {
  const state = _pageState;
  opts = opts || {};
  const showStar = opts.showStar !== false;   // default true
  const dimAlpha = opts.dimAlpha != null ? opts.dimAlpha : 1.0;

  if (!d || !Array.isArray(d.windows) || d.windows.length === 0) return;

  const candList = Array.isArray(state.candidateList) ? state.candidateList : [];

  // v4 turn 13 (Deliverable B): lane-stack overlapping candidates. When all
  // candidates are non-overlapping (or empty), n_lanes === 1 and the layout
  // is byte-identical to the pre-v4-turn-13 single-row rendering.
  const layout = _assignCandidateLanes(candList);
  const n_lanes = layout.n_lanes;
  const laneH = h / n_lanes;

  // Faint baseline strip — stays at full bar height regardless of lane count
  ctx.fillStyle = `rgba(160, 168, 180, ${0.10 * dimAlpha})`;
  const xLeft  = toX(d.windows[0].center_mb);
  const xRight = toX(d.windows[d.n_windows - 1].center_mb);
  ctx.fillRect(xLeft, y0, xRight - xLeft, h);

  // Thin lane separators when stacked (1 px dim line between adjacent lanes)
  if (n_lanes > 1) {
    ctx.fillStyle = `rgba(160, 168, 180, ${0.20 * dimAlpha})`;
    for (let i = 1; i < n_lanes; i++) {
      ctx.fillRect(xLeft, y0 + i * laneH - 0.5, xRight - xLeft, 1);
    }
  }

  // Helper: get this candidate's per-lane (y0, h) tuple
  const laneYHt = (c) => {
    const li = layout.assignments.has(c.id) ? layout.assignments.get(c.id) : 0;
    return { yLane: y0 + li * laneH, hLane: laneH };
  };

  // v4 turn 40 (Ask C step 5): two-track helpers. A two-track candidate is
  // one with `tracks.length === 2` AND both tracks have ≥1 active band.
  // Empty track 2 has been dropped at commit (turn 38), so this is exactly
  // what the user means by "this region has overlapping inversions". The
  // cand-strip renders such candidates as two stacked half-height
  // rectangles, each tinted by the track's primary band color. Single-
  // track candidates render unchanged.
  const _isTwoTrack = (c) => {
    return Array.isArray(c.tracks) && c.tracks.length === 2 &&
           c.tracks.every(t => t && Array.isArray(t.active_bands) &&
                               t.active_bands.length > 0);
  };
  // Primary band = first entry in active_bands (sorted at commit, so it's
  // deterministic). Falls back to band 0's color if active_bands is empty.
  const _trackPrimaryColor = (c, trackIdx) => {
    if (!c || !Array.isArray(c.tracks) || !c.tracks[trackIdx]) return null;
    const t = c.tracks[trackIdx];
    if (!Array.isArray(t.active_bands) || t.active_bands.length === 0) return null;
    return groupColor(t.active_bands[0]);
  };

  // Pass 1: pending (grey)
  ctx.fillStyle = `rgba(120, 130, 145, ${0.55 * dimAlpha})`;
  for (const c of candList) {
    if (!c || c.confirmed) continue;
    if (c.start_w == null || c.end_w == null) continue;
    const s0 = Math.max(0, c.start_w);
    const e0 = Math.min(d.n_windows - 1, c.end_w);
    if (s0 > e0) continue;
    const x0 = toX(d.windows[s0].center_mb);
    const x1 = toX(d.windows[e0].center_mb);
    const { yLane, hLane } = laneYHt(c);
    const w = Math.max(2, x1 - x0);
    if (_isTwoTrack(c)) {
      // Two stacked half-height rectangles. Top = track 1, bottom = track 2.
      const halfH = hLane / 2;
      const c1 = _trackPrimaryColor(c, 0);
      const c2 = _trackPrimaryColor(c, 1);
      // Track 1 (top half) — primary band color at pending alpha
      ctx.fillStyle = c1
        ? withAlpha(c1, 0.55 * dimAlpha)
        : `rgba(120, 130, 145, ${0.55 * dimAlpha})`;
      ctx.fillRect(x0, yLane, w, halfH);
      // Track 2 (bottom half)
      ctx.fillStyle = c2
        ? withAlpha(c2, 0.55 * dimAlpha)
        : `rgba(120, 130, 145, ${0.55 * dimAlpha})`;
      ctx.fillRect(x0, yLane + halfH, w, hLane - halfH);
      // 0.5-px hairline between halves so the split is visible at small heights
      ctx.fillStyle = `rgba(40, 45, 55, ${0.65 * dimAlpha})`;
      ctx.fillRect(x0, yLane + halfH - 0.25, w, 0.5);
      // Restore default fill so subsequent single-track pending bars render
      ctx.fillStyle = `rgba(120, 130, 145, ${0.55 * dimAlpha})`;
      continue;
    }
    ctx.fillRect(x0, yLane, w, hLane);
  }

  // Pass 2: confirmed (shiny gold gradient + ★)
  for (const c of candList) {
    if (!c || !c.confirmed) continue;
    if (c.start_w == null || c.end_w == null) continue;
    const s0 = Math.max(0, c.start_w);
    const e0 = Math.min(d.n_windows - 1, c.end_w);
    if (s0 > e0) continue;
    const x0 = toX(d.windows[s0].center_mb);
    const x1 = toX(d.windows[e0].center_mb);
    const w  = Math.max(2, x1 - x0);
    const { yLane, hLane } = laneYHt(c);

    if (_isTwoTrack(c)) {
      // Two-track confirmed: each half filled with its track's primary
      // band color at high alpha, plus a small pale highlight strip near
      // the top of each half (carries over the "shine" signal from the
      // single-track gold gradient). Dark outline and ★ stay the same.
      const halfH = hLane / 2;
      const c1 = _trackPrimaryColor(c, 0) || '#d4a019';
      const c2 = _trackPrimaryColor(c, 1) || '#d4a019';
      // Track 1 (top half)
      ctx.fillStyle = withAlpha(c1, 0.92 * dimAlpha);
      ctx.fillRect(x0, yLane, w, halfH);
      // Pale highlight near top of track 1
      ctx.fillStyle = `rgba(255, 255, 255, ${0.18 * dimAlpha})`;
      ctx.fillRect(x0, yLane, w, Math.max(1, halfH * 0.18));
      // Track 2 (bottom half)
      ctx.fillStyle = withAlpha(c2, 0.92 * dimAlpha);
      ctx.fillRect(x0, yLane + halfH, w, hLane - halfH);
      // Pale highlight near top of track 2
      ctx.fillStyle = `rgba(255, 255, 255, ${0.18 * dimAlpha})`;
      ctx.fillRect(x0, yLane + halfH, w, Math.max(1, (hLane - halfH) * 0.18));
      // Hairline between the two halves
      ctx.fillStyle = `rgba(20, 25, 35, ${0.85 * dimAlpha})`;
      ctx.fillRect(x0, yLane + halfH - 0.25, w, 0.5);
      // Dark outline around the whole rectangle (unchanged from single-track)
      ctx.strokeStyle = `rgba(140, 95, 10, ${0.85 * dimAlpha})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, yLane + 0.5, w - 1, hLane - 1);
      // ★ centered across the full rectangle
      if (showStar && w >= 12 && hLane >= 6) {
        const cx = x0 + w / 2;
        const cy = yLane + hLane / 2 + 0.5;
        const fontPx = Math.min(hLane + 2, Math.max(8, hLane));
        ctx.font = `${fontPx}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = `rgba(20, 25, 35, ${0.75 * dimAlpha})`;
        ctx.fillText('★', cx + 0.6, cy + 0.6);
        ctx.fillStyle = `rgba(255, 250, 230, ${0.98 * dimAlpha})`;
        ctx.fillText('★', cx, cy);
      }
      continue;
    }

    // Vertical gradient — light gold at top, deeper gold at bottom, with
    // a brighter highlight band near the top for the "shiny" feel.
    const grad = ctx.createLinearGradient(0, yLane, 0, yLane + hLane);
    grad.addColorStop(0,    `rgba(255, 230, 130, ${0.95 * dimAlpha})`);  // pale shine
    grad.addColorStop(0.35, `rgba(245, 200, 60,  ${0.95 * dimAlpha})`);  // mid-gold
    grad.addColorStop(1,    `rgba(190, 145, 25,  ${0.95 * dimAlpha})`);  // deep gold
    ctx.fillStyle = grad;
    ctx.fillRect(x0, yLane, w, hLane);

    // Thin warm outline so the gold reads as solid against the panel bg
    ctx.strokeStyle = `rgba(140, 95, 10, ${0.85 * dimAlpha})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, yLane + 0.5, w - 1, hLane - 1);

    // ★ glyph centered in the bar, only if the bar is wide enough
    // to actually display it (≥ 12 px). Drawn in white with a subtle
    // dark drop shadow for legibility against the gold gradient.
    if (showStar && w >= 12 && hLane >= 6) {
      const cx = x0 + w / 2;
      const cy = yLane + hLane / 2 + 0.5;   // +0.5 for visual centering of ★
      const fontPx = Math.min(hLane + 2, Math.max(8, hLane));
      ctx.font = `${fontPx}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Shadow
      ctx.fillStyle = `rgba(80, 50, 0, ${0.55 * dimAlpha})`;
      ctx.fillText('★', cx + 0.6, cy + 0.6);
      // Main glyph
      ctx.fillStyle = `rgba(255, 250, 230, ${0.98 * dimAlpha})`;
      ctx.fillText('★', cx, cy);
    }
  }

  // Pass 3: in-progress draft (state.l3Draft). Amber outline, no fill —
  // signals "you're shaping a candidate but haven't promoted it yet".
  // Sits ON TOP of pending/confirmed bars so the user can see the active
  // edit position even if it overlaps existing candidates.
  // The draft always renders at FULL bar height (across all lanes) so it
  // reads as the active edit, not just one lane.
  if (state.candidateMode && state.l3Draft && Array.isArray(d.l2_envelopes)) {
    const draft = state.l3Draft;
    const lo = d.l2_envelopes[draft.l2_left];
    const hi = d.l2_envelopes[draft.l2_right];
    if (lo && hi) {
      const s0 = Math.max(0, lo._s0);
      const e0 = Math.min(d.n_windows - 1, hi._e0);
      if (s0 <= e0) {
        const x0 = toX(d.windows[s0].center_mb);
        const x1 = toX(d.windows[e0].center_mb);
        const w  = Math.max(2, x1 - x0);
        // v3.67 carryover: red tint when the draft has a verdict warning
        // (one or more L2-to-L2 joins disagree with merge).
        const strokeCol = draft.has_warning
          ? `rgba(224, 85, 92, ${0.95 * dimAlpha})`
          : `rgba(245, 165, 36, ${0.95 * dimAlpha})`;
        ctx.strokeStyle = strokeCol;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 2]);
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
        ctx.setLineDash([]);
      }
    }
  }
}

// =============================================================================
// W-row + window-nav lane (candidate-mode editor lanes)
// =============================================================================
// Layout constants — legacy lines 67977-67980, 68161-68164. Kept in one
// place so drawZ + onZClick agree.
const W_ROW_H_EXPANDED  = 8;
const W_ROW_GAP_EXPANDED = 2;
const W_ROW_H_COLLAPSED = 6;
const W_ROW_GAP_COLLAPSED = 1;
const WIN_NAV_H_EXPANDED  = 6;
const WIN_NAV_GAP_EXPANDED = 2;
const WIN_NAV_H_COLLAPSED = 4;
const WIN_NAV_GAP_COLLAPSED = 1;

// --- _wRowVisible — legacy lines 67986-67988 ---
function _wRowVisible() {
  const state = _pageState;
  return !!(state && state.candidateMode && state.data && Array.isArray(state.data.l2_envelopes));
}

// --- _wRowBand — legacy lines 67993-68002 ---
export function _wRowBand(layoutCtx) {
  if (!_wRowVisible()) return null;
  const collapsed = !!(layoutCtx && layoutCtx.collapsed);
  const wRowH = collapsed ? W_ROW_H_COLLAPSED : W_ROW_H_EXPANDED;
  const wRowGap = collapsed ? W_ROW_GAP_COLLAPSED : W_ROW_GAP_EXPANDED;
  // W-row sits BELOW the L2 zone bar = below (zoneTop + zoneH).
  const y0 = layoutCtx.zoneTop + layoutCtx.zoneH + wRowGap;
  const y1 = y0 + wRowH;
  return { y0, y1, h: wRowH, gap: wRowGap };
}

// --- _winNavVisible — legacy lines 68167-68169 ---
function _winNavVisible() {
  const state = _pageState;
  return !!(state && state.data && Array.isArray(state.data.windows) && state.data.windows.length > 0);
}

// --- _winNavBand — legacy lines 68175-68184 ---
export function _winNavBand(layoutCtx) {
  if (!_winNavVisible()) return null;
  const collapsed = !!(layoutCtx && layoutCtx.collapsed);
  const navH = collapsed ? WIN_NAV_H_COLLAPSED : WIN_NAV_H_EXPANDED;
  const navGap = collapsed ? WIN_NAV_GAP_COLLAPSED : WIN_NAV_GAP_EXPANDED;
  // Nav-lane sits directly below the L2 zone bar.
  const y0 = layoutCtx.zoneTop + layoutCtx.zoneH + navGap;
  const y1 = y0 + navH;
  return { y0, y1, h: navH, gap: navGap };
}

// --- _drawWRow / _drawWinNavLane — drawZ-side helpers ---
// The drawZ-side painters for these lanes haven't been ported yet (they
// need fullsim/Z-panel context: toX, xOfWin, currentMbRange). Once z_panel
// wires them, replace these stubs. Keeping them as null no-ops mirrors
// the pre-port behavior where drawZ ran with these as undefined (the
// candidate-mode UI just rendered without the W-row / nav-lane painted).
export function _drawWRow()      { return; }
export function _drawWinNavLane(){ return; }

// --- _wRowHandleClick — legacy lines 68104-68140 ---
// W-row click handler. Returns true if the click hit the W-row AND was
// handled (extended/shrank the draft span). Otherwise returns false so
// the caller falls through to its default behavior (setCur).
export function _wRowHandleClick(yClick, targetWin, layoutCtx) {
  const state = _pageState;
  const band = _wRowBand(layoutCtx);
  if (!band) return false;
  if (yClick < band.y0 || yClick > band.y1) return false;
  if (!state || !state.candidateMode) return false;
  const d = state.data;
  if (!d) return false;
  // Make sure we have a draft to extend
  const draft = (typeof _ensureL3Draft === 'function') ? _ensureL3Draft() : null;
  if (!draft) return false;
  // First-time flip: stamp start_w/end_w from the current L2 span
  if (draft.resolution !== 'W') {
    const lo = d.l2_envelopes[draft.l2_left];
    const hi = d.l2_envelopes[draft.l2_right];
    if (!lo || !hi) return false;
    draft.resolution = 'W';
    draft.start_w = lo._s0;
    draft.end_w   = hi._e0;
  }
  // Extend or shrink to include the clicked window
  if (targetWin < draft.start_w) {
    draft.start_w = targetWin;
  } else if (targetWin > draft.end_w) {
    draft.end_w = targetWin;
  } else {
    // Click is INSIDE the draft span — interpret as "set the nearer edge
    // to this window". This lets the user pull either edge in toward the
    // click.
    const distLeft  = targetWin - draft.start_w;
    const distRight = draft.end_w - targetWin;
    if (distLeft <= distRight) draft.start_w = targetWin;
    else                       draft.end_w   = targetWin;
  }
  // Repaint
  try { drawZ(state); } catch (_) {}
  try { renderL3Panel(state); } catch (_) {}
  return true;
}

// --- _winNavHandleClick — legacy lines 68240-68246 ---
// Nav-lane click router. If the click landed inside the nav-lane, snap
// state.cur to targetWin and return true.
export function _winNavHandleClick(yClick, targetWin, layoutCtx) {
  const band = _winNavBand(layoutCtx);
  if (!band) return false;
  if (yClick < band.y0 || yClick > band.y1) return false;
  try { setCur(_pageState, targetWin); } catch (_) {}
  return true;
}

// --- refreshBandPickBar(state) — legacy lines 51976-51994 ---
export function refreshBandPickBar(state) {
  const btns = document.querySelectorAll('#bandPickBar button');
  if (btns.length === 0) return;
  let activeStillValid = true;
  btns.forEach(btn => {
    const v = btn.dataset.band;
    if (v === 'all') {
      btn.disabled = false;
      return;
    }
    const k = parseInt(v, 10);
    const valid = k >= 0 && k < state.k;
    btn.disabled = !valid;
    if (!valid && btn.classList.contains('active')) activeStillValid = false;
  });
  if (!activeStillValid) {
    btns.forEach(b => b.classList.remove('active'));
    const allBtn = document.querySelector('#bandPickBar button[data-band="all"]');
    if (allBtn) allBtn.classList.add('active');
  }
}

// =====================================================================
// Cross-species breakpoint helpers (legacy lines 23721, 23836-23882)
// =====================================================================
// Used by sim_mat / Z / lines-panel click handlers to route a click that
// lands near a cs-breakpoint marker to setCur(bp.win) instead of the
// generic x-axis fallback. `_csBpJumpToWindow` lives in events.js
// (it needs setCur, which would create a circular import here).

// --- _csEventTypeOf — legacy lines 23721-23724 ---
// Also referenced (previously undefined) inside _ensureCsOverlayIndex above.
export function _csEventTypeOf(bp) {
  return bp.event_type_refined || bp.event_type || 'unknown';
}

// Hit tolerance ≈ visual "thickness" of the dashed line so the user
// doesn't need to land pixel-perfect on a thin overlay.
export const _CS_BP_HIT_TOL_PX = 4;

// --- _csBpHitTestXFromList — legacy lines 23851-23863 ---
// 1-D x-axis hit test. Caller supplies bpToX(bp) -> number|null to project
// each bp to the same x position the renderer used.
export function _csBpHitTestXFromList(bps, clickX, tolerancePx, bpToX) {
  if (!Array.isArray(bps) || bps.length === 0) return null;
  if (typeof bpToX !== 'function') return null;
  const tol = (tolerancePx != null) ? tolerancePx : _CS_BP_HIT_TOL_PX;
  let bestBp = null, bestDx = tol + 0.001;
  for (const bp of bps) {
    const xx = bpToX(bp);
    if (!Number.isFinite(xx)) continue;
    const dx = Math.abs(xx - clickX);
    if (dx < bestDx) { bestDx = dx; bestBp = bp; }
  }
  return bestBp;
}

// --- _csBpHitTest2D — legacy lines 23868-23882 ---
// 2-D hit test for the sim_mat red-cross overlay on the diagonal.
export function _csBpHitTest2D(bps, clickX, clickY, bpToXY, tolerancePx) {
  if (!Array.isArray(bps) || bps.length === 0) return null;
  if (typeof bpToXY !== 'function') return null;
  const tol = (tolerancePx != null) ? tolerancePx : _CS_BP_HIT_TOL_PX;
  const tol2 = tol * tol;
  let bestBp = null, bestD2 = tol2 + 0.001;
  for (const bp of bps) {
    const xy = bpToXY(bp);
    if (!xy || !Number.isFinite(xy.x) || !Number.isFinite(xy.y)) continue;
    const dx = xy.x - clickX, dy = xy.y - clickY;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; bestBp = bp; }
  }
  return bestBp;
}

// =====================================================================
// _candidateAtClick — legacy lines 32543-32561
// =====================================================================
// Hit-tests a click against the lane-stacked candidate-bar. Returns the
// candidate object whose [start_w, end_w] × lane row contains the click,
// or null.
export function _candidateAtClick(x, y, y0, h_total, toX, d) {
  const state = _pageState;
  const candList = Array.isArray(state.candidateList) ? state.candidateList : [];
  if (candList.length === 0) return null;
  if (!d || !Array.isArray(d.windows)) return null;
  const layout = _assignCandidateLanes(candList);
  if (y < y0 || y > y0 + h_total) return null;
  const laneH = h_total / Math.max(1, layout.n_lanes);
  const laneIdx = Math.floor((y - y0) / laneH);
  if (laneIdx < 0 || laneIdx >= layout.n_lanes) return null;
  for (const c of candList) {
    if (!c || c.start_w == null || c.end_w == null) continue;
    if (layout.assignments.get(c.id) !== laneIdx) continue;
    const x0 = toX(d.windows[c.start_w].center_mb);
    const x1 = toX(d.windows[c.end_w].center_mb);
    if (x >= x0 && x <= x1) return c;
  }
  return null;
}

// =====================================================================
// Lines-panel candidate band palette (legacy lines 33879-33916)
// =====================================================================
// Referenced (previously undefined) inside _paintCandidateBands above.
const _LINES_CAND_BAND_PALETTE = ['#F5C518', '#4CAF50', '#3B82F6'];

// --- _candidateBandColor — legacy lines 33887-33916 ---
// First three indices use the canonical palette; idx >= 3 cycles via a
// golden-angle HSL rotation anchored at blue's hue.
export function _candidateBandColor(idx, alpha) {
  if (typeof idx !== 'number' || !isFinite(idx) || idx < 0) idx = 0;
  idx = Math.floor(idx);
  if (typeof alpha !== 'number' || !isFinite(alpha)) alpha = 0.10;
  if (alpha < 0) alpha = 0;
  if (alpha > 1) alpha = 1;
  if (idx < _LINES_CAND_BAND_PALETTE.length) {
    const hex = _LINES_CAND_BAND_PALETTE[idx];
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  const baseHue = 217;
  const step    = 137.5;
  const hue     = (baseHue + (idx - _LINES_CAND_BAND_PALETTE.length + 1) * step) % 360;
  return `hsla(${hue.toFixed(1)},60%,55%,${alpha})`;
}

// --- refreshCandidateUI(state) — legacy lines 57582-57617 ---
export function refreshCandidateUI(state) {
  // Update the page2 tab to show a small dot when a candidate is active
  const tabBtn = document.querySelector('#tabBar button[data-page="page2"]');
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
  // Render the page 2 metadata block (page2-territory; guarded — page2 may
  // not be loaded under the new shell when page1 mounts).
  if (typeof renderCandidateMetadata === 'function') {
    try { renderCandidateMetadata(state); } catch (_) {}
  }
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
  try { drawLinesPanel(state); } catch (e) {}
}

// =============================================================================
// Candidate state machine — promoteCandidate flow
// =============================================================================
// Two creation paths converge on the same canonical shape. Each path computes
// the band reference (ref_l2, K, locked_labels), the genomic span, and a source
// tag. The candidate is cleared on chromosome switch (cross-chrom labels are
// meaningless). Only one active candidate at a time.
//
// Verbatim port from legacy lines 56787-57619, 66147-66209.

// --- makeCandidateId — legacy lines 56789-56794 ---
// Unique id generator. Timestamp + random suffix is sufficient for our use case
// (candidates created within ms of each other still get distinct ids).
let _candIdCounter = 0;
export function makeCandidateId() {
  _candIdCounter++;
  return 'cand_' + Date.now().toString(36) + '_' + _candIdCounter.toString(36) +
         '_' + Math.random().toString(36).slice(2, 6);
}

// --- _CAND_STORAGE_PREFIX + _candStorageKey ---
const _CAND_STORAGE_PREFIX = 'pca_scrubber_v3.candidates.';
function _candStorageKey(chrom) {
  return _CAND_STORAGE_PREFIX + (chrom || '_unknown');
}

// --- isInCandidateList — legacy lines 57409-57411 ---
export function isInCandidateList(id) {
  const state = _pageState;
  if (!state || !Array.isArray(state.candidateList)) return false;
  return state.candidateList.some(c => c.id === id);
}

// --- loadCandidateList — legacy lines 57345-57392 ---
// Restore state.candidateList from localStorage for the active chrom.
// Also restores state.candidate from the active-candidate ID so reloads
// preserve focus.
export function loadCandidateList(state) {
  state = state || _pageState;
  _setActiveState(state);
  if (!state || !state.data) { if (state) state.candidateList = []; return; }
  try {
    const key = _candStorageKey(state.data.chrom);
    const raw = localStorage.getItem(key);
    if (!raw) { state.candidateList = []; return; }
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) { state.candidateList = []; return; }
    state.candidateList = arr.map(candidateFromJSON).filter(Boolean);
  } catch (e) {
    console.warn('[candidate] load failed:', e.message);
    state.candidateList = [];
  }
  // v4 turn 56: restore the active candidate from localStorage if its ID
  // matches an entry we just loaded.
  if (state.candidateList.length > 0) {
    try {
      const savedId = localStorage.getItem('pca_scrubber_v3.activeCandidateId');
      if (savedId) {
        const hit = state.candidateList.find(c => c && c.id === savedId);
        if (hit) {
          // Deep clone via JSON round-trip so the saved-list entry stays
          // separate from the active candidate.
          state.candidate = candidateFromJSON(candidateToJSON(hit));
          // Same atlas-core bridge as setCandidate(): on cold-start the
          // page restores its private state from localStorage, but every
          // other page reads atlasState.shared.activeCandidate. Without
          // this call they'd see null until the user re-promotes.
          try {
            const sh = getState();
            if (sh && typeof sh.setActiveCandidate === 'function') sh.setActiveCandidate(state.candidate);
          } catch (_) {}
        }
      }
    } catch (_) { /* fail-soft */ }
  }
  // turn 129: F5/cold-start path doesn't go through persistCandidateList(),
  // so the registry bridge has to be called explicitly here.
  if (typeof _rebuildCandidateRegistries === 'function') {
    try { _rebuildCandidateRegistries(); } catch (_) {}
  }
}

// --- candidateToJSON / candidateFromJSON ---
// Minimal JSON roundtrip — locked_labels needs to survive as Int8Array,
// everything else is plain serializable.
function candidateToJSON(cand) {
  if (!cand) return null;
  const out = { ...cand };
  if (cand.locked_labels instanceof Int8Array) {
    out.locked_labels = Array.from(cand.locked_labels);
  }
  return out;
}
function candidateFromJSON(obj) {
  if (!obj) return null;
  const out = { ...obj };
  if (Array.isArray(obj.locked_labels)) {
    out.locked_labels = new Int8Array(obj.locked_labels);
  }
  return out;
}

// --- persistCandidateList — legacy lines 57310-57343 ---
export function persistCandidateList(state) {
  state = state || _pageState;
  if (!state || !state.data) return;
  // turn 129: keep state.candidates (dict, read by inheritance compute)
  // in sync with state.candidateList (array, mutated by every UI surface).
  if (typeof _rebuildCandidateRegistries === 'function') {
    try { _rebuildCandidateRegistries(); } catch (_) {}
  }
  // turn 153: candidate-list mutations are the canonical trigger for
  // inheritance recompute. Cheap (one O(N) hash); idempotent.
  if (typeof _autoRegisterInheritanceOnCandidateChange === 'function') {
    try { _autoRegisterInheritanceOnCandidateChange(); } catch (_) {}
  }
  try {
    const key = _candStorageKey(state.data.chrom);
    const arr = (state.candidateList || []).map(candidateToJSON);
    localStorage.setItem(key, JSON.stringify(arr));
  } catch (e) {
    // localStorage may be unavailable (private mode, quota exceeded, etc.).
    // We surface the failure but don't crash — the list still works in memory.
    console.warn('[candidate] persist failed:', e.message);
  }
}

// --- addCandidateToList — legacy lines 57413-57420 ---
export function addCandidateToList(state, cand) {
  state = state || _pageState;
  if (!cand || !cand.id) return;
  if (isInCandidateList(cand.id)) return;   // already there
  if (!Array.isArray(state.candidateList)) state.candidateList = [];
  state.candidateList.push(cand);
  persistCandidateList(state);
  if (typeof refreshCandidateListUI === 'function') {
    try { refreshCandidateListUI(); } catch (_) {}
  }
  refreshCandidateUI(state);
}

// --- makeCandidateFromLock — legacy lines 57533-57560 ---
// Path B: user is on page 1 with colors locked at some L2.
// Use that L2 as the candidate reference.
export function makeCandidateFromLock(state) {
  state = state || _pageState;
  _setActiveState(state);
  const d = state && state.data;
  if (!d || !state.lockedLabels || state.lockedRefL2 == null) return null;
  const refIdx = state.lockedRefL2;
  const env = d.l2_envelopes && d.l2_envelopes[refIdx];
  if (!env) return null;
  const cl = getL2Cluster(state, refIdx);
  // K from the snapshot, fall back to current state.k
  const K = cl && cl.usedK != null ? cl.usedK : state.k;
  return {
    source: 'lock_promote',
    chrom: d.chrom,
    l2_indices: [refIdx],
    ref_l2: refIdx,
    ref_window: state.cur,    // the window the user was viewing when they promoted
    K,
    locked_labels: new Int8Array(state.lockedLabels),
    start_w: env._s0,
    end_w: env._e0,
    start_bp: env.start_bp,
    end_bp: env.end_bp,
    created_at: Date.now(),
    notes: '',
    id: makeCandidateId(),
  };
}

// --- setCandidate — legacy lines 57562-57566 ---
// Promote-flow completion: stores the candidate, adds it to the list,
// persists, and fans out the UI refresh.
export function setCandidate(state, cand) {
  state = state || _pageState;
  _setActiveState(state);
  if (!cand) return;
  state.candidate = cand;
  // Bridge into atlas-core so the registry's prewarm scheduler and every
  // other page subscribed to shared.activeCandidate.changed see the
  // selection. Without this call the choice is page1-private and the rest
  // of the system only learns about it on the next page mount + reload.
  // See atlas-core/docs/ARCHITECTURE.md and REGISTRY_GUIDE.md.
  try {
    const sh = getState();
    if (sh && typeof sh.setActiveCandidate === 'function') sh.setActiveCandidate(cand);
  } catch (_) {}
  // Persist the active candidate id so reloads can restore focus.
  // _persistActiveCandidate lives in events.js but the localStorage write
  // here is idempotent — duplicating it avoids a circular import.
  try { localStorage.setItem('pca_scrubber_v3.activeCandidateId', cand.id || ''); }
  catch (_) {}
  // Also add it to the saved list so the candidate-bar reflects the new
  // candidate immediately (legacy did this implicitly via the promote
  // button handler calling addCandidateToList before setCandidate, but
  // routing through here is simpler).
  if (!isInCandidateList(cand.id)) {
    addCandidateToList(state, cand);
  } else {
    refreshCandidateUI(state);
  }
}

// --- buildKLabelsTSV — legacy lines 66147-66187 ---
// One row per (L2, sample) pair. The C++ engine groups samples by
// k_label_fixed (always at state.k = uniform K across all L2s, supports
// cross-L2 pop-stats) or by k_label (adaptive K, per-L2 natural clustering).
export function buildKLabelsTSV(state) {
  state = state || _pageState;
  _setActiveState(state);
  const d = state && state.data;
  if (!d || !d.l2_envelopes) return null;
  const cols = [
    'chrom', 'l2_id', 'l2_idx', 'l2_start_bp', 'l2_end_bp', 'l2_n_windows',
    'ind', 'cga', 'family_id',
    'k_used', 'k_label', 'k_label_fixed', 'silhouette',
    'fam_purity', 'coherence', 'cluster_ok'
  ];
  const lines = [cols.join('\t')];
  for (let l2idx = 0; l2idx < d.l2_envelopes.length; l2idx++) {
    const env = d.l2_envelopes[l2idx];
    const cl = getL2Cluster(state, l2idx);
    if (!cl) continue;
    const labels = cl.labels;                          // adaptive (or fixed) K labels
    const labelsFx = cl.fixedKLabels || cl.labels;    // always state.k labels
    for (let si = 0; si < d.n_samples; si++) {
      const s = d.samples[si];
      const row = [
        d.chrom,
        env.candidate_id || `L2_${l2idx}`,
        l2idx,
        env.start_bp,
        env.end_bp,
        cl.nW,
        s.ind || `Ind${si}`,
        s.cga || '',
        s.family_id != null ? s.family_id : -1,
        cl.usedK != null ? cl.usedK : state.k,
        labels && labels[si] != null ? labels[si] : '',
        labelsFx && labelsFx[si] != null ? labelsFx[si] : '',
        cl.silhouette != null && isFinite(cl.silhouette) ? cl.silhouette.toFixed(4) : 'NA',
        cl.fam_purity != null && isFinite(cl.fam_purity) ? cl.fam_purity.toFixed(4) : 'NA',
        cl.coherence != null && isFinite(cl.coherence) ? cl.coherence.toFixed(4) : 'NA',
        cl.ok ? '1' : '0',
      ];
      lines.push(row.join('\t'));
    }
  }
  return lines.join('\n');
}

// --- exportKLabelsTSV — legacy lines 66189-66209 ---
// Click handler body for #exportKLabelsBtn. Downloads
// `<chrom>_L2_K_labels.tsv` with the per-(L2, sample) K-means labels.
export function exportKLabelsTSV(state) {
  state = state || _pageState;
  _setActiveState(state);
  const tsv = buildKLabelsTSV(state);
  if (!tsv) {
    if (typeof alert === 'function') alert('No data loaded — load a JSON first');
    return;
  }
  const chrom = (state.data && state.data.chrom) || 'chr';
  const fname = `${chrom}_L2_K_labels.tsv`;
  const blob = new Blob([tsv], { type: 'text/tab-separated-values' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
