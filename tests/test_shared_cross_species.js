// tests/test_shared_cross_species.js
//
// Unit tests for atlases/cross-species/shared/cross_species.js — the
// cs_breakpoints_v1 data layer.

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
  CROSS_SPECIES_TOOL,
  CROSS_SPECIES_LS_KEY,
  CROSS_SPECIES_FLANK_DEFAULT_BP,
  CS_EVENT_DEF,
  isCrossSpeciesJSON,
  ensureCrossSpeciesState,
  storeCrossSpecies,
  persistCrossSpecies,
  restoreCrossSpecies,
  clearCrossSpecies,
  getCrossSpeciesBreakpointById,
  getCsEventDef,
} = await import('../atlases/cross-species/shared/cross_species.js');

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

function makeBp(id, eventType, garChr, garPosMb) {
  return {
    id, event_type: eventType,
    gar_chr: garChr, gar_pos_start: garPosMb * 1e6 - 1000,
    gar_pos_end: garPosMb * 1e6 + 1000, gar_pos_mb: garPosMb,
    prev_block: { mac_chr: 'mac_LG7', mac_start_bp: 0, mac_end_bp: 1e6,
                  strand: '+', block_size_bp: 1e6, mapping_quality: 60 },
    next_block: { mac_chr: 'mac_LG7', mac_start_bp: 2e6, mac_end_bp: 3e6,
                  strand: '+', block_size_bp: 1e6, mapping_quality: 60 },
    flanking_repeat_density_gar: { all_TE: { mean: 0.4, max: 0.6, n_windows: 10 } },
  };
}

function makeJSON(bps, schemaVersion) {
  return {
    tool: CROSS_SPECIES_TOOL,
    schema_version: schemaVersion || 1,
    generated_at: '2026-05-12T00:00:00Z',
    species_query:  { name: 'C_gariepinus', haplotype: 'hap1' },
    species_target: { name: 'C_macrocephalus', haplotype: 'hap1' },
    input_paf: 'cgar_vs_cmac.paf',
    params: { min_block_size_bp: 1_000_000, min_pct_identity: 0.85 },
    n_breakpoints: bps.length,
    n_by_event_type: { inversion: bps.filter(b => b.event_type === 'inversion').length },
    breakpoints: bps,
  };
}

// =====================================================================
group('constants');
check('TOOL = cross_species_breakpoints_v1',
      CROSS_SPECIES_TOOL === 'cross_species_breakpoints_v1');
check('LS_KEY matches legacy',                CROSS_SPECIES_LS_KEY === 'pca_scrubber_v3.crossSpecies.v1');
check('FLANK_DEFAULT_BP = 100kb',             CROSS_SPECIES_FLANK_DEFAULT_BP === 100_000);
check('CS_EVENT_DEF frozen',                  Object.isFrozen(CS_EVENT_DEF));
check('CS_EVENT_DEF.inversion has label',     CS_EVENT_DEF.inversion.label === 'inversion');
check('CS_EVENT_DEF.translocation has icon',  typeof CS_EVENT_DEF.translocation.icon === 'string');
check('CS_EVENT_DEF.mixed present',           !!CS_EVENT_DEF.mixed);
check('CS_EVENT_DEF.fission_or_fusion present', !!CS_EVENT_DEF.fission_or_fusion);

// =====================================================================
group('isCrossSpeciesJSON');
check('valid → true',                          isCrossSpeciesJSON(makeJSON([makeBp('bp1', 'inversion', 'LG28', 15.0)])) === true);
check('null → false',                          isCrossSpeciesJSON(null) === false);
check('wrong tool → false',
      isCrossSpeciesJSON({ ...makeJSON([]), tool: 'other' }) === false);
check('non-number schema → false',
      isCrossSpeciesJSON({ ...makeJSON([]), schema_version: '1' }) === false);
check('missing breakpoints → false',
      isCrossSpeciesJSON({ tool: CROSS_SPECIES_TOOL, schema_version: 1 }) === false);

