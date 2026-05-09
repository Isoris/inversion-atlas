// pages/discovery/page1/l3_panel.js
//
// L3 contingency panel — three render modes (round 4 split, 2026-05-06).
//
// renderL3Panel:               primary L3 contingency / Hungarian-aligned
//                              concordance view.
// renderL3PanelSlab:           per-K slab variant (K=2,3,4,5,6).
// renderL3PanelScaleStability: scale-stability variant (NN20/40/80).
//
// Bodies extracted verbatim from the pre-split page1.js (eighth pass).

import { alignLabels } from '../../../shared/hungarian.js';

import { _setActiveState } from './_state.js';
import { getL2Cluster, getL2ClusterAt } from './_data.js';

// --- renderL3Panel(state) — legacy lines 48685-49193 ---
export function renderL3Panel(state) {
  _setActiveState(state);
  // v4.1: install delegated click handler for the L3 metric-cycle chip,
  // once per document lifetime. We listen on document.body and check the
  // event target's class so we don't re-attach on every L3 re-render.
  if (!window._v41HandlerInstalled && typeof document !== 'undefined') {
    window._v41HandlerInstalled = true;
    document.body.addEventListener('click', function (ev) {
      // Find the closest .l3-metric-chip (event might fire on inner span)
      let el = ev.target;
      while (el && el !== document.body) {
        if (el.classList && el.classList.contains('l3-metric-chip')) break;
        el = el.parentNode;
      }
      if (!el || el === document.body) return;
      // Cycle through cramer → nmi → ami → ari → cramer
      const order = ['cramer', 'nmi', 'ami', 'ari'];
      const labels = { cramer: "Cramér's V", nmi: 'NMI', ami: 'AMI', ari: 'ARI' };
      const tips = {
        cramer: 'Effect size of association in contingency table; N-independent. Does NOT account for label permutations — answers "are these variables associated?" not "are these the same partition?"',
        nmi: 'Normalized Mutual Information (Strehl-Ghosh, geometric-mean variant). [0,1]. Standard for partition comparison; permutation-invariant. Slightly sensitive to imbalanced cluster sizes.',
        ami: 'Adjusted Mutual Information (Vinh-Epps-Bailey 2010). Corrects NMI for chance agreement under hypergeometric null. Best metric for imbalanced K-means partitions like the hatchery 180/30/16 split.',
        ari: 'Adjusted Rand Index (Hubert-Arabie 1985). [-1,1] with 0 = chance. Counts agreeing sample-pairs across both partitions, adjusted for expectation under random labelling. Robust to cluster-size imbalance.',
      };
      // Different bands per metric
      function bandFor(key, v) {
        const t = { cramer: [0.10, 0.30, 0.50], nmi: [0.30, 0.50, 0.75],
                    ami: [0.20, 0.40, 0.65], ari: [0.20, 0.40, 0.65] }[key];
        if (v >= t[2]) return 'large';
        if (v >= t[1]) return 'medium';
        if (v >= t[0]) return 'small';
        return 'none';
      }
      const cur = el.dataset.metricActive || 'cramer';
      const nextIdx = (order.indexOf(cur) + 1) % order.length;
      const next = order[nextIdx];
      const v = parseFloat(el.dataset[next]);
      // Update state + persist
      state.l3SecondaryMetric = next;
      try { localStorage.setItem('pca_scrubber_v3.l3SecondaryMetric', next); } catch (_) {}
      // Update chip in-place — read the inner spans by querySelector
      el.dataset.metricActive = next;
      el.title = `${tips[next]}\n\nClick to cycle: Cramér's V → NMI → AMI → ARI → Cramér's V`;
      const lblSpan = el.querySelector('.lbl');
      const valSpan = el.querySelector('.val');
      if (lblSpan) lblSpan.innerHTML = `${labels[next]} <span class="dim" style="font-size:9px; opacity:0.6;">▸</span>`;
      if (valSpan) valSpan.innerHTML = `${v.toFixed(2)} <span class="dim" style="font-size:10px;">${bandFor(next, v)}</span>`;
      ev.stopPropagation();
    }, true);
    // Also restore from localStorage on first render
    try {
      const saved = localStorage.getItem('pca_scrubber_v3.l3SecondaryMetric');
      if (saved && ['cramer', 'nmi', 'ami', 'ari'].includes(saved)) {
        state.l3SecondaryMetric = saved;
      }
    } catch (_) {}
    // v4.1: wire the L3 re-clustering mode picker. Restore from localStorage,
    // set the dropdown's value, attach change listener that persists. The
    // handler does NOT yet trigger a re-render of the contingency — that's
    // post-v4.1 work. Today the dropdown is a state slot only.
    try {
      const savedMode = localStorage.getItem('pca_scrubber_v3.l3ReclusterMode');
      const validModes = ['kmeans-K3', 'kmeans-K6', 'distance-uv', 'uv-rotated',
                          'uv-denoise', 'uv-dbscan', 'uv-dist-rank', 'uv-dist-fuzzy'];
      if (savedMode && validModes.includes(savedMode)) {
        state.l3ReclusterMode = savedMode;
      }
    } catch (_) {}
    const reSel = document.getElementById('l3ReclusterSel');
    if (reSel) {
      reSel.value = state.l3ReclusterMode;
      reSel.addEventListener('change', function () {
        const v = reSel.value;
        // Only accept enabled modes; disabled options shouldn't reach here
        // (the disabled attr blocks selection in browsers) but guard anyway.
        const validModes = ['kmeans-K3', 'kmeans-K6', 'distance-uv', 'uv-rotated',
                            'uv-denoise', 'uv-dbscan', 'uv-dist-rank', 'uv-dist-fuzzy'];
        if (validModes.includes(v)) {
          state.l3ReclusterMode = v;
          try { localStorage.setItem('pca_scrubber_v3.l3ReclusterMode', v); } catch (_) {}
          // v4.1 continue: trigger an L3 re-render so the contingency rebuilds
          // against the new mode. Three call sites pick up the change:
          // (1) the focal-vs-neighbor contingency (line ~14328 in
          // _renderL3Fingerprint via the offset != 0 branch), (2) the
          // conservation calculation (in the focal pane's stats), (3) any
          // tracked-samples readouts that read from cmp.table. Cache hits
          // for the new mode are O(1) after first compute, so re-renders
          // are fast even on chromosomes with many L2s.
          if (typeof renderL3Panel === 'function') {
            renderL3Panel(state);
          }
        }
      });
    }
  }

  // v4 turn 32: install per-pane toolbar delegation once. Fires for clicks
  // on K-mode / color-mode buttons and changes on the recluster select
  // inside any of the L3 panes' header toolbars.
  if (typeof _wireL3PaneToolsDelegation === 'function') {
    try { _wireL3PaneToolsDelegation(); } catch (_) {}
  }

  const d = state.data;
  if (!d) return;

  // v4 turn 12a (Deliverable D): scale-stability mode short-circuits both
  // the L2 path AND the slab path. When state.l3Mode === 'scale_stability'
  // the carousel shows three different SCALES (fine / medium / coarse) on
  // the same focal window, with cross-scale fuse/split detection.
  if (state.l3Mode === 'scale_stability') {
    return renderL3PanelScaleStability();
  }

  // v3.45: slab mode short-circuits the L2-based path. compareUnit ≠ 'L2'
  // means each pane represents a slab of W windows, not an L2 envelope.
  // Sub-step A: render only the focal slab pane; neighbor panes show
  // a placeholder (sub-step B will wire them).
  if (state.compareUnit && state.compareUnit !== 'L2') {
    return renderL3PanelSlab();
  }

  // v3.99 turn 7 perf: short-circuit when nothing that affects pane content
  // has changed since the last render. The L3 panes are a pure function of
  // (curL2, layout, color mode, K mode, K, agg, merge τ, α, min n/grp,
  //  lockedLabels, l3Detailed, secondaryL2, candidate-draft state, tracked
  //  samples for the detailed readout, bcScope). state.cur within the same
  //  L2 doesn't affect anything — the panes show envelope-level clusters,
  //  not cursor-relative state. Skipping the rebuild on same-L2 steps avoids
  //  ~5 mini-PCA canvas redraws + the DOM teardown of body.innerHTML='' +
  //  full pane reconstruction. Big payoff for window-by-window scrubbing.
  const cur = state.cur;
  const curL2 = state.windowToL2 ? state.windowToL2[cur] : -1;
  const fp = _renderL3Fingerprint(curL2);
  if (state._l3CacheFp === fp && state._l3CacheRendered === true) {
    return;   // same render — DOM unchanged
  }
  state._l3CacheFp = fp;
  state._l3CacheRendered = true;

  const layoutKey = state.l3Layout || 'leftright';
  const layout = L3_LAYOUTS[layoutKey] || L3_LAYOUTS.leftright;
  const body = document.getElementById('l3Body');
  body.style.gridTemplateColumns = layout.cols;
  body.innerHTML = '';

  // Meta line
  const metaEl = document.getElementById('l3Meta');
  if (curL2 < 0) {
    metaEl.textContent = '— scrub into an L2 envelope —';
    body.innerHTML = '<div class="l3-col"><div class="dim" style="padding:12px;">scroll into an L2 envelope</div></div>';
    return;
  }
  metaEl.innerHTML = `K=${state.k} · agg=${state.aggMethod} · merge τ=${state.mergeThr.toFixed(2)} · α=${state.alpha.toFixed(3)} · min n/grp=${state.minNGroup}`;

  // ---- DUAL LAYOUT: two pinned L2 envelopes + middle comparison column ----
  if (layoutKey === 'dual' && state.secondaryL2 != null) {
    const aIdx = curL2;
    const bIdx = state.secondaryL2;
    if (aIdx < 0 || bIdx < 0 || aIdx === bIdx) {
      body.innerHTML = '<div class="l3-col"><div class="dim" style="padding:12px;">Dual layout needs two distinct L2 envelopes pinned. Scroll to one, click 📌, then scroll to the other.</div></div>';
      return;
    }
    const aEnv = d.l2_envelopes[aIdx];
    const bEnv = d.l2_envelopes[bIdx];
    const aCl  = getL2Cluster(state, aIdx);
    const bCl  = getL2Cluster(state, bIdx);
    const cmpAB = compareL2Pair(aIdx, bIdx);

    // ---- Column A: focal A ----
    const colA = document.createElement('div');
    colA.className = 'l3-col';
    const h3A = document.createElement('h3');
    h3A.classList.add('focal');
    h3A.innerHTML = `🅰️ <b>${shortId(aEnv.candidate_id)}</b> <span class="dim" style="font-weight:400;">${aEnv.n_windows}W · sim ${fmt(aEnv.mean_sim)}</span>`;
    colA.appendChild(h3A);
    const miniA = document.createElement('canvas');
    miniA.className = 'mini-pca';
    colA.appendChild(miniA);
    const contentA = document.createElement('div');
    contentA.className = 'ct-content';
    contentA.innerHTML = focalContentHtml(aCl, aEnv, aIdx);
    colA.appendChild(contentA);
    body.appendChild(colA);

    // ---- Column M (middle): A vs B contingency ----
    const colM = document.createElement('div');
    colM.className = 'l3-col';
    const h3M = document.createElement('h3');
    h3M.innerHTML = `🅰️ vs 🅱️ <span class="dim" style="font-weight:400;">contingency</span>`;
    colM.appendChild(h3M);
    // No mini for middle
    const contentM = document.createElement('div');
    contentM.className = 'ct-content';
    contentM.innerHTML = ctHtml(cmpAB, +1);  // offset +1 just for arrow display
    colM.appendChild(contentM);
    body.appendChild(colM);

    // ---- Column B: focal B (pinned) ----
    const colB = document.createElement('div');
    colB.className = 'l3-col';
    const h3B = document.createElement('h3');
    h3B.classList.add('focal');
    h3B.innerHTML = `🅱️ <b>${shortId(bEnv.candidate_id)}</b> <span class="dim" style="font-weight:400;">${bEnv.n_windows}W · sim ${fmt(bEnv.mean_sim)}</span>`;
    colB.appendChild(h3B);
    const miniB = document.createElement('canvas');
    miniB.className = 'mini-pca';
    colB.appendChild(miniB);
    const contentB = document.createElement('div');
    contentB.className = 'ct-content';
    contentB.innerHTML = focalContentHtml(bCl, bEnv, bIdx);
    colB.appendChild(contentB);
    body.appendChild(colB);

    // Draw both mini PCAs after layout, both Hungarian-aligned to A so colors
    // are consistent across the two-column strip (matches the rest of the UI).
    // In the A/B dual-pinned layout we treat A as offset=0 (focal) and B as
    // offset=+1 for palette purposes, so the user can still distinguish panes
    // when l3ColorMode is 'unique' or 'dual'.
    requestAnimationFrame(() => {
      drawMiniPCA(miniA, aIdx, aCl ? aCl.labels : null,
        { paneOffset: 0, focalLabels: null });
      const aCl_full = aCl;
      const aFocalLabels = aCl_full ? (aCl_full.fixedKLabels || aCl_full.labels) : null;
      drawMiniPCA(miniB, bIdx, alignedLabelsTo(aIdx, bIdx),
        { paneOffset: +1, focalLabels: aFocalLabels });
    });
    return;
  }

  // Build one column per offset
  // For 'dual' mode we need focal-aligned labels per neighbor (i.e. how the
  // focal would label this neighbor's samples). That's exactly what
  // alignLabels(focal_lab, neighbor_lab) gives us — the inverse perm — so we
  // pass each neighbor its own labels for fill, and the focal labels (cf)
  // re-keyed to neighbor sample index for the ring. Since labels are arrays
  // indexed by sample index in BOTH L2s (sample identity is preserved across
  // L2s), focal's labels work directly as the "what would focal say about
  // this sample" reference for any pane.
  //
  // l3KMode controls per-column section rendering:
  //   'k3' (default): one section per column at state.k (typically 3)
  //   'k6': one section per column forced to K=6
  //   'both': two sections per column — first at K=3, then K=6 — stacked
  const l3kMode = state.l3KMode || 'k3';
  // Decide which K(s) to render. Always include state.k as the primary K when
  // mode is 'k3' (so adaptive-K mode flows through correctly), use exactly 6
  // for 'k6', and both 3 and 6 for 'both'.
  const ksToRender = (l3kMode === 'k6') ? [6]
                   : (l3kMode === 'both') ? [state.k, 6]
                   : [state.k];

  layout.offsets.forEach((offset, colIdx) => {
    const isFocal = (offset === 0);
    const l2idx   = l2NeighborAt(curL2, offset);

    const col = document.createElement('div');
    col.className = 'l3-col';
    // v3.66: tag the column with a gold backdrop when this L2 is part of the
    // active candidate-mode draft. Solid gold = "all joins are MERGE";
    // dashed gold border = "draft includes a non-MERGE join" (warning).
    if (typeof l2DraftStatus === 'function') {
      const dStatus = l2DraftStatus(l2idx);
      if (dStatus === 'in')      col.classList.add('in-candidate');
      else if (dStatus === 'in-warn') col.classList.add('in-candidate-warn');
    }

    const h3 = document.createElement('h3');
    if (isFocal) h3.classList.add('focal');
    let titlePrefix = '';
    if (offset < 0) titlePrefix = (offset === -1 ? '←' : '←←');
    else if (offset > 0) titlePrefix = (offset === +1 ? '→' : '→→');
    else titlePrefix = '◆';
    // v4 turn 32: per-pane toolbar mirrors of the global L3 controls. Sits
    // on the right of the h3 (flex layout below). Tools render even on
    // empty panes (l2idx == null) so layout stays stable across panes.
    const paneToolsHtml = (typeof _l3PaneHeaderToolsHtml === 'function')
      ? _l3PaneHeaderToolsHtml() : '';
    if (l2idx == null) {
      h3.innerHTML = `<span class="l3-pane-title">${titlePrefix} <b>—</b></span>${paneToolsHtml}`;
    } else {
      const env = d.l2_envelopes[l2idx];
      h3.innerHTML = `<span class="l3-pane-title">${titlePrefix} <b>${shortId(env.candidate_id)}</b> <span class="dim" style="font-weight:400;">${env.n_windows}W · sim ${fmt(env.mean_sim)}</span></span>${paneToolsHtml}`;
    }
    col.appendChild(h3);

    if (l2idx == null) {
      // Empty placeholder column — single mini + message, no per-K split.
      const miniCanvas = document.createElement('canvas');
      miniCanvas.className = 'mini-pca';
      col.appendChild(miniCanvas);
      const content = document.createElement('div');
      content.className = 'ct-content';
      content.innerHTML = `<div class="dim" style="padding: 4px 0;">no neighbor at offset ${offset}<br>(boundary of L1 parent)</div>`;
      col.appendChild(content);
      drawMiniPCAEmpty(miniCanvas);
      body.appendChild(col);
      return;
    }

    // For each K in ksToRender, append a (mini-PCA + content) section.
    // Each section is independently rendered at its own K. In 'both' mode,
    // a small label badge identifies the K above each mini-PCA so the user
    // can tell K=3 from K=6 at a glance.
    //
    // v3.52: when only one K is rendered, append " · K=N" to the h3 caption
    // (saves a vertical line). Standalone badge only shown in multi-K mode
    // and only between sections (not before the first one).
    if (ksToRender.length === 1) {
      const K = ksToRender[0];
      // Append ' · K=N' to the existing h3 inline
      const dimSpan = h3.querySelector('span.dim');
      if (dimSpan) {
        dimSpan.innerHTML += ` · K=${K}`;
      }
    }
    // v3.72: in K=both mode the invariant meta block (windows/span/SNPs/density)
    // is the same for K=3 and K=6 — render it once at the top of the focal
    // column, then pass skipInvariantMeta:true to focalContentHtml in each
    // per-K section so it doesn't repeat. Only do this for the focal column
    // (offset === 0) since neighbor columns don't render the meta block.
    const hoistInvariantMeta = (ksToRender.length > 1) && isFocal;
    if (hoistInvariantMeta) {
      const env_focal = d.l2_envelopes[l2idx];
      // Use any K's cluster to read cl.nW (it's K-independent — number of
      // windows in the L2). Prefer state.k to keep semantics with old code.
      const clForStats = getL2Cluster(state, l2idx) || getL2ClusterAt(state, l2idx, ksToRender[0]);
      if (clForStats) {
        const stats = _l2InvariantStats(clForStats, env_focal, l2idx);
        const sharedHeader = document.createElement('div');
        sharedHeader.style.cssText = 'padding: 4px 0; border-bottom: 1px dashed var(--rule); margin-bottom: 2px;';
        sharedHeader.innerHTML = _invariantMetaInlineHtml(stats);
        col.appendChild(sharedHeader);
      }
    }
    ksToRender.forEach((K, sectionIdx) => {
      // K-label badge: only when multi-K rendering AND not the first section
      // (the first section's K is implied by the h3 caption append above —
      // wait, in multi-K we don't append to h3 — so first section needs the
      // badge too in multi-K mode). Show the badge in multi-K mode for all
      // sections. Use minimal vertical space.
      if (ksToRender.length > 1) {
        const kBadge = document.createElement('div');
        kBadge.style.cssText = 'font-family: var(--mono); font-size: 9.5px; ' +
          'color: var(--ink-dim); margin: 2px 0 0 0; ' +
          'border-top: ' + (sectionIdx > 0 ? '1px dashed var(--rule)' : 'none') + '; ' +
          'padding-top: ' + (sectionIdx > 0 ? '4px' : '0') + ';';
        kBadge.textContent = `K=${K}`;
        col.appendChild(kBadge);
      }

      // Pick the labels and helpers based on K.
      // For K === state.k, use the existing primary cluster path (preserves
      // adaptive-K, family-purity, coherence, and other diagnostics seen in
      // focalContentHtml). For K !== state.k, fall through to the per-K path.
      const useExisting = (K === state.k);
      const focalCl = useExisting
        ? getL2Cluster(state, curL2)
        : getL2ClusterAt(state, curL2, K);
      const focalLabels_forRing = focalCl
        ? (focalCl.fixedKLabels || focalCl.labels)
        : null;

      // v3.99 turn 6: for FOCAL pane, render the karyotype chips (per group /
      // center PC1) ABOVE the mini-PCA, in a tight small-font row that
      // matches the K=N badge size (~9.5px). Previously these chips lived
      // BELOW the plot inside `content`, which forced the user's eye to
      // travel down past the scatter to read them. Per Quentin's request:
      // "the karyotype info should be above the pca plot not below". For
      // neighbor panes the chips don't apply — they show contingency
      // tables instead via ctHtml.
      let focalChipsAbove = null;
      if (isFocal) {
        const cl = useExisting ? getL2Cluster(state, l2idx) : getL2ClusterAt(state, l2idx, K);
        const chipsHtml = _kSpecificMetaInlineHtml(cl, l2idx);
        if (chipsHtml) {
          focalChipsAbove = document.createElement('div');
          // Tight small font, matches K=N badge (9.5px). Override
          // the .meta-inline default size via inline style on the wrapper.
          focalChipsAbove.style.cssText = 'font-size: 9.5px; line-height: 1.2; ' +
            'padding: 2px 0; margin: 0;';
          focalChipsAbove.innerHTML = chipsHtml;
          col.appendChild(focalChipsAbove);
        }
      }

      const miniCanvas = document.createElement('canvas');
      miniCanvas.className = 'mini-pca';
      col.appendChild(miniCanvas);
      // v4 turn 6: spotlight click — fires after drawMiniPCA so __l3_render
      // is populated before the user can interact.
      if (typeof _setupL3MiniClick === 'function') _setupL3MiniClick(miniCanvas);

      // v4 turn 37 (Ask C step 2): band-selector strip below the focal
      // mini-PCA. Visible only on the FOCAL pane and only when
      // state.candidateMode === true. Returns '' otherwise so non-focal
      // panes and out-of-cand-mode views are unchanged.
      if (isFocal && typeof _l3BandSelectorHtml === 'function') {
        try {
          // Pull per-band sample counts from the focal cluster for hover
          // tooltips. Fail-soft if the cluster object is missing.
          let bandCounts = null;
          try {
            const cl = useExisting ? getL2Cluster(state, l2idx) : getL2ClusterAt(state, l2idx, K);
            if (cl) {
              const labels = cl.fixedKLabels || cl.labels;
              if (labels && labels.length) {
                bandCounts = new Array(K).fill(0);
                for (let s = 0; s < labels.length; s++) {
                  const lbl = labels[s] | 0;
                  if (lbl >= 0 && lbl < K) bandCounts[lbl]++;
                }
              }
            }
          } catch (_) {}
          const selHtml = _l3BandSelectorHtml(K, bandCounts);
          if (selHtml) {
            const sel = document.createElement('div');
            sel.innerHTML = selHtml;
            // unwrap one level so the .l3-band-selector div is the direct
            // child of col (no extra wrapping div)
            const inner = sel.firstChild;
            if (inner) col.appendChild(inner);
          }
          if (typeof _wireBandSelectorClicks === 'function') {
            _wireBandSelectorClicks();
          }
        } catch (_) { /* fail-soft — never break focal pane */ }
      }

      const content = document.createElement('div');
      content.className = 'ct-content';
      col.appendChild(content);

      if (isFocal) {
        // Focal column: K-means details + focal mini-PCA
        const cl = useExisting ? getL2Cluster(state, l2idx) : getL2ClusterAt(state, l2idx, K);
        const env = d.l2_envelopes[l2idx];
        // v3.72: when in K=both mode skip the invariant meta in each K's
        // section (it was hoisted to the top of the column above)
        // v3.99 turn 6: also skip kSpecific meta — already rendered above
        // the mini-PCA via focalChipsAbove.
        content.innerHTML = focalContentHtml(cl, env, l2idx,
          { skipInvariantMeta: hoistInvariantMeta, skipKSpecificMeta: true });
        const alignedLabels = useExisting
          ? alignedLabelsTo(curL2, l2idx)
          : alignedLabelsTo_atK(curL2, l2idx, K);
        requestAnimationFrame(() => drawMiniPCA(miniCanvas, l2idx,
          alignedLabels,
          { paneOffset: 0, focalLabels: null }));
      } else {
        // Neighbor column: contingency vs FOCAL + neighbor mini-PCA.
        // v4.1 continue: when state.l3ReclusterMode is set to a non-default
        // mode (kmeans-K6 or distance-uv), route through compareL2Pair_byMode
        // which uses the alternative clustering. Default 'kmeans-K3' falls
        // through to the existing useExisting / _atK branch — no behavioral
        // change for users who don't touch the picker.
        const reMode = state.l3ReclusterMode || 'kmeans-K3';
        let cmp;
        if (reMode !== 'kmeans-K3') {
          cmp = (offset < 0)
            ? compareL2Pair_byMode(l2idx, curL2, reMode)
            : compareL2Pair_byMode(curL2, l2idx, reMode);
        } else {
          cmp = useExisting
            ? ((offset < 0) ? compareL2Pair(l2idx, curL2) : compareL2Pair(curL2, l2idx))
            : ((offset < 0) ? compareL2Pair_atK(l2idx, curL2, K) : compareL2Pair_atK(curL2, l2idx, K));
        }
        // v3.65: compute alignedLabels BEFORE the ctHtml call so we can pass
        // them in (used by tracked-samples readout — neighbor's labels need
        // to be in focal's K-frame for cross-pane comparability).
        const alignedLabels = useExisting
          ? alignedLabelsTo(curL2, l2idx)
          : alignedLabelsTo_atK(curL2, l2idx, K);
        content.innerHTML = ctHtml(cmp, offset, alignedLabels);
        // v4 turn 6: stash spotlight-resolution metadata on the column so
        // _applySpotlightHighlights can find the (r, c) cell for each
        // sample without re-running the alignment. cmp.perm is the
        // permutation `bestPerm` from alignLabels — bestPerm[r] = right
        // raw label that aligns to left raw label r; invPerm maps a raw
        // right label to its aligned position. We compute invPerm here
        // to keep the post-processor cheap.
        const _invPerm = new Array(K);
        if (cmp && cmp.perm) {
          for (let r = 0; r < K; r++) _invPerm[cmp.perm[r]] = r;
        }
        col.__l3_meta = {
          K, offset,
          leftIdx:  (offset < 0) ? l2idx : curL2,
          rightIdx: (offset < 0) ? curL2 : l2idx,
          invPerm: _invPerm,
        };
        requestAnimationFrame(() => drawMiniPCA(miniCanvas, l2idx,
          alignedLabels,
          { paneOffset: offset, focalLabels: focalLabels_forRing }));
      }
    });

    body.appendChild(col);
  });
  // v4 turn 6: apply cross-pane sample-spotlight highlights to the just-
  // rendered contingency tables. Walks each .l3-col, finds the cell where
  // state.spotlight (and/or state.tracked when spotlightTrackedAll is on)
  // sits, and tags it with the spotlight CSS class. PCA dot rendering
  // is handled inside drawMiniPCA — drawMiniPCA reads state.spotlight
  // directly, no post-processing needed there.
  if (typeof _applySpotlightHighlights === 'function') {
    try { _applySpotlightHighlights(curL2); } catch (_) {}
  }
}

