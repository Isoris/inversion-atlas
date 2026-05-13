// tests/test_review_page_ancestry_scroller.js
//
// Unit coverage for pages/review/page_ancestry_scroller — the Fish
// Ancestry Scroller (SPEC_fish_ancestry_scroller.md UI layout v2,
// canonical). Sister to test_review_page_sv_evidence.js (same
// shape — exports + state-binding + submodule purity).
//
// The scroller's renderers are canvas-based and DOM-touching, so
// pixel correctness lives in the smoke test (with a DOM polyfill).
// This unit test verifies:
//   - public export surface (mount/unmount/refresh + toolbar init)
//   - _state.js live-binding pattern
//   - pure resolver behaviour (selection.resolveClick) on a fixture
//   - cohort summary math (Layer 3) on a fixture
//   - context-card vocab + brick-status icon table

import * as page from '../atlases/inversion/pages/review/page_ancestry_scroller.js';
import * as state from '../atlases/inversion/pages/review/page_ancestry_scroller/_state.js';
import {
  paintLayer1, paintLayer2, paintMetrics, paintLayer3,
  brickFillForMode, computeBrickSummary,
  PC1_BAND_COLORS, ANCESTRY_K_COLORS, METRIC_ROWS,
} from '../atlases/inversion/pages/review/page_ancestry_scroller/layers.js';
import {
  CONTEXT_CARD_ITEMS, BRICK_STATUS_ICONS,
  renderContextCard, formatSelectedBrickFields, formatSelectedBrickStatus,
  renderKLegend,
} from '../atlases/inversion/pages/review/page_ancestry_scroller/right_panel.js';
import {
  resolveClick, createSelectionStore,
} from '../atlases/inversion/pages/review/page_ancestry_scroller/selection.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('page entry — public exports');

check('mount exported',                  typeof page.mount === 'function');
check('unmount exported',                typeof page.unmount === 'function');
check('refreshAncestryScroller export',  typeof page.refreshAncestryScroller === 'function');
check('initAncestryScrollerToolbar',     typeof page.initAncestryScrollerToolbar === 'function');
check('no __MODULE_ID__ leak',           !('__MODULE_ID__' in page));

// =====================================================================
group('_state.js — live-binding pattern');

check('_pageState exported',          '_pageState' in state);
check('_setActiveState fn',           typeof state._setActiveState === 'function');
check('_pageState starts null',       state._pageState === null);
state._setActiveState({ marker: 'X' });
check('_setActiveState mutates',      state._pageState && state._pageState.marker === 'X');
state._setActiveState(null);
check('_setActiveState(null) clears', state._pageState === null);

// =====================================================================
group('layers.js — palettes + render exports');

check('PC1_BAND_COLORS frozen',       Object.isFrozen(PC1_BAND_COLORS));
check('PC1 has band1/band2/band3',
      'band1' in PC1_BAND_COLORS
   && 'band2' in PC1_BAND_COLORS
   && 'band3' in PC1_BAND_COLORS);
check('ANCESTRY_K_COLORS >= 3',       ANCESTRY_K_COLORS.length >= 3);
check('METRIC_ROWS frozen',           Object.isFrozen(METRIC_ROWS));
check('METRIC_ROWS length = 5',       METRIC_ROWS.length === 5);
check('paintLayer1 fn',               typeof paintLayer1 === 'function');
check('paintLayer2 fn',               typeof paintLayer2 === 'function');
check('paintMetrics fn',              typeof paintMetrics === 'function');
check('paintLayer3 fn',               typeof paintLayer3 === 'function');

// =====================================================================
group('layers.js — brickFillForMode (pure)');

const brick1 = {
  start_idx: 0, end_idx: 4,
  dominant_k: 1, mean_delta_q: 0.5, het_z: 1.5,
  mean_entropy: 0.3, alignment_confidence: 0.9,
  dosage_concordance: 'concordant', flags: [],
};
check('mode=ancestry_k returns palette[K]',
      brickFillForMode(brick1, 'ancestry_k') === ANCESTRY_K_COLORS[1]);
check('mode=delta_q returns a colour',
      typeof brickFillForMode(brick1, 'delta_q') === 'string');
check('mode=het_z returns a colour',
      typeof brickFillForMode(brick1, 'het_z') === 'string');
check('null brick returns ambiguous grey',
      typeof brickFillForMode(null, 'ancestry_k') === 'string');
check('unknown mode returns a string',
      typeof brickFillForMode(brick1, 'no-such-mode') === 'string');

// =====================================================================
group('layers.js — computeBrickSummary (pure)');

// 3 fish × 4 windows. Bricks designed so:
//   window 0-1: K0 majority (3/3) → agreement 1.0
//   window 2:   K1 majority (2/3) → agreement 2/3
//   window 3:   no bricks         → null, 0
const summaryModel = {
  fish_rows: ['F1', 'F2', 'F3'],
  window_grid: [
    { idx: 0, start_bp: 0,        end_bp:  500_000 },
    { idx: 1, start_bp: 500_000,  end_bp: 1_000_000 },
    { idx: 2, start_bp: 1_000_000, end_bp: 1_500_000 },
    { idx: 3, start_bp: 1_500_000, end_bp: 2_000_000 },
  ],
  bricks: {
    F1: [{ start_idx: 0, end_idx: 1, dominant_k: 0 }, { start_idx: 2, end_idx: 2, dominant_k: 1 }],
    F2: [{ start_idx: 0, end_idx: 1, dominant_k: 0 }, { start_idx: 2, end_idx: 2, dominant_k: 1 }],
    F3: [{ start_idx: 0, end_idx: 1, dominant_k: 0 }, { start_idx: 2, end_idx: 2, dominant_k: 0 }],
  },
};
const summary = computeBrickSummary(summaryModel);
check('majority[0] = 0',                    summary.majority[0] === 0);
check('majority[1] = 0',                    summary.majority[1] === 0);
check('majority[2] = 1 (2/3 vote)',         summary.majority[2] === 1);
check('majority[3] = null (no bricks)',     summary.majority[3] === null);
check('agreement[0] = 1.0',                 Math.abs(summary.agreement[0] - 1.0) < 1e-9);
check('agreement[2] = 2/3',                 Math.abs(summary.agreement[2] - 2/3) < 1e-9);
check('agreement[3] = 0 (no bricks)',       summary.agreement[3] === 0);

