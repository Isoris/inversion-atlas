// pages/discovery/haplotype_regimes/regimes_summary.js
//
// The "long-range regimes" view-toggle target. Renders the table of
// refined Cluster-3 regimes (one row per regime, with HOM/HET cores
// + cross-regime chain id) and applies the seeds-vs-regimes view
// toggle. Extracted from haplotype_regimes.js as part of the file
// split (2026-05-27).

import { escapeHtml } from './util.js';

/**
 * Apply the current view toggle ('seeds' vs 'regimes') to the
 * #rgSeedsStripWrap / #rgRegimesWrap visibility. Idempotent.
 *
 * @param {HTMLElement} root
 * @param {Object} state    legacy state — reads _regimesView,
 *                          _regimesResult, _regimesPostSeeding
 */
export function applyViewToggle(root, state) {
  if (!root || typeof document === 'undefined') return;
  const seedsWrap   = root.querySelector('#rgSeedsStripWrap');
  const regimesWrap = root.querySelector('#rgRegimesWrap');
  const view = state._regimesView || 'seeds';
  const haveResult = !!(state && state._regimesResult);
  const havePost   = !!(state && state._regimesPostSeeding);
  if (seedsWrap) {
    // Show the seeds strip only when we have a result AND the view is
    // seeds. Until a run produces seeds, the strip stays hidden in
    // both views.
    seedsWrap.style.display = (view === 'seeds' && haveResult) ? 'flex' : 'none';
  }
  if (regimesWrap) {
    // Show regimes only when in regimes view AND a post-seeding tail
    // ran (i.e. we have refined regimes to display).
    regimesWrap.style.display = (view === 'regimes' && havePost) ? 'flex' : 'none';
  }
}

/**
 * Render the refined long-range regimes table (#rgRegimesBody)
 * + the regime count (#rgRegimesCount). Pulls from
 * state._regimesPostSeeding.refined.regimes; safe to call before
 * the post-seeding tail has produced anything (renders an empty
 * placeholder row).
 *
 * @param {HTMLElement} root
 * @param {Object} state    legacy state
 */
export function renderRegimesSummary(root, state) {
  if (!root || typeof document === 'undefined') return;
  const tbody = root.querySelector('#rgRegimesBody');
  const countEl = root.querySelector('#rgRegimesCount');
  if (!tbody) return;
  tbody.innerHTML = '';
  const post = state && state._regimesPostSeeding;
  const refined = post && post.refined;
  const regimes = refined && Array.isArray(refined.regimes) ? refined.regimes : [];
  if (regimes.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="8" style="padding: 6px 10px; color: var(--ink-dimmer, #5a6472);">' +
      'No refined regimes yet. Run the pipeline.' +
      '</td></tr>';
    if (countEl) countEl.textContent = '';
    return;
  }
  // Map regime → chain_id (when topology produced multi-regime chains).
  const chainOf = new Map();
  const chains = (post.topology && Array.isArray(post.topology.chains))
                 ? post.topology.chains : [];
  chains.forEach((ch, ci) => {
    if (!ch || !Array.isArray(ch)) return;
    for (const uid of ch) chainOf.set(String(uid), ci);
  });
  for (let i = 0; i < regimes.length; i++) {
    const r = regimes[i];
    const id = r.regime_id != null ? r.regime_id : (r.regime_uid != null ? r.regime_uid : ('reg_' + i));
    const chrom = r.chrom_idx != null
      ? `chr${r.chrom_idx}`
      : (state.activeChrom || '—');
    const bpStart = Number.isFinite(r.start_bp) ? (r.start_bp / 1e6).toFixed(2) + ' Mb' : '—';
    const bpEnd   = Number.isFinite(r.end_bp)   ? (r.end_bp   / 1e6).toFixed(2) + ' Mb' : '—';
    const nIv     = r.n_intervals != null ? r.n_intervals
                  : (r.member_interval_ids ? r.member_interval_ids.length : 0);
    const sizeOf = (s) => {
      if (s == null) return 0;
      if (s instanceof Set) return s.size;
      if (Array.isArray(s)) return s.length;
      return 0;
    };
    const nHomA = sizeOf(r.hom_a_intersect || r.hom_a);
    const nHomB = sizeOf(r.hom_b_intersect || r.hom_b);
    const nHet  = sizeOf(r.het_union || r.het);
    const chainKey = String(r.regime_uid != null ? r.regime_uid : id);
    const chainId  = chainOf.has(chainKey) ? `chain ${chainOf.get(chainKey)}` : '—';
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--rule, #2a3242)';
    tr.innerHTML =
      `<td style="padding: 3px 6px; color: var(--ink, #e6edf6); font-weight: 600;">${escapeHtml(String(id))}</td>` +
      `<td style="padding: 3px 6px; color: var(--ink-dim, #8895a8);">${escapeHtml(String(chrom))}</td>` +
      `<td style="padding: 3px 6px; color: var(--ink-dim, #8895a8);">${bpStart} – ${bpEnd}</td>` +
      `<td style="padding: 3px 6px; color: var(--ink-dim, #8895a8);">${nIv}</td>` +
      `<td style="padding: 3px 6px; color: #5fb3ff;">${nHomA}</td>` +
      `<td style="padding: 3px 6px; color: #c7d3e4;">${nHet}</td>` +
      `<td style="padding: 3px 6px; color: #e07b7b;">${nHomB}</td>` +
      `<td style="padding: 3px 6px; color: var(--ink-dimmer, #5a6472);">${escapeHtml(chainId)}</td>`;
    tbody.appendChild(tr);
  }
  if (countEl) {
    const nReg = regimes.length;
    const nCh  = chains.length;
    countEl.textContent = `${nReg} regime${nReg === 1 ? '' : 's'}` +
                          (nCh > 0 ? ` · ${nCh} chain${nCh === 1 ? '' : 's'}` : '');
  }
}
