// atlases/cross-species/pages/breakpoints/bp_atlas_reciprocity.js
//
// BP reciprocity page — renders BP3c reciprocity_table.tsv. Both-anchor
// validated zones with confidence tier + backbone_support flag.
// Phase 1a: page stub. Renders empty-state when data missing.

let _pageState = null;

export async function mount(root, atlasState, registry) {
  _pageState = { atlasState, registry, rows: [] };
  await _loadReciprocity(root, registry);
}

export async function unmount(_root) { _pageState = null; }

export function refresh(_state) {
  if (typeof document === 'undefined') return;
  const root = document.getElementById('bp_atlas_reciprocity');
  if (root) _renderRows(root);
}

async function _loadReciprocity(root, registry) {
  if (!root || typeof document === 'undefined') return;
  const statusEl = root.querySelector('#bpRecStatus');
  if (statusEl) statusEl.textContent = 'loading reciprocity table…';
  let tsv = null;
  if (registry && typeof registry.resolve === 'function') {
    try { tsv = await registry.resolve('cross-species.bp_atlas_reciprocity_v1'); }
    catch (e) { console.warn('bp_atlas_reciprocity: load failed —', e); }
  }
  if (!tsv) {
    _renderEmptyState(root,
      'No bp_atlas_reciprocity_v1 layer loaded. Run the bp_atlas_pipeline ' +
      'workflow through stage BP3c (engines/producers/bp_atlas/runners/run_bp_atlas_LAPTOP.sh).');
    return;
  }
  const rows = (typeof tsv === 'string') ? _parseTsv(tsv)
             : (Array.isArray(tsv) ? tsv : []);
  if (_pageState) _pageState.rows = rows;
  if (statusEl) statusEl.textContent = `${rows.length} zone${rows.length === 1 ? '' : 's'}`;
  _renderRows(root);
}

function _parseTsv(txt) {
  const lines = txt.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t');
  return lines.slice(1).map(l => {
    const cells = l.split('\t');
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i] != null ? cells[i] : ''; });
    return obj;
  });
}

function _renderEmptyState(root, msg) {
  const body = root.querySelector('#bpRecBody');
  const count = root.querySelector('#bpRecCount');
  if (body) body.innerHTML =
    `<tr><td colspan="7" style="padding: 14px 10px; color: var(--ink-dimmer, #5a6472); font-style: italic;">${_esc(msg)}</td></tr>`;
  if (count) count.textContent = '';
}

function _renderRows(root) {
  if (!_pageState) return;
  const body = root.querySelector('#bpRecBody');
  if (!body) return;
  body.innerHTML = '';
  for (const r of _pageState.rows) body.appendChild(_renderRow(r));
}

function _renderRow(r) {
  const tr = document.createElement('tr');
  tr.style.borderBottom = '1px solid var(--rule)';
  const bothAnchor = r.both_anchor === 'TRUE' || r.both_anchor === '1';
  const baCell = bothAnchor
    ? '<span style="color: #3cc08a; font-weight: 600;">YES</span>'
    : '<span style="color: var(--ink-dim);">no</span>';
  tr.innerHTML =
    `<td style="padding: 3px 6px; font-weight: 600;">${_esc(r.zone_id || r.cluster_id || '—')}</td>` +
    `<td style="padding: 3px 6px;">${_esc(r.anchor_Cgar_pos || r.anchor_a_pos || '—')}</td>` +
    `<td style="padding: 3px 6px;">${_esc(r.anchor_Cmac_pos || r.anchor_b_pos || '—')}</td>` +
    `<td style="padding: 3px 6px;">${_esc(r.event_class || '—')}</td>` +
    `<td style="padding: 3px 6px;">${_esc(r.confidence_tier || r.confidence || '—')}</td>` +
    `<td style="padding: 3px 6px;">${_esc(r.backbone_support || '—')}</td>` +
    `<td style="padding: 3px 6px;">${baCell}</td>`;
  return tr;
}

function _esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
