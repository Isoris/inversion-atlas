// pages/discovery/local_pca_dosage/chrom_cache.js
//
// Per-session in-memory cache of parsed chromosome JSONs + the
// chrom-selector dropdown refresher (legacy lines 52534, 55206-55237).
//
// The cache lets the user switch between previously-loaded chromosomes
// instantly without re-uploading. It's module-local (one Map per app
// instance), exposed only through accessor functions so callers can't
// mutate it directly.
//
// refreshChromSelect() is DOM-bound but headless-tolerant (no-op when
// `document` is undefined). isChromosomeJSON is a pure predicate.

// =====================================================================
// Module-local cache
// =====================================================================

const _cache = new Map();   // chrom name → parsed JSON data

/** Number of chromosomes currently cached. */
export function chromCacheSize() {
  return _cache.size;
}

/** Get the cached data for `chrom`, or undefined when absent. */
export function getCachedChrom(chrom) {
  return _cache.get(chrom);
}

/** Has the cache seen `chrom`? */
export function hasCachedChrom(chrom) {
  return _cache.has(chrom);
}

/** Store a (chrom, data) pair. Overwrites prior entries. */
export function setCachedChrom(chrom, data) {
  if (!chrom) return;
  _cache.set(chrom, data);
}

/** Return all cached chromosome names. */
export function cachedChromNames() {
  return Array.from(_cache.keys());
}

/** Clear the cache. */
export function clearChromCache() {
  _cache.clear();
}

// =====================================================================
// Predicate (legacy lines 55206-55214)
// =====================================================================

/**
 * "Is this JSON a chromosome envelope?" — distinguishes scrubber_main
 * JSONs (windows + n_windows) from auxiliary enrichment JSONs.
 */
export function isChromosomeJSON(data) {
  return !!(
    data &&
    typeof data.n_windows === 'number' &&
    data.n_windows > 0 &&
    Array.isArray(data.windows) &&
    data.windows.length > 0
  );
}

// =====================================================================
// Chrom-selector refresh (legacy lines 55216-55237)
// =====================================================================

/**
 * Populate the #chromSelect <select> with the cached chromosome names.
 * Headless-tolerant — no-op when `document` is undefined or the
 * #chromSelect element isn't on the page.
 *
 * The active chromosome (from state.data.chrom) is pre-selected.
 *
 * @param {Object} [state]  Optional state for selection marking.
 */
export function refreshChromSelect(state) {
  if (typeof document === 'undefined') return;
  const sel = document.getElementById('chromSelect');
  if (!sel) return;

  // Only chromosomes — filter out auxiliary JSONs (legacy v3.99 turn 10).
  const keys = cachedChromNames()
    .filter(k => isChromosomeJSON(_cache.get(k)))
    .sort();

  sel.innerHTML = '';
  if (keys.length === 0) {
    sel.innerHTML = '<option value="">— none loaded —</option>';
    sel.disabled = true;
    return;
  }
  const activeChrom = state && state.data && state.data.chrom;
  for (const k of keys) {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = `${k}  (${_cache.get(k).n_windows} W)`;
    if (activeChrom === k) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.disabled = false;
}
