// tests/test_shared_mgl_stripe_quality.js
//
// Coverage for shared/mgl_stripe_quality — pure-compute migration of
// the legacy computeStripeQuality (STEP29 candidate coherence +
// polarity pipeline).

import {
  computeStripeQuality,
  perGroupMarkerMeans,
  selectInformativeMarkers,
  medianAndMad,
  stripeQualitySummary,
  MGL_STRIPE_QUALITY_DEFAULTS,
} from '../atlases/cross-species/shared/mgl_stripe_quality.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('exports');
check('computeStripeQuality fn',                typeof computeStripeQuality === 'function');
check('perGroupMarkerMeans fn',                 typeof perGroupMarkerMeans === 'function');
check('selectInformativeMarkers fn',            typeof selectInformativeMarkers === 'function');
check('medianAndMad fn',                        typeof medianAndMad === 'function');
check('stripeQualitySummary fn',                typeof stripeQualitySummary === 'function');
check('defaults frozen object',
      Object.isFrozen(MGL_STRIPE_QUALITY_DEFAULTS));

// =====================================================================
group('medianAndMad');
check('null input → null',                      medianAndMad(null) === null);
check('empty input → null',                     medianAndMad([]) === null);
check('all NaN → null',                         medianAndMad([NaN, NaN]) === null);
const mm = medianAndMad([1, 2, 3, 4, 5]);
check('median = 3',                             mm.median === 3);
check('MAD ≥ 1 (constant fallback)',            mm.mad >= 1);
const mm2 = medianAndMad([5, 5, 5, 5]);
check('all-same values: MAD floor = 1',         mm2.mad === 1);
const mm3 = medianAndMad([1, 1, 1, 10, 10]);
check('median from odd-length list',            mm3.median === 1);

// =====================================================================
group('perGroupMarkerMeans');
//
//   markers: 0 — clean HOM1=0, HOM2=2 separator
//            1 — HOM1=1, HOM2=1.5 (intermediate)
//            2 — all NA (-1 sentinel)
//
const chunk_m = {
  samples: ['s0','s1','s2','s3','s4','s5'],
  markers: [{}, {}, {}],
  dosage: [
    [0, 0, 1, 1, 2, 2],
    [1, 1, 1, 1, 2, 1],
    [-1, -1, -1, -1, -1, -1],
  ],
};
const grpIdx = { HOMO_1: [0, 1], HET: [2, 3], HOMO_2: [4, 5] };
const means = perGroupMarkerMeans(chunk_m.dosage, grpIdx, 3);
check('HOMO_1 marker 0 mean = 0',                means.HOMO_1[0] === 0);
check('HOMO_2 marker 0 mean = 2',                means.HOMO_2[0] === 2);
check('HET    marker 0 mean = 1',                means.HET[0] === 1);
check('marker 2 NA → NaN per group',
      Number.isNaN(means.HOMO_1[2])
   && Number.isNaN(means.HET[2])
   && Number.isNaN(means.HOMO_2[2]));

// Single-sample group: all NaN.
const singletons = { HOMO_1: [0], HET: [1], HOMO_2: [2] };
const m_single = perGroupMarkerMeans(chunk_m.dosage, singletons, 3);
check('single-sample groups → all NaN',
      Number.isNaN(m_single.HOMO_1[0])
   && Number.isNaN(m_single.HET[0]));

// =====================================================================
group('selectInformativeMarkers');
// Use min_informative_markers=2 so the fallback doesn't catch our
// 5-marker fixture and override the threshold filter.
const sel = selectInformativeMarkers(
  Float64Array.from([0,   1, 0.05, 1.0, 0.1]),
  Float64Array.from([2,   1, 0.10, 1.0, 0.2]),
  { min_informative_markers: 2 },
);
check('marker 0 selected (|delta|=2)',           sel.info_idx.includes(0));
check('marker 1 not selected (|delta|=0)',       !sel.info_idx.includes(1));
check('abs_delta array length = 5',              sel.abs_delta.length === 5);
// Falls back to top-N when too few survive the threshold.
const selFallback = selectInformativeMarkers(
  Float64Array.from([0, 0, 0, 0, 0]),
  Float64Array.from([0.05, 0.04, 0.03, 0.02, 0.01]),
  { min_informative_markers: 10, fallback_top_n: 5 },
);
check('fallback fires when too few above threshold',
      selFallback.info_idx.length === 5);
check('fallback returns ALL markers when n < top_n',
      selectInformativeMarkers(
        Float64Array.from([0, 0]),
        Float64Array.from([0, 0]),
        { min_informative_markers: 10, fallback_top_n: 50 },
      ).info_idx.length === 2);

// =====================================================================
group('computeStripeQuality — fixture');

