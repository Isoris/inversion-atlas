// tests/smoke_regime_groups_wiring.js
// =====================================================================
// Smoke test: verify the regime_summary_bundle → catalogue → regime_groups
// pre-aggregation wiring end-to-end.
//
// Constructs a minimal banding result + sample_regime_calls bundle and
// runs through buildCatalogue with regime_summary_bundle attached. Asserts
// each catalogue record carries:
//   - regime_summary (per-candidate row)
//   - regime_sample_calls (per-sample × candidate)
//   - regime_window_support (per-window × candidate)
//   - regime_qc
//   - regime_groups       <-- new (server-label keys, sample-id arrays)
//   - n_per_regime        <-- new (counts)
// =====================================================================

import { buildCatalogue } from '../atlases/inversion/shared/band_tracking/regime_catalogue.js';
import { regimeGroupsFromCalls } from '../atlases/inversion/shared/candidate_groups.js';

let pass = 0, fail = 0;
function assertEq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else    { fail++; console.error(`  ✗ ${label}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`); }
}
function assert(label, cond) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else      { fail++; console.error(`  ✗ ${label}`); }
}

// -------- 1. regimeGroupsFromCalls (server label style) -----------------

console.log('regimeGroupsFromCalls — server style');
{
  const calls = [
    { candidate_id: 'X1', sample_id: 'sA', regime_call: 'homA_like' },
    { candidate_id: 'X1', sample_id: 'sB', regime_call: 'homA_like' },
    { candidate_id: 'X1', sample_id: 'sC', regime_call: 'het_like'  },
    { candidate_id: 'X1', sample_id: 'sD', regime_call: 'homB_like' },
    { candidate_id: 'X1', sample_id: 'sE', regime_call: 'uncertain' },
  ];
  const out = regimeGroupsFromCalls(calls);
  assert('returns object', out && typeof out === 'object');
  assertEq('groups H1/H1', out.groups['H1/H1'], ['sA', 'sB']);
  assertEq('groups H1/H2', out.groups['H1/H2'], ['sC']);
  assertEq('groups H2/H2', out.groups['H2/H2'], ['sD']);
  assertEq('groups uncertain', out.groups['uncertain'], ['sE']);
  assertEq('n_per_group H1/H1', out.n_per_group['H1/H1'], 2);
  assertEq('dropped_unknown', out.dropped_unknown, 0);
}

console.log('regimeGroupsFromCalls — labelStyle: regime_call (raw)');
{
  const calls = [
    { candidate_id: 'X1', sample_id: 'sA', regime_call: 'homA_like' },
    { candidate_id: 'X1', sample_id: 'sB', regime_call: 'het_like'  },
  ];
  const out = regimeGroupsFromCalls(calls, { labelStyle: 'regime_call' });
  assertEq('groups homA_like', out.groups['homA_like'], ['sA']);
  assertEq('groups het_like',  out.groups['het_like'],  ['sB']);
}

// -------- 2. buildCatalogue with regime_summary_bundle ---------------

