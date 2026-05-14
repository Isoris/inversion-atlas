// tests/test_analysis_karyotype_assignment_adapter.js
//
// Adapter coverage: buildInput / saveOutput / runKaryotypeAssignment.
// Mocks atlas-core's aplr (registry) so we can exercise both paths
// without a live atlas-core dependency.

import {
  buildInput,
  saveOutput,
  runKaryotypeAssignment,
} from '../atlases/inversion/analysis/karyotype_assignment/adapter_atlas.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
// Shared fixture: a K=3 candidate
// =====================================================================

const candidate = {
  id:                'INV_LG28_002',
  K:                 3,
  locked_labels:     new Int32Array([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2]),
  samplePC1:         [-0.62, -0.55, -0.48, -0.51,  0.02, -0.04,  0.05,  0.01,
                       0.58,  0.51,  0.62,  0.55],
  per_sample_het:    [0.02, 0.05, 0.03, 0.04, 0.55, 0.61, 0.58, 0.62,
                       0.03, 0.04, 0.02, 0.05],
};

const atlasState = {
  candidate,
  inversion: {},
  data: {
    samples: ['CGA001','CGA002','CGA003','CGA004','CGA005','CGA006',
              'CGA007','CGA008','CGA009','CGA010','CGA011','CGA012'],
  },
};

// =====================================================================
group('buildInput — direct atlasState path (no aplr)');
{
  const input = await buildInput({}, { atlasState });
  check('input.candidate.id resolved',          input.candidate.id === 'INV_LG28_002');
  check('input.candidate.K = 3',                input.candidate.K === 3);
  check('input.candidate.labels length = 12',   input.candidate.labels.length === 12);
  check('input.candidate.pc1 length = 12',      input.candidate.pc1.length === 12);
  check('input.candidate.per_sample_het length = 12',
        input.candidate.per_sample_het.length === 12);
  check('input.candidate.samples = atlas IDs',
        input.candidate.samples[0] === 'CGA001');
  check('params object present',                typeof input.params === 'object');
}

// =====================================================================
group('buildInput — aplr resolver path');
{
  const fakeAplr = {
    async resolveLayer(id) {
      if (id === 'cand:42') {
        return {
          id: 'INV_X',
          K: 3,
          labels: [0, 1, 2, 0, 1, 2],
          pc1:    [-0.5, 0, 0.5, -0.4, 0.05, 0.6],
        };
      }
      if (id === 'het:99') return { values: [0.05, 0.55, 0.05, 0.04, 0.58, 0.02] };
      return null;
    },
  };
  const input = await buildInput({
    candidate_layer_id: 'cand:42',
    per_sample_het_layer_id: 'het:99',
  }, { aplr: fakeAplr });
  check('candidate resolved via aplr',          input.candidate.id === 'INV_X');
  check('per_sample_het resolved via aplr',     input.candidate.per_sample_het.length === 6);
  check('input_layer_ids round-tripped',
        input.input_layer_ids.includes('cand:42')
     && input.input_layer_ids.includes('het:99'));
}

// =====================================================================
group('buildInput — graceful when no candidate available');
{
  const input = await buildInput({}, {});
  check('null ctx + null candidate → empty K/labels',
        input.candidate.K === 0 && input.candidate.labels.length === 0);
}

// =====================================================================
group('saveOutput — atlasState local-stash fallback');
{
  const localState = { inversion: {} };
  const fakeResult = {
    candidate_id: 'INV_X',
    per_sample: [], per_band: [], karyotype_assignment: [],
    coarse_group: [], source: 'precomp_het', n_samples: 0, n_bands: 0,
    input_layer_ids: [], params_used: {},
  };
  const sink = await saveOutput(fakeResult, { scope: { candidate_id: 'INV_X' } },
    { atlasState: localState });
  check('local-stash path used',                sink.layer_status === 'local_stash');
  check('layer_id encodes candidate id',
        typeof sink.layer_id === 'string' && sink.layer_id.indexOf('INV_X') >= 0);
  check('stash present on atlasState.inversion',
        localState.inversion._karyotype_assignments
     && localState.inversion._karyotype_assignments.INV_X === fakeResult);
}

// =====================================================================
group('saveOutput — aplr commit path');
{
  let committed = null;
  const fakeAplr = {
    async commitLayer(layer) { committed = layer; return { layer_id: 'lay:1' }; },
  };
  const fakeResult = {
    candidate_id: 'INV_X', per_sample: [], per_band: [],
    karyotype_assignment: [], coarse_group: [],
    source: 'precomp_het', n_samples: 0, n_bands: 0,
    input_layer_ids: ['cand:42'], params_used: {},
  };
  const sink = await saveOutput(fakeResult, {}, { aplr: fakeAplr });
  check('aplr commitLayer called',              committed !== null);
  check('layer_type = candidate_karyotype_per_sample',
        committed.layer_type === 'candidate_karyotype_per_sample');
  check('payload preserved',                    committed.payload === fakeResult);
  check('layer_id returned by aplr',            sink.layer_id === 'lay:1');
  check('layer_status = committed_via_aplr',    sink.layer_status === 'committed_via_aplr');
}

// =====================================================================
group('saveOutput — aplr throws → local-stash fallback');
{
  const localState = { inversion: {} };
  const fakeAplr = {
    async commitLayer() { throw new Error('boom'); },
  };
  const fakeResult = {
    candidate_id: 'INV_X', per_sample: [], per_band: [],
    karyotype_assignment: [], coarse_group: [],
    source: 'precomp_het', n_samples: 0, n_bands: 0,
    input_layer_ids: [], params_used: {},
  };
  const sink = await saveOutput(fakeResult, {}, { aplr: fakeAplr, atlasState: localState });
  check('on aplr failure → falls back to local stash',
        sink.layer_status === 'local_stash'
     && localState.inversion._karyotype_assignments.INV_X === fakeResult);
}

// =====================================================================
group('saveOutput — no sink at all');
{
  const sink = await saveOutput({ candidate_id: 'X' }, {}, {});
  check('no aplr + no atlasState → no_sink',    sink.layer_status === 'no_sink');
}

// =====================================================================
group('runKaryotypeAssignment — end-to-end');
{
  const localState = {
    candidate, inversion: {},
    data: { samples: atlasState.data.samples.slice() },
  };
  const { result, sink } = await runKaryotypeAssignment({}, { atlasState: localState });
  check('end-to-end: result.n_samples = 12',    result.n_samples === 12);
  check('end-to-end: coarse_group populated',
        result.coarse_group.length === 12
     && result.coarse_group.every(g => g === 'HOMO_1' || g === 'HET' || g === 'HOMO_2'));
  check('end-to-end: sink emitted',             sink.layer_status === 'local_stash');
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
