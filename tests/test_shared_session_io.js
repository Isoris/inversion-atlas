// tests/test_shared_session_io.js

import {
  SESSION_SCHEMA,
  SESSION_PREF_KEYS,
  isSessionPayload,
  buildSessionPayload,
  mergeSessionPayload,
  buildSessionFilename,
} from '../atlases/inversion/shared/session_io.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('constants');
check('SCHEMA matches legacy',                 SESSION_SCHEMA === 'pca_scrubber_session_v1');
check('PREF_KEYS frozen, 5 entries',           Object.isFrozen(SESSION_PREF_KEYS) && SESSION_PREF_KEYS.length === 5);
check('PREF_KEYS includes simScale',           SESSION_PREF_KEYS.includes('simScale'));
check('PREF_KEYS includes atlasMode',          SESSION_PREF_KEYS.includes('atlasMode'));

// =====================================================================
group('isSessionPayload');
check('valid payload → true',                  isSessionPayload({ schema: SESSION_SCHEMA }) === true);
check('null → false',                          isSessionPayload(null) === false);
check('undefined → false',                     isSessionPayload(undefined) === false);
check('wrong schema tag → false',              isSessionPayload({ schema: 'other_v1' }) === false);
check('missing schema → false',                isSessionPayload({}) === false);
check('not object → false',                    isSessionPayload('a string') === false);

// =====================================================================
group('buildSessionPayload — empty state');
{
  const r = buildSessionPayload({});
  check('schema set',                            r.schema === SESSION_SCHEMA);
  check('saved_at is ISO',                       typeof r.saved_at === 'string'
                                                 && r.saved_at.indexOf('T') > 0);
  check('chrom null',                            r.chrom === null);
  check('candidates null',                       r.candidates === null);
  check('activeCandidateId null',                r.activeCandidateId === null);
  check('favorites [] (default)',                Array.isArray(r.favorites) && r.favorites.length === 0);
  check('regimes null',                          r.regimes === null);
  check('confirmedCandidates null',              r.confirmedCandidates === null);
  check('prefs object exists',                   typeof r.prefs === 'object');
  check('prefs.simScale null',                   r.prefs.simScale === null);
  check('prefs.layoutMode null (no opts)',       r.prefs.layoutMode === null);
}

// =====================================================================
group('buildSessionPayload — populated state');
{
  const state = {
    data: { chrom: 'LG28' },
    candidates: { c1: { id: 'c1' }, c2: { id: 'c2' } },
    activeCandidateId: 'c1',
    favorites: new Set([7, 42, 105]),
    regimes: { r1: { name: 'spalax' } },
    confirmedCandidates: { c1: true },
    simScale: 'win10000',
    linesColorMode: 'theta_pi',
    kChoice: 3,
  };
  const r = buildSessionPayload(state);
  check('chrom from state.data',                 r.chrom === 'LG28');
  check('candidates dict preserved',             r.candidates === state.candidates);
  check('activeCandidateId preserved',           r.activeCandidateId === 'c1');
  check('favorites Set → Array',                 Array.isArray(r.favorites) && r.favorites.length === 3);
  check('favorites contents preserved',          r.favorites.includes(42));
  check('regimes preserved',                     r.regimes.r1.name === 'spalax');
  check('confirmedCandidates preserved',         r.confirmedCandidates.c1 === true);
  check('prefs.simScale',                        r.prefs.simScale === 'win10000');
  check('prefs.linesColorMode',                  r.prefs.linesColorMode === 'theta_pi');
  check('prefs.kChoice',                         r.prefs.kChoice === 3);
}
{
  // favorites as Array (not Set)
  const state = { favorites: [1, 2, 3] };
  const r = buildSessionPayload(state);
  check('favorites Array → Array (copied)',      Array.isArray(r.favorites)
                                                 && r.favorites !== state.favorites
                                                 && r.favorites.length === 3);
}
{
  // opts.prefs adds layoutMode / atlasMode
  const r = buildSessionPayload({}, { prefs: { layoutMode: 'compact', atlasMode: 'expert' } });
  check('opts.prefs.layoutMode preserved',       r.prefs.layoutMode === 'compact');
  check('opts.prefs.atlasMode preserved',        r.prefs.atlasMode === 'expert');
}

