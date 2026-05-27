// tests/test_review_karyotype_rows.js
//
// Locks down the discovery → review karyotype workflow fix:
// `cand.locked_labels` is stored as Int8Array in memory (Int8Array
// from candidates.js promote-flow), but the karyotype renderer used
// to guard with `Array.isArray()`, which is ALWAYS false for
// TypedArray instances. That caused the karyotype subview to render
// blank even when locked_labels was correctly populated — the symptom
// behind "the karyotype page has no calls".
//
// These tests verify:
//   - buildKaryotypeRows accepts both plain Array and Int8Array
//   - _isLabelsArray returns true for typed arrays
//   - row counts + k_label values are correct in both cases
//   - the JSON-roundtrip path (Array re-hydrated to Int8Array) is
//     still safe

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

const {
  buildKaryotypeRows,
  _isLabelsArray,
  sortKaryoRows,
  filterKaryoRows,
} = await import('../atlases/inversion/pages/review/karyotype_tier/karyo_rows.js');

// =====================================================================
group('_isLabelsArray');

check('Array.isArray case',         _isLabelsArray([0, 1, 2]) === true);
check('Int8Array case',             _isLabelsArray(new Int8Array([0, 1, 2])) === true);
check('Uint8Array case',            _isLabelsArray(new Uint8Array([0, 1, 2])) === true);
check('Int16Array case',            _isLabelsArray(new Int16Array([0, 1, 2])) === true);
check('Float32Array case',          _isLabelsArray(new Float32Array([0, 1, 2])) === true);
check('null is not labels',         _isLabelsArray(null) === false);
check('undefined is not labels',    _isLabelsArray(undefined) === false);
check('plain object is not labels', _isLabelsArray({ length: 3 }) === false);
check('string is not labels',       _isLabelsArray('abc') === false);
check('number is not labels',       _isLabelsArray(42) === false);

// =====================================================================
group('buildKaryotypeRows — Int8Array locked_labels (the bug fix)');

// Mimic the candidate object as produced by local_pca_dosage's
// promote-flow (candidates.js:1012).
const cand_int8 = {
  id:            'cand_demo',
  K:             3,
  locked_labels: new Int8Array([0, 1, 2, 0, 1, 2]),
};
const samples = [
  { ind: 'A', cga: 'A_cga', family_id: 1, ancestry: 'north' },
  { ind: 'B', cga: 'B_cga', family_id: 1, ancestry: 'north' },
  { ind: 'C', cga: 'C_cga', family_id: 2, ancestry: 'south' },
  { ind: 'D', cga: 'D_cga', family_id: 2, ancestry: 'south' },
  { ind: 'E', cga: 'E_cga', family_id: 3, ancestry: 'south' },
  { ind: 'F', cga: 'F_cga', family_id: 3, ancestry: 'north' },
];

const rowsInt8 = buildKaryotypeRows(cand_int8, samples, null);
check('Int8Array → returns 6 rows (was 0 before fix)',  rowsInt8.length === 6);
check('row 0 k_label matches Int8Array[0]',             rowsInt8[0].k_label === 0);
check('row 2 k_label matches Int8Array[2]',             rowsInt8[2].k_label === 2);
check('row 5 k_label matches Int8Array[5]',             rowsInt8[5].k_label === 2);
check('row 0 ind from samples[]',                       rowsInt8[0].ind === 'A');
check('row 3 cga from samples[]',                       rowsInt8[3].cga === 'D_cga');
check('family_id preserved',                            rowsInt8[2].family_id === 2);

// =====================================================================
group('buildKaryotypeRows — Array locked_labels (JSON-roundtrip case)');

// Mimic the localStorage-restored shape (candidates.js:946-947 re-hydrates
// Array → Int8Array, but downstream callers shouldn't depend on which one).
const cand_arr = Object.assign({}, cand_int8, {
  locked_labels: [0, 1, 2, 0, 1, 2],
});
const rowsArr = buildKaryotypeRows(cand_arr, samples, null);
check('Array → returns 6 rows',          rowsArr.length === 6);
check('Array row k_labels match Int8',
      rowsArr.every((r, i) => r.k_label === rowsInt8[i].k_label));

// =====================================================================
group('buildKaryotypeRows — null / empty safety');

check('null cand → []',                  buildKaryotypeRows(null, samples).length === 0);
check('cand without locked_labels → []', buildKaryotypeRows({ K: 3 }, samples).length === 0);
check('cand locked_labels = "foo" → []', buildKaryotypeRows({ locked_labels: 'foo', K: 3 }, samples).length === 0);
check('cand locked_labels = {} → []',    buildKaryotypeRows({ locked_labels: { length: 2 }, K: 3 }, samples).length === 0);

// =====================================================================
group('sortKaryoRows + filterKaryoRows preserve Int8Array-built rows');

const sorted = sortKaryoRows(rowsInt8, { sortKey: 'k_label', sortAsc: true });
check('sort by k_label asc preserves length', sorted.length === 6);
check('sorted first row has lowest k_label',  sorted[0].k_label === 0);
check('sorted last row has highest k_label',  sorted[5].k_label === 2);

const filteredAncestry = filterKaryoRows(rowsInt8, { filter: 'north' });
check('filter by ancestry "north"',  filteredAncestry.length === 3);
const filteredBand = filterKaryoRows(rowsInt8, { bandFilter: 'k1' });
check('filter by band k1',           filteredBand.length === 2);
check('band-k1 rows all have k_label = 1',
      filteredBand.every(r => r.k_label === 1));

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
