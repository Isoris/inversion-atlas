// shared/karyotype_rows.js
//
// Per-sample karyotype table-row builder + two-track detection
// (legacy lines 62703-62763: buildKaryotypeRows + _isKaryoTwoTrack +
// _karyoBandToTrackMap). Pure helpers consumed by the karyotype
// page (karyotype_tier) and any view that lists samples ranked by σ /
// k-band / family.
//
// Inputs:
//   state.data.samples       per-sample {ind, cga, family_id, ancestry}
//   candidate.locked_labels  Int8Array of band indices (-1 = unassigned)
//   candidate.start_w/end_w  window range for the σ aggregator
//   candidate.tracks         optional [{active_bands:Array<int>}, ...]
//                             for two-track candidates
//
// `sampleSpreadRange` is injected via opts so this module stays
// independent of state-coupled lookups. Headless-tolerant.

/**
 * True when a candidate is a two-track candidate (legacy
 * `_isKaryoTwoTrack`).  Two-track = `cand.tracks.length === 2`
 * AND both tracks declare ≥ 1 active band. Mutual exclusivity is
 * an external invariant — this function only asserts the shape.
 *
 * @param {Object} cand
 * @returns {boolean}
 */
export function isKaryoTwoTrack(cand) {
  return !!(cand
    && Array.isArray(cand.tracks)
    && cand.tracks.length === 2
    && cand.tracks.every(t => t
        && Array.isArray(t.active_bands)
        && t.active_bands.length > 0));
}

/**
 * Build a `Map<bandIdx, trackIdx>` for a two-track candidate
 * (legacy `_karyoBandToTrackMap`). Returns an empty Map for
 * single-track / malformed candidates. Mutual exclusivity is
 * NOT enforced here — the map silently uses last-write-wins per
 * band, the same as legacy.
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
 * Build per-sample rows for the karyotype table (legacy
 * `buildKaryotypeRows`). One row per `candidate.locked_labels[si]`,
 * carrying:
 *
 *   { si, ind, cga, k_label, sigma, family_id, ancestry, track_idx }
 *
 * `sigma` is the per-sample σ from the candidate's bp range,
 * computed by `opts.sampleSpread(state, start_w, end_w)` (the
 * `sampleSpreadRange` helper from shared/sample_spread.js).
 * Returns NaN per row when the σ helper is missing or returns null.
 *
 * `track_idx` is the bind to one of cand.tracks for two-track
 * candidates, `null` otherwise. Same definition as legacy turn 43:
 * computed by `isKaryoTwoTrack` + `karyoBandToTrackMap`.
 *
 * @param {Object} state
 * @param {Object} candidate
 * @param {{sampleSpread?:Function}} opts
 * @returns {Array<Object>}
 */
export function buildKaryotypeRows(state, candidate, opts) {
  const o = opts || {};
  const d = state && state.data;
  if (!d || !Array.isArray(d.samples)) return [];
  if (!candidate || !candidate.locked_labels) return [];

  let sd = null;
  if (typeof o.sampleSpread === 'function') {
    try {
      sd = o.sampleSpread(state, candidate.start_w, candidate.end_w);
    } catch (_) { sd = null; }
  }
  const isTwoTrack = isKaryoTwoTrack(candidate);
  const bandToTrack = isTwoTrack ? karyoBandToTrackMap(candidate) : null;

  const rows = [];
  for (let si = 0; si < candidate.locked_labels.length; si++) {
    const s = d.samples[si] || {};
    const kLabel = candidate.locked_labels[si];
    rows.push({
      si,
      ind: s.ind || ('Ind' + si),
      cga: s.cga || s.ind || ('Ind' + si),
      k_label: kLabel,
      sigma: sd ? sd[si] : NaN,
      family_id: s.family_id != null ? s.family_id : -1,
      ancestry: s.ancestry || '',
      track_idx: (isTwoTrack && bandToTrack && Number.isInteger(kLabel)
                  && kLabel >= 0 && bandToTrack.has(kLabel))
                   ? bandToTrack.get(kLabel) : null,
    });
  }
  return rows;
}

/**
 * Sort a karyotype-row array (legacy `sortKaryoRows`). Stable
 * sort on the named key; numeric for `k_label` / `sigma` /
 * `family_id` / `si`, string-compare for everything else.
 * Non-finite numerics sort to the "lowest" position regardless of
 * direction.
 *
 * @param {Array<Object>} rows
 * @param {{key:string, asc?:boolean}} opts
 * @returns {Array<Object>}
 */
export function sortKaryoRows(rows, opts) {
  if (!Array.isArray(rows)) return [];
  const o = opts || {};
  const k = o.key || 'si';
  const asc = o.asc !== false;
  const isNumKey = (k === 'k_label' || k === 'sigma'
                    || k === 'family_id' || k === 'si');
  return rows.slice().sort((a, b) => {
    let av = a ? a[k] : null;
    let bv = b ? b[k] : null;
    if (isNumKey) {
      const na = Number.isFinite(av) ? av : -Infinity;
      const nb = Number.isFinite(bv) ? bv : -Infinity;
      return asc ? na - nb : nb - na;
    }
    av = av == null ? '' : String(av);
    bv = bv == null ? '' : String(bv);
    if (av < bv) return asc ? -1 : 1;
    if (av > bv) return asc ? 1 : -1;
    return 0;
  });
}
