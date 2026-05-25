// tests/test_shared_dosage_debug.js
//
// Behavior tests for buildDosageDebugReport in shared/dosage_chunks.js
// (2026-05-26 — closes the "PCA scatter is grey under color: dosage"
// diagnostic loop).
//
// Covers the diagnosis-tree branches:
//   - no getCachedChunk installed
//   - chunk fetcher installed but LRU empty
//   - no tracked samples
//   - all tracked samples NaN for both dosage AND het
//     (sample-id mismatch class)
//   - chunk loaded + sample-id matches + dosage values projected
//   - partial NaN (some tracked samples missing dosage)
//   - range fallback when no override + no L2 envelope at cursor
//
// Run from repo root:
//   node tests/test_shared_dosage_debug.js

import { buildDosageDebugReport } from '../atlases/inversion/shared/dosage_chunks.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// Minimal state factory — gives the function enough to walk through:
//   data.chrom / data.windows[] / data.samples[] / data.n_samples,
//   tracked[], cur, _linesPanelGetCachedChunk(startBp, endBp), and the
//   __dosageChunkLru that buildDosageDebugReport reads for the cached
//   chunk-keys list.
function mkState({ tracked = [], chunk = null, lruKeys = [] } = {}) {
  const windows = [];
  for (let i = 0; i < 20; i++) {
    windows.push({ start_bp: i * 100_000, end_bp: (i + 1) * 100_000, center_bp: i * 100_000 + 50_000 });
  }
  const samples = [
    { cga: 'CGA_001' },
    { cga: 'CGA_002' },
    { cga: 'CGA_003' },
    { cga: 'CGA_004' },
  ];
  const state = {
    cur: 5,
    tracked,
    data: { chrom: 'C_gar_LG07', n_samples: samples.length, windows, samples },
  };
  if (chunk != null) {
    // Install a getCachedChunk that always returns `chunk`. Real
    // installations also fire async fetches on miss; the test stub is
    // synchronous and idempotent.
    state._linesPanelGetCachedChunk = () => chunk;
  }
  if (lruKeys.length > 0) {
    state.__dosageChunkLru = new Map();
    for (const k of lruKeys) state.__dosageChunkLru.set(k, chunk || {});
  }
  return state;
}

// ---------------------------------------------------------------------------
group('diagnosis: getCachedChunk never installed');
{
  const state = mkState({ tracked: [0, 1] });
  const r = buildDosageDebugReport(state, null, null);
  check('diagnosis flags missing installer',
        r.diagnosis.includes('getCachedChunk not installed'));
  check('lruKeys = []',          r.lruKeys.length === 0);
  check('tracked rows length 2', r.trackedRows.length === 2);
  check('every dosage NaN',      r.trackedRows.every(row => !Number.isFinite(row.dosage)));
}

// ---------------------------------------------------------------------------
group('diagnosis: installer present, LRU empty');
{
  const state = mkState({ tracked: [0, 1] });
  state._linesPanelGetCachedChunk = () => null;  // installer present, returns null
  const r = buildDosageDebugReport(state, null, null);
  check('diagnosis flags "No chunks cached yet"',
        r.diagnosis.includes('No chunks cached yet'));
  check('every dosage NaN (no chunk to read)',
        r.trackedRows.every(row => !Number.isFinite(row.dosage)));
}

// ---------------------------------------------------------------------------
group('diagnosis: no tracked samples');
{
  const state = mkState({ tracked: [] });
  state._linesPanelGetCachedChunk = () => null;
  const r = buildDosageDebugReport(state, null, null);
  check('diagnosis flags "No tracked samples"',
        r.diagnosis.includes('No tracked samples'));
  check('trackedRows = []', r.trackedRows.length === 0);
}

// ---------------------------------------------------------------------------
group('diagnosis: chunk loaded, sample-id mismatch → all NaN');
{
  // Chunk has dosage rows, but its sample ids don't match data.samples.
  const chunk = {
    markers: [
      { pos_bp: 410_000 }, { pos_bp: 420_000 }, { pos_bp: 430_000 },
    ],
    dosage: [
      [1.0, 0.5, 1.5, 2.0],
      [0.5, 1.0, 1.5, 2.0],
      [1.5, 1.5, 1.5, 1.5],
    ],
    samples: ['BAD_1', 'BAD_2', 'BAD_3', 'BAD_4'],  // no overlap with CGA_*
  };
  const state = mkState({ tracked: [0, 1, 2, 3], chunk, lruKeys: ['C_gar_LG07:400000-500000'] });
  const r = buildDosageDebugReport(state, null, { startW: 4, endW: 4 });
  check('lruKeys length = 1', r.lruKeys.length === 1);
  check('every tracked row dosage NaN (id mismatch)',
        r.trackedRows.every(row => !Number.isFinite(row.dosage)));
  check('every tracked row het NaN (same root cause)',
        r.trackedRows.every(row => !Number.isFinite(row.het)));
  check('diagnosis suggests sample-id mismatch',
        r.diagnosis.toLowerCase().includes('sample-id mismatch'));
}

