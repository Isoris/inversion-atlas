// tests/test_discovery_dosage_registry_overlay.js
//
// Unit coverage for pages/discovery/dosage_heatmap/regime_registry_overlay.js
// — mapping atlasState.shared.registeredCandidates onto the heatmap.

import { buildRegistryOverlay }
  from '../atlases/inversion/pages/discovery/dosage_heatmap/regime_registry_overlay.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// Canonical: 6 samples, 5 markers at 1.0,1.1,…,1.4 Mb.
function makeCanonical() {
  return {
    n_samples: 6,
    n_markers: 5,
    cellValue: () => 1,
    sample_labels: ['s0', 's1', 's2', 's3', 's4', 's5'],
    marker_pos_bp: Float64Array.from([1.0e6, 1.1e6, 1.2e6, 1.3e6, 1.4e6]),
  };
}

// Two registered regimes on LG28: a wide one (1.0–1.4 Mb) and a narrow
// one (1.2–1.3 Mb, higher confidence).
const registered = [
  {
    candidate_id: 'WIDE', chrom: 'LG28', start_bp: 1.0e6, end_bp: 1.4e6,
    regime_class: 'stable_three_band_regime', confidence: 0.7,
    regime_groups: { 'H1/H1': ['s0', 's1'], 'H1/H2': ['s2', 's3'], 'H2/H2': ['s4', 's5'] },
  },
  {
    candidate_id: 'NARROW', chrom: 'LG28', start_bp: 1.2e6, end_bp: 1.3e6,
    regime_class: 'stable_two_band_regime', confidence: 0.9,
    regime_groups: { 'H1/H1': ['s0'], 'H2/H2': ['s5'] },
  },
  { candidate_id: 'OTHERCHR', chrom: 'LG7', start_bp: 1.0e6, end_bp: 1.4e6,
    regime_class: 'x', confidence: 1.0, regime_groups: { 'H1/H1': ['s0'] } },
];

// =====================================================================
group('buildRegistryOverlay — basics');

const can = makeCanonical();
const ov = buildRegistryOverlay(can, registered, { chrom: 'LG28' });
check('returns a result', !!ov);
check('two overlapping regimes (chrom filtered)', ov.n_regimes === 2);
check('spans sorted by lo', ov.spans[0].lo <= ov.spans[1].lo);
check('WIDE span covers all 5 markers', (() => {
  const w = ov.spans.find(s => s.candidate_id === 'WIDE');
  return w && w.lo === 0 && w.hi === 4;
})());
check('NARROW span covers markers 2–3', (() => {
  const nrw = ov.spans.find(s => s.candidate_id === 'NARROW');
  return nrw && nrw.lo === 2 && nrw.hi === 3;
})());
check('primary = WIDE (widest overlap)', ov.primary_id === 'WIDE');

// =====================================================================
group('per-sample labels from primary');

check('sample_group length = n_samples', ov.sample_group.length === 6);
check('s0/s1 → H1/H1', ov.sample_group[0] === 'H1/H1' && ov.sample_group[1] === 'H1/H1');
check('s2/s3 → H1/H2', ov.sample_group[2] === 'H1/H2' && ov.sample_group[3] === 'H1/H2');
check('s4/s5 → H2/H2', ov.sample_group[4] === 'H2/H2' && ov.sample_group[5] === 'H2/H2');
check('regime_call maps server→call', ov.regime_call[0] === 'homA_like'
  && ov.regime_call[2] === 'het_like' && ov.regime_call[4] === 'homB_like');

// =====================================================================
group('chrom filter + no-overlap + degenerate');

check('other-chrom record excluded', !ov.spans.some(s => s.candidate_id === 'OTHERCHR'));
const noChrom = buildRegistryOverlay(can, registered);   // no chrom → bp overlap only
check('without chrom filter, OTHERCHR also overlaps (3 regimes)', noChrom.n_regimes === 3);

const farRegistry = [{ candidate_id: 'FAR', chrom: 'LG28', start_bp: 5e6, end_bp: 6e6,
  regime_class: 'x', confidence: 0.5, regime_groups: { 'H1/H1': ['s0'] } }];
const ovFar = buildRegistryOverlay(can, farRegistry, { chrom: 'LG28' });
check('non-overlapping window → n_regimes 0', ovFar.n_regimes === 0);
check('non-overlapping → null sample_group entries', ovFar.sample_group.every(v => v === null));

check('null registry → null', buildRegistryOverlay(can, null) === null);
check('empty registry → null', buildRegistryOverlay(can, []) === null);
check('no marker_pos_bp → null', buildRegistryOverlay(
  { n_samples: 2, n_markers: 2, cellValue: () => 1, sample_labels: ['a', 'b'] },
  registered, { chrom: 'LG28' }) === null);

// =====================================================================
console.log('\n=================');
console.log('pass: ' + pass + '   fail: ' + fail);
console.log('=================');
if (fail > 0 && typeof process !== 'undefined') process.exitCode = 1;
