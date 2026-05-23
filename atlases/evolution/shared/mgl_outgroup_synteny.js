// shared/mgl_outgroup_synteny.js
// =====================================================================
// Outgroup-synteny polarization. Given per-outgroup-species break-point
// orientation calls + the cohort consensus orientation, aggregate to
// an arrangement-polarization verdict:
//
//   each outgroup votes:    'matches_A' / 'matches_B' / 'unresolved'
//   aggregated verdict:     'ancestral=A' / 'ancestral=B' / 'unpolarized'
//
// Input is light — just per-species verdicts + optional confidence
// (alignment quality, BUSCO support, etc.).
//
// Pure compute. No DOM, no fetch.
// =====================================================================

export const MGL_SYNTENY_VOTES = Object.freeze({
  MATCHES_A:  'matches_A',
  MATCHES_B:  'matches_B',
  UNRESOLVED: 'unresolved',
});

export const MGL_SYNTENY_DEFAULTS = Object.freeze({
  // Verdict requires at least this many resolved votes.
  min_resolved_votes:   1,
  // And the difference between supporters must be at least this fraction
  // of resolved votes (default 25%).
  polarization_margin:  0.25,
});

/**
 * Normalize a per-species vote.
 *
 * @param {Object} entry  e.g. { species, vote, confidence }
 * @returns {Object}      validated copy
 */
export function normaliseSyntenyEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const validVotes = new Set(Object.values(MGL_SYNTENY_VOTES));
  const vote = validVotes.has(entry.vote) ? entry.vote : MGL_SYNTENY_VOTES.UNRESOLVED;
  return {
    species:    String(entry.species || ''),
    vote,
    confidence: Number.isFinite(entry.confidence) ? entry.confidence : null,
    notes:      entry.notes ? String(entry.notes) : null,
  };
}

/**
 * Aggregate per-species votes → polarization verdict.
 *
 * @param {Array<Object>} entries
 * @param {Object} [opts]
 *   min_resolved_votes?, polarization_margin?
 * @returns {{
 *   verdict:string,           'ancestral=A' | 'ancestral=B' | 'unpolarized'
 *                             | 'insufficient_data',
 *   n_a:number, n_b:number, n_unresolved:number,
 *   confidence_sum_a:number, confidence_sum_b:number,
 *   resolved_votes:number,
 * }}
 */
export function aggregateSyntenyVotes(entries, opts) {
  const o = opts || {};
  const D = MGL_SYNTENY_DEFAULTS;
  const minResolved = Number.isFinite(o.min_resolved_votes)
    ? o.min_resolved_votes : D.min_resolved_votes;
  const margin = Number.isFinite(o.polarization_margin)
    ? o.polarization_margin : D.polarization_margin;
  const out = {
    verdict: 'insufficient_data',
    n_a: 0, n_b: 0, n_unresolved: 0,
    confidence_sum_a: 0, confidence_sum_b: 0,
    resolved_votes: 0,
  };
  if (!Array.isArray(entries)) return out;
  for (const e of entries) {
    if (!e) continue;
    const w = Number.isFinite(e.confidence) ? e.confidence : 1;
    if (e.vote === MGL_SYNTENY_VOTES.MATCHES_A) {
      out.n_a++; out.confidence_sum_a += w;
    } else if (e.vote === MGL_SYNTENY_VOTES.MATCHES_B) {
      out.n_b++; out.confidence_sum_b += w;
    } else {
      out.n_unresolved++;
    }
  }
  out.resolved_votes = out.n_a + out.n_b;
  if (out.resolved_votes < minResolved) {
    out.verdict = 'insufficient_data';
    return out;
  }
  const totalConf = out.confidence_sum_a + out.confidence_sum_b;
  // Margin uses confidence-weighted counts.
  const diff = (out.confidence_sum_a - out.confidence_sum_b);
  const denom = totalConf > 0 ? totalConf : 1;
  const ratio = diff / denom;
  if (ratio >= margin)        out.verdict = 'ancestral=A';
  else if (ratio <= -margin)  out.verdict = 'ancestral=B';
  else                        out.verdict = 'unpolarized';
  return out;
}
