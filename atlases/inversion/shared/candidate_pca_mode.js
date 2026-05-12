// shared/candidate_pca_mode.js
//
// HANDOFF 2 — Page-1 candidate PCA mode: state slot + transitions +
// JSON-key composition + manifest loader.
//
// Candidate mode is a page1 sub-mode where the cursor traverses
// windows inside ONE candidate interval and the user can switch
// between pre-computed PCA + heatmap JSONs via dropdowns (view ×
// weighting × anchor_mode for PCA, view × centering for heatmap).
//
// State lives at state.candidatePCAMode (NOT state.candidateMode —
// the latter is the legacy L3-draft editor flag, kept distinct so
// the two coexist without collision).
//
// Pre-computed JSONs (HANDOFF 1 producer):
//   - 16 PCA JSONs per candidate (4 views × 2 weighting × 2 anchor)
//   - 4 heatmap JSONs per candidate (4 views, no weight/anchor)
//   - Optional genotype-state JSONs for tri+ sites
//
// This module ships the cartridge-side state machinery. The actual
// drawHeatmap / controls-bar wiring lives elsewhere (page1/
// candidate_pca_*.js when those land).
//
// All entry points take state as their first arg. headless-safe:
// URL parsing is string-only (no `location` reads), manifest fetch
// is injected via an atlasServer-shaped client.

// =====================================================================
// Constants
// =====================================================================

/** Four canonical views from HANDOFF 1's producer matrix. */
export const CANDIDATE_PCA_VIEWS = Object.freeze([
  'bi_baseline', 'tri_extras', 'quad_extras', 'all_pairs',
]);

/** Two anchor modes for shared-basis comparison (SPEC §7). */
export const CANDIDATE_PCA_ANCHOR_MODES = Object.freeze([
  'bi_baseline', 'view_self', 'none',
]);

/** Centering anchors for the heatmap (SPEC §10). */
export const CANDIDATE_PCA_CENTERINGS = Object.freeze([
  'all', 'het', 'hom1', 'hom2', 'custom',
]);

/** Polarity references — how PC1 sign is resolved. */
export const CANDIDATE_PCA_POLARITIES = Object.freeze([
  'pc1_correlation', 'band_membership', 'none',
]);

/** Row-order modes for the heatmap sample axis. */
export const CANDIDATE_PCA_ROW_ORDERS = Object.freeze([
  'pc1_anchor', 'pc1_view', 'cluster', 'manual',
  'mean_dosage', 'median_dosage',
]);

/** Column-order modes for the heatmap marker axis. */
export const CANDIDATE_PCA_COL_ORDERS = Object.freeze([
  'genomic', 'pc1_loading', 'pc2_loading', 'clustering',
]);

/** Sample-color modes shared between PCA and heatmap. */
export const CANDIDATE_PCA_SAMPLE_COLOR_MODES = Object.freeze([
  'cluster', 'mean_dosage_window', 'median_dosage_window',
  'pc1_score', 'pc2_score', 'tracked_group',
]);

/** Heatmap display modes for dosage rendering. */
export const CANDIDATE_PCA_DISPLAY_MODES = Object.freeze([
  'dosage_centered', 'dosage_zscored', 'dosage_raw', 'genotype_state',
]);

/** Default field values for activation. */
export const CANDIDATE_PCA_DEFAULTS = Object.freeze({
  view_name:         'all_pairs',
  weighted:          true,
  anchor_mode:       'bi_baseline',
  centering:         'all',
  polarity_ref:      'pc1_correlation',
  row_order:         'pc1_anchor',
  col_order:         'genomic',
  sample_color_mode: 'cluster',
  display_mode:      'dosage_centered',
});

/** Single source of truth for "is this field validated against an enum?". */
const _FIELD_ENUMS = Object.freeze({
  view_name:         CANDIDATE_PCA_VIEWS,
  anchor_mode:       CANDIDATE_PCA_ANCHOR_MODES,
  centering:         CANDIDATE_PCA_CENTERINGS,
  polarity_ref:      CANDIDATE_PCA_POLARITIES,
  row_order:         CANDIDATE_PCA_ROW_ORDERS,
  col_order:         CANDIDATE_PCA_COL_ORDERS,
  sample_color_mode: CANDIDATE_PCA_SAMPLE_COLOR_MODES,
  display_mode:      CANDIDATE_PCA_DISPLAY_MODES,
});

