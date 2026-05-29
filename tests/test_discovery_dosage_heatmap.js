// tests/test_discovery_dosage_heatmap.js
//
// Unit coverage for pages/discovery/dosage_heatmap — sample × marker
// dosage heatmap cartridge. Renderer + adapters + selection are pure
// JS; the full mount/unmount lifecycle is exercised in the smoke
// (DOM polyfill).

import * as page from '../atlases/inversion/pages/discovery/dosage_heatmap.js';
import * as state from '../atlases/inversion/pages/discovery/dosage_heatmap/_state.js';
import {
  paintDosageHeatmap,
  findCellAtPixel,
  findRegimeSpanAtPixel,
  deriveSampleOrder,
  deriveMarkerOrder,
  buildGroupColorMap,
  dosageValueToColor,
  dosageMagmaColor,
  dosageDivergentColor,
  dosageGenotypeColor,
  pickDosageColorFn,
  confidenceColor,
} from '../atlases/inversion/pages/discovery/dosage_heatmap/renderer.js';
import {
  adaptMglHeatmapJson,
  adaptLegacyChunk,
} from '../atlases/inversion/pages/discovery/dosage_heatmap/adapters.js';
import {
  createDosageHeatmapSelection,
  summariseHoverCell,
  groupSizesFromSampleGroup,
} from '../atlases/inversion/pages/discovery/dosage_heatmap/selection.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('page entry — public exports');

check('mount exported',                          typeof page.mount === 'function');
check('unmount exported',                        typeof page.unmount === 'function');
check('refreshDosageHeatmap exported',           typeof page.refreshDosageHeatmap === 'function');
check('initDosageHeatmapToolbar exported',       typeof page.initDosageHeatmapToolbar === 'function');

// =====================================================================
group('_state.js — live-binding pattern');

check('_pageState exported',                     '_pageState' in state);
check('_setActiveState fn',                      typeof state._setActiveState === 'function');
check('_pageState starts null',                  state._pageState === null);
state._setActiveState({ marker: 'D' });
check('_setActiveState mutates',                 state._pageState && state._pageState.marker === 'D');
state._setActiveState(null);
check('_setActiveState(null) clears',            state._pageState === null);

// =====================================================================
group('renderer.dosageDivergentColor (default ramp — blue/white/red, 2026-05-29)');

// RdBu stops: t=0 → (33,102,172) blue; t=0.5 → (247,247,247) white;
// t=1 → (178,24,43) red. Default vmin/vmax = 0/2 so v=1 lands at t=0.5.
check('v=0 → divergent blue (hom-ref)',          dosageDivergentColor(0) === 'rgb(33,102,172)');
check('v=1 → divergent white (het)',             dosageDivergentColor(1) === 'rgb(247,247,247)');
check('v=2 → divergent red (hom-alt)',           dosageDivergentColor(2) === 'rgb(178,24,43)');
check('NaN → mauve missing',                     dosageDivergentColor(NaN) === 'rgb(238,214,222)');
check('custom vmin/vmax respected (t=0.5→white)', dosageDivergentColor(0.5, 0, 1) === 'rgb(247,247,247)');

// dosageValueToColor now aliases the divergent ramp (magma retired).
check('dosageValueToColor alias → divergent',    dosageValueToColor(0) === dosageDivergentColor(0));

group('renderer.dosageMagmaColor (legacy palette — retired as default)');

// The magma fn is still exported (back-compat) but no longer the heatmap
// default. Endpoints unchanged.
check('v=0 → magma dark',                        dosageMagmaColor(0) === 'rgb(0,0,4)');
check('v=2 → magma yellow',                      dosageMagmaColor(2) === 'rgb(252,253,191)');

group('renderer.dosageGenotypeColor (discrete white / blue / red)');

check('v=0 → near-white (HOM ref)',              dosageGenotypeColor(0) === 'rgb(248,248,250)');
check('v=1 → blue (HET)',                        dosageGenotypeColor(1) === 'rgb( 56,107,196)');
check('v=2 → red (HOM alt)',                     dosageGenotypeColor(2) === 'rgb(196, 40, 50)');
check('NaN → mauve (missing)',                   dosageGenotypeColor(NaN) === 'rgb(238,214,222)');

