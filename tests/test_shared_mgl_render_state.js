// tests/test_shared_mgl_render_state.js
//
// Unit coverage for shared/mgl_render_state.js — the coordinated
// rendering state for the SPEC_0 §10 dual-panel view.

import {
  MGL_COLOR_MODES,
  MGL_SAMPLE_ORDERS,
  MGL_MARKER_ORDERS,
  createMglRenderState,
  updateMglRenderState,
  subscribeMglRenderState,
  deriveSampleOrder,
  deriveSampleColors,
  deriveMarkerOrder,
  toggleSampleSelected,
  clearSampleSelection,
  toggleMarkerSelected,
  setHover,
} from '../atlases/inversion/shared/mgl_render_state.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab');

check('6 color modes',                MGL_COLOR_MODES.length === 6);
check('cluster in color modes',       MGL_COLOR_MODES.includes('cluster'));
check('5 sample orders',              MGL_SAMPLE_ORDERS.length === 5);
check('pc1_anchor in sample orders',  MGL_SAMPLE_ORDERS.includes('pc1_anchor'));
check('5 marker orders',              MGL_MARKER_ORDERS.length === 5);

// =====================================================================
group('createMglRenderState');

const s = createMglRenderState();
check('defaults: view_name = all_pairs', s.view_name === 'all_pairs');
check('defaults: weighting = weighted',  s.weighting === 'weighted');
check('defaults: anchor_mode = bi_baseline', s.anchor_mode === 'bi_baseline');
check('defaults: centering_anchor = all',    s.centering_anchor === 'all');
check('defaults: sample_color_mode = cluster', s.sample_color_mode === 'cluster');
check('defaults: selected_samples is Set',  s.selected_samples instanceof Set);
check('defaults: selected_markers is Set',  s.selected_markers instanceof Set);
check('defaults: empty selection',
      s.selected_samples.size === 0 && s.selected_markers.size === 0);

const s2 = createMglRenderState({ view_name: 'tri_extras', weighting: 'unweighted' });
check('overrides: view_name = tri_extras',  s2.view_name === 'tri_extras');
check('overrides: weighting = unweighted',  s2.weighting === 'unweighted');

// =====================================================================
group('updateMglRenderState + subscribeMglRenderState');

const s3 = createMglRenderState();
let lastChange = null, callCount = 0;
const unsub = subscribeMglRenderState(s3, (state, keys) => {
  lastChange = keys;
  callCount++;
});
updateMglRenderState(s3, { view_name: 'all_pairs' });   // no change
check('no-op update: no subscriber call',  callCount === 0);
updateMglRenderState(s3, { view_name: 'tri_extras' });
check('change: subscriber called',         callCount === 1);
check('change: keys list correct',         JSON.stringify(lastChange) === '["view_name"]');
check('state mutated',                     s3.view_name === 'tri_extras');

// Multiple keys at once
updateMglRenderState(s3, { weighting: 'unweighted', centering_anchor: 'het' });
check('multi-key change: 1 call',          callCount === 2);
check('multi-key change: keys reported',
      lastChange.length === 2
   && lastChange.includes('weighting')
   && lastChange.includes('centering_anchor'));

// Unsubscribe stops notifications
unsub();
updateMglRenderState(s3, { view_name: 'bi_baseline' });
check('unsubscribe stops calls',           callCount === 2);

// Subscriber error doesn't throw
const s4 = createMglRenderState();
subscribeMglRenderState(s4, () => { throw new Error('boom'); });
let threw = false;
try { updateMglRenderState(s4, { view_name: 'bi_baseline' }); }
catch (_) { threw = true; }
check('subscriber error swallowed',        !threw);

// =====================================================================
group('deriveSampleOrder');

// Fixture PCA result: 4 samples, 1 window.
const pca_result = {
  n_samples: 4,
  windows: [{
    idx: 0,
    pc1: [0.5, -0.3, 0.1, -0.8],
    pc2: [0.2, 0.1, -0.4, 0.3],
  }],
};

// pc1_anchor / pc1_view: ascending by PC1 → -0.8, -0.3, 0.1, 0.5 → idx 3,1,2,0
const sOrd = createMglRenderState();
sOrd.sample_order_mode = 'pc1_anchor';
const order_pc1 = deriveSampleOrder(sOrd, { pca_result });
check('pc1_anchor: 4 entries',             order_pc1.length === 4);
check('pc1_anchor: ascending order',
      order_pc1[0] === 3 && order_pc1[1] === 1
   && order_pc1[2] === 2 && order_pc1[3] === 0);

// pc1_view falls back to same when no anchor_pca_result supplied
sOrd.sample_order_mode = 'pc1_view';
const order_view = deriveSampleOrder(sOrd, { pca_result });
check('pc1_view: matches when no anchor result',
      order_view[0] === 3 && order_view[3] === 0);

// cluster: groups by label
sOrd.sample_order_mode = 'cluster';
const order_cl = deriveSampleOrder(sOrd, {
  pca_result, cluster_labels: ['B', 'A', 'A', 'B'],
});
// 'A' samples first (idx 1, 2), then 'B' (idx 0, 3)
check('cluster: groups labels together',
      order_cl[0] === 1 && order_cl[1] === 2
   && order_cl[2] === 0 && order_cl[3] === 3);

