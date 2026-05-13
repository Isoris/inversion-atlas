// shared/band_tracking/iv.js
// =====================================================================
// Per-sample karyotype caller from a het skeleton + HOM_A/B anchors.
//
// This is the TAIL of the band-tracking pipeline (see
// index.js header diagram). Inputs:
//
//   - skeleton          output of het.js#het_track_skeleton
//   - hom_anchor        output of hom.js#hom_anchor_to_het
//   - getLabels(w)      per-window K-means labels (cartridge per-
//                        window contract, NOT L2-broadcast)
//   - getK(w)           per-window K
//
// For each sample in the cohort, walk every window in the skeleton's
// [s_window, e_window] range and tally per-window membership:
//
//   - n_in_het:    sample sat in the het band at this window
//   - n_in_hom_a:  sample sat in the HOM_A band
//   - n_in_hom_b:  sample sat in the HOM_B band
//   - n_other:    sample had no label / was in some other band
//
// Then emit a categorical call:
//
//   STD/STD  (HOM_A homozygote) — dominant n_in_hom_a above threshold
//   INV/INV  (HOM_B homozygote) — dominant n_in_hom_b above threshold
//   HET      — dominant n_in_het above threshold
//   AMBIGUOUS — no single category dominates
//   UNCALLED — too few informative windows (n_in_het + n_in_hom_a +
//              n_in_hom_b < min_informative)
//
// All thresholds configurable. Pure JS — no DOM, no fetch.

/** Karyotype-call vocab. */
export const IV_CALLS = Object.freeze({
  STD_STD:   'STD/STD',     // HOM_A homozygote
  HET:       'HET',
  INV_INV:   'INV/INV',     // HOM_B homozygote
  AMBIGUOUS: 'AMBIGUOUS',
  UNCALLED:  'UNCALLED',
});

/** Defaults for the call thresholds. */
export const IV_CALL_DEFAULTS = Object.freeze({
  // A sample needs ≥ `dominant_frac` of its informative window-
  // memberships in one category to receive that call.
  dominant_frac: 0.66,
  // Minimum informative window-memberships (n_in_het +
  // n_in_hom_a + n_in_hom_b) below which the sample is UNCALLED.
  min_informative: 3,
});

/**
 * Call per-sample karyotypes from a het skeleton + HOM anchors.
 *
 * Returns:
 *   {
 *     ok: boolean,
 *     reason?: string,
 *     n_samples: int,
 *     n_windows: int,           // length of skeleton.windows
 *     calls: Map<sampleIdx, {
 *       call:           IV_CALLS.*,
 *       n_in_het, n_in_hom_a, n_in_hom_b, n_other,
 *       dominant_frac,   // fraction in the dominant category
 *     }>,
 *     summary: {
 *       n_std_std, n_het, n_inv_inv, n_ambiguous, n_uncalled,
 *     }
 *   }
 *
 * The cohort sample list is inferred from the FIRST window's labels
 * length; callers can override via `opts.n_samples`.
 *
 * @param {Object} args
 * @param {Object} args.skeleton
 * @param {Object} args.hom_anchor
 * @param {(w:number) => Int8Array|null} args.getLabels
 * @param {(w:number) => number}         args.getK
 * @param {{dominant_frac?:number, min_informative?:number,
 *          n_samples?:number}} [opts]
 * @returns {Object}
 */
