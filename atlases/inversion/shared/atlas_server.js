// shared/atlas_server.js
//
// Local atlas server HTTP client. Talks to the per-user localhost
// server that hosts the workspace files + compute endpoints. The
// URL persists in localStorage so the user can point at a different
// port across sessions.
//
// This is the foundation that SPEC_v2's Registry.write builds on:
//   - read(path) → GET /file/<path>
//   - write(path, data) → POST /file/<path>
//   - compute(name, args) → POST /compute/<name>
//   - isAvailable() → GET /health (cached, short timeout)
//
// Legacy origin: lines 61484-61633 of legacy/Inversion_atlas.html
// (the `atlasServer` singleton object + its _initUrl / setUrl /
// isAvailable / read / write / compute methods).
//
// Transformations from legacy:
//   - The legacy singleton stays a singleton (a single localhost server
//     per browser tab). Extracted as a frozen `atlasServer` factory in
//     a default export so tests can construct an isolated instance.
//   - `_initUrl` is called once at module load time as before so the
//     persisted URL is restored without an explicit caller.
//   - localStorage access is headless-tolerant (typeof guard) so the
//     module imports cleanly into tests.

// =====================================================================
// Constants
// =====================================================================

export const ATLAS_SERVER_DEFAULT_URL = 'http://localhost:8765';
export const ATLAS_SERVER_HEALTH_PATH = '/health';
export const ATLAS_SERVER_LS_KEY      = 'inversion_atlas.serverUrl';
export const ATLAS_SERVER_TIMEOUT_MS  = 1500;

// =====================================================================
// Headless-tolerant localStorage helpers
// =====================================================================

function _hasLocalStorage() {
  return typeof localStorage !== 'undefined' && localStorage;
}

// =====================================================================
// Factory — returns a fresh atlasServer instance.
// The default export at the bottom is one such instance (legacy singleton).
// Tests can call `makeAtlasServer()` for an isolated instance.
// =====================================================================

/**
 * @returns {AtlasServer}
 */
