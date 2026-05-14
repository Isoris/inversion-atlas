// tests/test_analysis_window_chain_to_candidates_adapter.js
//
// Adapter coverage. Mocks atlas-core's aplr and exercises both paths.

import {
  buildInput,
  saveOutput,
  runWindowChainToCandidates,
} from '../atlases/inversion/analysis/window_chain_to_candidates/adapter_atlas.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// Synthetic fixture (same shape as example_input.json, abbreviated).
function _w(idx, K, labels, pc1, bp) {
  return { idx, start_bp: bp[0], end_bp: bp[1], K, labels, pc1 };
}
const windowsFixture = [
  _w(0, 3, [0,0,0,1,1,1,2,2,2], [-0.5,-0.5,-0.5, 0, 0, 0, 0.5, 0.5, 0.5], [100, 200]),
  _w(1, 3, [0,0,0,1,1,1,2,2,2], [-0.5,-0.5,-0.5, 0, 0, 0, 0.5, 0.5, 0.5], [200, 300]),
  _w(2, 3, [0,0,0,1,1,1,2,2,2], [-0.5,-0.5,-0.5, 0, 0, 0, 0.5, 0.5, 0.5], [300, 400]),
  _w(3, 3, [0,0,0,1,1,1,2,2,2], [-0.5,-0.5,-0.5, 0, 0, 0, 0.5, 0.5, 0.5], [400, 500]),
];

// =====================================================================
group('buildInput — atlasState path');
{
  const atlasState = {
    data: {
      chrom: 'LG28',
      n_samples: 9,
      windows: windowsFixture,
    },
  };
  const input = await buildInput({}, { atlasState });
  check('chrom inferred from atlasState',          input.chrom === 'LG28');
  check('n_samples = 9',                           input.n_samples === 9);
  check('4 windows pulled',                        input.windows.length === 4);
  check('per-window labels carried',
        Array.isArray(input.windows[0].labels) && input.windows[0].labels.length === 9);
  check('per-window pc1 carried',
        Array.isArray(input.windows[0].pc1) && input.windows[0].pc1.length === 9);
}

// =====================================================================
group('buildInput — aplr path');
{
  const fakeAplr = {
    async resolveLayer(id) {
      if (id === 'win:42') {
        return { chrom: 'LG28', n_samples: 9, windows: windowsFixture };
      }
      return null;
    },
  };
  const input = await buildInput({ window_layer_id: 'win:42' }, { aplr: fakeAplr });
  check('aplr resolved layer',                     input.windows.length === 4);
  check('input_layer_ids populated',               input.input_layer_ids.includes('win:42'));
}

// =====================================================================
group('buildInput — empty fallback');
{
  const input = await buildInput({}, {});
  check('no ctx → empty windows',                  Array.isArray(input.windows) && input.windows.length === 0);
  check('n_samples = 0',                           input.n_samples === 0);
}

// =====================================================================
group('saveOutput — atlasState local-stash fallback');
{
  const localState = { inversion: {} };
  const fakeResult = {
    chrom: 'LG28', chains: [{ chain_type: 'het', anchor_w: 1, start_w: 0,
      end_w: 3, start_bp: 100, end_bp: 500, n_windows: 4, evidence: {} }],
    n_chains: 1, source: 'compute', branches_run: ['het'],
    input_layer_ids: [], params_used: {},
  };
  const sink = await saveOutput(fakeResult, {}, { atlasState: localState });
  check('local-stash path used',                   sink.layer_status === 'local_stash');
  check('layer_id encodes chrom',                  sink.layer_id.indexOf('LG28') >= 0);
  check('stash present',
        localState.inversion._chain_sets
     && localState.inversion._chain_sets.LG28 === fakeResult);
  check('no candidates promoted (promote=false)',  sink.candidates_promoted === 0);
}

