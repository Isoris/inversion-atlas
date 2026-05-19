// atlases/inversion/shared/page1_data_helpers.js
//
// Shared data-access helpers, hoisted from
// pages/discovery/local_pca_dosage/_data.js in chat 36 round 5 step 1
// (2026-05-07). All functions take `state` as first arg — they are
// pure or pure-from-state, no `_pageState` shim, no DOM access except
// for `populateSimScales` (which writes a <select>) and
// `loadViewControls`/`saveViewControls` (which use localStorage).
//
// They were originally extracted from legacy/Inversion_atlas.html in
// round 3 step 3 already taking `state` as first arg, so the hoist is
// a file move — no body edits.
//
// This module owns:
//   - Schema/layer detection (detectSchemaAndLayers, inferLayersFromV1, listLayers).
//   - PC accessors (availablePCs, getPC, getPCByAxis, getPCRender).
//   - State-mutating index builders (buildIndexes, computePC1Signs,
//     populateSimScales, buildFamilyPalette).
//   - View controls persistence (loadViewControls, saveViewControls,
//     reconcileViewControlsForData).
//   - L2 cluster cache wrappers (getL2Cluster, getL2ClusterAt; both
//     adapted to shared/per_l2_cluster.js's ctx-based API).
//   - Per-window grid/lines accessors (getLinesGrid, getLinesSignAt,
//     getLinesValuesAt, allSampleIdx).
//   - Range/scale helpers (currentMbRange, getActiveSimScale).
//   - Lines-color-mode availability helpers (_LINES_COLOR_MODES,
//     _isLinesColorModeAvailable).
//   - FAMILY_PALETTE_BASE constant (used by buildFamilyPalette;
//     previously lived in pages/discovery/local_pca_dosage/_state.js).
//
// Importers as of round 5 step 1:
//   - pages/discovery/local_pca_dosage/_data.js — re-exports everything from here
//     so existing local_pca_dosage panel imports (`./_data.js`) keep working.
//   - pages/discovery/candidate_focus.js (round 5 main migration) — will import
//     directly from this file.

import { ClusterCache, clusterL2AtK, contextFromState } from './per_l2_cluster.js';

// --- Family / lineage palette constant (legacy 36259-36269; was in local_pca_dosage/_state.js) ---
const FAMILY_PALETTE_BASE = [
  '#332288', '#117733', '#44AA99', '#88CCEE', '#DDCC77',
  '#CC6677', '#AA4499', '#882255', '#999933', '#661100',
  '#6699CC', '#888888', '#ed7953', '#0d9488', '#7c3aed',
  '#dc2626', '#16a34a', '#ca8a04', '#0284c7', '#9333ea',
  '#be123c', '#a16207', '#15803d', '#1d4ed8', '#7e22ce',
  '#9f1239', '#854d0e', '#166534', '#1e40af', '#6b21a8'
];

// --- getActiveSimScale(state) — legacy lines 31311-31329 ---
// Resolve which scale to render. Falls back to legacy `sim_thumb` when
// no scales were embedded.
export function getActiveSimScale(state) {
  const d = state && state.data;
  if (!d) return null;
  // New multi-scale path
  if (d.sim_scales && Object.keys(d.sim_scales).length > 0) {
    const lab = state.simScale && d.sim_scales[state.simScale]
              ? state.simScale
              : (d.default_sim_scale && d.sim_scales[d.default_sim_scale]
                 ? d.default_sim_scale
                 : Object.keys(d.sim_scales)[0]);
    return d.sim_scales[lab];
  }
  // Legacy single-thumbnail path
  if (d.sim_thumb && d.sim_thumb_n > 0) {
    return { sim: d.sim_thumb, n: d.sim_thumb_n,
             z: null, q_lo: 0.05, q_hi: 0.95, z_max: 2.5 };
  }
  return null;
}

// --- currentMbRange(state) — legacy lines 31781-31834 ---
export function currentMbRange(state) {
  if (!state || !state.data || !Array.isArray(state.data.windows) || state.data.windows.length === 0) {
    return { mbMin: 0, mbMax: 1 };
  }
  const wins = state.data.windows;
  const genomeMin = wins[0].center_mb;
  const genomeMax = wins[wins.length - 1].center_mb;
  const mode = state.viewMode || 'genome';
  if (mode === 'genome') return { mbMin: genomeMin, mbMax: genomeMax };
  // L2-zoom branch.
  if (mode === 'l2') {
    const cur = state.cur;
    const l2i = (state.windowToL2 && cur != null) ? state.windowToL2[cur] : -1;
    if (l2i != null && l2i >= 0 && Array.isArray(state.data.l2_envelopes)
        && state.data.l2_envelopes[l2i]) {
      const e = state.data.l2_envelopes[l2i];
      const lo = wins[Math.max(0, e._s0)].center_mb;
      const hi = wins[Math.min(wins.length-1, e._e0)].center_mb;
      const pad = (hi - lo) * 0.05;
      return { mbMin: Math.max(genomeMin, lo - pad), mbMax: Math.min(genomeMax, hi + pad) };
    }
  }
  // L1-zoom mode (or L2 fallback)
  const cur = state.cur;
  const l1i = (state.windowToL1 && cur != null) ? state.windowToL1[cur] : -1;
  if (l1i == null || l1i < 0) {
    if (Array.isArray(state.data.l1_envelopes) && state.data.l1_envelopes.length > 0) {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < state.data.l1_envelopes.length; i++) {
        const e = state.data.l1_envelopes[i];
        const center = (e._s0 + e._e0) / 2;
        const dd = Math.abs(center - cur);
        if (dd < bestD) { bestD = dd; best = i; }
      }
      const e = state.data.l1_envelopes[best];
      const lo = wins[Math.max(0, e._s0)].center_mb;
      const hi = wins[Math.min(wins.length-1, e._e0)].center_mb;
      const pad = (hi - lo) * 0.05;
      return { mbMin: Math.max(genomeMin, lo - pad), mbMax: Math.min(genomeMax, hi + pad) };
    }
    return { mbMin: genomeMin, mbMax: genomeMax };
  }
  const e = state.data.l1_envelopes[l1i];
  const lo = wins[Math.max(0, e._s0)].center_mb;
  const hi = wins[Math.min(wins.length-1, e._e0)].center_mb;
  const pad = (hi - lo) * 0.05;
  return { mbMin: Math.max(genomeMin, lo - pad), mbMax: Math.min(genomeMax, hi + pad) };
}

