// shared/age_model_suggester.js
//
// Inversion-age inference engine (legacy lines 26560-26730:
// _msAutoSuggestAgeModel). Combines comparative-species signals
// (lineage distribution, dXY elevation, karyotype verdict) into one
// of 5 age-model verdicts:
//
//   LINEAGE-KARYO       chromosome-context polarized (species evolution)
//   MULTI-AGE-HOTSPOT   region reused by multiple rearrangement types
//   OLD-BP-YOUNG-INV    breakpoint shared, dXY low (fragile region old,
//                        inversion young)
//   OLD-POLY            dXY elevated AND shared (old polymorphism)
//   YOUNG-POP           dXY low, no comparative evidence (recent in
//                        focal population)
//
// Returns null when evidence is insufficient — the rationale string
// explains which layer is missing so the UI can prompt the user.
//
// Pure: no DOM, no state writes. Callers pass the breakpoint object +
// auxiliary data + an optional escape function for the rationale
// (defaults to identity → caller is responsible for sanitisation
// when rendering).

/** Default HTML escaper for rationale strings. */
function _defaultEsc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The 5 age-model verdicts + null fallback. */
export const AGE_MODELS = Object.freeze({
  LINEAGE_KARYO:     'LINEAGE-KARYO',
  MULTI_AGE_HOTSPOT: 'MULTI-AGE-HOTSPOT',
  OLD_BP_YOUNG_INV:  'OLD-BP-YOUNG-INV',
  OLD_POLY:          'OLD-POLY',
  YOUNG_POP:         'YOUNG-POP',
});

/** Confidence tiers used by the rules. */
export const CONFIDENCE = Object.freeze({
  HIGH: 'high', MEDIUM: 'medium', LOW: 'low', UNKNOWN: 'unknown',
});

/**
 * Karyotype-verdict keys that trigger the RULE-0 LINEAGE-KARYO
 * override. Species-agnostic keys are primary; legacy `cgar_` /
 * `cmac_` are accepted for backward compat (legacy turn 125).
 */
export const LINEAGE_KARYO_VERDICTS = Object.freeze([
  'focal_lineage_fission',
  'sister_lineage_fission',
  'cgar_lineage_fission',
  'cmac_lineage_fission',
  'ancestral_split_both_retained',
]);

/**
 * Distil the comparative-evidence inputs into the canonical signals
 * the rules read.
 *
 * @param {Object?} lineageDist  per-species state map (values like
 *                                'boundary_present', 'fission_*', 'fusion_*')
 * @param {Object?} dxyEntry     dxy_per_inversion entry for this bp
 * @param {Object?} karyoVerdict {verdict: string} from karyotype-lineage
 * @returns {Object}             signal bag (n_present, n_fission, ...)
 */
export function deriveAgeSignals(lineageDist, dxyEntry, karyoVerdict) {
  const signals = {
    n_present: 0, n_fission: 0, n_fusion: 0, n_total: 0,
    fold_elevation: null, dxy_within: null,
    has_mixed_event_types: false, n_rearrangement_types: 0,
    karyo_verdict: null,
  };
  if (lineageDist && typeof lineageDist === 'object') {
    const states = Object.values(lineageDist);
    signals.n_total = states.length;
    signals.n_present = states.filter(s => s === 'boundary_present').length;
    signals.n_fission = states.filter(s =>
      typeof s === 'string' && s.indexOf('fission') >= 0).length;
    signals.n_fusion = states.filter(s =>
      typeof s === 'string' && s.indexOf('fusion') >= 0).length;
    const types = new Set();
    if (signals.n_present > 0) types.add('boundary_present');
    if (signals.n_fission > 0) types.add('fission');
    if (signals.n_fusion > 0)  types.add('fusion');
    signals.n_rearrangement_types = types.size;
    signals.has_mixed_event_types = types.size >= 2;
  }
  if (dxyEntry) {
    if (typeof dxyEntry.fold_elevation_inside_vs_flank === 'number') {
      signals.fold_elevation = dxyEntry.fold_elevation_inside_vs_flank;
    }
    if (typeof dxyEntry.dxy_within_inversion_ref_vs_inv === 'number') {
      signals.dxy_within = dxyEntry.dxy_within_inversion_ref_vs_inv;
    }
  }
  if (karyoVerdict && karyoVerdict.verdict) {
    signals.karyo_verdict = karyoVerdict.verdict;
  }
  return signals;
}

