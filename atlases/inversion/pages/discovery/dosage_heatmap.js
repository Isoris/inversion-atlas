// pages/discovery/dosage_heatmap.js
// =====================================================================
// Sample × marker dosage heatmap — atlas-side cartridge for SPEC_0 §11
// (centering / polarity) and the partner of the PCA panel.
//
// Phase 1 scope (this commit):
//   - Sequential cream → deep red ramp (matches similarity panel
//     "Reds" + the user's reference image)
//   - Left side K=3 group annotation track (+ optional K=6)
//   - Top polarity stripe (one cell per displayed marker; black =
//     flipped)
//   - Sample ordering options: natural | by_group | by_k6
//   - Marker ordering options: natural | by_polarity
//   - Hover crosshair + right-panel cell summary
//   - Click a cell to toggle either the sample or the marker in
//     the selection set
//
// Two input shapes feed the same canonical painter via
// `./adapters.js` so the legacy candidate dosage-heatmap and the
// new mgl_heatmap_json result render identically:
//
//   atlasState.inversion.dosage_heatmap_state = {
//     mgl_heatmap_result?:   shared/mgl_heatmap_json output,
//     legacy_chunk?:         { samples, markers, dosage },
//     selected_marker_indices?: number[]   (legacy adapter)
//     sample_group?:         Array<*>      per canonical sample idx
//     sample_k6?:            Int32Array
//     marker_polarity?:      Array<boolean>|Function
//     candidate_label?:      string,
//     view_label?:           string  e.g. 'unweighted · cohort_mean',
//   }
//
// Deferred:
//   - Marker bp-axis (needs sidecar metadata wired through)
//   - Per-sample dosage hover sparkline
//   - Cross-panel candidate-mode linkage with PCA (separate commit)
// =====================================================================

import { _pageState, _setActiveState } from './dosage_heatmap/_state.js';
import {
  paintDosageHeatmap,
  findCellAtPixel,
  findRegimeSpanAtPixel,
  deriveSampleOrder,
  deriveMarkerOrder,
  buildGroupColorMap,
} from './dosage_heatmap/renderer.js';
import {
  adaptMglHeatmapJson,
  adaptLegacyChunk,
} from './dosage_heatmap/adapters.js';
import {
  createDosageHeatmapSelection,
  summariseHoverCell,
  groupSizesFromSampleGroup,
} from './dosage_heatmap/selection.js';
import { fitCanvasNoDpr } from '../../shared/page1_utils.js';
import {
  computeSampleHetDosageMean,
  computeSampleThetaPiMean,
  computeSampleGhslMean,
} from './dosage_heatmap/sample_means.js';
import { detectGroups } from './dosage_heatmap/dosage_detect.js';
import { clusterIndexAware } from './dosage_heatmap/index_aware_cluster.js';
import { collapseSimilar } from './dosage_heatmap/collapse_similar.js';
import { computeKaryogroupStats } from './dosage_heatmap/karyogroup_stats.js';
import { selectMarkers, markerViewport } from './dosage_heatmap/marker_select.js';
import { buildRegistryOverlay } from './dosage_heatmap/regime_registry_overlay.js';

const DEFAULT_VIEW_STATE = Object.freeze({
  sample_order_mode:     'by_group',
  marker_order_mode:     'natural',
  color_mode:            'magma',    // 'magma' | 'genotype'
  show_group_track:      true,
  show_k6_track:         false,
  show_ghsl_track:       false,      // per-sample mean GHSL (continuous)
  show_theta_pi_track:   false,      // per-sample mean θπ (continuous)
  show_het_dosage_track: false,      // per-sample mean het dosage (continuous)
  show_polarity_track:   true,
  show_y_ticks:          true,
  show_group_labels:     true,
  // 2026-05-27: regime overlays (active candidate scope).
  show_regime_call_track:  false,
  show_locus_span_overlay: false,
  // Bounding rectangle per group (marker extent × that group's contiguous
  // row block). Tight karyotype/cluster boxes when rows are grouped.
  show_group_rects:        false,
  // Collapse near-identical samples (Hamming distance over tier-quantized
  // genomic bins) into a few representative rows + a right-side ×N size
  // histogram. Reduces crowding for large cohorts.
  collapse_similar:        false,
  collapse_hamming:        0,        // max differing bins to still collapse
  collapse_reps:           4,        // representative rows kept per group
  // Per-window karyogroup boundary statistics: window count knob (drives
  // Cramér's V / FST-proxy resolution + the 'fan' colour mode).
  kg_windows:              20,
  // 2026-05-29: in-page haplotype-regime grouping. The heatmap can group
  // samples from the loaded dosage chunk itself (no upstream pipeline
  // needed) and score how confident each group is, OR consume the active
  // candidate's upstream regime calls.
  //   grouping_source:  'external'        — the upstream sample_group as supplied
  //                     'bands'           — in-page 1-D dosage banding (homA/het/homB)
  //                     'clusters'        — in-page 2-D (mean,het) clustering
  //                     'upstream_regime' — active candidate's regime calls
  grouping_source:       'external',
  detect_k:              'auto',     // 'auto' | 2 | 3 | 4
  show_confidence_track: false,
  confidence_scheme:     'margin',   // 'margin' | 'silhouette'
  // 2026-05-29: marker-axis SNP views + subsampling + cursor/zoom.
  //   marker_view:        'all' | 'random' | 'high_var' | 'low_var'
  //   marker_subsample_n: 0 = all markers for the view; else cap to N
  //   zoom:               1 = whole working set; 2/4/8 = cursor-centred window
  //   cursor_col:         ←/→ cursor position (index into the working set)
  //   cursor_row:         ↑/↓ cursor (−1 = off)
  marker_view:           'all',
  marker_subsample_n:    0,
  zoom:                  1,
  cursor_col:            0,
  cursor_row:            -1,
});

// =====================================================================
// Public entry — refresh
// =====================================================================

export function refreshDosageHeatmap(state) {
  if (state) _setActiveState(state);
  _renderHeader(_pageState);
  _paintHeatmap(_pageState);
  _renderRightPanel(_pageState);
  _renderLegend(_pageState);
  _updateTooltip(_pageState);
}

export function initDosageHeatmapToolbar() {
  _wireToolbar(_pageState);
}

// =====================================================================
// Atlas-router lifecycle
// =====================================================================

export async function mount(root, atlasState, registry) {
  let pageState = _buildPageState(atlasState);
  _setActiveState(pageState);

  try { refreshDosageHeatmap(pageState); }
  catch (e) { console.warn('dosage_heatmap.mount: refresh threw —', e); }

  try { initDosageHeatmapToolbar(); }
  catch (e) { console.warn('dosage_heatmap.mount: toolbar wiring threw —', e); }

  if (atlasState.inversion) {
    atlasState.inversion._page_dosage_heatmap_state = pageState;
  }

  // 2026-05-20: auto-fetch a default chunk on direct mount. The page used
  // to render the empty "feed buildHeatmapFromDosage output…" stub when
  // the user navigated here without first opening from a candidate. Now
  // we fetch a sensible default range so the heatmap renders immediately.
  //
  // Priority order for the bp range:
  //   1. Active candidate's start_bp/end_bp (if set on shared state)
  //   2. Focal L2 envelope of the local_pca_dosage cursor (from the stash)
  //   3. First ~2 Mb of the active chromosome
  //
  // Uses the same /api/dosage/chunk endpoint the candidate-open path
  // uses, via the synthetic chunk-index template that local_pca_dosage
  // attaches to state.data.dosage_chunks. Bails silently when no chrom
  // is loaded or the template URL isn't available.
  if (!pageState.data) {
    try {
      await _autoLoadDefaultChunk(root, atlasState);
      // Rebuild the page state from the now-populated inv.dosage_heatmap_state
      // and re-render.
      pageState = _buildPageState(atlasState);
      _setActiveState(pageState);
      try { refreshDosageHeatmap(pageState); }
      catch (e) { console.warn('dosage_heatmap.mount: post-autoload refresh threw —', e); }
      if (atlasState.inversion) {
        atlasState.inversion._page_dosage_heatmap_state = pageState;
      }
    } catch (e) {
      console.warn('dosage_heatmap.mount: auto-load failed:', e);
    }
  }
}

