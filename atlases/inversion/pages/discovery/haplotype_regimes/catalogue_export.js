// pages/discovery/haplotype_regimes/catalogue_export.js
//
// Serialize the in-memory pipeline result to the regime-catalogue
// triple (manifest + knobs + catalogue.json) and trigger a browser
// download for each. Extracted from haplotype_regimes.js as part of
// Part C of the page audit (2026-05-27 file split) — pure DOM /
// download, no page-state mutation beyond reading.

import { buildCatalogue } from '../../../shared/band_tracking/regime_catalogue.js';
import { BANDING_PIPELINE_DEFAULTS }
  from '../../../shared/band_tracking/banding_pipeline.js';

/**
 * Build the catalogue triple from state._regimesResult + trigger
 * three JSON downloads named `<cohort>__<knob_hash>__<file>.json`.
 *
 * Caller supplies `state` + `atlasState`; we read sample IDs,
 * cohort/reference metadata, and the pipeline opts from state.
 * The function alerts (then returns) when no result is available
 * yet — caller doesn't need to gate this.
 *
 * @param {Object} state       haplotype_regimes legacy state
 * @param {Object} atlasState  atlas-core shared bucket (unused for now;
 *                              kept for future cohort/reference id reads)
 */
export function exportCatalogue(state, atlasState) {
  const result = state._regimesResult;
  if (!result) {
    alert('Run the pipeline first.');
    return;
  }
  const data = state.data;
  if (!data || !data.windows) {
    alert('No data loaded.');
    return;
  }

  // Sample IDs from the data file. Fallback to integer-strings if absent.
  const sample_ids = (Array.isArray(data.samples)
    ? data.samples.map(s => (s && (s.sample_id || s.id || s.name)) || `S${s}`)
    : Array.from({ length: data.n_samples }, (_, i) => `S${i}`));

  // Per-window bp mapping. We use the start_bp of the window for s_window
  // and end_bp of the window for e_window — these are the canonical
  // single-chromosome coordinates carried by scrubber_main.
  const windowToBp = (chr_idx, w_idx) => {
    const win = data.windows[w_idx];
    if (!win) return NaN;
    // For s_window query, return start; for e_window query, return end.
    // The serializer calls windowToBp(chr, s_window) and (chr, e_window)
    // separately, so we need a way to disambiguate. Use a heuristic:
    // s_window of a locus is always called first (visit order in
    // buildLocusRecord), so we cannot distinguish here. Solution: track
    // both bp endpoints by always returning the window's centre when
    // called with a single integer. Better: serializer should be told
    // bp endpoints separately. Compromise for now: return start_bp.
    // The result is conservative (slightly under-counts span_bp by the
    // last window's width); document this in HOW_TO_USE.md.
    return win.start_bp != null ? win.start_bp
         : win.center_bp != null ? win.center_bp
         : (win.center_mb != null ? Math.round(win.center_mb * 1e6) : NaN);
  };
  // Better alternative: pass both endpoints. We patch the catalogue
  // post-build to fix e_bp from end_bp instead of start_bp.

  const cohort_id = (data.cohort_id || 'cohort_unset');
  const reference_id = (data.reference_id || 'fClaHyb_Gar_LG');
  const pipeline_version = '3.4.0';
  const opts = state._regimesOpts || {};

  // Resolve full opts dict (the BUILT-IN defaults aren't reflected in opts
  // since the pipeline uses Object.assign({}, DEFAULTS, opts) internally).
  // For the catalogue we serialise the user-supplied opts; the knob_hash
  // therefore reflects the OVERRIDE set, not the full merged set. If a
  // future round needs the full effective config, walk BANDING_PIPELINE_DEFAULTS
  // and merge here.
  const resolved_opts = Object.assign({}, BANDING_PIPELINE_DEFAULTS, opts);

  let built;
  try {
    built = buildCatalogue(result, {
      cohort_id, reference_id, pipeline_version,
      sample_ids,
      chromName: (idx) => state.activeChrom,   // single-chrom run
      windowToBp,
      resolved_opts,
      include_full_votes: false,
    });
  } catch (e) {
    console.error('buildCatalogue threw:', e);
    alert(`Catalogue build failed: ${e.message}`);
    return;
  }

  // Patch e_bp using end_bp (windowToBp returned start_bp for both).
  for (const rec of built.catalogue) {
    const w = data.windows[rec.e_window];
    const e_bp = (w && w.end_bp != null) ? w.end_bp
               : (w && w.start_bp != null && w.start_bp >= rec.s_bp) ? w.start_bp
               : rec.e_bp;
    if (e_bp !== rec.e_bp) {
      rec.e_bp = e_bp;
      rec.span_bp = rec.e_bp - rec.s_bp + 1;
      rec.interval_id = `${rec.chrom_name}:${rec.s_bp}-${rec.e_bp}`;
    }
  }

  // Trigger downloads.
  _downloadJson(`${cohort_id}__${built.manifest.knob_hash}__manifest.json`,
                built.manifest);
  _downloadJson(`${cohort_id}__${built.manifest.knob_hash}__knobs.json`,
                built.knobs);
  _downloadJson(`${cohort_id}__${built.manifest.knob_hash}__catalogue.json`,
                built.catalogue);
}

function _downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)],
                        { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
