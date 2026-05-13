// tests/test_shared_mgl_heatmap_json.js
//
// Unit coverage for shared/mgl_heatmap_json.js — validator +
// accessors + live-compute from a parsed Beagle dosage matrix.

import {
  MGL_HEATMAP_SCHEMA_VERSION,
  MGL_CENTERING_ANCHORS,
  MGL_POLARITY_REFERENCES,
  isMglHeatmapJson,
  fromPrecomputedJson,
  buildHeatmapFromDosage,
  markerIndexOf,
  sampleIndexOf,
  orderMarkerIndices,
  heatmapFilenameFor,
} from '../atlases/inversion/shared/mgl_heatmap_json.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab');

check('schema_version = 1',          MGL_HEATMAP_SCHEMA_VERSION === 1);
check('5 centering anchors',         MGL_CENTERING_ANCHORS.length === 5);
check('"hom2" in anchors',           MGL_CENTERING_ANCHORS.includes('hom2'));
check('4 polarity refs',             MGL_POLARITY_REFERENCES.length === 4);

// =====================================================================
group('isMglHeatmapJson');

const good = {
  candidate_id: 'cand_1',
  view_name:    'all_pairs',
  weighted:     false,
  centering:    { anchor: 'all', polarity_reference: 'pc1_correlation' },
  n_samples:    3,
  samples:      ['S1', 'S2', 'S3'],
  n_markers:    2,
  markers: [
    { marker: 'M0', chrom: 'LG28', pos: 100, dosage: [0.1, 0.2, 0.3] },
    { marker: 'M1', chrom: 'LG28', pos: 200, dosage: [1.0, 1.0, 1.0] },
  ],
};
check('good payload → ok',                isMglHeatmapJson(good).ok);
check('null → !ok',                       !isMglHeatmapJson(null).ok);
check('missing field flagged',
      !isMglHeatmapJson({ candidate_id: 'X' }).ok);

// Bad centering anchor
const badAnchor = JSON.parse(JSON.stringify(good));
badAnchor.centering.anchor = 'not_a_real_anchor';
const v_anchor = isMglHeatmapJson(badAnchor);
check('bad centering.anchor flagged',
      !v_anchor.ok && v_anchor.errors.some(e => e.includes('centering.anchor')));

// Bad samples length
const badSamples = JSON.parse(JSON.stringify(good));
badSamples.samples = ['S1', 'S2'];
const v_samples = isMglHeatmapJson(badSamples);
check('samples length mismatch flagged',
      !v_samples.ok && v_samples.errors.some(e => e.includes('samples.length')));

// Per-marker dosage length mismatch
const badMarker = JSON.parse(JSON.stringify(good));
badMarker.markers[0].dosage = [0.1, 0.2];
const v_mk = isMglHeatmapJson(badMarker);
check('marker dosage length mismatch flagged',
      !v_mk.ok && v_mk.errors.some(e => e.includes('dosage.length')));

// =====================================================================
group('fromPrecomputedJson');

const r = fromPrecomputedJson(good);
check('returns non-null',                 r !== null);
check('_source = precomputed_json',       r._source === 'precomputed_json');
check('marker 0 dosage is Float64Array',  r.markers[0].dosage instanceof Float64Array);
check('marker 0 dosage[2] = 0.3',         Math.abs(r.markers[0].dosage[2] - 0.3) < 1e-9);
check('bad payload → null',               fromPrecomputedJson(null) === null);

// =====================================================================
group('buildHeatmapFromDosage — live compute from Beagle output');

// Build a fake parser output (mgl_beagle_parser's shape):
//   3 markers × 4 samples, dosage_matrix row-major.
const beagle = {
  markers:       ['M0', 'M1', 'M2'],
  allele1:       new Int8Array([0, 0, 1]),
  allele2:       new Int8Array([1, 2, 2]),
  samples:       ['S0', 'S1', 'S2', 'S3'],
  n_markers:     3,
  n_samples:     4,
  dosage_matrix: new Float64Array([
    // M0: 1, 2, 3, 4  mean=2.5  centered: [-1.5, -0.5, 0.5, 1.5]
    1, 2, 3, 4,
    // M1: 5, 5, 5, 5  mean=5    centered: [0, 0, 0, 0]
    5, 5, 5, 5,
    // M2: 0, 1, 2, 3  mean=1.5  centered: [-1.5, -0.5, 0.5, 1.5]
    0, 1, 2, 3,
  ]),
};

const live = buildHeatmapFromDosage({
  dosage_result: beagle,
  candidate_id:  'cand_live',
  view_name:     'all_pairs',
  weighted:      true,
});
check('live: returns non-null',          live !== null);
check('live: _source = live_compute',    live._source === 'live_compute');
check('live: n_markers = 3',             live.n_markers === 3);
check('live: n_samples = 4',             live.n_samples === 4);
check('live: samples preserved',         live.samples[2] === 'S2');
check('live: marker.dosage raw preserved',
      Math.abs(live.markers[0].dosage[3] - 4) < 1e-9);
