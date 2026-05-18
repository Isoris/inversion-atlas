// tests/test_catalogue_page3.js
//
// Sub-module + main re-export coverage for the catalogue split.
// Mirrors test_discovery_page1.js / test_discovery_page2.js.
//
// Round 5 step 3 (chat 36, 2026-05-07): catalogue split into:
//   ./catalogue/_state.js
//   ./catalogue/_breeding_export.js (1106 LOC, 17 helpers + 1 const)
// plus the catalogue.js main with mount/unmount/renderCataloguePage/initCataloguePage.

import * as catalogue       from '../atlases/inversion/pages/catalogue/catalogue.js';
import * as state       from '../atlases/inversion/pages/catalogue/catalogue/_state.js';
import * as breeding    from '../atlases/inversion/pages/catalogue/catalogue/_breeding_export.js';

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('catalogue.js main: lifecycle + entry-point exports');
check('catalogue exports mount',                    typeof catalogue.mount === 'function');
check('catalogue exports unmount',                  typeof catalogue.unmount === 'function');
check('catalogue exports renderCataloguePage',      typeof catalogue.renderCataloguePage === 'function');
check('catalogue exports initCataloguePage',        typeof catalogue.initCataloguePage === 'function');

// -----------------------------------------------------------------------------
group('catalogue.js main: re-exports breeding-export public set');
check('catalogue re-exports _exportBreedingCardsHTML',           typeof catalogue._exportBreedingCardsHTML === 'function');
check('catalogue re-exports _exportBreedingCardsJSON',           typeof catalogue._exportBreedingCardsJSON === 'function');
check('catalogue re-exports _wireCatalogueBreedingExportBtns',   typeof catalogue._wireCatalogueBreedingExportBtns === 'function');
// re-export identity (same function reference as the sub-module)
check('_exportBreedingCardsHTML identity preserved',
      catalogue._exportBreedingCardsHTML === breeding._exportBreedingCardsHTML);
check('_exportBreedingCardsJSON identity preserved',
      catalogue._exportBreedingCardsJSON === breeding._exportBreedingCardsJSON);
check('_wireCatalogueBreedingExportBtns identity preserved',
      catalogue._wireCatalogueBreedingExportBtns === breeding._wireCatalogueBreedingExportBtns);

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

// Internal helpers + constant table are NOT exported (catalogue-private).
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
