// tests/test_discovery_dosage_karyogroup_export.js
//
// Karyogroup export builder + popstats request shaping.

import {
  buildKaryogroupExport, buildPopstatsRequest, KARYOGROUP_EXPORT_SCHEMA,
} from '../atlases/inversion/pages/discovery/dosage_heatmap/karyogroup_export.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

const canonical = {
  n_samples: 6, n_markers: 4,
  sample_labels: ['ind1', 'ind2', 'ind3', 'ind4', 'ind5', 'ind6'],
};
const detect = {
  mode: 'index_aware', k: 2,
  labels: Int32Array.from([0, 0, 0, 1, 1, 1]),
  karyogroup: ['KG-A','KG-A','KG-A','KG-B','KG-B','KG-B'],
  regime_call: ['homA_like','homA_like','homA_like','homB_like','homB_like','homB_like'],
  mean: Float64Array.from([0.1, 0.0, 0.2, 1.9, 2.0, 1.8]),
  margin: Float64Array.from([0.9, 1.0, 0.8, 0.9, 1.0, 0.85]),
  groups: [
    { label: 0, karyogroup: 'KG-A', n: 3, call: 'homA_like', mean_dosage: 0.1, confidence: 0.9, separation: 3.2 },
    { label: 1, karyogroup: 'KG-B', n: 3, call: 'homB_like', mean_dosage: 1.9, confidence: 0.92, separation: 3.2 },
  ],
};
const kgstats = {
  n_windows: 5, n_inside: 4, n_outside: 1, frac_inside: 0.8,
  block: { start_win: 0, end_win: 3, n_windows: 4, start_bp: 1000, end_bp: 5000 },
  summary: { cramers_v_mean_inside: 0.98, fst_mean_inside: 0.95, cramers_v_mean_all: 0.8, fst_mean_all: 0.77 },
  thresholds: { v: 0.5, fst: 0.05 },
  windows: [{ idx: 0, cramers_v: 1, fst: 1, inside: true }],
};

// =====================================================================
group('buildKaryogroupExport — shape');

const exp = buildKaryogroupExport(canonical, detect, kgstats, { generated: '2026-01-01T00:00:00Z' });
check('returns payload', !!exp);
check('schema tag', exp.schema === KARYOGROUP_EXPORT_SCHEMA);
check('generated honoured', exp.generated === '2026-01-01T00:00:00Z');
check('k + n_samples', exp.k === 2 && exp.n_samples === 6);
check('groups_map keyed by karyogroup', !!exp.groups_map['KG-A'] && !!exp.groups_map['KG-B']);
check('groups_map members are sample ids', exp.groups_map['KG-A'].join(',') === 'ind1,ind2,ind3');
check('per-sample records carry karyogroup + dosage', (() => {
  const s0 = exp.samples[0];
  return s0.sample === 'ind1' && s0.karyogroup === 'KG-A' && Math.abs(s0.dosage_mean - 0.1) < 1e-9;
})());
check('karyogroups summary present', exp.karyogroups.length === 2
  && exp.karyogroups[0].id === 'KG-A' && exp.karyogroups[0].n === 3
  && exp.karyogroups[0].tier === 'homA');
check('boundary block carried', exp.boundary && exp.boundary.block.start_bp === 1000 && exp.boundary.n_inside === 4);
check('region defaults to block span', exp.region && exp.region.start_bp === 1000 && exp.region.end_bp === 5000);

// =====================================================================
group('region override + JSON-serialisable');

const exp2 = buildKaryogroupExport(canonical, detect, kgstats,
  { region: { chrom: 'chr7', start_bp: 100, end_bp: 200 }, generated: 'x' });
check('explicit region wins', exp2.region.chrom === 'chr7' && exp2.region.start_bp === 100);
check('round-trips through JSON', (() => {
  const s = JSON.stringify(exp2);
  const back = JSON.parse(s);
  return back.groups_map['KG-B'].length === 3 && back.k === 2;
})());

// =====================================================================
group('buildPopstatsRequest');

const req = buildPopstatsRequest(exp2, { chrom: 'chr7', metrics: ['fst'] });
check('returns request body', !!req);
check('chrom + region', req.chrom === 'chr7' && req.region.start_bp === 100 && req.region.end_bp === 200);
check('metrics passed', req.metrics.join(',') === 'fst');
check('groups carried (≥2 members)', req.groups['KG-A'].length === 3 && req.groups['KG-B'].length === 3);
check('drops singleton/empty groups → null when <2 usable', (() => {
  const skew = buildKaryogroupExport(
    { n_samples: 4, n_markers: 2, sample_labels: ['a','b','c','d'] },
    { k: 2, labels: Int32Array.from([0,0,0,1]), mean: Float64Array.from([0,0,0,2]),
      groups: [{label:0,n:3,call:'homA_like'},{label:1,n:1,call:'homB_like'}] },
    null, {});
  // KG-B has only 1 member → <2 usable groups → null
  return buildPopstatsRequest(skew, { minPerGroup: 2 }) === null;
})());

// =====================================================================
group('degenerate guards');

check('null canonical → null', buildKaryogroupExport(null, detect, kgstats) === null);
check('null detect → null', buildKaryogroupExport(canonical, null, kgstats) === null);
check('export without kgstats ok (no boundary)', (() => {
  const e = buildKaryogroupExport(canonical, detect, null, {});
  return e && !e.boundary && e.k === 2;
})());
check('buildPopstatsRequest null export → null', buildPopstatsRequest(null) === null);

// =====================================================================
console.log('\n=================');
console.log('pass: ' + pass + '   fail: ' + fail);
console.log('=================');
if (fail > 0 && typeof process !== 'undefined') process.exitCode = 1;
