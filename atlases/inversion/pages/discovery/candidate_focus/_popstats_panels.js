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

const POPSTATS_URL = '/api/popstats/groupwise';
const HOBS_URL     = '/api/popstats/hobs_groupwise';

/**
 * Entry point — call after the candidate page's HTML is in the DOM.
 * Reads the active candidate + chrom-level samples from `state`, builds
 * the group composition, and kicks off the four panel fetches in parallel.
 * Non-blocking: returns immediately. Each panel resolves independently.
 */
export function activatePopstatsPanels(state) {
  if (typeof document === 'undefined') return;
  const c = state && state.candidate;
  if (!c) return;
  const groups = _buildBandGroups(state);
  if (!groups || !groups.byBand) {
    // No per-band sample IDs available — leave stubs alone.
    return;
  }
  const region = { start_bp: c.start_bp | 0, end_bp: c.end_bp | 0 };
  const chrom = c.chrom || (state.data && state.data.chrom) || null;
  if (!chrom) return;

  // Fire all four panels in parallel; each handles its own DOM slot.
  _activateThetaPerBand(chrom, region, groups);
  _activateHetPerBand(chrom, region, groups);
  _activateFstHomVsHom(chrom, region, groups);
  _activateThetaPiIVGT(chrom, region, groups);
}

// ---------------------------------------------------------------------------
// Group composition — derive per-K-band sample-ID arrays from the candidate.
//
// Inputs from state:
//   state.candidate.locked_labels — Int8Array (or array) of length n_samples;
//     each entry is the K-band index this sample sits in (0..K-1) OR -1 for
//     ambiguous/unassigned.
//   state.data.samples            — chrom-level samples array; canonical IDs
//                                   live under `.cga`, `.ind`, or `.sample_id`.
//
// Returns:
//   { byBand: { 0: [sid, sid, ...], 1: [...], 2: [...] }, K }
//   OR null when either input is missing.
// ---------------------------------------------------------------------------
function _buildBandGroups(state) {
  const c = state && state.candidate;
  if (!c || !c.locked_labels) return null;
  const samples = state && state.data && state.data.samples;
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const labels = c.locked_labels;
  if (labels.length !== samples.length) return null;   // shape mismatch — bail

  const K = c.K || 3;
  const byBand = {};
  for (let i = 0; i < labels.length; i++) {
    const k = labels[i];
    if (k < 0 || k >= K) continue;
    const sid = _sampleId(samples[i]);
    if (!sid) continue;
    (byBand[k] ||= []).push(sid);
  }
  return { byBand, K };
}

function _sampleId(s) {
  if (!s) return null;
  return s.cga || s.ind || s.sample_id || s.id || null;
}

/** Group-name builder for the per-band panels — band_0 / band_1 / band_2. */
function _bandGroupNames(groups) {
  const out = {};
  for (const [k, ids] of Object.entries(groups.byBand)) {
    if (ids.length === 0) continue;
    out[`band_${k}`] = ids;
  }
  return out;
}

/** Group-name builder for Hom1/Hom2 (K=3): band 0 = Hom1, band 2 = Hom2. */
function _homGroupNames(groups) {
  const out = {};
  const h1 = groups.byBand[0] || [];
  const h2 = groups.byBand[2] || [];
  if (h1.length > 0) out.Hom1 = h1;
  if (h2.length > 0) out.Hom2 = h2;
  return out;
}

/** Group-name builder for INV/STD (K=3): same band convention, renamed. */
function _ivgtGroupNames(groups) {
  const out = {};
  const std = groups.byBand[0] || [];
  const inv = groups.byBand[2] || [];
  if (std.length > 0) out.STD = std;
  if (inv.length > 0) out.INV = inv;
  return out;
}

// ---------------------------------------------------------------------------
// Per-panel activators. Each one builds the request, POSTs, and replaces the
// panel's stub body on success. On any failure the stub is left in place.
// ---------------------------------------------------------------------------