// Auto-fetch a default dosage chunk and stash it on inv.dosage_heatmap_state.
// Returns silently if no chrom is loaded or the dosage_chunks template URL
// isn't available (e.g. user opened this page before mounting local_pca_dosage).
async function _autoLoadDefaultChunk(root, atlasState) {
  const inv = (atlasState && atlasState.inversion) || {};
  // If a payload is already set (candidate-open path), don't overwrite.
  const dh = inv.dosage_heatmap_state || {};
  if (dh.legacy_chunk || dh.mgl_heatmap_result) return;
  // 2026-05-20: be permissive about the stash — work even when
  // local_pca_dosage hasn't mounted yet. We only need a chrom + a
  // chunk-URL template; the latter has a hard-coded fallback below.
  const stash = inv._local_pca_dosage_state;
  const data = stash && stash.data;
  const chrom = (data && data.chrom)
             || (atlasState.shared && atlasState.shared.activeChrom);
  if (!chrom) return;
  const dc = data && data.dosage_chunks;
  // Prefer the synthetic-bridge URL that local_pca_dosage attaches; fall
  // back to the canonical /api/dosage/chunk template so this page is
  // self-sufficient when opened first.
  const template =
       (dc && Array.isArray(dc.chunks) && dc.chunks[0] && (dc.chunks[0].url || dc._endpoint))
    || '/api/dosage/chunk?chrom=__CHROM__&start=__START__&end=__END__&cap=__CAP__';
  if (!template || template.indexOf('__START__') < 0) return;
  // Pick a default region.
  let startBp = null, endBp = null, sourceLabel = null;
  // 1. Active candidate.
  const cand = atlasState.shared && atlasState.shared.activeCandidate;
  if (cand && Number.isFinite(cand.start_bp) && Number.isFinite(cand.end_bp)) {
    startBp = cand.start_bp; endBp = cand.end_bp;
    sourceLabel = `candidate ${cand.label || cand.id || ''}`.trim();
  }
  // 2. Focal L2 of the current cursor (only when the stash + data are present).
  if (startBp == null && stash && stash.windowToL2 && stash.cur != null
      && data && Array.isArray(data.l2_envelopes)) {
    const li = stash.windowToL2[stash.cur | 0];
    if (li >= 0 && data.l2_envelopes[li]) {
      const env = data.l2_envelopes[li];
      if (Number.isFinite(env.start_bp) && Number.isFinite(env.end_bp)) {
        startBp = env.start_bp; endBp = env.end_bp;
        sourceLabel = `focal L2 (window ${stash.cur | 0})`;
      }
    }
  }
  // 3. First 2 Mb of the chrom — best-effort window-range pull from
  //    data.windows[0..N].start_bp/end_bp, capped at 2 Mb. Falls back
  //    to "first 2 Mb starting at bp=1" when no windows array exists.
  if (startBp == null && data && Array.isArray(data.windows) && data.windows.length > 0) {
    const w0 = data.windows[0];
    const firstBp = Number.isFinite(w0.start_bp) ? w0.start_bp : 1;
    startBp = firstBp;
    endBp   = firstBp + 2_000_000;
    sourceLabel = `${chrom} ${(firstBp / 1e6).toFixed(2)}–${(endBp / 1e6).toFixed(2)} Mb (default)`;
  } else if (startBp == null) {
    startBp = 1;
    endBp   = 2_000_000;
    sourceLabel = `${chrom} 0.00–2.00 Mb (default)`;
  }
  if (startBp == null || endBp == null) return;
  const cap = (dc && (dc.cap_default | 0)) || 1000;
  const url = template
    .replace('__CHROM__', encodeURIComponent(chrom))
    .replace('__START__', String(startBp | 0))
    .replace('__END__',   String(endBp | 0))
    .replace('__CAP__',   String(cap));
  // Show a "loading" status on the empty-state slot while the fetch is
  // in flight so the user knows something is happening. 2026-05-26: added
  // a 15 s AbortController timeout so a server-side hang (or a workspace
  // served without atlas_server.py) surfaces as a clear failure instead of
  // an infinite "loading…" message. The endpoint is served by
  // start.sh → atlas_server.py at http://127.0.0.1:8000/api/dosage/chunk;
  // without it the page is read-only.
  _setLoadingHint(root, `loading dosage chunk for ${sourceLabel}…`);
  const controller = (typeof AbortController === 'function') ? new AbortController() : null;
  const timeoutMs = 15000;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let chunk = null;
  try {
    const r = await fetch(url, controller ? { signal: controller.signal } : undefined);
    if (timer) clearTimeout(timer);
    if (!r.ok) {
      _setLoadingHint(root, `failed to load dosage chunk (HTTP ${r.status}) — ` +
        `is atlas_server.py running? (start.sh, default port 8000)`);
      return;
    }
    chunk = await r.json();
  } catch (e) {
    if (timer) clearTimeout(timer);
    const aborted = e && (e.name === 'AbortError');
    _setLoadingHint(root, aborted
      ? `dosage chunk request timed out after ${timeoutMs / 1000}s — ` +
        `is atlas_server.py running? (start.sh, default port 8000)`
      : `dosage chunk fetch failed: ${e && e.message ? e.message : 'network error'} — ` +
        `is atlas_server.py running?`);
    return;
  }
  if (!chunk || typeof chunk !== 'object') return;
  inv.dosage_heatmap_state = Object.assign({}, dh, {
    legacy_chunk:    chunk,
    candidate_label: dh.candidate_label || sourceLabel,
    view_label:      dh.view_label || `auto-loaded · ${sourceLabel}`,
  });
}

function _setLoadingHint(root, msg) {
  if (!root) return;
  const el = (root.querySelector && root.querySelector('#dosageHeatmapEmpty'))
    || (typeof document !== 'undefined' && document.getElementById('dosageHeatmapEmpty'));
  if (el) el.textContent = msg;
}

export async function unmount(root) {
  try { _teardownToolbar(_pageState); }
  catch (e) { console.warn('dosage_heatmap.unmount: teardown threw —', e); }
  _setActiveState(null);
}

// =====================================================================
// State construction
// =====================================================================

