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
  CLASSIFICATION_AXIS_GROUPS,
  AXIS_MISSING,
  INVERSION_CLASSIFICATION_VERSION,
  EVOLUTIONARY_ROLES,
  PANGENOME_CLASSES,
  PANGENOME_DEFAULTS,
  EVOLUTIONARY_ROLE_DEFAULTS,
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
  classifyPangenomeClass,
  classifyEvolutionaryRole,
  buildInversionClassificationRow,
  buildClassificationRows,
  filterByCoverage,
  groupByAxis,
  axesByGroup,
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
check('14 axes defined',                  CLASSIFICATION_AXES.length === 14);
check('AXIS_MISSING is null',             AXIS_MISSING === null);
check('module version v1.3',              INVERSION_CLASSIFICATION_VERSION === 'inversion_classification_v1.3');

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
// Phylogenetic-confound fixture: 30 samples with karyotype label
// orthogonal to clade label → INDEPENDENT verdict, fully populates the
// axis.
const phyloKaryo  = new Array(30).fill(0).map((_, i) => Math.floor(i / 3) % 3);
const phyloClades = new Array(30).fill(0).map((_, i) => 'c' + (i % 6));

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
  karyotype_per_sample: phyloKaryo,
  clade_per_sample:     phyloClades,
};
const row = buildInversionClassificationRow(candidate, fullInputs);
check('row.candidate_id passed through',  row.candidate_id === 'INV_LG28_001');
check('row.chrom passed through',         row.chrom === 'LG28');
check('row.start_bp passed through',      row.start_bp === 15030000);
check('row.inversion_type passed through',row.inversion_type === 'paracentric');
check('row has all 14 axes',              Object.keys(row.axes).length === 14);
check('axes.origin_mechanism filled',     row.axes.origin_mechanism === 'NAHR-compatible');
check('axes.copy_origin_verdict filled',
      row.axes.copy_origin_verdict === 'arrangement-specific SD mosaic');
check('axes.age_my_bracket structured',   row.axes.age_my_bracket && row.axes.age_my_bracket.mu_mid_my === 1.30);
check('axes.segregation_status_majority filled',
      row.axes.segregation_status_majority && row.axes.segregation_status_majority.status === 'MENDELIAN');
check('axes.evolutionary_role filled',
      typeof row.axes.evolutionary_role === 'string');
check('coverage.n_present ≥ 11',          row.coverage.n_present >= 11);
check('coverage.fraction ≥ 0.9',          row.coverage.fraction >= 0.9);
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
// evolutionary_role is always set (UNCLASSIFIED fallback when evidence is thin)
// → with only mechanism filled, expect 2 axes present: origin_mechanism +
// evolutionary_role.
check('partial: coverage.n_present = 2',  partialRow.coverage.n_present === 2);
check('partial: coverage.n_total = 14',   partialRow.coverage.n_total === 14);
check('partial: fraction = 2/14',         Math.abs(partialRow.coverage.fraction - 2/14) < 1e-9);

const emptyRow = buildInversionClassificationRow(candidate, {});
// evolutionary_role is always set → 1 axis even on empty inputs.
check('empty inputs: 1 present (role UNCLASSIFIED)', emptyRow.coverage.n_present === 1);
check('empty inputs: no throw',           !!emptyRow);
check('empty inputs: role = unclassified',
      emptyRow.axes.evolutionary_role === 'unclassified');

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
group('CLASSIFICATION_AXIS_GROUPS — 4 buckets covering all axes');

check('groups frozen',                Object.isFrozen(CLASSIFICATION_AXIS_GROUPS));
check('ORIGIN / STRUCTURE / FATE / ROLE keys',
      'ORIGIN' in CLASSIFICATION_AXIS_GROUPS
   && 'STRUCTURE' in CLASSIFICATION_AXIS_GROUPS
   && 'FATE' in CLASSIFICATION_AXIS_GROUPS
   && 'ROLE' in CLASSIFICATION_AXIS_GROUPS);

const flat = new Set(CLASSIFICATION_AXES);
const grouped = new Set();
for (const arr of Object.values(CLASSIFICATION_AXIS_GROUPS)) {
  for (const k of arr) grouped.add(k);
}
check('every grouped axis is in flat',
      [...grouped].every(k => flat.has(k)));
