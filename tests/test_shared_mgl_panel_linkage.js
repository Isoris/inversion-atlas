// tests/test_shared_mgl_panel_linkage.js
//
// Coverage for shared/mgl_panel_linkage — cross-panel sample-hover
// + sample-selection bridging through the mglCandidateMode slot's
// shared mgl_render_state.

import {
  bindSamplePanelToSlot,
  bindSimilarityPanelToSlot,
  bindDosageHeatmapPanelToSlot,
  bindTreePanelToSlot,
  bindAllPanelsToCandidateMode,
} from '../atlases/inversion/shared/mgl_panel_linkage.js';
import { createTreePanelSelection } from
  '../atlases/inversion/pages/discovery/tree_panel/selection.js';
import {
  createMglCandidateModeSlot,
} from '../atlases/inversion/shared/mgl_candidate_mode.js';
import {
  setHover,
  updateMglRenderState,
} from '../atlases/inversion/shared/mgl_render_state.js';
import { createPcaPanelSelection } from
  '../atlases/inversion/pages/discovery/pca_scatter_per_window/selection.js';
import { createSimilarityPanelSelection } from
  '../atlases/inversion/pages/discovery/similarity_matrix/selection.js';
import { createDosageHeatmapSelection } from
  '../atlases/inversion/pages/discovery/dosage_heatmap/selection.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('module exports');
check('bindSamplePanelToSlot exported',          typeof bindSamplePanelToSlot === 'function');
check('bindSimilarityPanelToSlot exported',      typeof bindSimilarityPanelToSlot === 'function');
check('bindDosageHeatmapPanelToSlot exported',   typeof bindDosageHeatmapPanelToSlot === 'function');
check('bindTreePanelToSlot exported',            typeof bindTreePanelToSlot === 'function');
check('bindAllPanelsToCandidateMode exported',   typeof bindAllPanelsToCandidateMode === 'function');

// =====================================================================
group('bindSamplePanelToSlot — PCA panel');
{
  const slot = createMglCandidateModeSlot();
  const pcaPanel = { selection: createPcaPanelSelection() };
  const unbind = bindSamplePanelToSlot(pcaPanel, slot);

  // Panel hover → slot hover.
  pcaPanel.selection.setHoveredSample(7);
  check('panel→slot: hover_sample = 7',          slot.render_state.hover_sample === 7);
  // Slot hover → panel hover.
  setHover(slot.render_state, 3, undefined);
  check('slot→panel: panel sees 3',
        pcaPanel.selection.getHoveredSample() === 3);

  // No infinite loop — set the same value, should be idempotent.
  pcaPanel.selection.setHoveredSample(3);
  check('loop-safe: setting same hover is a no-op',
        slot.render_state.hover_sample === 3);

  // Selection: panel → slot.
  pcaPanel.selection.toggleSelectedSample(1);
  pcaPanel.selection.toggleSelectedSample(4);
  check('panel→slot: selected_samples size = 2',
        slot.render_state.selected_samples.size === 2);
  check('panel→slot: selected_samples contains 1 and 4',
        slot.render_state.selected_samples.has(1)
     && slot.render_state.selected_samples.has(4));

  // Selection: slot → panel.
  updateMglRenderState(slot.render_state,
    { selected_samples: new Set([10, 20]) });
  check('slot→panel: panel sees 10 and 20',
        pcaPanel.selection.getSelectedSamples().has(10)
     && pcaPanel.selection.getSelectedSamples().has(20));
  check('slot→panel: panel no longer has 1',
        !pcaPanel.selection.getSelectedSamples().has(1));

  // Unbind detaches both directions.
  unbind();
  pcaPanel.selection.setHoveredSample(99);
  check('after unbind: slot hover does not advance',
        slot.render_state.hover_sample === 3);
  setHover(slot.render_state, 50, undefined);
  check('after unbind: panel hover does not advance',
        pcaPanel.selection.getHoveredSample() === 99);
}

