// tests/test_shared_lasso_linkage.js

import {
  LASSO_LINKAGE_DEFAULT_PURITY_THRESHOLD,
  LASSO_LINKAGE_DEFAULT_MIN_BAND_SIZE,
  computeLassoLinkage,
  lassoLinkageCacheKey,
  lassoLinkageGetOrCompute,
  lassoLinkageToTSV,
} from '../atlases/inversion/shared/lasso_linkage.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// Helper: build a candidate object
function cand({ id, chrom = 'LG28', K = 3, confirmed = true, locked_labels, start_bp = 0, end_bp = 1000 }) {
  return { id, chrom, K, confirmed,
           locked_labels: Int8Array.from(locked_labels),
           start_bp, end_bp };
}

// =====================================================================
group('constants');
check('purity threshold = 0.7',                LASSO_LINKAGE_DEFAULT_PURITY_THRESHOLD === 0.7);
check('min band size = 5',                     LASSO_LINKAGE_DEFAULT_MIN_BAND_SIZE === 5);

// =====================================================================
group('computeLassoLinkage — happy path');
{
  // 10 fish total. Candidate A: locked_labels = [0,0,0,0,0,1,1,1,2,2]
  //   Fish-set = {0, 1, 2, 3, 4} → all 5 in band 0 → purity 1.0, n=5 → strong
  const candA = cand({ id: 'A', locked_labels: [0, 0, 0, 0, 0, 1, 1, 1, 2, 2] });
  const fishSet = new Set([0, 1, 2, 3, 4]);
  const r = computeLassoLinkage(fishSet, [candA]);
  check('returns object',                       !!r);
  check('n_fish_selected = 5',                  r.n_fish_selected === 5);
  check('n_candidates_seen = 1',                r.n_candidates_seen === 1);
  const cell = r.per_candidate['A'];
  check('cell exists',                          !!cell);
  check('best_band = 0',                        cell.best_band === 0);
  check('best_purity = 1.0',                    cell.best_purity === 1.0);
  check('n_in_best_band = 5',                   cell.n_in_best_band === 5);
  check('n_lasso_seen = 5',                     cell.n_lasso_seen === 5);
  check('is_strong_link = true',                cell.is_strong_link === true);
  check('per_band has K=3 rows',                cell.per_band.length === 3);
  check('strong_links = [A]',                   JSON.stringify(r.strong_links) === '["A"]');
}

// =====================================================================
group('computeLassoLinkage — mixed purity');
{
  // Fish-set splits 3+2 across bands 0 and 1 → purity 0.6 < 0.7 → not strong
  const candA = cand({ id: 'A', locked_labels: [0, 0, 0, 1, 1, 1, 1, 1, 2, 2] });
  const fishSet = new Set([0, 1, 2, 3, 4]);
  const r = computeLassoLinkage(fishSet, [candA]);
  const cell = r.per_candidate['A'];
  // band 0 has 3 fish, band 1 has 2, band 2 has 0
  check('best_band = 0 (3 fish)',               cell.best_band === 0);
  check('best_purity = 0.6',                    Math.abs(cell.best_purity - 0.6) < 1e-9);
  check('not strong (purity < 0.7)',            cell.is_strong_link === false);
  check('strong_links empty',                   r.strong_links.length === 0);
}

// =====================================================================
group('computeLassoLinkage — strong by purity but failing min_band_size');
{
  // 3 fish all in band 0 → purity 1.0 but n=3 < min_band_size=5
  const candA = cand({ id: 'A', locked_labels: [0, 0, 0, 1, 1, 1, 1, 1, 2, 2] });
  const fishSet = new Set([0, 1, 2]);
  const r = computeLassoLinkage(fishSet, [candA]);
  const cell = r.per_candidate['A'];
  check('best_purity = 1.0',                    cell.best_purity === 1.0);
  check('n_in_best_band = 3',                   cell.n_in_best_band === 3);
  check('not strong (n < min_band_size)',       cell.is_strong_link === false);
}

