// tests/test_shared_active_candidate.js
//
// Unit tests for shared/active_candidate.js — the tiny localStorage
// helpers that persist the user's active-candidate selection across
// page1 ↔ page2 navigation and full page reloads.

import {
  ACTIVE_CANDIDATE_LS_KEY,
  persistActiveCandidateId,
  loadActiveCandidateId,
  clearActiveCandidateId,
} from '../atlases/inversion/shared/active_candidate.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

function installLocalStorage() {
  const store = {};
  globalThis.localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
  };
  return store;
}
function uninstallLocalStorage() { delete globalThis.localStorage; }

// =====================================================================
group('constants');
check('storage key matches legacy',
      ACTIVE_CANDIDATE_LS_KEY === 'pca_scrubber_v3.activeCandidateId');

// =====================================================================
group('headless tolerance (no localStorage)');
{
  let threw = false;
  try { persistActiveCandidateId('cand_x'); } catch (_) { threw = true; }
  check('persist: no throw without localStorage', !threw);
  check('load: returns null without localStorage', loadActiveCandidateId() === null);
  let threw2 = false;
  try { clearActiveCandidateId(); } catch (_) { threw2 = true; }
  check('clear: no throw without localStorage', !threw2);
}

// =====================================================================
group('round-trip with localStorage shim');
{
  installLocalStorage();
  check('load on empty store → null',   loadActiveCandidateId() === null);
  persistActiveCandidateId('cand_LG28_15Mb');
  check('persist + load',                loadActiveCandidateId() === 'cand_LG28_15Mb');
  // Overwrite
  persistActiveCandidateId('cand_LG07_22Mb');
  check('persist again overwrites',      loadActiveCandidateId() === 'cand_LG07_22Mb');
  // Empty string / null / undefined → clear
  persistActiveCandidateId('');
  check('persist("") clears',             loadActiveCandidateId() === null);
  persistActiveCandidateId('cand_X');
  persistActiveCandidateId(null);
  check('persist(null) clears',           loadActiveCandidateId() === null);
  persistActiveCandidateId('cand_Y');
  persistActiveCandidateId(undefined);
  check('persist(undefined) clears',      loadActiveCandidateId() === null);
  uninstallLocalStorage();
}

// =====================================================================
group('clearActiveCandidateId helper');
{
  installLocalStorage();
  persistActiveCandidateId('cand_X');
  check('precondition: stored',           loadActiveCandidateId() === 'cand_X');
  clearActiveCandidateId();
  check('after clear: null',              loadActiveCandidateId() === null);
  uninstallLocalStorage();
}

// =====================================================================
group('fail-soft on storage exceptions');
{
  // Install a shim whose setItem throws (mimics quota / private mode)
  globalThis.localStorage = {
    getItem() { return null; },
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() { throw new Error('QuotaExceededError'); },
  };
  let threw = false;
  try { persistActiveCandidateId('cand_X'); } catch (_) { threw = true; }
  check('persist: no throw when setItem fails', !threw);
  let threw2 = false;
  try { clearActiveCandidateId(); } catch (_) { threw2 = true; }
  check('clear: no throw when removeItem fails', !threw2);
  // Now make getItem throw
  globalThis.localStorage = {
    getItem() { throw new Error('SecurityError'); },
    setItem() {},
    removeItem() {},
  };
  check('load: returns null when getItem throws',
        loadActiveCandidateId() === null);
  uninstallLocalStorage();
}

// =====================================================================
group('events.js re-exports as _persistActiveCandidate (backward compat)');
{
  // The events.js module re-exports persistActiveCandidateId under the
  // underscore name so existing callers don't break.
  const mod = await import('../atlases/inversion/pages/discovery/page1/events.js');
  check('_persistActiveCandidate is exported',
        typeof mod._persistActiveCandidate === 'function');
  // Smoke-test that the alias actually points at the same impl
  installLocalStorage();
  mod._persistActiveCandidate('via_alias');
  check('alias writes to the same storage key',
        loadActiveCandidateId() === 'via_alias');
  uninstallLocalStorage();
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
