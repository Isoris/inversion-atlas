// tests/test_shared_busco_4d_age.js
//
// Unit coverage for shared/busco_4d_age.js — μ-bracket primitives +
// JSON block builder + validator + display-text formatter per
// SPEC_busco_4d_age_brackets.md.

import {
  BUSCO_4D_MUS,
  BUSCO_4D_DEFAULTS,
  BUSCO_4D_SCHEMA_VERSION,
  BUSCO_4D_MU_KEYS,
  computeAgeFromDxy,
  computeAllThreeAges,
  computeAgeCiFromDxyCi,
  buildBuscoAgeBracketsBlock,
  validateBuscoAgeBracketsBlock,
  verifyAgeMatchesDxy,
  formatBuscoAgeBracketsTaskText,
  formatBuscoAgeBracketsEmptyText,
} from '../atlases/inversion/shared/busco_4d_age.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab — frozen μ table');

check('BUSCO_4D_MUS frozen',           Object.isFrozen(BUSCO_4D_MUS));
check('mu_low = 1e-9',                 BUSCO_4D_MUS.mu_low.value === 1.0e-9);
check('mu_mid = 3e-9',                 BUSCO_4D_MUS.mu_mid.value === 3.0e-9);
check('mu_high = 9e-9',                BUSCO_4D_MUS.mu_high.value === 9.0e-9);
check('mu_low frozen',                 Object.isFrozen(BUSCO_4D_MUS.mu_low));
check('mu_mid cites Liu 2023',         BUSCO_4D_MUS.mu_mid.reference.includes('Liu et al. 2023'));
check('MU_KEYS = [low, mid, high]',
      JSON.stringify(BUSCO_4D_MU_KEYS) === '["mu_low","mu_mid","mu_high"]');
check('min_4d_sites = 200',            BUSCO_4D_DEFAULTS.min_4d_sites === 200);
check('recommended_reps = 1000',       BUSCO_4D_DEFAULTS.recommended_bootstrap_reps === 1000);
check('schema_version = 1',            BUSCO_4D_SCHEMA_VERSION === 1);

// =====================================================================
group('computeAgeFromDxy — spec §2.2 step 5');

// Spec §3 worked example:
//   dxy = 0.0078
//   mu_low  → 3.90 My
//   mu_mid  → 1.30 My
//   mu_high → 0.43 My (rounded to 0.43)
const dxyExample = 0.0078;
const a_low  = computeAgeFromDxy(dxyExample, BUSCO_4D_MUS.mu_low.value);
const a_mid  = computeAgeFromDxy(dxyExample, BUSCO_4D_MUS.mu_mid.value);
const a_high = computeAgeFromDxy(dxyExample, BUSCO_4D_MUS.mu_high.value);
check('mu_low age ≈ 3.90 My',          Math.abs(a_low  - 3.90) < 0.01);
check('mu_mid age ≈ 1.30 My',          Math.abs(a_mid  - 1.30) < 0.01);
check('mu_high age ≈ 0.43 My',         Math.abs(a_high - 0.4333) < 0.01);

// Edge cases
check('dxy NaN → NaN',                 Number.isNaN(computeAgeFromDxy(NaN, 1e-9)));
check('mu = 0 → NaN',                  Number.isNaN(computeAgeFromDxy(0.01, 0)));
check('mu < 0 → NaN',                  Number.isNaN(computeAgeFromDxy(0.01, -1e-9)));
check('dxy = 0 → age = 0',             computeAgeFromDxy(0, 1e-9) === 0);

// =====================================================================
group('computeAllThreeAges');

const all = computeAllThreeAges(dxyExample);
check('all returns 3 keys',            Object.keys(all).length === 3);
check('all.mu_mid ≈ 1.30',             Math.abs(all.mu_mid - 1.30) < 0.01);
check('all.mu_low > all.mu_mid > all.mu_high',
      all.mu_low > all.mu_mid && all.mu_mid > all.mu_high);

