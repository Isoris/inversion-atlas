// tests/test_shared_ghsl_panel.js

import {
  GHSL_DEFAULT_HALF_FLANK,
  ghslPanel,
  ghslPanelScales,
  ghslPanelPrimaryScale,
  ghslDivAt,
  ghslAggregateRange,
  ghslAggregateFocal,
  ghslAggregateInterval,
  ghslKStripes,
  ghslKStripesAvailableK,
} from '../atlases/inversion/shared/ghsl_panel.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
// Fixture: 3 samples × 10 windows × 2 scales
// =====================================================================
function makeState() {
  const matrixA = [];   // scale s25k
  const matrixB = [];   // scale s100k
  for (let s = 0; s < 3; s++) {
    const rowA = new Float32Array(10);
    const rowB = new Float32Array(10);
    for (let w = 0; w < 10; w++) {
      rowA[w] = (s + 1) * (w + 1);             // 1, 2, ..., 10 for s=0
      rowB[w] = 100 + (s + 1) * (w + 1);       // 101..110 for s=0
    }
    // Sample 1, window 5: insert NaN to test NaN handling
    if (s === 1) rowA[5] = NaN;
    matrixA.push(rowA);
    matrixB.push(rowB);
  }
  return {
    data: {
      ghsl_panel: {
        n_samples: 3,
        n_windows: 10,
        samples: ['s0', 's1', 's2'],
        window_idx: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        scales: ['s25k', 's100k'],
        primary_scale: 's25k',
        div_roll: { s25k: matrixA, s100k: matrixB },
      },
      ghsl_kstripes: {
        by_k: {
          '3': { stripe_per_sample: [0, 1, 2],
                 stripe_means: [0.1, 0.2, 0.3],
                 stripe_medians: [0.1, 0.2, 0.3],
                 n_per_stripe: [1, 1, 1] },
          '5': { stripe_per_sample: [0, 1, 2, 3, 4],
                 n_per_stripe: [1, 1, 1, 1, 1] },
        },
      },
    },
  };
}

// =====================================================================
group('constants');
check('DEFAULT_HALF_FLANK = 5',                GHSL_DEFAULT_HALF_FLANK === 5);

// =====================================================================
group('panel accessors');
{
  const state = makeState();
  check('ghslPanel returns layer',              ghslPanel(state) !== null
                                                && ghslPanel(state).n_samples === 3);
  check('scales = [s25k, s100k]',
        JSON.stringify(ghslPanelScales(state)) === JSON.stringify(['s25k', 's100k']));
  check('primary scale = s25k',                 ghslPanelPrimaryScale(state) === 's25k');
}
check('null state → null',                    ghslPanel(null) === null);
check('no panel → null',                      ghslPanel({}) === null);
check('null state → []',                      ghslPanelScales(null).length === 0);
check('null state → null primary',            ghslPanelPrimaryScale(null) === null);
{
  // No primary_scale set → falls back to first scale
  const state = makeState();
  delete state.data.ghsl_panel.primary_scale;
  check('no primary_scale → first scale fallback', ghslPanelPrimaryScale(state) === 's25k');
}
{
  // Both missing → null
  const state = { data: { ghsl_panel: {} } };
  check('no scales + no primary → null',        ghslPanelPrimaryScale(state) === null);
}

// =====================================================================
group('ghslDivAt');
{
  const state = makeState();
  check('s=0 w=0 default scale → 1',            ghslDivAt(state, 0, 0) === 1);
  check('s=0 w=9 default scale → 10',           ghslDivAt(state, 0, 9) === 10);
  check('s=2 w=4 default scale → 15',           ghslDivAt(state, 2, 4) === 15);
  check('s=0 w=0 explicit s100k → 101',         ghslDivAt(state, 0, 0, 's100k') === 101);
  check('NaN cell → null',                      ghslDivAt(state, 1, 5) === null);
  check('out-of-range sample → null',           ghslDivAt(state, 99, 0) === null);
  check('negative sample → null',               ghslDivAt(state, -1, 0) === null);
  check('out-of-range window → null',           ghslDivAt(state, 0, 99) === null);
  check('negative window → null',               ghslDivAt(state, 0, -1) === null);
  check('unknown scale → null',                 ghslDivAt(state, 0, 0, 'oops') === null);
}
check('null state → null',                    ghslDivAt(null, 0, 0) === null);

