// tests/test_v34_drop_smoke.js
//
// Smoke test for the v3.4 drop modules: verify exports resolve and
// the headline functions handle null / empty inputs without
// throwing. Full unit coverage stays in the producer repo; this just
// confirms the modules load and the public API is intact after
// cartridge layout adjustment.

import {
  BAND_QUALITY_DEFAULTS,
  bandQualityForWindow,
  bandQualityGenomeWide,
} from '../atlases/inversion/shared/band_tracking/band_quality.js';
import {
  KARYOTYPE_STATE,
  CONCORDANCE,
  CONFIDENCE,
  dosageClassToKaryotype,
  callKaryotypePerAxisPerSample,
  resolveAxisMembership,
} from '../atlases/inversion/shared/band_tracking/karyotype_caller.js';
import {
  IGKC_DEFAULTS,
  KING_THRESHOLDS,
  trioAllowedKidStates,
  trioIsUninformative,
  igkcAllDyads,
} from '../atlases/inversion/shared/inheritance/igkc_gates.js';
import {
  DIRECTION,
  DIRECTION_DEFAULTS,
  resolveAllDyadDirections,
  buildIKCMatrix,
} from '../atlases/inversion/shared/inheritance/direction_resolver.js';
import {
  runStageB,
  runStageCForLocus,
  runStageD,
  partitionToMacroBands,
  flattenCallsForInheritance,
} from '../atlases/inversion/shared/inversion_pipeline.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('band_quality');

check('BAND_QUALITY_DEFAULTS defined',
      BAND_QUALITY_DEFAULTS && typeof BAND_QUALITY_DEFAULTS === 'object');
check('bandQualityForWindow is fn',     typeof bandQualityForWindow === 'function');
check('bandQualityGenomeWide is fn',    typeof bandQualityGenomeWide === 'function');

// null/empty handling
const bqNull = bandQualityGenomeWide([], 0, 0);
check('genome-wide on empty: no throw', bqNull != null);

// =====================================================================
group('karyotype_caller');

check('KARYOTYPE_STATE vocab',
      KARYOTYPE_STATE.HOM_REF === 'HOM_REF'
      && KARYOTYPE_STATE.HET === 'HET'
      && KARYOTYPE_STATE.HOM_INV === 'HOM_INV'
      && KARYOTYPE_STATE.FLAGGED === 'FLAGGED'
      && KARYOTYPE_STATE.NA === 'NA');
check('CONCORDANCE vocab defined',      CONCORDANCE && typeof CONCORDANCE === 'object');
check('CONFIDENCE vocab defined',       CONFIDENCE && typeof CONFIDENCE === 'object');
check('dosageClassToKaryotype is fn',   typeof dosageClassToKaryotype === 'function');
check('callKaryotypePerAxisPerSample fn', typeof callKaryotypePerAxisPerSample === 'function');
check('resolveAxisMembership is fn',    typeof resolveAxisMembership === 'function');

// =====================================================================
group('igkc_gates');

check('KING_THRESHOLDS PO = 0.177',     KING_THRESHOLDS.PO === 0.177);
check('IGKC_DEFAULTS defined',          IGKC_DEFAULTS && typeof IGKC_DEFAULTS === 'object');
check('trioAllowedKidStates is fn',     typeof trioAllowedKidStates === 'function');
check('trioIsUninformative is fn',      typeof trioIsUninformative === 'function');
check('igkcAllDyads is fn',             typeof igkcAllDyads === 'function');

// Basic Mendelian table sanity
const ts = trioAllowedKidStates('HOM_REF', 'HOM_REF');
check('HOM_REF × HOM_REF allows HOM_REF only',
      ts && ts.has(KARYOTYPE_STATE.HOM_REF)
      && !ts.has(KARYOTYPE_STATE.HOM_INV));

const tu = trioAllowedKidStates('HET', 'HET');
check('HET × HET allows all 3',
      tu && tu.size === 3);
check('HET × HET is uninformative',     trioIsUninformative('HET', 'HET') === true);
check('HOM_REF × HOM_INV is informative',
      trioIsUninformative('HOM_REF', 'HOM_INV') === false);

// =====================================================================
group('direction_resolver');

check('DIRECTION vocab present',
      DIRECTION.A_TO_B && DIRECTION.B_TO_A
      && DIRECTION.UNDIRECTED && DIRECTION.INCOMPATIBLE);
check('DIRECTION_DEFAULTS defined',     DIRECTION_DEFAULTS && DIRECTION_DEFAULTS.min_informative_axes === 5);
check('resolveAllDyadDirections is fn', typeof resolveAllDyadDirections === 'function');
check('buildIKCMatrix is fn',           typeof buildIKCMatrix === 'function');

// =====================================================================
group('inversion_pipeline');

check('runStageB is fn',                typeof runStageB === 'function');
check('runStageCForLocus is fn',        typeof runStageCForLocus === 'function');
check('runStageD is fn',                typeof runStageD === 'function');
check('partitionToMacroBands is fn',    typeof partitionToMacroBands === 'function');
check('flattenCallsForInheritance is fn', typeof flattenCallsForInheritance === 'function');

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
