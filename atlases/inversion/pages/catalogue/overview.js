// inversion_catalogue/overview.js
// =====================================================================
// Page "Overview" — synthesis-stage tab, declared but empty in legacy.
//
// Legacy state (Inversion_atlas.html line 9322):
//     <div id="overview" class="page"></div>
//
// The tab button exists at legacy line 5138 (data-page="overview"
// data-stage="synthesis") but no body and no render function were ever
// shipped. There are zero references to `renderOverview`, `renderPage_overview`,
// or `overview` in any JS scope of the legacy file — verified by
// `grep -niE "(renderOverview|overview|renderPageOverview)"`,
// which only returns the tab button and the empty <div>.
//
// This module exists so the page registry has a non-throwing entry for
// `overview`. If/when the synthesis overview gets designed, replace
// the body of renderPageOverview() with the real render logic and update
// overview.html with the panel skeleton.
//
// Round 5 step 8 (chat 36, 2026-05-07): refactored from chat-33 factory-
// only pattern (`wirePageOverview(state) → { renderPageOverview }`) to
// add the standard atlas-router lifecycle (mount/unmount/_pageState
// live-binding). The factory is RETAINED for backward-compat — anything
// that was importing wirePageOverview keeps working.
// =====================================================================

import { _pageState, _setActiveState } from './overview/_state.js';
import { listLayers } from '../../shared/atlas_server.js';

/**
 * Internal: render the synthesis overview using _pageState.
 *
 * Round-1 implementation (2026-05-14): the legacy "layer-presence
 * checklist" — answers "what action-pipeline data has been captured in
 * this workspace?" Asynchronously fetches GET /api/layers (atlas-core's
 * envelope index), groups by layer_type, and renders a compact table
 * inside #invLayerInventory.
 *
 * The HTML container shows "Querying …" until the probe resolves; on
 * error (server offline, 5xx, etc.) it shows a fail-soft message but
 * leaves the page navigable.
 */
function _renderPageOverview() {
  // Fire-and-forget — the page is rendered synchronously by the router;
  // the inventory populates as soon as the index loads.
  _populateLayerInventory()
    .catch((e) => console.warn('overview: _populateLayerInventory threw —', e));
}

// ---------------------------------------------------------------------------
// Layer-inventory rendering (envelope-aware, fail-soft).
// ---------------------------------------------------------------------------
// listLayers() returns the inversion-atlas fail-soft shape
//   { ok, status, json?: { layers, n, total }, text?, error? }
// (see shared/atlas_server.js for the convention — different from the
// throwing-pattern used in the four other atlases). The renderer
// branches on .ok and surfaces .error in the empty-state message.

