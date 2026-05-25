// Smoke tests for shared/persist_debounced.js.
//
// Run from inversion-atlas root:
//   node tests/test_shared_persist_debounced.js
//
// Covers:
//   - String + JSON-object stringification
//   - Per-key coalescing (last value wins within debounce window)
//   - Independent debouncing across keys
//   - flushPersistNow() drains immediately
//   - Stringification happens at call time (caller mutation after the
//     call does NOT affect what eventually persists)

// Fake localStorage BEFORE importing the module (the module references
// localStorage from its flush handler).
const _STORE = new Map();
globalThis.localStorage = {
  setItem: (k, v) => _STORE.set(k, v),
  getItem: (k)    => _STORE.has(k) ? _STORE.get(k) : null,
  removeItem: (k) => _STORE.delete(k),
};

const {
  persistDebounced,
  flushPersistNow,
  _pendingValueForTesting,
} = await import('../atlases/inversion/shared/persist_debounced.js');

let _failed = 0;
let _passed = 0;
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error(`FAIL: ${msg}\n  expected: ${JSON.stringify(b)}\n  got:      ${JSON.stringify(a)}`);
    _failed++;
    return;
  }
  _passed++;
  console.log(`  ok: ${msg}`);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ====== string write + flush ============================================

console.log('string write + immediate flush:');
{
  _STORE.clear();
  persistDebounced('k1', 'hello');
  eq(_STORE.get('k1'), undefined, 'not yet written (debounced)');
  eq(_pendingValueForTesting('k1'), 'hello', 'pending value visible');
  flushPersistNow();
  eq(_STORE.get('k1'), 'hello', 'flushed value written');
  eq(_pendingValueForTesting('k1'), null, 'pending cleared after flush');
}

// ====== JSON object stringification =====================================

console.log('\nJSON object stringification:');
{
  _STORE.clear();
  persistDebounced('k2', { a: 1, b: [2, 3] });
  flushPersistNow();
  eq(_STORE.get('k2'), '{"a":1,"b":[2,3]}', 'object stringified at call time');
}

// ====== caller mutation after call does NOT affect persisted value ======

console.log('\ncaller mutation safety:');
{
  _STORE.clear();
  const obj = { x: 1 };
  persistDebounced('k3', obj);
  obj.x = 999;            // mutate AFTER the debounced call
  flushPersistNow();
  eq(_STORE.get('k3'), '{"x":1}', 'snapshot taken at call time, not at flush');
}

// ====== per-key coalescing (last value wins) ============================

console.log('\nper-key coalescing:');
{
  _STORE.clear();
  persistDebounced('k4', 'first');
  persistDebounced('k4', 'second');
  persistDebounced('k4', 'third');
  eq(_pendingValueForTesting('k4'), 'third', 'last value wins in pending');
  flushPersistNow();
  eq(_STORE.get('k4'), 'third', 'only last value reaches storage');
}

// ====== independent debouncing across keys ==============================

console.log('\nindependent keys:');
{
  _STORE.clear();
  persistDebounced('a', '1');
  persistDebounced('b', '2');
  persistDebounced('c', '3');
  flushPersistNow();
  eq(_STORE.get('a'), '1', 'key a flushed');
  eq(_STORE.get('b'), '2', 'key b flushed');
  eq(_STORE.get('c'), '3', 'key c flushed');
}

// ====== timer fires after delay =========================================

console.log('\ntimer-based flush:');
{
  _STORE.clear();
  persistDebounced('k5', 'timed', 50);
  eq(_STORE.get('k5'), undefined, 'not written before timer');
  await sleep(80);
  eq(_STORE.get('k5'), 'timed', 'written after timer fires');
  eq(_pendingValueForTesting('k5'), null, 'pending cleared after timer fire');
}

// ====== rapid same-key writes only schedule one timer ===================

console.log('\nrapid same-key coalescing:');
{
  _STORE.clear();
  // 100 rapid calls — should produce ONE setItem on flush, not 100.
  let setItemCount = 0;
  const origSet = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = (k, v) => { setItemCount++; _STORE.set(k, v); };
  for (let i = 0; i < 100; i++) persistDebounced('k6', `val_${i}`);
  flushPersistNow();
  globalThis.localStorage.setItem = origSet;
  eq(setItemCount, 1, '100 rapid calls produce exactly 1 setItem');
  eq(_STORE.get('k6'), 'val_99', 'last value (val_99) is the persisted one');
}

// ====== quota / SecurityError swallowed silently ========================

console.log('\nquota error swallowed:');
{
  const origSet = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  try {
    persistDebounced('k7', 'wont-fit');
    flushPersistNow();   // should NOT throw
    console.log('  ok: flushPersistNow swallows setItem error');
    _passed++;
  } catch (e) {
    console.error(`FAIL: expected silent drop, got thrown: ${e.message}`);
    _failed++;
  }
  globalThis.localStorage.setItem = origSet;
}

// ====== summary =========================================================

console.log();
if (_failed > 0) {
  console.error(`FAILED: ${_failed} of ${_passed + _failed} assertions failed`);
  process.exit(1);
}
console.log(`ALL OK (${_passed} assertions)`);