// =====================================================================
group('computeLassoLinkage — sort order of strong_links');
{
  // 3 strong candidates with different (purity, n) tuples:
  //   A: purity 1.0, n=5
  //   B: purity 1.0, n=10  ← should come first (higher n)
  //   C: purity 0.8, n=20  ← lower purity
  // Expected order: B, A, C (purity desc, then n desc, then id asc)
  const candA = cand({ id: 'A',
    locked_labels: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] });
  const candB = cand({ id: 'B',
    locked_labels: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] });
  const candC = cand({ id: 'C',
    locked_labels: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1] });
  // Fish-set lassos top 20 fish indices for all
  // For A: indices 0..4 in band 0 (5), indices 5..19 in band 1 → with fishSet [0..19]:
  //   A purity = 15/20 = 0.75, n in best band = 15
  // We want clean fixtures. Use small targeted fish-sets per candidate test:
  // Use one common fish-set [0..19] and design label patterns:
  //   A: 5 in band 0, 15 in band 1 → n_lasso_seen=20, best=band 1 (15), purity 15/20=0.75, strong=true
  //   B: 10 in band 0, 10 in band 1 → best=0 (tie broken by lower idx), purity 0.5, NOT strong
  //   C: 16 in band 0, 4 in band 1 → best=0 (16), purity 16/20=0.80, strong=true
  // Need to design A and B more cleanly. Skip and use straightforward fixtures:
  const fishSet = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);  // 10 fish
  // A: all 10 in band 0 → purity 1.0, n=10
  const candA2 = cand({ id: 'A', locked_labels: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1] });
  // B: 9/10 in band 0 → purity 0.9, n=9 (lower purity, still strong)
  const candB2 = cand({ id: 'B', locked_labels: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1] });
  // C: all 10 in band 1 → purity 1.0, n=10 (tied with A → id asc → A first)
  const candC2 = cand({ id: 'C', locked_labels: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2] });
  const r = computeLassoLinkage(fishSet, [candA2, candB2, candC2]);
  // Expected order: A (1.0, 10), C (1.0, 10) — id asc → A,C ; then B (0.9, 9)
  check('strong_links count = 3',               r.strong_links.length === 3);
  check('A first (tied with C, id asc)',        r.strong_links[0] === 'A');
  check('C second',                             r.strong_links[1] === 'C');
  check('B last (lower purity)',                r.strong_links[2] === 'B');
}

// =====================================================================
group('computeLassoLinkage — chrom_filter');
{
  const candA = cand({ id: 'A', chrom: 'LG28', locked_labels: [0, 0, 0, 0, 0, 1, 1] });
  const candB = cand({ id: 'B', chrom: 'LG14', locked_labels: [0, 0, 0, 0, 0, 1, 1] });
  const fishSet = new Set([0, 1, 2, 3, 4]);
  const r = computeLassoLinkage(fishSet, [candA, candB], { chrom_filter: 'LG28' });
  check('only LG28 candidate seen',             r.n_candidates_seen === 1);
  check('A in result',                          !!r.per_candidate['A']);
  check('B not in result',                      !r.per_candidate['B']);
}

// =====================================================================
group('computeLassoLinkage — candidate filtering');
{
  const candA = cand({ id: 'A', locked_labels: [0, 0, 0, 0, 0] });
  const candUnconfirmed = cand({ id: 'B', confirmed: false, locked_labels: [0, 0, 0, 0, 0] });
  const candNoLabels   = { id: 'C', confirmed: true, chrom: 'LG28', K: 3, locked_labels: null };
  const candNoId       = cand({ id: '', locked_labels: [0, 0, 0, 0, 0] });
  const fishSet = new Set([0, 1, 2, 3, 4]);
  const r = computeLassoLinkage(fishSet, [candA, candUnconfirmed, candNoLabels, candNoId]);
  check('only confirmed-with-labels-and-id counted', r.n_candidates_seen === 1);
  check('A in result',                          !!r.per_candidate['A']);
  check('B (unconfirmed) skipped',              !r.per_candidate['B']);
  check('C (no labels) skipped',                !r.per_candidate['C']);
}