group('renderer.pickDosageColorFn');

check('dosage → divergent fn',                   pickDosageColorFn('dosage')(1, 0, 2) === 'rgb(247,247,247)');
check('genotype → genotype fn',                  pickDosageColorFn('genotype')(1) === 'rgb( 56,107,196)');
check('default → divergent',                     pickDosageColorFn()(2, 0, 2) === 'rgb(178,24,43)');

// =====================================================================
group('renderer.buildGroupColorMap');

const gcm = buildGroupColorMap(['HOMO_1', 'HET', 'HOMO_2']);
check('group colors: HOMO_1 set',                typeof gcm.get('HOMO_1') === 'string');
check('group colors: HET set',                   typeof gcm.get('HET') === 'string');
check('group colors: HOMO_1 ≠ HET',              gcm.get('HOMO_1') !== gcm.get('HET'));
const gcmOver = buildGroupColorMap(['HOMO_1', 'HET'], { HET: '#aabbcc' });
check('group colors: overrides applied',         gcmOver.get('HET') === '#aabbcc');

// =====================================================================
group('renderer.deriveSampleOrder');

const natural = deriveSampleOrder('natural', 5);
check('natural: identity',                       Array.from(natural).join(',') === '0,1,2,3,4');
const grp = ['HET', 'HOMO_1', 'HET', 'HOMO_2', 'HOMO_1'];
const byGroup = deriveSampleOrder('by_group', 5, { sample_group: grp });
check('by_group: HET first (alpha)',
      grp[byGroup[0]] === 'HET' && grp[byGroup[1]] === 'HET');
check('by_group: HOMO_2 last',
      grp[byGroup[4]] === 'HOMO_2');
const k6 = new Int32Array([2, 0, 1, 2, 0]);
const byK6 = deriveSampleOrder('by_k6', 5, { sample_k6: k6 });
check('by_k6: k=0 first',
      k6[byK6[0]] === 0 && k6[byK6[1]] === 0);
const fallback = deriveSampleOrder('unknown_mode', 5);
check('unknown mode → natural',
      Array.from(fallback).join(',') === '0,1,2,3,4');

// =====================================================================
group('renderer.deriveMarkerOrder');

const pol = [false, true, false, true, false];
const byPol = deriveMarkerOrder('by_polarity', 5, { marker_polarity: pol });
check('by_polarity: unflipped first',
      pol[byPol[0]] === false && pol[byPol[1]] === false && pol[byPol[2]] === false);
check('by_polarity: flipped last',
      pol[byPol[3]] === true && pol[byPol[4]] === true);
check('natural marker order: identity',
      Array.from(deriveMarkerOrder('natural', 5)).join(',') === '0,1,2,3,4');

// =====================================================================
group('renderer.paintDosageHeatmap');

class FakeContext {
  constructor() {
    this.calls = [];
    this.texts = [];
    this.fillStyle = ''; this.strokeStyle = ''; this.lineWidth = 0; this.font = '';
  }
  clearRect() { this.calls.push('clearRect'); }
  beginPath() {}
  moveTo()   {}
  lineTo()   {}
  stroke()   { this.calls.push('stroke'); }
  fillRect() { this.calls.push('fillRect'); }
  strokeRect() { this.calls.push('strokeRect'); }
  arc()      {}
  fill()     { this.calls.push('fill'); }
  fillText(t) { this.calls.push('fillText'); this.texts.push(String(t)); }
}
class FakeCanvas {
  constructor(w, h) { this.width = w || 600; this.height = h || 400; this._ctx = new FakeContext(); }
  getContext() { return this._ctx; }
}

// Build a 5-sample × 4-marker canonical fixture.
const nS = 5, nM = 4;
const rows = [
  Float64Array.from([0,   0.2, 1.0, 1.0, 2.0]),
  Float64Array.from([0.1, 0.3, 1.2, 1.1, 1.9]),
  Float64Array.from([1.8, 1.7, 1.0, 1.0, 0.1]),
  Float64Array.from([1.9, 1.9, 0.8, 0.9, 0.0]),
];
const data = {
  n_samples: nS,
  n_markers: nM,
  cellValue: (m, s) => rows[m][s],
  sample_group:    ['HOMO_1', 'HOMO_1', 'HET', 'HOMO_2', 'HOMO_2'],
  sample_k6:       new Int32Array([0, 0, 1, 2, 2]),
  marker_polarity: [false, false, true, false],
  sample_labels:   ['s0','s1','s2','s3','s4'],
  marker_labels:   ['m0','m1','m2','m3'],
};

