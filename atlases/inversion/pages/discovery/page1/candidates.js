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

import { _pageState } from './_state.js';
import { drawLinesPanel } from './lines_panel.js';

// --- _assignCandidateLanes — legacy lines 32503-32536 ---
export function _assignCandidateLanes(candList) {
  if (!Array.isArray(candList) || candList.length === 0) {
    return { assignments: new Map(), n_lanes: 1 };
  }
  // Sort a copy by start_w (then by id for stable order on ties)
  const sorted = candList.slice().filter(c => c && c.start_w != null && c.end_w != null)
    .sort((a, b) => {
      if (a.start_w !== b.start_w) return a.start_w - b.start_w;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  // lanes[i] = end_w of last candidate placed in lane i; -Infinity = lane unused
  const lanes = [];
  const assignments = new Map();
  for (const c of sorted) {
    let placed = -1;
    for (let i = 0; i < lanes.length; i++) {
      // Strict overlap test: this candidate's start_w must be > last lane's
      // end_w. If start_w === end_w of previous, they touch but don't overlap;
      // we reuse the lane (same as L1/L2 rendering convention which uses _s0
      // and _e0 as inclusive endpoints).
      if (c.start_w > lanes[i]) {
        lanes[i] = c.end_w;
        placed = i;
        break;
      }
    }
    if (placed < 0) {
      lanes.push(c.end_w);
      placed = lanes.length - 1;
    }
    assignments.set(c.id, placed);
  }
  return { assignments, n_lanes: Math.max(1, lanes.length) };
}

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
    return (typeof groupColor === 'function') ? groupColor(t.active_bands[0]) : null;
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

// --- _winNavBand / _wRowBand / _drawWRow / _drawWinNavLane ---
// Referenced-but-never-defined in legacy. legacy line 52173 explicitly
// has a `typeof _winNavBand === "function"` guard, confirming legacy
// itself ran with these as undefined. Keep stubbed.
export function _winNavBand()    { return null; }

export function _wRowBand()      { return null; }

export function _drawWRow()      { return; }

export function _drawWinNavLane(){ return; }

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
  if (typeof drawLinesPanel === 'function') {
    try { drawLinesPanel(state); } catch (e) {}
  }
}
