// atlases/inversion/pages/review/popstats_demo.js
// =====================================================================
// popstats_demo — integration proof for the regime → popstats loop.
//
// Closes the data flow established by the regime pipeline:
//   1. haplotype_regimes / candidate_regimes runs the banding pipeline.
//   2. run_pipeline.js writes one record per confirmed candidate into
//      atlasState.shared.registeredCandidates, each carrying
//      regime_groups = { 'H1/H1': [sids], 'H1/H2': [sids], 'H2/H2': [sids],
//                        'uncertain': [sids] }.
//   3. THIS page reads that registry and POSTs each candidate's groups
//      to /api/popstats/groupwise (the live region_popstats / Engine F
//      endpoint), then renders θπ per group + pairwise FST.
//
// What this proves: the producer-side serialisation (regime_groups +
// sample-id partitions) is exactly what the popstats server consumes,
// with no relabel. Failure states are rendered honestly so a missing
// server / unwired endpoint / too-small group is distinguishable from
// a real zero.
//
// Group handling for the request:
//   - 'uncertain' is dropped (not a karyotype class).
//   - empty groups dropped.
//   - we still send groups below the server's min_group_n floor; the
//     server returns 400 with a detail message, which we surface.
// =====================================================================

const GROUPWISE_URL = '/api/popstats/groupwise';

// Metric registry: id ↔ display label + which response field to read.
const METRICS = [
  { id: 'theta_pi', label: 'θπ',  kind: 'per_group' },
  { id: 'fst',      label: 'FST', kind: 'pairwise'  },
  { id: 'dxy',      label: 'dXY', kind: 'pairwise'  },
];

let _pageState = null;

// =====================================================================
// lifecycle
// =====================================================================

export async function mount(root, atlasState, _registry) {
  const state = {
    atlasState,
    enabledMetrics: new Set(['theta_pi', 'fst']),
    serverProbed: false,
  };
  _pageState = state;

  const candidates = _readRegistry(atlasState);
  state.candidates = candidates;

  _renderMetricChips(root, state);
  _wireComputeAll(root, state);

  if (!candidates || candidates.length === 0) {
    _showEmpty(root, true);
    return;
  }
  _showEmpty(root, false);
  _renderTable(root, state);
}

export async function unmount(_root) {
  _pageState = null;
}

// Re-read the registry + repaint when the shell re-activates the page
// (e.g. after running the pipeline on another tab). Cheap; safe to call
// repeatedly.
export function refresh(root) {
  const state = _pageState;
  if (!state) return;
  state.candidates = _readRegistry(state.atlasState);
  if (!state.candidates || state.candidates.length === 0) {
    _showEmpty(root, true);
    return;
  }
  _showEmpty(root, false);
  _renderTable(root, state);
}

// =====================================================================
// registry read
// =====================================================================

function _readRegistry(atlasState) {
  const shared = atlasState && atlasState.shared;
  const arr = shared && shared.registeredCandidates;
  return Array.isArray(arr) ? arr.slice() : [];
}

// =====================================================================
// chrome wiring
// =====================================================================

function _renderMetricChips(root, state) {
  const wrap = root.querySelector('#psdMetricChips');
  if (!wrap) return;
  wrap.innerHTML = '';
  for (const m of METRICS) {
    const on = state.enabledMetrics.has(m.id);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.textContent = m.label;
    chip.dataset.metric = m.id;
    chip.style.cssText = _chipCss(on);
    chip.onclick = () => {
      if (state.enabledMetrics.has(m.id)) state.enabledMetrics.delete(m.id);
      else state.enabledMetrics.add(m.id);
      chip.style.cssText = _chipCss(state.enabledMetrics.has(m.id));
    };
    wrap.appendChild(chip);
  }
}

function _chipCss(on) {
  return 'cursor: pointer; padding: 1px 8px; border-radius: 3px; '
    + 'font: 10px var(--mono, ui-monospace, monospace); '
    + (on
      ? 'background: var(--accent, #3b82f6); color: #fff; border: 1px solid var(--accent, #3b82f6);'
      : 'background: transparent; color: var(--ink-dim, #8895a8); border: 1px solid var(--rule, #2a3242);');
}

