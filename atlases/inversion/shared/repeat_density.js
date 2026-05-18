// shared/repeat_density.js
//
// Repeat-density (TE) data layer + user prefs. Consumed by:
//   - page11 (boundaries) — renders the per-chrom TE density panel
//     beside the boundary auto-propose evidence
//   - cross_species_breakpoints / multi_species_cockpit (comparative) — uses state.repeatDensity for
//     flank charts at cross-species breakpoints
//
// Legacy origin: lines 14236-14501 (data layer) + 18962-19083 (prefs
// + class setter) of legacy/Inversion_atlas.html.
//
// JSON shape (v2 binning_source='scrubber_windows'):
//   {
//     version: 2, species, precomp_chrom, n_classes, classes[],
//     default_class, loess_span, generated_at, binning_source: 'scrubber_windows',
//     chromosomes: [{ chrom, n_windows, window_centers_mb[],
//                     window_start_bp[], window_end_bp[],
//                     by_class: { <cls>: { densities[], loess[],
//                                          max_density, loess_span } } }]
//   }
//
// SPEC_v2 alignment: state.repeatDensity[chrom] is the in-memory form
// of v2's repeat_density layer. The localStorage cache (one key per
// chrom, prefix REPEAT_DENSITY_LS_PREFIX) is a stop-gap until
// Registry.write ships, at which point persistRepeatDensity becomes
// registry.write('repeat_density', {chrom}, payload).
//
// All entry points take `state` as their first arg (no globals).
// localStorage access is headless-tolerant (typeof guard) so the
// module imports cleanly in tests.

// =====================================================================
// Constants — data layer (legacy 14263-14312)
// =====================================================================

/** localStorage key prefix; one key per chromosome. */
export const REPEAT_DENSITY_LS_PREFIX = 'pca_scrubber_v3.repeatDensity.';

/**
 * Priority classes in dropdown render order. all_TE is the manuscript
 * aggregate (Spalax/mole-rat Fig. 2A morphology); young_TE_all /
 * old_TE_all are the most useful follow-up cuts; insertion_count and
 * intact_element_count are absolute counts (useful when the fractional
 * aggregate is saturated).
 */
export const PRIORITY_CLASSES = Object.freeze([
  'all_TE',
  'young_TE_all',
  'old_TE_all',
  'insertion_count',
  'intact_element_count',
]);

export const TSD_CLASSES = Object.freeze([
  'target_site_duplication',
  'target_site_duplication_all',
]);

/**
 * Y-axis auto-defaults when the active class changes. Aggregates and
 * fractions get 'auto' (so 0.95 peaks pop visually); counts get 'q99'
 * so one outlier window doesn't squash the rest of the chromosome.
 * Per-class densities not in this lookup retain the user's last yMode.
 */
export const PRIORITY_Y_MODE_DEFAULTS = Object.freeze({
  'all_TE':                      'auto',
  'young_TE_all':                'auto',
  'old_TE_all':                  'auto',
  'insertion_count':             'q99',
  'intact_element_count':        'q99',
  'target_site_duplication':     'q99',
  'target_site_duplication_all': 'q99',
});

// =====================================================================
// Constants — prefs (legacy 18966-18984)
// =====================================================================

export const REPEAT_DENSITY_PREFS_LS_KEY = 'pca_scrubber_v3.repeatDensity.prefs';

export const REPEAT_DENSITY_Y_MODES = Object.freeze(
  ['linear', 'auto', 'q99', 'q95', 'q90', 'log']);

export const REPEAT_DENSITY_VIEW_MODES = Object.freeze(['full', 'zoomed']);

/**
 * Multi-bandwidth LOESS overlays. Each band has id, label, span, color,
 * width. 'custom' span is read from prefs.customSpan at render time.
 */
export const REPEAT_DENSITY_LOESS_BANDS = Object.freeze([
  { id: 'ultra',  label: 'ultra (0.05)',   span: 0.05, color: '#f0a35e', width: 0.9 },
  { id: 'narrow', label: 'narrow (0.10)',  span: 0.10, color: '#e07cb0', width: 1.05 },
  { id: 'tight',  label: 'tight (0.15)',   span: 0.15, color: '#7ad3db', width: 1.2 },
  { id: 'medium', label: 'medium (0.30)',  span: 0.30, color: '#3070d0', width: 1.6 },
  { id: 'wide',   label: 'wide (0.50)',    span: 0.50, color: '#b07cf7', width: 2.0 },
  { id: 'custom', label: 'custom',         span: 0.20, color: '#5fd49a', width: 1.4 },
]);

