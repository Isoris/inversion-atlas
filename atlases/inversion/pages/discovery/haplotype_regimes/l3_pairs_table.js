// pages/discovery/haplotype_regimes/l3_pairs_table.js
//
// L3 adjacent-L2 Cramér's V mini-table (2026-05-20).
// Extracted from haplotype_regimes.js as part of the file split
// (2026-05-27). For each consecutive (L2_i, L2_{i+1}) on the active
// chromosome:
//   1. Cluster each L2 via the ClusterCache (already populated by
//      the pipeline ctx).
//   2. Hungarian-align L2_{i+1}'s labels to L2_i's K-band frame.
//   3. Build the K_a × K_b contingency table over samples present
//      in BOTH (defined-label intersect; some samples drop in some
//      L2s).
//   4. Compute Cramér's V and render a row.
// Only painted in short-range mode (the long-range V-walker already
// surfaces the same idea via its own seed boundaries).
//
// Per-row "merge → candidate" button promotes the joined L2 range
// as a new candidate via local_pca_dosage's addCandidateToList
// plumbing, then asks the caller to re-run the pipeline so the new
// candidate appears in the seeds strip.

import { alignLabels } from '../../../shared/hungarian.js';
import { buildContingency, cramersV } from '../../../shared/contingency.js';
import { escapeHtml } from './util.js';

/**
 * Render (or hide) the adjacent-L2 Cramér's V pair table.
 *
 * @param {HTMLElement} root         the page root
 * @param {Object}      state        haplotype_regimes legacy state
 * @param {Object}      [opts]
 * @param {Function}    [opts.onAfterMerge]   async () → void.
 *     Called after `_mergePairToCandidate` succeeds — caller should
 *     re-run the pipeline so the freshly-promoted candidate appears
 *     as a seed chip in the strip.
 */
export function renderL3PairsTable(root, state, opts) {
  if (!root || typeof document === 'undefined') return;
  const wrap = root.querySelector('#rgL3PairsWrap');
  const body = root.querySelector('#rgL3PairsBody');
  const countEl = root.querySelector('#rgL3PairsCount');
  if (!wrap || !body) return;
  if (state._regimesMode !== 'short') {
    wrap.style.display = 'none';
    body.innerHTML = '';
    return;
  }
  const data = state.data;
  if (!data || !Array.isArray(data.l2_envelopes) || data.l2_envelopes.length < 2) {
    wrap.style.display = 'flex';
    body.innerHTML =
      '<tr><td colspan="5" style="padding: 8px 10px; color: var(--ink-dimmer);">' +
      'Need at least 2 L2 envelopes on this chromosome to compute adjacent-pair V.' +
      '</td></tr>';
    if (countEl) countEl.textContent = '';
    return;
  }
  wrap.style.display = 'flex';
  body.innerHTML = '';
  const envs = data.l2_envelopes;
  const cache = state._regimesClusterCache;
  const ctx   = state._regimesClusterCtx;
  if (!cache || !ctx) {
    body.innerHTML =
      '<tr><td colspan="5" style="padding: 8px 10px; color: var(--ink-dimmer);">' +
      'Cluster cache not wired — run the pipeline first.' +
      '</td></tr>';
    return;
  }
  const onAfterMerge = (opts && typeof opts.onAfterMerge === 'function')
    ? opts.onAfterMerge : null;
  const rows = [];
  for (let i = 0; i + 1 < envs.length; i++) {
    rows.push(_computePairRow(state, i, i + 1, envs, cache, ctx));
  }
  for (const r of rows) {
    body.appendChild(_renderPairRow(state, r, onAfterMerge));
  }
  if (countEl) countEl.textContent = `${rows.length} pair${rows.length === 1 ? '' : 's'}`;
}

function _computePairRow(state, iA, iB, envs, cache, ctx) {
  const envA = envs[iA], envB = envs[iB];
  const clA = cache.getOrCompute(ctx, iA);
  const clB = cache.getOrCompute(ctx, iB);
  if (!clA || !clA.ok || !clA.labels || !clB || !clB.ok || !clB.labels) {
    return {
      iA, iB, envA, envB,
      v: NaN, nSamples: 0, K: 0, reason: !clA?.ok ? `L2#${iA} cluster failed` : `L2#${iB} cluster failed`,
    };
  }
  // Align labelsB onto labelsA's K-band frame so cluster ids correspond.
  const K = Math.max(clA.usedK | 0, clB.usedK | 0);
  let alignedB = clB.labels;
  try {
    const aligned = alignLabels(clA.labels, clB.labels, K);
    if (aligned && aligned.aligned) alignedB = aligned.aligned;
    else if (aligned && Array.isArray(aligned)) alignedB = aligned;
  } catch (_) { /* fall through with raw labels */ }
  // Intersect samples that have valid labels in BOTH L2s. -1 = absent.
  const nS = state.data.n_samples | 0;
  const valid = [];
  for (let s = 0; s < nS; s++) {
    if (clA.labels[s] >= 0 && alignedB[s] >= 0) valid.push(s);
  }
  if (valid.length < 4) {
    return { iA, iB, envA, envB, v: NaN, nSamples: valid.length, K, reason: 'insufficient samples' };
  }
  const aSubset = new Int32Array(valid.length);
  const bSubset = new Int32Array(valid.length);
  for (let i = 0; i < valid.length; i++) {
    aSubset[i] = clA.labels[valid[i]];
    bSubset[i] = alignedB[valid[i]];
  }
  let v = NaN;
  try {
    const table = buildContingency(aSubset, bSubset, K, K);
    v = cramersV(table, K, K);
  } catch (_) {}
  return { iA, iB, envA, envB, v, nSamples: valid.length, K };
}