function _wireComputeAll(root, state) {
  const btn = root.querySelector('#psdComputeAllBtn');
  if (!btn) return;
  btn.onclick = async () => {
    btn.disabled = true;
    const oldLabel = btn.textContent;
    btn.textContent = 'computing…';
    try {
      // Sequential — keeps server load sane + the badge probe stable.
      for (const cand of state.candidates) {
        await _computeOne(root, state, cand);
      }
    } finally {
      btn.disabled = false;
      btn.textContent = oldLabel;
    }
  };
}

// =====================================================================
// table
// =====================================================================

function _renderTable(root, state) {
  const table = root.querySelector('#psdTable');
  if (!table) return;
  table.innerHTML = '';

  const thead = document.createElement('thead');
  thead.innerHTML =
    `<tr style="text-align: left; color: var(--ink-dim, #8895a8);
                border-bottom: 1px solid var(--rule, #2a3242);">
       <th style="padding: 6px 8px;">candidate</th>
       <th style="padding: 6px 8px;">regime</th>
       <th style="padding: 6px 8px;">conf</th>
       <th style="padding: 6px 8px;">group composition</th>
       <th style="padding: 6px 8px;">popstats</th>
       <th style="padding: 6px 8px;"></th>
     </tr>`;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const cand of state.candidates) {
    tbody.appendChild(_candidateRow(root, state, cand));
  }
  table.appendChild(tbody);
}

function _candidateRow(root, state, cand) {
  const tr = document.createElement('tr');
  tr.style.cssText = 'border-bottom: 1px solid var(--rule, #2a3242); vertical-align: top;';
  const rowId = _safeId(cand.candidate_id);

  const span = (cand.span_bp != null) ? `${(cand.span_bp / 1e6).toFixed(2)} Mb` : '—';
  const region = (cand.start_bp != null && cand.end_bp != null)
    ? `${(cand.start_bp / 1e6).toFixed(3)}–${(cand.end_bp / 1e6).toFixed(3)} Mb` : '—';

  tr.innerHTML = `
    <td style="padding: 6px 8px;">
      <div style="color: var(--ink, #d6deea);">${_esc(cand.candidate_id)}</div>
      <div style="color: var(--ink-dim, #8895a8);">${_esc(cand.chrom || '?')} · ${region} · ${span}</div>
    </td>
    <td style="padding: 6px 8px; color: var(--ink, #d6deea);">${_esc(cand.regime_class || '—')}</td>
    <td style="padding: 6px 8px; color: var(--ink-dim, #8895a8);">${_fmtNum(cand.confidence)}</td>
    <td style="padding: 6px 8px;">${_groupBadges(cand)}</td>
    <td style="padding: 6px 8px;" id="psd-result-${rowId}">
      <span style="color: var(--ink-dimmer, #5a6678);">— not computed —</span>
    </td>
    <td style="padding: 6px 8px;">
      <button type="button" id="psd-btn-${rowId}"
              style="background: var(--panel-2, #131a25); border: 1px solid var(--rule, #2a3242);
                     color: var(--ink, #d6deea); cursor: pointer; padding: 2px 8px;
                     border-radius: 3px; font: 10px var(--mono, ui-monospace, monospace);">
        compute
      </button>
    </td>`;

  // Wire per-row compute.
  const btn = tr.querySelector(`#psd-btn-${rowId}`);
  if (btn) {
    btn.onclick = async () => {
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = '…';
      try { await _computeOne(root, state, cand); }
      finally { btn.disabled = false; btn.textContent = old; }
    };
  }
  return tr;
}

function _groupBadges(cand) {
  const groups = cand.regime_groups || {};
  const nPer = cand.n_per_regime || {};
  const order = ['H1/H1', 'H1/H2', 'H2/H2', 'uncertain'];
  const colors = {
    'H1/H1': '#3b82f6', 'H1/H2': '#a855f7', 'H2/H2': '#ef4444', 'uncertain': '#6b7280',
  };
  const out = [];
  for (const k of order) {
    const n = nPer[k] != null ? nPer[k] : (groups[k] ? groups[k].length : 0);
    if (!n) continue;
    out.push(
      `<span style="display: inline-block; margin: 0 4px 2px 0; padding: 0 6px;
                    border-radius: 3px; background: ${colors[k] || '#6b7280'}22;
                    border: 1px solid ${colors[k] || '#6b7280'}66; color: var(--ink, #d6deea);">
         ${_esc(k)}: ${n}</span>`);
  }
  return out.join('') || '<span style="color: var(--ink-dimmer, #5a6678);">no groups</span>';
}

