// tests/test_page1_fish_inspect_popover.js
//
// Unit tests for pages/discovery/local_pca_dosage/fish_inspect_popover.js.
// Covers the DOM-independent surface: fishInspectHitTest +
// fishInspectBuildHtml + headless tolerance on show/maybeShow.

import {
  FIP_HIT_TOL_PX,
  fishInspectHitTest,
  fishInspectBuildHtml,
  showFishInspectPopover,
  maybeShowFishInspectPopover,
} from '../atlases/inversion/pages/discovery/local_pca_dosage/fish_inspect_popover.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
// Fixture: a state with PC1 geom, tracked samples, and synthetic windows
// =====================================================================
function makeFixture() {
  // PC1 panel: pad.l=44, plotW=200, mb range [10, 20], yMin=-1, yMax=1
  const geom = {
    pad: { l: 44, t: 20 },
    plotW: 200,
    plotH: 100,
    mbMin: 10,
    mbMax: 20,
    yMin: -1,
    yMax: 1,
  };
  // 11 windows from 10..20 Mb spaced 1 Mb apart
  const windows = [];
  for (let i = 0; i <= 10; i++) {
    windows.push({ center_mb: 10 + i, pc1: null });
  }
  // PC1 grid: 5 samples × 11 windows. We mock getLinesValuesAt by setting
  // state.data.precomp_pc1[wi] (the real path is more elaborate but we only
  // need getLinesValuesAt(state, wi, 'pc1') to return per-sample values).
  // The simplest route: provide windows[wi].pc1 as a Float64Array, and the
  // real getLinesValuesAt reads from state.data.precomp.* — but that needs
  // a fuller fixture. For these tests we bypass by directly invoking the
  // builder/hit-test with a state that getLinesValuesAt can resolve to null,
  // and assert null-result behaviour.
  return {
    tracked: [0, 1, 2],
    data: {
      chrom: 'LG28',
      n_samples: 5,
      samples: [
        { cga: 'cga_001' }, { cga: 'cga_002' }, { cga: 'cga_003' },
        { cga: 'cga_004' }, { cga: 'cga_005' },
      ],
      windows,
      n_windows: 11,
    },
    __linesGeom: { pc1: geom },
    candidate: null,
  };
}

// =====================================================================
group('constants');
check('FIP_HIT_TOL_PX = 8',  FIP_HIT_TOL_PX === 8);

// =====================================================================
group('fishInspectHitTest — input validation');
check('null state → null',
      fishInspectHitTest(null, 50, 50) === null);
check('no tracked → null',
      fishInspectHitTest({ data: {} }, 50, 50) === null);
check('empty tracked → null',
      fishInspectHitTest({ tracked: [], data: {} }, 50, 50) === null);
check('no __linesGeom → null',
      fishInspectHitTest({ tracked: [0], data: {} }, 50, 50) === null);
check('no pc1 geom → null',
      fishInspectHitTest({ tracked: [0], data: {}, __linesGeom: {} }, 50, 50) === null);
{
  const state = makeFixture();
  state.data = null;
  check('no state.data → null',
        fishInspectHitTest(state, 50, 50) === null);
}
{
  const state = makeFixture();
  state.data.windows = [];
  check('empty windows → null',
        fishInspectHitTest(state, 50, 50) === null);
}

// =====================================================================
group('fishInspectHitTest — out-of-plot cursor');
{
  const state = makeFixture();
  // pad.l = 44, plotW = 200 → plot occupies x in [44, 244]
  check('x < pad.l → null',           fishInspectHitTest(state, 10, 50) === null);
  check('x > pad.l + plotW → null',   fishInspectHitTest(state, 999, 50) === null);
}

// =====================================================================
group('fishInspectHitTest — forceSi bypasses hit gating');
{
  const state = makeFixture();
  // The real path through getLinesValuesAt needs more fixture (state.data.precomp...).
  // Without it, getLinesValuesAt returns null and even forceSi can't help —
  // verify the null-path is reached gracefully.
  const result = fishInspectHitTest(state, 100, 50, 1);
  check('forceSi w/o pc1 data → null (graceful)', result === null);
}

// =====================================================================
group('fishInspectBuildHtml — null/empty paths');
check('null state → empty string',                 fishInspectBuildHtml(null, 0) === '');
check('no candidate → empty string',
      fishInspectBuildHtml({ data: {} }, 0) === '');

