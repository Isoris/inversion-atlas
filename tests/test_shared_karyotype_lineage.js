// tests/test_shared_karyotype_lineage.js

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
  KARYOTYPE_LINEAGE_TOOLS,
  KARYOTYPE_LINEAGE_LS_KEY,
  KARYOTYPE_REFINEMENT_STATES,
  KARYO_BOOST_CONFIRMED_FRAC,
  KARYO_DROP_REFUTED_FRAC,
  KARYO_MIN_TOUCHED_FRAC,
  isKaryotypeLineageJSON,
  storeKaryotypeLineage,
  persistKaryotypeLineage,
  restoreKaryotypeLineage,
  clearKaryotypeLineage,
  getKaryotypeEntryForFocalChr,
  getEffectiveClassForCell,
  getEffectiveTargetsForCell,
  summarizeRefinement,
  adjustConfidenceForRefinement,
} = await import('../atlases/inversion/shared/karyotype_lineage.js');

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

function makeJSON(opts) {
  return Object.assign({
    tool: 'karyotype_lineage_v1',
    schema_version: 1,
    params: { min_segment_bp: 1_000_000, min_pct_identity: 0.85 },
    focal_species: 'Cgar',
    sister_species: ['Cmac'],
    outgroup_species: ['Cfus', 'Capus'],
    per_focal_chr: [
      {
        focal_chr: 'LG28',
        classes_by_species: {
          Cgar: { class: '1-1', targets: ['LG28'] },
          Cmac: { class: '1-2', targets: ['mac_LG7', 'mac_LG12'] },
          Cfus: { class: '1-1', targets: ['fus_LG28'] },
          Capus: { class: '1-1', targets: ['capus_LG28'] },
        },
      },
      {
        focal_chr: 'LG14',
        classes_by_species: {
          Cgar: { class: '1-1', targets: ['LG14'] },
          Cmac: { class: '1-1', targets: ['mac_LG14'] },
        },
      },
    ],
  }, opts || {});
}

// =====================================================================
group('constants');
check('TOOLS frozen, 2 entries',              Object.isFrozen(KARYOTYPE_LINEAGE_TOOLS) && KARYOTYPE_LINEAGE_TOOLS.length === 2);
check('TOOLS includes both v1 + legacy',
      KARYOTYPE_LINEAGE_TOOLS.includes('karyotype_lineage_v1')
      && KARYOTYPE_LINEAGE_TOOLS.includes('mashmap_karyotype_lineage_v1'));
check('LS_KEY matches legacy',                KARYOTYPE_LINEAGE_LS_KEY === 'inversion_atlas.karyotypeLineage.v1');
check('REFINEMENT_STATES frozen, 4 entries',  Object.isFrozen(KARYOTYPE_REFINEMENT_STATES) && KARYOTYPE_REFINEMENT_STATES.length === 4);
check('BOOST_CONFIRMED_FRAC = 0.8',           KARYO_BOOST_CONFIRMED_FRAC === 0.8);
check('DROP_REFUTED_FRAC = 0.3',              KARYO_DROP_REFUTED_FRAC === 0.3);
check('MIN_TOUCHED_FRAC = 0.5',               KARYO_MIN_TOUCHED_FRAC === 0.5);

// =====================================================================
group('isKaryotypeLineageJSON');
check('valid (v1) → true',                    isKaryotypeLineageJSON(makeJSON()) === true);
check('valid (legacy alias) → true',
      isKaryotypeLineageJSON({ ...makeJSON(), tool: 'mashmap_karyotype_lineage_v1' }) === true);
check('legacy per_cgar_chr also accepted',
      isKaryotypeLineageJSON({
        tool: 'mashmap_karyotype_lineage_v1', schema_version: 1, params: {},
        per_cgar_chr: [{ cgar_chr: 'LG28' }],
      }) === true);
check('null → false',                         isKaryotypeLineageJSON(null) === false);
check('wrong tool → false',
      isKaryotypeLineageJSON({ ...makeJSON(), tool: 'other' }) === false);
check('non-number schema → false',
      isKaryotypeLineageJSON({ ...makeJSON(), schema_version: '1' }) === false);
check('missing params → false',
      isKaryotypeLineageJSON({ tool: 'karyotype_lineage_v1', schema_version: 1,
                               per_focal_chr: [] }) === false);
check('no per_focal_chr or per_cgar_chr → false',
      isKaryotypeLineageJSON({ ...makeJSON(), per_focal_chr: undefined,
                               per_cgar_chr: undefined }) === false);

