// tests/test_shared_inversion_classification.js
//
// Unit coverage for shared/inversion_classification.js — the per-
// candidate consolidator that turns each axis's producer output into
// one unified row.
//
// This module is a thin bridge — most tests verify that each axis
// extractor pulls the right field, that missing inputs are tolerated
// (no throws, AXIS_MISSING returned), and that the coverage roll-up
// is correct.

import {
  CLASSIFICATION_AXES,
  AXIS_MISSING,
  INVERSION_CLASSIFICATION_VERSION,
  extractOriginMechanism,
  extractCopyOriginVerdict,
  extractPositionClass,
  extractStructureClass,
  extractSelectionEfficacy,
  extractAgeMyBracket,
  extractSegregationStatusMajority,
  extractDivergence,
  extractXpehhSignal,
  extractArrangementN,
  buildInversionClassificationRow,
  buildClassificationRows,
  filterByCoverage,
  groupByAxis,
} from '../atlases/inversion/shared/inversion_classification.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('schema');

check('CLASSIFICATION_AXES frozen',       Object.isFrozen(CLASSIFICATION_AXES));
check('10 axes defined',                  CLASSIFICATION_AXES.length === 10);
check('AXIS_MISSING is null',             AXIS_MISSING === null);
check('module version v1.0',              INVERSION_CLASSIFICATION_VERSION === 'inversion_classification_v1.0');

// =====================================================================
group('extractors — pass-through on populated inputs');

check('origin mechanism: label extracted',
      extractOriginMechanism({ label: 'NAHR-compatible' }) === 'NAHR-compatible');
check('copy origin verdict extracted',
      extractCopyOriginVerdict({ verdict: 'arrangement-specific SD mosaic' })
   === 'arrangement-specific SD mosaic');
check('position class extracted',
      extractPositionClass({ label: 'pericentromeric' }) === 'pericentromeric');
check('structure class extracted',
      extractStructureClass({ label: 'inversion_dosage_like' }) === 'inversion_dosage_like');
check('selection efficacy extracted',
      extractSelectionEfficacy({ summary_tag: 'load_rich' }) === 'load_rich');
check('divergence label passthrough',
      extractDivergence('strong_divergence') === 'strong_divergence');
check('xpehh label passthrough',
      extractXpehhSignal('mild_outlier') === 'mild_outlier');

// =====================================================================
group('extractors — missing-input tolerance');

check('null origin → missing',     extractOriginMechanism(null)        === AXIS_MISSING);
check('null verdict → missing',    extractCopyOriginVerdict(null)      === AXIS_MISSING);
check('null position → missing',   extractPositionClass(null)          === AXIS_MISSING);
check('null structure → missing',  extractStructureClass(null)         === AXIS_MISSING);
check('null burden → missing',     extractSelectionEfficacy(null)      === AXIS_MISSING);
check('null busco → missing',      extractAgeMyBracket(null)           === AXIS_MISSING);
check('null family rows → missing',extractSegregationStatusMajority(null) === AXIS_MISSING);
check('null divergence → missing', extractDivergence(null)             === AXIS_MISSING);
check('null xpehh → missing',      extractXpehhSignal(null)            === AXIS_MISSING);
check('null arrangement → missing',extractArrangementN(null)           === AXIS_MISSING);
check('empty family rows → missing',
      extractSegregationStatusMajority([]) === AXIS_MISSING);
check('non-string divergence → missing',
      extractDivergence(42) === AXIS_MISSING);

// =====================================================================
group('extractAgeMyBracket — busco block');

