// shared/band_haplotype_assign.js
//
// Band-level H-system haplotype labelling (legacy lines 37662-37726:
// _dbdAssignHaplotypes). Pure: given a per-band interpretation array
// + a per-sample PC1 vector + per-sample band labels, emit the
// detailed-mode label for each band:
//
//   - hom-like bands → H<n>/H<n> where n is the rank among hom-like
//     bands ordered by ascending median PC1 (H1 is the lowest)
//   - het-like bands → H<a>/H<b> where {a, b} are the two
//     hom-like bands with closest median PC1 to this band
//   - other interpretations → legacy "band N" label
//
// The legacy label generator (`getKaryotypeLabel`) is injected via
// opts.legacyLabel so this module stays free of vocab globals.
// Default fallback emits "band N" (1-based).
//
// Pure: no DOM, no state writes. Caller passes PC1 + labels
// explicitly — see opts.getPC1Snapshot for state-coupled lookup.

/** Default "band N" (1-based) label fallback. */
function _defaultLegacyLabel(bandIdx /*, K */) {
  if (bandIdx == null || bandIdx < 0) return '?';
  return 'band ' + (bandIdx + 1);
}

/**
 * Compute median PC1 per band from per-sample PC1 values.
 *
 * @param {Array<Object>} per_band  rows of `{band, n}`
 * @param {Float32Array|Array<number>} pc1  per-sample PC1
 * @param {Int8Array|Array<number>} labels per-sample band label
 * @param {number} nS  number of samples
 * @returns {Array<number|null>}  index = pb.band → median PC1 (or null)
 */
export function medianPC1PerBand(per_band, pc1, labels, nS) {
  if (!Array.isArray(per_band) || !pc1 || !labels) return [];
  const K = per_band.length;
  const medians = new Array(K).fill(null);
  for (let i = 0; i < K; i++) {
    const pb = per_band[i];
    if (!pb || pb.n === 0) continue;
    const vals = [];
    for (let si = 0; si < nS; si++) {
      if (labels[si] === pb.band) {
        const v = pc1[si];
        if (Number.isFinite(v)) vals.push(v);
      }
    }
    if (vals.length === 0) continue;
    vals.sort((a, b) => a - b);
    medians[pb.band] = vals[Math.floor(vals.length / 2)];
  }
  return medians;
}

/**
 * Assign H-system haplotype labels per band.
 *
 * `per_band` entries must carry:
 *   - `band`: integer band index (0..K-1)
 *   - `n`: count of samples in that band
 *   - `interpretation`: 'hom-like' | 'het-like' | other
 *
 * `opts.pc1` is required for non-trivial assignment. When missing or
 * `opts.getPC1Snapshot` is supplied, the snapshot fn is invoked once.
 *
 * Returns an array (one row per per_band entry) of:
 *   {band, sub_band, label_legacy, label_detailed,
 *    haplotype_class, interpretation}
 *
 * @param {Array<Object>} per_band
 * @param {{pc1?:Array<number>, labels?:Array<number>, nS?:number,
 *          K?:number, legacyLabel?:Function,
 *          getPC1Snapshot?:Function}} opts
 * @returns {Array<Object>}
 */
export function assignBandHaplotypes(per_band, opts) {
  if (!Array.isArray(per_band)) return [];
  const o = opts || {};
  const K = o.K || 3;
  const legacyLabelFn = typeof o.legacyLabel === 'function'
    ? o.legacyLabel : _defaultLegacyLabel;
  const labels = o.labels || [];
  const nS = Number.isFinite(o.nS) ? o.nS : labels.length;

  let pc1 = o.pc1;
  if ((!pc1 || pc1.length === 0)
      && typeof o.getPC1Snapshot === 'function') {
    try { pc1 = o.getPC1Snapshot(nS); } catch (_) { pc1 = null; }
  }

  const medians = pc1
    ? medianPC1PerBand(per_band, pc1, labels, nS)
    : new Array(per_band.length).fill(null);

  // Order hom-like bands by median PC1 ascending → H1, H2, H3.
  // Bands without a median (n=0 or null pc1) sort to the end. When NO
  // hom-like band has a usable median (e.g. pc1 unavailable), skip
  // H-system assignment entirely — emitting H1/H2/H3 without PC1
  // ordering would be meaningless.
  const homBands = per_band.filter(pb => pb && pb.interpretation === 'hom-like');
  homBands.sort((a, b) => {
    const ma = medians[a.band], mb = medians[b.band];
    if (ma == null) return 1;
    if (mb == null) return -1;
    return ma - mb;
  });
  const anyHomMedian = homBands.some(hb => medians[hb.band] != null);
  const homHIndex = Object.create(null);
  if (anyHomMedian) {
    for (let i = 0; i < homBands.length && i < 3; i++) {
      homHIndex[homBands[i].band] = i + 1;
    }
  }

  const out = [];
  for (const pb of per_band) {
    if (!pb) continue;
    const legacyLbl = legacyLabelFn(pb.band, K);
    let detailedLbl = legacyLbl;
    let haplotypeClass = null;

    if (pb.interpretation === 'hom-like') {
      const h = homHIndex[pb.band];
      if (h) {
        haplotypeClass = 'H' + h + '/H' + h;
        detailedLbl = haplotypeClass;
      }
    } else if (pb.interpretation === 'het-like') {
      const myPc1 = medians[pb.band];
      if (myPc1 != null && homBands.length >= 2) {
        const ranked = homBands
          .map(hb => ({ hb, d: Math.abs((medians[hb.band] || 0) - myPc1) }))
          .sort((x, y) => x.d - y.d);
        const a = homHIndex[ranked[0].hb.band];
        const b = homHIndex[ranked[1].hb.band];
        if (a && b) {
          const lo = Math.min(a, b), hi = Math.max(a, b);
          haplotypeClass = 'H' + lo + '/H' + hi;
          detailedLbl = haplotypeClass;
        }
      }
    }

    out.push({
      band: pb.band,
      sub_band: null,
      label_legacy: legacyLbl,
      label_detailed: detailedLbl,
      haplotype_class: haplotypeClass,
      interpretation: pb.interpretation,
    });
  }
  return out;
}
