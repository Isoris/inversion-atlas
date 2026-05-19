// pages/discovery/local_pca_dosage/band_diagnostics_html.js
//
// HTML renderers for the band-diagnostics output (legacy lines
// 49914-50248). Two top-level entry points:
//
//   bandDiagsMiniChipsHtml(state, diag, K, l2idx)
//     — small "g0 n=30 [GHSL][θπ][het][ROH]" pill rows that sit
//       beneath the L3 contingency table. Each band gets one row with
//       four colored pills (GHSL/θπ/het/ROH). The het pill is
//       clickable when the het layer is present; data attributes let
//       a delegated handler find the corresponding diag via
//       state.__bdByL2 (which this renderer also populates).
//
//   bandDiagsPanelHtml(diag, K)
//     — full collapsible <details> with the same data in a 15-column
//       table (n, GHSL mean/median, θπ mean/median, het mean/median,
//       inline-SVG ridgeline, %ROH, ROH frac mean/median, FROH
//       mean/median, flags). Header carries the loaded-layers count
//       and total flag count.
//
// All four internal helpers (_bdFmt, _hetRidgelineSvg,
// _hetRidgelineInlineHtml, _hetSupportLineHtml) are module-private —
// callers go through the two public renderers.

import { groupColor } from '../../../shared/page1_data_helpers.js';

// =====================================================================
// Value formatter (legacy lines 49914-49931)
// =====================================================================

/**
 * Format a numeric value for diagnostic display.
 *
 * kinds: 'pct' (whole %), 'frac' (3-decimal), 'sci' (toFixed(4) when
 * |v| ≥ 0.01, else toExponential(1)), 'auto' (3-dec when |v| ≥ 0.1,
 * 4-dec when ≥ 0.001, else exponential).
 *
 * Non-finite or null → "?".
 */
function _bdFmt(v, kind) {
  if (v == null || !Number.isFinite(v)) return '?';
  if (kind === 'pct') return `${v.toFixed(0)}%`;
  if (kind === 'sci') {
    if (v === 0) return '0';
    if (Math.abs(v) >= 0.01) return v.toFixed(4);
    return v.toExponential(1);
  }
  if (kind === 'auto') {
    if (v === 0) return '0';
    if (Math.abs(v) >= 0.1) return v.toFixed(3);
    if (Math.abs(v) >= 0.001) return v.toFixed(4);
    return v.toExponential(1);
  }
  return v.toFixed(3);
}

// =====================================================================
// Het ridgeline SVG (legacy lines 49978-49996)
// =====================================================================

/**
 * Render a single-band ridgeline as an SVG filled area path. Used in
 * the table column and (in legacy) the popover. Pure.
 */
function _hetRidgelineSvg(binCounts, color, width, height) {
  if (!Array.isArray(binCounts) || binCounts.length === 0) {
    return `<svg class="hs-svg" width="${width}" height="${height}"></svg>`;
  }
  const N = binCounts.length;
  const maxC = Math.max(1, ...binCounts);
  const innerH = Math.max(1, height - 2);
  const px = (i) => (i / (N - 1)) * width;
  const py = (c) => 1 + innerH - (c / maxC) * innerH;
  let d = `M 0 ${height - 0.5} `;
  for (let i = 0; i < N; i++) d += `L ${px(i).toFixed(1)} ${py(binCounts[i]).toFixed(1)} `;
  d += `L ${width} ${height - 0.5} Z`;
  let dStroke = `M 0 ${py(binCounts[0]).toFixed(1)} `;
  for (let i = 1; i < N; i++) dStroke += `L ${px(i).toFixed(1)} ${py(binCounts[i]).toFixed(1)} `;
  return `<svg class="hs-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<path d="${d}" fill="${color}" fill-opacity="0.55" stroke="none"/>` +
    `<path d="${dStroke}" fill="none" stroke="${color}" stroke-opacity="0.95" stroke-width="1"/>` +
    `</svg>`;
}

/**
 * Inline ridgeline cell — uses the band-color palette. Empty string
 * when het_shape is absent or the requested band index has no counts.
 */
function _hetRidgelineInlineHtml(diag, bandIndex) {
  if (!diag || !diag.het_shape) return '';
  const counts = diag.het_shape.counts_per_band[bandIndex];
  if (!counts) return '';
  const color = groupColor(diag.bands[bandIndex].k);
  return _hetRidgelineSvg(counts, color, 80, 14);
}

// =====================================================================
// Het-support line (legacy lines 49946-49973)
// =====================================================================