const hc = new FakeCanvas(600, 400);
const res = paintDosageHeatmap(hc, data, {});
check('paint: layout returned',                  res.layout !== null);
check('paint: cellW/cellH positive',
      res.layout.cellW > 0 && res.layout.cellH > 0);
check('paint: n_displayed_samples = 5',
      res.layout.n_displayed_samples === 5);
check('paint: n_displayed_markers = 4',
      res.layout.n_displayed_markers === 4);
check('paint: clearRect called',                 hc._ctx.calls.includes('clearRect'));
check('paint: 5×4 = 20 cells + tracks',
      hc._ctx.calls.filter(c => c === 'fillRect').length
        === (5 * 4)      // matrix cells
         + 5             // left group track (one per sample)
         + 4);           // top polarity stripe
check('paint: strokeRect for matrix outline',    hc._ctx.calls.includes('strokeRect'));

// Without tracks: fewer fillRect.
const hcNoTracks = new FakeCanvas();
paintDosageHeatmap(hcNoTracks, data, {
  show_group_track: false,
  show_polarity_track: false,
});
check('paint without tracks: 20 fillRect',
      hcNoTracks._ctx.calls.filter(c => c === 'fillRect').length === 20);

// k6 track on adds another stripe.
const hcK6 = new FakeCanvas();
paintDosageHeatmap(hcK6, data, { show_k6_track: true });
check('paint with k6 track: 20 + 5 + 5 + 4 fillRect',
      hcK6._ctx.calls.filter(c => c === 'fillRect').length === 20 + 5 + 5 + 4);

// Hover crosshair adds 2 strokeRect calls.
const hcHov = new FakeCanvas();
paintDosageHeatmap(hcHov, data, { hovered_cell: { row: 2, col: 1 } });
check('paint with hover: extra strokeRect calls',
      hcHov._ctx.calls.filter(c => c === 'strokeRect').length
      > hc._ctx.calls.filter(c => c === 'strokeRect').length);

// Null safety.
check('null canvas → null layout',
      paintDosageHeatmap(null, data, {}).layout === null);
check('null data → null layout',
      paintDosageHeatmap(new FakeCanvas(), null, {}).layout === null);
check('data without cellValue → null layout',
      paintDosageHeatmap(new FakeCanvas(),
        { n_samples: 5, n_markers: 4 }, {}).layout === null);

// =====================================================================
group('renderer.findCellAtPixel');

const layout = res.layout;
const center = (row, col) => ({
  x: layout.matX + (col + 0.5) * layout.cellW,
  y: layout.matY + (row + 0.5) * layout.cellH,
});
const c00 = center(0, 0);
const hit00 = findCellAtPixel(layout, data.cellValue, c00.x, c00.y);
check('hit at row=0 col=0',
      hit00 && hit00.row === 0 && hit00.col === 0
            && hit00.marker_idx === 0 && hit00.sample_idx === 0);
const c21 = center(2, 1);
const hit21 = findCellAtPixel(layout, data.cellValue, c21.x, c21.y);
// Default natural order: marker_order[col=1]=1, sample_order[row=2]=2
// → rows[1][2] = 1.2
check('hit at row=2 col=1: dosage = 1.2',
      hit21 && Math.abs(hit21.dosage - 1.2) < 1e-9);
check('hit returns canonical (marker_idx, sample_idx)',
      hit21.marker_idx === 1 && hit21.sample_idx === 2);
check('miss outside matrix',
      findCellAtPixel(layout, data.cellValue, 0, 0) === null);
check('null layout → null',
      findCellAtPixel(null, data.cellValue, 100, 100) === null);

// =====================================================================
group('adapters.adaptMglHeatmapJson');