// =====================================================================
group('computeAgeCiFromDxyCi');

// Spec §3 example mu_low CI: dxy [0.0061, 0.0095] → age [3.05, 4.75]
const ci_low = computeAgeCiFromDxyCi([0.0061, 0.0095], BUSCO_4D_MUS.mu_low.value);
check('mu_low CI lo ≈ 3.05 My',        Math.abs(ci_low[0] - 3.05) < 0.01);
check('mu_low CI hi ≈ 4.75 My',        Math.abs(ci_low[1] - 4.75) < 0.01);

const ci_mid = computeAgeCiFromDxyCi([0.0061, 0.0095], BUSCO_4D_MUS.mu_mid.value);
check('mu_mid CI lo ≈ 1.02 My',        Math.abs(ci_mid[0] - 1.02) < 0.01);
check('mu_mid CI hi ≈ 1.58 My',        Math.abs(ci_mid[1] - 1.58) < 0.01);

check('non-array CI → [NaN, NaN]',
      isNaN(computeAgeCiFromDxyCi(null, 1e-9)[0]));

// =====================================================================
group('buildBuscoAgeBracketsBlock — full schema');

const built = buildBuscoAgeBracketsBlock({
  n_busco_genes_in_inversion:        14,
  n_busco_genes_with_4d_sites:       13,
  n_4d_sites_used:                   2847,
  n_4d_sites_callable_filter_failed: 612,
  n_bootstrap_replicates:            1000,
  dxy_4d_between_arrangements:       0.0078,
  dxy_4d_ci95:                       [0.0061, 0.0095],
});
check('block built (≥ 200 sites)',     built !== null);
check('block: n_4d_sites_used = 2847', built.n_4d_sites_used === 2847);
check('block: dxy preserved',          built.dxy_4d_between_arrangements === 0.0078);
check('block: dxy_ci95 preserved',
      built.dxy_4d_ci95[0] === 0.0061 && built.dxy_4d_ci95[1] === 0.0095);
check('block: 3 μ blocks present',
      'mu_low' in built && 'mu_mid' in built && 'mu_high' in built);
check('block: mu_mid.age ≈ 1.30',      Math.abs(built.mu_mid.age_my - 1.30) < 0.01);
check('block: mu_mid.value = 3e-9',    built.mu_mid.value === 3e-9);
check('block: mu_high.rationale present',
      typeof built.mu_high.rationale === 'string');

// =====================================================================
group('buildBuscoAgeBracketsBlock — site-count gate');

const gated = buildBuscoAgeBracketsBlock({
  n_4d_sites_used: 199,
  dxy_4d_between_arrangements: 0.005,
  dxy_4d_ci95: [0.004, 0.006],
});
check('n_4d < 200 → null',             gated === null);

const onThreshold = buildBuscoAgeBracketsBlock({
  n_4d_sites_used: 200,
  dxy_4d_between_arrangements: 0.005,
  dxy_4d_ci95: [0.004, 0.006],
});
check('n_4d = 200 → built',            onThreshold !== null);

// Custom threshold (e.g. for tests)
const customGate = buildBuscoAgeBracketsBlock({
  n_4d_sites_used: 50,
  dxy_4d_between_arrangements: 0.005,
  dxy_4d_ci95: [0.004, 0.006],
}, { min_4d_sites: 30 });
check('custom min_4d_sites threshold respected', customGate !== null);

check('null args → null',              buildBuscoAgeBracketsBlock(null) === null);
check('missing n_4d_sites_used → null',
      buildBuscoAgeBracketsBlock({ dxy_4d_between_arrangements: 0.005 }) === null);

// =====================================================================
group('validateBuscoAgeBracketsBlock');

// Spec §3 example
const v_good = validateBuscoAgeBracketsBlock(built);
check('built block validates',         v_good.ok === true);

// Null is valid (gated case)
check('null block is valid',           validateBuscoAgeBracketsBlock(null).ok === true);
check('undefined block is valid',      validateBuscoAgeBracketsBlock(undefined).ok === true);

