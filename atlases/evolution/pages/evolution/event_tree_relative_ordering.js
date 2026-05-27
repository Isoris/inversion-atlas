// pages/evolution/event_tree_relative_ordering.js
// =====================================================================
// Relative-ordering cartridge across multiple inversion candidates.
// Renders a per-candidate × per-candidate overlap matrix coloured by
// relationship (nested / sister / independent / mutual_exclusive).
//
// Input contract:
//   atlasState.inversion.event_tree_state = {
//     carriers: Uint8Array | number[],  n_samples × n_candidates row-major
//     n_samples, n_candidates,
//     per_candidate?: Array<{id, label?, pi_inv?, dxy?, fst?,
//                             private_inv?, outgroup_present?, ...}>,
//     chrom_label?, opts?
//   }
// =====================================================================

import { _pageState, _setActiveState } from './event_tree_relative_ordering/_state.js';
import { buildEventTree } from '../../shared/mgl_event_tree.js';
import { applyOnboarding, resetOnboarding } from '../../shared/onboarding.js';

const REL_COLOR = Object.freeze({
  nested:           '#3074C8',
  sister:           '#A060B8',
  independent:      '#888888',
  mutual_exclusive: '#D04545',
});

export function refreshEventTree(state) {
  if (state) _setActiveState(state);
  _renderHeader(_pageState);
  _paintCanvas(_pageState);
  _renderPairs(_pageState);
  _renderAges(_pageState);
}

export function initEventTreeToolbar() { /* no toolbar */ }

export async function mount(root, atlasState, registry) {
  resetOnboarding('event_tree_relative_ordering');
  const pageState = _buildPageState(atlasState);
  _setActiveState(pageState);
  try { refreshEventTree(pageState); }
  catch (e) { console.warn('event_tree_relative_ordering.mount: refresh threw —', e); }
  if (atlasState.inversion) {
    atlasState.inversion._page_event_tree_relative_ordering_state = pageState;
  }
}
export async function unmount(root) { _setActiveState(null); }

function _buildPageState(atlasState) {
  const inv = (atlasState && atlasState.inversion) || {};
  const src = inv.event_tree_state || null;
  let tree = null;
  if (src && src.carriers && (src.n_samples > 0) && (src.n_candidates > 0)) {
    const carriers = src.carriers instanceof Uint8Array
      ? src.carriers
      : Uint8Array.from(src.carriers);
    tree = buildEventTree({
      carriers,
      n_samples: src.n_samples,
      n_candidates: src.n_candidates,
      per_candidate: src.per_candidate || null,
      opts: src.opts || {},
    });
  }
  return {
    source:      src,
    chrom_label: src ? (src.chrom_label || null) : null,
    tree,
  };
}

function _renderHeader(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const lbl = document.getElementById('etChromLabel');
  if (lbl) lbl.textContent = state.chrom_label || '—';
  const sb = document.getElementById('etSummaryBadge');
  if (sb) {
    if (state.tree && state.tree.pairs) {
      const counts = { nested: 0, sister: 0, independent: 0, mutual_exclusive: 0 };
      for (const p of state.tree.pairs) counts[p.relationship] = (counts[p.relationship] || 0) + 1;
      sb.textContent = `nested ${counts.nested} · sister ${counts.sister} · `
                     + `indep ${counts.independent} · excl ${counts.mutual_exclusive}`;
    } else { sb.textContent = '—'; }
  }
}

function _paintCanvas(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const canvas = document.getElementById('etCanvas');
  const empty  = document.getElementById('etEmpty');
  if (!canvas) return;
  if (!state.tree || !state.tree.pair_overlap || state.tree.pair_overlap.length === 0) {
    if (empty) { empty.style.display = ''; applyOnboarding('event_tree_relative_ordering'); }
    if (canvas.getContext) {
      const ctx = canvas.getContext('2d');
      if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, canvas.width || 600, canvas.height || 400);
    }
    return;
  }
  if (empty) empty.style.display = 'none';
  const ctx = canvas.getContext('2d');
  const W = canvas.width || 600;
  const H = canvas.height || 400;
  if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, W, H);
  const n = state.source.n_candidates;
  const pad = 28;
  const cellW = Math.max(8, (W - 2 * pad) / n);
  const cellH = Math.max(8, (H - 2 * pad) / n);
  // Build a lookup of pairs by (a, b) ordered.
  const relMap = new Map();
  for (const p of state.tree.pairs) {
    relMap.set(p.a + '|' + p.b, p.relationship);
    relMap.set(p.b + '|' + p.a, p.relationship);
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const rel = (i === j) ? 'self' : relMap.get(i + '|' + j);
      let color = '#dddddd';
      if (i === j) color = 'rgba(40,50,70,0.85)';
      else if (rel) color = REL_COLOR[rel] || '#888';
      ctx.fillStyle = color;
      if (typeof ctx.fillRect === 'function') {
        ctx.fillRect(pad + j * cellW, pad + i * cellH, cellW + 0.5, cellH + 0.5);
      }
    }
  }
  ctx.strokeStyle = 'rgba(40,50,70,0.6)';
  ctx.lineWidth = 1;
  if (typeof ctx.strokeRect === 'function') ctx.strokeRect(pad, pad, cellW * n, cellH * n);
}

function _renderPairs(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const body = document.getElementById('etPairsBody');
  if (!body) return;
  if (!state.tree || !state.tree.pairs || state.tree.pairs.length === 0) {
    body.innerHTML = '<span class="empty">—</span>';
    return;
  }
  const labelFor = (idx) => {
    const c = state.source.per_candidate && state.source.per_candidate[idx];
    return (c && (c.label || c.id)) || ('inv ' + idx);
  };
  let html = '';
  for (const p of state.tree.pairs) {
    const c = REL_COLOR[p.relationship] || '#888';
    html += `<div class="et-pair-row">`
         +    `<span class="et-pair-swatch" style="background:${c}"></span>`
         +    `<span class="et-pair-label">${labelFor(p.a)} ↔ ${labelFor(p.b)}</span> `
         +    `<span class="et-pair-rel">${p.relationship}</span> `
         +    `<span class="et-pair-evidence">${p.evidence}</span>`
         + '</div>';
  }
  body.innerHTML = html;
}

function _renderAges(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const body = document.getElementById('etAgeBody');
  if (!body) return;
  if (!state.tree || !state.tree.age_rank || state.tree.age_rank.length === 0) {
    body.innerHTML = '<span class="empty">—</span>';
    return;
  }
  let html = '';
  for (const r of state.tree.age_rank) {
    html += `<div class="et-age-row">`
         +    `<span class="et-age-rank">rank ${r.age_rank}</span> `
         +    `<span class="et-age-id">${r.id}</span> `
         +    `<span class="et-age-score">score ${r.age_score}</span>`
         + '</div>';
  }
  body.innerHTML = html;
}
