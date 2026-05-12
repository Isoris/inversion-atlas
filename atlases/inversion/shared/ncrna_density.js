// shared/ncrna_density.js
//
// ncRNA density data layer (sibling track to repeat_density.js). Source
// data is the per-chrom JSON output of aggregate_ncrna_density.R, built
// from canonical GFF3s (tRNAscan-SE / barrnap / Rfam-Infernal). Same
// data model as the TE density layer — the difference is the categories:
//
//   tRNA  : tRNA_all / tRNA_HC / tRNA_pseudo / tRNA_intronic / tRNA_Sec
//   rRNA  : rRNA_all / rRNA_5S / rRNA_5_8S / rRNA_18S / rRNA_28S / rRNA_partial
//   ncRNA : ncRNA_all / ncRNA_snRNA / ncRNA_snoRNA / ncRNA_miRNA / ncRNA_other
//
// Densities are loci/Mb (unit-consistent with the TE layer).
//
// Detection key: tool === 'ncrna_density_v1' (vs repeat density which
// uses version=2 + binning_source='scrubber_windows'). Distinct enough
// that the two detectors won't conflict.
//
// Legacy origin: lines 14573-14742 of legacy/Inversion_atlas.html.
//
// Consumers per the cartridge registry:
//   - pages/review/page11.js (boundaries) — ncRNA panel beside the
//     TE density + boundary auto-propose evidence
//
// All entry points take state as their first arg. localStorage access
// is headless-tolerant.

// =====================================================================
// Constants (legacy 14573-14587)
// =====================================================================

/** Schema tool tag — discriminates ncRNA JSONs from TE density JSONs. */
export const NCRNA_DENSITY_TOOL = 'ncrna_density_v1';

/** localStorage key prefix; one key per chromosome. */
export const NCRNA_DENSITY_LS_PREFIX = 'inversion_atlas.ncRNADensity.';

/** localStorage key for per-chrom active-class overrides. */
export const NCRNA_DENSITY_ACTIVE_CLASS_LS_KEY = 'inversion_atlas.ncRNADensityActiveClass';

/** Default class when the JSON's default_class isn't set or missing. */
export const NCRNA_DEFAULT_CLASS = 'tRNA_all';

/**
 * Family grouping for the renderer's class chip row. Order matters —
 * chips render in this order. Classes not present in the loaded JSON
 * are silently skipped at render time.
 */
export const NCRNA_CLASS_FAMILIES = Object.freeze([
  { family: 'tRNA',  classes: ['tRNA_all', 'tRNA_HC', 'tRNA_pseudo', 'tRNA_intronic', 'tRNA_Sec'] },
  { family: 'rRNA',  classes: ['rRNA_all', 'rRNA_5S', 'rRNA_5_8S', 'rRNA_18S', 'rRNA_28S', 'rRNA_partial'] },
  { family: 'ncRNA', classes: ['ncRNA_all', 'ncRNA_snRNA', 'ncRNA_snoRNA', 'ncRNA_miRNA', 'ncRNA_other'] },
]);

// =====================================================================
// Headless-tolerant localStorage helpers
// =====================================================================

function _hasLocalStorage() {
  return typeof localStorage !== 'undefined' && localStorage;
}

// =====================================================================
// Detection + validation (legacy 14589-14618)
// =====================================================================

/**
 * Detect an ncRNA density JSON. Discriminates by tool tag +
 * schema_version + non-empty chromosomes array.
 */
export function isNcRNADensityJSON(data) {
  return !!(
    data &&
    data.tool === NCRNA_DENSITY_TOOL &&
    typeof data.schema_version === 'number' &&
    Array.isArray(data.chromosomes) &&
    data.chromosomes.length > 0
  );
}

/**
 * Validate a single chromosome block. Returns true if the shape is
 * usable; warns to console on shape failures.
 */
export function validateNcRNADensityChrom(block) {
  if (!block || typeof block !== 'object') return false;
  if (typeof block.chrom !== 'string' || !block.chrom) return false;
  if (typeof block.n_windows !== 'number' || block.n_windows <= 0) return false;
  if (!Array.isArray(block.window_centers_mb)
      || block.window_centers_mb.length !== block.n_windows) {
    if (typeof console !== 'undefined') {
      console.warn('[ncRNADensity] chrom', block.chrom, 'missing/wrong-length window_centers_mb');
    }
    return false;
  }
  if (!block.by_class || typeof block.by_class !== 'object') return false;
  for (const cls of Object.keys(block.by_class)) {
    const info = block.by_class[cls];
    if (!info || !Array.isArray(info.densities)
        || info.densities.length !== block.n_windows) {
      if (typeof console !== 'undefined') {
        console.warn('[ncRNADensity] class', cls, 'on', block.chrom, 'has wrong densities length');
      }
      return false;
    }
  }
  return true;
}

// =====================================================================
// Store / accessors (legacy 14622-14721)
// =====================================================================

/**
 * Store a parsed JSON onto state.ncRNADensity, indexed by chrom.
 * Returns the chrom name on success, null on validation failure.
 */
export function storeNcRNADensity(state, parsed) {
  if (!state || !isNcRNADensityJSON(parsed)) return null;
  const block = parsed.chromosomes[0];
  if (!validateNcRNADensityChrom(block)) return null;
  const chrom = block.chrom;
  if (!state.ncRNADensity || typeof state.ncRNADensity !== 'object') {
    state.ncRNADensity = {};
  }
  state.ncRNADensity[chrom] = {
    schema_version: parsed.schema_version,
    tool:           parsed.tool,
    species:        parsed.species || 'unknown',
    n_classes:      Object.keys(block.by_class).length,
    classes:        Array.isArray(parsed.classes)
                      ? parsed.classes.slice() : Object.keys(block.by_class),
    default_class:  parsed.default_class || NCRNA_DEFAULT_CLASS,
    generated_at:   parsed.generated_at || null,
    chrom_block:    block,
  };
  return chrom;
}

