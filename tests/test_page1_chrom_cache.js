// tests/test_page1_chrom_cache.js
//
// Unit tests for pages/discovery/local_pca_dosage/chrom_cache.js — the
// per-session in-memory chromosome cache + the #chromSelect dropdown
// refresher.

import {
  chromCacheSize,
  getCachedChrom,
  hasCachedChrom,
  setCachedChrom,
  cachedChromNames,
  clearChromCache,
  isChromosomeJSON,
  refreshChromSelect,
} from '../atlases/inversion/pages/discovery/local_pca_dosage/chrom_cache.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

function makeChromData(chrom, n_windows) {
  return {
    chrom, n_windows,
    windows: Array.from({ length: n_windows }, (_, i) => ({ center_mb: i })),
  };
}

// =====================================================================
group('isChromosomeJSON');
check('null → false',         isChromosomeJSON(null) === false);
check('undefined → false',    isChromosomeJSON(undefined) === false);
check('empty object → false', isChromosomeJSON({}) === false);
check('missing n_windows → false',
      isChromosomeJSON({ windows: [{}, {}] }) === false);
check('n_windows = 0 → false',
      isChromosomeJSON({ n_windows: 0, windows: [] }) === false);
check('non-numeric n_windows → false',
      isChromosomeJSON({ n_windows: 'lots', windows: [{}] }) === false);
check('missing windows array → false',
      isChromosomeJSON({ n_windows: 5 }) === false);
check('empty windows array → false',
      isChromosomeJSON({ n_windows: 5, windows: [] }) === false);
check('valid chrom JSON → true',
      isChromosomeJSON(makeChromData('LG28', 1500)) === true);
check('enrichment-shape → false',
      isChromosomeJSON({ schema_version: 2, _layers_present: ['sv_evidence'] }) === false);

// =====================================================================
group('cache CRUD');
{
  // Start clean — earlier tests may have run; clear first
  clearChromCache();
  check('starts empty', chromCacheSize() === 0);
  check('hasCachedChrom: missing key → false',
        hasCachedChrom('LG28') === false);
  check('getCachedChrom: missing key → undefined',
        getCachedChrom('LG28') === undefined);

  const lg28 = makeChromData('LG28', 1500);
  setCachedChrom('LG28', lg28);
  check('size = 1',                  chromCacheSize() === 1);
  check('hasCachedChrom finds it',   hasCachedChrom('LG28') === true);
  check('getCachedChrom returns the put record',
        getCachedChrom('LG28') === lg28);

  setCachedChrom('LG07', makeChromData('LG07', 800));
  check('size = 2',                  chromCacheSize() === 2);
  const names = cachedChromNames();
  check('cachedChromNames length = 2', names.length === 2);
  check('cachedChromNames includes LG28', names.includes('LG28'));
  check('cachedChromNames includes LG07', names.includes('LG07'));

  // Overwrite
  const lg28new = makeChromData('LG28', 1600);
  setCachedChrom('LG28', lg28new);
  check('size stays at 2',           chromCacheSize() === 2);
  check('overwrite preserved',       getCachedChrom('LG28') === lg28new);

  // Null/empty chrom name is ignored
  setCachedChrom('', makeChromData('', 10));
  setCachedChrom(null, makeChromData('null', 10));
  check('empty-name set is no-op',    chromCacheSize() === 2);

  clearChromCache();
  check('clear: size = 0',           chromCacheSize() === 0);
  check('clear: cachedChromNames empty', cachedChromNames().length === 0);
}

// =====================================================================
// Minimal document shim for refreshChromSelect
// =====================================================================
function installDocument() {
  const created = [];
  const selectElement = {
    innerHTML: '',
    disabled: false,
    children: [],
    appendChild(node) { this.children.push(node); },
    style: {},
  };
  globalThis.document = {
    getElementById(id) {
      if (id === 'chromSelect') return selectElement;
      return null;
    },
    createElement(tag) {
      const el = {
        tag, value: '', textContent: '', selected: false, style: {},
      };
      created.push(el);
      return el;
    },
    _selectElement: selectElement,
    _created: created,
  };
  return selectElement;
}
function uninstallDocument() { delete globalThis.document; }

// =====================================================================
group('refreshChromSelect — headless tolerance');
{
  uninstallDocument();
  let threw = false;
  try { refreshChromSelect({}); } catch (_) { threw = true; }
  check('no throw without document', !threw);
}

// =====================================================================
group('refreshChromSelect — empty cache');
{
  clearChromCache();
  const sel = installDocument();
  refreshChromSelect({});
  check('empty cache: disabled = true',  sel.disabled === true);
  check('empty cache: shows "— none loaded —"',
        sel.innerHTML.includes('— none loaded —'));
  uninstallDocument();
}

// =====================================================================
group('refreshChromSelect — populated cache');
{
  clearChromCache();
  setCachedChrom('LG28', makeChromData('LG28', 1500));
  setCachedChrom('LG07', makeChromData('LG07', 800));
  setCachedChrom('LG12', makeChromData('LG12', 1200));
  // Also stash a non-chromosome JSON to verify filtering
  setCachedChrom('aux', { schema_version: 2, _layers_present: [] });

  const sel = installDocument();
  refreshChromSelect({ data: { chrom: 'LG12' } });
  check('disabled = false',         sel.disabled === false);
  check('3 options (aux filtered)', sel.children.length === 3);
  // Options sorted alphabetically
  const values = sel.children.map(o => o.value);
  check('options sorted',
        values[0] === 'LG07' && values[1] === 'LG12' && values[2] === 'LG28');
  // textContent includes n_windows count
  check('LG28 label includes n_windows',
        sel.children.find(o => o.value === 'LG28').textContent.includes('1500'));
  // Selected matches state.data.chrom
  check('LG12 is pre-selected',
        sel.children.find(o => o.value === 'LG12').selected === true);
  check('LG07 is NOT pre-selected',
        sel.children.find(o => o.value === 'LG07').selected === false);
  uninstallDocument();
}

// =====================================================================
group('refreshChromSelect — no state, no pre-selection');
{
  clearChromCache();
  setCachedChrom('LG28', makeChromData('LG28', 1500));
  setCachedChrom('LG07', makeChromData('LG07', 800));
  const sel = installDocument();
  refreshChromSelect();   // no state arg
  check('still populates 2 options',  sel.children.length === 2);
  check('none pre-selected',
        sel.children.every(o => o.selected === false));
  uninstallDocument();
}

// =====================================================================
group('refreshChromSelect — missing #chromSelect element');
{
  clearChromCache();
  setCachedChrom('LG28', makeChromData('LG28', 1500));
  // shim with no #chromSelect
  globalThis.document = {
    getElementById() { return null; },
    createElement() { return {}; },
  };
  let threw = false;
  try { refreshChromSelect({}); } catch (_) { threw = true; }
  check('missing element: no throw',  !threw);
  uninstallDocument();
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