function _buildPageState(atlasState) {
  const inv = (atlasState && atlasState.inversion) || {};
  const dh = inv.dosage_heatmap_state || null;
  let canonical = null;
  if (dh) {
    if (dh.mgl_heatmap_result) {
      canonical = adaptMglHeatmapJson(dh.mgl_heatmap_result, {
        sample_group:           dh.sample_group           || null,
        sample_k6:              dh.sample_k6              || null,
        sample_ghsl_mean:       dh.sample_ghsl_mean       || null,
        sample_theta_pi_mean:   dh.sample_theta_pi_mean   || null,
        sample_het_dosage_mean: dh.sample_het_dosage_mean || null,
      });
    } else if (dh.legacy_chunk) {
      canonical = adaptLegacyChunk(dh.legacy_chunk, {
        selected_marker_indices: dh.selected_marker_indices || null,
        sample_group:            dh.sample_group            || null,
        sample_k6:               dh.sample_k6               || null,
        sample_ghsl_mean:        dh.sample_ghsl_mean        || null,
        sample_theta_pi_mean:    dh.sample_theta_pi_mean    || null,
        sample_het_dosage_mean:  dh.sample_het_dosage_mean  || null,
        marker_polarity:         dh.marker_polarity         || null,
      });
    }
  }

  // Fill any missing per-sample mean from the chrom precomp / heatmap
  // data itself. The local_pca_dosage page stashes the precomp at
  // inv._local_pca_dosage_state.data. Het-dosage mean is always
  // derivable from the canonical heatmap directly.
  if (canonical) {
    const chromData = (inv._local_pca_dosage_state && inv._local_pca_dosage_state.data) || null;
    if (!canonical.sample_het_dosage_mean) {
      try { canonical.sample_het_dosage_mean = computeSampleHetDosageMean(canonical); }
      catch (e) { console.warn('dosage_heatmap: het-dosage mean compute threw —', e); }
    }
    if (!canonical.sample_theta_pi_mean && chromData) {
      try { canonical.sample_theta_pi_mean = computeSampleThetaPiMean(chromData); }
      catch (e) { console.warn('dosage_heatmap: θπ mean compute threw —', e); }
    }
    if (!canonical.sample_ghsl_mean && chromData) {
      try { canonical.sample_ghsl_mean = computeSampleGhslMean(chromData, canonical); }
      catch (e) { console.warn('dosage_heatmap: GHSL mean compute threw —', e); }
    }
    // 2026-05-27: build regime overlay from the active candidate.
    try { canonical.regime_overlay = _buildRegimeOverlay(canonical, atlasState); }
    catch (e) { console.warn('dosage_heatmap: regime overlay build threw —', e); }
  }
  const state = {
    data:                  canonical,
    candidate_label:       dh ? (dh.candidate_label || null) : null,
    view_label:            dh ? (dh.view_label || _defaultViewLabel(dh)) : null,
    group_colors:          canonical
                              ? buildGroupColorMap(_distinctOf(canonical.sample_group))
                              : new Map(),
    k6_colors:             canonical
                              ? buildGroupColorMap(_distinctOf(canonical.sample_k6))
                              : new Map(),
    layout:                null,
    last_cursor_px:        null,
    detect:                null,    // detectGroups() result when grouping_source is in-page
    overlay:               null,    // buildRegistryOverlay() result for the catalogue source
    // Cross-atlas regime registry (written by the haplotype_regimes
    // pipeline) + active chrom, captured for the 'upstream_catalogue' source.
    _registered:           (atlasState && atlasState.shared && atlasState.shared.registeredCandidates) || null,
    _chrom:                (atlasState && atlasState.shared && atlasState.shared.activeChrom) || null,
    _focus_regime_id:      null,    // catalogue regime focused via click-to-focus
    view_state:            Object.assign({}, DEFAULT_VIEW_STATE,
                                          (dh && dh.view_state) || {}),
    selection:             createDosageHeatmapSelection(),
    _handlers:             {},
  };
  // Build the initial marker working-set + grouping.
  _recomputeMarkers(state);
  _applyGrouping(state);
  return state;
}

// =====================================================================
// Marker working-set (SNP view + subsample) + cursor clamp
// =====================================================================

/**
 * Recompute `state.markers_selected` (the working marker set the matrix
 * and the in-page detection both operate on) from the SNP view +
 * subsample knobs, and clamp the cursor into range.
 */
function _recomputeMarkers(state) {
  const d = state && state.data;
  if (!d) { if (state) state.markers_selected = null; return; }
  const vs = state.view_state;
  let sel;
  try {
    sel = selectMarkers(d, { view: vs.marker_view, n: vs.marker_subsample_n });
  } catch (e) {
    console.warn('dosage_heatmap: selectMarkers threw —', e);
    sel = null;
  }
  state.markers_selected = (sel && sel.length > 0) ? sel : null;
  const len = state.markers_selected ? state.markers_selected.length : (d.n_markers | 0);
  if (!Number.isFinite(vs.cursor_col)) vs.cursor_col = 0;
  vs.cursor_col = Math.max(0, Math.min(len - 1, vs.cursor_col | 0));
}

// =====================================================================
// Grouping source — in-page detection / upstream regime / external
// =====================================================================

// Map a per-sample silhouette ([-1,1]) into [0,1] for the confidence ramp.
function _sil01(arr) {
  if (!arr) return null;
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    out[i] = Number.isFinite(arr[i]) ? (arr[i] + 1) / 2 : NaN;
  }
  return out;
}

/**
 * Resolve `state.data.sample_group` + `sample_confidence` from the
 * current grouping source. Caches the originally-supplied (external)
 * grouping on first call so switching back to 'external' restores it.
 * Recomputes `state.group_colors` for the resulting group set and
 * stashes the full detection result on `state.detect`.
 */
function _applyGrouping(state) {
  const d = state && state.data;
  if (!d) { if (state) state.detect = null; return; }
  const vs = state.view_state;
  if (d._external_sample_group === undefined) {
    d._external_sample_group = d.sample_group || null;
  }
  const src = (vs && vs.grouping_source) || 'external';
  let det = null;
  if (src === 'bands' || src === 'clusters') {
    // Detection operates on the current SNP working-set so grouping +
    // confidence reflect the markers actually on screen (random / high-
    // var / low-var view), not always the full marker set.
    try { det = detectGroups(d, { mode: src, k: vs.detect_k, markerOrder: state.markers_selected || undefined }); }
    catch (e) { console.warn('dosage_heatmap: detectGroups threw —', e); det = null; }
  } else if (src === 'index_aware') {
    // Position-aware haplotype clustering on ordered-bin trajectories
    // (respects SNP order + block continuity, not just total dosage).
    try { det = clusterIndexAware(d, { k: vs.detect_k, markerOrder: state.markers_selected || undefined }); }
    catch (e) { console.warn('dosage_heatmap: clusterIndexAware threw —', e); det = null; }
  }
  state.detect = det;
  // Position-aware row order (index-aware source only); cleared otherwise.
  // Mirrored onto `d` so deriveSampleOrder (which receives `data` as src)
  // can consume it for the 'index_aware' sample-order mode.
  state.index_aware_order = (det && src === 'index_aware' && det.order) ? det.order : null;
  d.index_aware_order = state.index_aware_order;
  // Regime spans (catalogue source) live on the canonical data so the
  // renderer auto-draws them; clear them for every other source.
  d.regime_spans = null;
  state.overlay = null;
  if (det) {
    d.sample_group = det.sample_group;
    d.sample_confidence = (vs.confidence_scheme === 'silhouette')
      ? _sil01(det.silhouette)
      : det.margin;
  } else if (src === 'upstream_catalogue') {
    let ov = null;
    try { ov = buildRegistryOverlay(d, state._registered, { chrom: state._chrom, primary_id: state._focus_regime_id }); }
    catch (e) { console.warn('dosage_heatmap: buildRegistryOverlay threw —', e); ov = null; }
    state.overlay = ov;
    if (ov && ov.n_regimes > 0) {
      d.sample_group = ov.sample_group;
      d.regime_spans = ov.spans;
    } else {
      d.sample_group = d._external_sample_group;
    }
    d.sample_confidence = null;
  } else if (src === 'upstream_regime'
             && d.regime_overlay && d.regime_overlay.sample_regime_call) {
    d.sample_group = d.regime_overlay.sample_regime_call.map(c => c || null);
    d.sample_confidence = null;
  } else {
    d.sample_group = d._external_sample_group;
    d.sample_confidence = null;
  }
  state.group_colors = buildGroupColorMap(_distinctOf(d.sample_group));

  // Per-window karyogroup boundary statistics (Cramér's V / FST proxy /
  // separation / het-intermediacy + inside-window counts + block span).
  // Computed whenever an in-page detection produced karyogroup labels;
  // drives the legend window-count readout, the "fan" colour mode's
  // per-marker strength, and the FST export. Cleared otherwise.
  state.kgstats = null;
  d.boundary_strength = null;
  if (det && det.labels && Number.isFinite(det.k) && det.k >= 1) {
    let kg = null;
    try {
      kg = computeKaryogroupStats(d, {
        labels: det.labels, k: det.k,
        markerOrder: state.markers_selected || undefined,
        nWindows: state.view_state.kg_windows,
      });
    } catch (e) { console.warn('dosage_heatmap: computeKaryogroupStats threw —', e); kg = null; }
    if (kg) {
      state.kgstats = kg;
      d.boundary_strength = kg.per_marker_strength;
    }
  }
}

