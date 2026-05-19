// tests/test_shared_candidate_predicates.js
//
// Unit tests for shared/candidate_predicates.js — pure predicates
// that classify a candidate object. Library-shaped, page-independent.

import {
  isAutoCandidate,
} from '../atlases/inversion/shared/candidate_predicates.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('isAutoCandidate');
check('null → false',                  isAutoCandidate(null) === false);
check('undefined → false',             isAutoCandidate(undefined) === false);
check('empty object → false',          isAutoCandidate({}) === false);
check('confirmed candidate (auto_) → false (confirmation wins)',
      isAutoCandidate({ confirmed: true, source: 'auto_l2_sweep' }) === false);
check('source = auto_l2_sweep, unconfirmed → true',
      isAutoCandidate({ source: 'auto_l2_sweep' }) === true);
check('source = auto_sweep, unconfirmed → true',
      isAutoCandidate({ source: 'auto_sweep' }) === true);
check('source = user_promoted → false',
      isAutoCandidate({ source: 'user_promoted' }) === false);
check('source = manual → false',
      isAutoCandidate({ source: 'manual' }) === false);
check('non-string source → false',     isAutoCandidate({ source: 42 }) === false);
check('null source → false',           isAutoCandidate({ source: null }) === false);

// =====================================================================
group('re-export via local_pca_dosage/inheritance.js (backward compat)');
{
  const mod = await import('../atlases/inversion/pages/discovery/local_pca_dosage/inheritance.js');
  check('local_pca_dosage/inheritance re-exports isAutoCandidate',
        typeof mod.isAutoCandidate === 'function');
  check('re-export matches shared impl on auto_ source',
        mod.isAutoCandidate({ source: 'auto_x' }) === true);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
