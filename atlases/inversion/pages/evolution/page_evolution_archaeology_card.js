// pages/evolution/page_evolution_archaeology_card.js
// =====================================================================
// Step-6 synthesis card. Consumes a pre-computed metrics bag (or
// computes one inline from the standard inputs) and renders a single
// verdict + reason + interpretation + per-metric numeric table.
//
// Input contract:
//   atlasState.inversion.archaeology_card_state = {
//     metrics: {
//       pi_inv, pi_std, dxy, fst_hudson,
//       private_inv, private_std, fixed_differences,
//       arrangement_frequency?, leakage_score?, n_regimes?,
//       outgroup_present?, polarity_verdict?, age_class?,
//     },
//     candidate_label?, opts?
//   }
// =====================================================================

import { _pageState, _setActiveState } from './page_evolution_archaeology_card/_state.js';
import { buildArchaeologyCard } from '../../shared/mgl_archaeology_classifier.js';

const VERDICT_COLOR = Object.freeze({
  young_clean:       '#3074C8',
  old_divergent:     '#D04545',
  old_swept:         '#A060B8',
  old_leaky:         '#D8A030',
  complex_nested:    '#705090',
  recently_swept:    '#3DB5C0',
  unresolved:        '#888888',
  insufficient:      '#888888',
});

const VERDICT_LABEL = Object.freeze({
  young_clean:    'Young, clean',
  old_divergent:  'Old, divergent',
  old_swept:      'Old, swept',
  old_leaky:      'Old, leaky',
  complex_nested: 'Complex / nested',
  recently_swept: 'Recently swept',
  unresolved:     'Unresolved',
  insufficient:   'Insufficient data',
});

export function refreshArchaeology(state) {
  if (state) _setActiveState(state);
  _renderHeader(_pageState);
  _renderBoxes(_pageState);
  _renderMetrics(_pageState);
  _renderConfidence(_pageState);
}

export function initArchaeologyToolbar() { /* none */ }

export async function mount(root, atlasState, registry) {
  const pageState = _buildPageState(atlasState);
  _setActiveState(pageState);
  try { refreshArchaeology(pageState); }
  catch (e) { console.warn('page_evolution_archaeology_card.mount: refresh threw —', e); }
  if (atlasState.inversion) {
    atlasState.inversion._page_archaeology_card_state = pageState;
  }
}
export async function unmount(root) { _setActiveState(null); }

function _buildPageState(atlasState) {
  const inv = (atlasState && atlasState.inversion) || {};
  const src = inv.archaeology_card_state || null;
  const card = src && src.metrics
    ? buildArchaeologyCard(src.metrics, src.opts || {})
    : null;
  return {
    source:          src,
    candidate_label: src ? (src.candidate_label || null) : null,
    card,
  };
}

function _renderHeader(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const lbl = document.getElementById('acCandidateLabel');
  if (lbl) lbl.textContent = state.candidate_label || '—';
  const b = document.getElementById('acVerdictBadge');
  if (b) {
    if (state.card && state.card.verdict) {
      b.textContent = VERDICT_LABEL[state.card.verdict] || state.card.verdict;
      b.style.background = VERDICT_COLOR[state.card.verdict] || '#888';
      b.style.color = '#fff';
    } else {
      b.textContent = '—'; b.style.background = ''; b.style.color = '';
    }
  }
}

function _renderBoxes(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const reason = document.getElementById('acReasonBox');
  const interp = document.getElementById('acInterpretationBox');
  const empty  = document.getElementById('acEmpty');
  if (!state.card) {
    if (reason) reason.textContent = '—';
    if (interp) interp.textContent = '—';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (reason) reason.textContent = state.card.reason || '—';
  if (interp) interp.textContent = state.card.interpretation || '—';
}

function _renderMetrics(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const body = document.getElementById('acMetricsBody');
  if (!body) return;
  if (!state.card || !state.card.metrics) {
    body.innerHTML = '<dt class="empty">—</dt><dd>—</dd>';
    return;
  }
  const m = state.card.metrics;
  const f = (v, n=4) => Number.isFinite(v) ? v.toFixed(n) : '—';
  const labels = [
    ['π_INV',                  f(m.pi_inv)],
    ['π_STD',                  f(m.pi_std)],
    ['dXY',                    f(m.dxy)],
    ['FST (Hudson)',           f(m.fst_hudson)],
    ['private INV',            m.private_inv ?? '—'],
    ['private STD',            m.private_std ?? '—'],
    ['fixed diffs',            m.fixed_differences ?? '—'],
    ['frequency',              f(m.arrangement_frequency, 3)],
    ['leakage',                f(m.leakage_score, 3)],
    ['n_regimes',              m.n_regimes ?? '—'],
    ['outgroup',               m.outgroup_present ? 'present' : 'absent'],
    ['polarity',               m.polarity_verdict || '—'],
    ['age_class',              m.age_class || '—'],
  ];
  let html = '';
  for (const [k, v] of labels) html += `<dt>${k}</dt><dd>${v}</dd>`;
  body.innerHTML = html;
}

function _renderConfidence(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const body = document.getElementById('acConfBody');
  if (!body) return;
  if (!state.card) { body.textContent = '—'; return; }
  body.textContent = Number.isFinite(state.card.confidence)
    ? (state.card.confidence * 100).toFixed(0) + '%'
    : '—';
}
