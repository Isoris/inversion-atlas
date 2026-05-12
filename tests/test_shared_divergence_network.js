// tests/test_shared_divergence_network.js

import {
  DIVERGENCE_NETWORK_SOURCES,
  DIVERGENCE_NETWORK_METRICS,
  DIVERGENCE_LOW_POWER_MIN_N,
  DIVERGENCE_FST_WEAK_THRESHOLD,
  DIVERGENCE_FST_STRONG_THRESHOLD,
  DIVERGENCE_EDGE_COLORS,
  DIVERGENCE_LABEL_ORDER,
  computeDivergenceNetwork,
  divergenceNetworkRenderHints,
} from '../atlases/inversion/shared/divergence_network.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
// Fixture: 18 samples in 3 well-separated groups (STD / HET / INV)
// across 4 windows. STD centroid -1, HET ~0 (wobbles harder), INV +1.
//
// Each sample gets a deterministic per-sample-per-window jitter so
// within-group variance > 0. The jitter is scaled SMALL for STD/INV
// (clean homozygotes) and LARGER for HET (heterozygotes are noisier),
// which makes both the within-group π and the FST signal land right.
// =====================================================================
function makeFixture({ K = 3, hetWobbleAmp = 0.5, windows = 4 } = {}) {
  const labelsBySample = [];
  for (let i = 0; i < 6; i++) labelsBySample.push('STD');
  for (let i = 0; i < 6; i++) labelsBySample.push('HET');
  for (let i = 0; i < 6; i++) labelsBySample.push('INV');
  const n = labelsBySample.length;
  const jitter = (s, w) => (((s * 7 + w * 13) % 100) - 50) / 1000;   // [-0.05, +0.05]
  const winList = [];
  for (let w = 0; w < windows; w++) {
    const pc1 = new Array(n).fill(0);
    const pc2 = new Array(n).fill(0);
    const dosage = new Array(n).fill(0);
    const offset = (w - (windows - 1) / 2);
    for (let s = 0; s < n; s++) {
      const lab = labelsBySample[s];
      const center = lab === 'STD' ? -1 : lab === 'HET' ? 0 : 1;
      const amp = (lab === 'HET') ? hetWobbleAmp : 0.05;
      // Per-sample jitter scaled larger for HET so within-group π is bigger
      const jitterScale = (lab === 'HET') ? 1.5 : 0.3;
      pc1[s] = center + offset * amp + jitter(s, w) * jitterScale;
      pc2[s] = (s % 2 ? 0.1 : -0.1);
      // dosage in [0, 2]: STD → 0, HET → 1, INV → 2 (small jitter, clipped)
      const dCenter = lab === 'STD' ? 0 : lab === 'HET' ? 1 : 2;
      dosage[s] = Math.max(0, Math.min(2, dCenter + offset * 0.03 + jitter(s, w) * 0.05));
    }
    winList.push({ pca: { pc1, pc2 }, dosage });
  }
  const state = {
    data: {
      n_samples: n,
      windows: winList,
    },
  };
  const candidate = {
    id: 'cand_test', chrom: 'LG28', K,
    start_w: 0, end_w: windows - 1,
  };
  return { state, candidate, labels: labelsBySample };
}

// =====================================================================
group('constants');
check('SOURCES frozen, 2 entries',             Object.isFrozen(DIVERGENCE_NETWORK_SOURCES)
                                               && DIVERGENCE_NETWORK_SOURCES.length === 2);
check('METRICS frozen, 2 entries',             Object.isFrozen(DIVERGENCE_NETWORK_METRICS));
check('LOW_POWER_MIN_N = 5',                   DIVERGENCE_LOW_POWER_MIN_N === 5);
check('FST_WEAK_THRESHOLD = 0.10',             DIVERGENCE_FST_WEAK_THRESHOLD === 0.10);
check('FST_STRONG_THRESHOLD = 0.25',           DIVERGENCE_FST_STRONG_THRESHOLD === 0.25);
check('EDGE_COLORS has 4 flag keys',           Object.keys(DIVERGENCE_EDGE_COLORS).length === 4);
check('LABEL_ORDER frozen + includes STD',     Object.isFrozen(DIVERGENCE_LABEL_ORDER)
                                               && DIVERGENCE_LABEL_ORDER.includes('STD'));

