// shared/scale_stability.js
//
// Scale-stability verdict logic + display labels. SCHEMA §27 defines
// five verdict tags for "does this candidate's K-cluster structure
// hold across three scales (fine / medium / coarse)?":
//
//   STABLE_3BAND      K=3 holds across all three; classic single inversion
//   STABLE_6BAND      K=6 holds across all three; compound or multi-haplotype
//   NESTED_3IN6       K=6 fine collapses cleanly to K=3 coarse (3 fuses, 0 splits)
//   OVERLAP_BREAKS_3  edges K=3, middle K=6 with structure on both gaps —
//                     possible two overlapping inversions
//   UNSTABLE          everything else — low ARI somewhere, artifact-suspect
//
// This module ships the pure decision + display layer. The big
// orchestrator (_scaleStabilityCompute) stays in legacy — it walks
// the cluster pipeline (getSlabClusterAt + contingency + ARI/NMI).
//
// Legacy origin:
//   - _scaleStabilityVerdict     line 12408
//   - _scaleStabilityFingerprint line 12481
//   - _scaleStabilityVerdictText line 12595
//   - _scaleStabilityVerdictCss  line 12617
//   - _scaleStabilityPaneLabel   line 12628
//
// All entry points are pure (no state mutation, no localStorage).
// _scaleStabilityFingerprint reads optional state fields but never
// writes; it's safe to call with any plain object.

// =====================================================================
// Constants
// =====================================================================

/** The five SCHEMA §27 verdict tags, frozen. */
export const SCALE_STABILITY_VERDICTS = Object.freeze([
  'STABLE_3BAND',
  'STABLE_6BAND',
  'NESTED_3IN6',
  'OVERLAP_BREAKS_3',
  'UNSTABLE',
]);

/** Default ARI thresholds for the verdict logic. */
export const SCALE_STABILITY_DEFAULTS = Object.freeze({
  ari_stable: 0.85,    // ARI ≥ this on both gaps → STABLE_*
  ari_edge:   0.70,    // (reserved for future edge-verdicts; not used in v1)
});

// =====================================================================
// Verdict
// =====================================================================

/**
 * Apply the SCHEMA §27 decision tree to three panes + two pairwise
 * gap summaries, returning one of SCALE_STABILITY_VERDICTS.
 *
 *   panes:    [{ K, ok, ... }, { K, ok, ... }, { K, ok, ... }]
 *   pairwise: [{ contingency, fuseEvents, splitEvents, ari, nmi },
 *              { contingency, fuseEvents, splitEvents, ari, nmi }]
 *   opts:     { ari_stable: 0.85, ari_edge: 0.70 }
 *
 * Returns 'UNSTABLE' when panes/pairwise are the wrong shape, any
 * pane has ok === false, or ARI < 0.5 on a gap with no fuse/split
 * events explaining the disagreement.
 *
 * NESTED_3IN6 = K=6 fine + K=3 coarse with exactly 3 fuses and 0
 * splits on the 6→3 transition (it can happen at either pane gap,
 * depending on whether the middle pane is K=6 or K=3).
 *
 * OVERLAP_BREAKS_3 = edges K=3, middle K=6 with structure on BOTH
 * gaps (each shows ≥1 fuse or split).
 */
