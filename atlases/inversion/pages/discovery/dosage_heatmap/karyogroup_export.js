// pages/discovery/dosage_heatmap/karyogroup_export.js
// =====================================================================
// Turn a detected karyogroup partition (+ its per-window boundary stats)
// into a portable export for downstream FST / population-genetics
// analysis — either as a standalone JSON artifact or as the request body
// for the in-repo /api/popstats/groupwise endpoint that candidate_focus
// already uses.
//
// The groups map ({ karyogroup → [sampleId…] }) is exactly the shape the
// popstats groupwise contract expects, so the karyogroups we detect here
// feed straight into "FST between arrangements" — the elevated-inside /
// dropped-outside signal that validates the block.
//
// Pure compute. No DOM, no network.
// =====================================================================
import { karyogroupName } from './dosage_detect.js';

export const KARYOGROUP_EXPORT_SCHEMA = 'inversion-atlas/karyogroup_export@1';

/**
 * Build the export payload from a detection result + (optional) per-window
 * stats.
 *
 * @param {Object} canonical  adapter output (sample_labels, n_samples…)
 * @param {Object} detect     detectGroups / clusterIndexAware result
 *   (needs labels, k; uses karyogroup, regime_call, mean, groups)
 * @param {Object} [kgstats]  computeKaryogroupStats result (optional)
 * @param {Object} [opts]
 *   region?: { chrom?, start_bp?, end_bp? }   analysis region (defaults to
 *                                             the detected block span)
 *   generated?: string                        ISO timestamp override (tests)
 * @returns {Object|null}
 */
export function buildKaryogroupExport(canonical, detect, kgstats, opts) {
  const o = opts || {};
  if (!canonical || !detect || !detect.labels) return null;
  const labels = detect.labels;
  const K = Number.isFinite(detect.k) ? (detect.k | 0) : 0;
  if (K < 1) return null;
  const nS = (canonical.n_samples | 0) || labels.length;
  const sampleLabels = canonical.sample_labels || null;
  const idOf = (s) => (sampleLabels && sampleLabels[s] != null) ? String(sampleLabels[s]) : ('s' + s);

  // groups map (karyogroup → [sampleId]) + per-sample records.
  const groups_map = {};
  for (let g = 0; g < K; g++) groups_map[karyogroupName(g)] = [];
  const samples = [];
  for (let s = 0; s < nS; s++) {
    const g = labels[s];
    const kg = (g >= 0 && g < K) ? karyogroupName(g) : null;
    if (kg) groups_map[kg].push(idOf(s));
    samples.push({
      sample: idOf(s),
      karyogroup: kg,
      dosage_mean: (detect.mean && Number.isFinite(detect.mean[s])) ? detect.mean[s] : null,
      regime_call: (detect.regime_call && detect.regime_call[s]) || null,
      confidence: (detect.margin && Number.isFinite(detect.margin[s])) ? detect.margin[s] : null,
    });
  }

  // Per-karyogroup summary (from detect.groups when available).
  const karyogroups = [];
  for (let g = 0; g < K; g++) {
    const rec = (detect.groups && detect.groups[g]) || null;
    const name = karyogroupName(g);
    karyogroups.push({
      id: name,
      n: groups_map[name].length,
      tier: rec && rec.call ? rec.call.replace('_like', '') : null,
      mean_dosage: rec && Number.isFinite(rec.mean_dosage) ? rec.mean_dosage : null,
      confidence:  rec && Number.isFinite(rec.confidence)  ? rec.confidence  : null,
      separation:  rec && Number.isFinite(rec.separation)  ? rec.separation  : null,
    });
  }

  // Region: explicit opts, else the detected block span, else null.
  let region = o.region || null;
  if (!region && kgstats && kgstats.block) {
    region = {
      chrom: null,
      start_bp: Number.isFinite(kgstats.block.start_bp) ? kgstats.block.start_bp : null,
      end_bp:   Number.isFinite(kgstats.block.end_bp)   ? kgstats.block.end_bp   : null,
    };
  }

  const out = {
    schema: KARYOGROUP_EXPORT_SCHEMA,
    generated: o.generated || (typeof Date !== 'undefined' ? new Date().toISOString() : null),
    mode: detect.mode || null,
    k: K,
    n_samples: nS,
    region,
    karyogroups,
    groups_map,
    samples,
  };

  if (kgstats) {
    out.boundary = {
      n_windows: kgstats.n_windows,
      n_inside: kgstats.n_inside,
      n_outside: kgstats.n_outside,
      frac_inside: kgstats.frac_inside,
      block: kgstats.block || null,
      summary: kgstats.summary || null,
      thresholds: kgstats.thresholds || null,
      windows: Array.isArray(kgstats.windows) ? kgstats.windows : null,
    };
  }
  return out;
}

/**
 * Shape an export into the /api/popstats/groupwise request body. Drops
 * empty / singleton karyogroups (FST needs ≥2 members per group and ≥2
 * groups). Returns null when fewer than 2 usable groups remain.
 *
 * @param {Object} exportObj  buildKaryogroupExport output
 * @param {Object} [opts]
 *   metrics?: string[]   default ['fst']
 *   minPerGroup?: number  default 2
 * @returns {{ chrom, region, groups, metrics } | null}
 */
export function buildPopstatsRequest(exportObj, opts) {
  const o = opts || {};
  if (!exportObj || !exportObj.groups_map) return null;
  const metrics = Array.isArray(o.metrics) && o.metrics.length ? o.metrics : ['fst'];
  const minPerGroup = Number.isFinite(o.minPerGroup) ? (o.minPerGroup | 0) : 2;
  const groups = {};
  let nUsable = 0;
  for (const name of Object.keys(exportObj.groups_map)) {
    const members = exportObj.groups_map[name];
    if (Array.isArray(members) && members.length >= minPerGroup) { groups[name] = members; nUsable++; }
  }
  if (nUsable < 2) return null;
  const region = exportObj.region || {};
  return {
    chrom: (o.chrom != null ? o.chrom : (region.chrom != null ? region.chrom : null)),
    region: { start_bp: region.start_bp != null ? region.start_bp : null,
              end_bp:   region.end_bp   != null ? region.end_bp   : null },
    groups,
    metrics,
  };
}
