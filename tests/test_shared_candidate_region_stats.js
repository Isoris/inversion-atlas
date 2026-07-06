// tests/test_shared_candidate_region_stats.js
//
// Per-region (per-inversion / per-LRR) overdominance / POD hallmark stats
// for the candidate & karyotype page:
//   - candidate_region_stats: karyotype grouping + groupwise request + FIS
//     / theta_pi parse
//   - sift_adapter: deleterious-load request + tolerant parse (inert path)
//   - candidate_stats_table: TSV export

import {
  buildKaryotypeGroups, buildRegionStatsRequest, parseRegionStatsResponse,
  karyotypeGroupName, sampleId, REGION_STATS_METRICS,
} from '../atlases/inversion/shared/candidate_region_stats.js';
import {
  buildSiftRequest, parseSiftResponse, SIFT_METRIC,
} from '../atlases/inversion/shared/sift_adapter.js';
import {
  buildCandidateStatsTSV, CANDIDATE_STATS_COLUMNS,
} from '../atlases/inversion/shared/candidate_stats_table.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// Shared fixtures: K=3 candidate over chr5, 6 samples (2 per karyotype).
const samples = [
  { cga: 'S0' }, { cga: 'S1' }, { cga: 'S2' },
  { cga: 'S3' }, { cga: 'S4' }, { cga: 'S5' },
];
const candidate = {
  id: 'cand_abc', chrom: 'chr5', start_bp: 1000000, end_bp: 3000000, K: 3,
  locked_labels: Int8Array.from([0, 0, 1, 1, 2, 2]),   // HOMO_1, HET, HOMO_2
};

// =====================================================================
group('buildKaryotypeGroups');

const g = buildKaryotypeGroups(candidate, samples);
check('returns groups + all + K', !!g && g.K === 3 && g.all.length === 6);
check('HOMO_1 has S0,S1', g.byKaryo.HOMO_1.join(',') === 'S0,S1');
check('HET has S2,S3', g.byKaryo.HET.join(',') === 'S2,S3');
check('HOMO_2 has S4,S5', g.byKaryo.HOMO_2.join(',') === 'S4,S5');
check('karyotypeGroupName K=3', karyotypeGroupName(0, 3) === 'HOMO_1' && karyotypeGroupName(1, 3) === 'HET');
check('karyotypeGroupName K=4 → band_k', karyotypeGroupName(2, 4) === 'band_2');
check('sampleId prefers cga', sampleId({ cga: 'X', ind: 'Y' }) === 'X');
check('ambiguous label (−1) skipped from groups but counted in all', (() => {
  const c2 = { ...candidate, locked_labels: Int8Array.from([-1, 0, 1, 1, 2, 2]) };
  const r = buildKaryotypeGroups(c2, samples);
  return r.all.length === 6 && r.byKaryo.HOMO_1.length === 1;
})());
check('shape mismatch → null', buildKaryotypeGroups(candidate, samples.slice(0, 4)) === null);
check('no locked_labels → null', buildKaryotypeGroups({ chrom: 'c', K: 3 }, samples) === null);

// =====================================================================
group('buildRegionStatsRequest');

const req = buildRegionStatsRequest(candidate, samples);
check('has chrom + region', req.chrom === 'chr5' && req.region.start_bp === 1000000 && req.region.end_bp === 3000000);
check('includes ALL group (region-wide)', Array.isArray(req.groups.ALL) && req.groups.ALL.length === 6);
check('includes per-karyotype groups', req.groups.HOMO_1.length === 2 && req.groups.HET.length === 2 && req.groups.HOMO_2.length === 2);
check('default metrics = FIS + theta_pi', req.metrics.join(',') === REGION_STATS_METRICS.join(','));
check('custom metrics honoured', buildRegionStatsRequest(candidate, samples, { metrics: ['hwe_f_is'] }).metrics.length === 1);
check('missing chrom → null', buildRegionStatsRequest({ ...candidate, chrom: null }, samples) === null);

// =====================================================================
group('parseRegionStatsResponse');

