// shared/pc_accessors.js
//
// Per-window PC vector accessors (legacy lines 9951-10043). Pure
// readers that resolve the appropriate axis array out of a window
// object and respect the PC1 sign-flip rule for canonical orientation.
//
// IMPORTANT (carried from legacy header): getPC stays PC1×PC2 forever
// — analytics paths (k-means on bands, sample identity scoring,
// inv_likeness) all use PC1 as the canonical axis. The getPCByAxis /
// getPCRender helpers are for RENDERING only. Changing the PCA-display
// axis must NOT change the underlying classification labels — it just
// changes what the user sees.

/** Canonical PC axis names supported by the precomp + UI. */
export const PC_AXES = Object.freeze(['pc1', 'pc2', 'pc3', 'pc4']);

// =====================================================================
// Single-window PC1×PC2 accessor (analytics path)
// =====================================================================

/**
 * Resolve a window's canonical (pc1, pc2, sign) bundle. Used by every
 * analytics path that needs PC1-as-canonical-axis. The `sign` field
 * stays the legacy PC1-only flip (analytics consumers downstream
 * already encode "multiply pc1 by sign" semantics). The new `sign2`
 * field carries the same per-window flip for PC2 — added 2026-05-27;
 * the legacy callers that destructure {pc1, pc2, sign} keep working
 * unchanged.
 *
 * Returns null when the window is missing.
 *
 * @param {Object} state
 * @param {number} winIdx
 * @returns {{pc1:ArrayLike<number>, pc2:ArrayLike<number>,
 *            sign:number, sign2:number}|null}
 */
export function getPC(state, winIdx) {
  if (!state || !state.data || !Array.isArray(state.data.windows)) return null;
  const w = state.data.windows[winIdx];
  if (!w) return null;
  const sign  = (state.flipPC1 && state.pc1Sign && Number.isInteger(winIdx))
    ? (state.pc1Sign[winIdx] || 1) : 1;
  const sign2 = (state.flipPC2 && state.pc2Sign && Number.isInteger(winIdx))
    ? (state.pc2Sign[winIdx] || 1) : 1;
  return { pc1: w.pc1, pc2: w.pc2, sign, sign2 };
}

// =====================================================================
// Per-window per-axis (render path)
// =====================================================================

/**
 * Return the list of canonical PC axes the current data provides.
 * Probes windows[0] for `pc1`..`pc4`; always returns at least
 * ['pc1', 'pc2'] (legacy guarantee — the UI uses these as the
 * fallback pair when data is unloaded).
 *
 * @param {Object} state
 * @returns {Array<string>}
 */
export function availablePCs(state) {
  if (!state || !state.data || !Array.isArray(state.data.windows)
      || state.data.windows.length === 0) {
    return ['pc1', 'pc2'];
  }
  const w0 = state.data.windows[0];
  const out = [];
  for (const k of PC_AXES) {
    if (w0 && Array.isArray(w0[k]) && w0[k].length > 0) out.push(k);
  }
  if (out.length === 0) return ['pc1', 'pc2'];
  if (out.length === 1 && out[0] === 'pc1') return ['pc1', 'pc2'];
  return out;
}

/**
 * Per-window per-axis accessor. Returns the raw PC array for that
 * axis, or null when the window / axis is missing.
 *
 * No sign-flip is applied here — callers that draw PC1 should flip
 * via state.pc1Sign[winIdx] themselves (see getPCRender).
 *
 * @param {Object} state
 * @param {number} winIdx
 * @param {string} axis  one of 'pc1'..'pc4'
 * @returns {ArrayLike<number>|null}
 */
export function getPCByAxis(state, winIdx, axis) {
  if (!state || !state.data || !Array.isArray(state.data.windows)) return null;
  const w = state.data.windows[winIdx];
  if (!w) return null;
  const v = w[axis];
  return Array.isArray(v) ? v : null;
}

/**
 * Render-path accessor: returns `{ x, y, signX, signY, axisX, axisY }`
 * for the PCA scatter plot. 2026-05-27: now applies the per-window
 * sign-flip to **both** PC1 and PC2 (was PC1-only). PC2's eigenvector
 * sign is just as arbitrary as PC1's; without the parallel align,
 * PC2-as-Y in the scatter and PC2-on-lines-panel both X-braided
 * independently of PC1.
 *
 * @param {Object} state
 * @param {number} winIdx
 * @param {string?} axisX  defaults to 'pc1'
 * @param {string?} axisY  defaults to 'pc2'
 * @returns {Object}
 */