// =====================================================================
// State lifecycle
// =====================================================================

/**
 * Ensure state.candidatePCAMode exists with the canonical shape.
 * Idempotent. Does NOT auto-activate — activation requires a
 * candidate_id + interval and goes through activateCandidatePCAMode.
 *
 * @param {Object} state
 * @returns {Object|null}  the state.candidatePCAMode slot
 */
export function ensureCandidatePCAMode(state) {
  if (!state) return null;
  if (!state.candidatePCAMode || typeof state.candidatePCAMode !== 'object') {
    state.candidatePCAMode = {
      active: false,
      candidate_id: null,
      interval: null,
      ...CANDIDATE_PCA_DEFAULTS,
      loaded_pca: {},
      loaded_heatmap: {},
      manual_order: null,
    };
  }
  return state.candidatePCAMode;
}

/**
 * Activate candidate PCA mode for `candidate_id` over `interval`.
 * Resets loaded_pca / loaded_heatmap caches. Other fields fall back
 * to CANDIDATE_PCA_DEFAULTS unless `overrides` is provided.
 *
 * @param {Object} state
 * @param {{candidate_id:string, interval:{chrom:string,start:number,end:number}, overrides?:Object}} args
 * @returns {boolean}  true on success; false on missing args
 */
export function activateCandidatePCAMode(state, args) {
  if (!state || !args || !args.candidate_id || !args.interval) return false;
  const i = args.interval;
  if (typeof i.chrom !== 'string' || !i.chrom
      || !Number.isFinite(i.start) || !Number.isFinite(i.end)
      || i.end < i.start) return false;
  const m = ensureCandidatePCAMode(state);
  Object.assign(m, CANDIDATE_PCA_DEFAULTS);
  if (args.overrides && typeof args.overrides === 'object') {
    for (const [k, v] of Object.entries(args.overrides)) {
      if (k in CANDIDATE_PCA_DEFAULTS) m[k] = v;
    }
  }
  m.active = true;
  m.candidate_id = args.candidate_id;
  m.interval = { chrom: i.chrom, start: i.start, end: i.end };
  m.loaded_pca = {};
  m.loaded_heatmap = {};
  m.manual_order = null;
  return true;
}

/**
 * Deactivate candidate mode. Clears caches + interval but leaves the
 * slot in place so existing references stay valid.
 */
export function deactivateCandidatePCAMode(state) {
  if (!state || !state.candidatePCAMode) return;
  const m = state.candidatePCAMode;
  m.active = false;
  m.candidate_id = null;
  m.interval = null;
  m.loaded_pca = {};
  m.loaded_heatmap = {};
  m.manual_order = null;
}

/**
 * Set a single candidate-mode field, with enum validation.
 *   - String-enum fields: rejected when value isn't in the enum.
 *   - 'weighted': must be a boolean.
 *   - All other writes are rejected (callers must go through this
 *     setter to avoid bypassing validation).
 *
 * @param {Object} state
 * @param {string} field
 * @param {*}      value
 * @returns {boolean}  true on success
 */
export function setCandidatePCAField(state, field, value) {
  if (!state) return false;
  const m = ensureCandidatePCAMode(state);
  if (!m) return false;
  if (field === 'weighted') {
    if (typeof value !== 'boolean') return false;
    m.weighted = value;
    return true;
  }
  const enumVals = _FIELD_ENUMS[field];
  if (!enumVals) return false;
  if (!enumVals.includes(value)) return false;
  m[field] = value;
  return true;
}

// =====================================================================
// JSON key composition (SPEC §8-9)
// =====================================================================