/**
 * Persist one chrom's ncRNA density JSON to localStorage. Reconstructs
 * the v1 envelope. Returns true on success.
 */
export function persistNcRNADensity(state, chrom) {
  if (!state || !state.ncRNADensity || !state.ncRNADensity[chrom]) return false;
  if (!_hasLocalStorage()) return false;
  try {
    const entry = state.ncRNADensity[chrom];
    const obj = {
      tool:            entry.tool,
      schema_version:  entry.schema_version,
      species:         entry.species,
      n_chromosomes:   1,
      n_classes:       entry.n_classes,
      classes:         entry.classes,
      default_class:   entry.default_class,
      generated_at:    entry.generated_at,
      chromosomes:     [entry.chrom_block],
    };
    localStorage.setItem(NCRNA_DENSITY_LS_PREFIX + chrom, JSON.stringify(obj));
    return true;
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[ncRNADensity] persist failed for', chrom, ':', e.message);
    }
    return false;
  }
}

/**
 * Restore all ncRNA density JSONs from localStorage. Returns the
 * number of chroms restored. Per-key fail-soft.
 */
export function restoreNcRNADensity(state) {
  if (!state) return 0;
  if (!state.ncRNADensity || typeof state.ncRNADensity !== 'object') {
    state.ncRNADensity = {};
  }
  if (!_hasLocalStorage()) return 0;
  let n = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(NCRNA_DENSITY_LS_PREFIX)) continue;
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (storeNcRNADensity(state, parsed)) n++;
      } catch (_) { /* skip individual failures */ }
    }
  } catch (_) { /* localStorage might be disabled */ }
  if (n > 0 && typeof console !== 'undefined') {
    console.info('[ncRNADensity] restored', n, 'chromosome(s) from localStorage');
  }
  return n;
}

/** Drop one chrom's ncRNA density data (in-memory + localStorage). */
export function clearNcRNADensity(state, chrom) {
  if (!state) return;
  if (state.ncRNADensity && state.ncRNADensity[chrom]) {
    delete state.ncRNADensity[chrom];
  }
  if (_hasLocalStorage()) {
    try { localStorage.removeItem(NCRNA_DENSITY_LS_PREFIX + chrom); } catch (_) {}
  }
}

/** Look up the entry for a chrom. Returns null if not loaded. */
export function getNcRNADensity(state, chrom) {
  if (!state || !state.ncRNADensity) return null;
  return state.ncRNADensity[chrom] || null;
}

/** Alphabetically sorted list of chroms with ncRNA density loaded. */
export function ncRNADensityChromList(state) {
  if (!state || !state.ncRNADensity) return [];
  return Object.keys(state.ncRNADensity).sort();
}

/**
 * Resolve which class to display for `chrom`. Precedence:
 *   1. user override (state.ncRNADensityActiveClass[chrom]) if present
 *      in by_class
 *   2. the JSON's default_class
 *   3. NCRNA_DEFAULT_CLASS ('tRNA_all')
 *   4. first available class
 *   5. null when nothing matches
 */
export function resolveNcRNADensityClass(state, chrom) {
  const entry = getNcRNADensity(state, chrom);
  if (!entry) return null;
  if (state.ncRNADensityActiveClass && state.ncRNADensityActiveClass[chrom]) {
    if (entry.chrom_block.by_class[state.ncRNADensityActiveClass[chrom]]) {
      return state.ncRNADensityActiveClass[chrom];
    }
  }
  if (entry.default_class && entry.chrom_block.by_class[entry.default_class]) {
    return entry.default_class;
  }
  if (entry.chrom_block.by_class[NCRNA_DEFAULT_CLASS]) return NCRNA_DEFAULT_CLASS;
  const cls = Object.keys(entry.chrom_block.by_class);
  return cls.length > 0 ? cls[0] : null;
}

/**
 * Set the active class for a chrom. Persists to its own localStorage
 * key (NCRNA_DENSITY_ACTIVE_CLASS_LS_KEY) on success. No y-mode
 * auto-default — the ncRNA layer doesn't have a priority/non-priority
 * split the way the TE layer does.
 */
export function setNcRNADensityActiveClass(state, chrom, cls) {
  if (!state) return;
  if (!state.ncRNADensityActiveClass
      || typeof state.ncRNADensityActiveClass !== 'object') {
    state.ncRNADensityActiveClass = {};
  }
  state.ncRNADensityActiveClass[chrom] = cls;
  if (_hasLocalStorage()) {
    try {
      localStorage.setItem(NCRNA_DENSITY_ACTIVE_CLASS_LS_KEY,
        JSON.stringify(state.ncRNADensityActiveClass));
    } catch (_) { /* fail-soft */ }
  }
}

/**
 * Restore per-chrom active-class overrides from localStorage. Failure
 * (no key, JSON parse error) keeps the existing in-memory shape.
 */
export function restoreNcRNADensityActiveClass(state) {
  if (!state || !_hasLocalStorage()) return false;
  try {
    const raw = localStorage.getItem(NCRNA_DENSITY_ACTIVE_CLASS_LS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      state.ncRNADensityActiveClass = parsed;
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}
