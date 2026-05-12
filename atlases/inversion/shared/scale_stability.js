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

/**
 * Default 3-pane configuration: fine 5w / medium L2 / coarse candidate.
 * Frozen. Callers `slice()` it (Object.freeze on the outer array means
 * push() throws; the inner objects are intentionally NOT frozen so the
 * user's K-knob picker can mutate them in place).
 */
export const SCALE_STABILITY_PANE_DEFAULTS = Object.freeze([
  Object.freeze({ scale: '5w',        K: 6, custom_n: null }),
  Object.freeze({ scale: 'L2',        K: 6, custom_n: null }),
  Object.freeze({ scale: 'candidate', K: 3, custom_n: null }),
]);

// =====================================================================
// State lifecycle
// =====================================================================

/**
 * Ensure state has the scale-stability slots. Lazily fills in unset
 * fields only — never clobbers anything the user previously set.
 * Idempotent.
 *
 * Slots:
 *   state.l3Mode                ('contingency' | other; default 'contingency')
 *   state.scaleStabilityPanes   default 3-pane config
 *   state.scaleStabilityCache   null (reset on every recompute)
 *
 * @param {Object} state
 */
export function ensureScaleStabilityState(state) {
  if (!state) return;
  if (state.l3Mode == null) state.l3Mode = 'contingency';
  if (!Array.isArray(state.scaleStabilityPanes)) {
    // Deep-copy the defaults so user mutations don't escape into the
    // frozen constant.
    state.scaleStabilityPanes = SCALE_STABILITY_PANE_DEFAULTS.map(p => ({ ...p }));
  }
  if (!state.scaleStabilityCache) state.scaleStabilityCache = null;
}

// =====================================================================
// Range converters
// =====================================================================
// All return [s, e] inclusive window indices, or null when no resolution
// is possible (missing data / no active candidate / focal outside an
// envelope, etc.).

/**
 * Symmetric SNP-band: smallest contiguous range centered on focalW
 * whose total n_snps ≥ targetSnps. Expands one window at a time on
 * whichever side has fewer SNPs absorbed so far (to keep coverage
 * roughly symmetric).
 *
 * Edge cases:
 *   - focalW out of bounds                        → null
 *   - sum of all windows' n_snps < targetSnps     → returns max range
 *                                                    with target_met=false
 *   - hits chromosome boundary mid-expansion      → returns asymmetric
 *                                                    range (asymmetric=true,
 *                                                    edgeForced)
 *
 * @param {Object} state
 * @param {number} focalW
 * @param {number} targetSnps
 * @returns {Object|null}
 */
export function snpBandRange(state, focalW, targetSnps) {
  if (!state || !state.data || !Array.isArray(state.data.windows)) return null;
  const windows = state.data.windows;
  const n = windows.length;
  if (focalW < 0 || focalW >= n || targetSnps == null || targetSnps <= 0) return null;
  const wSnps = (i) => {
    const w = windows[i];
    return (w && w.n_snps != null && Number.isFinite(w.n_snps)) ? +w.n_snps : 0;
  };
  let s = focalW, e = focalW, total = wSnps(focalW);
  let leftAbsorbed = 0, rightAbsorbed = 0;
  let edgeForced = false;
  while (total < targetSnps) {
    const canL = s > 0;
    const canR = e < n - 1;
    if (!canL && !canR) break;
    let pickLeft;
    if (canL && !canR)      { pickLeft = true;  edgeForced = true; }
    else if (canR && !canL) { pickLeft = false; edgeForced = true; }
    else                    { pickLeft = (leftAbsorbed <= rightAbsorbed); }
    if (pickLeft) {
      s--;
      const v = wSnps(s); total += v; leftAbsorbed += v;
    } else {
      e++;
      const v = wSnps(e); total += v; rightAbsorbed += v;
    }
  }
  return {
    s, e,
    total_snps: total,
    target: targetSnps,
    asymmetric: edgeForced,
    target_met: total >= targetSnps,
    left_absorbed: leftAbsorbed,
    right_absorbed: rightAbsorbed,
  };
}

/**
 * Symmetric kb-band: same algorithm as snpBandRange but on
 * sum(span_bp). When span_bp is absent, falls back to
 * max(0, end_bp - start_bp). targetKb is the target span in
 * kilobases; the result's target_bp echoes targetKb * 1000.
 *
 * @param {Object} state
 * @param {number} focalW
 * @param {number} targetKb
 * @returns {Object|null}
 */
export function kbBandRange(state, focalW, targetKb) {
  if (!state || !state.data || !Array.isArray(state.data.windows)) return null;
  const windows = state.data.windows;
  const n = windows.length;
  if (focalW < 0 || focalW >= n || targetKb == null || targetKb <= 0) return null;
  const wSpan = (i) => {
    const w = windows[i];
    if (!w) return 0;
    if (w.span_bp != null && Number.isFinite(w.span_bp)) return +w.span_bp;
    if (w.start_bp != null && w.end_bp != null) return Math.max(0, +w.end_bp - +w.start_bp);
    return 0;
  };
  const targetBp = targetKb * 1000;
  let s = focalW, e = focalW, total = wSpan(focalW);
  let leftAbsorbed = 0, rightAbsorbed = 0;
  let edgeForced = false;
  while (total < targetBp) {
    const canL = s > 0;
    const canR = e < n - 1;
    if (!canL && !canR) break;
    let pickLeft;
    if (canL && !canR)      { pickLeft = true;  edgeForced = true; }
    else if (canR && !canL) { pickLeft = false; edgeForced = true; }
    else                    { pickLeft = (leftAbsorbed <= rightAbsorbed); }
    if (pickLeft) {
      s--;
      const v = wSpan(s); total += v; leftAbsorbed += v;
    } else {
      e++;
      const v = wSpan(e); total += v; rightAbsorbed += v;
    }
  }
  return {
    s, e,
    total_bp: total,
    target_bp: targetBp,
    asymmetric: edgeForced,
    target_met: total >= targetBp,
    left_absorbed: leftAbsorbed,
    right_absorbed: rightAbsorbed,
  };
}