// =====================================================================
group('buildSessionPayload — JSON round-trip');
{
  const state = {
    data: { chrom: 'LG28' },
    candidates: { c1: { id: 'c1', K: 3 } },
    favorites: new Set([1, 2]),
    activeCandidateId: 'c1',
  };
  const payload = buildSessionPayload(state);
  const json = JSON.stringify(payload);
  const parsed = JSON.parse(json);
  check('round-trips through JSON',              parsed.schema === SESSION_SCHEMA);
  check('candidates preserved',                  parsed.candidates.c1.K === 3);
  check('favorites preserved as array',          Array.isArray(parsed.favorites)
                                                 && parsed.favorites.length === 2);
}

// =====================================================================
group('mergeSessionPayload — happy path');
{
  const state = {};
  const payload = buildSessionPayload({
    data: { chrom: 'LG28' },
    candidates: { c1: { id: 'c1' }, c2: { id: 'c2' } },
    activeCandidateId: 'c1',
    favorites: new Set([7, 42]),
    regimes: { r1: { name: 'r1' } },
    confirmedCandidates: { c1: true },
  });
  const r = mergeSessionPayload(state, payload);
  check('ok = true',                             r.ok === true);
  check('applied.candidates',                    r.applied.candidates === true);
  check('applied.favorites',                     r.applied.favorites === true);
  check('n_candidates_added = 2',                r.n_candidates_added === 2);
  check('n_favorites_added = 2',                 r.n_favorites_added === 2);
  // State mutations
  check('candidates merged into state',          state.candidates.c1.id === 'c1'
                                                 && state.candidates.c2.id === 'c2');
  check('candidateList created + populated',     Array.isArray(state.candidateList)
                                                 && state.candidateList.length === 2);
  check('activeCandidateId set',                 state.activeCandidateId === 'c1');
  check('favorites is Array (started fresh)',    Array.isArray(state.favorites));
  check('favorites contains 7 + 42',             state.favorites.includes(7) && state.favorites.includes(42));
  check('regimes set',                           state.regimes.r1.name === 'r1');
  check('confirmedCandidates set',               state.confirmedCandidates.c1 === true);
}

// =====================================================================
group('mergeSessionPayload — candidates merge dedup');
{
  // State already has c1; loaded session also has c1 (dedup) + c3 (new)
  const state = {
    candidates: { c1: { id: 'c1', K: 3 } },
    candidateList: [{ id: 'c1', K: 3 }],
  };
  const payload = buildSessionPayload({
    candidates: { c1: { id: 'c1', K: 4 }, c3: { id: 'c3' } },
  });
  const r = mergeSessionPayload(state, payload);
  check('n_candidates_added = 1 (only c3 new)',  r.n_candidates_added === 1);
  check('state.candidateList still 2 entries',    state.candidateList.length === 2);
  check('c1 NOT duplicated in list',
        state.candidateList.filter(c => c.id === 'c1').length === 1);
  check('c3 added',                              state.candidateList.some(c => c.id === 'c3'));
  // The dict assign DOES overwrite c1
  check('state.candidates c1 overwritten by payload',
        state.candidates.c1.K === 4);
}

// =====================================================================
group('mergeSessionPayload — favorites union (Set preserved)');
{
  const state = { favorites: new Set([1, 2]) };
  const payload = buildSessionPayload({ favorites: new Set([2, 3, 4]) });
  const r = mergeSessionPayload(state, payload);
  check('Set instance preserved',                state.favorites instanceof Set);
  check('union: {1,2,3,4}',                      state.favorites.has(1)
                                                 && state.favorites.has(2)
                                                 && state.favorites.has(3)
                                                 && state.favorites.has(4));
  check('n_favorites_added = 2 (3 + 4 are new)', r.n_favorites_added === 2);
}
{
  const state = { favorites: [1, 2] };
  const payload = buildSessionPayload({ favorites: new Set([2, 3]) });
  const r = mergeSessionPayload(state, payload);
  check('Array stays Array',                     Array.isArray(state.favorites));
  check('Array union dedups',                    state.favorites.length === 3);
  check('n_favorites_added = 1',                 r.n_favorites_added === 1);
}

