// tests/test_analysis_window_chain_to_candidates_compute.js
//
// Pure JSON-in / JSON-out compute() coverage. Both chain branches.

import { compute } from '../atlases/inversion/analysis/window_chain_to_candidates/compute.js';
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

const FIXTURE_PATH = '/home/user/inversion-atlas/atlases/inversion/analysis/window_chain_to_candidates/example_input.json';
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

// =====================================================================
group('compute — basic shape');

const nullOut = compute(null);
check('null input → empty result',
      nullOut.n_chains === 0 && nullOut.source === 'insufficient'
   && Array.isArray(nullOut.chains));

const emptyOut = compute({ windows: [], n_samples: 0 });
check('empty windows → empty result',
      emptyOut.n_chains === 0);

// =====================================================================
group('compute — fixture: het + hom_separation');

const out = compute(fixture);
check('source = compute',                          out.source === 'compute');
check('chrom = LG28',                              out.chrom === 'LG28');
check('two chains found',                          out.n_chains === 2);
check('branches_run includes het + hom_separation',
      out.branches_run.includes('het') && out.branches_run.includes('hom_separation'));

const hetChain = out.chains.find(c => c.chain_type === 'het');
const homChain = out.chains.find(c => c.chain_type === 'hom_separation');
check('het chain exists',                          !!hetChain);
check('hom_separation chain exists',               !!homChain);

if (hetChain) {
  check('het chain anchor = 4',                    hetChain.anchor_w === 4);
  check('het chain span w[2..6]',                  hetChain.start_w === 2 && hetChain.end_w === 6);
  check('het chain n_windows = 5',                 hetChain.n_windows === 5);
  check('het chain start_bp = 1200000',            hetChain.start_bp === 1200000);
  check('het chain end_bp = 1700000',              hetChain.end_bp === 1700000);
  check('het chain has H1, H2, HET arrangements',
        hetChain.samples_per_arrangement.H1.length === 4
     && hetChain.samples_per_arrangement.H2.length === 4
     && hetChain.samples_per_arrangement.HET.length === 4);
  check('het evidence: het_band_present=true',     hetChain.evidence.het_band_present === true);
  check('het evidence: n_het_windows = 5',         hetChain.evidence.n_het_windows === 5);
}

if (homChain) {
  check('hom_separation anchor = 10',              homChain.anchor_w === 10);
  check('hom_separation span w[8..12]',            homChain.start_w === 8 && homChain.end_w === 12);
  check('hom_separation n_windows = 5',            homChain.n_windows === 5);
  check('hom_separation V_mean = 1.00 (perfect)',
        Math.abs(homChain.cramers_v_mean - 1.0) < 1e-9);
  check('hom_separation V_min = 1.00 (perfect)',
        Math.abs(homChain.cramers_v_min - 1.0) < 1e-9);
  check('hom_separation has H1, H2 arrangements (no HET)',
        homChain.samples_per_arrangement.H1.length === 6
     && homChain.samples_per_arrangement.H2.length === 6
     && (!homChain.samples_per_arrangement.HET || homChain.samples_per_arrangement.HET.length === 0));
  check('hom_separation evidence: het_band_present=false',
        homChain.evidence.het_band_present === false);
  check('hom_separation anchor_K = 2',             homChain.evidence.anchor_K === 2);
}

// =====================================================================
group('compute — K-match guard prevents drift');

// Drop the het branch and check that hom_separation does NOT bleed
// into the K=3 windows even with seed at K=2.
const homOnly = compute({
  ...fixture,
  params: { ...fixture.params, branches: ['hom_separation'] },
});
check('hom_separation-only: 1 chain',              homOnly.n_chains === 1);
if (homOnly.n_chains >= 1) {
  const c = homOnly.chains[0];
  check('hom_separation-only: stays within K=2 windows (w 8..12)',
        c.start_w === 8 && c.end_w === 12);
}

// =====================================================================
group('compute — het-only branch');

const hetOnly = compute({
  ...fixture,
  params: { ...fixture.params, branches: ['het'] },
});
check('het-only: 1 chain',                         hetOnly.n_chains === 1);
if (hetOnly.n_chains >= 1) {
  check('het-only: chain_type = het',              hetOnly.chains[0].chain_type === 'het');
}

// =====================================================================
group('compute — min_chain_length filter');

// Set min_chain_length=10 — both chains have only 5 windows, both should be dropped.
const filtered = compute({
  ...fixture,
  params: { ...fixture.params, min_chain_length: 10 },
});
check('min_chain_length=10 → 0 chains',            filtered.n_chains === 0);

// =====================================================================
group('compute — output is JSON-serialisable');

let serialised;
try { serialised = JSON.stringify(out); } catch (e) { serialised = null; }
check('output is JSON-serialisable',               typeof serialised === 'string');
const round = JSON.parse(serialised);
check('round-trip preserves n_chains',             round.n_chains === out.n_chains);

// =====================================================================
group('compute — Cramér V threshold gate');

// Bump threshold to 1.01 (impossible). Hom-separation should produce nothing.
const tightV = compute({
  ...fixture,
  params: { ...fixture.params, cramers_v_threshold: 1.01 },
});
check('V threshold above 1.0 → no hom_separation chain',
      tightV.chains.every(c => c.chain_type !== 'hom_separation'));

// =====================================================================
group('compute — provenance round-tripping');

check('params_used populated',                     out.params_used && Number.isFinite(out.params_used.cramers_v_threshold));
check('input_layer_ids round-tripped',             Array.isArray(out.input_layer_ids) && out.input_layer_ids.includes('scrubber_main:LG28'));

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
