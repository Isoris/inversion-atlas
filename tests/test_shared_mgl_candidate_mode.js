// tests/test_shared_mgl_candidate_mode.js
//
// Unit coverage for shared/mgl_candidate_mode.js — the page1 state-
// slot lifecycle helpers + cache + active-choice plumbing.

import {
  createMglCandidateModeSlot,
  activateForCandidate,
  deactivate,
  resetMglCandidateModeSlot,
  pcaCacheKey,
  heatmapCacheKey,
  beagleCacheKey,
  registerPcaResult,
  registerHeatmapResult,
  registerBeagleText,
  activatePcaHeatmapChoice,
  getActivePca,
  getActiveHeatmap,
  getRenderState,
  cacheStats,
} from '../atlases/inversion/shared/mgl_candidate_mode.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('createMglCandidateModeSlot');

const slot = createMglCandidateModeSlot();
check('slot.active = false',           slot.active === false);
check('slot.candidate_id = null',      slot.candidate_id === null);
check('slot.interval = null',          slot.interval === null);
check('slot.render_state present',     slot.render_state && slot.render_state.view_name === 'all_pairs');
check('slot.loaded_pca empty',         Object.keys(slot.loaded_pca).length === 0);
check('slot.loaded_heatmap empty',     Object.keys(slot.loaded_heatmap).length === 0);
check('slot.loaded_beagle empty',      Object.keys(slot.loaded_beagle).length === 0);
check('slot.active_pca = null',        slot.active_pca === null);
check('slot.active_heatmap = null',    slot.active_heatmap === null);

// Override render_state initial values
const slot_override = createMglCandidateModeSlot({
  render_state_init: { view_name: 'tri_extras' },
});
check('render_state init override',    slot_override.render_state.view_name === 'tri_extras');

// =====================================================================
group('activateForCandidate / deactivate / reset');

activateForCandidate(slot, {
  candidate_id: 'LG28_15_18',
  chrom:        'LG28',
  start:        15115000,
  end:          18005000,
});
check('after activate: active = true',     slot.active === true);
check('after activate: candidate_id set',  slot.candidate_id === 'LG28_15_18');
check('after activate: interval populated',
      slot.interval.chrom === 'LG28'
   && slot.interval.start === 15115000
   && slot.interval.end   === 18005000);

deactivate(slot);
check('after deactivate: active = false',  slot.active === false);
check('after deactivate: candidate_id preserved (caches still useful)',
      slot.candidate_id === 'LG28_15_18');

// Reactivate, then reset
activateForCandidate(slot, {
  candidate_id: 'C2', chrom: 'LG28', start: 0, end: 100,
});
// Populate some caches
registerPcaResult(slot, 'all_pairs', 'weighted', 'bi_baseline',
                  { n_samples: 4, windows: [] });
registerHeatmapResult(slot, 'all_pairs', 'weighted', 'all',
                      { n_samples: 4, markers: [] });
registerBeagleText(slot, 'C2', 'all_pairs', 'marker\tallele1\tallele2\tind0\tind0\tind0');
check('caches populated before reset',
      cacheStats(slot).pca === 1
   && cacheStats(slot).heatmap === 1
   && cacheStats(slot).beagle === 1);
resetMglCandidateModeSlot(slot);
check('reset: active = false',           slot.active === false);
check('reset: candidate_id = null',      slot.candidate_id === null);
check('reset: interval = null',          slot.interval === null);
check('reset: caches cleared',
      cacheStats(slot).pca === 0
   && cacheStats(slot).heatmap === 0
   && cacheStats(slot).beagle === 0);
check('reset: active_pca = null',        slot.active_pca === null);
check('reset: active_heatmap = null',    slot.active_heatmap === null);

// =====================================================================
group('Cache keys + registration');

check('pcaCacheKey format',           pcaCacheKey('all_pairs', 'weighted', 'bi_baseline')
                                       === 'all_pairs|weighted|bi_baseline');
check('heatmapCacheKey format',       heatmapCacheKey('all_pairs', 'unweighted', 'het')
                                       === 'all_pairs|unweighted|het');
check('beagleCacheKey format',        beagleCacheKey('C1', 'tri_extras')
                                       === 'C1|tri_extras');