export function scaleStabilityVerdict(panes, pairwise, opts) {
  const t = Object.assign({}, SCALE_STABILITY_DEFAULTS, opts || {});
  if (!Array.isArray(panes) || panes.length !== 3) return 'UNSTABLE';
  if (!Array.isArray(pairwise) || pairwise.length !== 2) return 'UNSTABLE';
  const allOk = panes.every(p => p && p.ok !== false);
  if (!allOk) return 'UNSTABLE';
  const Ks = panes.map(p => p.K | 0);
  const ari12 = pairwise[0] && Number.isFinite(pairwise[0].ari) ? pairwise[0].ari : NaN;
  const ari23 = pairwise[1] && Number.isFinite(pairwise[1].ari) ? pairwise[1].ari : NaN;
  const nFuse12  = (pairwise[0] && pairwise[0].fuseEvents)  ? pairwise[0].fuseEvents.length  : 0;
  const nFuse23  = (pairwise[1] && pairwise[1].fuseEvents)  ? pairwise[1].fuseEvents.length  : 0;
  const nSplit12 = (pairwise[0] && pairwise[0].splitEvents) ? pairwise[0].splitEvents.length : 0;
  const nSplit23 = (pairwise[1] && pairwise[1].splitEvents) ? pairwise[1].splitEvents.length : 0;

  // ARI < 0.5 anywhere → UNSTABLE — BUT NOT when fuses/splits explain
  // the disagreement. A clean K=6→K=3 collapse (NESTED_3IN6) has
  // ARI ~0.4 by construction (labels can't agree fully when one pane
  // has 6 distinct labels and the other has 3). Fuses are positive
  // evidence of nested structure that the ARI floor would misread.
  const lowAri12 = Number.isFinite(ari12) && ari12 < 0.5;
  const lowAri23 = Number.isFinite(ari23) && ari23 < 0.5;
  const explained12 = (nFuse12 + nSplit12) > 0;
  const explained23 = (nFuse23 + nSplit23) > 0;
  if (lowAri12 && !explained12) return 'UNSTABLE';
  if (lowAri23 && !explained23) return 'UNSTABLE';

  const allK3 = Ks[0] === 3 && Ks[1] === 3 && Ks[2] === 3;
  const allK6 = Ks[0] === 6 && Ks[1] === 6 && Ks[2] === 6;
  const noFuse  = (nFuse12 === 0  && nFuse23 === 0);
  const noSplit = (nSplit12 === 0 && nSplit23 === 0);
  const ariStable = Number.isFinite(ari12) && Number.isFinite(ari23)
    && ari12 >= t.ari_stable && ari23 >= t.ari_stable;

  if (allK3 && noFuse && noSplit && ariStable) return 'STABLE_3BAND';
  if (allK6 && noFuse && noSplit && ariStable) return 'STABLE_6BAND';

  // NESTED_3IN6: K=6 fine, K=3 coarse, 3 fuses + 0 splits on the
  // crossover gap. Middle pane can be K=6 (collapse at 2↔3) or K=3
  // (collapse at 1↔2).
  const isNestedTransition = (KA, KB, fuses, splits) =>
    KA === 6 && KB === 3 && fuses === 3 && splits === 0;
  if (Ks[0] === 6 && Ks[2] === 3) {
    const t12 = isNestedTransition(Ks[0], Ks[1], nFuse12, nSplit12);
    const t23 = isNestedTransition(Ks[1], Ks[2], nFuse23, nSplit23);
    if ((Ks[1] === 6 && t23) || (Ks[1] === 3 && t12)) return 'NESTED_3IN6';
  }

  // OVERLAP_BREAKS_3: edges K=3, middle K=6, both gaps have structure
  if (Ks[0] === 3 && Ks[2] === 3 && Ks[1] === 6) {
    const middleHasStructure = (nFuse12 > 0 || nSplit12 > 0)
                            && (nFuse23 > 0 || nSplit23 > 0);
    if (middleHasStructure) return 'OVERLAP_BREAKS_3';
  }

  return 'UNSTABLE';
}

// =====================================================================
// Cache fingerprint
// =====================================================================

/**
 * Compose a fingerprint string that uniquely identifies the inputs
 * to scaleStabilityVerdict. Any change → re-cluster the affected pane(s).
 *
 * Inputs read from state (all optional):
 *   - state.scaleStabilityPanes[]: each {scale, K, custom_n}
 *   - state.cur: focal window index
 *   - state.aggMethod, state.minNGroup: cluster knobs
 *   - state.candidate.id: active candidate
 *   - state.data.chrom: chromosome
 *
 * @param {Object} state
 * @returns {string}
 */
export function scaleStabilityFingerprint(state) {
  const s = state || {};
  const panes = Array.isArray(s.scaleStabilityPanes) ? s.scaleStabilityPanes : [];
  const paneFp = panes.map(p =>
    `${p.scale || ''}|K=${p.K | 0}|N=${p.custom_n || 0}`
  ).join('::');
  const candFp = (s.candidate && s.candidate.id) ? s.candidate.id : '';
  return [
    s.cur | 0,
    paneFp,
    s.aggMethod || '',
    (s.minNGroup | 0),
    candFp,
    (s.data && s.data.chrom) || '',
  ].join('//');
}

