// tests/test_shared_karyotype_rows.js
//
// Unit coverage for shared/karyotype_rows.js — per-sample karyotype
// table builder + 2-track detection + sort.

import {
  isKaryoTwoTrack,
  karyoBandToTrackMap,
  buildKaryotypeRows,
  sortKaryoRows,
} from '../atlases/popstats/shared/karyotype_rows.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('isKaryoTwoTrack');

check('null → false',                isKaryoTwoTrack(null) === false);
check('no tracks → false',           isKaryoTwoTrack({}) === false);
check('1 track → false',
      isKaryoTwoTrack({ tracks: [{ active_bands: [0, 1] }] }) === false);
check('3 tracks → false',
      isKaryoTwoTrack({ tracks: [
        { active_bands: [0] }, { active_bands: [1] }, { active_bands: [2] }
      ] }) === false);
check('2 tracks both populated → true',
      isKaryoTwoTrack({ tracks: [
        { active_bands: [0] }, { active_bands: [1, 2] }
      ] }) === true);
check('2 tracks one empty → false',
      isKaryoTwoTrack({ tracks: [
        { active_bands: [0] }, { active_bands: [] }
      ] }) === false);
check('2 tracks missing active_bands → false',
      isKaryoTwoTrack({ tracks: [
        { active_bands: [0] }, {}
      ] }) === false);

// =====================================================================
group('karyoBandToTrackMap');

const m1 = karyoBandToTrackMap({ tracks: [
  { active_bands: [0, 1] }, { active_bands: [2, 3] }
] });
check('band 0 → track 0',           m1.get(0) === 0);
check('band 1 → track 0',           m1.get(1) === 0);
check('band 2 → track 1',           m1.get(2) === 1);
check('band 3 → track 1',           m1.get(3) === 1);
check('unmapped band → undefined',  m1.get(99) === undefined);
check('map size = 4',               m1.size === 4);

check('null → empty Map',
      karyoBandToTrackMap(null) instanceof Map
      && karyoBandToTrackMap(null).size === 0);
check('no tracks → empty Map',
      karyoBandToTrackMap({}).size === 0);

// Non-integer bands skipped
const m2 = karyoBandToTrackMap({ tracks: [
  { active_bands: [0, 'x', 2] }, { active_bands: [3.5, 4] }
] });
check('non-integer bands skipped',
      m2.has(0) && !m2.has('x') && m2.has(2)
      && !m2.has(3.5) && m2.has(4));

// =====================================================================
group('buildKaryotypeRows — happy path');

const state = {
  data: {
    samples: [
      { ind: 'A1', cga: 'CGA-A1', family_id: 7, ancestry: 'pop1' },
      { ind: 'A2', cga: 'CGA-A2', family_id: 7, ancestry: 'pop1' },
      { ind: 'B1', cga: 'CGA-B1', family_id: 8, ancestry: 'pop2' },
      {},
    ],
  },
};
const cand = {
  start_w: 10, end_w: 20,
  locked_labels: new Int8Array([0, 1, 2, -1]),
};
const spreadFn = (s, lo, hi) => {
  return new Float32Array([0.1, 0.2, 0.3, 0.4]);
};

const rows = buildKaryotypeRows(state, cand, { sampleSpread: spreadFn });
check('4 rows produced',             rows.length === 4);
check('row 0: si = 0',               rows[0].si === 0);
check('row 0: ind propagated',       rows[0].ind === 'A1');
check('row 0: cga propagated',       rows[0].cga === 'CGA-A1');
check('row 0: k_label = 0',          rows[0].k_label === 0);
check('row 0: sigma = 0.1',
      Math.abs(rows[0].sigma - 0.1) < 1e-6);
check('row 0: family_id = 7',        rows[0].family_id === 7);
check('row 0: ancestry = pop1',      rows[0].ancestry === 'pop1');
check('row 0: track_idx = null (single-track)',
      rows[0].track_idx === null);
check('row 3 (no sample meta): ind = Ind3',
      rows[3].ind === 'Ind3');
