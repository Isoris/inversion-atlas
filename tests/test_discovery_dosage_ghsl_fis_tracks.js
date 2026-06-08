// tests/test_discovery_dosage_ghsl_fis_tracks.js
//
// Track 1: buildGhslChromCurves — per-sample / per-karyogroup / summary
//          GHSL trajectories along the chromosome.
// Track 2: hwe_fis_adapter — OUT request + tolerant IN parsing of the
//          imported (GL-based) HWE_F_IS popstats curve.

import { buildGhslChromCurves } from '../atlases/inversion/pages/discovery/dosage_heatmap/ghsl_track.js';
import {
  buildHweFisRequest, parseHweFisResponse, HWE_FIS_METRIC,
} from '../atlases/inversion/pages/discovery/dosage_heatmap/hwe_fis_adapter.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('buildGhslChromCurves — per-sample + summary');

// 4 panel samples × 4 windows. Samples 0,1 low divergence; 2,3 high.
const chromData = {
  ghsl_panel: {
    samples: ['s0', 's1', 's2', 's3'],
    scales: ['s25k'], primary_scale: 's25k',
    win_mid: { s25k: [1000, 2000, 3000, 4000] },
    div_roll: {
      s25k: [
        Float32Array.from([0.1, 0.1, 0.1, 0.1]),
        Float32Array.from([0.2, 0.2, NaN, 0.2]),
        Float32Array.from([0.8, 0.9, 0.8, 0.9]),
        Float32Array.from([0.9, 1.0, 0.9, 1.0]),
      ],
    },
  },
};

const c = buildGhslChromCurves(chromData);
check('returns a result', !!c);
check('scale + n_windows', c.scale === 's25k' && c.n_windows === 4);
check('win_x from panel midpoints', c.win_x[0] === 1000 && c.win_x[3] === 4000);
check('per_sample matrix carried', c.per_sample.length === 4);
check('median per window (w0 ~ between 0.2 and 0.8)', c.median[0] > 0.2 && c.median[0] < 0.85);
check('P90 ≥ median', c.p90[0] >= c.median[0]);
check('mean computed', Number.isFinite(c.mean[0]));
check('n_used drops NaN (w2 has 3 finite)', c.n_used[2] === 3);
check('vmin/vmax bracket data', c.vmin <= 0.1 + 1e-6 && c.vmax >= 1.0 - 1e-6);

// =====================================================================
group('buildGhslChromCurves — per-karyogroup trajectories');

// labels: samples 0,1 → KG-A ; samples 2,3 → KG-B
const panelLabels = Int32Array.from([0, 0, 1, 1]);
const ck = buildGhslChromCurves(chromData, { panelLabels, k: 2 });
check('per_karyo present', !!ck.per_karyo && !!ck.per_karyo['KG-A'] && !!ck.per_karyo['KG-B']);
check('KG-A low divergence', ck.per_karyo['KG-A'][0] < 0.25);
check('KG-B high divergence', ck.per_karyo['KG-B'][0] > 0.75);
check('per_karyo curves sized to n_windows', ck.per_karyo['KG-A'].length === 4);
check('per_karyo handles NaN window (KG-A w2 = only s0 = 0.1)', Math.abs(ck.per_karyo['KG-A'][2] - 0.1) < 1e-6);

// =====================================================================
group('buildGhslChromCurves — guards + fallbacks');

check('null data → null', buildGhslChromCurves(null) === null);
check('no panel → null', buildGhslChromCurves({}) === null);
check('win_x falls back to index when no coords', (() => {
  const noCoord = { ghsl_panel: { scales: ['x'], primary_scale: 'x',
    div_roll: { x: [Float32Array.from([0.3, 0.4])] } } };
  const r = buildGhslChromCurves(noCoord);
  return r && r.win_x[0] === 0 && r.win_x[1] === 1;
})());
check('maxSamplesKept caps per_sample', (() => {
  const rows = []; for (let i = 0; i < 10; i++) rows.push(Float32Array.from([0.5, 0.5]));
  const big = { ghsl_panel: { scales: ['x'], primary_scale: 'x', div_roll: { x: rows } } };
  const r = buildGhslChromCurves(big, { maxSamplesKept: 4 });
  return r.per_sample.length === 4 && r.n_windows === 2;
})());

