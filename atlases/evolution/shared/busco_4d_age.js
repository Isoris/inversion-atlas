// shared/busco_4d_age.js
// =====================================================================
// BUSCO 4D-neutral-site three-μ age bracketing (specs_todo/
// SPEC_busco_4d_age_brackets.md).
//
// The producer pipeline (Python, STEP_C01f_e_emit_busco_4d_age.py)
// extracts 4-fold-degenerate sites from BUSCO genes overlapping each
// inversion, computes Hudson 1992 dXY between HOM_REF / HOM_INV, and
// bootstraps a 95% CI. The atlas consumes that block; this module
// supplies:
//   - the three frozen μ values (DO NOT parameterise — comparability)
//   - dxy → age_my conversion (pure)
//   - block builder that gates on the ≥ 200 4D-site count (spec §2.4)
//   - JSON validator for the `busco_4d_age_brackets` block (spec §3)
//   - display-text formatters for Page 3 Row C (spec §4)
//
// The brackets are FIXED. If catfish-specific μ is published later,
// regenerate the JSON and bump the schema version.
// =====================================================================

// =====================================================================
// Frozen vocab — DO NOT parameterise
// =====================================================================

/** Spec §2.3 — three teleost-clock μ values, in mutations/site/year. */
export const BUSCO_4D_MUS = Object.freeze({
  mu_low: Object.freeze({
    value: 1.0e-9,
    rationale: 'slow teleost clock',
    reference: 'typical lower-bound from teleost phylogenomics',
  }),
  mu_mid: Object.freeze({
    value: 3.0e-9,
    rationale: 'Liu 2023 Siluriformes (electric catfish, r8s)',
    reference: 'Liu et al. 2023, Mar Life Sci Technol, doi:10.1007/s42995-023-00197-8',
  }),
  mu_high: Object.freeze({
    value: 9.0e-9,
    rationale: 'fast teleost clock',
    reference: 'typical upper-bound (pufferfish / killifish lineages)',
  }),
});

/** Default gates (spec §2.4 + §2.2 bootstrap convention). */
export const BUSCO_4D_DEFAULTS = Object.freeze({
  /** Site-count gate — fewer than this → block emitted as `null`. */
  min_4d_sites:                   200,
  /** Recommended bootstrap count for site-level resampling (spec §2.2). */
  recommended_bootstrap_reps:     1000,
});

/** Schema version of the host `inversion_age_v1.json` document.
 *  The brackets block is additive — no schema bump. */
export const BUSCO_4D_SCHEMA_VERSION = 1;

/** The three μ keys in canonical order (low → high). */
export const BUSCO_4D_MU_KEYS = Object.freeze(['mu_low', 'mu_mid', 'mu_high']);

// =====================================================================
// 1. Age computation (pure)
// =====================================================================

/**
 * Spec §2.2 step 5 — convert per-site dXY to age in millions of years
 * under a clock μ.
 *
 *   age_my = dxy / (2 × μ × 1e6)
 *
 * The 2× accounts for the two independent lineages diverging.
 * `1e6` converts year-scale to My.
 *
 * Returns NaN when either input is non-finite or μ ≤ 0.
 *
 * @param {number} dxy            per-site dXY between arrangements
 * @param {number} mu_per_site_per_year
 * @returns {number}              age in millions of years
 */
export function computeAgeFromDxy(dxy, mu_per_site_per_year) {
  if (!Number.isFinite(dxy) || !Number.isFinite(mu_per_site_per_year)) return NaN;
  if (mu_per_site_per_year <= 0) return NaN;
  return dxy / (2 * mu_per_site_per_year * 1e6);
}

/**
 * Apply all three μ values to one dxy point.
 *
 * @param {number} dxy
 * @returns {{mu_low:number, mu_mid:number, mu_high:number}}
 */
export function computeAllThreeAges(dxy) {
  return {
    mu_low:  computeAgeFromDxy(dxy, BUSCO_4D_MUS.mu_low.value),
    mu_mid:  computeAgeFromDxy(dxy, BUSCO_4D_MUS.mu_mid.value),
    mu_high: computeAgeFromDxy(dxy, BUSCO_4D_MUS.mu_high.value),
  };
}

/**
 * Apply one μ to a dxy 95% CI tuple, returning the age 95% CI.
 *
 * Because age = dxy / (2μ × 1e6) is monotonic-increasing in dxy, the
 * CI maps directly: [age_lo, age_hi] = [dxy_lo / (2μ × 1e6), dxy_hi / ...].
 *
 * @param {[number, number]} dxy_ci95
 * @param {number} mu
 * @returns {[number, number]}
 */
export function computeAgeCiFromDxyCi(dxy_ci95, mu) {
  if (!Array.isArray(dxy_ci95) || dxy_ci95.length !== 2) return [NaN, NaN];
  return [
    computeAgeFromDxy(dxy_ci95[0], mu),
    computeAgeFromDxy(dxy_ci95[1], mu),
  ];
}

