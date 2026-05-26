// tests/test_analysis_trio_finder.js
//
// Tests for analysis/trio_finder.js — the analysis-shape wrapper around
// findTrios from mendelian.js. Verifies registry-resolve plumbing,
// permissive vs strict threshold modes, and the warm-cache writeback.

import {
  findCohortTrios,
  MODULE_VERSION,
} from '../atlases/popstats/analysis/trio_finder.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
function makeRegistry(layers) {
  return {
    _layers: layers,
    _writes: [],
    async resolve(layerName /*, args */) {
      if (!(layerName in layers)) {
        throw new Error('mock registry: unknown layer ' + layerName);
      }
      return layers[layerName];
    },
    async set(layerName, payload, args) {
      this._writes.push({ layerName, payload, args });
    },
  };
}

// =====================================================================
group('module shape');
check('MODULE_VERSION exported',  typeof MODULE_VERSION === 'string' && MODULE_VERSION.length > 0);
check('findCohortTrios exported', typeof findCohortTrios === 'function');

// =====================================================================
group('findCohortTrios — empty cohort returns empty trios');
{
  const reg = makeRegistry({ cohort_relatedness: { pairs: [] } });
  const result = await findCohortTrios(reg, {});
  check('n_trios = 0',                   result.n_trios === 0);
  check('trios is []',                   Array.isArray(result.trios) && result.trios.length === 0);
  check('default threshold = 1st_degree', result.threshold === '1st_degree');
  check('writeback called once',          reg._writes.length === 1);
  check('writeback layer = trio_inventory', reg._writes[0].layerName === 'trio_inventory');
}

// =====================================================================
group('findCohortTrios — recovers a single parent-pair-child trio');
{
  const pairs = [
    { sample_a: 'PA', sample_b: 'O', relationship_class: 'parent_offspring' },
    { sample_a: 'PB', sample_b: 'O', relationship_class: 'parent_offspring' },
  ];
  const reg = makeRegistry({ cohort_relatedness: { pairs } });
  const result = await findCohortTrios(reg, {});
  check('n_trios = 1',                       result.n_trios === 1);
  check('trio.offspring = O',                result.trios[0].offspring === 'O');
  check('parents are PA + PB (sorted)',
        result.trios[0].father === 'PA' && result.trios[0].mother === 'PB');
}

// =====================================================================
group('findCohortTrios — strict mode rejects 1st_degree-only pairs');
{
  const pairs = [
    { sample_a: 'PA', sample_b: 'O', relationship_class: '1st_degree' },
    { sample_a: 'PB', sample_b: 'O', relationship_class: '1st_degree' },
  ];
  const reg = makeRegistry({ cohort_relatedness: { pairs } });
  const result = await findCohortTrios(reg, { relatedness_threshold: 'parent_offspring' });
  check('strict mode → 0 trios',     result.n_trios === 0);
  check('threshold propagated',      result.threshold === 'parent_offspring');
}

// =====================================================================
group('findCohortTrios — multi-child family yields one trio per offspring');
{
  // Parents PA, PB unrelated; 4 offspring O1..O4 are all 1st_degree (sibs)
  // to each other (won't pollute the trio finder because sibs aren't PO).
  // Use full_sibling to be explicit (caught only by the non-strict pathway
  // — we use parent_offspring labels for the parental edges to keep this
  // test orientation-clean).
  const pairs = [];
  for (let i = 1; i <= 4; i++) {
    pairs.push({ sample_a: 'PA', sample_b: 'O' + i, relationship_class: 'parent_offspring' });
    pairs.push({ sample_a: 'PB', sample_b: 'O' + i, relationship_class: 'parent_offspring' });
    for (let j = i + 1; j <= 4; j++) {
      pairs.push({ sample_a: 'O' + i, sample_b: 'O' + j, relationship_class: 'full_sibling' });
    }
  }
  const reg = makeRegistry({ cohort_relatedness: { pairs } });
  const result = await findCohortTrios(reg, {});
  check('n_trios = 4 (one per offspring)',  result.n_trios === 4);
  const offspringSet = new Set(result.trios.map(t => t.offspring));
  check('all 4 offspring covered',
        offspringSet.size === 4 &&
        ['O1', 'O2', 'O3', 'O4'].every(o => offspringSet.has(o)));
}

// =====================================================================
group('findCohortTrios — payload metadata stable');
{
  const reg = makeRegistry({ cohort_relatedness: { pairs: [] } });
  const result = await findCohortTrios(reg, {});
  check('module_version present',  result.module_version === MODULE_VERSION);
  check('computed_at is ISO',      typeof result.computed_at === 'string'
                                    && result.computed_at.includes('T'));
}

// =====================================================================
console.log('\n=================');
console.log('pass: ' + pass + '   fail: ' + fail);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
