// =============================================================================
// popstats/_candidate_nav.js
// =============================================================================
// Inline candidate-navigation bar at the top of the popstats page. Ported from
// _renderCandidateNavInline() in Inversion_atlas.html (line 59653).
//
// Shape: prev | "candidate N / M" | next | · active: <id> | (spacer) | 🌍 whole genome
//
// Reads:
//   atlasState.inversion.candidateList — array of candidates with {id, chrom, start_bp, end_bp}
//   atlasState.shared.activeCandidate  — the currently-selected candidate (or null)
//
// Writes via atlasState.setActiveCandidate(...) — same path the scopebar uses,
// so the convenience-setter event (`shared.activeCandidate.changed`) fires and
// the prewarm scheduler / sibling listeners stay in sync. After the slot is
// updated we call `onChange()` so the popstats page re-renders.
// =============================================================================

/**
 * Build the nav bar and wire its buttons.
 *
 * @param {object} args
 * @param {object} args.atlasState                 — global AtlasState instance
 * @param {string} args.idPrefix                   — DOM id prefix ('ps' / 'page7' / etc.)
 * @param {() => void} [args.onChange]             — fired after the active candidate flips
 * @returns {HTMLElement}                          — the .cand-nav-inline bar
 */
export function renderCandidateNav({ atlasState, idPrefix = 'ps', onChange }) {
  const inv = (atlasState && atlasState.inversion) || {};
  const sh  = (atlasState && atlasState.shared)    || {};

  const sorted = _candidatesSortedByPos(inv.candidateList || []);
  const c = sh.activeCandidate || null;

  const bar = document.createElement('div');
  bar.className = 'cand-nav-inline';

  let posLabel = 'whole genome view';
  let prevDisabled = sorted.length === 0;
  let nextDisabled = sorted.length === 0;
  let curIdx = -1;
  if (c && sorted.length > 0) {
    curIdx = sorted.findIndex(x => x.id === c.id);
    if (curIdx >= 0) {
      posLabel = `candidate ${curIdx + 1} / ${sorted.length}`;
      prevDisabled = (curIdx === 0);
      nextDisabled = (curIdx === sorted.length - 1);
    } else {
      posLabel = 'candidate (off-list)';
    }
  }

  const activeName = c
    ? `<span class="cnav-id">${_esc(c.id || '?')}</span>`
    : `<span class="cnav-id cnav-empty">no candidate selected</span>`;

  bar.innerHTML =
    `<button id="${idPrefix}NavPrev" class="cnav-btn"`
      + ` ${prevDisabled ? 'disabled' : ''}`
      + ` title="Previous candidate by genomic position">‹ prev</button>`
    + `<span class="cnav-pos">${posLabel}</span>`
    + `<button id="${idPrefix}NavNext" class="cnav-btn"`
      + ` ${nextDisabled ? 'disabled' : ''}`
      + ` title="Next candidate by genomic position">next ›</button>`
    + `<span class="cnav-sep">·</span>`
    + `<span class="cnav-label">active:</span> ${activeName}`
    + `<span class="cnav-spacer"></span>`
    + `<button id="${idPrefix}NavGenome" class="cnav-btn cnav-btn-dim"`
      + ` title="Clear candidate selection — show whole-genome view">🌍 whole genome</button>`;

  const prevBtn   = bar.querySelector(`#${idPrefix}NavPrev`);
  const nextBtn   = bar.querySelector(`#${idPrefix}NavNext`);
  const genomeBtn = bar.querySelector(`#${idPrefix}NavGenome`);

  const apply = (target) => {
    // If the target is on a different chrom, flip activeChrom too so the
    // page paints against the right precomp. Matches legacy
    // _navigateToCandidate behaviour.
    if (target && target.chrom && atlasState && atlasState.shared
        && target.chrom !== atlasState.shared.activeChrom) {
      if (typeof atlasState.setActiveChrom === 'function') {
        atlasState.setActiveChrom(target.chrom);
      } else {
        atlasState.shared.activeChrom = target.chrom;
      }
    }
    if (atlasState && typeof atlasState.setActiveCandidate === 'function') {
      atlasState.setActiveCandidate(target);
    } else if (atlasState && atlasState.shared) {
      atlasState.shared.activeCandidate = target;
    }
    if (typeof onChange === 'function') onChange();
  };

  if (prevBtn && !prevDisabled) {
    prevBtn.addEventListener('click', () => {
      const target = curIdx > 0 ? sorted[curIdx - 1] : sorted[0];
      if (target) apply(target);
    });
  }
  if (nextBtn && !nextDisabled) {
    nextBtn.addEventListener('click', () => {
      const target = (curIdx >= 0 && curIdx < sorted.length - 1)
        ? sorted[curIdx + 1]
        : sorted[sorted.length - 1];
      if (target) apply(target);
    });
  }
  if (genomeBtn) {
    genomeBtn.addEventListener('click', () => apply(null));
  }

  return bar;
}

function _candidatesSortedByPos(list) {
  return list.slice().sort((a, b) => {
    const ca = String(a.chrom || ''), cb = String(b.chrom || '');
    if (ca !== cb) {
      const ma = ca.match(/^LG(\d+)$/);
      const mb = cb.match(/^LG(\d+)$/);
      if (ma && mb) return Number(ma[1]) - Number(mb[1]);
      return ca.localeCompare(cb);
    }
    return (a.start_bp || 0) - (b.start_bp || 0);
  });
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
