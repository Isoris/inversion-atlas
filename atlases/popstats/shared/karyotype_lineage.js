// shared/karyotype_lineage.js
//
// karyotype_lineage_v1 / mashmap_karyotype_lineage_v1 data layer +
// the wfmash-refinement helpers. Source data is a per-(focal_chr,
// species) classification from mashmap alignment ("1-1" / "1-2" /
// "other") with optional higher-resolution wfmash refinement on each
// (focal_chr, species) cell.
//
// Used by the multi-species classification cockpit (multi_species_cockpit) to
// polarize karyotype events (fission/fusion across the catfish
// phylogeny) — see _msPolarizeKaryotypeEvent in legacy. This module
// ships the data + pure lookup helpers; the polarization rules emit
// HTML rationales and stay in legacy for now.
//
// Schema accepts both:
//   - new species-agnostic: tool=karyotype_lineage_v1, focal_species,
//     per_focal_chr[].focal_chr / classes_by_species
//   - legacy: tool=mashmap_karyotype_lineage_v1, per_cgar_chr[].
//     cgar_chr (normalized to focal_chr on store)
//
// wfmash refinement: each classes_by_species[species_id] cell can
// carry refined_by_wfmash ('confirmed'|'refuted'|'refined'|'failed'|
// null), wfmash_class, wfmash_targets[], wfmash_n_blocks,
// wfmash_pct_identity. Semantics:
//   confirmed → wfmash agrees with mashmap at higher resolution
//   refuted   → wfmash collapses 1-2 → 1-1 (or otherwise reduces frag.)
//   refined   → wfmash gives a *different* class than mashmap
//   failed    → wfmash ran but produced no confident alignment
//   null      → not yet attempted
//
// Legacy origin: lines 27770-28162 of legacy/Inversion_atlas.html.

// =====================================================================
// Constants
// =====================================================================

export const KARYOTYPE_LINEAGE_TOOLS = Object.freeze([
  'karyotype_lineage_v1',
  'mashmap_karyotype_lineage_v1',
]);

export const KARYOTYPE_LINEAGE_LS_KEY = 'inversion_atlas.karyotypeLineage.v1';

/**
 * wfmash refinement states. null = not yet attempted (also accepted
 * by the helpers but not in this list).
 */
export const KARYOTYPE_REFINEMENT_STATES = Object.freeze([
  'confirmed', 'refuted', 'refined', 'failed',
]);

/** Confidence tier order (used by adjustConfidenceForRefinement). */
const _CONFIDENCE_ORDER = ['low', 'medium', 'high'];

/** Frac-confirmed threshold (≥80%) for boosting confidence one tier. */
export const KARYO_BOOST_CONFIRMED_FRAC = 0.8;

/** Frac-refuted threshold (≥30%) for dropping confidence one tier. */
export const KARYO_DROP_REFUTED_FRAC = 0.3;

/** Minimum cells-touched fraction before refinement adjusts confidence. */
export const KARYO_MIN_TOUCHED_FRAC = 0.5;

// =====================================================================
// Headless-tolerant localStorage helpers
// =====================================================================

function _hasLocalStorage() {
  return typeof localStorage !== 'undefined' && localStorage;
}

// =====================================================================
// Detection
// =====================================================================

export function isKaryotypeLineageJSON(data) {
  return !!(
    data &&
    KARYOTYPE_LINEAGE_TOOLS.includes(data.tool) &&
    typeof data.schema_version === 'number' &&
    typeof data.params === 'object' &&
    (Array.isArray(data.per_focal_chr) || Array.isArray(data.per_cgar_chr))
  );
}

// =====================================================================
// Store / accessors
// =====================================================================

/**
 * Store a parsed JSON onto state.karyotypeLineage. Normalizes the
 * legacy `per_cgar_chr` / `cgar_chr` field names to the species-agnostic
 * `per_focal_chr` / `focal_chr` on the way in. Infers focal_species
 * from the first entry's classes_by_species when the JSON doesn't
 * declare it explicitly (the species whose only target equals the
 * entry's focal_chr with class 1-1).
 *
 * @param {Object} state
 * @param {Object} parsed
 * @returns {boolean}
 */
