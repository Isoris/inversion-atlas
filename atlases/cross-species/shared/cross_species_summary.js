// shared/cross_species_summary.js
//
// Stats-profile derivations from cross-species breakpoints
// (legacy lines 28730-28752: _spDeriveFusionFission). Pure
// compute over a breakpoint array — no state coupling.
//
// The output shape matches the legacy "stats profile entry"
// schema (state / effect / observed / expected / unit /
// fold_change / p_value / q_value / n / label), so the per-page
// table can render it without any adapter.

/** Event-type strings considered fission-or-fusion in the legacy. */
export const FISSION_FUSION_EVENT_TYPES = Object.freeze([
  'fission_or_fusion',
  'translocation_or_fission',
]);

/**
 * Read the effective event type of a breakpoint, preferring the
 * refined call when present.
 */
function _eventType(bp) {
  return (bp && (bp.event_type_refined || bp.event_type)) || '';
}

/**
 * Derive the fission/fusion fraction from a cross-species
 * breakpoint array. Returns a stats-profile entry, or `null` when
 * the breakpoint array is missing / empty.
 *
 * Shape:
 *   {
 *     state:       'derived',
 *     effect:      'enriched' | 'not_significant',
 *     observed:    int      // fission/fusion count
 *     expected:    null,
 *     unit:        'breakpoints',
 *     fold_change: null,
 *     p_value:     null,
 *     q_value:     null,
 *     n:           int      // total breakpoints
 *     label:       string
 *   }
 *
 * `effect` is `'enriched'` when ≥ 1 fission/fusion call is present
 * (legacy heuristic — no formal test).
 *
 * @param {Array<Object>|null} breakpoints
 * @returns {Object|null}
 */
export function deriveFusionFission(breakpoints) {
  if (!Array.isArray(breakpoints) || breakpoints.length === 0) return null;
  let ff = 0, inv = 0;
  for (const b of breakpoints) {
    const et = _eventType(b);
    if (FISSION_FUSION_EVENT_TYPES.indexOf(et) >= 0) ff++;
    if (et === 'inversion') inv++;
  }
  return {
    state: 'derived',
    effect: ff > 0 ? 'enriched' : 'not_significant',
    observed: ff,
    expected: null,
    unit: 'breakpoints',
    fold_change: null,
    p_value: null,
    q_value: null,
    n: breakpoints.length,
    label: ff + ' / ' + breakpoints.length + ' cross-species breakpoints '
      + 'classified as fission/fusion (' + inv + ' inversion breakpoints)',
  };
}

/**
 * Stratify breakpoints by effective event type. Pure compute;
 * returns `{[event_type]: count}`. Empty / null input → `{}`.
 *
 * @param {Array<Object>|null} breakpoints
 * @returns {Object<string, number>}
 */
export function countByEventType(breakpoints) {
  if (!Array.isArray(breakpoints)) return {};
  const out = Object.create(null);
  for (const b of breakpoints) {
    const et = _eventType(b);
    if (!et) continue;
    out[et] = (out[et] || 0) + 1;
  }
  return out;
}
