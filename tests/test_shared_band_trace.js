// tests/test_shared_band_trace.js
//
// Unit tests for shared/band_trace.js — the compute layer for the
// per-fish-set band-trace strip (legacy 39395-39667).
//
// We don't depend on real LG28 data: tests synthesise per-L2 labels
// via a small `getLabelsForL2` callback feeding the Hungarian chain
// projection, which is the same shape the real renderer uses.

import {
  BTRACE_COSEG_ENTROPY_MAX,
  BTRACE_FANNED_ENTROPY_MIN,
  BTRACE_MIN_VALID_FISH,
  BTRACE_MIN_RUN_LENGTH,
  bandTraceShannonEntropy,
  bandTraceForFishSet,
  bandTraceRegimeRuns,
  bandTraceToTSV,
  bandTraceRunsToTSV,
} from '../atlases/inversion/shared/band_trace.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function approx(a, b, tol = 1e-9) {
  return Math.abs(a - b) <= tol;
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('constants');
check('COSEG_MAX is 0.40',     BTRACE_COSEG_ENTROPY_MAX === 0.40);
check('FANNED_MIN is 0.85',    BTRACE_FANNED_ENTROPY_MIN === 0.85);
check('MIN_VALID is 3',        BTRACE_MIN_VALID_FISH === 3);
check('MIN_RUN_LENGTH is 2',   BTRACE_MIN_RUN_LENGTH === 2);

// =====================================================================
group('bandTraceShannonEntropy');
check('empty fractions → 0',       bandTraceShannonEntropy([], 3) === 0);
check('K <= 1 → 0',                bandTraceShannonEntropy([0.5, 0.5], 1) === 0);
check('all zero → 0',              bandTraceShannonEntropy([0, 0, 0], 3) === 0);
check('all in one bin → 0',        approx(bandTraceShannonEntropy([1, 0, 0], 3), 0));
check('uniform K=3 → 1',           approx(bandTraceShannonEntropy([1, 1, 1], 3), 1, 1e-9));
check('uniform K=2 → 1',           approx(bandTraceShannonEntropy([0.5, 0.5], 2), 1, 1e-9));
{
  // 70/30 split, K=2: H = -(0.7 ln 0.7 + 0.3 ln 0.3) / ln 2 ≈ 0.881
  const v = bandTraceShannonEntropy([0.7, 0.3], 2);
  check('70/30 split K=2 ≈ 0.881',  approx(v, 0.8812908992, 1e-6),
                                     `got ${v}`);
}
check('fractions need not sum to 1 (renormalised internally)',
      approx(bandTraceShannonEntropy([2, 2, 2], 3), 1, 1e-9));

// =====================================================================
// Build a synthetic fixture: 5 L2s × 3 bands × 6 samples.
//   Samples 0,1,2  → all in band 0 at every L2 (perfect co_seg)
//   Samples 3,4,5  → spread evenly (band 0, 1, 2 cycled)
// =====================================================================
const K = 3;
const N_SAMPLES = 6;
const L2_INDICES = [10, 11, 12, 13, 14];   // arbitrary L2 indices

function makeLabels(l2idx) {
  const out = new Int8Array(N_SAMPLES);
  for (let s = 0; s < N_SAMPLES; s++) {
    if (s < 3) out[s] = 0;
    else       out[s] = (s + l2idx) % 3;
  }
  return out;
}

group('bandTraceForFishSet — input validation');
check('null fishSet → null',
      bandTraceForFishSet(null,
        { K, l2_indices: L2_INDICES, getLabelsForL2: makeLabels }) === null);
check('empty fishSet → null',
      bandTraceForFishSet(new Set(),
        { K, l2_indices: L2_INDICES, getLabelsForL2: makeLabels }) === null);
check('K = 0 → null',
      bandTraceForFishSet([0, 1, 2],
        { K: 0, l2_indices: L2_INDICES, getLabelsForL2: makeLabels }) === null);
check('missing l2_indices → null',
      bandTraceForFishSet([0, 1, 2],
        { K, getLabelsForL2: makeLabels }) === null);
check('empty l2_indices → null',
      bandTraceForFishSet([0, 1, 2],
        { K, l2_indices: [], getLabelsForL2: makeLabels }) === null);
check('missing getLabelsForL2 → null',
      bandTraceForFishSet([0, 1, 2],
        { K, l2_indices: L2_INDICES }) === null);

// =====================================================================
group('bandTraceForFishSet — perfect co-segregation');
{
  const trace = bandTraceForFishSet([0, 1, 2],
    { K, l2_indices: L2_INDICES, getLabelsForL2: makeLabels });
  check('returns non-null trace',           trace !== null);
  check('n_fish_selected = 3',              trace.n_fish_selected === 3);
  check('K = 3',                            trace.K === 3);
  check('per_l2 has 5 entries',             trace.per_l2.length === 5);
  // Every L2 should have n_valid = 3, all in band 0
  let allCoseg = true;
  for (const e of trace.per_l2) {
    if (e.n_valid !== 3) allCoseg = false;
    if (e.dominant_band !== 0) allCoseg = false;
    if (!approx(e.dominant_fraction, 1)) allCoseg = false;
    if (e.regime !== 'co_seg') allCoseg = false;
  }
  check('all 5 L2s: co_seg, dominant_band=0, fraction=1', allCoseg);
}

