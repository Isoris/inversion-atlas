// tests/test_shared_candidate_export_record.js
//
// Unit coverage for shared/candidate_export_record.js — per-candidate
// export record builder (legacy lines 61176-61362). Pairs with
// shared/atlas_export.js as opts.buildRecord.

import { buildCandidateExportRecord } from '../atlases/inversion/shared/candidate_export_record.js';
import { buildAtlasCandidateExport } from '../atlases/inversion/shared/atlas_export.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// Build a synthetic state that satisfies every helper the record builder
// invokes via safeCall. PC1 windows let diamond_detection +
// sigma_profile do their work; samples carry family + ancestry for
// band_composition.
// -----------------------------------------------------------------------------
function _makeState() {
  // 16 windows, NPC=4 with PC1 stable in bands 0/1/2 across all windows
  // (so band_composition + per-sample primary band work cleanly). Bands
  // 1 splits in the middle to give diamond_detection something to find.
  const nW = 16;
  const labels = [];
  for (let si = 0; si < 18; si++) labels.push(si % 3);  // 6 per band
  const samples = [];
  for (let si = 0; si < 18; si++) {
    samples.push({
      id: 'S' + (si + 1).toString().padStart(2, '0'),
      family_id: (si % 3) + 1,
      ancestry: si < 6 ? 'EU' : si < 12 ? 'AS' : 'AF',
    });
  }
  const windows = [];
  for (let w = 0; w < nW; w++) {
    const inSplit = (w >= 5 && w <= 9);
    const pc1 = new Array(18);
    for (let si = 0; si < 18; si++) {
      const band = labels[si];
      const inBandIdx = Math.floor(si / 3);
      if (band === 0) {
        pc1[si] = 0 + (inBandIdx - 2.5) * (inSplit ? 0.4 : 0.05);
      } else if (band === 1) {
        pc1[si] = 0.5 + (inBandIdx - 2.5) * 0.01;
      } else {
        pc1[si] = -0.5 + (inBandIdx - 2.5) * 0.01;
      }
    }
    windows.push({ pc1, center_mb: w * 0.1, start_bp: w * 100, end_bp: (w + 1) * 100 - 1 });
  }
  return {
    k: 3,
    activeMode: 'default',
    data: {
      chrom: 'LG28',
      n_samples: 18,
      n_windows: nW,
      samples,
      windows,
    },
    candidates: {
      cand_A: {
        id: 'cand_A',
        chrom: 'LG28',
        K: 3,
        locked_labels: labels,
        start_w: 0,
        end_w: nW - 1,
        start_bp: 0,
        end_bp:   nW * 100 - 1,
        confirmed: true,
        source: 'manual',
        notes: 'note',
        haplotype_labels: { 0: 'H1/H1', 1: 'H1/H2', 2: 'H2/H2' },
      },
    },
  };
}

// -----------------------------------------------------------------------------
group('buildCandidateExportRecord: basic structure');
const state = _makeState();
const cand = state.candidates.cand_A;
const rec = buildCandidateExportRecord(state, cand);

check('candidate_id stringified',    rec.candidate_id === 'cand_A');
check('chrom propagated',             rec.chrom === 'LG28');
check('K_used = 3',                   rec.K_used === 3);
check('start_w/end_w propagated',
      rec.start_w === 0 && rec.end_w === 15);
check('start_bp/end_bp propagated',
      rec.start_bp === 0 && rec.end_bp === 1599);
check('confirmed bool',               rec.confirmed === true);
check('source/notes preserved',
      rec.source === 'manual' && rec.annotator_notes === 'note');

// -----------------------------------------------------------------------------
group('atlas_band_assignments');
const ba = rec.atlas_band_assignments;
check('per_sample keyed by sample id',
      ba.per_sample.S01 && ba.per_sample.S01.primary_band === 0);
check('per_sample.primary_band_label resolves from haplotype_labels',
      ba.per_sample.S01.primary_band_label === 'H1/H1');
check('band_counts: 6 per band',
      ba.band_counts.length === 3 && ba.band_counts.every(c => c === 6));

// -----------------------------------------------------------------------------
group('haplotype_labels + sample_groups');
check('haplotype_labels propagated',
      rec.haplotype_labels[0] === 'H1/H1' && rec.haplotype_labels[1] === 'H1/H2');
check('sample_groups keyed by label',
      Array.isArray(rec.sample_groups['H1/H1']) && rec.sample_groups['H1/H1'].length === 6);
check('sample_groups uses sample ids',
      rec.sample_groups['H1/H2'][0].startsWith('S'));

