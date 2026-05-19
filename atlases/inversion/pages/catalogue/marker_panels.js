// inversion_catalogue/marker_panels.js
// =====================================================================
// Page 10 — "Marker panels"
// Diagnostic PCR marker panel cards for each candidate inversion regime.
// Activates when `marker_panel_summary` is present in state.data._layers_present.
// See SCHEMA §10 for the marker layer column contracts.
//
// Extracted verbatim from legacy Inversion_atlas.html lines 57837–58043
// (helper _markerPanelCardHtml: 57837–57970, render: 57972–58043).
// _markerPanelCardHtml has exactly one caller (renderMarkerPage), so it's
// kept private to this module rather than promoted to shared/.
//
// Wiring: call wirePage10(state) once after state is constructed; it returns
// a render function the host can invoke whenever the active page becomes
// marker_panels (or whenever marker layers change).
//
// Round 5 step 9 (chat 36, 2026-05-07): refactored from chat-33 factory-
// only pattern to add the standard atlas-router lifecycle (mount /
// unmount / renderPage10 / _pageState live-binding). The factory
// `wirePage10` is RETAINED verbatim — closure-captured state still
// works for any caller still using the chat-33 surface. Same approach
// as overview (round 5 step 8).
// =====================================================================

import { _pageState, _setActiveState } from './marker_panels/_state.js';