// =====================================================================
group('ensureCrossSpeciesState');
{
  const state = {};
  const ui = ensureCrossSpeciesState(state);
  check('initializes UI state',                  !!ui);
  check('crossSpecies starts null',              state.crossSpecies === null);
  check('active_id null',                        ui.active_id === null);
  check('filter.events null (all)',              ui.filter.events === null);
  check('filter.search empty',                   ui.filter.search === '');
  check('sort defaults to gar_pos',              ui.sort === 'gar_pos');
  check('flank_bp = 100kb default',              ui.flank_bp === CROSS_SPECIES_FLANK_DEFAULT_BP);
  // Idempotent
  const ui2 = ensureCrossSpeciesState(state);
  check('idempotent (same UI object)',           ui === ui2);
}
{
  // Pre-existing UI state preserved
  const state = { _crossSpeciesUI: { active_id: 'bp7', sort: 'gar_chr', filter: {} } };
  const ui = ensureCrossSpeciesState(state);
  check('existing active_id preserved',          ui.active_id === 'bp7');
  check('existing sort preserved',               ui.sort === 'gar_chr');
}
check('null state → null',                     ensureCrossSpeciesState(null) === null);

// =====================================================================
group('storeCrossSpecies');
{
  const state = {};
  const ok = storeCrossSpecies(state, makeJSON([
    makeBp('bp1', 'inversion', 'LG28', 15.0),
    makeBp('bp2', 'translocation', 'LG14', 5.0),
  ]));
  check('returns true',                          ok === true);
  check('state.crossSpecies populated',          !!state.crossSpecies);
  check('n_breakpoints = 2',                     state.crossSpecies.n_breakpoints === 2);
  check('breakpoints deep-copied',               state.crossSpecies.breakpoints.length === 2);
  check('species_query stored',                  state.crossSpecies.species_query.name === 'C_gariepinus');
  check('params stored',                         state.crossSpecies.params.min_pct_identity === 0.85);
  check('loaded_at is ISO string',               typeof state.crossSpecies.loaded_at === 'string');
  // Caches invalidated
  state._csSyntenyCache = { stale: true };
  state._csOverlayIndex = { stale: true };
  storeCrossSpecies(state, makeJSON([makeBp('bp1', 'inversion', 'LG28', 15.0)]));
  check('synteny cache invalidated on re-store', state._csSyntenyCache === null);
  check('overlay index invalidated',             state._csOverlayIndex === null);
}
{
  // schema v2 fields
  const state = {};
  const json = makeJSON([makeBp('bp1', 'inversion', 'LG28', 15.0)], 2);
  json.synteny_blocks = [
    { id: 'sb1', gar_chr: 'LG28', gar_start: 0, gar_end: 1e6, mac_chr: 'mac_LG7' },
    { id: 'sb2', gar_chr: 'LG28', gar_start: 2e6, gar_end: 3e6, mac_chr: 'mac_LG7' },
  ];
  json.chrom_lengths_query  = { LG28: 30_000_000 };
  json.chrom_lengths_target = { mac_LG7: 35_000_000 };
  storeCrossSpecies(state, json);
  check('v2: synteny_blocks deep-copied',        state.crossSpecies.synteny_blocks.length === 2);
  check('v2: n_synteny_blocks derived',          state.crossSpecies.n_synteny_blocks === 2);
  check('v2: chrom_lengths_query stored',        state.crossSpecies.chrom_lengths_query.LG28 === 30_000_000);
}
{
  // v1: synteny_blocks absent → null
  const state = {};
  storeCrossSpecies(state, makeJSON([makeBp('bp1', 'inversion', 'LG28', 15.0)]));
  check('v1: synteny_blocks null',               state.crossSpecies.synteny_blocks === null);
  check('v1: n_synteny_blocks = 0',              state.crossSpecies.n_synteny_blocks === 0);
}
{
  // n_breakpoints fallback to breakpoints.length when not specified
  const state = {};
  const json = makeJSON([makeBp('bp1', 'inversion', 'LG28', 15.0)]);
  delete json.n_breakpoints;
  storeCrossSpecies(state, json);
  check('n_breakpoints fallback',                state.crossSpecies.n_breakpoints === 1);
}
{
  // species_query / species_target defaults when absent
  const state = {};
  const json = makeJSON([makeBp('bp1', 'inversion', 'LG28', 15.0)]);
  delete json.species_query;
  delete json.species_target;
  storeCrossSpecies(state, json);
  check('species_query defaulted',
        state.crossSpecies.species_query.name === 'unknown'
        && state.crossSpecies.species_query.haplotype === '?');
}
check('null state → false',                    storeCrossSpecies(null, makeJSON([])) === false);
check('null parsed → false',                   storeCrossSpecies({}, null) === false);
check('wrong-shape input → false',             storeCrossSpecies({}, { foo: 1 }) === false);

