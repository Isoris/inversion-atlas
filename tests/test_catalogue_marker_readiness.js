// tests/test_catalogue_page18.js
//
// Sub-module + main re-export coverage + pure-helper exercises for the
// marker_readiness marker readiness panel.
//
// Round 5 step 4 (chat 36, 2026-05-07): marker_readiness refactored from chat-33
// "single-file with const state = window.state || {}" pattern to the
// _pageState live-binding pattern + atlas-router mount/unmount lifecycle.
// Body kept as a single file (vs sub-module split) because all 30 helpers
// are cohesive marker-panel-domain code (~966 LOC; threshold for splitting
// is ~3000 LOC across multiple concerns, like page1 and page2).

import * as marker_readiness from '../atlases/inversion/pages/catalogue/marker_readiness.js';
import * as state  from '../atlases/inversion/pages/catalogue/marker_readiness/_state.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('marker_readiness.js: lifecycle entry-points');
check('exports mount',                      typeof marker_readiness.mount === 'function');
check('exports unmount',                    typeof marker_readiness.unmount === 'function');
check('exports renderMarkerPanelPage',      typeof marker_readiness.renderMarkerPanelPage === 'function');

// -----------------------------------------------------------------------------
group('marker_readiness.js: marker-panel domain helpers');
const expectedHelpers = [
  '_mpScoreVariantAf',
  '_mpAnnotateGelVisibility',
  '_mpSuggestControlsFromKaryotype',
  '_mpDefaultCrossSpeciesControls',
  '_mpMinDistanceToCsBreakpoint',
  '_mpAutoTierFromAtlas',
  '_mpDeriveAutoPanel',
  '_mpAnnotateAfVariants',
  '_mpIsValidPanelJson',
  '_mpIsValidVariantAfsJson',
  '_mpMergeUserJson',
  '_mpParseTsv',
  '_mpEnsureState',
  '_mpRefreshPanel',
  '_mpExportCsv',
  '_mpIngestText',
];
for (const name of expectedHelpers) {
  check(`exports ${name}`, typeof marker_readiness[name] === 'function');
}

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
group('Pure helpers: _mpScoreVariantAf (Tier 1 clean variant)');
// API uses lowercase keys: af_std, af_het, af_inv
const t1clean = marker_readiness._mpScoreVariantAf({ af_std: 0.01, af_het: 0.50, af_inv: 0.95 });
check('returns object',                                typeof t1clean === 'object' && t1clean !== null);
check('has private_score',                             'private_score' in t1clean);
check('private_score = af_inv - af_std',               Math.abs(t1clean.private_score - 0.94) < 1e-9);
check('has dosage_score',                              'dosage_score' in t1clean);
check('dosage_score = 1 for clean het (0.50)',         Math.abs(t1clean.dosage_score - 1.0) < 1e-9);
check('has final_score',                               'final_score' in t1clean);
check('final_score = private_score + dosage_score',
      Math.abs(t1clean.final_score - (t1clean.private_score + t1clean.dosage_score)) < 1e-9);
check('Tier-1-clean variant assigned tier_from_af=1',  t1clean.tier_from_af === 1);

// Tier 4 (AF table missing)
const t4 = marker_readiness._mpScoreVariantAf({});
check('missing AFs → tier_from_af=4',                  t4.tier_from_af === 4);
check('missing AFs → null scores',
      t4.private_score === null && t4.dosage_score === null && t4.final_score === null);

// Tier 2 (strong tag, imperfect het)
const t2 = marker_readiness._mpScoreVariantAf({ af_std: 0.04, af_het: 0.30, af_inv: 0.78 });
check('strong tag with imperfect het → tier_from_af=2', t2.tier_from_af === 2);

// -----------------------------------------------------------------------------
group('Pure helpers: _mpAnnotateGelVisibility (returns NEW object)');
// Note: function returns a copy, doesn't mutate
const v1 = marker_readiness._mpAnnotateGelVisibility({ type: 'indel', indel_size_bp: 50 });
check('returns object with gel_visible',               'gel_visible' in v1);
check('20-300 bp indel → gel_visible=true',            v1.gel_visible === true);

const v2 = marker_readiness._mpAnnotateGelVisibility({ type: 'indel', indel_size_bp: 5 });
check('5 bp indel → gel_visible=false',                v2.gel_visible === false);

const v3 = marker_readiness._mpAnnotateGelVisibility({ type: 'snp' });
check('SNP → gel_visible=null',                        v3.gel_visible === null);

// -----------------------------------------------------------------------------
group('Pure helpers: JSON validators');
check('valid panel JSON shape accepted (has markers array)',
      marker_readiness._mpIsValidPanelJson({ markers: [] }));
check('null returns false (panel)',     !marker_readiness._mpIsValidPanelJson(null));
check('non-object returns false (panel)', !marker_readiness._mpIsValidPanelJson('string'));
check('missing markers array returns false',  !marker_readiness._mpIsValidPanelJson({}));

check('valid AFs JSON shape accepted (has variants_by_inversion object)',
      marker_readiness._mpIsValidVariantAfsJson({ variants_by_inversion: {} }));
check('null returns false (afs)',       !marker_readiness._mpIsValidVariantAfsJson(null));
check('missing variants_by_inversion returns false',  !marker_readiness._mpIsValidVariantAfsJson({}));

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