export function wirePage10(state) {
  // Keep _pageState in sync with the factory's closure-captured state so
  // both surfaces (factory + new lifecycle) see the same data. Round 5
  // step 9, chat 36, 2026-05-07.
  if (state) _setActiveState(state);

  // ---------------------------------------------------------------------
  // Helper — build one panel card's HTML. Single-use, kept module-private.
  // Verbatim from legacy line 57837.
  // ---------------------------------------------------------------------
  function _markerPanelCardHtml(panelSummary, candidateRow, catalogueRows, primerRows) {
  const sum = panelSummary || {};
  const cand = candidateRow || {};
  const tier = sum.confidence_tier || 'NA';
  const tierColor = tier === 'HIGH' ? '#3cc08a'
                  : tier === 'MEDIUM' ? '#f5c43a'
                  : tier === 'LOW' ? '#e0555c'
                  : 'var(--ink-dim)';
  const accuracyPct = (sum.expected_call_accuracy != null)
    ? (sum.expected_call_accuracy * 100).toFixed(1) + '%'
    : 'NA';
  const candId = sum.candidate_id || cand.candidate_id || '?';
  const chrom = cand.chrom || (state.data && state.data.chrom) || '?';
  const startBp = cand.start_bp != null ? cand.start_bp : null;
  const endBp = cand.end_bp != null ? cand.end_bp : null;
  const spanMb = (startBp != null && endBp != null)
    ? ((endBp - startBp) / 1e6).toFixed(3) + ' Mb'
    : '?';
  // Regime-counts string from candidate_registry.regime_counts ("g0:38;g1:50;g2:138")
  const regimeCounts = cand.regime_counts || '';
  // Compose card HTML
  let html = '';
  html += `<section class="mp-card">`;
  // Header
  html += `<div class="mp-card-head">`;
  html += `<div class="mp-card-id">${candId}</div>`;
  html += `<div class="mp-card-coords">${chrom}:${startBp != null ? startBp.toLocaleString() : '?'}–${endBp != null ? endBp.toLocaleString() : '?'} <span class="mp-dim">(${spanMb})</span></div>`;
  if (regimeCounts) {
    html += `<div class="mp-card-regimes">${regimeCounts.replace(/;/g, ' · ')}</div>`;
  }
  html += `</div>`;
  // Tier + accuracy strip
  html += `<div class="mp-card-tier-row">`;
  html += `<span class="mp-tier-badge" style="color: ${tierColor}; border-color: ${tierColor};">${tier}</span>`;
  html += `<span class="mp-acc">expected accuracy <b>${accuracyPct}</b></span>`;
  if (sum.n_markers != null) {
    html += `<span class="mp-acc">${sum.n_markers} marker${sum.n_markers === 1 ? '' : 's'}</span>`;
  }
  if (sum.panel_class) {
    html += `<span class="mp-acc">panel: ${sum.panel_class}</span>`;
  }
  html += `</div>`;
  // Per-regime marker counts (small breakdown row, only if present)
  if (sum.n_g0_diagnostic != null || sum.n_g1_diagnostic != null || sum.n_g2_diagnostic != null) {
    html += `<div class="mp-card-regimes-row">`;
    if (sum.n_g0_diagnostic != null) html += `<span>g0 markers: <b>${sum.n_g0_diagnostic}</b></span>`;
    if (sum.n_g1_diagnostic != null) html += `<span>g1 markers: <b>${sum.n_g1_diagnostic}</b></span>`;
    if (sum.n_g2_diagnostic != null) html += `<span>g2 markers: <b>${sum.n_g2_diagnostic}</b></span>`;
    html += `</div>`;
  }
  // Multiplex constraint info
  if (sum.tm_min != null && sum.tm_max != null) {
    const spread = sum.tm_spread != null ? sum.tm_spread : (sum.tm_max - sum.tm_min);
    const spreadClass = spread <= 4 ? 'ok' : 'warn';
    html += `<div class="mp-multiplex">Tm range: ${sum.tm_min.toFixed(1)}–${sum.tm_max.toFixed(1)}°C `
         +  `<span class="mp-spread mp-${spreadClass}">spread ${spread.toFixed(1)}°C ${spreadClass === 'ok' ? '✓ multiplex-safe' : '⚠ multiplex-tight'}</span></div>`;
  }
  // Warnings
  if (sum.warnings) {
    const tags = String(sum.warnings).split(/[|,;]/).map(s => s.trim()).filter(Boolean);
    if (tags.length > 0) {
      html += `<div class="mp-warnings">`;
      html += tags.map(t => `<span class="mp-warn-tag">${t}</span>`).join('');
      html += `</div>`;
    }
  }
  // Detail block — markers table when catalogue is loaded
  if (Array.isArray(catalogueRows) && catalogueRows.length > 0) {
    html += `<div class="mp-detail">`;
    html += `<div class="mp-detail-h">Markers</div>`;
    html += `<table class="mp-table"><thead><tr>`;
    html += `<th>marker</th><th>pos</th><th>type</th><th>target</th><th>specificity</th>`;
    html += `<th>freq g0/g1/g2</th><th>family spread</th>`;
    if (Array.isArray(primerRows) && primerRows.length > 0) {
      html += `<th>amplicon</th><th>Tm</th>`;
    }
    html += `</tr></thead><tbody>`;
    for (const m of catalogueRows) {
      const target = m.target_regime || '?';
      const spec = m.specificity_score != null ? m.specificity_score.toFixed(2) : '?';
      const f0 = m.freq_g0 != null ? m.freq_g0.toFixed(2) : '?';
      const f1 = m.freq_g1 != null ? m.freq_g1.toFixed(2) : '?';
      const f2 = m.freq_g2 != null ? m.freq_g2.toFixed(2) : '?';
      const fam = m.family_spread_score != null ? m.family_spread_score.toFixed(2) : '?';
      html += `<tr>`;
      html += `<td>${m.marker_id || '?'}</td>`;
      html += `<td>${m.pos != null ? m.pos.toLocaleString() : '?'}</td>`;
      html += `<td>${m.variant_type || '?'}</td>`;
      html += `<td><span class="mp-target mp-target-${target}">${target}</span></td>`;
      html += `<td>${spec}</td>`;
      html += `<td>${f0}/${f1}/${f2}</td>`;
      html += `<td>${fam}</td>`;
      if (Array.isArray(primerRows) && primerRows.length > 0) {
        const pp = primerRows.find(p => p.marker_id === m.marker_id && p.selected === 'TRUE') ||
                   primerRows.find(p => p.marker_id === m.marker_id);
        if (pp) {
          const ampStr = pp.amplicon_size != null ? `${pp.amplicon_size} bp` : '?';
          const tmStr = (pp.tm_forward != null && pp.tm_reverse != null)
            ? `${pp.tm_forward.toFixed(1)}/${pp.tm_reverse.toFixed(1)}`
            : '?';
          html += `<td>${ampStr}</td><td>${tmStr}</td>`;
        } else {
          html += `<td>—</td><td>—</td>`;
        }
      }
      html += `</tr>`;
    }
    html += `</tbody></table>`;
    html += `</div>`;
  } else {
    html += `<div class="mp-detail mp-detail-empty">`;
    html += `Marker catalogue not loaded — drag in <code>${chrom}_phase13_markers.json</code> to see per-marker detail.`;
    html += `</div>`;
  }
  // Interpretation block
  if (sum.n_g0_diagnostic != null || sum.n_g1_diagnostic != null || sum.n_g2_diagnostic != null) {
    const lines = [];
    if (sum.n_g0_diagnostic) lines.push(`${sum.n_g0_diagnostic} marker${sum.n_g0_diagnostic === 1 ? '' : 's'} support regime <b>g0</b>`);
    if (sum.n_g2_diagnostic) lines.push(`${sum.n_g2_diagnostic} marker${sum.n_g2_diagnostic === 1 ? '' : 's'} support regime <b>g2</b>`);
    if (sum.n_g1_diagnostic) lines.push(`${sum.n_g1_diagnostic} marker${sum.n_g1_diagnostic === 1 ? '' : 's'} separate g0/g2 from heterozygous <b>g1</b>`);
    if (lines.length > 0 && sum.expected_call_accuracy != null) {
      const accStr = (sum.expected_call_accuracy * 100).toFixed(1);
      lines.push(`Combined panel assigns a fish to a candidate regime with <b>${accStr}%</b> accuracy on the calibration cohort.`);
    }
    if (lines.length > 0) {
      html += `<div class="mp-interpret">`;
      html += `<div class="mp-detail-h">Interpretation</div>`;
      html += lines.map(l => `<div class="mp-interpret-line">${l}</div>`).join('');
      html += `</div>`;
    }
  }
  html += `</section>`;
  return html;
}

  // ---------------------------------------------------------------------
  // Main render — one card per panel summary entry.
  // Verbatim from legacy line 57972.
  // ---------------------------------------------------------------------
  function renderMarkerPage() {
  const slot = document.getElementById('page10Content');
  const subtitleEl = document.getElementById('page10Subtitle');
  if (!slot) return;
  const layers = (state.data && state.data._layers_present) || [];
  const hasSummary = layers.indexOf('marker_panel_summary') >= 0;
  const hasCatalogue = layers.indexOf('marker_catalogue') >= 0;
  const hasPrimers = layers.indexOf('marker_primers') >= 0;
  if (!hasSummary) {
    if (subtitleEl) subtitleEl.textContent = '(no marker layer loaded)';
    if ('innerHTML' in slot) {
      slot.innerHTML = `<div class="mp-empty">
        <div class="mp-empty-h">No marker panels loaded</div>
        <div>To populate this page, drag in a phase-13 marker JSON.
        See SCHEMA §10 for the layer contract.</div>
      </div>`;
    }
    return;
  }
  const summaries = state.data.marker_panel_summary || [];
  const catalogue = state.data.marker_catalogue || [];
  const primers = state.data.marker_primers || [];
  // Index candidate-registry rows by candidate_id for quick lookup of chrom/start/end
  const candByID = new Map();
  if (Array.isArray(state.candidateList)) {
    for (const c of state.candidateList) candByID.set(c.id || c.candidate_id, c);
  }
  // Build subtitle
  const tierCounts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const s of summaries) {
    if (tierCounts[s.confidence_tier] != null) tierCounts[s.confidence_tier]++;
  }
  const layerStr = [];
  layerStr.push(`${summaries.length} panel${summaries.length === 1 ? '' : 's'}`);
  if (hasCatalogue) layerStr.push('catalogue ✓');
  if (hasPrimers) layerStr.push('primers ✓');
  layerStr.push(`HIGH ${tierCounts.HIGH} · MEDIUM ${tierCounts.MEDIUM} · LOW ${tierCounts.LOW}`);
  if (subtitleEl) subtitleEl.textContent = layerStr.join(' · ');
  // Group catalogue + primers by candidate_id for fast slicing
  const catBy = {}, primBy = {};
  for (const m of catalogue) {
    const cid = m.candidate_id;
    if (!cid) continue;
    if (!catBy[cid]) catBy[cid] = [];
    catBy[cid].push(m);
  }
  for (const p of primers) {
    const cid = p.candidate_id;
    if (!cid) continue;
    if (!primBy[cid]) primBy[cid] = [];
    primBy[cid].push(p);
  }
  // Render cards. If summaries is empty (rare; layer present with no rows),
  // show empty state. Otherwise emit one card per panel.
  if (summaries.length === 0) {
    if ('innerHTML' in slot) {
      slot.innerHTML = `<div class="mp-empty">
        <div class="mp-empty-h">Marker layer loaded but no panels emitted</div>
        <div>Phase-13 ran but produced zero panels — likely no candidates met
        the discovery thresholds. Check phase-13 logs.</div>
      </div>`;
    }
    return;
  }
  let html = '';
  for (const sum of summaries) {
    const cid = sum.candidate_id;
    const cand = candByID.get(cid) || {};
    html += _markerPanelCardHtml(sum, cand, catBy[cid] || null, primBy[cid] || null);
  }
  if ('innerHTML' in slot) slot.innerHTML = html;
}

  // Public render handle. Legacy name preserved as alias for cross-module
  // call sites that still reference renderMarkerPage().
  return {
    renderPage10: renderMarkerPage,
    renderMarkerPage,
  };
}

