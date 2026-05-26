// tests/test_analysis_karyotype_assignment.js
//
// Tests for analysis/karyotype_assignment.js — per-sample karyotype call
// via K-means on the candidate's local-PCA slab.
//
// Strategy: build a synthetic scrubber_main payload where the 3 karyotype
// clusters are clearly separated in (PC1, PC2) space. Verify:
//   - The 3 clusters get mapped to HOM_REF / HET / HOM_INV based on
//     PC1-ascending centroid ordering.
//   - Per-sample purity gates near-boundary samples into 'AMBIGUOUS'.
//   - invert_orientation swaps HOM_REF ↔ HOM_INV.
//   - Empty-windows / candidate-not-found paths return clean
//     'insufficient_data'-style empty results with a _reason string.

import {
  assignKaryotypes,
  MODULE_VERSION,
} from '../atlases/popstats/analysis/karyotype_assignment.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
// Synthetic scrubber_main: 30 samples × 5 windows, 3 clusters of 10
// samples each. Samples 0..9 cluster around (-2, 0); 10..19 around (0, 0);
// 20..29 around (+2, 0). Tiny per-sample jitter so kmeans converges.
// =====================================================================
function makeSyntheticPrecomp({ n_per_cluster = 10, n_windows = 5, jitter = 0.05 } = {}) {
  const n_samples = n_per_cluster * 3;
  const centers = [-2, 0, +2];
  const samples = [];
  for (let i = 0; i < n_samples; i++) samples.push('S' + i);
  const windows = [];
  // Deterministic pseudo-random (so tests are reproducible).
  let seed = 1;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let w = 0; w < n_windows; w++) {
    const pc1 = new Array(n_samples);
    const pc2 = new Array(n_samples);
    for (let i = 0; i < n_samples; i++) {
      const cluster = Math.floor(i / n_per_cluster);
      pc1[i] = centers[cluster] + (rand() - 0.5) * jitter;
      pc2[i] = (rand() - 0.5) * jitter;
    }
    windows.push({
      start_bp: w * 100_000,
      end_bp:   (w + 1) * 100_000 - 1,
      pc1, pc2,
    });
  }
  return { samples, windows };
}

function makeRegistry({ candidate, precomp }) {
  return {
    _writes: [],
    async resolve(layerName, args) {
      if (layerName === 'candidates_registry') {
        return candidate ? [candidate] : [];
      }
      if (layerName === 'scrubber_main') {
        if (args && candidate && args.chrom === candidate.chrom) return precomp;
        return null;
      }
      throw new Error('mock registry: unknown layer ' + layerName);
    },
    async set(layerName, payload, args) {
      this._writes.push({ layerName, payload, args });
    },
  };
}

// =====================================================================
group('module shape');
check('MODULE_VERSION exported',  typeof MODULE_VERSION === 'string' && MODULE_VERSION.length > 0);
check('assignKaryotypes exported', typeof assignKaryotypes === 'function');

// =====================================================================
group('assignKaryotypes — missing candidate_id throws');
{
  let threw = false;
  try { await assignKaryotypes(makeRegistry({ candidate: null, precomp: null }), {}); }
  catch (e) { threw = true; }
  check('ctx without candidate_id throws', threw);
}

// =====================================================================
group('assignKaryotypes — candidate not in registry → empty result');
{
  const reg = makeRegistry({ candidate: null, precomp: null });
  const r = await assignKaryotypes(reg, { candidate_id: 'cand_unknown' });
  check('returns empty karyotypes',    Object.keys(r.karyotypes).length === 0);
  check('n_samples = 0',               r.n_samples === 0);
  check('_reason mentions not found',  typeof r._reason === 'string' && r._reason.includes('not found'));
}

// =====================================================================
group('assignKaryotypes — clean 3-cluster slab → balanced karyotypes');
{
  const candidate = {
    id: 'cand_clean', chrom: 'LG01',
    start_bp: 0, end_bp: 500_000,
  };
  const precomp = makeSyntheticPrecomp();
  const reg = makeRegistry({ candidate, precomp });
  const r = await assignKaryotypes(reg, { candidate_id: 'cand_clean' });
  check('n_samples = 30',                          r.n_samples === 30);
  check('n_windows_used = 5',                      r.n_windows_used === 5);
  check('3 centroids present',                     r.centroids.length === 3);
  check('centroid[0] label = HOM_REF',             r.centroids[0].label === 'HOM_REF');
  check('centroid[1] label = HET',                 r.centroids[1].label === 'HET');
  check('centroid[2] label = HOM_INV',             r.centroids[2].label === 'HOM_INV');
  check('centroid[0].pc1 < centroid[1].pc1',       r.centroids[0].pc1 < r.centroids[1].pc1);
  check('centroid[1].pc1 < centroid[2].pc1',       r.centroids[1].pc1 < r.centroids[2].pc1);
  // With clean clusters all 30 samples should be high-purity (jitter is tiny).
  const counts = r.n_per_kar;
  check('n_per_kar.HOM_REF = 10',                  counts.HOM_REF === 10);
  check('n_per_kar.HET = 10',                      counts.HET === 10);
  check('n_per_kar.HOM_INV = 10',                  counts.HOM_INV === 10);
  check('n_per_kar.AMBIGUOUS = 0 (clean clusters)', counts.AMBIGUOUS === 0);
  check('first 10 samples → HOM_REF',
        ['S0','S1','S2','S3','S4','S5','S6','S7','S8','S9']
          .every(s => r.karyotypes[s] === 'HOM_REF'));
  check('middle 10 → HET',
        ['S10','S11','S12','S13','S14','S15','S16','S17','S18','S19']
          .every(s => r.karyotypes[s] === 'HET'));
  check('last 10 → HOM_INV',
        ['S20','S21','S22','S23','S24','S25','S26','S27','S28','S29']
          .every(s => r.karyotypes[s] === 'HOM_INV'));
  check('writeback fired',                         reg._writes.length === 1);
  check('writeback layer = candidate_karyotype_per_sample',
        reg._writes[0].layerName === 'candidate_karyotype_per_sample');
}

