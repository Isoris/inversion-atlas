// tests/test_shared_synteny_multispecies.js
//
// Unit tests for atlases/cross-species/shared/synteny_multispecies.js
// (synteny_multispecies + phylo_tree + multi_species_ui layers).

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
  SYNTENY_MULTISPECIES_TOOLS,
  SYNTENY_MULTISPECIES_LS_KEY,
  PHYLO_TREE_LS_KEY,
  MULTI_SPECIES_UI_LS_KEY,
  MS_POS_MATCH_BP,
  MS_DEFAULT_SPECIES,
  msInitState,
  msPersistUI,
  isSyntenyMultispeciesJSON,
  storeSyntenyMultispecies,
  persistSyntenyMultispecies,
  restoreSyntenyMultispecies,
  clearSyntenyMultispecies,
  isPhyloTreeJSON,
  storePhyloTree,
  persistPhyloTree,
  restorePhyloTree,
  clearPhyloTree,
  msGetActiveBreakpoint,
  msGetEffectiveSpeciesList,
  msGetLineageDistribution,
} = await import('../atlases/cross-species/shared/synteny_multispecies.js');

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

function makeSyntenyJSON(tool) {
  return {
    tool: tool || 'catfish_synteny_toolkit_v1',
    schema_version: 1,
    generated_at: '2026-05-12T00:00:00Z',
    species: [
      { id: 'Cgar', label: 'Clarias gariepinus', tier: 'core', focal: true },
      { id: 'Cmac', label: 'Clarias macrocephalus', tier: 'core', focal: true },
      { id: 'Cfus', label: 'Clarias fuscus', tier: 'clarias_context', focal: false },
    ],
    synteny_blocks: [
      { id: 'sb1', species_a: 'Cgar', species_b: 'Cmac', start_a: 0, end_a: 1000000 },
    ],
    breakpoints_multilineage: [
      {
        bp_id: 'bp1',
        position: { chrom: 'LG28', pos_bp: 15_000_000 },
        lineage_distribution: { Cgar: 'boundary_present', Cmac: 'boundary_absent', Cfus: 'unknown' },
      },
      {
        bp_id: 'bp2',
        position: { chrom: 'C_gar_LG14', pos_bp: 5_000_000 },
        lineage_distribution: { Cgar: 'fission', Cmac: 'boundary_present' },
      },
    ],
  };
}

function makePhyloJSON() {
  return {
    tool: 'phylo_tree_v1',
    schema_version: 1,
    species_set: ['Cgar', 'Cmac', 'Cfus'],
    newick: '((Cgar:0.1,Cmac:0.1):0.05,Cfus:0.15);',
    calibration: { method: 'TimeTree', ma_node: { 'Cgar_Cmac': 5.5 } },
    support_values: { 'Cgar_Cmac': 100 },
    provenance: { source: 'TimeTree-2026' },
  };
}

// =====================================================================
group('constants');
check('SYNTENY_TOOLS includes both aliases',
      SYNTENY_MULTISPECIES_TOOLS.includes('catfish_synteny_toolkit_v1')
      && SYNTENY_MULTISPECIES_TOOLS.includes('synteny_multispecies_v1'));
check('SYNTENY_TOOLS frozen',                 Object.isFrozen(SYNTENY_MULTISPECIES_TOOLS));
check('SYNTENY LS_KEY',                       SYNTENY_MULTISPECIES_LS_KEY === 'inversion_atlas.syntenyMultispecies.v1');
check('PHYLO LS_KEY',                         PHYLO_TREE_LS_KEY === 'inversion_atlas.phyloTree.v1');
check('UI LS_KEY',                            MULTI_SPECIES_UI_LS_KEY === 'inversion_atlas.multiSpeciesUI.v1');
check('MS_POS_MATCH_BP = 100kb',              MS_POS_MATCH_BP === 100_000);
check('MS_DEFAULT_SPECIES has 10 entries',    MS_DEFAULT_SPECIES.length === 10);
check('MS_DEFAULT_SPECIES frozen',            Object.isFrozen(MS_DEFAULT_SPECIES));
check('Cgar marked focal in defaults',
      MS_DEFAULT_SPECIES.find(s => s.id === 'Cgar').focal === true);
check('Cmac marked focal in defaults',
      MS_DEFAULT_SPECIES.find(s => s.id === 'Cmac').focal === true);

// =====================================================================
group('msInitState / msPersistUI');
{
  globalThis.localStorage.clear();
  const state = {};
  const ui = msInitState(state);
  check('initializes UI object',                !!ui);
  check('active_species defaulted to null',     ui.active_species === null);
  check('syntenyMultispecies slot present',     state.syntenyMultispecies === null);
  check('phyloTree slot present',               state.phyloTree === null);
  // Idempotent
  const ui2 = msInitState(state);
  check('idempotent (same object)',             ui === ui2);
  // Persist + reload
  state._multiSpeciesUI.active_species = 'Cfus';
  msPersistUI(state);
  const state2 = {};
  msInitState(state2);
  check('restored active_species after persist', state2._multiSpeciesUI.active_species === 'Cfus');
}
{
  // Malformed LS payload → defaults preserved
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(MULTI_SPECIES_UI_LS_KEY, '{not json}');
  const state = {};
  msInitState(state);
  check('malformed UI LS payload: defaults preserved',
        state._multiSpeciesUI.active_species === null);
}
check('msInitState null state → null',         msInitState(null) === null);