const _DEFAULT_LOESS_BANDS = Object.freeze({
  ultra: false, narrow: false, tight: false,
  medium: true, wide: false, custom: false,
});

// =====================================================================
// Headless-tolerant localStorage helpers
// =====================================================================

function _hasLocalStorage() {
  return typeof localStorage !== 'undefined' && localStorage;
}

// =====================================================================
// Detection + validation
// =====================================================================

/**
 * Detect a v2 repeat-density JSON. Discriminates by version === 2 +
 * binning_source === 'scrubber_windows' so the precomp loader can
 * route it separately from chromosome JSONs and other layers.
 */
export function isRepeatDensityJSON(data) {
  return !!(
    data &&
    data.version === 2 &&
    data.binning_source === 'scrubber_windows' &&
    Array.isArray(data.chromosomes) &&
    data.chromosomes.length > 0
  );
}

/**
 * Validate a single chromosome block from a v2 JSON. Returns true if
 * the shape is usable; warns to console on shape failures so partial
 * / interrupted R runs are visible.
 */
export function validateRepeatDensityChrom(block) {
  if (!block || typeof block !== 'object') return false;
  if (typeof block.chrom !== 'string' || !block.chrom) return false;
  if (typeof block.n_windows !== 'number' || block.n_windows <= 0) return false;
  for (const k of ['window_centers_mb', 'window_start_bp', 'window_end_bp']) {
    if (!Array.isArray(block[k]) || block[k].length !== block.n_windows) {
      if (typeof console !== 'undefined') {
        console.warn('[repeatDensity] chrom', block.chrom, 'missing/wrong-length', k);
      }
      return false;
    }
  }
  if (!block.by_class || typeof block.by_class !== 'object') return false;
  for (const cls of Object.keys(block.by_class)) {
    const info = block.by_class[cls];
    if (!info || !Array.isArray(info.densities) || info.densities.length !== block.n_windows) {
      if (typeof console !== 'undefined') {
        console.warn('[repeatDensity] class', cls, 'on', block.chrom, 'has wrong densities length');
      }
      return false;
    }
  }
  return true;
}

// =====================================================================
// Store / accessors (legacy 14366-14501)
// =====================================================================

/**
 * Store a parsed v2 JSON onto state.repeatDensity, indexed by chrom.
 * Returns the chrom name on success, null on validation failure.
 *
 * When isFreshLoad is true (e.g. drag/drop) AND the JSON contains
 * the all_TE aggregate AND the user's saved active class is a legacy
 * (non-priority, non-TSD) class, the override is cleared so the JSON's
 * default_class ("all_TE") wins on a fresh TEfull drop. localStorage
 * rehydration uses isFreshLoad=false so an explicit user pick survives.
 */
export function storeRepeatDensity(state, parsed, isFreshLoad) {
  if (!state || !isRepeatDensityJSON(parsed)) return null;
  const block = parsed.chromosomes[0];
  if (!validateRepeatDensityChrom(block)) return null;
  const chrom = block.chrom;
  if (!state.repeatDensity || typeof state.repeatDensity !== 'object') {
    state.repeatDensity = {};
  }
  state.repeatDensity[chrom] = {
    version:        parsed.version,
    species:        parsed.species || 'unknown',
    precomp_chrom:  parsed.precomp_chrom || chrom,
    n_classes:      parsed.n_classes || Object.keys(block.by_class).length,
    classes:        Array.isArray(parsed.classes) ? parsed.classes.slice() : Object.keys(block.by_class),
    default_class:  parsed.default_class || 'repeat_fragment',
    loess_span:     typeof parsed.loess_span === 'number' ? parsed.loess_span : 0.3,
    generated_at:   parsed.generated_at || null,
    chrom_block:    block,
  };
  const saved = (state.repeatDensityActiveClass
                 && typeof state.repeatDensityActiveClass === 'object')
                ? state.repeatDensityActiveClass[chrom] : null;
  if (saved) {
    let shouldClear = false;
    if (!block.by_class[saved]) {
      shouldClear = true;
    } else if (isFreshLoad
               && Array.isArray(parsed.classes)
               && parsed.classes.includes('all_TE')
               && !PRIORITY_CLASSES.includes(saved)
               && !TSD_CLASSES.includes(saved)) {
      shouldClear = true;
    }
    if (shouldClear) {
      delete state.repeatDensityActiveClass[chrom];
      try { persistRepeatDensityPrefs(state); } catch (_) { /* fail-soft */ }
    }
  }
  return chrom;
}