function _defaultViewLabel(dh) {
  if (dh.mgl_heatmap_result && dh.mgl_heatmap_result.centering) {
    const c = dh.mgl_heatmap_result.centering;
    return `${c.anchor || '—'} · polarity ${c.polarity_reference || 'none'}`;
  }
  return null;
}

function _distinctOf(arr) {
  if (!arr) return [];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v == null) continue;
    if (!seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}

// =====================================================================
// Regime overlay (active-candidate scope)
// =====================================================================

// Dosage tier thresholds — kept in sync with shared/mgl_regime_consistency.js
// MGL_REGIME_CONSISTENCY_DEFAULTS. Duplicated as constants here so the
// build doesn't pull the whole stats module into this page when the
// user hasn't enabled the regime overlays.
const _DOSAGE_TIER_HOM_A_MAX = 0.4;
const _DOSAGE_TIER_HET_LO    = 0.6;
const _DOSAGE_TIER_HET_HI    = 1.4;
const _DOSAGE_TIER_HOM_B_MIN = 1.6;

/**
 * Build the regime overlay struct from atlasState.shared.activeCandidate.
 * Returns null when there's no active candidate or when the candidate's
 * chrom doesn't match the heatmap.
 *
 *   locus_start_marker / locus_end_marker — marker indices spanning the
 *     candidate's bp range (used by the locus-span overlay).
 *   sample_regime_call: Array<string|null> length n_samples — homA_like
 *     / het_like / homB_like / uncertain / null (out-of-locus).
 */
function _buildRegimeOverlay(canonical, atlasState) {
  if (!canonical || !atlasState) return null;
  const cand = atlasState.shared && atlasState.shared.activeCandidate;
  if (!cand) return null;
  // 1. Map candidate bp range -> marker indices.
  const mb = canonical.marker_pos_bp;
  let lo = -1, hi = -1;
  if (mb && Number.isFinite(cand.start_bp) && Number.isFinite(cand.end_bp)) {
    for (let i = 0; i < mb.length; i++) {
      const v = mb[i];
      if (!Number.isFinite(v)) continue;
      if (v >= cand.start_bp && v <= cand.end_bp) {
        if (lo < 0) lo = i;
        hi = i;
      }
    }
  }
  // 2. Per-sample mean dosage over the locus markers.
  const nS = canonical.n_samples | 0;
  const call = new Array(nS).fill(null);
  if (lo >= 0 && hi >= lo) {
    // Walk locked_labels (TypedArray-friendly) — samples without a band
    // assignment leave a null call.
    const locked = cand.locked_labels;
    const lockedLen = (locked && typeof locked.length === 'number') ? locked.length : 0;
    for (let s = 0; s < nS; s++) {
      const k = (s < lockedLen) ? locked[s] : -1;
      if (k == null || k < 0) continue;
      let sum = 0, n = 0;
      for (let m = lo; m <= hi; m++) {
        const v = canonical.cellValue(m, s);
        if (Number.isFinite(v)) { sum += v; n++; }
      }
      if (n === 0) { call[s] = 'uncertain'; continue; }
      const mean = sum / n;
      if      (mean <= _DOSAGE_TIER_HOM_A_MAX)                                  call[s] = 'homA_like';
      else if (mean >= _DOSAGE_TIER_HET_LO && mean <= _DOSAGE_TIER_HET_HI)      call[s] = 'het_like';
      else if (mean >= _DOSAGE_TIER_HOM_B_MIN)                                  call[s] = 'homB_like';
      else                                                                      call[s] = 'uncertain';
    }
  }
  return {
    candidate_id:        cand.id || null,
    locus_start_marker:  lo,
    locus_end_marker:    hi,
    sample_regime_call:  call,
  };
}

// =====================================================================
// Header
// =====================================================================

function _renderHeader(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const lbl = document.getElementById('dosageHeatmapCandidateLabel');
  if (lbl) lbl.textContent = state.candidate_label || '—';
  const view = document.getElementById('dosageHeatmapViewBadge');
  if (view) view.textContent = state.view_label || '—';
  // Reflect view-state on toolbar inputs.
  const so = document.getElementById('dosageHeatmapSampleOrder');
  if (so) so.value = state.view_state.sample_order_mode;
  const mo = document.getElementById('dosageHeatmapMarkerOrder');
  if (mo) mo.value = state.view_state.marker_order_mode;
  const cm = document.getElementById('dosageHeatmapColorMode');
  if (cm) cm.value = state.view_state.color_mode;
  const gt = document.getElementById('dosageHeatmapShowGroupTrack');
  if (gt) gt.checked = !!state.view_state.show_group_track;
  const pt = document.getElementById('dosageHeatmapShowPolarityTrack');
  if (pt) pt.checked = !!state.view_state.show_polarity_track;
  const k6 = document.getElementById('dosageHeatmapShowK6Track');
  if (k6) k6.checked = !!state.view_state.show_k6_track;
  const rc = document.getElementById('dosageHeatmapShowRegimeCallTrack');
  if (rc) rc.checked = !!state.view_state.show_regime_call_track;
  const ls = document.getElementById('dosageHeatmapShowLocusSpanOverlay');
  if (ls) ls.checked = !!state.view_state.show_locus_span_overlay;
  const gr = document.getElementById('dosageHeatmapShowGroupRects');
  if (gr) gr.checked = !!state.view_state.show_group_rects;
  const csim = document.getElementById('dosageHeatmapCollapseSimilar');
  if (csim) csim.checked = !!state.view_state.collapse_similar;
  const cham = document.getElementById('dosageHeatmapCollapseHamming');
  if (cham) cham.value = String(state.view_state.collapse_hamming);
  const crep = document.getElementById('dosageHeatmapCollapseReps');
  if (crep) crep.value = String(state.view_state.collapse_reps);
  const hg = document.getElementById('dosageHeatmapShowGhslTrack');
  if (hg) hg.checked = !!state.view_state.show_ghsl_track;
  const tp = document.getElementById('dosageHeatmapShowThetaPiTrack');
  if (tp) tp.checked = !!state.view_state.show_theta_pi_track;
  const hd = document.getElementById('dosageHeatmapShowHetDosageTrack');
  if (hd) hd.checked = !!state.view_state.show_het_dosage_track;
  const gs = document.getElementById('dosageHeatmapGroupingSource');
  if (gs) gs.value = state.view_state.grouping_source;
  const dk = document.getElementById('dosageHeatmapDetectK');
  if (dk) dk.value = String(state.view_state.detect_k);
  const kw = document.getElementById('dosageHeatmapKgWindows');
  if (kw) kw.value = String(state.view_state.kg_windows);
  const cs = document.getElementById('dosageHeatmapConfidenceScheme');
  if (cs) cs.value = state.view_state.confidence_scheme;
  const ct = document.getElementById('dosageHeatmapShowConfidenceTrack');
  if (ct) ct.checked = !!state.view_state.show_confidence_track;
  const mv = document.getElementById('dosageHeatmapMarkerView');
  if (mv) mv.value = state.view_state.marker_view;
  const sn = document.getElementById('dosageHeatmapSubsampleN');
  if (sn) sn.value = String(state.view_state.marker_subsample_n);
  const zm = document.getElementById('dosageHeatmapZoom');
  if (zm) zm.value = String(state.view_state.zoom);
}

// =====================================================================
// Heatmap paint
// =====================================================================