// =====================================================================
group('fishInspectBuildHtml — no fish call for sample');
{
  const state = {
    candidate: { id: 'cand_LG28_15Mb', fish_calls: [] },
    data: { samples: [{ cga: 'cga_001' }] },
  };
  const html = fishInspectBuildHtml(state, 0);
  check('renders head with sample id', html.includes('cga_001'));
  check('renders candidate short id (cand_ stripped)',
        html.includes('LG28_15Mb'));
  check('renders close button',        html.includes('fip-close'));
  check('renders "no call" placeholder', html.includes('No fish call data'));
}

// =====================================================================
group('fishInspectBuildHtml — full fish call');
{
  const state = {
    candidate: {
      id: 'cand_LG28_15Mb',
      fish_calls: [
        {
          regime: 1, ambiguous: false,
          confidence: 0.875, n_supporting: 7, n_intervals: 8,
          subband_stability: 0.8,
          votes: [-1, 1, 1, 2, 1],
          subband_path: ['g1a', null, 'g1a', 'g1b'],
        },
      ],
    },
    data: { samples: [{ cga: 'cga_001' }] },
  };
  const html = fishInspectBuildHtml(state, 0);
  check('renders regime g1',                       html.includes('g1'));
  check('renders confidence 0.875 (7/8)',
        html.includes('0.875') && html.includes('(7/8)'));
  check('renders stability 0.800 (subband < 1 → ambig)',
        html.includes('0.800') && html.includes('ambig'));
  check('renders vote tokens',                    html.includes('vote-token'));
  check('vote -1 renders as "."',                 html.includes('>.</span>'));
  check('non-matching vote gets jumped class',    html.includes('vote-token jumped'));
  check('matching vote gets consensus class',     html.includes('vote-token consensus'));
  check('renders sub-band path',                  html.includes('sub-token'));
  check('null subband entry renders ".",',        html.includes('>.</span>'));
}

// =====================================================================
group('fishInspectBuildHtml — ambiguous regime');
{
  const state = {
    candidate: {
      id: 'cand_X',
      fish_calls: [{
        regime: null, ambiguous: true,
        confidence: 0.4, n_supporting: 2, n_intervals: 8,
      }],
    },
    data: { samples: [{}] },
  };
  const html = fishInspectBuildHtml(state, 0);
  check('renders ambiguous regime chip', html.includes('ambig'));
}

// =====================================================================
group('fishInspectBuildHtml — confidence NA when missing');
{
  const state = {
    candidate: {
      id: 'x',
      fish_calls: [{ regime: 0, n_supporting: 0, n_intervals: 0 }],
    },
    data: { samples: [{ ind: 'ind_A' }] },
  };
  const html = fishInspectBuildHtml(state, 0);
  check('uses ind when cga missing',     html.includes('ind_A'));
  check('confidence missing → "NA"',     html.includes('NA'));
}

// =====================================================================
group('fishInspectBuildHtml — sample id fallback');
{
  const state = {
    candidate: { id: 'cand_x', fish_calls: [{}] },
    data: { samples: [{}] },  // no cga, no ind
  };
  const html = fishInspectBuildHtml(state, 0);
  check('falls back to s<idx>',          html.includes('s0'));
}

// =====================================================================
group('show / maybeShow — headless tolerance');
{
  // No document defined → show should return false without throwing
  let threw = false;
  let result;
  try { result = showFishInspectPopover({}, { si: 0, wi: 0, dy: 0 }, { clientX: 10, clientY: 10 }); }
  catch (_) { threw = true; }
  check('show: no throw without document', !threw);
  check('show: returns false without document', result === false);
}
{
  let threw = false;
  let result;
  try { result = showFishInspectPopover({}, null, { clientX: 10, clientY: 10 }); }
  catch (_) { threw = true; }
  check('show with null hit: returns false', !threw && result === false);
}
{
  // maybeShow with null canvas → false
  let threw = false;
  let result;
  try { result = maybeShowFishInspectPopover({ clientX: 10, clientY: 10 }, null, {}); }
  catch (_) { threw = true; }
  check('maybeShow: null canvas → false (no throw)', !threw && result === false);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
