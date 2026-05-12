// tests/test_shared_json_classify.js

import {
  JSON_KINDS,
  JSON_KIND_INFO,
  isChromosomeJSON,
  isEnrichmentJSON,
  classifyJSONKind,
} from '../atlases/inversion/shared/json_classify.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('constants');
check('JSON_KINDS frozen, 14 entries',         Object.isFrozen(JSON_KINDS) && JSON_KINDS.length === 14);
check('JSON_KINDS includes chromosome',        JSON_KINDS.includes('chromosome'));
check('JSON_KINDS includes unknown',           JSON_KINDS.includes('unknown'));
check('JSON_KIND_INFO frozen',                 Object.isFrozen(JSON_KIND_INFO));
check('every kind has info entry',
      JSON_KINDS.every(k => k in JSON_KIND_INFO && typeof JSON_KIND_INFO[k].label === 'string'));
check('chromosome state_path = data',          JSON_KIND_INFO.chromosome.state_path === 'data');
check('cohort_diversity state_path = cohortDiversity',
      JSON_KIND_INFO.cohort_diversity.state_path === 'cohortDiversity');
check('unknown state_path = null',             JSON_KIND_INFO.unknown.state_path === null);
check('enrichment state_path = null',          JSON_KIND_INFO.enrichment.state_path === null);

// =====================================================================
group('isChromosomeJSON');
check('valid chrom → true',
      isChromosomeJSON({ n_windows: 100, windows: [{ pos: 0 }] }) === true);
check('null → false',                          isChromosomeJSON(null) === false);
check('n_windows = 0 → false',                 isChromosomeJSON({ n_windows: 0, windows: [] }) === false);
check('missing windows[] → false',             isChromosomeJSON({ n_windows: 100 }) === false);
check('empty windows[] → false',
      isChromosomeJSON({ n_windows: 5, windows: [] }) === false);
check('n_windows non-number → false',
      isChromosomeJSON({ n_windows: '100', windows: [{}] }) === false);

// =====================================================================
group('isEnrichmentJSON');
check('layers_present array → true',
      isEnrichmentJSON({ _layers_present: ['relatedness'] }) === true);
check('null → false',                          isEnrichmentJSON(null) === false);
check('no _layers_present → false',            isEnrichmentJSON({}) === false);
check('_layers_present not array → false',
      isEnrichmentJSON({ _layers_present: 'oops' }) === false);

// =====================================================================
group('classifyJSONKind — happy path per kind');

check('null → unknown',                        classifyJSONKind(null) === 'unknown');
check('undefined → unknown',                   classifyJSONKind(undefined) === 'unknown');
check('empty object → unknown',                classifyJSONKind({}) === 'unknown');

check('cross_species',
      classifyJSONKind({
        tool: 'cross_species_breakpoints_v1', schema_version: 1, breakpoints: [],
      }) === 'cross_species');

check('cohort_diversity (wrapped)',
      classifyJSONKind({
        tool: 'cohort_diversity_v1', schema_version: 1, samples: [],
      }) === 'cohort_diversity');

check('cohort_diversity (raw array dt_S1 paste)',
      classifyJSONKind([{ sample_id: 'CGA001', f_roh: 0.1 }]) === 'cohort_diversity');

check('dotplot_mashmap',
      classifyJSONKind({
        tool: 'dotplot_mashmap_v1', schema_version: 1, resolutions: [],
      }) === 'dotplot_mashmap');

check('synteny_multispecies',
      classifyJSONKind({
        tool: 'catfish_synteny_toolkit_v1', schema_version: 1,
        species: [{ id: 'X' }], synteny_blocks: [],
      }) === 'synteny_multispecies');

check('phylo_tree',
      classifyJSONKind({
        tool: 'phylo_tree_v1', schema_version: 1,
        newick: '(A,B);', species_set: ['A', 'B'],
      }) === 'phylo_tree');

check('dxy_per_inversion',
      classifyJSONKind({
        tool: 'dxy_per_inversion_v1', schema_version: 1, per_inversion: [],
      }) === 'dxy_per_inversion');

check('comp_te_fragility',
      classifyJSONKind({
        tool: 'comparative_te_breakpoint_fragility_v1', schema_version: 1,
        per_breakpoint_per_species: [],
      }) === 'comp_te_fragility');

check('karyotype_lineage',
      classifyJSONKind({
        tool: 'karyotype_lineage_v1', schema_version: 1,
        params: {}, per_focal_chr: [],
      }) === 'karyotype_lineage');

check('cheat30_results',
      classifyJSONKind({
        tool: 'cheat30_gds_by_genotype', schema_version: 'cheat30_v1',
        chrom: 'LG28', candidates: {},
      }) === 'cheat30_results');

check('ncrna_density',
      classifyJSONKind({
        tool: 'ncrna_density_v1', schema_version: 1,
        chromosomes: [{
          chrom: 'LG28', n_windows: 4,
          window_centers_mb: [0.1, 0.2, 0.3, 0.4],
          by_class: { tRNA_all: { densities: [1, 1, 1, 1] } },
        }],
      }) === 'ncrna_density');

check('repeat_density',
      classifyJSONKind({
        version: 2, binning_source: 'scrubber_windows',
        chromosomes: [{
          chrom: 'LG28', n_windows: 4,
          window_centers_mb: [0.1, 0.2, 0.3, 0.4],
          window_start_bp: [0, 1, 2, 3], window_end_bp: [1, 2, 3, 4],
          by_class: { all_TE: { densities: [0.1, 0.2, 0.3, 0.4] } },
        }],
      }) === 'repeat_density');

check('chromosome (last resort among structured shapes)',
      classifyJSONKind({
        n_windows: 100, windows: [{ pos: 0 }],
      }) === 'chromosome');

check('enrichment (fallback)',
      classifyJSONKind({ _layers_present: ['relatedness'] }) === 'enrichment');

check('unknown shape',                         classifyJSONKind({ random: 'stuff' }) === 'unknown');

// =====================================================================
group('classifyJSONKind — priority ordering');
{
  // A chrom-like JSON that ALSO has cross-species fields should match
  // cross_species first (tool wins over generic shape).
  const ambiguous = {
    tool: 'cross_species_breakpoints_v1', schema_version: 1, breakpoints: [],
    n_windows: 100, windows: [{ pos: 0 }],   // ALSO chromosome-shaped
  };
  check('cross_species wins over chromosome',  classifyJSONKind(ambiguous) === 'cross_species');
}
{
  // chromosome wins over enrichment (chrom data may also have _layers_present)
  const both = {
    n_windows: 10, windows: [{ pos: 0 }],
    _layers_present: ['het'],
  };
  check('chromosome wins over enrichment',     classifyJSONKind(both) === 'chromosome');
}

// =====================================================================
group('classifyJSONKind — broken-detector resilience');
{
  // Detectors are wrapped in try/catch — a malformed JSON that crashes
  // one detector shouldn't abort the rest of the chain. We can't easily
  // force one of the shared detectors to throw, so we just verify the
  // chain runs to completion on a wide variety of weird inputs.
  let threw = false;
  try {
    classifyJSONKind({ tool: null, schema_version: NaN });
    classifyJSONKind({ tool: 123, schema_version: 'abc' });
    classifyJSONKind({ chrom: 'X' });  // chrom-string-only, no n_windows
    classifyJSONKind([]);              // empty array
    classifyJSONKind('a string');
    classifyJSONKind(42);
    classifyJSONKind(true);
  } catch (_) { threw = true; }
  check('detector chain handles weird inputs without throwing', !threw);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