// =====================================================================
group('bandTraceForFishSet — fanned regime');
{
  // Samples 3, 4, 5 spread across bands per the makeLabels cycle:
  //   At l2idx=10: (3+10)%3=1, (4+10)%3=2, (5+10)%3=0  → all 3 bands
  //   At l2idx=11: (3+11)%3=2, (4+11)%3=0, (5+11)%3=1  → all 3 bands
  // The fish-set has 3 valid samples each L2, distributed across all
  // K=3 bands evenly → entropy = 1 → fanned.
  const trace = bandTraceForFishSet([3, 4, 5],
    { K, l2_indices: L2_INDICES, getLabelsForL2: makeLabels });
  check('returns non-null trace',           trace !== null);
  let allFanned = true;
  for (const e of trace.per_l2) {
    if (e.n_valid !== 3) allFanned = false;
    if (e.regime !== 'fanned') allFanned = false;
  }
  check('all 5 L2s: fanned (entropy = 1)',  allFanned);
  // entropy should be 1.0 exactly (uniform 1/1/1 distribution)
  check('entropy ≈ 1 on uniform spread',    approx(trace.per_l2[0].entropy, 1, 1e-9));
}

// =====================================================================
group('bandTraceForFishSet — sparse regime (< min_valid)');
{
  // Single fish — n_valid = 1 at each L2, below BTRACE_MIN_VALID_FISH=3.
  const trace = bandTraceForFishSet([0],
    { K, l2_indices: L2_INDICES, getLabelsForL2: makeLabels });
  let allSparse = true;
  for (const e of trace.per_l2) {
    if (e.n_valid !== 1) allSparse = false;
    if (e.regime !== 'sparse') allSparse = false;
  }
  check('1-fish set: regime = sparse on every L2', allSparse);
}

// =====================================================================
group('bandTraceForFishSet — Set vs Array input');
{
  const traceSet   = bandTraceForFishSet(new Set([0, 1, 2]),
    { K, l2_indices: L2_INDICES, getLabelsForL2: makeLabels });
  const traceArray = bandTraceForFishSet([0, 1, 2],
    { K, l2_indices: L2_INDICES, getLabelsForL2: makeLabels });
  check('Set and Array inputs produce same trace',
        traceSet.per_l2.length === traceArray.per_l2.length
        && traceSet.per_l2[0].n_valid === traceArray.per_l2[0].n_valid);
}

// =====================================================================
group('bandTraceForFishSet — out-of-range sample indices dropped');
{
  // Fish set includes indices outside [0, N_SAMPLES) — should be ignored.
  const trace = bandTraceForFishSet([0, 1, 2, -1, 99, 500],
    { K, l2_indices: L2_INDICES, getLabelsForL2: makeLabels });
  check('out-of-range indices dropped',  trace.per_l2[0].n_valid === 3);
}

// =====================================================================
group('bandTraceRegimeRuns — co_seg aggregation');
{
  const trace = bandTraceForFishSet([0, 1, 2],
    { K, l2_indices: L2_INDICES, getLabelsForL2: makeLabels });
  const runs = bandTraceRegimeRuns(trace);
  check('5 consecutive co_seg L2s → 1 run',  runs.length === 1);
  check('run.n_L2 = 5',                       runs[0].n_L2 === 5);
  check('run.dominant_band = 0',              runs[0].dominant_band === 0);
  check('run.n_co_seg = 5',                   runs[0].n_co_seg === 5);
  check('run.n_partial = 0',                  runs[0].n_partial === 0);
  check('run.mean_dominant_fraction ≈ 1',     approx(runs[0].mean_dominant_fraction, 1));
  check('run.mean_entropy ≈ 0',               approx(runs[0].mean_entropy, 0));
}

// =====================================================================
group('bandTraceRegimeRuns — fanned breaks runs');
{
  const trace = bandTraceForFishSet([3, 4, 5],
    { K, l2_indices: L2_INDICES, getLabelsForL2: makeLabels });
  const runs = bandTraceRegimeRuns(trace);
  check('all-fanned trace → 0 runs',  runs.length === 0);
}

