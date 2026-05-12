// tests/test_shared_cross_candidate.js

import {
  CROSS_CANDIDATE_MIN_N_DEFAULT,
  CROSS_CANDIDATE_LOW_COUNT_FRACTION,
  bandFingerprintFor,
  crossCandidateContingency,
  crossCandidateMatrix,
} from '../atlases/inversion/shared/cross_candidate.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 1e-6); }

// =====================================================================
group('constants');
check('MIN_N_DEFAULT = 10',                    CROSS_CANDIDATE_MIN_N_DEFAULT === 10);
check('LOW_COUNT_FRACTION = 0.20',             CROSS_CANDIDATE_LOW_COUNT_FRACTION === 0.20);

// =====================================================================
group('bandFingerprintFor — perfect concentration');
{
  // All 8 samples in band 0 of A map to band 1 of B → dist = [0, 1, 0]
  const labelsA = [0, 0, 0, 0, 0, 0, 0, 0];
  const labelsB = [1, 1, 1, 1, 1, 1, 1, 1];
  const r = bandFingerprintFor(labelsA, labelsB, 1, 3, 0, 'srcId', 'tgtId');
  check('returns object',                       !!r);
  check('source_id pass-through',               r.source_id === 'srcId');
  check('target_id pass-through',               r.target_id === 'tgtId');
  check('n = 8',                                r.n === 8);
  check('mode_band = 1',                        r.mode_band === 1);
  check('mode_share = 1.0',                     r.mode_share === 1.0);
  check('dist[1] = 1.0',                        r.dist[1] === 1.0);
  check('dist[0] = 0',                          r.dist[0] === 0);
  // Entropy 0 → concentration 1
  check('entropy = 0 (degenerate)',             approx(r.entropy, 0));
  check('concentration = 1',                    approx(r.concentration, 1));
}

// =====================================================================
group('bandFingerprintFor — uniform');
{
  // Band 0 of A: 9 samples, split evenly across 3 B bands → dist = [1/3, 1/3, 1/3]
  const labelsA = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const labelsB = [0, 0, 0, 1, 1, 1, 2, 2, 2];
  const r = bandFingerprintFor(labelsA, labelsB, 1, 3, 0);
  check('uniform: dist[0] ≈ 1/3',               approx(r.dist[0], 1 / 3));
  check('uniform: dist[1] ≈ 1/3',               approx(r.dist[1], 1 / 3));
  check('uniform: dist[2] ≈ 1/3',               approx(r.dist[2], 1 / 3));
  // Entropy = log(3); concentration = 1 - log(3)/log(3) = 0
  check('uniform: entropy ≈ log(3)',            approx(r.entropy, Math.log(3)));
  check('uniform: concentration ≈ 0',           approx(r.concentration, 0));
  // null source/target ids default to null
  check('default source_id = null',             r.source_id === null);
}

// =====================================================================
group('bandFingerprintFor — out-of-range labelsB dropped');
{
  // Some labelsB are -1 (unassigned) or KB → silently dropped
  const labelsA = [0, 0, 0, 0, 0, 0];
  const labelsB = [-1, 0, 0, 5, 1, 1];   // KB=2, so 5 and -1 dropped
  const r = bandFingerprintFor(labelsA, labelsB, 1, 2, 0);
  check('out-of-range dropped: n = 4',          r.n === 4);
  check('dist[0] = 0.5 (2/4)',                  r.dist[0] === 0.5);
  check('dist[1] = 0.5 (2/4)',                  r.dist[1] === 0.5);
}

// =====================================================================
group('bandFingerprintFor — empty band');
{
  // Band 1 of A has no samples
  const labelsA = [0, 0, 0, 0];
  const labelsB = [0, 1, 0, 1];
  const r = bandFingerprintFor(labelsA, labelsB, 2, 2, 1);
  check('empty band: n = 0',                    r.n === 0);
  check('empty band: mode_band = -1',           r.mode_band === -1);
  check('empty band: mode_share = 0',           r.mode_share === 0);
  check('empty band: entropy = NaN',            Number.isNaN(r.entropy));
  check('empty band: concentration = NaN',      Number.isNaN(r.concentration));
}

// =====================================================================
group('bandFingerprintFor — out-of-range band_a → null');
check('band_a = -1 → null',                    bandFingerprintFor([0], [0], 1, 1, -1) === null);
check('band_a = K → null',                     bandFingerprintFor([0], [0], 1, 1, 1) === null);

