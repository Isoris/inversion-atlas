// shared/candidate_nav.js
//
// Cross-page candidate-navigation helpers (legacy lines 58552-58590 +
// 59653-59745). The inline nav bar [‹ prev] [active] [next ›] [🌍] is
// used by karyotype_tier / popstats / ancestry_per_window / boundary_refinement. Page2's candidate focus has
// its own richer nav with confirm-toggle and isn't covered here.
//
// Public entries:
//   candidateListSortedByPos(state) : pure, sort by start_bp asc;
//                                     filters by `confirmed` when
//                                     state.candidatePageMode is 'confirmed'
//   candidateListIndexOf(state, c)  : pure index lookup
//   candidateListClosestIndex(state, c) : nearest-by-midpoint fallback
//   renderCandidateNavInline(state, opts) : DOM <div> element
//   buildCandidateNavHtml(state, opts)    : pure HTML string (testable
//                                            without document)
//   navHandlersFor(state, opts)     : pure { onPrev, onNext, onGenome }
//                                     trio for caller-driven wiring

function _escape(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// =====================================================================
// Sorted list + index helpers
// =====================================================================

/**
 * Return state.candidateList sorted by start_bp ascending. When
 * `state.candidatePageMode === 'confirmed'`, only confirmed candidates
 * are included (matches legacy page-8 behaviour).
 *
 * Pure: never mutates state.candidateList; returns a new array.
 *
 * @param {Object} state
 * @returns {Array<Object>}
 */
export function candidateListSortedByPos(state) {
  if (!state || !Array.isArray(state.candidateList)) return [];
  let list = state.candidateList.slice();
  if (state.candidatePageMode === 'confirmed') {
    list = list.filter(c => c && c.confirmed);
  }
  return list.sort((a, b) => {
    const aS = Number.isFinite(a.start_bp) ? a.start_bp : Infinity;
    const bS = Number.isFinite(b.start_bp) ? b.start_bp : Infinity;
    return aS - bS;
  });
}

/**
 * Index of candidate `c` in the sorted list (matching by `.id`).
 * Returns -1 when not found or no candidate given.
 *
 * @param {Object} state
 * @param {Object?} c
 * @returns {number}
 */
export function candidateListIndexOf(state, c) {
  if (!c) return -1;
  const sorted = candidateListSortedByPos(state);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] && sorted[i].id === c.id) return i;
  }
  return -1;
}

/**
 * Closest sorted-list index by midpoint of `c`. Used when `c` is not in
 * state.candidateList (off-list candidate); the prev/next buttons still
 * have a sensible meaning relative to position. Returns -1 on an empty
 * list.
 *
 * @param {Object} state
 * @param {Object?} c
 * @returns {number}
 */
export function candidateListClosestIndex(state, c) {
  if (!c || !Number.isFinite(c.start_bp) || !Number.isFinite(c.end_bp)) return -1;
  const sorted = candidateListSortedByPos(state);
  if (sorted.length === 0) return -1;
  let bestI = 0, bestD = Infinity;
  const cMid = (c.start_bp + c.end_bp) / 2;
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    if (!Number.isFinite(e.start_bp) || !Number.isFinite(e.end_bp)) continue;
    const mid = (e.start_bp + e.end_bp) / 2;
    const d = Math.abs(mid - cMid);
    if (d < bestD) { bestD = d; bestI = i; }
  }
  return bestI;
}

// =====================================================================
// Nav state computation
// =====================================================================

/**
 * Compute the nav-bar state for the active candidate:
 *   { sorted, idx, posLabel, prevTarget, nextTarget,
 *     prevDisabled, nextDisabled }
 *
 * Pure: derived entirely from state. The "off-list candidate" case
 * (active candidate not in sorted) drives an "(off-list)" label and
 * uses the closest-by-midpoint as the prev/next reference.
 *
 * @param {Object} state
 * @returns {Object}
 */
export function navStateFor(state) {
  const sorted = candidateListSortedByPos(state);
  const c = state && state.candidate;
  let idx = -1, offList = false;
  if (c) {
    idx = candidateListIndexOf(state, c);
    if (idx < 0) {
      idx = candidateListClosestIndex(state, c);
      offList = (idx >= 0);
    }
  }
  let posLabel = 'whole genome view';
  let prevDisabled = sorted.length === 0;
  let nextDisabled = sorted.length === 0;
  if (c && sorted.length > 0) {
    if (offList) {
      posLabel = 'candidate (off-list)';
    } else if (idx >= 0) {
      posLabel = 'candidate ' + (idx + 1) + ' / ' + sorted.length;
      prevDisabled = (idx === 0);
      nextDisabled = (idx === sorted.length - 1);
    }
  }
  const prevTarget = (sorted.length > 0 && idx > 0) ? sorted[idx - 1]
    : (sorted.length > 0 ? sorted[0] : null);
  const nextTarget = (sorted.length > 0 && idx >= 0 && idx < sorted.length - 1)
    ? sorted[idx + 1]
    : (sorted.length > 0 ? sorted[sorted.length - 1] : null);
  return {
    sorted, idx, offList, posLabel,
    prevTarget, nextTarget,
    prevDisabled, nextDisabled,
  };
}

// =====================================================================
// HTML builder
// =====================================================================

/**
 * Build the nav-bar HTML as a string. `opts.idPrefix` namespaces the
 * button ids (defaults to 'cand') so multiple nav bars can coexist on
 * different pages without collision. Pure: testable without document.
 *
 * @param {Object} state
 * @param {{idPrefix?:string}} opts
 * @returns {string}
 */