function _paintHeatmap(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const canvas = document.getElementById('dosageHeatmapCanvas');
  const empty  = document.getElementById('dosageHeatmapEmpty');
  if (!canvas) return;
  // 2026-05-26: size the canvas backing buffer to its CSS display box.
  // The HTML has no width/height attributes, so the buffer defaults to
  // 300×150 — paintDosageHeatmap then drew into that tiny buffer and
  // the browser stretched the result to fit the wrap. Re-fit on every
  // paint so layout changes track too.
  fitCanvasNoDpr(canvas);
  if (!state.data) {
    if (empty) empty.style.display = '';
    if (canvas.getContext) {
      const ctx = canvas.getContext('2d');
      if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, canvas.width || 600, canvas.height || 400);
    }
    state.layout = null;
    return;
  }
  if (empty) empty.style.display = 'none';
  let order_s = deriveSampleOrder(state.view_state.sample_order_mode,
                                   state.data.n_samples, state.data);
  // Collapse near-identical samples into representative rows. Overrides the
  // sample-order mode (groups are ordered low→high dosage) and attaches the
  // per-row size metadata the renderer's right-gutter histogram consumes.
  state._collapse = null;
  state.data.collapse_rows = null;
  if (state.view_state.collapse_similar) {
    let plan = null;
    try {
      plan = collapseSimilar(state.data, {
        hammingThreshold: state.view_state.collapse_hamming,
        maxReps: state.view_state.collapse_reps,
        markerOrder: state.markers_selected || undefined,
      });
    } catch (e) { console.warn('dosage_heatmap: collapseSimilar threw —', e); plan = null; }
    if (plan && plan.order && plan.order.length > 0) {
      state._collapse = plan;
      order_s = plan.order;
      state.data.collapse_rows = {
        row_group: plan.row_group,
        row_group_size: plan.row_group_size,
        row_is_group_start: plan.row_is_group_start,
        row_is_medoid: plan.row_is_medoid,
      };
    }
  }
  // Marker axis: the working set (SNP view + subsample) ordered by the
  // chosen marker-order mode, then a cursor-centred zoom window.
  const working = state.markers_selected
    || deriveMarkerOrder(state.view_state.marker_order_mode,
                         state.data.n_markers, state.data);
  const orderedWorking = _orderWorkingMarkers(working, state);
  const vp = markerViewport(orderedWorking, state.view_state.cursor_col, state.view_state.zoom);
  const order_m = vp.order;
  state._viewport = vp;            // for cursor info + hit-mapping
  state._working_markers = orderedWorking;
  // Cursor position relative to the painted viewport.
  const cursorColDisp = (state.view_state.cursor_col | 0) - vp.start;
  const hov = state.selection.getHoveredCell();
  const paint = paintDosageHeatmap(canvas, state.data, {
    sample_order:          order_s,
    marker_order:          order_m,
    color_mode:            state.view_state.color_mode,
    show_group_track:      state.view_state.show_group_track,
    show_k6_track:         state.view_state.show_k6_track,
    show_ghsl_track:       state.view_state.show_ghsl_track,
    show_theta_pi_track:   state.view_state.show_theta_pi_track,
    show_het_dosage_track: state.view_state.show_het_dosage_track,
    show_confidence_track: state.view_state.show_confidence_track,
    show_polarity_track:   state.view_state.show_polarity_track,
    show_y_ticks:            state.view_state.show_y_ticks,
    show_group_labels:       state.view_state.show_group_labels,
    show_regime_call_track:  state.view_state.show_regime_call_track,
    show_locus_span_overlay: state.view_state.show_locus_span_overlay,
    show_group_rects:        state.view_state.show_group_rects,
    show_collapse:           state.view_state.collapse_similar,
    group_colors:          state.group_colors,
    k6_colors:             state.k6_colors,
    hovered_cell:          hov ? { row: hov.row, col: hov.col } : null,
    cursor_col:            cursorColDisp,
    cursor_row:            state.view_state.cursor_row,
    selected_samples:      state.selection.getSelectedSamples(),
    selected_markers:      state.selection.getSelectedMarkers(),
  });
  state.layout = paint.layout;
}

// Apply the marker-order mode (natural | by_polarity) to the working
// marker set. by_polarity reorders the working canonical indices so
// unflipped markers come first; natural keeps ascending order.
function _orderWorkingMarkers(working, state) {
  const w = (working instanceof Int32Array) ? working : Int32Array.from(working || []);
  const mode = state.view_state.marker_order_mode;
  const pol = state.data && state.data.marker_polarity;
  if (mode !== 'by_polarity' || !pol) return w;
  const arr = Array.from(w);
  arr.sort((a, b) => (Number(pol[a] || 0) - Number(pol[b] || 0)) || (a - b));
  return Int32Array.from(arr);
}

// =====================================================================
// Right panel
// =====================================================================

function _renderRightPanel(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const fields = document.getElementById('dosageHeatmapSelectedFields');
  if (!fields) return;
  if (!state.data) {
    fields.innerHTML = '<dt class="empty">No heatmap loaded</dt><dd>—</dd>';
    return;
  }
  const hov = state.selection.getHoveredCell();
  if (!hov) {
    let html =
      '<dt>Samples</dt><dd>' + state.data.n_samples + '</dd>'
      + '<dt>Markers</dt><dd>' + state.data.n_markers + '</dd>'
      + '<dt>Selected samples</dt><dd>' + state.selection.getSelectedSamples().size + '</dd>'
      + '<dt>Selected markers</dt><dd>' + state.selection.getSelectedMarkers().size + '</dd>';
    html += _cursorInfoHtml(state);
    html += _detectSummaryHtml(state);
    html += _overlaySummaryHtml(state);
    fields.innerHTML = html;
    return;
  }
  let html = '<dt>Cell</dt><dd>' + summariseHoverCell(hov, state.data) + '</dd>';
  html += '<dt>Sample idx</dt><dd>' + hov.sample_idx + '</dd>';
  html += '<dt>Marker idx</dt><dd>' + hov.marker_idx + '</dd>';
  html += '<dt>Dosage</dt><dd>' + (hov.dosage == null ? 'NA'
            : (Number.isFinite(hov.dosage) ? hov.dosage.toFixed(4) : hov.dosage)) + '</dd>';
  fields.innerHTML = html;
}

// Marker cursor + viewport readout for the right panel.
function _cursorInfoHtml(state) {
  const d = state && state.data;
  if (!d) return '';
  const vs = state.view_state;
  const working = state._working_markers;
  const len = (working && working.length) || (d.n_markers | 0);
  const col = Math.max(0, Math.min(len - 1, vs.cursor_col | 0));
  const mi = working ? working[col] : col;
  const lbl = (d.marker_labels && d.marker_labels[mi]) || ('M' + mi);
  const bp = d.marker_pos_bp && Number.isFinite(d.marker_pos_bp[mi])
    ? (d.marker_pos_bp[mi] / 1e6).toFixed(3) + ' Mb' : null;
  let html = '<dt class="dh2-detect-head">Cursor</dt><dd>'
           + lbl + (bp ? ' · ' + bp : '') + ' · col ' + (col + 1) + '/' + len + '</dd>';
  const vw = (vs.marker_view !== 'all') ? vs.marker_view : 'all SNPs';
  html += '<dt>View · zoom</dt><dd>' + vw
        + (vs.marker_subsample_n > 0 ? ' · n=' + vs.marker_subsample_n : '')
        + ' · ×' + (vs.zoom || 1) + '</dd>';
  return html;
}

// Regime-catalogue overlay summary for the right panel (one row per
// overlapping regime). Rendered only when the catalogue source is active.
function _overlaySummaryHtml(state) {
  const ov = state && state.overlay;
  if (!ov) return '';
  if (!ov.n_regimes) {
    return '<dt class="dh2-detect-head">Regime catalogue</dt>'
         + '<dd>no registered regimes overlap this window'
         + (state._registered ? '' : ' (run the regime pipeline first)') + '</dd>';
  }
  let html = '<dt class="dh2-detect-head">Regime catalogue</dt><dd>'
           + ov.n_regimes + ' overlapping · primary '
           + (ov.primary_id || '—')
           + (state._focus_regime_id ? ' (focused)' : '')
           + '<br><span style="opacity:.6">click a regime band header to focus / select its markers</span></dd>';
  for (const s of ov.spans) {
    const conf = Number.isFinite(s.confidence) ? s.confidence.toFixed(2) : '—';
    const mark = (s.candidate_id === ov.primary_id) ? ' ◀' : '';
    html += '<dt>' + (s.label || 'regime') + mark + '</dt>'
         +  '<dd>' + (s.regime_class || '—') + ' · conf ' + conf
         +  ' · markers ' + s.lo + '–' + s.hi + '</dd>';
  }
  return html;
}

