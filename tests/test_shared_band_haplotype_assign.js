// tests/test_shared_band_haplotype_assign.js
//
// Unit coverage for shared/band_haplotype_assign.js — the H-system
// band-to-haplotype labeller (legacy _dbdAssignHaplotypes).

import {
  medianPC1PerBand,
  assignBandHaplotypes,
} from '../atlases/inversion/shared/band_haplotype_assign.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('medianPC1PerBand');

// 6 samples, K=3 bands; labels = [0,0,1,1,2,2]; pc1 ascending order.
const pc1A = [-2, -1, 0, 0.5, 2, 3];
const labelsA = [0, 0, 1, 1, 2, 2];
const pbA = [
  { band: 0, n: 2 }, { band: 1, n: 2 }, { band: 2, n: 2 },
];
const medA = medianPC1PerBand(pbA, pc1A, labelsA, 6);
check('band 0 median = -1',         medA[0] === -1);
check('band 1 median = 0.5',        medA[1] === 0.5);
check('band 2 median = 3',          medA[2] === 3);

// Empty band → null
const pbEmpty = [{ band: 0, n: 0 }, { band: 1, n: 6 }];
const medEmpty = medianPC1PerBand(pbEmpty, pc1A, [1,1,1,1,1,1], 6);
check('empty band → null',          medEmpty[0] === null);

// Non-array per_band → []
check('non-array per_band → []',
      Array.isArray(medianPC1PerBand(null, pc1A, labelsA, 6))
      && medianPC1PerBand(null, pc1A, labelsA, 6).length === 0);

// NaN pc1 values skipped
const pcNaN = [-2, NaN, 0, 0.5, 2, NaN];
const medNaN = medianPC1PerBand(pbA, pcNaN, labelsA, 6);
check('NaN values skipped',
      medNaN[0] === -2 && medNaN[1] === 0.5);
// (band 0 only valid val: -2; band 1: 0 and 0.5 → median 0.5;
//  wait actually [0, 0.5] sorted is [0, 0.5], median index 1 → 0.5;
//  so band 0 has only one valid pc1 (-2), band 1 has [0, 0.5], median 0.5)
// Actually with vals [0, 0.5], length=2, floor(2/2)=1, so median = 0.5. Hmm.
// Let me recheck: pcNaN = [-2, NaN, 0, 0.5, 2, NaN]
//   band 0: si=0 (-2), si=1 (NaN skip) → [-2], median = -2
//   band 1: si=2 (0), si=3 (0.5) → [0, 0.5], median = vals[floor(2/2)]=vals[1]=0.5
//   band 2: si=4 (2), si=5 (NaN skip) → [2], median = 2

// So the test should be: band 0 = -2, band 1 = 0.5, band 2 = 2

// =====================================================================
group('assignBandHaplotypes — happy path (3 bands, all interpreted)');

// hom-like bands at low/high PC1, het-like in middle.
const per_band = [
  { band: 0, n: 4, interpretation: 'hom-like' },  // low PC1
  { band: 1, n: 4, interpretation: 'het-like' },  // mid PC1
  { band: 2, n: 4, interpretation: 'hom-like' },  // high PC1
];
const pc1 = [-3, -2, -1, 0, 1, 0.5, 2, 3, 4, -2.5, 1, 0];
const labels = [0, 0, 1, 1, 1, 1, 2, 2, 2, 0, 2, 0];
// band 0: si 0,1,9,11 → pc1: -3, -2, -2.5, 0 → sorted [-3,-2.5,-2,0], median[2]=-2
// band 1: si 2,3,4,5 → pc1: -1, 0, 1, 0.5 → sorted [-1,0,0.5,1], median[2]=0.5
// band 2: si 6,7,8,10 → pc1: 2, 3, 4, 1 → sorted [1,2,3,4], median[2]=3

const out1 = assignBandHaplotypes(per_band,
  { pc1, labels, nS: 12, K: 3 });