// =====================================================================
// 2. Block builder — emits the spec §3 schema or null when gated
// =====================================================================

/**
 * Build the `busco_4d_age_brackets` block for one inversion.
 *
 * Returns `null` when `n_4d_sites_used < min_4d_sites` (spec §2.4).
 * Otherwise emits the full spec §3 block — all three μ blocks with
 * value + rationale + age_my + age_my_ci95.
 *
 * @param {{
 *   n_busco_genes_in_inversion?:        number,
 *   n_busco_genes_with_4d_sites?:       number,
 *   n_4d_sites_used:                    number,
 *   n_4d_sites_callable_filter_failed?: number,
 *   n_bootstrap_replicates?:            number,
 *   dxy_4d_between_arrangements:        number,
 *   dxy_4d_ci95:                        [number, number],
 * }} args
 * @param {{min_4d_sites?:number}} [opts]
 * @returns {Object|null}
 */
export function buildBuscoAgeBracketsBlock(args, opts) {
  const o = opts || {};
  const minSites = Number.isFinite(o.min_4d_sites)
    ? o.min_4d_sites : BUSCO_4D_DEFAULTS.min_4d_sites;
  if (!args || !Number.isFinite(args.n_4d_sites_used) || args.n_4d_sites_used < minSites) {
    return null;
  }
  const block = {
    n_busco_genes_in_inversion:        Number.isFinite(args.n_busco_genes_in_inversion)
      ? args.n_busco_genes_in_inversion : null,
    n_busco_genes_with_4d_sites:       Number.isFinite(args.n_busco_genes_with_4d_sites)
      ? args.n_busco_genes_with_4d_sites : null,
    n_4d_sites_used:                   args.n_4d_sites_used,
    n_4d_sites_callable_filter_failed: Number.isFinite(args.n_4d_sites_callable_filter_failed)
      ? args.n_4d_sites_callable_filter_failed : null,
    n_bootstrap_replicates:            Number.isFinite(args.n_bootstrap_replicates)
      ? args.n_bootstrap_replicates : null,
    dxy_4d_between_arrangements:       args.dxy_4d_between_arrangements,
    dxy_4d_ci95:                       Array.isArray(args.dxy_4d_ci95)
      ? args.dxy_4d_ci95.slice(0, 2) : [NaN, NaN],
  };
  for (const k of BUSCO_4D_MU_KEYS) {
    const muMeta = BUSCO_4D_MUS[k];
    block[k] = {
      value:        muMeta.value,
      rationale:    muMeta.rationale,
      age_my:       computeAgeFromDxy(args.dxy_4d_between_arrangements, muMeta.value),
      age_my_ci95:  computeAgeCiFromDxyCi(args.dxy_4d_ci95, muMeta.value),
    };
  }
  return block;
}

// =====================================================================
// 3. Validator — for producer-emitted JSON
// =====================================================================

const _REQUIRED_TOP_FIELDS = [
  'n_4d_sites_used',
  'dxy_4d_between_arrangements',
  'dxy_4d_ci95',
  'mu_low', 'mu_mid', 'mu_high',
];

/**
 * Validate a `busco_4d_age_brackets` block (spec §3). Returns
 * `{ok, errors}`; `errors` is empty when ok.
 *
 * `null` blocks are valid (gated case) — they pass.
 *
 * The validator is structural; it does NOT verify the age_my values
 * match the dxy / μ relationship (a separate cross-check call can do
 * that — see `verifyAgeMatchesDxy`).
 */
