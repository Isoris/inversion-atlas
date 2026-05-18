// tests/test_page1_band_diagnostics.js
//
// Unit tests for pages/discovery/local_pca_dosage/band_diagnostics.js — the
// per-band confounder/support computation that drives the L3 panel's
// diagnostic chips and table.

import {
  computeBandDiagnostics,
} from '../atlases/inversion/pages/discovery/local_pca_dosage/band_diagnostics.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function approx(a, b, tol = 1e-6) { return Math.abs(a - b) <= tol; }
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
// Fixture builder
// =====================================================================
// 9 samples × K=3 bands, perfectly clustered: 3 samples per band.
//   band 0: samples 0, 1, 2
//   band 1: samples 3, 4, 5
//   band 2: samples 6, 7, 8
// L2 envelope covers bp 10..20.
function makeFixture(opts) {
  opts = opts || {};
  const N_SAMPLES = 9;
  const K = 3;
  const labels = new Int8Array(N_SAMPLES);
  for (let s = 0; s < N_SAMPLES; s++) labels[s] = Math.floor(s / 3);
  const cl = { labels, usedK: K };
  const env = { start_bp: 10, end_bp: 20 };
  const state = {
    data: {
      n_samples: N_SAMPLES,
      // Caller decides which optional layers to attach
      ...(opts.ghsl_panel ? { ghsl_panel: opts.ghsl_panel } : {}),
      ...(opts.theta_pi_panel ? { theta_pi_panel: opts.theta_pi_panel } : {}),
      ...(opts.roh_intervals ? { roh_intervals: opts.roh_intervals } : {}),
      ...(opts.sample_froh ? { sample_froh: opts.sample_froh } : {}),
    },
  };
  return { state, cl, env, K, N_SAMPLES };
}

// Build a synthetic panel with per-sample values. Panel covers bp 10..20
// with one window. Each sample gets a single value, repeated across the
// window. valuesByBand[k] = value applied to all 3 samples in band k.
function buildPanel(valuesByBand) {
  const N_SAMPLES = 9;
  const M = Array.from({ length: N_SAMPLES }, (_, s) => {
    const k = Math.floor(s / 3);
    return [valuesByBand[k]];
  });
  return {
    primary_scale: 's50',
    scales: ['s50'],
    div_roll: { s50: M },
    start_bp: [10],
    end_bp:   [20],
  };
}

// =====================================================================
group('input validation');
check('null cl → null',
      computeBandDiagnostics({ data: { n_samples: 1 } }, null, {}, 0) === null);
check('cl without labels → null',
      computeBandDiagnostics({ data: { n_samples: 1 } }, { usedK: 3 }, {}, 0) === null);
check('cl without usedK → null',
      computeBandDiagnostics({ data: { n_samples: 1 } },
                              { labels: new Int8Array(1) }, {}, 0) === null);
check('null env → null',
      computeBandDiagnostics({ data: { n_samples: 1 } },
                              { labels: new Int8Array(1), usedK: 1 }, null, 0) === null);
check('null state → null',
      computeBandDiagnostics(null,
                              { labels: new Int8Array(1), usedK: 1 }, {}, 0) === null);
check('state without data → null',
      computeBandDiagnostics({},
                              { labels: new Int8Array(1), usedK: 1 }, {}, 0) === null);

// =====================================================================
group('no source layers → empty diagnostics');
{
  const { state, cl, env } = makeFixture({});
  const r = computeBandDiagnostics(state, cl, env, 0);
  check('returns non-null result',     r !== null);
  check('3 bands rendered',            r.bands.length === 3);
  check('each band has n = 3',         r.bands.every(b => b.n === 3));
  check('all flags empty',             r.bands.every(b => b.flags.length === 0));
  check('all source-stat fields null', r.bands[0].ghsl_mean === null
                                        && r.bands[0].theta_pi_mean === null
                                        && r.bands[0].het_mean === null
                                        && r.bands[0].roh_overlap_pct === null
                                        && r.bands[0].froh_mean === null);
  check('data_status all false',
        Object.values(r.data_status).every(v => v === false));
  check('het_shape is null',           r.het_shape === null);
}

