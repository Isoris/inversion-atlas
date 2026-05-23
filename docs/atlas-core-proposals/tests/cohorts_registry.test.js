// docs/atlas-core-proposals/tests/cohorts_registry.test.js
//
// Smokes for reference_impl/cohorts_registry.js. Run with:
//
//   node docs/atlas-core-proposals/tests/cohorts_registry.test.js

import {
  validateCohortsRegistry,
  getCohort,
  listCohorts,
  getCohortsForAtlas,
  findHandoff,
  listHandoffs,
} from '../reference_impl/cohorts_registry.js';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else      { fail++; console.log('  ✗', name, detail ? '— ' + detail : ''); }
}
function group(label) { console.log('\n--- ' + label + ' ---'); }

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const goodAtlasesIndex = { atlases: ['inversion', 'evolution', 'cross-species', 'popstats'] };

const goodRegistry = {
  version: '1.0',
  cohorts: [
    {
      cohort_id: 'f1_hybrid_cga_cma',
      label: 'F1 hybrid',
      species: ['Clarias gariepinus', 'Clarias macrocephalus'],
      reference_id: 'fClaHyb_Gar_LG',
      n_samples_approx: 18,
      scope: 'assembly_paper_only',
      atlases: ['cross-species'],
    },
    {
      cohort_id: 'cgar_hatchery_226',
      label: '226-sample pure C. gariepinus hatchery',
      species: ['Clarias gariepinus'],
      reference_id: 'fClaHyb_Gar_LG',
      n_samples_approx: 226,
      scope: 'inversion_atlas_main_cohort',
      atlases: ['inversion', 'evolution', 'popstats'],
    },
    {
      cohort_id: 'cmac_wild_future',
      label: 'Pure C. macrocephalus wild (future)',
      species: ['Clarias macrocephalus'],
      reference_id: 'fClaHyb_Mac_LG',
      n_samples_approx: null,
      scope: 'future_paper',
      atlases: [],
    },
  ],
  cross_reference_handoffs: [
    {
      handoff_id: 'bp_atlas_to_hatchery_join',
      from_cohort: 'f1_hybrid_cga_cma',
      to_cohort: 'cgar_hatchery_226',
      via_layer_pattern: 'crossSpecies\\.(breakpoints_consolidated|bp_atlas_reciprocity|synteny_18sp|gene_order_catalog|atlas_paf_arcs)_v\\d+',
      handoff_kind: 'coordinate_handoff',
      rationale: 'BP_ATLAS produces breakpoint coordinates on fClaHyb_Gar_LG; hatchery atlas reads coordinates to test population-level overlap. Coordinates only.',
    }
  ]
};

// ---------------------------------------------------------------------------
group('valid registry');
{
  const errs = validateCohortsRegistry(goodRegistry, goodAtlasesIndex);
  check('valid registry produces 0 errors', errs.length === 0, JSON.stringify(errs));
}

// ---------------------------------------------------------------------------
group('missing required fields');
{
  const bad = { version: '1.0' };
  const errs = validateCohortsRegistry(bad, goodAtlasesIndex);
  check('missing cohorts → error', errs.some(e => /cohorts/.test(e)));
}
{
  const bad = JSON.parse(JSON.stringify(goodRegistry));
  delete bad.cohorts[0].cohort_id;
  const errs = validateCohortsRegistry(bad, goodAtlasesIndex);
  check('missing cohort_id → error', errs.length > 0);
}
{
  const bad = JSON.parse(JSON.stringify(goodRegistry));
  delete bad.cohorts[0].reference_id;
  const errs = validateCohortsRegistry(bad, goodAtlasesIndex);
  check('missing reference_id → error', errs.some(e => /reference_id/.test(e)));
}

// ---------------------------------------------------------------------------
group('cross-validation against atlases index');
{
  const bad = JSON.parse(JSON.stringify(goodRegistry));
  bad.cohorts[0].atlases = ['cross-species', 'nonexistent-atlas'];
  const errs = validateCohortsRegistry(bad, goodAtlasesIndex);
  check('atlas not in index → error', errs.some(e => /nonexistent-atlas/.test(e)));
}

