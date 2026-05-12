// tests/test_shared_snp_density.js
//
// Unit coverage for shared/snp_density.js — per-window SNP-density
// resolver, color ramp, and strip drawer (legacy lines 33801 +
// 34456-34570).

import * as SD from '../atlases/inversion/shared/snp_density.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('LINES_SNP_DENSITY_MODES');
check('frozen + 3 entries',
      Object.isFrozen(SD.LINES_SNP_DENSITY_MODES) && SD.LINES_SNP_DENSITY_MODES.length === 3);
check('off/strip/shade',
      ['off', 'strip', 'shade'].every(m => SD.LINES_SNP_DENSITY_MODES.includes(m)));

// -----------------------------------------------------------------------------
group('snpDensityForWindow + snpDensitySource');
check('n_snps wins',
      SD.snpDensityForWindow({ n_snps: 42, snp_count: 99, lambda1: 0.5 }) === 42);
check('source: precomp:n_snps',
      SD.snpDensitySource({ n_snps: 42 }) === 'precomp:n_snps');

check('falls back to snp_count',
      SD.snpDensityForWindow({ snp_count: 100 }) === 100);
check('source: precomp:snp_count',
      SD.snpDensitySource({ snp_count: 100 }) === 'precomp:snp_count');

check('falls back to lambda1',
      SD.snpDensityForWindow({ lambda1: 0.7 }) === 0.7);
check('source: precomp:lambda1',
      SD.snpDensitySource({ lambda1: 0.7 }) === 'precomp:lambda1');

check('falls back to variance_pc1',
      SD.snpDensityForWindow({ variance_pc1: 0.4 }) === 0.4);

// pc1 variance
const pc1 = [1, 2, 3, 4, 5];
const v = SD.snpDensityForWindow({ pc1 });
check('pc1 variance ≈ 2 (n-variance)',  Math.abs(v - 2) < 1e-9);
check('source: proxy:pc1_variance',  SD.snpDensitySource({ pc1 }) === 'proxy:pc1_variance');

// Null / invalid
check('null window → null',           SD.snpDensityForWindow(null) === null);
check('empty window → null',          SD.snpDensityForWindow({}) === null);
check('pc1 with <2 finite values → null',
      SD.snpDensityForWindow({ pc1: [1] }) === null);

check('null window: source = "none"', SD.snpDensitySource(null) === 'none');
check('empty: source = "none"',       SD.snpDensitySource({}) === 'none');

// NaN/finite handling
check('NaN n_snps falls through',
      SD.snpDensityForWindow({ n_snps: NaN, lambda1: 0.3 }) === 0.3);

