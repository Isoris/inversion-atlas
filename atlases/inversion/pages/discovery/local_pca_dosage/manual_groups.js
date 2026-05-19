// pages/discovery/local_pca_dosage/manual_groups.js
//
// Manual-group helpers (round 4 port, 2026-05-11).
//
// Verbatim port from the legacy monolith (Atlas_round166), legacy lines
// 47880-48269 + 56669-56688. Owns the full lifecycle of user-defined
// manual sample groups:
//
//   - per-chrom + cohort-pinned scopes (with localStorage persistence)
//   - palette assignment (10-color rotation, least-used heuristic)
//   - CGA-keyed membership (survives precomp regeneration)
//   - TSV import/export
//   - sidebar rendering + click-delegation hooks
//
// Storage keys (preserved verbatim from legacy):
//   localStorage['pca_scrubber_v3.manual_groups.<chrom>']  per-chrom
//   localStorage['pca_scrubber_v3.manual_groups.__cohort'] cohort-pinned
//
// Each group: { id, name, color, scope: 'chrom'|'cohort', members: [cga,...] }
//
// Sample identity is stored as CGA strings, NOT scrubber indices, so the
// groups survive precomp regeneration where sample indexing might shift.

import { escapeHtml } from '../../../shared/page1_utils.js';

import { _pageState } from './_state.js';
import { getL2Cluster } from './_data.js';
import { drawPCA } from './pca_panel.js';
import { renderL3Panel } from './l3_panel.js';

// --- Palette + storage prefixes (legacy lines 47899-47904) ---
const MG_PALETTE = [
  '#4fa3ff', '#f5a524', '#3cc08a', '#e0555c', '#b07cf7',
  '#5dc4d6', '#d54852', '#7eaecb', '#9580c2', '#88b58a',
];
const MG_STORAGE_PREFIX = 'pca_scrubber_v3.manual_groups.';
const MG_COHORT_KEY = '__cohort';

// --- _mgChromKey / _mgCohortKey (legacy 47906-47910) ---
function _mgChromKey() {
  const state = _pageState;
  const c = state && state.data && state.data.chrom ? state.data.chrom : null;
  return c ? (MG_STORAGE_PREFIX + c) : null;
}
function _mgCohortKey() { return MG_STORAGE_PREFIX + MG_COHORT_KEY; }

// --- loadManualGroups (legacy 47912-47940) ---
// Merge per-chrom + cohort-pinned groups into a unified list. Cohort
// groups are returned with scope='cohort' and live unchanged across chroms.
function loadManualGroups() {
  const out = [];
  // Cohort-pinned first
  try {
    const raw = localStorage.getItem(_mgCohortKey());
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && Array.isArray(obj.groups)) {
        for (const g of obj.groups) out.push({ ...g, scope: 'cohort' });
      }
    }
  } catch (e) { console.warn('[mg] failed to load cohort groups:', e); }
  // Per-chrom
  const ck = _mgChromKey();
  if (ck) {
    try {
      const raw = localStorage.getItem(ck);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && Array.isArray(obj.groups)) {
          for (const g of obj.groups) out.push({ ...g, scope: 'chrom' });
        }
      }
    } catch (e) { console.warn('[mg] failed to load chrom groups:', e); }
  }
  return out;
}

// --- saveManualGroups (legacy 47942-47961) ---
// Persist: split current groups by scope, save into the two namespaces.
function saveManualGroups() {
  const state = _pageState;
  const groups = (state && state.manualGroups) || [];
  const cohort = groups.filter(g => g.scope === 'cohort');
  const chrom  = groups.filter(g => g.scope !== 'cohort');
  try {
    localStorage.setItem(_mgCohortKey(),
      JSON.stringify({ groups: cohort.map(_mgPick) }));
  } catch (e) {}
  const ck = _mgChromKey();
  if (ck) {
    try {
      localStorage.setItem(ck,
        JSON.stringify({ groups: chrom.map(_mgPick) }));
    } catch (e) {}
  }
}
function _mgPick(g) {
  return { id: g.id, name: g.name, color: g.color, members: g.members.slice() };
}

// --- _mgNextColor (legacy 47963-47968) ---
// Pick the next available palette color (least-used).
function _mgNextColor() {
  const state = _pageState;
  const inUse = new Set(((state && state.manualGroups) || []).map(g => g.color));
  for (const c of MG_PALETTE) if (!inUse.has(c)) return c;
  return MG_PALETTE[(((state && state.manualGroups) || []).length) % MG_PALETTE.length];
}