const VIEW_CONTROLS_STORAGE_KEY = 'scrubber_v3_viewControls';

// --- inferLayersFromV1(data) — legacy lines 52588-52600 ---
function inferLayersFromV1(data) {
  // Best-effort layer detection for legacy JSON without _layers_present.
  const layers = [];
  if (data.windows && data.n_windows > 0) layers.push('windows');
  if ((data.l1_envelopes && data.l1_envelopes.length > 0) ||
      (data.l2_envelopes && data.l2_envelopes.length > 0)) layers.push('envelopes');
  if (data.tracks && Object.keys(data.tracks).length > 0) layers.push('tracks');
  if (data.samples && data.samples.length > 0) layers.push('samples');
  // Layers introduced in v2 (sv_evidence, candidates_registry, breakpoints_refined,
  // groups_validated, classification, gene_cargo) are NEVER inferred from v1.
  // They must be explicitly declared.
  return layers;
}

// --- _LINES_COLOR_MODES constant + _isLinesColorModeAvailable ---
// Legacy lines 33139-33159. The constant is read by refreshLinesColorMode
// and by the linesColorMode-driven coloring helpers; the predicate is read
// by refreshLinesColorMode and by the picker UI.
export const _LINES_COLOR_MODES = [
  { id: 'kmeans',           layer: null,                   label: 'kmeans' },
  { id: 'dosage',           layer: 'dosage_chunks',        label: 'dosage' },
  { id: 'ghsl',             layer: 'ghsl_panel',           label: 'GHSL' },
  { id: 'het',              layer: 'dosage_chunks',        label: 'het' },
  { id: 'theta_pi',         layer: 'per_sample_theta_pi',  label: 'θπ' },
  { id: 'froh',             layer: 'sample_froh',          label: 'F_ROH' },
  { id: 'family',           layer: null,                   label: 'family' },
  { id: 'confounder_alert', layer: 'sample_froh',          label: '⚠ confounder' },
  { id: 'lineage',          layer: null,                   label: 'lineage' },
];

export function _isLinesColorModeAvailable(state, modeId) {
  const def = _LINES_COLOR_MODES.find(m => m.id === modeId);
  if (!def) return false;
  if (def.layer == null) return true;   // always available (kmeans, family, lineage)
  return !!(state && state.layersPresent && state.layersPresent.has(def.layer));
}

