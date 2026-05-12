// tests/test_shared_te_fragility.js
//
// Unit tests for atlases/inversion/shared/te_fragility.js.

class MockLS {
  constructor() { this.store = new Map(); }
  setItem(k, v) { this.store.set(String(k), String(v)); }
  getItem(k) { const v = this.store.get(String(k)); return v == null ? null : v; }
  removeItem(k) { this.store.delete(String(k)); }
  clear() { this.store.clear(); }
  get length() { return this.store.size; }
  key(i) { const keys = Array.from(this.store.keys()); return i < keys.length ? keys[i] : null; }
}
globalThis.localStorage = new MockLS();

const {
  TE_FRAGILITY_TOOLS,
  TE_FRAGILITY_LS_KEY,
  TE_FRAGILITY_POS_MATCH_BP,
  isTEFragilityJSON,
  storeTEFragility,
  persistTEFragility,
  restoreTEFragility,
  clearTEFragility,
  getTEFragilityForBreakpoint,
} = await import('../atlases/inversion/shared/te_fragility.js');

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

function makeJSON(perBpSp, tool) {
  return {
    tool: tool || 'comparative_te_breakpoint_fragility_v1',
    schema_version: 1,
    generated_at: '2026-05-12T00:00:00Z',
    params: { focal_radius_bp: 250000 },
    per_breakpoint_per_species: perBpSp,
  };
}

// =====================================================================
group('constants');
check('TOOLS includes comparative_te_breakpoint_fragility_v1',
      TE_FRAGILITY_TOOLS.includes('comparative_te_breakpoint_fragility_v1'));
check('TOOLS includes te_fragility_v1 alias',
      TE_FRAGILITY_TOOLS.includes('te_fragility_v1'));
check('TOOLS frozen',                        Object.isFrozen(TE_FRAGILITY_TOOLS));
check('LS_KEY matches legacy',               TE_FRAGILITY_LS_KEY === 'inversion_atlas.teFragility.v1');
check('POS_MATCH_BP = 100kb',                TE_FRAGILITY_POS_MATCH_BP === 100_000);

// =====================================================================
group('isTEFragilityJSON');
check('valid (primary tool) → true',         isTEFragilityJSON(makeJSON([{}])) === true);
check('valid (alias tool) → true',           isTEFragilityJSON(makeJSON([{}], 'te_fragility_v1')) === true);
check('null → false',                        isTEFragilityJSON(null) === false);
check('unknown tool → false',                isTEFragilityJSON(makeJSON([{}], 'other')) === false);
check('non-number schema → false',
      isTEFragilityJSON({ ...makeJSON([]), schema_version: '1' }) === false);
check('per_breakpoint_per_species not array → false',
      isTEFragilityJSON({ ...makeJSON([]), per_breakpoint_per_species: 'x' }) === false);

// =====================================================================
group('storeTEFragility');
{
  const state = {};
  const ok = storeTEFragility(state, makeJSON([
    { bp_id: 'bp1', species: 'Cmac', gar_chr: 'LG28', gar_pos_bp: 1_500_000,
      focal_te_density: 0.35, fold_enrichment: 2.1, percentile: 0.95 },
    { bp_id: 'bp1', species: 'Cgar_ref', gar_chr: 'LG28', gar_pos_bp: 1_500_000,
      focal_te_density: 0.20, fold_enrichment: 1.0, percentile: 0.50 },
  ]));
  check('returns true',                       ok === true);
  check('state.teFragility created',          !!state.teFragility);
  check('rows length = 2',                    state.teFragility.per_breakpoint_per_species.length === 2);
  check('tool stored',                        state.teFragility.tool === 'comparative_te_breakpoint_fragility_v1');
  check('params deep-copied',                 state.teFragility.params.focal_radius_bp === 250000);
}
check('null state → false',                  storeTEFragility(null, makeJSON([])) === false);
check('null parsed → false',                 storeTEFragility({}, null) === false);