// Per-group confidence summary for the right panel. Rendered only when
// an in-page grouping source (bands/clusters) is active.
function _detectSummaryHtml(state) {
  const det = state && state.detect;
  if (!det || !Array.isArray(det.groups) || det.groups.length === 0) return '';
  const modeLabel = det.mode === 'index_aware' ? 'index-aware' : det.mode;
  let html = '<dt class="dh2-detect-head">Detected ' + modeLabel
           + ' (K=' + det.k + (Number.isFinite(det.n_bins) ? ', ' + det.n_bins + ' bins' : '') + ')</dt><dd>silhouette '
           + (Number.isFinite(det.overall_silhouette) ? det.overall_silhouette.toFixed(2) : '—')
           + '</dd>';
  for (const g of det.groups) {
    const tier = (g.call || '').replace('_like', '');
    const lbl = (g.karyogroup || ('KG-' + g.label)) + ' (' + tier + ')';
    const conf = Number.isFinite(g.confidence) ? g.confidence.toFixed(2) : '—';
    const md   = Number.isFinite(g.mean_dosage) ? g.mean_dosage.toFixed(2) : '—';
    const mg   = Number.isFinite(g.mean_margin) ? g.mean_margin.toFixed(2) : '—';
    const sl   = Number.isFinite(g.mean_silhouette) ? g.mean_silhouette.toFixed(2) : '—';
    const sep  = Number.isFinite(g.separation) ? g.separation.toFixed(1) : '—';
    html += '<dt>' + lbl + ' · n=' + g.n + '</dt>'
         +  '<dd>conf ' + conf + ' · d̄ ' + md
         +  ' · margin ' + mg + ' · sil ' + sl + ' · sep ' + sep + '</dd>';
  }
  // Per-window karyogroup boundary statistics (the inside/outside signal).
  const kg = state.kgstats;
  if (kg) {
    const s = kg.summary || {};
    const vIn = Number.isFinite(s.cramers_v_mean_inside) ? s.cramers_v_mean_inside.toFixed(2) : '—';
    const fIn = Number.isFinite(s.fst_mean_inside) ? s.fst_mean_inside.toFixed(2) : '—';
    html += '<dt class="dh2-detect-head">Boundary (' + kg.n_windows + ' windows)</dt>'
         +  '<dd>inside ' + kg.n_inside + ' / outside ' + kg.n_outside
         +  ' · V̄ ' + vIn + ' · FST ' + fIn + '</dd>';
    if (kg.block) {
      const b = kg.block;
      const span = (Number.isFinite(b.start_bp) && Number.isFinite(b.end_bp))
        ? (' · ' + _bp(b.start_bp) + '–' + _bp(b.end_bp)) : '';
      html += '<dt>block</dt><dd>windows ' + b.start_win + '–' + b.end_win
           +  ' (' + b.n_windows + ')' + span + '</dd>';
    }
  }
  return html;
}

// Compact bp formatter (e.g. 1.23 Mb / 456 kb).
function _bp(x) {
  if (!Number.isFinite(x)) return '—';
  if (Math.abs(x) >= 1e6) return (x / 1e6).toFixed(2) + ' Mb';
  if (Math.abs(x) >= 1e3) return (x / 1e3).toFixed(0) + ' kb';
  return String(Math.round(x));
}

function _renderLegend(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const body = document.getElementById('dosageHeatmapLegendBody');
  if (!body) return;
  if (!state.data || !state.data.sample_group) {
    body.innerHTML = '<span class="empty">—</span>';
    return;
  }
  const sizes = groupSizesFromSampleGroup(state.data.sample_group);
  let html = '';
  // Collapsed-rows summary at the top of the legend.
  if (state._collapse) {
    const c = state._collapse;
    html += '<div class="dh2-legend-row" style="opacity:.9">'
         +    '<span class="dh2-legend-id">⊟ collapsed</span> '
         +    '<span class="dh2-legend-count">' + c.n_samples + ' samples → '
         +    c.n_displayed + ' rows · ' + c.n_groups + ' groups</span></div>';
  }
  // Focused-regime readout (catalogue source) at the top of the legend.
  if (state._focus_regime_id && state.overlay) {
    const sp = (state.overlay.spans || []).find(s => s.candidate_id === state._focus_regime_id);
    html += '<div class="dh2-legend-row" style="opacity:.95">'
         +    '<span class="dh2-legend-id">▶ focus: ' + state._focus_regime_id + '</span> '
         +    '<span class="dh2-legend-count">'
         +    (sp ? ((sp.regime_class || '—') + (Number.isFinite(sp.confidence) ? ' · conf ' + sp.confidence.toFixed(2) : '')) : '')
         +    '</span></div>';
  }
  for (const [g, n] of sizes) {
    const c = state.group_colors.get(g) || '#888';
    html += '<div class="dh2-legend-row">'
         +    '<span class="dh2-legend-swatch" style="background:' + c + '"></span>'
         +    '<span class="dh2-legend-id">' + g + '</span> '
         +    '<span class="dh2-legend-count">n = ' + n + '</span>'
         + '</div>';
  }
  body.innerHTML = html;
}

// =====================================================================
// Toolbar wiring
// =====================================================================