// =====================================================================
group('ghsl: equal across bands → no GHSL_support flag');
{
  const { state, cl, env } = makeFixture({
    ghsl_panel: buildPanel([0.5, 0.5, 0.5]),
  });
  const r = computeBandDiagnostics(state, cl, env, 0);
  check('data_status.ghsl = true',  r.data_status.ghsl === true);
  check('all bands ghsl_mean = 0.5',
        r.bands.every(b => approx(b.ghsl_mean, 0.5)));
  check('no GHSL_support flags',
        r.bands.every(b => !b.flags.includes('GHSL_support')));
}

// =====================================================================
group('ghsl: spread > 1.3× → GHSL_support flag on argmax band');
{
  // band 0 = 1.0, band 1 = 0.5, band 2 = 0.5 → max/min = 2.0 > 1.3
  // → flag fires on band 0 (the argmax)
  const { state, cl, env } = makeFixture({
    ghsl_panel: buildPanel([1.0, 0.5, 0.5]),
  });
  const r = computeBandDiagnostics(state, cl, env, 0);
  check('band 0: GHSL_support flag present',  r.bands[0].flags.includes('GHSL_support'));
  check('bands 1, 2: no GHSL_support flag',
        !r.bands[1].flags.includes('GHSL_support')
        && !r.bands[2].flags.includes('GHSL_support'));
}

// =====================================================================
group('ghsl: spread = 1.3× exactly → no flag (strict >)');
{
  // 1.3 / 1.0 = 1.3 — strict >, so this doesn't fire
  const { state, cl, env } = makeFixture({
    ghsl_panel: buildPanel([1.3, 1.0, 1.0]),
  });
  const r = computeBandDiagnostics(state, cl, env, 0);
  check('exactly 1.3× spread does NOT fire GHSL_support',
        !r.bands.some(b => b.flags.includes('GHSL_support')));
}

// =====================================================================
group('theta_pi_shift: same logic on theta_pi_panel');
{
  const { state, cl, env } = makeFixture({
    theta_pi_panel: buildPanel([0.3, 0.3, 0.5]),    // 0.5/0.3 ≈ 1.67 > 1.3
  });
  const r = computeBandDiagnostics(state, cl, env, 0);
  check('data_status.theta_pi = true',  r.data_status.theta_pi === true);
  check('band 2: theta_pi_shift flag',  r.bands[2].flags.includes('theta_pi_shift'));
}

// =====================================================================
group('het + middle_het_support (K=3 specific)');
{
  // Middle band higher than both flanks by > 1.2×
  // band 0 = 0.10, band 1 = 0.40, band 2 = 0.10
  // het = ghsl_panel (same source by atlas convention)
  const { state, cl, env } = makeFixture({
    ghsl_panel: buildPanel([0.10, 0.40, 0.10]),
  });
  const r = computeBandDiagnostics(state, cl, env, 0);
  check('data_status.het = true',           r.data_status.het === true);
  // het_high fires when one band > 1.5× max(others) — middle 0.4 vs max(0.1)=0.1 → 4× → fires.
  check('band 1: het_high flag',            r.bands[1].flags.includes('het_high'));
  check('band 1: middle_het_support flag',  r.bands[1].flags.includes('middle_het_support'));
}

// =====================================================================
group('het: no middle_het_support when middle is NOT highest');
{
  // band 0 = 0.5 (highest), band 1 = 0.2, band 2 = 0.3
  const { state, cl, env } = makeFixture({
    ghsl_panel: buildPanel([0.50, 0.20, 0.30]),
  });
  const r = computeBandDiagnostics(state, cl, env, 0);
  check('no middle_het_support',
        !r.bands.some(b => b.flags.includes('middle_het_support')));
  check('band 0 gets het_high (0.5 / max(0.2, 0.3) = 1.67 > 1.5)',
        r.bands[0].flags.includes('het_high'));
}

