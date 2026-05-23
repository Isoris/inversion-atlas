// tests/test_shared_band_tracking_layer4_integration.js
//
// Unit coverage for the three Layer-4 integration helpers added to
// regime_mendelian.js: computeFamilyReliabilityTier (SPEC §4.1),
// rollupEffectDirection (SPEC §8 Q3), and annotateRegimeMendelianAll
// (combined trios+families+dyads orchestrator).

import {
  FAMILY_RELIABILITY_TIERS,
  FAMILY_RELIABILITY_DEFAULTS,
  computeFamilyReliabilityTier,
  rollupEffectDirection,
  annotateRegimeMendelianAll,
  TRIO_SUPPORT_STATUS,
} from '../atlases/popstats/shared/band_tracking/regime_mendelian.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
// Shared regime fixture: 50 AA + 50 AB + 50 BB, 150 total
// =====================================================================
function mkAASet(start, n) { const s = new Set(); for (let i = 0; i < n; i++) s.add(start + i); return s; }
const regime = {
  regime_id: 0,
  hom_a_intersect: mkAASet(0, 50),
  hom_b_intersect: mkAASet(50, 50),
  het_union:       mkAASet(100, 50),
  start_bp: 1_000_000, end_bp: 5_000_000,
};

// =====================================================================
group('vocab + defaults');

check('FAMILY_RELIABILITY_TIERS frozen',
      Object.isFrozen(FAMILY_RELIABILITY_TIERS));
check('FAMILY_RELIABILITY_DEFAULTS frozen',
      Object.isFrozen(FAMILY_RELIABILITY_DEFAULTS));
check('offspring_high = 20',
      FAMILY_RELIABILITY_DEFAULTS.offspring_high === 20);
check('call_rate_high = 0.90',
      FAMILY_RELIABILITY_DEFAULTS.call_rate_high === 0.90);

// =====================================================================
group('computeFamilyReliabilityTier — high tier (all axes high)');

// Both parents called (samples 0 + 100), ≥20 offspring all in regime,
// 3 karyotype classes populated.
const fam_high = {
  family_id: 'F_high',
  parents: [0, 100],   // AA + AB
  offspring: Array.from({ length: 25 }, (_, i) => i),  // 25 AA samples, all in regime
};
const r_high = computeFamilyReliabilityTier(fam_high, regime);
check('all-high → tier HIGH',         r_high.tier === FAMILY_RELIABILITY_TIERS.HIGH);
check('axes.parents = high',           r_high.axes.parents === FAMILY_RELIABILITY_TIERS.HIGH);
check('axes.offspring_n = high',       r_high.axes.offspring_n === FAMILY_RELIABILITY_TIERS.HIGH);
check('axes.call_rate = high',         r_high.axes.call_rate === FAMILY_RELIABILITY_TIERS.HIGH);
check('axes.karyotype_clarity = high', r_high.axes.karyotype_clarity === FAMILY_RELIABILITY_TIERS.HIGH);
check('n_offspring = 25',              r_high.n_offspring === 25);
check('call_rate = 1',                 r_high.call_rate === 1);

// =====================================================================
group('computeFamilyReliabilityTier — offspring count tiers');

const fam_15 = {
  family_id: 'F_15', parents: [0, 100],
  offspring: Array.from({ length: 15 }, (_, i) => i),
};
const r_15 = computeFamilyReliabilityTier(fam_15, regime);
check('15 offspring → medium axis',
      r_15.axes.offspring_n === FAMILY_RELIABILITY_TIERS.MEDIUM);
check('15 offspring → tier MEDIUM',    r_15.tier === FAMILY_RELIABILITY_TIERS.MEDIUM);
check('limiting_axis = offspring_n',   r_15.limiting_axis === 'offspring_n');

const fam_5 = {
  family_id: 'F_5', parents: [0, 100],
  offspring: Array.from({ length: 5 }, (_, i) => i),
};
const r_5 = computeFamilyReliabilityTier(fam_5, regime);
check('5 offspring → low axis',
      r_5.axes.offspring_n === FAMILY_RELIABILITY_TIERS.LOW);
check('5 offspring → tier LOW',        r_5.tier === FAMILY_RELIABILITY_TIERS.LOW);

// =====================================================================
group('computeFamilyReliabilityTier — call rate');

// 25 offspring but 10 are uncalled (sample indices > 149) → 60% call rate → LOW
const fam_lowcall = {
  family_id: 'F_low', parents: [0, 100],
  offspring: Array.from({ length: 25 }, (_, i) => i < 15 ? i : 1000 + i),
};
const r_lc = computeFamilyReliabilityTier(fam_lowcall, regime);
check('60% call_rate → axis low',      r_lc.axes.call_rate === FAMILY_RELIABILITY_TIERS.LOW);
check('low call_rate → tier LOW',      r_lc.tier === FAMILY_RELIABILITY_TIERS.LOW);

// =====================================================================
group('computeFamilyReliabilityTier — parent calls');

