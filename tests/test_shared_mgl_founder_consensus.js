// tests/test_shared_mgl_founder_consensus.js
//
// Coverage for shared/mgl_founder_consensus — per-site founder-like /
// MRCA-like consensus with confidence tiers and reason codes.

import {
  siteFrequency,
  classifySite,
  computeFounderConsensus,
  consensusToDosageRow,
  MGL_FOUNDER_TIERS,
  MGL_FOUNDER_REASONS,
  MGL_FOUNDER_DEFAULTS,
} from '../atlases/evolution/shared/mgl_founder_consensus.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('exports');
check('MGL_FOUNDER_TIERS frozen',                 Object.isFrozen(MGL_FOUNDER_TIERS));
check('5 tiers',                                  MGL_FOUNDER_TIERS.length === 5);
check('MGL_FOUNDER_REASONS frozen',               Object.isFrozen(MGL_FOUNDER_REASONS));
check('siteFrequency fn',                         typeof siteFrequency === 'function');
check('classifySite fn',                          typeof classifySite === 'function');
check('computeFounderConsensus fn',               typeof computeFounderConsensus === 'function');
check('consensusToDosageRow fn',                  typeof consensusToDosageRow === 'function');

// =====================================================================
group('siteFrequency');
// 4 samples, dosage row = [2, 1, 0, -1]   → 3 called, 1 missing.
// sum = 2+1+0 = 3; freq = 3/(2*3) = 0.5
const row = [2, 1, 0, -1];
const f1 = siteFrequency(row, [0, 1, 2, 3]);
check('freq = 0.5',                               Math.abs(f1.freq - 0.5) < 1e-9);
check('n_called = 3',                             f1.n_called === 3);
check('n_missing = 1',                            f1.n_missing === 1);

// All missing → freq NaN.
const f2 = siteFrequency([-1, -1], [0, 1]);
check('all missing → NaN',                        Number.isNaN(f2.freq));
check('all missing → n_called = 0',               f2.n_called === 0);

// Empty class → NaN.
check('null inputs → NaN',                        Number.isNaN(siteFrequency(null, []).freq));
check('empty class → NaN',                        Number.isNaN(siteFrequency(row, []).freq));

// =====================================================================
group('classifySite — tiers');
// 0.98 → high / fixed_derived
let c = classifySite(0.98, 0);
check('0.98 → high, derived',                     c.tier === 'high' && c.call === 1);
check('reason = fixed_derived',                   c.reason === MGL_FOUNDER_REASONS.FIXED_DERIVED);

// 0.02 → high / fixed_reference
c = classifySite(0.02, 0);
check('0.02 → high, reference',                   c.tier === 'high' && c.call === 0);
check('reason = fixed_reference',                 c.reason === MGL_FOUNDER_REASONS.FIXED_REFERENCE);

// 0.85 → medium / high_freq / derived
c = classifySite(0.85, 0);
check('0.85 → medium, derived',                   c.tier === 'medium' && c.call === 1);

// 0.15 → medium / reference
c = classifySite(0.15, 0);
check('0.15 → medium, reference',                 c.tier === 'medium' && c.call === 0);

// 0.65 → low / derived
c = classifySite(0.65, 0);
check('0.65 → low, derived',                      c.tier === 'low' && c.call === 1);

// 0.50 → ambiguous
c = classifySite(0.50, 0);
check('0.50 → ambiguous',                         c.tier === 'ambiguous' && c.call === null);

// High missingness → suspicious
c = classifySite(0.95, 0.6);
check('high missingness → suspicious',            c.tier === 'suspicious');
check('high missingness reason',                  c.reason === MGL_FOUNDER_REASONS.HIGH_MISSINGNESS);

// NaN freq → suspicious / high missingness
c = classifySite(NaN, 0);
check('NaN freq → suspicious',                    c.tier === 'suspicious');

// =====================================================================
group('classifySite — possible_mosaic');
// INV freq high AND close to STD freq → flagged as possible mosaic.
const cm = classifySite(0.85, 0, { freq_std: 0.83 });
check('mosaic detected when INV ≈ STD and far from mid',
      cm.reason === MGL_FOUNDER_REASONS.POSSIBLE_MOSAIC);
