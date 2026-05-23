// tests/test_shared_band_tracking_genome_scale.js
//
// Unit coverage for shared/band_tracking/genome_scale.js — Layer 5
// chromosome-scale wiring.

import {
  GENOME_SCALE_LINKS,
  GENOME_SCALE_DEFAULTS,
  mergePerChromosomeRegimes,
  crossChromosomeRegimeLinks,
  genomeWidePedigreeFromRegimes,
  genomeWideRegimeReport,
} from '../atlases/inversion/shared/band_tracking/genome_scale.js';
import {
  REGIME_PEDIGREE_VERDICTS,
} from '../atlases/popstats/shared/band_tracking/regime_pedigree.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab + defaults');

check('GENOME_SCALE_LINKS frozen',     Object.isFrozen(GENOME_SCALE_LINKS));
check('defaults frozen',                Object.isFrozen(GENOME_SCALE_DEFAULTS));
check('CHAINED link tag',               GENOME_SCALE_LINKS.CHAINED === 'cross_chrom_chained');
check('chained_min_shared default = 5',
      GENOME_SCALE_DEFAULTS.chained_min_shared === 5);

// =====================================================================
// Fixture: 3 chromosomes, each with 2 regimes.
//   chr1 regime 0: hom_a = {0..5}, hom_b = {6..11}, het = {12..14}
//   chr1 regime 1: hom_a = {0..5}, hom_b = {30..35}, het = {40..42}
//   chr2 regime 0: hom_a = {0..5}, hom_b = {50..55}, het = {60..62}
//   chr2 regime 1: hom_a = {6..11}, hom_b = {0..5}, het = {70..72}  ← cross-chrom SWAPPED
//   chr3 regime 0: hom_a = {100..105}, hom_b = {200..205}, het = {300, 301}  ← isolated
//   chr3 regime 1: hom_a = {0..5}, hom_b = {6..11}, het = {12..14}  ← chained with chr1.r0
// =====================================================================
function mkRegime(id, homA, homB, het, start) {
  return {
    regime_id: id, member_ids: [], sign_split: false,
    start_bp: start, end_bp: start + 1_000_000, n_intervals: 1,
    hom_a_intersect: new Set(homA),
    hom_b_intersect: new Set(homB),
    het_union:       new Set(het),
  };
}
const perChromMap = new Map([
  ['chr1', { ok: true, n_intervals: 2, n_regimes: 2, regimes: [
    mkRegime(0, [0, 1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 11], [12, 13, 14], 1_000_000),
    mkRegime(1, [0, 1, 2, 3, 4, 5], [30, 31, 32, 33, 34, 35], [40, 41, 42], 5_000_000),
  ] }],
  ['chr2', { ok: true, n_intervals: 2, n_regimes: 2, regimes: [
    mkRegime(0, [0, 1, 2, 3, 4, 5], [50, 51, 52, 53, 54, 55], [60, 61, 62], 1_000_000),
    mkRegime(1, [6, 7, 8, 9, 10, 11], [0, 1, 2, 3, 4, 5], [70, 71, 72], 3_000_000),
  ] }],
  ['chr3', { ok: true, n_intervals: 2, n_regimes: 2, regimes: [
    mkRegime(0, [100, 101, 102, 103, 104, 105],
             [200, 201, 202, 203, 204, 205], [300, 301], 1_000_000),
    mkRegime(1, [0, 1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 11], [12, 13, 14], 5_000_000),
  ] }],
]);

// =====================================================================
group('mergePerChromosomeRegimes');

const merged = mergePerChromosomeRegimes(perChromMap);
check('ok = true',                      merged.ok === true);
check('n_chroms = 3',                   merged.n_chroms === 3);
check('n_regimes = 6',                  merged.n_regimes === 6);
check('flat regimes array length = 6',  merged.regimes.length === 6);
// Each regime carries its chrom + regime_uid
check('chrom field present',            merged.regimes.every(r => typeof r.chrom === 'string'));
check('regime_uid format',
      merged.regimes.every(r => r.regime_uid && r.regime_uid.indexOf(':') >= 0));
check('by_chrom map has 3 keys',        merged.by_chrom.size === 3);
check('chr1 has 2 indices in by_chrom',
      merged.by_chrom.get('chr1').length === 2);
// Sample-cores preserved
const r0 = merged.regimes[0];
check('chr1 regime 0: hom_a preserved',
      r0.hom_a_intersect && r0.hom_a_intersect.has(0));

// Object instead of Map
const perChromObj = {
  chrA: perChromMap.get('chr1'),
};
const mergedObj = mergePerChromosomeRegimes(perChromObj);
check('object input accepted',          mergedObj.ok === true && mergedObj.n_chroms === 1);

// Null / empty inputs
check('null → ok=false',                mergePerChromosomeRegimes(null).ok === false);
check('empty map → n_regimes 0',        mergePerChromosomeRegimes(new Map()).n_regimes === 0);

// =====================================================================
group('crossChromosomeRegimeLinks');

const links = crossChromosomeRegimeLinks(merged.regimes);
check('edges array present',            Array.isArray(links.edges));
check('intra-chrom pairs skipped',      links.n_intra_skipped > 0);

