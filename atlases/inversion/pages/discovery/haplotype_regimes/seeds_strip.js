// pages/discovery/haplotype_regimes/seeds_strip.js
//
// Seeds inspector strip (2026-05-20). Extracted from
// haplotype_regimes.js as part of the Part C file split (2026-05-27).
//
// Horizontal scrollable chip list at the top of the page, one chip per
// Stage 3 locus (the panels iterate stage3.loci, so the chip indexes
// match what arrow keys + ★ promote target). Click a chip to set
// state.regimesPanel.focal.seed_index + repaint the 4 panels. Hover a
// chip to see the full anchor/span tooltip. The active chip is
// accent-filled; others are panel-2.
//
// Bonus columns on each chip:
//   #N     — seed list index (1-based for readability)
//   ●      — color-dot from band_quality / min_internal_jaccard
//            (greener = stronger structural signal)
//   X Mb   — anchor center in Mb (from data.windows[anchor_w].center_mb)
//   Nw     — n_windows the locus spans

import { regimeGroupsFromBands } from '../../../shared/candidate_groups.js';

/**
 * Render or hide the seeds chip strip + paint the interpretation
 * drawer header alongside it. No-op when there's no pipeline result
 * yet.
 *
 * @param {HTMLElement} root
 * @param {Object} state    legacy state — reads _regimesResult,
 *                          state.data, state.regimesPanel.focal
 */
export function renderSeedsStrip(root, state) {
  if (!root || typeof document === 'undefined') return;
  const wrap = root.querySelector('#rgSeedsStripWrap');
  const list = root.querySelector('#rgSeedsStripList');
  const interpret = root.querySelector('#rgInterpretDrawer');
  if (!wrap || !list) return;
  const result = state && state._regimesResult;
  const loci   = result && result.stage3 && Array.isArray(result.stage3.loci)
    ? result.stage3.loci : [];
  const seeds  = result && result.stage1 && Array.isArray(result.stage1.seeds)
    ? result.stage1.seeds : [];
  if (loci.length === 0) {
    wrap.style.display = 'none';
    list.innerHTML = '';
    if (interpret) interpret.style.display = 'none';
    return;
  }
  wrap.style.display = 'flex';
  // 2026-05-20: surface the interpretation drawer alongside the seeds
  // strip — both appear/disappear in lock-step with pipeline results.
  if (interpret) interpret.style.display = '';
  const data = state.data;
  const wins = (data && Array.isArray(data.windows)) ? data.windows : null;
  const focal = (state.regimesPanel && state.regimesPanel.focal
                 && Number.isFinite(state.regimesPanel.focal.seed_index))
    ? state.regimesPanel.focal.seed_index | 0 : 0;
  // Rebuild the chip list.
  list.innerHTML = '';
  for (let i = 0; i < loci.length; i++) {
    const locus = loci[i];
    if (!locus) continue;
    const seed = (Number.isFinite(locus.seed_id) && seeds[locus.seed_id]) ? seeds[locus.seed_id] : null;
    const anchorW = seed && Number.isFinite(seed.anchor_w)
      ? seed.anchor_w | 0
      : Math.round((locus.s_window + locus.e_window) / 2);
    const mb = (wins && wins[anchorW] && Number.isFinite(wins[anchorW].center_mb))
      ? wins[anchorW].center_mb : null;
    const nw = (locus.e_window - locus.s_window + 1) | 0;
    const quality = seed && Number.isFinite(seed.anchor_band_quality)
      ? seed.anchor_band_quality
      : (Number.isFinite(locus.min_internal_jaccard) ? locus.min_internal_jaccard : 0.5);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'rg-seed-chip' + (i === focal ? ' active' : '');
    chip.dataset.seedIdx = String(i);
    chip.title = [
      `seed #${i} (id=${locus.seed_id != null ? locus.seed_id : '?'})`,
      `anchor: window ${anchorW}${mb != null ? ` · ${mb.toFixed(3)} Mb` : ''}`,
      `span: ${nw} windows (${locus.s_window}–${locus.e_window})`,
      `K: ${locus.K | 0}`,
      `min internal jaccard: ${
        Number.isFinite(locus.min_internal_jaccard) ? locus.min_internal_jaccard.toFixed(3) : '—'
      }`,
      locus.stage2_verdict ? `stage2 verdict: ${locus.stage2_verdict}` : null,
      'Click to make this seed focal (arrow keys also navigate).',
    ].filter(Boolean).join('\n');
    chip.innerHTML =
      '<span class="rg-seed-dot" style="background:' + _qualityDotColor(quality) + ';"></span>' +
      '<span class="rg-seed-idx">#' + i + '</span>' +
      '<span class="rg-seed-meta">' +
        (mb != null ? mb.toFixed(2) + ' Mb · ' : '') +
        nw + 'w' +
      '</span>';
    chip.addEventListener('click', () => _focusSeedFromChip(state, i));
    list.appendChild(chip);
  }
}

function _qualityDotColor(q) {
  // 0..1 → red → amber → green. Anything ≥ 0.7 is green; ≥ 0.4 is amber; below is red.
  if (!Number.isFinite(q)) return '#5a6472';
  if (q >= 0.7) return '#3cc08a';
  if (q >= 0.4) return '#f5a524';
  return '#e0555c';
}

