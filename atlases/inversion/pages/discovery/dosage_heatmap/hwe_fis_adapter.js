// pages/discovery/dosage_heatmap/hwe_fis_adapter.js
// =====================================================================
// HWE_F_IS overlay — Track 2 of the GHSL / HWE_F_IS overlay.
//
// HWE_F_IS (windowed population inbreeding coefficient, F_IS = 1 − Ho/He)
// is the genotype-FREQUENCY layer: negative = heterozygote excess,
// positive = heterozygote deficit. For low-coverage data it must NOT be
// hard-called in-page — it is computed externally in a genotype-likelihood
// popstats framework (ANGSD / PCAngsd / ngsF) and imported here via JSON.
//
// This module is the in/out JSON bridge to that popstats path:
//   - buildHweFisRequest(...)   → the OUT request body (which windows /
//                                 region / sample groups to score)
//   - parseHweFisResponse(...)  → the IN per-window HWE_F_IS curve,
//                                 tolerant of the common response shapes
//
// The combination high-GHSL (Track 1) + negative-HWE_F_IS (Track 2) is the
// heterozygote-excess divergent-haplotype-block / POD-compatible signal —
// neither curve is interpretable alone.
//
// Pure compute. No DOM, no network (the page performs the fetch).
// =====================================================================

export const HWE_FIS_METRIC = 'hwe_f_is';
export const HWE_FIS_SCHEMA = 'inversion-atlas/hwe_fis_request@1';

/**
 * Build the OUT request body for the popstats HWE_F_IS endpoint.
 *
 * @param {Object} opts
 *   chrom?: string
 *   region?: { start_bp?, end_bp? }
 *   windows?: Array<{ start_bp, end_bp }>   explicit windows (else scale)
 *   scale?: string                          windowing scale tag
 *   groups?: { name: [sampleId…] }          optional per-group stratification
 *             (e.g. full 226 vs relatedness-culled subset)
 * @returns {Object|null}
 */
export function buildHweFisRequest(opts) {
  const o = opts || {};
  const body = {
    schema: HWE_FIS_SCHEMA,
    metric: HWE_FIS_METRIC,
    chrom: o.chrom != null ? o.chrom : null,
    region: o.region
      ? { start_bp: o.region.start_bp != null ? o.region.start_bp : null,
          end_bp:   o.region.end_bp   != null ? o.region.end_bp   : null }
      : null,
  };
  if (Array.isArray(o.windows) && o.windows.length) {
    body.windows = o.windows.map(w => ({
      start_bp: w.start_bp != null ? w.start_bp : null,
      end_bp:   w.end_bp   != null ? w.end_bp   : null,
    }));
  } else if (o.scale != null) {
    body.scale = o.scale;
  }
  if (o.groups && typeof o.groups === 'object') {
    const g = {};
    let any = false;
    for (const name of Object.keys(o.groups)) {
      const m = o.groups[name];
      if (Array.isArray(m) && m.length) { g[name] = m.slice(); any = true; }
    }
    if (any) body.groups = g;
  }
  return body;
}

/**
 * Parse the IN popstats response into a per-window HWE_F_IS curve.
 * Tolerant of three shapes:
 *   A) { windows | per_window: [{ start_bp, end_bp, mid?, hwe_f_is|HWE_F_IS|fis,
 *        n_sites?, p_value?|p? }, …] }
 *   B) columnar: { hwe_f_is|HWE_F_IS|fis: [...], win_mid|win_start: [...],
 *                  n_sites?: [...], p_value?: [...] }
 *   C) nested under a group: { groups: { GroupName: <A or B> } } + opts.group
 *
 * @param {Object} json
 * @param {Object} [opts]  { group?: string, sigAlpha?: number (default 0.05) }
 * @returns {Object|null}
 *   { n_windows, win_x, hwe_f_is, n_sites, significant, group, source }
 */
export function parseHweFisResponse(json, opts) {
  const o = opts || {};
  if (!json || typeof json !== 'object') return null;
  const sigAlpha = Number.isFinite(o.sigAlpha) ? o.sigAlpha : 0.05;

  let node = json;
  let group = null;
  if (json.groups && typeof json.groups === 'object') {
    group = o.group && json.groups[o.group] ? o.group : Object.keys(json.groups)[0];
    if (group != null) node = json.groups[group];
  }
  if (!node || typeof node !== 'object') return null;

  const rows = Array.isArray(node.windows) ? node.windows
            : Array.isArray(node.per_window) ? node.per_window
            : null;

  let W, getF, getX, getN, getP;
  if (rows) {                                   // shape A — array of records
    W = rows.length;
    getF = (w) => _num(rows[w].hwe_f_is, rows[w].HWE_F_IS, rows[w].fis, rows[w].F_IS);
    getX = (w) => _winMid(rows[w], w);
    getN = (w) => _num(rows[w].n_sites, rows[w].nSites);
    getP = (w) => _num(rows[w].p_value, rows[w].p, rows[w].pval);
  } else {                                      // shape B — columnar arrays
    const F = node.hwe_f_is || node.HWE_F_IS || node.fis || node.F_IS;
    if (!Array.isArray(F)) return null;
    W = F.length;
    const mid = node.win_mid || node.mid;
    const start = node.win_start || node.start_bp;
    const end = node.win_end || node.end_bp;
    const NS = node.n_sites;
    const PV = node.p_value || node.p;
    getF = (w) => _num(F[w]);
    getX = (w) => Array.isArray(mid) ? _num(mid[w], w)
                : (Array.isArray(start) && Array.isArray(end)) ? ((+start[w] + +end[w]) / 2)
                : w;
    getN = (w) => Array.isArray(NS) ? _num(NS[w]) : NaN;
    getP = (w) => Array.isArray(PV) ? _num(PV[w]) : NaN;
  }
  if (!(W > 0)) return null;

  const hwe_f_is = new Float64Array(W).fill(NaN);
  const win_x    = new Float64Array(W);
  const n_sites  = new Float64Array(W).fill(NaN);
  const significant = new Uint8Array(W);
  let anySig = false;
  for (let w = 0; w < W; w++) {
    hwe_f_is[w] = getF(w);
    const x = getX(w); win_x[w] = Number.isFinite(x) ? x : w;
    n_sites[w] = getN(w);
    const p = getP(w);
    if (Number.isFinite(p) && p <= sigAlpha) { significant[w] = 1; anySig = true; }
  }

  return {
    n_windows: W, win_x, hwe_f_is, n_sites,
    significant: anySig ? significant : null,
    group, source: rows ? 'records' : 'columnar',
  };
}

function _num(...xs) {
  for (const x of xs) { const v = +x; if (Number.isFinite(v)) return v; }
  return NaN;
}
function _winMid(rec, w) {
  if (Number.isFinite(rec.mid)) return rec.mid;
  if (Number.isFinite(rec.start_bp) && Number.isFinite(rec.end_bp)) return (rec.start_bp + rec.end_bp) / 2;
  if (Number.isFinite(rec.start) && Number.isFinite(rec.end)) return (rec.start + rec.end) / 2;
  return w;
}