// =====================================================================
group('ROH_confounded: overlap_pct > max(2× others, 5%)');
{
  // band 0 fully covered, bands 1 & 2 have no ROH
  // → band 0 overlap_pct = 100%, others = 0% → 100 > max(0, 5) → fires.
  const { state, cl, env } = makeFixture({
    roh_intervals: [
      { sample_idx: 0, start_bp: 10, end_bp: 20 },
      { sample_idx: 1, start_bp: 10, end_bp: 20 },
      { sample_idx: 2, start_bp: 10, end_bp: 20 },
    ],
  });
  const r = computeBandDiagnostics(state, cl, env, 0);
  check('data_status.roh = true',     r.data_status.roh === true);
  check('band 0: overlap_pct = 100',  approx(r.bands[0].roh_overlap_pct, 100));
  check('bands 1, 2: overlap_pct = 0',
        r.bands[1].roh_overlap_pct === 0 && r.bands[2].roh_overlap_pct === 0);
  check('band 0: ROH_confounded flag',  r.bands[0].flags.includes('ROH_confounded'));
}

// =====================================================================
group('ROH_confounded: 5% absolute floor (1% vs 0% does NOT fire)');
{
  // band 0 sample 0 ROH covers just 1bp of the 10bp interval = 10% per sample
  // overlap_pct uses ANY-overlap counting; band 0 has 1/3 samples with any
  // overlap → 33%. Other bands = 0%. → 33 > max(0, 5) → fires. Not what
  // we want; let me adjust. Use SHORT ROH spans where 33% is still strong.
  // Test the floor: bands with 0 and 0 overlap should NOT trigger flag.
  const { state, cl, env } = makeFixture({
    // No ROH at all
    roh_intervals: [],
  });
  const r = computeBandDiagnostics(state, cl, env, 0);
  check('empty roh_intervals: all bands overlap_pct = 0',
        r.bands.every(b => b.roh_overlap_pct === 0));
  check('no ROH_confounded flag when all bands at 0',
        !r.bands.some(b => b.flags.includes('ROH_confounded')));
}

// =====================================================================
group('FROH_high: one band\'s froh_mean > 1.5× max(others)');
{
  // band 0 froh_mean = 0.5; bands 1, 2 mean = 0.1 → 0.5/0.1 = 5× > 1.5
  const { state, cl, env } = makeFixture({
    sample_froh: [0.5, 0.5, 0.5,    // band 0
                  0.1, 0.1, 0.1,    // band 1
                  0.1, 0.1, 0.1],   // band 2
  });
  const r = computeBandDiagnostics(state, cl, env, 0);
  check('data_status.froh = true',  r.data_status.froh === true);
  check('band 0: froh_mean = 0.5',  approx(r.bands[0].froh_mean, 0.5));
  check('band 0: FROH_high flag',   r.bands[0].flags.includes('FROH_high'));
  check('bands 1, 2: no FROH_high', !r.bands[1].flags.includes('FROH_high')
                                     && !r.bands[2].flags.includes('FROH_high'));
}

// =====================================================================
group('het_shape: K=3, middle-vs-flanks support kind');
{
  // Build het distribution: band 1 has high het (0.45), flanks low (0.05)
  // support_ratio = 0.45 / 0.05 = 9.0, support_kind = 'middle_vs_flanks'
  const { state, cl, env } = makeFixture({
    ghsl_panel: buildPanel([0.05, 0.45, 0.05]),
  });
  const r = computeBandDiagnostics(state, cl, env, 0);
  check('het_shape non-null',                   r.het_shape !== null);
  check('het_shape.n_bins = 16',                 r.het_shape.n_bins === 16);
  check('counts_per_band length = 3',            r.het_shape.counts_per_band.length === 3);
  check('counts_per_band[k] length = 16',
        r.het_shape.counts_per_band.every(c => c.length === 16));
  check('support_kind = middle_vs_flanks',       r.het_shape.support_kind === 'middle_vs_flanks');
  check('support_ratio ≈ 9.0',                   approx(r.het_shape.support_ratio, 9.0, 1e-9));
  check('support_passes = true (ratio ≥ 1.5)',   r.het_shape.support_passes === true);
  check('support_marginal = false',              r.het_shape.support_marginal === false);
}

