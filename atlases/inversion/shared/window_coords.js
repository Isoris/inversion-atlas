// shared/window_coords.js
//
// Window-coordinate math. Today: bsearchWin (binary-search a sorted
// per-window bp array). Future: bp↔win converters, win-range
// intersections, etc.
//
// Legacy origin: _bsearchWin at line 17785 of legacy/Inversion_atlas.html.

/**
 * Binary-search a sorted ascending bp array for the index whose
 * value brackets `target`.
 *
 *   mode='lo': first index whose arr[i] >= target
 *              (returns arr.length when target > all values)
 *   mode='hi': last  index whose arr[i] <= target
 *              (returns -1 when target < all values)
 *
 * Handles empty arrays gracefully (lo → 0, hi → -1). Accepts both
 * regular Arrays and TypedArrays.
 *
 * @param {Array<number>|TypedArray} arr
 * @param {number} target
 * @param {'lo'|'hi'} mode
 * @returns {number}
 */
export function bsearchWin(arr, target, mode) {
  if (!arr || arr.length === 0) return mode === 'lo' ? 0 : -1;
  let lo = 0, hi = arr.length - 1;
  if (mode === 'lo') {
    if (target <= arr[0]) return 0;
    if (target > arr[hi]) return arr.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (arr[m] >= target) hi = m;
      else lo = m + 1;
    }
    return lo;
  }
  // 'hi' (default for anything not 'lo')
  if (target < arr[0]) return -1;
  if (target >= arr[hi]) return hi;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (arr[m] <= target) lo = m;
    else hi = m - 1;
  }
  return lo;
}