/**
 * Suggest an age model for a breakpoint. Pure compute — no state
 * writes. Returns `{age_model, confidence, rationale, signals}`.
 *
 * Rule order (highest-priority first):
 *   RULE 0 — LINEAGE-KARYO via karyo verdict           (high)
 *   RULE 0b — MULTI-AGE-HOTSPOT via recurrent_fission_hotspot (high)
 *   RULE 1 — MULTI-AGE-HOTSPOT (mixed event types ≥ 3 species)  (medium)
 *   RULE 2 — LINEAGE-KARYO (event is fission/fusion + ≥ 1 species)  (medium)
 *   RULE 3 — OLD-BP-YOUNG-INV (≥ 3 species share boundary, dXY low/null)
 *   RULE 4 — OLD-POLY (dXY elevated ≥ 1.5× AND ≥ 2 species share)  (medium)
 *   RULE 5 — YOUNG-POP (dXY < 1.2×, ≤ 1 species, focal-only)        (medium)
 *   fallback — null with a rationale naming the missing data layer
 *
 * @param {Object} bp                breakpoint row {event_type, event_type_refined?}
 * @param {Object?} lineageDist      species → lineage state map
 * @param {Object?} dxyEntry         dxy_per_inversion row
 * @param {Object?} karyoVerdict     {verdict: string}
 * @param {{esc?:Function}} opts     opts.esc — html escape for rationale
 *                                    (default: built-in)
 * @returns {{age_model: string|null, confidence: string,
 *           rationale: string, signals: Object}}
 */