// --- detectSchemaAndLayers(data) — legacy lines 52835-53039 ---
export function detectSchemaAndLayers(data) {
  // Returns { schemaVersion, layers } where layers is a Set<string>.
  if (!data) return { schemaVersion: 0, layers: new Set() };
  const v = data.schema_version;
  if (v === 2 || v === '2' || (typeof v === 'number' && v >= 2)) {
    const arr = Array.isArray(data._layers_present) ? data._layers_present : [];
    // Defensive: even with v2, sanity-check that declared layers actually
    // have their corresponding top-level keys. Trust but verify.
    const actual = new Set();
    for (const name of arr) {
      if (typeof name !== 'string') continue;
      let ok = false;
      switch (name) {
        // Phase 1+2
        case 'windows':              ok = data.windows && data.n_windows > 0; break;
        case 'envelopes':            ok = (data.l1_envelopes && data.l1_envelopes.length > 0) ||
                                          (data.l2_envelopes && data.l2_envelopes.length > 0); break;
        case 'tracks':               ok = data.tracks && Object.keys(data.tracks).length > 0; break;
        case 'samples':              ok = data.samples && data.samples.length > 0; break;
        // Phase 3 (cluster proposals)
        case 'candidate_proposals':  ok = Array.isArray(data.candidate_proposals); break;
        // Phase 4a
        case 'cluster_labels_ghsl':  ok = !!data.cluster_labels_ghsl; break;
        case 'cusum_ghsl':           ok = !!data.cusum_ghsl; break;
        case 'ghsl_karyotype_runs':  ok = Array.isArray(data.ghsl_karyotype_runs); break;
        case 'ghsl_heatmap':         ok = !!data.ghsl_heatmap && Array.isArray(data.ghsl_heatmap.matrix); break;
        case 'ghsl_panel':           ok = !!data.ghsl_panel && Array.isArray(data.ghsl_panel.samples) && !!data.ghsl_panel.div_roll; break;
        case 'ghsl_kstripes':        ok = !!data.ghsl_kstripes && !!data.ghsl_kstripes.by_k; break;
        case 'ancestry_window':      ok = !!data.ancestry_window && Array.isArray(data.ancestry_window.start_bp); break;
        case 'ancestry_sample':      ok = !!data.ancestry_sample && Array.isArray(data.ancestry_sample.samples); break;
        case 'ancestry_q_means':     ok = !!data.ancestry_q_means && !!data.ancestry_q_means.q_means; break;
        case 'ancestry_q_global':    ok = !!data.ancestry_q_global && Array.isArray(data.ancestry_q_global.samples) && Array.isArray(data.ancestry_q_global.q); break;
        case 'ancestry_q_chrom':     ok = !!data.ancestry_q_chrom && Array.isArray(data.ancestry_q_chrom.samples) && Array.isArray(data.ancestry_q_chrom.q); break;
        case 'snp_q_support':        ok = !!data.snp_q_support && Array.isArray(data.snp_q_support.snps); break;
        case 'relatedness':          ok = !!data.relatedness && Array.isArray(data.relatedness.samples) &&
                                          Array.isArray(data.relatedness.hub_id_1st); break;
        // Phase 4b
        case 'cluster_labels_theta': ok = !!data.cluster_labels_theta; break;
        case 'cusum_theta':          ok = !!data.cusum_theta; break;
        // Phase 4c
        case 'dosage_dip':           ok = !!data.dosage_dip; break;
        // Phase 4d
        case 'concordance_tables':   ok = !!data.concordance_tables; break;
        case 'cusum_concordance':    ok = !!data.cusum_concordance; break;
        // Phase 4e
        case 'subcandidates_emitted': ok = Array.isArray(data.subcandidates_emitted); break;
        case 'candidates_registry':  ok = Array.isArray(data.candidates); break;
        // Phase 5
        case 'sv_evidence':          ok = !!data.sv_evidence; break;
        case 'bnd_rescue':           ok = !!data.bnd_rescue; break;
        case 'boundaries_refined':   ok = !!data.boundaries_refined; break;
        case 'qc_flags':             ok = !!data.qc_flags; break;
        case 'groups_validated':     ok = !!data.groups_validated; break;
        case 'classification':       ok = !!data.classification; break;
        case 'gene_cargo':           ok = !!data.gene_cargo; break;
        case 'marker_panel_summary': ok = Array.isArray(data.marker_panel_summary); break;
        case 'marker_catalogue':     ok = Array.isArray(data.marker_catalogue); break;
        case 'marker_primers':       ok = Array.isArray(data.marker_primers); break;
        case 'theta_pi_panel':       ok = !!data.theta_pi_panel && !!data.theta_pi_panel.div_roll &&
                                          Array.isArray(data.theta_pi_panel.start_bp); break;
        case 'roh_intervals':        ok = Array.isArray(data.roh_intervals); break;
        case 'sample_froh':          ok = !!data.sample_froh && (Array.isArray(data.sample_froh) ||
                                          ArrayBuffer.isView(data.sample_froh)); break;
        case 'candidate_sample_coherence': ok = Array.isArray(data.candidate_sample_coherence); break;
        case 'candidate_marker_polarity':  ok = Array.isArray(data.candidate_marker_polarity); break;
        case 'dosage_chunks':        ok = !!data.dosage_chunks && Array.isArray(data.dosage_chunks.chunks); break;
        case 'per_sample_theta_pi':  ok = !!data.per_sample_theta_pi &&
                                          (Array.isArray(data.per_sample_theta_pi.samples) ||
                                           ArrayBuffer.isView(data.per_sample_theta_pi.by_window) ||
                                           Array.isArray(data.per_sample_theta_pi.by_window)); break;
        case 'final_classification': ok = !!data.final_classification &&
                                          typeof data.final_classification === 'object' &&
                                          !Array.isArray(data.final_classification); break;
        case 'theta_pi_per_window':  ok = !!data.theta_pi_per_window &&
                                          Array.isArray(data.theta_pi_per_window.samples) &&
                                          Array.isArray(data.theta_pi_per_window.windows) &&
                                          (Array.isArray(data.theta_pi_per_window.values) ||
                                           ArrayBuffer.isView(data.theta_pi_per_window.values)); break;
        case 'theta_pi_local_pca':   ok = !!data.theta_pi_local_pca &&
                                          (Array.isArray(data.theta_pi_local_pca.z) ||
                                           ArrayBuffer.isView(data.theta_pi_local_pca.z)); break;
        case 'theta_pi_envelopes':   ok = !!data.theta_pi_envelopes &&
                                          (Array.isArray(data.theta_pi_envelopes.l1) ||
                                           Array.isArray(data.theta_pi_envelopes.l2) ||
                                           Array.isArray(data.theta_pi_envelopes.candidate_intervals)); break;
        default:                     ok = true;   // unknown layer, trust the declaration
      }
      if (ok) actual.add(name);
    }
    // Auto-detect Shape A of theta_pi_per_window (per-window-embedded `w.theta`).
    if (!actual.has('theta_pi_per_window') && data && data.windows &&
        Array.isArray(data.windows) && data.windows.length > 0 &&
        data.windows[0] && Array.isArray(data.windows[0].theta) &&
        data.windows[0].theta.length > 0) {
      actual.add('theta_pi_per_window');
    }
    // Recovery sweep: when JSON exporter forgot to declare _layers_present.
    const _RECOVERY_CHECKS = [
      ['windows',                    () => data.windows && data.n_windows > 0],
      ['envelopes',                  () => (data.l1_envelopes && data.l1_envelopes.length > 0) ||
                                            (data.l2_envelopes && data.l2_envelopes.length > 0)],
      ['tracks',                     () => data.tracks && Object.keys(data.tracks).length > 0],
      ['samples',                    () => data.samples && data.samples.length > 0],
      ['candidate_proposals',        () => Array.isArray(data.candidate_proposals)],
      ['cluster_labels_ghsl',        () => !!data.cluster_labels_ghsl],
      ['cusum_ghsl',                 () => !!data.cusum_ghsl],
      ['ghsl_karyotype_runs',        () => Array.isArray(data.ghsl_karyotype_runs)],
      ['ghsl_heatmap',               () => !!data.ghsl_heatmap && Array.isArray(data.ghsl_heatmap.matrix)],
      ['ghsl_panel',                 () => !!data.ghsl_panel && Array.isArray(data.ghsl_panel.samples) && !!data.ghsl_panel.div_roll],
      ['ghsl_kstripes',              () => !!data.ghsl_kstripes && !!data.ghsl_kstripes.by_k],
      ['ancestry_window',            () => !!data.ancestry_window && Array.isArray(data.ancestry_window.start_bp)],
      ['ancestry_sample',            () => !!data.ancestry_sample && Array.isArray(data.ancestry_sample.samples)],
      ['ancestry_q_means',           () => !!data.ancestry_q_means && !!data.ancestry_q_means.q_means],
      ['ancestry_q_global',          () => !!data.ancestry_q_global && Array.isArray(data.ancestry_q_global.samples) && Array.isArray(data.ancestry_q_global.q)],
      ['ancestry_q_chrom',           () => !!data.ancestry_q_chrom && Array.isArray(data.ancestry_q_chrom.samples) && Array.isArray(data.ancestry_q_chrom.q)],
      ['snp_q_support',              () => !!data.snp_q_support && Array.isArray(data.snp_q_support.snps)],
      ['relatedness',                () => !!data.relatedness && Array.isArray(data.relatedness.samples) && Array.isArray(data.relatedness.hub_id_1st)],
      ['cluster_labels_theta',       () => !!data.cluster_labels_theta],
      ['cusum_theta',                () => !!data.cusum_theta],
      ['dosage_dip',                 () => !!data.dosage_dip],
      ['concordance_tables',         () => !!data.concordance_tables],
      ['cusum_concordance',          () => !!data.cusum_concordance],
      ['subcandidates_emitted',      () => Array.isArray(data.subcandidates_emitted)],
      ['candidates_registry',        () => Array.isArray(data.candidates)],
      ['sv_evidence',                () => !!data.sv_evidence],
      ['bnd_rescue',                 () => !!data.bnd_rescue],
      ['boundaries_refined',         () => !!data.boundaries_refined],
      ['qc_flags',                   () => !!data.qc_flags],
      ['groups_validated',           () => !!data.groups_validated],
      ['classification',             () => !!data.classification],
      ['gene_cargo',                 () => !!data.gene_cargo],
      ['marker_panel_summary',       () => Array.isArray(data.marker_panel_summary)],
      ['marker_catalogue',           () => Array.isArray(data.marker_catalogue)],
      ['marker_primers',             () => Array.isArray(data.marker_primers)],
      ['theta_pi_panel',             () => !!data.theta_pi_panel && !!data.theta_pi_panel.div_roll && Array.isArray(data.theta_pi_panel.start_bp)],
      ['roh_intervals',              () => Array.isArray(data.roh_intervals)],
      ['sample_froh',                () => !!data.sample_froh && (Array.isArray(data.sample_froh) || ArrayBuffer.isView(data.sample_froh))],
      ['candidate_sample_coherence', () => Array.isArray(data.candidate_sample_coherence)],
      ['candidate_marker_polarity',  () => Array.isArray(data.candidate_marker_polarity)],
      ['dosage_chunks',              () => !!data.dosage_chunks && Array.isArray(data.dosage_chunks.chunks)],
      ['per_sample_theta_pi',        () => !!data.per_sample_theta_pi &&
                                            (Array.isArray(data.per_sample_theta_pi.samples) ||
                                             ArrayBuffer.isView(data.per_sample_theta_pi.by_window) ||
                                             Array.isArray(data.per_sample_theta_pi.by_window))],
      ['final_classification',       () => !!data.final_classification && typeof data.final_classification === 'object' && !Array.isArray(data.final_classification)],
      ['theta_pi_local_pca',         () => !!data.theta_pi_local_pca &&
                                            (Array.isArray(data.theta_pi_local_pca.z) || ArrayBuffer.isView(data.theta_pi_local_pca.z))],
      ['theta_pi_envelopes',         () => !!data.theta_pi_envelopes &&
                                            (Array.isArray(data.theta_pi_envelopes.l1) ||
                                             Array.isArray(data.theta_pi_envelopes.l2) ||
                                             Array.isArray(data.theta_pi_envelopes.candidate_intervals))],
    ];
    for (const [name, check] of _RECOVERY_CHECKS) {
      if (actual.has(name)) continue;
      try {
        if (check()) actual.add(name);
      } catch (_) {}
    }
    return { schemaVersion: 2, layers: actual };
  }
  // v1 / legacy
  return { schemaVersion: 1, layers: new Set(inferLayersFromV1(data)) };
}