check('row 3: family_id = -1 (fallback)',
      rows[3].family_id === -1);
check('row 3: ancestry = "" (fallback)',
      rows[3].ancestry === '');

// =====================================================================
group('buildKaryotypeRows — no sampleSpread fn');

const rowsNoSig = buildKaryotypeRows(state, cand, {});
check('sigma = NaN when no spread fn',
      Number.isNaN(rowsNoSig[0].sigma));

// Throwing spread fn → swallowed, sigma = NaN
const rowsThrow = buildKaryotypeRows(state, cand,
  { sampleSpread: () => { throw new Error('boom'); } });
check('throwing spread fn caught: sigma NaN',
      Number.isNaN(rowsThrow[0].sigma));

// =====================================================================
group('buildKaryotypeRows — two-track candidate');

const cand2 = {
  start_w: 0, end_w: 5,
  locked_labels: new Int8Array([0, 1, 2, 3, -1]),
  tracks: [
    { active_bands: [0, 1] },
    { active_bands: [2, 3] },
  ],
};
const state2 = {
  data: { samples: [{}, {}, {}, {}, {}] },
};
const rows2 = buildKaryotypeRows(state2, cand2,
  { sampleSpread: (s, lo, hi) => new Float32Array([0, 0, 0, 0, 0]) });
check('two-track: band 0 → track 0',  rows2[0].track_idx === 0);
check('two-track: band 1 → track 0',  rows2[1].track_idx === 0);
check('two-track: band 2 → track 1',  rows2[2].track_idx === 1);
check('two-track: band 3 → track 1',  rows2[3].track_idx === 1);
check('two-track: unassigned (-1) → null',
      rows2[4].track_idx === null);

// =====================================================================
group('buildKaryotypeRows — empty / missing inputs');

check('no state → []',
      buildKaryotypeRows(null, cand, {}).length === 0);
check('no samples array → []',
      buildKaryotypeRows({ data: {} }, cand, {}).length === 0);
check('no candidate → []',
      buildKaryotypeRows(state, null, {}).length === 0);
check('no locked_labels → []',
      buildKaryotypeRows(state, { start_w: 0, end_w: 1 }, {}).length === 0);

// =====================================================================
group('sortKaryoRows');

const rowsToSort = [
  { si: 2, ind: 'C', sigma: 0.5, k_label: 0, family_id: 9 },
  { si: 0, ind: 'A', sigma: NaN, k_label: 2, family_id: 7 },
  { si: 1, ind: 'B', sigma: 0.1, k_label: 1, family_id: 8 },
];

// Numeric ascending by si
const bySiAsc = sortKaryoRows(rowsToSort, { key: 'si', asc: true });
check('si asc: 0,1,2',
      bySiAsc[0].si === 0 && bySiAsc[1].si === 1 && bySiAsc[2].si === 2);

// Numeric descending by sigma; NaN treated as -Inf → sorts last in desc
const bySigDesc = sortKaryoRows(rowsToSort, { key: 'sigma', asc: false });
check('sigma desc: 0.5 first, NaN last',
      bySigDesc[0].sigma === 0.5
      && Number.isNaN(bySigDesc[bySigDesc.length - 1].sigma));

// String ascending by ind
const byIndAsc = sortKaryoRows(rowsToSort, { key: 'ind', asc: true });
check('ind asc: A,B,C',
      byIndAsc[0].ind === 'A' && byIndAsc[2].ind === 'C');

// Default asc=true when omitted
const byKlbl = sortKaryoRows(rowsToSort, { key: 'k_label' });
check('default asc=true',
      byKlbl[0].k_label === 0);

// Non-array → []
check('non-array → []',
      sortKaryoRows(null, { key: 'si' }).length === 0);

// Sort returns a copy (does not mutate input)
const inputCopy = [
  { si: 1 }, { si: 0 },
];
const out = sortKaryoRows(inputCopy, { key: 'si' });
check('sort returns new array, input unchanged',
      out !== inputCopy && inputCopy[0].si === 1);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
