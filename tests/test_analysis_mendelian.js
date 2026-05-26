// tests/test_analysis_mendelian.js
//
// Unit tests for analysis/mendelian.js — the canonical analysis-module
// shape that SPEC_registry_v2 item 7 will wrap with the version-aware
// mendelian_inheritance.js orchestrator.
//
// The runMendelianTest() entry point currently has an
// IMPLEMENTATION_NOTE on _findTrios (needs the actual pedigree
// resolver from cohort/sample_groups.tsv to distinguish father vs
// mother by sex). That branch is exercised by the
// "insufficient_data" path. The chi-sq machinery + verdict logic +
// p-value resolution are fully covered.

import {
  runMendelianTest,
  MODULE_VERSION,
} from '../atlases/popstats/analysis/mendelian.js';
import { chiSqSurvival } from '../atlases/inversion/shared/contingency.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function approx(a, b, tol = 1e-6) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  return Math.abs(a - b) <= tol;
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
// Mock Registry — minimal surface to satisfy runMendelianTest
// =====================================================================
function makeRegistry(layers) {
  return {
    _layers: layers,
    _writes: [],
    async resolve(layerName /*, args */) {
      if (!(layerName in layers)) {
        throw new Error('mock registry: unknown layer ' + layerName);
      }
      return layers[layerName];
    },
    async set(layerName, payload, args) {
      // Legacy stub — see SPEC_v2 NOTE in mendelian.js header. Tests
      // capture the call to verify the orchestrator does the right
      // thing on the "write back" step.
      this._writes.push({ layerName, payload, args });
    },
  };
}

// =====================================================================
group('module shape');
check('MODULE_VERSION exported', typeof MODULE_VERSION === 'string'
                                  && MODULE_VERSION.length > 0);

// =====================================================================
group('runMendelianTest — input validation');
{
  let threw = false;
  try { await runMendelianTest(makeRegistry({}), {}); } catch (e) { threw = true; }
  check('ctx without candidate_id throws', threw);
}

// =====================================================================
group('runMendelianTest — insufficient_data path');
{
  // _findTrios currently returns [] (IMPLEMENTATION_NOTE on pedigree).
  // Any registry that provides karyotypes + relatedness should land
  // on insufficient_data with n_trios = 0.
  const reg = makeRegistry({
    candidate_karyotype_per_sample: { s1: 'HOM_REF', s2: 'HET' },
    cohort_relatedness: { pairs: [] },
  });
  const result = await runMendelianTest(reg, { candidate_id: 'cand_X' });
  check('verdict = insufficient_data',  result.verdict === 'insufficient_data');
  check('n_trios = 0',                  result.n_trios === 0);
  check('carries candidate_id',         result.candidate_id === 'cand_X');
  check('carries computed_at',          typeof result.computed_at === 'string');
  check('carries module_version',
        result.module_version === MODULE_VERSION);
  check('reason explains the gate',
        typeof result._reason === 'string'
        && result._reason.includes('need'));
}

// =====================================================================
group('runMendelianTest — registry resolve calls fire in parallel');
{
  const calls = [];
  const reg = {
    async resolve(layer) {
      calls.push(layer);
      if (layer === 'candidate_karyotype_per_sample') return { s1: 'HET' };
      if (layer === 'cohort_relatedness') return { pairs: [] };
      throw new Error('unknown layer: ' + layer);
    },
    async set() {},
  };
  await runMendelianTest(reg, { candidate_id: 'cand_X' });
  check('resolves karyotype_per_sample layer',
        calls.includes('candidate_karyotype_per_sample'));
  check('resolves cohort_relatedness layer',
        calls.includes('cohort_relatedness'));
}