// --- listLayers(state) — legacy lines 54175-54177 ---
export function listLayers(state) {
  return state && state.layersPresent ? Array.from(state.layersPresent).sort() : [];
}

// --- availablePCs(state) — legacy lines 9980-9991 ---
export function availablePCs(state) {
  if (!state || !state.data || !state.data.windows || state.data.windows.length === 0) return ['pc1', 'pc2'];
  const w0 = state.data.windows[0];
  const out = [];
  for (const k of ['pc1', 'pc2', 'pc3', 'pc4']) {
    if (Array.isArray(w0[k]) && w0[k].length > 0) out.push(k);
  }
  if (out.length === 0) return ['pc1', 'pc2'];
  if (out.length === 1 && out[0] === 'pc1') return ['pc1', 'pc2'];
  return out;
}

// --- getPCByAxis(state, winIdx, axis) — legacy lines 9993-9998 ---
function getPCByAxis(state, winIdx, axis) {
  const w = state && state.data && state.data.windows && state.data.windows[winIdx];
  if (!w) return null;
  const v = w[axis];
  return Array.isArray(v) ? v : null;
}

// --- getPCRender(state, winIdx, axisX, axisY) — legacy lines 10000-10007 ---
// Replaces the round-2 stub. PC1 has the sign-flip rule; other axes
// use raw orientation. The call sites destructure { x, y, signX, signY }.
export function getPCRender(state, winIdx, axisX, axisY) {
  const x = getPCByAxis(state, winIdx, axisX || 'pc1');
  const y = getPCByAxis(state, winIdx, axisY || 'pc2');
  const signX = (axisX === 'pc1' && state && state.flipPC1 && state.pc1Sign) ? state.pc1Sign[winIdx] : 1;
  const signY = (axisY === 'pc1' && state && state.flipPC1 && state.pc1Sign) ? state.pc1Sign[winIdx] : 1;
  return { x, y, signX, signY, axisX, axisY };
}