const buscoBlock = {
  n_4d_sites_used: 2847,
  mu_low:  { age_my: 3.90, age_my_ci95: [3.05, 4.75] },
  mu_mid:  { age_my: 1.30, age_my_ci95: [1.02, 1.58] },
  mu_high: { age_my: 0.43, age_my_ci95: [0.34, 0.53] },
};
const age = extractAgeMyBracket(buscoBlock);
check('age: mu_low_my = 3.90',    age.mu_low_my === 3.90);
check('age: mu_mid_my = 1.30',    age.mu_mid_my === 1.30);
check('age: mu_high_my = 0.43',   age.mu_high_my === 0.43);
check('age: n_4d_sites = 2847',   age.n_4d_sites === 2847);
check('age: ci95_mid preserved',  age.ci95_mid[0] === 1.02 && age.ci95_mid[1] === 1.58);

// Partial busco (missing one μ) → missing
const partial = { ...buscoBlock };
delete partial.mu_mid;
check('partial busco → missing',  extractAgeMyBracket(partial) === AXIS_MISSING);

// =====================================================================
group('extractSegregationStatusMajority — family rollup');

// 5 high-reliability families: 3 MENDELIAN, 1 DISTORTED, 1 AMBIGUOUS
const familyRows = [
  { reliability: 'high',   segregation_status: 'MENDELIAN' },
  { reliability: 'high',   segregation_status: 'MENDELIAN' },
  { reliability: 'medium', segregation_status: 'MENDELIAN' },
  { reliability: 'high',   segregation_status: 'DISTORTED' },
  { reliability: 'medium', segregation_status: 'AMBIGUOUS' },
  { reliability: 'low',    segregation_status: 'DISTORTED' },   // dropped
];
const seg = extractSegregationStatusMajority(familyRows);
check('majority status = MENDELIAN',       seg.status === 'MENDELIAN');
check('n_families = 5 (low excluded)',     seg.n_families === 5);
check('n_mendelian = 3',                   seg.n_mendelian === 3);
check('n_distorted = 1',                   seg.n_distorted === 1);
check('n_other = 1 (the AMBIGUOUS row)',   seg.n_other === 1);

// Only-low-reliability rows → missing
const allLow = [
  { reliability: 'low', segregation_status: 'DISTORTED' },
  { reliability: 'low', segregation_status: 'MENDELIAN' },
];
check('all low-reliability → missing',     extractSegregationStatusMajority(allLow) === AXIS_MISSING);

// =====================================================================
group('extractArrangementN — tab roll-up');

const tab = {
  arrangement_sizes: [60, 106, 60],
  n_uncalled: 0,
  n_samples:  226,
};
const arr = extractArrangementN(tab);
check('arrangement_n: count = 3',          arr.n_arrangements === 3);
check('arrangement_n: n_uncalled = 0',     arr.n_uncalled === 0);
check('arrangement_n: fraction = 0',       arr.fraction_uncalled === 0);

const tabUncalled = {
  arrangement_sizes: [50, 50],
  n_uncalled: 10,
  n_samples:  110,
};
const arrU = extractArrangementN(tabUncalled);
check('arrangement_n: n_uncalled = 10',    arrU.n_uncalled === 10);
check('arrangement_n: fraction ≈ 0.091',
      Math.abs(arrU.fraction_uncalled - 10/110) < 1e-9);

// =====================================================================
group('buildInversionClassificationRow — full fixture');

const candidate = {
  candidate_id: 'INV_LG28_001',
  chrom: 'LG28',
  start_bp: 15030000,
  end_bp:   17890000,
  inversion_type: 'paracentric',
};
const fullInputs = {
  breakpoint_mechanism: { label: 'NAHR-compatible' },
  copy_origin_summary:  { verdict: 'arrangement-specific SD mosaic' },
  regime_position:      { label: 'pericentromeric' },
  regime_structure:     { label: 'simple_haplotype_split' },
  functional_burden:    { summary_tag: 'clean' },
  busco_4d_age:         buscoBlock,
  family_rows:          familyRows,
  divergence_label:     'strong_divergence',
  xpehh_label:          'no_signal',
  arrangement_sizes:    tab,
};
const row = buildInversionClassificationRow(candidate, fullInputs);
check('row.candidate_id passed through',  row.candidate_id === 'INV_LG28_001');
check('row.chrom passed through',         row.chrom === 'LG28');
check('row.start_bp passed through',      row.start_bp === 15030000);
check('row.inversion_type passed through',row.inversion_type === 'paracentric');
check('row has all 10 axes',              Object.keys(row.axes).length === 10);
check('axes.origin_mechanism filled',     row.axes.origin_mechanism === 'NAHR-compatible');
check('axes.copy_origin_verdict filled',
      row.axes.copy_origin_verdict === 'arrangement-specific SD mosaic');
