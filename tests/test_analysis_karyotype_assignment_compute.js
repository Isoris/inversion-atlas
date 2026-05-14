// tests/test_analysis_karyotype_assignment_compute.js
//
// Pure JSON-in / JSON-out compute() coverage. Registry-agnostic;
// no adapter, no atlasState, no DOM.

import { compute } from '../atlases/inversion/analysis/karyotype_assignment/compute.js';
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('compute — basic shape');

const empty = compute(null);
check('null input → well-formed empty result',
      empty && Array.isArray(empty.per_sample) && empty.per_sample.length === 0
   && Array.isArray(empty.coarse_group) && empty.coarse_group.length === 0
   && empty.source === 'insufficient'
   && empty.n_samples === 0 && empty.n_bands === 0);

const emptyCand = compute({ candidate: { K: 0, labels: [] } });
check('empty candidate → insufficient source',
      emptyCand.source === 'insufficient' && emptyCand.n_samples === 0);

// =====================================================================
group('compute — K=3 fixture from example_input.json');

const input = JSON.parse(readFileSync(
  '/home/user/inversion-atlas/atlases/inversion/analysis/karyotype_assignment/example_input.json',
  'utf8'));
const out = compute(input);

check('candidate_id round-tripped',
      out.candidate_id === 'INV_LG28_001');
check('n_samples = 12',                          out.n_samples === 12);
check('n_bands = 3',                             out.n_bands === 3);
check('source = precomp_het (per_sample_het supplied)',
      out.source === 'precomp_het');
check('per_sample length matches n_samples',     out.per_sample.length === 12);
check('per_band length matches K',               out.per_band.length === 3);
check('karyotype_assignment length matches K',   out.karyotype_assignment.length === 3);
check('coarse_group length matches n_samples',   out.coarse_group.length === 12);

// Band interpretation pattern: 2 hom-like + 1 het-like
const interps = out.per_band.map(b => b.interpretation).sort();
check('per_band interpretations: 1 het-like + 2 hom-like',
      interps.join(',') === 'het-like,hom-like,hom-like');

// Haplotype classes assigned
const hc = out.karyotype_assignment.map(k => k.haplotype_class);
check('all karyotype entries got a haplotype_class',
      hc.every(x => x === 'H1/H1' || x === 'H1/H2' || x === 'H2/H2'));

// Coarse-group mapping
const cg = out.coarse_group;
check('first 4 samples → HOMO_1',
      cg[0] === 'HOMO_1' && cg[1] === 'HOMO_1' && cg[2] === 'HOMO_1' && cg[3] === 'HOMO_1');
check('middle 4 samples → HET',
      cg[4] === 'HET' && cg[5] === 'HET' && cg[6] === 'HET' && cg[7] === 'HET');
check('last 4 samples → HOMO_2',
      cg[8] === 'HOMO_2' && cg[9] === 'HOMO_2' && cg[10] === 'HOMO_2' && cg[11] === 'HOMO_2');

// Sample-id round-tripping
check('per_sample[0].sample = CGA001',
      out.per_sample[0].sample === 'CGA001');

// Provenance / params round-tripping
check('input_layer_ids round-tripped',
      Array.isArray(out.input_layer_ids) && out.input_layer_ids.length === 2);
check('params_used populated',
      out.params_used && Number.isFinite(out.params_used.low_het_threshold));

// =====================================================================
group('compute — K=2 (no HET band)');
// Edge case: a fixed-different inversion that only has HOMO_1 / HOMO_2,
// no observed heterozygotes. K=3 coarse_group should NOT fire (K !== 3),
// so coarse_group becomes all-'unknown'.
const fixedOut = compute({
  candidate: {
    K: 2,
    labels:         [0, 0, 0, 0, 1, 1, 1, 1],
    pc1:            [-0.6, -0.55, -0.51, -0.58, 0.55, 0.61, 0.58, 0.62],
    per_sample_het: [0.02, 0.03, 0.04, 0.02, 0.03, 0.05, 0.04, 0.03],
  },
});
check('K=2 fixture: n_bands = 2',                fixedOut.n_bands === 2);
check('K=2 fixture: coarse_group all "unknown" (K !== 3)',
      fixedOut.coarse_group.every(g => g === 'unknown'));
check('K=2 fixture: per_band still computed',
      fixedOut.per_band.length === 2 && fixedOut.per_band.every(b => typeof b.interpretation === 'string'));

// =====================================================================
group('compute — missing per_sample_het without proxy → insufficient');

const noHet = compute({
  candidate: {
    K: 3,
    labels: [0, 0, 1, 1, 2, 2],
    pc1:    [-0.5, -0.45, 0.0, 0.05, 0.5, 0.55],
    // no per_sample_het
  },
  params: { allow_pc_residual_proxy: false },
});
check('no per_sample_het + proxy off → empty per_sample',
      noHet.per_sample.length === 0);
check('no per_sample_het + proxy off → source insufficient',
      noHet.source === 'insufficient');

// =====================================================================
group('compute — params override');

const strict = compute({
  ...input,
  params: { ...input.params, low_het_threshold: 0.01, high_het_threshold: 0.99 },
});
check('strict thresholds: params_used reflects override',
      strict.params_used.low_het_threshold === 0.01
   && strict.params_used.high_het_threshold === 0.99);
check('strict thresholds: still emits per_sample',
      strict.per_sample.length === 12);

// =====================================================================
group('compute — output is JSON-serialisable');
let serialised;
try { serialised = JSON.stringify(out); } catch (e) { serialised = null; }
check('compute() output is JSON-serialisable', typeof serialised === 'string');
check('round-tripped JSON preserves n_samples',
      JSON.parse(serialised).n_samples === out.n_samples);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