// --- getPC(state, winIdx) — legacy lines 9951-9955 ---
// When the precomp is slim (data.has_pc2 === false), w.pc2 is missing and
// any PCA scatter would collapse to a single column. We synthesize a small
// jittered PC2 per window so the scatter still spreads visually. This
// matches the legacy "PC2: jittered (slim precomp — no per-sample PC2)"
// note shown in the data status block.
export function getPC(state, winIdx) {
  const w = state && state.data && state.data.windows && state.data.windows[winIdx];
  if (!w) return null;
  const s = state.flipPC1 && state.pc1Sign ? state.pc1Sign[winIdx] : 1;
  let pc2 = w.pc2;
  if (!pc2 && state.data && state.data.has_pc2 === false && Array.isArray(w.pc1)) {
    // Lazily cache jittered PC2 on the window object so we don't regenerate
    // on every getPC call. Seed is winIdx so the jitter is reproducible.
    if (!w._pc2Jitter) {
      const n = w.pc1.length;
      const jit = new Float32Array(n);
      // Deterministic LCG seeded by winIdx so we get the same jitter each call.
      let seed = (winIdx * 2654435761) >>> 0;
      for (let i = 0; i < n; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        // Box-Muller-lite via two uniforms is overkill; uniform [-0.02, 0.02]
        // is enough to spread points visually without faking biological signal.
        jit[i] = (seed / 0xFFFFFFFF - 0.5) * 0.04;
      }
      w._pc2Jitter = jit;
    }
    pc2 = w._pc2Jitter;
  }
  return { pc1: w.pc1, pc2, sign: s };
}

// --- buildIndexes(state) — legacy lines 9881-9927 ---
export function buildIndexes(state) {
  const d = state && state.data;
  if (!d) return;
  const N = d.n_windows;
  state.windowToL1 = new Int32Array(N).fill(-1);
  state.windowToL2 = new Int32Array(N).fill(-1);
  if (Array.isArray(d.l1_envelopes)) {
    d.l1_envelopes.forEach((e, i) => {
      const s0 = e.start_w - 1, e0 = e.end_w - 1;
      e._s0 = s0; e._e0 = e0;
      for (let w = Math.max(0, s0); w <= Math.min(N - 1, e0); w++) {
        state.windowToL1[w] = i;
      }
    });
  }
  if (Array.isArray(d.l2_envelopes)) {
    d.l2_envelopes.forEach((e, i) => {
      const s0 = e.start_w - 1, e0 = e.end_w - 1;
      e._s0 = s0; e._e0 = e0;
      for (let w = Math.max(0, s0); w <= Math.min(N - 1, e0); w++) {
        state.windowToL2[w] = i;
      }
    });
  }
  // L2 adjacency: within each parent_l1_id, sort by start_w and link.
  state.l2NeighborsInL1 = new Map();
  if (Array.isArray(d.l2_envelopes)) {
    const byParent = new Map();
    d.l2_envelopes.forEach((e, i) => {
      const k = e.parent_l1_id || '__none__';
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k).push({ idx: i, start_w: e.start_w });
    });
    for (const [, arr] of byParent) {
      arr.sort((a, b) => a.start_w - b.start_w);
      for (let j = 0; j < arr.length; j++) {
        state.l2NeighborsInL1.set(arr[j].idx, {
          left:  j > 0             ? arr[j - 1].idx : null,
          right: j < arr.length - 1 ? arr[j + 1].idx : null,
        });
      }
    }
  }
}