// =====================================================================
group('storeKaryotypeLineage');
{
  const state = {};
  const ok = storeKaryotypeLineage(state, makeJSON());
  check('returns true',                         ok === true);
  check('state.karyotypeLineage created',       !!state.karyotypeLineage);
  check('per_focal_chr length = 2',             state.karyotypeLineage.per_focal_chr.length === 2);
  check('focal_species stored',                 state.karyotypeLineage.focal_species === 'Cgar');
  check('sister_species copied',                state.karyotypeLineage.sister_species[0] === 'Cmac');
  check('outgroup_species 2 entries',           state.karyotypeLineage.outgroup_species.length === 2);
  check('params deep-copied',                   state.karyotypeLineage.params.min_segment_bp === 1_000_000);
  check('loaded_at is ISO',                     typeof state.karyotypeLineage.loaded_at === 'string');
}
{
  // Legacy cgar_chr normalized to focal_chr
  const state = {};
  storeKaryotypeLineage(state, {
    tool: 'mashmap_karyotype_lineage_v1', schema_version: 1, params: {},
    per_cgar_chr: [
      { cgar_chr: 'LG28', classes_by_species: { Cgar: { class: '1-1', targets: ['LG28'] } } },
      { cgar_chr: 'LG14', classes_by_species: { Cgar: { class: '1-1', targets: ['LG14'] } } },
    ],
  });
  check('cgar_chr normalized to focal_chr',
        state.karyotypeLineage.per_focal_chr[0].focal_chr === 'LG28');
  check('still has 2 entries',                  state.karyotypeLineage.per_focal_chr.length === 2);
}
{
  // focal_species inferred from data when not explicit
  const state = {};
  storeKaryotypeLineage(state, {
    tool: 'karyotype_lineage_v1', schema_version: 1, params: {},
    per_focal_chr: [{
      focal_chr: 'LG28',
      classes_by_species: {
        Cgar: { class: '1-1', targets: ['LG28'] },
        Cmac: { class: '1-2', targets: ['mac_LG7', 'mac_LG12'] },
      },
    }],
  });
  check('focal_species inferred from data',     state.karyotypeLineage.focal_species === 'Cgar');
}
check('null state → false',                    storeKaryotypeLineage(null, makeJSON()) === false);
check('null parsed → false',                   storeKaryotypeLineage({}, null) === false);

// =====================================================================
group('persist / restore round-trip');
{
  globalThis.localStorage.clear();
  const state = {};
  storeKaryotypeLineage(state, makeJSON());
  check('persist → true',                       persistKaryotypeLineage(state) === true);
  const state2 = {};
  check('restore → true',                       restoreKaryotypeLineage(state2) === true);
  check('restored 2 chroms',                    state2.karyotypeLineage.per_focal_chr.length === 2);
  check('restored focal_species',               state2.karyotypeLineage.focal_species === 'Cgar');
}
{
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(KARYOTYPE_LINEAGE_LS_KEY, 'x');
  const state = { karyotypeLineage: null };
  persistKaryotypeLineage(state);
  check('persist null clears LS',
        globalThis.localStorage.getItem(KARYOTYPE_LINEAGE_LS_KEY) === null);
}
{
  globalThis.localStorage.clear();
  check('restore no key → false',               restoreKaryotypeLineage({}) === false);
}
{
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(KARYOTYPE_LINEAGE_LS_KEY, '{bad');
  let threw = false;
  let ret;
  try { ret = restoreKaryotypeLineage({}); } catch (_) { threw = true; }
  check('malformed JSON: no throw',             !threw);
  check('malformed JSON → false',               ret === false);
}

// =====================================================================
group('clearKaryotypeLineage');
{
  globalThis.localStorage.clear();
  const state = {};
  storeKaryotypeLineage(state, makeJSON());
  persistKaryotypeLineage(state);
  clearKaryotypeLineage(state);
  check('state nulled',                         state.karyotypeLineage === null);
  check('LS cleared',
        globalThis.localStorage.getItem(KARYOTYPE_LINEAGE_LS_KEY) === null);
  let threw = false;
  try { clearKaryotypeLineage(null); } catch (_) { threw = true; }
  check('null state: no throw',                 !threw);
}