check('every flat axis is in some group',
      [...flat].every(k => grouped.has(k)));
check('no duplicates across groups',
      grouped.size === CLASSIFICATION_AXES.length);

const grouped_row = axesByGroup(row);
check('axesByGroup returns 4 buckets',
      Object.keys(grouped_row).length === 4);
check('ORIGIN bucket has origin_mechanism',
      grouped_row.ORIGIN && 'origin_mechanism' in grouped_row.ORIGIN);
check('ROLE bucket has evolutionary_role',
      grouped_row.ROLE && 'evolutionary_role' in grouped_row.ROLE);
check('flat axes still intact after grouping',
      Object.keys(row.axes).length === 14);

check('axesByGroup(null) = {}',     Object.keys(axesByGroup(null)).length === 0);

// =====================================================================
group('vocab — PANGENOME + EVOLUTIONARY_ROLES');

check('PANGENOME_CLASSES frozen',         Object.isFrozen(PANGENOME_CLASSES));
check('EVOLUTIONARY_ROLES frozen',        Object.isFrozen(EVOLUTIONARY_ROLES));
check('PANGENOME_DEFAULTS frozen',        Object.isFrozen(PANGENOME_DEFAULTS));
check('PRIVATE / CO_SHARED / GENERAL / UNKNOWN',
      'PRIVATE' in PANGENOME_CLASSES
   && 'CO_SHARED' in PANGENOME_CLASSES
   && 'GENERAL' in PANGENOME_CLASSES
   && 'UNKNOWN' in PANGENOME_CLASSES);
check('7 evolutionary roles (6 + unclassified)',
      Object.keys(EVOLUTIONARY_ROLES).length === 7);

// =====================================================================
group('classifyPangenomeClass');

// 10 populations, only 1 carries → private
const private_freq = [
  { population: 'P1', freq: 0.30, n: 30 },
  { population: 'P2', freq: 0.0,  n: 30 },
  { population: 'P3', freq: 0.0,  n: 30 },
  { population: 'P4', freq: 0.0,  n: 30 },
  { population: 'P5', freq: 0.0,  n: 30 },
  { population: 'P6', freq: 0.0,  n: 30 },
  { population: 'P7', freq: 0.0,  n: 30 },
  { population: 'P8', freq: 0.0,  n: 30 },
  { population: 'P9', freq: 0.0,  n: 30 },
  { population: 'P10', freq: 0.0, n: 30 },
];
const pcPriv = classifyPangenomeClass(private_freq);
check('1/10 populations → PRIVATE',         pcPriv.class === PANGENOME_CLASSES.PRIVATE);
check('PRIVATE: n_carrier = 1',             pcPriv.n_carrier === 1);
check('PRIVATE: fraction = 0.1',            Math.abs(pcPriv.fraction_carrier - 0.1) < 1e-9);

// 5/10 populations carry — co_shared
const co_freq = [
  { population: 'P1', freq: 0.40, n: 30 },
  { population: 'P2', freq: 0.35, n: 30 },
  { population: 'P3', freq: 0.30, n: 30 },
  { population: 'P4', freq: 0.45, n: 30 },
  { population: 'P5', freq: 0.30, n: 30 },
  { population: 'P6', freq: 0.0,  n: 30 },
  { population: 'P7', freq: 0.0,  n: 30 },
  { population: 'P8', freq: 0.0,  n: 30 },
  { population: 'P9', freq: 0.0,  n: 30 },
  { population: 'P10', freq: 0.0, n: 30 },
];
const pcCo = classifyPangenomeClass(co_freq);
check('5/10 populations → CO_SHARED',       pcCo.class === PANGENOME_CLASSES.CO_SHARED);

// 9/10 populations at high freq → general
const gen_freq = Array.from({length: 10}, (_, i) =>
  ({ population: 'P' + i, freq: i < 9 ? 0.70 : 0.0, n: 30 }));
const pcGen = classifyPangenomeClass(gen_freq);
check('9/10 high-freq populations → GENERAL', pcGen.class === PANGENOME_CLASSES.GENERAL);

// Edge: no data
check('null → missing',           classifyPangenomeClass(null) === AXIS_MISSING);
check('empty array → missing',    classifyPangenomeClass([]) === AXIS_MISSING);

