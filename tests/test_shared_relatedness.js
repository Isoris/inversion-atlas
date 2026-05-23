// tests/test_shared_relatedness.js

import {
  RELATEDNESS_DEGREES,
  RELATEDNESS_NO_HUB,
  getRelatedness,
  relSampleMap,
  getHubIdAt,
  getNumHubsAt,
} from '../atlases/popstats/shared/relatedness.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

function makeState() {
  return {
    data: {
      samples: [
        { cga: 'CGA001' },
        { cga: 'CGA002' },
        { ind: 'CGA003' },   // ind fallback
        { sample_id: 'CGA004' },  // sample_id fallback
        { cga: 'CGA_NOT_IN_REL' },
        { /* nothing */ },
      ],
      relatedness: {
        n_samples: 4,
        samples: ['CGA001', 'CGA002', 'CGA003', 'CGA004'],
        thresholds: { t1: 0.177, t2: 0.0884, t3: 0.0442 },
        hub_id_1st: [0, 0, 1, 1],   // 2 hubs at degree 1
        hub_id_2nd: [0, 1, 1, 2],   // 3 hubs at degree 2
        hub_id_3rd: [0, 0, 0, 0],   // 1 hub at degree 3
        n_hubs: { n1: 2, n2: 3, n3: 1 },
      },
    },
  };
}

// =====================================================================
group('constants');
check('DEGREES frozen + [1,2,3]',
      Object.isFrozen(RELATEDNESS_DEGREES)
      && JSON.stringify(RELATEDNESS_DEGREES) === '[1,2,3]');
check('NO_HUB = -1',                          RELATEDNESS_NO_HUB === -1);

// =====================================================================
group('getRelatedness');
check('valid state → layer',                  getRelatedness(makeState()).n_samples === 4);
check('null state → null',                    getRelatedness(null) === null);
check('no data → null',                       getRelatedness({}) === null);
check('no relatedness → null',                getRelatedness({ data: {} }) === null);

// =====================================================================
group('relSampleMap');
{
  const state = makeState();
  const m = relSampleMap(state);
  check('returns Map',                         m instanceof Map);
  check('CGA001 (si=0) → rel idx 0',           m.get(0) === 0);
  check('CGA002 (si=1) → rel idx 1',           m.get(1) === 1);
  check('ind fallback CGA003 → rel idx 2',     m.get(2) === 2);
  check('sample_id fallback CGA004 → rel idx 3', m.get(3) === 3);
  check('si=4 (CGA_NOT_IN_REL) → no entry',    m.get(4) === undefined);
  check('si=5 (no id) → no entry',             m.get(5) === undefined);
  // Cached
  const m2 = relSampleMap(state);
  check('cached on relatedness layer',         m === m2);
  check('cache key __scrubber_idx_map exists', state.data.relatedness.__scrubber_idx_map === m);
}
check('null state → null',                    relSampleMap(null) === null);
check('no relatedness → null',                relSampleMap({ data: { samples: [] } }) === null);
check('no samples array → null',              relSampleMap({ data: { relatedness: { samples: [] } } }) === null);

// =====================================================================
group('getHubIdAt');
{
  const state = makeState();
  check('si=0 degree=1 → hub 0',                getHubIdAt(state, 0, 1) === 0);
  check('si=1 degree=1 → hub 0',                getHubIdAt(state, 1, 1) === 0);
  check('si=2 degree=1 → hub 1',                getHubIdAt(state, 2, 1) === 1);
  check('si=3 degree=1 → hub 1',                getHubIdAt(state, 3, 1) === 1);
  check('si=0 degree=2 → hub 0',                getHubIdAt(state, 0, 2) === 0);
  check('si=2 degree=2 → hub 1',                getHubIdAt(state, 2, 2) === 1);
  check('si=3 degree=2 → hub 2',                getHubIdAt(state, 3, 2) === 2);
  check('si=0 degree=3 → hub 0',                getHubIdAt(state, 0, 3) === 0);
  check('invalid degree → coerce to 1',         getHubIdAt(state, 0, 99) === 0);
  check('si not in rel → -1',                   getHubIdAt(state, 4, 1) === -1);
  check('si beyond samples → -1',               getHubIdAt(state, 99, 1) === -1);
}
check('null state → -1',                      getHubIdAt(null, 0, 1) === -1);
check('no relatedness → -1',                  getHubIdAt({}, 0, 1) === -1);
{
  // arr missing → -1
  const state = makeState();
  state.data.relatedness.hub_id_1st = null;
  check('missing hub array → -1',               getHubIdAt(state, 0, 1) === -1);
}

// =====================================================================
group('getNumHubsAt');
{
  const state = makeState();
  check('degree 1 → 2',                         getNumHubsAt(state, 1) === 2);
  check('degree 2 → 3',                         getNumHubsAt(state, 2) === 3);
  check('degree 3 → 1',                         getNumHubsAt(state, 3) === 1);
  check('invalid degree → coerce to 1',         getNumHubsAt(state, 99) === 2);
}
check('null state → 0',                       getNumHubsAt(null, 1) === 0);
check('no relatedness → 0',                   getNumHubsAt({}, 1) === 0);
check('no n_hubs → 0',
      getNumHubsAt({ data: { relatedness: { samples: [] } } }, 1) === 0);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