// One parent uncalled in regime
const fam_pu = {
  family_id: 'F_pu', parents: [1000, 100],   // sample 1000 uncalled
  offspring: Array.from({ length: 25 }, (_, i) => i),
};
const r_pu = computeFamilyReliabilityTier(fam_pu, regime);
check('one uncalled parent → axis medium',
      r_pu.axes.parents === FAMILY_RELIABILITY_TIERS.MEDIUM);

const fam_npu = {
  family_id: 'F_npu', parents: [1000, 2000],   // both uncalled
  offspring: Array.from({ length: 25 }, (_, i) => i),
};
const r_npu = computeFamilyReliabilityTier(fam_npu, regime);
check('both uncalled → axis low',      r_npu.axes.parents === FAMILY_RELIABILITY_TIERS.LOW);
check('both uncalled → tier LOW',      r_npu.tier === FAMILY_RELIABILITY_TIERS.LOW);

// =====================================================================
group('computeFamilyReliabilityTier — karyotype clarity');

// Regime with only 2 classes populated (no HET)
const regime2 = Object.assign({}, regime, { het_union: new Set() });
const r_2classes = computeFamilyReliabilityTier(fam_high, regime2);
check('2 classes → axis medium',
      r_2classes.axes.karyotype_clarity === FAMILY_RELIABILITY_TIERS.MEDIUM);

const regime1 = Object.assign({}, regime, {
  hom_b_intersect: new Set(), het_union: new Set(),
});
const r_1class = computeFamilyReliabilityTier(fam_high, regime1);
check('1 class → axis low',
      r_1class.axes.karyotype_clarity === FAMILY_RELIABILITY_TIERS.LOW);

// =====================================================================
group('computeFamilyReliabilityTier — confound override');

const r_confound = computeFamilyReliabilityTier(fam_high, regime,
  { confound_tier: 'low' });
check('confound=low: tier LOW',         r_confound.tier === FAMILY_RELIABILITY_TIERS.LOW);
check('limiting_axis = confound',       r_confound.limiting_axis === 'confound');

// Null / malformed inputs
check('null family → axis parents=low',
      computeFamilyReliabilityTier(null, regime).axes.parents
        === FAMILY_RELIABILITY_TIERS.LOW);

// =====================================================================
group('rollupEffectDirection');

const family_rows_clean = [
  { segregation_status: 'MENDELIAN', effect_direction: 'none' },
  { segregation_status: 'MENDELIAN', effect_direction: 'none' },
  { segregation_status: 'MENDELIAN', effect_direction: 'none' },
];
const rollup_clean = rollupEffectDirection(family_rows_clean);
check('all Mendelian: n_total = 3',     rollup_clean.n_total === 3);
check('all Mendelian: n_distorted = 0', rollup_clean.n_distorted === 0);
check('all Mendelian: by_direction.none = 3',
      rollup_clean.by_direction.none === 3);
check('all Mendelian: dominant_frac NaN',
      Number.isNaN(rollup_clean.dominant_frac));

// Mixed with BB_deficit dominant
const family_rows_mixed = [
  { segregation_status: 'MENDELIAN', effect_direction: 'none' },
  { segregation_status: 'DISTORTED', effect_direction: 'BB_deficit' },
  { segregation_status: 'DISTORTED', effect_direction: 'BB_deficit' },
  { segregation_status: 'DISTORTED', effect_direction: 'BB_deficit' },
  { segregation_status: 'DISTORTED', effect_direction: 'AA_deficit' },
  { segregation_status: 'AMBIGUOUS', effect_direction: 'AB_deficit' },
];
const rollup_mixed = rollupEffectDirection(family_rows_mixed);
check('mixed: n_total = 6',             rollup_mixed.n_total === 6);
check('mixed: n_distorted = 4',         rollup_mixed.n_distorted === 4);
check('mixed: BB_deficit = 3',          rollup_mixed.by_direction.BB_deficit === 3);
check('mixed: AA_deficit = 1',          rollup_mixed.by_direction.AA_deficit === 1);
check('dominant = BB_deficit',
      rollup_mixed.dominant_direction === 'BB_deficit');
check('dominant_frac = 3/4 = 0.75',     rollup_mixed.dominant_frac === 0.75);

check('empty rows → n_total 0',         rollupEffectDirection([]).n_total === 0);
check('null rows → n_total 0',          rollupEffectDirection(null).n_total === 0);

// =====================================================================
group('annotateRegimeMendelianAll — all methods agree MENDELIAN');

// Build a fixture where all three methods come up Mendelian.
const trios_mend = [
  // Clean Mendelian trios: AA × AB → AA, AB × AB → AB, etc.
  { father: 0, mother: 100, offspring: 1 },     // AA × AB → AA ✓
  { father: 100, mother: 101, offspring: 102 }, // AB × AB → AB ✓
  { father: 100, mother: 101, offspring: 2 },   // AB × AB → AA ✓
  { father: 0, mother: 50, offspring: 103 },    // AA × BB → AB ✓
  { father: 0, mother: 50, offspring: 104 },    // AA × BB → AB ✓
];
const families_mend = [{
  family_id: 'F_mend',
  parents: [100, 101],   // both AB
  offspring: [],
  reliability: 'high',
}];
// 1:2:1 offspring distribution
for (let i = 0; i < 8; i++)  families_mend[0].offspring.push(i % 50);          // AA
for (let i = 0; i < 16; i++) families_mend[0].offspring.push(100 + (i % 50));  // AB
for (let i = 0; i < 8; i++)  families_mend[0].offspring.push(50 + (i % 50));   // BB

