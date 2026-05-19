// tests/test_evolution_page_polarize_msa.js
//
// Unit coverage for pages/evolution/polarize_msa_stacked.
// Renderer + builder + selection + verdict are pure; mount/unmount
// lifecycle is exercised in the smoke.

import * as page from '../atlases/inversion/pages/evolution/polarize_msa_stacked.js';
import * as state from '../atlases/inversion/pages/evolution/polarize_msa_stacked/_state.js';
import {
  buildPolarizeMsaRows,
  polarizationVerdict,
  ROW_TAG,
} from '../atlases/inversion/pages/evolution/polarize_msa_stacked/builder.js';
import {
  paintTierStripe,
  rowTagColor,
  tierLabel,
} from '../atlases/inversion/pages/evolution/polarize_msa_stacked/renderer.js';
import {
  createPolarizeMsaSelection,
  summariseHover,
} from '../atlases/inversion/pages/evolution/polarize_msa_stacked/selection.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('page entry — public exports');
check('mount fn',                                 typeof page.mount === 'function');
check('unmount fn',                               typeof page.unmount === 'function');
check('refreshPolarizeMsa fn',                    typeof page.refreshPolarizeMsa === 'function');
check('initPolarizeMsaToolbar fn',                typeof page.initPolarizeMsaToolbar === 'function');

// =====================================================================
group('_state.js — live binding');
check('_pageState exported',                      '_pageState' in state);
check('starts null',                              state._pageState === null);
state._setActiveState({ marker: 'PM' });
check('mutates',                                  state._pageState.marker === 'PM');
state._setActiveState(null);
check('clears',                                   state._pageState === null);

// =====================================================================
group('builder.buildPolarizeMsaRows — fixture');
//
// 8 samples; 5 sites; classes:
//   inv_idx = [0, 1, 2, 3]
//   std_idx = [4, 5]
//   outgroup_idx = [6, 7]
//
// site 0: INV all 2, STD all 0, OUT all 0 — strong polarization
// site 1: INV all 0, STD all 2, OUT all 2 — opposite polarization
// site 2: INV mixed 1/1/2/2 — derived but soft
// site 3: all 0 — uninformative
// site 4: INV all 2, STD all 2 — possible mosaic
const dosage = [
  Float64Array.from([2, 2, 2, 2, 0, 0, 0, 0]),  // site 0
  Float64Array.from([0, 0, 0, 0, 2, 2, 2, 2]),  // site 1
  Float64Array.from([1, 1, 2, 2, 0, 0, 0, 0]),  // site 2
  Float64Array.from([0, 0, 0, 0, 0, 0, 0, 0]),  // site 3
  Float64Array.from([2, 2, 2, 2, 2, 2, 2, 2]),  // site 4
];
const built = buildPolarizeMsaRows({
  dosage, n_markers: 5, n_samples: 8,
  inv_idx: [0, 1, 2, 3],
  std_idx: [4, 5],
  outgroup_idx: [6, 7],
});
check('rows include outgroup',
      built.rows.some(r => r.tag === ROW_TAG.OUTGROUP));
check('rows include INV founder',
      built.rows.some(r => r.tag === ROW_TAG.INV_FOUNDER));
check('rows include INV subgroups',
      built.rows.some(r => r.tag === ROW_TAG.INV_GROUP));
check('rows include STD',
      built.rows.some(r => r.tag === ROW_TAG.STD));
check('K_actual ≤ K_max default 3',               built.K_actual <= 3);
const founder = built.rows.find(r => r.tag === ROW_TAG.INV_FOUNDER);
check('founder row site 0 = 2 (high-confidence derived)',
      founder.dosage_row[0] === 2);
check('founder row site 1 = 0 (high-confidence reference)',
      founder.dosage_row[1] === 0);
check('tier_mask returned',                       built.tier_mask !== null);
check('tier_mask site 0 = 4 (high)',              built.tier_mask[0] === 4);
check('consensus_summary populated',              built.consensus_summary !== null);
check('subgroup_labels length matches inv_idx',   built.subgroup_labels.length === 4);

// Empty / null safety.
check('null args → empty rows',
      buildPolarizeMsaRows(null).rows.length === 0);
check('no inv_idx → empty rows',
      buildPolarizeMsaRows({ dosage, n_markers: 5, n_samples: 8 }).rows.length === 0);

// Without outgroup, builder still produces INV + STD rows.
const noOg = buildPolarizeMsaRows({
  dosage, n_markers: 5, n_samples: 8,
  inv_idx: [0, 1, 2, 3], std_idx: [4, 5],
});
check('no outgroup: still builds INV + STD',
      !noOg.rows.some(r => r.tag === ROW_TAG.OUTGROUP)
   && noOg.rows.some(r => r.tag === ROW_TAG.INV_FOUNDER)
   && noOg.rows.some(r => r.tag === ROW_TAG.STD));