// =====================================================================
group('saveOutput — aplr commit path');
{
  let committed = null;
  const fakeAplr = {
    async commitLayer(layer) { committed = layer; return { layer_id: 'lay:1' }; },
  };
  const fakeResult = {
    chrom: 'LG28', chains: [], n_chains: 0, source: 'insufficient',
    branches_run: [], input_layer_ids: [], params_used: {},
  };
  const sink = await saveOutput(fakeResult, {}, { aplr: fakeAplr });
  check('aplr.commitLayer called',                 committed !== null);
  check('layer_type = candidate_chain_set',
        committed.layer_type === 'candidate_chain_set');
  check('layer_id from aplr',                      sink.layer_id === 'lay:1');
  check('layer_status = committed_via_aplr',       sink.layer_status === 'committed_via_aplr');
}

// =====================================================================
group('saveOutput — promote=true populates candidateList');
{
  const localState = { inversion: {}, candidateList: [] };
  const fakeResult = {
    chrom: 'LG28',
    chains: [
      { chain_type: 'het', anchor_w: 4, start_w: 2, end_w: 6,
        start_bp: 1200000, end_bp: 1700000, n_windows: 5,
        samples_per_arrangement: { H1: [0,1,2,3], H2: [8,9,10,11], HET: [4,5,6,7] },
        evidence: { het_band_present: true } },
      { chain_type: 'hom_separation', anchor_w: 10, start_w: 8, end_w: 12,
        start_bp: 1800000, end_bp: 2300000, n_windows: 5,
        samples_per_arrangement: { H1: [0,1,2,3,4,5], H2: [6,7,8,9,10,11] },
        cramers_v_mean: 1.0,
        evidence: { het_band_present: false } },
    ],
    n_chains: 2, source: 'compute', branches_run: ['het','hom_separation'],
    input_layer_ids: [], params_used: {},
  };
  const sink = await saveOutput(fakeResult, { promote: true },
                                 { atlasState: localState });
  check('candidates_promoted = 2',                 sink.candidates_promoted === 2);
  check('candidateList grew to 2',                 localState.candidateList.length === 2);
  check('first candidate has chrom + chain_type',
        localState.candidateList[0].chrom === 'LG28'
     && localState.candidateList[0].chain_type === 'het');
  check('first candidate id = chain_het_4',
        localState.candidateList[0].id === 'chain_het_4');
  check('source = window_chain',                   localState.candidateList[0].source === 'window_chain');
  check('confirmed = false',                       localState.candidateList[0].confirmed === false);
  check('samples_per_arrangement preserved',
        localState.candidateList[0].samples_per_arrangement
     && localState.candidateList[0].samples_per_arrangement.HET.length === 4);
}

// =====================================================================
group('saveOutput — promote=true with custom makeCandidate');
{
  const localState = { inversion: {}, candidateList: [] };
  const custom = (chain, env) => ({
    id:           `custom-${chain.anchor_w}`,
    chrom:        env.chrom,
    start_bp:     chain.start_bp,
    end_bp:       chain.end_bp,
    custom_tag:   true,
  });
  const fakeResult = {
    chrom: 'LG28',
    chains: [{ chain_type: 'het', anchor_w: 4, start_w: 2, end_w: 6,
                start_bp: 1200000, end_bp: 1700000, n_windows: 5,
                evidence: {} }],
    n_chains: 1, source: 'compute', branches_run: ['het'],
    input_layer_ids: [], params_used: {},
  };
  await saveOutput(fakeResult, { promote: true },
                    { atlasState: localState, makeCandidate: custom });
  check('custom makeCandidate used',
        localState.candidateList[0].id === 'custom-4'
     && localState.candidateList[0].custom_tag === true);
}

// =====================================================================
group('runWindowChainToCandidates — end-to-end');
{
  const atlasState = {
    data: { chrom: 'LG28', n_samples: 9, windows: windowsFixture },
    inversion: {},
    candidateList: [],
  };
  const { result, sink } = await runWindowChainToCandidates(
    { promote: true, params: { min_chain_length: 3 } },
    { atlasState });
  check('end-to-end: result emitted',              result && Array.isArray(result.chains));
  check('end-to-end: sink emitted',                sink && typeof sink.layer_status === 'string');
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