// --- _mgNewId (legacy 47971-47973) ---
// Generate a fresh group id (mongo-style short hex).
function _mgNewId() {
  return 'mg_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
}

// --- _mgSiToCga (legacy 47977-47980) ---
// Convert scrubber sample-index to CGA name (for storage). Falls back to
// ind or sample_id if cga is missing.
function _mgSiToCga(si) {
  const state = _pageState;
  const s = state && state.data && state.data.samples && state.data.samples[si];
  return s ? String(s.cga || s.ind || s.sample_id || si) : String(si);
}

// --- _mgCgaToSi (legacy 47984-47997) ---
// Convert CGA name back to scrubber sample-index. Builds a name->index map
// once per data load, cached on state.data.
function _mgCgaToSi(cga) {
  const state = _pageState;
  if (!state || !state.data) return -1;
  if (!state.data.__mg_name_map) {
    const m = new Map();
    state.data.samples.forEach((s, i) => {
      if (!s) return;
      const k = String(s.cga || s.ind || s.sample_id || i);
      m.set(k, i);
    });
    state.data.__mg_name_map = m;
  }
  const v = state.data.__mg_name_map.get(String(cga));
  return v == null ? -1 : v;
}

// --- manualGroupForSample (legacy 47999-48009) ---
// Resolve the active group for a sample-index (or null). Membership is
// exclusive: first group containing si wins. If we ever loosen exclusivity,
// this becomes a list.
export function manualGroupForSample(si) {
  const state = _pageState;
  const cga = _mgSiToCga(si);
  const groups = (state && state.manualGroups) || [];
  for (const g of groups) {
    if (g.members.includes(cga)) return g;
  }
  return null;
}

// --- addToManualGroup (legacy 48019-48048) ---
// Add (or extend) a group with the given member sample-indices. If the
// group name already exists, extend it; otherwise create new. Removes
// those samples from any other group (exclusivity).
export function addToManualGroup(name, sampleIndices, opts) {
  const state = _pageState;
  if (!Array.isArray(sampleIndices) || sampleIndices.length === 0) return null;
  if (!state.manualGroups) state.manualGroups = [];
  opts = opts || {};
  const wantedScope = opts.scope === 'cohort' ? 'cohort' : 'chrom';
  const cgas = sampleIndices.map(_mgSiToCga).filter(Boolean);
  // Remove these CGAs from any existing group (exclusivity)
  for (const g of state.manualGroups) {
    g.members = g.members.filter(c => !cgas.includes(c));
  }
  // Find or create
  let g = state.manualGroups.find(x => x.name === name);
  if (!g) {
    g = { id: _mgNewId(), name, color: opts.color || _mgNextColor(),
          scope: wantedScope, members: [] };
    state.manualGroups.push(g);
  }
  // Merge new members (preserve insertion order, dedupe)
  for (const c of cgas) if (!g.members.includes(c)) g.members.push(c);
  // Drop any group that ended up empty
  state.manualGroups = state.manualGroups.filter(x => x.members.length > 0);
  saveManualGroups();
  renderManualGroupsList();
  // Trigger re-render of views that depend on coloring
  if (state.colorMode === 'manual' && state.data) {
    try { drawPCA(state); } catch (_) {}
    try { renderL3Panel(state); } catch (_) {}
  }
  return g;
}

// --- removeManualGroup (legacy 48050-48059) ---
export function removeManualGroup(groupId) {
  const state = _pageState;
  if (!state.manualGroups) return;
  state.manualGroups = state.manualGroups.filter(g => g.id !== groupId);
  saveManualGroups();
  renderManualGroupsList();
  if (state.colorMode === 'manual' && state.data) {
    try { drawPCA(state); } catch (_) {}
    try { renderL3Panel(state); } catch (_) {}
  }
}

// --- renameManualGroup (legacy 48061-48077) ---
export function renameManualGroup(groupId, newName) {
  const state = _pageState;
  if (!state.manualGroups) return;
  const g = state.manualGroups.find(x => x.id === groupId);
  if (!g) return;
  newName = String(newName || '').trim().slice(0, 40);
  if (!newName) return;
  // If the new name collides, merge into the existing group of that name
  const collision = state.manualGroups.find(x => x !== g && x.name === newName);
  if (collision) {
    for (const c of g.members) if (!collision.members.includes(c)) collision.members.push(c);
    state.manualGroups = state.manualGroups.filter(x => x.id !== g.id);
  } else {
    g.name = newName;
  }
  saveManualGroups();
  renderManualGroupsList();
}

