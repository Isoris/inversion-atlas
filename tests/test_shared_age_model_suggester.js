// tests/test_shared_age_model_suggester.js
//
// Unit coverage for shared/age_model_suggester.js — the 5-rule
// inversion-age inference engine (legacy _msAutoSuggestAgeModel).

import {
  AGE_MODELS,
  CONFIDENCE,
  LINEAGE_KARYO_VERDICTS,
  deriveAgeSignals,
  suggestAgeModel,
} from '../atlases/evolution/shared/age_model_suggester.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab + constants');

check('AGE_MODELS frozen',          Object.isFrozen(AGE_MODELS));
check('CONFIDENCE frozen',          Object.isFrozen(CONFIDENCE));
check('LINEAGE_KARYO_VERDICTS frozen',
      Object.isFrozen(LINEAGE_KARYO_VERDICTS));
check('5 age models present',
      AGE_MODELS.LINEAGE_KARYO === 'LINEAGE-KARYO'
      && AGE_MODELS.MULTI_AGE_HOTSPOT === 'MULTI-AGE-HOTSPOT'
      && AGE_MODELS.OLD_BP_YOUNG_INV === 'OLD-BP-YOUNG-INV'
      && AGE_MODELS.OLD_POLY === 'OLD-POLY'
      && AGE_MODELS.YOUNG_POP === 'YOUNG-POP');
check('focal_lineage_fission listed',
      LINEAGE_KARYO_VERDICTS.indexOf('focal_lineage_fission') >= 0);
check('ancestral_split_both_retained listed',
      LINEAGE_KARYO_VERDICTS.indexOf('ancestral_split_both_retained') >= 0);
check('cgar_ legacy alias kept',
      LINEAGE_KARYO_VERDICTS.indexOf('cgar_lineage_fission') >= 0);

// =====================================================================
group('deriveAgeSignals — empty / null inputs');

const s0 = deriveAgeSignals(null, null, null);
check('all-null: n_total = 0',     s0.n_total === 0);
check('all-null: n_present = 0',   s0.n_present === 0);
check('all-null: fold_elevation = null',
      s0.fold_elevation === null);
check('all-null: karyo_verdict = null',
      s0.karyo_verdict === null);
check('all-null: has_mixed = false',
      s0.has_mixed_event_types === false);

// =====================================================================
group('deriveAgeSignals — counting');

const dist1 = {
  sp1: 'boundary_present',
  sp2: 'boundary_present',
  sp3: 'fission_to_4',
  sp4: 'fusion_with_5',
  sp5: 'absent',
};
const s1 = deriveAgeSignals(dist1, null, null);
check('n_total = 5',               s1.n_total === 5);
check('n_present = 2',             s1.n_present === 2);
check('n_fission = 1',             s1.n_fission === 1);
check('n_fusion = 1',              s1.n_fusion === 1);
check('n_rearrangement_types = 3',
      s1.n_rearrangement_types === 3);
check('has_mixed_event_types',     s1.has_mixed_event_types === true);

// dxy + karyo signals
const s2 = deriveAgeSignals(null,
  { fold_elevation_inside_vs_flank: 2.5, dxy_within_inversion_ref_vs_inv: 0.04 },
  { verdict: 'focal_lineage_fission' });
check('fold_elevation extracted',  s2.fold_elevation === 2.5);
check('dxy_within extracted',      s2.dxy_within === 0.04);
check('karyo_verdict extracted',
      s2.karyo_verdict === 'focal_lineage_fission');

// Non-string state values shouldn't crash counts
const distOdd = { sp1: null, sp2: undefined, sp3: 42, sp4: 'fission_x' };
const sOdd = deriveAgeSignals(distOdd, null, null);
check('non-string states tolerated',
      sOdd.n_total === 4 && sOdd.n_fission === 1);

// =====================================================================
group('suggestAgeModel — null breakpoint');

const r0 = suggestAgeModel(null, null, null, null);
check('null bp: age_model = null',  r0.age_model === null);
check('null bp: confidence unknown', r0.confidence === CONFIDENCE.UNKNOWN);
check('null bp: rationale set',     typeof r0.rationale === 'string'
                                     && r0.rationale.length > 0);

// =====================================================================
group('RULE 0 — LINEAGE-KARYO via karyo verdict');

const r0a = suggestAgeModel(
  { event_type: 'inversion' }, null, null,
  { verdict: 'focal_lineage_fission' });
check('focal_lineage_fission → LINEAGE-KARYO',
      r0a.age_model === AGE_MODELS.LINEAGE_KARYO);
check('confidence high',            r0a.confidence === CONFIDENCE.HIGH);
check('rationale mentions verdict',
      r0a.rationale.indexOf('focal lineage fission') >= 0);

const r0b = suggestAgeModel(
  { event_type: 'inversion' }, null, null,
  { verdict: 'cgar_lineage_fission' });