// =====================================================================
group('_chiSqPValue — backed by shared chiSqSurvival');
// We can't import _chiSqPValue directly (it's module-private), but
// the legacy NaN-returning placeholder bubbled through the verdict
// logic and caused 'non-mendelian' to never fire (p_value < ALPHA
// with NaN is false). Now with chiSqSurvival wired, the verdict
// logic actually distinguishes mendelian from non-mendelian.
//
// We verify the wiring transitively: a contrived runMendelianTest
// call where we substitute _findTrios with a stub that emits exactly
// one fully-determined trio. But _findTrios is module-private too.
//
// Easier: verify chiSqSurvival itself returns finite values across
// the spec's calibration table, and assert mendelian.js no longer
// imports anything that returns NaN. Cover the wiring through a
// direct chiSqSurvival test.
{
  // P(X²(df=2) > 5.991) ≈ 0.05 — the chi-sq critical value at α=0.05.
  const p = chiSqSurvival(5.991, 2);
  check('chiSqSurvival(5.991, 2) ≈ 0.05',  approx(p, 0.05, 1e-3));
  // P(X²(df=1) > 3.841) ≈ 0.05
  const p2 = chiSqSurvival(3.841, 1);
  check('chiSqSurvival(3.841, 1) ≈ 0.05',  approx(p2, 0.05, 1e-3));
  // P(X²(df=2) > 0.001) ≈ 1 (long tail)
  const pHigh = chiSqSurvival(0.001, 2);
  check('chiSqSurvival(0.001, 2) ≈ 1',     approx(pHigh, 1, 1e-3));
  // P(X²(df=2) > 100) ≈ 0
  const pLow = chiSqSurvival(100, 2);
  check('chiSqSurvival(100, 2) ≈ 0',       pLow < 1e-15);
  // Non-finite guard: NaN in → NaN out
  check('chiSqSurvival(NaN, 2) = NaN',     Number.isNaN(chiSqSurvival(NaN, 2)));
}

// =====================================================================
// 2026-05-26: _findTrios is now implemented (was a stub returning []).
// Exercised through runMendelianTest since _findTrios is module-private.
// MIN_TRIOS = 5, so each positive test below stages ≥5 trios to escape
// the insufficient_data short-circuit.
// =====================================================================
group('runMendelianTest — single-family triad (parent_offspring labels)');
{
  // One full sibship: parents PA, PB (unrelated), 5 offspring O1..O5.
  // All offspring are HET, both parents HOM_REF — Mendelian-impossible
  // unless one of the parents is actually HET (i.e. classic non-mendelian
  // signature). EXPECTED for HOM_REF × HOM_REF is HOM_REF=1.0.
  const pairs = [];
  for (let i = 1; i <= 5; i++) {
    pairs.push({ sample_a: 'PA', sample_b: 'O' + i, relationship_class: 'parent_offspring' });
    pairs.push({ sample_a: 'PB', sample_b: 'O' + i, relationship_class: 'parent_offspring' });
    // sibs share full-sibling status (not PO, won't pollute trio finder)
    for (let j = i + 1; j <= 5; j++) {
      pairs.push({ sample_a: 'O' + i, sample_b: 'O' + j, relationship_class: 'full_sibling' });
    }
  }
  const karyotypes = { PA: 'HOM_REF', PB: 'HOM_REF',
                       O1: 'HET', O2: 'HET', O3: 'HET', O4: 'HET', O5: 'HET' };
  const reg = makeRegistry({
    candidate_karyotype_per_sample: karyotypes,
    cohort_relatedness: { pairs },
  });
  const result = await runMendelianTest(reg, { candidate_id: 'cand_singlefam' });
  check('n_trios = 5 (one per offspring)',   result.n_trios === 5);
  check('verdict NOT insufficient_data',     result.verdict !== 'insufficient_data');
  check('p_value is finite',                 Number.isFinite(result.p_value));
  // 5 HET offspring with HOM_REF×HOM_REF parents → all 5 in an
  // expected-zero cell → impossible-sentinel chi_sq (1e6 per offspring) →
  // p_value should round to 0 → verdict 'non-mendelian'.
  check('verdict = non-mendelian',           result.verdict === 'non-mendelian');
  check('observed has HOM_REF_x_HOM_REF key',
        result.observed && 'HOM_REF_x_HOM_REF' in result.observed);
  check('observed HET count = 5',
        result.observed.HOM_REF_x_HOM_REF.HET === 5);
}

