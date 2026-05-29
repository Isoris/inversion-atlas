// atlases/inversion/pages/discovery/candidate_focus/_popstats_panels.js
// =============================================================================
// Activates the four pop-stats stub panels on candidate_focus:
//   #cp-theta    — θ per band (per-K-cluster nucleotide diversity)
//   #cp-het      — heterozygosity per band (per-K-cluster Hobs)
//   #cp-fst      — FST Hom1 vs Hom2 (between-arrangement, excludes het)
//   #cp-thetapi  — θπ IVGT (inverted vs standard arrangement)
//
// Each panel calls one of two pop-stats endpoints on the atlas-core server:
//   POST /api/popstats/groupwise          → FST + dXY + θπ (one call, multi-metric)
//   POST /api/popstats/hobs_groupwise     → Hobs / Hexp
//
// The server runs LOCALLY (popstats-atlas owns it via popstats-atlas/server/;
// no LANTA / HPC dependency anywhere in the flow). All four panels are
// fail-soft: a server 404 / 5xx / offline leaves the existing stub fallback
// in place, the page stays interactive.
//
// Convention: bands 0 and 2 of the K=3 local-PCA cluster map to the two
// homozygous arrangements (Hom1 / Hom2 = STD / INV in arrangement vocab);
// band 1 is the heterozygous middle. The renderer canonicalises this so
// callers don't have to know which band is which arrangement direction.
// =============================================================================

import { candidateGroupsFromLabels } from '../../../shared/candidate_groups.js';

const POPSTATS_URL = '/api/popstats/groupwise';
const HOBS_URL     = '/api/popstats/hobs_groupwise';

// Server label vocabulary for K=3 (per shared/candidate_groups.js).
// All four panels key off these names — the server returns metric values
// under exactly these keys, so any deviation breaks _extractPerGroup.
const G_HOM1 = 'H1/H1';
const G_HET  = 'H1/H2';
const G_HOM2 = 'H2/H2';

/**
 * Entry point — call after the candidate page's HTML is in the DOM.
 * Builds the group composition through the canonical shared helper
 * (so the labels match the server's vocabulary AND we don't duplicate
 * the K-means → sample-id projection that popstats.js already uses),
 * then fires the four panel fetches in parallel.
 */
export function activatePopstatsPanels(state) {
  if (typeof document === 'undefined') return;
  const c = state && state.candidate;
  if (!c) return;
  const built = candidateGroupsFromLabels(c, state && state.data, { labelStyle: 'server' });
  if (!built || !built.groups) return;
  const chrom = c.chrom || (state.data && state.data.chrom) || null;
  if (!chrom) return;
  const region = { start_bp: c.start_bp | 0, end_bp: c.end_bp | 0 };

  _activateThetaPerBand(chrom, region, built);
  _activateHetPerBand(chrom, region, built);
  _activateFstHomVsHom(chrom, region, built);
  _activateThetaPiIVGT(chrom, region, built);
}