const mglResult = {
  candidate_id: 'cand_x',
  n_samples: 3, samples: ['sA', 'sB', 'sC'],
  n_markers: 2,
  markers: [
    { marker: 'rs1', dosage_centered: Float64Array.from([-0.5, 0.0, 0.5]),
      dosage: Float64Array.from([0.5, 1.0, 1.5]), polarity_flipped: false },
    { marker: 'rs2', dosage_centered: Float64Array.from([1.0, -1.0, 0.0]),
      dosage: Float64Array.from([2.0, 0.0, 1.0]), polarity_flipped: true },
  ],
  centering: { anchor: 'all', polarity_reference: 'pc1' },
};
const adaptedMgl = adaptMglHeatmapJson(mglResult);
check('mgl adapter: n_samples = 3',              adaptedMgl.n_samples === 3);
check('mgl adapter: n_markers = 2',              adaptedMgl.n_markers === 2);
check('mgl adapter: cellValue → centered by default',
      adaptedMgl.cellValue(0, 0) === -0.5);
check('mgl adapter: marker_polarity captured',
      adaptedMgl.marker_polarity[0] === false && adaptedMgl.marker_polarity[1] === true);
check('mgl adapter: sample labels propagated',
      adaptedMgl.sample_labels.join(',') === 'sA,sB,sC');
check('mgl adapter: marker labels propagated',
      adaptedMgl.marker_labels.join(',') === 'rs1,rs2');
check('mgl adapter: _source tag',
      adaptedMgl._source === 'mgl_heatmap_json');

const adaptedRaw = adaptMglHeatmapJson(mglResult, { use_centered: false });
check('mgl adapter (raw): cellValue uses dosage',
      adaptedRaw.cellValue(0, 0) === 0.5);

check('mgl adapter: null result → null',         adaptMglHeatmapJson(null) === null);
check('mgl adapter: empty markers → null',
      adaptMglHeatmapJson({ markers: [] }) === null);

// =====================================================================
group('adapters.adaptLegacyChunk');

const chunk = {
  samples: ['cga01', 'cga02', 'cga03', 'cga04'],
  markers: [
    { marker_id: 'M0001', pos_bp: 1000 },
    { marker_id: 'M0002', pos_bp: 2000 },
    { marker_id: 'M0003', pos_bp: 3000 },
    { marker_id: 'M0004', pos_bp: 4000 },
  ],
  dosage: [
    [0, 1, 2, -1],          // marker 0 — NA at last sample
    [0, 0, 1, 1],
    [2, 2, 0, 1],
    [1, 1, 1, 1],
  ],
};
const adaptedLegacy = adaptLegacyChunk(chunk, {
  selected_marker_indices: [1, 2],
  sample_group: ['HET', 'HET', 'HOMO_1', 'HOMO_1'],
  marker_polarity: [false, true],
});
check('legacy adapter: n_samples = 4',           adaptedLegacy.n_samples === 4);
check('legacy adapter: n_markers (selection) = 2',
      adaptedLegacy.n_markers === 2);
check('legacy adapter: cellValue maps through selection',
      adaptedLegacy.cellValue(0, 0) === 0  // chunk.dosage[1][0]
   && adaptedLegacy.cellValue(0, 2) === 1  // chunk.dosage[1][2]
);
check('legacy adapter: polarity flip applies (2 - v)',
      adaptedLegacy.cellValue(1, 0) === 0  // chunk.dosage[2][0] = 2 → 2-2 = 0
   && adaptedLegacy.cellValue(1, 2) === 2  // chunk.dosage[2][2] = 0 → 2-0 = 2
);
check('legacy adapter: -1 sentinel → null',
      adaptLegacyChunk(chunk).cellValue(0, 3) === null);
check('legacy adapter: marker labels from selection',
      adaptedLegacy.marker_labels.join(',') === 'M0002,M0003');
check('legacy adapter: sample labels propagated',
      adaptedLegacy.sample_labels.join(',') === 'cga01,cga02,cga03,cga04');
check('legacy adapter: _source tag',
      adaptedLegacy._source === 'legacy_chunk');

// Polarity as a function.
const polFn = (col) => col === 0;
const adaptedFn = adaptLegacyChunk(chunk, {
  selected_marker_indices: [0, 1],
  marker_polarity: polFn,
});
check('legacy adapter: function polarity captured',
      adaptedFn.marker_polarity[0] === true && adaptedFn.marker_polarity[1] === false);