// =====================================================================
group('buildHweFisRequest — OUT body');

const reqW = buildHweFisRequest({
  chrom: 'chr5', region: { start_bp: 100, end_bp: 9000 },
  windows: [{ start_bp: 100, end_bp: 1000 }, { start_bp: 1000, end_bp: 2000 }],
  groups: { full: ['a', 'b', 'c'], culled: ['a', 'b'] },
});
check('metric tagged HWE_F_IS', reqW.metric === HWE_FIS_METRIC && reqW.metric === 'hwe_f_is');
check('chrom + region carried', reqW.chrom === 'chr5' && reqW.region.end_bp === 9000);
check('explicit windows carried', Array.isArray(reqW.windows) && reqW.windows.length === 2);
check('groups carried (full + culled)', reqW.groups.full.length === 3 && reqW.groups.culled.length === 2);
check('scale path when no windows', (() => {
  const r = buildHweFisRequest({ chrom: 'c', scale: 's25k' });
  return r.scale === 's25k' && !r.windows;
})());
check('empty groups dropped', (() => {
  const r = buildHweFisRequest({ chrom: 'c', scale: 'x', groups: { g: [] } });
  return !r.groups;
})());

// =====================================================================
group('parseHweFisResponse — shape A (records)');

const respA = {
  windows: [
    { start_bp: 0,    end_bp: 1000, hwe_f_is: -0.30, n_sites: 120, p_value: 0.001 },
    { start_bp: 1000, end_bp: 2000, HWE_F_IS:  0.05, n_sites: 90,  p: 0.40 },
    { start_bp: 2000, end_bp: 3000, fis:       0.42, n_sites: 75,  p_value: 0.01 },
  ],
};
const pA = parseHweFisResponse(respA);
check('parses records', !!pA && pA.n_windows === 3);
check('hwe_f_is values (neg/pos)', Math.abs(pA.hwe_f_is[0] + 0.30) < 1e-9 && Math.abs(pA.hwe_f_is[2] - 0.42) < 1e-9);
check('alt key HWE_F_IS read', Math.abs(pA.hwe_f_is[1] - 0.05) < 1e-9);
check('win_x = midpoints', pA.win_x[0] === 500 && pA.win_x[2] === 2500);
check('n_sites carried', pA.n_sites[0] === 120);
check('significance mask (p≤0.05 → w0,w2)', pA.significant && pA.significant[0] === 1 && pA.significant[1] === 0 && pA.significant[2] === 1);

// =====================================================================
group('parseHweFisResponse — shape B (columnar) + groups');

const respB = {
  hwe_f_is: [-0.2, 0.0, 0.3],
  win_mid: [500, 1500, 2500],
  n_sites: [100, 80, 60],
};
const pB = parseHweFisResponse(respB);
check('parses columnar', !!pB && pB.n_windows === 3 && pB.source === 'columnar');
check('columnar values + x', pB.hwe_f_is[0] === -0.2 && pB.win_x[1] === 1500);
check('no p-values → significant null', pB.significant === null);

const respG = { groups: { full: respA, culled: { hwe_f_is: [-0.1], win_mid: [500] } } };
const pGfull = parseHweFisResponse(respG, { group: 'full' });
const pGcull = parseHweFisResponse(respG, { group: 'culled' });
check('group selection: full', pGfull && pGfull.group === 'full' && pGfull.n_windows === 3);
check('group selection: culled', pGcull && pGcull.group === 'culled' && pGcull.hwe_f_is[0] === -0.1);
check('default group when unspecified', (() => {
  const r = parseHweFisResponse(respG);
  return r && (r.group === 'full' || r.group === 'culled');
})());

// =====================================================================
group('parseHweFisResponse — guards');

check('null → null', parseHweFisResponse(null) === null);
check('empty object → null', parseHweFisResponse({}) === null);
check('non-array columnar → null', parseHweFisResponse({ hwe_f_is: 0.3 }) === null);

// =====================================================================
console.log('\n=================');
console.log('pass: ' + pass + '   fail: ' + fail);
console.log('=================');
if (fail > 0 && typeof process !== 'undefined') process.exitCode = 1;
