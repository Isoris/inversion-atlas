// tests/test_shared_atlas_server.js
//
// Unit tests for atlases/inversion/shared/atlas_server.js — the local
// atlas server HTTP client. Mocks globalThis.fetch (Node 18+ has native
// fetch but no server to talk to) so each HTTP method can be exercised
// without spinning up a real server.

class MockLS {
  constructor() { this.store = new Map(); }
  setItem(k, v) { this.store.set(String(k), String(v)); }
  getItem(k) { const v = this.store.get(String(k)); return v == null ? null : v; }
  removeItem(k) { this.store.delete(String(k)); }
  clear() { this.store.clear(); }
  get length() { return this.store.size; }
  key(i) { const keys = Array.from(this.store.keys()); return i < keys.length ? keys[i] : null; }
}
globalThis.localStorage = new MockLS();

// --- Mock fetch ------------------------------------------------------
// `fetchHandler` is a function that takes (url, opts) and returns a
// promise of a Response-like object: { ok, status, headers, json(), text() }.
// Each test sets fetchHandler then calls the method under test.
let fetchHandler = null;
let lastFetch = null;

globalThis.fetch = (url, opts) => {
  lastFetch = { url, opts };
  if (!fetchHandler) return Promise.reject(new Error('no fetchHandler set'));
  return Promise.resolve(fetchHandler(url, opts));
};

function makeResp({ ok = true, status = 200, json, text, contentType }) {
  return {
    ok, status,
    headers: {
      get(name) {
        if (name.toLowerCase() === 'content-type') return contentType || null;
        return null;
      },
    },
    json: () => Promise.resolve(json),
    text: () => Promise.resolve(text || ''),
  };
}

const {
  ATLAS_SERVER_DEFAULT_URL,
  ATLAS_SERVER_HEALTH_PATH,
  ATLAS_SERVER_LS_KEY,
  ATLAS_SERVER_TIMEOUT_MS,
  makeAtlasServer,
  atlasServer,
} = await import('../atlases/inversion/shared/atlas_server.js');

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('constants');
check('DEFAULT_URL = localhost:8765',          ATLAS_SERVER_DEFAULT_URL === 'http://localhost:8765');
check('HEALTH_PATH = /health',                 ATLAS_SERVER_HEALTH_PATH === '/health');
check('LS_KEY matches legacy',                 ATLAS_SERVER_LS_KEY === 'inversion_atlas.serverUrl');
check('TIMEOUT_MS = 1500',                     ATLAS_SERVER_TIMEOUT_MS === 1500);

// =====================================================================
group('factory + singleton');
check('default singleton url = default',       atlasServer.url === ATLAS_SERVER_DEFAULT_URL);
check('default singleton status unknown',      atlasServer.status === 'unknown');
check('default singleton mode = view',         atlasServer.mode === 'view');
{
  const s = makeAtlasServer();
  check('factory produces fresh instance',     s !== atlasServer);
  check('factory url defaults',                s.url === ATLAS_SERVER_DEFAULT_URL);
}

// =====================================================================
group('setUrl + _initUrl + LS persistence');
{
  globalThis.localStorage.clear();
  const s = makeAtlasServer();
  s.setUrl('http://localhost:9999');
  check('setUrl: url updated',                  s.url === 'http://localhost:9999');
  check('setUrl: status reset to unknown',      s.status === 'unknown');
  check('setUrl: persists to LS',
        globalThis.localStorage.getItem(ATLAS_SERVER_LS_KEY) === 'http://localhost:9999');

  // _initUrl reads from LS
  const s2 = makeAtlasServer();
  s2._initUrl();
  check('_initUrl restores from LS',            s2.url === 'http://localhost:9999');

  // setUrl with null/empty → default
  s.setUrl(null);
  check('setUrl(null) → default url',           s.url === ATLAS_SERVER_DEFAULT_URL);
  s.setUrl('');
  check('setUrl("") → default url',             s.url === ATLAS_SERVER_DEFAULT_URL);
}
{
  // _initUrl when LS empty → keeps default
  globalThis.localStorage.clear();
  const s = makeAtlasServer();
  s._initUrl();
  check('_initUrl no LS: keeps default',        s.url === ATLAS_SERVER_DEFAULT_URL);
}