// =====================================================================
group('bindSimilarityPanelToSlot');
{
  const slot = createMglCandidateModeSlot();
  const simPanel = { selection: createSimilarityPanelSelection() };
  const unbind = bindSimilarityPanelToSlot(simPanel, slot);

  // Panel hover-cell.i → slot hover_sample.
  simPanel.selection.setHoveredCell({ i: 5, j: 9 });
  check('panel→slot: hover_sample = i (5)',
        slot.render_state.hover_sample === 5);

  // Slot hover → panel hover-cell.
  setHover(slot.render_state, 8, undefined);
  const cell = simPanel.selection.getHoveredCell();
  check('slot→panel: panel cell i = j = 8',
        cell && cell.i === 8 && cell.j === 8);

  // Selection: bidirectional.
  simPanel.selection.toggleSelectedSample(2);
  check('panel→slot: selected_samples has 2',
        slot.render_state.selected_samples.has(2));
  updateMglRenderState(slot.render_state,
    { selected_samples: new Set([11]) });
  check('slot→panel: panel sees 11',
        simPanel.selection.getSelectedSamples().has(11));

  unbind();
  setHover(slot.render_state, null, undefined);
  check('after unbind: panel hover unchanged',
        simPanel.selection.getHoveredCell() !== null);
}

// =====================================================================
group('bindDosageHeatmapPanelToSlot — selection only');
{
  const slot = createMglCandidateModeSlot();
  const hmPanel = { selection: createDosageHeatmapSelection() };
  const unbind = bindDosageHeatmapPanelToSlot(hmPanel, slot);

  // Panel hover propagates sample_idx into slot hover.
  hmPanel.selection.setHoveredCell({
    row: 1, col: 2, marker_idx: 4, sample_idx: 6, dosage: 1.2,
  });
  check('panel→slot: hover_sample = 6',
        slot.render_state.hover_sample === 6);

  // Slot hover does NOT propagate INTO heatmap (intentional MVP).
  hmPanel.selection.setHoveredCell(null);
  setHover(slot.render_state, 9, undefined);
  check('slot→panel: heatmap hover unchanged (no-op)',
        hmPanel.selection.getHoveredCell() === null);

  // Selection: bidirectional.
  hmPanel.selection.toggleSelectedSample(3);
  check('panel→slot: selected_samples has 3',
        slot.render_state.selected_samples.has(3));
  updateMglRenderState(slot.render_state,
    { selected_samples: new Set([12, 13]) });
  check('slot→panel: panel sees 12',
        hmPanel.selection.getSelectedSamples().has(12)
     && hmPanel.selection.getSelectedSamples().has(13));

  unbind();
  hmPanel.selection.setHoveredCell({
    row: 0, col: 0, marker_idx: 0, sample_idx: 99, dosage: 0,
  });
  check('after unbind: slot hover does not advance',
        slot.render_state.hover_sample !== 99);
}

// =====================================================================
group('bindTreePanelToSlot');
{
  const slot = createMglCandidateModeSlot();
  const treePanel = { selection: createTreePanelSelection() };
  const unbind = bindTreePanelToSlot(treePanel, slot);

  // Panel hover (leaf-id string) → slot hover_sample (int).
  treePanel.selection.setHovered('5');
  check('panel→slot: hover_sample = 5',
        slot.render_state.hover_sample === 5);

  // Slot hover → panel sees the leaf id as string.
  setHover(slot.render_state, 8, undefined);
  check('slot→panel: hovered leaf = "8"',
        treePanel.selection.getHovered() === '8');

  // Selection: panel → slot.
  treePanel.selection.toggleSelected('2');
  treePanel.selection.toggleSelected('4');
  check('panel→slot: selected_samples size = 2',
        slot.render_state.selected_samples.size === 2);
  check('panel→slot: selected_samples contains 2 and 4',
        slot.render_state.selected_samples.has(2)
     && slot.render_state.selected_samples.has(4));

  // Selection: slot → panel.
  updateMglRenderState(slot.render_state,
    { selected_samples: new Set([10, 20]) });
  check('slot→panel: tree sees "10" and "20"',
        treePanel.selection.getSelected().has('10')
     && treePanel.selection.getSelected().has('20'));

  unbind();
  treePanel.selection.setHovered('99');
  check('after unbind: slot hover does not advance',
        slot.render_state.hover_sample !== 99);
}

// =====================================================================
group('bindTreePanelToSlot — custom leafIdToSample / sampleToLeafId');
{
  const slot = createMglCandidateModeSlot();
  const treePanel = { selection: createTreePanelSelection() };
  // Use a custom mapping: leaf 'sA' = sample 0, 'sB' = 1, 'sC' = 2.
  const idToSample = { sA: 0, sB: 1, sC: 2 };
  const sampleToId = ['sA', 'sB', 'sC'];
  const unbind = bindTreePanelToSlot(treePanel, slot, {
    leafIdToSample: (id) => id in idToSample ? idToSample[id] : null,
    sampleToLeafId: (n) => sampleToId[n] || null,
  });
  treePanel.selection.setHovered('sB');
  check('custom mapping: panel sB → slot 1',
        slot.render_state.hover_sample === 1);
  setHover(slot.render_state, 2, undefined);
  check('custom mapping: slot 2 → panel sC',
        treePanel.selection.getHovered() === 'sC');
  unbind();
}