check('3 rows returned',            out1.length === 3);
check('band 0 hom → H1/H1 (lowest PC1)',
      out1[0].haplotype_class === 'H1/H1');
check('band 2 hom → H2/H2 (highest PC1)',
      out1[2].haplotype_class === 'H2/H2');
check('band 1 het → H1/H2',
      out1[1].haplotype_class === 'H1/H2');
check('label_detailed = haplotype_class for hom-like',
      out1[0].label_detailed === 'H1/H1');
check('label_legacy uses fallback "band N"',
      out1[0].label_legacy === 'band 1');
check('interpretation propagated',
      out1[1].interpretation === 'het-like');
check('sub_band always null (turn 91 placeholder)',
      out1.every(r => r.sub_band === null));

// =====================================================================
group('assignBandHaplotypes — H1/H2/H3 with 3 hom-like bands');

const per_band3 = [
  { band: 0, n: 4, interpretation: 'hom-like' },  // mid PC1
  { band: 1, n: 4, interpretation: 'hom-like' },  // low PC1
  { band: 2, n: 4, interpretation: 'hom-like' },  // high PC1
];
const pc1_3 = [-3, -2, 0.5, 1, 3, 4, 0, 0.4, -2.5, -1, 2.5, 3.5];
const labels_3 = [1, 1, 0, 0, 2, 2, 0, 0, 1, 1, 2, 2];
// band 0: si 2,3,6,7 → 0.5, 1, 0, 0.4 → sorted [0, 0.4, 0.5, 1], median[2]=0.5
// band 1: si 0,1,8,9 → -3, -2, -2.5, -1 → sorted [-3, -2.5, -2, -1], median[2]=-2
// band 2: si 4,5,10,11 → 3, 4, 2.5, 3.5 → sorted [2.5, 3, 3.5, 4], median[2]=3.5

const out2 = assignBandHaplotypes(per_band3, { pc1: pc1_3, labels: labels_3, nS: 12 });
// Sorted by median PC1 ascending: band 1 (-2) < band 0 (0.5) < band 2 (3.5)
// → band 1 = H1, band 0 = H2, band 2 = H3
check('band 1 (lowest PC1) → H1/H1',
      out2[1].haplotype_class === 'H1/H1');
check('band 0 (middle PC1) → H2/H2',
      out2[0].haplotype_class === 'H2/H2');
check('band 2 (highest PC1) → H3/H3',
      out2[2].haplotype_class === 'H3/H3');

// =====================================================================
group('assignBandHaplotypes — het-like picks closest pair');

const per_bandHet = [
  { band: 0, n: 4, interpretation: 'hom-like' },  // PC1 ~ 0
  { band: 1, n: 4, interpretation: 'het-like' },  // PC1 ~ 5 (close to band 2)
  { band: 2, n: 4, interpretation: 'hom-like' },  // PC1 ~ 10
  { band: 3, n: 4, interpretation: 'hom-like' },  // PC1 ~ 20
];
// Spread PC1 so band-1 median is close to band-2 (10), far from band-3 (20)
const pc1H = [0, 0, 0, 0,    5, 5, 5, 5,    10, 10, 10, 10,   20, 20, 20, 20];
const labelsH = [0,0,0,0, 1,1,1,1, 2,2,2,2, 3,3,3,3];

const outH = assignBandHaplotypes(per_bandHet, { pc1: pc1H, labels: labelsH, nS: 16 });
// Hom-like order by median PC1: band 0 (0) < band 2 (10) < band 3 (20)
// → band 0 = H1, band 2 = H2, band 3 = H3
// Het-like band 1 median 5 → distance to: band 0 (5), band 2 (5), band 3 (15)
// First two by distance: band 0 (H1), band 2 (H2) → H1/H2

check('het-like picks closest 2 hom-like',
      outH[1].haplotype_class === 'H1/H2');
