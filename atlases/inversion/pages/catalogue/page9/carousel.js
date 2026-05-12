// pages/catalogue/page9/carousel.js
//
// Confirmed-candidates carousel — the implementation legacy was
// missing. Page9's HTML shell ships nav-bar + meta-panel + empty-
// state placeholder; this module supplies the JS that drives them.
//
// State slots used (set on state at mount time, mutated by nav):
//   state.candidateList            : the full registry; we filter
//                                    .filter(c => c.confirmed === true)
//   state.confirmedCarouselIndex   : current position in the
//                                    confirmed-list view
//
// Public entries:
//   filterConfirmed(state)         : pure — confirmed-candidate sub-list
//   resolveCarouselIndex(state)    : clamp the stored index into range
//   navigateCarousel(state, delta) : pure index transition; updates state
//   renderConfirmedMeta(candidate) : pure HTML string for a candidate
//   renderConfirmedCarousel(state) : DOM-side renderer (uses doc.getElementById)
//   wireConfirmedCarouselNav(state): wire prev/next buttons + ←/→ keys
//   teardownConfirmedCarouselNav() : remove the wired handlers
//
// Headless-tolerant: every DOM access is typeof-guarded so the pure
// functions can be unit-tested without a document.

// =====================================================================
// Pure helpers
// =====================================================================

/**
 * Return the list of confirmed candidates from state, preserving the
 * original order. Empty array when none are confirmed or state.
 * candidateList is missing.
 *
 * @param {Object} state
 * @returns {Array<Object>}
 */
export function filterConfirmed(state) {
  if (!state || !Array.isArray(state.candidateList)) return [];
  return state.candidateList.filter(c => c && c.confirmed === true);
}

/**
 * Clamp state.confirmedCarouselIndex into [0, n-1]. Returns the
 * effective index (after clamp). Does NOT mutate state — callers
 * write the clamped value back themselves if needed.
 *
 * Returns -1 when the confirmed list is empty.
 *
 * @param {Object} state
 * @returns {number}
 */
export function resolveCarouselIndex(state) {
  const list = filterConfirmed(state);
  if (list.length === 0) return -1;
  const raw = (state && Number.isInteger(state.confirmedCarouselIndex))
    ? state.confirmedCarouselIndex : 0;
  if (raw < 0) return 0;
  if (raw >= list.length) return list.length - 1;
  return raw;
}

/**
 * Move the carousel by `delta` steps. Wraps around at both ends so
 * pressing ← at index 0 lands on the last entry. Mutates
 * state.confirmedCarouselIndex; returns the new index.
 *
 * Returns -1 (and leaves state untouched) when the confirmed list is
 * empty.
 *
 * @param {Object} state
 * @param {number} delta  typically -1 or +1
 * @returns {number}
 */
export function navigateCarousel(state, delta) {
  if (!state) return -1;
  const list = filterConfirmed(state);
  if (list.length === 0) return -1;
  const cur = resolveCarouselIndex(state);
  const step = Number.isFinite(delta) ? Math.trunc(delta) : 0;
  // Modular wrap (handles negative delta correctly)
  let next = ((cur + step) % list.length + list.length) % list.length;
  state.confirmedCarouselIndex = next;
  return next;
}

// =====================================================================
// Candidate summary HTML
// =====================================================================