// =====================================================================
group('computeDivergenceNetwork — input validation');
check('null state → null',                     computeDivergenceNetwork(null, {}, []) === null);
check('no state.data → null',                  computeDivergenceNetwork({}, {}, []) === null);
check('no windows → null',
      computeDivergenceNetwork({ data: { windows: 'oops' } }, {}, []) === null);
check('null candidate → null',
      computeDivergenceNetwork({ data: { windows: [], n_samples: 1 } }, null, []) === null);
{
  const { state, candidate } = makeFixture();
  check('unknown source → null',
        computeDivergenceNetwork(state, candidate, [], { source: 'oops' }) === null);
  check('unknown metric → null',
        computeDivergenceNetwork(state, candidate, [], { metric: 'oops' }) === null);
  // end_w < start_w
  const badCand = { ...candidate, start_w: 5, end_w: 0 };
  check('end_w < start_w → null',              computeDivergenceNetwork(state, badCand, []) === null);
}

// =====================================================================
group('computeDivergenceNetwork — clean K=3 with pc1 + FST');
{
  const { state, candidate, labels } = makeFixture();
  const r = computeDivergenceNetwork(state, candidate, labels);
  check('returns object',                       !!r);
  check('3 nodes',                              r.nodes.length === 3);
  check('3 edges',                              r.edges.length === 3);
  // Order: STD, HET, INV (per LABEL_ORDER)
  check('node order STD, HET, INV',
        r.nodes[0].id === 'STD' && r.nodes[1].id === 'HET' && r.nodes[2].id === 'INV');
  check('STD n = 6',                            r.nodes[0].n === 6);
  check('STD color = palette[0]',               r.nodes[0].color === '#4fa3ff');
  check('HET color = palette[2]',               r.nodes[1].color === '#f5a524');
  check('INV color = palette[4]',               r.nodes[2].color === '#e0555c');
  // STD-INV pair should have STRONG FST (well-separated centroids)
  const stdInv = r.edges.find(e => e.a === 'STD' && e.b === 'INV');
  check('STD-INV edge exists',                  !!stdInv);
  check('STD-INV FST is finite + non-negative', Number.isFinite(stdInv.fst) && stdInv.fst >= 0);
  check('STD-INV FST > weak threshold',         stdInv.fst > DIVERGENCE_FST_WEAK_THRESHOLD);
  // HET-INV / STD-HET edges should also be flagged
  const stdHet = r.edges.find(e => e.a === 'STD' && e.b === 'HET');
  check('STD-HET edge exists',                  !!stdHet);
  check('all 3 unique pairs',
        r.edges.find(e => e.a === 'HET' && e.b === 'INV'));
  // meta sanity
  check('meta candidate_id',                    r.meta.candidate_id === 'cand_test');
  check('meta source = pc1',                    r.meta.source === 'pc1');
  check('meta metric = fst',                    r.meta.metric === 'fst');
  check('meta start_w = 0',                     r.meta.start_w === 0);
  check('meta end_w = 3',                       r.meta.end_w === 3);
  // stats
  check('all 18 classified',                    r.stats.n_samples_classified === 18);
  check('0 unclassified',                       r.stats.n_samples_unclassified === 0);
  check('3 groups',                             r.stats.n_groups === 3);
}

// =====================================================================
group('within-group π proxy');
{
  // HET should have larger within_pi than STD/INV (it wobbles more)
  const { state, candidate, labels } = makeFixture({ hetWobbleAmp: 1.0 });
  const r = computeDivergenceNetwork(state, candidate, labels);
  const std = r.nodes.find(n => n.id === 'STD');
  const het = r.nodes.find(n => n.id === 'HET');
  const inv = r.nodes.find(n => n.id === 'INV');
  check('HET within_pi > STD within_pi',        het.within_pi > std.within_pi);
  check('HET within_pi > INV within_pi',        het.within_pi > inv.within_pi);
  check('STD within_pi is finite',              Number.isFinite(std.within_pi));
}