function _renderPairRow(state, r, onAfterMerge) {
  const tr = document.createElement('tr');
  const mbA = (r.envA && Number.isFinite(r.envA.start_bp))
    ? (r.envA.start_bp / 1e6).toFixed(2) : '—';
  const mbB = (r.envB && Number.isFinite(r.envB.end_bp))
    ? (r.envB.end_bp / 1e6).toFixed(2) : '—';
  const span = `${mbA}–${mbB} Mb`;
  let tier, vText;
  if (Number.isFinite(r.v)) {
    vText = r.v.toFixed(2);
    tier  = r.v >= 0.7 ? 'high' : r.v >= 0.4 ? 'mid' : 'low';
  } else {
    vText = '—'; tier = 'na';
  }
  const idA = (r.envA && r.envA.id) || ('L2_' + r.iA);
  const idB = (r.envB && r.envB.id) || ('L2_' + r.iB);
  tr.innerHTML =
    '<td><span style="color: var(--ink);">' + escapeHtml(idA) + '</span> &rarr; <span style="color: var(--ink);">' + escapeHtml(idB) + '</span></td>' +
    '<td style="color: var(--ink-dim);">' + span + '</td>' +
    '<td><span class="rg-l3-pair-v" data-tier="' + tier + '">' + vText + '</span></td>' +
    '<td style="color: var(--ink-dim);">' + (r.nSamples | 0) + '</td>' +
    '<td><button type="button" class="rg-l3-pair-merge" data-pair-a="' + r.iA +
      '" data-pair-b="' + r.iB + '" ' + (r.envA && r.envB ? '' : 'disabled') +
      ' title="Build a candidate inversion spanning both L2 envelopes. Lands in the local_pca_dosage candidate list + sets it active.">merge → candidate</button></td>';
  const btn = tr.querySelector('button.rg-l3-pair-merge');
  if (btn) {
    btn.addEventListener('click', () => _mergePairToCandidate(state, r, onAfterMerge).catch(e => {
      console.warn('merge pair failed:', e);
    }));
  }
  return tr;
}

async function _mergePairToCandidate(state, r, onAfterMerge) {
  const data = state.data;
  if (!data || !r || !r.envA || !r.envB) return;
  // The merged candidate's start_w/end_w span from envA's left edge to
  // envB's right edge. ref_window = midpoint window. K = larger of the
  // two L2s (Hungarian aligned to envA, so we use envA's K).
  const start_w = Number.isFinite(r.envA._s0) ? r.envA._s0
                : (Number.isFinite(r.envA.start_w) ? r.envA.start_w - 1 : 0);
  const end_w   = Number.isFinite(r.envB._e0) ? r.envB._e0
                : (Number.isFinite(r.envB.end_w) ? r.envB.end_w - 1 : (data.n_windows - 1));
  const start_bp = Number.isFinite(r.envA.start_bp) ? r.envA.start_bp : null;
  const end_bp   = Number.isFinite(r.envB.end_bp)   ? r.envB.end_bp   : null;
  const ref_window = Math.round((start_w + end_w) / 2);
  // Use the aligned labels at L2_A as locked_labels (the merge's
  // reference K-band assignment). The shared per_l2_cluster cache
  // already has them.
  const cl = state._regimesClusterCache && state._regimesClusterCache.getOrCompute
    ? state._regimesClusterCache.getOrCompute(state._regimesClusterCtx, r.iA)
    : null;
  const nS = data.n_samples | 0;
  const locked = new Int8Array(nS).fill(-1);
  if (cl && cl.labels) {
    for (let s = 0; s < nS; s++) {
      const k = cl.labels[s];
      if (k >= 0) locked[s] = k;
    }
  }
  const candMod = await import('../local_pca_dosage/candidates.js').catch(() => null);
  if (!candMod || typeof candMod.makeCandidateId !== 'function') {
    console.warn('candidates.js not available; cannot promote merge.');
    return;
  }
  const cand = {
    source:        'l3_pair_merge',
    chrom:         data.chrom || state.activeChrom,
    l2_indices:    [r.iA, r.iB],
    ref_l2:        r.iA,
    ref_window,
    K:             (cl && cl.usedK) || r.K || 3,
    locked_labels: locked,
    start_w, end_w,
    start_bp, end_bp,
    created_at:    Date.now(),
    notes: `Merged from L3 adjacent-pair V table (L2#${r.iA} → L2#${r.iB}, V=${
      Number.isFinite(r.v) ? r.v.toFixed(3) : '—'
    }, n=${r.nSamples}).`,
    id:            candMod.makeCandidateId(),
    _from_l3_pair: { iA: r.iA, iB: r.iB, v: r.v, n_samples: r.nSamples },
  };
  const inv = (typeof window !== 'undefined' && window.atlasState && window.atlasState.inversion) || {};
  const page1State = inv._local_pca_dosage_state || { data, candidate: null, candidateList: [] };
  try { candMod.addCandidateToList(page1State, cand); } catch (_) {}
  try { candMod.setCandidate(page1State, cand); } catch (_) {}
  inv._local_pca_dosage_state = page1State;
  // Caller refreshes the pipeline so the new candidate shows up as a
  // seed chip in the same view. Used to be a direct _runPipeline call
  // — kept as a callback to avoid pulling run_pipeline.js into this
  // module's import graph.
  if (onAfterMerge) {
    try { await onAfterMerge(); } catch (_) {}
  }
}
