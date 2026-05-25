// shared/ensure_chrom_tracks.js
//
// 2026-05-26: shared helper for the scrubber_main self-bootstrap pattern
// used by candidate_focus, boundary_refinement, catalogue, and the
// catalogue sub-pages (annotation_cockpit, marker_panels, etc).
//
// Several inversion-atlas pages read state.data from
//   atlasState.inversion.tracks[chrom]
// which is normally populated by local_pca_dosage's mount when the user
// navigates through the discovery workflow. When the user lands on one
// of these dependent pages DIRECTLY (via a session-restore URL, the
// chrom-picker, the catalogue index, etc.) the tracks slot is empty and
// every per-chrom panel silently bails on `if (!state.data) return` →
// blank canvases / empty rows / "no data" placeholder.
//
// This helper closes that gap by resolving scrubber_main through the
// registry when the slot is empty, stashing the result on
// inv.tracks[chrom], and contributing chromSummary (SPEC_multichrom
// Slice 1) while it has the data. Fail-soft on every error so a missing
// registry / failed resolve doesn't break the page's own error path.
//
// Returns:
//   { ok: true,  data, chrom }   if data was resolved and stashed
//   { ok: false, reason }        if no work to do or resolve failed
//
// The caller is expected to:
//   1. Call before rendering anything that depends on inv.tracks
//   2. Rebuild its legacyState after `ok: true` so the new tracks slot
//      is picked up (every page's _buildLegacyState reads inv.tracks)
//   3. Re-render
//
// Idempotent: if tracks[chrom] already exists or no activeChrom is set,
// returns ok:false with a "skip" reason. The cost of calling it on every
// mount is one Map lookup.

/**
 * Resolve scrubber_main and stash on atlasState.inversion.tracks[chrom].
 *
 * @param {Object} atlasState   the registry-provided atlasState object
 * @param {Object} registry     the registry instance with resolve()
 * @returns {Promise<{ok:boolean, data?:Object, chrom?:string, reason?:string}>}
 */
export async function ensureChromTracks(atlasState, registry) {
  const sh = (atlasState && atlasState.shared) || {};
  const inv = (atlasState && atlasState.inversion) || {};
  const chrom = sh.activeChrom;
  if (!chrom) return { ok: false, reason: 'no-active-chrom' };
  if (inv.tracks && inv.tracks[chrom]) {
    return { ok: false, reason: 'tracks-already-present', chrom };
  }
  if (!registry || typeof registry.resolve !== 'function') {
    return { ok: false, reason: 'no-registry' };
  }
  let data = null;
  try {
    const resolved = registry.resolve('scrubber_main', { chrom });
    // registry.resolve hot-tier cache hits return sync; cold returns a Promise.
    data = (resolved && typeof resolved.then === 'function')
      ? await resolved
      : resolved;
  } catch (e) {
    console.warn('ensureChromTracks: scrubber_main resolve threw —', e);
    return { ok: false, reason: 'resolve-threw' };
  }
  if (!data) return { ok: false, reason: 'resolve-empty', chrom };
  // Stash. Create both nested objects if they're missing — atlasState may
  // not have an inversion bucket yet on a fresh session.
  atlasState.inversion = atlasState.inversion || {};
  atlasState.inversion.tracks = atlasState.inversion.tracks || {};
  atlasState.inversion.tracks[chrom] = data;
  // Contribute chromSummary (SPEC_multichrom Slice 1). Non-essential —
  // fail-soft on missing helper / setter.
  if (typeof atlasState.setChromSummary === 'function') {
    try {
      const cs = await import('../../../../core/chrom_summary.js');
      atlasState.setChromSummary(chrom, cs.buildChromSummary(data, { chrom }));
    } catch (_) { /* non-essential */ }
  }
  return { ok: true, data, chrom };
}
