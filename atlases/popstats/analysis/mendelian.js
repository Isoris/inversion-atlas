// atlases/inversion/analysis/mendelian.js
// =====================================================================
// Mendelian-inheritance test for inversion karyotypes across known
// parent-offspring trios in the cohort.
//
// CANONICAL ANALYSIS MODULE SHAPE — copy this pattern for new analysis.
//
// SPEC_v2 NOTE (specs_done/SPEC_registry_v2.md item 7):
//   The orchestrator that wraps this module (mendelian_inheritance.js,
//   not yet written) will:
//     - take candidate_id + version_id + selectedFamilies + selectedSamples
//     - resolve inputs via registry.resolve()
//     - compute dependency_hash from (candidate_version_id, callset_id,
//       relatedness_result_id, sample_set_id, analysis_version, thresholds)
//     - call this module's pure compute for the math
//     - write the result via registry.write('mendelian_inheritance_block',
//       { candidate_id, version_id }, payload) — currently a stub-call
//       to reg.set() below; the swap is mechanical once Registry.write
//       lands in atlas-core.
//
// Contract:
//   - Receives `reg` (Registry instance) and `ctx` (call context).
//   - Asks `reg` for the data it needs (candidate karyotypes, relatedness).
//   - Computes the result PURELY in this module (no DOM, no fetch).
//   - Writes the result back through `reg.set()` so other pages get
//     it from cache instead of re-computing.
//   - Returns the result to the calling page.
//
// Scoping (per the user's note about `const`):
//   - All `const` below are PRIVATE to this module unless `export`-ed.
//   - The only exports are runMendelianTest() and a couple of helpers
//     that happen to be useful for other analysis modules.
//   - No `window.X = ...` anywhere. This module does not pollute globals.
//
// =====================================================================

import { chiSqSurvival } from '../../inversion/shared/contingency.js';

// --------------------------------------------------------------------
// Module-private constants. Not visible outside this file.
// --------------------------------------------------------------------

const ALPHA = 0.05;                       // significance for chi-sq
const MIN_TRIOS = 5;                      // refuse to run on < 5 trios
const KARYOTYPE_STATES = ['HOM_REF', 'HET', 'HOM_INV'];

// Mendelian expected-offspring tables for inversion karyotypes.
// Indexed by [father_state][mother_state] → { HOM_REF: p, HET: p, HOM_INV: p }
const EXPECTED = Object.freeze({
  HOM_REF: {
    HOM_REF: { HOM_REF: 1.0, HET: 0.0, HOM_INV: 0.0 },
    HET:     { HOM_REF: 0.5, HET: 0.5, HOM_INV: 0.0 },
    HOM_INV: { HOM_REF: 0.0, HET: 1.0, HOM_INV: 0.0 }
  },
  HET: {
    HOM_REF: { HOM_REF: 0.5, HET: 0.5, HOM_INV: 0.0 },
    HET:     { HOM_REF: 0.25, HET: 0.5, HOM_INV: 0.25 },
    HOM_INV: { HOM_REF: 0.0, HET: 0.5, HOM_INV: 0.5 }
  },
  HOM_INV: {
    HOM_REF: { HOM_REF: 0.0, HET: 1.0, HOM_INV: 0.0 },
    HET:     { HOM_REF: 0.0, HET: 0.5, HOM_INV: 0.5 },
    HOM_INV: { HOM_REF: 0.0, HET: 0.0, HOM_INV: 1.0 }
  }
});


// --------------------------------------------------------------------
// PUBLIC API
// --------------------------------------------------------------------

/**
 * Run the Mendelian-inheritance test for a candidate inversion.
 *
 * @param {Registry} reg - the registry instance (from atlas_api.js)
 * @param {Object}   ctx - call context
 * @param {string}   ctx.candidate_id - which inversion candidate
 * @param {string}   [ctx.relatedness_threshold='1st_degree'] - trio definition
 *
 * @returns {Promise<MendelianResult>}
 *
 * Result shape:
 *   {
 *     candidate_id: string,
 *     n_trios: int,
 *     observed: { [parentpair_key]: { HOM_REF: int, HET: int, HOM_INV: int } },
 *     expected: { [parentpair_key]: { HOM_REF: float, HET: float, HOM_INV: float } },
 *     chi_sq: float,
 *     df: int,
 *     p_value: float,
 *     verdict: 'mendelian' | 'non-mendelian' | 'insufficient_data',
 *     trios: [ {father, mother, offspring, fa_kar, mo_kar, off_kar, expected_pmf} ],
 *     computed_at: ISO8601 string,
 *     module_version: string
 *   }
 */