// =====================================================================
group('crossCandidateContingency — happy path');
{
  // Perfect correlation: every A=k maps to B=k
  const labelsA = [];
  const labelsB = [];
  for (let i = 0; i < 30; i++) {
    const k = i % 3;
    labelsA.push(k);
    labelsB.push(k);
  }
  const r = crossCandidateContingency(labelsA, labelsB, 3, 3);
  check('returns object',                       !!r);
  check('n = 30',                               r.n === 30);
  check('KA = 3, KB = 3',                       r.KA === 3 && r.KB === 3);
  check('cramer_v ≈ 1 (perfect)',               approx(r.cramer_v, 1, 0.01));
  check('chi2 positive',                        r.chi2 > 0);
  check('df = (3-1)*(3-1) = 4',                 r.df === 4);
  check('p_value small (perfect → near 0)',     r.p_value < 0.001);
  check('band_fingerprints length = KA',        r.band_fingerprints.length === 3);
  // Diagonal cells should dominate
  check('M[0][0] = 10',                         r.M[0][0] === 10);
  check('M[1][1] = 10',                         r.M[1][1] === 10);
  check('M[2][2] = 10',                         r.M[2][2] === 10);
}

// =====================================================================
group('crossCandidateContingency — uncorrelated');
{
  // Random-like assignments → low Cramér's V
  const labelsA = [0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1];
  const labelsB = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1];
  const r = crossCandidateContingency(labelsA, labelsB, 2, 2);
  check('uncorrelated: cramer_v ≈ 0',           approx(r.cramer_v, 0, 0.1));
  check('uncorrelated: p_value not tiny',       r.p_value > 0.05);
}

// =====================================================================
group('crossCandidateContingency — n < min_n');
{
  const labelsA = [0, 1, 0, 1];
  const labelsB = [0, 1, 1, 0];
  const r = crossCandidateContingency(labelsA, labelsB, 2, 2);
  check('n=4 < default min_n=10: reason set',   typeof r.reason === 'string');
  check('cramer_v = NaN',                       Number.isNaN(r.cramer_v));
  check('chi2 = NaN',                           Number.isNaN(r.chi2));
  check('p_value = NaN',                        Number.isNaN(r.p_value));
  check('low_count_warning = true',             r.low_count_warning === true);
  check('band_fingerprints empty',              r.band_fingerprints.length === 0);
  // M is still populated
  check('M populated',                          r.M[0][0] === 1);
}
{
  // Custom min_n
  const labelsA = [0, 1, 0, 1];
  const labelsB = [0, 1, 1, 0];
  const r = crossCandidateContingency(labelsA, labelsB, 2, 2, { min_n: 3 });
  check('custom min_n: passes',                 !r.reason);
  check('cramer_v computed',                    Number.isFinite(r.cramer_v));
}

// =====================================================================
group('crossCandidateContingency — out-of-range labels dropped');
{
  const labelsA = [-1, 0, 1, 2, 0, 1, 2, 0, 1, 2, 5];   // -1 and 5 dropped
  const labelsB = [0, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0];
  const r = crossCandidateContingency(labelsA, labelsB, 3, 3);
  check('OOR dropped: n = 9',                   r.n === 9);
}

// =====================================================================
group('crossCandidateContingency — low_count_warning');
{
  // Many expected counts < 5 → warning fires
  const labelsA = [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3];
  const labelsB = [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3];
  const r = crossCandidateContingency(labelsA, labelsB, 4, 4);
  // Expected counts: rowSum * colSum / n = 3 * 3 / 12 = 0.75 < 5
  check('many cells < 5: low_count_warning',    r.low_count_warning === true);
  check('cells_below_5 reported',               r.cells_below_5 > 0);
}

// =====================================================================
group('crossCandidateContingency — dominant_patterns');
{
  // Strong corner: 20 samples all in (0, 0); rest distributed
  const labelsA = [], labelsB = [];
  for (let i = 0; i < 20; i++) { labelsA.push(0); labelsB.push(0); }
  for (let i = 0; i < 5; i++)  { labelsA.push(1); labelsB.push(1); }
  for (let i = 0; i < 5; i++)  { labelsA.push(2); labelsB.push(2); }
  const r = crossCandidateContingency(labelsA, labelsB, 3, 3);
  check('dominant_patterns has the (0,0) cell',
        r.dominant_patterns.some(p => p.source_band === 0 && p.target_band === 0 && p.count === 20));
  // Should be sorted by count desc
  check('dominant_patterns sorted desc',
        r.dominant_patterns.every((p, i) =>
          i === 0 || r.dominant_patterns[i - 1].count >= p.count));
  // Max 6 entries
  check('dominant_patterns ≤ 6',                r.dominant_patterns.length <= 6);
}