/**
 * Compose the PCA JSON cache key:
 *   `${view_name}_${weighted ? 'weighted' : 'unweighted'}_${anchor_mode}`
 * Examples:
 *   bi_baseline_unweighted_bi_baseline
 *   all_pairs_weighted_view_self
 *
 * @param {{view_name:string, weighted:boolean, anchor_mode:string}} fields
 * @returns {string|null}  null when any field is missing
 */
export function pcaJSONKey({ view_name, weighted, anchor_mode } = {}) {
  if (!view_name || typeof weighted !== 'boolean' || !anchor_mode) return null;
  return `${view_name}_${weighted ? 'weighted' : 'unweighted'}_${anchor_mode}`;
}

/**
 * Compose the heatmap JSON cache key:
 *   `${view_name}_${centering}`
 * The heatmap has no weighting / anchor — those only affect PCA scores.
 *
 * @param {{view_name:string, centering:string}} fields
 * @returns {string|null}
 */
export function heatmapJSONKey({ view_name, centering } = {}) {
  if (!view_name || !centering) return null;
  return `${view_name}_${centering}`;
}

/**
 * Build the PCA key for the current state.candidatePCAMode fields.
 * Returns null when the mode isn't active.
 */
export function currentPCAKey(state) {
  const m = state && state.candidatePCAMode;
  if (!m || !m.active) return null;
  return pcaJSONKey(m);
}

/** Build the heatmap key for the current state.candidatePCAMode. */
export function currentHeatmapKey(state) {
  const m = state && state.candidatePCAMode;
  if (!m || !m.active) return null;
  return heatmapJSONKey(m);
}

// =====================================================================
// JSON cache accessors
// =====================================================================

export function getLoadedPCA(state, key) {
  const m = state && state.candidatePCAMode;
  if (!m || !key) return null;
  return m.loaded_pca[key] || null;
}

export function getLoadedHeatmap(state, key) {
  const m = state && state.candidatePCAMode;
  if (!m || !key) return null;
  return m.loaded_heatmap[key] || null;
}

export function stashLoadedPCA(state, key, json) {
  const m = ensureCandidatePCAMode(state);
  if (!m || !key) return false;
  m.loaded_pca[key] = json;
  return true;
}

export function stashLoadedHeatmap(state, key, json) {
  const m = ensureCandidatePCAMode(state);
  if (!m || !key) return false;
  m.loaded_heatmap[key] = json;
  return true;
}

// =====================================================================
// URL param parsing
// =====================================================================

/**
 * Parse a `?candidate=<chrom>_<start_mb>_<end_mb>` URL param into
 * { candidate_id, interval }. Returns null when the param is missing
 * or malformed.
 *
 *   parseCandidateURLParam('?candidate=LG28_15.115_18.005')
 *   → { candidate_id: 'LG28_15.115_18.005',
 *       interval: { chrom: 'LG28', start: 15.115, end: 18.005 } }
 *
 * Numbers are parsed as Mb (consistent with how the atlas displays
 * positions); the consumer can multiply by 1e6 for bp.
 *
 * @param {string} search   `location.search`-shaped string
 * @returns {{candidate_id:string, interval:{chrom:string,start:number,end:number}}|null}
 */