// =====================================================================
group('assignKaryotypes — invert_orientation swaps HOM_REF ↔ HOM_INV');
{
  const candidate = {
    id: 'cand_invert', chrom: 'LG01',
    start_bp: 0, end_bp: 500_000,
  };
  const precomp = makeSyntheticPrecomp();
  const reg = makeRegistry({ candidate, precomp });
  const r = await assignKaryotypes(reg,
    { candidate_id: 'cand_invert', invert_orientation: true });
  // First 10 samples now → HOM_INV, last 10 → HOM_REF.
  check('first 10 samples → HOM_INV after invert',
        ['S0','S1','S2','S3','S4','S5','S6','S7','S8','S9']
          .every(s => r.karyotypes[s] === 'HOM_INV'));
  check('last 10 samples → HOM_REF after invert',
        ['S20','S21','S22','S23','S24','S25','S26','S27','S28','S29']
          .every(s => r.karyotypes[s] === 'HOM_REF'));
  check('HET stays HET',
        ['S10','S11','S12','S13','S14','S15','S16','S17','S18','S19']
          .every(s => r.karyotypes[s] === 'HET'));
}

// =====================================================================
group('assignKaryotypes — high purity_threshold flags some boundary samples');
{
  // Same clean precomp at jitter=0.05. At default threshold 0.20 all 30
  // samples pass; at 0.99 some samples whose aggregated PC1 lands far
  // from the centroid (per-window jitter that didn't fully average out)
  // get gated to AMBIGUOUS. Exact count is deterministic-with-seed but
  // depends on the rand sequence, so assert the qualitative gate: at
  // least 1 sample flagged, and strictly more than at default threshold.
  const candidate = {
    id: 'cand_strict', chrom: 'LG01',
    start_bp: 0, end_bp: 500_000,
  };
  const precompA = makeSyntheticPrecomp();
  const regA = makeRegistry({ candidate, precomp: precompA });
  const rDefault = await assignKaryotypes(regA, { candidate_id: 'cand_strict' });

  const precompB = makeSyntheticPrecomp();
  const regB = makeRegistry({ candidate, precomp: precompB });
  const rStrict = await assignKaryotypes(regB,
    { candidate_id: 'cand_strict', purity_threshold: 0.99 });

  check('default threshold passes all samples',
        rDefault.n_per_kar.AMBIGUOUS === 0);
  check('strict threshold flags at least 1 sample',
        rStrict.n_per_kar.AMBIGUOUS >= 1);
  check('strict > default ambiguous count',
        rStrict.n_per_kar.AMBIGUOUS > rDefault.n_per_kar.AMBIGUOUS);
  check('strict threshold persisted in result',
        rStrict.purity_threshold === 0.99);
}

// =====================================================================
group('assignKaryotypes — no windows in slab → empty result');
{
  const candidate = {
    id: 'cand_off_range', chrom: 'LG01',
    start_bp: 10_000_000, end_bp: 20_000_000,  // past synthetic precomp
  };
  const precomp = makeSyntheticPrecomp();
  const reg = makeRegistry({ candidate, precomp });
  const r = await assignKaryotypes(reg, { candidate_id: 'cand_off_range' });
  check('n_samples = 0',                       r.n_samples === 0);
  check('_reason mentions no windows overlap', typeof r._reason === 'string'
                                                && r._reason.includes('No windows overlap'));
}

// =====================================================================
group('assignKaryotypes — chrom missing in scrubber_main → empty result');
{
  const candidate = {
    id: 'cand_no_chrom', chrom: 'LG99',
    start_bp: 0, end_bp: 1_000_000,
  };
  const reg = makeRegistry({ candidate, precomp: null });
  const r = await assignKaryotypes(reg, { candidate_id: 'cand_no_chrom' });
  check('n_samples = 0',                  r.n_samples === 0);
  check('_reason mentions windows',       typeof r._reason === 'string'
                                           && r._reason.includes('windows'));
}

// =====================================================================
console.log('\n=================');
console.log('pass: ' + pass + '   fail: ' + fail);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