// --- renderL3PanelSlab() — legacy lines 49209-49478 ---
export function renderL3PanelSlab(state) {
  _setActiveState(state);
  const d = state.data;
  if (!d) return;
  const body = document.getElementById('l3Body');
  if (!body) return;
  const layoutKey = state.l3Layout || 'leftright';
  const layout = L3_LAYOUTS[layoutKey] || L3_LAYOUTS.leftright;
  body.style.gridTemplateColumns = layout.cols;
  body.innerHTML = '';

  const halfW = compareUnitHalfW();
  const cur = state.cur;
  const range = (halfW != null) ? slabRange(cur, halfW) : null;
  const W = (halfW != null) ? (2 * halfW + 1) : 0;

  // v3.55: honor state.l3KMode in slab mode (parity with L2 mode).
  // 'k3' → render at state.k; 'k6' → render at K=6; 'both' → render K=3 then K=6 stacked.
  const l3kMode = state.l3KMode || 'k3';
  const ksToRender = (l3kMode === 'k6') ? [6]
                   : (l3kMode === 'both') ? [state.k, 6]
                   : [state.k];

  // Toolbar meta — show all Ks rendered when multiple
  const metaEl = document.getElementById('l3Meta');
  if (metaEl) {
    if (range) {
      const startMb = d.windows[range[0]].center_mb;
      const endMb   = d.windows[range[1]].center_mb;
      const kStr = ksToRender.length === 1 ? `K=${ksToRender[0]}` : `K=${ksToRender.join('+')}`;
      metaEl.innerHTML =
        `slab=${W}w · windows ${range[0]+1}–${range[1]+1} · ` +
        `${startMb.toFixed(2)}–${endMb.toFixed(2)} Mb · ` +
        `${kStr} · merge τ=${state.mergeThr.toFixed(2)}`;
    } else {
      metaEl.textContent = '— invalid slab —';
    }
  }
  if (!range) {
    body.innerHTML = '<div class="l3-col"><div class="dim" style="padding:12px;">invalid slab range</div></div>';
    return;
  }

  // Render each pane defined by the layout. v3.55: each pane iterates over
  // ksToRender, producing one (mini-PCA + content) section per K. In single-K
  // mode this matches the v3.46 behavior; in multi-K mode the sections stack
  // vertically with a thin separator.
  layout.offsets.forEach((offset, paneIdx) => {
    const isFocal = (offset === 0);
    const col = document.createElement('div');
    col.className = 'l3-col';

    // Pane header (one per pane, K-agnostic)
    const head = document.createElement('div');
    head.style.cssText = 'padding: 6px 10px; font-family: var(--mono); font-size: 11px;' +
                        ' display: flex; gap: 8px; align-items: center;' +
                        ' border-bottom: 1px solid var(--rule);';
    let offsetSlab = null;
    // turn 148: per-pane toolbar mirrors of the global L3 controls (parity
    // with L2 mode line 44592). Sits to the right of the title text via
    // margin-left:auto inside the existing .l3-pane-tools span. Renders even
    // on out-of-range panes so layout stays stable across panes.
    const paneToolsHtml = (typeof _l3PaneHeaderToolsHtml === 'function')
      ? _l3PaneHeaderToolsHtml() : '';
    if (isFocal) {
      // Inline K=N suffix when single-K (v3.53 convention)
      const kSuffix = (ksToRender.length === 1) ? ` · K=${ksToRender[0]}` : '';
      head.innerHTML = `<span class="l3-pane-title" style="font-weight: 600;">◆ slab focal` +
                       ` <span class="dim" style="font-weight:400;">w${range[0]+1}–w${range[1]+1} (${W}w)${kSuffix}</span></span>` +
                       paneToolsHtml;
    } else {
      const arrow = offset < 0 ? '←' : '→';
      offsetSlab = slabRangeOffset(cur, halfW, offset);
      const kSuffix = (ksToRender.length === 1) ? ` · K=${ksToRender[0]}` : '';
      const lblText = offsetSlab
        ? `slab ${offset > 0 ? '+' : ''}${offset} · w${offsetSlab[0]+1}–w${offsetSlab[1]+1}${kSuffix}`
        : `slab ${offset} · out of range`;
      head.innerHTML = `<span class="l3-pane-title"><span class="dim">${arrow}</span> ` +
                       `<span style="font-weight: 500;">${lblText}</span></span>` +
                       paneToolsHtml;
    }
    col.appendChild(head);

    // Edge cases (neighbor only) — handle once before the K loop
    if (!isFocal) {
      if (!offsetSlab) {
        const oot = document.createElement('div');
        oot.className = 'dim';
        oot.style.cssText = 'padding: 16px 12px; font-size: 11px;';
        oot.textContent = 'out of range';
        col.appendChild(oot);
        body.appendChild(col);
        return;
      }
      if (offsetSlab[0] === offsetSlab[1] && offsetSlab[0] === range[0] && range[0] === range[1]) {
        const oot = document.createElement('div');
        oot.className = 'dim';
        oot.style.cssText = 'padding: 16px 12px; font-size: 11px;';
        oot.textContent = 'identical to focal at edge';
        col.appendChild(oot);
        body.appendChild(col);
        return;
      }
    }

    // For each K, append (badge + mini-PCA + content) to the column
    ksToRender.forEach((K, sectionIdx) => {
      // K-badge: only in multi-K mode (single-K's K is in the head already)
      if (ksToRender.length > 1) {
        const kBadge = document.createElement('div');
        kBadge.style.cssText = 'font-family: var(--mono); font-size: 9.5px; ' +
          'color: var(--ink-dim); padding: 4px 10px 0 10px; ' +
          'border-top: ' + (sectionIdx > 0 ? '1px dashed var(--rule)' : 'none') + '; ' +
          'margin-top: ' + (sectionIdx > 0 ? '4px' : '0') + ';';
        kBadge.textContent = `K=${K}`;
        col.appendChild(kBadge);
      }

      // turn 148: karyotype chips ABOVE the mini-PCA on the focal pane
      // (parity with L2 mode line 44687-44699). _kSpecificMetaInlineHtml works
      // off cl.n_per_group + cl.centers — both available on slab clusters.
      // Pass l2idx=null to skip the sub-band annotation chip (which only
      // applies to L2 envelopes in active draft context).
      if (isFocal) {
        const clFocal = getSlabClusterAt(range[0], range[1], K);
        if (typeof _kSpecificMetaInlineHtml === 'function') {
          const chipsHtml = _kSpecificMetaInlineHtml(clFocal, null);
          if (chipsHtml) {
            const focalChipsAbove = document.createElement('div');
            focalChipsAbove.style.cssText = 'font-size: 9.5px; line-height: 1.2; ' +
              'padding: 2px 10px; margin: 0;';
            focalChipsAbove.innerHTML = chipsHtml;
            col.appendChild(focalChipsAbove);
          }
        }
      }

      // Mini-PCA canvas
      const miniWrap = document.createElement('div');
      miniWrap.style.cssText = 'padding: 6px;';
      const mini = document.createElement('canvas');
      mini.style.cssText = 'display: block; width: 100%; height: 110px; cursor: crosshair; background: var(--panel-2);';
      miniWrap.appendChild(mini);
      col.appendChild(miniWrap);
      // turn 148: spotlight click — fires after drawSlabMiniPCA has populated
      // canvas.__l3_render. Same handler as L2 mode (parity with line 44707).
      if (typeof _setupL3MiniClick === 'function') _setupL3MiniClick(mini);

      // turn 148: band-selector strip on focal pane in candidate mode (parity
      // with L2 mode line 44713-44744). _l3BandSelectorHtml is K-and-counts
      // only — no L2 dependency — so it works for slabs too.
      if (isFocal && typeof _l3BandSelectorHtml === 'function') {
        try {
          let bandCounts = null;
          try {
            const cl = getSlabClusterAt(range[0], range[1], K);
            if (cl) {
              const labels = cl.fixedKLabels || cl.labels;
              if (labels && labels.length) {
                bandCounts = new Array(K).fill(0);
                for (let s = 0; s < labels.length; s++) {
                  const lbl = labels[s] | 0;
                  if (lbl >= 0 && lbl < K) bandCounts[lbl]++;
                }
              }
            }
          } catch (_) {}
          const selHtml = _l3BandSelectorHtml(K, bandCounts);
          if (selHtml) {
            const sel = document.createElement('div');
            sel.innerHTML = selHtml;
            const inner = sel.firstChild;
            if (inner) col.appendChild(inner);
          }
          if (typeof _wireBandSelectorClicks === 'function') {
            _wireBandSelectorClicks();
          }
        } catch (_) { /* fail-soft — never break focal pane */ }
      }

      // Content block: focal shows cluster info; neighbors show contingency
      const content = document.createElement('div');
      content.className = 'ct-content';
      content.style.cssText = 'padding: 6px 10px;';
      col.appendChild(content);

      if (isFocal) {
        const cl = getSlabClusterAt(range[0], range[1], K);
        content.innerHTML = slabFocalContentHtml(cl, range, K);
        requestAnimationFrame(() => drawSlabMiniPCA(mini, range, cl ? cl.labels : null));
      } else {
        // ctHtml expects focal-on-rows for offset>=0, focal-on-cols for offset<0.
        // turn 149: when state.l3ReclusterMode is set to a non-default mode,
        // route through compareSlabPair_byMode (parity with L2 line 44832).
        // The byMode variant handles kmeans-K6 directly and falls back to
        // kmeans-K3 with a `fellBack: true` flag for U/V modes (which don't
        // yet have slab implementations). Default kmeans-K3 keeps the simple
        // path so unaffected users see no behavioral change.
        const reMode = state.l3ReclusterMode || 'kmeans-K3';
        let cmp;
        if (reMode !== 'kmeans-K3') {
          cmp = (offset < 0)
            ? compareSlabPair_byMode(offsetSlab, range, reMode)
            : compareSlabPair_byMode(range, offsetSlab, reMode);
        } else {
          cmp = (offset < 0)
            ? compareSlabPair(offsetSlab, range, K)
            : compareSlabPair(range, offsetSlab, K);
        }
        // v3.65: compute alignedLabels first so we can pass to ctHtml for
        // tracked-samples readout (slab variant). When reMode forces a
        // different K (e.g. kmeans-K6 against l3KMode='k3' sections), the
        // aligned labels are still at the section K — visual K mismatch
        // between the mini-PCA palette (K=3) and the contingency (K=6) is
        // the same trade-off L2 mode accepts.
        const alignedLabels = alignedSlabLabelsTo(range, offsetSlab, K);
        const neighborCl = getSlabClusterAt(offsetSlab[0], offsetSlab[1], K);
        if (!cmp) {
          content.innerHTML = '<div class="dim">low power · slab K-means failed</div>';
        } else {
          // turn 149: surface fallback notice when a U/V mode was requested
          // but slab compare fell back to kmeans-K3 (no slab-aware U/V
          // implementation yet). Prepended to the contingency content so
          // the user knows the visible table doesn't reflect the dropdown
          // setting.
          let prefix = '';
          if (cmp.fellBack && cmp.requestedMode) {
            prefix = `<div class="dim" style="font-size:9.5px; line-height:1.3; ` +
                     `padding:2px 4px; margin-bottom:4px; ` +
                     `border-left: 2px solid var(--accent); padding-left:6px;" ` +
                     `title="The U/V recluster modes (uv-rotated, uv-denoise, uv-dbscan, uv-dist-rank, uv-dist-fuzzy) require a slab-aware rotation pipeline that isn't shipped yet. ` +
                     `Slab compare falls back to kmeans-K3 for these modes. Use kmeans-K3 or kmeans-K6 for accurate slab-mode reclustering, or switch the compare unit back to L2 for U/V modes.">` +
                     `↩ slab fallback: <b>${cmp.requestedMode}</b> not available for slabs · using kmeans-K3` +
                     `</div>`;
          }
          content.innerHTML = prefix + ctHtml(cmp, offset, alignedLabels);
        }
        // turn 148: stash spotlight-resolution metadata on the column (parity
        // with L2 mode line 44798-44807). Slab variant uses leftRange /
        // rightRange instead of L2 indices and sets isSlab:true so the
        // post-pass can route to getSlabClusterAt.
        // turn 149: meta.K must reflect the K that was actually used in the
        // contingency, which may differ from the section K when reMode forced
        // a different K (e.g. kmeans-K6). Read from cmp.K.
        const ctK = (cmp && cmp.K) ? cmp.K : K;
        const _invPerm = new Array(ctK);
        if (cmp && cmp.perm) {
          for (let r = 0; r < ctK; r++) _invPerm[cmp.perm[r]] = r;
        }
        col.__l3_meta = {
          K: ctK, offset,
          isSlab: true,
          leftRange:  (offset < 0) ? offsetSlab : range,
          rightRange: (offset < 0) ? range      : offsetSlab,
          invPerm: _invPerm,
        };
        requestAnimationFrame(() => drawSlabMiniPCA(mini, offsetSlab,
          alignedLabels || (neighborCl ? neighborCl.labels : null)));
      }
    });

    body.appendChild(col);
  });

  // turn 148: apply cross-pane sample-spotlight highlights to the just-rendered
  // contingency tables (parity with L2 mode line 44822). _applySpotlightHighlights
  // detects slab columns via meta.isSlab and routes to getSlabClusterAt.
  if (typeof _applySpotlightHighlights === 'function') {
    try { _applySpotlightHighlights(null); } catch (_) {}
  }
}

