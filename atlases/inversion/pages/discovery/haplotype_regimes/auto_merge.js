// pages/discovery/haplotype_regimes/auto_merge.js
//
// Auto-merge V — single driver for both granularities (2026-05-27).
// Extracted from haplotype_regimes.js as part of the file split.
//
// Walks pipeline-result seeds (either full Stage 1 list or per-Stage-3
// macrostripe), runs the appropriate Cramér's V walker, and promotes
// each multi-seed chain as a candidate inversion via the
// local_pca_dosage candidates module. SPEC_cramers_v_seed_merge.md
// Phase 1 deliverable #2; compute is in shared/cramers_v_merge.js
// (runCramersVMergeLocal + runCramersVMergeMacrostripe).

import {
  runCramersVMergeLocal,
  runCramersVMergeMacrostripe,
} from '../../../shared/cramers_v_merge.js';
import { setStatus } from './util.js';

/**
 * @param {HTMLElement} root         the page root (for #rgStatus)
 * @param {Object}      state        haplotype_regimes legacy state
 * @param {Object}      atlasState   atlas-core shared bucket
 * @param {'local'|'macrostripe'} granularity
 * @param {Object}      [opts]
 * @param {Function}    [opts.onRefresh]  () → void. Called after the
 *     merge promotes candidates so the caller can refresh the seeds
 *     strip + L3 pairs table.
 */