async function _activateThetaPerBand(chrom, region, groups) {
  const opts = { label: 'θ per band',
                 sublabel: 'nucleotide diversity per K-means cluster',
                 valueFmt: _fmtSci };
  const grpMap = _bandGroupNames(groups);
  if (Object.keys(grpMap).length === 0) return;
  const body = { chrom, region, groups: grpMap, metrics: ['theta_pi'] };
  const r = await _postJson(POPSTATS_URL, body);
  if (!r.ok) { _renderNotReady('cp-theta', opts, r); return; }
  const perGroup = _extractPerGroup(r.data, 'theta_pi');
  if (!perGroup) { _renderNotReady('cp-theta', opts,
                                   { error: 'parse', status: r.status }); return; }
  _renderPerBandBars('cp-theta', perGroup, opts);
}

async function _activateHetPerBand(chrom, region, groups) {
  const opts = { label: 'heterozygosity per band',
                 sublabel: 'mean per-sample H grouped by band',
                 valueFmt: _fmtFloat };
  const grpMap = _bandGroupNames(groups);
  if (Object.keys(grpMap).length === 0) return;
  const body = { chrom, region, groups: grpMap, scales: ['10kb'] };
  const r = await _postJson(HOBS_URL, body);
  if (!r.ok) { _renderNotReady('cp-het', opts, r); return; }
  const perGroup = _extractPerGroup(r.data, 'Hobs') ||
                   _extractPerGroup(r.data, 'hobs');
  if (!perGroup) { _renderNotReady('cp-het', opts,
                                   { error: 'parse', status: r.status }); return; }
  _renderPerBandBars('cp-het', perGroup, opts);
}

async function _activateFstHomVsHom(chrom, region, groups) {
  const opts = { label: 'Fst Hom1 vs Hom2',
                 sublabel: 'between-arrangement Fst (excludes het band)',
                 valueFmt: _fmtFloat,
                 valueLabel: 'Fst(Hom1, Hom2)' };
  const grpMap = _homGroupNames(groups);
  if (Object.keys(grpMap).length < 2) return;
  const body = { chrom, region, groups: grpMap, metrics: ['fst'] };
  const r = await _postJson(POPSTATS_URL, body);
  if (!r.ok) { _renderNotReady('cp-fst', opts, r); return; }
  const fst = _extractPairwise(r.data, 'fst', 'Hom1', 'Hom2');
  if (fst == null) { _renderNotReady('cp-fst', opts,
                                     { error: 'parse', status: r.status }); return; }
  _renderSingleValue('cp-fst', { ...opts, value: fst });
}

async function _activateThetaPiIVGT(chrom, region, groups) {
  const opts = { label: 'θπ IVGT',
                 sublabel: 'pairwise diversity for inverted vs standard arrangements',
                 valueFmt: _fmtSci };
  const grpMap = _ivgtGroupNames(groups);
  if (Object.keys(grpMap).length < 2) return;
  const body = { chrom, region, groups: grpMap, metrics: ['theta_pi'] };
  const r = await _postJson(POPSTATS_URL, body);
  if (!r.ok) { _renderNotReady('cp-thetapi', opts, r); return; }
  const perGroup = _extractPerGroup(r.data, 'theta_pi');
  if (!perGroup) { _renderNotReady('cp-thetapi', opts,
                                   { error: 'parse', status: r.status }); return; }
  _renderPerBandBars('cp-thetapi', perGroup, opts);
}

// ---------------------------------------------------------------------------
// HTTP + payload extraction
// ---------------------------------------------------------------------------

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
        try { serverMsg = (JSON.parse(text).detail) || text; }
        catch (_) { serverMsg = text; }
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
  // Build a reason string that distinguishes the three real failure modes:
  //   404 → endpoint not wired                  (badge says "not ready")
  //   400 (with server message, e.g. min_group_n violated) → "rejected"
  //                                              (the request was malformed
  //                                              for THIS candidate, but the
  //                                              endpoint itself is live)
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
  } else if (result.error === 'http' && status >= 400 && status < 500) {
    // 400 / 422 — request was rejected. Server's `detail` message is the
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

/**
 * Pull a per-group value for `metric` out of the popstats response. Shape
 * varies across server versions; try a few common layouts.
 *
 *   { groups: { name: { metric: value, ... } } }                — preferred
 *   { per_group: { name: { metric: value } } }                  — older
 *   { name: { metric: value } } (flat)                          — fallback
 */
function _extractPerGroup(data, metric) {
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