// =====================================================================
group('isSyntenyMultispeciesJSON');
check('valid (primary tool) → true',           isSyntenyMultispeciesJSON(makeSyntenyJSON()) === true);
check('valid (alias tool) → true',
      isSyntenyMultispeciesJSON(makeSyntenyJSON('synteny_multispecies_v1')) === true);
check('null → false',                          isSyntenyMultispeciesJSON(null) === false);
check('wrong tool → false',
      isSyntenyMultispeciesJSON({ ...makeSyntenyJSON(), tool: 'other' }) === false);
check('missing species array → false',
      isSyntenyMultispeciesJSON({ ...makeSyntenyJSON(), species: null }) === false);
check('missing synteny_blocks → false',
      isSyntenyMultispeciesJSON({ ...makeSyntenyJSON(), synteny_blocks: null }) === false);

// =====================================================================
group('storeSyntenyMultispecies');
{
  const state = {};
  const ok = storeSyntenyMultispecies(state, makeSyntenyJSON());
  check('returns true',                          ok === true);
  check('species deep-copied (3 entries)',       state.syntenyMultispecies.species.length === 3);
  check('breakpoints_multilineage stored',
        state.syntenyMultispecies.breakpoints_multilineage.length === 2);
}
{
  // breakpoints_multilineage missing → []
  const state = {};
  const json = makeSyntenyJSON();
  delete json.breakpoints_multilineage;
  storeSyntenyMultispecies(state, json);
  check('missing breakpoints_multilineage → []',
        Array.isArray(state.syntenyMultispecies.breakpoints_multilineage)
        && state.syntenyMultispecies.breakpoints_multilineage.length === 0);
}
check('null state → false',                    storeSyntenyMultispecies(null, makeSyntenyJSON()) === false);
check('null parsed → false',                   storeSyntenyMultispecies({}, null) === false);

// =====================================================================
group('synteny persist / restore round-trip');
{
  globalThis.localStorage.clear();
  const state = {};
  storeSyntenyMultispecies(state, makeSyntenyJSON());
  check('persist → true',                        persistSyntenyMultispecies(state) === true);
  const state2 = {};
  check('restore → true',                        restoreSyntenyMultispecies(state2) === true);
  check('restored 3 species',                    state2.syntenyMultispecies.species.length === 3);
  check('restored 2 lineage breakpoints',
        state2.syntenyMultispecies.breakpoints_multilineage.length === 2);
}
{
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(SYNTENY_MULTISPECIES_LS_KEY, 'x');
  const state = { syntenyMultispecies: null };
  persistSyntenyMultispecies(state);
  check('persist with null clears LS',
        globalThis.localStorage.getItem(SYNTENY_MULTISPECIES_LS_KEY) === null);
}
{
  globalThis.localStorage.clear();
  check('restore no key → false',                restoreSyntenyMultispecies({}) === false);
}
{
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(SYNTENY_MULTISPECIES_LS_KEY, '{bad json');
  let threw = false;
  let ret;
  try { ret = restoreSyntenyMultispecies({}); } catch (_) { threw = true; }
  check('malformed JSON: no throw',              !threw);
  check('malformed JSON → false',                ret === false);
}

// =====================================================================
group('clearSyntenyMultispecies');
{
  globalThis.localStorage.clear();
  const state = {};
  storeSyntenyMultispecies(state, makeSyntenyJSON());
  persistSyntenyMultispecies(state);
  clearSyntenyMultispecies(state);
  check('state nulled',                          state.syntenyMultispecies === null);
  check('LS cleared',
        globalThis.localStorage.getItem(SYNTENY_MULTISPECIES_LS_KEY) === null);
  let threw = false;
  try { clearSyntenyMultispecies(null); } catch (_) { threw = true; }
  check('null state: no throw',                  !threw);
}

// =====================================================================
group('phylo_tree layer');
check('valid → true',                          isPhyloTreeJSON(makePhyloJSON()) === true);
check('wrong tool → false',
      isPhyloTreeJSON({ ...makePhyloJSON(), tool: 'other' }) === false);
check('non-string newick → false',
      isPhyloTreeJSON({ ...makePhyloJSON(), newick: null }) === false);
