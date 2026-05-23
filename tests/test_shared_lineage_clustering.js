// tests/test_shared_lineage_clustering.js
//
// Unit coverage for shared/lineage_clustering.js (legacy lines
// 39260-39296).

import * as LC from '../atlases/popstats/shared/lineage_clustering.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('Constants');
check('LINEAGE_DEFAULT_THRESHOLD = 0.5',   LC.LINEAGE_DEFAULT_THRESHOLD === 0.5);
check('LINEAGE_CHAIN_BREAK_AGREEMENT = 0.5', LC.LINEAGE_CHAIN_BREAK_AGREEMENT === 0.5);
check('LINEAGE_MIN_L2_FOR_COMPUTE = 3',    LC.LINEAGE_MIN_L2_FOR_COMPUTE === 3);
check('LINEAGE_MIN_FISH_PER_LINEAGE = 1',  LC.LINEAGE_MIN_FISH_PER_LINEAGE === 1);

// -----------------------------------------------------------------------------
group('lineageClustering: 4-sample fixture');
// 4 samples: 0+1 share lineage (concordance 0.9 → distance 0.1),
// 2+3 share lineage (concordance 0.95 → distance 0.05), cross-pairs
// have concordance 0.1 → distance 0.9.
const N = 4;
const M = new Float32Array(N * N);
const _set = (i, j, v) => { M[i * N + j] = v; M[j * N + i] = v; };
for (let i = 0; i < N; i++) _set(i, i, 1);  // diagonal (irrelevant)
_set(0, 1, 0.90);
_set(2, 3, 0.95);
_set(0, 2, 0.10); _set(0, 3, 0.10);
_set(1, 2, 0.10); _set(1, 3, 0.10);

const result = LC.lineageClustering(M, N);
check('returns dendrogram',          Array.isArray(result.dendrogram));
check('lineage_id_per_sample length', result.lineage_id_per_sample.length === N);
check('threshold defaults to 0.5',    result.threshold === 0.5);
// Samples 0+1 → same lineage; 2+3 → same lineage; total 2 lineages
check('samples 0+1 share lineage',
      result.lineage_id_per_sample[0] === result.lineage_id_per_sample[1]);
check('samples 2+3 share lineage',
      result.lineage_id_per_sample[2] === result.lineage_id_per_sample[3]);
check('samples 0 + 2 different lineages',
      result.lineage_id_per_sample[0] !== result.lineage_id_per_sample[2]);
check('n_lineages = 2',               result.n_lineages === 2);

// -----------------------------------------------------------------------------
group('lineageClustering: custom threshold');
// Very high threshold (1.0) → everyone merges into 1 lineage
const looseResult = LC.lineageClustering(M, N, 1.0);
check('threshold = 1.0 (loose): 1 lineage', looseResult.n_lineages === 1);

// Strict threshold (0.05) → only sample pairs whose dist < 0.05 merge
// (only 2+3 with dist 0.05 ≤ but is < or <=? Algorithm uses <= so 2+3 stays.
// 0+1 has dist 0.10 — won't merge at threshold 0.05.)
const strictResult = LC.lineageClustering(M, N, 0.05);
check('threshold = 0.05 (strict): more lineages',
      strictResult.n_lineages >= 2);

// -----------------------------------------------------------------------------
group('lineageCacheKey');
const k1 = LC.lineageCacheKey([0, 1, 2], 3, 0.5, 'default', 'LG28');
check('contains chrom',                  k1.includes('LG28'));
check('contains mode',                   k1.includes('default'));
check('contains K',                      k1.includes('::3::'));
check('contains threshold',              k1.includes('0.5'));
check('uses "::" delimiter',             k1.split('::').length >= 6);

// Chrom change → different key
const k2 = LC.lineageCacheKey([0, 1, 2], 3, 0.5, 'default', 'LG14');
check('chrom change → different key',    k1 !== k2);

// Mode change → different key
const k3 = LC.lineageCacheKey([0, 1, 2], 3, 0.5, 'detailed', 'LG28');
check('mode change → different key',     k1 !== k3);

// K change → different key
const k4 = LC.lineageCacheKey([0, 1, 2], 6, 0.5, 'default', 'LG28');
check('K change → different key',        k1 !== k4);

// Threshold change → different key
const k5 = LC.lineageCacheKey([0, 1, 2], 3, 0.8, 'default', 'LG28');
check('threshold change → different key', k1 !== k5);

// L2 endpoints change → different key
const k6 = LC.lineageCacheKey([5, 6, 7], 3, 0.5, 'default', 'LG28');
check('L2 endpoints change → different key', k1 !== k6);

