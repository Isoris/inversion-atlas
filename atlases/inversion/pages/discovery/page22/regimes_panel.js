// pages/discovery/page1/regimes_panel.js
//
// Per-sample lines panel — LONG-RANGE HAPLOTYPE REGIMES VIEW.
//
// Sister panel to lines_panel.js, but the y-axis is no longer PC1/PC2 of
// the current chromosome. Instead, it shows how a chosen *focal voter*
// (a stable band of a seed locus) projects onto every window across the
// genome. Each sample's line at window w is the target band id it lands
// in at w (normalised to [0,1] by K_w-1). The pattern_class of the
// projection at each window is shown as a coloured strip on top.
//
// This is the visual companion to Stage 4 of the banding pipeline (the
// "all seeds → all windows" bruteforce). See:
//   shared/band_tracking/projection.js          (classifyProjection)
//   shared/band_tracking/breadth_voting.js      (runBreadthVoting)
//   shared/band_tracking/banding_pipeline.js    (runStage4)
//
// HOW THE LASSO FROM lines_panel.js MAPS HERE:
//   In lines_panel.js the user lassoes ~2 PC1 bands at one window to
//   colour the samples in those bands. Here that mechanism is replaced
//   by the FOCAL VOTER selector: pick a seed, pick a band combo within
//   that seed, and the samples in that combo are coloured across the
//   genome the same way (gold + per-original-band tints). Untracked
//   samples are grey.
//
// KEYBOARD NAVIGATION (Quentin's design):
//   ←/→  cycle focal voter through the seed catalogue (one seed at a
//        time, or one band at a time when shift is held)
//   ↑/↓  cycle the band combo within the current seed:
//          single band 0 → single band 1 → single band 2 → ...
//          → 0+1 → 0+2 → 1+2 → 0+1+2 → back to single band 0
//        (i.e. all 2^K - 1 non-empty subsets, ordered by size then
//         lexicographically)
//   home / end  jump to first / last seed
//
// The seed catalogue and per-band sample sets are passed in via a
// ctx-style object (mirrors lines_panel's `state` shape but without the
// page1-specific globals). The host page wires these from
// state.bandingPipelineResult — the cached output of
// runBandingPipeline().
// =====================================================================

import { fitCanvas, formatTrackVal, themeColor, withAlpha } from '../../../shared/page1_utils.js';
import { resolveSampleScopeColor } from '../../../shared/sample_color.js';
import { currentMbRange } from '../../../shared/page1_data_helpers.js';

// ---------------------------------------------------------------------
// Pattern-class colour palette
//
// Same taxonomy as projection.js. Colours chosen so the "informative"
// classes (SINGLE, SUBSET, SPLIT_TWO, SUBSET_SPLIT, COHERENT_SPLIT) sit
// in the warm half (bright/structured) and the "uninformative" classes
// (RANDOM_FAN, SCATTER, EMPTY) sit in the cool/grey half. RANDOM_FAN
// and COHERENT_SPLIT are deliberately distinguishable (red vs purple)
// because the whole point of the daughter-stability classifier is to
// separate them — colour-coding them similarly would defeat the visual
// purpose.
// ---------------------------------------------------------------------

export const PATTERN_CLASS_COLORS = Object.freeze({
  SINGLE:         '#22c55e',   // green   — clean, voter hits one band
  SUBSET:         '#3b82f6',   // blue    — clean subset
  SPLIT_TWO:      '#f59e0b',   // amber   — voter splits into 2 stable
  SUBSET_SPLIT:   '#a855f7',   // violet  — multi-band split, awaiting
                               //              stability check
  COHERENT_SPLIT: '#ec4899',   // pink    — split with stable daughters
                               //              (real sub-structure)
  RANDOM_FAN:     '#ef4444',   // red     — unstable scattering
  SCATTER:        '#64748b',   // slate   — diffuse, no structure
  EMPTY:          '#1f2937',   // near-bg — no overlap
});

// ---------------------------------------------------------------------
// Subset enumeration for ↑/↓ band-combo cycling
//
// Returns all non-empty subsets of [0..K-1] ordered by:
//   1. cardinality ascending (singletons first, then pairs, then triples)
//   2. lex ordering within each cardinality (so 0, 1, 2, then 0+1, 0+2,
//      1+2, then 0+1+2)
// This matches Quentin's mental model: ↑↓ first walks single bands,
// then 2-band unions, then 3-band, etc.
// ---------------------------------------------------------------------

export function enumerateBandSubsets(K) {
  const out = [];
  const total = 1 << K;
  // Group by popcount
  const byCard = [];
  for (let card = 1; card <= K; card++) byCard.push([]);
  for (let mask = 1; mask < total; mask++) {
    let c = 0;
    for (let b = 0; b < K; b++) if (mask & (1 << b)) c++;
    byCard[c - 1].push(mask);
  }
  for (const arr of byCard) {
    arr.sort((a, b) => a - b);
    for (const m of arr) out.push(m);
  }
  return out;   // array of bitmasks
}

export function maskToBands(mask, K) {
  const out = [];
  for (let b = 0; b < K; b++) if (mask & (1 << b)) out.push(b);
  return out;
}

export function maskLabel(mask, K) {
  const bands = maskToBands(mask, K);
  return bands.length === 1 ? `b${bands[0]}` : `b${bands.join('+')}`;
}

// ---------------------------------------------------------------------
// Alternative band-combo enumerators — addresses the "K=6 has 63
// subsets" problem from the chat.
//
//   'all'         — all 2^K - 1 non-empty subsets (existing
//                    enumerateBandSubsets). Use for K ≤ 4.
//   'additive'    — singletons added one at a time:
//                    {b0}, {b0,b1}, {b0,b1,b2}, ..., {b0..bK-1}.
//                    Exactly K steps. Default for the panel.
//   'informative' — 'all' filtered to subsets that produce informative
//                    pattern classes (SINGLE / SUBSET / SPLIT_TWO /
//                    COHERENT_SPLIT) on a meaningful fraction of in-
//                    scope target windows. Computed lazily by the
//                    caller (requires evaluating each subset against
//                    the current scope; that's done in
//                    enumerateInformativeBandSubsets).
// ---------------------------------------------------------------------

