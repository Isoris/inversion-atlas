// atlases/inversion/shared/sample_color.js
//
// Pure sample-color resolvers — every page in the cartridge that
// needs to color a sample by its family / ancestry / lineage / etc.
// pulls from here rather than reaching into another page's
// _pageState. Each function takes `state` as its first argument so
// the resolvers compose cleanly with any caller's state shape.
//
// Legacy source: lines 33287-33298 (_resolveSampleScopeColor),
// 36303-36311 (familyColor), 33220-33254 (_lineageColor). The
// auto-trigger requestIdleCallback wrapping around _lineageColor
// stays in page1/_state.js because it's page1-specific scheduling
// behavior — the pure resolver here returns null when the lineage
// result isn't ready and lets the caller decide whether to schedule
// a compute.

// =====================================================================
// Constants (legacy lines 36262-36264)
// =====================================================================

const FAMILY_COLOR_SMALL     = '#cbd5e1';   // n == 2 or 3
const FAMILY_COLOR_SINGLETON = '#dde3eb';   // n == 1
const FAMILY_COLOR_UNMATCHED = '#94a3b8';   // family_id == -1 / missing

// =====================================================================
// Family color (legacy lines 36303-36311)
// =====================================================================

/**
 * Resolve a sample's color by family-id. Reads:
 *   state.data.samples[si].family_id
 *   state.familyPalette[family_id]
 *   state.smallFamilyIds (Set)
 *   state.singletonFamilyIds (Set)
 *
 * Returns the resolved hex (or fallback grey when family is missing).
 */
export function familyColor(state, si) {
  if (!state || !state.data || !state.data.samples) return FAMILY_COLOR_UNMATCHED;
  const sample = state.data.samples[si];
  if (!sample) return FAMILY_COLOR_UNMATCHED;
  const f = sample.family_id;
  if (f == null || f === -1) return FAMILY_COLOR_UNMATCHED;
  if (state.familyPalette && state.familyPalette[f]) return state.familyPalette[f];
  if (state.smallFamilyIds && state.smallFamilyIds.has && state.smallFamilyIds.has(f)) {
    return FAMILY_COLOR_SMALL;
  }
  if (state.singletonFamilyIds && state.singletonFamilyIds.has
      && state.singletonFamilyIds.has(f)) {
    return FAMILY_COLOR_SINGLETON;
  }
  return FAMILY_COLOR_UNMATCHED;
}

// =====================================================================
// Lineage color (legacy lines 33220-33254, pure subset)
// =====================================================================

/**
 * Resolve a sample's color by lineage assignment. Reads
 * state.lineageResult (populated by runLineageCompute in
 * page1/lineage.js). Returns null when the lineage result isn't
 * available — the caller decides whether to schedule a compute.
 *
 * The legacy page1 path wraps this with a requestIdleCallback auto-
 * trigger; page22 uses the pure version (degrades gracefully when no
 * result is loaded).
 */
export function lineageColor(state, si) {
  if (!state) return null;
  const result = state.lineageResult;
  if (!result || !result.lineage_id_per_sample) return null;
  if (si < 0 || si >= result.n_samples) return null;
  const lid = result.lineage_id_per_sample[si];
  if (lid == null || lid < 0 || lid >= result.n_lineages) return null;
  // Golden-angle rotation: each lineage gets a distinct hue.
  const baseHue = 210;                  // cool blue anchor for lineage 0
  const goldenAngle = 137.508;
  const hue = (baseHue + lid * goldenAngle) % 360;
  return `hsl(${hue.toFixed(1)}, 70%, 55%)`;
}

// =====================================================================
// Composite scope-color resolver (legacy lines 33287-33298)
// =====================================================================

/**
 * Resolve a sample's color for one of the page-agnostic "scope" modes
 * that page22's regime panels and page1's lines panel both consume.
 *
 * Modes today: 'family', 'lineage'. Other modes return null (caller
 * uses a fallback color). Future modes can grow the switch without
 * touching call sites.
 *
 * @param {Object} state  any page state with the relevant slots
 * @param {number} si     sample index
 * @param {string} mode   'family' | 'lineage' | …
 * @returns {string|null}
 */
export function resolveSampleScopeColor(state, si, mode) {
  if (mode === 'family')  return familyColor(state, si);
  if (mode === 'lineage') return lineageColor(state, si);
  return null;
}