export function parseCandidateURLParam(search) {
  if (typeof search !== 'string' || !search) return null;
  const qs = search.startsWith('?') ? search.slice(1) : search;
  for (const part of qs.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = decodeURIComponent(part.slice(0, eq));
    if (k !== 'candidate') continue;
    const v = decodeURIComponent(part.slice(eq + 1));
    if (!v) return null;
    // Split into chrom + start_mb + end_mb. Chrom can contain underscores
    // (e.g. C_gar_LG28), so we split from the RIGHT.
    const lastUnderscore = v.lastIndexOf('_');
    if (lastUnderscore <= 0) return null;
    const secondLastUnderscore = v.lastIndexOf('_', lastUnderscore - 1);
    if (secondLastUnderscore <= 0) return null;
    const chrom = v.slice(0, secondLastUnderscore);
    const startStr = v.slice(secondLastUnderscore + 1, lastUnderscore);
    const endStr = v.slice(lastUnderscore + 1);
    const start = Number(startStr);
    const end = Number(endStr);
    if (!chrom || !Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (end < start) return null;
    return {
      candidate_id: v,
      interval: { chrom, start, end },
    };
  }
  return null;
}

// =====================================================================
// Manifest loader
// =====================================================================

/**
 * Load the candidate manifest via the supplied atlasServer-shaped
 * client. Manifest path:
 *   /file/candidates/<candidate_id>/manifest.json
 *
 * Returns:
 *   { ok: true,  manifest: <parsed JSON> }   on success
 *   { ok: false, error: <message>, status }  on failure
 *
 * Does NOT mutate state. Callers stash the manifest where they need
 * it (typically state.candidatePCAMode._manifest for later lookups).
 *
 * @param {{read: (path: string, opts?: Object) => Promise<{ok:boolean, status:number, json?:Object, error?:string}>}} atlasServer
 * @param {string} candidate_id
 * @returns {Promise<{ok:boolean, manifest?:Object, error?:string, status?:number}>}
 */
export async function loadCandidateManifest(atlasServer, candidate_id) {
  if (!atlasServer || typeof atlasServer.read !== 'function') {
    return { ok: false, error: 'no atlasServer client', status: 0 };
  }
  if (!candidate_id) return { ok: false, error: 'no candidate_id', status: 0 };
  const path = `candidates/${candidate_id}/manifest.json`;
  const r = await atlasServer.read(path, { as: 'json' });
  if (!r || !r.ok) return { ok: false, error: r && r.error, status: r && r.status };
  if (!r.json) return { ok: false, error: 'manifest is empty', status: r.status };
  return { ok: true, manifest: r.json };
}

/**
 * Load a single PCA JSON via the supplied client + stash it in the
 * cache. The cache key uses the fields passed in (NOT the current
 * state.candidatePCAMode — caller controls which combination to fetch).
 *
 * Path: candidates/<candidate_id>/pca/<key>.json
 *
 * @returns {Promise<{ok:boolean, key?:string, error?:string, status?:number}>}
 */
export async function loadCandidatePCAJSON(state, atlasServer, fields) {
  const key = pcaJSONKey(fields);
  if (!key) return { ok: false, error: 'invalid fields' };
  const m = state && state.candidatePCAMode;
  if (!m || !m.active || !m.candidate_id) return { ok: false, error: 'mode inactive' };
  if (m.loaded_pca[key]) return { ok: true, key, cached: true };
  if (!atlasServer || typeof atlasServer.read !== 'function') {
    return { ok: false, error: 'no atlasServer client' };
  }
  const path = `candidates/${m.candidate_id}/pca/${key}.json`;
  const r = await atlasServer.read(path, { as: 'json' });
  if (!r || !r.ok || !r.json) {
    return { ok: false, key, error: r && r.error, status: r && r.status };
  }
  m.loaded_pca[key] = r.json;
  return { ok: true, key };
}

/**
 * Load a single heatmap JSON. Same shape as loadCandidatePCAJSON but
 * for state.candidatePCAMode.loaded_heatmap.
 *
 * Path: candidates/<candidate_id>/heatmap/<key>.json
 */
export async function loadCandidateHeatmapJSON(state, atlasServer, fields) {
  const key = heatmapJSONKey(fields);
  if (!key) return { ok: false, error: 'invalid fields' };
  const m = state && state.candidatePCAMode;
  if (!m || !m.active || !m.candidate_id) return { ok: false, error: 'mode inactive' };
  if (m.loaded_heatmap[key]) return { ok: true, key, cached: true };
  if (!atlasServer || typeof atlasServer.read !== 'function') {
    return { ok: false, error: 'no atlasServer client' };
  }
  const path = `candidates/${m.candidate_id}/heatmap/${key}.json`;
  const r = await atlasServer.read(path, { as: 'json' });
  if (!r || !r.ok || !r.json) {
    return { ok: false, key, error: r && r.error, status: r && r.status };
  }
  m.loaded_heatmap[key] = r.json;
  return { ok: true, key };
}