// =====================================================================
group('getKaryotypeEntryForFocalChr');
{
  const state = {};
  storeKaryotypeLineage(state, makeJSON());
  // exact match
  check('exact match: LG28',                    getKaryotypeEntryForFocalChr(state, 'LG28').focal_chr === 'LG28');
  check('exact match: LG14',                    getKaryotypeEntryForFocalChr(state, 'LG14').focal_chr === 'LG14');
  // not present
  check('unknown chrom → null',                 getKaryotypeEntryForFocalChr(state, 'LG99') === null);
}
{
  // Prefix tolerance: entry has 'C_gar_LG28', request 'LG28'
  const state = {};
  storeKaryotypeLineage(state, {
    tool: 'karyotype_lineage_v1', schema_version: 1, params: {}, focal_species: 'Cgar',
    per_focal_chr: [{ focal_chr: 'C_gar_LG28', classes_by_species: {} }],
  });
  check('strip "C_gar_" prefix: LG28 match',    getKaryotypeEntryForFocalChr(state, 'LG28').focal_chr === 'C_gar_LG28');
  check('exact match still works',              getKaryotypeEntryForFocalChr(state, 'C_gar_LG28').focal_chr === 'C_gar_LG28');
}
{
  // Suffix match with separator
  const state = {};
  storeKaryotypeLineage(state, {
    tool: 'karyotype_lineage_v1', schema_version: 1, params: {}, focal_species: 'Cgar',
    per_focal_chr: [{ focal_chr: 'whatever|LG28', classes_by_species: {} }],
  });
  check('|<chr> suffix match',                  getKaryotypeEntryForFocalChr(state, 'LG28').focal_chr === 'whatever|LG28');
}
check('null state → null',                     getKaryotypeEntryForFocalChr(null, 'LG28') === null);
check('empty chrom → null',                    getKaryotypeEntryForFocalChr({}, '') === null);
check('no data loaded → null',                 getKaryotypeEntryForFocalChr({}, 'LG28') === null);

// =====================================================================
group('getEffectiveClassForCell');
check('null cell → null',                      getEffectiveClassForCell(null) === null);
check('confirmed → mashmap class',
      getEffectiveClassForCell({ class: '1-1', refined_by_wfmash: 'confirmed',
                                  wfmash_class: '1-2' }) === '1-1');
check('refuted → wfmash class',
      getEffectiveClassForCell({ class: '1-2', refined_by_wfmash: 'refuted',
                                  wfmash_class: '1-1' }) === '1-1');
check('refined → wfmash class',
      getEffectiveClassForCell({ class: '1-2', refined_by_wfmash: 'refined',
                                  wfmash_class: '1-3' }) === '1-3');
check('refuted but no wfmash_class → mashmap',
      getEffectiveClassForCell({ class: '1-1', refined_by_wfmash: 'refuted' }) === '1-1');
check('failed → mashmap class',
      getEffectiveClassForCell({ class: '1-1', refined_by_wfmash: 'failed',
                                  wfmash_class: 'whatever' }) === '1-1');
check('not attempted (null) → mashmap',        getEffectiveClassForCell({ class: '1-2' }) === '1-2');

// =====================================================================
group('getEffectiveTargetsForCell');
check('null cell → []',                        getEffectiveTargetsForCell(null).length === 0);
{
  // String targets passed through
  const r = getEffectiveTargetsForCell({ class: '1-2', targets: ['mac_LG7', 'mac_LG12'] });
  check('mashmap targets (strings)',            r.length === 2 && r[0] === 'mac_LG7');
}
{
  // refuted overrides with wfmash_targets (string array)
  const r = getEffectiveTargetsForCell({
    class: '1-2', targets: ['mac_LG7', 'mac_LG12'],
    refined_by_wfmash: 'refuted', wfmash_targets: ['mac_LG_unified'],
  });
  check('refuted: wfmash_targets win',          r.length === 1 && r[0] === 'mac_LG_unified');
}
{
  // refined wfmash_targets as objects with chrom field
  const r = getEffectiveTargetsForCell({
    class: '1-2',
    refined_by_wfmash: 'refined',
    wfmash_targets: [{ chrom: 'mac_LG7', start_bp: 0 }, { chrom: 'mac_LG12' }],
  });
  check('object wfmash_targets coerced to chrom strings',
        r.length === 2 && r[0] === 'mac_LG7' && r[1] === 'mac_LG12');
}
{
  // wfmash_targets empty → falls back to mashmap targets
  const r = getEffectiveTargetsForCell({
    class: '1-2', targets: ['fallback'],
    refined_by_wfmash: 'refuted', wfmash_targets: [],
  });
  check('empty wfmash_targets → mashmap fallback', r.length === 1 && r[0] === 'fallback');
}
check('confirmed: mashmap targets preserved',
      JSON.stringify(getEffectiveTargetsForCell({
        targets: ['x', 'y'], refined_by_wfmash: 'confirmed',
        wfmash_targets: ['wrong'],
      })) === JSON.stringify(['x', 'y']));

