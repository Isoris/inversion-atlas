// shared/atlas_export.js
//
// Atlas candidate export bundle (legacy lines 61035 + 61364-61435).
// Builds the canonical JSON envelope that downstream phase-7 readers
// consume — provenance + cohort metadata + per-candidate records.
//
// The per-candidate record builder is INJECTABLE via opts.buildRecord
// so call sites can pass their own (the legacy buildCandidateExportRecord
// is 187 LOC of atlas-specific field assembly; that lives at the call
// site rather than here).
//
// All compute is pure: caller passes state explicitly.

import { buildCohortSamplesBlock } from './cohort_export.js';
import {
  DD_SPLIT_RATIO_THRESHOLD, DD_MIN_DIAMOND_WINDOWS, DD_STABLE_VARIANCE_FRAC,
} from './diamond_detection.js';
import {
  BREACH_NARROW_THRESHOLD, BREACH_NARROW_FRAC_HIGH, BREACH_NARROW_FRAC_LOW,
  BREACH_MIN_FISH_PER_BAND,
  BR_BIMODAL_NARROW_MIN, BR_BIMODAL_WIDE_MIN, BR_BIMODAL_DIP_FRAC,
  BR_NARROW_REACH_MAX, BR_WIDE_REACH_MIN,
} from './band_reach.js';
import { IGC_DEFAULT_DIST_THRESHOLD } from './inheritance_groups.js';

/** Format-version marker for the export envelope. */
export const ATLAS_EXPORT_FORMAT_VERSION = 'atlas_candidate_export_v2';

/** Default atlas version string (the legacy turn-bumped this on every
 *  schema change; cartridge default for now). Caller can override via
 *  opts.atlasVersion. */
export const ATLAS_DEFAULT_VERSION_STRING = 'v4.cartridge';

// =====================================================================
// Provenance: atlas constants
// =====================================================================

/**
 * Dump the locked atlas constants that govern the diagnostic
 * computations. Downstream readers compare these against their own
 * thresholds to confirm compatible analysis.
 *
 * @returns {Object}
 */
export function dumpAtlasConstants() {
  return {
    diamond: {
      _DD_SPLIT_RATIO_THRESHOLD: DD_SPLIT_RATIO_THRESHOLD,
      _DD_MIN_DIAMOND_WINDOWS:   DD_MIN_DIAMOND_WINDOWS,
      _DD_STABLE_VARIANCE_FRAC:  DD_STABLE_VARIANCE_FRAC,
    },
    band_reach: {
      _BREACH_NARROW_THRESHOLD: BREACH_NARROW_THRESHOLD,
      _BREACH_NARROW_FRAC_HIGH: BREACH_NARROW_FRAC_HIGH,
      _BREACH_NARROW_FRAC_LOW:  BREACH_NARROW_FRAC_LOW,
      _BREACH_MIN_FISH_PER_BAND: BREACH_MIN_FISH_PER_BAND,
    },
    band_reach_bimodality: {
      _BR_BIMODAL_NARROW_MIN: BR_BIMODAL_NARROW_MIN,
      _BR_BIMODAL_WIDE_MIN:   BR_BIMODAL_WIDE_MIN,
      _BR_BIMODAL_DIP_FRAC:   BR_BIMODAL_DIP_FRAC,
      _BR_NARROW_REACH_MAX:   BR_NARROW_REACH_MAX,
      _BR_WIDE_REACH_MIN:     BR_WIDE_REACH_MIN,
    },
    inheritance: {
      _IGC_DEFAULT_COSINE_DIST_THRESHOLD: IGC_DEFAULT_DIST_THRESHOLD,
    },
  };
}

/**
 * Dump every haplotype-vocab choice (state.haplotypeVocabs). Empty
 * object when none set.
 *
 * @param {Object} state
 * @returns {Object}
 */
export function dumpHaplotypeVocabs(state) {
  if (!state || !state.haplotypeVocabs) return {};
  return Object.assign({}, state.haplotypeVocabs);
}

// =====================================================================
// Cohort inheritance block
// =====================================================================

/**
 * Build the cohort-level inheritance result block. Includes the
 * dendrogram + rtab (group ids + per-item counts) + cut threshold,
 * but NOT the full N×N distance matrix (large; callers can emit
 * separately).
 *
 * Returns null when no inheritance compute has been run, or
 * `{ dendrogram, rtab, cut, threshold }` when it has.
 *
 * @param {Object} state
 * @returns {Object|null}
 */
export function buildCohortInheritanceBlock(state) {
  const r = state && state.inheritanceResult;
  if (!r) return null;
  return {
    dendrogram: r.dendrogram || null,
    items_meta: Array.isArray(r.items_meta)
      ? r.items_meta.map(m => Object.assign({}, m)) : null,
    rtab: r.rtab || null,
    cut:  r.cut  || null,
    threshold: Number.isFinite(state.gPanelInheritanceThreshold)
      ? state.gPanelInheritanceThreshold : null,
  };
}