check('legacy adapter: null chunk → null',       adaptLegacyChunk(null) === null);
check('legacy adapter: chunk missing dosage → null',
      adaptLegacyChunk({ samples: [], markers: [] }) === null);

// =====================================================================
group('selection.createDosageHeatmapSelection');

const sel = createDosageHeatmapSelection();
let nNotify = 0;
sel.subscribe(() => { nNotify++; });

check('initial: hovered = null',                 sel.getHoveredCell() === null);
check('initial: no selected samples',            sel.getSelectedSamples().size === 0);
check('initial: no selected markers',            sel.getSelectedMarkers().size === 0);

sel.setHoveredCell({ row: 1, col: 2, marker_idx: 5, sample_idx: 9, dosage: 0.75 });
check('setHoveredCell notifies',                 nNotify === 1);
check('hovered cell read back',
      sel.getHoveredCell() && sel.getHoveredCell().marker_idx === 5
                           && sel.getHoveredCell().sample_idx === 9
                           && sel.getHoveredCell().dosage === 0.75);
sel.setHoveredCell({ row: 1, col: 2, marker_idx: 5, sample_idx: 9, dosage: 0.75 });
check('repeat hover same cell: no-op',           nNotify === 1);
sel.setHoveredCell({ row: 0, col: 0, marker_idx: 0, sample_idx: 0, dosage: 1.0 });
check('hover different cell notifies',           nNotify === 2);
sel.setHoveredCell(null);
check('clear hover notifies',                    nNotify === 3 && sel.getHoveredCell() === null);

sel.toggleSelectedSample(0);
sel.toggleSelectedSample(2);
check('two samples selected',                    sel.getSelectedSamples().size === 2);
sel.toggleSelectedSample(0);
check('toggle removes sample',                   !sel.getSelectedSamples().has(0));

sel.toggleSelectedMarker(1);
sel.toggleSelectedMarker(3);
check('two markers selected',                    sel.getSelectedMarkers().size === 2);
sel.toggleSelectedMarker(1);
check('toggle removes marker',                   !sel.getSelectedMarkers().has(1));

sel.clearSelection();
check('clearSelection empties both sets',
      sel.getSelectedSamples().size === 0 && sel.getSelectedMarkers().size === 0);

sel.toggleSelectedSample(null);
check('toggleSelectedSample(null) no-op',        sel.getSelectedSamples().size === 0);

const unsub = sel.subscribe(() => { nNotify += 100; });
sel.setHoveredCell({ row: 5, col: 5, marker_idx: 1, sample_idx: 1, dosage: 0.5 });
check('multi-subscriber notifies all',           nNotify > 100);
unsub();
const before = nNotify;
sel.setHoveredCell(null);
check('unsubscribed not called',                 nNotify - before < 100);

// =====================================================================
group('selection.summariseHoverCell');

const sum = summariseHoverCell(
  { row: 0, col: 0, marker_idx: 1, sample_idx: 2, dosage: 1.234 },
  data,
);
check('summary contains sample label',           sum.indexOf('s2') >= 0);
check('summary contains marker label',           sum.indexOf('m1') >= 0);
check('summary contains dosage value',           sum.indexOf('1.234') >= 0);
check('summary contains group label',            sum.indexOf('HET') >= 0);
// marker 1 polarity = false → no 'flipped' suffix
check('summary omits flipped for unflipped marker',
      sum.indexOf('flipped') < 0);

const sumFlipped = summariseHoverCell(
  { row: 0, col: 0, marker_idx: 2, sample_idx: 2, dosage: 0.5 },
  data,
);
check('summary includes flipped for flipped marker',
      sumFlipped.indexOf('flipped') >= 0);

const sumNa = summariseHoverCell(
  { row: 0, col: 0, marker_idx: 0, sample_idx: 0, dosage: null },
  data,
);
check('summary handles NA dosage',               sumNa.indexOf('dosage=NA') >= 0);

check('summary null hover → "—"',                summariseHoverCell(null, data) === '—');

// =====================================================================
group('selection.groupSizesFromSampleGroup');

const sizes = groupSizesFromSampleGroup(data.sample_group);
check('group sizes: 3 entries',                  sizes.length === 3);
check('group sizes: HOMO_1 = 2',
      sizes.find(([g]) => g === 'HOMO_1')[1] === 2);