// =====================================================================
// compute one candidate
// =====================================================================

async function _computeOne(root, state, cand) {
  const slot = root.querySelector(`#psd-result-${_safeId(cand.candidate_id)}`);
  if (!slot) return;

  const groups = _requestGroups(cand);
  const nGroups = Object.keys(groups).length;
  if (nGroups < 2) {
    slot.innerHTML = _diag('⚠',
      `need ≥2 non-empty karyotype groups; have ${nGroups} (uncertain dropped)`);
    return;
  }
  const chrom = cand.chrom;
  if (!chrom) { slot.innerHTML = _diag('⚠', 'candidate has no chrom'); return; }

  const metrics = METRICS.filter(m => state.enabledMetrics.has(m.id)).map(m => m.id);
  if (metrics.length === 0) { slot.innerHTML = _diag('○', 'no metrics selected'); return; }

  slot.innerHTML = '<span style="color: var(--ink-dim, #8895a8);">computing…</span>';

  const body = {
    chrom,
    region: { start_bp: cand.start_bp | 0, end_bp: cand.end_bp | 0 },
    groups,
    metrics,
  };
  const r = await _postJson(GROUPWISE_URL, body);
  _markServer(root, state, r);

  if (!r.ok) { slot.innerHTML = _failDiag(r); return; }
  slot.innerHTML = _renderResults(r.data, groups, metrics);
}

// Build the request groups dict: drop 'uncertain' + empty groups.
function _requestGroups(cand) {
  const src = cand.regime_groups || {};
  const out = {};
  for (const [name, ids] of Object.entries(src)) {
    if (name === 'uncertain') continue;
    if (Array.isArray(ids) && ids.length > 0) out[name] = ids;
  }
  return out;
}

// =====================================================================
// result rendering
// =====================================================================

function _renderResults(data, groups, metrics) {
  const parts = [];
  const names = Object.keys(groups);

  for (const mid of metrics) {
    const meta = METRICS.find(m => m.id === mid);
    if (!meta) continue;
    if (meta.kind === 'per_group') {
      const per = _extractPerGroup(data, mid);
      if (!per) { parts.push(_metricLine(meta.label, '— no per-group value in response —')); continue; }
      const cells = names
        .filter(n => per[n] != null)
        .map(n => `${_esc(n)}=${_fmtSci(per[n])}`)
        .join('  ');
      parts.push(_metricLine(meta.label, cells || '— empty —'));
    } else {
      // pairwise
      const pairs = [];
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const v = _extractPairwise(data, mid, names[i], names[j]);
          if (v != null) pairs.push(`${_esc(names[i])}↔${_esc(names[j])}=${_fmtNum(v)}`);
        }
      }
      parts.push(_metricLine(meta.label, pairs.join('  ') || '— no pairwise value —'));
    }
  }
  return parts.join('');
}

function _metricLine(label, body) {
  return `<div style="margin-bottom: 2px;">
            <span style="display: inline-block; min-width: 34px; color: var(--ink-dim, #8895a8);">${_esc(label)}</span>
            <span style="color: var(--ink, #d6deea);">${body}</span>
          </div>`;
}

// =====================================================================
// response extraction (shapes mirror candidate_focus/_popstats_panels.js)
// =====================================================================

function _extractPerGroup(data, metric) {
  const containers = [data && data.groups, data && data.per_group, data];
  for (const c of containers) {
    if (!c || typeof c !== 'object') continue;
    const out = {};
    let any = false;
    for (const [name, info] of Object.entries(c)) {
      if (name === 'pairs' || name === 'pairwise' || name === 'groups') continue;
      if (!info || typeof info !== 'object') continue;
      const v = info[metric];
      if (typeof v === 'number' && Number.isFinite(v)) { out[name] = v; any = true; }
    }
    if (any) return out;
  }
  return null;
}