function _escape(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _formatBp(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + ' Mb';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + ' kb';
  return String(n) + ' bp';
}

function _bandCountsHtml(c) {
  if (!c || !c.locked_labels || !c.K) return '';
  const K = c.K | 0;
  const counts = new Array(K).fill(0);
  for (let i = 0; i < c.locked_labels.length; i++) {
    const k = c.locked_labels[i];
    if (k >= 0 && k < K) counts[k]++;
  }
  const cells = counts.map((n, k) =>
    `<span style="display:inline-block; padding:2px 8px; margin:0 4px 4px 0; `
    + `background: var(--panel-2); border:1px solid var(--rule); border-radius:3px;">`
    + `band ${k}: <b>${n}</b></span>`
  ).join('');
  return `<div style="margin-top:8px;">${cells}</div>`;
}

/**
 * Pure HTML builder for one confirmed candidate's meta panel. Returns
 * a string the renderer assigns to innerHTML. Headless-testable.
 *
 * Layout: candidate id (large), chrom + bp range, K + band sample counts,
 * vocab if set, notes/manuscript_note when present.
 *
 * @param {Object} cand
 * @returns {string}
 */
export function renderConfirmedMeta(cand) {
  if (!cand || !cand.id) return '';
  const chrom = _escape(cand.chrom || '?');
  const start = _formatBp(cand.start_bp);
  const end   = _formatBp(cand.end_bp);
  const span  = (cand.start_bp != null && cand.end_bp != null)
    ? _formatBp(cand.end_bp - cand.start_bp) : '—';
  const K = cand.K || cand.K_used || null;
  const vocab = cand.haplotype_vocab ? _escape(cand.haplotype_vocab) : null;
  const note = cand.manuscript_note || cand.notes || null;
  const nSamples = (cand.locked_labels && cand.locked_labels.length) || 0;

  let html = '';
  html += '<div style="padding:18px 24px; max-width: 720px; margin: 0 auto;">';

  // Header
  html += '<div style="font-size:18px; font-family: var(--mono); font-weight:600; ';
  html +=             'margin-bottom:6px;">' + _escape(cand.id) + '</div>';

  // Location line
  html += '<div style="font-size:12px; color: var(--ink-dim); margin-bottom:14px;">';
  html += '<b>' + chrom + '</b> · ' + start + ' – ' + end + ' (' + span + ')';
  if (K != null) html += ' · K=' + (K | 0);
  if (nSamples) html += ' · ' + nSamples + ' samples';
  html += '</div>';

  // Band counts
  if (K != null && cand.locked_labels) {
    html += '<div style="font-size:11.5px; color: var(--ink-dim); ';
    html +=             'margin-bottom:4px;">Band membership</div>';
    html += _bandCountsHtml(cand);
  }

  // Vocab
  if (vocab) {
    html += '<div style="font-size:11.5px; color: var(--ink-dim); margin-top:10px;">';
    html += 'haplotype vocab: <span style="color: var(--ink);">' + vocab + '</span>';
    html += '</div>';
  }

  // Note
  if (note) {
    html += '<div style="margin-top:14px; padding:10px 14px; border-left: 3px solid var(--accent); ';
    html +=             'background: var(--panel-2); font-size:12px; line-height:1.5;">';
    html += _escape(note) + '</div>';
  }

  html += '</div>';
  return html;
}

// =====================================================================
// DOM renderer
// =====================================================================

/**
 * Render the carousel against the active document. Reads the
 * confirmed list + index from state; updates #confirmedNavBar /
 * #confirmedNavInfo / #confirmedCandidateMeta / #confirmedEmpty.
 *
 * Idempotent. Safe to call repeatedly (e.g. after every nav step or
 * candidateList mutation).
 *
 * Headless-tolerant: returns silently when typeof document is undefined.
 */
export function renderConfirmedCarousel(state) {
  if (typeof document === 'undefined') return;
  const navBar = document.getElementById('confirmedNavBar');
  const meta   = document.getElementById('confirmedCandidateMeta');
  const empty  = document.getElementById('confirmedEmpty');
  const info   = document.getElementById('confirmedNavInfo');

  const list = filterConfirmed(state);
  if (list.length === 0) {
    if (navBar) navBar.style.display = 'none';
    if (meta)   meta.style.display = 'none';
    if (empty)  empty.style.display = 'block';
    return;
  }

  // Clamp + write back the resolved index so subsequent reads see it
  const idx = resolveCarouselIndex(state);
  if (state) state.confirmedCarouselIndex = idx;

  if (empty)  empty.style.display = 'none';
  if (navBar) navBar.style.display = '';
  if (meta) {
    meta.style.display = '';
    meta.innerHTML = renderConfirmedMeta(list[idx]);
  }
  if (info) info.textContent = (idx + 1) + ' / ' + list.length;
}

// =====================================================================
// Event wiring
// =====================================================================

// Module-level handler refs so teardown can remove them. Page9 mounts
// at most once per session, so a single-handler-per-event slot is fine.
let _prevHandler = null;
let _nextHandler = null;
let _keyHandler  = null;

function _canListen(target) {
  return target
    && typeof target.addEventListener === 'function'
    && typeof target.removeEventListener === 'function';
}

/**
 * Wire prev/next buttons + ←/→ keydown handlers. Removes any
 * previously-wired handlers so the function is idempotent. Tolerant
 * of partial DOM mocks: silently skips elements that lack
 * addEventListener.
 *
 * @param {Object} state
 */
export function wireConfirmedCarouselNav(state) {
  if (typeof document === 'undefined') return;
  // Tear down first (idempotent)
  teardownConfirmedCarouselNav();

  const prevBtn = document.getElementById('confirmedNavPrev');
  const nextBtn = document.getElementById('confirmedNavNext');

  _prevHandler = () => {
    navigateCarousel(state, -1);
    renderConfirmedCarousel(state);
  };
  _nextHandler = () => {
    navigateCarousel(state, +1);
    renderConfirmedCarousel(state);
  };
  _keyHandler = (evt) => {
    // Only act when page9 is the visible page (#page9.active).
    // The atlas-router toggles .active on the page wrapper.
    const page9 = document.getElementById('page9');
    if (!page9 || !page9.classList
        || typeof page9.classList.contains !== 'function'
        || !page9.classList.contains('active')) return;
    if (evt.key === 'ArrowLeft' || evt.key === 'Left') {
      if (typeof evt.preventDefault === 'function') evt.preventDefault();
      _prevHandler();
    } else if (evt.key === 'ArrowRight' || evt.key === 'Right') {
      if (typeof evt.preventDefault === 'function') evt.preventDefault();
      _nextHandler();
    }
  };

  if (_canListen(prevBtn)) prevBtn.addEventListener('click', _prevHandler);
  if (_canListen(nextBtn)) nextBtn.addEventListener('click', _nextHandler);
  if (_canListen(document)) document.addEventListener('keydown', _keyHandler);
}

/**
 * Remove handlers wired by wireConfirmedCarouselNav. Idempotent;
 * safe to call when nothing was wired or when the DOM mock is
 * partial (lacks removeEventListener).
 */
export function teardownConfirmedCarouselNav() {
  if (typeof document === 'undefined') return;
  if (_prevHandler) {
    const prevBtn = document.getElementById('confirmedNavPrev');
    if (_canListen(prevBtn)) prevBtn.removeEventListener('click', _prevHandler);
    _prevHandler = null;
  }
  if (_nextHandler) {
    const nextBtn = document.getElementById('confirmedNavNext');
    if (_canListen(nextBtn)) nextBtn.removeEventListener('click', _nextHandler);
    _nextHandler = null;
  }
  if (_keyHandler) {
    if (_canListen(document)) document.removeEventListener('keydown', _keyHandler);
    _keyHandler = null;
  }
}