check('axes.age_my_bracket structured',   row.axes.age_my_bracket && row.axes.age_my_bracket.mu_mid_my === 1.30);
check('axes.segregation_status_majority filled',
      row.axes.segregation_status_majority && row.axes.segregation_status_majority.status === 'MENDELIAN');
check('coverage.n_present = 10',          row.coverage.n_present === 10);
check('coverage.fraction = 1.0',          row.coverage.fraction === 1);
check('module_version set',               row.module_version === INVERSION_CLASSIFICATION_VERSION);
check('created_at is ISO string',         typeof row.created_at === 'string' && row.created_at.includes('T'));

// =====================================================================
group('buildInversionClassificationRow — partial coverage');

const partialRow = buildInversionClassificationRow(candidate, {
  breakpoint_mechanism: { label: 'NHEJ/MMEJ-compatible' },
  // Everything else missing.
});
check('partial: origin filled',           partialRow.axes.origin_mechanism === 'NHEJ/MMEJ-compatible');
check('partial: copy origin missing',     partialRow.axes.copy_origin_verdict === AXIS_MISSING);
check('partial: age missing',             partialRow.axes.age_my_bracket === AXIS_MISSING);
check('partial: coverage.n_present = 1',  partialRow.coverage.n_present === 1);
check('partial: coverage.n_total = 10',   partialRow.coverage.n_total === 10);
check('partial: fraction = 0.1',          Math.abs(partialRow.coverage.fraction - 0.1) < 1e-9);

const emptyRow = buildInversionClassificationRow(candidate, {});
check('empty inputs: 0 present',          emptyRow.coverage.n_present === 0);
check('empty inputs: no throw',           !!emptyRow);

const nullCandidate = buildInversionClassificationRow(null, fullInputs);
check('null candidate: still produces row',  nullCandidate && nullCandidate.coverage);
check('null candidate: candidate_id = null', nullCandidate.candidate_id === null);

// =====================================================================
group('bulk + filter + groupBy helpers');

const pairs = [
  { candidate: { ...candidate, candidate_id: 'C1' }, inputs: fullInputs },
  { candidate: { ...candidate, candidate_id: 'C2' }, inputs: { breakpoint_mechanism: { label: 'NAHR-compatible' } } },
  { candidate: { ...candidate, candidate_id: 'C3' }, inputs: {} },
];
const rows = buildClassificationRows(pairs);
check('bulk: 3 rows produced',            rows.length === 3);
check('bulk: ids preserved',
      rows[0].candidate_id === 'C1'
   && rows[1].candidate_id === 'C2'
   && rows[2].candidate_id === 'C3');

const filtered = filterByCoverage(rows, 0.5);
check('filter ≥ 0.5: keeps C1 (full)',    filtered.length === 1 && filtered[0].candidate_id === 'C1');

const groups = groupByAxis(rows, 'origin_mechanism');
check('group by origin_mechanism: 2 NAHR rows',
      groups['NAHR-compatible'] && groups['NAHR-compatible'].length === 2);
check('group by origin_mechanism: 1 missing',
      groups['__missing__'] && groups['__missing__'].length === 1);

// Group by a structured axis (age_my_bracket) → __object__ key
const ageGroups = groupByAxis(rows, 'age_my_bracket');
check('group by age (structured): C1 under __object__',
      ageGroups['__object__'] && ageGroups['__object__'].length === 1);

// Unknown axis → empty
check('unknown axis → empty group',       Object.keys(groupByAxis(rows, 'fake_axis')).length === 0);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