export function iv_call_samples_from_skeleton(args, opts) {
  if (!args || !args.skeleton || !args.skeleton.ok) {
    return { ok: false, reason: 'NO_SKELETON' };
  }
  if (!args.hom_anchor || !args.hom_anchor.ok) {
    return { ok: false, reason: 'NO_HOM_ANCHOR' };
  }
  if (typeof args.getLabels !== 'function'
      || typeof args.getK !== 'function') {
    return { ok: false, reason: 'NO_CALLBACKS' };
  }
  const o = opts || {};
  const dominantFrac = Number.isFinite(o.dominant_frac)
    ? o.dominant_frac : IV_CALL_DEFAULTS.dominant_frac;
  const minInformative = Number.isFinite(o.min_informative)
    ? o.min_informative : IV_CALL_DEFAULTS.min_informative;

  const skel = args.skeleton;
  const homA_pw = args.hom_anchor.hom_a_per_window;
  const homB_pw = args.hom_anchor.hom_b_per_window;
  if (!Array.isArray(homA_pw) || !Array.isArray(homB_pw)) {
    return { ok: false, reason: 'NO_HOM_PER_WINDOW' };
  }
  if (homA_pw.length !== skel.windows.length
      || homB_pw.length !== skel.windows.length) {
    return { ok: false, reason: 'HOM_LENGTH_MISMATCH' };
  }

  // Resolve cohort size.
  let n_samples = Number.isFinite(o.n_samples) ? o.n_samples : null;
  if (n_samples == null && skel.windows.length > 0) {
    const firstLabels = args.getLabels(skel.windows[0].w);
    if (firstLabels && typeof firstLabels.length === 'number') {
      n_samples = firstLabels.length;
    }
  }
  if (!Number.isFinite(n_samples) || n_samples <= 0) {
    return { ok: false, reason: 'NO_COHORT_SIZE' };
  }

  // Per-sample tallies.
  const tallies = new Array(n_samples);
  for (let si = 0; si < n_samples; si++) {
    tallies[si] = { n_in_het: 0, n_in_hom_a: 0, n_in_hom_b: 0, n_other: 0 };
  }

  for (let wi = 0; wi < skel.windows.length; wi++) {
    const rec = skel.windows[wi];
    const labels = args.getLabels(rec.w);
    if (!labels) continue;
    const setA = homA_pw[wi];
    const setB = homB_pw[wi];
    const k_het = rec.k;
    for (let si = 0; si < n_samples; si++) {
      const lbl = labels[si];
      if (lbl == null) { tallies[si].n_other++; continue; }
      if (lbl === k_het) { tallies[si].n_in_het++; continue; }
      if (setA && setA.has(si)) { tallies[si].n_in_hom_a++; continue; }
      if (setB && setB.has(si)) { tallies[si].n_in_hom_b++; continue; }
      tallies[si].n_other++;
    }
  }

  const calls = new Map();
  const summary = {
    n_std_std: 0, n_het: 0, n_inv_inv: 0,
    n_ambiguous: 0, n_uncalled: 0,
  };
  for (let si = 0; si < n_samples; si++) {
    const t = tallies[si];
    const informative = t.n_in_het + t.n_in_hom_a + t.n_in_hom_b;
    let call = IV_CALLS.UNCALLED;
    let domFrac = 0;
    if (informative >= minInformative) {
      const counts = [t.n_in_hom_a, t.n_in_het, t.n_in_hom_b];
      const tags  = [IV_CALLS.STD_STD, IV_CALLS.HET, IV_CALLS.INV_INV];
      let maxC = 0, maxI = -1;
      for (let i = 0; i < counts.length; i++) {
        if (counts[i] > maxC) { maxC = counts[i]; maxI = i; }
      }
      domFrac = informative > 0 ? maxC / informative : 0;
      call = (maxI >= 0 && domFrac >= dominantFrac)
        ? tags[maxI] : IV_CALLS.AMBIGUOUS;
    }
    calls.set(si, Object.assign({}, t, { call, dominant_frac: domFrac }));
    if      (call === IV_CALLS.STD_STD)   summary.n_std_std++;
    else if (call === IV_CALLS.HET)       summary.n_het++;
    else if (call === IV_CALLS.INV_INV)   summary.n_inv_inv++;
    else if (call === IV_CALLS.AMBIGUOUS) summary.n_ambiguous++;
    else                                  summary.n_uncalled++;
  }

  return {
    ok: true,
    n_samples,
    n_windows: skel.windows.length,
    calls,
    summary,
  };
}
