// Smoke tests for inversion-atlas overview.js's layer-inventory
// rendering. This is the FIRST inversion-atlas migration, and it uses
// the inversion-side fail-soft return shape ({ok, status, json|text,
// error?}) rather than the throwing pattern used in the four sibling
// atlas tests. The assertions pin both the happy path AND the failure
// paths' error-message rendering, since fail-soft means errors land in
// the DOM rather than in a catch().
//
// Run from inversion-atlas root:
//   node tests/test_catalogue_overview_inventory.js
import { atlasServer, listLayers } from '../atlases/inversion/shared/atlas_server.js';

// Point the singleton URL at a deterministic origin.
atlasServer.setUrl('http://test.local');

// ----- fake DOM ---------------------------------------------------------
const _elements = new Map();
function _makeSlot(id) {
  const el = { id, innerHTML: '', textContent: '', title: '', className: '' };
  _elements.set(id, el);
  return el;
}
globalThis.document = {
  getElementById(id) { return _elements.get(id) || null; },
};

// ----- fetch mock -------------------------------------------------------
const _routes = [];
const _calls  = [];
function _route(p, fn) { _routes.push({ p, fn }); }
function _reset()      { _routes.length = 0; _calls.length = 0; _elements.clear(); }
globalThis.fetch = async (url, init) => {
  _calls.push({ url, init });
  for (const r of _routes) if (r.p(url, init)) return _make(await r.fn(url, init));
  return _make({ status: 404, body: { error: 'no route', url } });
};
function _make({ status = 200, body = null, text = null } = {}) {
  const ok = status >= 200 && status < 300;
  const t = text ?? (body == null ? '' : JSON.stringify(body));
  return {
    ok, status,
    headers: { get: () => 'application/json' },
    async json() { return body != null ? body : JSON.parse(t); },
    async text() { return t; },
  };
}
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error(`FAIL: ${msg}\n  expected: ${JSON.stringify(b)}\n  got: ${JSON.stringify(a)}`);
    process.exit(1);
  }
  console.log(`  ok: ${msg}`);
}

// ----- mirror overview.js helpers (byte-equivalent) ----------------

async function _populateLayerInventory() {
  const slot = document.getElementById('invLayerInventory');
  if (!slot) return;
  let resp;
  try { resp = await listLayers({ limit: 500 }); }
  catch (e) {
    slot.innerHTML = `<span style="color: #b00;">Failed to query /api/layers: ${_escape(String(e))}</span>`;
    return;
  }
  if (!resp.ok) {
    if (resp.status === 503) {
      slot.innerHTML = '<span style="color: #888; font-style: italic;">Action pipeline subsystem not configured (no workspace root). Start atlas_server.py with <code>--workspace-root</code> to enable.</span>';
    } else {
      slot.innerHTML = `<span style="color: #b00;">/api/layers returned HTTP ${resp.status}: ${_escape((resp.error || '').slice(0, 200))}</span>`;
    }
    return;
  }
  const rows = (resp.json && resp.json.layers) || [];
  const total = (resp.json && resp.json.total) || rows.length;
  if (rows.length === 0) {
    slot.innerHTML = '<span style="color: #888; font-style: italic;">◌  No layer envelopes captured yet. Submit an action via <code>POST /api/actions</code> or <code>scripts/atlas_action.py</code> to populate the inventory.</span>';
    return;
  }
  const groups = new Map();
  for (const r of rows) {
    const t = r.layer_type || '(no type)';
    const g = groups.get(t) || { count: 0, latest: null };
    g.count += 1;
    if (!g.latest || (r.created_at || '') > (g.latest.created_at || '')) g.latest = r;
    groups.set(t, g);
  }
  const sortedTypes = Array.from(groups.keys()).sort();
  let html = `<div style="margin-bottom: 8px; color: #666;"><b>${total}</b> envelope${total === 1 ? '' : 's'} across <b>${sortedTypes.length}</b> layer type${sortedTypes.length === 1 ? '' : 's'}.</div><table><thead><tr><th>layer_type</th><th>count</th><th>latest</th><th>created</th></tr></thead><tbody>`;
  for (const t of sortedTypes) {
    const g = groups.get(t);
    html += `<tr><td><code>${_escape(t)}</code></td><td>${g.count}</td><td><code>${_escape(g.latest.layer_id || '')}</code></td><td>${_escape(g.latest.created_at || '')}</td></tr>`;
  }
  html += `</tbody></table>`;
  slot.innerHTML = html;
}

