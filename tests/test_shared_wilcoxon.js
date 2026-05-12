// tests/test_shared_wilcoxon.js

import { wilcoxonRankSumP } from '../atlases/inversion/shared/wilcoxon.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('wilcoxonRankSumP — input validation');
check('null a → null',                         wilcoxonRankSumP(null, [1]) === null);
check('null b → null',                         wilcoxonRankSumP([1], null) === null);
check('non-array → null',                      wilcoxonRankSumP('a', [1]) === null);
check('empty a → null',                        wilcoxonRankSumP([], [1, 2]) === null);
check('empty b → null',                        wilcoxonRankSumP([1, 2], []) === null);
{
  // All-NaN → null
  const r = wilcoxonRankSumP([NaN, NaN], [1, 2]);
  check('all-NaN a → null',                    r === null);
}
{
  // Mixed NaN: finite values used, NaNs dropped
  const r = wilcoxonRankSumP([1, NaN, 2], [3, 4]);
  check('mixed NaN: n_a counts finite only',   r.n_a === 2);
}

// =====================================================================
group('wilcoxonRankSumP — clean separation, no ties');
{
  // a = [1, 2, 3, 4, 5], b = [6, 7, 8, 9, 10] — fully separated
  const r = wilcoxonRankSumP([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]);
  check('n_a = 5',                              r.n_a === 5);
  check('n_b = 5',                              r.n_b === 5);
  check('R_a = 1+2+3+4+5 = 15',                 r.R_a === 15);
  check('U_a = 15 - 5*6/2 = 0',                 r.U_a === 0);
  check('mu = 5*5/2 = 12.5',                    r.mu === 12.5);
  check('no ties: n_tie_groups = 0',            r.n_tie_groups === 0);
  check('tie_correction_factor = 0',            r.tie_correction_factor === 0);
  // Standard formula: sigma² = 5*5*(10+1)/12 = 22.917
  check('sigma² ≈ 22.917',                      Math.abs(r.sigma2 - 22.917) < 0.01);
  // |U-mu| = 12.5 → z = (12.5 - 0.5)/sqrt(22.917) ≈ 2.506
  check('z ≈ 2.506',                            Math.abs(r.z - 2.506) < 0.01);
  // p_two_sided is tiny but finite, should be < 0.05
  check('p_two_sided < 0.05 (well-separated)',  r.p_two_sided < 0.05);
  check('p_two_sided > 0',                      r.p_two_sided > 0);
  check('direction = a_lower',                  r.direction === 'a_lower');
}

// =====================================================================
group('wilcoxonRankSumP — equal medians');
{
  // a and b interleaved — same distribution
  const r = wilcoxonRankSumP([1, 3, 5, 7, 9], [2, 4, 6, 8, 10]);
  // R_a = 1+3+5+7+9 = 25; mu_R = n_a*(N+1)/2 = 5*11/2 = 27.5; U_a = 25 - 15 = 10
  check('R_a = 25',                             r.R_a === 25);
  check('U_a = 10',                             r.U_a === 10);
  check('mu = 12.5',                            r.mu === 12.5);
  // |U-mu| = 2.5 → z = (2.5-0.5)/sqrt(22.917) ≈ 0.418
  check('z ≈ 0.418',                            Math.abs(r.z - 0.418) < 0.02);
  // p_two_sided ≈ 0.676 — not significant
  check('p_two_sided > 0.5',                    r.p_two_sided > 0.5);
}