check('group sizes: HET = 1',
      sizes.find(([g]) => g === 'HET')[1] === 1);
check('group sizes: HOMO_2 = 2',
      sizes.find(([g]) => g === 'HOMO_2')[1] === 2);
check('group sizes sorted desc',
      sizes[0][1] >= sizes[sizes.length - 1][1]);
check('group sizes: null → []',                  groupSizesFromSampleGroup(null).length === 0);

// =====================================================================
group('sample_means — per-sample left-track derivations');

const {
  computeSampleHetDosageMean,
  computeSampleThetaPiMean,
  computeSampleGhslMean,
} = await import('../atlases/inversion/pages/discovery/dosage_heatmap/sample_means.js');

const canonForMeans = {
  n_samples: 3, n_markers: 4,
  // sample 0: 0,1,1,1 → 3/4 het; sample 1: 0,0,2,2 → 0/4 het;
  // sample 2: 1,1,1,1 → 4/4 het
  cellValue: (m, s) => {
    const table = [
      [0, 1, 1, 1],
      [0, 0, 2, 2],
      [1, 1, 1, 1],
    ];
    return table[s][m];
  },
  sample_labels: ['s0', 's1', 's2'],
};

const het = computeSampleHetDosageMean(canonForMeans);
check('het-dosage mean: returns Float32Array',   het instanceof Float32Array);
check('het-dosage mean: s0 = 0.75',              Math.abs(het[0] - 0.75) < 1e-6);
check('het-dosage mean: s1 = 0',                 het[1] === 0);
check('het-dosage mean: s2 = 1',                 het[2] === 1);
check('het-dosage mean: null on missing data',   computeSampleHetDosageMean(null) === null);

const tpData = {
  theta_pi_per_window: {
    samples: ['s0', 's1', 's2'],
    windows: [0, 1, 2, 3],
    // flat Float32Array, row-major by sample: s0 = [1,2,3,4] mean 2.5;
    // s1 has one NaN → mean of finite; s2 = [10,10,10,10] mean 10
    values: Float32Array.from([
      1, 2, 3, 4,
      0, NaN, 6, 6,
      10, 10, 10, 10,
    ]),
  },
};
const tp = computeSampleThetaPiMean(tpData);
check('θπ mean: returns Float32Array',           tp instanceof Float32Array);
check('θπ mean: s0 = 2.5',                       Math.abs(tp[0] - 2.5) < 1e-6);
check('θπ mean: s1 ignores NaN',                 Math.abs(tp[1] - 4) < 1e-6);
check('θπ mean: s2 = 10',                        tp[2] === 10);
check('θπ mean: null when panel missing',        computeSampleThetaPiMean({}) === null);

const ghslData = {
  ghsl_panel: {
    samples: ['s0', 's1', 's2'],
    scales: ['s25k'],
    primary_scale: 's25k',
    div_roll: {
      // jagged Array<Float32Array>[sample][window]
      's25k': [
        Float32Array.from([0.2, 0.4, 0.6]),     // mean 0.4
        Float32Array.from([NaN, 0.5, 0.5]),     // mean 0.5
        Float32Array.from([1.0, 1.0, 1.0]),     // mean 1.0
      ],
    },
  },
};
const gh = computeSampleGhslMean(ghslData, canonForMeans);
check('GHSL mean: returns Float32Array',         gh instanceof Float32Array);
check('GHSL mean: s0 = 0.4',                     Math.abs(gh[0] - 0.4) < 1e-6);
check('GHSL mean: s1 ignores NaN',               Math.abs(gh[1] - 0.5) < 1e-6);
check('GHSL mean: s2 = 1.0',                     Math.abs(gh[2] - 1.0) < 1e-6);
check('GHSL mean: null when panel missing',      computeSampleGhslMean({}) === null);

// =====================================================================
group('renderer.confidenceColor + confidence track');