// =====================================================================
group('bandTraceRegimeRuns — min_run_length filtering');
{
  // Synthesise a trace by hand: 1 co_seg, 1 fanned, 1 co_seg, 1 fanned, 2 co_seg
  // Default min_run_length = 2 → only the trailing 2-L2 run survives.
  const trace = {
    n_fish_selected: 3, n_chains: 1, n_total_L2: 6, K: 3,
    per_l2: [
      { l2_idx: 0, chain_idx: 0, chain_position: 0, n_valid: 3,
        regime: 'co_seg', dominant_band: 0, dominant_fraction: 1, entropy: 0 },
      { l2_idx: 1, chain_idx: 0, chain_position: 1, n_valid: 3,
        regime: 'fanned', dominant_band: 1, dominant_fraction: 0.4, entropy: 0.95 },
      { l2_idx: 2, chain_idx: 0, chain_position: 2, n_valid: 3,
        regime: 'co_seg', dominant_band: 0, dominant_fraction: 1, entropy: 0 },
      { l2_idx: 3, chain_idx: 0, chain_position: 3, n_valid: 3,
        regime: 'fanned', dominant_band: 1, dominant_fraction: 0.4, entropy: 0.95 },
      { l2_idx: 4, chain_idx: 0, chain_position: 4, n_valid: 3,
        regime: 'co_seg', dominant_band: 0, dominant_fraction: 1, entropy: 0 },
      { l2_idx: 5, chain_idx: 0, chain_position: 5, n_valid: 3,
        regime: 'co_seg', dominant_band: 0, dominant_fraction: 1, entropy: 0 },
    ],
  };
  const runsDefault = bandTraceRegimeRuns(trace);
  check('min_run=2 (default): 1 run kept',  runsDefault.length === 1);
  check('kept run starts at L2 4',          runsDefault[0].start_l2_idx === 4);
  check('kept run n_L2 = 2',                runsDefault[0].n_L2 === 2);

  const runsAll = bandTraceRegimeRuns(trace, { min_run_length: 1 });
  check('min_run=1: 3 runs kept',           runsAll.length === 3);
}

// =====================================================================
group('bandTraceRegimeRuns — chain breaks force run split');
{
  // Same regime on both sides of a chain break — must split.
  const trace = {
    n_fish_selected: 3, n_chains: 2, n_total_L2: 4, K: 3,
    per_l2: [
      { l2_idx: 0, chain_idx: 0, chain_position: 0, n_valid: 3,
        regime: 'co_seg', dominant_band: 0, dominant_fraction: 1, entropy: 0 },
      { l2_idx: 1, chain_idx: 0, chain_position: 1, n_valid: 3,
        regime: 'co_seg', dominant_band: 0, dominant_fraction: 1, entropy: 0 },
      { l2_idx: 2, chain_idx: 1, chain_position: 0, n_valid: 3,
        regime: 'co_seg', dominant_band: 0, dominant_fraction: 1, entropy: 0 },
      { l2_idx: 3, chain_idx: 1, chain_position: 1, n_valid: 3,
        regime: 'co_seg', dominant_band: 0, dominant_fraction: 1, entropy: 0 },
    ],
  };
  const runs = bandTraceRegimeRuns(trace);
  check('chain break splits one all-co_seg trace into 2 runs', runs.length === 2);
  check('run 0 ends at L2 1 (chain 0)',  runs[0].end_l2_idx === 1);
  check('run 1 starts at L2 2 (chain 1)', runs[1].start_l2_idx === 2);
}

console.log('\n--- bandTraceToTSV + bandTraceRunsToTSV ---');
{
  const trace = {
    K: 3,
    n_fish_selected: 5,
    per_l2: [
      { l2_idx: 0, chain_idx: 0, chain_position: 0, n_valid: 4,
        regime: 'co_seg', dominant_band: 0, dominant_fraction: 1.0, entropy: 0,
        band_fractions: [1, 0, 0] },
      { l2_idx: 1, chain_idx: 0, chain_position: 1, n_valid: 3,
        regime: 'partial', dominant_band: 1, dominant_fraction: 0.667, entropy: 0.55,
        band_fractions: [0.33, 0.67, 0] },
    ],
  };
  const tsv = bandTraceToTSV(trace, { chrom: 'LG28', envelopes: null });
  check('bandTraceToTSV returns string', typeof tsv === 'string');
  check('TSV header has chrom+l2_idx',   tsv.includes('chrom\tl2_idx'));
  check('TSV header has band_fraction_2 column',
        tsv.includes('band_fraction_2'));
  check('TSV row 1 starts with LG28\\t0', tsv.split('\n')[1].startsWith('LG28\t0'));
  check('TSV row 1 includes co_seg regime', tsv.split('\n')[1].includes('co_seg'));
  check('null trace → null',             bandTraceToTSV(null) === null);

  const runs = [{
    chain_idx: 0, start_l2_idx: 0, end_l2_idx: 4, n_L2: 5,
    n_co_seg: 4, n_partial: 1, dominant_band: 0,
    sum_dom: 4.5, sum_ent: 0.5,
  }];
  const runsTsv = bandTraceRunsToTSV(runs, { chrom: 'LG28' });
  check('runs TSV has run_idx column',   runsTsv.includes('run_idx'));
  check('runs TSV has mean_dominant_fraction', runsTsv.includes('mean_dominant_fraction'));
  check('runs TSV row dominant_band = 0',
        runsTsv.split('\n')[1].split('\t')[10] === '0');
  check('runs TSV mean_dom = 4.5/5 = 0.9',
        runsTsv.split('\n')[1].split('\t')[11] === '0.900000');
  check('null runs → null',              bandTraceRunsToTSV(null) === null);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