// --- renderL3PanelScaleStability() — legacy lines 12833-12912 ---
export function renderL3PanelScaleStability(state) {
  _setActiveState(state);
  const d = state.data;
  const body = document.getElementById('l3Body');
  const metaEl = document.getElementById('l3Meta');
  if (!body) return;

  if (!d) {
    body.innerHTML = '<div class="l3-col"><div class="dim" style="padding:12px;">no data</div></div>';
    return;
  }

  const result = _scaleStabilityCompute();
  if (metaEl) {
    metaEl.innerHTML = 'scale-stability mode · focal window ' + (state.cur + 1) +
      ' · verdict <b>' + result.verdict + '</b>';
  }

  // Layout: 3 panes + 2 inter-pane "gap" columns (numeric contingency tables)
  // Total 5 columns: pane | gap | pane | gap | pane
  body.style.gridTemplateColumns =
    'minmax(180px,1fr) minmax(120px,160px) minmax(180px,1fr) minmax(120px,160px) minmax(180px,1fr)';
  body.innerHTML = '';

  // Append a column helper
  function appendCol(html, classes) {
    const col = document.createElement('div');
    col.className = (classes || 'l3-col');
    col.innerHTML = html;
    body.appendChild(col);
    return col;
  }

  for (let i = 0; i < 3; i++) {
    const cfg  = state.scaleStabilityPanes[i];
    const pane = result.panes[i] || { ok: false, why: 'missing' };
    const label = _scaleStabilityPaneLabel(i, cfg, pane);
    let paneHtml = '<div class="ss-pane-header">' +
                   '<span class="ss-pane-icon">' + ['Σ₁','Σ₂','Σ₃'][i] + '</span>' +
                   '<span>' + label.replace(/^Σ[₁₂₃]\s/, '') + '</span>';
    if (pane.lowConf) paneHtml += '<span class="ss-low-conf">low conf</span>';
    paneHtml += '</div>';
    if (!pane.ok) {
      paneHtml += '<div class="dim" style="padding:12px;font-family:var(--mono);font-size:11px;">— ' +
                  (pane.why || 'unavailable') + ' —</div>';
    } else {
      const range = pane.range ? ('w' + (pane.range[0] + 1) + '–w' + (pane.range[1] + 1)) : '';
      const counts = pane.n_per_group ? pane.n_per_group.join(' · ') : '';
      paneHtml += '<div style="padding:10px 12px;font-family:var(--mono);font-size:11px;line-height:1.6;">' +
                  '<div class="dim">range: ' + range + '</div>' +
                  '<div class="dim">cluster sizes: ' + counts + '</div>' +
                  '</div>';
    }
    appendCol(paneHtml);

    // Gap (between this pane and the next, but not after the last)
    if (i < 2) {
      const pw = result.pairwise[i];
      let gapHtml = '<div class="ss-gap-label">' + ['Σ₁→Σ₂','Σ₂→Σ₃'][i] + '</div>';
      // v4 turn 12b: SVG Sankey ribbons sit ABOVE the numeric contingency
      // table. Visual headline (fan-in / parallel ribbons / reshuffle) reads
      // first, the numeric backup follows.
      if (pw && pw.ok) {
        gapHtml += '<div class="ss-sankey">' + _ssSankeyHtml(pw.contingency) + '</div>';
      }
      gapHtml += pw && pw.ok ? _ssContingencyTableHtml(pw.contingency) :
                               '<div class="ss-event-row" style="color:var(--ink-dimmer);">—</div>';
      gapHtml += _ssEventRowHtml(pw);
      appendCol(gapHtml, 'ss-gap');
    }
  }

  // Verdict row spans all columns
  const verdictRow = document.createElement('div');
  verdictRow.className = 'ss-verdict-row';
  const cssCls = _scaleStabilityVerdictCss(result.verdict);
  verdictRow.innerHTML =
    '<span class="ss-verdict-pill ' + cssCls + '">' + result.verdict + '</span>' +
    '<span class="ss-verdict-text">' + _scaleStabilityVerdictText(result.verdict) + '</span>';
  body.appendChild(verdictRow);
}