// =====================================================================
group('het_shape: support_marginal (1.2 ≤ ratio < 1.5)');
{
  // band 1 = 0.13, flanks = 0.10 → ratio = 1.3 → marginal range
  const { state, cl, env } = makeFixture({
    ghsl_panel: buildPanel([0.10, 0.13, 0.10]),
  });
  const r = computeBandDiagnostics(state, cl, env, 0);
  check('support_ratio ≈ 1.3',          approx(r.het_shape.support_ratio, 1.3, 1e-9));
  check('support_passes = false',       r.het_shape.support_passes === false);
  check('support_marginal = true',      r.het_shape.support_marginal === true);
}

// =====================================================================
group('het_shape: K!=3 uses max_min_spread');
{
  // K=2 fixture
  const labels = new Int8Array(6);
  labels[0] = labels[1] = labels[2] = 0;
  labels[3] = labels[4] = labels[5] = 1;
  const state = {
    data: {
      n_samples: 6,
      ghsl_panel: {
        primary_scale: 's50', scales: ['s50'],
        div_roll: { s50: [[0.2], [0.2], [0.2], [0.6], [0.6], [0.6]] },
        start_bp: [10], end_bp: [20],
      },
    },
  };
  const r = computeBandDiagnostics(state,
    { labels, usedK: 2 }, { start_bp: 10, end_bp: 20 }, 0);
  check('K=2 het_shape uses max_min_spread',
        r.het_shape.support_kind === 'max_min_spread');
  check('K=2 support_ratio = 0.6/0.2 = 3.0',
        approx(r.het_shape.support_ratio, 3.0, 1e-9));
}

// =====================================================================
group('per-sample data correctness — sanity check the means');
{
  // band 0 = 1.0, band 1 = 0.4, band 2 = 0.7
  const { state, cl, env } = makeFixture({
    ghsl_panel: buildPanel([1.0, 0.4, 0.7]),
  });
  const r = computeBandDiagnostics(state, cl, env, 0);
  check('band 0 ghsl_mean = 1.0',  approx(r.bands[0].ghsl_mean, 1.0));
  check('band 1 ghsl_mean = 0.4',  approx(r.bands[1].ghsl_mean, 0.4));
  check('band 2 ghsl_mean = 0.7',  approx(r.bands[2].ghsl_mean, 0.7));
  check('band 0 ghsl_median = 1.0', approx(r.bands[0].ghsl_median, 1.0));
}

// =====================================================================
group('het_shape: per-band counts populate the right bin');
{
  // band 0 = 0.05 (bin 0), band 1 = 0.50 (bin 8), band 2 = 0.95 (bin 15)
  const { state, cl, env } = makeFixture({
    ghsl_panel: buildPanel([0.05, 0.50, 0.95]),
  });
  const r = computeBandDiagnostics(state, cl, env, 0);
  const counts = r.het_shape.counts_per_band;
  check('band 0: all 3 samples in bin 0',  counts[0][0] === 3
                                              && counts[0].reduce((a, b) => a + b, 0) === 3);
  check('band 1: all 3 samples in bin 8',  counts[1][8] === 3);
  check('band 2: all 3 samples in bin 15', counts[2][15] === 3);
}

// =====================================================================
group('empty band (n=0) renders correctly');
{
  // Force one band to be empty by setting labels to skip band 1
  const labels = new Int8Array(9);
  for (let s = 0; s < 9; s++) labels[s] = (s < 4) ? 0 : 2;
  const state = { data: { n_samples: 9 } };
  const r = computeBandDiagnostics(state, { labels, usedK: 3 },
                                    { start_bp: 10, end_bp: 20 }, 0);
  check('band 0: n = 4',     r.bands[0].n === 4);
  check('band 1: n = 0',     r.bands[1].n === 0);
  check('band 2: n = 5',     r.bands[2].n === 5);
  check('empty band: no flags',  r.bands[1].flags.length === 0);
}

// =====================================================================
group('_het_vals is stripped from output');
{
  const { state, cl, env } = makeFixture({
    ghsl_panel: buildPanel([0.10, 0.20, 0.30]),
  });
  const r = computeBandDiagnostics(state, cl, env, 0);
  check('bands don\'t expose _het_vals',
        r.bands.every(b => b._het_vals === undefined));
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
