// shared/candidate_region_stats.js
// =====================================================================
// Per-region (per-inversion / per-LRR) population statistics for the
// candidate list on the candidate & karyotype page — computed on the fly
// from the popstats groupwise endpoint, grouped by karyotype.
//
// Two of the three "overdominance / POD" hallmarks come from here:
//   - FIS (HWE_F_IS): heterozygote excess. Negative = excess of
//     heterozygotes vs HWE — the balancing-selection / POD signal.
//   - theta_pi: nucleotide diversity (maintenance of higher diversity).
// The third hallmark (deleterious load) comes from sift_adapter.js.
//
// Samples are grouped by the candidate's locked karyotype labels, plus an
// ALL group so we get a region-WIDE FIS / diversity (the manuscript
// Table-1 per-region value) alongside per-arrangement breakdowns.
//
// Pure request-building + response-parsing. No DOM, no network (the page
// performs the POST).
// =====================================================================

export const GROUPWISE_URL = '/api/popstats/groupwise';
export const REGION_STATS_METRICS = Object.freeze(['hwe_f_is', 'theta_pi']);

// Canonical karyotype-group names. K=3 → the operational H-system
// (HOMO_1 / HET / HOMO_2, ordered by increasing dosage); other K → band_k.
export function karyotypeGroupName(k, K) {
  if (K === 3) return ['HOMO_1', 'HET', 'HOMO_2'][k] || ('band_' + k);
  return 'band_' + k;
}

export function sampleId(s) {
  if (!s) return null;
  return s.cga || s.ind || s.sample_id || s.id || null;
}

/**
 * Partition samples into per-karyotype sample-ID groups + an ALL group.
 * @returns {{ byKaryo:Object, all:string[], K:number }|null}
 */
export function buildKaryotypeGroups(candidate, samples) {
  if (!candidate || !candidate.locked_labels) return null;
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const labels = candidate.locked_labels;
  if (labels.length !== samples.length) return null;      // shape mismatch → bail
  const K = candidate.K || 3;
  const byKaryo = {};
  const all = [];
  for (let i = 0; i < labels.length; i++) {
    const sid = sampleId(samples[i]);
    if (!sid) continue;
    all.push(sid);
    const k = labels[i];
    if (k < 0 || k >= K) continue;                        // ambiguous / unassigned
    (byKaryo[karyotypeGroupName(k, K)] ||= []).push(sid);
  }
  return { byKaryo, all, K };
}

/**
 * Build the popstats groupwise request body for one candidate region.
 * @returns {Object|null}
 */
export function buildRegionStatsRequest(candidate, samples, opts) {
  const o = opts || {};
  const g = buildKaryotypeGroups(candidate, samples);
  if (!g) return null;
  const chrom = candidate.chrom || o.chrom || null;
  if (!chrom) return null;
  const groups = {};
  if (g.all.length) groups.ALL = g.all;                   // region-wide FIS / diversity
  for (const [name, ids] of Object.entries(g.byKaryo)) if (ids.length) groups[name] = ids;
  if (Object.keys(groups).length === 0) return null;
  return {
    chrom,
    region: { start_bp: candidate.start_bp | 0, end_bp: candidate.end_bp | 0 },
    groups,
    metrics: (Array.isArray(o.metrics) && o.metrics.length) ? o.metrics.slice()
                                                            : REGION_STATS_METRICS.slice(),
  };
}

// Pull { groupName: value } for a metric out of the groupwise response,
// tolerant of {groups:{…}} / {per_group:{…}} / flat {…} containers.
function _extractPerGroup(data, keys) {
  const containers = [data && data.groups, data && data.per_group, data];
  for (const c of containers) {
    if (!c || typeof c !== 'object') continue;
    const out = {};
    let any = false;
    for (const [name, info] of Object.entries(c)) {
      if (name === 'pairs' || name === 'pairwise' || name === 'groups') continue;
      if (!info || typeof info !== 'object') continue;
      for (const key of keys) {
        const v = info[key];
        if (typeof v === 'number' && Number.isFinite(v)) { out[name] = v; any = true; break; }
      }
    }
    if (any) return out;
  }
  return null;
}

function _mean(vals) {
  let n = 0, s = 0;
  for (const v of vals) if (Number.isFinite(v)) { s += v; n++; }
  return n > 0 ? s / n : NaN;
}
function _nSites(data) {
  const g = _extractPerGroup(data, ['n_sites', 'nSites', 'n_snps']);
  if (g && Number.isFinite(g.ALL)) return g.ALL;
  if (data && Number.isFinite(data.n_sites)) return data.n_sites;
  return NaN;
}

/**
 * Parse the groupwise response into a region-level stats record.
 * Region-wide value is the ALL group when present, else the mean across
 * karyotype groups.
 * @returns {{ fis, theta_pi, fis_by_group, theta_pi_by_group, n_sites, source }|null}
 */
export function parseRegionStatsResponse(json) {
  if (!json || typeof json !== 'object') return null;
  const fisG = _extractPerGroup(json, ['hwe_f_is', 'HWE_F_IS', 'fis', 'F_IS']);
  const thG  = _extractPerGroup(json, ['theta_pi', 'thetaPi', 'pi']);
  if (!fisG && !thG) return null;
  const regionVal = (g) => {
    if (!g) return NaN;
    return Number.isFinite(g.ALL) ? g.ALL : _mean(Object.values(g));
  };
  return {
    fis: regionVal(fisG),
    theta_pi: regionVal(thG),
    fis_by_group: fisG || null,
    theta_pi_by_group: thG || null,
    n_sites: _nSites(json),
    source: 'groupwise',
  };
}