function _escape(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ----- tests ------------------------------------------------------------

console.log('happy path: 5 envelopes across 3 layer types:');
{
  _reset();
  _makeSlot('invLayerInventory');
  _route(
    (url) => url.startsWith('http://test.local/api/layers'),
    () => ({ body: {
      layers: [
        { layer_id: 'fst_windows_main_226_hatchery_LG28_a', layer_type: 'fst_windows', created_at: '2026-05-14T15:00:00Z' },
        { layer_id: 'fst_windows_main_226_hatchery_LG28_b', layer_type: 'fst_windows', created_at: '2026-05-14T16:30:00Z' },
        { layer_id: 'fst_windows_main_226_hatchery_LG28_c', layer_type: 'fst_windows', created_at: '2026-05-13T10:00:00Z' },
        { layer_id: 'candidate_regions_main_226_hatchery_x', layer_type: 'candidate_regions', created_at: '2026-05-14T17:00:00Z' },
        { layer_id: 'staging_inversion_candidate_y', layer_type: 'inversion_candidate', created_at: '2026-05-14T17:30:00Z' },
      ],
      n: 5, total: 5,
    } }),
  );
  await _populateLayerInventory();
  const slot = document.getElementById('invLayerInventory');
  if (!slot.innerHTML.includes('<b>5</b> envelopes')) {
    console.error(`FAIL: should show "5 envelopes", got: ${slot.innerHTML.slice(0, 200)}`);
    process.exit(1);
  }
  console.log('  ok: total count rendered');
  if (!slot.innerHTML.includes('<b>3</b> layer types')) {
    console.error(`FAIL: should show "3 layer types", got: ${slot.innerHTML.slice(0, 200)}`);
    process.exit(1);
  }
  console.log('  ok: layer-type count rendered');
  // Latest per layer_type — fst_windows_main_226_hatchery_LG28_b (the 16:30 one) wins for fst_windows
  if (!slot.innerHTML.includes('fst_windows_main_226_hatchery_LG28_b')) {
    console.error(`FAIL: should show newer fst_windows envelope as latest, got: ${slot.innerHTML.slice(0, 300)}`);
    process.exit(1);
  }
  console.log('  ok: most-recent fst_windows envelope shown as latest');
  if (!slot.innerHTML.includes('<code>fst_windows</code>')) {
    console.error(`FAIL: layer_type cell missing for fst_windows`);
    process.exit(1);
  }
  console.log('  ok: layer_type cells rendered');
}

console.log('empty index → friendly empty state:');
{
  _reset();
  _makeSlot('invLayerInventory');
  _route(() => true, () => ({ body: { layers: [], n: 0, total: 0 } }));
  await _populateLayerInventory();
  const slot = document.getElementById('invLayerInventory');
  if (!slot.innerHTML.includes('No layer envelopes captured yet')) {
    console.error(`FAIL: empty state should explain emptiness: ${slot.innerHTML.slice(0, 300)}`);
    process.exit(1);
  }
  console.log('  ok: empty-state message');
  if (!slot.innerHTML.includes('atlas_action.py')) {
    console.error(`FAIL: empty state should mention the CLI: ${slot.innerHTML.slice(0, 300)}`);
    process.exit(1);
  }
  console.log('  ok: empty-state CTA mentions the CLI');
}

console.log('503 unconfigured subsystem → guidance about --workspace-root:');
{
  _reset();
  _makeSlot('invLayerInventory');
  _route(() => true, () => ({ status: 503, text: 'no workspace root' }));
  await _populateLayerInventory();
  const slot = document.getElementById('invLayerInventory');
  if (!slot.innerHTML.includes('Action pipeline subsystem not configured')) {
    console.error(`FAIL: 503 should explain subsystem unconfigured: ${slot.innerHTML.slice(0, 300)}`);
    process.exit(1);
  }
  console.log('  ok: 503 produces "subsystem not configured" message');
  if (!slot.innerHTML.includes('--workspace-root')) {
    console.error(`FAIL: 503 message should hint at --workspace-root: ${slot.innerHTML.slice(0, 300)}`);
    process.exit(1);
  }
  console.log('  ok: 503 message mentions --workspace-root');
}

console.log('other non-2xx → surfaces status code + body:');
{
  _reset();
  _makeSlot('invLayerInventory');
  _route(() => true, () => ({ status: 500, text: 'engine exploded' }));
  await _populateLayerInventory();
  const slot = document.getElementById('invLayerInventory');
  if (!slot.innerHTML.includes('HTTP 500')) {
    console.error(`FAIL: should mention HTTP 500: ${slot.innerHTML.slice(0, 300)}`);
    process.exit(1);
  }
  console.log('  ok: 5xx surfaces status code');
  if (!slot.innerHTML.includes('engine exploded')) {
    console.error(`FAIL: should surface body: ${slot.innerHTML.slice(0, 300)}`);
    process.exit(1);
  }
  console.log('  ok: error body surfaced (up to 200 chars)');
}

console.log('single layer type, count of 1 → singular grammar:');
{
  _reset();
  _makeSlot('invLayerInventory');
  _route(() => true, () => ({ body: {
    layers: [{ layer_id: 'L1', layer_type: 'fst_windows', created_at: '2026-05-14T00:00:00Z' }],
    n: 1, total: 1,
  } }));
  await _populateLayerInventory();
  const slot = document.getElementById('invLayerInventory');
  if (!slot.innerHTML.includes('<b>1</b> envelope across')) {
    console.error(`FAIL: should use singular "envelope": ${slot.innerHTML.slice(0, 200)}`);
    process.exit(1);
  }
  console.log('  ok: singular "envelope" for count=1');
  if (!slot.innerHTML.includes('<b>1</b> layer type.')) {
    console.error(`FAIL: should use singular "layer type": ${slot.innerHTML.slice(0, 200)}`);
    process.exit(1);
  }
  console.log('  ok: singular "layer type" for one type');
}

console.log('HTML escaping in layer_id:');
{
  _reset();
  _makeSlot('invLayerInventory');
  // A malicious layer_id can never actually happen (the schema regex
  // forbids the chars below) — but our renderer should still escape.
  _route(() => true, () => ({ body: {
    layers: [{ layer_id: 'a<b>"c"&d', layer_type: 'fst_windows', created_at: '2026' }],
    n: 1, total: 1,
  } }));
  await _populateLayerInventory();
  const slot = document.getElementById('invLayerInventory');
  if (slot.innerHTML.includes('<b>"c"&d')) {
    console.error(`FAIL: HTML escaping broken: ${slot.innerHTML.slice(0, 200)}`);
    process.exit(1);
  }
  if (!slot.innerHTML.includes('a&lt;b&gt;&quot;c&quot;&amp;d')) {
    console.error(`FAIL: expected escaped, got: ${slot.innerHTML.slice(0, 300)}`);
    process.exit(1);
  }
  console.log('  ok: < > " & escaped in layer_id');
}

console.log('missing DOM slot → no throw:');
{
  _reset();
  // Don't create #invLayerInventory.
  await _populateLayerInventory();
  console.log('  ok: missing #invLayerInventory is a no-op');
}

console.log('\nALL OK');
