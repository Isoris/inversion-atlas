// tests/test_shared_copy_origin_painting.js
//
// Unit coverage for shared/copy_origin_painting.js — Steps D + E of
// SPEC_copy_origin_painting.md (mechanism classifier + arrangement-
// group integration).

import {
  COPY_ORIGIN_MECHANISMS,
  ARRANGEMENT_COPY_VERDICTS,
  COPY_ORIGIN_DEFAULTS,
  COPY_UNKNOWN,
  classifyBreakpointMechanism,
  dominantCopyShare,
  aggregateCopyShares,
  partitionPaintingByArrangement,
  interpretCopyOriginPattern,
  summarizeArrangementCopyOrigin,
} from '../atlases/evolution/shared/copy_origin_painting.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab + defaults');

check('mechanisms frozen',            Object.isFrozen(COPY_ORIGIN_MECHANISMS));
check('verdicts frozen',              Object.isFrozen(ARRANGEMENT_COPY_VERDICTS));
check('defaults frozen',              Object.isFrozen(COPY_ORIGIN_DEFAULTS));
check('hom_dominant_share_min = 0.85',
      COPY_ORIGIN_DEFAULTS.hom_dominant_share_min === 0.85);
check('het_per_copy_min = 0.20',
      COPY_ORIGIN_DEFAULTS.het_per_copy_min === 0.20);
check('COPY_UNKNOWN = unknown',       COPY_UNKNOWN === 'unknown');

// =====================================================================
group('classifyBreakpointMechanism — NAHR (clean transition)');

const nahr = classifyBreakpointMechanism(['copy1','copy1','copy1','copy2','copy2','copy2']);
check('NAHR label',                   nahr.label === COPY_ORIGIN_MECHANISMS.NAHR);
check('n_transitions = 1',            nahr.n_transitions === 1);
check('distinct_copies = 2',          nahr.distinct_copies === 2);
check('no scar',                      nahr.has_scar === false);

// =====================================================================
group('classifyBreakpointMechanism — NHEJ/MMEJ (scar)');

const nhej = classifyBreakpointMechanism(['copy1','copy1','unknown','copy2','copy2']);
check('NHEJ/MMEJ label',              nhej.label === COPY_ORIGIN_MECHANISMS.NHEJ_MMEJ);
check('1 transition',                 nhej.n_transitions === 1);
check('scar detected',                nhej.has_scar === true);

const nhej2 = classifyBreakpointMechanism(['copy1','copy1','copy2','unknown','copy2','copy2']);
check('scar after transition: NHEJ',  nhej2.label === COPY_ORIGIN_MECHANISMS.NHEJ_MMEJ);

// =====================================================================
group('classifyBreakpointMechanism — complex paralogue mosaic');

// ≥ 2 transitions
const cmplx_t = classifyBreakpointMechanism(['copy1','copy2','copy1','copy2']);
check('3 transitions → complex',      cmplx_t.label === COPY_ORIGIN_MECHANISMS.COMPLEX_MOSAIC);

// ≥ 3 distinct copies
const cmplx_c = classifyBreakpointMechanism(['copy1','copy2','copy3']);
check('3 distinct copies → complex',  cmplx_c.label === COPY_ORIGIN_MECHANISMS.COMPLEX_MOSAIC);

// =====================================================================
group('classifyBreakpointMechanism — no mosaic evidence');

const none = classifyBreakpointMechanism(['copy1','copy1','copy1','copy1']);
check('zero transitions → no mosaic', none.label === COPY_ORIGIN_MECHANISMS.NO_MOSAIC);

const allUnk = classifyBreakpointMechanism(['unknown','unknown','unknown']);
check('all unknown → no mosaic',      allUnk.label === COPY_ORIGIN_MECHANISMS.NO_MOSAIC);
check('all unknown: n_unknowns = 3',   allUnk.n_unknowns === 3);

// =====================================================================
group('classifyBreakpointMechanism — edge cases');

check('empty → NO_MOSAIC',
      classifyBreakpointMechanism([]).label === COPY_ORIGIN_MECHANISMS.NO_MOSAIC);
check('null → NO_MOSAIC',
      classifyBreakpointMechanism(null).label === COPY_ORIGIN_MECHANISMS.NO_MOSAIC);

const singleton = classifyBreakpointMechanism(['copy1']);
check('single window → no_mosaic',    singleton.label === COPY_ORIGIN_MECHANISMS.NO_MOSAIC);