check('mosaic still gets a tier',                 cm.tier === 'suspicious');
// Distance from STD is bigger than the cap → still goes through normal.
const cn = classifySite(0.85, 0, { freq_std: 0.10 });
check('STD dissimilar → normal tier',             cn.tier === 'medium');
check('STD dissimilar → reason high_freq',        cn.reason === MGL_FOUNDER_REASONS.HIGH_FREQ);

// =====================================================================
group('computeFounderConsensus — fixture');
// 6 samples; 4 markers
//   marker 0: dosage [2,2,2,2,0,0] — fixed-derived inside INV (idx 0..3)
//   marker 1: dosage [0,0,0,1,0,0] — mostly reference inside INV, one HET
//   marker 2: dosage [1,1,2,2,0,0] — mixed inside INV
//   marker 3: dosage [-1,-1,-1,-1,2,2] — all-NA inside INV
const dosage = [
  Float64Array.from([2, 2, 2, 2, 0, 0]),
  Float64Array.from([0, 0, 0, 1, 0, 0]),
  Float64Array.from([1, 1, 2, 2, 0, 0]),
  Float64Array.from([-1,-1,-1,-1,2, 2]),
];
const r = computeFounderConsensus({
  dosage, n_markers: 4, n_samples: 6,
  inv_idx: [0, 1, 2, 3],
  std_idx: [4, 5],
});
check('4 sites returned',                         r.sites.length === 4);
check('site 0: high / call=1',
      r.sites[0].present_consensus.tier === 'high'
   && r.sites[0].present_consensus.call === 1);
check('site 1: low or medium / call=0',
      (r.sites[1].present_consensus.tier === 'medium'
        || r.sites[1].present_consensus.tier === 'low')
   && r.sites[1].present_consensus.call === 0);
check('site 2: medium-ish, call=1 (freq=0.75)',
      r.sites[2].present_consensus.call === 1);
check('site 3: suspicious / high missingness',
      r.sites[3].present_consensus.tier === 'suspicious'
   && r.sites[3].present_consensus.reason === MGL_FOUNDER_REASONS.HIGH_MISSINGNESS);
check('STD freq propagated to site 0',            r.sites[0].freq_std === 0);
check('tier counts: n_high ≥ 1',                  r.n_high >= 1);
check('tier counts: n_suspicious ≥ 1',            r.n_suspicious >= 1);

// Empty / null safety.
check('null args → 0 sites',                      computeFounderConsensus(null).sites.length === 0);
check('empty inv_idx → 0 sites',
      computeFounderConsensus({ dosage, n_markers: 4, n_samples: 6, inv_idx: [] }).sites.length === 0);

// Flat Float64Array input (row-major) also works.
const flat = new Float64Array(4 * 6);
for (let mi = 0; mi < 4; mi++) {
  for (let si = 0; si < 6; si++) flat[mi * 6 + si] = dosage[mi][si];
}
const rFlat = computeFounderConsensus({
  dosage: flat, n_markers: 4, n_samples: 6,
  inv_idx: [0, 1, 2, 3], std_idx: [4, 5],
});
check('flat Float64Array input works',
      rFlat.sites.length === 4
   && rFlat.sites[0].present_consensus.tier === 'high');

// =====================================================================
group('consensusToDosageRow');
const { dosage_row, mask_row } = consensusToDosageRow(r);
check('dosage_row length = 4',                    dosage_row.length === 4);
check('site 0 → dosage = 2 (derived call)',       dosage_row[0] === 2);
check('site 1 → dosage = 0 (reference call)',     dosage_row[1] === 0);
check('site 3 → dosage NaN (suspicious / null call)',
      Number.isNaN(dosage_row[3]));
check('mask_row site 0 = 4 (high)',               mask_row[0] === 4);
check('mask_row site 3 = 0 (suspicious)',         mask_row[3] === 0);
check('null consensus → empty arrays',
      consensusToDosageRow(null).dosage_row.length === 0);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