// =====================================================================
group('runMendelianTest — sibling-only family rejects all trios');
{
  // 6 full siblings (all 1st_degree to each other) and NO parents in the
  // cohort. Triple enumeration over each sample's neighbors finds candidate
  // (sib_i, sib_j, sib_k), but the "P1↔P2 not PO" filter kills every one
  // because all sib pairs are themselves 1st_degree (and we accept
  // 1st_degree as PO under default threshold).
  const sibs = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
  const pairs = [];
  for (let i = 0; i < sibs.length; i++) {
    for (let j = i + 1; j < sibs.length; j++) {
      pairs.push({ sample_a: sibs[i], sample_b: sibs[j], relationship_class: '1st_degree' });
    }
  }
  const karyotypes = {};
  sibs.forEach(s => karyotypes[s] = 'HET');
  const reg = makeRegistry({
    candidate_karyotype_per_sample: karyotypes,
    cohort_relatedness: { pairs },
  });
  const result = await runMendelianTest(reg, { candidate_id: 'cand_sibsonly' });
  check('sibling-only → 0 trios',           result.n_trios === 0);
  check('verdict = insufficient_data',      result.verdict === 'insufficient_data');
}

// =====================================================================
group('runMendelianTest — true mendelian family verdict = mendelian');
{
  // HET × HET cross: expected 1:2:1 ratio across HOM_REF:HET:HOM_INV.
  // Stage 12 offspring (3:6:3 split — perfectly on the expected ratio).
  // Should produce a high p-value → verdict 'mendelian'.
  const offspring = [];
  for (let i = 1; i <= 12; i++) offspring.push('O' + i);
  const pairs = [];
  for (const o of offspring) {
    pairs.push({ sample_a: 'PA', sample_b: o, relationship_class: 'parent_offspring' });
    pairs.push({ sample_a: 'PB', sample_b: o, relationship_class: 'parent_offspring' });
  }
  const karyotypes = { PA: 'HET', PB: 'HET' };
  // 3 HOM_REF, 6 HET, 3 HOM_INV — exact mendelian ratio
  ['O1', 'O2', 'O3'].forEach(o => karyotypes[o] = 'HOM_REF');
  ['O4', 'O5', 'O6', 'O7', 'O8', 'O9'].forEach(o => karyotypes[o] = 'HET');
  ['O10', 'O11', 'O12'].forEach(o => karyotypes[o] = 'HOM_INV');
  const reg = makeRegistry({
    candidate_karyotype_per_sample: karyotypes,
    cohort_relatedness: { pairs },
  });
  const result = await runMendelianTest(reg, { candidate_id: 'cand_classic' });
  check('n_trios = 12',                       result.n_trios === 12);
  check('chi_sq ≈ 0 on exact ratio',          result.chi_sq < 0.001);
  check('p_value ≈ 1 (perfect fit)',          result.p_value > 0.99);
  check('verdict = mendelian',                result.verdict === 'mendelian');
}

// =====================================================================
group('runMendelianTest — parent_offspring strict mode rejects 1st_degree');
{
  // Same single family but pairs are labelled only as '1st_degree'.
  // Default threshold '1st_degree' accepts; explicit 'parent_offspring'
  // rejects (strict mode).
  const pairs = [];
  for (let i = 1; i <= 5; i++) {
    pairs.push({ sample_a: 'PA', sample_b: 'O' + i, relationship_class: '1st_degree' });
    pairs.push({ sample_a: 'PB', sample_b: 'O' + i, relationship_class: '1st_degree' });
  }
  const karyotypes = { PA: 'HET', PB: 'HET',
                       O1: 'HET', O2: 'HET', O3: 'HET', O4: 'HET', O5: 'HET' };
  const reg = makeRegistry({
    candidate_karyotype_per_sample: karyotypes,
    cohort_relatedness: { pairs },
  });
  const result = await runMendelianTest(reg,
    { candidate_id: 'cand_strict', relatedness_threshold: 'parent_offspring' });
  check('strict mode rejects 1st_degree-only pairs',  result.n_trios === 0);
  check('strict mode → insufficient_data',            result.verdict === 'insufficient_data');
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
