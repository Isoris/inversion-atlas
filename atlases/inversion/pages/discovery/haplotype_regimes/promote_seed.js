// pages/discovery/haplotype_regimes/promote_seed.js
//
// Promote the focal Stage 3 locus to a candidate inversion (2026-05-20).
// Extracted from haplotype_regimes.js as part of the Part C file
// split (2026-05-27).
//
// The four regime panels iterate `result.stage3.loci`, and the keyboard
// navigation mutates `state.regimesPanel.focal.seed_index` against THAT
// array (the variable is named seed_index for legacy reasons — it indexes
// loci, not the upstream Stage 1 seeds). The Stage 3 locus also carries
// the cleanest per-band sample assignment via `per_band_samples`, so we
// use it directly to populate `locked_labels`.
//
// Locus → candidate field mapping:
//   locus.chain.anchor_w?   → cand.ref_window (falls back to mid-window)
//   locus.K                 → cand.K
//   locus.per_band_samples  → cand.locked_labels (Set per band → Int8Array;
//                                                  unassigned samples = -1)
//   locus.s_window/e_window → cand.start_w/end_w
//   data.windows[s/e].bp    → cand.start_bp/end_bp
//   windowToL2[ref_window]  → cand.ref_l2
//   unique L2s in footprint → cand.l2_indices

import { setStatus } from './util.js';

/**
 * @param {HTMLElement} root        the page root (for the status bar)
 * @param {Object}      state       haplotype_regimes legacy state
 * @param {Object}      atlasState  atlas-core shared bucket — pushes
 *                                  the promoted candidate through
 *                                  local_pca_dosage's candidates module
 */
export async function promoteFocalSeed(root, state, atlasState) {
  const result = state._regimesResult;
  if (!result || !result.stage3 || !Array.isArray(result.stage3.loci)) {
    setStatus(root, 'no pipeline result — run the pipeline first');
    return;
  }
  const loci = result.stage3.loci;
  const focalIdx = (state.regimesPanel && state.regimesPanel.focal
                    && Number.isFinite(state.regimesPanel.focal.seed_index))
    ? (state.regimesPanel.focal.seed_index | 0) : 0;
  if (focalIdx < 0 || focalIdx >= loci.length) {
    setStatus(root, `focal index ${focalIdx} is out of range (0..${loci.length - 1})`);
    return;
  }
  const locus = loci[focalIdx];
  const data = state.data;
  if (!data || !data.windows) {
    setStatus(root, 'no scrubber data loaded');
    return;
  }

  const sw = locus.s_window | 0;
  const ew = locus.e_window | 0;
  // ref_window: prefer the originating Stage 1 seed's anchor_w (so the
  // candidate's "focal window" is the V-walker anchor, which is where the
  // band signal is strongest); fall back to the locus midpoint.
  let aw = Math.round((sw + ew) / 2);
  if (result.stage1 && Array.isArray(result.stage1.seeds) && locus.seed_id != null) {
    const matchedSeed = result.stage1.seeds.find(s => s && s.seed_id === locus.seed_id)
                     || result.stage1.seeds[locus.seed_id];
    if (matchedSeed && Number.isFinite(matchedSeed.anchor_w)) aw = matchedSeed.anchor_w | 0;
  }
  const winS = data.windows[sw];
  const winE = data.windows[ew];
  const start_bp = winS && Number.isFinite(winS.start_bp) ? winS.start_bp : null;
  const end_bp   = winE && Number.isFinite(winE.end_bp)   ? winE.end_bp   : null;

  // Convert per_band_samples (Array<Set<sample_idx>>) to a cohort-length
  // Int8Array. Samples not assigned to any band stay at -1.
  const nS = data.n_samples | 0;
  const locked = new Int8Array(nS).fill(-1);
  if (Array.isArray(locus.per_band_samples)) {
    for (let b = 0; b < locus.per_band_samples.length; b++) {
      const set = locus.per_band_samples[b];
      if (!set) continue;
      if (typeof set.forEach === 'function') {
        set.forEach((si) => {
          if (si >= 0 && si < nS) locked[si] = b;
        });
      }
    }
  }

  // ref_l2 + l2_indices from state.windowToL2 (built in _wireCtxCallbacks).
  const wToL2 = state.windowToL2;
  const ref_l2 = (wToL2 && aw >= 0 && aw < wToL2.length) ? wToL2[aw] : null;
  const l2_set = new Set();
  if (wToL2) {
    for (let w = sw; w <= ew; w++) {
      const li = wToL2[w];
      if (li >= 0) l2_set.add(li);
    }
  }
  const l2_indices = [...l2_set].sort((a, b) => a - b);

  // Lazy-import the local_pca_dosage candidates module so this page
  // doesn't carry the import at top-level.
  const candMod = await import('../local_pca_dosage/candidates.js')
    .catch(() => null);
  if (!candMod || typeof candMod.makeCandidateId !== 'function'
      || typeof candMod.addCandidateToList !== 'function'
      || typeof candMod.setCandidate !== 'function') {
    setStatus(root, 'local_pca_dosage/candidates.js helpers not available');
    return;
  }

  const cand = {
    source:        'seed_promote',
    chrom:         data.chrom || state.activeChrom,
    l2_indices,
    ref_l2:        (ref_l2 != null && ref_l2 >= 0) ? ref_l2 : null,
    ref_window:    aw,
    K:             locus.K | 0,
    locked_labels: locked,
    start_w:       sw,
    end_w:         ew,
    start_bp,
    end_bp,
    created_at:    Date.now(),
    notes: `Promoted from haplotype_regimes Stage 3 locus (seed_id=${
      locus.seed_id != null ? locus.seed_id : '?'
    }, K=${locus.K | 0}, span=${(ew - sw + 1) | 0}w, min_jaccard=${
      (locus.min_internal_jaccard != null ? locus.min_internal_jaccard.toFixed(3) : '—')
    }, stage2=${locus.stage2_verdict || '?'}).`,
    id:            candMod.makeCandidateId(),
    _from_seed: {
      anchor_w:             aw,
      seed_id:              locus.seed_id,
      stage2_verdict:       locus.stage2_verdict,
      stage2_linkage_group: locus.stage2_linkage_group,
      min_internal_jaccard: locus.min_internal_jaccard,
      n_samples_dropped:    locus.n_samples_dropped,
    },
  };

  // Push through the local_pca_dosage candidates module so the candidate
  // lands in the same carousel + persistence the lock-promote path uses.
  // Falls back to a synthetic shim when local_pca_dosage hasn't mounted yet.
  const inv = (atlasState && atlasState.inversion) || {};
  const page1State = inv._local_pca_dosage_state || {
    data,
    candidate: null,
    candidateList: [],
  };
  try { candMod.addCandidateToList(page1State, cand); }
  catch (e) { console.warn('addCandidateToList threw:', e); }
  try { candMod.setCandidate(page1State, cand); }
  catch (e) { console.warn('setCandidate threw:', e); }
  inv._local_pca_dosage_state = page1State;

  setStatus(root, `promoted locus #${focalIdx} (seed_id=${locus.seed_id}) → candidate ${cand.id}. Opening candidate focus…`);
  try { window.location.hash = '#/inversion/candidate_focus'; } catch (_) {}
}
