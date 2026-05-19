// tests/test_page1_band_trace_tooltip.js
//
// Unit tests for pages/discovery/local_pca_dosage/band_trace_tooltip.js.
// Covers the parts that don't need a DOM: bandTraceHitTest and
// bandTraceTooltipBuildHtml. The show/hide/wire entry points are
// exercised by the smoke tests once the canvas shim is in scope.

import {
  bandTraceHitTest,
  bandTraceTooltipBuildHtml,
  bandTraceTooltipEnsureEl,
  bandTraceTooltipHide,
  wireBandTraceTooltip,
} from '../atlases/inversion/pages/discovery/local_pca_dosage/band_trace_tooltip.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('bandTraceHitTest');
{
  check('empty hits → null',  bandTraceHitTest([], 5, 5) === null);
  check('null hits → null',   bandTraceHitTest(null, 5, 5) === null);

  const hits = [
    { x: 0,   y: 10, w: 20, h: 7, l2_idx: 0 },
    { x: 20,  y: 10, w: 20, h: 7, l2_idx: 1 },
    { x: 40,  y: 10, w: 20, h: 7, l2_idx: 2 },
  ];
  check('cursor inside hit 0 → that hit',  bandTraceHitTest(hits, 5, 12).l2_idx === 0);
  check('cursor inside hit 2 → that hit',  bandTraceHitTest(hits, 50, 12).l2_idx === 2);
  // x=20 lies inside both hit 0 ([0..20]) and hit 1 ([20..40]) because the
  // hit-test uses <= on both sides. First-match wins, so we get hit 0.
  // Real rects are disjoint by construction in _drawBandTraceStrip (each
  // L2 column starts at the previous column's end), so this boundary case
  // is academic.
  check('cursor on shared boundary (x=20) → first hit (hit 0)',
        bandTraceHitTest(hits, 20, 12).l2_idx === 0);
  check('cursor above strip → null',       bandTraceHitTest(hits, 30, 5) === null);
  check('cursor below strip → null',       bandTraceHitTest(hits, 30, 99) === null);
  check('cursor right of last rect → null', bandTraceHitTest(hits, 70, 12) === null);
  check('null entry in hits is tolerated',
        bandTraceHitTest([null, hits[0]], 5, 12).l2_idx === 0);
}

// =====================================================================
group('bandTraceTooltipBuildHtml — edge cases');
check('null hit → empty string',         bandTraceTooltipBuildHtml(null) === '');
check('hit without entry → empty string',
      bandTraceTooltipBuildHtml({ l2_idx: 0 }) === '');

// =====================================================================
group('bandTraceTooltipBuildHtml — co_seg L2');
{
  const hit = {
    l2_idx: 42,
    entry: {
      chain_idx: 0,
      regime: 'co_seg',
      n_valid: 5,
      dominant_band: 1,
      dominant_fraction: 1.0,
      entropy: 0,
      band_fractions: new Float32Array([0, 1, 0]),
    },
  };
  const html = bandTraceTooltipBuildHtml(hit, { n_chains: 1, n_fish_selected: 6 });
  check('renders L2 number',           html.includes('L2 #42'));
  check('renders regime chip',         html.includes('co_seg'));
  check('renders n_valid / total',     html.includes('5 / 6'));
  check('renders dominant band',       html.includes('b1'));
  check('renders dominant fraction',   html.includes('100.0%'));
  check('renders entropy = 0.000',     html.includes('0.000'));
  check('renders band fractions header', html.includes('band fractions:'));
  check('renders b1 100% slab',        html.includes('b1 100%'));
  check('no chain indicator when n_chains=1',
        !html.includes('chain'));
}

// =====================================================================
group('bandTraceTooltipBuildHtml — fanned + multi-chain');
{
  const hit = {
    l2_idx: 7,
    entry: {
      chain_idx: 2,
      regime: 'fanned',
      n_valid: 8,
      dominant_band: 0,
      dominant_fraction: 0.4,
      entropy: 0.95,
      band_fractions: new Float32Array([0.4, 0.4, 0.2]),
    },
  };
  const html = bandTraceTooltipBuildHtml(hit, { n_chains: 3, n_fish_selected: 8 });
  check('renders fanned regime',           html.includes('fanned'));
  check('renders chain idx when n_chains>1', html.includes('chain 2'));
  check('renders entropy = 0.950',         html.includes('0.950'));
  check('renders b0 40% slab',             html.includes('b0 40%'));
  check('renders b1 40% slab',             html.includes('b1 40%'));
  check('renders b2 20% slab',             html.includes('b2 20%'));
}

// =====================================================================
group('bandTraceTooltipBuildHtml — no_valid regime');
{
  const hit = {
    l2_idx: 99,
    entry: {
      chain_idx: 0,
      regime: 'no_valid',
      n_valid: 0,
      dominant_band: -1,
      dominant_fraction: 0,
      entropy: 0,
      band_fractions: new Float32Array([0, 0, 0]),
    },
  };
  const html = bandTraceTooltipBuildHtml(hit, { n_chains: 1, n_fish_selected: 8 });
  check('renders no_valid regime',          html.includes('no_valid'));
  check('renders n_valid = 0 / 8',          html.includes('0 / 8'));
  check('no band-fractions block for no_valid',
        !html.includes('band fractions:'));
  // dominant_band < 0 should NOT render
  check('no dominant block when dominant_band < 0',
        !html.includes('dominant:'));
}

// =====================================================================
group('bandTraceTooltipBuildHtml — missing fields render gracefully');
{
  const hit = {
    l2_idx: 1,
    entry: {
      chain_idx: 0,
      regime: 'partial',
      n_valid: 3,
      dominant_band: 1,
      dominant_fraction: NaN,    // not finite
      entropy: NaN,
      band_fractions: null,
    },
  };
  const html = bandTraceTooltipBuildHtml(hit);
  check('renders partial regime',     html.includes('partial'));
  check('renders n_valid = 3 (no /total when n_fish_selected absent)',
        html.includes('>3<'));
  check('renders ? for non-finite dominant_fraction',
        html.includes('?%'));
  check('renders NA for non-finite entropy', html.includes('NA'));
  check('no band-fractions block when array missing',
        !html.includes('band fractions:'));
}

// =====================================================================
group('bandTraceTooltipEnsureEl + Hide — headless tolerance');
{
  // No `document` in Node → ensureEl returns null, hide is a no-op
  check('ensureEl returns null in headless', bandTraceTooltipEnsureEl() === null);
  let threw = false;
  try { bandTraceTooltipHide(); } catch (_) { threw = true; }
  check('hide is no-op in headless',          !threw);
}

// =====================================================================
group('wireBandTraceTooltip — null canvas tolerance');
{
  let threw = false;
  try { wireBandTraceTooltip(null, {}); } catch (_) { threw = true; }
  check('null canvas: no throw', !threw);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