/**
 * Resolve a pane's scale string to a [s, e] window range.
 *
 * Supported scales:
 *   - '1w' / '5w' / '10w' / '25w'    → centered window-count band
 *   - 'Nw'                            → centered band, custom_n or
 *                                       state.compareUnitN (≥ 1)
 *   - '100SNPs' / '500SNPs' / '1000SNPs'  → symmetric SNP-band
 *   - '100kb' / '500kb'                    → symmetric kb-band
 *   - 'L2' / 'L1' → envelope containing focalW
 *                  (via state.windowToL2 / state.windowToL1)
 *   - 'candidate' → state.candidate's window span
 *
 * Even-N windows: focal sits at floor((N-1)/2) from the left so the
 * range biases right when forced to choose. Edge focal positions
 * clip to the chromosome panel.
 *
 * Returns null when:
 *   - state.data.windows is missing
 *   - paneCfg has no scale
 *   - 'L2' / 'L1' requested but focalW isn't inside one
 *   - 'candidate' requested but state.candidate is missing
 *   - any unknown scale string
 *
 * The returned object always carries a `kind` tag matching
 * scale_stability_pane_label's expected shape.
 *
 * @param {Object} state
 * @param {number} focalW
 * @param {{scale:string, K:number, custom_n:?number}} paneCfg
 * @returns {Object|null}
 */
export function resolvePaneRange(state, focalW, paneCfg) {
  if (!state || !state.data || !Array.isArray(state.data.windows)) return null;
  if (!paneCfg || !paneCfg.scale) return null;
  const windows = state.data.windows;
  const n = windows.length;
  const scale = paneCfg.scale;
  const clamp = (v) => Math.max(0, Math.min(n - 1, v | 0));

  function nWindowsRange(N) {
    if (N <= 0) return null;
    if (N === 1) return { s: focalW, e: focalW, kind: 'windows', n: 1 };
    const halfL = Math.floor((N - 1) / 2);
    const halfR = N - 1 - halfL;
    return { s: clamp(focalW - halfL), e: clamp(focalW + halfR), kind: 'windows', n: N };
  }

  if (scale === '1w')  return nWindowsRange(1);
  if (scale === '5w')  return nWindowsRange(5);
  if (scale === '10w') return nWindowsRange(10);
  if (scale === '25w') return nWindowsRange(25);
  if (scale === 'Nw') {
    const N = (paneCfg.custom_n != null && paneCfg.custom_n > 0)
      ? paneCfg.custom_n : ((state.compareUnitN | 0) || 0);
    return nWindowsRange(Math.max(1, N));
  }

  if (scale === '100SNPs'  || scale === '100 SNPs')  { const r = snpBandRange(state, focalW, 100);  return r ? Object.assign({ kind: 'snps' }, r) : null; }
  if (scale === '500SNPs'  || scale === '500 SNPs')  { const r = snpBandRange(state, focalW, 500);  return r ? Object.assign({ kind: 'snps' }, r) : null; }
  if (scale === '1000SNPs' || scale === '1000 SNPs') { const r = snpBandRange(state, focalW, 1000); return r ? Object.assign({ kind: 'snps' }, r) : null; }

  if (scale === '100kb' || scale === '100 kb') { const r = kbBandRange(state, focalW, 100); return r ? Object.assign({ kind: 'kb' }, r) : null; }
  if (scale === '500kb' || scale === '500 kb') { const r = kbBandRange(state, focalW, 500); return r ? Object.assign({ kind: 'kb' }, r) : null; }

  if (scale === 'L2') {
    const l2Idx = state.windowToL2 ? state.windowToL2[focalW] : -1;
    if (l2Idx == null || l2Idx < 0) return null;
    const env = (state.data.l2_envelopes || [])[l2Idx];
    if (!env) return null;
    return { s: env._s0, e: env._e0, kind: 'L2', l2idx: l2Idx };
  }
  if (scale === 'L1') {
    const l1Idx = state.windowToL1 ? state.windowToL1[focalW] : -1;
    if (l1Idx == null || l1Idx < 0) return null;
    const env = (state.data.l1_envelopes || [])[l1Idx];
    if (!env) return null;
    return { s: env._s0, e: env._e0, kind: 'L1', l1idx: l1Idx };
  }
  if (scale === 'candidate') {
    const c = state.candidate;
    if (!c || c.start_w == null || c.end_w == null) return null;
    return { s: c.start_w, e: c.end_w, kind: 'candidate', cand_id: c.id };
  }
  return null;
}

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