// --- toggleManualGroupScope (legacy 48079-48086) ---
export function toggleManualGroupScope(groupId) {
  const state = _pageState;
  if (!state.manualGroups) return;
  const g = state.manualGroups.find(x => x.id === groupId);
  if (!g) return;
  g.scope = (g.scope === 'cohort') ? 'chrom' : 'cohort';
  saveManualGroups();
  renderManualGroupsList();
}

// --- clearAllManualGroups (legacy 48088-48100) ---
export function clearAllManualGroups() {
  const state = _pageState;
  state.manualGroups = [];
  // Clear both namespaces (chrom + cohort)
  try {
    if (_mgChromKey()) localStorage.removeItem(_mgChromKey());
    localStorage.removeItem(_mgCohortKey());
  } catch (e) {}
  renderManualGroupsList();
  if (state.colorMode === 'manual' && state.data) {
    try { drawPCA(state); } catch (_) {}
    try { renderL3Panel(state); } catch (_) {}
  }
}

// --- manualGroupFromTracked (legacy 48103-48114) ---
// Add tracked samples to a new group with auto-generated name.
export function manualGroupFromTracked() {
  const state = _pageState;
  if (!state.tracked || state.tracked.length === 0) {
    if (typeof alert === 'function') alert('No tracked samples. Click samples in the PCA first.');
    return;
  }
  // Default name: increment until free
  const groups = state.manualGroups || [];
  let n = groups.length + 1;
  let name;
  do { name = 'group_' + n++; } while (groups.some(g => g.name === name) && n < 100);
  return addToManualGroup(name, state.tracked.slice());
}

// --- manualGroupFromBand (legacy 48117-48146) ---
// Add all samples currently in K-means cluster k of the focal L2.
export function manualGroupFromBand(k) {
  const state = _pageState;
  if (!state.data) return null;
  const curL2 = state.windowToL2 ? state.windowToL2[state.cur] : -1;
  if (curL2 == null || curL2 < 0) {
    if (typeof alert === 'function') alert('No focal L2 envelope at the current window.');
    return null;
  }
  const cl = (typeof getL2Cluster === 'function') ? getL2Cluster(state, curL2) : null;
  if (!cl || !cl.labels) {
    if (typeof alert === 'function') alert('Cluster info not available for this L2.');
    return null;
  }
  if (k >= (cl.usedK != null ? cl.usedK : state.k)) {
    if (typeof alert === 'function') alert(`K=${cl.usedK || state.k} for this L2; cluster k${k} doesn't exist.`);
    return null;
  }
  const members = [];
  for (let si = 0; si < cl.labels.length; si++) {
    if (cl.labels[si] === k) members.push(si);
  }
  if (members.length === 0) {
    if (typeof alert === 'function') alert(`No samples in cluster k${k}.`);
    return null;
  }
  // Default name: <env>_k<k>
  const env = state.data.l2_envelopes[curL2];
  const envTag = env && env.candidate_id ? String(env.candidate_id).split('_').pop() : 'L2';
  const name = `${envTag}_k${k}`;
  return addToManualGroup(name, members);
}

// --- renderManualGroupsList (legacy 48152-48191) ---
// Render the sidebar list. Idempotent — safe to call any time.
// v4 turn 73c: dual-writes into both #manualGroupsList (sidebar) and
// #manualGroupsListCompact (compact panel). Same HTML in both; click
// delegation is set up on both containers in the wiring section.
// turn 135 Slice 1 (SPEC_g_panel_unified_groups.md): popup re-host.
// The G-panel manual tab body holds a #manualGroupsListPopup div.
// When the popup is open, this renderer also fills it so the single
// source of truth (state.manualGroups) drives all three surfaces.
export function renderManualGroupsList() {
  const state = _pageState;
  const containers = [];
  if (typeof document !== 'undefined') {
    const sidebar = document.getElementById('manualGroupsList');
    const compact = document.getElementById('manualGroupsListCompact');
    const popup   = document.getElementById('manualGroupsListPopup');
    if (sidebar) containers.push(sidebar);
    if (compact) containers.push(compact);
    if (popup)   containers.push(popup);
  }
  if (containers.length === 0) return;
  const groups = (state && state.manualGroups) || [];
  if (groups.length === 0) {
    const emptyHtml = '<div class="mg-empty">No groups yet — pick samples or grab a K-band.</div>';
    for (const box of containers) box.innerHTML = emptyHtml;
    return;
  }
  let html = '';
  for (const g of groups) {
    const pinClass = g.scope === 'cohort' ? 'mg-pin pinned' : 'mg-pin';
    const pinTitle = g.scope === 'cohort'
      ? 'Pinned to cohort — follows you across chromosomes (click to unpin)'
      : 'Per-chromosome — click to pin to cohort';
    html += `<div class="mg-row" data-mgid="${g.id}">` +
      `<span class="mg-swatch" style="background:${g.color}"></span>` +
      `<span class="mg-name" contenteditable="true" spellcheck="false" ` +
      `data-mgid="${g.id}">${escapeHtml(g.name)}</span>` +
      `<span class="mg-count">n=${g.members.length}</span>` +
      `<button class="${pinClass}" data-mgid="${g.id}" title="${pinTitle}">📌</button>` +
      `<button class="mg-del" data-mgid="${g.id}" title="Remove this group">×</button>` +
      `</div>`;
  }
  for (const box of containers) box.innerHTML = html;
}