// =====================================================================
group('mergeSessionPayload — prefs gating');
{
  // simScale only restored when state.data.sim_scales lists it
  const state = { data: { sim_scales: { win10000: {} } } };
  const payload = buildSessionPayload({ simScale: 'win10000' });
  mergeSessionPayload(state, payload);
  check('simScale matched → restored',           state.simScale === 'win10000');
}
{
  // simScale present but not in sim_scales → ignored
  const state = { data: { sim_scales: { other: {} } } };
  const payload = buildSessionPayload({ simScale: 'win10000' });
  mergeSessionPayload(state, payload);
  check('simScale not in sim_scales → ignored',  state.simScale === undefined);
}
{
  // No state.data → simScale ignored
  const state = {};
  const payload = buildSessionPayload({ simScale: 'win10000' });
  mergeSessionPayload(state, payload);
  check('no state.data → simScale ignored',      state.simScale === undefined);
}
{
  const state = {};
  const payload = buildSessionPayload({ linesColorMode: 'theta', kChoice: 5 });
  mergeSessionPayload(state, payload);
  check('linesColorMode restored',               state.linesColorMode === 'theta');
  check('kChoice restored',                      state.kChoice === 5);
}

// =====================================================================
group('mergeSessionPayload — onCandidatesMerged callback');
{
  const state = {};
  const payload = buildSessionPayload({ candidates: { c1: { id: 'c1' } } });
  let fired = false;
  let firedWith = null;
  mergeSessionPayload(state, payload, {
    onCandidatesMerged: s => { fired = true; firedWith = s; },
  });
  check('callback fired',                        fired === true);
  check('callback received state',               firedWith === state);
}
{
  // Callback throws → fail-soft (caught)
  const state = {};
  const payload = buildSessionPayload({ candidates: { c1: { id: 'c1' } } });
  let threw = false;
  try {
    mergeSessionPayload(state, payload, {
      onCandidatesMerged: () => { throw new Error('boom'); },
    });
  } catch (_) { threw = true; }
  check('callback throw: caught, no exception',  !threw);
  check('candidates still merged',               state.candidates.c1.id === 'c1');
}
{
  // No candidates → callback NOT fired
  const state = {};
  const payload = buildSessionPayload({});  // empty
  let fired = false;
  mergeSessionPayload(state, payload, { onCandidatesMerged: () => { fired = true; } });
  check('no candidates: callback not fired',     fired === false);
}

// =====================================================================
group('mergeSessionPayload — input validation');
check('null state → ok=false',                 mergeSessionPayload(null, buildSessionPayload({})).ok === false);
check('null payload → ok=false',               mergeSessionPayload({}, null).ok === false);
check('wrong-schema payload → ok=false',       mergeSessionPayload({}, { schema: 'other' }).ok === false);
check('empty payload (just schema) → ok=true', mergeSessionPayload({}, buildSessionPayload({})).ok === true);

// =====================================================================
group('buildSessionFilename');
{
  const now = new Date('2026-05-12T10:30:45.123Z');
  const name = buildSessionFilename({ chrom: 'LG28' }, now);
  check('uses payload chrom + ISO timestamp',
        name === 'atlas_session_LG28_2026-05-12T10-30-45.json');
}
{
  const now = new Date('2026-05-12T10:30:45.123Z');
  const name = buildSessionFilename({ chrom: null }, now);
  check('no chrom → no chrom tag',
        name === 'atlas_session_2026-05-12T10-30-45.json');
}
{
  const name = buildSessionFilename({ chrom: 'X' });   // default now
  check('default now: filename returned',        typeof name === 'string' && name.startsWith('atlas_session_X_'));
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