// =====================================================================
group('mode getter');
{
  const s = makeAtlasServer();
  s.status = 'available';
  check('available → server',                   s.mode === 'server');
  s.status = 'unavailable';
  check('unavailable → view',                   s.mode === 'view');
  s.status = 'unknown';
  check('unknown → view',                       s.mode === 'view');
}

// =====================================================================
group('isAvailable');
{
  const s = makeAtlasServer();
  fetchHandler = (url, opts) => {
    if (url.endsWith('/health')) return makeResp({ ok: true, json: { server: 'ok', subsystems: { popstats: { ready: true } } } });
    return makeResp({ ok: false, status: 404 });
  };
  // First call: status was 'unknown', so it always queries.
  const r = await s.isAvailable();
  check('isAvailable → true on 200',            r === true);
  check('status set to available',              s.status === 'available');
  check('mode flips to server',                 s.mode === 'server');
  check('lastHealthBody captured',
        s.lastHealthBody && s.lastHealthBody.server === 'ok');
  check('lastChecked updated',                  s.lastChecked > 0);
  check('fetched /health',                      lastFetch.url === s.url + '/health');
}
{
  // Cache hit: second call within cacheLifetimeMs short-circuits
  const s = makeAtlasServer();
  s.status = 'available';
  s.lastChecked = Date.now();
  let fetched = false;
  fetchHandler = (url, opts) => { fetched = true; return makeResp({ ok: true, json: {} }); };
  const r = await s.isAvailable();
  check('cache hit: returns cached true',       r === true);
  check('cache hit: no fetch',                  fetched === false);
}
{
  // forceRefresh bypasses cache
  const s = makeAtlasServer();
  s.status = 'available';
  s.lastChecked = Date.now();
  let fetched = false;
  fetchHandler = (url, opts) => { fetched = true; return makeResp({ ok: true, json: {} }); };
  await s.isAvailable(true);
  check('forceRefresh: bypasses cache',         fetched === true);
}
{
  // 200 with non-JSON body → ok but lastHealthBody = null
  const s = makeAtlasServer();
  fetchHandler = (url, opts) => makeResp({ ok: true, status: 200, json: undefined, text: 'not json' });
  // Mock json() to throw to simulate non-JSON response
  const respBuilder = (url, opts) => {
    const r = makeResp({ ok: true, status: 200 });
    r.json = () => Promise.reject(new Error('not json'));
    return r;
  };
  fetchHandler = respBuilder;
  const r = await s.isAvailable();
  check('non-JSON body: still ok',              r === true);
  check('non-JSON body: lastHealthBody null',   s.lastHealthBody === null);
}
{
  // 5xx → unavailable
  const s = makeAtlasServer();
  fetchHandler = (url, opts) => makeResp({ ok: false, status: 503 });
  const r = await s.isAvailable();
  check('5xx → false',                          r === false);
  check('5xx → status unavailable',             s.status === 'unavailable');
  check('5xx → mode view',                      s.mode === 'view');
}
{
  // fetch throws → unavailable
  const s = makeAtlasServer();
  fetchHandler = (url, opts) => { throw new Error('network down'); };
  const r = await s.isAvailable();
  check('fetch throw → false',                  r === false);
  check('fetch throw → status unavailable',     s.status === 'unavailable');
  check('fetch throw → lastHealthBody null',    s.lastHealthBody === null);
}