/**
 * Push the focal seed's per-band partition into atlasState.shared.activeGroups.
 *
 * The Stage 3 locus carries `per_band_samples` — `Array<Set<sample_idx>>` —
 * which is the canonical regime-band partition. We convert it to a flat
 * Int8Array of band-index-per-sample (same shape candidate.locked_labels
 * uses) and feed it through `regimeGroupsFromBands` so popstats and any
 * other consumer of `shared.activeGroups` picks up the partition without
 * needing to know about the regimes-pipeline internals.
 *
 * Fires on three entry points:
 *   - _afterPipelineRun (initial seed becomes focal after pipeline finishes)
 *   - _focusSeedFromChip (user clicks a different seed chip)
 *   - wireSeedStripFocalSync (arrow-key cycle through seeds)
 *
 * No-op when nothing meaningful to push (no atlasState, no result, no
 * focal index, no per_band_samples on the locus).
 */
export function pushFocalSeedGroups(state) {
  const atlasState = state && state._atlasState;
  if (!atlasState || typeof atlasState.setActiveGroups !== 'function') return;
  const rp = state.regimesPanel;
  if (!rp || !rp.focal || !Number.isFinite(rp.focal.seed_index)) return;
  const focalIdx = rp.focal.seed_index | 0;
  const loci = state._regimesResult && state._regimesResult.stage3
            && state._regimesResult.stage3.loci;
  if (!Array.isArray(loci) || focalIdx < 0 || focalIdx >= loci.length) return;
  const locus = loci[focalIdx];
  if (!locus || !Array.isArray(locus.per_band_samples)) return;
  const data = state.data;
  if (!data || !Array.isArray(data.samples) || !Number.isFinite(data.n_samples)) return;

  // Flatten per_band_samples (Array<Set<sample_idx>>) → Int8Array per sample.
  // Same conversion the promote path uses (see _promoteFocalSeed); kept inline
  // here so this helper has no side effects on the promote module.
  const nS = data.n_samples | 0;
  const bandPerSample = new Array(nS).fill(-1);
  for (let b = 0; b < locus.per_band_samples.length; b++) {
    const set = locus.per_band_samples[b];
    if (!set || typeof set.forEach !== 'function') continue;
    set.forEach((si) => { if (si >= 0 && si < nS) bandPerSample[si] = b; });
  }

  const derived = regimeGroupsFromBands(bandPerSample, data, { labelStyle: 'server' });
  if (derived && derived.groups) {
    try { atlasState.setActiveGroups(derived.groups); }
    catch (e) { console.warn('haplotype_regimes: setActiveGroups threw —', e); }
  }
}

function _focusSeedFromChip(state, idx) {
  if (!state || !state.regimesPanel || !state.regimesPanel.focal) return;
  const loci = state._regimesResult && state._regimesResult.stage3
            && state._regimesResult.stage3.loci;
  if (!Array.isArray(loci) || idx < 0 || idx >= loci.length) return;
  const rp = state.regimesPanel;
  rp.focal.seed_index = idx;
  pushFocalSeedGroups(state);
  // Reset band_mask to the first available subset for the new locus.
  rp.focal.band_mask = 1;
  // If the new seed lives on a different chromosome, snap chrom panels too.
  const newChr = loci[idx].chromosome_idx;
  if (newChr != null && newChr !== rp.current_chromosome_idx) {
    rp.current_chromosome_idx = newChr;
    if (state._regimesGenomeState) {
      state._regimesGenomeState.regimesPanel.current_chromosome_idx = newChr;
    }
    rp.track = null;
  }
  // Update active-chip styling synchronously so the visual feedback is
  // instant; the 4 panels repaint via window._refreshRegimesPanels which
  // initRegimesPage installs as a global re-render entry point.
  const list = document.getElementById('rgSeedsStripList');
  if (list) {
    list.querySelectorAll('.rg-seed-chip').forEach(c => {
      c.classList.toggle('active', (c.dataset.seedIdx | 0) === idx);
    });
  }
  // Re-paint by re-running initRegimesPage's draw chain — simplest
  // available API. The pipeline result + ctx are still cached on state
  // from the last _runPipeline.
  if (typeof window !== 'undefined' && typeof window._refreshRegimesPanels === 'function') {
    try { window._refreshRegimesPanels(state); } catch (_) {}
  }
}

/**
 * Sync the strip's active chip with arrow-key navigation. The keyboard
 * handler in regimes_page.js mutates rp.focal.seed_index then triggers
 * the panel repaint chain — we hook a MutationObserver-free poll by
 * listening for keydown at document level and re-running the active-
 * class update after the keydown handler runs (rAF defers us to AFTER).
 *
 * Idempotent — guards a `document._rgSeedStripFocalSyncWired` flag.
 *
 * @param {HTMLElement} root
 * @param {Object} state
 */
export function wireSeedStripFocalSync(root, state) {
  if (!root || typeof document === 'undefined') return;
  if (document._rgSeedStripFocalSyncWired === '1') return;
  document._rgSeedStripFocalSyncWired = '1';
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight'
        && e.key !== 'Home' && e.key !== 'End') return;
    // Defer so regimes_page.js's keyboard handler runs first.
    requestAnimationFrame(() => {
      const rp = state && state.regimesPanel;
      if (!rp || !rp.focal) return;
      const focal = rp.focal.seed_index | 0;
      const list = document.getElementById('rgSeedsStripList');
      if (!list) return;
      let target = null;
      list.querySelectorAll('.rg-seed-chip').forEach(c => {
        const isActive = (c.dataset.seedIdx | 0) === focal;
        c.classList.toggle('active', isActive);
        if (isActive) target = c;
      });
      // Scroll the active chip into view if it slid off-screen.
      if (target && typeof target.scrollIntoView === 'function') {
        try { target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
        catch (_) {}
      }
      // Push the new focal seed's regime partition to shared.activeGroups.
      try { pushFocalSeedGroups(state); } catch (_) {}
    });
  });
}
