// pages/review/page4/karyo_labels.js
//
// Karyotype label vocabulary (legacy lines 36977-37050). Cartridge port
// of the K=3..K=6 detailed H-system labels plus the legacy "band N"
// labels. The vocab choice persists in localStorage under
// 'inversion_atlas.labelVocab'.

const _LABEL_STORAGE_KEY = 'inversion_atlas.labelVocab';

/** localStorage key under which the vocab choice persists. Exported for
 *  tests + atlas-core registry. */
export const KARYO_LABEL_STORAGE_KEY = _LABEL_STORAGE_KEY;

/** Vocab options. 'legacy' = "band 1 (lo)" / etc.; 'detailed' = the
 *  operational H-system labels (H1/H1, H1/H2, ...). */
export const KARYO_LABEL_VOCABS = Object.freeze(['legacy', 'detailed']);

/** Detailed H-system labels for K=3..K=6.
 *  K=3 = biallelic (H1/H1, H1/H2, H2/H2).
 *  K=6 = full 3-haplotype system.
 *  K=4/K=5 = intermediate cases. */
export const KARYO_DETAILED_LABELS = Object.freeze({
  3: Object.freeze(['H1/H1', 'H1/H2', 'H2/H2']),
  4: Object.freeze(['H1/H1', 'H1/H2', 'H2/H2', 'H1/H3']),
  5: Object.freeze(['H1/H1', 'H1/H2', 'H2/H2', 'H1/H3', 'H3/H3']),
  6: Object.freeze(['H1/H1', 'H1/H2', 'H2/H2', 'H1/H3', 'H2/H3', 'H3/H3']),
});

/** Legacy labels for K=3 only (for K≠3 we fall back to "band N"). */
export const KARYO_LEGACY_LABELS_K3 = Object.freeze(['band 1 (lo)', 'band 2 (mid)', 'band 3 (hi)']);

function _readStored() {
  if (typeof localStorage === 'undefined') return null;
  try { return localStorage.getItem(_LABEL_STORAGE_KEY); }
  catch (_) { return null; }
}

function _writeStored(v) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(_LABEL_STORAGE_KEY, v); }
  catch (_) { /* swallow */ }
}

/**
 * Ensure state.labelVocab is set. Reads from localStorage on first
 * access; defaults to 'legacy' when nothing is persisted. Returns the
 * resolved vocab. Mutates the state slot.
 *
 * @param {Object} state
 * @returns {'legacy'|'detailed'}
 */
export function ensureKaryoLabelVocab(state) {
  if (!state) return 'legacy';
  if (state.labelVocab === 'legacy' || state.labelVocab === 'detailed') {
    return state.labelVocab;
  }
  const stored = _readStored();
  state.labelVocab = (stored === 'detailed') ? 'detailed' : 'legacy';
  return state.labelVocab;
}

/**
 * Set the karyotype label vocab on state. Persists to localStorage.
 * Returns true on success, false if the value is invalid.
 *
 * @param {Object} state
 * @param {string} v
 * @returns {boolean}
 */
export function setKaryoLabelVocab(state, v) {
  if (v !== 'legacy' && v !== 'detailed') return false;
  if (state) state.labelVocab = v;
  _writeStored(v);
  return true;
}

/**
 * Resolve the display label for `bandIdx` in a K-band candidate. Reads
 * the active vocab from state (use `mode` to override). Falls back to
 * "band N" (1-indexed) when K is out of supported range.
 *
 * @param {Object} state         active state (for vocab lookup)
 * @param {number} bandIdx
 * @param {number} K
 * @param {'legacy'|'detailed'?} mode
 * @returns {string}
 */
export function getKaryotypeLabel(state, bandIdx, K, mode) {
  if (bandIdx == null || bandIdx < 0) return '?';
  const k = K || 3;
  const vocab = mode || ensureKaryoLabelVocab(state);
  if (vocab === 'detailed') {
    const arr = KARYO_DETAILED_LABELS[k];
    if (arr && bandIdx < arr.length) return arr[bandIdx];
    return 'band ' + (bandIdx + 1);
  }
  // legacy
  if (k === 3 && bandIdx < 3) return KARYO_LEGACY_LABELS_K3[bandIdx];
  return 'band ' + (bandIdx + 1);
}

/**
 * Returns the tooltip caveat when the active vocab is 'detailed', or
 * null when 'legacy'. The caveat reminds users that the H-labels are
 * operational (PC1-ordered), not biological assertions.
 *
 * @param {Object} state
 * @returns {string|null}
 */
export function getKaryotypeLabelCaveat(state) {
  return ensureKaryoLabelVocab(state) === 'detailed'
    ? 'Operational H-label — ordered by median PC1, not a confirmed '
      + 'biological assignment. Confirm with heterozygosity / haplotype-'
      + 'divergence evidence before claiming homozygote-like or '
      + 'heterozygote-like state.'
    : null;
}