console.log('buildCatalogue — embeds regime_groups per record');
{
  // Minimal banding result: one stage3 locus.
  const result = {
    stage3: {
      loci: [
        { seed_id: 'cand_A', s_window: 10, e_window: 30 },
      ],
    },
    summary: { n_seeds: 1 },
  };
  const bundle = {
    candidate_regime_summary: [
      { candidate_id: 'cand_A', chrom: 'chr12', start: 1_000_000, end: 2_000_000,
        regime_class: 'stable_three_band_regime', confidence: 0.82, support_score: 0.74,
        heterozygote_band_present: true,
        homA_count: 12, het_count: 8, homB_count: 5, uncertain_count: 0,
        n_samples: 25, n_bands: 3 },
    ],
    sample_regime_calls: [
      { candidate_id: 'cand_A', sample_id: 's01', regime_call: 'homA_like' },
      { candidate_id: 'cand_A', sample_id: 's02', regime_call: 'homA_like' },
      { candidate_id: 'cand_A', sample_id: 's03', regime_call: 'het_like'  },
      { candidate_id: 'cand_A', sample_id: 's04', regime_call: 'het_like'  },
      { candidate_id: 'cand_A', sample_id: 's05', regime_call: 'homB_like' },
    ],
    window_regime_support: [
      { candidate_id: 'cand_A', window_id: 10, start: 1_000_000, is_supported: true,
        agreement_to_seed: 0.95, cramers_v_to_seed: 0.6, assigned_regime: 'aligned',
        n_samples: 25 },
      { candidate_id: 'cand_A', window_id: 11, start: 1_100_000, is_supported: false,
        agreement_to_seed: 0.30, cramers_v_to_seed: 0.1, assigned_regime: 'misaligned',
        n_samples: 25 },
    ],
    regime_qc_summary: [
      { candidate_id: 'cand_A', regime_class: 'stable_three_band_regime',
        confidence: 0.82, support_score: 0.74,
        n_samples_used: 25, n_windows_tested: 2, n_windows_supported: 1,
        possible_ancestry_confounding: false, possible_family_confounding: false,
        missingness: 0.02 },
    ],
  };

  const built = buildCatalogue(result, {
    cohort_id: 'test_cohort',
    reference_id: 'GRCh38',
    pipeline_version: 'test-1.0',
    sample_ids: ['s01','s02','s03','s04','s05'],
    chromName: () => 'chr12',
    windowToBp: (_chrIdx, w) => 1_000_000 + (w * 100_000),
    resolved_opts: {},
    include_full_votes: false,
    regime_summary_bundle: bundle,
  });

  assertEq('catalogue length', built.catalogue.length, 1);
  assertEq('manifest.has_regime_summary', built.manifest.has_regime_summary, true);

  const rec = built.catalogue[0];
  assert('regime_summary attached',         !!rec.regime_summary);
  assert('regime_sample_calls attached',    Array.isArray(rec.regime_sample_calls));
  assert('regime_window_support attached',  Array.isArray(rec.regime_window_support));
  assert('regime_qc attached',              !!rec.regime_qc);
  assertEq('regime_summary.regime_class',   rec.regime_summary.regime_class, 'stable_three_band_regime');

  // The new bits.
  assert('regime_groups attached',          !!rec.regime_groups);
  assertEq('regime_groups H1/H1',           rec.regime_groups['H1/H1'], ['s01','s02']);
  assertEq('regime_groups H1/H2',           rec.regime_groups['H1/H2'], ['s03','s04']);
  assertEq('regime_groups H2/H2',           rec.regime_groups['H2/H2'], ['s05']);
  assertEq('n_per_regime H1/H1',            rec.n_per_regime['H1/H1'], 2);
  assertEq('n_per_regime H1/H2',            rec.n_per_regime['H1/H2'], 2);
  assertEq('n_per_regime H2/H2',            rec.n_per_regime['H2/H2'], 1);
}

// -------- 3. buildCatalogue without bundle: regime_groups omitted ---------

console.log('buildCatalogue — no bundle → no regime_groups');
{
  const result = {
    stage3: { loci: [{ seed_id: 'A', s_window: 0, e_window: 10 }] },
    summary: {},
  };
  const built = buildCatalogue(result, {
    cohort_id: 't', reference_id: 'r', pipeline_version: '1',
    sample_ids: ['s'],
    chromName: () => 'chr1', windowToBp: (_c, w) => 1000 + 100*w,
    resolved_opts: {},
  });
  const rec = built.catalogue[0];
  assert('no regime_summary',  !rec.regime_summary);
  assert('no regime_groups',   !rec.regime_groups);
  assertEq('manifest.has_regime_summary', built.manifest.has_regime_summary, false);
}

console.log('=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
if (fail > 0) process.exit(1);