function _wireToolbar(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  _teardownToolbar(state);

  const repaint = () => { _paintHeatmap(state); };
  const repaintAll = () => {
    _renderHeader(state);
    _paintHeatmap(state);
    _renderRightPanel(state);
    _renderLegend(state);
  };

  const onSampleOrder = (e) => {
    state.view_state.sample_order_mode = (e && e.target && e.target.value) || 'natural';
    repaint();
  };
  const onMarkerOrder = (e) => {
    state.view_state.marker_order_mode = (e && e.target && e.target.value) || 'natural';
    repaint();
  };
  const onColorMode = (e) => {
    state.view_state.color_mode = (e && e.target && e.target.value) || 'magma';
    repaint();
  };
  const onShowGroupTrack = (e) => {
    state.view_state.show_group_track = !!(e && e.target && e.target.checked);
    repaint();
  };
  const onShowPolarityTrack = (e) => {
    state.view_state.show_polarity_track = !!(e && e.target && e.target.checked);
    repaint();
  };
  const onShowK6Track = (e) => {
    state.view_state.show_k6_track = !!(e && e.target && e.target.checked);
    repaint();
  };
  const onShowGhslTrack = (e) => {
    state.view_state.show_ghsl_track = !!(e && e.target && e.target.checked);
    repaint();
  };
  const onShowThetaPiTrack = (e) => {
    state.view_state.show_theta_pi_track = !!(e && e.target && e.target.checked);
    repaint();
  };
  const onShowHetDosageTrack = (e) => {
    state.view_state.show_het_dosage_track = !!(e && e.target && e.target.checked);
    repaint();
  };
  const onGroupingSource = (e) => {
    state.view_state.grouping_source = (e && e.target && e.target.value) || 'external';
    state._focus_regime_id = null;   // focus is catalogue-specific; reset on source change
    _applyGrouping(state);
    repaintAll();
  };
  const onDetectK = (e) => {
    const v = (e && e.target && e.target.value) || 'auto';
    state.view_state.detect_k = (v === 'auto') ? 'auto' : (parseInt(v, 10) || 'auto');
    _applyGrouping(state);
    repaintAll();
  };
  const onKgWindows = (e) => {
    state.view_state.kg_windows = parseInt((e && e.target && e.target.value) || '20', 10) || 20;
    _applyGrouping(state);
    repaintAll();
  };
  const onConfidenceScheme = (e) => {
    state.view_state.confidence_scheme = (e && e.target && e.target.value) || 'margin';
    _applyGrouping(state);
    repaintAll();
  };
  const onShowConfidenceTrack = (e) => {
    state.view_state.show_confidence_track = !!(e && e.target && e.target.checked);
    repaint();
  };
  const onMarkerView = (e) => {
    state.view_state.marker_view = (e && e.target && e.target.value) || 'all';
    _recomputeMarkers(state);
    _applyGrouping(state);
    repaintAll();
  };
  const onSubsampleN = (e) => {
    const v = parseInt((e && e.target && e.target.value), 10);
    state.view_state.marker_subsample_n = Number.isFinite(v) ? v : 0;
    _recomputeMarkers(state);
    _applyGrouping(state);
    repaintAll();
  };
  const onZoom = (e) => {
    const v = parseInt((e && e.target && e.target.value), 10);
    state.view_state.zoom = Number.isFinite(v) && v >= 1 ? v : 1;
    repaint();
    _renderRightPanel(state);
  };
  // Keyboard cursor: ←/→ move the marker cursor (Shift ×10, Home/End to
  // ends), ↑/↓ move the sample cursor, +/− zoom. Ignored while typing in
  // a form control or when the page isn't mounted.
  const onKeyDown = (ev) => {
    if (!ev) return;
    const t = ev.target;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName || '')) return;
    if (!document.getElementById('dosageHeatmapCanvas')) return;
    if (!state.data) return;
    const vs = state.view_state;
    const len = (state._working_markers && state._working_markers.length)
      || (state.data.n_markers | 0);
    const nS = state.data.n_samples | 0;
    const step = ev.shiftKey ? 10 : 1;
    let handled = true;
    switch (ev.key) {
      case 'ArrowLeft':  vs.cursor_col = Math.max(0, (vs.cursor_col | 0) - step); break;
      case 'ArrowRight': vs.cursor_col = Math.min(len - 1, (vs.cursor_col | 0) + step); break;
      case 'Home':       vs.cursor_col = 0; break;
      case 'End':        vs.cursor_col = len - 1; break;
      case 'ArrowUp':
        vs.cursor_row = (vs.cursor_row < 0 ? nS - 1 : Math.max(0, vs.cursor_row - step)); break;
      case 'ArrowDown':
        vs.cursor_row = (vs.cursor_row < 0 ? 0 : Math.min(nS - 1, vs.cursor_row + step)); break;
      case '+': case '=': vs.zoom = Math.min(16, (vs.zoom || 1) * 2); break;
      case '-': case '_': vs.zoom = Math.max(1, (vs.zoom || 1) / 2); break;
      default: handled = false;
    }
    if (!handled) return;
    if (typeof ev.preventDefault === 'function') ev.preventDefault();
    _renderHeader(state);
    _paintHeatmap(state);
    _renderRightPanel(state);
  };
  const onShowRegimeCallTrack = (e) => {
    state.view_state.show_regime_call_track = !!(e && e.target && e.target.checked);
    repaint();
  };
  const onShowLocusSpanOverlay = (e) => {
    state.view_state.show_locus_span_overlay = !!(e && e.target && e.target.checked);
    repaint();
  };
  const onShowGroupRects = (e) => {
    state.view_state.show_group_rects = !!(e && e.target && e.target.checked);
    repaint();
  };
  const onCollapseSimilar = (e) => {
    state.view_state.collapse_similar = !!(e && e.target && e.target.checked);
    repaintAll();
  };
  const onCollapseHamming = (e) => {
    state.view_state.collapse_hamming = parseInt((e && e.target && e.target.value) || '0', 10) || 0;
    repaintAll();
  };
  const onCollapseReps = (e) => {
    state.view_state.collapse_reps = parseInt((e && e.target && e.target.value) || '4', 10) || 4;
    repaintAll();
  };
  const onCanvasMove = (ev) => {
    const c = document.getElementById('dosageHeatmapCanvas');
    if (!c) return;
    const rect = typeof c.getBoundingClientRect === 'function'
      ? c.getBoundingClientRect() : { left: 0, top: 0 };
    const x = ((ev && ev.clientX) || 0) - (rect.left || 0);
    const y = ((ev && ev.clientY) || 0) - (rect.top  || 0);
    state.last_cursor_px = { x, y };
    const cell = findCellAtPixel(state.layout, state.data ? state.data.cellValue : null, x, y);
    state.selection.setHoveredCell(cell);
    _updateTooltip(state);
  };
  const onCanvasLeave = () => {
    state.last_cursor_px = null;
    state.selection.setHoveredCell(null);
    _hideTooltip();
  };
  const onCanvasClick = (ev) => {
    const c = document.getElementById('dosageHeatmapCanvas');
    if (!c || !state.data) return;
    const rect = typeof c.getBoundingClientRect === 'function'
      ? c.getBoundingClientRect() : { left: 0, top: 0 };
    const x = ((ev && ev.clientX) || 0) - (rect.left || 0);
    const y = ((ev && ev.clientY) || 0) - (rect.top  || 0);
    // Regime focus: a click on a regime span's label header (catalogue
    // source) focuses that regime — re-picks it as primary so the group
    // track + per-sample labels reflect it, and selects its markers. Takes
    // precedence over cell selection since it sits in the top label strip.
    if (state.data.regime_spans && state.data.regime_spans.length) {
      const span = findRegimeSpanAtPixel(state.layout, state.data.regime_spans, x, y);
      if (span) {
        state._focus_regime_id = (state._focus_regime_id === span.candidate_id)
          ? null : span.candidate_id;   // click the focused regime again to clear
        _applyGrouping(state);
        const markers = [];
        for (let m = span.lo | 0; m <= (span.hi | 0); m++) markers.push(m);
        state.selection.setSelectedMarkers(markers);  // notify → repaintAll
        return;
      }
    }
    const cell = findCellAtPixel(state.layout, state.data.cellValue, x, y);
    if (!cell) return;
    // Shift-click → toggle marker; plain click → toggle sample.
    if (ev && ev.shiftKey) state.selection.toggleSelectedMarker(cell.marker_idx);
    else                   state.selection.toggleSelectedSample(cell.sample_idx);
  };

  const unsubSelection = state.selection.subscribe(() => {
    repaintAll();
    _updateTooltip(state);
  });

  state._handlers = {
    onSampleOrder, onMarkerOrder, onColorMode,
    onShowGroupTrack, onShowPolarityTrack, onShowK6Track,
    onShowGhslTrack, onShowThetaPiTrack, onShowHetDosageTrack,
    onShowRegimeCallTrack, onShowLocusSpanOverlay, onShowGroupRects,
    onCollapseSimilar, onCollapseHamming, onCollapseReps,
    onGroupingSource, onDetectK, onKgWindows, onConfidenceScheme, onShowConfidenceTrack,
    onMarkerView, onSubsampleN, onZoom, onKeyDown,
    onCanvasMove, onCanvasClick, onCanvasLeave,
    unsubSelection,
  };

  _addListener('dosageHeatmapSampleOrder',          'change',     onSampleOrder);
  _addListener('dosageHeatmapMarkerOrder',          'change',     onMarkerOrder);
  _addListener('dosageHeatmapColorMode',            'change',     onColorMode);
  _addListener('dosageHeatmapShowGroupTrack',       'change',     onShowGroupTrack);
  _addListener('dosageHeatmapShowPolarityTrack',    'change',     onShowPolarityTrack);
  _addListener('dosageHeatmapShowK6Track',          'change',     onShowK6Track);
  _addListener('dosageHeatmapShowGhslTrack',        'change',     onShowGhslTrack);
  _addListener('dosageHeatmapShowThetaPiTrack',     'change',     onShowThetaPiTrack);
  _addListener('dosageHeatmapShowHetDosageTrack',   'change',     onShowHetDosageTrack);
  _addListener('dosageHeatmapGroupingSource',       'change',     onGroupingSource);
  _addListener('dosageHeatmapDetectK',              'change',     onDetectK);
  _addListener('dosageHeatmapKgWindows',            'change',     onKgWindows);
  _addListener('dosageHeatmapConfidenceScheme',     'change',     onConfidenceScheme);
  _addListener('dosageHeatmapShowConfidenceTrack',  'change',     onShowConfidenceTrack);
  _addListener('dosageHeatmapMarkerView',           'change',     onMarkerView);
  _addListener('dosageHeatmapSubsampleN',           'change',     onSubsampleN);
  _addListener('dosageHeatmapZoom',                 'change',     onZoom);
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('keydown', onKeyDown);
  }
  _addListener('dosageHeatmapShowRegimeCallTrack',  'change',     onShowRegimeCallTrack);
  _addListener('dosageHeatmapShowLocusSpanOverlay', 'change',     onShowLocusSpanOverlay);
  _addListener('dosageHeatmapShowGroupRects',       'change',     onShowGroupRects);
  _addListener('dosageHeatmapCollapseSimilar',      'change',     onCollapseSimilar);
  _addListener('dosageHeatmapCollapseHamming',      'change',     onCollapseHamming);
  _addListener('dosageHeatmapCollapseReps',         'change',     onCollapseReps);
  _addListener('dosageHeatmapCanvas',               'mousemove',  onCanvasMove);
  _addListener('dosageHeatmapCanvas',               'click',      onCanvasClick);
  _addListener('dosageHeatmapCanvas',               'mouseleave', onCanvasLeave);
}