/** Filter the canonical groups dict to a name subset, dropping empty groups. */
function _pickGroups(built, names) {
  const out = {};
  for (const n of names) {
    const arr = built.groups[n];
    if (Array.isArray(arr) && arr.length > 0) out[n] = arr;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-panel activators. Each one builds the request, POSTs, and replaces the
// panel's stub body on success. On any failure the stub is left in place.
// ---------------------------------------------------------------------------

async function _activateThetaPerBand(chrom, region, built) {
  const opts = { label: 'θ per band',
                 sublabel: 'nucleotide diversity per K-means cluster (H1/H1 · H1/H2 · H2/H2)',
                 valueFmt: _fmtSci };
  // All three groups — the per-band view wants the full K=3 split including het.
  const grpMap = _pickGroups(built, [G_HOM1, G_HET, G_HOM2]);
  if (Object.keys(grpMap).length === 0) return;
  const body = { chrom, region, groups: grpMap, metrics: ['theta_pi'] };
  const r = await _postPopstats(POPSTATS_URL, body);
  if (!r.ok) { _renderNotReady('cp-theta', opts, r); return; }
  const perGroup = _extractPerGroup(r.data, 'theta_pi');
  if (!perGroup) { _renderNotReady('cp-theta', opts,
                                   { error: 'parse', status: r.status }); return; }
  _renderPerBandBars('cp-theta', perGroup, opts);
}

async function _activateHetPerBand(chrom, region, built) {
  const opts = { label: 'heterozygosity per band',
                 sublabel: 'mean per-sample H grouped by band (H1/H1 · H1/H2 · H2/H2)',
                 valueFmt: _fmtFloat };
  const grpMap = _pickGroups(built, [G_HOM1, G_HET, G_HOM2]);
  if (Object.keys(grpMap).length === 0) return;
  const body = { chrom, region, groups: grpMap, scales: ['10kb'] };
  const r = await _postPopstats(HOBS_URL, body);
  if (!r.ok) { _renderNotReady('cp-het', opts, r); return; }
  const perGroup = _extractPerGroup(r.data, 'Hobs') ||
                   _extractPerGroup(r.data, 'hobs');
  if (!perGroup) { _renderNotReady('cp-het', opts,
                                   { error: 'parse', status: r.status }); return; }
  _renderPerBandBars('cp-het', perGroup, opts);
}

async function _activateFstHomVsHom(chrom, region, built) {
  const opts = { label: 'Fst Hom1 vs Hom2',
                 sublabel: 'between-arrangement Fst — H1/H1 vs H2/H2 (excludes het H1/H2)',
                 valueFmt: _fmtFloat,
                 valueLabel: 'Fst(H1/H1, H2/H2)' };
  // Two homozygous groups only — the panel title's "Hom1/Hom2" maps to
  // H1/H1 + H2/H2 in server vocab; the heterozygous band is excluded.
  const grpMap = _pickGroups(built, [G_HOM1, G_HOM2]);
  if (Object.keys(grpMap).length < 2) return;
  const body = { chrom, region, groups: grpMap, metrics: ['fst'] };
  const r = await _postPopstats(POPSTATS_URL, body);
  if (!r.ok) { _renderNotReady('cp-fst', opts, r); return; }
  const fst = _extractPairwise(r.data, 'fst', G_HOM1, G_HOM2);
  if (fst == null) { _renderNotReady('cp-fst', opts,
                                     { error: 'parse', status: r.status }); return; }
  _renderSingleValue('cp-fst', { ...opts, value: fst });
}

async function _activateThetaPiIVGT(chrom, region, built) {
  const opts = { label: 'θπ IVGT',
                 sublabel: 'pairwise θπ for inverted (H2/H2) vs standard (H1/H1)',
                 valueFmt: _fmtSci };
  // Same two homozygous groups as Fst — IVGT = "Inverted vs Standard"
  // interpretation, identical sample partition just with arrangement
  // semantics added in the labels.
  const grpMap = _pickGroups(built, [G_HOM1, G_HOM2]);
  if (Object.keys(grpMap).length < 2) return;
  const body = { chrom, region, groups: grpMap, metrics: ['theta_pi'] };
  const r = await _postPopstats(POPSTATS_URL, body);
  if (!r.ok) { _renderNotReady('cp-thetapi', opts, r); return; }
  const perGroup = _extractPerGroup(r.data, 'theta_pi');
  if (!perGroup) { _renderNotReady('cp-thetapi', opts,
                                   { error: 'parse', status: r.status }); return; }
  _renderPerBandBars('cp-thetapi', perGroup, opts);
}

// ---------------------------------------------------------------------------
// HTTP + payload extraction
// ---------------------------------------------------------------------------

// The popstats server validates group names against [A-Za-z0-9_], but our
// canonical karyotype labels contain '/' (H1/H1, H1/H2, H2/H2). Rename on
// send, undo on receive — extractors downstream keep working in canonical
// vocabulary.
function _toWire(name)   { return String(name).replace(/\//g, '_'); }

/**
 * POST helper that rewrites group keys to the server's allowed alphabet
 * and renames them back in the response. Wraps _postJson.
 */
async function _postPopstats(url, body) {
  let canonicalNames = null;
  let wireBody = body;
  if (body && body.groups && typeof body.groups === 'object') {
    canonicalNames = Object.keys(body.groups);
    const wireGroups = {};
    for (const n of canonicalNames) wireGroups[_toWire(n)] = body.groups[n];
    wireBody = { ...body, groups: wireGroups };
  }
  const r = await _postJson(url, wireBody);
  if (r.ok && canonicalNames) _restoreCanonicalKeys(r.data, canonicalNames);
  return r;
}

function _restoreCanonicalKeys(data, canonicalNames) {
  if (!data || typeof data !== 'object') return;
  const wireToCanonical = {};
  for (const c of canonicalNames) wireToCanonical[_toWire(c)] = c;
  const unwire = (k) => (k in wireToCanonical ? wireToCanonical[k] : k);

  for (const containerKey of ['groups', 'per_group']) {
    const c = data[containerKey];
    if (c && typeof c === 'object' && !Array.isArray(c)) {
      const renamed = {};
      for (const [k, v] of Object.entries(c)) renamed[unwire(k)] = v;
      data[containerKey] = renamed;
    }
  }
  for (const listKey of ['pairs', 'pairwise']) {
    const arr = data[listKey];
    if (!Array.isArray(arr)) continue;
    for (const row of arr) {
      if (!row || typeof row !== 'object') continue;
      for (const k of ['a', 'b', 'group_a', 'group_b', 'i', 'j']) {
        if (typeof row[k] === 'string') row[k] = unwire(row[k]);
      }
    }
  }
  const pairsMap = data.pairs;
  if (pairsMap && typeof pairsMap === 'object' && !Array.isArray(pairsMap)) {
    for (const a of canonicalNames) {
      for (const b of canonicalNames) {
        if (a === b) continue;
        for (const sep of [':', '__']) {
          const wireKey = `${_toWire(a)}${sep}${_toWire(b)}`;
          const canonKey = `${a}${sep}${b}`;
          if (wireKey !== canonKey && wireKey in pairsMap) {
            pairsMap[canonKey] = pairsMap[wireKey];
            delete pairsMap[wireKey];
          }
        }
      }
    }
  }
}

/**
 * POST helper. Returns { ok, data, status, error } so callers can paint
 * an honest failure state instead of leaving the stub stuck on "loading…".
 *
 *   { ok: true,  data, status }                  — 2xx, JSON parsed
 *   { ok: false, status, error: 'http' }          — non-2xx (most likely 404
 *                                                  for an endpoint not wired
 *                                                  on the server yet)
 *   { ok: false, status: 0, error: 'network' }    — fetch threw (server down,
 *                                                  CORS, DNS, etc.)
 *   { ok: false, status, error: 'parse' }         — 2xx but body wasn't JSON
 */
async function _postJson(url, body) {
  let resp;
  try {
    resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, status: 0, error: 'network', message: String(e && e.message || e) };
  }
  if (!resp.ok) {
    // Try to extract the server's error message so the badge can say
    // something useful (FastAPI returns { detail: "..." } for HTTPException;
    // raw 4xx errors may be plain text). Either way, never throw.
    let serverMsg = null;
    try {
      const text = await resp.text();
      if (text) {
        try {
          const d = JSON.parse(text).detail;
          // FastAPI HTTPException → detail is a string; Pydantic validation
          // errors → detail is an array of error objects. Stringify the
          // latter so the badge never renders "[object Object]".
          serverMsg = (typeof d === 'string') ? d
                    : (d != null ? JSON.stringify(d) : text);
        } catch (_) { serverMsg = text; }
      }
    } catch (_) {}
    return { ok: false, status: resp.status, error: 'http', message: serverMsg };
  }
  try {
    const data = await resp.json();
    return { ok: true, data, status: resp.status };
  } catch (e) {
    return { ok: false, status: resp.status, error: 'parse', message: String(e && e.message || e) };
  }
}

/**
 * Render an honest "endpoint not ready" state into a stub slot. Used when
 * the popstats server returns 404 (operation not wired) or the fetch
 * itself fails (server down). Keeps the panel's title + subtitle so the
 * reviewer knows what they're looking at; replaces the body with a one-
 * line diagnostic instead of the misleading "loading…" the stub started in.
 */
function _renderNotReady(slotId, opts, result) {
  const slot = document.getElementById(slotId);
  if (!slot) return;
  // Build a reason string that distinguishes the real failure modes:
  //   404 → endpoint not wired                  (badge says "not ready")
  //   422 → inputs unavailable in this deploy    (badge says "unavailable")
  //         e.g. Hobs needs per-sample BAMs that aren't deployed — the
  //         request was valid, the data just isn't here. Not an error.
  //   400 → request rejected (malformed for THIS candidate, e.g.
  //         min_group_n violated); the endpoint itself is live → "rejected"
  //   5xx → server error                        (atlas_server.py threw)
  //   other → "popstats: <bare error>"
  let glyph = '○';
  let badgeText = 'not ready';
  let reasonText;
  const status = result.status | 0;
  if (result.error === 'network') {
    reasonText = 'popstats server unreachable (is atlas-core/server/atlas_server.py running?)';
  } else if (result.error === 'parse') {
    reasonText = `popstats server returned ${status} but body wasn't JSON`;
  } else if (result.error === 'http' && status === 404) {
    reasonText = 'endpoint not implemented in atlas_server.py';
  } else if (result.error === 'http' && status === 422) {
    // Data-availability gap, not a crash. Keep the ○ glyph (same as "data
    // pending") and surface the server's explanation verbatim.
    badgeText = 'unavailable';
    reasonText = result.message || 'metric unavailable in this deployment';
  } else if (result.error === 'http' && status >= 400 && status < 500) {
    // 400 / 4xx — request was rejected. Server's `detail` message is the
    // useful payload (e.g. "group 'band_2' has only 7 known samples after
    // filtering against canonical sample_list (min_group_n=10)").
    glyph = '⚠';
    badgeText = 'rejected';
    reasonText = result.message
      ? `popstats rejected this request: ${result.message}`
      : `popstats returned HTTP ${status}`;
  } else if (result.error === 'http') {
    reasonText = result.message
      ? `popstats server error ${status}: ${result.message}`
      : `popstats server returned ${status}`;
  } else {
    reasonText = `popstats: ${result.error}`;
  }
  slot.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: baseline;">
      <div>
        <div style="font-family: var(--mono); font-size: 11.5px; font-weight: 600; color: var(--ink);">${_esc(opts.label)}</div>
        <div style="font-family: var(--mono); font-size: 10px; color: var(--ink-dim); margin-top: 2px;">${_esc(opts.sublabel || '')}</div>
      </div>
      <div style="font-family: var(--mono); font-size: 9.5px; color: var(--ink-dim); white-space: nowrap; padding-left: 12px;">
        ${glyph} ${badgeText}
      </div>
    </div>
    <div style="flex: 1; display: flex; align-items: center; justify-content: center;
                margin-top: 10px; color: var(--ink-dimmer); font-family: var(--mono);
                font-size: 10.5px; text-align: center; line-height: 1.4;
                padding: 8px 4px;">
      ${_esc(reasonText)}
    </div>
  `;
}

// 2026-05-29: the live popstats_groupwise.v1 response is per-WINDOW rows
// (`data.windows`) with columns like `theta_pi_<group>` / `Fst_<a>_<b>`,
// and `data.groups` = { name: sampleCount }. The per-candidate panels
// want a single value per group, so we aggregate the matching column
// across the candidate's windows (n_sites_used-weighted mean, skipping
// empty / null windows). Earlier the extractors expected a pre-aggregated
// `groups[name].metric` shape the server never produced — so every panel
// fell through to the misleading "200 but body wasn't JSON" state.

// Metric id (client vocabulary) → column-name prefix (engine vocabulary).
const _METRIC_COL_PREFIX = { theta_pi: 'theta_pi', fst: 'Fst', dxy: 'dXY', da: 'dA' };
function _metricColPrefix(metric) {
  return _METRIC_COL_PREFIX[metric] || metric;
}

// The server sanitizes group names into column keys: '/' → '_'
// ('H1/H1' → 'H1_H1'). Mirror that so client-side column lookups match.
function _sanitizeGroupName(name) {
  return String(name).replace(/\//g, '_');
}

// n_sites_used-weighted mean of `col` across windows. Skips windows whose
// value is null/non-finite or whose weight is 0. Falls back to an
// unweighted mean when no weights are present. Returns null when nothing
// usable is found.
function _weightedMeanCol(windows, col) {
  let num = 0, den = 0, plainSum = 0, plainN = 0;
  for (const w of windows) {
    if (!w) continue;
    const v = w[col];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const wt = Number.isFinite(w.n_sites_used) ? w.n_sites_used
             : Number.isFinite(w.n_sites)      ? w.n_sites : 0;
    plainSum += v; plainN++;
    if (wt > 0) { num += v * wt; den += wt; }
  }
  if (den > 0) return num / den;
  if (plainN > 0) return plainSum / plainN;
  return null;
}

/**
 * Pull a per-group value for `metric` out of the popstats response.
 * Primary path: aggregate the `theta_pi_<group>` column across
 * `data.windows`. Legacy fallbacks for older pre-aggregated shapes are
 * kept so a different server build still renders.
 */
function _extractPerGroup(data, metric) {
  if (!data) return null;
  // Primary: per-window rows + `groups` keys (live popstats_groupwise.v1).
  const windows = Array.isArray(data.windows) ? data.windows : null;
  const groupNames = (data.groups && typeof data.groups === 'object' && !Array.isArray(data.groups))
    ? Object.keys(data.groups) : null;
  if (windows && windows.length && groupNames && groupNames.length) {
    const prefix = _metricColPrefix(metric);
    const out = {};
    let any = false;
    for (const name of groupNames) {
      const agg = _weightedMeanCol(windows, `${prefix}_${name}`);
      if (agg != null && Number.isFinite(agg)) { out[name] = agg; any = true; }
    }
    if (any) return out;
  }
  // Legacy pre-aggregated shapes.
  const containers = [
    data && data.groups,
    data && data.per_group,
    data,
  ];
  for (const c of containers) {
    if (!c || typeof c !== 'object') continue;
    const out = {};
    let any = false;
    for (const [name, info] of Object.entries(c)) {
      if (name === 'pairs' || name === 'pairwise' || name === 'groups') continue;
      if (!info || typeof info !== 'object') continue;
      const v = info[metric];
      if (typeof v === 'number' && Number.isFinite(v)) {
        out[name] = v; any = true;
      }
    }
    if (any) return out;
  }
  return null;
}

/**
 * Pull a pairwise metric value between groups `a` and `b` out of the
 * popstats response. Common shapes:
 *
 *   { pairs:    [ { a, b, fst, ... }, ... ] }
 *   { pairwise: [ { group_a, group_b, fst }, ... ] }
 *   { pairs:    { 'a:b': { fst } } }
 */
function _extractPairwise(data, metric, a, b) {
  // Primary: aggregate the `Fst_<a>_<b>` column across data.windows.
  // The server sanitizes group names for column keys (slash → underscore,
  // so 'H1/H1' → 'H1_H1' and the pairwise column is 'Fst_H1_H1_H2_H2').
  // Sanitize the caller's group names the same way, and try both pair
  // orientations (the engine emits pairs in sorted group order).
  const windows = Array.isArray(data && data.windows) ? data.windows : null;
  if (windows && windows.length) {
    const prefix = _metricColPrefix(metric);
    const sa = _sanitizeGroupName(a), sb = _sanitizeGroupName(b);
    for (const col of [`${prefix}_${sa}_${sb}`, `${prefix}_${sb}_${sa}`]) {
      const agg = _weightedMeanCol(windows, col);
      if (agg != null && Number.isFinite(agg)) return agg;
    }
  }
  // Legacy pre-aggregated shapes.
  const lists = [data && data.pairs, data && data.pairwise];
  for (const arr of lists) {
    if (!Array.isArray(arr)) continue;
    for (const row of arr) {
      if (!row || typeof row !== 'object') continue;
      const ra = row.a || row.group_a || row.i;
      const rb = row.b || row.group_b || row.j;
      const matches = (ra === a && rb === b) || (ra === b && rb === a);
      if (matches && typeof row[metric] === 'number') return row[metric];
    }
  }
  // Map shape under `pairs`
  const m = data && data.pairs;
  if (m && typeof m === 'object' && !Array.isArray(m)) {
    for (const key of [`${a}:${b}`, `${b}:${a}`, `${a}__${b}`, `${b}__${a}`]) {
      const v = m[key] && m[key][metric];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function _renderPerBandBars(slotId, perGroup, opts) {
  const slot = document.getElementById(slotId);
  if (!slot) return;
  const entries = Object.entries(perGroup).sort((a, b) => a[0].localeCompare(b[0]));
  const maxV = Math.max(...entries.map(([, v]) => v));
  const fmt = opts.valueFmt || _fmtFloat;
  const bars = entries.map(([name, v]) => {
    const pct = maxV > 0 ? Math.round((v / maxV) * 100) : 0;
    return `
      <div style="display: grid; grid-template-columns: 80px 1fr 90px;
                  gap: 8px; align-items: center; font-family: var(--mono); font-size: 10.5px;">
        <div style="color: var(--ink-dim);">${_esc(name)}</div>
        <div style="height: 12px; background: var(--panel-3, var(--panel));
                    border-radius: 2px; position: relative; overflow: hidden;">
          <div style="height: 100%; width: ${pct}%; background: var(--accent, #3cc08a);"></div>
        </div>
        <div style="text-align: right; color: var(--ink);">${fmt(v)}</div>
      </div>`;
  }).join('');
  slot.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: baseline;">
      <div>
        <div style="font-family: var(--mono); font-size: 11.5px; font-weight: 600; color: var(--ink);">${_esc(opts.label)}</div>
        <div style="font-family: var(--mono); font-size: 10px; color: var(--ink-dim); margin-top: 2px;">${_esc(opts.sublabel)}</div>
      </div>
      <div style="font-family: var(--mono); font-size: 9.5px; color: var(--good, #3cc08a);">✓ live · popstats</div>
    </div>
    <div style="display: grid; gap: 4px; margin-top: 10px;">${bars}</div>
  `;
}

function _renderSingleValue(slotId, opts) {
  const slot = document.getElementById(slotId);
  if (!slot) return;
  slot.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: baseline;">
      <div>
        <div style="font-family: var(--mono); font-size: 11.5px; font-weight: 600; color: var(--ink);">${_esc(opts.label)}</div>
        <div style="font-family: var(--mono); font-size: 10px; color: var(--ink-dim); margin-top: 2px;">${_esc(opts.sublabel)}</div>
      </div>
      <div style="font-family: var(--mono); font-size: 9.5px; color: var(--good, #3cc08a);">✓ live · popstats</div>
    </div>
    <div style="flex: 1; display: flex; align-items: center; justify-content: center; flex-direction: column;
                margin-top: 10px; font-family: var(--mono);">
      <div style="font-size: 22px; color: var(--ink);">${opts.valueFmt(opts.value)}</div>
      <div style="font-size: 10px; color: var(--ink-dim); margin-top: 4px;">${_esc(opts.valueLabel)}</div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Formatters + escape
// ---------------------------------------------------------------------------

function _fmtSci(v) {
  if (!Number.isFinite(v)) return '—';
  return v.toExponential(2);
}

function _fmtFloat(v) {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(3);
}

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