// =====================================================================
group('persist / restore round-trip');
{
  globalThis.localStorage.clear();
  const state = {};
  storeCrossSpecies(state, makeJSON([
    makeBp('bp1', 'inversion', 'LG28', 15.0),
    makeBp('bp2', 'translocation', 'LG14', 5.0),
  ]));
  check('persist → true',                        persistCrossSpecies(state) === true);
  const state2 = {};
  check('restore → true',                        restoreCrossSpecies(state2) === true);
  check('restored 2 bps',                        state2.crossSpecies.breakpoints.length === 2);
  check('bp1 id round-tripped',
        state2.crossSpecies.breakpoints[0].id === 'bp1');
  check('event_type round-tripped',
        state2.crossSpecies.breakpoints[1].event_type === 'translocation');
}
{
  // Null data → LS cleared
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(CROSS_SPECIES_LS_KEY, 'x');
  const state = { crossSpecies: null };
  persistCrossSpecies(state);
  check('persist with null clears LS',
        globalThis.localStorage.getItem(CROSS_SPECIES_LS_KEY) === null);
}
{
  globalThis.localStorage.clear();
  check('restore no key → false',                restoreCrossSpecies({}) === false);
}
{
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(CROSS_SPECIES_LS_KEY, '{bad json');
  let threw = false;
  let ret;
  try { ret = restoreCrossSpecies({}); } catch (_) { threw = true; }
  check('malformed JSON: no throw',              !threw);
  check('malformed JSON → false',                ret === false);
}

// =====================================================================
group('clearCrossSpecies');
{
  globalThis.localStorage.clear();
  const state = {};
  ensureCrossSpeciesState(state);
  storeCrossSpecies(state, makeJSON([makeBp('bp1', 'inversion', 'LG28', 15.0)]));
  state._crossSpeciesUI.active_id = 'bp1';
  state._csSyntenyCache = { stale: true };
  persistCrossSpecies(state);
  clearCrossSpecies(state);
  check('state nulled',                          state.crossSpecies === null);
  check('active_id reset',                       state._crossSpeciesUI.active_id === null);
  check('synteny cache cleared',                 state._csSyntenyCache === null);
  check('LS key cleared',
        globalThis.localStorage.getItem(CROSS_SPECIES_LS_KEY) === null);
  let threw = false;
  try { clearCrossSpecies(null); } catch (_) { threw = true; }
  check('null state: no throw',                  !threw);
}

// =====================================================================
group('getCrossSpeciesBreakpointById');
{
  const state = {};
  storeCrossSpecies(state, makeJSON([
    makeBp('bp1', 'inversion', 'LG28', 15.0),
    makeBp('bp2', 'translocation', 'LG14', 5.0),
  ]));
  check('match by id',                           getCrossSpeciesBreakpointById(state, 'bp2').id === 'bp2');
  check('unknown id → null',                     getCrossSpeciesBreakpointById(state, 'bp99') === null);
  check('null bpId → null',                      getCrossSpeciesBreakpointById(state, null) === null);
  check('empty bpId → null',                     getCrossSpeciesBreakpointById(state, '') === null);
  check('null state → null',                     getCrossSpeciesBreakpointById(null, 'bp1') === null);
  check('no data loaded → null',                 getCrossSpeciesBreakpointById({}, 'bp1') === null);
}

// =====================================================================
group('getCsEventDef');
check('inversion → CS_EVENT_DEF.inversion',
      getCsEventDef({ event_type: 'inversion' }) === CS_EVENT_DEF.inversion);
check('event_type_refined wins',
      getCsEventDef({ event_type: 'inversion',
                      event_type_refined: 'translocation' }) === CS_EVENT_DEF.translocation);
check('unknown type → null',
      getCsEventDef({ event_type: 'never_heard_of_it' }) === null);
check('no type → null',                        getCsEventDef({}) === null);
check('null bp → null',                        getCsEventDef(null) === null);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