export function enumerateAdditiveBandSubsets(K) {
  const out = new Array(K);
  let m = 0;
  for (let b = 0; b < K; b++) {
    m |= (1 << b);
    out[b] = m;
  }
  return out;
}

/**
 * Build the informative-only subset list for the given panel state.
 * Walks every subset, evaluates it against the in-scope chromosomes,
 * and keeps subsets whose track has ≥ minFrac informative windows.
 * Falls back to singletons if nothing qualifies.
 *
 * NOTE: this temporarily mutates rp.focal.band_mask while evaluating.
 * The caller's band_mask is restored before return.
 *
 * @param {object} args
 * @param {object} args.regimesPanel
 * @param {number} args.K
 * @param {number} [args.min_informative_frac]   default 0.10
 * @returns {number[]}
 */
export function enumerateInformativeBandSubsets(args) {
  const { regimesPanel, K } = args;
  const minFrac = args.min_informative_frac != null
    ? args.min_informative_frac : 0.10;
  const all = enumerateBandSubsets(K);
  const out = [];
  const orig_mask = regimesPanel.focal.band_mask;
  const orig_track = regimesPanel.track;
  for (const m of all) {
    regimesPanel.focal.band_mask = m;
    regimesPanel.track = null;     // force rebuild
    ensureRegimesTrack({ regimesPanel });
    const tr = regimesPanel.track;
    if (!tr) continue;
    let n_inf = 0, n_total = 0;
    for (const cls of tr.pattern_classes) {
      if (cls === 'EMPTY') continue;
      n_total++;
      if (cls === 'SINGLE' || cls === 'SUBSET' ||
          cls === 'SPLIT_TWO' || cls === 'COHERENT_SPLIT') n_inf++;
    }
    if (n_total > 0 && n_inf / n_total >= minFrac) out.push(m);
  }
  // Restore the caller's state
  regimesPanel.focal.band_mask = orig_mask;
  regimesPanel.track = orig_track;
  return out.length > 0 ? out : enumerateAdditiveBandSubsets(K);
}

/**
 * Pick the right subset enumerator based on regimesPanel.bandComboMode.
 * Returns the enumerated subset list and the index of the current
 * focal.band_mask within it (or 0 if not present).
 *
 * @param {object} regimesPanel
 * @param {number} K
 * @returns {{ subsets: number[], curIdx: number, mode: string }}
 */
export function getActiveBandSubsets(regimesPanel, K) {
  const mode = regimesPanel.bandComboMode || 'additive';
  let subsets;
  if (mode === 'additive') subsets = enumerateAdditiveBandSubsets(K);
  else if (mode === 'informative') {
    subsets = enumerateInformativeBandSubsets({ regimesPanel, K });
  } else {
    subsets = enumerateBandSubsets(K);
  }
  let curIdx = subsets.indexOf(regimesPanel.focal.band_mask);
  if (curIdx < 0) curIdx = 0;
  return { subsets, curIdx, mode };
}

// ---------------------------------------------------------------------
// Build the focal voter from a seed + band-combo mask.
//
// A focal voter is the UNION of the seed's per-band sample sets at the
// chosen bands. The resulting set is what gets projected onto every
// target window.
// ---------------------------------------------------------------------

/**
 * @param {object} stage3_locus       one entry from runBandingPipeline().stage3.loci
 * @param {number} mask               bitmask over [0..stage3_locus.K)
 * @returns {{ samples: Set<number>, K: number, bands: number[],
 *             label: string, n: number }}
 */
export function buildFocalVoter(stage3_locus, mask) {
  const K = stage3_locus.K;
  const bands = maskToBands(mask, K);
  const samples = new Set();
  for (const b of bands) {
    const bandSamples = stage3_locus.per_band_samples[b];
    if (!bandSamples) continue;
    for (const si of bandSamples) samples.add(si);
  }
  return {
    samples, K, bands,
    label: maskLabel(mask, K),
    n: samples.size,
  };
}

// ---------------------------------------------------------------------
// Compute the per-window projection track for a focal voter.
//
// Walks every window in the genome, projects the focal voter onto that
// window's K_w bands, and records:
//   - the pattern_class at this window
//   - the per-sample target band id (for samples in the voter)
//   - the K_w (so y-normalisation is per-window)
//
// This is what the pipeline's Stage 4 does internally (per target),
// but inlined here for the panel: we don't need consensus_partition,
// we just need the per-window vote for ONE focal voter.
//
// Caller supplies `classifyFn` (the projection.js classifier). We use
// the static classifier by default — daughter-stability adds latency
// and the panel wants snappy redraws on ←/→ cycling. Callers can pass
// a stability-aware classifier via opts.
// ---------------------------------------------------------------------

/**
 * @param {object} args
 * @param {Set<number>} args.focal_samples
 * @param {(w:number) => Int8Array} args.getLabels
 * @param {(w:number) => number}    args.getK
 * @param {number} args.s_window     first window (inclusive)
 * @param {number} args.e_window     last window (inclusive)
 * @param {(focal_samples, target_labels, K_target, opts) => object} args.classifyFn
 * @param {object} [args.classifyOpts]
 * @returns {{
 *   pattern_classes: string[],     // length nGrid; per-window class
 *   target_band_per_sample: Int16Array,
 *      // (nGrid * n_samples) row-major; entry[gi * n_samples + si] is
 *      // the target band id at window s_window+gi for sample si, or
 *      // -1 if missing/invalid.
 *   K_per_window:    Int8Array,    // length nGrid
 *   max_K:           number,
 *   visited_per_window:  Array<number[]>,   // visited band ids per win
 *   purity_per_window:   Array<Float64Array>, // K_w-long purity vec
 * }}
 */