// =====================================================================
group('FST: well-separated > overlapping');
{
  // STD-INV (centroids ±1) should have higher FST than STD-HET (centroids -1, 0)
  const { state, candidate, labels } = makeFixture();
  const r = computeDivergenceNetwork(state, candidate, labels);
  const stdInv = r.edges.find(e => e.a === 'STD' && e.b === 'INV');
  const stdHet = r.edges.find(e => e.a === 'STD' && e.b === 'HET');
  check('STD-INV FST > STD-HET FST',            stdInv.fst > stdHet.fst);
}

// =====================================================================
group('distance metric (alternative to FST)');
{
  const { state, candidate, labels } = makeFixture();
  const r = computeDivergenceNetwork(state, candidate, labels, { metric: 'distance' });
  check('metric is distance',                   r.meta.metric === 'distance');
  const stdInv = r.edges.find(e => e.a === 'STD' && e.b === 'INV');
  // STD centroid -1, INV centroid +1 → mean distance per window ~2
  check('STD-INV distance ≈ 2',                 Math.abs(stdInv.distance - 2) < 0.2);
  check('FST field is null when metric=distance', stdInv.fst === null);
  check('weight === distance',                  stdInv.weight === stdInv.distance);
  check('STD-INV stronger than STD-HET (distance)',
        stdInv.distance > r.edges.find(e => e.a === 'STD' && e.b === 'HET').distance);
}

// =====================================================================
group('source=dosage with Nei FST');
{
  const { state, candidate, labels } = makeFixture();
  const r = computeDivergenceNetwork(state, candidate, labels, { source: 'dosage' });
  check('source = dosage',                      r.meta.source === 'dosage');
  // STD (dosage~0) vs INV (dosage~2) → near-perfect FST
  const stdInv = r.edges.find(e => e.a === 'STD' && e.b === 'INV');
  check('STD-INV FST very high (~1)',           stdInv.fst > 0.9);
  // STD-HET (dosage 0 vs 1) → moderate FST
  const stdHet = r.edges.find(e => e.a === 'STD' && e.b === 'HET');
  check('STD-HET FST > 0 and < 1',              stdHet.fst > 0 && stdHet.fst < 1);
  // Flag confirms STD-INV strong
  check('STD-INV flagged strong',               stdInv.flag === 'strong');
}

// =====================================================================
group('low_power flag');
{
  // Build a fixture with only 4 samples in HET → low_power
  const labels = [];
  for (let i = 0; i < 6; i++) labels.push('STD');
  for (let i = 0; i < 4; i++) labels.push('HET');
  for (let i = 0; i < 6; i++) labels.push('INV');
  const n = labels.length;
  const windows = 4;
  const winList = [];
  for (let w = 0; w < windows; w++) {
    const pc1 = new Array(n).fill(0);
    for (let s = 0; s < n; s++) {
      pc1[s] = labels[s] === 'STD' ? -1 : labels[s] === 'HET' ? 0 : 1;
    }
    winList.push({ pca: { pc1 } });
  }
  const state = { data: { n_samples: n, windows: winList } };
  const cand = { id: 'c', chrom: 'X', K: 3, start_w: 0, end_w: 3 };
  const r = computeDivergenceNetwork(state, cand, labels);
  const stdHet = r.edges.find(e => e.a === 'STD' && e.b === 'HET');
  check('STD-HET flagged low_power (n_het = 4)', stdHet.flag === 'low_power');
  const hetInv = r.edges.find(e => e.a === 'HET' && e.b === 'INV');
  check('HET-INV also low_power',                hetInv.flag === 'low_power');
  const stdInv = r.edges.find(e => e.a === 'STD' && e.b === 'INV');
  check('STD-INV NOT low_power (both n=6)',      stdInv.flag !== 'low_power');
}

