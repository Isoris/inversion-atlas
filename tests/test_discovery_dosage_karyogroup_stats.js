// tests/test_discovery_dosage_karyogroup_stats.js
//
// Per-window karyogroup statistics: Cramér's V, AMOVA FST proxy,
// separation, het-intermediacy, inside/outside classification, and the
// block-span (longest inside run) — the boundary diagnostic.

import { computeKaryogroupStats } from '../atlases/inversion/pages/discovery/dosage_heatmap/karyogroup_stats.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// Canonical fixture. rows[s] = dosage per marker for sample s.
// marker_pos_bp ascending so windows carry bp spans.
function makeCanonical(rows, pos) {
  const nS = rows.length, nM = rows[0].length;
  return {
    n_samples: nS, n_markers: nM,
    sample_labels: rows.map((_, i) => 's' + i),
    marker_pos_bp: pos || Array.from({ length: nM }, (_, i) => 1000 + i * 100),
    cellValue: (m, s) => rows[s][m],
  };
}

// 12 markers. Markers 0..7 = "inside": two karyogroups cleanly separated
// (group 0 ≈ dosage 0, group 1 ≈ dosage 2). Markers 8..11 = "outside":
// both groups ≈ dosage 1 (no separation → V≈0, FST≈0).
const INSIDE = 8, TOTAL = 12;
function mkSample(group) {
  const r = new Array(TOTAL);
  for (let m = 0; m < TOTAL; m++) {
    if (m < INSIDE) r[m] = group === 0 ? 0.0 : 2.0;   // separated inside
    else            r[m] = 1.0;                         // merged outside
  }
  return r;
}
const rows = [];
for (let i = 0; i < 6; i++) rows.push(mkSample(0));
for (let i = 0; i < 6; i++) rows.push(mkSample(1));
const canon = makeCanonical(rows);
const labels = Int32Array.from([0,0,0,0,0,0, 1,1,1,1,1,1]);

// =====================================================================
group('computeKaryogroupStats — basic shape');

const st = computeKaryogroupStats(canon, { labels, k: 2, nWindows: 6, minNWindow: 2 });
check('returns a result', !!st);
check('K + present groups', st.k === 2 && st.n_karyogroups_present === 2);
check('n_windows honoured (6)', st.n_windows === 6);
check('per-window arrays sized to n_windows',
  st.cramers_v.length === 6 && st.fst.length === 6 && st.separation.length === 6 && st.het_intermediacy.length === 6);
check('windows object array aligned', Array.isArray(st.windows) && st.windows.length === 6);
check('windows carry bp spans', Number.isFinite(st.windows[0].start_bp) && Number.isFinite(st.windows[0].end_bp));

// =====================================================================
group('inside vs outside signal');

// First 4 windows (cover markers 0..7) inside; last 2 (8..11) outside.
check('inside windows: high Cramér V', st.windows[0].cramers_v > 0.9 && st.windows[1].cramers_v > 0.9);
check('inside windows: elevated FST', st.windows[0].fst > 0.9);
check('outside windows: low Cramér V', !(st.windows[5].cramers_v > 0.5));
check('outside windows: FST drops', !(st.windows[5].fst > 0.05));
check('inside flagged, outside not', st.windows[0].inside === true && st.windows[5].inside === false);
check('n_inside + n_outside = n_windows', st.n_inside + st.n_outside === st.n_windows);
check('more inside than outside here', st.n_inside >= 4 && st.n_outside >= 1);
check('frac_inside in (0,1)', st.frac_inside > 0 && st.frac_inside < 1);

// =====================================================================
group('block span (longest inside run)');

check('block present', !!st.block);
check('block starts at window 0', st.block.start_win === 0);
check('block carries bp span', Number.isFinite(st.block.start_bp) && Number.isFinite(st.block.end_bp));
check('block n_windows matches run length', st.block.n_windows === (st.block.end_win - st.block.start_win + 1));
check('summary: inside FST ≥ all-window FST',
  !(st.summary.fst_mean_inside < st.summary.fst_mean_all) );

// =====================================================================
group('het intermediacy (3 groups)');

// 3 karyogroups: dosage 0, 1, 2 inside. Middle group should read as
// intermediate (≈1) between the extremes (0 and 2).
const rows3 = [];
function mk3(level) { const r = new Array(TOTAL); for (let m = 0; m < TOTAL; m++) r[m] = (m < INSIDE) ? level : 1.0; return r; }
for (let i = 0; i < 4; i++) rows3.push(mk3(0));
for (let i = 0; i < 4; i++) rows3.push(mk3(1));
for (let i = 0; i < 4; i++) rows3.push(mk3(2));
const canon3 = makeCanonical(rows3);
const labels3 = Int32Array.from([0,0,0,0, 1,1,1,1, 2,2,2,2]);
const st3 = computeKaryogroupStats(canon3, { labels: labels3, k: 3, nWindows: 6, minNWindow: 2 });
check('3-group het intermediacy high inside', st3.windows[0].het_intermediacy > 0.9);
check('separation high inside (3 groups)', st3.windows[0].separation > 0.5);

// =====================================================================
group('window-count knob + thresholds');

const stHi = computeKaryogroupStats(canon, { labels, k: 2, nWindows: 12, minNWindow: 2 });
check('higher nWindows → finer resolution', stHi.n_windows === 12);
const stThr = computeKaryogroupStats(canon, { labels, k: 2, nWindows: 6, minNWindow: 2, vThreshold: 0.99, fstThreshold: 0.99 });
check('strict thresholds shrink inside set', stThr.n_inside <= st.n_inside);

// =====================================================================
group('degenerate guards');

check('null labels → null', computeKaryogroupStats(canon, {}) === null);
check('null canonical → null', computeKaryogroupStats(null, { labels }) === null);
check('all-same-label → low/zero FST (no between-group var)', (() => {
  const one = computeKaryogroupStats(canon, { labels: new Int32Array(12).fill(0), k: 1, nWindows: 4, minNWindow: 2 });
  return one && !(one.summary.fst_mean_all > 0.01);
})());
check('small windows skipped (minNWindow)', (() => {
  const sparse = computeKaryogroupStats(canon, { labels, k: 2, nWindows: 6, minNWindow: 999 });
  // every window under-populated → none scored
  return sparse && sparse.n_inside === 0 && !Number.isFinite(sparse.cramers_v[0]);
})());

// =====================================================================
console.log('\n=================');
console.log('pass: ' + pass + '   fail: ' + fail);
console.log('=================');
if (fail > 0 && typeof process !== 'undefined') process.exitCode = 1;