// ---------------------------------------------------------------------------
group('duplicates');
{
  const bad = JSON.parse(JSON.stringify(goodRegistry));
  bad.cohorts.push(JSON.parse(JSON.stringify(bad.cohorts[0])));
  const errs = validateCohortsRegistry(bad, goodAtlasesIndex);
  check('duplicate cohort_id → error', errs.some(e => /duplicated/.test(e)));
}

// ---------------------------------------------------------------------------
group('handoff validation');
{
  const bad = JSON.parse(JSON.stringify(goodRegistry));
  bad.cross_reference_handoffs[0].from_cohort = 'nonexistent';
  const errs = validateCohortsRegistry(bad, goodAtlasesIndex);
  check('handoff from unknown cohort → error',
        errs.some(e => /from_cohort/.test(e) && /nonexistent/.test(e)));
}
{
  const bad = JSON.parse(JSON.stringify(goodRegistry));
  bad.cross_reference_handoffs[0].handoff_kind = 'made_up_kind';
  const errs = validateCohortsRegistry(bad, goodAtlasesIndex);
  check('invalid handoff_kind → error', errs.some(e => /handoff_kind/.test(e)));
}
{
  const bad = JSON.parse(JSON.stringify(goodRegistry));
  bad.cross_reference_handoffs[0].via_layer_pattern = '[invalid_regex(';
  const errs = validateCohortsRegistry(bad, goodAtlasesIndex);
  check('invalid regex → error', errs.some(e => /regex/.test(e)));
}
{
  const bad = JSON.parse(JSON.stringify(goodRegistry));
  bad.cross_reference_handoffs[0].rationale = 'short';
  const errs = validateCohortsRegistry(bad, goodAtlasesIndex);
  check('rationale too short → error', errs.some(e => /rationale/.test(e)));
}

// ---------------------------------------------------------------------------
group('lookup');
{
  const c = getCohort(goodRegistry, 'cgar_hatchery_226');
  check('getCohort finds existing', c && c.n_samples_approx === 226);
  check('getCohort returns null for missing', getCohort(goodRegistry, 'nope') === null);

  const list = listCohorts(goodRegistry);
  check('listCohorts returns 3', list.length === 3);

  const forInv = getCohortsForAtlas(goodRegistry, 'inversion');
  check('getCohortsForAtlas inversion → 1 cohort', forInv.length === 1);
  check('inversion atlas cohort is cgar_hatchery_226',
        forInv[0].cohort_id === 'cgar_hatchery_226');

  const forNobody = getCohortsForAtlas(goodRegistry, 'no-such-atlas');
  check('getCohortsForAtlas unknown → []', forNobody.length === 0);
}

// ---------------------------------------------------------------------------
group('handoff lookup');
{
  const hf = findHandoff(goodRegistry,
                         'f1_hybrid_cga_cma',
                         'cgar_hatchery_226',
                         'crossSpecies.bp_atlas_reciprocity_v1');
  check('findHandoff matches the BP_ATLAS handoff',
        hf && hf.handoff_id === 'bp_atlas_to_hatchery_join');

  const noHf = findHandoff(goodRegistry,
                           'f1_hybrid_cga_cma',
                           'cgar_hatchery_226',
                           'crossSpecies.some_unrelated_layer_v1');
  check('findHandoff returns null for non-matching layer', noHf === null);

  const wrongDirection = findHandoff(goodRegistry,
                                     'cgar_hatchery_226',
                                     'f1_hybrid_cga_cma',
                                     'crossSpecies.bp_atlas_reciprocity_v1');
  check('handoff is directional (reverse not allowed)', wrongDirection === null);

  const handoffList = listHandoffs(goodRegistry);
  check('listHandoffs returns 1', handoffList.length === 1);
}

// ---------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