check('legacy cgar_ alias → LINEAGE-KARYO',
      r0b.age_model === AGE_MODELS.LINEAGE_KARYO);

const r0c = suggestAgeModel(
  { event_type: 'inversion' }, null, null,
  { verdict: 'recurrent_fission_hotspot' });
check('recurrent_fission_hotspot → MULTI-AGE-HOTSPOT',
      r0c.age_model === AGE_MODELS.MULTI_AGE_HOTSPOT);
check('recurrent hotspot: confidence high',
      r0c.confidence === CONFIDENCE.HIGH);
check('recurrent hotspot: rationale set',
      r0c.rationale.indexOf('recurrent fission hotspot') >= 0);

const r0d = suggestAgeModel(
  { event_type: 'inversion' }, null, null,
  { verdict: 'no_karyotype_change' });
// no_karyotype_change does NOT short-circuit; with no other signals
// it falls through to fallback.
check('no_karyotype_change does not short-circuit',
      r0d.age_model === null);

// =====================================================================
group('RULE 1 — MULTI-AGE-HOTSPOT (mixed event types ≥ 3 species)');

const distMixed = {
  sp1: 'boundary_present', sp2: 'boundary_present',
  sp3: 'fission_to_4', sp4: 'fusion_with_5',
};
const r1 = suggestAgeModel({ event_type: 'inversion' }, distMixed, null, null);
check('3+ mixed types → MULTI-AGE-HOTSPOT',
      r1.age_model === AGE_MODELS.MULTI_AGE_HOTSPOT);
check('confidence medium',          r1.confidence === CONFIDENCE.MEDIUM);

// Only 2 boundary_present + 1 fission still triggers (n=3, types=2)
const distEdge = {
  sp1: 'boundary_present', sp2: 'boundary_present', sp3: 'fission_x',
};
const r1b = suggestAgeModel({ event_type: 'inversion' }, distEdge, null, null);
check('2 present + 1 fission → MULTI-AGE-HOTSPOT',
      r1b.age_model === AGE_MODELS.MULTI_AGE_HOTSPOT);

// Only 2 species total — doesn't qualify
const distSmall = {
  sp1: 'boundary_present', sp2: 'fission_x',
};
const r1c = suggestAgeModel({ event_type: 'inversion' }, distSmall, null, null);
check('2 species mixed: NOT hotspot',
      r1c.age_model !== AGE_MODELS.MULTI_AGE_HOTSPOT);

// =====================================================================
group('RULE 2 — LINEAGE-KARYO (event is fission/fusion)');

const distOneFission = { sp1: 'fission_to_4' };
const r2 = suggestAgeModel({ event_type: 'fission' }, distOneFission, null, null);
check('fission event + 1 species → LINEAGE-KARYO',
      r2.age_model === AGE_MODELS.LINEAGE_KARYO);
check('rule-2 confidence medium',   r2.confidence === CONFIDENCE.MEDIUM);

// event_type_refined takes precedence
const r2b = suggestAgeModel(
  { event_type: 'inversion', event_type_refined: 'fusion' },
  { sp1: 'fusion_x' }, null, null);
check('event_type_refined overrides event_type',
      r2b.age_model === AGE_MODELS.LINEAGE_KARYO);

// fission keyword in event_type ("fission_balanced") still triggers
const r2c = suggestAgeModel(
  { event_type: 'fission_balanced' },
  { sp1: 'fission_x' }, null, null);
check('"fission_balanced" event triggers rule-2',
      r2c.age_model === AGE_MODELS.LINEAGE_KARYO);

// inversion event type does NOT trigger rule-2 even with fission count
const r2d = suggestAgeModel(
  { event_type: 'inversion' },
  { sp1: 'fission_x' }, null, null);
check('inversion + fission count: NOT rule-2',
      r2d.age_model !== AGE_MODELS.LINEAGE_KARYO);

// =====================================================================
group('RULE 3 — OLD-BP-YOUNG-INV (≥3 share, dXY low/null)');

const distShared = {
  sp1: 'boundary_present', sp2: 'boundary_present',
  sp3: 'boundary_present', sp4: 'absent',
};
const r3 = suggestAgeModel({ event_type: 'inversion' }, distShared, null, null);
check('3 share, no dXY → OLD-BP-YOUNG-INV',
      r3.age_model === AGE_MODELS.OLD_BP_YOUNG_INV);
check('no dXY → confidence low',    r3.confidence === CONFIDENCE.LOW);

const r3b = suggestAgeModel({ event_type: 'inversion' }, distShared,
  { fold_elevation_inside_vs_flank: 1.0 }, null);
check('3 share + dXY 1.0 → OLD-BP-YOUNG-INV',
      r3b.age_model === AGE_MODELS.OLD_BP_YOUNG_INV);
check('dXY present → confidence medium',
      r3b.confidence === CONFIDENCE.MEDIUM);