// transition_indices captures the right indices
const trans_idx = classifyBreakpointMechanism(['copy1','copy1','copy2','copy2']);
check('transition_indices = [2]',
      trans_idx.transition_indices.length === 1
      && trans_idx.transition_indices[0] === 2);

// =====================================================================
group('dominantCopyShare');

const d1 = dominantCopyShare({ copy1: 0.95, copy2: 0.03, unknown: 0.02 });
check('dominant = copy1',             d1.copy === 'copy1');
check('share = 0.95',                 d1.share === 0.95);

const d2 = dominantCopyShare({ copy1: 0.0, copy2: 0.4, copy3: 0.6, unknown: 0.0 });
check('dominant = copy3',             d2.copy === 'copy3');

// 'unknown' is excluded from argmax
const d3 = dominantCopyShare({ copy1: 0.3, unknown: 0.7 });
check('unknown excluded from argmax', d3.copy === 'copy1');

check('null → null',                  dominantCopyShare(null) === null);
check('all-zero → null',              dominantCopyShare({ copy1: 0, copy2: 0 }) === null);

// =====================================================================
group('aggregateCopyShares');

const samples = [
  { copy_shares: { copy1: 0.9, copy2: 0.1, unknown: 0.0 } },
  { copy_shares: { copy1: 0.7, copy2: 0.3, unknown: 0.0 } },
];
const agg = aggregateCopyShares(samples);
check('mean copy1 = 0.8',             Math.abs(agg.copy1 - 0.8) < 1e-9);
check('mean copy2 = 0.2',             Math.abs(agg.copy2 - 0.2) < 1e-9);

check('empty → {}',                   Object.keys(aggregateCopyShares([])).length === 0);
check('null → {}',                    Object.keys(aggregateCopyShares(null)).length === 0);

// =====================================================================
group('partitionPaintingByArrangement — arrangement-specific mosaic');

// HOM_A samples uniformly copy1; HOM_B uniformly copy2; HET mixed
const samples_specific = [
  { sample_id: 'A1', arrangement_group: 'HOM_A', copy_shares: { copy1: 0.95, copy2: 0.03, unknown: 0.02 } },
  { sample_id: 'A2', arrangement_group: 'HOM_A', copy_shares: { copy1: 0.92, copy2: 0.05, unknown: 0.03 } },
  { sample_id: 'B1', arrangement_group: 'HOM_B', copy_shares: { copy1: 0.04, copy2: 0.93, unknown: 0.03 } },
  { sample_id: 'B2', arrangement_group: 'HOM_B', copy_shares: { copy1: 0.06, copy2: 0.91, unknown: 0.03 } },
  { sample_id: 'H1', arrangement_group: 'HET',   copy_shares: { copy1: 0.48, copy2: 0.49, unknown: 0.03 } },
  { sample_id: 'H2', arrangement_group: 'HET',   copy_shares: { copy1: 0.45, copy2: 0.52, unknown: 0.03 } },
];
const parts = partitionPaintingByArrangement(samples_specific);
check('3 groups partitioned',         Object.keys(parts.by_group).length === 3);
check('HOM_A dominant = copy1',
      parts.by_group.HOM_A.dominant.copy === 'copy1');
check('HOM_A is_uniform_dominant',     parts.by_group.HOM_A.is_uniform_dominant === true);
check('HOM_B dominant = copy2',
      parts.by_group.HOM_B.dominant.copy === 'copy2');
check('HOM_B is_uniform_dominant',     parts.by_group.HOM_B.is_uniform_dominant === true);
check('HET is_het_mixed',              parts.by_group.HET.is_het_mixed === true);
check('HET status = mixed',            parts.by_group.HET.status === 'mixed');

// =====================================================================
group('partitionPaintingByArrangement — no copy difference');

const samples_same = [
  { sample_id: 'A1', arrangement_group: 'HOM_A', copy_shares: { copy1: 0.95, copy2: 0.05 } },
  { sample_id: 'B1', arrangement_group: 'HOM_B', copy_shares: { copy1: 0.94, copy2: 0.06 } },
];
const same = partitionPaintingByArrangement(samples_same);
check('both groups copy1',
      same.by_group.HOM_A.dominant.copy === 'copy1'
      && same.by_group.HOM_B.dominant.copy === 'copy1');

// =====================================================================
group('interpretCopyOriginPattern');