// Groupwise response: per-group scalar metrics, ALL = region-wide.
const resp = {
  groups: {
    ALL:    { hwe_f_is: -0.22, theta_pi: 0.0041, n_sites: 1200 },
    HOMO_1: { hwe_f_is:  0.02, theta_pi: 0.0018 },
    HET:    { hwe_f_is: -0.40, theta_pi: 0.0060 },
    HOMO_2: { hwe_f_is:  0.05, theta_pi: 0.0020 },
  },
};
const parsed = parseRegionStatsResponse(resp);
check('region FIS = ALL group', Math.abs(parsed.fis + 0.22) < 1e-9);
check('region theta_pi = ALL group', Math.abs(parsed.theta_pi - 0.0041) < 1e-12);
check('per-group FIS captured', parsed.fis_by_group.HET === -0.40);
check('per-group theta captured', parsed.theta_pi_by_group.HOMO_1 === 0.0018);
check('n_sites captured', parsed.n_sites === 1200);
check('falls back to group mean when no ALL', (() => {
  const r = parseRegionStatsResponse({ groups: { HOMO_1: { hwe_f_is: 0.1 }, HOMO_2: { hwe_f_is: -0.1 } } });
  return Math.abs(r.fis) < 1e-9;   // mean of 0.1 and -0.1
})());
check('alt key HWE_F_IS + flat container', (() => {
  const r = parseRegionStatsResponse({ ALL: { HWE_F_IS: -0.15, pi: 0.003 } });
  return Math.abs(r.fis + 0.15) < 1e-9 && Math.abs(r.theta_pi - 0.003) < 1e-12;
})());
check('empty / null → null', parseRegionStatsResponse(null) === null && parseRegionStatsResponse({}) === null);

// =====================================================================
group('sift_adapter — request');

const sreq = buildSiftRequest(candidate, samples);
check('metric tagged deleterious_load', sreq.metric === SIFT_METRIC && sreq.metric === 'deleterious_load');
check('region + chrom + groups carried', sreq.chrom === 'chr5' && sreq.region.end_bp === 3000000 && sreq.groups.HET.length === 2);
check('has ALL group', sreq.groups.ALL.length === 6);
check('missing labels → null', buildSiftRequest({ chrom: 'c', K: 3 }, samples) === null);

// =====================================================================
group('sift_adapter — parse');

const sresp = {
  groups: {
    ALL:    { deleterious_load: 0.18, n_deleterious: 36, n_tolerated: 164 },
    HOMO_1: { deleterious_load: 0.10, n_deleterious: 10, n_tolerated: 190 },
    HOMO_2: { deleterious_load: 0.30, n_deleterious: 60, n_tolerated: 140 },
  },
};
const sp = parseSiftResponse(sresp);
check('region deleterious_load = ALL', Math.abs(sp.deleterious_load - 0.18) < 1e-9);
check('del_tol_ratio derived from counts', Math.abs(sp.del_tol_ratio - (36 / 164)) < 1e-9);
check('per-group captured', sp.by_group.HOMO_2.deleterious_load === 0.30);
check('flat region scalars parse', (() => {
  const r = parseSiftResponse({ deleterious_load: 0.25, del_tol_ratio: 0.4, n_variants: 500 });
  return Math.abs(r.deleterious_load - 0.25) < 1e-9 && r.del_tol_ratio === 0.4 && r.source === 'flat';
})());
check('counts-only → load as deleterious fraction', (() => {
  const r = parseSiftResponse({ n_deleterious: 25, n_variants: 100 });
  return Math.abs(r.deleterious_load - 0.25) < 1e-9;
})());
check('null / empty → null', parseSiftResponse(null) === null && parseSiftResponse({}) === null);

// =====================================================================
group('candidate_stats_table — TSV export');

const withStats = {
  ...candidate,
  region_stats: {
    fis: -0.22, theta_pi: 0.0041, n_sites: 1200, source: 'groupwise',
    computed_at: '2026-07-06T00:00:00Z',
    fis_by_group: { HOMO_1: 0.02, HET: -0.40, HOMO_2: 0.05 },
    sift: { deleterious_load: 0.18, del_tol_ratio: 0.22, n_variants: 200 },
  },
};
const lrrNoStats = { id: 'cand_lrr', chrom: 'chr7', start_bp: 5e6, end_bp: 9e6, K: 3, is_auto: true };
const tsv = buildCandidateStatsTSV([withStats, lrrNoStats]);
const lines = tsv.replace(/\n$/, '').split('\n');   // keep trailing empty cells
check('header row present', lines[0] === CANDIDATE_STATS_COLUMNS.join('\t'));
check('one row per candidate', lines.length === 3);
const r0 = lines[1].split('\t');
check('row: id + chrom', r0[0] === 'cand_abc' && r0[1] === 'chr5');
check('row: span_mb computed', r0[4] === '2.000');
check('row: FIS formatted', r0[8] === '-0.2200');
check('row: theta_pi sci', /e/.test(r0[9]));
check('row: deleterious_load', r0[10] === '0.1800');
check('row: karyotype_groups list', r0[6] === 'HOMO_1;HET;HOMO_2');
check('row: fis_by_group serialized', /HET:-0.4000/.test(r0[13]));
const r1 = lines[2].split('\t');
check('LRR row without stats → empty stat cells', r1[8] === '' && r1[10] === '' && r1[7] === 'true');
check('empty list → header only', buildCandidateStatsTSV([]).replace(/\n$/, '').split('\n').length === 1);

// =====================================================================
console.log('\n=================');
console.log('pass: ' + pass + '   fail: ' + fail);
console.log('=================');
if (fail > 0 && typeof process !== 'undefined') process.exitCode = 1;