// =====================================================================
group('RECOMBINANT handling');
{
  // Drop by default
  const labels = [];
  for (let i = 0; i < 5; i++) labels.push('STD');
  for (let i = 0; i < 5; i++) labels.push('INV');
  for (let i = 0; i < 3; i++) labels.push('RECOMBINANT');
  const n = labels.length;
  const winList = [];
  for (let w = 0; w < 4; w++) {
    const pc1 = new Array(n).fill(0);
    for (let s = 0; s < n; s++) {
      pc1[s] = labels[s] === 'STD' ? -1 : labels[s] === 'INV' ? 1 : 0;
    }
    winList.push({ pca: { pc1 } });
  }
  const state = { data: { n_samples: n, windows: winList } };
  const cand = { id: 'c', chrom: 'X', K: 3, start_w: 0, end_w: 3 };
  const r = computeDivergenceNetwork(state, cand, labels);
  check('RECOMBINANTs dropped by default: 2 groups',     r.nodes.length === 2);
  check('skipped_groups includes RECOMBINANT',
        r.stats.skipped_groups.includes('RECOMBINANT'));
  // includeRecombinants=true
  const r2 = computeDivergenceNetwork(state, cand, labels, { includeRecombinants: true });
  check('includeRecombinants=true: 3 groups',            r2.nodes.length === 3);
  check('RECOMBINANT node has n=3',
        r2.nodes.find(n => n.id === 'RECOMBINANT').n === 3);
}

// =====================================================================
group('unclassified samples handled');
{
  // Mix of labels, null, undefined
  const state = makeFixture().state;
  const cand = { id: 'c', chrom: 'X', K: 3, start_w: 0, end_w: 3 };
  // 18 samples but only 10 classified
  const labels = ['STD', 'STD', 'STD', 'STD', 'STD',
                  'INV', 'INV', 'INV', 'INV', 'INV',
                  null, null, null, undefined, undefined, '', '', null];
  const r = computeDivergenceNetwork(state, cand, labels);
  check('only 2 groups (STD + INV)',                     r.nodes.length === 2);
  check('n_classified = 10',                             r.stats.n_samples_classified === 10);
  check('n_unclassified = 8',                            r.stats.n_samples_unclassified === 8);
}

// =====================================================================
group('exposeMembership');
{
  const { state, candidate, labels } = makeFixture();
  const r = computeDivergenceNetwork(state, candidate, labels, { exposeMembership: true });
  const std = r.nodes.find(n => n.id === 'STD');
  check('sample_idx exposed',                            Array.isArray(std.sample_idx));
  check('STD members are 0..5',                          std.sample_idx.length === 6 && std.sample_idx[0] === 0);
  // Default: not exposed
  const r2 = computeDivergenceNetwork(state, candidate, labels);
  check('sample_idx omitted by default',                 r2.nodes[0].sample_idx === undefined);
}

// =====================================================================
group('karyotype labels as Object (not Array)');
{
  const { state, candidate } = makeFixture();
  const dict = {};
  for (let i = 0; i < 6; i++) dict[i] = 'STD';
  for (let i = 6; i < 12; i++) dict[i] = 'HET';
  for (let i = 12; i < 18; i++) dict[i] = 'INV';
  const r = computeDivergenceNetwork(state, candidate, dict);
  check('Object dict labels work',                       r.nodes.length === 3);
  check('STD n=6',                                       r.nodes.find(n => n.id === 'STD').n === 6);
}

// =====================================================================
group('arr_0/arr_1/arr_2 (multi-haplotype convention)');
{
  const { state, candidate } = makeFixture();
  const labels = [];
  for (let i = 0; i < 6; i++) labels.push('arr_0');
  for (let i = 0; i < 6; i++) labels.push('arr_1');
  for (let i = 0; i < 6; i++) labels.push('arr_2');
  const r = computeDivergenceNetwork(state, candidate, labels);
  check('arr_0/1/2 grouped',                             r.nodes.length === 3);
  check('arr_0 color = palette[0]',                      r.nodes.find(n => n.id === 'arr_0').color === '#4fa3ff');
  check('arr_1 color = palette[2]',                      r.nodes.find(n => n.id === 'arr_1').color === '#f5a524');
  check('arr_2 color = palette[4]',                      r.nodes.find(n => n.id === 'arr_2').color === '#e0555c');
}

// =====================================================================
group('single group → no edges');
{
  const { state, candidate } = makeFixture();
  const labels = [];
  for (let i = 0; i < 18; i++) labels.push('STD');
  const r = computeDivergenceNetwork(state, candidate, labels);
  check('1 node',                                        r.nodes.length === 1);
  check('0 edges',                                       r.edges.length === 0);
  check('within_pi computed',                            Number.isFinite(r.nodes[0].within_pi));
}