const dyads_mend = [];
for (let i = 0; i < 50; i++) dyads_mend.push({ parent: 100, offspring: i });          // AA
for (let i = 0; i < 50; i++) dyads_mend.push({ parent: 100, offspring: 50 + i });     // BB

const ann_mend = annotateRegimeMendelianAll(regime, {
  trios: trios_mend,
  families: families_mend,
  dyads: dyads_mend,
}, { min_trios: 5 });

check('regime_id propagated',           ann_mend.regime_id === 0);
check('method_a populated',              ann_mend.method_a !== undefined);
check('method_b populated',              ann_mend.method_b !== undefined);
check('method_4d populated',             ann_mend.method_4d !== undefined);
check('effect_rollup populated',         ann_mend.effect_rollup !== undefined);
check('n_methods_run = 3',               ann_mend.n_methods_run === 3);
check('methods_agree_mendelian = true',  ann_mend.methods_agree_mendelian === true);
check('methods_agree_distorted = false', ann_mend.methods_agree_distorted === false);
check('summary_verdict = mendelian',     ann_mend.summary_verdict === 'mendelian');

// =====================================================================
group('annotateRegimeMendelianAll — partial methods');

// Only trios → only method_a, summary_verdict mendelian if A supports
const ann_trios_only = annotateRegimeMendelianAll(regime,
  { trios: trios_mend }, { min_trios: 5 });
check('only trios: method_b absent',     ann_trios_only.method_b === undefined);
check('only trios: n_methods_run = 1',   ann_trios_only.n_methods_run === 1);
check('only trios + SUPPORTED → mendelian',
      ann_trios_only.summary_verdict === 'mendelian');

// No methods supplied
const ann_none = annotateRegimeMendelianAll(regime, {});
check('no methods → n_methods_run = 0',  ann_none.n_methods_run === 0);
check('no methods → insufficient_data',  ann_none.summary_verdict === 'insufficient_data');

// =====================================================================
group('annotateRegimeMendelianAll — methods disagree → mixed');

// Trios all contradict (AA × AA → BB), but families look Mendelian.
const trios_bad = [
  { father: 0, mother: 1, offspring: 50 },   // AA × AA → BB: BAD
  { father: 0, mother: 1, offspring: 51 },
  { father: 0, mother: 1, offspring: 52 },
  { father: 0, mother: 1, offspring: 53 },
  { father: 0, mother: 1, offspring: 54 },
];
const ann_disagree = annotateRegimeMendelianAll(regime, {
  trios: trios_bad,
  families: families_mend,  // still Mendelian
}, { min_trios: 5 });
check('A=CONTRADICTED, B=MENDELIAN → mixed',
      ann_disagree.summary_verdict === 'mixed');
check('methods_agree_mendelian = false', ann_disagree.methods_agree_mendelian === false);
check('methods_agree_distorted = false', ann_disagree.methods_agree_distorted === false);

// =====================================================================
group('annotateRegimeMendelianAll — all methods agree DISTORTED');

// Build a fixture where all methods say "distorted":
// - Trios: 5 contradictions → A=CONTRADICTED
// - Families: 100% distorted (very skewed offspring)
// - Dyads: strong drive
const families_dist = [{
  family_id: 'F_dist',
  parents: [100, 101],
  offspring: [],
  reliability: 'high',
}];
// 12 AA, 30 AB, 1 BB → SPEC §2.1 worked example
for (let i = 0; i < 12; i++) families_dist[0].offspring.push(i % 50);
for (let i = 0; i < 30; i++) families_dist[0].offspring.push(100 + (i % 50));
families_dist[0].offspring.push(50);

const dyads_drive = [];
for (let i = 0; i < 80; i++) dyads_drive.push({ parent: 100, offspring: i % 50 });        // AA
for (let i = 0; i < 20; i++) dyads_drive.push({ parent: 100, offspring: 50 + (i % 50) }); // BB

const ann_dist = annotateRegimeMendelianAll(regime, {
  trios: trios_bad,           // contradictions
  families: families_dist,    // mostly distorted
  dyads: dyads_drive,         // strong drive
}, { min_trios: 5 });

check('all-distorted: method_a CONTRADICTED',
      ann_dist.method_a.support_status === TRIO_SUPPORT_STATUS.CONTRADICTED);
check('all-distorted: summary_verdict mixed or distorted',
      ann_dist.summary_verdict === 'mixed'
      || ann_dist.summary_verdict === 'distorted');

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