export function storeKaryotypeLineage(state, parsed) {
  if (!state || !isKaryotypeLineageJSON(parsed)) return false;
  const rawEntries = Array.isArray(parsed.per_focal_chr)
    ? parsed.per_focal_chr
    : (parsed.per_cgar_chr || []);
  const normalizedEntries = rawEntries.map(e => {
    if (!e) return null;
    const copy = JSON.parse(JSON.stringify(e));
    if (copy.focal_chr == null && copy.cgar_chr != null) {
      copy.focal_chr = copy.cgar_chr;
    }
    return copy;
  }).filter(Boolean);
  // Determine focal_species: explicit > inferred from the data.
  let focalSpecies = parsed.focal_species || null;
  if (!focalSpecies && normalizedEntries.length > 0) {
    const first = normalizedEntries[0];
    const cls = first.classes_by_species || {};
    for (const sp of Object.keys(cls)) {
      const e = cls[sp];
      if (e && e.class === '1-1' && Array.isArray(e.targets)
          && e.targets.length === 1 && e.targets[0] === first.focal_chr) {
        focalSpecies = sp;
        break;
      }
    }
  }
  const sisterSpecies = Array.isArray(parsed.sister_species)
    ? parsed.sister_species.slice() : [];
  const outgroupSpecies = Array.isArray(parsed.outgroup_species)
    ? parsed.outgroup_species.slice() : [];
  state.karyotypeLineage = {
    schema_version: parsed.schema_version,
    tool: parsed.tool,
    generated_at: parsed.generated_at || null,
    params: JSON.parse(JSON.stringify(parsed.params)),
    focal_species: focalSpecies,
    sister_species: sisterSpecies,
    outgroup_species: outgroupSpecies,
    per_focal_chr: normalizedEntries,
    loaded_at: new Date().toISOString(),
  };
  return true;
}

export function persistKaryotypeLineage(state) {
  if (!state || !_hasLocalStorage()) return false;
  try {
    if (state.karyotypeLineage) {
      localStorage.setItem(KARYOTYPE_LINEAGE_LS_KEY,
        JSON.stringify(state.karyotypeLineage));
    } else {
      localStorage.removeItem(KARYOTYPE_LINEAGE_LS_KEY);
    }
    return true;
  } catch (_) {
    return false;
  }
}