// mean_dosage: ascending
sOrd.sample_order_mode = 'mean_dosage';
const order_md = deriveSampleOrder(sOrd, {
  pca_result, mean_dosage_per_sample: [1.0, 0.2, 0.8, 0.4],
});
// asc: 0.2 (idx 1), 0.4 (idx 3), 0.8 (idx 2), 1.0 (idx 0)
check('mean_dosage: ascending order',
      order_md[0] === 1 && order_md[3] === 0);

// manual: returns the explicit order
sOrd.sample_order_mode = 'manual';
sOrd.sample_order = new Int32Array([2, 0, 1, 3]);
const order_man = deriveSampleOrder(sOrd, { pca_result });
check('manual: returns user order',        order_man[0] === 2 && order_man[3] === 3);

// =====================================================================
group('deriveSampleColors');

const sCol = createMglRenderState();
sCol.sample_color_mode = 'cluster';
const colors_cl = deriveSampleColors(sCol, {
  pca_result, cluster_labels: ['A', 'A', 'B', 'B'],
});
check('cluster colors: 4 entries',         colors_cl.length === 4);
check('cluster colors: A samples match',   colors_cl[0] === colors_cl[1]);
check('cluster colors: B samples match',   colors_cl[2] === colors_cl[3]);
check('cluster colors: A != B',            colors_cl[0] !== colors_cl[2]);

// Continuous mode: pc1_score
sCol.sample_color_mode = 'pc1_score';
const colors_pc1 = deriveSampleColors(sCol, { pca_result });
check('pc1_score colors: 4 entries',       colors_pc1.length === 4);
check('pc1_score colors: rgb format',      colors_pc1.every(c => c.startsWith('rgb')));

// mean_dosage_window
sCol.sample_color_mode = 'mean_dosage_window';
const colors_md = deriveSampleColors(sCol, {
  pca_result, mean_dosage_per_sample: [0, 0.5, 1, 0.25],
});
check('mean_dosage colors: 4 entries',     colors_md.length === 4);
check('mean_dosage colors: highest and lowest distinct',
      colors_md[0] !== colors_md[2]);

// External annotation
sCol.sample_color_mode = 'external_annotation';
const colors_ext = deriveSampleColors(sCol, {
  pca_result, external_annotations: ['ecotype1', 'ecotype2', null, 'ecotype1'],
});
check('external annotation: 4 entries',    colors_ext.length === 4);
check('external annotation: null → grey',  colors_ext[2].includes('140') || colors_ext[2].includes('grey'));
check('external annotation: same label same color',
      colors_ext[0] === colors_ext[3]);

// =====================================================================
group('deriveMarkerOrder — placeholder (delegate to heatmap module)');

const heatmap_result = { n_markers: 5, markers: [
  { marker: 'M0', pos: 100 },
  { marker: 'M1', pos: 200 },
  { marker: 'M2', pos: 300 },
  { marker: 'M3', pos: 400 },
  { marker: 'M4', pos: 500 },
]};
const sMk = createMglRenderState();
const order_mk = deriveMarkerOrder(sMk, heatmap_result);
check('marker order: 5 indices returned',  order_mk.length === 5);
check('marker order: default identity',
      order_mk[0] === 0 && order_mk[4] === 4);

// Manual order
sMk.marker_order_mode = 'manual';
const order_manual = deriveMarkerOrder(sMk, heatmap_result, { manual_order: [4, 3, 2, 1, 0] });
check('marker manual order respected',
      order_manual[0] === 4 && order_manual[4] === 0);

// =====================================================================
group('toggleSampleSelected + clearSampleSelection');

const sSel = createMglRenderState();
let lastSelKeys = null;
subscribeMglRenderState(sSel, (st, keys) => { lastSelKeys = keys; });

toggleSampleSelected(sSel, 5);
check('toggle: 5 added',                   sSel.selected_samples.has(5));
check('toggle: notification fired',        lastSelKeys && lastSelKeys.includes('selected_samples'));

toggleSampleSelected(sSel, 5);
check('toggle again: removed',             !sSel.selected_samples.has(5));

toggleSampleSelected(sSel, 7);
toggleSampleSelected(sSel, 9);
check('two added',                         sSel.selected_samples.size === 2);

clearSampleSelection(sSel);
check('clear: emptied',                    sSel.selected_samples.size === 0);

// clear no-op when already empty (no notify)
let callsBefore = 0;
let calls = 0;
subscribeMglRenderState(sSel, () => { calls++; });
clearSampleSelection(sSel);
check('clear on empty: no-op (no notify)', calls === 0);

// =====================================================================
group('toggleMarkerSelected');

const sMs = createMglRenderState();
toggleMarkerSelected(sMs, 3);
toggleMarkerSelected(sMs, 7);
check('markers added',                     sMs.selected_markers.size === 2);
toggleMarkerSelected(sMs, 3);
check('marker removed',                    !sMs.selected_markers.has(3));

// =====================================================================
group('setHover');

const sHov = createMglRenderState();
let hovKeys = null;
subscribeMglRenderState(sHov, (st, keys) => { hovKeys = keys; });

setHover(sHov, 12, 7);
check('hover_sample set',                  sHov.hover_sample === 12);
check('hover_marker set',                  sHov.hover_marker === 7);
check('both keys reported',
      hovKeys && hovKeys.includes('hover_sample') && hovKeys.includes('hover_marker'));

setHover(sHov, null);   // only clear sample
check('hover_sample cleared',              sHov.hover_sample === null);
check('hover_marker unchanged',            sHov.hover_marker === 7);

setHover(sHov, undefined, null);
check('hover_marker cleared via undefined+null', sHov.hover_marker === null);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