// -----------------------------------------------------------------------------
group('diamond_detection');
check('diamond_detection present',  rec.diamond_detection !== null);
check('diamond counts numeric',
      Number.isFinite(rec.diamond_detection.n_diamonds));
check('diamonds_full is an array (or null)',
      rec.diamonds_full === null || Array.isArray(rec.diamonds_full));

// -----------------------------------------------------------------------------
group('classifier_output + per_band_stats');
check('haplotype_vocab is a string',  typeof rec.haplotype_vocab === 'string');
check('classifier_output.per_band populated',
      rec.classifier_output && Array.isArray(rec.classifier_output.per_band)
      && rec.classifier_output.per_band.length === 3);

// per_band_stats may be null when candPerBandStats can't compute; either
// way it's the right shape
check('per_band_stats null OR array',
      rec.per_band_stats === null || Array.isArray(rec.per_band_stats));

// -----------------------------------------------------------------------------
group('band_composition');
check('band_composition: 3 bands',     Array.isArray(rec.band_composition) && rec.band_composition.length === 3);
check('band 0: n = 6',                 rec.band_composition[0].n === 6);
check('band 0: member_ids = 6',         rec.band_composition[0].member_ids.length === 6);
check('band 0: family tally present',  rec.band_composition[0].families.length >= 1);
check('band 0: ancestry tally present', rec.band_composition[0].ancestries.length >= 1);

// -----------------------------------------------------------------------------
group('inheritance lookup');
// No inheritance result on state → inheritance is null
check('no inheritance result → inheritance null',  rec.inheritance === null);

// With inheritance result
const stateWithInh = Object.assign({}, state, {
  inheritanceResult: {
    items_meta: [{ id: 'cand_A', seq_num: 1 }],
    band_index: [
      { item_idx: 0, band: 0 }, { item_idx: 0, band: 1 }, { item_idx: 0, band: 2 },
    ],
    cut: { group_id_per_band: [3, 5, 5], n_groups: 2 },
    rtab: { per_item_n_groups: [2] },
  },
});
const recInh = buildCandidateExportRecord(stateWithInh, cand);
check('inheritance found in result',
      recInh.inheritance && recInh.inheritance.item_idx_in_cohort === 0);
check('inheritance: group_id_per_band populated',
      recInh.inheritance.group_id_per_band[0] === 3
      && recInh.inheritance.group_id_per_band[1] === 5);
check('inheritance: n_inheritance_groups',
      recInh.inheritance.n_inheritance_groups === 2);
check('inheritance: total_groups_in_cohort',
      recInh.inheritance.total_groups_in_cohort === 2);

// -----------------------------------------------------------------------------
group('locked_labels_raw + candidate_runtime');
check('locked_labels_raw: array',
      Array.isArray(rec.locked_labels_raw) && rec.locked_labels_raw.length === 18);
check('candidate_runtime present',     typeof rec.candidate_runtime === 'object');

// -----------------------------------------------------------------------------
group('Edge cases');
check('null cand → null',              buildCandidateExportRecord(state, null) === null);

// Missing windows (caller didn't pass + state.data.windows missing)
const stateNoWindows = Object.assign({}, state, { data: Object.assign({}, state.data, { windows: null }) });
const recNoWin = buildCandidateExportRecord(stateNoWindows, cand);
check('no windows: diamond_detection = null',  recNoWin.diamond_detection === null);
check('no windows: sigma_profile = null',      recNoWin.sigma_profile === null);
check('no windows: still emits the rest of the record',
      recNoWin.candidate_id === 'cand_A' && recNoWin.K_used === 3);

// Single-band candidate (no haplotype_labels): falls back to band_<k>
const candSingle = {
  id: 'cand_S', chrom: 'LG1', K: 2,
  locked_labels: [0, 0, 1, 1],
};
const stateSingle = {
  data: { chrom: 'LG1', samples: [], windows: [] },
  candidates: { cand_S: candSingle },
};
const recSingle = buildCandidateExportRecord(stateSingle, candSingle);
check('no haplotype_labels: sample_groups uses band_<k>',
      'band_0' in recSingle.sample_groups || 'band_1' in recSingle.sample_groups);

// -----------------------------------------------------------------------------
group('Integration: buildAtlasCandidateExport + this record builder');
const expBundle = buildAtlasCandidateExport(state, {
  buildRecord: (c) => buildCandidateExportRecord(state, c),
});
check('bundle candidates: 1 record',  expBundle.candidates.length === 1);
check('bundle candidate is fully assembled',
      expBundle.candidates[0].candidate_id === 'cand_A'
      && expBundle.candidates[0].atlas_band_assignments
      && expBundle.candidates[0].haplotype_labels);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