async function _populateLayerInventory() {
  const slot = (typeof document !== 'undefined')
    ? document.getElementById('invLayerInventory') : null;
  if (!slot) return;   // overview HTML hasn't loaded

  let resp;
  try {
    // No filter — we want the whole index so we can group by layer_type.
    // limit=500 is the server-side default; bump if you have a workspace
    // with more registered envelopes.
    resp = await listLayers({ limit: 500 });
  } catch (e) {
    slot.innerHTML =
      `<span style="color: #b00;">Failed to query /api/layers: ${_escape(String(e))}</span>`;
    return;
  }

  if (!resp.ok) {
    if (resp.status === 503) {
      slot.innerHTML =
        '<span class="ov-hint">' +
        'Action pipeline subsystem not configured (no workspace root). ' +
        'Start atlas_server.py with <code>--workspace-root</code> to enable.</span>';
    } else {
      slot.innerHTML =
        `<span class="ov-error">/api/layers returned HTTP ${resp.status}: ` +
        `${_escape((resp.error || '').slice(0, 200))}</span>`;
    }
    return;
  }

  const rows = (resp.json && resp.json.layers) || [];
  const total = (resp.json && resp.json.total) || rows.length;
  if (rows.length === 0) {
    slot.innerHTML =
      '<span class="ov-hint">' +
      '◌  No layer envelopes captured yet. Submit an action via ' +
      '<code>POST /api/actions</code> or <code>scripts/atlas_action.py</code> ' +
      'to populate the inventory.</span>';
    return;
  }

  // Group rows by layer_type; remember the most-recent row per group.
  const groups = new Map();   // layer_type → { count, latest_row }
  for (const r of rows) {
    const t = r.layer_type || '(no type)';
    const g = groups.get(t) || { count: 0, latest: null };
    g.count += 1;
    if (!g.latest || (r.created_at || '') > (g.latest.created_at || '')) {
      g.latest = r;
    }
    groups.set(t, g);
  }

  const sortedTypes = Array.from(groups.keys()).sort();
  let html =
    `<div class="ov-summary">` +
    `<b>${total}</b> envelope${total === 1 ? '' : 's'} across ` +
    `<b>${sortedTypes.length}</b> layer type${sortedTypes.length === 1 ? '' : 's'}.` +
    `</div>` +
    `<table class="ov-table">` +
    `<thead><tr>` +
    `<th>layer_type</th>` +
    `<th class="ov-right">count</th>` +
    `<th>latest</th>` +
    `<th>created</th>` +
    `</tr></thead><tbody>`;
  for (const t of sortedTypes) {
    const g = groups.get(t);
    html +=
      `<tr>` +
      `<td><code>${_escape(t)}</code></td>` +
      `<td class="ov-right">${g.count}</td>` +
      `<td><code>${_escape(g.latest.layer_id || '')}</code></td>` +
      `<td class="ov-dim">${_escape(g.latest.created_at || '')}</td>` +
      `</tr>`;
  }
  html += `</tbody></table>`;
  slot.innerHTML = html;
}

function _escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Public entry — state-aware wrapper. Sets _pageState before delegating
 * so the (currently-empty) renderer sees live data.
 */
export function renderPageOverview(state) {
  if (state) _setActiveState(state);
  return _renderPageOverview();
}

/**
 * Backward-compat factory (legacy chat-33 surface). Retained so anything
 * importing `wirePageOverview` keeps working. The returned closure
 * shares state with the module-level _pageState via _setActiveState,
 * so the new lifecycle and the old factory both see the same data.
 */
export function wirePageOverview(state) {
  if (state) _setActiveState(state);
  return { renderPageOverview: _renderPageOverview };
}

export default wirePageOverview;

// ---------------------------------------------------------------------------
// Atlas-router lifecycle (chat 36 round 5 step 8, 2026-05-07).
// ---------------------------------------------------------------------------

/**
 * Mount: called by atlas_router when the user navigates to overview.
 *
 * Builds a legacy-shape state (currently a passthrough — overview
 * declares no requires_layers / requires_slots in pages.registry.json,
 * so there's nothing chrom-specific to wire). The mount is structured
 * the same as sibling pages so the future overview implementation can
 * read from atlasState.inversion + atlasState.shared without a
 * separate refactor.
 */
export async function mount(root, atlasState, registry) {
  const legacyState = _buildLegacyState(atlasState);
  _setActiveState(legacyState);

  try { renderPageOverview(legacyState); }
  catch (e) { console.warn('overview.mount: renderPageOverview threw —', e); }

  if (atlasState.inversion) atlasState.inversion._pageOverviewState = legacyState;
}

/**
 * Unmount: clear _pageState so post-unmount callbacks see null.
 */
export async function unmount(root) {
  _setActiveState(null);
}

function _buildLegacyState(atlasState) {
  const inv = atlasState.inversion || {};
  // Pass-through: overview reads no specific state slots in the
  // current empty-stub implementation. When the real overview lands,
  // it'll likely want candidateList + layersPresent + ancestry-related
  // slots — those flow through Object.assign({}, inv) below.
  return Object.assign({}, inv);
}