/**
 * Persist one chrom's repeat-density JSON to localStorage. Reconstructs
 * the original v2 JSON envelope so we can round-trip identically.
 * Returns true on success; false on missing data or storage failure
 * (logged but not thrown — quota-exceeded is the common case).
 */
export function persistRepeatDensity(state, chrom) {
  if (!state || !state.repeatDensity || !state.repeatDensity[chrom]) return false;
  if (!_hasLocalStorage()) return false;
  try {
    const entry = state.repeatDensity[chrom];
    const obj = {
      version: entry.version,
      species: entry.species,
      binning_source: 'scrubber_windows',
      precomp_chrom: entry.precomp_chrom,
      n_chromosomes: 1,
      n_classes: entry.n_classes,
      classes: entry.classes,
      default_class: entry.default_class,
      loess_span: entry.loess_span,
      generated_at: entry.generated_at,
      chromosomes: [entry.chrom_block],
    };
    localStorage.setItem(REPEAT_DENSITY_LS_PREFIX + chrom, JSON.stringify(obj));
    return true;
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[repeatDensity] persist failed for', chrom, ':', e.message);
    }
    return false;
  }
}

/**
 * Restore all repeat-density JSONs from localStorage. Walks keys
 * matching REPEAT_DENSITY_LS_PREFIX and stores each via
 * storeRepeatDensity (isFreshLoad=false → preserves saved class
 * overrides). Returns the number of chroms restored.
 */
export function restoreRepeatDensity(state) {
  if (!state) return 0;
  if (!state.repeatDensity || typeof state.repeatDensity !== 'object') {
    state.repeatDensity = {};
  }
  if (!_hasLocalStorage()) return 0;
  let n = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(REPEAT_DENSITY_LS_PREFIX)) continue;
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (storeRepeatDensity(state, parsed)) n++;
      } catch (_) { /* skip individual failures */ }
    }
  } catch (_) { /* localStorage might be disabled in private mode */ }
  if (n > 0 && typeof console !== 'undefined') {
    console.info('[repeatDensity] restored', n, 'chromosome(s) from localStorage');
  }
  return n;
}

/**
 * Drop one chrom's repeat-density data (in-memory + localStorage).
 * Used by tests and by future clear-UI buttons.
 */
export function clearRepeatDensity(state, chrom) {
  if (!state) return;
  if (state.repeatDensity && state.repeatDensity[chrom]) {
    delete state.repeatDensity[chrom];
  }
  if (_hasLocalStorage()) {
    try { localStorage.removeItem(REPEAT_DENSITY_LS_PREFIX + chrom); } catch (_) {}
  }
}

/** Look up a chrom entry. Returns null if not loaded. */
export function getRepeatDensity(state, chrom) {
  if (!state || !state.repeatDensity) return null;
  return state.repeatDensity[chrom] || null;
}

/**
 * Resolve which class to display for `chrom`. Precedence:
 *   1. user override (state.repeatDensityActiveClass[chrom]) if it
 *      points at a class present in the loaded data
 *   2. the JSON's default_class
 *   3. 'repeat_fragment' (legacy default)
 *   4. first available class
 *   5. null when nothing matches
 */
export function resolveRepeatDensityClass(state, chrom) {
  const entry = getRepeatDensity(state, chrom);
  if (!entry) return null;
  if (state.repeatDensityActiveClass && state.repeatDensityActiveClass[chrom]) {
    if (entry.chrom_block.by_class[state.repeatDensityActiveClass[chrom]]) {
      return state.repeatDensityActiveClass[chrom];
    }
  }
  if (entry.default_class && entry.chrom_block.by_class[entry.default_class]) {
    return entry.default_class;
  }
  if (entry.chrom_block.by_class['repeat_fragment']) return 'repeat_fragment';
  const cls = Object.keys(entry.chrom_block.by_class);
  return cls.length > 0 ? cls[0] : null;
}

/** Alphabetically sorted list of chroms with repeat density loaded. */
export function repeatDensityChromList(state) {
  if (!state || !state.repeatDensity) return [];
  return Object.keys(state.repeatDensity).sort();
}

// =====================================================================
// Prefs (legacy 18986-19083)
// =====================================================================

/**
 * Initialize / fetch state.repeatDensityPrefs with backfill for older
 * persisted shapes (missing loessBands ids, missing customSpan).
 * Idempotent.
 */