check('rationale shows fold value',
      r3b.rationale.indexOf('1.00') >= 0);

// 2 species shared — does NOT qualify for rule 3, falls through
const distTwoShared = {
  sp1: 'boundary_present', sp2: 'boundary_present',
};
const r3c = suggestAgeModel({ event_type: 'inversion' }, distTwoShared,
  { fold_elevation_inside_vs_flank: 1.0 }, null);
check('2 share: NOT rule-3',
      r3c.age_model !== AGE_MODELS.OLD_BP_YOUNG_INV);

// =====================================================================
group('RULE 4 — OLD-POLY (dXY ≥ 1.5 AND ≥2 share)');

const r4 = suggestAgeModel({ event_type: 'inversion' },
  { sp1: 'boundary_present', sp2: 'boundary_present' },
  { fold_elevation_inside_vs_flank: 2.5 }, null);
check('dXY 2.5 + 2 share → OLD-POLY',
      r4.age_model === AGE_MODELS.OLD_POLY);
check('rule-4 confidence medium',   r4.confidence === CONFIDENCE.MEDIUM);
check('rationale mentions 2.50',    r4.rationale.indexOf('2.50') >= 0);

// dXY high but only 1 species → doesn't trigger
const r4b = suggestAgeModel({ event_type: 'inversion' },
  { sp1: 'boundary_present' },
  { fold_elevation_inside_vs_flank: 2.5 }, null);
check('dXY high + 1 species: NOT OLD-POLY',
      r4b.age_model !== AGE_MODELS.OLD_POLY);

// =====================================================================
group('RULE 5 — YOUNG-POP (dXY < 1.2, ≤ 1 species)');

const r5 = suggestAgeModel({ event_type: 'inversion' },
  { sp1: 'absent' },
  { fold_elevation_inside_vs_flank: 1.0 }, null);
check('dXY 1.0 + 0 shared → YOUNG-POP',
      r5.age_model === AGE_MODELS.YOUNG_POP);
check('rule-5 confidence medium',   r5.confidence === CONFIDENCE.MEDIUM);

const r5b = suggestAgeModel({ event_type: 'inversion' },
  { sp1: 'boundary_present' },
  { fold_elevation_inside_vs_flank: 0.8 }, null);
check('dXY low + 1 share → YOUNG-POP',
      r5b.age_model === AGE_MODELS.YOUNG_POP);

// dXY moderate (1.3) → between rules; doesn't fit 4 or 5
const r5c = suggestAgeModel({ event_type: 'inversion' },
  { sp1: 'absent' },
  { fold_elevation_inside_vs_flank: 1.3 }, null);
check('dXY 1.3 + 0 share → no model (gap)',
      r5c.age_model === null);

// =====================================================================
group('fallback — insufficient evidence');

const rf1 = suggestAgeModel({ event_type: 'inversion' }, null, null, null);
check('no inputs: age_model = null', rf1.age_model === null);
check('rationale names dXY + synteny',
      rf1.rationale.indexOf('dxy_per_inversion') >= 0
      && rf1.rationale.indexOf('synteny_multispecies') >= 0);

const rf2 = suggestAgeModel({ event_type: 'inversion' },
  { sp1: 'absent' }, null, null);
check('lineage only: rationale names dXY',
      rf2.rationale.indexOf('dxy_per_inversion') >= 0);

const rf3 = suggestAgeModel({ event_type: 'inversion' }, null,
  { fold_elevation_inside_vs_flank: 1.3 }, null);
check('dxy only: rationale names synteny',
      rf3.rationale.indexOf('synteny_multispecies') >= 0);

// =====================================================================
group('opts.esc — custom escaper');

// The rationale string is built with the provided escaper for any
// user-controlled text (the karyo verdict string in rule 0,
// event_type in rule 2). Default escaper handles <, >, &, ".
const rEsc = suggestAgeModel(
  { event_type: 'fission<tag>' },
  { sp1: 'fission_x' }, null, null);
check('default esc: < / > escaped',
      rEsc.rationale.indexOf('fission&lt;tag&gt;') >= 0);

const identityEsc = s => String(s);
const rEsc2 = suggestAgeModel(
  { event_type: 'fission<tag>' },
  { sp1: 'fission_x' }, null, null,
  { esc: identityEsc });
check('custom esc: raw passed through',
      rEsc2.rationale.indexOf('fission<tag>') >= 0);

// =====================================================================
group('signals always attached');

const rSig = suggestAgeModel({ event_type: 'inversion' },
  { sp1: 'boundary_present', sp2: 'boundary_present' },
  { fold_elevation_inside_vs_flank: 2.0 }, null);
check('signals present',            rSig.signals && typeof rSig.signals === 'object');
check('signals.fold_elevation = 2', rSig.signals.fold_elevation === 2.0);
check('signals.n_present = 2',      rSig.signals.n_present === 2);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