export function buildFocalVoterTrack(args) {
  const { focal_samples, getLabels, getK, s_window, e_window,
          classifyFn, classifyOpts } = args;
  const nGrid = e_window - s_window + 1;
  const focalSet = focal_samples instanceof Set
    ? focal_samples
    : new Set(focal_samples);
  // Discover sample count from any non-null label array
  let n_samples = 0;
  for (let w = s_window; w <= e_window; w++) {
    const L = getLabels(w);
    if (L && L.length > 0) { n_samples = L.length; break; }
  }
  if (n_samples === 0) {
    return {
      pattern_classes: new Array(nGrid).fill('EMPTY'),
      target_band_per_sample: new Int16Array(0),
      K_per_window: new Int8Array(nGrid),
      max_K: 0,
      visited_per_window: new Array(nGrid),
      purity_per_window: new Array(nGrid),
    };
  }
  const pattern_classes = new Array(nGrid);
  const K_per_window = new Int8Array(nGrid);
  const visited_per_window = new Array(nGrid);
  const purity_per_window = new Array(nGrid);
  // (gi, si) → target band id. Use -1 for missing. Int16 supports K
  // up to 32767, more than enough.
  const tbl = new Int16Array(nGrid * n_samples).fill(-1);
  let max_K = 0;
  for (let gi = 0; gi < nGrid; gi++) {
    const w = s_window + gi;
    const labels = getLabels(w);
    const K = getK(w);
    if (!labels || K < 2) {
      // K < 2 means the target window has at most one band — there's no
      // partition for the voter to project onto. Mark EMPTY explicitly,
      // and zero out per-sample target bands (they trivially all land in
      // band 0, but visualising that is misleading because the y-axis is
      // calibrated against max_K which may be ≥ 3 elsewhere).
      pattern_classes[gi] = 'EMPTY';
      K_per_window[gi] = 0;
      visited_per_window[gi] = [];
      purity_per_window[gi] = new Float64Array(0);
      const off = gi * n_samples;
      for (let si = 0; si < n_samples; si++) tbl[off + si] = -1;
      continue;
    }
    if (K > max_K) max_K = K;
    K_per_window[gi] = K;
    // Per-sample target band — for ALL samples, not just focal. Untracked
    // samples are still drawn as grey lines whose y is their target band
    // id. So we record for everyone.
    const off = gi * n_samples;
    for (let si = 0; si < n_samples; si++) {
      const lbl = labels[si];
      tbl[off + si] = (lbl != null && lbl >= 0 && lbl < K) ? lbl : -1;
    }
    // Project focal-only and classify
    const cls = classifyFn(focalSet, labels, K, classifyOpts);
    pattern_classes[gi] = cls.pattern_class;
    visited_per_window[gi] = cls.visited_bands.slice();
    purity_per_window[gi] = cls.purity_vector;
  }
  return {
    pattern_classes, target_band_per_sample: tbl,
    K_per_window, max_K, visited_per_window, purity_per_window,
  };
}

// ---------------------------------------------------------------------
// Iterate all windows across the chromosome list — flat genome-order.
//
// Caller passes the chromosomes array (each {s_window, e_window}); we
// emit a flat list of all windows in genome order, each tagged with
// its chromosome index. This is what the panel's x-axis walks.
// ---------------------------------------------------------------------