// =====================================================================
group('computeLassoLinkage — fish-set normalization');
{
  const candA = cand({ id: 'A', locked_labels: [0, 0, 0, 0, 0, 1, 1] });
  // Array input
  let r = computeLassoLinkage([0, 1, 2, 3, 4], [candA]);
  check('array fishSet works',                  r.per_candidate['A'].best_purity === 1.0);
  // Set input
  r = computeLassoLinkage(new Set([0, 1, 2, 3, 4]), [candA]);
  check('Set fishSet works',                    r.per_candidate['A'].best_purity === 1.0);
  // Float values get coerced to int via |0
  r = computeLassoLinkage([0.7, 1.5, 2, 3, 4], [candA]);
  check('non-int fishSet coerced via |0',       r.per_candidate['A'].best_purity === 1.0);
}

// =====================================================================
group('computeLassoLinkage — out-of-range / unassigned fish');
{
  const candA = cand({ id: 'A', locked_labels: [0, 0, 0, -1, 1] });  // -1 = unassigned
  const fishSet = new Set([0, 1, 2, 3, 99]);  // 3 is unassigned, 99 is out-of-range
  const r = computeLassoLinkage(fishSet, [candA]);
  const cell = r.per_candidate['A'];
  check('only 3 fish assignable (0,1,2)',       cell.n_lasso_seen === 3);
  check('best_band = 0',                        cell.best_band === 0);
  check('best_purity = 1.0 (3/3)',              cell.best_purity === 1.0);
}

// =====================================================================
group('computeLassoLinkage — custom thresholds');
{
  const candA = cand({ id: 'A', locked_labels: [0, 0, 0, 1, 1, 1, 1] });
  const fishSet = new Set([0, 1, 2, 3]);  // 3 in band 0, 1 in band 1 → purity 0.75
  const r = computeLassoLinkage(fishSet, [candA], { purity_threshold: 0.9, min_band_size: 1 });
  check('custom: stricter purity fails strong', r.per_candidate['A'].is_strong_link === false);
  const r2 = computeLassoLinkage(fishSet, [candA], { purity_threshold: 0.5, min_band_size: 1 });
  check('custom: lower purity passes',          r2.per_candidate['A'].is_strong_link === true);
}

// =====================================================================
group('computeLassoLinkage — input validation');
check('null fishSet → null',                  computeLassoLinkage(null, []) === null);
check('null candidateList → null',            computeLassoLinkage([0], null) === null);
check('non-array candidateList → null',       computeLassoLinkage([0], 'oops') === null);
check('empty fish-set → null',                computeLassoLinkage(new Set(), []) === null);
check('non-iterable fishSet → null',          computeLassoLinkage(42, []) === null);

// =====================================================================
group('lassoLinkageCacheKey');
{
  const candA = cand({ id: 'A', locked_labels: [0, 1, 2] });
  const k1 = lassoLinkageCacheKey(null, new Set([1, 2, 3]), [candA]);
  check('returns string',                       typeof k1 === 'string');
  // Order-insensitive in fish-set
  const k2 = lassoLinkageCacheKey(null, new Set([3, 1, 2]), [candA]);
  check('order-insensitive fish-set',           k1 === k2);
  // Array vs Set fish-set
  const k3 = lassoLinkageCacheKey(null, [1, 2, 3], [candA]);
  check('Set and Array produce same key',       k1 === k3);
  // Different fish-set → different key
  const k4 = lassoLinkageCacheKey(null, new Set([1, 2, 4]), [candA]);
  check('different fish-set → different key',   k1 !== k4);
  // chromFilter changes the key
  const k5 = lassoLinkageCacheKey('LG28', new Set([1, 2, 3]), [candA]);
  check('different chrom filter → different key', k1 !== k5);
  // Adding a candidate changes the key
  const candB = cand({ id: 'B', locked_labels: [0, 1, 2] });
  const k6 = lassoLinkageCacheKey(null, new Set([1, 2, 3]), [candA, candB]);
  check('adding candidate → different key',     k1 !== k6);
  // Unconfirmed candidate doesn't affect key
  const candC = cand({ id: 'C', confirmed: false, locked_labels: [0, 1, 2] });
  const k7 = lassoLinkageCacheKey(null, new Set([1, 2, 3]), [candA, candC]);
  check('unconfirmed candidate skipped in fp',  k1 === k7);
}
check('null fishSet → null',                  lassoLinkageCacheKey(null, null, []) === null);
check('non-array candidateList → null',       lassoLinkageCacheKey(null, [1], 'oops') === null);