// =====================================================================
group('ghslAggregateRange');
{
  const state = makeState();
  // Whole-panel aggregation for sample 0: values 1..10
  const r = ghslAggregateRange(state, 0, 9);
  check('returns object',                        !!r);
  check('samples array length 3',                r.samples.length === 3);
  check('mean[0] = 5.5 (1..10)',                 Math.abs(r.mean[0] - 5.5) < 1e-6);
  check('median[0] = 5.5',                       Math.abs(r.median[0] - 5.5) < 1e-6);
  check('n[0] = 10',                             r.n[0] === 10);
  // Sample 1 has NaN at w=5 → 9 finite values, mean = (2+4+6+8+10+14+16+18+20)/9 = 10.888...
  check('NaN excluded: n[1] = 9',                r.n[1] === 9);
  check('mean[1] computed from finite only',
        Math.abs(r.mean[1] - (2 + 4 + 6 + 8 + 10 + 14 + 16 + 18 + 20) / 9) < 1e-5);
  check('colStart = 0, colEnd = 9',              r.colStart === 0 && r.colEnd === 9);
  check('scale defaults to primary',             r.scale === 's25k');
}
{
  // Reversed range arg order: function should normalize
  const state = makeState();
  const r = ghslAggregateRange(state, 5, 2);
  check('reversed args: colStart = 2',           r.colStart === 2);
  check('reversed args: colEnd = 5',             r.colEnd === 5);
}
{
  // colStart clamped to 0, colEnd to n_windows-1
  const state = makeState();
  const r = ghslAggregateRange(state, -5, 99);
  check('negative clamped to 0',                 r.colStart === 0);
  check('overflow clamped to n_windows-1',       r.colEnd === 9);
}
{
  // Sample with no finite in range → mean/median null
  const state = makeState();
  // Window 5 only → for s=1, only NaN → mean/median null
  const r = ghslAggregateRange(state, 5, 5);
  check('all-NaN sample 1: mean null',           r.mean[1] === null);
  check('all-NaN sample 1: median null',         r.median[1] === null);
  check('all-NaN sample 1: n = 0',               r.n[1] === 0);
  check('finite sample 0: mean = 6',             Math.abs(r.mean[0] - 6) < 1e-6);
}
{
  // Explicit scale
  const state = makeState();
  const r = ghslAggregateRange(state, 0, 9, 's100k');
  // s100k for s=0: 101..110, mean 105.5
  check('explicit scale: mean[0] = 105.5',       Math.abs(r.mean[0] - 105.5) < 1e-6);
  check('scale tagged on result',                r.scale === 's100k');
}
check('null state → null',                    ghslAggregateRange(null, 0, 9) === null);
check('unknown scale → null',                 ghslAggregateRange(makeState(), 0, 9, 'oops') === null);

// =====================================================================
group('ghslAggregateFocal');
{
  const state = makeState();
  // Focal col 5, halfFlank 2 → cols 3..7
  const r = ghslAggregateFocal(state, 5, 2);
  check('returns object',                        !!r);
  check('colStart = 3 (focal-halfFlank)',        r.colStart === 3);
  check('colEnd = 7 (focal+halfFlank)',          r.colEnd === 7);
  check('focalCol preserved',                    r.focalCol === 5);
  check('halfFlank preserved',                   r.halfFlank === 2);
  // s=0 mean over [3..7] = (4+5+6+7+8)/5 = 6
  check('mean[0] = 6',                           Math.abs(r.mean[0] - 6) < 1e-6);
}
{
  // Default halfFlank = 5
  const state = makeState();
  const r = ghslAggregateFocal(state, 5);
  check('default halfFlank applied',             r.halfFlank === GHSL_DEFAULT_HALF_FLANK);
  check('default colStart = 0',                  r.colStart === 0);
  check('default colEnd = 9',                    r.colEnd === 9);
}
{
  // Out-of-range halfFlank → default
  const state = makeState();
  const r = ghslAggregateFocal(state, 5, -1);
  check('negative halfFlank → default',          r.halfFlank === GHSL_DEFAULT_HALF_FLANK);
}
{
  // Focal near edge: flanks clipped to panel range
  const state = makeState();
  const r = ghslAggregateFocal(state, 0, 5);
  check('edge focal: clipped at 0',              r.colStart === 0);
  check('edge focal: extends to 5',              r.colEnd === 5);
}
check('null state → null',                    ghslAggregateFocal(null, 5, 2) === null);