check('live: marker.dosage_centered M0',
      Math.abs(live.markers[0].dosage_centered[0] - (-1.5)) < 1e-9
   && Math.abs(live.markers[0].dosage_centered[3] - 1.5)   < 1e-9);
check('live: marker.dosage_centered M1 = 0',
      Math.abs(live.markers[1].dosage_centered[0]) < 1e-9);
check('live: allele decoded from int code (M0: 0→A, 1→C)',
      live.markers[0].allele_a === 'A' && live.markers[0].allele_b === 'C');

// Subset centering — only samples [0, 1] define the mean.
// M0 subset mean = (1+2)/2 = 1.5 → centered [-0.5, 0.5, 1.5, 2.5]
const liveSubset = buildHeatmapFromDosage({
  dosage_result:     beagle,
  candidate_id:      'cand_live',
  view_name:         'all_pairs',
  centering_anchor:  'hom1',
  centering_subset:  [0, 1],
});
check('subset centering: M0 first value -0.5',
      Math.abs(liveSubset.markers[0].dosage_centered[0] - (-0.5)) < 1e-9);
check('subset centering: M0 last value 2.5',
      Math.abs(liveSubset.markers[0].dosage_centered[3] - 2.5) < 1e-9);
check('subset centering: anchor preserved in output',
      liveSubset.centering.anchor === 'hom1');

// Polarity flip — ref_pc1 increases with sample idx → marker M2
// (which increases with sample idx) correlates positively → no flip.
// To force a flip, give a DECREASING ref_pc1.
const ref_dec = new Float64Array([3, 1, -1, -3]);
const liveFlip = buildHeatmapFromDosage({
  dosage_result:    beagle,
  candidate_id:     'cand_live',
  view_name:        'all_pairs',
  polarity_ref_pc1: ref_dec,
});
// Expect: M0 (increasing dosage) has NEG correlation with ref_dec → flip
//         M2 (increasing dosage) has NEG correlation with ref_dec → flip
//         M1 (flat) has 0 correlation → no flip
check('live flip: M0 polarity_flipped = true',  liveFlip.markers[0].polarity_flipped === true);
check('live flip: M2 polarity_flipped = true',  liveFlip.markers[2].polarity_flipped === true);
check('live flip: M1 polarity_flipped = false', liveFlip.markers[1].polarity_flipped === false);
// After flipping M0 (was [-1.5,-0.5,0.5,1.5] centered), sign reversed → [1.5, 0.5, -0.5, -1.5]
check('live flip: M0 dosage_centered sign-reversed',
      Math.abs(liveFlip.markers[0].dosage_centered[0] - 1.5)  < 1e-9
   && Math.abs(liveFlip.markers[0].dosage_centered[3] - (-1.5)) < 1e-9);

check('null dosage_result → null', buildHeatmapFromDosage({}) === null);

// =====================================================================
group('Accessors');

check('markerIndexOf hit',           markerIndexOf(r, 'M1') === 1);
check('markerIndexOf miss',          markerIndexOf(r, 'fake') === -1);
check('sampleIndexOf hit',           sampleIndexOf(r, 'S2') === 1);
check('sampleIndexOf miss',          sampleIndexOf(r, 'fake') === -1);

// =====================================================================
group('orderMarkerIndices');

// 3-marker × 4-sample result with explicit chrom+pos. The 4-sample
// dosage profiles let us differentiate correlation magnitude
// (correlation maxes at 1 trivially for n=2).
const sortable = fromPrecomputedJson({
  candidate_id: 'X', view_name: 'all_pairs',
  n_samples: 4, samples: ['S0', 'S1', 'S2', 'S3'],
  n_markers: 3,
  markers: [
    { marker: 'M_late',  chrom: 'LG28', pos: 300, dosage: [0.5, 0.55, 0.5, 0.6] },
    { marker: 'M_early', chrom: 'LG28', pos: 100, dosage: [0.0, 0.3, 0.6, 1.0] },
    { marker: 'M_mid',   chrom: 'LG28', pos: 200, dosage: [0.5, 0.5, 0.5, 0.5] },
  ],
});

const genomic = orderMarkerIndices(sortable, 'genomic');
check('genomic order: pos 100 → 200 → 300',
      sortable.markers[genomic[0]].pos === 100
   && sortable.markers[genomic[1]].pos === 200
   && sortable.markers[genomic[2]].pos === 300);

// Order by pc1_loading: ref correlates almost perfectly with M_early
// (clean linear), weakly with M_late (noisy), zero with M_mid (flat).
// Expect M_early > M_late > M_mid.
const orderPc1 = orderMarkerIndices(sortable, 'pc1_loading', {
  ref_pc1: new Float64Array([-1, -0.33, 0.33, 1]),
});
check('pc1_loading: M_early ranks first',
      sortable.markers[orderPc1[0]].marker === 'M_early');
check('pc1_loading: M_mid ranks last (zero correlation)',
      sortable.markers[orderPc1[2]].marker === 'M_mid');

// =====================================================================
group('heatmapFilenameFor');

check('filename pattern',
      heatmapFilenameFor('all_pairs', 'unweighted', 'het')
   === 'heatmap_all_pairs_unweighted_het.json');

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