// =====================================================================
// Main export bundle builder
// =====================================================================

/**
 * Build the canonical atlas candidate export envelope.
 *
 * `opts.buildRecord(cand)` is the per-candidate record builder —
 * legacy buildCandidateExportRecord, or whatever the caller wires up.
 * When absent, the candidates[] array is empty (provenance + cohort
 * blocks still emitted).
 *
 * `opts.mode` overrides state.activeMode for choosing the source
 * registry ('default' → state.candidates, 'detailed' →
 * state.candidates_detailed).
 *
 * `opts.candidate_id` filters the export to a single candidate. Use
 * for "export this one candidate" UI actions.
 *
 * `opts.atlasVersion` overrides the default ATLAS_DEFAULT_VERSION_STRING.
 * `opts.now` overrides the timestamp (deterministic tests).
 *
 * Returns:
 *   {
 *     format_version, atlas_provenance: { atlas_version, exported_at,
 *       mode, session_state_hash, atlas_constants, haplotype_vocabs,
 *       active_K, kMode },
 *     cohort: { n_samples, chrom, n_windows, samples,
 *               inheritance_result },
 *     candidates: [...],
 *   }
 *
 * @param {Object} state
 * @param {{mode?:string, candidate_id?:string, buildRecord?:Function,
 *         atlasVersion?:string, now?:Date}} opts
 * @returns {Object}
 */
export function buildAtlasCandidateExport(state, opts) {
  const o = opts || {};
  const mode = (typeof o.mode === 'string' && o.mode)
    ? o.mode : ((state && state.activeMode) || 'default');
  const atlasVersion = (typeof o.atlasVersion === 'string' && o.atlasVersion)
    ? o.atlasVersion : ATLAS_DEFAULT_VERSION_STRING;
  const now = (o.now instanceof Date) ? o.now : new Date();

  const isDetailed = mode === 'detailed';
  const src = state && (isDetailed ? state.candidates_detailed : state.candidates);

  const baseProvenance = {
    atlas_version: atlasVersion,
    exported_at:   now.toISOString(),
    mode,
  };

  if (!state || !src || typeof src !== 'object') {
    return {
      format_version: ATLAS_EXPORT_FORMAT_VERSION,
      atlas_provenance: baseProvenance,
      cohort: {},
      candidates: [],
    };
  }

  const allIds = Object.keys(src);
  const wantedId = o.candidate_id ? String(o.candidate_id) : null;
  const ids = wantedId ? allIds.filter(id => id === wantedId) : allIds;

  let records = [];
  if (typeof o.buildRecord === 'function') {
    records = ids
      .map(id => src[id])
      .filter(Boolean)
      .map(c => {
        try { return o.buildRecord(c); }
        catch (_) { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => (a.start_bp || 0) - (b.start_bp || 0));
  }

  const samples = (state.data && state.data.samples) || [];

  return {
    format_version: ATLAS_EXPORT_FORMAT_VERSION,
    atlas_provenance: Object.assign({}, baseProvenance, {
      session_state_hash: null,
      atlas_constants:    dumpAtlasConstants(),
      haplotype_vocabs:   dumpHaplotypeVocabs(state),
      active_K: state.k    || null,
      kMode:    state.kMode || null,
    }),
    cohort: {
      n_samples:  samples.length,
      chrom:      (state.data && state.data.chrom)     || null,
      n_windows:  (state.data && state.data.n_windows) || null,
      samples:    buildCohortSamplesBlock(samples),
      inheritance_result: buildCohortInheritanceBlock(state),
    },
    candidates: records,
  };
}

// =====================================================================
// Download via browser
// =====================================================================

/**
 * Build the export envelope and trigger a JSON download in the
 * browser. opts.onDownload(filename, content, mime) is the actual
 * download dispatcher (legacy used an inline Blob+URL flow; the
 * cartridge port makes it injectable so headless callers, atlas-core
 * registry writes, or alternate UI flows can plug in).
 *
 * Default filename: 'atlas_candidate_export_<ISO-timestamp>.json'.
 * `opts.filename` overrides; `opts.candidate_id` is appended for
 * single-candidate exports (matches legacy naming).
 *
 * @param {Object} state
 * @param {Object} opts  forwarded to buildAtlasCandidateExport +
 *                       { onDownload, filename }
 * @returns {Object|null}  the export envelope (also passed to onDownload)
 */
export function downloadAtlasExport(state, opts) {
  const o = opts || {};
  const exp = buildAtlasCandidateExport(state, opts);
  if (!exp) return null;
  const stamp = (o.now instanceof Date)
    ? o.now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
    : new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const candSuffix = o.candidate_id ? ('_' + o.candidate_id) : '';
  const fname = o.filename
    || ('atlas_candidate_export' + candSuffix + '_' + stamp + '.json');
  const content = JSON.stringify(exp, null, 2);
  if (typeof o.onDownload === 'function') {
    try { o.onDownload(fname, content, 'application/json'); }
    catch (_) { /* fail-soft */ }
  }
  return exp;
}