export async function runAutoMerge(root, state, atlasState, granularity, opts) {
  const onRefresh = (opts && typeof opts.onRefresh === 'function') ? opts.onRefresh : null;
  const granLabel = (granularity === 'macrostripe')
    ? 'V macrostripe' : 'V';
  const result = state._regimesResult;
  if (!result || !result.stage1 || !Array.isArray(result.stage1.seeds)) {
    setStatus(root, 'no pipeline result — run the pipeline first');
    return;
  }
  const seeds = result.stage1.seeds;
  if (granularity === 'local' && seeds.length < 2) {
    setStatus(root, `auto-merge V: need ≥ 2 seeds, have ${seeds.length}`);
    return;
  }
  if (granularity === 'macrostripe' &&
      (!result.stage3 || !Array.isArray(result.stage3.loci) || result.stage3.loci.length === 0)) {
    setStatus(root, 'no Stage 3 macrostripes — pipeline did not produce loci');
    return;
  }
  const ctx = state._regimesCtx;
  if (!ctx || typeof ctx.getLabels !== 'function') {
    setStatus(root, 'pipeline ctx not wired — reload the page');
    return;
  }

  const loci = (granularity === 'macrostripe') ? result.stage3.loci : null;
  const setupMsg = (granularity === 'macrostripe')
    ? `auto-merge V macrostripe: walking ${loci.length} macrostripe${loci.length === 1 ? '' : 's'}…`
    : `auto-merge V: walking ${seeds.length - 1} adjacent pair${seeds.length - 1 === 1 ? '' : 's'}…`;
  setStatus(root, setupMsg);
  await new Promise(r => setTimeout(r, 0));
  const t0 = performance.now();

  let walker;
  try {
    walker = (granularity === 'macrostripe')
      ? runCramersVMergeMacrostripe({
          seeds, loci,
          getLabels: ctx.getLabels, getK: ctx.getK,
          opts: { emitSingletons: false },
        })
      : runCramersVMergeLocal({
          seeds,
          getLabels: ctx.getLabels, getK: ctx.getK,
          opts: { emitSingletons: false },
        });
  } catch (e) {
    console.error(`runCramersVMerge${granularity === 'macrostripe' ? 'Macrostripe' : 'Local'} threw:`, e);
    setStatus(root, `auto-merge ${granLabel} failed: ${e.message}`);
    return;
  }
  const ms = (performance.now() - t0).toFixed(0);
  const sum = walker.summary || {};
  const multiChains = (walker.chains || []).filter(c => c && c.length > 1);
  if (multiChains.length === 0) {
    const noopStatus = (granularity === 'macrostripe')
      ? `auto-merge V macrostripe ran in ${ms}ms · ${sum.n_loci || 0} loci · `
        + `${sum.n_seeds_total || 0} seeds inside · ${sum.n_pairs || 0} pairs · `
        + `${sum.n_merge || 0} MERGE · ${sum.n_separate || 0} SEPARATE · `
        + `${sum.n_insufficient || 0} INSUFFICIENT · no multi-seed chains to promote`
      : `auto-merge V ran in ${ms}ms · ${sum.n_pairs || 0} pairs · `
        + `${sum.n_merge || 0} MERGE · ${sum.n_separate || 0} SEPARATE · `
        + `${sum.n_insufficient || 0} INSUFFICIENT · no multi-seed chains to promote`;
    setStatus(root, noopStatus);
    return;
  }

  // Promotion path — common to both granularities apart from how
  // each chain's bookkeeping fields differ.
  const candMod = await import('../local_pca_dosage/candidates.js').catch(() => null);
  if (!candMod || typeof candMod.makeCandidateId !== 'function'
      || typeof candMod.addCandidateToList !== 'function'
      || typeof candMod.setCandidate !== 'function') {
    setStatus(root, 'local_pca_dosage/candidates.js helpers not available');
    return;
  }
  const data = state.data;
  const nS = data.n_samples | 0;
  const inv = (atlasState && atlasState.inversion) || {};
  const page1State = inv._local_pca_dosage_state || {
    data, candidate: null, candidateList: [],
  };

  let lastCand = null;
  let nPromoted = 0;
  for (const chain of multiChains) {
    // Granularity-specific reconstruction of (seedA, seedB, chainV).
    let seedA, seedB, chainV;
    if (granularity === 'macrostripe') {
      const entry = walker.per_locus[chain.locus_idx];
      if (!entry) continue;
      const lS = entry.locus.s_window | 0;
      const lE = entry.locus.e_window | 0;
      const insideSeeds = [];
      for (const sd of seeds) {
        if (!sd) continue;
        const aw = sd.anchor_w | 0;
        if (aw >= lS && aw <= lE) insideSeeds.push(sd);
      }
      seedA = insideSeeds[chain.seed_start_i];
      seedB = insideSeeds[chain.seed_end_i];
      chainV = [];
      const vs = entry.verdicts || [];
      for (let i = chain.seed_start_i; i < chain.seed_end_i; i++) {
        const ve = vs[i];
        if (ve && Number.isFinite(ve.v)) chainV.push(ve.v.toFixed(3));
      }
    } else {
      seedA = seeds[chain.start_i];
      seedB = seeds[chain.end_i];
      chainV = [];
      for (let i = chain.start_i; i < chain.end_i; i++) {
        const ve = walker.verdicts[i];
        if (ve && Number.isFinite(ve.v)) chainV.push(ve.v.toFixed(3));
      }
    }
    if (!seedA || !seedB) continue;

    const start_w = seedA.s_window | 0;
    const end_w   = seedB.e_window | 0;
    const ref_window = Number.isFinite(seedA.anchor_w) ? seedA.anchor_w | 0
                     : Math.round((start_w + end_w) / 2);
    const winS = data.windows && data.windows[start_w];
    const winE = data.windows && data.windows[end_w];
    const start_bp = winS && Number.isFinite(winS.start_bp) ? winS.start_bp : null;
    const end_bp   = winE && Number.isFinite(winE.end_bp)   ? winE.end_bp   : null;

    const labelsA = ctx.getLabels(seedA.anchor_w | 0);
    const K = (typeof ctx.getK === 'function' ? ctx.getK(seedA.anchor_w | 0) : 0)
           || seedA.K_a || 0;
    const locked = new Int8Array(nS).fill(-1);
    if (labelsA && labelsA.length) {
      for (let s = 0; s < Math.min(nS, labelsA.length); s++) {
        const k = labelsA[s];
        if (k >= 0 && k < K) locked[s] = k;
      }
    }
    const wToL2 = state.windowToL2;
    const ref_l2 = (wToL2 && ref_window >= 0 && ref_window < wToL2.length)
      ? wToL2[ref_window] : null;
    const l2_set = new Set();
    if (wToL2) {
      for (let w = start_w; w <= end_w; w++) {
        const li = wToL2[w];
        if (li >= 0) l2_set.add(li);
      }
    }
    const l2_indices = [...l2_set].sort((a, b) => a - b);

    // Granularity-specific provenance fields.
    const sourceTag = (granularity === 'macrostripe')
      ? 'auto_cramers_v_macrostripe' : 'auto_cramers_v_local';
    const modeNote  = (granularity === 'macrostripe')
      ? `Mode 2 post_long_range, locus ${chain.locus_idx}, ` +
        `seeds ${chain.seed_start_i}..${chain.seed_end_i}`
      : `Mode 1 insulated_local, seeds ${chain.start_i}..${chain.end_i}`;
    const provKey = (granularity === 'macrostripe')
      ? '_from_cramers_v_macrostripe' : '_from_cramers_v_local';
    const provVal = (granularity === 'macrostripe')
      ? {
          locus_idx:      chain.locus_idx,
          chain_start_i:  chain.seed_start_i,
          chain_end_i:    chain.seed_end_i,
          chain_length:   chain.length,
          chain_v_values: chainV.map(v => Number(v)),
          anchor_seed_id: seedA.seed_id,
        }
      : {
          chain_start_i:  chain.start_i,
          chain_end_i:    chain.end_i,
          chain_length:   chain.length,
          chain_v_values: chainV.map(v => Number(v)),
          anchor_seed_id: seedA.seed_id,
        };

    const cand = {
      source:        sourceTag,
      chrom:         data.chrom || state.activeChrom,
      l2_indices,
      ref_l2:        (ref_l2 != null && ref_l2 >= 0) ? ref_l2 : null,
      ref_window,
      K,
      locked_labels: locked,
      start_w, end_w,
      start_bp, end_bp,
      created_at:    Date.now(),
      notes: `Auto-merged from Cramér's V walker (${modeNote}, ` +
             `${chain.length} seeds, V_chain=[${chainV.join(', ')}]).`,
      id:            candMod.makeCandidateId(),
      [provKey]:     provVal,
    };
    try { candMod.addCandidateToList(page1State, cand); nPromoted++; lastCand = cand; }
    catch (e) { console.warn('addCandidateToList threw for chain:', chain, e); }
  }
  if (lastCand) {
    try { candMod.setCandidate(page1State, lastCand); }
    catch (e) { console.warn('setCandidate threw:', e); }
  }
  inv._local_pca_dosage_state = page1State;

  const finalStatus = (granularity === 'macrostripe')
    ? `auto-merge V macrostripe ran in ${ms}ms · ${sum.n_loci} loci · `
      + `${sum.n_loci_with_chains} with chains · ${sum.n_pairs} pairs · `
      + `${sum.n_merge} MERGE · promoted ${nPromoted} chain${nPromoted === 1 ? '' : 's'} `
      + `(${multiChains.reduce((a, c) => a + c.length, 0)} seeds → ${nPromoted} candidates)`
    : `auto-merge V ran in ${ms}ms · ${sum.n_pairs} pairs · `
      + `${sum.n_merge} MERGE · ${sum.n_separate} SEPARATE · `
      + `${sum.n_insufficient} INSUFFICIENT · promoted ${nPromoted} `
      + `chain${nPromoted === 1 ? '' : 's'} (${multiChains.reduce((a, c) => a + c.length, 0)} seeds → ${nPromoted} candidates)`;
  setStatus(root, finalStatus);

  // Refresh seeds strip + L3 pairs table so the new candidates surface.
  if (onRefresh) { try { onRefresh(); } catch (_) {} }
}
