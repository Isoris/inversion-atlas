// tests/test_page1_lineage.js
//
// Unit tests for pages/discovery/local_pca_dosage/lineage.js — state-managed
// lineage compute wrapping shared/clustering.js and
// shared/hungarian.js. Drives the per-sample lineage assignments
// surfaced by _lineageColor in local_pca_dosage's per-sample-lines panel.

import {
  LINEAGE_DEFAULT_THRESHOLD,
  LINEAGE_MIN_L2_FOR_COMPUTE,
  lineageCacheKey,
  runLineageCompute,
} from '../atlases/inversion/pages/discovery/local_pca_dosage/lineage.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('constants');
check('DEFAULT_THRESHOLD = 0.50',  LINEAGE_DEFAULT_THRESHOLD === 0.50);
check('MIN_L2_FOR_COMPUTE = 3',    LINEAGE_MIN_L2_FOR_COMPUTE === 3);

// =====================================================================
group('lineageCacheKey — fingerprint behaviour');
{
  const k1 = lineageCacheKey([0, 1, 2], 3, 0.5, 'default', 'LG28');
  const k2 = lineageCacheKey([0, 1, 2], 3, 0.5, 'default', 'LG28');
  check('identical inputs → identical key', k1 === k2);

  check('different chrom → different key',
        k1 !== lineageCacheKey([0, 1, 2], 3, 0.5, 'default', 'LG07'));
  check('different K → different key',
        k1 !== lineageCacheKey([0, 1, 2], 4, 0.5, 'default', 'LG28'));
  check('different threshold → different key',
        k1 !== lineageCacheKey([0, 1, 2], 3, 0.6, 'default', 'LG28'));
  check('different mode → different key',
        k1 !== lineageCacheKey([0, 1, 2], 3, 0.5, 'detailed', 'LG28'));
  check('different length → different key',
        k1 !== lineageCacheKey([0, 1, 2, 3], 3, 0.5, 'default', 'LG28'));
}

// =====================================================================
group('runLineageCompute — input validation');
check('null state → null',          runLineageCompute(null) === null);
check('state w/o data → null',      runLineageCompute({}) === null);
check('< MIN_L2 envelopes → null',
      runLineageCompute({ data: { l2_envelopes: [{}, {}], chrom: 'LG28' } }) === null);

// =====================================================================
// Build a fixture: 4 samples × 5 L2s × K=3. All L2s have identical
// labels: samples [0,1] in band 0, samples [2,3] in band 1.
// Expected: 2 lineages, (0,1) and (2,3).
// =====================================================================
function makeFixture() {
  const N_SAMPLES = 4;
  const K = 3;
  const N_L2 = 5;
  const labels = new Int8Array(N_SAMPLES);
  labels[0] = 0; labels[1] = 0;
  labels[2] = 1; labels[3] = 1;
  const l2GroupCache = new Map();
  for (let i = 0; i < N_L2; i++) l2GroupCache.set(i, { labels });
  return {
    state: {
      k: K,
      activeMode: 'default',
      data: {
        chrom: 'LG28',
        l2_envelopes: Array.from({ length: N_L2 }, () => ({})),
        n_samples: N_SAMPLES,
      },
      l2GroupCache,
    },
    N_SAMPLES, K, N_L2,
  };
}

group('runLineageCompute — 2 lineages, 5 L2s');
{
  const { state, N_SAMPLES } = makeFixture();
  const result = runLineageCompute(state);
  check('returns non-null result',        result !== null);
  check('result.n_samples = 4',           result.n_samples === N_SAMPLES);
  check('result.n_lineages = 2',          result.n_lineages === 2);
  check('result.K = 3',                   result.K === 3);
  check('result.chrom = LG28',            result.chrom === 'LG28');
  check('result.threshold = 0.5',         result.threshold === 0.5);
  check('lineage_id_per_sample length = 4',
        result.lineage_id_per_sample.length === N_SAMPLES);
  check('0 and 1 same lineage',
        result.lineage_id_per_sample[0] === result.lineage_id_per_sample[1]);
  check('2 and 3 same lineage',
        result.lineage_id_per_sample[2] === result.lineage_id_per_sample[3]);
  check('0 and 2 different lineages',
        result.lineage_id_per_sample[0] !== result.lineage_id_per_sample[2]);
  check('fish_count_per_lineage = [2, 2]',
        result.fish_count_per_lineage.length === 2
        && result.fish_count_per_lineage[0] === 2
        && result.fish_count_per_lineage[1] === 2);
}

