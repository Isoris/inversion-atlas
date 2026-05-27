// pages/evolution/polarize_synteny_vote.js
// =====================================================================
// Outgroup-synteny polarization cartridge. Light-weight: consumes
// pre-computed per-species votes, renders a simple horizontal
// stacked bar (A / B / unresolved) plus a per-species table.
//
// Input contract:
//   atlasState.inversion.polarize_synteny_state = {
//     votes: Array<{species, vote, confidence?, notes?}>,
//     candidate_label?: string,
//     opts?: { min_resolved_votes?, polarization_margin? },
//   }
// =====================================================================

import { _pageState, _setActiveState }
  from './polarize_synteny_vote/_state.js';
import { applyOnboarding, resetOnboarding } from '../../shared/onboarding.js';
import {
  normaliseSyntenyEntry,
  aggregateSyntenyVotes,
  MGL_SYNTENY_VOTES,
} from '../../shared/mgl_outgroup_synteny.js';

const VERDICT_LABEL = Object.freeze({
  'ancestral=A':      'Ancestral = A · B derived',
  'ancestral=B':      'Ancestral = B · A derived',
  'unpolarized':      'Unpolarized',
  'insufficient_data':'Insufficient data',
});

const VOTE_COLOR = Object.freeze({
  matches_A:  '#3074C8',
  matches_B:  '#D04545',
  unresolved: '#888888',
});

export function refreshSynteny(state) {
  if (state) _setActiveState(state);
  _renderHeader(_pageState);
  _paintBar(_pageState);
  _renderVotes(_pageState);
}

export function initSyntenyToolbar() { /* no toolbar inputs */ }

export async function mount(root, atlasState, registry) {
  resetOnboarding('polarize_synteny_vote');
  const pageState = _buildPageState(atlasState);
  _setActiveState(pageState);
  try { refreshSynteny(pageState); }
  catch (e) { console.warn('polarize_synteny_vote.mount: refresh threw —', e); }
  if (atlasState.inversion) {
    atlasState.inversion._page_polarize_synteny_vote_state = pageState;
  }
}

export async function unmount(root) { _setActiveState(null); }

function _buildPageState(atlasState) {
  const inv = (atlasState && atlasState.inversion) || {};
  const src = inv.polarize_synteny_state || null;
  const entries = (src && Array.isArray(src.votes))
    ? src.votes.map(normaliseSyntenyEntry).filter(Boolean)
    : [];
  const aggregate = aggregateSyntenyVotes(entries, src ? src.opts : {});
  return {
    source:           src,
    candidate_label:  src ? (src.candidate_label || null) : null,
    entries,
    aggregate,
  };
}

function _renderHeader(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const lbl = document.getElementById('syntenyCandidateLabel');
  if (lbl) lbl.textContent = state.candidate_label || '—';
  const b = document.getElementById('syntenyVerdictBadge');
  if (b) b.textContent = VERDICT_LABEL[state.aggregate.verdict] || state.aggregate.verdict;
  const s = document.getElementById('syntenyVoteSummary');
  if (s) {
    s.textContent = `A=${state.aggregate.n_a} · B=${state.aggregate.n_b} · ?=${state.aggregate.n_unresolved}`;
  }
}

function _paintBar(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const canvas = document.getElementById('syntenyCanvas');
  const empty  = document.getElementById('syntenyEmpty');
  if (!canvas) return;
  if (!state.entries || state.entries.length === 0) {
    if (empty) { empty.style.display = ''; applyOnboarding('polarize_synteny_vote'); }
    if (canvas.getContext) {
      const ctx = canvas.getContext('2d');
      if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, canvas.width || 600, canvas.height || 80);
    }
    return;
  }
  if (empty) empty.style.display = 'none';
  const ctx = canvas.getContext('2d');
  const W = canvas.width || 600;
  const H = canvas.height || 80;
  if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, W, H);
  const total = state.aggregate.n_a + state.aggregate.n_b + state.aggregate.n_unresolved;
  if (total === 0) return;
  const padX = 16, padY = 24;
  const barH = Math.max(20, H - 2 * padY);
  const barW = Math.max(50, W - 2 * padX);
  let x = padX;
  const segs = [
    { label: 'A', n: state.aggregate.n_a, color: VOTE_COLOR.matches_A },
    { label: 'B', n: state.aggregate.n_b, color: VOTE_COLOR.matches_B },
    { label: '?', n: state.aggregate.n_unresolved, color: VOTE_COLOR.unresolved },
  ];
  ctx.font = '11px sans-serif';
  for (const seg of segs) {
    const w = (seg.n / total) * barW;
    ctx.fillStyle = seg.color;
    if (typeof ctx.fillRect === 'function' && w > 0) ctx.fillRect(x, padY, w, barH);
    if (typeof ctx.fillText === 'function' && w > 14) {
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${seg.label}: ${seg.n}`, x + 4, padY + barH / 2 + 4);
    }
    x += w;
  }
  ctx.strokeStyle = 'rgba(40,50,70,0.6)';
  ctx.lineWidth = 1;
  if (typeof ctx.strokeRect === 'function') ctx.strokeRect(padX, padY, barW, barH);
}

function _renderVotes(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const body = document.getElementById('syntenyVotesBody');
  if (!body) return;
  if (!state.entries || state.entries.length === 0) {
    body.innerHTML = '<span class="empty">No votes</span>';
    return;
  }
  let html = '';
  for (const e of state.entries) {
    const c = VOTE_COLOR[e.vote] || '#888';
    html += `<div class="syn-vote-row">`
         +    `<span class="syn-vote-swatch" style="background:${c}"></span>`
         +    `<span class="syn-vote-species">${e.species || '?'}</span> `
         +    `<span class="syn-vote-tag">${e.vote}</span>`
         +    (Number.isFinite(e.confidence)
              ? ` <span class="syn-vote-conf">conf ${e.confidence.toFixed(2)}</span>` : '')
         + '</div>';
  }
  body.innerHTML = html;
}