export function makeAtlasServer() {
  const self = {
    url: ATLAS_SERVER_DEFAULT_URL,
    /** 'unknown' | 'available' | 'unavailable' */
    status: 'unknown',
    lastChecked: 0,
    cacheLifetimeMs: 30_000,
    /** Last /health response body (parsed JSON), or null. */
    lastHealthBody: null,

    /** Restore url from localStorage. */
    _initUrl() {
      if (!_hasLocalStorage()) return;
      try {
        const saved = localStorage.getItem(ATLAS_SERVER_LS_KEY);
        if (saved) self.url = saved;
      } catch (_) { /* fail-soft */ }
    },

    /**
     * Set + persist a new server URL. Resets status to 'unknown' so
     * the next isAvailable() call re-probes.
     */
    setUrl(u) {
      self.url = u || ATLAS_SERVER_DEFAULT_URL;
      self.status = 'unknown';
      self.lastChecked = 0;
      self.lastHealthBody = null;
      if (_hasLocalStorage()) {
        try { localStorage.setItem(ATLAS_SERVER_LS_KEY, self.url); }
        catch (_) { /* fail-soft */ }
      }
    },

    /**
     * 'server' if we last knew the server was up, 'view' otherwise.
     * Does NOT do a network roundtrip; that's what isAvailable() is for.
     */
    get mode() {
      return (self.status === 'available') ? 'server' : 'view';
    },

    /**
     * Health check with a short timeout. Caches the result for
     * cacheLifetimeMs to avoid hammering the server on every render
     * frame. Pass forceRefresh=true to bypass the cache.
     * Returns Promise<boolean>.
     */
    async isAvailable(forceRefresh) {
      const now = Date.now();
      if (!forceRefresh
          && self.status !== 'unknown'
          && (now - self.lastChecked) < self.cacheLifetimeMs) {
        return self.status === 'available';
      }
      let ok = false;
      try {
        const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), ATLAS_SERVER_TIMEOUT_MS) : null;
        const resp = await fetch(self.url + ATLAS_SERVER_HEALTH_PATH, {
          method: 'GET',
          signal: ctrl ? ctrl.signal : undefined,
          cache: 'no-store',
        });
        if (timer) clearTimeout(timer);
        ok = !!resp && (resp.ok || resp.status === 0);
        if (ok) {
          try {
            self.lastHealthBody = await resp.json();
          } catch (_) {
            self.lastHealthBody = null;
          }
        } else {
          self.lastHealthBody = null;
        }
      } catch (_) {
        ok = false;
        self.lastHealthBody = null;
      }
      self.status = ok ? 'available' : 'unavailable';
      self.lastChecked = now;
      return ok;
    },

    /**
     * GET a file from the server. `path` is project-relative.
     * Returns Promise<{ok, status, text?, json?, error?}>.
     * Decodes response as JSON when opts.as === 'json' OR the
     * response Content-Type contains 'application/json'.
     */
    async read(path, opts) {
      if (!path) return { ok: false, status: 0, error: 'no path' };
      try {
        const resp = await fetch(self.url + '/file/' + encodeURI(path), {
          method: 'GET',
          cache: 'no-store',
        });
        const out = { ok: resp.ok, status: resp.status };
        if (!resp.ok) return out;
        const ct = resp.headers && resp.headers.get && resp.headers.get('content-type');
        if ((opts && opts.as === 'json') || (ct && ct.indexOf('application/json') >= 0)) {
          out.json = await resp.json();
        } else {
          out.text = await resp.text();
        }
        return out;
      } catch (e) {
        return { ok: false, status: 0, error: (e && e.message) || String(e) };
      }
    },

    /**
     * POST data to a project-relative path. String data → text/plain;
     * object data → application/json (auto-stringified).
     * Returns Promise<{ok, status, error?}>.
     */
    async write(path, data) {
      if (!path) return { ok: false, status: 0, error: 'no path' };
      try {
        let body, contentType;
        if (typeof data === 'string') {
          body = data; contentType = 'text/plain';
        } else {
          body = JSON.stringify(data); contentType = 'application/json';
        }
        const resp = await fetch(self.url + '/file/' + encodeURI(path), {
          method: 'POST',
          headers: { 'Content-Type': contentType },
          body,
        });
        return { ok: resp.ok, status: resp.status };
      } catch (e) {
        return { ok: false, status: 0, error: (e && e.message) || String(e) };
      }
    },

    /**
     * POST a compute request. The server knows how to run named
     * computes (e.g. 'contingency_matrix', 'inheritance_full');
     * args is the payload. Returns Promise<{ok, status, json?, text?, error?}>.
     */
    async compute(name, args) {
      if (!name) return { ok: false, status: 0, error: 'no compute name' };
      try {
        const resp = await fetch(self.url + '/compute/' + encodeURI(name), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args || {}),
        });
        const out = { ok: resp.ok, status: resp.status };
        if (resp.ok) {
          try { out.json = await resp.json(); } catch (_) { out.text = await resp.text(); }
        }
        return out;
      } catch (e) {
        return { ok: false, status: 0, error: (e && e.message) || String(e) };
      }
    },
  };
  return self;
}

// =====================================================================
// Singleton (legacy `atlasServer`) — one per browser tab.
// =====================================================================

/** Default singleton. Restores url from localStorage at import time. */
export const atlasServer = makeAtlasServer();
atlasServer._initUrl();

export default atlasServer;

// =====================================================================
// Action pipeline — POST /api/actions, GET /api/actions/{id}, /api/layers
// =====================================================================
// Pages use these to consume action-pipeline outputs (fst_windows_v1
// envelopes from run_popstats, candidate_regions, etc.) without going
// through hardcoded file paths. Contract: atlas-core/toolkit_registries/
// PIPELINE_FLOW.md. Endpoints: atlas-core/server/atlas_server.py.
//
// Convention matches read/write/compute above — fail-soft
// { ok, status, json?, text?, error? } instead of throwing — so pages
// can branch uniformly on .ok across all server interactions.
//
// All methods read the active server URL from `atlasServer.url`, so
// users can `atlasServer.setUrl(...)` once and every call picks it up.

