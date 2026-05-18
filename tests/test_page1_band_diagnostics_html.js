// tests/test_page1_band_diagnostics_html.js
//
// Unit tests for pages/discovery/local_pca_dosage/band_diagnostics_html.js —
// the HTML renderers that consume computeBandDiagnostics output.

import {
  bandDiagsMiniChipsHtml,
  bandDiagsPanelHtml,
} from '../atlases/inversion/pages/discovery/local_pca_dosage/band_diagnostics_html.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
// Diag fixture: 3 bands, all source layers populated, het flag present
// =====================================================================
function makeDiag(opts) {
  opts = opts || {};
  return {
    bands: [
      { k: 0, n: 3,
        ghsl_mean: 0.10, ghsl_median: 0.10,
        theta_pi_mean: 0.0012, theta_pi_median: 0.0012,
        het_mean: 0.10, het_median: 0.10,
        roh_overlap_pct: 0,
        roh_frac_mean: 0, roh_frac_median: 0,
        froh_mean: 0.05, froh_median: 0.05,
        flags: [],
      },
      { k: 1, n: 3,
        ghsl_mean: 0.20, ghsl_median: 0.20,
        theta_pi_mean: 0.0034, theta_pi_median: 0.0034,
        het_mean: 0.45, het_median: 0.45,
        roh_overlap_pct: 33,
        roh_frac_mean: 0.05, roh_frac_median: 0.05,
        froh_mean: 0.08, froh_median: 0.08,
        flags: ['het_high', 'middle_het_support'],
      },
      { k: 2, n: 3,
        ghsl_mean: 0.10, ghsl_median: 0.10,
        theta_pi_mean: 0.0010, theta_pi_median: 0.0010,
        het_mean: 0.10, het_median: 0.10,
        roh_overlap_pct: 0,
        roh_frac_mean: 0, roh_frac_median: 0,
        froh_mean: 0.05, froh_median: 0.05,
        flags: [],
      },
    ],
    data_status: opts.data_status || {
      ghsl: true, theta_pi: true, het: true, roh: true, froh: true,
    },
    het_shape: opts.het_shape !== undefined ? opts.het_shape : {
      n_bins: 16, bin_lo: 0, bin_hi: 1,
      bin_edges: Array.from({ length: 17 }, (_, i) => i / 16),
      counts_per_band: [
        [3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
        [0,0,0,0,0,0,0,3,0,0,0,0,0,0,0,0],
        [3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      ],
      support_ratio: 4.5, support_kind: 'middle_vs_flanks',
      support_passes: true, support_marginal: false,
    },
  };
}

// =====================================================================
group('bandDiagsMiniChipsHtml — null / empty inputs');
check('null diag → empty string',           bandDiagsMiniChipsHtml(null, null, 3, 0) === '');
check('diag without bands → empty string',  bandDiagsMiniChipsHtml(null, {}, 3, 0) === '');
check('empty bands array → empty string',
      bandDiagsMiniChipsHtml(null, { bands: [] }, 3, 0) === '');

{
  // All bands with n=0 → no rows emitted
  const diag = {
    bands: [
      { k: 0, n: 0, flags: [] },
      { k: 1, n: 0, flags: [] },
    ],
    data_status: {},
  };
  check('all bands n=0 → empty string',
        bandDiagsMiniChipsHtml(null, diag, 2, 0) === '');
}

// =====================================================================
group('bandDiagsMiniChipsHtml — three bands render three rows');
{
  const diag = makeDiag();
  const html = bandDiagsMiniChipsHtml(null, diag, 3, 5);
  // Container has data-bd-l2idx
  check('wraps in .bd-mini',                 html.includes('class="bd-mini"'));
  check('carries data-bd-l2idx="5"',         html.includes('data-bd-l2idx="5"'));
  // Three rows
  check('3 .bd-mini-row instances',
        (html.match(/class="bd-mini-row"/g) || []).length === 3);
  // Band labels
  for (const lbl of ['g0', 'g1', 'g2']) {
    check(`includes ${lbl} band label`,    html.includes(`>${lbl}<`));
  }
  // Pill labels
  for (const lbl of ['GHSL', 'θπ', 'het', 'ROH']) {
    check(`includes ${lbl} pill label`,    html.includes(`>${lbl}<`));
  }
  // n=3 chip
  check('n=3 chip rendered',                 html.includes('n=3'));
}

// =====================================================================
group('bandDiagsMiniChipsHtml — het clickable when het_shape present');
{
  const diag = makeDiag();
  const html = bandDiagsMiniChipsHtml(null, diag, 3, 42);
  check('het pill gets data-hs-trigger',     html.includes('data-hs-trigger="1"'));
  check('het pill carries data-hs-l2idx="42"', html.includes('data-hs-l2idx="42"'));
  check('het pill has cursor:pointer',       html.includes('cursor:pointer'));
}
{
  // No het_shape → het pill NOT clickable
  const diag = makeDiag({ het_shape: null });
  const html = bandDiagsMiniChipsHtml(null, diag, 3, 5);
  check('no het_shape → no data-hs-trigger', !html.includes('data-hs-trigger'));
}
{
  // het_shape present but data_status.het = false → still NOT clickable
  const diag = makeDiag({
    data_status: { ghsl: true, theta_pi: true, het: false, roh: true, froh: true },
  });
  const html = bandDiagsMiniChipsHtml(null, diag, 3, 5);
  check('het layer off → no data-hs-trigger', !html.includes('data-hs-trigger'));
}

// =====================================================================
group('bandDiagsMiniChipsHtml — flags surface in title attributes');
{
  const diag = makeDiag();
  const html = bandDiagsMiniChipsHtml(null, diag, 3, 0);
  check('het_high flag in title text',
        html.includes('flags: het_high, middle_het_support'));
}

// =====================================================================
group('bandDiagsMiniChipsHtml — state stash for click handler');
{
  const state = {};
  const diag = makeDiag();
  bandDiagsMiniChipsHtml(state, diag, 3, 7);
  check('state.__bdByL2 created',            state.__bdByL2 instanceof Map);
  check('keyed by l2idx=7',                  state.__bdByL2.has(7));
  check('stores diag object verbatim',       state.__bdByL2.get(7) === diag);
  // Subsequent call with a different l2idx adds, doesn't replace
  bandDiagsMiniChipsHtml(state, diag, 3, 12);
  check('Map size grows: 2 entries',         state.__bdByL2.size === 2);
}
{
  // l2idx=null → no stash
  const state = {};
  bandDiagsMiniChipsHtml(state, makeDiag(), 3, null);
  check('null l2idx → no state stash',       state.__bdByL2 === undefined);
}
{
  // No state → no throw, no stash
  let threw = false;
  try { bandDiagsMiniChipsHtml(null, makeDiag(), 3, 1); } catch (_) { threw = true; }
  check('null state: no throw',              !threw);
}

// =====================================================================
group('bandDiagsMiniChipsHtml — value formatter modes');
{
  // GHSL uses 'auto' (3-dec when |v| ≥ 0.1)
  // θπ uses 'sci' (4-dec when |v| ≥ 0.01, else exponential)
  // ROH uses 'pct' (no decimals)
  const diag = makeDiag();
  const html = bandDiagsMiniChipsHtml(null, diag, 3, 0);
  // GHSL 0.10 → "0.100"
  check('GHSL 0.10 → "0.100"',       html.includes('>0.100<'));
  // θπ 0.0012 → exponential (sci mode)
  check('θπ 0.0012 → exponential',   html.includes('1.2e-3'));
  // het 0.45 → "0.450"
  check('het 0.45 → "0.450"',        html.includes('>0.450<'));
  // ROH 33% → "33%"
  check('ROH 33 → "33%"',            html.includes('>33%<'));
  // ROH 0 → "0%"
  check('ROH 0 → "0%"',              html.includes('>0%<'));
}
{
  // null values render as "?"
  const diag = {
    bands: [{ k: 0, n: 3, ghsl_mean: null, theta_pi_mean: null,
              het_mean: null, roh_overlap_pct: null, flags: [] }],
    data_status: {},
  };
  const html = bandDiagsMiniChipsHtml(null, diag, 1, 0);
  // 4 "?" pills (GHSL, θπ, het, ROH all null)
  check('null values render as ?',  (html.match(/>\?</g) || []).length === 4);
}

// =====================================================================
group('bandDiagsPanelHtml — null / empty inputs');
check('null diag → empty string',          bandDiagsPanelHtml(null, 3) === '');
check('diag without bands → empty string', bandDiagsPanelHtml({}, 3) === '');
check('empty bands → empty string',        bandDiagsPanelHtml({ bands: [] }, 3) === '');

// =====================================================================
group('bandDiagsPanelHtml — full layout');
{
  const diag = makeDiag();
  const html = bandDiagsPanelHtml(diag, 3);
  // <details> wrapper
  check('wraps in <details class="bd-panel">', html.includes('<details class="bd-panel">'));
  check('summary row present',                 html.includes('<summary class="bd-summary">'));
  // Layer count summary: 5/5 layers loaded
  check('summary: "5/5 layers loaded"',        html.includes('5/5 layers loaded'));
  // Flag count: 2 flags (het_high + middle_het_support on band 1)
  check('summary: "2 flags" chip',             html.includes('2 flags'));
  // Table headers
  for (const th of ['band', 'GHSL', 'θ/π', 'het', 'shape', '%ROH', 'FROH', 'flags']) {
    check(`<th>${th}</th> present`, html.includes(`<th>${th}</th>`)
                                      || html.includes(`<th class="dim">${th}</th>`));
  }
  // Three tbody rows
  check('3 <tr> rows in tbody',
        (html.match(/<tr>/g) || []).length === 4);   // 1 header + 3 body
  // Flag chips for band 1
  check('het_high flag chip',                  html.includes('bd-flag-het_high'));
  check('middle_het_support flag chip',
        html.includes('bd-flag-middle_het_support'));
  // Bands without flags show em-dash
  check('bands without flags show em-dash',
        (html.match(/>—</g) || []).length >= 2);   // bands 0 and 2
  // Inline ridgeline cells
  check('inline ridgeline SVG present',        html.includes('<svg class="hs-svg"'));
  // Het support line above table
  check('het support line: "Het:" label',      html.includes('class="hs-lbl">Het:</span>'));
  check('het support: 4.5× ratio',             html.includes('4.5×'));
  check('het support: ✓ glyph (passes)',       html.includes('<span class="hs-pass">✓</span>'));
}

// =====================================================================
group('bandDiagsPanelHtml — partial data_status');
{
  // Only GHSL and het available; θπ, ROH, FROH absent
  const diag = makeDiag({
    data_status: { ghsl: true, theta_pi: false, het: true, roh: false, froh: false },
  });
  const html = bandDiagsPanelHtml(diag, 3);
  // 2/5: ghsl + het (data_status counts each layer flag independently)
  check('summary: "2/5 layers loaded"',        html.includes('2/5 layers loaded'));
  // ridgeline still rendered (het is on)
  check('ridgeline rendered (het is on)',      html.includes('<svg class="hs-svg"'));
}
{
  // No het → "?" placeholder in ridgeline cell
  const diag = makeDiag({
    data_status: { ghsl: true, theta_pi: false, het: false, roh: false, froh: false },
    het_shape: null,
  });
  const html = bandDiagsPanelHtml(diag, 3);
  check('het off: ridgeline cell shows "?"',
        html.includes('<td class="hs-ridge-cell"><span class="dim">?</span></td>'));
  check('het off: no het-support line',
        !html.includes('class="hs-lbl">Het:</span>'));
}

// =====================================================================
group('bandDiagsPanelHtml — no flags scenario');
{
  const diag = makeDiag();
  for (const b of diag.bands) b.flags = [];
  const html = bandDiagsPanelHtml(diag, 3);
  check('summary: no flag chip when total flags = 0',
        !html.includes('flag</span>') && !html.includes('flags</span>'));
}

// =====================================================================
group('bandDiagsPanelHtml — het_shape support_marginal');
{
  const diag = makeDiag({
    het_shape: {
      n_bins: 16, bin_lo: 0, bin_hi: 1,
      bin_edges: Array.from({ length: 17 }, (_, i) => i / 16),
      counts_per_band: [[3], [3], [3]],
      support_ratio: 1.3, support_kind: 'middle_vs_flanks',
      support_passes: false, support_marginal: true,
    },
  });
  const html = bandDiagsPanelHtml(diag, 3);
  check('support_marginal: ?? glyph',         html.includes('class="hs-marg">??</span>'));
  check('support_passes: no ✓ glyph',         !html.includes('class="hs-pass">✓</span>'));
}

// =====================================================================
group('bandDiagsPanelHtml — null support_ratio');
{
  const diag = makeDiag({
    het_shape: {
      n_bins: 16, bin_lo: 0, bin_hi: 1,
      bin_edges: Array.from({ length: 17 }, (_, i) => i / 16),
      counts_per_band: [[3], [3], [3]],
      support_ratio: null, support_kind: 'none',
      support_passes: false, support_marginal: false,
    },
  });
  const html = bandDiagsPanelHtml(diag, 3);
  check('null support_ratio: "?" placeholder', html.includes('>?</span>'));
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