// L2 length change → different key
const k7 = LC.lineageCacheKey([0, 1, 2, 3], 3, 0.5, 'default', 'LG28');
check('L2 length change → different key', k1 !== k7);

// Nullish mode/chrom → defaults
const kDefault = LC.lineageCacheKey([0], 3, 0.5);
check('nullish mode → "default"',        kDefault.includes('default'));
check('nullish chrom → "_"',             kDefault.startsWith('_::'));

// Empty l2_indices: still valid
const kEmpty = LC.lineageCacheKey([], 3, 0.5, 'default', 'LGZ');
check('empty l2_indices: key ends with ::0::0::0',
      kEmpty.endsWith('::0::0::0'));

// Non-array → treated as []
const kNonArr = LC.lineageCacheKey(null, 3, 0.5, 'default', 'LGZ');
check('null l2_indices: same as empty',  kNonArr === kEmpty);

// -----------------------------------------------------------------------------
group('lineageColor');
check('lineage 0 → hsl(...)',          LC.lineageColor(0).startsWith('hsl('));
check('lineage 5 → hsl(...)',          LC.lineageColor(5).startsWith('hsl('));
check('different lineages → different colors',
      LC.lineageColor(0) !== LC.lineageColor(1));
check('lineage -1 → neutral grey',      LC.lineageColor(-1).includes('120, 128, 140'));
check('NaN → neutral grey',             LC.lineageColor(NaN).includes('120, 128, 140'));

// -----------------------------------------------------------------------------
group('drawLineageStrip');
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
}

const envs = [
  { start_bp: 0,         end_bp: 1_000_000 },
  { start_bp: 1_000_000, end_bp: 2_000_000 },
  { start_bp: 2_000_000, end_bp: 3_000_000 },
];

// All in chain: 3 colored bars
const lineageRes = {
  lineage_id_per_sample: [0, 0, 1, 1, 2, 2, 0, 0, 1, 1],
  chains: [{ l2_indices: [0, 1, 2] }],
};
const getCluster = (idx) => ({ fixedKLabels: [0, 0, 0, 1, 1, 1, 0, 0, 1, 1], K: 3 });

const ctx = new FakeCtx();
LC.drawLineageStrip(ctx, { l: 50, t: 30 }, 600, 200, 0, 3, lineageRes, envs, getCluster);
check('drawStrip: save/restore',
      ctx.calls[0][0] === 'save' && ctx.calls[ctx.calls.length - 1][0] === 'restore');
const fills = ctx.calls.filter(c => c[0] === 'fillRect');
check('drawStrip: 1 backdrop + 3 per-L2 fillRects',  fills.length === 4);
const frame = ctx.calls.filter(c => c[0] === 'strokeRect');
check('drawStrip: frame strokeRect',  frame.length === 1);

// Chain-break L2: grey overlay instead of color
const lineageBreak = {
  lineage_id_per_sample: [0, 0, 1, 1],
  chains: [{ l2_indices: [0, 2] }],   // L2 idx 1 is the break
};
const ctxBreak = new FakeCtx();
LC.drawLineageStrip(ctxBreak, { l: 0, t: 30 }, 600, 200, 0, 3, lineageBreak, envs, getCluster);
const breakFills = ctxBreak.calls.filter(c => c[0] === 'fillRect');
const greyFills = breakFills.filter(c => c[5] && c[5].includes('120, 128, 140'));
check('chain-break: grey overlay drawn',
      greyFills.length >= 1);

// Outside visible range
const ctxOut = new FakeCtx();
LC.drawLineageStrip(ctxOut, { l: 0, t: 30 }, 600, 200, 100, 200, lineageRes, envs, getCluster);
const fillsOut = ctxOut.calls.filter(c => c[0] === 'fillRect');
check('outside visible: only backdrop drawn',  fillsOut.length === 1);

// Headless safety
let safeHeadless = true;
try {
  LC.drawLineageStrip(null, { l: 0, t: 0 }, 100, 100, 0, 1, lineageRes, envs, getCluster);
  LC.drawLineageStrip({}, { l: 0, t: 0 }, 100, 100, 0, 1, lineageRes, envs, getCluster);
  LC.drawLineageStrip(ctx, { l: 0, t: 0 }, 100, 100, 0, 1, null, envs, getCluster);
  LC.drawLineageStrip(ctx, { l: 0, t: 0 }, 100, 100, 0, 1, lineageRes, null, getCluster);
  LC.drawLineageStrip(ctx, { l: 0, t: 0 }, 100, 100, 0, 1, lineageRes, envs, null);
} catch (_) { safeHeadless = false; }
check('headless safety',  safeHeadless);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
