// atlases/inversion/shared/candidate_predicates.js
//
// Pure predicates that classify a candidate object. Any page that
// inspects a candidate's metadata should pull these from shared rather
// than reaching into a sibling page's module — predicates are
// library-shaped, not page-shaped.
//
// Legacy source: _isAutoCandidate at line 41184.

/**
 * Is this candidate an unconfirmed auto-promotion?
 *
 * Auto candidates (`source` starts with `'auto_'`, e.g. `'auto_l2_sweep'`)
 * are surfaced in the review UI but excluded from inheritance compute /
 * I·g pills / cross-candidate Jaccard until the user explicitly
 * confirms them. Once `cand.confirmed === true`, the predicate returns
 * false regardless of source — confirmation overrides the auto-only
 * gate.
 *
 * @param {Object|null} cand
 * @returns {boolean}
 */
export function isAutoCandidate(cand) {
  if (!cand) return false;
  if (cand.confirmed) return false;
  const src = cand.source;
  if (typeof src !== 'string') return false;
  return src.indexOf('auto_') === 0;
}