check('band 3 (highest hom) → H3/H3',
      outH[3].haplotype_class === 'H3/H3');

// =====================================================================
group('assignBandHaplotypes — fallback / no-PC1');

// No pc1 → no haplotype class, just legacy labels
const outNoPc1 = assignBandHaplotypes(per_band, { labels: [], nS: 0, K: 3 });
check('no pc1: rows still returned',  outNoPc1.length === 3);
check('no pc1: haplotype_class = null',
      outNoPc1.every(r => r.haplotype_class === null));
check('no pc1: label_detailed = label_legacy',
      outNoPc1.every(r => r.label_detailed === r.label_legacy));

// per_band non-array → []
check('non-array → []',
      assignBandHaplotypes(null, {}).length === 0);

// 'other' interpretation: no haplotype class
const per_bandOther = [
  { band: 0, n: 4, interpretation: 'mixed' },
  { band: 1, n: 4, interpretation: 'hom-like' },
];
const outOther = assignBandHaplotypes(per_bandOther, {
  pc1: [1, 1, 1, 1, 2, 2, 2, 2],
  labels: [0, 0, 0, 0, 1, 1, 1, 1], nS: 8 });
check('mixed interpretation: no haplotype_class',
      outOther[0].haplotype_class === null);
check('single hom-like → H1/H1',
      outOther[1].haplotype_class === 'H1/H1');

// =====================================================================
group('assignBandHaplotypes — opts.legacyLabel injection');

const customLbl = (idx, K) => 'CUSTOM_' + idx + '_of_' + K;
const outCustom = assignBandHaplotypes(per_band, {
  pc1, labels, nS: 12, K: 3, legacyLabel: customLbl,
});
check('custom legacyLabel fn used',
      outCustom[0].label_legacy === 'CUSTOM_0_of_3'
      && outCustom[2].label_legacy === 'CUSTOM_2_of_3');
// detailed still preferred when haplotype assigned
check('detailed label still wins for hom-like',
      outCustom[0].label_detailed === 'H1/H1');

// =====================================================================
group('assignBandHaplotypes — opts.getPC1Snapshot');

let snapshotCalled = 0;
const snapshotFn = (nS) => {
  snapshotCalled++;
  return pc1;   // re-use fixture
};
const outSnap = assignBandHaplotypes(per_band, {
  labels, nS: 12, K: 3, getPC1Snapshot: snapshotFn,
});
check('getPC1Snapshot invoked when no pc1',  snapshotCalled === 1);
check('snapshot-supplied pc1 produces same result',
      outSnap[0].haplotype_class === 'H1/H1');

// Throwing snapshot → graceful fallback
const throwSnap = () => { throw new Error('boom'); };
let safeFromThrow = true;
try {
  const outThrow = assignBandHaplotypes(per_band, {
    labels, nS: 12, getPC1Snapshot: throwSnap });
  // Without pc1 the bands still get legacy labels
  if (outThrow[0].haplotype_class !== null) safeFromThrow = false;
} catch (_) { safeFromThrow = false; }
check('throwing snapshot: no exception, no haplotype',
      safeFromThrow);

// =====================================================================
group('assignBandHaplotypes — only 1 hom-like band');

// With only 1 hom-like band, het-like can't pick 2 → falls back
const per_band1 = [
  { band: 0, n: 4, interpretation: 'hom-like' },
  { band: 1, n: 4, interpretation: 'het-like' },
];
const out1Hom = assignBandHaplotypes(per_band1, {
  pc1: [0,0,0,0, 5,5,5,5],
  labels: [0,0,0,0, 1,1,1,1], nS: 8 });
check('hom → H1/H1',                  out1Hom[0].haplotype_class === 'H1/H1');
check('het with only 1 hom: no class',
      out1Hom[1].haplotype_class === null);
check('het with only 1 hom: detailed falls back to legacy',
      out1Hom[1].label_detailed === out1Hom[1].label_legacy);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