export function suggestAgeModel(bp, lineageDist, dxyEntry, karyoVerdict, opts) {
  const o = opts || {};
  const esc = typeof o.esc === 'function' ? o.esc : _defaultEsc;
  if (!bp) {
    return {
      age_model: null,
      confidence: CONFIDENCE.UNKNOWN,
      rationale: 'No active breakpoint.',
      signals: {},
    };
  }
  const signals = deriveAgeSignals(lineageDist, dxyEntry, karyoVerdict);
  const eventType = bp.event_type_refined || bp.event_type || '';
  const isFissionFusion = eventType === 'fission' || eventType === 'fusion'
    || eventType.indexOf('fis') >= 0 || eventType.indexOf('fus') >= 0;

  // RULE 0 — Karyotype-driven LINEAGE-KARYO override.
  if (LINEAGE_KARYO_VERDICTS.indexOf(signals.karyo_verdict) >= 0) {
    return {
      age_model: AGE_MODELS.LINEAGE_KARYO,
      confidence: CONFIDENCE.HIGH,
      rationale:
        'Karyotype-scale polarization: <b>'
        + esc(signals.karyo_verdict.replace(/_/g, ' '))
        + '</b>. The chromosome-context evidence (mashmap 1–1 / 1–2 '
        + 'classes across catfish lineages) indicates this is a '
        + 'species-evolution breakpoint, not just a population polymorphism. '
        + 'Class <b>LINEAGE-KARYO</b>.',
      signals,
    };
  }
  if (signals.karyo_verdict === 'recurrent_fission_hotspot') {
    return {
      age_model: AGE_MODELS.MULTI_AGE_HOTSPOT,
      confidence: CONFIDENCE.HIGH,
      rationale:
        'Karyotype-scale polarization: <b>recurrent fission hotspot</b>. '
        + 'Multiple lineages show 1–2 mappings with <b>different '
        + 'target chromosome combinations</b> at this focal-species '
        + 'chromosome — consistent with reuse of the same fragile '
        + 'region by independent rearrangement events. Strongest '
        + 'mechanism class.',
      signals,
    };
  }
  // no_karyotype_change does NOT block downstream rules — absence of
  // chromosome-scale rearrangement is consistent with intra-chromosomal
  // inversions.

  // RULE 1 — MULTI-AGE-HOTSPOT (mixed event types in ≥ 3 species).
  if (signals.has_mixed_event_types
      && signals.n_rearrangement_types >= 2
      && (signals.n_present + signals.n_fission + signals.n_fusion) >= 3) {
    const total = signals.n_present + signals.n_fission + signals.n_fusion;
    return {
      age_model: AGE_MODELS.MULTI_AGE_HOTSPOT,
      confidence: CONFIDENCE.MEDIUM,
      rationale:
        '<b>Mixed rearrangement types</b> across ' + total + ' species ('
        + signals.n_present + ' boundary present, '
        + signals.n_fission + ' fission, '
        + signals.n_fusion  + ' fusion). The fragile region appears reused '
        + 'by rearrangements of <b>different ages and types</b> — '
        + 'strongest mechanism class.',
      signals,
    };
  }
  // RULE 2 — LINEAGE-KARYO (event type is fission/fusion + comparative support).
  if (isFissionFusion && (signals.n_fission + signals.n_fusion) >= 1) {
    return {
      age_model: AGE_MODELS.LINEAGE_KARYO,
      confidence: CONFIDENCE.MEDIUM,
      rationale:
        'Event type is <b>' + esc(eventType) + '</b> and '
        + (signals.n_fission + signals.n_fusion) + ' comparative species '
        + 'show a chromosome-context change. Class <b>LINEAGE-KARYO</b> — '
        + 'this is mostly a species-evolution breakpoint, not just a '
        + 'population polymorphism. Tree polarization can refine which '
        + 'lineage carries the event.',
      signals,
    };
  }
  // RULE 3 — OLD-BP-YOUNG-INV (boundary shared in ≥ 3 species, dXY not elevated).
  if (signals.n_present >= 3
      && (signals.fold_elevation == null || signals.fold_elevation < 1.5)) {
    return {
      age_model: AGE_MODELS.OLD_BP_YOUNG_INV,
      confidence: signals.fold_elevation != null
        ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW,
      rationale:
        'Breakpoint shared in <b>' + signals.n_present + '/'
        + signals.n_total + '</b> species'
        + (signals.fold_elevation != null
            ? ' but dXY inside the inversion is <b>not strongly elevated</b> '
              + '(fold = ' + signals.fold_elevation.toFixed(2)
              + '× vs flank).'
            : '.')
        + ' The fragile region appears <b>old</b> (reused across catfish '
        + 'lineages) but the present-day inversion is likely <b>young</b>. '
        + 'Class <b>OLD-BP-YOUNG-INV</b>.',
      signals,
    };
  }
  // RULE 4 — OLD-POLY (dXY elevated AND shared in ≥ 2 species).
  if (signals.fold_elevation != null && signals.fold_elevation >= 1.5
      && signals.n_present >= 2) {
    return {
      age_model: AGE_MODELS.OLD_POLY,
      confidence: CONFIDENCE.MEDIUM,
      rationale:
        '<b>dXY elevated</b> inside the inversion ('
        + signals.fold_elevation.toFixed(2) + '× vs flank) AND '
        + 'boundary shared in ' + signals.n_present + ' species. The '
        + 'inversion itself is likely <b>old polymorphism</b> — standard '
        + 'and inverted haplotypes have been diverging for a long time. '
        + 'Class <b>OLD-POLY</b>.',
      signals,
    };
  }
  // RULE 5 — YOUNG-POP (dXY low, comparative evidence absent).
  if (signals.fold_elevation != null && signals.fold_elevation < 1.2
      && signals.n_present <= 1) {
    return {
      age_model: AGE_MODELS.YOUNG_POP,
      confidence: CONFIDENCE.MEDIUM,
      rationale:
        '<b>dXY low</b> inside the inversion ('
        + signals.fold_elevation.toFixed(2) + '× vs flank) AND '
        + 'boundary present in only ' + signals.n_present + ' species. '
        + 'The inversion is likely <b>recent</b>, segregating within the '
        + 'focal population. Class <b>YOUNG-POP</b>.',
      signals,
    };
  }

  // Fallback — uncertain (mixed or insufficient evidence). The
  // rationale names the missing layer so the UI can prompt for it.
  let why = 'Insufficient evidence to commit to an age model.';
  if (signals.fold_elevation == null && !lineageDist) {
    why = 'No dXY layer and no multi-species lineage data loaded. '
        + 'Drop <code>dxy_per_inversion_v1.json</code> + '
        + '<code>synteny_multispecies_v1.json</code> to populate.';
  } else if (signals.fold_elevation == null) {
    why = 'No dXY layer loaded. Drop <code>dxy_per_inversion_v1.json</code> '
        + 'to add quantitative inversion-age signal.';
  } else if (!lineageDist) {
    why = 'No multi-species lineage data loaded. Drop '
        + '<code>synteny_multispecies_v1.json</code> to add comparative '
        + 'evidence.';
  }
  return {
    age_model: null,
    confidence: CONFIDENCE.UNKNOWN,
    rationale: why,
    signals,
  };
}
