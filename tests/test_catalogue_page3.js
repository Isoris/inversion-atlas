// tests/test_catalogue_page3.js
//
// Sub-module + main re-export coverage for the page3 split.
// Mirrors test_discovery_page1.js / test_discovery_page2.js.
//
// Round 5 step 3 (chat 36, 2026-05-07): page3 split into:
//   ./page3/_state.js
//   ./page3/_breeding_export.js (1106 LOC, 17 helpers + 1 const)
// plus the page3.js main with mount/unmount/renderCataloguePage/initCataloguePage.

import * as page3       from '../atlases/inversion/pages/catalogue/page3.js';
import * as state       from '../atlases/inversion/pages/catalogue/page3/_state.js';
import * as breeding    from '../atlases/inversion/pages/catalogue/page3/_breeding_export.js';

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('page3.js main: lifecycle + entry-point exports');
check('page3 exports mount',                    typeof page3.mount === 'function');
check('page3 exports unmount',                  typeof page3.unmount === 'function');
check('page3 exports renderCataloguePage',      typeof page3.renderCataloguePage === 'function');
check('page3 exports initCataloguePage',        typeof page3.initCataloguePage === 'function');

// -----------------------------------------------------------------------------
group('page3.js main: re-exports breeding-export public set');
check('page3 re-exports _exportBreedingCardsHTML',           typeof page3._exportBreedingCardsHTML === 'function');
check('page3 re-exports _exportBreedingCardsJSON',           typeof page3._exportBreedingCardsJSON === 'function');
check('page3 re-exports _wireCatalogueBreedingExportBtns',   typeof page3._wireCatalogueBreedingExportBtns === 'function');
// re-export identity (same function reference as the sub-module)
check('_exportBreedingCardsHTML identity preserved',
      page3._exportBreedingCardsHTML === breeding._exportBreedingCardsHTML);
check('_exportBreedingCardsJSON identity preserved',
      page3._exportBreedingCardsJSON === breeding._exportBreedingCardsJSON);
check('_wireCatalogueBreedingExportBtns identity preserved',
      page3._wireCatalogueBreedingExportBtns === breeding._wireCatalogueBreedingExportBtns);

// -----------------------------------------------------------------------------
group('_state.js: live-binding pattern');
check('exports _pageState',          '_pageState' in state);
check('exports _setActiveState',     typeof state._setActiveState === 'function');
check('_pageState starts null',      state._pageState === null);
state._setActiveState({ marker: 'A' });
check('_setActiveState mutates _pageState',  state._pageState && state._pageState.marker === 'A');
state._setActiveState(null);
check('_setActiveState(null) clears',         state._pageState === null);

// -----------------------------------------------------------------------------
group('_breeding_export.js: public exports');
check('exports _exportBreedingCardsHTML',           typeof breeding._exportBreedingCardsHTML === 'function');
check('exports _exportBreedingCardsJSON',           typeof breeding._exportBreedingCardsJSON === 'function');
check('exports _wireCatalogueBreedingExportBtns',   typeof breeding._wireCatalogueBreedingExportBtns === 'function');

// Internal helpers + constant table are NOT exported (page3-private).
// We can only verify they're consumed by the public set without exception.
check('public set is exactly 3 names',
      Object.keys(breeding).length === 3 &&
      ['_exportBreedingCardsHTML', '_exportBreedingCardsJSON',
       '_wireCatalogueBreedingExportBtns'].every(k => k in breeding));

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
