// tests/test_shared_build_family_palette.js
//
// Behavior tests for buildFamilyPalette in shared/page1_data_helpers.js.
// Covers: hub/small/singleton classification, palette ordering by hub size,
// and the golden-angle HSL extension for hub counts above the curated 30.

import { buildFamilyPalette } from '../atlases/inversion/shared/page1_data_helpers.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

const CURATED_FIRST = '#332288';
const CURATED_LAST  = '#6b21a8';

function makeSamplesForFamilies(spec) {
  // spec: Map<family_id, count>
  const samples = [];
  for (const [fid, n] of spec.entries()) {
    for (let i = 0; i < n; i++) samples.push({ family_id: fid });
  }
  return samples;
}

// =====================================================================
group('classification by size');
{
  const spec = new Map([
    [10, 5],   // hub (n >= 4)
    [11, 4],   // hub
    [12, 3],   // small (2..3)
    [13, 2],   // small
    [14, 1],   // singleton
    [-1, 7],   // unmatched bucket, excluded from any group
  ]);
  const state = { data: { samples: makeSamplesForFamilies(spec) } };
  buildFamilyPalette(state);

  check('hubs ordered by descending size',
        state.hubFamilies[0] === 10 && state.hubFamilies[1] === 11);
  check('only 2 hubs assigned',          state.hubFamilies.length === 2);
  check('smallFamilyIds contains 12,13', state.smallFamilyIds.has(12) && state.smallFamilyIds.has(13));
  check('singletonFamilyIds contains 14', state.singletonFamilyIds.has(14));
  check('-1 is not a hub',                !state.hubFamilies.includes(-1));
  check('-1 is not in small',             !state.smallFamilyIds.has(-1));
  check('-1 is not in singleton',         !state.singletonFamilyIds.has(-1));
  check('largest hub gets first curated color',
        state.familyPalette[10] === CURATED_FIRST);
}

// =====================================================================
group('palette overflow — hub #31+ uses golden-angle HSL');
{
  // 32 hubs, all size 4, with deterministic ids so sort order is stable.
  // Sort is by descending count; ties are insertion order from Map.
  const spec = new Map();
  for (let i = 0; i < 32; i++) spec.set(1000 + i, 4);
  const state = { data: { samples: makeSamplesForFamilies(spec) } };
  buildFamilyPalette(state);

  check('all 32 hubs registered', state.hubFamilies.length === 32);

  // Hubs 0..29 (the first 30) get curated hex colors.
  const hub0  = state.familyPalette[state.hubFamilies[0]];
  const hub29 = state.familyPalette[state.hubFamilies[29]];
  check('hub #0 = first curated color',  hub0  === CURATED_FIRST);
  check('hub #29 = last curated color',  hub29 === CURATED_LAST);

  // Hubs 30 and 31 fall into the procedural extension.
  const hub30 = state.familyPalette[state.hubFamilies[30]];
  const hub31 = state.familyPalette[state.hubFamilies[31]];
  check('hub #30 is hsl(...)',  typeof hub30 === 'string' && hub30.startsWith('hsl('));
  check('hub #31 is hsl(...)',  typeof hub31 === 'string' && hub31.startsWith('hsl('));
  check('hub #30 ≠ hub #31',    hub30 !== hub31);

  // None of the procedural colors should accidentally equal the curated hexes
  // (would indicate the overflow branch produced a curated lookalike string).
  const curatedSet = new Set(Object.values(state.familyPalette).filter(c => c.startsWith('#')));
  const overflowCollision =
    curatedSet.has(hub30) || curatedSet.has(hub31);
  check('overflow colors do not collide with curated hex set', !overflowCollision);
}

// =====================================================================
group('determinism — same input → same palette');
{
  const spec = new Map();
  for (let i = 0; i < 40; i++) spec.set(2000 + i, 4);
  const a = { data: { samples: makeSamplesForFamilies(spec) } };
  const b = { data: { samples: makeSamplesForFamilies(spec) } };
  buildFamilyPalette(a);
  buildFamilyPalette(b);
  let same = true;
  for (const f of a.hubFamilies) {
    if (a.familyPalette[f] !== b.familyPalette[f]) { same = false; break; }
  }
  check('palette is deterministic across runs', same);
}

// =====================================================================
group('null / missing inputs are tolerated');
{
  const s1 = {};
  buildFamilyPalette(s1);
  check('no data → familyPalette = {}',
        s1.familyPalette && Object.keys(s1.familyPalette).length === 0);
  check('no data → hubFamilies = []',
        Array.isArray(s1.hubFamilies) && s1.hubFamilies.length === 0);

  const s2 = { data: {} };
  buildFamilyPalette(s2);
  check('data without samples → familyPalette = {}',
        Object.keys(s2.familyPalette).length === 0);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