// =====================================================================
group('selection.js — resolveClick (pure)');

const clickModel = {
  fish_rows: ['F1', 'F2'],
  window_grid: [
    { idx: 0 }, { idx: 1 }, { idx: 2 }, { idx: 3 },
  ],
  bricks: {
    F1: [{ start_idx: 0, end_idx: 1, dominant_k: 0 }, { start_idx: 2, end_idx: 3, dominant_k: 1 }],
    F2: [{ start_idx: 0, end_idx: 3, dominant_k: 0 }],
  },
};
// canvas_w=400, canvas_h=200 → colW=100, rowH=100
// click (x=50, y=50) → c=0, r=0 → F1 first brick
const sel0 = resolveClick({ x: 50, y: 50, canvas_w: 400, canvas_h: 200 }, clickModel);
check('hit returns selection',          sel0 && sel0.fish_id === 'F1');
check('hit returns the right brick',    sel0 && sel0.brick.start_idx === 0 && sel0.brick.end_idx === 1);

// click (x=250, y=150) → c=2, r=1 → F2 (covers 0..3)
const sel1 = resolveClick({ x: 250, y: 150, canvas_w: 400, canvas_h: 200 }, clickModel);
check('F2 selection',                   sel1 && sel1.fish_id === 'F2');

// click outside the grid
check('click outside → null',
      resolveClick({ x: -1, y: 0, canvas_w: 400, canvas_h: 200 }, clickModel) === null);
check('null model → null',              resolveClick({ x: 1, y: 1, canvas_w: 1, canvas_h: 1 }, null) === null);
check('null px → null',                 resolveClick(null, clickModel) === null);

// =====================================================================
group('selection.js — createSelectionStore');

const store = createSelectionStore();
check('starts null',                  store.get() === null);
let seen = null;
const unsub = store.subscribe((s) => { seen = s; });
store.set({ fish_id: 'F1' });
check('set updates getter',           store.get() && store.get().fish_id === 'F1');
check('subscribe fired',              seen && seen.fish_id === 'F1');
unsub();
store.set({ fish_id: 'F2' });
check('unsubscribe stops emissions',  seen.fish_id === 'F1');

// =====================================================================
group('right_panel.js — vocab + formatters');

check('CONTEXT_CARD_ITEMS frozen',     Object.isFrozen(CONTEXT_CARD_ITEMS));
check('CONTEXT_CARD_ITEMS = 3 items',  CONTEXT_CARD_ITEMS.length === 3);
check('BRICK_STATUS_ICONS frozen',     Object.isFrozen(BRICK_STATUS_ICONS));
check('REGIME_DISCORDANT in vocab',    'REGIME_DISCORDANT' in BRICK_STATUS_ICONS);
check('DOSAGE_DISCORDANT in vocab',    'DOSAGE_DISCORDANT' in BRICK_STATUS_ICONS);

const fields_html = formatSelectedBrickFields({
  fish_id: 'Fish_1012',
  brick: {
    start_bp: 16_400_000, end_bp: 16_820_000,
    dominant_k: 1, dominant_share: 0.78,
    mean_delta_q: 0.62, het_z: 1.74, mean_entropy: 0.21,
    alignment_confidence: 0.87,
    pc1_band_label: 'Band 3 (Inv Hom)',
    dosage_state: 'Het',
    flags: ['HIGH_DELTA_Q', 'HIGH_HET'],
  },
});
check('fields HTML mentions fish id',     fields_html.indexOf('Fish_1012') >= 0);
check('fields HTML mentions K2',          fields_html.indexOf('K2') >= 0);
check('fields HTML mentions ΔQ 0.62',     fields_html.indexOf('0.62') >= 0);
check('fields HTML signs het z (+1.74)',  fields_html.indexOf('+1.74') >= 0);

const fields_empty = formatSelectedBrickFields(null);
check('null selection → empty hint',      fields_empty.indexOf('No brick selected') >= 0);

const status_html = formatSelectedBrickStatus({
  brick: { flags: ['HIGH_DELTA_Q', 'REGIME_DISCORDANT'] },
});
check('status html mentions High ΔQ',     status_html.indexOf('High') >= 0);
check('status html mentions Regime',      status_html.indexOf('Regime') >= 0);

const status_empty = formatSelectedBrickStatus({ brick: { flags: [] } });
check('no flags → "—"',                   status_empty.indexOf('—') >= 0);

// renderContextCard / renderKLegend require an innerHTML-settable node.
const fakeNode = { innerHTML: '' };
renderContextCard(fakeNode);
check('context card writes innerHTML',    fakeNode.innerHTML.indexOf('① PC1') >= 0);

const legendNode = { innerHTML: '' };
renderKLegend(legendNode, 3);
check('K legend writes K1 / K2 / K3',
      legendNode.innerHTML.indexOf('K1') >= 0
   && legendNode.innerHTML.indexOf('K2') >= 0
   && legendNode.innerHTML.indexOf('K3') >= 0);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
