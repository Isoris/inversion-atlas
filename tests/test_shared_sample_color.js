// tests/test_shared_sample_color.js
//
// Unit tests for shared/sample_color.js — the page-independent sample
// color resolvers (family / lineage / scope-mode dispatcher). Every
// page that needs to color a sample by its family or lineage pulls
// from here rather than reaching into another page's _pageState.

import {
  familyColor,
  lineageColor,
  resolveSampleScopeColor,
} from '../atlases/inversion/shared/sample_color.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('familyColor — null / missing inputs');
check('null state → UNMATCHED grey',
      familyColor(null, 0) === '#94a3b8');
check('state without data → UNMATCHED grey',
      familyColor({}, 0) === '#94a3b8');
check('state without samples → UNMATCHED grey',
      familyColor({ data: {} }, 0) === '#94a3b8');
check('out-of-range si → UNMATCHED grey',
      familyColor({ data: { samples: [{ family_id: 1 }] } }, 5) === '#94a3b8');
check('sample with no family_id → UNMATCHED',
      familyColor({ data: { samples: [{}] } }, 0) === '#94a3b8');
check('family_id = -1 → UNMATCHED',
      familyColor({ data: { samples: [{ family_id: -1 }] } }, 0) === '#94a3b8');
check('family_id = null → UNMATCHED',
      familyColor({ data: { samples: [{ family_id: null }] } }, 0) === '#94a3b8');

// =====================================================================
group('familyColor — palette lookups');
{
  const state = {
    data: { samples: [
      { family_id: 7 },
      { family_id: 7 },
      { family_id: 99 },     // in smallFamilyIds
      { family_id: 100 },    // in singletonFamilyIds
      { family_id: 200 },    // unknown
    ] },
    familyPalette: { 7: '#abcdef' },
    smallFamilyIds: new Set([99]),
    singletonFamilyIds: new Set([100]),
  };
  check('family in palette → custom hex',     familyColor(state, 0) === '#abcdef');
  check('family in palette (different si) → same hex',
                                              familyColor(state, 1) === '#abcdef');
  check('family in smallFamilyIds → SMALL fallback',
                                              familyColor(state, 2) === '#cbd5e1');
  check('family in singletonFamilyIds → SINGLETON',
                                              familyColor(state, 3) === '#dde3eb');
  check('unknown family → UNMATCHED',         familyColor(state, 4) === '#94a3b8');
}

// =====================================================================
group('familyColor — missing optional state slots is tolerated');
{
  // No familyPalette / smallFamilyIds / singletonFamilyIds — still
  // returns UNMATCHED rather than throwing.
  const state = { data: { samples: [{ family_id: 5 }] } };
  check('missing palette + sets → UNMATCHED',
        familyColor(state, 0) === '#94a3b8');
}

// =====================================================================
group('lineageColor — null / missing inputs');
check('null state → null',                 lineageColor(null, 0) === null);
check('state without lineageResult → null',
      lineageColor({}, 0) === null);
check('lineageResult without lineage_id_per_sample → null',
      lineageColor({ lineageResult: {} }, 0) === null);

// =====================================================================
group('lineageColor — value resolution');
{
  const state = {
    lineageResult: {
      n_samples: 4,
      n_lineages: 3,
      lineage_id_per_sample: new Int32Array([0, 1, 2, -1]),
    },
  };
  // Sample 0 → lineage 0 (cool blue base hue)
  const c0 = lineageColor(state, 0);
  check('sample 0 returns an hsl string', typeof c0 === 'string' && c0.startsWith('hsl('));
  check('sample 0 carries the base hue 210',
        c0.includes('hsl(210.0,'));

  // Sample 1 → lineage 1
  const c1 = lineageColor(state, 1);
  check('sample 1 hue differs from sample 0', c1 !== c0);

  // Sample 3 has lineage -1 → null
  check('lineage -1 → null',                 lineageColor(state, 3) === null);

  // Out-of-range sample index → null
  check('si < 0 → null',                     lineageColor(state, -1) === null);
  check('si >= n_samples → null',            lineageColor(state, 99) === null);
}

// =====================================================================
group('lineageColor — guards lineage_id out of range');
{
  const state = {
    lineageResult: {
      n_samples: 1, n_lineages: 2,
      lineage_id_per_sample: new Int32Array([5]),   // 5 >= 2
    },
  };
  check('lineage_id >= n_lineages → null',  lineageColor(state, 0) === null);
}

// =====================================================================
group('resolveSampleScopeColor — dispatch');
{
  const state = {
    data: { samples: [{ family_id: 1 }] },
    familyPalette: { 1: '#deadbe' },
    lineageResult: {
      n_samples: 1, n_lineages: 1,
      lineage_id_per_sample: new Int32Array([0]),
    },
  };
  check('mode = family → familyColor result',
        resolveSampleScopeColor(state, 0, 'family') === '#deadbe');
  check('mode = lineage → lineageColor (hsl)',
        typeof resolveSampleScopeColor(state, 0, 'lineage') === 'string'
        && resolveSampleScopeColor(state, 0, 'lineage').startsWith('hsl('));
  check('mode = kmeans → null (unknown mode)',
        resolveSampleScopeColor(state, 0, 'kmeans') === null);
  check('mode = "" → null',
        resolveSampleScopeColor(state, 0, '') === null);
  check('null state → null',
        resolveSampleScopeColor(null, 0, 'family') !== null
          && resolveSampleScopeColor(null, 0, 'lineage') === null);
}

// =====================================================================
group('page-isolation: page1 wrapper still exposes the legacy names');
{
  const mod = await import('../atlases/inversion/pages/discovery/page1/_state.js');
  check('_resolveSampleScopeColor exported',
        typeof mod._resolveSampleScopeColor === 'function');
  check('_lineageColor exported',
        typeof mod._lineageColor === 'function');
  check('_pageState defaults to null',
        mod._pageState === null);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
