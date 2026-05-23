// tests/test_shared_inheritance_compute.js
//
// Unit coverage for shared/inheritance_compute.js — the inheritance
// orchestrator (legacy lines 41305-41435).

import {
  runInheritanceCompute,
  invalidateInheritanceCache,
} from '../atlases/popstats/shared/inheritance_compute.js';
import { IGC_DEFAULT_DIST_THRESHOLD } from '../atlases/popstats/shared/inheritance_groups.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// Fixture: build a state with ≥2 confirmed candidates so inheritance compute
// has something to chew on. Each candidate has locked_labels + K + bp range
// so gatherActiveCandidatesForInheritance accepts them.
// -----------------------------------------------------------------------------
function _makeState() {
  return {
    k: 3,
    activeMode: 'default',
    candidates: {
      cA: {
        id: 'cA', confirmed: true, source: 'manual',
        K: 3, start_bp: 0, end_bp: 1_000_000,
        locked_labels: new Int8Array([0, 1, 2, 0, 1, 2, 0, 1, 2, 0]),
      },
      cB: {
        id: 'cB', confirmed: true, source: 'merge',
        K: 3, start_bp: 1_100_000, end_bp: 2_000_000,
        locked_labels: new Int8Array([0, 1, 2, 0, 1, 2, 0, 1, 2, 0]),
      },
      cC: {
        id: 'cC', confirmed: true, source: 'manual',
        K: 3, start_bp: 2_100_000, end_bp: 3_000_000,
        locked_labels: new Int8Array([1, 1, 0, 0, 2, 2, 1, 0, 2, 1]),
      },
    },
  };
}

// -----------------------------------------------------------------------------
group('insufficient_items short-circuit');
const sOne = { candidates: { cA: { id: 'cA', confirmed: true, source: 'manual', K: 3, start_bp: 0, end_bp: 1, locked_labels: [0] } } };
const r1 = runInheritanceCompute(sOne);
check('< 2 items: returns null',          r1 === null);
check('result + cacheKey cleared',
      sOne.inheritanceResult === null && sOne.inheritanceCacheKey === null);
check('status: insufficient_items',
      sOne.inheritanceLastStatus && sOne.inheritanceLastStatus.reason === 'insufficient_items');
check('status.ok = false',                sOne.inheritanceLastStatus.ok === false);
check('status.message present',           typeof sOne.inheritanceLastStatus.message === 'string');

// Null state
check('null state → null',                runInheritanceCompute(null) === null);

// -----------------------------------------------------------------------------
group('happy path: computed');
const s = _makeState();
const r2 = runInheritanceCompute(s);
check('returns result object',            r2 && typeof r2 === 'object');
check('result.items_meta populated',      Array.isArray(r2.items_meta) && r2.items_meta.length === 3);
check('items_meta: id propagated',         r2.items_meta[0].id === 'cA');
check('state.inheritanceResult set',      s.inheritanceResult === r2);
check('state.inheritanceCacheKey set',    typeof s.inheritanceCacheKey === 'string');
check('status.ok = true',                  s.inheritanceLastStatus.ok === true);
check('status.reason = computed',          s.inheritanceLastStatus.reason === 'computed');
check('status.threshold = default',
      s.inheritanceLastStatus.threshold === IGC_DEFAULT_DIST_THRESHOLD);

// -----------------------------------------------------------------------------
group('cache-hit short-circuit');
const r3 = runInheritanceCompute(s);
check('cache hit: returns same ref',      r3 === r2);
check('status.reason = cached',            s.inheritanceLastStatus.reason === 'cached');

// force=true: recompute even with valid cache
const r4 = runInheritanceCompute(s, { force: true });
check('force=true: new compute',          r4 !== null);
check('force=true: status.reason = computed',
      s.inheritanceLastStatus.reason === 'computed');

// -----------------------------------------------------------------------------
group('threshold resolution chain');
// 1. opts.threshold wins
const sT = _makeState();
runInheritanceCompute(sT, { threshold: 0.05 });
check('opts.threshold propagated',         sT.inheritanceLastStatus.threshold === 0.05);

// 2. state.gPanelInheritanceThreshold fallback
const sGp = _makeState();
sGp.gPanelInheritanceThreshold = 0.25;
runInheritanceCompute(sGp);
check('state.gPanelInheritanceThreshold fallback',
      sGp.inheritanceLastStatus.threshold === 0.25);

// 3. default fallback
const sD = _makeState();
runInheritanceCompute(sD);
check('default IGC threshold fallback',
      sD.inheritanceLastStatus.threshold === IGC_DEFAULT_DIST_THRESHOLD);

// -----------------------------------------------------------------------------
group('mode override');
const sM = _makeState();
sM.activeMode = 'default';
sM.candidates_detailed = {};
const r5 = runInheritanceCompute(sM, { mode: 'detailed' });
// detailed mode reads candidates_detailed which is empty → insufficient_items
check('opts.mode=detailed reads detailed registry',
      r5 === null && sM.inheritanceLastStatus.reason === 'insufficient_items');

// -----------------------------------------------------------------------------
group('invalidateInheritanceCache');
const sI = _makeState();
runInheritanceCompute(sI);
check('pre-invalidate: result set',        sI.inheritanceResult !== null);
invalidateInheritanceCache(sI);
check('result cleared',                    sI.inheritanceResult === null);
check('cacheKey cleared',                  sI.inheritanceCacheKey === null);
check('status cleared',                    sI.inheritanceLastStatus === null);

// Null state safe
let safeInvalid = true;
try { invalidateInheritanceCache(null); } catch (_) { safeInvalid = false; }
check('null state: no-throw',              safeInvalid);

// Cache miss after invalidate triggers recompute
const r6 = runInheritanceCompute(sI);
check('post-invalidate: fresh compute',    sI.inheritanceLastStatus.reason === 'computed');

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
