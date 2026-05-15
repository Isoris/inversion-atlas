// Smoke tests for shared/atlas_server.js — the action-pipeline exports.
//
// Inversion-atlas uses a fail-soft return shape { ok, status, json|text,
// error? } across read/write/compute, so the action-pipeline methods
// follow the same convention. Tests use a mocked fetch.
//
// Run from the atlas root:
//   node atlases/inversion/shared/test_atlas_server.js

import {
  listLayers, getLayer, resolveLatestLayer,
  submitAction, getActionLog, newActionId,
  atlasServer,
} from './atlas_server.js';

// Point the singleton at a deterministic URL so request URLs are predictable.
atlasServer.setUrl('http://test.local');

const _routes = [];
const _calls  = [];

function _route(predicate, respFn) { _routes.push({ predicate, respFn }); }
function _resetMock() { _routes.length = 0; _calls.length = 0; }

globalThis.fetch = async (url, init) => {
  _calls.push({ url, init });
  for (const r of _routes) {
    if (r.predicate(url, init)) return _makeResp(await r.respFn(url, init));
  }
  return _makeResp({ status: 404, body: { error: 'no mock route', url } });
};

function _makeResp({ status = 200, body = null, text = null } = {}) {
  const okStatus = status >= 200 && status < 300;
  const bodyText = text !== null
    ? text
    : (body === null ? '' : JSON.stringify(body));
  return {
    ok: okStatus,
    status,
    headers: { get: () => 'application/json' },
    async json() { return body !== null ? body : JSON.parse(bodyText); },
    async text() { return bodyText; },
  };
}

function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error(`FAIL: ${msg}\n  expected: ${JSON.stringify(b)}\n  got: ${JSON.stringify(a)}`);
    process.exit(1);
  }
  console.log(`  ok: ${msg}`);
}

// ---- tests ----

console.log('listLayers (fail-soft shape):');
{
  _resetMock();
  _route(
    (url) => url.startsWith('http://test.local/api/layers'),
    () => ({ body: { layers: [{ layer_id: 'L1' }], n: 1, total: 1 } }),
  );
  const r = await listLayers({ layer_type: 'fst_windows', limit: 50 });
  eq(r.ok, true, 'ok=true on success');
  eq(r.status, 200, 'status=200');
  eq(r.json.layers[0].layer_id, 'L1', 'json.layers parsed');
  eq(_calls[0].url.includes('layer_type=fst_windows'), true, 'layer_type forwarded');
  eq(_calls[0].url.includes('limit=50'), true, 'limit forwarded');

  _resetMock();
  _route(() => true, () => ({ status: 500, text: 'engine down' }));
  const err = await listLayers({});
  eq(err.ok, false, 'ok=false on 5xx');
  eq(err.status, 500, 'status=500');
  eq(err.error, 'engine down', 'error body captured');
}

console.log('getLayer (fail-soft):');
{
  _resetMock();
  _route(
    (url) => url === 'http://test.local/api/layers/fst_windows_main_226_hatchery_abc',
    () => ({ body: { layer_id: 'fst_windows_main_226_hatchery_abc', stage: 'normalized' } }),
  );
  const r = await getLayer('fst_windows_main_226_hatchery_abc');
  eq(r.ok, true, 'ok=true');
  eq(r.json.stage, 'normalized', 'envelope returned');

  _resetMock();
  const missing = await getLayer('');
  eq(missing.ok, false, 'empty layer_id rejected with ok=false');
  eq(missing.error, 'no layer_id', 'error message specific');
}

console.log('resolveLatestLayer (fail-soft):');
{
  _resetMock();
  _route(
    (url) => url.startsWith('http://test.local/api/layers?'),
    () => ({ body: { layers: [{ layer_id: 'L_a' }, { layer_id: 'L_b' }], n: 2, total: 2 } }),
  );
  _route(
    (url) => url === 'http://test.local/api/layers/L_b',
    () => ({ body: { layer_id: 'L_b', stage: 'normalized' } }),
  );
  const r = await resolveLatestLayer('fst_windows', { dataset_id: 'c1' });
  eq(r.ok, true, 'ok=true');
  eq(r.json.layer_id, 'L_b', 'tail of list returned');

  _resetMock();
  _route(() => true, () => ({ body: { layers: [], n: 0, total: 0 } }));
  const none = await resolveLatestLayer('fst_windows', { dataset_id: 'x' });
  eq(none.ok, true, 'no-match: still ok=true');
  eq(none.json, null, 'no-match: json=null (NOT an error)');
}

console.log('submitAction (fail-soft):');
{
  _resetMock();
  const missing = await submitAction(null);
  eq(missing.ok, false, 'null manifest → ok=false');

  _resetMock();
  _route(
    (url, init) => url.startsWith('http://test.local/api/actions') && init && init.method === 'POST',
    () => ({ body: { ok: true, action_id: 'act_1_xyz', atlas_id: 'inversion',
                      produced_layers: ['fst_windows_main_226_hatchery_xyz'] } }),
  );
  const m = {
    action_id: 'act_1_xyz', type: 'run_popstats',
    dataset_id: 'main_226_hatchery', runner: 'run_popstats',
    target: { chrom: 'C_gar_LG28', groups: { A: ['s1'], B: ['s2'] } },
    params: { stat: 'fst' },
    expected_outputs: [{ layer_type: 'fst_windows', schema_version: 'fst_windows_v1' }],
  };
  const r = await submitAction(m, { atlas: 'inversion' });
  eq(r.ok, true, 'success: ok=true');
  eq(r.json.produced_layers.length, 1, 'one produced layer');
  eq(_calls[0].url, 'http://test.local/api/actions?atlas=inversion', 'atlas query forwarded');
  eq(_calls[0].init.method, 'POST', 'POST method');
  const sentBody = JSON.parse(_calls[0].init.body);
  eq(sentBody.action_id, 'act_1_xyz', 'manifest body forwarded');
}

console.log('getActionLog (fail-soft):');
{
  _resetMock();
  _route(
    (url) => url === 'http://test.local/api/actions/act_1_xyz',
    () => ({ body: { action_id: 'act_1_xyz', status: 'success' } }),
  );
  const r = await getActionLog('act_1_xyz');
  eq(r.ok, true, 'log entry returned');
  eq(r.json.status, 'success', 'status field present');
}

console.log('newActionId:');
{
  const id = newActionId();
  if (!/^act_[A-Za-z0-9_]+$/.test(id)) {
    console.error(`FAIL: newActionId did not match regex: ${id}`);
    process.exit(1);
  }
  console.log(`  ok: schema-conformant (${id})`);
  const tagged = newActionId('inv');
  if (!tagged.endsWith('_inv')) {
    console.error(`FAIL: tag not honored: ${tagged}`);
    process.exit(1);
  }
  console.log('  ok: tag honored');
}

console.log('\nALL OK');
