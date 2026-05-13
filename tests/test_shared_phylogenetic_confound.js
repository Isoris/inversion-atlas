// tests/test_shared_phylogenetic_confound.js
//
// Unit coverage for shared/phylogenetic_confound.js — the
// karyotype-vs-clade stress test (rules out "K-means picked up the
// underlying phylogeny instead of the inversion").

import {
  PHYLO_CONFOUND_VERDICTS,
  PHYLO_CONFOUND_INTERPRETATIONS,
  PHYLO_CONFOUND_DEFAULTS,
  normaliseKaryotypeLabels,
  classifyPhylogeneticConfound,
  interpretConfoundResult,
  summariseConfoundForCandidate,
} from '../atlases/inversion/shared/phylogenetic_confound.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab + defaults');

check('verdicts frozen',           Object.isFrozen(PHYLO_CONFOUND_VERDICTS));
check('defaults frozen',           Object.isFrozen(PHYLO_CONFOUND_DEFAULTS));
check('4-state verdict',           Object.keys(PHYLO_CONFOUND_VERDICTS).length === 4);
check('confounded_v_above = 0.60', PHYLO_CONFOUND_DEFAULTS.confounded_v_above === 0.60);
check('independent_v_below = 0.30',PHYLO_CONFOUND_DEFAULTS.independent_v_below === 0.30);
check('min_n_overlap = 20',        PHYLO_CONFOUND_DEFAULTS.min_n_overlap === 20);

// =====================================================================
group('normaliseKaryotypeLabels — vocab tolerance');

check('AA → 0',                normaliseKaryotypeLabels(['AA'])[0] === 0);
check('STD/STD → 0',           normaliseKaryotypeLabels(['STD/STD'])[0] === 0);
check('AB → 1',                normaliseKaryotypeLabels(['AB'])[0] === 1);
check('HET → 1',               normaliseKaryotypeLabels(['HET'])[0] === 1);
check('BB → 2',                normaliseKaryotypeLabels(['BB'])[0] === 2);
check('INV/INV → 2',           normaliseKaryotypeLabels(['INV/INV'])[0] === 2);
check('numeric 0/1/2 passthrough',
      normaliseKaryotypeLabels([0,1,2])[0] === 0
   && normaliseKaryotypeLabels([0,1,2])[1] === 1
   && normaliseKaryotypeLabels([0,1,2])[2] === 2);
check('null → -1',             normaliseKaryotypeLabels([null])[0] === -1);
check('unknown string → -1',   normaliseKaryotypeLabels(['blob'])[0] === -1);
check('null input → empty',    normaliseKaryotypeLabels(null).length === 0);

// =====================================================================
group('CONFOUNDED — karyotype perfectly tracks 3 clades');

// 30 samples, 3 clades × 3 karyotypes, but clade and karyotype are
// THE SAME variable. Perfect confounding → V = 1, ARI = 1.
const ky_conf = [];
const cl_conf = [];
for (let i = 0; i < 30; i++) {
  const g = i % 3;          // 0, 1, 2 cycling
  ky_conf.push(g);
  cl_conf.push('clade_' + g);
}
const r_conf = classifyPhylogeneticConfound(ky_conf, cl_conf);
check('CONFOUNDED verdict',           r_conf.verdict === PHYLO_CONFOUND_VERDICTS.CONFOUNDED);
check('Cramér V = 1',                  Math.abs(r_conf.cramers_v - 1) < 1e-6);
check('ARI = 1',                       Math.abs(r_conf.ari - 1) < 1e-6);
check('p tiny',                        r_conf.p_value < 1e-6);
check('n_overlap = 30',                r_conf.n_overlap === 30);
check('n_karyotypes = 3',              r_conf.n_karyotypes === 3);
check('n_clades = 3',                  r_conf.n_clades === 3);

// =====================================================================
group('INDEPENDENT — karyotype orthogonal to phylogeny');