// Edge: every population has n < 5 → UNKNOWN
const low_n = [
  { population: 'P1', freq: 0.50, n: 2 },
  { population: 'P2', freq: 0.40, n: 3 },
];
check('all n<5 → UNKNOWN class',
      classifyPangenomeClass(low_n).class === PANGENOME_CLASSES.UNKNOWN);

// =====================================================================
group('classifyEvolutionaryRole — rule-by-rule');

// Rule 1: speciation_barrier — old + strong divergence + DISTORTED
check('old + strong_div + DISTORTED → speciation_barrier',
      classifyEvolutionaryRole({
        age_my_bracket: { mu_mid_my: 5.0 },
        divergence:     'strong_divergence',
        segregation_status_majority: { status: 'DISTORTED' },
      }) === EVOLUTIONARY_ROLES.SPECIATION_BARRIER);

// Rule 2: supergene — load_rich + CO_SHARED + MENDELIAN
check('load_rich + co_shared + MENDELIAN → supergene',
      classifyEvolutionaryRole({
        selection_efficacy: 'load_rich',
        pangenome_class:    { class: PANGENOME_CLASSES.CO_SHARED },
        segregation_status_majority: { status: 'MENDELIAN' },
      }) === EVOLUTIONARY_ROLES.SUPERGENE);

// Rule 3: local_adaptation_container — load_rich + xpehh mild
check('load_rich + mild xpehh → local_adaptation_container',
      classifyEvolutionaryRole({
        selection_efficacy: 'load_rich',
        xpehh_signal: 'mild_outlier',
      }) === EVOLUTIONARY_ROLES.LOCAL_ADAPTATION_CONTAINER);

// Rule 4: ecotype_stabilizer — co_shared + simple/dosage structure
check('co_shared + simple_haplotype_split → ecotype_stabilizer',
      classifyEvolutionaryRole({
        pangenome_class: { class: PANGENOME_CLASSES.CO_SHARED },
        structure_class: 'simple_haplotype_split',
      }) === EVOLUTIONARY_ROLES.ECOTYPE_STABILIZER);

// Rule 5: recombination_modifier — strong_div but selection != load_rich
check('strong_div + clean → recombination_modifier',
      classifyEvolutionaryRole({
        divergence: 'strong_divergence',
        selection_efficacy: 'clean',
      }) === EVOLUTIONARY_ROLES.RECOMBINATION_MODIFIER);

// Rule 6: neutral_passenger
check('young + clean + no_div + no_xpehh → neutral_passenger',
      classifyEvolutionaryRole({
        age_my_bracket: { mu_mid_my: 0.3 },
        selection_efficacy: 'clean',
        divergence: 'no_divergence',
        xpehh_signal: 'no_signal',
      }) === EVOLUTIONARY_ROLES.NEUTRAL_PASSENGER);

// Default: unclassified
check('empty axes → unclassified',
      classifyEvolutionaryRole({}) === EVOLUTIONARY_ROLES.UNCLASSIFIED);
check('null axes → unclassified',
      classifyEvolutionaryRole(null) === EVOLUTIONARY_ROLES.UNCLASSIFIED);

// Rule precedence: speciation_barrier wins over recombination_modifier
check('precedence: speciation_barrier beats recombination_modifier',
      classifyEvolutionaryRole({
        age_my_bracket: { mu_mid_my: 5.0 },
        divergence: 'strong_divergence',
        selection_efficacy: 'clean',
        segregation_status_majority: { status: 'DISTORTED' },
      }) === EVOLUTIONARY_ROLES.SPECIATION_BARRIER);

// =====================================================================
group('end-to-end with pangenome + role');

// Run the full fixture again WITH pangenome input — should classify as
// supergene (load_rich + co_shared + MENDELIAN).
const role_row = buildInversionClassificationRow(
  { ...candidate, candidate_id: 'INV_SUPERGENE_001' },
  { ...fullInputs,
    functional_burden: { summary_tag: 'load_rich' },
    freq_by_pop: co_freq,
  },
);
check('supergene fixture: pangenome_class = co_shared',
      role_row.axes.pangenome_class
   && role_row.axes.pangenome_class.class === PANGENOME_CLASSES.CO_SHARED);
check('supergene fixture: evolutionary_role = supergene',
      role_row.axes.evolutionary_role === EVOLUTIONARY_ROLES.SUPERGENE);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