// chr1.r0 vs chr2.r0: both have hom_a = {0..5} → CHAINED
const link_chr1r0_chr2r0 = links.edges.find(e =>
  (e.chrom_a === 'chr1' && e.chrom_b === 'chr2' && e.regime_uid_a === 'chr1:0')
  || (e.chrom_a === 'chr2' && e.chrom_b === 'chr1' && e.regime_uid_b === 'chr1:0')
);
check('chr1.r0 ↔ chr2.r0: CHAINED',     !!link_chr1r0_chr2r0);
check('chr1.r0 ↔ chr2.r0: 6 shared hom_a',
      link_chr1r0_chr2r0.n_shared_hom_a === 6);

// chr1.r0 vs chr2.r1: chr2.r1 has hom_a={6..11} (matches chr1.r0.hom_b)
// and hom_b={0..5} (matches chr1.r0.hom_a) → SWAPPED-style link
// (Cross-chrom doesn't distinguish SWAPPED — it just flags CHAINED
// when hom_a OR hom_b sets share enough samples.)
const link_swap = links.edges.find(e =>
  (e.regime_uid_a === 'chr1:0' && e.regime_uid_b === 'chr2:1')
  || (e.regime_uid_a === 'chr2:1' && e.regime_uid_b === 'chr1:0')
);
check('cross-chrom SWAPPED-style: detected as CHAINED',
      !!link_swap);
// Either hom_a or hom_b should be the matching side here.
if (link_swap) {
  check('cross-chrom SWAPPED: n_shared_hom_b = 6',
        link_swap.n_shared_hom_b === 6
        || link_swap.n_shared_hom_a === 6);
}

// chr3.r0 (isolated) should produce NO edges
const chr3r0_edges = links.edges.filter(e =>
  e.regime_uid_a === 'chr3:0' || e.regime_uid_b === 'chr3:0');
check('chr3.r0 has no cross-chrom edges (disjoint cores)',
      chr3r0_edges.length === 0);

// chr3.r1 mirrors chr1.r0 exactly → should link to chr1.r0 + chr2.r0 + chr2.r1
const chr3r1_edges = links.edges.filter(e =>
  e.regime_uid_a === 'chr3:1' || e.regime_uid_b === 'chr3:1');
check('chr3.r1 has ≥ 2 cross-chrom edges',
      chr3r1_edges.length >= 2);

// edges sorted by n_shared_max desc
if (links.edges.length >= 2) {
  check('edges sorted by n_shared_max desc',
        links.edges[0].n_shared_max >= links.edges[1].n_shared_max);
}

// All edges tagged CHAINED
check('all edges have link_type = CHAINED',
      links.edges.every(e => e.link_type === GENOME_SCALE_LINKS.CHAINED));

// Custom threshold: nothing passes
const linksStrict = crossChromosomeRegimeLinks(merged.regimes,
  { chained_min_shared: 100 });
check('strict threshold: 0 edges',     linksStrict.n_edges === 0);

// =====================================================================
group('genomeWidePedigreeFromRegimes');

const sample_list = [0, 1, 5, 99];
const pedigree = genomeWidePedigreeFromRegimes(merged.regimes, sample_list);
check('pedigree pairs count = 6',       pedigree.pairs.length === 6);
check('pedigree uses 6 genome-wide regimes',
      pedigree.n_regimes === 6);

// Samples 0 and 1 are HOM_A in 4 of 6 regimes (chr1.r0, chr1.r1, chr2.r0,
// chr3.r1), HOM_B in 1 (chr2.r1), and uncalled in chr3.r0 → 5 called,
// 4 same-class → frac = 0.8 → FIRST_DEGREE.
const pair_01 = pedigree.pairs.find(p =>
  (p.sample_a === 0 && p.sample_b === 1)
  || (p.sample_a === 1 && p.sample_b === 0));
check('samples 0+1: ≥ FIRST_DEGREE',
      pair_01.verdict === REGIME_PEDIGREE_VERDICTS.FIRST_DEGREE
      || pair_01.verdict === REGIME_PEDIGREE_VERDICTS.DUPLICATE);

// Sample 99 should be uncalled in most regimes → INSUFFICIENT_DATA
const pair_0_99 = pedigree.pairs.find(p =>
  (p.sample_a === 0 && p.sample_b === 99)
  || (p.sample_a === 99 && p.sample_b === 0));
check('sample 99 (mostly uncalled): n_called < 5 → INSUFFICIENT_DATA',
      pair_0_99.verdict === REGIME_PEDIGREE_VERDICTS.INSUFFICIENT_DATA);

// =====================================================================
group('genomeWideRegimeReport — orchestrator');

const report = genomeWideRegimeReport(perChromMap, {
  sample_list: [0, 1, 5],
});
check('ok = true',                      report.ok === true);
check('merged populated',               report.merged && report.merged.n_regimes === 6);
check('cross_chrom_links populated',    report.cross_chrom_links
                                          && report.cross_chrom_links.n_edges > 0);
check('mendelian null (no trios/families)', report.mendelian === null);
check('pedigree populated',             report.pedigree
                                          && report.pedigree.pairs.length > 0);

// With trios + families
const trios = [
  { father: 0, mother: 12, offspring: 1 },
  { father: 1, mother: 13, offspring: 2 },
  { father: 0, mother: 12, offspring: 3 },
  { father: 1, mother: 14, offspring: 4 },
  { father: 0, mother: 13, offspring: 5 },
];
const reportFull = genomeWideRegimeReport(perChromMap, {
  trios, sample_list: [0, 1, 5],
});
check('mendelian populated when trios given',
      reportFull.mendelian && reportFull.mendelian.ok === true);
check('per-regime mendelian count = 6',
      reportFull.mendelian.per_regime.length === 6);

// Null input
check('null → ok=false',
      genomeWideRegimeReport(null).ok === false);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