export function getPCRender(state, winIdx, axisX, axisY) {
  const aX = axisX || 'pc1';
  const aY = axisY || 'pc2';
  const x = getPCByAxis(state, winIdx, aX);
  const y = getPCByAxis(state, winIdx, aY);
  const signFor = (axis) => {
    if (!state || !Number.isInteger(winIdx)) return 1;
    if (axis === 'pc1') {
      return (state.flipPC1 && state.pc1Sign) ? (state.pc1Sign[winIdx] || 1) : 1;
    }
    if (axis === 'pc2') {
      return (state.flipPC2 && state.pc2Sign) ? (state.pc2Sign[winIdx] || 1) : 1;
    }
    return 1;
  };
  return {
    x, y,
    signX: signFor(aX),
    signY: signFor(aY),
    axisX: aX, axisY: aY,
  };
}

// =====================================================================
// viewControls persistence
// =====================================================================

/** localStorage key for the persisted viewControls struct. */
export const VIEW_CONTROLS_STORAGE_KEY = 'scrubber_v3_viewControls';

function _safeLocalStorage() {
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

/**
 * Persist `state.viewControls` to localStorage. Fail-soft.
 *
 * @param {Object} state
 * @param {{localStorage?:Storage}} opts
 */
export function saveViewControls(state, opts) {
  if (!state || !state.viewControls) return;
  const ls = (opts && opts.localStorage) || _safeLocalStorage();
  if (!ls) return;
  try {
    ls.setItem(VIEW_CONTROLS_STORAGE_KEY, JSON.stringify(state.viewControls));
  } catch (_) { /* fail-soft */ }
}

/**
 * Restore `state.viewControls` from localStorage. Validates the
 * shape before assigning each field (so corrupt LS entries fall back
 * to in-memory defaults). Fields handled:
 *
 *   - pcaXY: 2-tuple of axis names with axes[0] !== axes[1]
 *   - linesYsources: array of strings (length ≥ 1)
 *   - linked: boolean
 *
 * @param {Object} state
 * @param {{localStorage?:Storage}} opts
 */
export function loadViewControls(state, opts) {
  if (!state) return;
  const ls = (opts && opts.localStorage) || _safeLocalStorage();
  if (!ls) return;
  try {
    const raw = ls.getItem(VIEW_CONTROLS_STORAGE_KEY);
    if (!raw) return;
    const v = JSON.parse(raw);
    if (!state.viewControls) state.viewControls = {};
    if (Array.isArray(v.pcaXY) && v.pcaXY.length === 2 &&
        typeof v.pcaXY[0] === 'string' && typeof v.pcaXY[1] === 'string' &&
        v.pcaXY[0] !== v.pcaXY[1]) {
      state.viewControls.pcaXY = v.pcaXY.slice();
    }
    if (Array.isArray(v.linesYsources) && v.linesYsources.length >= 1 &&
        v.linesYsources.every(s => typeof s === 'string')) {
      state.viewControls.linesYsources = v.linesYsources.slice();
    }
    if (typeof v.linked === 'boolean') state.viewControls.linked = v.linked;
  } catch (_) { /* fail-soft */ }
}

/**
 * Coerce viewControls.pcaXY to validity given the currently-available
 * PCs. If a referenced axis isn't in the current data (e.g. user had
 * PC3 selected and loaded a PC2-only dataset), fall back to PC1×PC2.
 *
 * @param {Object} state
 */
export function reconcileViewControlsForData(state) {
  if (!state || !state.viewControls) return;
  const avail = availablePCs(state);
  const isPCAxis = (s) => /^pc[1-4]$/.test(s);
  const xy = state.viewControls.pcaXY;
  if (!Array.isArray(xy) || xy.length !== 2
      || !isPCAxis(xy[0]) || !isPCAxis(xy[1]) || xy[0] === xy[1]
      || avail.indexOf(xy[0]) < 0 || avail.indexOf(xy[1]) < 0) {
    state.viewControls.pcaXY = ['pc1', 'pc2'];
  }
}
