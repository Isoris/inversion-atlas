// pages/evolution/page_evolution_age.js
// =====================================================================
// Deep-divergence + age-class cartridge. Renders 4 sparkline-style
// summary bars (pi_inv, pi_std, dxy, FST) + private/fixed counts +
// age-class verdict.
//
// Input contract:
//   atlasState.inversion.age_state = {
//     dosage, n_markers, n_samples, inv_idx, std_idx,
//     candidate_label?, opts?
//   }
// =====================================================================

import { _pageState, _setActiveState } from './page_evolution_age/_state.js';
import { computeDivergence } from '../../shared/mgl_inversion_divergence.js';

const AGE_CLASS_LABEL = Object.freeze({
  young_clean:        'Young, clean',
  old_divergent:      'Old, divergent',
  old_swept:          'Old, swept',
  leaky:              'Old, leaky',
  complex_or_unclear: 'Complex / unclear',
  insufficient:      'Insufficient data',
});

const AGE_CLASS_COLOR = Object.freeze({
  young_clean:        '#3074C8',
  old_divergent:      '#D04545',
  old_swept:          '#A060B8',
  leaky:              '#D8A030',
  complex_or_unclear: '#888888',
  insufficient:       '#888888',
});

export function refreshAge(state) {
  if (state) _setActiveState(state);
  _renderHeader(_pageState);
  _paintBars(_pageState);
  _renderMetrics(_pageState);
  _renderReason(_pageState);
}

export function initAgeToolbar() { /* no toolbar */ }

export async function mount(root, atlasState, registry) {
  const pageState = _buildPageState(atlasState);
  _setActiveState(pageState);
  try { refreshAge(pageState); }
  catch (e) { console.warn('page_evolution_age.mount: refresh threw —', e); }
  if (atlasState.inversion) {
    atlasState.inversion._page_age_state = pageState;
  }
}
export async function unmount(root) { _setActiveState(null); }

function _buildPageState(atlasState) {
  const inv = (atlasState && atlasState.inversion) || {};
  const src = inv.age_state || null;
  const metrics = src ? computeDivergence(src) : null;
  return {
    source:          src,
    candidate_label: src ? (src.candidate_label || null) : null,
    metrics,
  };
}

function _renderHeader(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const lbl = document.getElementById('ageCandidateLabel');
  if (lbl) lbl.textContent = state.candidate_label || '—';
  const b = document.getElementById('ageClassBadge');
  if (b) {
    if (state.metrics && state.metrics.age_class) {
      b.textContent = AGE_CLASS_LABEL[state.metrics.age_class] || state.metrics.age_class;
      b.style.background = AGE_CLASS_COLOR[state.metrics.age_class] || '#888';
      b.style.color = '#fff';
    } else {
      b.textContent = '—'; b.style.background = ''; b.style.color = '';
    }
  }
}

function _paintBars(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const canvas = document.getElementById('ageCanvas');
  const empty  = document.getElementById('ageEmpty');
  if (!canvas) return;
  if (!state.metrics || state.metrics.n_sites_evaluated === 0) {
    if (empty) empty.style.display = '';
    if (canvas.getContext) {
      const ctx = canvas.getContext('2d');
      if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, canvas.width || 600, canvas.height || 220);
    }
    return;
  }
  if (empty) empty.style.display = 'none';
  const ctx = canvas.getContext('2d');
  const W = canvas.width || 600;
  const H = canvas.height || 220;
  if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, W, H);
  const m = state.metrics;
  // 4 horizontal bars: pi_inv, pi_std, dxy (shared scale 0..0.03),
  // FST (scale 0..1).
  const labels = ['π_INV', 'π_STD', 'dXY', 'FST'];
  const vals   = [m.pi_inv, m.pi_std, m.dxy, m.fst_hudson];
  const maxes  = [0.03, 0.03, 0.03, 1.0];
  const colors = ['#3074C8', '#2BAA50', '#D04545', '#705090'];
  const padX = 60, padY = 20;
  const barH = 24, gap = 8;
  const barW = Math.max(50, W - 2 * padX);
  ctx.font = '11px sans-serif';
  for (let i = 0; i < 4; i++) {
    const y = padY + i * (barH + gap);
    ctx.fillStyle = 'rgba(40,50,70,0.7)';
    if (typeof ctx.fillText === 'function') ctx.fillText(labels[i], 8, y + barH / 2 + 4);
    ctx.fillStyle = 'rgba(220,220,220,0.6)';
    if (typeof ctx.fillRect === 'function') ctx.fillRect(padX, y, barW, barH);
    const v = vals[i];
    if (Number.isFinite(v)) {
      const t = Math.max(0, Math.min(1, v / maxes[i]));
      ctx.fillStyle = colors[i];
      if (typeof ctx.fillRect === 'function') ctx.fillRect(padX, y, barW * t, barH);
      ctx.fillStyle = 'rgba(40,50,70,0.95)';
      if (typeof ctx.fillText === 'function') {
        ctx.fillText(v.toFixed(4), padX + barW + 6, y + barH / 2 + 4);
      }
    }
  }
  ctx.strokeStyle = 'rgba(40,50,70,0.6)';
  if (typeof ctx.strokeRect === 'function') {
    ctx.strokeRect(padX, padY, barW, 4 * barH + 3 * gap);
  }
}

function _renderMetrics(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const body = document.getElementById('ageMetricsBody');
  if (!body) return;
  const m = state.metrics;
  if (!m) { body.innerHTML = '<dt class="empty">—</dt><dd>—</dd>'; return; }
  const f = (v) => Number.isFinite(v) ? v.toFixed(4) : '—';
  let html = '';
  html += `<dt>π_INV</dt><dd>${f(m.pi_inv)}</dd>`;
  html += `<dt>π_STD</dt><dd>${f(m.pi_std)}</dd>`;
  html += `<dt>dXY</dt><dd>${f(m.dxy)}</dd>`;
  html += `<dt>FST (Hudson)</dt><dd>${f(m.fst_hudson)}</dd>`;
  html += `<dt>private INV</dt><dd>${m.private_inv}</dd>`;
  html += `<dt>private STD</dt><dd>${m.private_std}</dd>`;
  html += `<dt>fixed diffs</dt><dd>${m.fixed_differences}</dd>`;
  html += `<dt>sites evaluated</dt><dd>${m.n_sites_evaluated}</dd>`;
  html += `<dt>sites skipped</dt><dd>${m.n_skipped}</dd>`;
  body.innerHTML = html;
}

function _renderReason(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const body = document.getElementById('ageReasonBody');
  if (!body) return;
  if (!state.metrics) { body.textContent = '—'; return; }
  body.textContent = state.metrics.age_class_reason || '—';
}