/**
 * Render the het-support line shown above the diagnostics table when
 * the het layer is present. "Het: 9.0× ✓ · g0=0.05 | g1=0.45 | g2=0.05"
 */
function _hetSupportLineHtml(diag) {
  if (!diag || !diag.het_shape) return '';
  const hs = diag.het_shape;
  const bands = diag.bands;
  const parts = bands.map(b => {
    const v = (b.het_median != null && Number.isFinite(b.het_median))
      ? b.het_median.toFixed(2) : '?';
    const color = groupColor(b.k);
    return `<span class="hs-band" style="color:${color}">g${b.k}=${v}</span>`;
  });
  let ratioStr = '?', glyph = '', titleHint = 'het support: insufficient data';
  if (hs.support_ratio != null && Number.isFinite(hs.support_ratio)) {
    ratioStr = hs.support_ratio.toFixed(1) + '×';
    if (hs.support_passes) glyph = ' <span class="hs-pass">✓</span>';
    else if (hs.support_marginal) glyph = ' <span class="hs-marg">??</span>';
    titleHint = hs.support_kind === 'middle_vs_flanks'
      ? `het support (K=3): middle band median ÷ mean of flanking medians = ${ratioStr}. `
        + '✓ at ≥1.5×, ?? at ≥1.2×.'
      : `het spread: max(median) ÷ min(median) across bands = ${ratioStr}. `
        + '✓ at ≥1.5×, ?? at ≥1.2×.';
  }
  return `<div class="hs-line" title="${titleHint}">`
       + `<span class="hs-lbl">Het:</span> `
       + `<span class="hs-ratio">${ratioStr}${glyph}</span> · `
       + parts.join(' <span class="dim">|</span> ')
       + `</div>`;
}

// =====================================================================
// Mini-chips row (legacy lines 50134-50180)
// =====================================================================

/**
 * Render the compact pill-row representation of band diagnostics —
 * one row per non-empty band. Stashes the diag on
 * state.__bdByL2[l2idx] so a delegated het-pill click handler can
 * recover it to render the ridgeline popover.
 *
 * @param {Object} state                 local_pca_dosage _pageState (mutated for the stash)
 * @param {Object} diag                  computeBandDiagnostics output
 * @param {number} K                     band cardinality (reserved for future use)
 * @param {number|null} l2idx            focal L2 index for the click stash
 * @returns {string}
 */
export function bandDiagsMiniChipsHtml(state, diag, K, l2idx) {
  if (!diag || !Array.isArray(diag.bands) || diag.bands.length === 0) return '';
  const rows = [];
  // v3.93: stash diag on a state-keyed map so the het pill click handler
  // can find it. Keyed by l2idx (the focal L2 index for this tile).
  if (state && l2idx != null) {
    if (!state.__bdByL2) state.__bdByL2 = new Map();
    state.__bdByL2.set(l2idx, diag);
  }
  for (const b of diag.bands) {
    if (b.n === 0) continue;
    const color = groupColor(b.k);
    const pill = (label, valueStr, title, extraAttrs) =>
      `<span class="bd-pill" style="background:${color}" title="${title}"${extraAttrs || ''}>`
      + `<span class="bd-pill-lbl">${label}</span>`
      + `<span class="bd-pill-val">${valueStr}</span>`
      + `</span>`;
    const ghslStr = _bdFmt(b.ghsl_mean, 'auto');
    const tpiStr  = _bdFmt(b.theta_pi_mean, 'sci');
    const hetStr  = _bdFmt(b.het_mean, 'auto');
    const rohStr  = _bdFmt(b.roh_overlap_pct, 'pct');
    const flagsHint = b.flags.length > 0 ? ` · flags: ${b.flags.join(', ')}` : '';
    const hetClickable = !!(diag.het_shape && diag.data_status && diag.data_status.het);
    const hetExtra = hetClickable
      ? ` data-hs-trigger="1" data-hs-l2idx="${l2idx == null ? '' : l2idx}" style="background:${color};cursor:pointer;"`
      : '';
    const hetTitle = hetClickable
      ? `dosage heterozygosity mean for band g${b.k}${flagsHint} · click for shape`
      : `dosage heterozygosity mean for band g${b.k}${flagsHint}`;
    rows.push(
      `<div class="bd-mini-row">`
      + `<span class="bd-mini-band" style="color:${color}">g${b.k}</span>`
      + `<span class="bd-mini-n dim">n=${b.n}</span>`
      + pill('GHSL', ghslStr, `GHSL mean for band g${b.k}${flagsHint}`)
      + pill('θπ',   tpiStr,  `theta/pi mean for band g${b.k}${flagsHint}`)
      + pill('het',  hetStr,  hetTitle, hetExtra)
      + pill('ROH',  rohStr,  `% samples in band g${b.k} with ROH overlapping interval${flagsHint}`)
      + `</div>`
    );
  }
  if (rows.length === 0) return '';
  return `<div class="bd-mini" data-bd-l2idx="${l2idx == null ? '' : l2idx}">${rows.join('')}</div>`;
}