// --- computePC1Signs(state) — legacy lines 9932-9950 ---
export function computePC1Signs(state) {
  if (!state || !state.data) return;
  const wins = state.data.windows;
  const n = wins.length;
  const signs = new Float32Array(n);
  signs[0] = 1;
  let prev = wins[0].pc1;
  for (let i = 1; i < n; i++) {
    const cur = wins[i].pc1;
    let dot = 0, mp = 0, mc = 0;
    for (let j = 0; j < cur.length; j++) {
      dot += prev[j] * cur[j]; mp += prev[j] * prev[j]; mc += cur[j] * cur[j];
    }
    const cor = dot / Math.sqrt(mp * mc + 1e-9);
    signs[i] = (cor >= 0 ? 1 : -1) * signs[i - 1];
    prev = cur;
  }
  state.pc1Sign = signs;
}

// --- populateSimScales(state) — legacy lines 52472-52530 ---
export function populateSimScales(state) {
  const sel = document.getElementById('simScaleSelect');
  if (!sel) return;
  sel.innerHTML = '';
  const d = state && state.data;
  if (!d) return;
  if (d.sim_scales && Object.keys(d.sim_scales).length > 0) {
    const labels = Object.keys(d.sim_scales);
    // Default to nn320 (discovery-friendly: only structural blocks survive
    // at this smoothing level). Fallback chain:
    //   nn320 → nn160 → nn80 → nn40 → nn20 → highest-N → default → first
    let def = null;
    const PREF = ['nn320', 'nn160', 'nn80', 'nn40', 'nn20'];
    for (const p of PREF) {
      if (d.sim_scales[p]) { def = p; break; }
    }
    if (def == null) {
      let bestN = -1;
      for (const lab of labels) {
        const sc = d.sim_scales[lab];
        const n = (sc && Number.isFinite(sc.n)) ? sc.n : 0;
        if (n > bestN) { bestN = n; def = lab; }
      }
    }
    if (def == null) {
      def = (d.default_sim_scale && d.sim_scales[d.default_sim_scale])
          ? d.default_sim_scale : labels[0];
    }
    state.simScale = def;
    for (const lab of labels) {
      const opt = document.createElement('option');
      opt.value = lab;
      const sc = d.sim_scales[lab];
      const n = (sc && Number.isFinite(sc.n)) ? sc.n : null;
      opt.textContent = n ? `${lab} (${n}×${n})` : lab;
      if (lab === def) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.disabled = false;
  } else if (d.sim_thumb) {
    const opt = document.createElement('option');
    opt.value = '__legacy__'; opt.textContent = '(legacy single scale)';
    opt.selected = true;
    sel.appendChild(opt);
    sel.disabled = true;
  } else {
    const opt = document.createElement('option');
    opt.value = ''; opt.textContent = '(no sim_mat embedded)';
    sel.appendChild(opt);
    sel.disabled = true;
  }
}

// --- buildFamilyPalette(state) — legacy lines 36273-36301 ---
export function buildFamilyPalette(state) {
  state.familyPalette = {};
  state.hubFamilies = [];
  state.smallFamilyIds = new Set();
  state.singletonFamilyIds = new Set();
  if (!state.data || !state.data.samples) return;
  // Count distinct samples per family
  const counts = new Map();
  for (const s of state.data.samples) {
    const f = (s.family_id == null) ? -1 : s.family_id;
    counts.set(f, (counts.get(f) || 0) + 1);
  }
  // Hubs in descending size, excluding -1
  const sorted = Array.from(counts.entries())
    .filter(([f]) => f !== -1)
    .sort((a, b) => b[1] - a[1]);
  let palIdx = 0;
  for (const [f, n] of sorted) {
    if (n >= 4) {
      state.familyPalette[f] = FAMILY_PALETTE_BASE[palIdx % FAMILY_PALETTE_BASE.length];
      state.hubFamilies.push(f);
      palIdx++;
    } else if (n >= 2) {
      state.smallFamilyIds.add(f);
    } else {
      state.singletonFamilyIds.add(f);
    }
  }
}

// --- loadViewControls(state) — legacy lines 10020-10038 ---
export function loadViewControls(state) {
  if (!state.viewControls) state.viewControls = { pcaXY: ['pc1', 'pc2'], linesYsources: ['pc1'], linked: true };
  try {
    const raw = localStorage.getItem(VIEW_CONTROLS_STORAGE_KEY);
    if (!raw) return;
    const v = JSON.parse(raw);
    if (Array.isArray(v.pcaXY) && v.pcaXY.length === 2 &&
        typeof v.pcaXY[0] === 'string' && typeof v.pcaXY[1] === 'string' &&
        v.pcaXY[0] !== v.pcaXY[1]) {
      state.viewControls.pcaXY = v.pcaXY.slice();
    }
    if (Array.isArray(v.linesYsources) && v.linesYsources.length >= 1 &&
        v.linesYsources.every(s => typeof s === 'string')) {
      state.viewControls.linesYsources = v.linesYsources.slice();
    }
    if (typeof v.linked === 'boolean') state.viewControls.linked = v.linked;
  } catch (e) {
    console.warn('[scrubber] could not load viewControls:', e);
  }
}

// --- saveViewControls(state) — legacy lines 10011-10018 ---
function saveViewControls(state) {
  if (!state || !state.viewControls) return;
  try {
    localStorage.setItem(VIEW_CONTROLS_STORAGE_KEY, JSON.stringify(state.viewControls));
  } catch (e) {
    console.warn('[scrubber] could not persist viewControls:', e);
  }
}

// --- setPcaXY(state, axisX, axisY) — legacy lines 10062-10069 ---
export function setPcaXY(state, axisX, axisY) {
  if (axisX === axisY) return;
  state.viewControls.pcaXY = [axisX, axisY];
  if (state.viewControls.linked) {
    state.viewControls.linesYsources = [axisX, axisY];
  }
  saveViewControls(state);
}

// --- setViewControlsLinked(state, b) — legacy lines 10082-10085 ---
export function setViewControlsLinked(state, b) {
  state.viewControls.linked = !!b;
  saveViewControls(state);
}

// --- reconcileViewControlsForData(state) — legacy lines 10043-10059 ---
export function reconcileViewControlsForData(state) {
  if (!state.viewControls) state.viewControls = { pcaXY: ['pc1', 'pc2'], linesYsources: ['pc1'], linked: true };
  const avail = availablePCs(state);
  const isPCAxis = (s) => /^pc[1-4]$/.test(s);
  const cur = state.viewControls.pcaXY;
  const xOK = avail.includes(cur[0]);
  const yOK = avail.includes(cur[1]);
  if (!xOK || !yOK || cur[0] === cur[1]) {
    state.viewControls.pcaXY = ['pc1', avail.includes('pc2') ? 'pc2' : avail[1] || 'pc2'];
  }
  // Lines sources: drop any PC sources not available; keep non-PC sources
  state.viewControls.linesYsources = state.viewControls.linesYsources.filter(s => {
    if (isPCAxis(s)) return avail.includes(s);
    return true;
  });
  if (state.viewControls.linesYsources.length === 0) state.viewControls.linesYsources = ['pc1'];
}

// --- getL2Cluster(state, l2idx) — legacy lines 10673-10679 ---
// Adapted to use shared/per_l2_cluster.js's ClusterCache + contextFromState.
// Legacy used a global `state.l2GroupCache` Map and a parameterless
// `clusterL2(l2idx)`; the shared module's `clusterL2(ctx, l2idx)` takes
// an explicit context, and `ClusterCache.getOrCompute(ctx, l2idx)` handles
// the cache + ctx-based invalidation rule.
export function getL2Cluster(state, l2idx) {
  if (!state || !state.data) return null;
  if (!state._l2ClusterCache) state._l2ClusterCache = new ClusterCache();
  const ctx = contextFromState(state);
  return state._l2ClusterCache.getOrCompute(ctx, l2idx);
}

// --- getL2ClusterAt(state, l2idx, K) — legacy lines 10770-10784 ---
// Per-K cluster cache (used by L3 panel when l3KMode is 'k6' or 'both').
// Cache identity: data chrom + n_windows; per-K key is `${l2idx}_${K}`.
export function getL2ClusterAt(state, l2idx, K) {
  if (!state || !state.data) return null;
  if (!state.l2GroupCacheAtK) state.l2GroupCacheAtK = new Map();
  const dataKey = state.data.chrom + '|' + state.data.n_windows;
  if (state._l2GroupCacheAtKDataKey !== dataKey) {
    state.l2GroupCacheAtK = new Map();
    state._l2GroupCacheAtKDataKey = dataKey;
  }
  const k = `${l2idx}_${K}`;
  if (state.l2GroupCacheAtK.has(k)) return state.l2GroupCacheAtK.get(k);
  const ctx = contextFromState(state);
  const r = clusterL2AtK(ctx, l2idx, K);
  state.l2GroupCacheAtK.set(k, r);
  return r;
}

// --- getLinesValuesAt(state, winIdx, source) — legacy lines 33626-33655 ---
export function getLinesValuesAt(state, winIdx, source) {
  if (!state || !state.data) return null;
  // PC sources (precomp grid)
  if (/^pc[1-4]$/.test(source)) {
    return getPCByAxis(state, winIdx, source);
  }
  // GHSL panel sources (panel grid)
  const panel = state.data.ghsl_panel;
  if (!panel || !panel.div_roll) return null;
  let scaleKey = null;
  if (source === 'het') {
    scaleKey = panel.primary_scale || (panel.scales && panel.scales[0]);
  } else if (/^ghsl_div_s\d+$/.test(source)) {
    scaleKey = source.replace(/^ghsl_div_/, '');   // 'ghsl_div_s50' -> 's50'
  } else {
    return null;
  }
  if (!scaleKey || !panel.div_roll[scaleKey]) return null;
  const M = panel.div_roll[scaleKey];
  if (!M.length) return null;
  const nCols = (M[0] && M[0].length) || 0;
  if (winIdx < 0 || winIdx >= nCols) return null;
  // Build the sample-vector at this panel column
  const out = new Array(M.length);
  for (let s = 0; s < M.length; s++) out[s] = M[s][winIdx];
  return out;
}

// --- getLinesGrid(state, source) — legacy lines 33660-33671 ---
export function getLinesGrid(state, source) {
  if (!state || !state.data) return null;
  if (/^pc[1-4]$/.test(source)) return null;   // precomp grid — caller handles
  const panel = state.data.ghsl_panel;
  if (!panel) return null;
  if (source !== 'het' && !/^ghsl_div_s\d+$/.test(source)) return null;
  if (!Array.isArray(panel.start_bp) || !Array.isArray(panel.end_bp)) return null;
  const N = panel.start_bp.length;
  const out = new Array(N);
  for (let i = 0; i < N; i++) out[i] = (panel.start_bp[i] + panel.end_bp[i]) / 2;
  return out;
}

// --- getLinesSignAt(state, winIdx, source) — legacy lines 33674-33677 ---
export function getLinesSignAt(state, winIdx, source) {
  if (source === 'pc1' && state && state.flipPC1 && state.pc1Sign) return state.pc1Sign[winIdx];
  return 1;
}

// --- allSampleIdx(state) — legacy lines 47867-47874 ---
export function allSampleIdx(state) {
  if (!state || !state.data) return [];
  if (!state._sampleIdxCache || state._sampleIdxCache.length !== state.data.n_samples) {
    const a = new Array(state.data.n_samples);
    for (let i = 0; i < a.length; i++) a[i] = i;
    state._sampleIdxCache = a;
  }
  return state._sampleIdxCache;
}

// --- sampleSpreadL2(state, l2idx) — legacy lines 10294-10301 ---
// Per-sample σ of sign-aligned PC1 across an L2's windows. Low = stable;
// high = sample drifts across bands. The "spread score" for tracked samples.
//
// Hoisted in chat 36 round 5 step 2 (was a legacy global). Body refactored
// from bare `state.data` and `getPC(idx)` to take state as first arg
// (calls getPC(state, idx) which is the hoisted helper above). Behaviour
// is byte-equivalent.
export function sampleSpreadL2(state, l2idx) {
  const d = state.data;
  const env = d.l2_envelopes[l2idx];
  if (!env) return null;
  return sampleSpreadRange(state, env._s0, env._e0);
}

// --- sampleSpreadRange(state, s, e) — legacy lines 10304-10327 ---
// Per-sample σ of sign-aligned PC1 across an arbitrary [s, e] window range
// (both inclusive, 0-based). Used by sampleSpreadL2 and by candidate page 2
// (computes σ across the candidate's full span, possibly multiple L2s).
//
// Hoisted in chat 36 round 5 step 2. Same byte-equivalence note as above.
export function sampleSpreadRange(state, s, e) {
  const d = state.data;
  if (!d) return null;
  const nW = e - s + 1;
  const nS = d.n_samples;
  if (nW < 2) return null;
  const mean = new Float64Array(nS);
  const sumSq = new Float64Array(nS);
  for (let w = 0; w < nW; w++) {
    const { pc1, sign } = getPC(state, s + w);
    for (let si = 0; si < nS; si++) mean[si] += pc1[si] * sign;
  }
  for (let si = 0; si < nS; si++) mean[si] /= nW;
  for (let w = 0; w < nW; w++) {
    const { pc1, sign } = getPC(state, s + w);
    for (let si = 0; si < nS; si++) {
      const v = pc1[si] * sign - mean[si];
      sumSq[si] += v * v;
    }
  }
  const sd = new Float64Array(nS);
  for (let si = 0; si < nS; si++) sd[si] = Math.sqrt(sumSq[si] / (nW - 1));
  return sd;
}

// ---------------------------------------------------------------------------
// Pure formatting / color helpers (chat 36 round 5 step 2 hoist)
// ---------------------------------------------------------------------------
// These were legacy globals used by both local_pca_dosage and candidate_focus. They take no
// state; they're pure functions. Hoisted here rather than to a separate
// `shared/format_helpers.js` because they're tightly coupled to the
// local_pca_dosage/candidate_focus rendering call graph and live alongside everything else
// local_pca_dosage uses.

// --- _esc — legacy line 13925 ---
// HTML escape. Used by every Html-builder for user-supplied / data-bound
// strings.
export function _esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- _fmt4 — legacy line 60402 ---
// Numeric format with 4 decimal digits. 'na' for missing/non-finite.
export function _fmt4(x) {
  return (x == null || !Number.isFinite(x)) ? 'na' : Number(x).toFixed(4);
}

// --- _fmtP — legacy line 60395 ---
// p-value formatter with adaptive precision. Uses scientific notation
// below 1e-3, 4 digits below 1e-2, 3 digits otherwise. Floor at 2.2e-16.
export function _fmtP(p) {
  if (p == null || !Number.isFinite(p)) return 'na';
  if (p <= 1e-16) return '<2.2\u00d710\u207b\u00b9\u2076';
  if (p < 0.001)  return p.toExponential(2).replace('e', '\u00d710').replace('+', '');
  if (p < 0.01)   return p.toFixed(4);
  return p.toFixed(3);
}

// --- groupColor — legacy line 50895 ---
// K-means cluster color palette. Used by local_pca_dosage's pca/lines panels and
// candidate_focus's drawCand* functions.
export function groupColor(k) {
  return ['#4fa3ff','#b8b8b8','#f5a524','#3cc08a','#e0555c','#b07cf7'][k] || '#666';
}
