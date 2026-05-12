// tests/test_shared_cheat30_render.js
//
// Unit coverage for shared/cheat30_render.js — cheat30 age/origin
// display vocabularies + inline-SVG ridgeline plot.

import * as CR from '../atlases/inversion/shared/cheat30_render.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('AGEORIG_CLASS + AGEORIG_RIDGE_COLOR');
check('AGEORIG_CLASS frozen',          Object.isFrozen(CR.AGEORIG_CLASS));
check('class entries frozen',
      ['single_origin', 'recurrent', 'weak_signal', 'inconclusive']
        .every(k => Object.isFrozen(CR.AGEORIG_CLASS[k])));
check('single_origin has label',       CR.AGEORIG_CLASS.single_origin.label === 'SINGLE ORIGIN');
check('recurrent: red',                CR.AGEORIG_CLASS.recurrent.color === '#e07a7a');
check('weak_signal: amber',            CR.AGEORIG_CLASS.weak_signal.color === '#e0bc7a');
check('inconclusive: grey',            CR.AGEORIG_CLASS.inconclusive.color === '#888');

check('AGEORIG_RIDGE_COLOR frozen',    Object.isFrozen(CR.AGEORIG_RIDGE_COLOR));
check('HOM_REF_HOM_REF: green',        CR.AGEORIG_RIDGE_COLOR.HOM_REF_HOM_REF === '#7ad394');

check('AGEORIG_PRIMARY_PAIR_TYPES frozen', Object.isFrozen(CR.AGEORIG_PRIMARY_PAIR_TYPES));
check('primary types: 3 entries',      CR.AGEORIG_PRIMARY_PAIR_TYPES.length === 3);

// -----------------------------------------------------------------------------
group('resolveAgeOriginClass');
check('single_origin → SINGLE ORIGIN entry',
      CR.resolveAgeOriginClass('single_origin').label === 'SINGLE ORIGIN');
check('unknown → inconclusive fallback',
      CR.resolveAgeOriginClass('mystery').label === 'INCONCLUSIVE');
check('null → inconclusive fallback',
      CR.resolveAgeOriginClass(null).label === 'INCONCLUSIVE');

// -----------------------------------------------------------------------------
group('fmtP');
check('null → "na"',                   CR.fmtP(null) === 'na');
check('NaN → "na"',                    CR.fmtP(NaN) === 'na');
check('1e-20 → sentinel',              CR.fmtP(1e-20) === '<2.2×10⁻¹⁶');
check('0.0001 → scientific',           CR.fmtP(0.0001).includes('×10'));
check('0.005 → 4dp',                   CR.fmtP(0.005) === '0.0050');
check('0.5 → 3dp',                     CR.fmtP(0.5) === '0.500');
check('1 → 3dp',                       CR.fmtP(1) === '1.000');

// -----------------------------------------------------------------------------
group('fmt4 + fmt3');
check('fmt4(0.12345) = "0.1235"',      CR.fmt4(0.12345) === '0.1235');
check('fmt4(null) = "na"',             CR.fmt4(null) === 'na');
check('fmt4(NaN) = "na"',              CR.fmt4(NaN) === 'na');
check('fmt3(0.12345) = "0.123"',       CR.fmt3(0.12345) === '0.123');
check('fmt3(0) = "0.000"',             CR.fmt3(0) === '0.000');

// -----------------------------------------------------------------------------
group('drawCheat30Ridgeline: empty cases');
const noData = CR.drawCheat30Ridgeline({}, null);
check('empty pair_density: shows hint',
      noData.includes('no pair_density'));
check('null pair_density: shows hint',
      CR.drawCheat30Ridgeline(null, null).includes('no pair_density'));

// All-NaN x → degenerate
const degen = {
  HOM_REF_HOM_REF: { x: [0.5, 0.5, 0.5], y: [1, 2, 1] },
};
const degenSvg = CR.drawCheat30Ridgeline(degen, null);
check('degenerate x range: shows hint',
      degenSvg.includes('degenerate x range'));

// -----------------------------------------------------------------------------
group('drawCheat30Ridgeline: populated');
const dens = {
  HOM_REF_HOM_REF: {
    x: [0.10, 0.15, 0.20, 0.25, 0.30],
    y: [0.5, 2.0, 5.0, 2.0, 0.5],
  },
  HOM_INV_HOM_INV: {
    x: [0.40, 0.45, 0.50, 0.55, 0.60],
    y: [0.2, 1.0, 3.5, 1.0, 0.2],
  },
  HOM_REF_HOM_INV: {
    x: [0.25, 0.30, 0.35, 0.40, 0.45],
    y: [0.5, 1.0, 2.5, 1.0, 0.5],
  },
};
const summaries = {
  HOM_REF_HOM_REF: { mean: 0.20 },
  HOM_INV_HOM_INV: { mean: 0.50 },
};
const svg = CR.drawCheat30Ridgeline(dens, summaries, { width: 400, height: 200 });
check('returns SVG string',            svg.startsWith('<svg'));
check('SVG closed',                    svg.endsWith('</svg>'));
check('viewBox includes width',        svg.includes('viewBox="0 0 400 200"'));
check('REF/REF ridge rendered',        svg.includes('REF / REF'));
check('INV/INV ridge rendered',        svg.includes('INV / INV'));
check('REF/INV ridge rendered',        svg.includes('REF / INV'));
check('uses REF/REF green',            svg.includes('#7ad394'));
check('uses INV/INV red',              svg.includes('#e07a7a'));
check('REF/REF mean dashed line drawn (HOM_REF_HOM_REF in summaries)',
      svg.includes('stroke-dasharray'));
check('SVG axis label "GDS"',          svg.includes('GDS'));

// Subset of types
const svgSubset = CR.drawCheat30Ridgeline(dens, null, {
  types: ['HOM_REF_HOM_REF'],
});
check('subset types: only REF/REF',
      svgSubset.includes('REF / REF') && !svgSubset.includes('INV / INV'));

// HTML escape in pair-type label (unlikely but defensive)
const evilDens = {
  '<bad>': {
    x: [0.1, 0.2, 0.3], y: [1, 2, 1],
  },
};
const svgEvil = CR.drawCheat30Ridgeline(evilDens, null, { types: ['<bad>'] });
check('escapes < in pair label',  svgEvil.includes('&lt;bad&gt;'));

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