// =====================================================================
group('lassoLinkageGetOrCompute — cache hit / miss');
{
  const candA = cand({ id: 'A', locked_labels: [0, 0, 0, 0, 0, 1, 1] });
  const state = {
    bandTraceFishSet: [0, 1, 2, 3, 4],
    candidateList: [candA],
  };
  const r1 = lassoLinkageGetOrCompute(state);
  check('first call returns result',            !!r1);
  check('cache stored',                         state.lassoLinkageCache === r1);
  check('cache key stored',                     typeof state.lassoLinkageCacheKey === 'string');
  // Second call: cache hit (same object ref)
  const r2 = lassoLinkageGetOrCompute(state);
  check('cache hit: same object',               r2 === r1);
  // Mutating fish-set → new key → cache miss
  state.bandTraceFishSet = [0, 1, 2];
  const r3 = lassoLinkageGetOrCompute(state);
  check('cache miss: new object',               r3 !== r1);
  check('fish-set change reflected',            r3.n_fish_selected === 3);
}
{
  // No fish-set → null
  const state = { candidateList: [] };
  check('no bandTraceFishSet → null',           lassoLinkageGetOrCompute(state) === null);
}
{
  // Empty fish-set → null
  const state = { bandTraceFishSet: [], candidateList: [cand({ id: 'A', locked_labels: [0] })] };
  check('empty fish-set → null',                lassoLinkageGetOrCompute(state) === null);
}
{
  // No candidate list → null
  const state = { bandTraceFishSet: [1, 2, 3], candidateList: [] };
  check('empty candidate list → null',          lassoLinkageGetOrCompute(state) === null);
}
check('null state → null',                    lassoLinkageGetOrCompute(null) === null);

console.log('\n--- lassoLinkageToTSV ---');
{
  const result = {
    n_fish_selected: 5,
    n_candidates_seen: 2,
    purity_threshold: 0.7,
    min_band_size: 5,
    strong_links: [],
    per_candidate: {
      'I1': { id: 'I1', chrom: 'LG28', start_bp: 15000000, end_bp: 18000000,
              K: 3, best_band: 0, best_purity: 0.85, n_in_best_band: 5,
              n_lasso_seen: 5, is_strong_link: true },
      'I2': { id: 'I2', chrom: 'LG12', start_bp: 1000000,  end_bp: 2000000,
              K: 3, best_band: 1, best_purity: 0.40, n_in_best_band: 2,
              n_lasso_seen: 5, is_strong_link: false },
    },
  };
  const tsv = lassoLinkageToTSV(result);
  check('lassoLinkageToTSV returns string', typeof tsv === 'string');
  check('TSV has metadata comment',         tsv.includes('# n_fish_selected\t5'));
  check('TSV has candidate_id column',      tsv.includes('candidate_id\tchrom'));
  // Strong links should appear first (I1 before I2)
  const dataRows = tsv.split('\n').filter(l => l && !l.startsWith('#') && !l.startsWith('candidate_id'));
  check('strong link I1 sorted first',      dataRows[0].startsWith('I1'));
  check('weak link I2 sorted second',       dataRows[1].startsWith('I2'));
  check('I1 row has is_strong_link=1',      dataRows[0].endsWith('\t1'));
  check('I2 row has is_strong_link=0',      dataRows[1].endsWith('\t0'));
  check('null result → null',               lassoLinkageToTSV(null) === null);
  check('result without per_candidate → null',
        lassoLinkageToTSV({ n_fish_selected: 1 }) === null);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