// 6 samples: 2 HOMO_1, 2 HET, 2 HOMO_2.
// 12 markers, all informative (HOM1=0, HET=1, HOM2=2 ideal).
const chunk = {
  samples: ['s0','s1','s2','s3','s4','s5'],
  markers: Array.from({ length: 12 }, (_, i) => ({ marker_id: 'M' + i })),
  dosage: [],
};
for (let mi = 0; mi < 12; mi++) {
  chunk.dosage.push([0, 0, 1, 1, 2, 2]);
}
const sampleGroup = (si) => si < 2 ? 'HOMO_1' : si < 4 ? 'HET' : 'HOMO_2';
const samplePC1   = (si) => si - 2.5;   // -2.5, -1.5, -0.5, 0.5, 1.5, 2.5

const rows = computeStripeQuality(chunk, sampleGroup, samplePC1);
check('n_rows = n_samples',                     rows.length === 6);
check('rows have sample id',                    rows.every(r => typeof r.sample === 'string'));
check('all coarse_groups assigned',
      rows.every(r => r.coarse_group !== 'unknown'));
// HOM samples in this clean fixture: agreement_fraction = 1 → coherent.
// HET samples sit at the midpoint between HOMO_1 and HOMO_2 means, so
// |x − own| == |x − other_mean| for every informative marker; the
// "strict <" tiebreaker drops to 0/N → discordant. That's the
// expected legacy behaviour for a perfectly-clean fixture.
check('HOM samples → coherent',
      rows[0].coherence_class === 'coherent'
   && rows[1].coherence_class === 'coherent'
   && rows[4].coherence_class === 'coherent'
   && rows[5].coherence_class === 'coherent');
check('HET samples in midpoint fixture: discordant (degenerate)',
      rows[2].coherence_class === 'discordant'
   && rows[3].coherence_class === 'discordant');
check('all stripe_quality assigned (not "unknown")',
      rows.every(r => r.stripe_quality !== 'unknown'));
check('agreement_fraction = 1.0 for HOM samples (clean fixture)',
      rows[0].agreement_fraction === 1
   && rows[5].agreement_fraction === 1);
check('tier_rule string includes group',
      rows[0].tier_rule.indexOf('group=HOMO_1') >= 0);

// Noisy fixture: introduce an outlier into HOMO_1[0] — sample 0 has
// HOM_2-like dosage even though labelled HOM_1.
const chunk2 = {
  samples: chunk.samples.slice(),
  markers: chunk.markers.slice(),
  dosage: chunk.dosage.map(r => r.slice()),
};
for (let mi = 0; mi < 12; mi++) chunk2.dosage[mi][0] = 2;
const rowsNoisy = computeStripeQuality(chunk2, sampleGroup, samplePC1);
check('outlier HOMO_1 sample flagged discordant or worse',
      rowsNoisy[0].coherence_class !== 'coherent');
check('outlier centroid_z available',
      Number.isFinite(rowsNoisy[0].centroid_z_score));

// NA in informative marker for sample 0 — agreement_fraction should
// drop without throwing.
const chunk3 = {
  samples: chunk.samples.slice(),
  markers: chunk.markers.slice(),
  dosage: chunk.dosage.map(r => r.slice()),
};
for (let mi = 0; mi < 12; mi++) chunk3.dosage[mi][0] = -1;
const rowsNA = computeStripeQuality(chunk3, sampleGroup, samplePC1);
check('sample 0 with all-NA dosage → insufficient',
      rowsNA[0].coherence_class === 'insufficient');
check('sample 0 with all-NA: agreement_fraction = null',
      rowsNA[0].agreement_fraction === null);

// Null inputs.
check('null chunk → []',
      computeStripeQuality(null, sampleGroup, samplePC1).length === 0);
check('empty chunk → []',
      computeStripeQuality({ samples: [], markers: [], dosage: [] },
                            sampleGroup, samplePC1).length === 0);

// =====================================================================
group('stripeQualitySummary');
const sumClean = stripeQualitySummary(rows);
check('summary has HOMO_1 key',                 sumClean.HOMO_1 !== undefined);
check('summary HOMO_1 + HET + HOMO_2 counts sum = 6',
      sumClean.HOMO_1.core + sumClean.HOMO_1.peripheral + sumClean.HOMO_1.junk
    + sumClean.HET.core    + sumClean.HET.peripheral    + sumClean.HET.junk
    + sumClean.HOMO_2.core + sumClean.HOMO_2.peripheral + sumClean.HOMO_2.junk
    + (sumClean.HOMO_1.unknown || 0)
    + (sumClean.HET.unknown || 0)
    + (sumClean.HOMO_2.unknown || 0) === 6);
check('summary null → {}',                      Object.keys(stripeQualitySummary(null)).length === 0);
check('summary on noisy fixture has discordant or junk count',
      Object.values(stripeQualitySummary(rowsNoisy))
        .some(g => (g.junk + g.peripheral) > 0));

// =====================================================================
group('opt threshold overrides');
//
// Override HET coherent threshold to 0.99 — should push our HET
// samples down a tier.
const rowsStrict = computeStripeQuality(chunk, sampleGroup, samplePC1, {
  het_coh_coherent: 0.99,
});
check('strict HET threshold downgrades coherent HET',
      rowsStrict[2].coherence_class !== 'coherent'
   || rowsStrict[2].stripe_quality === 'peripheral'
   || rowsStrict[2].stripe_quality === 'junk');

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