// =====================================================================
group('wilcoxonRankSumP — ties handled');
{
  // Many ties: a = [1,1,1], b = [1,1,1]
  const r = wilcoxonRankSumP([1, 1, 1], [1, 1, 1]);
  // All 6 ranks at avg 3.5; R_a = 3*3.5 = 10.5; U_a = 10.5 - 6 = 4.5
  // mu = 9/2 = 4.5 → U_a = mu, diff = 0
  check('all-tied: U_a = mu',                   r.U_a === r.mu);
  check('all-tied: 1 tie group of size 6',      r.n_tie_groups === 1);
  // tie_correction_factor = (6³−6)/(6·5) = 210/30 = 7
  check('tie_correction_factor ≈ 7',            Math.abs(r.tie_correction_factor - 7) < 0.001);
  // sigma² = n_a*n_b/12 * ((N+1) - tcf) = 9/12 * (7 - 7) = 0
  check('full ties: sigma² = 0',                r.sigma2 === 0);
  check('full ties: sigma = 0',                 r.sigma === 0);
  check('full ties: z = NaN',                   Number.isNaN(r.z));
  check('full ties: p = NaN',                   Number.isNaN(r.p_two_sided));
  check('direction = equal',                    r.direction === 'equal');
}
{
  // Partial ties: 2 tied at 3, otherwise distinct
  const r = wilcoxonRankSumP([1, 2, 3], [3, 4, 5]);
  check('partial ties: 1 tie group of size 2',  r.n_tie_groups === 1);
  // tie at value 3 (a[2] and b[0]) at ranks 3,4 avg 3.5
  check('tie_correction_factor > 0',            r.tie_correction_factor > 0);
  check('sigma² > 0',                           r.sigma2 > 0);
  check('z is finite',                          Number.isFinite(r.z));
  check('p_two_sided in [0, 1]',                r.p_two_sided >= 0 && r.p_two_sided <= 1);
}

// =====================================================================
group('wilcoxonRankSumP — direction labels');
{
  const aHigher = wilcoxonRankSumP([10, 20, 30], [1, 2, 3]);
  check('a higher: direction = a_higher',       aHigher.direction === 'a_higher');
  const aLower = wilcoxonRankSumP([1, 2, 3], [10, 20, 30]);
  check('a lower: direction = a_lower',         aLower.direction === 'a_lower');
}

// =====================================================================
group('wilcoxonRankSumP — continuity correction edge case');
{
  // |U - mu| = 0.5 → continuity correction lands on 0 → p_two_sided = 1
  // a = [1, 2], b = [3, 4] → ranks 1,2,3,4 → R_a = 3 → U_a = 3 - 3 = 0; mu = 2; |U-mu| = 2
  // To get |U-mu| = 0.5 exactly, use a = [1, 4], b = [2, 3]:
  //   pooled ranks: a[0]=1 (rank1), b[0]=2 (rank2), b[1]=3 (rank3), a[1]=4 (rank4)
  //   R_a = 1 + 4 = 5; U_a = 5 - 2*3/2 = 5 - 3 = 2; mu = 4/2 = 2 → diff = 0
  // Try a = [1, 4], b = [2, 5]:
  //   ranks: 1,2,3,4; a positions 1,3 → R_a = 1+3 = 4 → U_a = 4-3 = 1; mu = 2 → diff = -1, |diff|=1
  //   1 > 0.5 → proceeds with z = 0.5 / sigma
  // We don't easily hit |diff| <= 0.5 with integer ranks. Skip this exact-half test.
  const r = wilcoxonRankSumP([1, 4], [2, 5]);
  check('|U-mu| > 0.5: z computed',             Number.isFinite(r.z));
}

// =====================================================================
group('wilcoxonRankSumP — manuscript-scale n=60+60');
{
  // Build two distinct distributions: REF dosage near 0, INV near 2
  const ref = [], inv = [];
  for (let i = 0; i < 60; i++) {
    ref.push(((i * 31) % 100) / 1000);                   // 0..0.099
    inv.push(2 - ((i * 17) % 100) / 1000);               // 1.901..2
  }
  const r = wilcoxonRankSumP(ref, inv);
  check('n=60+60: n_a + n_b = 120',             r.n_a + r.n_b === 120);
  check('n=60+60: clear separation → p < 1e-15', r.p_two_sided < 1e-15);
  check('n=60+60: direction = a_lower',         r.direction === 'a_lower');
  check('n=60+60: sigma² > 0',                  r.sigma2 > 0);
}

// =====================================================================
group('wilcoxonRankSumP — symmetric around midpoint');
{
  // Pure symmetry: a and b mirror each other around 5
  const r = wilcoxonRankSumP([1, 3, 5], [5, 7, 9]);
  // a ranks: 1, 2, avg(3,4)=3.5
  // b ranks: avg(3,4)=3.5, 5, 6
  // R_a = 1 + 2 + 3.5 = 6.5; U_a = 6.5 - 6 = 0.5; mu = 9/2 = 4.5
  check('symmetric: U_a < mu',                  r.U_a < r.mu);
  check('symmetric: 1 tie group',               r.n_tie_groups === 1);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