check('species_set not array → false',
      isPhyloTreeJSON({ ...makePhyloJSON(), species_set: 'x' }) === false);
{
  const state = {};
  storePhyloTree(state, makePhyloJSON());
  check('stored newick',                         state.phyloTree.newick.startsWith('(('));
  check('species_set 3 entries',                 state.phyloTree.species_set.length === 3);
  check('calibration preserved',                 state.phyloTree.calibration.method === 'TimeTree');
}
{
  globalThis.localStorage.clear();
  const state = {};
  storePhyloTree(state, makePhyloJSON());
  persistPhyloTree(state);
  const state2 = {};
  check('phylo restore round-trip',              restorePhyloTree(state2) === true);
  check('newick survived round-trip',            state2.phyloTree.newick.includes('Cgar'));
  clearPhyloTree(state2);
  check('phylo clear nulls state',               state2.phyloTree === null);
}
{
  // Phylo with optional fields missing
  const state = {};
  const minimal = { tool: 'phylo_tree_v1', schema_version: 1,
                    newick: '(A,B);', species_set: ['A', 'B'] };
  storePhyloTree(state, minimal);
  check('phylo missing optional → null fields',
        state.phyloTree.calibration === null
        && state.phyloTree.support_values === null
        && state.phyloTree.provenance === null);
}

// =====================================================================
group('msGetActiveBreakpoint');
{
  const state = {
    crossSpecies: { breakpoints: [{ id: 'bp1', gar_chr: 'LG28' }, { id: 'bp2', gar_chr: 'LG14' }] },
    _crossSpeciesUI: { active_id: 'bp2' },
  };
  check('returns matching bp',                   msGetActiveBreakpoint(state).id === 'bp2');
}
{
  const state = { crossSpecies: { breakpoints: [{ id: 'bp1' }] }, _crossSpeciesUI: { active_id: null } };
  check('no active_id → null',                   msGetActiveBreakpoint(state) === null);
}
{
  const state = { crossSpecies: { breakpoints: [{ id: 'bp1' }] }, _crossSpeciesUI: { active_id: 'bp99' } };
  check('unknown active_id → null',              msGetActiveBreakpoint(state) === null);
}
check('no crossSpecies → null',                  msGetActiveBreakpoint({}) === null);
check('null state → null',                       msGetActiveBreakpoint(null) === null);

// =====================================================================
group('msGetEffectiveSpeciesList');
{
  // No layer → defaults
  const list = msGetEffectiveSpeciesList({});
  check('no layer → 10 default species',         list.length === 10);
  check('returns copies (mutable)',              list[0] !== MS_DEFAULT_SPECIES[0]);
}
{
  const state = {};
  storeSyntenyMultispecies(state, makeSyntenyJSON());
  const list = msGetEffectiveSpeciesList(state);
  check('layer loaded → from manifest (3)',      list.length === 3);
  check('id mapped',                             list[0].id === 'Cgar');
  check('focal flag preserved',                  list[0].focal === true);
}
{
  // Sparse entries with no id → filtered out
  const state = { syntenyMultispecies: {
    species: [{ name: 'Cgar' }, { /* no id */ }, { id: 'X' }],
  }};
  const list = msGetEffectiveSpeciesList(state);
  check('sparse entries: no-id rows filtered',   list.length === 2);
  check('name → id fallback works',              list[0].id === 'Cgar');
}
{
  // Role-based focal detection (legacy alias)
  const state = { syntenyMultispecies: {
    species: [{ id: 'X', role: 'sister' }, { id: 'Y', role: 'focal' }, { id: 'Z' }],
  }};
  const list = msGetEffectiveSpeciesList(state);
  check('role=sister → focal=true',              list.find(s => s.id === 'X').focal === true);
  check('role=focal → focal=true',               list.find(s => s.id === 'Y').focal === true);
  check('no role → focal=false',                 list.find(s => s.id === 'Z').focal === false);
}
check('null state → defaults',                  msGetEffectiveSpeciesList(null).length === 10);

// =====================================================================
group('msGetLineageDistribution');
{
  const state = {};
  storeSyntenyMultispecies(state, makeSyntenyJSON());
  // Match by bp_id
  const r1 = msGetLineageDistribution(state, { id: 'bp1' });
  check('bp_id match',                           r1 && r1.Cgar === 'boundary_present');
  // Position-based fallback (gar_pos_mb in window of bp2)
  const r2 = msGetLineageDistribution(state,
    { gar_chr: 'LG14', gar_pos_mb: 5.05 });
  check('position match (gar_pos_mb)',           r2 && r2.Cmac === 'boundary_present');
  // start/end midpoint match
  const r3 = msGetLineageDistribution(state,
    { gar_chr: 'LG28', gar_start: 14_950_000, gar_end: 15_050_000 });
  check('start/end midpoint match',              r3 && r3.Cgar === 'boundary_present');
  // C_gar_ prefix tolerance
  const r4 = msGetLineageDistribution(state,
    { gar_chr: 'C_gar_LG28', gar_pos_mb: 15 });
  check('C_gar_ prefix tolerance',               r4 && r4.Cgar === 'boundary_present');
  // Outside 100kb window → null
  const r5 = msGetLineageDistribution(state,
    { gar_chr: 'LG28', gar_pos_mb: 15.5 });
  check('outside 100kb window → null',           r5 === null);
  // Null guards
  check('null state → null',                     msGetLineageDistribution(null, { id: 'bp1' }) === null);
  check('null bp → null',                        msGetLineageDistribution(state, null) === null);
  check('no synteny loaded → null',              msGetLineageDistribution({}, { id: 'bp1' }) === null);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
