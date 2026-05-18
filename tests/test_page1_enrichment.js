// tests/test_page1_enrichment.js
//
// Unit tests for pages/discovery/local_pca_dosage/enrichment.js — the
// enrichment-layer merge that runs whenever the user drops a partial
// JSON onto an already-loaded chromosome (or when IDB restore replays
// cached enrichments at startup).

import {
  ENRICHMENT_LAYER_NAMES,
  mergeEnrichmentLayers,
} from '../atlases/inversion/pages/discovery/local_pca_dosage/enrichment.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// Build a minimal v2 state.data the merge can operate on.
function makeState(chrom) {
  return {
    data: {
      schema_version: 2,
      chrom: chrom || 'LG28',
      _layers_present: ['windows', 'samples'],
      windows: [{ center_mb: 1 }, { center_mb: 2 }],
      n_windows: 2,
      samples: [{ cga: 'a' }, { cga: 'b' }],
    },
    layersPresent: new Set(['windows', 'samples']),
  };
}

// Build a v2 enrichment carrying a single declared layer.
function makeEnrichment(chrom, layerName, payload) {
  return {
    schema_version: 2,
    chrom,
    _layers_present: [layerName],
    [layerName]: payload,
  };
}

// =====================================================================
group('layer registry');
check('ENRICHMENT_LAYER_NAMES is non-empty array',
      Array.isArray(ENRICHMENT_LAYER_NAMES) && ENRICHMENT_LAYER_NAMES.length > 20);
check('ENRICHMENT_LAYER_NAMES is frozen',
      Object.isFrozen(ENRICHMENT_LAYER_NAMES));
// Spot-check a few representatives
for (const name of ['ghsl_panel', 'cusum_theta', 'sv_evidence', 'marker_catalogue',
                     'dosage_chunks', 'theta_pi_panel', 'relatedness']) {
  check(`includes ${name}`, ENRICHMENT_LAYER_NAMES.includes(name));
}

// =====================================================================
group('null / no-state guards');
check('null state → no-op',
      mergeEnrichmentLayers(null, {}).added.length === 0);
check('null enrichment → no-op',
      mergeEnrichmentLayers({ data: {} }, null).added.length === 0);
check('state without data → no-op',
      mergeEnrichmentLayers({}, { schema_version: 2 }).added.length === 0);

// =====================================================================
group('chrom mismatch rejection');
{
  const state = makeState('LG28');
  const enr = makeEnrichment('LG07', 'sv_evidence', { foo: 1 });
  const result = mergeEnrichmentLayers(state, enr);
  check('returns rejected_chrom_mismatch = true',
        result.rejected_chrom_mismatch === true);
  check('added is empty',                   result.added.length === 0);
  check('state.data unchanged',              !state.data.sv_evidence);
  check('layersPresent unchanged',           !state.layersPresent.has('sv_evidence'));
}

// =====================================================================
group('chrom match (or enrichment with no chrom) is accepted');
{
  const state = makeState('LG28');
  const enr = makeEnrichment('LG28', 'sv_evidence', { confirmed: ['a'] });
  const result = mergeEnrichmentLayers(state, enr);
  check('rejected = false',                 result.rejected_chrom_mismatch === false);
  check('added includes sv_evidence',       result.added.includes('sv_evidence'));
  check('state.data.sv_evidence populated', state.data.sv_evidence.confirmed[0] === 'a');
  check('layersPresent updated',             state.layersPresent.has('sv_evidence'));
  check('state.data._layers_present synced',
        state.data._layers_present.includes('sv_evidence'));
}
{
  // Enrichment with no chrom field also passes (legacy behaviour)
  const state = makeState('LG28');
  const enr = { schema_version: 2, _layers_present: ['cusum_ghsl'], cusum_ghsl: { x: 1 } };
  const result = mergeEnrichmentLayers(state, enr);
  check('chrom-less enrichment merges',      result.added.includes('cusum_ghsl'));
}

// =====================================================================
group('layers already present are NOT re-added');
{
  const state = makeState('LG28');
  state.data.sv_evidence = { existing: true };
  state.layersPresent.add('sv_evidence');
  const enr = makeEnrichment('LG28', 'sv_evidence', { confirmed: ['NEW'] });
  const result = mergeEnrichmentLayers(state, enr);
  check('added does NOT include sv_evidence',
        !result.added.includes('sv_evidence'));
  check('existing payload preserved',
        state.data.sv_evidence.existing === true);
  check('new payload NOT applied',
        !state.data.sv_evidence.confirmed);
}

