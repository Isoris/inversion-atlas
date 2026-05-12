// tests/test_shared_color_helpers.js
//
// Verifies the colour-palette exports from shared/color_helpers.js.
// The continuous ramps (simColor, simColorPDF, zColorPDF) return rgb
// triples; the categorical karyo helper returns hex strings.

import {
  simColor, simColorPDF, zColorPDF,
  KARYO_PALETTE, karyoColor,
} from '../atlases/inversion/shared/color_helpers.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('simColor (single-channel ramp)');
check('simColor(0) returns [r,g,b]', Array.isArray(simColor(0)) && simColor(0).length === 3);
check('simColor(1) returns [r,g,b]', Array.isArray(simColor(1)) && simColor(1).length === 3);
check('simColor monotonic R', simColor(0)[0] !== simColor(1)[0]);

// =====================================================================
group('simColorPDF (5-stop piecewise)');
{
  const c = simColorPDF(0.5, 0, 1);
  check('simColorPDF returns rgb triple', Array.isArray(c) && c.length === 3);
}

// =====================================================================
group('zColorPDF (diverging)');
{
  const cMid = zColorPDF(0, 5);
  const cLow = zColorPDF(-5, 5);
  const cHi  = zColorPDF(5, 5);
  check('zColorPDF(0) returns rgb', Array.isArray(cMid) && cMid.length === 3);
  check('zColorPDF(-z, z) differs from zColorPDF(+z, z)',
        cLow[0] !== cHi[0] || cLow[1] !== cHi[1] || cLow[2] !== cHi[2]);
}
check('zColorPDF(NaN) returns mid-grey',
      JSON.stringify(zColorPDF(NaN, 1)) === '[200,200,200]');
check('zColorPDF(Infinity) returns mid-grey',
      JSON.stringify(zColorPDF(Infinity, 1)) === '[200,200,200]');

// =====================================================================
group('KARYO_PALETTE (6-entry frozen array)');
check('KARYO_PALETTE has 6 entries',   KARYO_PALETTE.length === 6);
check('KARYO_PALETTE is frozen',       Object.isFrozen(KARYO_PALETTE));
check('all entries are hex strings',
      KARYO_PALETTE.every(c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)));
check('first entry matches legacy #4fa3ff', KARYO_PALETTE[0] === '#4fa3ff');

// =====================================================================
group('karyoColor (band-index → hex)');
check('karyoColor(0) = palette[0]', karyoColor(0) === KARYO_PALETTE[0]);
check('karyoColor(5) = palette[5]', karyoColor(5) === KARYO_PALETTE[5]);
check('karyoColor(6) wraps to palette[0]', karyoColor(6) === KARYO_PALETTE[0]);
check('karyoColor(12) wraps to palette[0]', karyoColor(12) === KARYO_PALETTE[0]);
check('karyoColor(null) = neutral grey',    karyoColor(null) === '#666');
check('karyoColor(undefined) = neutral grey', karyoColor(undefined) === '#666');
check('karyoColor(-1) = neutral grey',      karyoColor(-1) === '#666');
check('karyoColor(-99) = neutral grey',     karyoColor(-99) === '#666');

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