export function validateBuscoAgeBracketsBlock(block) {
  if (block === null || block === undefined) return { ok: true, errors: [] };
  const errors = [];
  if (typeof block !== 'object') {
    return { ok: false, errors: ['block is not an object'] };
  }
  for (const f of _REQUIRED_TOP_FIELDS) {
    if (!(f in block)) errors.push(`missing field: ${f}`);
  }
  if (Array.isArray(block.dxy_4d_ci95) && block.dxy_4d_ci95.length !== 2) {
    errors.push(`dxy_4d_ci95 must be length 2 (got ${block.dxy_4d_ci95.length})`);
  } else if ('dxy_4d_ci95' in block && !Array.isArray(block.dxy_4d_ci95)) {
    errors.push('dxy_4d_ci95 must be an array');
  }
  for (const k of BUSCO_4D_MU_KEYS) {
    const m = block[k];
    if (m === undefined) continue;   // missing already flagged above
    if (!m || typeof m !== 'object') {
      errors.push(`${k} must be an object`);
      continue;
    }
    if (!('value' in m))   errors.push(`${k}.value missing`);
    if (!('age_my' in m))  errors.push(`${k}.age_my missing`);
    if (!('age_my_ci95' in m)) errors.push(`${k}.age_my_ci95 missing`);
    if (Number.isFinite(m.value) && m.value !== BUSCO_4D_MUS[k].value) {
      errors.push(`${k}.value = ${m.value} != expected ${BUSCO_4D_MUS[k].value} ` +
                  `(brackets are fixed — see spec §2.3)`);
    }
    if ('age_my_ci95' in m && Array.isArray(m.age_my_ci95)
        && m.age_my_ci95.length !== 2) {
      errors.push(`${k}.age_my_ci95 must be length 2 (got ${m.age_my_ci95.length})`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Optional consistency check — verify the per-μ age_my values in a
 * block are consistent (within tol) with the dxy + μ relationship.
 *
 * Returns `{ok, mismatches}`; `mismatches` is a list of
 * `{mu_key, expected, found, abs_diff}` entries.
 *
 * @param {Object} block
 * @param {{tol?:number}} [opts]
 */
export function verifyAgeMatchesDxy(block, opts) {
  const o = opts || {};
  const tol = Number.isFinite(o.tol) ? o.tol : 1e-3;
  const mismatches = [];
  if (!block || typeof block !== 'object') return { ok: true, mismatches };
  const dxy = block.dxy_4d_between_arrangements;
  if (!Number.isFinite(dxy)) return { ok: true, mismatches };
  for (const k of BUSCO_4D_MU_KEYS) {
    const m = block[k];
    if (!m || !Number.isFinite(m.value) || !Number.isFinite(m.age_my)) continue;
    const expected = computeAgeFromDxy(dxy, m.value);
    if (Number.isFinite(expected)
        && Math.abs(expected - m.age_my) > tol * Math.max(1, Math.abs(expected))) {
      mismatches.push({
        mu_key: k,
        expected,
        found: m.age_my,
        abs_diff: Math.abs(expected - m.age_my),
      });
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

// =====================================================================
// 4. Display-text formatters (spec §4)
// =====================================================================

/**
 * Format the Page-3 Row C task text (spec §4 example block).
 *
 * Each line shows μ value, age_my, age_my_ci95, and rationale. Returns
 * an array of strings (one per render row). Callers join with '\n'
 * or render each as its own DOM line.
 *
 * @param {Object} block   the busco_4d_age_brackets block (non-null)
 * @returns {string[]}
 */
export function formatBuscoAgeBracketsTaskText(block) {
  if (!block) return formatBuscoAgeBracketsEmptyText();
  const lines = [
    'TASK 3: absolute age (BUSCO 4D-neutral sites, three-μ bracketing)',
  ];
  for (const k of BUSCO_4D_MU_KEYS) {
    const m = block[k];
    if (!m) continue;
    const muExp = _formatMuExponent(m.value);
    const age   = Number.isFinite(m.age_my) ? m.age_my.toFixed(2) : '—';
    const lo    = Array.isArray(m.age_my_ci95) && Number.isFinite(m.age_my_ci95[0])
      ? m.age_my_ci95[0].toFixed(2) : '—';
    const hi    = Array.isArray(m.age_my_ci95) && Number.isFinite(m.age_my_ci95[1])
      ? m.age_my_ci95[1].toFixed(2) : '—';
    const tag   = k.replace('mu_', 'μ_').padEnd(6);
    lines.push(`   ${tag} = ${muExp}/site/year      ${age} My (${lo}–${hi})   ${m.rationale}`);
  }
  const genes = Number.isFinite(block.n_busco_genes_in_inversion)
    ? block.n_busco_genes_in_inversion : '?';
  const sites = Number.isFinite(block.n_4d_sites_used)
    ? block.n_4d_sites_used.toLocaleString() : '?';
  const reps  = Number.isFinite(block.n_bootstrap_replicates)
    ? block.n_bootstrap_replicates.toLocaleString() : '?';
  lines.push('');
  lines.push(`   n BUSCO genes: ${genes}    n 4D sites: ${sites}    bootstrap reps: ${reps}`);
  return lines;
}

/**
 * Spec §4 empty-state text for the gated / not-computed case.
 */
export function formatBuscoAgeBracketsEmptyText() {
  return [
    'TASK 3: absolute age (BUSCO 4D, three-μ)        [not computed]',
    '   Method 3 not computed for this candidate.',
    `   Need ≥ ${BUSCO_4D_DEFAULTS.min_4d_sites} BUSCO 4D sites in this inversion.`,
  ];
}

function _formatMuExponent(v) {
  if (!Number.isFinite(v) || v <= 0) return '—';
  // 1.0e-9 → "1×10⁻⁹"; 3.0e-9 → "3×10⁻⁹"; 9.0e-9 → "9×10⁻⁹"
  const exp = Math.floor(Math.log10(v));
  const mant = v / Math.pow(10, exp);
  const mantStr = (Math.round(mant * 10) / 10).toString().replace(/\.0$/, '');
  const supDigits = String(exp)
    .replace('-', '⁻')
    .replace(/[0-9]/g, d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]);
  return `${mantStr}×10${supDigits}`;
}