// =====================================================================
group('summarizeRefinement');
{
  const entry = {
    classes_by_species: {
      A: { class: '1-1', refined_by_wfmash: 'confirmed' },
      B: { class: '1-2', refined_by_wfmash: 'refuted' },
      C: { class: '1-2', refined_by_wfmash: 'refined' },
      D: { class: '1-1', refined_by_wfmash: 'failed' },
      E: { class: '1-1' },                                  // not_attempted
      F: { class: '1-1', refined_by_wfmash: null },         // also not_attempted
    },
  };
  const s = summarizeRefinement(entry);
  check('total = 6',                            s.total === 6);
  check('confirmed = 1',                        s.confirmed === 1);
  check('refuted = 1',                          s.refuted === 1);
  check('refined = 1',                          s.refined === 1);
  check('failed = 1',                           s.failed === 1);
  check('not_attempted = 2',                    s.not_attempted === 2);
}
check('null entry → zeros',                    summarizeRefinement(null).total === 0);
check('no classes_by_species → zeros',         summarizeRefinement({}).total === 0);

// =====================================================================
group('adjustConfidenceForRefinement');
{
  // Boost: ≥80% confirmed, 0 refuted, ≥50% touched
  const verdict = { verdict: 'focal_lineage_fission', confidence: 'medium',
                    rationale: 'base rationale' };
  const s = { confirmed: 5, refuted: 0, refined: 0, failed: 0, not_attempted: 0, total: 5 };
  const r = adjustConfidenceForRefinement(verdict, s);
  check('boosted to high',                      r.confidence === 'high');
  check('refinement note appended',             r.rationale.includes('Boosted by wfmash'));
  check('refinement attached',                  r._refinement === s);
  check('verdict not mutated',                  verdict.confidence === 'medium');
}
{
  // Drop: ≥30% refuted, ≥50% touched
  const verdict = { verdict: 'focal_lineage_fission', confidence: 'medium',
                    rationale: 'base' };
  const s = { confirmed: 1, refuted: 4, refined: 0, failed: 0, not_attempted: 0, total: 5 };
  const r = adjustConfidenceForRefinement(verdict, s);
  check('dropped to low',                       r.confidence === 'low');
  check('caution note appended',                r.rationale.includes('Caution: wfmash refuted'));
}
{
  // Below MIN_TOUCHED_FRAC → unchanged
  const verdict = { verdict: 'focal_lineage_fission', confidence: 'medium',
                    rationale: 'base' };
  const s = { confirmed: 2, refuted: 0, refined: 0, failed: 0, not_attempted: 3, total: 5 };
  // 2/5 = 40% touched, < 50% → no adjustment
  const r = adjustConfidenceForRefinement(verdict, s);
  check('below touched threshold: confidence unchanged', r.confidence === 'medium');
  check('below touched threshold: no note appended',
        r.rationale === 'base');
}
{
  // Confirmed boost requires 0 refuted too
  const verdict = { verdict: 'focal_lineage_fission', confidence: 'medium',
                    rationale: 'base' };
  const s = { confirmed: 4, refuted: 1, refined: 0, failed: 0, not_attempted: 0, total: 5 };
  const r = adjustConfidenceForRefinement(verdict, s);
  check('80% confirmed but 1 refuted: no boost', r.confidence === 'medium' || r.confidence === 'low');
}
{
  // Confidence already high → caps at high
  const verdict = { verdict: 'x', confidence: 'high', rationale: 'r' };
  const s = { confirmed: 5, refuted: 0, refined: 0, failed: 0, not_attempted: 0, total: 5 };
  const r = adjustConfidenceForRefinement(verdict, s);
  check('high already → stays high',            r.confidence === 'high');
}
{
  // Confidence low → drop stays at low
  const verdict = { verdict: 'x', confidence: 'low', rationale: 'r' };
  const s = { confirmed: 1, refuted: 4, refined: 0, failed: 0, not_attempted: 0, total: 5 };
  const r = adjustConfidenceForRefinement(verdict, s);
  check('low already → stays low',              r.confidence === 'low');
}
check('null verdict → null',                   adjustConfidenceForRefinement(null, {}) === null);
check('unresolved verdict unchanged',
      adjustConfidenceForRefinement({ verdict: 'unresolved', confidence: 'low', rationale: '' },
        { confirmed: 5, refuted: 0, refined: 0, failed: 0, not_attempted: 0, total: 5 }).confidence === 'low');
check('null summary → unchanged',
      adjustConfidenceForRefinement({ verdict: 'x', confidence: 'medium', rationale: 'r' }, null).confidence === 'medium');
check('total=0 → unchanged',
      adjustConfidenceForRefinement({ verdict: 'x', confidence: 'medium', rationale: 'r' },
        { confirmed: 0, refuted: 0, refined: 0, failed: 0, not_attempted: 0, total: 0 }).confidence === 'medium');

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
