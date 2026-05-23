// tests/test_shared_dxy_per_inversion.js
//
// Unit tests for atlases/cross-species/shared/dxy_per_inversion.js.

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
  DXY_PER_INVERSION_TOOL,
  DXY_PER_INVERSION_LS_KEY,
  isDxyPerInversionJSON,
  storeDxyPerInversion,
  persistDxyPerInversion,
  restoreDxyPerInversion,
  clearDxyPerInversion,
  getDxyForBreakpoint,
} = await import('../atlases/cross-species/shared/dxy_per_inversion.js');

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

function makeJSON(perInv) {
  return {
    tool: DXY_PER_INVERSION_TOOL,
    schema_version: 1,
    generated_at: '2026-05-12T00:00:00Z',
    params: { window_bp: 100000 },
    per_inversion: perInv,
  };
}

// =====================================================================
group('constants');
check('TOOL = dxy_per_inversion_v1',          DXY_PER_INVERSION_TOOL === 'dxy_per_inversion_v1');
check('LS_KEY matches legacy',                DXY_PER_INVERSION_LS_KEY === 'inversion_atlas.dxyPerInversion.v1');

// =====================================================================
group('isDxyPerInversionJSON');
check('valid → true',
      isDxyPerInversionJSON(makeJSON([{ candidate_id: 'c1' }])) === true);
check('null → false',                         isDxyPerInversionJSON(null) === false);
check('wrong tool → false',
      isDxyPerInversionJSON({ ...makeJSON([]), tool: 'other' }) === false);
check('non-number schema_version → false',
      isDxyPerInversionJSON({ ...makeJSON([]), schema_version: '1' }) === false);
check('per_inversion not array → false',
      isDxyPerInversionJSON({ ...makeJSON([]), per_inversion: 'x' }) === false);

// =====================================================================
group('storeDxyPerInversion');
{
  const state = {};
  const ok = storeDxyPerInversion(state, makeJSON([
    { candidate_id: 'c1', chrom: 'LG28', start_bp: 1000000, end_bp: 2000000,
      fold_elevation_inside_vs_flank: 2.3, dxy_within_inversion_ref_vs_inv: 0.012 },
    { candidate_id: 'c2', chrom: 'LG14', start_bp: 5000000, end_bp: 6000000,
      fold_elevation_inside_vs_flank: 1.1, dxy_within_inversion_ref_vs_inv: 0.003 },
  ]));
  check('returns true',                        ok === true);
  check('state.dxyPerInversion created',       !!state.dxyPerInversion);
  check('per_inversion length = 2',            state.dxyPerInversion.per_inversion.length === 2);
  check('tool stored',                         state.dxyPerInversion.tool === DXY_PER_INVERSION_TOOL);
  check('params copied (deep)',                state.dxyPerInversion.params.window_bp === 100000);
  check('loaded_at is ISO string',             typeof state.dxyPerInversion.loaded_at === 'string');
  // Deep copy: mutating source doesn't affect stored
  const src = state.dxyPerInversion.per_inversion[0];
  check('per_inversion is deep-copied',        src.candidate_id === 'c1');
}
check('null state → false',                  storeDxyPerInversion(null, makeJSON([])) === false);
check('null parsed → false',                 storeDxyPerInversion({}, null) === false);
check('non-dxy JSON → false',                storeDxyPerInversion({}, { foo: 1 }) === false);

// =====================================================================
group('persist / restore round-trip');
{
  globalThis.localStorage.clear();
  const state = {};
  storeDxyPerInversion(state, makeJSON([
    { candidate_id: 'c1', chrom: 'LG28', start_bp: 1, end_bp: 2 },
  ]));
  check('persist → true',                      persistDxyPerInversion(state) === true);
  const state2 = {};
  check('restore → true',                      restoreDxyPerInversion(state2) === true);
  check('restored 1 entry',                    state2.dxyPerInversion.per_inversion.length === 1);
  check('restored candidate_id',
        state2.dxyPerInversion.per_inversion[0].candidate_id === 'c1');
}
{
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(DXY_PER_INVERSION_LS_KEY, 'x');
  const state = { dxyPerInversion: null };
  persistDxyPerInversion(state);
  check('persist with null clears LS',
        globalThis.localStorage.getItem(DXY_PER_INVERSION_LS_KEY) === null);
}
{
  globalThis.localStorage.clear();
  check('restore no key → false',              restoreDxyPerInversion({}) === false);
}
{
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(DXY_PER_INVERSION_LS_KEY, '{not json}');
  let threw = false;
  let ret;
  try { ret = restoreDxyPerInversion({}); } catch (_) { threw = true; }
  check('malformed JSON: no throw',            !threw);
  check('malformed JSON → false',              ret === false);
}

// =====================================================================
group('clearDxyPerInversion');
{
  globalThis.localStorage.clear();
  const state = {};
  storeDxyPerInversion(state, makeJSON([{ candidate_id: 'c1' }]));
  persistDxyPerInversion(state);
  clearDxyPerInversion(state);
  check('state nulled',                        state.dxyPerInversion === null);
  check('LS key cleared',
        globalThis.localStorage.getItem(DXY_PER_INVERSION_LS_KEY) === null);
  let threw = false;
  try { clearDxyPerInversion(null); } catch (_) { threw = true; }
  check('null state: no throw',                !threw);
}

// =====================================================================
group('getDxyForBreakpoint');
{
  const state = {};
  storeDxyPerInversion(state, makeJSON([
    { candidate_id: 'c1', chrom: 'LG28', start_bp: 1_000_000, end_bp: 2_000_000 },
    { candidate_id: 'c2', chrom: 'LG14', start_bp: 5_000_000, end_bp: 6_000_000 },
  ]));
  // Match by candidate_overlap
  check('candidate_overlap match',
        getDxyForBreakpoint(state, { candidate_overlap: ['c1'] }).candidate_id === 'c1');
  // Match by bp.id
  check('bp.id == candidate_id match',
        getDxyForBreakpoint(state, { id: 'c2' }).candidate_id === 'c2');
  // Position-based (gar_pos_mb)
  check('gar_pos_mb match within span',
        getDxyForBreakpoint(state, { gar_chr: 'LG28', gar_pos_mb: 1.5 }).candidate_id === 'c1');
  // Position-based (gar_start/gar_end midpoint)
  check('gar_start/end midpoint match',
        getDxyForBreakpoint(state, { gar_chr: 'LG28',
                                     gar_start: 1_200_000, gar_end: 1_800_000 }).candidate_id === 'c1');
  // C_gar_ prefix tolerance
  check('C_gar_ prefix on bp.gar_chr',
        getDxyForBreakpoint(state, { gar_chr: 'C_gar_LG28', gar_pos_mb: 1.5 }).candidate_id === 'c1');
  // Position outside any span → null
  check('position outside spans → null',
        getDxyForBreakpoint(state, { gar_chr: 'LG28', gar_pos_mb: 50 }) === null);
  // No position info → null
  check('no chrom + no pos → null',
        getDxyForBreakpoint(state, { gar_chr: 'LG28' }) === null);
  // No bp / no state
  check('null bp → null',                      getDxyForBreakpoint(state, null) === null);
  check('null state → null',                   getDxyForBreakpoint(null, { id: 'c1' }) === null);
  check('no dxy loaded → null',                getDxyForBreakpoint({}, { id: 'c1' }) === null);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