// =====================================================================
group('read');
{
  const s = makeAtlasServer();
  // JSON content-type
  fetchHandler = (url, opts) => makeResp({
    ok: true, status: 200, json: { hello: 'world' },
    contentType: 'application/json',
  });
  const r = await s.read('/data/foo.json');
  check('200 + JSON: ok',                        r.ok === true);
  check('200 + JSON: status 200',                r.status === 200);
  check('200 + JSON: json.hello',                r.json.hello === 'world');
  check('encoded path in URL',                   lastFetch.url.endsWith('/file/' + encodeURI('/data/foo.json')));
}
{
  // text fallback (no json content-type)
  const s = makeAtlasServer();
  fetchHandler = (url, opts) => makeResp({
    ok: true, status: 200, text: 'hello text',
    contentType: 'text/plain',
  });
  const r = await s.read('/data/foo.txt');
  check('text content-type: text returned',      r.text === 'hello text');
  check('text content-type: no json',            r.json === undefined);
}
{
  // opts.as='json' forces JSON decode
  const s = makeAtlasServer();
  fetchHandler = (url, opts) => makeResp({
    ok: true, status: 200, json: { forced: true },
    contentType: 'text/plain',   // server lied about CT
  });
  const r = await s.read('/data/foo', { as: 'json' });
  check('opts.as=json forces JSON decode',       r.json.forced === true);
}
{
  // 404 → ok=false, no body
  const s = makeAtlasServer();
  fetchHandler = (url, opts) => makeResp({ ok: false, status: 404 });
  const r = await s.read('/missing');
  check('404: ok=false',                         r.ok === false);
  check('404: status 404',                       r.status === 404);
}
{
  // fetch throws → error in response
  const s = makeAtlasServer();
  fetchHandler = (url, opts) => { throw new Error('boom'); };
  const r = await s.read('/foo');
  check('fetch throw: ok=false',                 r.ok === false);
  check('fetch throw: error captured',           r.error === 'boom');
}
{
  // no path → error
  const s = makeAtlasServer();
  const r = await s.read('');
  check('empty path → ok=false',                 r.ok === false);
  check('empty path → "no path" error',          r.error === 'no path');
}

// =====================================================================
group('write');
{
  const s = makeAtlasServer();
  fetchHandler = (url, opts) => makeResp({ ok: true, status: 201 });
  const r = await s.write('/data/out.json', { a: 1 });
  check('write object: ok',                      r.ok === true);
  check('write object: status 201',              r.status === 201);
  check('POST method',                           lastFetch.opts.method === 'POST');
  check('object → application/json',             lastFetch.opts.headers['Content-Type'] === 'application/json');
  check('object body stringified',               lastFetch.opts.body === '{"a":1}');
}
{
  const s = makeAtlasServer();
  fetchHandler = (url, opts) => makeResp({ ok: true, status: 200 });
  await s.write('/data/note.txt', 'raw string');
  check('string body → text/plain',              lastFetch.opts.headers['Content-Type'] === 'text/plain');
  check('string body unchanged',                 lastFetch.opts.body === 'raw string');
}
{
  const s = makeAtlasServer();
  fetchHandler = (url, opts) => { throw new Error('refused'); };
  const r = await s.write('/data/foo', {});
  check('fetch throw: ok=false',                 r.ok === false);
  check('fetch throw: error captured',           r.error === 'refused');
}
{
  const s = makeAtlasServer();
  const r = await s.write('', {});
  check('empty path → "no path" error',          r.error === 'no path');
}

// =====================================================================
group('compute');
{
  const s = makeAtlasServer();
  fetchHandler = (url, opts) => makeResp({
    ok: true, status: 200, json: { result: 42 },
  });
  const r = await s.compute('inheritance_full', { candidate_id: 'c1' });
  check('compute: ok',                           r.ok === true);
  check('compute: json result',                  r.json.result === 42);
  check('URL contains /compute/<name>',
        lastFetch.url.endsWith('/compute/' + encodeURI('inheritance_full')));
  check('args serialized as JSON',
        lastFetch.opts.body === '{"candidate_id":"c1"}');
  check('compute is POST',                       lastFetch.opts.method === 'POST');
}
{
  // 200 with non-JSON → text path
  const s = makeAtlasServer();
  const respBuilder = (url, opts) => {
    const r = makeResp({ ok: true, status: 200, text: 'OK' });
    r.json = () => Promise.reject(new Error('not json'));
    return r;
  };
  fetchHandler = respBuilder;
  const r = await s.compute('noop', {});
  check('compute non-JSON: text path',           r.text === 'OK');
}
{
  // No name → error
  const s = makeAtlasServer();
  const r = await s.compute('');
  check('empty name → ok=false',                 r.ok === false);
  check('empty name → "no compute name" error',  r.error === 'no compute name');
}
{
  const s = makeAtlasServer();
  fetchHandler = (url, opts) => { throw new Error('refused'); };
  const r = await s.compute('foo', {});
  check('fetch throw: ok=false',                 r.ok === false);
  check('fetch throw: error captured',           r.error === 'refused');
}
{
  // No args → defaults to {}
  const s = makeAtlasServer();
  fetchHandler = (url, opts) => makeResp({ ok: true, status: 200, json: {} });
  await s.compute('foo');
  check('compute(): defaults args to {}',        lastFetch.opts.body === '{}');
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