// =====================================================================
group('crossCandidateContingency — input validation');
check('null labelsA → null',                  crossCandidateContingency(null, [0], 1, 1) === null);
check('null labelsB → null',                  crossCandidateContingency([0], null, 1, 1) === null);
check('length mismatch → null',
      crossCandidateContingency([0, 1], [0], 1, 1) === null);
check('KA = 0 → null',                        crossCandidateContingency([0], [0], 0, 1) === null);
check('KB = 0 → null',                        crossCandidateContingency([0], [0], 1, 0) === null);
check('negative KA → null',                   crossCandidateContingency([0], [0], -1, 1) === null);

// =====================================================================
group('crossCandidateMatrix — happy path');
{
  // 3 candidates, all perfectly correlated to each other
  const labels = [];
  for (let i = 0; i < 30; i++) labels.push(i % 3);
  const items = [
    { id: 'A', labels: labels.slice(), K: 3 },
    { id: 'B', labels: labels.slice(), K: 3 },
    { id: 'C', labels: labels.slice(), K: 3 },
  ];
  const r = crossCandidateMatrix(items);
  check('n_items = 3',                          r.n_items === 3);
  check('ids preserved',                        r.ids[0] === 'A' && r.ids[2] === 'C');
  check('K_per_item preserved',                 r.K_per_item[0] === 3);
  // cramer_v is N×N
  check('cramer_v length = 9',                  r.cramer_v.length === 9);
  // Diagonal = 1
  check('diag[0,0] = 1',                        r.cramer_v[0] === 1);
  check('diag[1,1] = 1',                        r.cramer_v[4] === 1);
  check('diag[2,2] = 1',                        r.cramer_v[8] === 1);
  // Off-diagonal ≈ 1 (perfect correlation)
  check('cramer_v[0,1] ≈ 1',                    approx(r.cramer_v[1], 1, 0.01));
  // Symmetric
  check('cramer_v[0,1] == cramer_v[1,0]',       r.cramer_v[1] === r.cramer_v[3]);
  // pair_details NOT populated by default
  check('pair_details empty by default',        r.pair_details.size === 0);
}

// =====================================================================
group('crossCandidateMatrix — full_details');
{
  const labels = [];
  for (let i = 0; i < 30; i++) labels.push(i % 3);
  const items = [
    { id: 'A', labels: labels.slice(), K: 3 },
    { id: 'B', labels: labels.slice(), K: 3 },
  ];
  const r = crossCandidateMatrix(items, { full_details: true });
  check('full_details: pair_details has entry',   r.pair_details.size === 1);
  const cell = r.pair_details.get('0:1');
  check('pair_details["0:1"] is a contingency',  cell && cell.M);
}

// =====================================================================
group('crossCandidateMatrix — missing labels handled');
{
  const items = [
    { id: 'A', labels: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1], K: 2 },
    { id: 'B', K: 2 },                                          // no labels
  ];
  const r = crossCandidateMatrix(items);
  check('n_items = 2',                          r.n_items === 2);
  check('A diag = 1',                           r.cramer_v[0] === 1);
  check('B diag = 1 (always)',                  r.cramer_v[3] === 1);
  check('A vs B is NaN (B has no labels)',      Number.isNaN(r.cramer_v[1]));
  check('B vs A also NaN',                      Number.isNaN(r.cramer_v[2]));
}

// =====================================================================
group('crossCandidateMatrix — id fallback');
{
  const items = [
    { labels: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], K: 1 },   // no id
    { id: 'X', labels: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], K: 1 },
  ];
  const r = crossCandidateMatrix(items);
  check('missing id → "_0"',                    r.ids[0] === '_0');
  check('explicit id preserved',                r.ids[1] === 'X');
}

// =====================================================================
group('crossCandidateMatrix — low-count warnings collected');
{
  // 6 candidates × K=4 with only 12 samples → many cells < 5 expected
  const labels = [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3];
  const items = [];
  for (let i = 0; i < 4; i++) items.push({ id: 'C' + i, labels: labels.slice(), K: 4 });
  const r = crossCandidateMatrix(items);
  check('warnings populated',                   r.warnings.count_below_5.length > 0);
  check('each warning has i, j, frac',
        r.warnings.count_below_5.every(w =>
          typeof w.i === 'number' && typeof w.j === 'number' && typeof w.frac === 'number'));
}

// =====================================================================
group('crossCandidateMatrix — empty / invalid');
check('null → null',                          crossCandidateMatrix(null) === null);
check('empty array → null',                   crossCandidateMatrix([]) === null);
check('non-array → null',                     crossCandidateMatrix('oops') === null);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