check('confidenceColor returns rgb',             /^rgb\(/.test(confidenceColor(0.5, 0, 1)));
check('confidenceColor NaN → muted slate',       confidenceColor(NaN) === 'rgb(50,55,65)');
check('confidenceColor low ≠ high',              confidenceColor(0.05, 0, 1) !== confidenceColor(0.95, 0, 1));

// Paint with a confidence track present → one extra fillRect per sample.
const hcConf = new FakeCanvas(600, 400);
const dataConf = Object.assign({}, data, {
  sample_confidence: Float64Array.from([0.9, 0.8, 0.4, 0.85, 0.95]),
});
paintDosageHeatmap(hcConf, dataConf, {
  show_group_track: false, show_polarity_track: false, show_confidence_track: true,
});
check('confidence track adds n_samples fillRects',
      hcConf._ctx.calls.filter(c => c === 'fillRect').length === (5 * 4) + 5);

// Track is auto-skipped when the backing array is absent.
const hcNoConf = new FakeCanvas(600, 400);
paintDosageHeatmap(hcNoConf, data, {
  show_group_track: false, show_polarity_track: false, show_confidence_track: true,
});
check('confidence track auto-hidden without data',
      hcNoConf._ctx.calls.filter(c => c === 'fillRect').length === (5 * 4));

// =====================================================================
group('renderer.regime_spans overlay (catalogue)');

const hcSpans = new FakeCanvas(600, 400);
const dataSpans = Object.assign({}, data, {
  marker_pos_bp: Float64Array.from([1.0e6, 1.1e6, 1.2e6, 1.3e6]),
  regime_spans: [
    { label: 'R1', lo: 0, hi: 3, regime_class: 'stable_three_band_regime', confidence: 0.8 },
    { label: 'R2', lo: 1, hi: 2, regime_class: 'stable_two_band_regime', confidence: 0.6 },
  ],
});
const beforeStroke = 0;
paintDosageHeatmap(hcSpans, dataSpans, { show_group_track: false, show_polarity_track: false });
check('regime spans draw band fills + outlines', (() => {
  // 5×4 = 20 matrix cells + 2 span fills = 22 fillRects; ≥ 3 strokeRects (2 outlines + matrix).
  const fills = hcSpans._ctx.calls.filter(c => c === 'fillRect').length;
  const strokes = hcSpans._ctx.calls.filter(c => c === 'strokeRect').length;
  return fills === (5 * 4) + 2 && strokes >= 3;
})());
check('regime spans auto-hidden without data', (() => {
  const hc2 = new FakeCanvas(600, 400);
  paintDosageHeatmap(hc2, data, { show_group_track: false, show_polarity_track: false });
  return hc2._ctx.calls.filter(c => c === 'fillRect').length === (5 * 4);
})());
check('show_regime_spans:false suppresses overlay', (() => {
  const hc3 = new FakeCanvas(600, 400);
  paintDosageHeatmap(hc3, dataSpans, {
    show_group_track: false, show_polarity_track: false, show_regime_spans: false,
  });
  return hc3._ctx.calls.filter(c => c === 'fillRect').length === (5 * 4);
})());

// =====================================================================
group('renderer.group rects overlay + index_aware order');

const dataGr = Object.assign({}, data, {
  sample_group: ['hap 0 (homA)', 'hap 0 (homA)', 'hap 1 (homB)', 'hap 1 (homB)', 'hap 1 (homB)'],
});
check('show_group_rects draws one outline per group', (() => {
  const hc = new FakeCanvas(600, 400);
  paintDosageHeatmap(hc, dataGr, {
    show_group_track: false, show_polarity_track: false,
    sample_order: Int32Array.from([0, 1, 2, 3, 4]),   // already grouped
    show_group_rects: true,
  });
  const base = new FakeCanvas(600, 400);
  paintDosageHeatmap(base, dataGr, {
    show_group_track: false, show_polarity_track: false,
    sample_order: Int32Array.from([0, 1, 2, 3, 4]), show_group_rects: false,
  });
  const extra = hc._ctx.calls.filter(c => c === 'strokeRect').length
              - base._ctx.calls.filter(c => c === 'strokeRect').length;
  return extra === 2;   // two distinct groups → two boxes
})());
check('group rects off by default', (() => {
  const hc = new FakeCanvas(600, 400);
  paintDosageHeatmap(hc, dataGr, { show_group_track: false, show_polarity_track: false });
  const base = new FakeCanvas(600, 400);
  paintDosageHeatmap(base, dataGr, {
    show_group_track: false, show_polarity_track: false, show_group_rects: true,
  });
  return hc._ctx.calls.filter(c => c === 'strokeRect').length
       < base._ctx.calls.filter(c => c === 'strokeRect').length;
})());
check('deriveSampleOrder index_aware uses precomputed order', (() => {
  const src = { index_aware_order: Int32Array.from([4, 3, 2, 1, 0]) };
  const ord = deriveSampleOrder('index_aware', 5, src);
  return ord.length === 5 && ord[0] === 4 && ord[4] === 0;
})());
check('index_aware falls back to natural without an order', (() => {
  const ord = deriveSampleOrder('index_aware', 5, { sample_group: ['a', 'a', 'b', 'b', 'b'] });
  return ord[0] === 0 && ord[4] === 4;
})());

// =====================================================================
group('renderer.collapse size histogram (right gutter)');

const dataCol = Object.assign({}, data, {
  collapse_rows: {
    row_group:          Int32Array.from([0, 0, 1]),
    row_group_size:     Int32Array.from([5, 5, 2]),
    row_is_group_start: Uint8Array.from([1, 0, 1]),
    row_is_medoid:      Uint8Array.from([1, 0, 1]),
  },
});
check('collapse histogram draws ×N labels per group', (() => {
  const hc = new FakeCanvas(600, 400);
  paintDosageHeatmap(hc, dataCol, {
    show_group_track: false, show_polarity_track: false,
    sample_order: Int32Array.from([0, 1, 2]),
    show_collapse: true,
  });
  const texts = hc._ctx.texts ? hc._ctx.texts.filter(t => /^×\d/.test(t)) : [];
  return texts.includes('×5') && texts.includes('×2');
})());
check('collapse histogram only when show_collapse + aligned rows', (() => {
  const hc = new FakeCanvas(600, 400);
  paintDosageHeatmap(hc, dataCol, {
    show_group_track: false, show_polarity_track: false,
    sample_order: Int32Array.from([0, 1, 2]),
    show_collapse: false,
  });
  const texts = hc._ctx.texts ? hc._ctx.texts.filter(t => /^×\d/.test(t)) : [];
  return texts.length === 0;
})());
check('mismatched collapse_rows length is ignored (no throw)', (() => {
  const hc = new FakeCanvas(600, 400);
  const bad = Object.assign({}, data, { collapse_rows: { row_group_size: Int32Array.from([5]) } });
  paintDosageHeatmap(hc, bad, {
    show_group_track: false, show_polarity_track: false,
    sample_order: Int32Array.from([0, 1, 2, 3, 4]), show_collapse: true,
  });
  return true;   // reaching here = no exception
})());

// =====================================================================
group('findRegimeSpanAtPixel (click-to-focus)');

const hcHit = new FakeCanvas(600, 400);
const paintHit = paintDosageHeatmap(hcHit, dataSpans, {
  show_group_track: false, show_polarity_track: false,
});
const L = paintHit.layout;
check('layout exposes matX/matY/cellW/marker_order', !!L
  && Number.isFinite(L.matX) && Number.isFinite(L.cellW) && !!L.marker_order);
// Click in the label header strip over the LAST marker column → R1 (lo0..hi3)
// covers it; R2 (lo1..hi2) does not at the rightmost column.
const xLast = L.matX + (L.n_displayed_markers - 0.5) * L.cellW;
const yHdr  = L.matY + 3;
check('header click over last column hits R1 only', (() => {
  const s = findRegimeSpanAtPixel(L, dataSpans.regime_spans, xLast, yHdr);
  return s && s.label === 'R1';
})());
check('overlapping bands → topmost (R2) wins in shared column', (() => {
  const xMid = L.matX + 1.5 * L.cellW;   // column 1, inside both R1 and R2
  const s = findRegimeSpanAtPixel(L, dataSpans.regime_spans, xMid, yHdr);
  return s && s.label === 'R2';
})());
check('click below the header strip → no hit', (() => {
  const s = findRegimeSpanAtPixel(L, dataSpans.regime_spans, xLast, L.matY + 60);
  return s === null;
})());
check('empty spans → null', findRegimeSpanAtPixel(L, [], xLast, yHdr) === null);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