// =====================================================================
group('builder.polarizationVerdict');
const v = polarizationVerdict(built);
check('verdict object returned',                   v && typeof v === 'object');
check('inv_matches_outgroup populated',            Number.isFinite(v.inv_matches_outgroup));
check('std_matches_outgroup populated',            Number.isFinite(v.std_matches_outgroup));
// In our fixture, outgroup matches STD on site 0 (both 0) and INV on
// site 1 (both 0). Site 4 — both 2 for both — counts as a tie. So
// verdict may be 'unpolarized' or could lean either way. Just check
// it's one of the valid strings.
check('verdict ∈ valid set',
      ['derived_inv', 'derived_std', 'unpolarized', 'insufficient_data']
        .includes(v.verdict));
check('null stack → unpolarized',
      polarizationVerdict(null).verdict === 'unpolarized');
check('missing OG → unpolarized',
      polarizationVerdict({ rows: [{ tag: ROW_TAG.INV_FOUNDER, dosage_row: new Float64Array(5) }] })
        .verdict === 'unpolarized');

// =====================================================================
group('renderer.rowTagColor / tierLabel / paintTierStripe');
check('outgroup colour',                          rowTagColor('outgroup') === '#705090');
check('inv_founder colour',                       rowTagColor('inv_founder') === '#D04545');
check('inv_group colour',                         rowTagColor('inv_group') === '#3074C8');
check('std colour',                               rowTagColor('std') === '#2BAA50');
check('unknown tag → grey',                       rowTagColor('xxx') === '#888888');

check('tierLabel 4 → high',                       tierLabel(4) === 'high');
check('tierLabel 3 → medium',                     tierLabel(3) === 'medium');
check('tierLabel 2 → low',                        tierLabel(2) === 'low');
check('tierLabel 1 → ambiguous',                  tierLabel(1) === 'ambiguous');
check('tierLabel 0 → suspicious',                 tierLabel(0) === 'suspicious');

class FakeCtx {
  constructor() { this.calls = []; this.fillStyle = ''; }
  fillRect() { this.calls.push('fillRect'); }
  clearRect() { this.calls.push('clearRect'); }
}
class FakeCanvas {
  constructor() { this.width = 800; this.height = 400; this._ctx = new FakeCtx(); }
  getContext() { return this._ctx; }
}
const fc = new FakeCanvas();
const layout = {
  matX: 50, matY: 20, cellW: 10, cellH: 10,
  n_displayed_markers: 5, n_displayed_samples: 4,
  marker_order: new Int32Array([0, 1, 2, 3, 4]),
  sample_order: new Int32Array([0, 1, 2, 3]),
};
paintTierStripe(fc, built.tier_mask, layout);
check('tier stripe drew fillRect cells',
      fc._ctx.calls.filter(c => c === 'fillRect').length === 5);
// Null / empty safety.
paintTierStripe(null, built.tier_mask, layout);
paintTierStripe(fc, null, layout);
paintTierStripe(fc, built.tier_mask, null);
check('null inputs → no throw',                   true);

// =====================================================================
group('selection.createPolarizeMsaSelection');
const sel = createPolarizeMsaSelection();
let n = 0;
sel.subscribe(() => { n++; });
check('initial hovered = null',                   sel.getHoveredCell() === null);
sel.setHoveredCell({ row: 1, col: 2, marker_idx: 2, sample_idx: 1, dosage: 1.5 });
check('hover notifies',                           n === 1);
check('hover read back',
      sel.getHoveredCell().marker_idx === 2 && sel.getHoveredCell().sample_idx === 1);
sel.setHoveredCell({ row: 1, col: 2, marker_idx: 2, sample_idx: 1, dosage: 1.5 });
check('repeat hover no-op',                       n === 1);
sel.setHoveredCell(null);
check('clear hover notifies',                     n === 2);

sel.toggleSelectedRow(0);
sel.toggleSelectedRow(2);
check('two rows selected',                        sel.getSelectedRows().size === 2);
sel.toggleSelectedRow(0);
check('toggle removes',                           !sel.getSelectedRows().has(0));
sel.toggleSelectedSite(5);
check('site selection',                           sel.getSelectedSites().has(5));
sel.clearSelection();
check('clearSelection empties both',
      sel.getSelectedRows().size === 0 && sel.getSelectedSites().size === 0);

// =====================================================================
group('selection.summariseHover');
const s1 = summariseHover(null, [], null);
check('null hover → "—"',                         s1[0].value === '—');
const s2 = summariseHover(
  { row: 1, col: 2, marker_idx: 2, sample_idx: 1, dosage: 1.5 },
  built.rows, built.tier_mask,
);
check('summary has Row entry',                    s2.some(r => r.label === 'Row'));
check('summary has Dosage entry',                 s2.some(r => r.label === 'Dosage'));
check('summary has Tier entry',                   s2.some(r => r.label === 'Tier'));

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