export async function runMendelianTest(reg, ctx) {
  const candidate_id = ctx.candidate_id;
  if (!candidate_id) throw new Error('runMendelianTest: ctx.candidate_id is required');

  // 1. Ask the registry for everything we need.
  //    These calls hit warm cache on second use — instant.
  const [karyotypes, relatedness] = await Promise.all([
    reg.resolve('candidate_karyotype_per_sample', { candidate_id }),
    reg.resolve('cohort_relatedness')
  ]);

  // 2. Identify trios from relatedness.
  const trios = _findTrios(relatedness, ctx.relatedness_threshold || '1st_degree');

  if (trios.length < MIN_TRIOS) {
    return {
      candidate_id,
      n_trios: trios.length,
      verdict: 'insufficient_data',
      _reason: `Only ${trios.length} trios found, need ${MIN_TRIOS}.`,
      computed_at: new Date().toISOString(),
      module_version: MODULE_VERSION
    };
  }

  // 3. For each trio, look up karyotypes and tally observed offspring.
  const annotatedTrios = [];
  const observed = {};
  const expected = {};

  for (const trio of trios) {
    const fa_kar = karyotypes[trio.father];
    const mo_kar = karyotypes[trio.mother];
    const off_kar = karyotypes[trio.offspring];

    if (!fa_kar || !mo_kar || !off_kar) continue;       // skip if any missing
    if (fa_kar === 'AMBIGUOUS' || mo_kar === 'AMBIGUOUS' || off_kar === 'AMBIGUOUS') continue;

    const key = `${fa_kar}_x_${mo_kar}`;
    if (!observed[key]) observed[key] = { HOM_REF: 0, HET: 0, HOM_INV: 0 };
    observed[key][off_kar] += 1;

    expected[key] = EXPECTED[fa_kar][mo_kar];

    annotatedTrios.push({
      father: trio.father, mother: trio.mother, offspring: trio.offspring,
      fa_kar, mo_kar, off_kar,
      expected_pmf: EXPECTED[fa_kar][mo_kar]
    });
  }

  // 4. Compute chi-squared goodness-of-fit.
  const { chi_sq, df, p_value } = _chiSqGof(observed, expected);

  // 5. Verdict.
  let verdict;
  if (annotatedTrios.length < MIN_TRIOS) verdict = 'insufficient_data';
  else if (p_value < ALPHA)              verdict = 'non-mendelian';
  else                                    verdict = 'mendelian';

  const result = {
    candidate_id,
    n_trios: annotatedTrios.length,
    observed,
    expected,
    chi_sq,
    df,
    p_value,
    verdict,
    trios: annotatedTrios,
    computed_at: new Date().toISOString(),
    module_version: MODULE_VERSION
  };

  // 6. Write the result back through the registry. Now any other page
  //    that asks reg.resolve('mendelian_test', { candidate_id })
  //    gets it instantly from warm cache.
  await reg.set('mendelian_test', result, { candidate_id });

  return result;
}

export const MODULE_VERSION = '1.0.0';


// --------------------------------------------------------------------
// PRIVATE helpers (not exported, not visible outside this module)
// --------------------------------------------------------------------

function _findTrios(relatedness, threshold) {
  // relatedness JSON shape (from cohort/relatedness.json):
  //   { pairs: [ { sample_a, sample_b, kinship, relationship_class }, ... ] }
  //
  // A trio is (father, mother, offspring) where:
  //   - father–offspring is 1st-degree
  //   - mother–offspring is 1st-degree
  //   - father–mother is < 3rd-degree (i.e. unrelated parents)

  const firstDegree = new Map();        // sample → Set of 1st-degree relatives
  for (const pair of relatedness.pairs || []) {
    if (pair.relationship_class === '1st_degree') {
      if (!firstDegree.has(pair.sample_a)) firstDegree.set(pair.sample_a, new Set());
      if (!firstDegree.has(pair.sample_b)) firstDegree.set(pair.sample_b, new Set());
      firstDegree.get(pair.sample_a).add(pair.sample_b);
      firstDegree.get(pair.sample_b).add(pair.sample_a);
    }
  }

  // IMPLEMENTATION_NOTE: a real implementation needs sex info to
  // distinguish father from mother. For v1 we treat trios as unordered
  // (parent_a, parent_b, offspring) and use EXPECTED's symmetry. The
  // commutative property of the Mendelian table (EXPECTED[a][b] ===
  // EXPECTED[b][a]) means this is correct.

  const trios = [];
  // ... trio-finding logic ...
  // (left as IMPLEMENTATION_NOTE for the next chat — needs the actual
  //  pedigree resolver from cohort/sample_groups.tsv)

  return trios;
}

function _chiSqGof(observed, expected) {
  let chi_sq = 0;
  let df = 0;

  for (const key of Object.keys(observed)) {
    const obs = observed[key];
    const exp_pmf = expected[key];
    const n = obs.HOM_REF + obs.HET + obs.HOM_INV;
    if (n === 0) continue;

    for (const state of KARYOTYPE_STATES) {
      const e = exp_pmf[state] * n;
      if (e < 1e-9) {
        // Expected zero: any observed in this cell is a hard violation.
        // Skip the cell for chi-sq (would be infinity); flag in verdict logic.
        if (obs[state] > 0) chi_sq += 1e6;     // sentinel for "impossible"
        continue;
      }
      const diff = obs[state] - e;
      chi_sq += (diff * diff) / e;
    }
    df += KARYOTYPE_STATES.length - 1;        // categories - 1 per parent-pair
  }

  const p_value = _chiSqPValue(chi_sq, df);
  return { chi_sq, df, p_value };
}

function _chiSqPValue(chi_sq, df) {
  // Right-tail p-value: 1 - CDF(chi_sq; df). Uses chiSqSurvival from
  // shared/contingency.js (Lanczos-backed gamma regularised incomplete
  // function, ~10-digit accuracy for df up to ~200). Returns NaN on
  // non-finite inputs to preserve the legacy "insufficient data" path.
  if (!Number.isFinite(chi_sq) || !Number.isFinite(df) || df <= 0) return NaN;
  return chiSqSurvival(chi_sq, df);
}