// =====================================================================
group('cross-panel propagation: PCA + similarity together');
{
  const slot = createMglCandidateModeSlot();
  const pca = { selection: createPcaPanelSelection() };
  const sim = { selection: createSimilarityPanelSelection() };
  const u1 = bindSamplePanelToSlot(pca, slot);
  const u2 = bindSimilarityPanelToSlot(sim, slot);

  // Hover in PCA → similarity sees the same sample as i = j cell.
  pca.selection.setHoveredSample(4);
  const cell = sim.selection.getHoveredCell();
  check('PCA hover → similarity hover cell {4,4}',
        cell && cell.i === 4 && cell.j === 4);

  // Hover in similarity → PCA sees the row sample.
  sim.selection.setHoveredCell({ i: 9, j: 12 });
  check('similarity hover → PCA hover = i (9)',
        pca.selection.getHoveredSample() === 9);

  // Selection in either propagates to the other.
  pca.selection.toggleSelectedSample(7);
  check('PCA select → similarity sees 7',
        sim.selection.getSelectedSamples().has(7));
  sim.selection.toggleSelectedSample(11);
  check('similarity select → PCA sees 11',
        pca.selection.getSelectedSamples().has(11));

  u1(); u2();
}

// =====================================================================
group('bindAllPanelsToCandidateMode');
{
  const slot = createMglCandidateModeSlot();
  const pca = { selection: createPcaPanelSelection() };
  const sim = { selection: createSimilarityPanelSelection() };
  const hm  = { selection: createDosageHeatmapSelection() };
  const tree = { selection: createTreePanelSelection() };
  const atlasState = {
    inversion: {
      _page_pca_scatter_per_window_state:        pca,
      _page_similarity_matrix_state: sim,
      _page_dosage_heatmap_state:   hm,
      _page_tree_panel_state:       tree,
    },
  };
  const unbindAll = bindAllPanelsToCandidateMode(atlasState, slot);

  pca.selection.setHoveredSample(15);
  check('all-bind: similarity sees PCA hover',
        sim.selection.getHoveredCell() && sim.selection.getHoveredCell().i === 15);
  check('all-bind: tree sees PCA hover as "15"',
        tree.selection.getHovered() === '15');

  // PCA selecting fires in heatmap too.
  pca.selection.toggleSelectedSample(20);
  check('all-bind: heatmap sees PCA selection',
        hm.selection.getSelectedSamples().has(20));
  check('all-bind: tree sees selection as "20"',
        tree.selection.getSelected().has('20'));

  unbindAll();
  pca.selection.setHoveredSample(99);
  check('all-bind: unbind detaches every panel',
        slot.render_state.hover_sample !== 99);

  // bindAllPanelsToCandidateMode with no panels present is safe.
  const slot2 = createMglCandidateModeSlot();
  const unbind2 = bindAllPanelsToCandidateMode({ inversion: {} }, slot2);
  check('bindAll on empty atlas: safe',           typeof unbind2 === 'function');
  unbind2();

  // null inputs.
  check('bindAll(null, slot) safe',
        typeof bindAllPanelsToCandidateMode(null, slot) === 'function');
}

// =====================================================================
group('null-input safety');
{
  const slot = createMglCandidateModeSlot();
  const pca = { selection: createPcaPanelSelection() };
  check('bindSamplePanelToSlot(null, slot) → no-op',
        typeof bindSamplePanelToSlot(null, slot) === 'function');
  check('bindSamplePanelToSlot(panel, null) → no-op',
        typeof bindSamplePanelToSlot(pca, null) === 'function');
  check('bindSimilarityPanelToSlot(null, null) → no-op',
        typeof bindSimilarityPanelToSlot(null, null) === 'function');
  check('bindDosageHeatmapPanelToSlot(null, slot) → no-op',
        typeof bindDosageHeatmapPanelToSlot(null, slot) === 'function');
  check('bindTreePanelToSlot(null, slot) → no-op',
        typeof bindTreePanelToSlot(null, slot) === 'function');
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