// =====================================================================
// Display labels
// =====================================================================

const _VERDICT_TEXT = Object.freeze({
  'STABLE_3BAND':
    'STABLE 3-band — K=3 holds across all three scales with no fuses or splits. '
    + 'Classic single-inversion signature.',
  'STABLE_6BAND':
    'STABLE 6-band — K=6 holds across all three scales. '
    + 'Stable multiband architecture; needs band-tree to decide single vs compound.',
  'NESTED_3IN6':
    'NESTED 3-in-6 — K=6 fine collapses cleanly into K=3 coarse with 3 fuse events '
    + 'and 0 splits. 3-band inversion with substructure visible only at fine scale.',
  'OVERLAP_BREAKS_3':
    'OVERLAP — edges hold K=3 but the medium scale shows reshuffled bands '
    + '(fuses + splits). Possible two overlapping inversions; flank regions show '
    + 'one axis each.',
  'UNSTABLE':
    'UNSTABLE — clustering disagrees across scales (low ARI somewhere, or '
    + 'crossing/braided ribbons). Treat as artifact-suspect; do not force a '
    + 'biological call.',
});

/** Long-form explanation string for a verdict. Returns 'UNKNOWN' on unrecognized verdicts. */
export function scaleStabilityVerdictText(verdict) {
  return _VERDICT_TEXT[verdict] || 'UNKNOWN';
}

const _VERDICT_CSS = Object.freeze({
  'STABLE_3BAND':     'stable',
  'STABLE_6BAND':     'stable',
  'NESTED_3IN6':      'nested',
  'OVERLAP_BREAKS_3': 'overlap',
  'UNSTABLE':         'unstable',
});

/** CSS modifier class for a verdict. Defaults to 'unstable'. */
export function scaleStabilityVerdictCss(verdict) {
  return _VERDICT_CSS[verdict] || 'unstable';
}

// =====================================================================
// Pane header label
// =====================================================================

const _SIGMA = Object.freeze(['Σ₁', 'Σ₂', 'Σ₃']);
const _TAG   = Object.freeze(['fine', 'medium', 'coarse']);

const _SCALE_LABEL = Object.freeze({
  '1w': '1w', '5w': '5w', '10w': '10w', '25w': '25w', 'Nw': 'Nw',
  '100SNPs': '100 SNPs', '500SNPs': '500 SNPs', '1000SNPs': '1000 SNPs',
  '100kb': '100 kb', '500kb': '500 kb',
  'L2': 'L2', 'L1': 'L1', 'candidate': 'candidate',
});

/**
 * Compose the pane header label: 'Σ₁ fine · 5w · K=6' (with size /
 * SNP-count / window-count extras + asym/partial chips when present).
 *
 * @param {number} paneIdx              0/1/2
 * @param {{scale:string, K:number}} paneCfg
 * @param {{meta:Object}|null} paneResult
 * @returns {string}
 */
export function scaleStabilityPaneLabel(paneIdx, paneCfg, paneResult) {
  if (!paneCfg) return '';
  const sigma = _SIGMA[paneIdx] || 'Σ';
  const tag   = _TAG[paneIdx]   || '';
  const scaleLabel = _SCALE_LABEL[paneCfg.scale] || paneCfg.scale;
  let extra = '';
  if (paneResult && paneResult.meta) {
    const m = paneResult.meta;
    if      (m.kind === 'snps'    && m.total_snps != null) extra = ' (' + m.total_snps + ' SNPs)';
    else if (m.kind === 'kb'      && m.total_bp   != null) extra = ' (' + (m.total_bp / 1000).toFixed(1) + ' kb)';
    else if (m.kind === 'windows' && m.n          != null) extra = ' (' + m.n + 'w)';
    else if (m.kind === 'L2')                              extra = ' (' + (m.l2idx + 1) + ')';
    else if (m.kind === 'L1')                              extra = ' (' + (m.l1idx + 1) + ')';
    if (m.asymmetric) extra += ' asym';
    if (m.target_met === false) extra += ' partial';
  }
  return sigma + ' ' + tag + ' · ' + scaleLabel + extra + ' · K=' + (paneCfg.K | 0);
}