// ---------------------------------------------------------------------------
group('chunk loaded + id match → dosage values projected');
{
  // chunk.samples align with data.samples cga ids → projection works.
  const chunk = {
    markers: [
      { pos_bp: 410_000 }, { pos_bp: 420_000 }, { pos_bp: 430_000 },
    ],
    dosage: [
      [0,    1,    2,    1],
      [0,    1,    2,    1],
      [0,    1,    2,    1],
    ],
    samples: ['CGA_001', 'CGA_002', 'CGA_003', 'CGA_004'],
  };
  const state = mkState({ tracked: [0, 1, 2, 3], chunk, lruKeys: ['C_gar_LG07:400000-500000'] });
  const r = buildDosageDebugReport(state, null, { startW: 4, endW: 4 });
  // Mean dosage = mean over 3 markers, each row identical, so each sample
  // returns the same value as the column (0, 1, 2, 1).
  check('CGA_001 dosage = 0', Math.abs(r.trackedRows[0].dosage - 0) < 1e-9);
  check('CGA_002 dosage = 1', Math.abs(r.trackedRows[1].dosage - 1) < 1e-9);
  check('CGA_003 dosage = 2', Math.abs(r.trackedRows[2].dosage - 2) < 1e-9);
  check('CGA_004 dosage = 1', Math.abs(r.trackedRows[3].dosage - 1) < 1e-9);
  check('diagnosis is the happy-path verdict',
        r.diagnosis.includes('All tracked samples have dosage'));
}

// ---------------------------------------------------------------------------
group('partial NaN — some tracked samples missing dosage');
{
  // Sample CGA_003's chunk row is all -1 (NA), so projection emits NaN
  // for that index even though the id-mapping worked.
  const chunk = {
    markers: [
      { pos_bp: 410_000 }, { pos_bp: 420_000 },
    ],
    dosage: [
      [0, 1, -1, 1],
      [0, 1, -1, 1],
    ],
    samples: ['CGA_001', 'CGA_002', 'CGA_003', 'CGA_004'],
  };
  const state = mkState({ tracked: [0, 1, 2, 3], chunk, lruKeys: ['C_gar_LG07:400000-500000'] });
  const r = buildDosageDebugReport(state, null, { startW: 4, endW: 4 });
  check('CGA_001 has a value',  Number.isFinite(r.trackedRows[0].dosage));
  check('CGA_002 has a value',  Number.isFinite(r.trackedRows[1].dosage));
  check('CGA_003 is NaN (all -1)', !Number.isFinite(r.trackedRows[2].dosage));
  check('CGA_004 has a value',  Number.isFinite(r.trackedRows[3].dosage));
  check('diagnosis surfaces the 3/4 partial',
        r.diagnosis.includes('3/4 tracked samples have a dosage value'));
}

// ---------------------------------------------------------------------------
group('range — caller override is honored');
{
  const state = mkState({ tracked: [0] });
  const r = buildDosageDebugReport(state, null, { startW: 2, endW: 7 });
  check('range.startW = 2 (override)', r.range.startW === 2);
  check('range.endW = 7 (override)',   r.range.endW === 7);
  check('startBp picks windows[2].start_bp', r.range.startBp === 200_000);
  check('endBp picks windows[7].end_bp',     r.range.endBp === 800_000);
}

// ---------------------------------------------------------------------------
group('range — default fallback (no override + no L2 envelope)');
{
  const state = mkState({ tracked: [0] });
  // cur = 5 (default); no l2_envelopes → ±20 window fallback, clamped.
  const r = buildDosageDebugReport(state, null, null);
  check('startW clamped to 0',  r.range.startW === 0);
  check('endW clamped to 19',   r.range.endW === 19);
  check('chrom forwarded',      r.range.chrom === 'C_gar_LG07');
}

// ---------------------------------------------------------------------------
group('null/missing state — graceful');
{
  const r = buildDosageDebugReport(null, null, null);
  check('null state → range null + empty rows',
        r.range === null && r.trackedRows.length === 0);
  check('null state → diagnosis hint',  r.diagnosis === 'no state.data');
}

// ---------------------------------------------------------------------------
group('idProjection — populated when chunk loads + correct match counts');
{
  const chunk = {
    markers: [{ pos_bp: 410_000 }],
    dosage: [[0, 1, 2, 1]],
    samples: ['CGA_001', 'CGA_002', 'BAD_3', 'CGA_004'],   // index 2 mismatches
  };
  const state = mkState({ tracked: [0], chunk, lruKeys: ['C_gar_LG07:400000-500000'] });
  const r = buildDosageDebugReport(state, null, { startW: 4, endW: 4 });
  check('idProjection present',                  r.idProjection != null);
  check('chunk_n = 4',                           r.idProjection.chunk_n === 4);
  check('cohort_n = 4',                          r.idProjection.cohort_n === 4);
  check('matched = 3, unmatched = 1',
        r.idProjection.matched === 3 && r.idProjection.unmatched === 1);
  check('match_rate ≈ 0.75',
        Math.abs(r.idProjection.match_rate - 0.75) < 1e-9);
  // sample_map has one entry per chunk sample, with the unmatched index marked.
  const sm = r.idProjection.sample_map;
  check('sample_map length = 4',                 sm.length === 4);
  check('chunk_idx 0 → cohort_idx 0 (matched)',
        sm[0].matched === true && sm[0].cohort_idx === 0);
  check('chunk_idx 2 → unmatched (cohort_idx -1)',
        sm[2].matched === false && sm[2].cohort_idx === -1);
  check('matched row carries cohort_id',
        sm[0].cohort_id === 'CGA_001');
  check('unmatched row cohort_id is null',
        sm[2].cohort_id === null);
}

// ---------------------------------------------------------------------------
group('idProjection — null when no chunk yet');
{
  const state = mkState({ tracked: [0] });
  state._linesPanelGetCachedChunk = () => null;
  const r = buildDosageDebugReport(state, null, null);
  check('no chunk → idProjection is null', r.idProjection === null);
}

// ---------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