// =====================================================================
group('tracks layer: merges by key');
{
  // tracks is special — by-key merge, doesn't overwrite existing names
  const state = makeState('LG28');
  state.data.tracks = {
    existing_track: { values: [1, 2, 3] },
  };
  state.layersPresent.add('tracks');
  state.data._layers_present = Array.from(state.layersPresent);

  const enr = {
    schema_version: 2, chrom: 'LG28',
    _layers_present: ['tracks'],
    tracks: {
      new_track:        { values: [9, 8, 7] },
      existing_track:   { values: [0, 0, 0] },   // should NOT overwrite
    },
  };
  mergeEnrichmentLayers(state, enr);
  check('new track key added',
        state.data.tracks.new_track && state.data.tracks.new_track.values[0] === 9);
  check('existing track preserved',
        state.data.tracks.existing_track.values[0] === 1);
}
{
  // tracks layer arrives when there were none
  const state = makeState('LG28');
  // No tracks in initial state. _layers_present omits 'tracks'.
  state.data._layers_present = Array.from(state.layersPresent);
  const enr = {
    schema_version: 2, chrom: 'LG28',
    _layers_present: ['tracks'],
    tracks: { phase4_score: { values: [1, 2] } },
  };
  const result = mergeEnrichmentLayers(state, enr);
  check('tracks layer added when previously absent',
        result.added.includes('tracks'));
  check('state.data.tracks populated',
        state.data.tracks.phase4_score.values[0] === 1);
}

// =====================================================================
group('unknown layer is dropped');
{
  const state = makeState('LG28');
  // Real layer + bogus one. detectSchemaAndLayers will exclude the bogus
  // because its switch only allows known names — so this enrichment
  // contributes nothing.
  const enr = {
    schema_version: 2, chrom: 'LG28',
    _layers_present: ['totally_made_up_layer'],
    totally_made_up_layer: { x: 1 },
  };
  const result = mergeEnrichmentLayers(state, enr);
  check('unknown name not added',
        result.added.length === 0 && !state.data.totally_made_up_layer);
}

// =====================================================================
group('multiple layers merged in one call');
{
  const state = makeState('LG28');
  const enr = {
    schema_version: 2, chrom: 'LG28',
    _layers_present: ['sv_evidence', 'gene_cargo', 'qc_flags'],
    sv_evidence: { found: ['s1'] },
    gene_cargo: { genes: ['G1', 'G2'] },
    qc_flags: { flagged: 3 },
  };
  const result = mergeEnrichmentLayers(state, enr);
  check('all 3 added',
        result.added.length === 3
        && result.added.includes('sv_evidence')
        && result.added.includes('gene_cargo')
        && result.added.includes('qc_flags'));
  check('state.data has all 3 payloads',
        state.data.sv_evidence.found[0] === 's1'
        && state.data.gene_cargo.genes.length === 2
        && state.data.qc_flags.flagged === 3);
  check('layersPresent grew by 3',
        state.layersPresent.has('sv_evidence')
        && state.layersPresent.has('gene_cargo')
        && state.layersPresent.has('qc_flags'));
}

// =====================================================================
group('idempotence: same merge twice → second is no-op');
{
  const state = makeState('LG28');
  const enr = makeEnrichment('LG28', 'classification', { result: 'PASS' });
  const r1 = mergeEnrichmentLayers(state, enr);
  const r2 = mergeEnrichmentLayers(state, enr);
  check('first call adds classification',  r1.added.includes('classification'));
  check('second call adds nothing',         r2.added.length === 0);
  check('state.data.classification unchanged',
        state.data.classification.result === 'PASS');
}

// =====================================================================
group('state.layersPresent auto-initialised when missing');
{
  const state = {
    data: {
      schema_version: 2, chrom: 'LG28',
      _layers_present: ['classification'],
      classification: { x: 1 },
    },
    // No layersPresent on state — the merge should create one.
  };
  const result = mergeEnrichmentLayers(state, makeEnrichment('LG28', 'sv_evidence', { y: 1 }));
  check('layersPresent created as Set',     state.layersPresent instanceof Set);
  check('contains the just-added layer',    state.layersPresent.has('sv_evidence'));
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