// =====================================================================
group('persist / restore round-trip');
{
  globalThis.localStorage.clear();
  const state = {};
  storeTEFragility(state, makeJSON([
    { bp_id: 'bp1', species: 'Cmac', fold_enrichment: 2.1 },
  ]));
  check('persist → true',                     persistTEFragility(state) === true);
  const state2 = {};
  check('restore → true',                     restoreTEFragility(state2) === true);
  check('restored 1 entry',                   state2.teFragility.per_breakpoint_per_species.length === 1);
  check('restored bp_id',
        state2.teFragility.per_breakpoint_per_species[0].bp_id === 'bp1');
}
{
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(TE_FRAGILITY_LS_KEY, 'x');
  const state = { teFragility: null };
  persistTEFragility(state);
  check('persist with null clears LS',
        globalThis.localStorage.getItem(TE_FRAGILITY_LS_KEY) === null);
}
{
  globalThis.localStorage.clear();
  check('restore no key → false',             restoreTEFragility({}) === false);
}

// =====================================================================
group('clearTEFragility');
{
  globalThis.localStorage.clear();
  const state = {};
  storeTEFragility(state, makeJSON([{ bp_id: 'bp1', species: 'Cmac' }]));
  persistTEFragility(state);
  clearTEFragility(state);
  check('state nulled',                       state.teFragility === null);
  check('LS key cleared',
        globalThis.localStorage.getItem(TE_FRAGILITY_LS_KEY) === null);
  let threw = false;
  try { clearTEFragility(null); } catch (_) { threw = true; }
  check('null state: no throw',               !threw);
}

// =====================================================================
group('getTEFragilityForBreakpoint');
{
  const state = {};
  storeTEFragility(state, makeJSON([
    { bp_id: 'bp1', species: 'Cmac', gar_chr: 'LG28', gar_pos_bp: 1_500_000,
      focal_te_density: 0.35, fold_enrichment: 2.1 },
    { bp_id: 'bp1', species: 'Cgar_ref', gar_chr: 'LG28', gar_pos_bp: 1_500_000,
      focal_te_density: 0.20, fold_enrichment: 1.0 },
    { bp_id: 'bp2', species: 'Cmac', gar_chr: 'LG14', gar_pos_bp: 5_000_000 },
  ]));
  // bp_id + species match
  const r1 = getTEFragilityForBreakpoint(state, { id: 'bp1' }, 'Cmac');
  check('bp_id + species match',              r1 && r1.fold_enrichment === 2.1);
  check('species filter (different row for same bp)',
        getTEFragilityForBreakpoint(state, { id: 'bp1' }, 'Cgar_ref').fold_enrichment === 1.0);
  // Position-based fallback (no bp.id)
  const r2 = getTEFragilityForBreakpoint(state,
    { gar_chr: 'LG28', gar_pos_mb: 1.55 }, 'Cmac');
  check('gar_pos_mb within 100kb match',      !!r2 && r2.bp_id === 'bp1');
  // Just outside 100kb window → null
  const r3 = getTEFragilityForBreakpoint(state,
    { gar_chr: 'LG28', gar_pos_mb: 1.7 }, 'Cmac');
  check('pos > 100kb from any entry → null',  r3 === null);
  // C_gar_ prefix tolerance
  const r4 = getTEFragilityForBreakpoint(state,
    { gar_chr: 'C_gar_LG28', gar_pos_mb: 1.5 }, 'Cmac');
  check('C_gar_ prefix tolerance works',      !!r4 && r4.bp_id === 'bp1');
  // Wrong species → null
  check('wrong species → null',
        getTEFragilityForBreakpoint(state, { id: 'bp1' }, 'Unknown_sp') === null);
  // Null guards
  check('null state → null',                  getTEFragilityForBreakpoint(null, { id: 'bp1' }, 'Cmac') === null);
  check('null bp → null',                     getTEFragilityForBreakpoint(state, null, 'Cmac') === null);
  check('null species → null',                getTEFragilityForBreakpoint(state, { id: 'bp1' }, null) === null);
  check('no layer loaded → null',             getTEFragilityForBreakpoint({}, { id: 'bp1' }, 'Cmac') === null);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