// =====================================================================
// Full panel (legacy lines 50183-50248)
// =====================================================================

/**
 * Render the collapsible <details> with the full 15-column band-
 * diagnostics table. Pure (no state mutation).
 *
 * @param {Object} diag  computeBandDiagnostics output
 * @param {number} K     reserved
 * @returns {string}
 */
export function bandDiagsPanelHtml(diag, K) {
  if (!diag || !Array.isArray(diag.bands) || diag.bands.length === 0) return '';
  const ds = diag.data_status || {};
  const layersTotal = 5;
  const layersHave = ['ghsl', 'theta_pi', 'het', 'roh', 'froh']
    .reduce((acc, k) => acc + (ds[k] ? 1 : 0), 0);
  const totalFlags = diag.bands.reduce((s, b) => s + b.flags.length, 0);
  const flagsHint = totalFlags > 0
    ? ` · <span style="color:var(--accent);">${totalFlags} flag${totalFlags > 1 ? 's' : ''}</span>`
    : '';
  const layersLine = `${layersHave}/${layersTotal} layers loaded`;

  const rowHtml = (b, bi) => {
    const color = groupColor(b.k);
    const flagSpans = b.flags.length > 0
      ? b.flags.map(f => `<span class="bd-flag bd-flag-${f}">${f}</span>`).join(' ')
      : '<span class="dim">—</span>';
    const ridge = (diag.het_shape && diag.data_status && diag.data_status.het)
      ? _hetRidgelineInlineHtml(diag, bi)
      : '<span class="dim">?</span>';
    return `<tr>
      <td><span class="bd-swatch" style="background:${color}"></span> g${b.k}</td>
      <td class="num">${b.n}</td>
      <td class="num">${_bdFmt(b.ghsl_mean, 'auto')}</td>
      <td class="num dim">${_bdFmt(b.ghsl_median, 'auto')}</td>
      <td class="num">${_bdFmt(b.theta_pi_mean, 'sci')}</td>
      <td class="num dim">${_bdFmt(b.theta_pi_median, 'sci')}</td>
      <td class="num">${_bdFmt(b.het_mean, 'auto')}</td>
      <td class="num dim">${_bdFmt(b.het_median, 'auto')}</td>
      <td class="hs-ridge-cell">${ridge}</td>
      <td class="num">${_bdFmt(b.roh_overlap_pct, 'pct')}</td>
      <td class="num">${_bdFmt(b.roh_frac_mean, 'auto')}</td>
      <td class="num dim">${_bdFmt(b.roh_frac_median, 'auto')}</td>
      <td class="num">${_bdFmt(b.froh_mean, 'auto')}</td>
      <td class="num dim">${_bdFmt(b.froh_median, 'auto')}</td>
      <td class="bd-flags-cell">${flagSpans}</td>
    </tr>`;
  };

  const hetSupport = (diag.het_shape && diag.data_status && diag.data_status.het)
    ? _hetSupportLineHtml(diag) : '';

  return `<details class="bd-panel"><summary class="bd-summary">
      <span class="bd-summary-lbl">band diagnostics</span>
      <span class="bd-summary-info">${layersLine}${flagsHint}</span>
    </summary>
    ${hetSupport}
    <div class="bd-table-wrap"><table class="bd-table">
      <thead><tr>
        <th>band</th><th>n</th>
        <th>GHSL</th><th class="dim">med</th>
        <th>θ/π</th><th class="dim">med</th>
        <th>het</th><th class="dim">med</th>
        <th>shape</th>
        <th>%ROH</th>
        <th>ROH frac</th><th class="dim">med</th>
        <th>FROH</th><th class="dim">med</th>
        <th>flags</th>
      </tr></thead>
      <tbody>${diag.bands.map((b, bi) => rowHtml(b, bi)).join('')}</tbody>
    </table></div>
  </details>`;
}
