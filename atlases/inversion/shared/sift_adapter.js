// shared/sift_adapter.js
// =====================================================================
// Deleterious-load (SIFT) adapter — the third overdominance / POD hallmark
// on the candidate & karyotype page: accumulation of deleterious mutations
// sheltered in the low-recombination arrangement.
//
// The score comes from an external SIFT C binary that scores variants in
// the region as deleterious vs tolerated. The frontend can't run a C
// binary directly, so this is an in/out JSON bridge to an /api endpoint
// (to be wired). It is INERT until that endpoint lands: buildSiftRequest
// produces the request body; parseSiftResponse tolerantly reads whatever
// per-group deleterious summary the binary returns; and the page shows
// "—" until a real response comes back.
//
// Pure request/parse. No DOM, no network.
// =====================================================================
import { buildKaryotypeGroups } from './candidate_region_stats.js';

export const SIFT_URL = '/api/sift/deleterious';
export const SIFT_METRIC = 'deleterious_load';
export const SIFT_SCHEMA = 'inversion-atlas/sift_deleterious_request@1';

/**
 * Build the OUT request for the SIFT deleterious-load endpoint for one
 * candidate region, grouped by karyotype (so the binary can report the
 * per-arrangement deleterious/tolerated breakdown).
 * @returns {Object|null}
 */
export function buildSiftRequest(candidate, samples, opts) {
  const o = opts || {};
  const g = buildKaryotypeGroups(candidate, samples);
  if (!g) return null;
  const chrom = candidate.chrom || o.chrom || null;
  if (!chrom) return null;
  const groups = {};
  if (g.all.length) groups.ALL = g.all;
  for (const [name, ids] of Object.entries(g.byKaryo)) if (ids.length) groups[name] = ids;
  if (Object.keys(groups).length === 0) return null;
  return {
    schema: SIFT_SCHEMA,
    metric: SIFT_METRIC,
    chrom,
    region: { start_bp: candidate.start_bp | 0, end_bp: candidate.end_bp | 0 },
    groups,
  };
}

/**
 * Parse the IN SIFT response into a region deleterious record. Tolerant of:
 *   A) per-group records: { groups|per_group: { NAME: { deleterious_load|
 *        del_tol_ratio|n_deleterious|n_tolerated }, … } }
 *   B) flat region scalars: { deleterious_load|del_tol_ratio|n_deleterious|
 *        n_tolerated|n_variants }
 * Region-level value = ALL group when present, else flat scalar, else mean
 * across groups. del_tol_ratio is derived from counts when not given.
 * @returns {{ deleterious_load, del_tol_ratio, n_variants, by_group, source }|null}
 */
export function parseSiftResponse(json) {
  if (!json || typeof json !== 'object') return null;

  const perGroup = _perGroup(json);
  const flat = _record(json);

  // Region-level: prefer ALL group, then flat, then mean across groups.
  let load = NaN, ratio = NaN, nVar = NaN;
  if (perGroup && perGroup.ALL) {
    load = perGroup.ALL.deleterious_load; ratio = perGroup.ALL.del_tol_ratio; nVar = perGroup.ALL.n_variants;
  }
  if (!Number.isFinite(load) && flat) { load = flat.deleterious_load; ratio = flat.del_tol_ratio; nVar = flat.n_variants; }
  if (!Number.isFinite(load) && perGroup) {
    const vals = Object.values(perGroup).map(r => r.deleterious_load).filter(Number.isFinite);
    if (vals.length) load = vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  if (!Number.isFinite(load) && !Number.isFinite(ratio) && !(perGroup)) return null;
  return {
    deleterious_load: Number.isFinite(load) ? load : NaN,
    del_tol_ratio: Number.isFinite(ratio) ? ratio : NaN,
    n_variants: Number.isFinite(nVar) ? nVar : NaN,
    by_group: perGroup || null,
    source: perGroup ? 'per_group' : 'flat',
  };
}

// Normalise one group/region record → { deleterious_load, del_tol_ratio, n_variants }.
function _record(info) {
  if (!info || typeof info !== 'object') return null;
  let load = _num(info.deleterious_load, info.del_load, info.load);
  let ratio = _num(info.del_tol_ratio, info.deleterious_tolerated_ratio, info.dt_ratio);
  const nDel = _num(info.n_deleterious, info.n_del, info.deleterious);
  const nTol = _num(info.n_tolerated, info.n_tol, info.tolerated);
  const nVar = _num(info.n_variants, info.n_sites, info.n);
  if (!Number.isFinite(ratio) && Number.isFinite(nDel) && Number.isFinite(nTol) && nTol > 0) {
    ratio = nDel / nTol;
  }
  if (!Number.isFinite(load) && Number.isFinite(nDel) && Number.isFinite(nVar) && nVar > 0) {
    load = nDel / nVar;                 // deleterious fraction as a fallback load
  }
  if (!Number.isFinite(load) && !Number.isFinite(ratio) &&
      !Number.isFinite(nDel) && !Number.isFinite(nVar)) return null;
  return {
    deleterious_load: load, del_tol_ratio: ratio,
    n_variants: Number.isFinite(nVar) ? nVar : (Number.isFinite(nDel) && Number.isFinite(nTol) ? nDel + nTol : NaN),
  };
}

function _perGroup(json) {
  const containers = [json.groups, json.per_group];
  for (const c of containers) {
    if (!c || typeof c !== 'object') continue;
    const out = {};
    let any = false;
    for (const [name, info] of Object.entries(c)) {
      const rec = _record(info);
      if (rec) { out[name] = rec; any = true; }
    }
    if (any) return out;
  }
  return null;
}

function _num(...xs) {
  for (const x of xs) { const v = +x; if (Number.isFinite(v)) return v; }
  return NaN;
}