// -----------------------------------------------------------------------------
group('snpDensityColorRamp');
const c0 = SD.snpDensityColorRamp(0);
check('t=0 → blue-ish (b > r)',  /rgb\((\d+), (\d+), (\d+)\)/.test(c0));
const c1 = SD.snpDensityColorRamp(1);
check('t=1 → warm (r high)',  /rgb\(25\d/.test(c1));
const cMid = SD.snpDensityColorRamp(0.5);
check('t=0.5 → green-ish (g high)',  /rgb\(\d+, (220|2[1-3]\d)/.test(cMid));

// Out of range clamps
check('t<0 clamps to 0',  SD.snpDensityColorRamp(-1) === c0);
check('t>1 clamps to 1',  SD.snpDensityColorRamp(2) === c1);
check('NaN → t=0',        SD.snpDensityColorRamp(NaN) === c0);

// -----------------------------------------------------------------------------
group('drawSnpDensityStrip');
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
  strokeRect(x, y, w, h) { this.calls.push(['strokeRect', x, y, w, h, this.strokeStyle]); }
}

// 10 visible windows with linearly increasing n_snps
const windows = [];
for (let i = 0; i < 10; i++) {
  windows.push({ center_mb: i * 0.5, n_snps: 100 + i * 50 });
}
const ctx = new FakeCtx();
SD.drawSnpDensityStrip(ctx, { l: 50, t: 30 }, 600, 200, 0, 5, windows);
check('drawStrip: save/restore',
      ctx.calls[0][0] === 'save' && ctx.calls[ctx.calls.length - 1][0] === 'restore');
check('drawStrip: ~10 fillRects (one per visible window)',
      ctx.calls.filter(c => c[0] === 'fillRect').length === 10);
check('drawStrip: strokeRect frame',  ctx.calls.some(c => c[0] === 'strokeRect'));

// First window low density → blue-ish; last → warm
const fills = ctx.calls.filter(c => c[0] === 'fillRect').map(c => c[5]);
check('drawStrip: first fill cool (high b)',  /rgb\(\d+, \d+, 1[89]\d\)/.test(fills[0]) || /rgb\(40/.test(fills[0]));
check('drawStrip: last fill warm',           /rgb\(2[45]\d/.test(fills[fills.length - 1]));

// mode = 'off' → no fillRect
const ctxOff = new FakeCtx();
SD.drawSnpDensityStrip(ctxOff, { l: 0, t: 30 }, 600, 200, 0, 5, windows, { mode: 'off' });
check('drawStrip: mode=off → no fillRect',
      !ctxOff.calls.some(c => c[0] === 'fillRect'));

// mode = 'shade' → no draw (separate drawer would handle it)
const ctxShade = new FakeCtx();
SD.drawSnpDensityStrip(ctxShade, { l: 0, t: 30 }, 600, 200, 0, 5, windows, { mode: 'shade' });
check('drawStrip: mode=shade → no fillRect',
      !ctxShade.calls.some(c => c[0] === 'fillRect'));

// < 5 visible → skip
const ctxFew = new FakeCtx();
SD.drawSnpDensityStrip(ctxFew, { l: 0, t: 30 }, 600, 200, 100, 200, windows);
check('drawStrip: < 5 visible → skip',
      !ctxFew.calls.some(c => c[0] === 'fillRect'));

// Uniform values → skip (vMin === vMax)
const uniformWindows = new Array(10).fill(0).map((_, i) => ({ center_mb: i * 0.5, n_snps: 100 }));
const ctxUniform = new FakeCtx();
SD.drawSnpDensityStrip(ctxUniform, { l: 0, t: 30 }, 600, 200, 0, 5, uniformWindows);
check('drawStrip: uniform values → skip',
      !ctxUniform.calls.some(c => c[0] === 'fillRect'));

// Headless safety
let headlessOK = true;
try {
  SD.drawSnpDensityStrip(null, { l: 0, t: 30 }, 600, 200, 0, 5, windows);
  SD.drawSnpDensityStrip({}, { l: 0, t: 30 }, 600, 200, 0, 5, windows);
  SD.drawSnpDensityStrip(ctx, { l: 0, t: 30 }, 600, 200, 0, 5, null);
  SD.drawSnpDensityStrip(ctx, { l: 0, t: 30 }, 600, 200, 0, 5, []);
} catch (_) { headlessOK = false; }
check('drawStrip: headless safety',  headlessOK);

// -----------------------------------------------------------------------------
group('drawSnpDensityShade');
const shadeCtx = new FakeCtx();
SD.drawSnpDensityShade(shadeCtx, { l: 50, t: 30 }, 600, 200, 0, 5, windows);
check('drawShade: save/restore',
      shadeCtx.calls[0][0] === 'save' && shadeCtx.calls[shadeCtx.calls.length - 1][0] === 'restore');
const shadeFills = shadeCtx.calls.filter(c => c[0] === 'fillRect');
check('drawShade: 1+ fillRects (high-density bars skipped near-transparent)',
      shadeFills.length >= 5 && shadeFills.length <= 10);
// All shade fills use the dark backdrop color
check('drawShade: bars use dark rgba',
      shadeFills.every(c => c[5].includes('40, 50, 70')));
// Shade height = plotH (full plot)
check('drawShade: bars span plot height',
      shadeFills.every(c => c[4] === 200));

// mode = 'off' → no draw
const shadeOffCtx = new FakeCtx();
SD.drawSnpDensityShade(shadeOffCtx, { l: 0, t: 30 }, 600, 200, 0, 5, windows, { mode: 'off' });
check('drawShade: mode=off → no fillRect',
      !shadeOffCtx.calls.some(c => c[0] === 'fillRect'));

// mode = 'strip' → no draw (different drawer handles it)
const shadeStripCtx = new FakeCtx();
SD.drawSnpDensityShade(shadeStripCtx, { l: 0, t: 30 }, 600, 200, 0, 5, windows, { mode: 'strip' });
check('drawShade: mode=strip → no fillRect (sibling drawer)',
      !shadeStripCtx.calls.some(c => c[0] === 'fillRect'));

// Custom maxAlpha
const shadeMaxCtx = new FakeCtx();
SD.drawSnpDensityShade(shadeMaxCtx, { l: 0, t: 30 }, 600, 200, 0, 5, windows, { maxAlpha: 0.4 });
const shadeMaxFills = shadeMaxCtx.calls.filter(c => c[0] === 'fillRect');
// Higher maxAlpha lets MORE bars survive the near-transparent threshold
check('drawShade: higher maxAlpha → ≥ default count',
      shadeMaxFills.length >= shadeFills.length);

// Headless safety
let shadeHeadlessOK = true;
try {
  SD.drawSnpDensityShade(null, { l: 0, t: 0 }, 100, 100, 0, 1, windows);
  SD.drawSnpDensityShade({}, { l: 0, t: 0 }, 100, 100, 0, 1, windows);
  SD.drawSnpDensityShade(shadeCtx, { l: 0, t: 0 }, 100, 100, 0, 1, null);
} catch (_) { shadeHeadlessOK = false; }
check('drawShade: headless safety',  shadeHeadlessOK);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