export function repeatDensityPrefs(state) {
  if (!state) return null;
  if (!state.repeatDensityPrefs || typeof state.repeatDensityPrefs !== 'object') {
    state.repeatDensityPrefs = {
      yMode: 'auto',
      viewMode: 'full',
      loessBands: { ..._DEFAULT_LOESS_BANDS },
      customSpan: 0.20,
    };
  }
  if (!state.repeatDensityPrefs.loessBands
      || typeof state.repeatDensityPrefs.loessBands !== 'object') {
    state.repeatDensityPrefs.loessBands = { ..._DEFAULT_LOESS_BANDS };
  } else {
    const cur = state.repeatDensityPrefs.loessBands;
    for (const id of ['ultra', 'narrow', 'tight', 'medium', 'wide', 'custom']) {
      if (typeof cur[id] !== 'boolean') cur[id] = (id === 'medium');
    }
  }
  if (!Number.isFinite(state.repeatDensityPrefs.customSpan)) {
    state.repeatDensityPrefs.customSpan = 0.20;
  }
  return state.repeatDensityPrefs;
}

/**
 * Persist prefs to localStorage (single atomic blob). Includes the
 * per-chrom activeClass overrides and the y-mode stickiness flag.
 */
export function persistRepeatDensityPrefs(state) {
  if (!state || !_hasLocalStorage()) return false;
  try {
    const prefs = repeatDensityPrefs(state);
    localStorage.setItem(REPEAT_DENSITY_PREFS_LS_KEY, JSON.stringify({
      yMode:    prefs.yMode,
      viewMode: prefs.viewMode,
      loessBands: prefs.loessBands || { ..._DEFAULT_LOESS_BANDS },
      customSpan: Number.isFinite(prefs.customSpan) ? prefs.customSpan : 0.20,
      activeClass: state.repeatDensityActiveClass || {},
      yModeUserPicked: !!state._repeatDensityYModeUserPicked,
    }));
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Restore prefs from localStorage. Validates each field against its
 * enum / range; rejects malformed values silently and keeps defaults.
 */
export function restoreRepeatDensityPrefs(state) {
  if (!state || !_hasLocalStorage()) return false;
  try {
    const raw = localStorage.getItem(REPEAT_DENSITY_PREFS_LS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return false;
    const prefs = repeatDensityPrefs(state);
    if (REPEAT_DENSITY_Y_MODES.includes(parsed.yMode))      prefs.yMode = parsed.yMode;
    if (REPEAT_DENSITY_VIEW_MODES.includes(parsed.viewMode)) prefs.viewMode = parsed.viewMode;
    if (parsed.loessBands && typeof parsed.loessBands === 'object') {
      const validIds = new Set(REPEAT_DENSITY_LOESS_BANDS.map(b => b.id));
      const restored = {};
      for (const id of validIds) {
        restored[id] = (typeof parsed.loessBands[id] === 'boolean')
          ? parsed.loessBands[id]
          : (id === 'medium');
      }
      prefs.loessBands = restored;
    }
    if (Number.isFinite(parsed.customSpan)
        && parsed.customSpan >= 0.01 && parsed.customSpan <= 1.0) {
      prefs.customSpan = parsed.customSpan;
    }
    if (parsed.activeClass && typeof parsed.activeClass === 'object') {
      state.repeatDensityActiveClass = parsed.activeClass;
    }
    if (typeof parsed.yModeUserPicked === 'boolean') {
      state._repeatDensityYModeUserPicked = parsed.yModeUserPicked;
    }
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Set the active class for a chrom. When switching INTO a priority
 * class (all_TE, young_TE_all, etc.), auto-defaults the y-axis mode
 * per PRIORITY_Y_MODE_DEFAULTS — UNLESS the user has manually picked
 * a y-mode this session (state._repeatDensityYModeUserPicked = true),
 * in which case the manual pick is preserved.
 */
export function setRepeatDensityActiveClass(state, chrom, cls) {
  if (!state) return;
  if (!state.repeatDensityActiveClass || typeof state.repeatDensityActiveClass !== 'object') {
    state.repeatDensityActiveClass = {};
  }
  const prevCls = state.repeatDensityActiveClass[chrom];
  state.repeatDensityActiveClass[chrom] = cls;
  if (prevCls !== cls
      && PRIORITY_Y_MODE_DEFAULTS[cls]
      && !state._repeatDensityYModeUserPicked) {
    const desired = PRIORITY_Y_MODE_DEFAULTS[cls];
    if (REPEAT_DENSITY_Y_MODES.includes(desired)) {
      const prefs = repeatDensityPrefs(state);
      if (prefs.yMode !== desired) {
        prefs.yMode = desired;
        try { persistRepeatDensityPrefs(state); } catch (_) { /* fail-soft */ }
      }
    }
  }
}
