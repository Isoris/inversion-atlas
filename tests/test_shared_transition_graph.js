// tests/test_shared_transition_graph.js
//
// Unit coverage for shared/transition_graph.js — structural-haplotype
// transition graph computation (legacy lines 38020-38150).

import * as TG from '../atlases/inversion/shared/transition_graph.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('Constants');
check('hotspot threshold = 0.30',          TG.SHTG_HOTSPOT_THRESHOLD === 0.30);
check('min samples = 5',                   TG.SHTG_MIN_SAMPLES === 5);

// -----------------------------------------------------------------------------
group('computeShtgBoundaryStats: stable boundary (no transitions)');
// 10 samples, all stay in same band, identity perm
const cl = { labels: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1] };
const cr = { labels: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1] };
const identityPerm = [0, 1];
const stable = TG.computeShtgBoundaryStats(cl, cr, identityPerm, {
  leftIdx: 0, rightIdx: 1,
});
check('stable: n_samples = 10',            stable.n_samples === 10);
check('stable: n_changed = 0',             stable.n_changed === 0);
check('stable: transition_rate = 0',       stable.transition_rate === 0);
check('stable: edges array present',       Array.isArray(stable.edges));
check('stable: edges sorted desc',
      stable.edges[0].count >= stable.edges[stable.edges.length - 1].count);

// -----------------------------------------------------------------------------
group('computeShtgBoundaryStats: high transitions');
// Half the fish change bands
const cl2 = { labels: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1] };
const cr2 = { labels: [0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1] };
const hot = TG.computeShtgBoundaryStats(cl2, cr2, identityPerm);
check('hot: n_samples = 12',               hot.n_samples === 12);
check('hot: n_changed = 6',                hot.n_changed === 6);
check('hot: transition_rate = 0.5',        hot.transition_rate === 0.5);
check('hot: 4 edge entries',               hot.edges.length === 4);

// -----------------------------------------------------------------------------
group('computeShtgBoundaryStats: Hungarian perm');
// Right side is band-relabeled: 0↔1. Perm [1, 0] aligns them.
const cl3 = { labels: [0, 0, 0, 1, 1, 1, 0, 0, 1, 1] };
const cr3 = { labels: [1, 1, 1, 0, 0, 0, 1, 1, 0, 0] };  // exact same partition, just renamed
const aligned = TG.computeShtgBoundaryStats(cl3, cr3, [1, 0]);
check('perm: aligned → no transitions',    aligned.transition_rate === 0);

// Without perm (identity) → all "changed"
const unaligned = TG.computeShtgBoundaryStats(cl3, cr3, null);
check('no perm: all changed → rate 1',     unaligned.transition_rate === 1);

// -----------------------------------------------------------------------------
group('computeShtgBoundaryStats: edge cases');
check('null left → null',                  TG.computeShtgBoundaryStats(null, cr, identityPerm) === null);
check('null right → null',                 TG.computeShtgBoundaryStats(cl, null, identityPerm) === null);
check('label-length mismatch → null',
      TG.computeShtgBoundaryStats({ labels: [0] }, { labels: [0, 1] }, identityPerm) === null);

// Below min samples
const tiny = TG.computeShtgBoundaryStats({ labels: [0, 1] }, { labels: [0, 1] }, identityPerm);
check('below min_samples → null',          tiny === null);

// Negative labels excluded
const withNeg = TG.computeShtgBoundaryStats(
  { labels: [0, 0, -1, 1, 1, -1, 0, 0, 1, 1, 0, 0] },
  { labels: [0, 0, -1, 1, 1,  0, 0, 0, 1, 1, 0, 0] },
  identityPerm,
);
check('negative labels excluded: n_samples = 10',
      withNeg.n_samples === 10);

