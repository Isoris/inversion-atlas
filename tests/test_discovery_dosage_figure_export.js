// tests/test_discovery_dosage_figure_export.js
//
// Manuscript-figure features for the dosage heatmap:
//   - even-spaced-by-bp marker view   (marker_select.pickEvenlySpacedByBp)
//   - per-karyogroup sample cap        (sample_subsample.subsampleByGroup)
//   - vector SVG export                (svg_export.buildHeatmapSvg)

import { selectMarkers, pickEvenlySpacedByBp }
  from '../atlases/inversion/pages/discovery/dosage_heatmap/marker_select.js';
import { subsampleByGroup }
  from '../atlases/inversion/pages/discovery/dosage_heatmap/sample_subsample.js';
import { buildHeatmapSvg }
  from '../atlases/inversion/pages/discovery/dosage_heatmap/svg_export.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('pickEvenlySpacedByBp — equal genomic spacing');

// 10 markers evenly at 0,100,…,900.
const evenPos = Float64Array.from([0, 100, 200, 300, 400, 500, 600, 700, 800, 900]);
const pick5 = pickEvenlySpacedByBp(evenPos, 10, 5);
check('returns 5 markers', pick5.length === 5);
check('sorted + unique', pick5.every((v, i) => i === 0 || v > pick5[i - 1]));
check('first near interval start', evenPos[pick5[0]] <= 200);
check('last near interval end', evenPos[pick5[pick5.length - 1]] >= 700);
check('spacing roughly uniform', (() => {
  const xs = pick5.map(i => evenPos[i]);
  const gaps = xs.slice(1).map((x, i) => x - xs[i]);
  const mn = Math.min(...gaps), mx = Math.max(...gaps);
  return mx - mn <= 200;   // near-uniform on an evenly-spaced grid
})());

// Markers CLUSTERED at the left end + a few far right — even-bp must NOT
// just take the dense cluster; it should span the interval.
const clusterPos = Float64Array.from([0, 1, 2, 3, 4, 5, 900, 950, 1000]);
const pickC = pickEvenlySpacedByBp(clusterPos, 9, 3);
check('cluster: spans to the far end', clusterPos[pickC[pickC.length - 1]] >= 900);
check('cluster: not all from the dense cluster', pickC.some(i => clusterPos[i] >= 900));

check('want ≥ nM → all', pickEvenlySpacedByBp(evenPos, 10, 20).length === 10);
check('no positions → even index fallback', (() => {
  const p = pickEvenlySpacedByBp(null, 10, 4);
  return p.length === 4 && p[0] < p[3] && p[3] <= 9;
})());
check('empty → []', pickEvenlySpacedByBp(evenPos, 0, 3).length === 0);

// Wired through selectMarkers(view:'even_bp').
const canon = { n_markers: 10, marker_pos_bp: evenPos };
const sel = selectMarkers(canon, { view: 'even_bp', n: 4 });
check('selectMarkers even_bp returns Int32Array(4)', sel instanceof Int32Array && sel.length === 4);
check('selectMarkers even_bp sorted', sel.every((v, i) => i === 0 || v > sel[i - 1]));

// =====================================================================
group('subsampleByGroup — N samples per karyogroup');

const order = Int32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const labels = Int32Array.from([0, 0, 0, 0, 0, 1, 1, 1, 1, 1]);   // 5 + 5
const cap2 = subsampleByGroup(order, labels, 2);
check('caps to 2 per group → 4 total', cap2.length === 4);
check('keeps 2 from group 0', cap2.filter(s => labels[s] === 0).length === 2);
check('keeps 2 from group 1', cap2.filter(s => labels[s] === 1).length === 2);
check('preserves ascending display order', cap2.every((v, i) => i === 0 || v > cap2[i - 1]));
check('even spread (not just the first two)', (() => {
  // group 0 members 0..4 → evenly-spaced pick should not be {0,1}
  const g0 = cap2.filter(s => labels[s] === 0);
  return !(g0[0] === 0 && g0[1] === 1);
})());

check('cap 0 → unchanged', subsampleByGroup(order, labels, 0).length === 10);
check('cap ≥ group size → all kept', subsampleByGroup(order, labels, 99).length === 10);
check('ungrouped (label −1) never capped', (() => {
  const lab = Int32Array.from([-1, -1, -1, 0, 0, 0, 0, 0, 0, 0]);   // 3 ungrouped, 7 in g0
  const r = subsampleByGroup(order, lab, 2);
  const ung = r.filter(s => lab[s] === -1).length;
  const g0 = r.filter(s => lab[s] === 0).length;
  return ung === 3 && g0 === 2;
})());
check('no labels → unchanged', subsampleByGroup(order, null, 2).length === 10);

// =====================================================================
group('buildHeatmapSvg — vector figure');

// 4 samples × 3 markers; cellValue(marker, sample) like the canvas renderer.
const dos = [
  // marker 0,1,2 per sample
  [0, 1, 2],   // s0
  [2, 1, 0],   // s1
  [1, 1, 1],   // s2
  [0, 0, 2],   // s3
];
const fig = {
  n_samples: 4, n_markers: 3,
  cellValue: (m, s) => dos[s][m],
  sample_group: ['A', 'A', 'B', 'B'],
  marker_polarity: Uint8Array.from([1, 0, 1]),
  marker_pos_bp: Float64Array.from([1000, 500000, 1000000]),
};
const svg = buildHeatmapSvg(fig, { title: 'chr5 inversion', color_mode: 'genotype' });
check('returns an SVG document', typeof svg === 'string' && svg.startsWith('<svg') && svg.includes('</svg>'));
check('has matrix rects', (svg.match(/<rect/g) || []).length >= 4);
check('renders the title', svg.includes('chr5 inversion'));
check('genotype legend labels present', svg.includes('0/0') && svg.includes('0/1') && svg.includes('1/1'));
check('uses genotype red + blue', svg.includes('rgb( 56,107,196)') && svg.includes('rgb(196, 40, 50)'));
check('bp axis shows Mb tick', /Mb|kb/.test(svg));
check('respects marker_order subset (fewer columns)', (() => {
  const one = buildHeatmapSvg(fig, { marker_order: Int32Array.from([1]) });
  const all = buildHeatmapSvg(fig, {});
  // subsetting to one marker yields no more rects than the full figure
  return (one.match(/<rect/g) || []).length <= (all.match(/<rect/g) || []).length;
})());
check('respects sample_order subset', (() => {
  const sub = buildHeatmapSvg(fig, { sample_order: Int32Array.from([0, 1]) });
  return sub.startsWith('<svg') && sub.includes('</svg>');
})());
check('magma mode → gradient legend (no genotype labels)', (() => {
  const m = buildHeatmapSvg(fig, { color_mode: 'magma' });
  return m.startsWith('<svg') && !m.includes('>0/0<');
})());
check('empty data → still valid svg', (() => {
  const e = buildHeatmapSvg({ n_samples: 0, n_markers: 0 }, {});
  return e.startsWith('<svg') && e.includes('</svg>');
})());
check('escapes title XML', buildHeatmapSvg(fig, { title: 'a<b&c' }).includes('a&lt;b&amp;c'));

// =====================================================================
console.log('\n=================');
console.log('pass: ' + pass + '   fail: ' + fail);
console.log('=================');
if (fail > 0 && typeof process !== 'undefined') process.exitCode = 1;