// =====================================================================
group('ghslAggregateInterval');
{
  const state = makeState();
  // Interval [2..7], focal at 5 with halfFlank 1 → aggregate cols [4..6]
  const r = ghslAggregateInterval(state, 2, 7, 5, 1);
  check('returns object',                        !!r);
  check('intervalStart = 2',                     r.intervalStart === 2);
  check('intervalEnd = 7',                       r.intervalEnd === 7);
  check('focalCol = 5',                          r.focalCol === 5);
  check('halfFlank = 1',                         r.halfFlank === 1);
  check('clipped colStart = 4',                  r.colStart === 4);
  check('clipped colEnd = 6',                    r.colEnd === 6);
  // s=0 mean over [4..6] = (5+6+7)/3 = 6
  check('mean[0] = 6',                           Math.abs(r.mean[0] - 6) < 1e-6);
}
{
  // Default focal = midpoint
  const state = makeState();
  const r = ghslAggregateInterval(state, 2, 6, null, 1);
  check('default focal = floor((2+6)/2) = 4',    r.focalCol === 4);
}
{
  // Focal outside interval → clamped INTO interval
  const state = makeState();
  const r = ghslAggregateInterval(state, 2, 4, 99, 1);
  check('focal clamped into interval (end)',     r.focalCol === 4);
  const r2 = ghslAggregateInterval(state, 5, 8, -1, 1);
  check('focal clamped into interval (start)',   r2.focalCol === 5);
}
{
  // Flanks clipped to interval (not panel)
  const state = makeState();
  // Interval [3..5], focal 5, halfFlank 10 → clipped to [3..5]
  const r = ghslAggregateInterval(state, 3, 5, 5, 10);
  check('flanks clipped to interval',            r.colStart === 3 && r.colEnd === 5);
}
{
  // Reversed interval args
  const state = makeState();
  const r = ghslAggregateInterval(state, 7, 3, 5, 1);
  check('reversed interval: normalized',         r.intervalStart === 3 && r.intervalEnd === 7);
}
{
  // Out-of-panel interval clipped
  const state = makeState();
  const r = ghslAggregateInterval(state, -5, 99, 5, 1);
  check('negative interval clamped to 0',        r.intervalStart === 0);
  check('overflow interval clamped to 9',        r.intervalEnd === 9);
}
check('null state → null',                    ghslAggregateInterval(null, 0, 5, 2, 1) === null);

// =====================================================================
group('ghslKStripes');
{
  const state = makeState();
  const k3 = ghslKStripes(state, 3);
  check('K=3 returns entry',                     !!k3);
  check('K=3 stripe_per_sample length 3',        k3.stripe_per_sample.length === 3);
  const k5 = ghslKStripes(state, 5);
  check('K=5 returns entry',                     !!k5);
  check('K=99 → null',                           ghslKStripes(state, 99) === null);
}
check('null state → null',                    ghslKStripes(null, 3) === null);
check('no kstripes → null',                   ghslKStripes({ data: {} }, 3) === null);

// =====================================================================
group('ghslKStripesAvailableK');
{
  const state = makeState();
  const ks = ghslKStripesAvailableK(state);
  check('returns sorted [3, 5]',                 JSON.stringify(ks) === JSON.stringify([3, 5]));
}
check('null state → []',                      ghslKStripesAvailableK(null).length === 0);
check('no kstripes → []',                     ghslKStripesAvailableK({}).length === 0);
{
  // by_k with non-numeric keys filtered
  const state = { data: { ghsl_kstripes: { by_k: { '3': {}, 'foo': {}, '7': {} } } } };
  const ks = ghslKStripesAvailableK(state);
  check('non-numeric keys filtered',             JSON.stringify(ks) === JSON.stringify([3, 7]));
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
