// pages/review/karyotype_tier/karyo_rows.js
//
// Per-sample karyotype row builder + sort/filter (legacy lines 62703-62791).
// Cartridge port. Pure helpers — operate on candidate objects + optional
// sample registry; no DOM, no localStorage.

/**
 * True when the candidate is a two-track candidate: cand.tracks.length === 2
 * AND both tracks have non-empty active_bands. Single-track candidates
 * (the default everywhere) → false.
 *
 * @param {Object} cand
 * @returns {boolean}
 */
export function isKaryoTwoTrack(cand) {
  return !!(cand && Array.isArray(cand.tracks) && cand.tracks.length === 2 &&
            cand.tracks.every(t => t && Array.isArray(t.active_bands) &&
                                    t.active_bands.length > 0));
}

/**
 * For a two-track candidate, return Map<bandIdx → trackIdx>. Mutual
 * exclusivity is enforced upstream; each band index is in at most one
 * track. Returns an empty Map for non-track candidates.
 *
 * @param {Object} cand
 * @returns {Map<number, number>}
 */
export function karyoBandToTrackMap(cand) {
  const m = new Map();
  if (!cand || !Array.isArray(cand.tracks)) return m;
  for (let t = 0; t < cand.tracks.length; t++) {
    const ab = cand.tracks[t] && cand.tracks[t].active_bands;
    if (!Array.isArray(ab)) continue;
    for (const b of ab) {
      if (Number.isInteger(b)) m.set(b, t);
    }
  }
  return m;
}

/**
 * Build per-sample karyotype rows from a candidate. Each row carries:
 *   { si, ind, cga, k_label, sigma, family_id, ancestry, track_idx }
 *
 * `samples` is the per-sample registry (state.data.samples[]) keyed by
 * sample index; when missing/empty, ind/cga default to 'Ind<si>',
 * family_id to -1, ancestry to ''.
 *
 * `sigmaSpread` (optional) is a typed/regular array indexed by sample
 * index with the precomputed σ value; when absent, sigma is NaN.
 *
 * @param {Object} cand
 * @param {Array<Object>?} samples
 * @param {ArrayLike<number>?} sigmaSpread
 * @returns {Array<Object>}
 */
/**
 * True when `x` is something we can iterate as a labels vector —
 * either a plain Array or any TypedArray (Int8Array / Uint8Array /
 * …). The candidates pipeline stores `locked_labels` as Int8Array,
 * but the JSON roundtrip path re-hydrates it from a plain Array, so
 * we need to accept both. A bare `Array.isArray(x)` check returns
 * false for the Int8Array case → blank karyotype table.
 */
export function _isLabelsArray(x) {
  return Array.isArray(x) || (x != null && ArrayBuffer.isView(x) && typeof x.length === 'number');
}

export function buildKaryotypeRows(cand, samples, sigmaSpread) {
  if (!cand || !_isLabelsArray(cand.locked_labels)) return [];
  const samp = Array.isArray(samples) ? samples : [];
  const sig  = sigmaSpread || null;
  const twoTrack = isKaryoTwoTrack(cand);
  const bandToTrack = twoTrack ? karyoBandToTrackMap(cand) : null;
  const rows = [];
  for (let si = 0; si < cand.locked_labels.length; si++) {
    const s = samp[si] || {};
    const kLabel = cand.locked_labels[si];
    const sigmaVal = (sig && si < sig.length && Number.isFinite(sig[si]))
      ? sig[si] : NaN;
    rows.push({
      si,
      ind:        s.ind || ('Ind' + si),
      cga:        s.cga || s.ind || ('Ind' + si),
      k_label:    Number.isInteger(kLabel) ? kLabel : -1,
      sigma:      sigmaVal,
      family_id:  Number.isInteger(s.family_id) ? s.family_id : -1,
      ancestry:   typeof s.ancestry === 'string' ? s.ancestry : '',
      track_idx:  (twoTrack && bandToTrack && Number.isInteger(kLabel)
                   && kLabel >= 0 && bandToTrack.has(kLabel))
                    ? bandToTrack.get(kLabel) : null,
    });
  }
  return rows;
}

/**
 * Sort rows according to karyoUiState ({ sortKey, sortAsc }). Numeric
 * keys: k_label, sigma, family_id, si. All others sorted by string
 * compare. Returns a new array.
 *
 * @param {Array<Object>} rows
 * @param {{sortKey:string, sortAsc?:boolean}} ui
 * @returns {Array<Object>}
 */
export function sortKaryoRows(rows, ui) {
  if (!Array.isArray(rows)) return [];
  const k = (ui && ui.sortKey) || 'k_label';
  const asc = (ui && ui.sortAsc !== false);
  const numeric = (k === 'k_label' || k === 'sigma' || k === 'family_id' || k === 'si');
  const out = rows.slice();
  out.sort((a, b) => {
    const av = a[k], bv = b[k];
    if (numeric) {
      const na = Number.isFinite(av) ? av : -Infinity;
      const nb = Number.isFinite(bv) ? bv : -Infinity;
      return asc ? na - nb : nb - na;
    }
    const sa = String(av == null ? '' : av);
    const sb = String(bv == null ? '' : bv);
    if (sa < sb) return asc ? -1 : 1;
    if (sa > sb) return asc ?  1 : -1;
    return 0;
  });
  return out;
}

/**
 * Filter rows by the optional free-text filter (matches cga / ind /
 * family_id / ancestry, case-insensitive) and band filter ('kN'). When
 * both are empty, returns the original array.
 *
 * @param {Array<Object>} rows
 * @param {{filter?:string, bandFilter?:string}} ui
 * @returns {Array<Object>}
 */
export function filterKaryoRows(rows, ui) {
  if (!Array.isArray(rows)) return [];
  const filter = (ui && typeof ui.filter === 'string') ? ui.filter.trim().toLowerCase() : '';
  const bandFilter = (ui && typeof ui.bandFilter === 'string') ? ui.bandFilter : '';
  let out = rows;
  if (bandFilter) {
    const k = parseInt(bandFilter.replace(/^k/, ''), 10);
    if (Number.isFinite(k)) out = out.filter(r => r && r.k_label === k);
  }
  if (filter) {
    out = out.filter(r => r && (
      String(r.cga || '').toLowerCase().includes(filter) ||
      String(r.ind || '').toLowerCase().includes(filter) ||
      String(r.family_id || '').includes(filter) ||
      String(r.ancestry || '').toLowerCase().includes(filter)
    ));
  }
  return out;
}
