// shared/candidate_display_name.js
//
// Pure display-name builder for candidates (legacy lines 56827-56970).
// Produces stable, human-readable labels like "LG28.15-16Mb.A" by
// combining the chromosome short-form, the floor of the start/end Mb,
// and a per-(chrom, Mb-bin) disambiguation letter (A, B, ..., Z, AA,
// AB, ...) assigned by sorting candidates within each bin by start_bp.

/** Prefixes stripped from chrom names for the display short-form. */
export const CHROM_PREFIX_RE = /^(C_gar_|C_mac_|chr_)/;

/**
 * Strip the chrom prefix to produce a short display name (e.g.
 * "C_gar_LG28" → "LG28"). Returns "?" for nullish / non-string input.
 *
 * @param {string|*} chrom
 * @returns {string}
 */
export function candidateDisplayChromShort(chrom) {
  if (typeof chrom !== 'string' || !chrom) return '?';
  return chrom.replace(CHROM_PREFIX_RE, '');
}

/**
 * Convert a 0-indexed integer into a letter sequence:
 *   0 → A, 1 → B, ..., 25 → Z, 26 → AA, 27 → AB, ...
 *
 * Used for the disambiguation suffix when multiple candidates fall in
 * the same (chrom, Mb-bin). Returns "?" for invalid input.
 *
 * @param {number} idx
 * @returns {string}
 */
export function candidateDisplayLetterSeq(idx) {
  if (typeof idx !== 'number' || idx < 0 || !Number.isFinite(idx)) return '?';
  let n = Math.floor(idx);
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/**
 * Build a stable map from candidate.id → display name. Candidates are
 * grouped by (chrom_short, floor(start_bp/1e6), floor(end_bp/1e6)),
 * sorted within each group by start_bp ascending (then end_bp, then id),
 * and assigned successive letters.
 *
 * Examples:
 *   { id: 'cand_001', chrom: 'C_gar_LG28', start_bp: 15_190_000, end_bp: 16_220_000 }
 *     → 'LG28.15-16Mb.A'
 *   { id: 'cand_002', chrom: 'LG14',      start_bp: 5_120_000,  end_bp: 5_980_000 }
 *     → 'LG14.5Mb.A'  (start floor == end floor → degenerate-single-Mb form)
 *
 * Candidates missing start_bp/end_bp fall back to "<chromShort>.??Mb.?".
 *
 * @param {Array<Object>} cands
 * @returns {Object<string, string>}
 */
export function buildCandidateDisplayNameMap(cands) {
  const out = {};
  if (!Array.isArray(cands) || cands.length === 0) return out;

  const groups = new Map();
  for (const c of cands) {
    if (!c || !c.id) continue;
    if (typeof c.start_bp !== 'number' || typeof c.end_bp !== 'number'
        || !Number.isFinite(c.start_bp) || !Number.isFinite(c.end_bp)) {
      out[c.id] = candidateDisplayChromShort(c.chrom) + '.??Mb.?';
      continue;
    }
    const chromShort = candidateDisplayChromShort(c.chrom);
    const startMb = Math.floor(c.start_bp / 1e6);
    const endMb   = Math.floor(c.end_bp   / 1e6);
    const key = chromShort + '|' + startMb + '|' + endMb;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  for (const [key, members] of groups) {
    members.sort((a, b) => {
      if (a.start_bp !== b.start_bp) return a.start_bp - b.start_bp;
      if (a.end_bp   !== b.end_bp)   return a.end_bp   - b.end_bp;
      return String(a.id).localeCompare(String(b.id));
    });
    const parts = key.split('|');
    const chromShort = parts[0];
    const startMb = parts[1];
    const endMb   = parts[2];
    const mbPart = (startMb === endMb)
      ? (startMb + 'Mb')
      : (startMb + '-' + endMb + 'Mb');
    for (let i = 0; i < members.length; i++) {
      const letter = candidateDisplayLetterSeq(i);
      out[members[i].id] = chromShort + '.' + mbPart + '.' + letter;
    }
  }
  return out;
}

/**
 * Convenience: derive the display name for a single candidate,
 * computing the disambiguation letter using `state.candidateList +
 * state.candidate` as the disambiguation universe.
 *
 * Pure: takes state explicitly. Returns "?" for nullish inputs.
 *
 * @param {Object} state
 * @param {Object?} cand
 * @returns {string}
 */
export function candidateDisplayName(state, cand) {
  if (!cand || !cand.id) return '?';
  const universe = [];
  if (state && Array.isArray(state.candidateList)) {
    for (const c of state.candidateList) {
      if (c && c.id) universe.push(c);
    }
  }
  if (state && state.candidate && state.candidate.id
      && !universe.find(c => c.id === state.candidate.id)) {
    universe.push(state.candidate);
  }
  if (!universe.find(c => c.id === cand.id)) universe.push(cand);
  const map = buildCandidateDisplayNameMap(universe);
  return map[cand.id] || '?';
}