// fixedKLabels used when present
const withFixed = TG.computeShtgBoundaryStats(
  { labels: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], fixedKLabels: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
  { labels: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
  identityPerm,
);
check('fixedKLabels preferred (rate=0 after identity)',
      withFixed.transition_rate === 0);

// Envelope position
const withEnv = TG.computeShtgBoundaryStats(cl, cr, identityPerm, {
  leftEnvelope:  { end_bp: 1_000_000 },
  rightEnvelope: { start_bp: 2_000_000 },
});
check('position_mb derived: 1.5',          withEnv.position_mb === 1.5);

// -----------------------------------------------------------------------------
group('computeStructuralHaplotypeTransitionGraph');
const clusters = [
  { labels: [0, 1, 0, 1, 0, 1, 0, 1] },                 // L2 0
  { labels: [0, 1, 0, 1, 0, 1, 0, 1] },                 // L2 1 (stable)
  { labels: [1, 0, 1, 0, 1, 0, 1, 0] },                 // L2 2 (50% diff, identity perm)
  { labels: [1, 0, 1, 0, 1, 0, 1, 0] },                 // L2 3 (stable)
];
const envs = [
  { start_bp: 0,         end_bp: 1_000_000 },
  { start_bp: 1_000_000, end_bp: 2_000_000 },
  { start_bp: 2_000_000, end_bp: 3_000_000 },
  { start_bp: 3_000_000, end_bp: 4_000_000 },
];
const state = { data: { l2_envelopes: envs } };
const graph = TG.computeStructuralHaplotypeTransitionGraph(state, {
  getCluster: (i) => clusters[i],
  getPerm: () => [0, 1],
});
check('graph: 3 boundaries',               graph.boundaries.length === 3);
check('graph: middle boundary is hotspot (>0.30)',
      graph.boundaries[1].transition_rate >= TG.SHTG_HOTSPOT_THRESHOLD);
check('graph: hotspots contains middle',
      graph.hotspots.length === 1 && graph.hotspots[0].l2_left === 1);
check('graph: stable boundaries not hotspot',
      graph.boundaries[0].transition_rate === 0);

// Empty / no envelopes
check('graph: no envelopes → empty',
      TG.computeStructuralHaplotypeTransitionGraph({}, { getCluster: () => null }).boundaries.length === 0);
check('graph: no getCluster → empty',
      TG.computeStructuralHaplotypeTransitionGraph(state, {}).boundaries.length === 0);

// Custom threshold
const graphLow = TG.computeStructuralHaplotypeTransitionGraph(state, {
  getCluster: (i) => clusters[i],
  getPerm: () => [0, 1],
  hotspotThreshold: 0.01,
});
check('custom threshold: 1 hotspot (middle has rate 1)',
      graphLow.hotspots.length === 1);

// -----------------------------------------------------------------------------
group('summarizeTransitionBoundary');
const stats = graph.boundaries[1];
const summary = TG.summarizeTransitionBoundary(stats);
check('summary: position_mb forwarded',    summary.position_mb === stats.position_mb);
check('summary: rate forwarded',           summary.transition_rate === stats.transition_rate);
check('summary: is_hotspot true',          summary.is_hotspot === true);
check('summary: top_edges_label format',   /^B\d+→B\d+:\d+/.test(summary.top_edges_label));

// Stable boundary → not a hotspot
const stableSummary = TG.summarizeTransitionBoundary(graph.boundaries[0]);
check('summary stable: is_hotspot false',  stableSummary.is_hotspot === false);

check('summary: null stats → null',        TG.summarizeTransitionBoundary(null) === null);

// Custom threshold
const cs = TG.summarizeTransitionBoundary(graph.boundaries[0], 0.01);
check('summary custom threshold: stable=false vs 0.01',  cs.is_hotspot === false);

// -----------------------------------------------------------------------------
group('drawTransitionRateStrip');
class FakeCtx {
  constructor() {
    this.calls = [];
    this.fillStyle = '';
    this.strokeStyle = '';
    this.lineWidth = 1;
  }
  save()    { this.calls.push(['save']); }
  restore() { this.calls.push(['restore']); }
  fillRect(x, y, w, h)   { this.calls.push(['fillRect', x, y, w, h, this.fillStyle]); }
  strokeRect(x, y, w, h) { this.calls.push(['strokeRect', x, y, w, h]); }
  beginPath() { this.calls.push(['beginPath']); }
  moveTo(x, y) { this.calls.push(['moveTo', x, y]); }
  lineTo(x, y) { this.calls.push(['lineTo', x, y]); }
  stroke()    { this.calls.push(['stroke']); }
}

const graphForDraw = {
  boundaries: [
    { position_mb: 1.0, transition_rate: 0.05 },  // green (low)
    { position_mb: 2.0, transition_rate: 0.20 },  // amber (medium)
    { position_mb: 3.0, transition_rate: 0.50 },  // red (hotspot)
    { position_mb: 4.0, transition_rate: 0.01 },  // skipped (< 0.02)
  ],
};

const drawCtx = new FakeCtx();
TG.drawTransitionRateStrip(drawCtx, { l: 50, t: 30 }, 600, 200, 0, 5, graphForDraw);
check('drawStrip: save/restore',
      drawCtx.calls[0][0] === 'save' && drawCtx.calls[drawCtx.calls.length - 1][0] === 'restore');
check('drawStrip: backdrop fillRect drawn',
      drawCtx.calls.some(c => c[0] === 'fillRect' && c[5].includes('40, 50, 70')));
// 3 bars: green/amber/red (the 4th is < 0.02 → skipped)
const fillRects = drawCtx.calls.filter(c => c[0] === 'fillRect');
check('drawStrip: 1 backdrop + 3 per-boundary bars',  fillRects.length === 4);

// Verify color tiers
const colors = fillRects.slice(1).map(c => c[5]);
check('drawStrip: green bar (low rate)',   colors.some(c => c.includes('60, 192, 138')));
check('drawStrip: amber bar (medium rate)', colors.some(c => c.includes('245, 165, 36')));
check('drawStrip: red bar (hotspot)',       colors.some(c => c.includes('224, 85, 92')));

// Hotspot tick: full plot height stroke
check('drawStrip: hotspot tick stroked',
      drawCtx.calls.some(c => c[0] === 'stroke'));

// Frame
check('drawStrip: strokeRect frame',
      drawCtx.calls.some(c => c[0] === 'strokeRect'));

// Custom threshold
const drawCtx2 = new FakeCtx();
TG.drawTransitionRateStrip(drawCtx2, { l: 0, t: 30 }, 600, 200, 0, 5, graphForDraw, { hotspotThreshold: 0.15 });
// Now boundaries at 0.20 + 0.50 both become "red"
const colors2 = drawCtx2.calls.filter(c => c[0] === 'fillRect').slice(1).map(c => c[5]);
const redCount2 = colors2.filter(c => c.includes('224, 85, 92')).length;
check('drawStrip: lower threshold → more reds',  redCount2 >= 2);

// Outside visible range
const ctxOut = new FakeCtx();
TG.drawTransitionRateStrip(ctxOut, { l: 0, t: 30 }, 600, 200, 100, 200, graphForDraw);
const fillsOut = ctxOut.calls.filter(c => c[0] === 'fillRect');
check('drawStrip: outside range → only backdrop',  fillsOut.length === 1);

// Empty graph
let emptyHandled = true;
try {
  TG.drawTransitionRateStrip(drawCtx, { l: 0, t: 30 }, 600, 200, 0, 5, null);
  TG.drawTransitionRateStrip(drawCtx, { l: 0, t: 30 }, 600, 200, 0, 5, { boundaries: [] });
} catch (_) { emptyHandled = false; }
check('drawStrip: empty/null graph handled silently', emptyHandled);

// Headless safety
let headlessOK = true;
try {
  TG.drawTransitionRateStrip(null, { l: 0, t: 0 }, 100, 100, 0, 1, graphForDraw);
  TG.drawTransitionRateStrip({}, { l: 0, t: 0 }, 100, 100, 0, 1, graphForDraw);
} catch (_) { headlessOK = false; }
check('drawStrip: headless safety',  headlessOK);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