// GET /api/layers — filter the envelope index.
//   filters: { layer_type, dataset_id, stage, status, limit }
// On success: { ok:true, status:200, json:{ layers:[...], n, total } }.
export async function listLayers(filters) {
  filters = filters || {};
  const q = new URLSearchParams();
  for (const k of ['layer_type', 'dataset_id', 'stage', 'status']) {
    const v = filters[k];
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  if (filters.limit !== undefined && filters.limit !== null) {
    q.set('limit', String(Number(filters.limit) | 0));
  }
  const qs = q.toString();
  return _doGetJson(`/api/layers${qs ? '?' + qs : ''}`);
}

// GET /api/layers/{layer_id} — fetch one full envelope.
export async function getLayer(layer_id) {
  if (!layer_id) return { ok: false, status: 0, error: 'no layer_id' };
  return _doGetJson(`/api/layers/${encodeURIComponent(layer_id)}`);
}

// Convenience: most-recent envelope of `layer_type` matching the
// optional dataset_id / stage / status filters. Returns
//   { ok:true, status:200, json: null }              when no match
//   { ok:true, status:200, json: envelope }          when one is found
//   { ok:false, status, error: ... }                 on server error.
export async function resolveLatestLayer(layer_type, opts) {
  if (!layer_type) return { ok: false, status: 0, error: 'no layer_type' };
  const list = await listLayers(Object.assign({}, opts || {}, { layer_type }));
  if (!list.ok) return list;
  const rows = (list.json && list.json.layers) || [];
  if (rows.length === 0) return { ok: true, status: 200, json: null };
  return getLayer(rows[rows.length - 1].layer_id);
}

// POST /api/actions — submit an action manifest.
//   manifest: full action_manifest dict
//   opts.atlas: optional ?atlas=… (overrides manifest.atlas_id + master_config)
// On success: { ok:true, status:200, json:{ ok, action_id, atlas_id, produced_layers } }.
export async function submitAction(manifest, opts) {
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, status: 0, error: 'manifest object required' };
  }
  const atlas = (opts && opts.atlas) || null;
  const q = atlas ? `?atlas=${encodeURIComponent(atlas)}` : '';
  try {
    const resp = await fetch(atlasServer.url + `/api/actions${q}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest),
    });
    const out = { ok: resp.ok, status: resp.status };
    if (resp.ok) { try { out.json = await resp.json(); } catch (_) { out.text = await resp.text(); } }
    else { try { out.error = await resp.text(); } catch (_) { out.error = `HTTP ${resp.status}`; } }
    return out;
  } catch (e) {
    return { ok: false, status: 0, error: (e && e.message) || String(e) };
  }
}

// GET /api/actions/{action_id} — latest log entry.
export async function getActionLog(action_id) {
  if (!action_id) return { ok: false, status: 0, error: 'no action_id' };
  return _doGetJson(`/api/actions/${encodeURIComponent(action_id)}`);
}

// Generate an action_id matching ^act_[A-Za-z0-9_]+$.
export function newActionId(tag) {
  const ms = Date.now();
  const tail = tag || Math.random().toString(36).slice(2, 5).padEnd(3, '0');
  return `act_${ms}_${tail}`;
}

// Internal: GET a JSON path, return the same shape read/write/compute use.
async function _doGetJson(path) {
  try {
    const resp = await fetch(atlasServer.url + path, {
      method: 'GET',
      cache: 'no-store',
    });
    const out = { ok: resp.ok, status: resp.status };
    if (resp.ok) { try { out.json = await resp.json(); } catch (_) { out.text = await resp.text(); } }
    else { try { out.error = await resp.text(); } catch (_) { out.error = `HTTP ${resp.status}`; } }
    return out;
  } catch (e) {
    return { ok: false, status: 0, error: (e && e.message) || String(e) };
  }
}