// 60 samples, karyotype and clade are independently uniform.
// Distribution: 60 = 6 clades × 10 each; karyotype 0/1/2 distributed
// evenly within each clade (no association). Use deterministic
// scheme: karyotype = floor(i / 3) % 3, clade = i % 6 — these are
// coprime so no association.
const ky_indep = [];
const cl_indep = [];
for (let i = 0; i < 60; i++) {
  ky_indep.push(Math.floor(i / 3) % 3);
  cl_indep.push('clade_' + (i % 6));
}
const r_indep = classifyPhylogeneticConfound(ky_indep, cl_indep);
check('INDEPENDENT verdict',           r_indep.verdict === PHYLO_CONFOUND_VERDICTS.INDEPENDENT);
check('Cramér V small',                r_indep.cramers_v < 0.30);
check('ARI near 0',                    Math.abs(r_indep.ari) < 0.20);

// =====================================================================
group('PARTIALLY_CONFOUNDED — intermediate association');

// 60 samples: 40 follow the clade-tracks-karyotype pattern, 20 are noise.
const ky_part = [];
const cl_part = [];
for (let i = 0; i < 40; i++) {
  const g = i % 3;
  ky_part.push(g);
  cl_part.push('clade_' + g);
}
// 20 noise samples — random reassignment
const noiseKy = [0, 1, 2, 0, 2, 1, 1, 0, 2, 0, 2, 1, 0, 1, 2, 0, 1, 2, 0, 1];
const noiseCl = ['clade_2','clade_0','clade_1','clade_2','clade_0','clade_2','clade_0','clade_1','clade_1','clade_2','clade_1','clade_0','clade_2','clade_0','clade_2','clade_1','clade_0','clade_1','clade_2','clade_0'];
for (let i = 0; i < 20; i++) { ky_part.push(noiseKy[i]); cl_part.push(noiseCl[i]); }
const r_part = classifyPhylogeneticConfound(ky_part, cl_part);
check('partial fixture: V in (0.30, 0.85)',
      r_part.cramers_v > 0.30 && r_part.cramers_v < 0.85);
check('partial fixture: verdict not INDEPENDENT',
      r_part.verdict !== PHYLO_CONFOUND_VERDICTS.INDEPENDENT);

// =====================================================================
group('INSUFFICIENT_DATA — small N or degenerate');

check('n < min_n_overlap → insufficient',
      classifyPhylogeneticConfound(
        [0, 1, 2, 0, 1],
        ['c0', 'c1', 'c2', 'c0', 'c1'],
      ).verdict === PHYLO_CONFOUND_VERDICTS.INSUFFICIENT_DATA);

check('only 1 distinct karyotype → insufficient',
      classifyPhylogeneticConfound(
        new Array(30).fill(0),
        new Array(30).fill(0).map((_, i) => 'c' + (i % 3)),
      ).verdict === PHYLO_CONFOUND_VERDICTS.INSUFFICIENT_DATA);

check('only 1 distinct clade → insufficient',
      classifyPhylogeneticConfound(
        new Array(30).fill(0).map((_, i) => i % 3),
        new Array(30).fill('only_clade'),
      ).verdict === PHYLO_CONFOUND_VERDICTS.INSUFFICIENT_DATA);

check('null inputs → insufficient',
      classifyPhylogeneticConfound(null, null).verdict === PHYLO_CONFOUND_VERDICTS.INSUFFICIENT_DATA);

// =====================================================================
group('Missing-tolerant overlap');

// Some samples have missing karyotype OR missing clade; should be
// dropped from the test but not break it.
const ky_miss = [];
const cl_miss = [];
for (let i = 0; i < 30; i++) {
  if (i < 25) {
    ky_miss.push(i % 3);
    cl_miss.push('c' + (i % 3));
  } else {
    ky_miss.push(null);              // missing karyotype
    cl_miss.push('c0');
  }
}
const r_miss = classifyPhylogeneticConfound(ky_miss, cl_miss);
check('missing-tolerant: n_overlap = 25', r_miss.n_overlap === 25);
check('missing-tolerant: still CONFOUNDED', r_miss.verdict === PHYLO_CONFOUND_VERDICTS.CONFOUNDED);