// =====================================================================
group('runLineageCompute — caching');
{
  const { state } = makeFixture();
  const r1 = runLineageCompute(state);
  check('first call populates state.lineageResult',  state.lineageResult === r1);
  check('first call populates state.lineageCacheKey',
        typeof state.lineageCacheKey === 'string');

  // Second call with same state: returns cached object
  const r2 = runLineageCompute(state);
  check('second call returns cached object',         r2 === r1);

  // Force flag bypasses cache
  const r3 = runLineageCompute(state, { force: true });
  check('force:true recomputes (different object)',  r3 !== r1);
}

// =====================================================================
group('runLineageCompute — single lineage when all samples agree');
{
  // All 4 samples in band 0 → concordance = 1 everywhere → 1 lineage
  const labels = new Int8Array(4);   // all zeros
  const l2GroupCache = new Map();
  for (let i = 0; i < 5; i++) l2GroupCache.set(i, { labels });
  const state = {
    k: 3, activeMode: 'default',
    data: { chrom: 'LG28', l2_envelopes: [{}, {}, {}, {}, {}], n_samples: 4 },
    l2GroupCache,
  };
  const result = runLineageCompute(state);
  check('all-agree: 1 lineage',           result.n_lineages === 1);
  check('all-agree: all samples in lineage 0',
        Array.from(result.lineage_id_per_sample).every(li => li === 0));
}

// =====================================================================
group('runLineageCompute — invalid l2GroupCache → null result');
{
  const state = {
    k: 3, activeMode: 'default',
    data: { chrom: 'LG28', l2_envelopes: [{}, {}, {}, {}, {}], n_samples: 4 },
    // No l2GroupCache → getLabelsForL2 returns null → projection has 0 L2s
  };
  const result = runLineageCompute(state);
  check('no l2GroupCache: result = null',  result === null);
  check('state.lineageResult cleared',     state.lineageResult === null);
  check('state.lineageCacheKey cleared',   state.lineageCacheKey === null);
}

// =====================================================================
group('runLineageCompute — opts.threshold + opts.l2_indices overrides');
{
  const { state } = makeFixture();
  // The fixture has perfect concordance within each pair (d=0) and zero
  // concordance across pairs (d=1). Threshold 0.01 still accepts the
  // zero-distance merges, leaving 2 lineages. A threshold below 0 (or
  // before the first merge) is the only way to prevent any merge.
  const r = runLineageCompute(state, { threshold: 0.01 });
  check('threshold 0.01: still 2 lineages (perfect-agreement pairs at d=0)',
        r.n_lineages === 2);

  // Subset of L2s
  const r2 = runLineageCompute(state, { l2_indices: [0, 1, 2], force: true });
  check('l2_indices subset: n_L2 = 3',   r2.n_L2 === 3);

  // Subset below MIN_L2_FOR_COMPUTE → null
  const r3 = runLineageCompute(state, { l2_indices: [0, 1], force: true });
  check('l2_indices length < MIN: null', r3 === null);
}

// =====================================================================
group('runLineageCompute — explicit getLabelsForL2 callback');
{
  // Inject a callback returning labels for any l2idx; bypass l2GroupCache.
  const labels = new Int8Array([0, 0, 1, 1]);
  const state = {
    k: 3, activeMode: 'default',
    data: { chrom: 'LG28', l2_envelopes: [{}, {}, {}], n_samples: 4 },
  };
  const result = runLineageCompute(state, {
    getLabelsForL2: () => labels,
  });
  check('explicit callback works without l2GroupCache', result !== null);
  check('explicit callback: 2 lineages',                result.n_lineages === 2);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