// Convenience default export so callers can `import wire from './marker_panels.js'`.
export default wirePage10;

// ---------------------------------------------------------------------------
// Atlas-router lifecycle (chat 36 round 5 step 9, 2026-05-07).
//
// The new direct exports below give marker_panels the standard surface used by
// confirmed_carousel/17/18/21/overview: renderPage10(state), mount(), unmount().
// They share _pageState with the factory's closure capture above so old
// and new callers see consistent state.
// ---------------------------------------------------------------------------

/**
 * Public entry — state-aware wrapper for the legacy renderMarkerPage.
 * Sets _pageState before delegating so the factory-rebuilt closures see
 * live data. Calling this with a state argument is equivalent to
 * `wirePage10(state).renderPage10()`, but without re-creating closures
 * each time.
 */
export function renderPage10(state) {
  if (state) _setActiveState(state);
  // Re-create the factory closures with the current _pageState so the
  // closure-captured `state` reference matches what we just stashed.
  // This costs one extra factory invocation per render, but keeps both
  // surfaces structurally identical to the chat-33 factory contract.
  const handle = wirePage10(_pageState);
  return handle.renderPage10();
}

/**
 * Backward-compat alias — legacy code references renderMarkerPage().
 */
export function renderMarkerPage(state) {
  return renderPage10(state);
}

/**
 * Mount: called by atlas_router when the user navigates to marker_panels.
 *
 * Reads activeChrom from atlasState and builds a legacy-shape state with
 * the slots marker_panels reads: data (chromosome precomp with _layers_present,
 * marker_panel_summary, marker_catalogue, marker_primers), candidateList
 * (used to look up chrom/start_bp/end_bp by candidate_id).
 */
export async function mount(root, atlasState, registry) {
  const legacyState = _buildLegacyState(atlasState);
  _setActiveState(legacyState);

  try { renderPage10(legacyState); }
  catch (e) { console.warn('marker_panels.mount: renderPage10 threw —', e); }

  if (atlasState.inversion) atlasState.inversion._page10State = legacyState;
}

/**
 * Unmount: clear _pageState so post-unmount callbacks see null.
 */
export async function unmount(root) {
  _setActiveState(null);
}

function _buildLegacyState(atlasState) {
  const inv = atlasState.inversion || {};
  const sh  = atlasState.shared    || {};
  const legacy = Object.assign({}, inv);
  legacy.candidateList = inv.candidateList || [];
  const chrom = sh.activeChrom;
  legacy.data = (chrom && inv.tracks && inv.tracks[chrom]) ? inv.tracks[chrom] : null;
  return legacy;
}