export function buildGenomeWindowList(chromosomes) {
  const out = [];
  for (let ci = 0; ci < chromosomes.length; ci++) {
    const chr = chromosomes[ci];
    for (let w = chr.s_window; w <= chr.e_window; w++) {
      out.push({ w, chr: ci });
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Dosage palette — blue / white / red / grey
//
// Quentin's colour convention: HOM_REF = blue, HET = white,
// HOM_INV = red, AMBIGUOUS_DOSAGE = grey, NO_SAMPLES = transparent.
// Mirrors the standard biological intuition: REF allele dosage
// monotonically increases REF→HET→ALT.
//
// The atlas's dosage_overlay.js classifies macro-bands into these
// classes from polarized mean dosage (0=REF, 1=HET, 2=ALT).
// ---------------------------------------------------------------------

export const DOSAGE_CLASS_COLOURS = Object.freeze({
  HOM_REF:           '#2563eb',   // blue
  HET:               '#f8fafc',   // near-white
  HOM_INV:           '#dc2626',   // red
  AMBIGUOUS_DOSAGE:  '#64748b',   // slate grey
  NO_SAMPLES:        'rgba(0,0,0,0)',
});

/**
 * Return an rgba colour string for a dosage class at the given alpha.
 * Used by the seed-loci "you are here" rectangle to tint each band
 * stripe by its macro-band dosage class.
 *
 * @param {string} cls
 * @param {number} alpha
 * @returns {string}
 */
export function _dosageClassColour(cls, alpha) {
  const hex = DOSAGE_CLASS_COLOURS[cls];
  if (!hex || hex.startsWith('rgba')) return hex || 'rgba(0,0,0,0)';
  // Convert #rrggbb to rgba(r,g,b,alpha)
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ---------------------------------------------------------------------
// drawRegimesPanel — the canvas renderer.
//
// Mirrors drawLinesPanel's structure. Single sub-panel (no PC1/PC2
// stacking — there's only one y-axis here, the per-window target band
// id). Renders:
//   1. Pattern-class strip on top (one coloured cell per window)
//   2. Frame + y-axis ticks (target band lanes, 0..max_K-1 on common scale)
//   3. Untracked samples (grey lines) — y = target band id / (K_w - 1)
//   4. Tracked samples (lasso-equivalent — the focal voter's members) —
//      y same, but coloured by their original voter-band tint
//   5. Voter-bands legend top-left
//   6. Chromosome boundary ticks on the x-axis
//
// `state` here is a small subset of the page1 state object — the
// minimum fields the panel needs to function. The host page populates
// it from runBandingPipeline()'s output before calling drawRegimesPanel.
// ---------------------------------------------------------------------

/**
 * @param {object} state                lightweight panel state
 *   state.regimesPanel: {
 *     ctx_callbacks: {
 *       getLabels, getK, currentMbRange?, mbAt?  // mbAt(w) -> Mb
 *     },
 *     chromosomes: [{ s_window, e_window, name? }, ...],
 *     stage3_loci: Array,         // from runBandingPipeline.stage3.loci
 *     focal: {
 *       seed_index: number,        // index into stage3_loci
 *       band_mask: number,         // bitmask over [0..K)
 *     },
 *     classifyFn: (focal, target_labels, K, opts) => {pattern_class, ...},
 *     classifyOpts: object,
 *     // cached track (rebuilt when focal changes); populated by
 *     // ensureRegimesTrack() below
 *     track: object | null,
 *   }
 *   state.tracked: Set<number>     (existing — sample tracking)
 * @returns void
 */
export function drawRegimesPanel(state) {
  if (!state || !state.regimesPanel) return;
  const rp = state.regimesPanel;
  const container = document.getElementById('regimesCanvasContainer');
  if (!container || typeof container.querySelector !== 'function') return;
  const sub = container.querySelector('.regimes-subpanel');
  if (!sub) return;
  const cv = sub.querySelector('canvas');
  if (!cv) return;
  const { ctx, w, h } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, h);

  // Geometry
  const padTop_strip = 18;       // pattern-class strip height
  const pad = { l: 44, r: 16, t: 6 + padTop_strip, b: 16 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  if (plotW <= 0 || plotH <= 0) return;

  // Resolve focal voter and ensure track is built
  const locus = rp.stage3_loci[rp.focal.seed_index];
  if (!locus) {
    _drawEmptyMessage(ctx, w, h, '(no seed selected)');
    return;
  }
  const voter = buildFocalVoter(locus, rp.focal.band_mask);
  if (voter.n === 0) {
    _drawEmptyMessage(ctx, w, h, `(seed ${rp.focal.seed_index} ${voter.label} is empty)`);
    return;
  }
  ensureRegimesTrack(state);
  const track = rp.track;
  if (!track) {
    _drawEmptyMessage(ctx, w, h, '(track not built)');
    return;
  }

  // Build x-axis: flat window order across all chromosomes
  const windowList = rp.windowList || buildGenomeWindowList(rp.chromosomes);
  const nGrid = windowList.length;
  if (nGrid < 2) return;

  const max_K = Math.max(track.max_K, 2);   // avoid div by 0 in y-norm
  const yLanes = max_K;          // visual lanes 0..max_K-1
  const laneStep = plotH / yLanes;
  const laneY = (band) => pad.t + plotH - (band + 0.5) * laneStep;
  const xByGi = new Float32Array(nGrid);
  for (let gi = 0; gi < nGrid; gi++) {
    xByGi[gi] = pad.l + (gi / (nGrid - 1)) * plotW;
  }

  // ---------------- (1) Pattern-class strip ----------------
  // One coloured cell per window. Width per cell = plotW / nGrid.
  const cellW = Math.max(1, plotW / nGrid);
  const stripY = pad.t - padTop_strip + 2;
  const stripH = padTop_strip - 4;
  for (let gi = 0; gi < nGrid; gi++) {
    const cls = track.pattern_classes[gi];
    const colour = PATTERN_CLASS_COLORS[cls] || '#1f2937';
    ctx.fillStyle = colour;
    ctx.fillRect(xByGi[gi] - cellW / 2, stripY, cellW + 0.5, stripH);
  }
  // Strip frame
  ctx.strokeStyle = themeColor('rule');
  ctx.lineWidth = 1;
  ctx.strokeRect(pad.l + 0.5, stripY + 0.5, plotW, stripH);

  // ---------------- (2) Plot frame + lane labels ----------------
  ctx.strokeStyle = themeColor('rule');
  ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, plotW, plotH);
  ctx.fillStyle = themeColor('ink');
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let b = 0; b < yLanes; b++) {
    const y = laneY(b);
    ctx.fillText(`band ${b}`, pad.l - 4, y);
    ctx.strokeStyle = 'rgba(120,128,144,0.18)';
    ctx.beginPath();
    ctx.moveTo(pad.l, y + 0.5);
    ctx.lineTo(pad.l + plotW, y + 0.5);
    ctx.stroke();
  }

  // ---------------- (3) + (4) per-sample lines ----------------
  const trackedSet = state.tracked instanceof Set
    ? state.tracked : new Set(state.tracked || []);
  const voterSet = voter.samples;
  const n_samples = (track.target_band_per_sample.length / nGrid) | 0;

  // Helper: build per-sample y track, NaN where target_band == -1.
  // Cached on track so re-renders without focal changes are cheap.
  if (!track._yMatrix) {
    const Y = new Array(n_samples);
    for (let si = 0; si < n_samples; si++) {
      const arr = new Float32Array(nGrid);
      for (let gi = 0; gi < nGrid; gi++) {
        const tb = track.target_band_per_sample[gi * n_samples + si];
        const Kw = track.K_per_window[gi];
        if (tb < 0 || Kw <= 0) { arr[gi] = NaN; continue; }
        // Use lane y directly (target band id IS the lane index, already
        // in [0, max_K-1]).
        arr[gi] = laneY(tb);
      }
      Y[si] = arr;
    }
    track._yMatrix = Y;
  }
  const yMatrix = track._yMatrix;

  function strokePath(si) {
    const ys = yMatrix[si];
    let started = false;
    ctx.beginPath();
    for (let gi = 0; gi < nGrid; gi++) {
      const y = ys[gi];
      if (!isFinite(y)) { started = false; continue; }
      const x = xByGi[gi];
      if (!started) { ctx.moveTo(x, y); started = true; }
      else { ctx.lineTo(x, y); }
    }
    ctx.stroke();
  }

  // Untracked + non-voter — grey lines (the "invisited windows were grey"
  // semantic from the chat, applied per-sample instead of per-window).
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = 'rgba(140,150,170,0.10)';
  for (let si = 0; si < n_samples; si++) {
    if (voterSet.has(si)) continue;
    if (trackedSet.has(si)) continue;
    strokePath(si);
  }

  // Tracked but not in voter — keep their tracked colour but at low alpha,
  // so the user can see where their pinned samples go relative to the
  // voter group's regime.
  for (const si of trackedSet) {
    if (voterSet.has(si)) continue;
    let col = '#aab2c0';
    {
      const c = resolveSampleScopeColor(state, si, state.linesColorMode || 'kmeans');
      if (c) col = c;
    }
    ctx.lineWidth = 1.0;
    ctx.strokeStyle = withAlpha(col, 0.45);
    strokePath(si);
  }

  // Voter samples — colour by the seed band they came from. Each band of
  // the focal voter gets a distinct hue. Samples in the same band stroke
  // in the same colour. This is the long-range analogue of the lasso
  // colouring in lines_panel.js.
  const bandHues = ['#f5a524', '#22d3ee', '#a78bfa', '#34d399', '#f472b6',
                    '#fb7185', '#facc15', '#60a5fa'];
  // Map: si → focal_band_index (0..voter.bands.length-1)
  const siToFocalBand = new Map();
  for (let bi = 0; bi < voter.bands.length; bi++) {
    const b = voter.bands[bi];
    for (const si of locus.per_band_samples[b]) siToFocalBand.set(si, bi);
  }
  for (const si of voterSet) {
    const bi = siToFocalBand.get(si);
    const col = bandHues[(bi >= 0 ? bi : 0) % bandHues.length];
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = col;
    strokePath(si);
  }

  // ---------------- (5) Voter-bands legend ----------------
  const lx = pad.l + 6;
  const ly = pad.t + 4;
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  const legendW = 180;
  const legendH = 18 + voter.bands.length * 12;
  ctx.fillRect(lx, ly, legendW, legendH);
  ctx.fillStyle = '#e6edf6';
  ctx.fillText(
    `seed ${rp.focal.seed_index}  ${voter.label}  (n=${voter.n})`,
    lx + 6, ly + 4);
  for (let bi = 0; bi < voter.bands.length; bi++) {
    const b = voter.bands[bi];
    const yL = ly + 18 + bi * 12;
    ctx.fillStyle = bandHues[bi % bandHues.length];
    ctx.fillRect(lx + 6, yL + 2, 10, 8);
    ctx.fillStyle = '#cbd5e1';
    const sz = locus.per_band_samples[b] ? locus.per_band_samples[b].size : 0;
    ctx.fillText(`band ${b}  (n=${sz})`, lx + 22, yL + 1);
  }

  // ---------------- (5b) Active-seed-loci "you are here" rectangle ----------------
  // Find the gi range in windowList covered by the active seed's
  // [s_window..e_window]. In chrom scope this only matters if the seed
  // happens to lie on the current chromosome; in genome scope the
  // rectangle always shows.
  //
  // The rectangle is stratified into K horizontal stripes (one per
  // band of the seed locus). Each stripe is coloured:
  //   - if getMacroDosage is provided, by the band's dosage class
  //     (HOM_REF=blue, HET=white, HOM_INV=red, AMBIGUOUS=grey/gold);
  //   - otherwise uniformly gold (legacy behaviour).
  // The bands that are part of the ACTIVE focal voter (focal.band_mask)
  // render at full alpha (1.0); inactive bands render at alpha 0.95 so
  // there's slight contrast — the user can see the stripe layout but
  // their selection is still visually emphasised.
  const seedChr = locus.chromosome_idx != null
    ? locus.chromosome_idx
    : (locus.chrom != null ? locus.chrom : -1);
  let seedGiStart = -1, seedGiEnd = -1;
  for (let gi = 0; gi < windowList.length; gi++) {
    const wl = windowList[gi];
    if (wl.chr !== seedChr) continue;
    if (wl.w >= locus.s_window && wl.w <= locus.e_window) {
      if (seedGiStart < 0) seedGiStart = gi;
      seedGiEnd = gi;
    }
  }
  if (seedGiStart >= 0 && seedGiEnd >= seedGiStart) {
    const x0 = xByGi[seedGiStart] - 0.5 * cellW;
    const x1 = xByGi[seedGiEnd] + 0.5 * cellW;
    const seedK = locus.K;
    const stripeH = plotH / Math.max(1, seedK);
    const getMacroDosage = (rp.ctx_callbacks && rp.ctx_callbacks.getMacroDosage) || null;
    const activeBandsSet = new Set(voter.bands);
    ctx.save();
    for (let b = 0; b < seedK; b++) {
      const yTop = pad.t + b * stripeH;
      const isActive = activeBandsSet.has(b);
      const baseAlpha = isActive ? 0.18 : 0.10;   // softer for inactive
      let fillCol = `rgba(245, 165, 36, ${baseAlpha})`;   // legacy gold
      if (getMacroDosage) {
        try {
          const bandSamples = locus.per_band_samples[b];
          const dos = getMacroDosage(locus, bandSamples);
          if (dos && dos.dosage_class) {
            fillCol = _dosageClassColour(dos.dosage_class, baseAlpha);
          }
        } catch (_) { /* keep legacy gold */ }
      }
      ctx.fillStyle = fillCol;
      // Active bands paint at alpha 1.0 (full brightness); inactive at
      // 0.95. We achieve this with globalAlpha rather than baking into
      // the rgba above, so the dosage hue stays correct while the
      // contrast cue lives in the alpha channel.
      ctx.globalAlpha = isActive ? 1.0 : 0.95;
      ctx.fillRect(x0, yTop, x1 - x0, stripeH);
    }
    ctx.globalAlpha = 1.0;
    // Dashed border on the whole box
    ctx.strokeStyle = 'rgba(245, 165, 36, 0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x0 + 0.5, pad.t + 0.5, x1 - x0 - 1, plotH - 1);
    ctx.setLineDash([]);
    // Per-band thin lane separators inside the rectangle
    ctx.strokeStyle = 'rgba(245, 165, 36, 0.30)';
    ctx.lineWidth = 0.5;
    for (let b = 1; b < seedK; b++) {
      const ySep = pad.t + b * stripeH + 0.5;
      ctx.beginPath();
      ctx.moveTo(x0, ySep);
      ctx.lineTo(x1, ySep);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------- (6) Chromosome boundary ticks ----------------
  ctx.strokeStyle = 'rgba(220,230,245,0.35)';
  ctx.lineWidth = 1;
  ctx.fillStyle = themeColor('dim');
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  let prevChr = -1;
  for (let gi = 0; gi < nGrid; gi++) {
    const ci = windowList[gi].chr;
    if (ci !== prevChr) {
      const x = xByGi[gi];
      ctx.beginPath();
      ctx.moveTo(x + 0.5, pad.t);
      ctx.lineTo(x + 0.5, pad.t + plotH);
      ctx.stroke();
      const name = (rp.chromosomes[ci] && rp.chromosomes[ci].name)
        ? rp.chromosomes[ci].name
        : `chr ${ci}`;
      ctx.fillText(name, x + 4, pad.t + plotH + 2);
      prevChr = ci;
    }
  }

  // Stash geometry for click-to-jump (host page wires the click handler)
  state.__regimesGeom = {
    pad, plotW, plotH, w, h, nGrid,
    windowList,
  };
}

function _drawEmptyMessage(ctx, w, h, msg) {
  ctx.fillStyle = themeColor('dim');
  ctx.font = '12px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(msg, w / 2, h / 2);
}

// ---------------------------------------------------------------------
// ensureRegimesTrack — (re)build the per-window projection track when
// the focal voter has changed OR the scope has changed.
//
// Honors:
//   - state.regimesPanel.scope ('chrom' or 'genome')
//   - state.regimesPanel.current_chromosome_idx (when scope == 'chrom')
//   - state.regimesPanel.stride (perf knob, default 1)
//
// Cache key includes scope so chrom and genome tracks don't clobber
// each other.
// ---------------------------------------------------------------------

export function ensureRegimesTrack(state) {
  const rp = state.regimesPanel;
  if (!rp || !rp.stage3_loci) return;
  const stride = Math.max(1, rp.stride | 0 || 1);
  const scope = rp.scope || 'chrom';
  const ci = rp.current_chromosome_idx;
  const cacheKey = [
    'v1', scope,
    scope === 'chrom' ? `c${ci}` : 'g',
    `s=${rp.focal.seed_index}`,
    `m=${rp.focal.band_mask}`,
    `st=${stride}`,
  ].join('|');
  if (rp.track && rp.track._key === cacheKey) return;
  const locus = rp.stage3_loci[rp.focal.seed_index];
  if (!locus) { rp.track = null; return; }
  const voter = buildFocalVoter(locus, rp.focal.band_mask);
  if (voter.n === 0) { rp.track = null; return; }

  // Resolve which chromosomes are in scope.
  const chroms = scope === 'genome'
    ? rp.chromosomes.map((chr, i) => Object.assign({}, chr, { idx: i }))
    : (ci != null && ci >= 0 && ci < rp.chromosomes.length
        ? [Object.assign({}, rp.chromosomes[ci], { idx: ci })]
        : []);
  if (chroms.length === 0) { rp.track = null; return; }

  const cb = rp.ctx_callbacks;
  const chromTracks = [];
  for (const chr of chroms) {
    if (stride === 1) {
      chromTracks.push(buildFocalVoterTrack({
        focal_samples: voter.samples,
        getLabels:     cb.getLabels,
        getK:          cb.getK,
        s_window:      chr.s_window,
        e_window:      chr.e_window,
        classifyFn:    rp.classifyFn,
        classifyOpts:  rp.classifyOpts,
      }));
    } else {
      chromTracks.push(_buildStridedTrack({
        focal_samples: voter.samples,
        getLabels:     cb.getLabels,
        getK:          cb.getK,
        s_window:      chr.s_window,
        e_window:      chr.e_window,
        classifyFn:    rp.classifyFn || null,
        classifyOpts:  rp.classifyOpts || {},
        stride,
      }));
    }
  }
  // Concatenate
  let total_n = 0, total_max_K = 0;
  for (const t of chromTracks) total_n += t.pattern_classes.length;
  for (const t of chromTracks) if (t.max_K > total_max_K) total_max_K = t.max_K;
  let n_samples = 0;
  for (const t of chromTracks) {
    if (t.target_band_per_sample.length > 0 && t.pattern_classes.length > 0) {
      n_samples = t.target_band_per_sample.length / t.pattern_classes.length;
      break;
    }
  }
  const pattern_classes = new Array(total_n);
  const K_per_window = new Int8Array(total_n);
  const tbl = new Int16Array(total_n * n_samples);
  const visited_per_window = new Array(total_n);
  const purity_per_window = new Array(total_n);
  let ofs = 0;
  for (const t of chromTracks) {
    const ngi = t.pattern_classes.length;
    for (let gi = 0; gi < ngi; gi++) {
      pattern_classes[ofs + gi] = t.pattern_classes[gi];
      K_per_window[ofs + gi]    = t.K_per_window[gi];
      visited_per_window[ofs + gi] = t.visited_per_window[gi];
      purity_per_window[ofs + gi]  = t.purity_per_window[gi];
    }
    if (t.target_band_per_sample.length > 0) {
      tbl.set(t.target_band_per_sample, ofs * n_samples);
    }
    ofs += ngi;
  }
  rp.track = {
    _key: cacheKey,
    pattern_classes,
    target_band_per_sample: tbl,
    K_per_window,
    max_K: total_max_K,
    visited_per_window, purity_per_window,
    n_samples,
    stride,
    scope,
    _yMatrix: null,
  };
  // Build the windowList for this scope
  rp.windowList = [];
  for (const chr of chroms) {
    for (let w = chr.s_window; w <= chr.e_window; w++) {
      rp.windowList.push({ w, chr: chr.idx });
    }
  }
}

// ---------------------------------------------------------------------
// _buildStridedTrack — sparse classifier walk for the genome-mode
// performance gate. Identical to buildFocalVoterTrack but only
// classifies every `stride`-th window. Skipped windows get pattern
// 'EMPTY' and target band -1, so renderers naturally draw gaps.
// ---------------------------------------------------------------------

function _buildStridedTrack(args) {
  const { focal_samples, getLabels, getK, s_window, e_window,
          classifyFn, classifyOpts, stride } = args;
  const nGrid = e_window - s_window + 1;
  const focalSet = focal_samples instanceof Set
    ? focal_samples : new Set(focal_samples);
  let n_samples = 0;
  for (let w = s_window; w <= e_window; w += stride) {
    const L = getLabels(w);
    if (L && L.length > 0) { n_samples = L.length; break; }
  }
  const pattern_classes = new Array(nGrid);
  const K_per_window = new Int8Array(nGrid);
  const visited_per_window = new Array(nGrid);
  const purity_per_window = new Array(nGrid);
  for (let i = 0; i < nGrid; i++) {
    pattern_classes[i] = 'EMPTY';
    visited_per_window[i] = [];
    purity_per_window[i] = new Float64Array(0);
  }
  if (n_samples === 0 || !classifyFn) {
    return {
      pattern_classes, target_band_per_sample: new Int16Array(0),
      K_per_window, max_K: 0, visited_per_window, purity_per_window,
    };
  }
  const tbl = new Int16Array(nGrid * n_samples).fill(-1);
  let max_K = 0;
  for (let w = s_window; w <= e_window; w += stride) {
    const gi = w - s_window;
    const labels = getLabels(w);
    const K = getK(w);
    if (!labels || K < 2) continue;
    if (K > max_K) max_K = K;
    K_per_window[gi] = K;
    const off = gi * n_samples;
    for (let si = 0; si < n_samples; si++) {
      const lbl = labels[si];
      tbl[off + si] = (lbl != null && lbl >= 0 && lbl < K) ? lbl : -1;
    }
    const cls = classifyFn(focalSet, labels, K, classifyOpts);
    pattern_classes[gi] = cls.pattern_class;
    visited_per_window[gi] = cls.visited_bands.slice();
    purity_per_window[gi] = cls.purity_vector;
  }
  return {
    pattern_classes, target_band_per_sample: tbl,
    K_per_window, max_K, visited_per_window, purity_per_window,
  };
}

// ---------------------------------------------------------------------
// Keyboard navigation — install once per panel.
//
//   ←/→  cycle seed_index (with shift+←/→: cycle band singleton inside
//        seed instead — handy for "stay at the same locus, change voter
//        band")
//   ↑/↓  cycle band_mask through the subset enumeration
//   home/end  first / last seed
// ---------------------------------------------------------------------

export function installRegimesKeyboardNav(state) {
  const handler = (e) => {
    if (!state.regimesPanel || !state.regimesPanel.stage3_loci) return;
    const rp = state.regimesPanel;
    const loci = rp.stage3_loci;
    if (loci.length === 0) return;
    let { seed_index, band_mask } = rp.focal;
    let curLocus = loci[seed_index];
    let curK = curLocus ? curLocus.K : 1;
    const active = getActiveBandSubsets(rp, curK);
    let subsets = active.subsets;
    let curIdx = active.curIdx;

    let handled = false;
    if (e.key === 'ArrowRight') {
      if (e.shiftKey) {
        // Shift+→: stay at this locus, advance to next single-band mask
        // (if we're already on a single band, jump to the next one;
        // if we're on a multi-band, snap to the lowest single).
        const singles = subsets.slice(0, curK);
        const curSingle = singles.indexOf(band_mask);
        const nextSingle = singles[(curSingle < 0 ? 0 : curSingle + 1) % singles.length];
        rp.focal.band_mask = nextSingle;
      } else {
        seed_index = (seed_index + 1) % loci.length;
        rp.focal.seed_index = seed_index;
        // Reset band_mask to first subset of the new seed's enumeration
        const newK = loci[seed_index].K;
        const newSubs = getActiveBandSubsets(rp, newK).subsets;
        rp.focal.band_mask = newSubs[0] || 1;
      }
      handled = true;
    } else if (e.key === 'ArrowLeft') {
      if (e.shiftKey) {
        const singles = subsets.slice(0, curK);
        const curSingle = singles.indexOf(band_mask);
        const prevSingle = singles[(curSingle < 0 ? singles.length - 1
                                    : (curSingle - 1 + singles.length) % singles.length)];
        rp.focal.band_mask = prevSingle;
      } else {
        seed_index = (seed_index - 1 + loci.length) % loci.length;
        rp.focal.seed_index = seed_index;
        const newK = loci[seed_index].K;
        const newSubs = getActiveBandSubsets(rp, newK).subsets;
        rp.focal.band_mask = newSubs[0] || 1;
      }
      handled = true;
    } else if (e.key === 'ArrowDown') {
      // Next subset in enumeration order
      curIdx = (curIdx + 1) % subsets.length;
      rp.focal.band_mask = subsets[curIdx];
      handled = true;
    } else if (e.key === 'ArrowUp') {
      curIdx = (curIdx - 1 + subsets.length) % subsets.length;
      rp.focal.band_mask = subsets[curIdx];
      handled = true;
    } else if (e.key === 'Home') {
      rp.focal.seed_index = 0;
      rp.focal.band_mask = 1;
      handled = true;
    } else if (e.key === 'End') {
      rp.focal.seed_index = loci.length - 1;
      rp.focal.band_mask = 1;
      handled = true;
    }
    if (handled) {
      e.preventDefault();
      drawRegimesPanel(state);
      // Also refresh any header-display caller has registered
      if (typeof rp.onFocalChange === 'function') {
        rp.onFocalChange(rp.focal);
      }
    }
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}

// ---------------------------------------------------------------------
// buildRegimesPanel — DOM scaffolding (one canvas + a header showing
// seed/voter info + arrow-key hint). Mirrors buildLinesPanel's pattern
// but simpler — there's only one sub-canvas (one y-axis).
// ---------------------------------------------------------------------

export function buildRegimesPanel(state) {
  const container = document.getElementById('regimesCanvasContainer');
  const panel = document.getElementById('regimesPanel');
  if (!container || !panel) return;
  if (typeof container.appendChild !== 'function') return;
  if ('innerHTML' in container) container.innerHTML = '';
  if (!state.regimesPanel || !state.regimesPanel.stage3_loci ||
      state.regimesPanel.stage3_loci.length === 0) {
    if (panel.style) panel.style.display = 'none';
    return;
  }
  if (panel.style) panel.style.display = '';
  if (container.style) {
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
  }
  const sub = document.createElement('div');
  sub.className = 'regimes-subpanel';
  sub.style.cssText = 'position: relative; flex: 1 1 0; min-height: 0; ' +
                      'border-bottom: 1px solid var(--rule, #2a3242);';
  const cv = document.createElement('canvas');
  cv.style.cssText = 'display: block; width: 100%; height: 100%; cursor: crosshair;';
  cv.tabIndex = 0;     // make it focusable so arrow keys work when the
                       // panel has focus (host page can also rely on
                       // document-level keys via installRegimesKeyboardNav)
  sub.appendChild(cv);

  // Header overlay — shows current focal voter + arrow-key hint
  const hdr = document.createElement('div');
  hdr.className = 'regimes-subpanel-header';
  hdr.style.cssText = 'position: absolute; top: 4px; right: 8px; ' +
    'font-size: 10px; color: var(--dim, #888); pointer-events: none; ' +
    'font-family: ui-monospace, monospace;';
  hdr.textContent = '←/→ seed   ↑/↓ band combo   shift+←/→ band only';
  sub.appendChild(hdr);

  // Click on canvas → forward the gi to a host-supplied callback
  cv.addEventListener('click', (e) => {
    if (typeof state.regimesPanel.onWindowClick !== 'function') return;
    const geom = state.__regimesGeom;
    if (!geom) return;
    const rect = cv.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const frac = (x - geom.pad.l) / geom.plotW;
    if (frac < 0 || frac > 1) return;
    const gi = Math.round(frac * (geom.nGrid - 1));
    const entry = geom.windowList[gi];
    if (entry) state.regimesPanel.onWindowClick(entry);
  });

  container.appendChild(sub);
}

// ---------------------------------------------------------------------
// initRegimesPanelFromBandingResult — convenience initialiser.
//
// Given runBandingPipeline()'s result + the host page's getLabels/getK
// callbacks, sets up state.regimesPanel and runs build + draw.
// ---------------------------------------------------------------------

/**
 * @param {object} state
 * @param {object} args
 * @param {object} args.bandingResult            output of runBandingPipeline
 * @param {(w:number) => Int8Array} args.getLabels
 * @param {(w:number) => number}    args.getK
 * @param {(w:number) => Float32Array} [args.getPC1]
 *   Optional. Per-window per-sample PC1 values. Only required for the
 *   PC1-lines panel; the target-band-lanes panel doesn't need it.
 * @param {(locus, sample_set) => {dosage_class:string, dosage_mean:number,
 *                                   n_with_data:number}} [args.getMacroDosage]
 *   Optional. Returns the macro-band dosage class for a given seed
 *   locus + sample set. Used by the seed-loci "you are here" rectangle
 *   to tint each band's stripe (HOM_REF=blue, HET=white, HOM_INV=red,
 *   AMBIGUOUS=grey). The host page wires this from
 *   shared/band_tracking/dosage_overlay.js + the dosage_bridge endpoint.
 * @param {Function} args.classifyFn             projection classifier
 * @param {object}   [args.classifyOpts]
 * @param {Array}    [args.chromosomes]          override; else ctx-derived
 * @param {string}   [args.scope]                'chrom' (default) or 'genome'
 * @param {number}   [args.current_chromosome_idx]   default 0
 * @param {string}   [args.bandComboMode]        'additive' (default), 'all', 'informative'
 * @param {number}   [args.stride]               default 1; >1 subsamples in genome mode
 */
export function initRegimesPanelFromBandingResult(state, args) {
  const {
    bandingResult, getLabels, getK, getPC1, getMacroDosage,
    classifyFn, classifyOpts, chromosomes,
    scope, current_chromosome_idx, bandComboMode, stride,
  } = args;
  if (!bandingResult || !bandingResult.stage3 || !bandingResult.stage3.loci) {
    state.regimesPanel = null;
    return;
  }
  const loci = bandingResult.stage3.loci.slice();
  if (loci.length === 0) {
    state.regimesPanel = null;
    return;
  }
  const chroms = chromosomes || (bandingResult.stage1 && bandingResult.stage1.chromosomes)
    || _chromosomesFromLoci(loci);
  state.regimesPanel = {
    ctx_callbacks: {
      getLabels, getK,
      getPC1: getPC1 || null,
      getMacroDosage: getMacroDosage || null,
    },
    chromosomes: chroms,
    stage3_loci: loci,
    focal: { seed_index: 0, band_mask: 1 },
    classifyFn,
    classifyOpts: classifyOpts || {},
    scope: scope || 'chrom',
    current_chromosome_idx: current_chromosome_idx != null
      ? current_chromosome_idx : (loci[0] ? loci[0].chromosome_idx : 0),
    bandComboMode: bandComboMode || 'additive',
    stride: stride || 1,
    track: null,
    windowList: null,
    onFocalChange: null,
    onWindowClick: null,
  };
  buildRegimesPanel(state);
  drawRegimesPanel(state);
}

function _chromosomesFromLoci(loci) {
  const map = new Map();
  for (const L of loci) {
    const ci = L.chromosome_idx;
    if (!map.has(ci)) map.set(ci, { s_window: Infinity, e_window: -Infinity });
    const e = map.get(ci);
    if (L.s_window < e.s_window) e.s_window = L.s_window;
    if (L.e_window > e.e_window) e.e_window = L.e_window;
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([ci, sp]) => ({ s_window: sp.s_window, e_window: sp.e_window, name: `chr ${ci}` }));
}

// Console-debug
if (typeof window !== 'undefined') {
  window._enumerateBandSubsets       = enumerateBandSubsets;
  window._buildFocalVoter            = buildFocalVoter;
  window._buildFocalVoterTrack       = buildFocalVoterTrack;
  window._buildGenomeWindowList      = buildGenomeWindowList;
  window._drawRegimesPanel           = drawRegimesPanel;
  window._buildRegimesPanel          = buildRegimesPanel;
  window._ensureRegimesTrack         = ensureRegimesTrack;
  window._installRegimesKeyboardNav  = installRegimesKeyboardNav;
  window._initRegimesPanelFromBandingResult = initRegimesPanelFromBandingResult;
  window._PATTERN_CLASS_COLORS       = PATTERN_CLASS_COLORS;
}
