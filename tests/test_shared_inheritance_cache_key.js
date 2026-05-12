// tests/test_shared_inheritance_cache_key.js
//
// Unit coverage for shared/inheritance_cache_key.js — cache-key +
// label-fingerprint helpers (legacy lines 41257-41304).

import * as CK from '../atlases/inversion/shared/inheritance_cache_key.js';
import { IGC_DEFAULT_DIST_THRESHOLD } from '../atlases/inversion/shared/inheritance_groups.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('hashLockedLabels');
const lbl1 = [0, 1, 2, 0, 1, 2];
const lbl2 = [0, 1, 2, 0, 1, 2];
const lbl3 = [0, 1, 2, 0, 1, 3];   // differs at last position
check('identical arrays → identical hashes',
      CK.hashLockedLabels(lbl1) === CK.hashLockedLabels(lbl2));
check('different arrays → different hashes',
      CK.hashLockedLabels(lbl1) !== CK.hashLockedLabels(lbl3));
check('null → 0',                          CK.hashLockedLabels(null) === 0);
check('empty array → 0',                   CK.hashLockedLabels([]) === 0);
// -1 (NA) distinguishable from 0 (band 0)
const labelsWithNA = [-1, -1, -1];
const labelsZero = [0, 0, 0];
check('-1 NA distinct from 0',
      CK.hashLockedLabels(labelsWithNA) !== CK.hashLockedLabels(labelsZero));
// Hash stays in unsigned 32-bit
check('hash is unsigned 32-bit',
      CK.hashLockedLabels(lbl1) >= 0 && CK.hashLockedLabels(lbl1) <= 0xFFFFFFFF);

// Typed array vs regular array — same content → same hash
const i8 = new Int8Array([0, 1, 2, 0, 1, 2]);
check('typed array ≡ regular array hash',
      CK.hashLockedLabels(i8) === CK.hashLockedLabels(lbl1));

// -----------------------------------------------------------------------------
group('inheritanceCacheKey: structure');
const items = [
  { id: 'cA', K: 3, start_bp: 100, end_bp: 200, labels: [0, 1, 2] },
  { id: 'cB', K: 6, start_bp: 500, end_bp: 700, labels: [0, 1, 2, 3, 4, 5] },
];
const key1 = CK.inheritanceCacheKey(items, 'default', 0.15);
check('key starts with mode',              key1.startsWith('default@t'));
check('key contains threshold (4dp)',      key1.includes('@t0.1500'));
check('key contains both candidate ids',
      key1.includes('cA@') && key1.includes('cB@'));
check('key contains K',                    key1.includes('@K3') && key1.includes('@K6'));
check('key contains bp range',             key1.includes('@100-200') && key1.includes('@500-700'));

// -----------------------------------------------------------------------------
group('inheritanceCacheKey: invalidation triggers');
// Same items, same threshold → same key
const keyDup = CK.inheritanceCacheKey(items, 'default', 0.15);
check('duplicate call → same key',         key1 === keyDup);

// Mode change → different key
const keyDetailed = CK.inheritanceCacheKey(items, 'detailed', 0.15);
check('mode change → different key',       key1 !== keyDetailed);

// Threshold change → different key
const keyT = CK.inheritanceCacheKey(items, 'default', 0.20);
check('threshold change → different key',  key1 !== keyT);

// 4dp threshold rounding absorbs slider jitter
const keyJitter = CK.inheritanceCacheKey(items, 'default', 0.150000001);
check('threshold jitter (4dp rounding) → same key',  key1 === keyJitter);

// K change → different key
const itemsKChanged = [
  { id: 'cA', K: 4, start_bp: 100, end_bp: 200, labels: [0, 1, 2] },
  items[1],
];
check('K change → different key',
      CK.inheritanceCacheKey(itemsKChanged, 'default', 0.15) !== key1);

// labels change → different key
const itemsLabelsChanged = [
  { id: 'cA', K: 3, start_bp: 100, end_bp: 200, labels: [0, 1, 0] },
  items[1],
];
check('labels change → different key',
      CK.inheritanceCacheKey(itemsLabelsChanged, 'default', 0.15) !== key1);

// bp change → different key
const itemsBpChanged = [
  { id: 'cA', K: 3, start_bp: 150, end_bp: 200, labels: [0, 1, 2] },
  items[1],
];
check('bp change → different key',
      CK.inheritanceCacheKey(itemsBpChanged, 'default', 0.15) !== key1);

// Id-set change → different key
const itemsRemoved = [items[0]];
check('id removed → different key',
      CK.inheritanceCacheKey(itemsRemoved, 'default', 0.15) !== key1);

// -----------------------------------------------------------------------------
group('inheritanceCacheKey: defaults + edge cases');
// nullish threshold → uses IGC_DEFAULT_DIST_THRESHOLD
const keyDefault = CK.inheritanceCacheKey(items, 'default');
const keyExplicitDefault = CK.inheritanceCacheKey(items, 'default', IGC_DEFAULT_DIST_THRESHOLD);
check('nullish threshold → defaults match', keyDefault === keyExplicitDefault);

// Non-finite threshold → also defaults
check('NaN threshold → defaults match',
      CK.inheritanceCacheKey(items, 'default', NaN) === keyExplicitDefault);

// Nullish mode → 'default'
const keyNullMode = CK.inheritanceCacheKey(items, null, 0.15);
check('null mode → "default"',             keyNullMode.startsWith('default@t'));

// Empty items
const keyEmpty = CK.inheritanceCacheKey([], 'default', 0.15);
check('empty items → key ends with "::"',  keyEmpty.endsWith('::'));

// Non-array items
const keyNonArr = CK.inheritanceCacheKey(null, 'default', 0.15);
check('null items → key ends with "::"',   keyNonArr.endsWith('::'));

// Item without labels — still gets hashed (as 0)
const noLabels = [{ id: 'cX', K: 3, start_bp: 0, end_bp: 100 }];
const keyNoLabels = CK.inheritanceCacheKey(noLabels, 'default', 0.15);
check('item without labels: fp = 0',       keyNoLabels.includes('@0'));

// -----------------------------------------------------------------------------
group('inheritanceCacheKeysMatch');
check('both null → false',                 CK.inheritanceCacheKeysMatch(null, null) === false);
check('one null → false',                  CK.inheritanceCacheKeysMatch('x', null) === false);
check('both equal → true',                 CK.inheritanceCacheKeysMatch('x', 'x') === true);
check('different strings → false',         CK.inheritanceCacheKeysMatch('x', 'y') === false);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
