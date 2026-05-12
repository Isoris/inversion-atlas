// shared/band_composition.js
//
// Per-band sample tallies (legacy lines 10465-10500 + 61065-61073).
// Given a candidate's locked_labels + a per-sample registry, computes
// per-band family + ancestry distributions plus simple sample counts.
//
// Pure: caller passes samples array explicitly (no state.data reach-in).

/**
 * Count samples per band. Returns Array<number> of length K. Labels
 * outside [0, K) are skipped silently.
 *
 * @param {ArrayLike<number>?} labels
 * @param {number} K
 * @returns {Array<number>}
 */
export function bandSampleCounts(labels, K) {
  const k = Number.isFinite(K) ? Math.max(0, K | 0) : 0;
  const counts = new Array(k).fill(0);
  if (!labels) return counts;
  for (let i = 0; i < labels.length; i++) {
    const lab = labels[i];
    if (Number.isInteger(lab) && lab >= 0 && lab < k) counts[lab]++;
  }
  return counts;
}

/**
 * Sum the absolute counts in a family/ancestry tally to verify
 * normalization. Convenience for tests.
 *
 * @param {Array<{n:number}>} entries
 * @returns {number}
 */
function _sumN(entries) {
  let s = 0;
  for (const e of entries) if (e && Number.isFinite(e.n)) s += e.n;
  return s;
}

/**
 * For each band 0..K-1 in `candidate`, compute:
 *   { k, n, members:[si...],
 *     families:   [{family_id, n, frac}],   sorted by n desc
 *     ancestries: [{label,     n, frac}],   sorted by n desc }
 *
 * `families[*].frac` is `n / band_n` (the fraction of this band's
 * samples in that family). Missing/unset family_id (or value -1) is
 * bucketed under the string 'unknown'. Same convention for ancestry
 * (key 'unknown' when the field is missing).
 *
 * @param {Object} candidate          must have locked_labels + K
 * @param {Array<{family_id?:number|string, ancestry?:string}>} samples
 * @returns {Array<Object>|null}
 */
export function candidateBandComposition(candidate, samples) {
  if (!candidate || !candidate.locked_labels) return null;
  if (!Array.isArray(samples)) samples = [];
  const labels = candidate.locked_labels;
  let K = Number.isFinite(candidate.K) ? candidate.K : null;
  if (K == null) {
    let maxK = -1;
    for (let i = 0; i < labels.length; i++) {
      const v = labels[i];
      if (Number.isInteger(v) && v > maxK) maxK = v;
    }
    K = maxK + 1;
  }
  if (K <= 0) return [];

  const out = [];
  for (let k = 0; k < K; k++) {
    const memberIdx = [];
    for (let si = 0; si < labels.length; si++) {
      if (labels[si] === k) memberIdx.push(si);
    }
    const n = memberIdx.length;

    const famCounts = new Map();
    for (const si of memberIdx) {
      const s = samples[si];
      const fid = s && s.family_id;
      const key = (fid != null && fid !== -1) ? fid : 'unknown';
      famCounts.set(key, (famCounts.get(key) || 0) + 1);
    }
    const families = Array.from(famCounts.entries())
      .map(([family_id, count]) => ({
        family_id,
        n: count,
        frac: n > 0 ? count / n : 0,
      }))
      .sort((a, b) => b.n - a.n);

    const ancCounts = new Map();
    for (const si of memberIdx) {
      const s = samples[si];
      const a = s && s.ancestry;
      const key = a || 'unknown';
      ancCounts.set(key, (ancCounts.get(key) || 0) + 1);
    }
    const ancestries = Array.from(ancCounts.entries())
      .map(([label, count]) => ({
        label,
        n: count,
        frac: n > 0 ? count / n : 0,
      }))
      .sort((a, b) => b.n - a.n);

    out.push({ k, n, members: memberIdx, families, ancestries });
  }
  return out;
}

/** Verify per-band tallies sum to band_n. Convenience for tests. */
export function _bandCompositionSelfCheck(composition) {
  if (!Array.isArray(composition)) return false;
  for (const band of composition) {
    if (!band) continue;
    if (_sumN(band.families)   !== band.n) return false;
    if (_sumN(band.ancestries) !== band.n) return false;
  }
  return true;
}
