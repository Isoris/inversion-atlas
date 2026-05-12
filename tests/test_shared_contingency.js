// tests/test_shared_contingency.js
// Verifies behavioural parity between shared/contingency.js and the
// legacy Inversion_atlas.html primitives.
//
// Run:  node tests/test_shared_contingency.js

import {
  buildContingency, detectFuseEvents, detectSplitEvents,
  computeARI, computeNMI,
  cramersV, chiSqSurvival, lnGamma,
  scaleStabilityVerdict,
  // table-based metrics (extracted from legacy 30915–31178, 2026-05-12)
  chiSquare, normalCDF,
  nmiFromTable, amiFromTable, ariFromTable,
  restrictedConcord,
  fisher2x2,
} from '../atlases/inversion/shared/contingency.js';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}${detail ? '  (' + detail + ')' : ''}`); pass++; }
  else      { console.log(`  ✗ ${name}  ${detail}`); fail++; }
}
function approx(a, b, tol = 1e-9) {
  if (!Number.isFinite(a) && !Number.isFinite(b)) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= tol;
}

console.log('--- buildContingency ---');
{
  // Identity partition: KA=KB=3, all i map a=>i, b=>i, n=10
  const A = [0, 0, 1, 1, 2, 2, 0, 1, 2, 0];
  const B = [0, 0, 1, 1, 2, 2, 0, 1, 2, 0];
  const ct = buildContingency(A, B, 3, 3);
  check('null on bad input',                buildContingency(null, [1], 2, 2) === null);
  check('null on length mismatch',          buildContingency([1, 2], [1], 2, 2) === null);
  check('null on KA=0',                     buildContingency([0], [0], 0, 1) === null);
  check('returns shape {M, KA, KB, n}',     ct && ct.M && ct.KA === 3 && ct.KB === 3 && ct.n === 10);
  check('diagonal counts',                  ct.M[0][0] === 4 && ct.M[1][1] === 3 && ct.M[2][2] === 3);
  check('off-diagonal zero',                ct.M[0][1] === 0 && ct.M[1][2] === 0);
}
{
  // Out-of-range labels are skipped, n decreases
  const A = [0, 1, 2, -1, 5];   // -1 and 5 are out-of-range for KA=3
  const B = [0, 1, 2, 0, 1];
  const ct = buildContingency(A, B, 3, 3);
  check('out-of-range skipped, n=3', ct.n === 3);
  check('M[0][0]=1, M[1][1]=1, M[2][2]=1', ct.M[0][0] === 1 && ct.M[1][1] === 1 && ct.M[2][2] === 1);
}

console.log('\n--- detectFuseEvents ---');
{
  // Synthetic: fine clusters {0,1} both map ≥80% into coarse cluster 0
  // Fine cluster 2 maps 100% into coarse cluster 1 (alone — not a fuse)
  // M shape: 3 rows (fine) × 2 cols (coarse)
  const ct = {
    M: [
      [10, 0],   // fine 0 → 100% coarse 0
      [9, 1],    // fine 1 → 90% coarse 0
      [0, 8],    // fine 2 → 100% coarse 1
    ],
    KA: 3, KB: 2, n: 28,
  };
  const fuses = detectFuseEvents(ct, { thresh: 0.80 });
  check('one fuse event detected',          fuses.length === 1);
  check('fuse coarse cluster = 0',          fuses[0].coarse_cluster === 0);
  check('fuse fine clusters = [0, 1]',
        fuses[0].fine_clusters.length === 2
        && fuses[0].fine_clusters.includes(0)
        && fuses[0].fine_clusters.includes(1));
  // Higher threshold filters fine 1 (only 90%)
  const fuses2 = detectFuseEvents(ct, { thresh: 0.95 });
  check('higher thresh excludes fine 1',    fuses2.length === 0);
  check('default thresh is 0.80',           detectFuseEvents(ct).length === 1);
  check('null input → []',                  detectFuseEvents(null).length === 0);
}

console.log('\n--- detectSplitEvents ---');
{
  // Symmetric to the fuse test, but TRANSPOSED. Fine cluster 0
  // distributes its samples across BOTH coarse clusters at ≥20%:
  //   [6, 4] → 60% to coarse 0, 40% to coarse 1 (split)
  //   [9, 1] → 90% to coarse 0, 10% to coarse 1 (NOT split at thresh=0.20)
  //   [0, 8] → 100% to coarse 1 (NOT split)
  const ct = {
    M: [
      [6, 4],
      [9, 1],
      [0, 8],
    ],
    KA: 3, KB: 2, n: 28,
  };
  const splits = detectSplitEvents(ct, { thresh: 0.20 });
  check('one split event detected',         splits.length === 1);
  check('split fine cluster = 0',           splits[0].fine_cluster === 0);
  check('split coarse clusters = [0, 1]',
        splits[0].coarse_clusters.length === 2
        && splits[0].coarse_clusters.includes(0)
        && splits[0].coarse_clusters.includes(1));
  // Lower threshold catches fine 1 too (10% slice qualifies)
  const splits2 = detectSplitEvents(ct, { thresh: 0.05 });
  check('lower thresh catches more',        splits2.length === 2);
  // Higher threshold filters fine 0 (60/40 doesn't clear 50%)
  // Actually 60% is still >= 50%, so both clusters qualify. Use 0.70.
  const splits3 = detectSplitEvents(ct, { thresh: 0.70 });
  check('thresh > major split share excludes',  splits3.length === 0);
  check('default thresh is 0.20',           detectSplitEvents(ct).length === 1);
  check('null input → []',                  detectSplitEvents(null).length === 0);
  // Empty row (rowS = 0) is skipped, not crashed
  const ctEmpty = { M: [[0, 0], [5, 5]], KA: 2, KB: 2, n: 10 };
  const splitsE = detectSplitEvents(ctEmpty);
  check('empty row skipped',                splitsE.length === 1 && splitsE[0].fine_cluster === 1);
}

console.log('\n--- computeARI ---');
{
  // Identical partitions → ARI = 1
  check('identical partitions → 1',
        approx(computeARI([0,0,1,1,2,2], [0,0,1,1,2,2]), 1));
  // Renamed labels (still identical clustering) → ARI = 1
  check('renamed labels → 1',
        approx(computeARI([0,0,1,1,2,2], [2,2,0,0,1,1]), 1));
  // Independent → ARI ≈ 0
  // n=8, A: 4×0, 4×1; B: alternating 0/1 (independent of A) → ARI should be near 0
  check('NaN on length mismatch',           Number.isNaN(computeARI([0,1], [0])));
  check('NaN on n<2',                       Number.isNaN(computeARI([0], [0])));
  // Manual: A=[0,0,0,1,1,1], B=[0,1,2,0,1,2]: every cell has count 1
  // → sumCellPairs=0, sumRowPairs=2*C2(3)=6, sumColPairs=3*C2(2)=3
  // → totalPairs=C2(6)=15, expected=18/15=1.2, max=4.5
  // → ARI = (0 - 1.2) / (4.5 - 1.2) ≈ -0.3636
  const ari_split = computeARI([0,0,0,1,1,1], [0,1,2,0,1,2]);
  check('split case ≈ -0.3636',             approx(ari_split, -1.2 / 3.3, 1e-6));
}

console.log('\n--- computeNMI ---');
{
  check('identical → 1',                    approx(computeNMI([0,0,1,1,2,2], [0,0,1,1,2,2]), 1));
  check('renamed → 1',                      approx(computeNMI([0,0,1,1,2,2], [2,2,0,0,1,1]), 1));
  check('NaN on bad input',                 Number.isNaN(computeNMI([0,1], [0])));
  // Worst-case independent (A all 0s, B all distinct) → NMI = 0
  // A = [0,0,0,0], B = [0,0,0,0]: HA=HB=0 → returns 1 (both single cluster)
  check('both single-cluster → 1',          computeNMI([0,0,0], [0,0,0]) === 1);
}

console.log('\n--- cramersV ---');
{
  // Independence: row*col = expected exactly → V = 0
  // 2x2 with M = [[10,10],[10,10]]: chi2 = 0 → V = 0
  const flatTable = [10, 10, 10, 10];
  check('independence → V = 0',             approx(cramersV(flatTable, 2, 2), 0));
  // Perfect 1-1 mapping: M = [[5,0],[0,5]]: chi2 = 10 (compute)
  // Actually for 2×2 perfect: V should be 1
  const perfect = [5, 0, 0, 5];
  check('perfect 2x2 → V = 1',              approx(cramersV(perfect, 2, 2), 1));
  // n=0 → NaN
  check('n=0 → NaN',                        Number.isNaN(cramersV([0,0,0,0], 2, 2)));
  // Single non-empty row → V = 0 (degenerate)
  check('single non-empty row → 0',         cramersV([5, 5, 0, 0], 2, 2) === 0);
}

console.log('\n--- lnGamma & chiSqSurvival ---');
{
  // lnGamma well-known values
  check('lnGamma(1) = 0',                   approx(lnGamma(1), 0, 1e-9));
  check('lnGamma(2) = 0',                   approx(lnGamma(2), 0, 1e-9));
  check('lnGamma(3) = ln(2)',               approx(lnGamma(3), Math.log(2), 1e-9));
  check('lnGamma(4) = ln(6)',               approx(lnGamma(4), Math.log(6), 1e-9));
  check('lnGamma(5) = ln(24)',              approx(lnGamma(5), Math.log(24), 1e-9));
  // chi-sq survival: for chi2=0 → 1; for very large chi2 → 0
  check('Q(chi2=0, df=1) = 1',              chiSqSurvival(0, 1) === 1);
  check('Q(chi2=1000, df=1) ≈ 0',           chiSqSurvival(1000, 1) < 1e-100);
  // For chi2=df, Q is around 0.3-0.5 (df=1: ~0.317; df=2: ~0.368; df=4: ~0.406)
  check('Q(chi2=1, df=1) ≈ 0.317',          approx(chiSqSurvival(1, 1), 0.31731, 1e-3));
  check('Q(chi2=2, df=2) ≈ 0.368',          approx(chiSqSurvival(2, 2), 0.36788, 1e-3));
  check('Q(chi2<0) → 1',                    chiSqSurvival(-1, 2) === 1);
  check('Q(df=0) → NaN',                    Number.isNaN(chiSqSurvival(1, 0)));
}

console.log('\n--- scaleStabilityVerdict ---');
{
  // STABLE_3BAND: all panes K=3, ARI≥0.85, no fuses/splits
  const stable3 = scaleStabilityVerdict(
    [{K:3, ok:true}, {K:3, ok:true}, {K:3, ok:true}],
    [{ari:0.95, fuseEvents:[], splitEvents:[]}, {ari:0.92, fuseEvents:[], splitEvents:[]}],
  );
  check('STABLE_3BAND',                     stable3 === 'STABLE_3BAND');
  // STABLE_6BAND
  const stable6 = scaleStabilityVerdict(
    [{K:6, ok:true}, {K:6, ok:true}, {K:6, ok:true}],
    [{ari:0.92, fuseEvents:[], splitEvents:[]}, {ari:0.90, fuseEvents:[], splitEvents:[]}],
  );
  check('STABLE_6BAND',                     stable6 === 'STABLE_6BAND');
  // NESTED_3IN6: legacy convention is Ks[0]=6 (fine) AND Ks[2]=3 (coarse),
  // with the 6→3 collapse landing on the gap that crosses the K-change.
  // K=[6,6,3] → collapse at 2↔3 with 3 fuses + 0 splits.
  const nested = scaleStabilityVerdict(
    [{K:6, ok:true}, {K:6, ok:true}, {K:3, ok:true}],
    [
      {ari:0.9, fuseEvents:[],         splitEvents:[]},
      {ari:0.4, fuseEvents:[{},{},{}], splitEvents:[]},
    ],
  );
  check('NESTED_3IN6',                      nested === 'NESTED_3IN6');
  // OVERLAP_BREAKS_3: K=[3,6,3] but with fuses+splits at middle
  const overlap = scaleStabilityVerdict(
    [{K:3, ok:true}, {K:6, ok:true}, {K:3, ok:true}],
    [
      {ari:0.75, fuseEvents:[{}], splitEvents:[{}]},
      {ari:0.75, fuseEvents:[{}], splitEvents:[{}]},
    ],
  );
  check('OVERLAP_BREAKS_3',                 overlap === 'OVERLAP_BREAKS_3');
  // UNSTABLE: low ARI
  const unstable = scaleStabilityVerdict(
    [{K:3, ok:true}, {K:3, ok:true}, {K:3, ok:true}],
    [{ari:0.3, fuseEvents:[], splitEvents:[]}, {ari:0.4, fuseEvents:[], splitEvents:[]}],
  );
  check('UNSTABLE on low ARI',              unstable === 'UNSTABLE');
  // UNSTABLE on bad input
  check('UNSTABLE on null panes',           scaleStabilityVerdict(null, []) === 'UNSTABLE');
  check('UNSTABLE on wrong arity',          scaleStabilityVerdict(
        [{K:3, ok:true}, {K:3, ok:true}], []) === 'UNSTABLE');
}

// =====================================================================
// Table-based metrics (chiSquare / normalCDF / nmiFromTable /
// amiFromTable / ariFromTable / restrictedConcord / fisher2x2)
// Extracted from legacy 30915–31178 on 2026-05-12.
// =====================================================================
console.log('\n--- normalCDF ---');
check('normalCDF(0) ≈ 0.5',          approx(normalCDF(0), 0.5, 1e-3));
check('normalCDF(1.96) ≈ 0.975',     approx(normalCDF(1.96), 0.975, 5e-3));
check('normalCDF(-1.96) ≈ 0.025',    approx(normalCDF(-1.96), 0.025, 5e-3));
check('normalCDF(5) ≈ 1',            normalCDF(5) > 0.9999);
check('normalCDF(-5) ≈ 0',           normalCDF(-5) < 0.0001);

console.log('\n--- chiSquare ---');
// Perfectly independent 2×2 table — all rows and cols equal — chi² = 0
{
  const T = [[10, 10], [10, 10]];
  const cs = chiSquare(T, 2);
  check('independent table: chi2 = 0',     approx(cs.chi2, 0));
  check('independent table: df = 1',       cs.df === 1);
  check('independent table: n = 40',       cs.n === 40);
  // Wilson–Hilferty is approximate at the boundary chi²=0; the legacy
  // implementation returns ~0.95 here (the analytic answer is 1.0). Keep
  // the looser bound to match legacy behaviour.
  check('independent table: p_approx > 0.9', cs.p_approx > 0.9);
}
// Perfectly associated 2×2 diagonal — high chi²
{
  const T = [[20, 0], [0, 20]];
  const cs = chiSquare(T, 2);
  check('diagonal table: chi2 > 0',        cs.chi2 > 30);
  check('diagonal table: p_approx tiny',   cs.p_approx < 0.01);
}
// 3×3 known case: pure diagonal n=30
{
  const T = [[10,0,0],[0,10,0],[0,0,10]];
  const cs = chiSquare(T, 3);
  check('3×3 diagonal: chi2 ≈ 60',         approx(cs.chi2, 60, 1e-6));
  check('3×3 diagonal: df = 4',            cs.df === 4);
}

console.log('\n--- nmiFromTable ---');
// Perfect agreement (diagonal) → NMI = 1
{
  const T = [[10,0,0],[0,10,0],[0,0,10]];
  check('perfect diagonal: NMI = 1',       approx(nmiFromTable(T, 3), 1, 1e-9));
}
// Independent uniform → NMI ≈ 0
{
  const T = [[10,10,10],[10,10,10],[10,10,10]];
  check('uniform table: NMI ≈ 0',          approx(nmiFromTable(T, 3), 0, 1e-9));
}
check('empty table: NMI = 0',              nmiFromTable([[0,0],[0,0]], 2) === 0);

console.log('\n--- amiFromTable ---');
// Perfect agreement — AMI close to 1 (slightly less due to chance correction)
{
  const T = [[10,0,0],[0,10,0],[0,0,10]];
  const ami = amiFromTable(T, 3);
  check('perfect diagonal: AMI ≈ 1',       ami > 0.95);
}
// Uniform table — AMI is small but non-zero. AMI corrects MI for chance:
// MI=0 on a strictly uniform table, but E[MI] under the hypergeometric null
// is positive, so the adjusted value is slightly negative. The legacy
// implementation produces ~-0.15 for a 3×3 uniform-30 table.
{
  const T = [[10,10,10],[10,10,10],[10,10,10]];
  const ami = amiFromTable(T, 3);
  check('uniform table: AMI in [-0.3, 0.05]',
                                            ami >= -0.3 && ami <= 0.05);
}

console.log('\n--- ariFromTable ---');
// Perfect diagonal → ARI = 1
{
  const T = [[10,0,0],[0,10,0],[0,0,10]];
  check('perfect diagonal: ARI = 1',       approx(ariFromTable(T, 3), 1, 1e-9));
}
// Uniform → ARI ≈ 0 (small negative bias under finite-N hypergeometric
// adjustment is expected; ~-0.023 on a 3×3 uniform-90 table).
{
  const T = [[10,10,10],[10,10,10],[10,10,10]];
  check('uniform table: |ARI| < 0.1',      Math.abs(ariFromTable(T, 3)) < 0.1);
}
// Edge case: n ≤ 1 → 0
check('ARI on n=1 table = 0',              ariFromTable([[1,0],[0,0]], 2) === 0);
check('ARI on empty table = 0',            ariFromTable([[0,0],[0,0]], 2) === 0);

console.log('\n--- table-based ARI vs label-array ARI ---');
// Sanity: build a contingency from two label arrays, then compare ariFromTable
// to computeARI. The two metrics share the Hubert-Arabie definition so they
// should agree to numerical tolerance.
{
  const labelsA = [0,0,0,1,1,1,2,2,2];
  const labelsB = [0,0,0,1,1,1,2,2,2];
  const ct = buildContingency(labelsA, labelsB, 3, 3);
  const ariTable = ariFromTable(ct.M, 3);
  const ariLabel = computeARI(labelsA, labelsB);
  check('perfect: table ARI = label ARI',  approx(ariTable, ariLabel, 1e-9));
}
{
  const labelsA = [0,0,0,1,1,1,2,2,2];
  const labelsB = [0,0,1,1,1,2,2,2,0];   // shifted
  const ct = buildContingency(labelsA, labelsB, 3, 3);
  const ariTable = ariFromTable(ct.M, 3);
  const ariLabel = computeARI(labelsA, labelsB);
  check('shifted: table ARI = label ARI',  approx(ariTable, ariLabel, 1e-9));
}

console.log('\n--- restrictedConcord ---');
// Diagonal table, keep all rows → concord = 1, verdict = MERGE
{
  const cmp = { table: [[10,0,0],[0,10,0],[0,0,10]] };
  const rc = restrictedConcord(cmp, [0,1,2]);
  check('diag, keep all: concord = 1',     approx(rc.concord, 1, 1e-9));
  check('diag, keep all: verdict MERGE',   rc.verdict === 'MERGE');
  check('diag, keep all: n = 30',          rc.n === 30);
  check('diag, keep all: kept_set = [0,1,2]',
                                            rc.kept_set.length === 3
                                            && rc.kept_set.includes(0) && rc.kept_set.includes(2));
}
// Off-diagonal, keep one row → low concord, SEPARATE
{
  const cmp = { table: [[2, 8, 0], [0, 10, 0], [0, 0, 10]] };
  const rc = restrictedConcord(cmp, [0]);
  check('off-diag row 0: concord = 0.2',   approx(rc.concord, 0.2));
  check('off-diag row 0: verdict SEPARATE',rc.verdict === 'SEPARATE');
}
// Custom mergeThr — diagonal with threshold above concord → SEPARATE
{
  const cmp = { table: [[7, 3], [0, 10]] };
  // row 0 only: concord = 7/10 = 0.7. mergeThr 0.8 → SEPARATE.
  const rc = restrictedConcord(cmp, [0], 0.8);
  check('threshold 0.8 → SEPARATE',        rc.verdict === 'SEPARATE');
  // mergeThr 0.65 → MERGE
  const rc2 = restrictedConcord(cmp, [0], 0.65);
  check('threshold 0.65 → MERGE',          rc2.verdict === 'MERGE');
}
// All-zero kept rows → LOW_POWER verdict
{
  const cmp = { table: [[0,0,0],[0,10,0],[0,0,10]] };
  const rc = restrictedConcord(cmp, [0]);
  check('all-zero kept: verdict LOW_POWER',rc.verdict === 'LOW_POWER');
  check('all-zero kept: n = 0',            rc.n === 0);
}
// Bad inputs return null
check('null cmp → null',                   restrictedConcord(null, [0]) === null);
check('no keep → null',                    restrictedConcord({ table: [[1]] }, []) === null);
check('out-of-range keep → null',          restrictedConcord({ table: [[1,0],[0,1]] }, [5,10]) === null);

console.log('\n--- fisher2x2 ---');
// Independent 2×2 (every cell ≈ row*col/n) → p close to 1
{
  const p = fisher2x2([[10, 10], [10, 10]]);
  check('independent 2×2: p close to 1',   p > 0.5);
}
// Pure diagonal — strong association, p tiny
{
  const p = fisher2x2([[20, 0], [0, 20]]);
  check('diagonal 2×2: p < 0.001',         p < 0.001);
}
// p ∈ [0, 1]
check('fisher2x2: p ≤ 1',                  fisher2x2([[5, 5], [5, 5]]) <= 1);

console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