check('different homs + mixed HET → arrangement-specific',
      interpretCopyOriginPattern({
        hom_a_origin: 'copy1', hom_b_origin: 'copy2', het_signal: 'mixed',
      }) === ARRANGEMENT_COPY_VERDICTS.ARRANGEMENT_SPECIFIC);

check('same hom origin → no_copy_difference',
      interpretCopyOriginPattern({
        hom_a_origin: 'copy1', hom_b_origin: 'copy1', het_signal: 'single',
      }) === ARRANGEMENT_COPY_VERDICTS.NO_COPY_DIFFERENCE);

check('all ambiguous → uncallable',
      interpretCopyOriginPattern({
        hom_a_origin: null, hom_b_origin: null, het_signal: null,
      }) === ARRANGEMENT_COPY_VERDICTS.UNCALLABLE_LOW_PSV);

check('all ambiguous (string sentinel) → uncallable',
      interpretCopyOriginPattern({
        hom_a_origin: 'ambiguous', hom_b_origin: 'ambiguous', het_signal: 'ambiguous',
      }) === ARRANGEMENT_COPY_VERDICTS.UNCALLABLE_LOW_PSV);

check('different homs but HET not mixed → complex',
      interpretCopyOriginPattern({
        hom_a_origin: 'copy1', hom_b_origin: 'copy2', het_signal: 'single',
      }) === ARRANGEMENT_COPY_VERDICTS.COMPLEX_REARRANGEMENT);

check('HOM_A copy1 + HOM_B copy3 → complex',
      interpretCopyOriginPattern({
        hom_a_origin: 'copy1', hom_b_origin: 'copy3', het_signal: 'ambiguous',
      }) === ARRANGEMENT_COPY_VERDICTS.COMPLEX_REARRANGEMENT);

// =====================================================================
group('summarizeArrangementCopyOrigin');

const summary = summarizeArrangementCopyOrigin(samples_specific);
check('verdict = arrangement-specific',
      summary.verdict === ARRANGEMENT_COPY_VERDICTS.ARRANGEMENT_SPECIFIC);
check('hom_a_origin = copy1',         summary.hom_a_origin === 'copy1');
check('hom_b_origin = copy2',         summary.hom_b_origin === 'copy2');
check('het_signal = mixed',           summary.het_signal === 'mixed');

const summary_same = summarizeArrangementCopyOrigin(samples_same);
check('same-origin summary verdict',
      summary_same.verdict === ARRANGEMENT_COPY_VERDICTS.NO_COPY_DIFFERENCE);

// Empty / null
const empty = summarizeArrangementCopyOrigin([]);
check('empty samples: verdict uncallable',
      empty.verdict === ARRANGEMENT_COPY_VERDICTS.UNCALLABLE_LOW_PSV);

// =====================================================================
group('mechanism extensions — TE_MEDIATED + REPLICATION_BASED');

// NAHR + te_overlap_flag → TE_MEDIATED
const te = classifyBreakpointMechanism(
  ['copy1','copy1','copy1','copy2','copy2','copy2'],
  { te_overlap_flag: true },
);
check('clean NAHR + te_overlap → TE_MEDIATED',
      te.label === COPY_ORIGIN_MECHANISMS.TE_MEDIATED);
check('te_overlap=false default → still NAHR',
      classifyBreakpointMechanism(['copy1','copy1','copy2','copy2']).label === COPY_ORIGIN_MECHANISMS.NAHR);

// COMPLEX_MOSAIC + fragile_site_flag → REPLICATION_BASED
const fragile = classifyBreakpointMechanism(
  ['copy1','copy2','copy1','copy2'],   // 3 transitions → complex
  { fragile_site_flag: true },
);
check('complex + fragile_site → REPLICATION_BASED',
      fragile.label === COPY_ORIGIN_MECHANISMS.REPLICATION_BASED);
check('fragile_site=false default → still COMPLEX_MOSAIC',
      classifyBreakpointMechanism(['copy1','copy2','copy1','copy2']).label === COPY_ORIGIN_MECHANISMS.COMPLEX_MOSAIC);

// NHEJ_MMEJ unaffected by te_overlap_flag (flag only refines NAHR)
const nhej_te = classifyBreakpointMechanism(
  ['copy1','copy1','unknown','copy2','copy2'],
  { te_overlap_flag: true },
);
check('NHEJ unaffected by te_overlap_flag',
      nhej_te.label === COPY_ORIGIN_MECHANISMS.NHEJ_MMEJ);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