function _extractPairwise(data, metric, a, b) {
  const lists = [data && data.pairs, data && data.pairwise];
  for (const arr of lists) {
    if (!Array.isArray(arr)) continue;
    for (const row of arr) {
      if (!row || typeof row !== 'object') continue;
      const ra = row.a || row.group_a || row.g1;
      const rb = row.b || row.group_b || row.g2;
      const match = (ra === a && rb === b) || (ra === b && rb === a);
      if (!match) continue;
      const v = row[metric];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
  }
  // Keyed-object shape: { pairs: { 'a:b': { fst } } }
  const pobj = data && data.pairs;
  if (pobj && !Array.isArray(pobj) && typeof pobj === 'object') {
    for (const key of [`${a}:${b}`, `${b}:${a}`]) {
      const info = pobj[key];
      if (info && typeof info[metric] === 'number' && Number.isFinite(info[metric])) {
        return info[metric];
      }
    }
  }
  return null;
}

// =====================================================================
// POST helper + server badge
// =====================================================================

async function _postJson(url, body) {
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, status: 0, error: 'network', message: String(e && e.message || e) };
  }
  if (!resp.ok) {
    let serverMsg = null;
    try {
      const text = await resp.text();
      if (text) { try { serverMsg = JSON.parse(text).detail || text; } catch (_) { serverMsg = text; } }
    } catch (_) {}
    return { ok: false, status: resp.status, error: 'http', message: serverMsg };
  }
  try {
    return { ok: true, data: await resp.json(), status: resp.status };
  } catch (e) {
    return { ok: false, status: resp.status, error: 'parse', message: String(e && e.message || e) };
  }
}

function _markServer(root, state, r) {
  state.serverProbed = true;
  const badge = root.querySelector('#psdServerBadge');
  if (!badge) return;
  let txt, col;
  if (r.ok || (r.error === 'http' && r.status >= 400 && r.status < 500 && r.status !== 404)) {
    txt = 'server: live'; col = '#22c55e';
  } else if (r.error === 'http' && r.status === 404) {
    txt = 'server: endpoint unwired (404)'; col = '#f59e0b';
  } else if (r.error === 'network') {
    txt = 'server: unreachable'; col = '#ef4444';
  } else {
    txt = `server: error ${r.status || ''}`; col = '#ef4444';
  }
  badge.textContent = txt;
  badge.style.color = col;
  badge.style.borderColor = col + '66';
}

function _failDiag(r) {
  const status = r.status | 0;
  if (r.error === 'network') {
    return _diag('✕', 'popstats server unreachable (is atlas-core/server running?)');
  }
  if (r.error === 'parse') return _diag('✕', `server returned ${status} but body wasn't JSON`);
  if (r.error === 'http' && status === 404) return _diag('○', 'endpoint not implemented in server');
  if (r.error === 'http' && status >= 400 && status < 500) {
    return _diag('⚠', r.message ? `rejected: ${r.message}` : `rejected (HTTP ${status})`);
  }
  if (r.error === 'http') return _diag('✕', r.message ? `server error ${status}: ${r.message}` : `server error ${status}`);
  return _diag('✕', `error: ${r.error}`);
}

// =====================================================================
// small helpers
// =====================================================================

function _diag(glyph, text) {
  return `<span style="color: var(--ink-dim, #8895a8);">${glyph} ${_esc(text)}</span>`;
}

function _showEmpty(root, show) {
  const empty = root.querySelector('#psdEmpty');
  const wrap = root.querySelector('#psdTableWrap');
  if (empty) empty.style.display = show ? 'flex' : 'none';
  if (wrap) wrap.style.display = show ? 'none' : 'block';
}

function _safeId(s) { return String(s == null ? '' : s).replace(/[^a-zA-Z0-9_-]/g, '_'); }

function _esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _fmtNum(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  return (Math.round(v * 1000) / 1000).toString();
}

function _fmtSci(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  if (Math.abs(v) < 0.001 || Math.abs(v) >= 1000) return v.toExponential(2);
  return (Math.round(v * 10000) / 10000).toString();
}

// Pure helpers exposed for unit tests (no DOM dependency).
export const __test = {
  requestGroups: _requestGroups,
  extractPerGroup: _extractPerGroup,
  extractPairwise: _extractPairwise,
  readRegistry: _readRegistry,
};