// --- exportManualGroupsTSV (legacy 48202-48224) ---
// Export current groups as a 4-column TSV: cga, group_name, color, scope
export function exportManualGroupsTSV() {
  const state = _pageState;
  const groups = (state && state.manualGroups) || [];
  if (groups.length === 0) {
    if (typeof alert === 'function') alert('No groups to export.');
    return;
  }
  const rows = ['cga\tgroup_name\tcolor\tscope'];
  for (const g of groups) {
    for (const c of g.members) {
      rows.push(`${c}\t${g.name}\t${g.color}\t${g.scope}`);
    }
  }
  const blob = new Blob([rows.join('\n') + '\n'], { type: 'text/tab-separated-values' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const chrom = state.data ? state.data.chrom : 'cohort';
  a.href = url;
  a.download = `manual_groups.${chrom}.tsv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- importManualGroupsTSV (legacy 48228-48269) ---
// Import groups from TSV. Tolerant: accepts header row
// "cga[\t]group_name[\t]color[\t]scope" or just two columns
// "cga\tgroup_name". Replaces the current groups (with confirmation).
export function importManualGroupsTSV(text) {
  const state = _pageState;
  if (!text || typeof text !== 'string') return;
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return;
  // Detect header
  const first = lines[0].toLowerCase();
  const hasHeader = first.startsWith('cga') || first.includes('group_name');
  const dataLines = hasHeader ? lines.slice(1) : lines;
  // Parse rows -> map by group name
  const groupMap = new Map();
  for (const line of dataLines) {
    const parts = line.split('\t').map(p => p.trim());
    if (parts.length < 2) continue;
    const cga = parts[0];
    const name = parts[1];
    const color = parts[2] || null;
    const scope = (parts[3] === 'cohort') ? 'cohort' : 'chrom';
    if (!cga || !name) continue;
    let g = groupMap.get(name);
    if (!g) {
      g = { id: _mgNewId(), name, color: color || _mgNextColor(),
            scope, members: [] };
      groupMap.set(name, g);
    }
    if (!g.members.includes(cga)) g.members.push(cga);
  }
  if (groupMap.size === 0) {
    if (typeof alert === 'function') alert('No valid rows found in the TSV.');
    return;
  }
  if (typeof confirm === 'function' &&
      state.manualGroups && state.manualGroups.length > 0) {
    if (!confirm(`Import ${groupMap.size} groups? Existing groups will be replaced.`)) return;
  }
  state.manualGroups = Array.from(groupMap.values());
  saveManualGroups();
  renderManualGroupsList();
  if (state.colorMode === 'manual' && state.data) {
    try { drawPCA(state); } catch (_) {}
    try { renderL3Panel(state); } catch (_) {}
  }
}

// --- _mgRefreshOnDataLoad (legacy 56669-56686) ---
// Initial load — runs once at startup AND whenever data is loaded (via
// the hook in applyData). Loads cohort + per-chrom groups and drops
// CGAs not present in the current precomp.
export function _mgRefreshOnDataLoad() {
  const state = _pageState;
  if (!state) return;
  state.manualGroups = loadManualGroups();
  // Drop any members whose CGAs aren't in the current precomp
  if (state.data && state.manualGroups.length > 0) {
    const dropped = [];
    for (const g of state.manualGroups) {
      const before = g.members.length;
      g.members = g.members.filter(c => _mgCgaToSi(c) >= 0);
      const after = g.members.length;
      if (before !== after) dropped.push(`${g.name}: ${before-after} of ${before}`);
    }
    state.manualGroups = state.manualGroups.filter(g => g.members.length > 0);
    if (dropped.length > 0) {
      console.warn('[mg] dropped samples not in current precomp:', dropped);
    }
  }
  renderManualGroupsList();
}