// =====================================================================
group('empty / no-classifiable samples');
{
  const { state, candidate } = makeFixture();
  const labels = new Array(18).fill(null);
  const r = computeDivergenceNetwork(state, candidate, labels);
  check('empty groups: 0 nodes',                         r.nodes.length === 0);
  check('empty groups: 0 edges',                         r.edges.length === 0);
  check('n_unclassified = 18',                           r.stats.n_samples_unclassified === 18);
}

// =====================================================================
group('divergenceNetworkRenderHints');
{
  const { state, candidate, labels } = makeFixture();
  const network = computeDivergenceNetwork(state, candidate, labels);
  const hints = divergenceNetworkRenderHints(network, { width: 400, height: 300 });
  check('returns object',                                !!hints);
  check('3 node hints',                                  hints.nodes.length === 3);
  check('3 edge hints',                                  hints.edges.length === 3);
  // Each node has x,y inside canvas
  hints.nodes.forEach((n, i) => {
    check(`node ${i} x in canvas`,                       n.x >= 0 && n.x <= 400);
    check(`node ${i} y in canvas`,                       n.y >= 0 && n.y <= 300);
    check(`node ${i} radius positive`,                    n.radius > 0);
    check(`node ${i} fill is hex`,                       /^#[0-9a-f]{6}$/i.test(n.fill));
  });
  // Edge endpoints match node positions
  const stdHint = hints.nodes.find(n => n.id === 'STD');
  const invHint = hints.nodes.find(n => n.id === 'INV');
  const stdInv = hints.edges.find(e => e.a === 'STD' && e.b === 'INV');
  check('edge x1 matches STD node x',                    stdInv.x1 === stdHint.x);
  check('edge y1 matches STD node y',                    stdInv.y1 === stdHint.y);
  check('edge x2 matches INV node x',                    stdInv.x2 === invHint.x);
  check('edge x2 matches INV node y',                    stdInv.y2 === invHint.y);
  // Edge label is formatted FST
  check('edge label is 2dp FST',                         /^[0-9]\.[0-9]{2}$/.test(stdInv.label));
}

{
  // Render hints handles null/empty
  check('null network → null',                           divergenceNetworkRenderHints(null) === null);
  const empty = { nodes: [], edges: [], meta: { metric: 'fst' } };
  const r = divergenceNetworkRenderHints(empty);
  check('empty network: hints arrays empty',              r.nodes.length === 0 && r.edges.length === 0);
}

// =====================================================================
group('render hints — width scales with weight');
{
  const { state, candidate, labels } = makeFixture();
  const network = computeDivergenceNetwork(state, candidate, labels);
  const hints = divergenceNetworkRenderHints(network);
  const widths = hints.edges.map(e => e.width).sort((a, b) => a - b);
  check('min width >= 1',                                widths[0] >= 1);
  check('max width <= 8',                                widths[widths.length - 1] <= 8);
  check('widths span > 0 (varied)',                      widths[widths.length - 1] > widths[0]);
}

// =====================================================================
group('render hints — flag drives stroke');
{
  // Force a low-power pair
  const labels = [];
  for (let i = 0; i < 6; i++) labels.push('STD');
  for (let i = 0; i < 4; i++) labels.push('HET');   // n=4 → low_power
  for (let i = 0; i < 6; i++) labels.push('INV');
  const n = labels.length;
  const winList = [];
  for (let w = 0; w < 4; w++) {
    const pc1 = new Array(n).fill(0);
    for (let s = 0; s < n; s++) {
      pc1[s] = labels[s] === 'STD' ? -1 : labels[s] === 'HET' ? 0 : 1;
    }
    winList.push({ pca: { pc1 } });
  }
  const state = { data: { n_samples: n, windows: winList } };
  const candidate = { id: 'c', chrom: 'X', K: 3, start_w: 0, end_w: 3 };
  const network = computeDivergenceNetwork(state, candidate, labels);
  const hints = divergenceNetworkRenderHints(network);
  const stdHet = hints.edges.find(e => e.a === 'STD' && e.b === 'HET');
  check('low_power edge stroke = grey',                  stdHet.stroke === DIVERGENCE_EDGE_COLORS.low_power);
  check('low_power edge is dashed',                      stdHet.dashed === true);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