// =====================================================================
group('summariseConfoundForCandidate');

const summary = summariseConfoundForCandidate(ky_conf, cl_conf);
check('summary has 7 keys (incl. interpretation + circularity_advisory)',
      Object.keys(summary).length === 7);
check('summary.verdict = CONFOUNDED', summary.verdict === PHYLO_CONFOUND_VERDICTS.CONFOUNDED);
check('summary.cramers_v = 1',      Math.abs(summary.cramers_v - 1) < 1e-6);

check('summary null+null → null',  summariseConfoundForCandidate(null, null) === null);

// =====================================================================
group('interpretConfoundResult — biological interpretation table');

check('confounded + no aux → ancestry_like',
      interpretConfoundResult(PHYLO_CONFOUND_VERDICTS.CONFOUNDED, {})
   === PHYLO_CONFOUND_INTERPRETATIONS.ANCESTRY_LIKE);
check('confounded + family clustering → family_ld_suspect',
      interpretConfoundResult(PHYLO_CONFOUND_VERDICTS.CONFOUNDED, { family_clustering: true })
   === PHYLO_CONFOUND_INTERPRETATIONS.FAMILY_LD_SUSPECT);
check('independent + breakpoint → inversion_supported',
      interpretConfoundResult(PHYLO_CONFOUND_VERDICTS.INDEPENDENT, { breakpoint_supported: true })
   === PHYLO_CONFOUND_INTERPRETATIONS.INVERSION_SUPPORTED);
check('independent + no breakpoint → local_haplotype_regime',
      interpretConfoundResult(PHYLO_CONFOUND_VERDICTS.INDEPENDENT, {})
   === PHYLO_CONFOUND_INTERPRETATIONS.LOCAL_HAPLOTYPE_REGIME);
check('partial → ancestry_like (conservative)',
      interpretConfoundResult(PHYLO_CONFOUND_VERDICTS.PARTIALLY_CONFOUNDED, {})
   === PHYLO_CONFOUND_INTERPRETATIONS.ANCESTRY_LIKE);
check('insufficient_data → unknown',
      interpretConfoundResult(PHYLO_CONFOUND_VERDICTS.INSUFFICIENT_DATA, {})
   === PHYLO_CONFOUND_INTERPRETATIONS.UNKNOWN);

// =====================================================================
group('summariseConfoundForCandidate — interpretation + circularity advisory');

const conf_s = summariseConfoundForCandidate(ky_conf, cl_conf);
check('summary has interpretation',         typeof conf_s.interpretation === 'string');
check('summary: confounded → ancestry_like', conf_s.interpretation === PHYLO_CONFOUND_INTERPRETATIONS.ANCESTRY_LIKE);
check('summary: circularity_advisory = false (default true)',
      conf_s.circularity_advisory === false);

const conf_circular = summariseConfoundForCandidate(ky_conf, cl_conf, {
  tree_excludes_candidate: false,
});
check('tree_excludes_candidate=false → circularity_advisory = true',
      conf_circular.circularity_advisory === true);

const indep_s = summariseConfoundForCandidate(ky_indep, cl_indep, {
  breakpoint_supported: true,
});
check('independent + breakpoint_supported → inversion_supported',
      indep_s.interpretation === PHYLO_CONFOUND_INTERPRETATIONS.INVERSION_SUPPORTED);

const conf_fam = summariseConfoundForCandidate(ky_conf, cl_conf, {
  family_clustering: true,
});
check('confounded + family_clustering → family_ld_suspect',
      conf_fam.interpretation === PHYLO_CONFOUND_INTERPRETATIONS.FAMILY_LD_SUSPECT);

// =====================================================================
group('Custom thresholds');

// Tighten confounded_v_above so the partial fixture still doesn't trip it.
const r_strict = classifyPhylogeneticConfound(ky_part, cl_part, {
  confounded_v_above: 0.95,
  confounded_ari_above: 0.95,
});
check('strict thresholds: partial → not CONFOUNDED',
      r_strict.verdict !== PHYLO_CONFOUND_VERDICTS.CONFOUNDED);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
