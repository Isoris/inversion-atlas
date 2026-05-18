// pages/review/fish_ancestry_scroller/right_panel.js
// =====================================================================
// Right side panel — three blocks per spec §"Right side panel":
//   Block 1 — Context explainer card
//   Block 2 — View-mode + overlay controls
//   Block 3 — Selected brick card
// =====================================================================

import { ANCESTRY_K_COLORS } from './layers.js';

/** Spec §Block 1 — three plain-language layer descriptions. */
export const CONTEXT_CARD_ITEMS = Object.freeze([
  {
    label: '① PC1 Band / Regime',
    text: 'Local structural pattern (from PCA). Shows bands that correspond to standard / heterozygote / inversion patterns.',
  },
  {
    label: '② Ancestry Bricks',
    text: 'Local ancestry composition (Q) aligned to global K. Bricks are merged segments of coherent ancestry.',
  },
  {
    label: 'Brick metrics',
    text: 'Quantify how unusual or uncertain each brick is (ΔQ, heterozygosity, entropy, confidence, concordance).',
  },
]);

/** Spec §Selected brick: status icon legend. */
export const BRICK_STATUS_ICONS = Object.freeze({
  LOW_CONFIDENCE:    { icon: '▲', label: 'Low confidence' },
  HIGH_DELTA_Q:      { icon: '▢', label: 'High ΔQ' },
  HIGH_HET:          { icon: '▢', label: 'High het.' },
  REGIME_DISCORDANT: { icon: '⚠', label: 'Regime discordant' },
  DOSAGE_DISCORDANT: { icon: '⊗', label: 'Dosage discordant' },
});

/**
 * Render the context explainer list into the supplied container.
 *
 * @param {{innerHTML:string}} ul   target list node (with innerHTML setter)
 */
export function renderContextCard(ul) {
  if (!ul) return;
  let html = '';
  for (const it of CONTEXT_CARD_ITEMS) {
    html += `<li><b>${it.label}</b><br><span>${it.text}</span></li>`;
  }
  ul.innerHTML = html;
}

/**
 * Format the "Selected brick" card body for a given brick + fish row.
 * Returns the rendered HTML so the caller can drop it into a <dl>.
 *
 * Spec §Selected brick (mockup example) — fields in this order:
 *   Fish, Interval, Dominant ancestry, ΔQ, Heterozygosity z, Entropy,
 *   Confidence, Regime (PC1 band), Dosage state.
 */
export function formatSelectedBrickFields(sel) {
  if (!sel || !sel.brick) {
    return '<dt class="empty">No brick selected</dt><dd>click a brick in the Ancestry Bricks layer</dd>';
  }
  const b = sel.brick;
  const dom = (Number.isFinite(b.dominant_k) && b.dominant_k >= 0)
    ? `K${b.dominant_k + 1}`
    : '—';
  const domShare = Number.isFinite(b.dominant_share)
    ? ` (${b.dominant_share.toFixed(2)})`
    : '';
  const intervalKb = Number.isFinite(b.start_bp) && Number.isFinite(b.end_bp)
    ? `${(b.start_bp / 1e6).toFixed(2)} – ${(b.end_bp / 1e6).toFixed(2)} Mb (${Math.round((b.end_bp - b.start_bp) / 1e3)} kb)`
    : '—';
  const fields = [
    ['Fish',              sel.fish_id || '—'],
    ['Interval',          intervalKb],
    ['Dominant ancestry', `${dom}${domShare}`],
    ['ΔQ (mean abs)',     fmtNumber(b.mean_delta_q, 2)],
    ['Heterozygosity z',  fmtNumber(b.het_z, 2, /*signed*/true)],
    ['Entropy',           fmtNumber(b.mean_entropy, 2)],
    ['Confidence',        fmtNumber(b.alignment_confidence, 2)],
    ['Regime (PC1 band)', b.pc1_band_label || '—'],
    ['Dosage state',      b.dosage_state || '—'],
  ];
  let html = '';
  for (const [k, v] of fields) {
    html += `<dt>${k}</dt><dd>${v}</dd>`;
  }
  return html;
}

/** Render the status badges row for a selected brick. */
export function formatSelectedBrickStatus(sel) {
  if (!sel || !sel.brick || !Array.isArray(sel.brick.flags) || sel.brick.flags.length === 0) {
    return '<span class="anc-status-empty">—</span>';
  }
  let html = '';
  for (const flag of sel.brick.flags) {
    const spec = BRICK_STATUS_ICONS[flag];
    if (!spec) continue;
    html += `<span class="anc-status-badge" title="${spec.label}">[${spec.icon}] ${spec.label}</span>`;
  }
  return html || '<span class="anc-status-empty">—</span>';
}

function fmtNumber(v, digits, signed) {
  if (!Number.isFinite(v)) return '—';
  const f = v.toFixed(digits);
  if (signed && v >= 0 && !f.startsWith('-')) return `+${f}`;
  return f;
}

/**
 * Idempotent helper: paint the K legend into a node, one swatch per K.
 *
 * @param {{innerHTML:string}} node
 * @param {number} K  K value (defaults to 3 per spec)
 */
export function renderKLegend(node, K) {
  if (!node) return;
  const k = Number.isFinite(K) ? K : 3;
  let html = '';
  for (let i = 0; i < k; i++) {
    const color = ANCESTRY_K_COLORS[i] || '#9aa3ad';
    html += `<span class="anc-k-swatch" style="background:${color}"></span>K${i + 1} `;
  }
  node.innerHTML = html;
}