export function restoreKaryotypeLineage(state) {
  if (!state || !_hasLocalStorage()) return false;
  try {
    const raw = localStorage.getItem(KARYOTYPE_LINEAGE_LS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return storeKaryotypeLineage(state, parsed);
  } catch (_) {
    return false;
  }
}

export function clearKaryotypeLineage(state) {
  if (!state) return;
  state.karyotypeLineage = null;
  persistKaryotypeLineage(state);
}

// =====================================================================
// Lookups
// =====================================================================

/**
 * Look up the karyotype entry for a focal-species chromosome.
 * Match priority:
 *   1. exact focal_chr
 *   2. prefix-tolerant: strip a leading "C_<short>_" prefix from
 *      entry.focal_chr (e.g. 'C_gar_LG28' matches request 'LG28')
 *   3. suffix match with separator: entry.focal_chr ending in
 *      '_<focalChr>' or '|<focalChr>'
 *
 * @param {Object} state
 * @param {string} focalChr
 * @returns {Object|null}
 */
export function getKaryotypeEntryForFocalChr(state, focalChr) {
  if (!state || !focalChr) return null;
  const kl = state.karyotypeLineage;
  if (!kl || !Array.isArray(kl.per_focal_chr)) return null;
  for (const entry of kl.per_focal_chr) {
    if (!entry || !entry.focal_chr) continue;
    if (entry.focal_chr === focalChr) return entry;
    const stripped = entry.focal_chr.replace(/^[A-Z][a-z]?_[a-z]+_/i, '');
    if (stripped === focalChr) return entry;
    if (entry.focal_chr.endsWith('_' + focalChr)
        || entry.focal_chr.endsWith('|' + focalChr)) return entry;
  }
  return null;
}

// =====================================================================
// wfmash refinement helpers (legacy 28078-28161)
// =====================================================================

/**
 * Get the effective class for a cell — wfmash overrides mashmap when
 * the cell is refuted or refined and has a wfmash_class.
 */
export function getEffectiveClassForCell(cell) {
  if (!cell) return null;
  if (cell.refined_by_wfmash === 'refuted'
      || cell.refined_by_wfmash === 'refined') {
    if (cell.wfmash_class) return cell.wfmash_class;
  }
  return cell.class || null;
}

/**
 * Get the effective targets list for a cell. wfmash refined targets
 * override mashmap targets when present + non-empty + the cell is
 * refuted/refined. Coerces target objects ({chrom: ...}) to chrom
 * strings.
 */
export function getEffectiveTargetsForCell(cell) {
  if (!cell) return [];
  if ((cell.refined_by_wfmash === 'refuted'
       || cell.refined_by_wfmash === 'refined')
      && Array.isArray(cell.wfmash_targets) && cell.wfmash_targets.length > 0) {
    return cell.wfmash_targets.map(t =>
      typeof t === 'string' ? t : (t && t.chrom ? t.chrom : ''));
  }
  return Array.isArray(cell.targets) ? cell.targets.slice() : [];
}

/**
 * Count refinement states across all species cells in a per-focal-chr
 * entry. Returns { confirmed, refuted, refined, failed, not_attempted,
 * total }. not_attempted bucket holds cells with refined_by_wfmash =
 * null / undefined / any unrecognized value.
 */
export function summarizeRefinement(entry) {
  const out = { confirmed: 0, refuted: 0, refined: 0, failed: 0,
                not_attempted: 0, total: 0 };
  if (!entry || !entry.classes_by_species) return out;
  const cls = entry.classes_by_species;
  for (const sp of Object.keys(cls)) {
    out.total++;
    const r = cls[sp] && cls[sp].refined_by_wfmash;
    if (r === 'confirmed') out.confirmed++;
    else if (r === 'refuted') out.refuted++;
    else if (r === 'refined') out.refined++;
    else if (r === 'failed') out.failed++;
    else out.not_attempted++;
  }
  return out;
}

/**
 * Pure function that returns a possibly-adjusted verdict based on the
 * refinement summary. Rules:
 *   - verdict.verdict null OR 'unresolved' → no change
 *   - Fewer than KARYO_MIN_TOUCHED_FRAC of cells touched → no change
 *     (sample too small to draw conclusions from refinement)
 *   - ≥80% confirmed and 0 refuted → boost confidence one tier
 *     (medium → high), append a refinement-confirmation note
 *   - ≥30% refuted → drop confidence one tier, append a caution note
 *   - Otherwise: attach the summary to verdict._refinement, no change
 *
 * Note: the appended notes use small HTML span markup
 * (<span class="ms-refine-note">...</span>) consistent with the legacy
 * UI's rationale rendering. Callers that need plain-text rationales
 * should strip the spans downstream.
 */
export function adjustConfidenceForRefinement(verdict, refinementSummary) {
  if (!verdict || !verdict.verdict) return verdict;
  if (verdict.verdict === 'unresolved') return verdict;
  const s = refinementSummary;
  if (!s || s.total === 0) return verdict;
  const fracConfirmed = s.confirmed / s.total;
  const fracRefuted   = s.refuted   / s.total;
  const fracTouched   = (s.confirmed + s.refuted + s.refined + s.failed) / s.total;
  function boost(c, n) {
    const i = _CONFIDENCE_ORDER.indexOf(c);
    if (i < 0) return c;
    const j = Math.min(_CONFIDENCE_ORDER.length - 1, Math.max(0, i + n));
    return _CONFIDENCE_ORDER[j];
  }
  if (fracTouched < KARYO_MIN_TOUCHED_FRAC) return verdict;
  if (fracConfirmed >= KARYO_BOOST_CONFIRMED_FRAC && s.refuted === 0) {
    return Object.assign({}, verdict, {
      confidence: boost(verdict.confidence, +1),
      rationale: verdict.rationale
        + ' <span class="ms-refine-note">Boosted by wfmash confirmation across '
        + s.confirmed + '/' + s.total + ' species cells.</span>',
      _refinement: s,
    });
  }
  if (fracRefuted >= KARYO_DROP_REFUTED_FRAC) {
    return Object.assign({}, verdict, {
      confidence: boost(verdict.confidence, -1),
      rationale: verdict.rationale
        + ' <span class="ms-refine-note ms-refine-note-warn">Caution: wfmash refuted '
        + s.refuted + '/' + s.total + ' mashmap cells at higher resolution.</span>',
      _refinement: s,
    });
  }
  return Object.assign({}, verdict, { _refinement: s });
}