// Missing top fields
const v_miss = validateBuscoAgeBracketsBlock({ n_4d_sites_used: 100 });
check('missing fields flagged',        v_miss.ok === false && v_miss.errors.length > 0);

// Wrong μ value (spec invariant — brackets are fixed)
const tampered = JSON.parse(JSON.stringify(built));
tampered.mu_mid.value = 2.5e-9;
const v_tamp = validateBuscoAgeBracketsBlock(tampered);
check('tampered μ value flagged',
      !v_tamp.ok && v_tamp.errors.some(e => e.includes('brackets are fixed')));

// Bad ci95 length
const badCi = JSON.parse(JSON.stringify(built));
badCi.dxy_4d_ci95 = [0.005];
const v_ci = validateBuscoAgeBracketsBlock(badCi);
check('bad CI length flagged',         !v_ci.ok && v_ci.errors.some(e => e.includes('length 2')));

// Bad: non-object block
check('non-object → !ok',              validateBuscoAgeBracketsBlock('x').ok === false);

// =====================================================================
group('verifyAgeMatchesDxy — internal consistency');

const consist = verifyAgeMatchesDxy(built);
check('built block: ages match dxy',   consist.ok === true);
check('no mismatches',                 consist.mismatches.length === 0);

// Plant a typo in mu_mid.age_my
const mismatched = JSON.parse(JSON.stringify(built));
mismatched.mu_mid.age_my = 99.99;
const m = verifyAgeMatchesDxy(mismatched);
check('mismatched age flagged',         m.ok === false);
check('mismatched: mu_mid in mismatches',
      m.mismatches[0] && m.mismatches[0].mu_key === 'mu_mid');

// Empty / null safe
check('null block → ok (no-op)',       verifyAgeMatchesDxy(null).ok === true);

// =====================================================================
group('formatBuscoAgeBracketsTaskText');

const lines = formatBuscoAgeBracketsTaskText(built);
check('first line = TASK 3',           lines[0].startsWith('TASK 3'));
check('μ_low line includes 1×10⁻⁹',    lines.some(l => l.includes('1×10⁻⁹')));
check('μ_mid line includes 3×10⁻⁹',    lines.some(l => l.includes('3×10⁻⁹')));
check('μ_high line includes 9×10⁻⁹',   lines.some(l => l.includes('9×10⁻⁹')));
check('mu_mid age line shows 1.30',
      lines.some(l => l.includes('1.30')));
check('Liu 2023 rationale rendered',
      lines.some(l => l.includes('Liu 2023')));
check('site count line includes 2,847',
      lines.some(l => l.includes('2,847')));
check('bootstrap reps line includes 1,000',
      lines.some(l => l.includes('1,000')));

const emptyLines = formatBuscoAgeBracketsEmptyText();
check('empty: first line includes "not computed"',
      emptyLines[0].includes('not computed'));
check('empty: mentions 200 site threshold',
      emptyLines.some(l => l.includes('200')));

const passthroughEmpty = formatBuscoAgeBracketsTaskText(null);
check('null block routes to empty text',
      passthroughEmpty[0].includes('not computed'));

// =====================================================================
group('integration — build + validate + format round-trip');

const rt = buildBuscoAgeBracketsBlock({
  n_busco_genes_in_inversion: 8,
  n_busco_genes_with_4d_sites: 8,
  n_4d_sites_used: 540,
  n_4d_sites_callable_filter_failed: 80,
  n_bootstrap_replicates: 1000,
  dxy_4d_between_arrangements: 0.0125,
  dxy_4d_ci95: [0.0103, 0.0148],
});
check('round-trip: validates',         validateBuscoAgeBracketsBlock(rt).ok === true);
check('round-trip: internally consistent', verifyAgeMatchesDxy(rt).ok === true);
const rtLines = formatBuscoAgeBracketsTaskText(rt);
check('round-trip: formats to text',   rtLines.length > 3);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