function _teardownToolbar(state) {
  if (!state || !state._handlers) return;
  const h = state._handlers;
  if (h.onSampleOrder)         _removeListener('dosageHeatmapSampleOrder',          'change',    h.onSampleOrder);
  if (h.onMarkerOrder)         _removeListener('dosageHeatmapMarkerOrder',          'change',    h.onMarkerOrder);
  if (h.onColorMode)           _removeListener('dosageHeatmapColorMode',            'change',    h.onColorMode);
  if (h.onShowGroupTrack)      _removeListener('dosageHeatmapShowGroupTrack',       'change',    h.onShowGroupTrack);
  if (h.onShowPolarityTrack)   _removeListener('dosageHeatmapShowPolarityTrack',    'change',    h.onShowPolarityTrack);
  if (h.onShowK6Track)         _removeListener('dosageHeatmapShowK6Track',          'change',    h.onShowK6Track);
  if (h.onShowGhslTrack)       _removeListener('dosageHeatmapShowGhslTrack',        'change',    h.onShowGhslTrack);
  if (h.onShowThetaPiTrack)    _removeListener('dosageHeatmapShowThetaPiTrack',     'change',    h.onShowThetaPiTrack);
  if (h.onShowHetDosageTrack)  _removeListener('dosageHeatmapShowHetDosageTrack',   'change',    h.onShowHetDosageTrack);
  if (h.onGroupingSource)      _removeListener('dosageHeatmapGroupingSource',       'change',    h.onGroupingSource);
  if (h.onDetectK)             _removeListener('dosageHeatmapDetectK',              'change',    h.onDetectK);
  if (h.onKgWindows)           _removeListener('dosageHeatmapKgWindows',            'change',    h.onKgWindows);
  if (h.onConfidenceScheme)    _removeListener('dosageHeatmapConfidenceScheme',     'change',    h.onConfidenceScheme);
  if (h.onShowConfidenceTrack) _removeListener('dosageHeatmapShowConfidenceTrack',  'change',    h.onShowConfidenceTrack);
  if (h.onMarkerView)          _removeListener('dosageHeatmapMarkerView',           'change',    h.onMarkerView);
  if (h.onSubsampleN)          _removeListener('dosageHeatmapSubsampleN',           'change',    h.onSubsampleN);
  if (h.onZoom)                _removeListener('dosageHeatmapZoom',                 'change',    h.onZoom);
  if (h.onKeyDown && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
    document.removeEventListener('keydown', h.onKeyDown);
  }
  if (h.onShowRegimeCallTrack) _removeListener('dosageHeatmapShowRegimeCallTrack',  'change',    h.onShowRegimeCallTrack);
  if (h.onShowLocusSpanOverlay) _removeListener('dosageHeatmapShowLocusSpanOverlay','change',    h.onShowLocusSpanOverlay);
  if (h.onShowGroupRects)      _removeListener('dosageHeatmapShowGroupRects',        'change',     h.onShowGroupRects);
  if (h.onCollapseSimilar)     _removeListener('dosageHeatmapCollapseSimilar',       'change',     h.onCollapseSimilar);
  if (h.onCollapseHamming)     _removeListener('dosageHeatmapCollapseHamming',       'change',     h.onCollapseHamming);
  if (h.onCollapseReps)        _removeListener('dosageHeatmapCollapseReps',          'change',     h.onCollapseReps);
  if (h.onCanvasMove)          _removeListener('dosageHeatmapCanvas',               'mousemove',  h.onCanvasMove);
  if (h.onCanvasClick)         _removeListener('dosageHeatmapCanvas',               'click',      h.onCanvasClick);
  if (h.onCanvasLeave)         _removeListener('dosageHeatmapCanvas',               'mouseleave', h.onCanvasLeave);
  if (typeof h.unsubSelection === 'function') { try { h.unsubSelection(); } catch (_) {} }
  state._handlers = {};
}

function _updateTooltip(state) {
  if (typeof document === 'undefined' || !document.getElementById) return;
  const slot = document.getElementById('dosageHeatmapTooltip');
  if (!slot) return;
  if (!state) { slot.style.display = 'none'; return; }
  const hov = state.selection.getHoveredCell();
  const px  = state.last_cursor_px;
  if (!hov || !px || !state.data) { slot.style.display = 'none'; return; }
  let tip = summariseHoverCell(hov, state.data);
  // Collapsed view: annotate the representative row with its group size.
  const cr = state.data.collapse_rows;
  if (cr && cr.row_group_size && hov.row >= 0 && hov.row < cr.row_group_size.length) {
    const n = cr.row_group_size[hov.row];
    if (n > 1) tip += ' · ×' + n + (cr.row_is_medoid && cr.row_is_medoid[hov.row] ? ' (medoid)' : '');
  }
  slot.innerHTML = tip;
  slot.style.display = 'block';
  // Position the tooltip 12px right + 4px below the cursor, clamped to
  // the canvas-wrap. We use offsetWidth/Height after toggling display
  // so the dimensions are known.
  const canvas = document.getElementById('dosageHeatmapCanvas');
  const wrap = canvas && canvas.parentElement;
  if (!wrap) return;
  const ww = (typeof wrap.clientWidth  === 'number') ? wrap.clientWidth  : 0;
  const wh = (typeof wrap.clientHeight === 'number') ? wrap.clientHeight : 0;
  const tw = slot.offsetWidth  || 0;
  const th = slot.offsetHeight || 0;
  let left = px.x + 12;
  let top  = px.y + 4;
  if (tw > 0 && left + tw > ww - 4) left = px.x - tw - 8;
  if (left < 4) left = 4;
  if (th > 0 && top + th > wh - 4) top = px.y - th - 6;
  if (top < 4) top = 4;
  slot.style.left = left + 'px';
  slot.style.top  = top  + 'px';
}

function _hideTooltip() {
  if (typeof document === 'undefined' || !document.getElementById) return;
  const slot = document.getElementById('dosageHeatmapTooltip');
  if (slot) slot.style.display = 'none';
}

function _addListener(id, evt, cb) {
  if (typeof document === 'undefined' || !document.getElementById) return;
  const el = document.getElementById(id);
  if (el && typeof el.addEventListener === 'function') el.addEventListener(evt, cb);
}
function _removeListener(id, evt, cb) {
  if (typeof document === 'undefined' || !document.getElementById) return;
  const el = document.getElementById(id);
  if (el && typeof el.removeEventListener === 'function') el.removeEventListener(evt, cb);
}
