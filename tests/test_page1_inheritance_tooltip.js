// tests/test_page1_inheritance_tooltip.js
//
// Unit tests for pages/discovery/page1/inheritance_tooltip.js.
// Covers the DOM-independent surface: inhPillHitTest +
// inhTooltipBuildHtml + headless tolerance on the show/hide/wire pair.

import {
  inhPillHitTest,
  inhTooltipBuildHtml,
  inhTooltipEnsureEl,
  inhTooltipHide,
  wireInheritancePillTooltip,
} from '../atlases/inversion/pages/discovery/page1/inheritance_tooltip.js';
import {
  inhGroupColor,
} from '../atlases/inversion/shared/color_helpers.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('inhPillHitTest');
{
  check('empty → null',                inhPillHitTest([], 5, 5) === null);
  check('null → null',                 inhPillHitTest(null, 5, 5) === null);
  const regions = [
    { x: 0,  y: 0,  w: 10, h: 10, item_idx: 0, seq_num: 1 },
    { x: 30, y: 0,  w: 10, h: 10, item_idx: 1, seq_num: 2 },
  ];
  check('inside region 0',             inhPillHitTest(regions, 5, 5).seq_num === 1);
  check('inside region 1',             inhPillHitTest(regions, 35, 5).seq_num === 2);
  check('gap between regions → null',  inhPillHitTest(regions, 20, 5) === null);
  check('below regions → null',        inhPillHitTest(regions, 5, 99) === null);
  check('null entry tolerated',
        inhPillHitTest([null, regions[0]], 5, 5).seq_num === 1);
}

// =====================================================================
group('inhTooltipBuildHtml — null/no-result paths');
check('null hit → empty string', inhTooltipBuildHtml(null, {}) === '');

{
  // Hit with no inheritance result on state → header renders, body
  // shows the "composition unavailable" placeholder.
  const hit = {
    item_idx: 0, seq_num: 1, candidate_id: 'cand_LG28_15Mb',
    n_groups: 3, start_bp: 15_115_000, end_bp: 18_005_000,
  };
  const html = inhTooltipBuildHtml(hit, {});
  check('renders I-seq header',         html.includes('I1 · cand_LG28_15Mb'));
  // 18,005,000 / 1e6 = 18.005 which toFixed(2) prints as '18.00' due to
  // floating-point representation (18.005 ≈ 18.00499…).
  check('renders bp range in Mb',       html.includes('15.12 – 18.00 Mb'));
  check('renders group count plural',   html.includes('3 inheritance groups'));
  check('placeholder when no result',
        html.includes('composition unavailable'));
}

{
  // 1 group → singular label
  const html = inhTooltipBuildHtml({
    item_idx: 0, seq_num: 2, candidate_id: 'x',
    n_groups: 1, start_bp: 1e6, end_bp: 2e6,
  }, {});
  check('singular: "1 inheritance group"', html.includes('1 inheritance group<'));
}

// =====================================================================
group('inhTooltipBuildHtml — happy path with composition');
{
  // Build a synthetic state matching what runInheritanceCompute would
  // populate: inheritanceResult with cut.group_id_per_band, band_index
  // pointing at items_meta entries, and a candidates map carrying
  // locked_labels for fish counts.
  const lockedLabels = [0, 0, 1, 1, 2, 2];     // 2 fish per band
  const state = {
    activeMode: 'default',
    candidates: {
      cand_A: { K: 3, locked_labels: lockedLabels, start_bp: 1e6, end_bp: 2e6, confirmed: true },
    },
    inheritanceResult: {
      items_meta: [
        { id: 'cand_A', K: 3, seq_num: 1, start_bp: 1e6, end_bp: 2e6 },
      ],
      band_index: [
        { item_idx: 0, band: 0, item_id: 'cand_A' },
        { item_idx: 0, band: 1, item_id: 'cand_A' },
        { item_idx: 0, band: 2, item_id: 'cand_A' },
      ],
      cut: {
        group_id_per_band: new Int32Array([0, 1, 0]),
      },
    },
  };
  const hit = {
    item_idx: 0, seq_num: 1, candidate_id: 'cand_A',
    n_groups: 2, start_bp: 1e6, end_bp: 2e6,
  };
  const html = inhTooltipBuildHtml(hit, state);
  check('renders bands header',                    html.includes('bands:'));
  check('renders 3 band rows (b0/b1/b2)',
        html.includes('b0') && html.includes('b1') && html.includes('b2'));
  check('renders fish counts (2 fish each)',
        (html.match(/2 fish/g) || []).length === 3);
  check('renders group g0 chip for band 0',        html.includes('g0'));
  check('renders group g1 chip for band 1',        html.includes('g1'));
  check('reuses inhGroupColor for g0 swatch',      html.includes(inhGroupColor(0)));
  check('reuses inhGroupColor for g1 swatch',      html.includes(inhGroupColor(1)));
  check('no placeholder when composition resolves',
        !html.includes('composition unavailable'));
}

// =====================================================================
group('inhTooltipBuildHtml — detailed mode reads candidates_detailed');
{
  const lockedLabels = [0, 0, 1];
  const state = {
    activeMode: 'detailed',
    candidates_detailed: {
      X: { K: 2, locked_labels: lockedLabels, start_bp: 1e6, end_bp: 2e6, confirmed: true },
    },
    candidates: {
      X: { K: 2, locked_labels: [9, 9, 9], start_bp: 1e6, end_bp: 2e6, confirmed: true },  // wrong
    },
    inheritanceResult: {
      items_meta: [{ id: 'X', K: 2, seq_num: 1, start_bp: 1e6, end_bp: 2e6 }],
      band_index: [
        { item_idx: 0, band: 0, item_id: 'X' },
        { item_idx: 0, band: 1, item_id: 'X' },
      ],
      cut: { group_id_per_band: new Int32Array([0, 1]) },
    },
  };
  const hit = {
    item_idx: 0, seq_num: 1, candidate_id: 'X',
    n_groups: 2, start_bp: 1e6, end_bp: 2e6,
  };
  const html = inhTooltipBuildHtml(hit, state);
  // detailed source has 2 fish in band 0, 1 in band 1
  check('detailed mode: 2 fish in band 0', html.includes('2 fish'));
  check('detailed mode: 1 fish in band 1', html.includes('1 fish'));
}

// =====================================================================
group('inhTooltipEnsureEl + Hide — headless tolerance');
check('ensureEl returns null in headless', inhTooltipEnsureEl() === null);
{
  let threw = false;
  try { inhTooltipHide(); } catch (_) { threw = true; }
  check('hide is no-op in headless',          !threw);
}

// =====================================================================
group('wireInheritancePillTooltip — null canvas tolerance');
{
  let threw = false;
  try { wireInheritancePillTooltip(null, {}); } catch (_) { threw = true; }
  check('null canvas: no throw', !threw);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