export function buildCandidateNavHtml(state, opts) {
  const prefix = (opts && opts.idPrefix) || 'cand';
  const nav = navStateFor(state);
  const c = state && state.candidate;
  const activeName = c
    ? '<span style="color: var(--accent); font-weight: 500;">'
      + _escape(c.id || '?') + '</span>'
    : '<span style="color: var(--ink-dim); font-style: italic;">no candidate selected</span>';
  const prevAttr = nav.prevDisabled ? ' disabled' : '';
  const nextAttr = nav.nextDisabled ? ' disabled' : '';
  const prevCursor = nav.prevDisabled ? 'default' : 'pointer';
  const nextCursor = nav.nextDisabled ? 'default' : 'pointer';
  const prevOpacity = nav.prevDisabled ? 0.4 : 1;
  const nextOpacity = nav.nextDisabled ? 0.4 : 1;
  return ''
    + '<button id="' + prefix + 'NavPrev"' + prevAttr
    + ' title="Previous candidate by genomic position"'
    + ' style="background: var(--panel); border: 1px solid var(--rule);'
    + '        color: var(--ink); border-radius: 3px; padding: 4px 12px;'
    + '        font-family: var(--mono); font-size: 11px;'
    + '        cursor: ' + prevCursor + '; opacity: ' + prevOpacity + ';">‹ prev</button>'
    + '<span style="color: var(--ink-dim); min-width: 130px; text-align: center;'
    + '             white-space: nowrap;">' + _escape(nav.posLabel) + '</span>'
    + '<button id="' + prefix + 'NavNext"' + nextAttr
    + ' title="Next candidate by genomic position"'
    + ' style="background: var(--panel); border: 1px solid var(--rule);'
    + '        color: var(--ink); border-radius: 3px; padding: 4px 12px;'
    + '        font-family: var(--mono); font-size: 11px;'
    + '        cursor: ' + nextCursor + '; opacity: ' + nextOpacity + ';">next ›</button>'
    + '<span style="color: var(--ink-dim); margin: 0 6px;">·</span>'
    + '<span style="color: var(--ink-dim);">active:</span> ' + activeName
    + '<span style="flex: 1;"></span>'
    + '<button id="' + prefix + 'NavGenome"'
    + ' title="Clear candidate selection — show whole-genome view"'
    + ' style="background: var(--panel); border: 1px solid var(--rule);'
    + '        color: var(--ink-dim); border-radius: 3px; padding: 4px 12px;'
    + '        font-family: var(--mono); font-size: 11px; cursor: pointer;">'
    + '🌍 whole genome</button>';
}

// =====================================================================
// DOM element factory
// =====================================================================

/**
 * Create the nav-bar <div> element and wire its three buttons.
 *
 * Caller supplies the navigation callbacks (so this module doesn't
 * depend on the legacy _navigateToCandidate / refresh helpers):
 *   - opts.onNavigate(state, target) — fires when prev/next picks a candidate
 *   - opts.onClearActive(state)       — fires when 🌍 is clicked
 *   - opts.idPrefix                   — id namespace (default 'cand')
 *
 * Returns the <div> (not yet inserted anywhere). When document is
 * unavailable, returns null. Headless-tolerant.
 *
 * @param {Object} state
 * @param {{idPrefix?:string, onNavigate?:Function, onClearActive?:Function}} opts
 * @returns {HTMLElement|null}
 */
export function renderCandidateNavInline(state, opts) {
  if (typeof document === 'undefined') return null;
  const o = opts || {};
  const prefix = o.idPrefix || 'cand';
  const onNavigate    = (typeof o.onNavigate    === 'function') ? o.onNavigate    : null;
  const onClearActive = (typeof o.onClearActive === 'function') ? o.onClearActive : null;

  const bar = document.createElement('div');
  bar.className = 'cand-nav-inline';
  if (bar.style) {
    bar.style.cssText = 'display: flex; align-items: center; gap: 10px; '
      + 'padding: 6px 12px; background: var(--panel-2); '
      + 'border: 1px solid var(--rule); border-radius: 4px; '
      + 'margin-bottom: 12px; font-family: var(--mono); font-size: 11.5px;';
  }
  bar.innerHTML = buildCandidateNavHtml(state, { idPrefix: prefix });

  const nav = navStateFor(state);

  // querySelector lookup — works pre-insertion since elements are children.
  const prevBtn   = bar.querySelector ? bar.querySelector('#' + prefix + 'NavPrev')   : null;
  const nextBtn   = bar.querySelector ? bar.querySelector('#' + prefix + 'NavNext')   : null;
  const genomeBtn = bar.querySelector ? bar.querySelector('#' + prefix + 'NavGenome') : null;

  if (prevBtn && typeof prevBtn.addEventListener === 'function') {
    prevBtn.addEventListener('click', () => {
      if (nav.prevDisabled) return;
      if (nav.prevTarget && onNavigate) {
        try { onNavigate(state, nav.prevTarget); } catch (_) {}
      }
    });
  }
  if (nextBtn && typeof nextBtn.addEventListener === 'function') {
    nextBtn.addEventListener('click', () => {
      if (nav.nextDisabled) return;
      if (nav.nextTarget && onNavigate) {
        try { onNavigate(state, nav.nextTarget); } catch (_) {}
      }
    });
  }
  if (genomeBtn && typeof genomeBtn.addEventListener === 'function') {
    genomeBtn.addEventListener('click', () => {
      if (onClearActive) {
        try { onClearActive(state); } catch (_) {}
      }
    });
  }

  return bar;
}
