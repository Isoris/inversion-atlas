// shared/candidate_lanes.js
//
// Pure lane-stacking helper for candidate bars (legacy lines 32503-32562:
// _assignCandidateLanes + _candidateAtClick). The Z panel + local_pca_dosage
// candidate-strip stack overlapping candidates into vertical lanes so
// every candidate gets its own un-clobbered rectangle.
//
// All compute is pure: caller passes the candidate list explicitly.

/**
 * Assign each candidate to a vertical lane such that overlapping
 * candidates land in distinct lanes. Greedy first-fit: walk
 * candidates in (start_w, id) ascending order, place each into the
 * first lane whose last-placed candidate ended before this one
 * starts (strict `start_w > previous.end_w`; touching candidates
 * reuse the lane).
 *
 * Returns:
 *   { assignments: Map<id, laneIdx>, n_lanes }
 *
 * Candidates lacking start_w / end_w are silently skipped (matches
 * legacy filter).
 *
 * Pure: never mutates the input list.
 *
 * @param {Array<{id, start_w, end_w}>} candList
 * @returns {{assignments:Map, n_lanes:number}}
 */
export function assignCandidateLanes(candList) {
  if (!Array.isArray(candList) || candList.length === 0) {
    return { assignments: new Map(), n_lanes: 1 };
  }
  const sorted = candList.slice()
    .filter(c => c && Number.isInteger(c.start_w) && Number.isInteger(c.end_w))
    .sort((a, b) => {
      if (a.start_w !== b.start_w) return a.start_w - b.start_w;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  const lanes = [];
  const assignments = new Map();
  for (const c of sorted) {
    let placed = -1;
    for (let i = 0; i < lanes.length; i++) {
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

/**
 * Hit-test for a click on the candidate bar in 2D. Returns the
 * candidate whose lane the click landed in (the topmost match if
 * multiple overlap the click x), or null if the click is outside the
 * bar region / not inside any candidate.
 *
 * Pure given candList + the toX (mb → px) projection + a per-window
 * grid lookup. The bar geometry is supplied as y0 + h_total + toX.
 *
 * @param {number} x        canvas x-coord of the click
 * @param {number} y        canvas y-coord
 * @param {number} y0       top of the candidate bar region
 * @param {number} h_total  total bar height (n_lanes × per-lane)
 * @param {Function} toX    (centerMb:number) → px:number
 * @param {Array<{id, start_w, end_w}>} candList
 * @param {Array<{center_mb:number}>} windows  state.data.windows
 * @returns {Object|null}   the hit candidate, or null
 */
export function candidateAtClick(x, y, y0, h_total, toX, candList, windows) {
  if (!Array.isArray(candList) || candList.length === 0) return null;
  if (!Array.isArray(windows) || windows.length === 0) return null;
  if (typeof toX !== 'function') return null;
  const layout = assignCandidateLanes(candList);
  if (y < y0 || y > y0 + h_total) return null;
  const laneH = h_total / Math.max(1, layout.n_lanes);
  const laneIdx = Math.floor((y - y0) / laneH);
  if (laneIdx < 0 || laneIdx >= layout.n_lanes) return null;
  for (const c of candList) {
    if (!c || !Number.isInteger(c.start_w) || !Number.isInteger(c.end_w)) continue;
    if (layout.assignments.get(c.id) !== laneIdx) continue;
    const wS = windows[c.start_w];
    const wE = windows[c.end_w];
    if (!wS || !wE || !Number.isFinite(wS.center_mb) || !Number.isFinite(wE.center_mb)) continue;
    const x0 = toX(wS.center_mb);
    const x1 = toX(wE.center_mb);
    if (x >= x0 && x <= x1) return c;
  }
  return null;
}
