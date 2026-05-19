// tests/test_shared_per_sample_line_color.js
//
// Unit tests for shared/per_sample_line_color.js — the per-sample
// line-color resolvers added for WIRE_AUDIT Group D.

import {
  isPerSampleLineColorMode,
  perSampleValuesForMode,
  perSampleColorFor,
} from '../atlases/inversion/shared/per_sample_line_color.js';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else      { fail++; console.log('  ✗', name, detail ? '— ' + detail : ''); }
}
function group(label) { console.log('\n--- ' + label + ' ---'); }

// =====================================================================
group('isPerSampleLineColorMode');
{
  for (const m of ['family', 'lineage', 'het', 'theta_pi', 'ghsl', 'dosage', 'froh', 'confounder_alert']) {
    check(`${m} → true`, isPerSampleLineColorMode(m) === true);
  }
  check('kmeans → false',        isPerSampleLineColorMode('kmeans')   === false);
  check('null → false',          isPerSampleLineColorMode(null)       === false);
  check('unknown → false',       isPerSampleLineColorMode('bogus')    === false);
}

// =====================================================================
group('perSampleValuesForMode — froh / confounder_alert');
{
  const state = {
    data: {
      n_samples: 4,
      n_windows: 10,
      windows: [],
      sample_froh: new Float64Array([0.02, 0.10, 0.45, 0.00]),
    },
  };
  const v = perSampleValuesForMode(state, 'froh', null);
  check('froh: returns Float64Array of length 4',
        v instanceof Float64Array && v.length === 4);
  check('froh: values copied from sample_froh',
        v[0] === 0.02 && v[2] === 0.45);
  const v2 = perSampleValuesForMode(state, 'confounder_alert', null);
  check('confounder_alert: returns the same data',
        v2[0] === 0.02 && v2[1] === 0.10 && v2[3] === 0.00);
  // Layer absent
  const stateNoFroh = { data: { n_samples: 4, n_windows: 10, windows: [] } };
  check('layer absent → null', perSampleValuesForMode(stateNoFroh, 'froh', null) === null);
}

// =====================================================================
group('perSampleValuesForMode — theta_pi / ghsl panel');
{
  const state = {
    data: {
      n_samples: 3,
      n_windows: 5,
      windows: Array.from({ length: 5 }, (_, i) => ({ start_bp: i * 1000, end_bp: (i + 1) * 1000 })),
      theta_pi_panel: {
        primary_scale: 'win1',
        start_bp: [0, 1000, 2000, 3000, 4000],
        end_bp:   [1000, 2000, 3000, 4000, 5000],
        div_roll: {
          win1: [
            [0.1, 0.2, 0.3, 0.4, 0.5],   // sample 0
            [0.5, 0.5, 0.5, 0.5, 0.5],   // sample 1
            [1.0, 1.0, NaN, 1.0, 1.0],   // sample 2 (with NaN)
          ],
        },
      },
    },
  };
  const v = perSampleValuesForMode(state, 'theta_pi', { startW: 0, endW: 4 });
  check('theta_pi: Float64Array of length 3', v instanceof Float64Array && v.length === 3);
  check('theta_pi: sample 0 mean = 0.3', Math.abs(v[0] - 0.3) < 1e-6);
  check('theta_pi: sample 1 mean = 0.5', Math.abs(v[1] - 0.5) < 1e-6);
  check('theta_pi: sample 2 ignores NaN col → mean = 1.0', Math.abs(v[2] - 1.0) < 1e-6);
  // ghsl missing → null
  check('ghsl: layer absent → null',
        perSampleValuesForMode(state, 'ghsl', { startW: 0, endW: 4 }) === null);
}

// =====================================================================
group('perSampleColorFor');
{
  // het: hetRateColor handles its own scale
  const c1 = perSampleColorFor('het', 0.3, null);
  check('het: returns string color', typeof c1 === 'string' && c1.length > 0);
  check('het: NaN → null', perSampleColorFor('het', NaN, null) === null);

  // froh: sequential grey→red
  const c2a = perSampleColorFor('froh', 0.0, null);
  const c2b = perSampleColorFor('froh', 1.0, null);
  check('froh: 0 returns rgb(...)', /^rgb\(/.test(c2a));
  check('froh: 0 and 1 produce different colors', c2a !== c2b);

  // confounder_alert: threshold 0.05
  const c3a = perSampleColorFor('confounder_alert', 0.02, null);
  const c3b = perSampleColorFor('confounder_alert', 0.10, null);
  check('confounder_alert: below threshold → grey-ish', c3a.includes('140'));
  check('confounder_alert: above threshold → red', c3b.includes('217'));

  // theta_pi: sequential ramp normalized to array range
  const arr = new Float64Array([0.1, 0.5, 1.0]);
  const c4a = perSampleColorFor('theta_pi', 0.1, arr);
  const c4b = perSampleColorFor('theta_pi', 1.0, arr);
  check('theta_pi: min and max produce different colors', c4a !== c4b);
  check('theta_pi: NaN → null',  perSampleColorFor('theta_pi', NaN, arr) === null);
  // Degenerate range (vmin === vmax) → null
  const flatArr = new Float64Array([0.5, 0.5, 0.5]);
  check('theta_pi: degenerate range → null',
        perSampleColorFor('theta_pi', 0.5, flatArr) === null);

  // Unknown mode → null
  check('unknown mode → null', perSampleColorFor('bogus', 0.5, arr) === null);
}

console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