const slot2 = createMglCandidateModeSlot();
const pcaA = { n_samples: 5, windows: [{ idx: 0, pc1: [0,1,2,3,4] }] };
const pcaB = { n_samples: 5, windows: [{ idx: 0, pc1: [4,3,2,1,0] }] };
registerPcaResult(slot2, 'all_pairs', 'weighted', 'bi_baseline', pcaA);
registerPcaResult(slot2, 'tri_extras', 'weighted', 'bi_baseline', pcaB);
check('2 PCA results cached',         cacheStats(slot2).pca === 2);
check('key separation: A vs B distinct',
      slot2.loaded_pca['all_pairs|weighted|bi_baseline']
       !== slot2.loaded_pca['tri_extras|weighted|bi_baseline']);

// Null inputs ignored
registerPcaResult(slot2, 'fake', 'weighted', 'bi_baseline', null);
check('null result ignored',          cacheStats(slot2).pca === 2);

// Empty-string Beagle text — typeof '' === 'string', so it DOES
// register (impl only rejects non-strings).
const slot3 = createMglCandidateModeSlot();
registerBeagleText(slot3, 'C1', 'all_pairs', '');
check('empty-string Beagle text DOES register',
      cacheStats(slot3).beagle === 1);
registerBeagleText(slot3, 'C2', 'all_pairs', null);
check('null Beagle text ignored',
      cacheStats(slot3).beagle === 1);

// =====================================================================
group('activatePcaHeatmapChoice — switch view × weighting × anchor');

const slot4 = createMglCandidateModeSlot();
activateForCandidate(slot4, { candidate_id: 'C1', chrom: 'LG28', start: 0, end: 100 });

const pcaResult1 = { n_samples: 5, windows: [{ idx: 0 }] };
const pcaResult2 = { n_samples: 5, windows: [{ idx: 1 }] };
const hmResult1  = { n_samples: 5, markers: [] };

registerPcaResult(slot4, 'all_pairs', 'weighted', 'bi_baseline', pcaResult1);
registerPcaResult(slot4, 'tri_extras', 'weighted', 'bi_baseline', pcaResult2);
registerHeatmapResult(slot4, 'all_pairs', 'weighted', 'all', hmResult1);

activatePcaHeatmapChoice(slot4, {
  view_name: 'all_pairs',
  weighting: 'weighted',
  anchor_mode: 'bi_baseline',
  centering_anchor: 'all',
});
check('activate: active_pca = pcaResult1',     getActivePca(slot4) === pcaResult1);
check('activate: active_heatmap = hmResult1',  getActiveHeatmap(slot4) === hmResult1);
check('activate: render_state.view = all_pairs',
      getRenderState(slot4).view_name === 'all_pairs');

// Switch view
activatePcaHeatmapChoice(slot4, {
  view_name: 'tri_extras',
  weighting: 'weighted',
  anchor_mode: 'bi_baseline',
  centering_anchor: 'all',
});
check('switch: active_pca = pcaResult2',       getActivePca(slot4) === pcaResult2);
// Heatmap not registered for tri_extras → null
check('switch: active_heatmap = null (no cache)', getActiveHeatmap(slot4) === null);
check('switch: render_state.view = tri_extras',
      getRenderState(slot4).view_name === 'tri_extras');

// Partial choice fills from current render_state
const slot5 = createMglCandidateModeSlot();
activateForCandidate(slot5, { candidate_id: 'C1', chrom: 'LG28', start: 0, end: 100 });
registerPcaResult(slot5, 'all_pairs', 'unweighted', 'view_self', pcaResult1);
slot5.render_state.weighting   = 'unweighted';
slot5.render_state.anchor_mode = 'view_self';
activatePcaHeatmapChoice(slot5, { view_name: 'all_pairs' });
check('partial choice: weighting from render_state',
      getActivePca(slot5) === pcaResult1);
check('render_state preserved after partial activate',
      getRenderState(slot5).anchor_mode === 'view_self');

// =====================================================================
group('Null-input tolerance');

createMglCandidateModeSlot();   // does not throw
activateForCandidate(null, {});
activateForCandidate(slot, null);
check('null slot/candidate: no-op without throwing', true);

deactivate(null);
resetMglCandidateModeSlot(null);
activatePcaHeatmapChoice(null, {});
check('null slot on every mutator: no-op without throwing', true);

check('cacheStats(null) → all zero',
      cacheStats(null).pca === 0
   && cacheStats(null).heatmap === 0
   && cacheStats(null).beagle === 0);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
