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
import {
  chiSquare,
  nmiFromTable,
  amiFromTable,
  ariFromTable,
  restrictedConcord,
} from '../../../shared/contingency.js';
import { computeBandDiagnostics } from './band_diagnostics.js';
import {
  bandDiagsMiniChipsHtml,
  bandDiagsPanelHtml,
} from './band_diagnostics_html.js';
import {
  escapeHtml,
  fitCanvas,
  fmt,
  shortId,
  themeColor,
  withAlpha,
} from '../../../shared/page1_utils.js';

import { _pageState, _setActiveState, getSampleColor, trackedColor } from './_state.js';
import {
  _fmtP,
  getL2Cluster,
  getL2ClusterAt,
  getPC,
  groupColor,
} from './_data.js';
import { manualGroupForSample } from './manual_groups.js';
// Live-binding import: setCur is called from click handlers (function bodies),
// never at module-load time, so the events.js ↔ l3_panel.js cycle resolves
// fine. Used to make neighbor panes clickable (jump cursor to that L2).
import { setCur } from './events.js';

// =============================================================================
// refreshPinUI(state) — legacy lines 70130-70161
// =============================================================================
// Updates the 📌 pin-2nd-L2 button label + accent + enables/disables the
// "Dual" layout option based on whether state.secondaryL2 is set.
export function refreshPinUI(state) {
  _setActiveState(state);
  const btn = document.getElementById('pinL2Btn');
  const dualBtn = document.querySelector('#l3Layout button[data-layout="dual"]');
  if (!btn) return;
  if (state && state.secondaryL2 != null && state.data && state.data.l2_envelopes[state.secondaryL2]) {
    const env = state.data.l2_envelopes[state.secondaryL2];
    btn.innerHTML = `📌 unpin ${shortId(env.candidate_id)}`;
    btn.style.background = 'var(--accent)';
    btn.style.color = '#0e1116';
    btn.style.borderColor = 'var(--accent)';
    if (dualBtn) {
      dualBtn.disabled = false;
      dualBtn.title = `Dual: focal vs ${shortId(env.candidate_id)}`;
    }
  } else {
    btn.innerHTML = '📌 pin 2nd';
    btn.style.background = 'var(--panel-2)';
    btn.style.color = 'var(--ink-dim)';
    btn.style.borderColor = 'var(--rule)';
    if (dualBtn) {
      dualBtn.disabled = true;
      dualBtn.title = 'Pin a 2nd L2 first';
      if (state && state.l3Layout === 'dual') {
        state.l3Layout = 'focal';
        document.querySelectorAll('#l3Layout button').forEach(b => b.classList.remove('active'));
        const fb = document.querySelector('#l3Layout button[data-layout="focal"]');
        if (fb) fb.classList.add('active');
      }
    }
  }
}

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

    // Click-to-jump on neighbor panes: clicking the ← / → pane jumps the
    // scrubber cursor to that L2's anchor window. Focal pane (◆) is the
    // current L2 — clicking it is a no-op so we don't bind the handler.
    // The handler is bound on the column itself (so the entire pane is a
    // hit target) but excludes the per-pane toolbar (`.l3-pane-tools`)
    // so its embedded buttons keep their own click semantics.
    if (!isFocal && l2idx != null) {
      col.classList.add('l3-col-clickable');
      col.title = 'Click to jump the scrubber to this L2';
      col.addEventListener('click', (ev) => {
        // Don't steal clicks from the per-pane tool buttons.
        if (ev.target.closest('.l3-pane-tools')) return;
        const env = d.l2_envelopes[l2idx];
        if (!env) return;
        const s0 = (env._s0 != null) ? env._s0 : (env.start_w - 1);
        const e0 = (env._e0 != null) ? env._e0 : (env.end_w   - 1);
        const center = Math.max(0, Math.floor((s0 + e0) / 2));
        try { setCur(_pageState || state, center); } catch (_) {}
      });
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
    // Click-to-jump: in slab mode, clicking a neighbor pane jumps the cursor
    // to the center of that offset slab. Bound on the column itself; the
    // .l3-pane-tools buttons inside keep their own click semantics. Bound
    // before we know offsetSlab so the closure captures the live value.
    if (!isFocal) {
      col.classList.add('l3-col-clickable');
      col.title = 'Click to jump the scrubber to this slab';
      col.addEventListener('click', (ev) => {
        if (ev.target.closest('.l3-pane-tools')) return;
        if (!offsetSlab) return;
        const center = Math.max(0, Math.floor((offsetSlab[0] + offsetSlab[1]) / 2));
        try { setCur(_pageState || state, center); } catch (_) {}
      });
    }
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
        {
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

// =============================================================================
// Helpers ported from legacy (round 4 follow-up, 2026-05-11).
// =============================================================================
// The orchestrators above (renderL3Panel / renderL3PanelSlab) reference many
// helpers that lived as top-level functions in the legacy monolith. This block
// ports a curated set of those helpers — the ones that, when missing, made
// the entire L3 carousel render as an empty pane. Everything below uses the
// module-local `_pageState` for state access (matching the convention used by
// the panels) so signatures stay tight at the call sites.

// =============================================================================
// L3_LAYOUTS — legacy lines 48338-48347
// =============================================================================
// Layout descriptors: which neighbor offsets to render alongside focal, and
// the CSS grid columns to use. Read by renderL3Panel + renderL3PanelSlab.
const L3_LAYOUTS = {
  focal:     { offsets: [0],            cols: '1fr' },
  left:      { offsets: [-1, 0],        cols: '1fr 1fr' },
  right:     { offsets: [0, +1],        cols: '1fr 1fr' },
  leftright: { offsets: [-1, 0, +1],    cols: '1fr 1fr 1fr' },
  four:      { offsets: [-2, -1, 0, +1, +2], cols: '1fr 1fr 1fr 1fr 1fr' },
  // Dual mode is special: two pinned L2s + a middle compare column. The
  // 'offsets' array is unused; renderL3Panel branches on layoutKey === 'dual'.
  dual:      { offsets: [],             cols: '1fr 1fr 1fr' },
};

// =============================================================================
// l2NeighborAt — legacy lines 48351-48362
// =============================================================================
// Resolve an offset relative to the focal L2 within the same L1 parent.
// Returns the L2 envelope index, or null if outside the parent.
function l2NeighborAt(focalIdx, offset) {
  const state = _pageState;
  if (focalIdx == null) return null;
  if (offset === 0) return focalIdx;
  const dir = offset > 0 ? 'right' : 'left';
  let cur = focalIdx;
  for (let s = 0; s < Math.abs(offset); s++) {
    const nb = state.l2NeighborsInL1 && state.l2NeighborsInL1.get(cur);
    if (!nb || nb[dir] == null) return null;
    cur = nb[dir];
  }
  return cur;
}

// =============================================================================
// alignedLabelsTo — legacy lines 48366-48381
// =============================================================================
// Hungarian-align this envelope's labels to the focal's, so that "group 0"
// in the column display = "group 0" in the focal envelope.
function alignedLabelsTo(focalIdx, neighborIdx) {
  const state = _pageState;
  if (focalIdx == null || neighborIdx == null) return null;
  // When colors are locked, every column shows the SAME locked labels —
  // so dots colored "blue" in the focal stay blue everywhere, even in
  // neighbors where the local K-means would have grouped them differently.
  if (state.lockedLabels) return state.lockedLabels;
  if (focalIdx === neighborIdx) {
    const cl = getL2Cluster(state, focalIdx);
    return cl && cl.labels ? cl.labels : null;
  }
  const cf = getL2Cluster(state, focalIdx);
  const cn = getL2Cluster(state, neighborIdx);
  if (!cf || !cn || !cf.labels || !cn.labels) return null;
  const a = alignLabels(cf.labels, cn.labels, state.k);
  return a.aligned;
}

// =============================================================================
// _l3CacheInvalidate — legacy lines 48461-48464
// =============================================================================
// Force the next renderL3Panel() to actually rebuild, bypassing the cache.
// Called by code paths that mutate state in ways the fingerprint can't track
// (e.g. invalidating cluster caches, schema reloads, layout-mode changes).
export function _l3CacheInvalidate() {
  const state = _pageState;
  if (!state) return;
  state._l3CacheFp = null;
  state._l3CacheRendered = false;
}

// =============================================================================
// _renderL3Fingerprint — legacy lines 48411-48456
// =============================================================================
// Builds a stable string fingerprint of every input that affects L3 pane
// content. Used by renderL3Panel to short-circuit a redraw when nothing
// content-affecting has changed (state.cur within the same L2 doesn't matter
// — the panes show envelope-level clusters).
function _renderL3Fingerprint(curL2) {
  const state = _pageState;
  // Hash tracked samples cheaply: sum of indices + length is enough to
  // detect any change to the set (collisions vanishingly rare in practice
  // and a false-cache-hit just shows the previous detailed readout for
  // one render — corrected on the next state change).
  let trackedHash = 0;
  if (Array.isArray(state.tracked)) {
    for (let i = 0; i < state.tracked.length; i++) trackedHash += state.tracked[i] | 0;
    trackedHash = (trackedHash * 31) ^ (state.tracked.length << 16);
  }
  // Draft fingerprint: anchor + span + verdict (warning flag changes border)
  let draftFp = '';
  if (state.candidateMode && state.l3Draft) {
    const dr = state.l3Draft;
    draftFp = `${dr.focal_l2idx}|${dr.l2_left}|${dr.l2_right}|${dr.has_warning ? 1 : 0}|${dr.verdict || ''}`;
  }
  return [
    curL2,
    state.l3Layout || '',
    state.l3ColorMode || '',
    state.l3KMode || '',
    state.compareUnit || 'L2',
    state.k | 0,
    state.aggMethod || '',
    (state.mergeThr || 0).toFixed(3),
    (state.alpha || 0).toFixed(4),
    state.minNGroup | 0,
    state.lockedLabels ? 'L' : '',
    state.l3Detailed ? 'D' : '',
    state.secondaryL2 != null ? state.secondaryL2 : '',
    state.candidateMode ? 'CM' : '',
    draftFp,
    trackedHash,
    state.bcScope || '',
    // state.cacheKey changes whenever the L2 cluster cache is invalidated
    // (callers set it to null then rebuild). Including it here means any
    // clustering-parameter change automatically forces an L3 re-render
    // without needing 9 explicit _l3CacheInvalidate() calls.
    state.cacheKey || '',
    // v4.1: L3 recluster mode and secondary metric. Mode change rebuilds
    // the contingency; metric change updates the chip in-place but include
    // it for consistency in case another trigger re-renders between cycles.
    state.l3ReclusterMode || 'kmeans-K3',
    state.l3SecondaryMetric || 'cramer',
  ].join('::');
}

// =============================================================================
// _wireL3PaneToolsDelegation — legacy lines 48633-48683
// =============================================================================
// Document-level delegated handlers for the per-pane toolbar mirrors of the
// global L3 controls (K-mode buttons + recluster select). Idempotent via the
// state._l3PaneToolsWired flag so safe to call from every renderL3Panel().
function _wireL3PaneToolsDelegation() {
  const state = _pageState;
  if (!state || state._l3PaneToolsWired) return;
  const root = document.getElementById('l3Panel') || document.body;
  if (!root) return;
  state._l3PaneToolsWired = true;

  root.addEventListener('click', (ev) => {
    const tgt = ev.target;
    if (!tgt || tgt.tagName !== 'BUTTON') return;
    // K-mode mirror
    if (tgt.dataset.l3paneK) {
      const v = tgt.dataset.l3paneK;
      // Drive the global control so its state + persistence path runs
      const globalBtn = document.querySelector(`#l3KMode button[data-l3k="${v}"]`);
      if (globalBtn) { globalBtn.click(); ev.stopPropagation(); return; }
      // Fallback: set state directly + re-render
      state.l3KMode = v;
      if (typeof renderL3Panel === 'function') renderL3Panel(state);
      ev.stopPropagation();
      return;
    }
    // Color-mode mirror
    if (tgt.dataset.l3paneColor) {
      const v = tgt.dataset.l3paneColor;
      const globalBtn = document.querySelector(`#l3ColorMode button[data-l3color="${v}"]`);
      if (globalBtn) { globalBtn.click(); ev.stopPropagation(); return; }
      state.l3ColorMode = v;
      if (typeof renderL3Panel === 'function') renderL3Panel(state);
      ev.stopPropagation();
      return;
    }
  });

  root.addEventListener('change', (ev) => {
    const tgt = ev.target;
    if (!tgt || tgt.tagName !== 'SELECT') return;
    if (!tgt.hasAttribute('data-l3pane-recluster')) return;
    const v = tgt.value;
    // Drive the global recluster select so localStorage save runs
    const globalSel = document.getElementById('l3ReclusterSel');
    if (globalSel) {
      globalSel.value = v;
      // Synthesize a 'change' event so the global handler fires
      try { globalSel.dispatchEvent(new Event('change', { bubbles: true })); }
      catch (_) { state.l3ReclusterMode = v; if (typeof renderL3Panel === 'function') renderL3Panel(state); }
    } else {
      state.l3ReclusterMode = v;
      if (typeof renderL3Panel === 'function') renderL3Panel(state);
    }
  });
}

// =============================================================================
// compareL2Pair — legacy lines 31184-31226
// =============================================================================
// Returns a contingency-table comparison between two L2 envelopes' K-means
// labels, using Hungarian alignment + chi-square (or Fisher 2×2 at K=2).
// chiSquare / fisher2x2 still live in the legacy monolith — when they aren't
// available we fall back to a null p-value so the verdict logic stays honest.
function compareL2Pair(leftIdx, rightIdx) {
  const state = _pageState;
  if (leftIdx == null || rightIdx == null) return null;
  const cl = getL2Cluster(state, leftIdx), cr = getL2Cluster(state, rightIdx);
  if (!cl || !cr || !cl.labels || !cr.labels) return null;
  const K = state.k;
  // For comparison, use fixedKLabels which are always at state.k regardless of
  // each L2's adaptive K choice. This keeps Hungarian alignment well-defined
  // and concord/chi² interpretable across all comparisons.
  const llab = cl.fixedKLabels || cl.labels;
  const rlab = cr.fixedKLabels || cr.labels;
  const align = alignLabels(llab, rlab, K);
  let p_value, test_kind;
  if (K === 2) {
    p_value = (typeof fisher2x2 === 'function') ? fisher2x2(align.table) : null;
    test_kind = 'fisher_2x2';
  } else {
    const cs = (typeof chiSquare === 'function') ? chiSquare(align.table, K) : null;
    p_value = cs ? cs.p_approx : null;
    test_kind = 'chi2_' + K + 'x' + K;
  }
  // Verdict
  let verdict;
  if (!cl.ok || !cr.ok) verdict = 'LOW_POWER';
  else if (align.concord >= state.mergeThr && (p_value == null || p_value > state.alpha)) verdict = 'MERGE';
  else if (align.concord >= state.mergeThr && p_value <= state.alpha) {
    // High concordance but p significant => still considered MERGE per handoff.
    verdict = 'MERGE';
  }
  else verdict = 'SEPARATE';
  return {
    leftIdx, rightIdx, K,
    table: align.table,
    perm: align.perm,
    concord: align.concord,
    p_value,
    test_kind,
    verdict,
    cl_ok: cl.ok, cr_ok: cr.ok,
    cl_reason: cl.reason, cr_reason: cr.reason,
    cl_npg: cl.n_per_group, cr_npg: cr.n_per_group,
    cl_usedK: cl.usedK, cr_usedK: cr.usedK,   // for K-mismatch annotation
  };
}

// =============================================================================
// aggregateSlab — legacy lines 11822-11858
// =============================================================================
// Aggregates a slab's window range into a synthetic L2-like cluster vector.
// Two aggregation methods: 'median_pc1' (per-sample median of signed PC1
// across the slab) and 'mean_pc12' (per-sample mean of PC1 and PC2). The
// signed PC1 (via getPC's sign) keeps the slab's K-means orientation stable.
function aggregateSlab(s, e) {
  const state = _pageState;
  const d = state.data;
  if (!d) return null;
  const nS = d.n_samples;
  const nW = e - s + 1;
  if (nW <= 0) return null;

  const xs = new Float64Array(nS);
  const ys = state.aggMethod === 'mean_pc12' ? new Float64Array(nS) : null;

  if (state.aggMethod === 'median_pc1') {
    const tmp = new Float64Array(nW);
    for (let si = 0; si < nS; si++) {
      for (let w = 0; w < nW; w++) {
        const { pc1, sign } = getPC(state, s + w);
        tmp[w] = pc1[si] * sign;
      }
      const sorted = Array.from(tmp).sort((a, b) => a - b);
      xs[si] = sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) >> 1]
        : 0.5 * (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]);
    }
  } else {
    for (let w = 0; w < nW; w++) {
      const { pc1, pc2, sign } = getPC(state, s + w);
      for (let si = 0; si < nS; si++) {
        xs[si] += pc1[si] * sign;
        if (ys) ys[si] += pc2[si];
      }
    }
    for (let si = 0; si < nS; si++) {
      xs[si] /= nW;
      if (ys) ys[si] /= nW;
    }
  }
  return { xs, ys, nW, s, e };
}

// =============================================================================
// Per-pane palette helpers — legacy lines 50924-50966
// =============================================================================
// Each pane in the L3 strip has an offset from focal: 0 (focal), -1, +1, -2,
// +2. Up to K=6 clusters per pane. paneClusterColor / paneRingColor are used
// by drawMiniPCA; in 'shared' mode (the default) they reduce to groupColor.
const L3_PANE_PALETTES = {
  // offset 0 (focal): blue / grey / orange / green / red / violet — anchor
  '0': ['#4fa3ff', '#b8b8b8', '#f5a524', '#3cc08a', '#e0555c', '#b07cf7'],
  // offset -1 (left ±1): cooler blues + teals
  '-1': ['#5dc4d6', '#9ab1c4', '#ffb673', '#7ad495', '#ec7177', '#c19af7'],
  // offset +1 (right ±1): warmer ambers + corals
  '+1': ['#7ab8ff', '#cfc7bc', '#e89034', '#5fbf78', '#d54852', '#a06cdb'],
  // offset -2: muted greens + olives
  '-2': ['#7eaecb', '#a8b2a0', '#d4ad57', '#88b58a', '#c66a6f', '#9580c2'],
  // offset +2: deep purples + plums
  '+2': ['#3f7fcc', '#9b9eaa', '#cf8a3a', '#52a07a', '#b94850', '#7e5fa6'],
};

function _l3PalForOffset(offset) {
  const key = (offset > 0 ? '+' : '') + String(offset);
  return L3_PANE_PALETTES[key] || L3_PANE_PALETTES['0'];
}

function paneClusterColor(offset, k, mode) {
  if (k == null || k < 0) return '#666';
  if (mode === 'shared') return groupColor(k);
  const pal = _l3PalForOffset(offset);
  return pal[k] || '#666';
}

function paneRingColor(focalK) {
  if (focalK == null || focalK < 0) return null;
  // Desaturated focal palette — same hues, lower chroma, slightly darker
  const desat = ['#3a6a9b', '#7a7a7a', '#9a691b', '#287a55', '#8e3037', '#705094'];
  return desat[focalK] || '#444';
}

// Empty mini-PCA placeholder for panes with no envelope (boundary of L1).
function drawMiniPCAEmpty(canvas) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = themeColor('ink-dimmer');
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('(no envelope)', w / 2, h / 2);
}

// =============================================================================
// focalContentHtml — legacy lines 50250-50677
// =============================================================================
// Builds the HTML for a focal L3 pane: K-means cluster summary, n-per-group
// breakdown, secondary metric chips, draft action buttons. Most of the body
// is verbatim from legacy. Several deep helpers (computeBandDiagnostics,
// sigmaProfileL2, bandContinuity, _l2InvariantStats, _kSpecificMetaInlineHtml,
// trackedSamplesHtml, _bandDiagsMiniChipsHtml, _bandDiagsPanelHtml) are still
// monolith-only — they're typeof-guarded so missing helpers fail-soft. When
// they ship the focal pane gains those readouts automatically.
function focalContentHtml(cl, env, l2idx, options) {
  const state = _pageState;
  if (!cl || !cl.labels) return '<div class="dim">no cluster</div>';
  let html = '';
  // v3.66: candidate-mode draft banner. If the focal L2 is the anchor of an
  // active draft, show a compact hint with the current span + commit/cancel
  // shortcuts. Helps the user remember they're in build mode.
  if (state.candidateMode && state.l3Draft &&
      state.l3Draft.focal_l2idx === l2idx) {
    const d = state.l3Draft;
    const span = d.l2_right - d.l2_left + 1;
    // v3.67: warning state uses a SOFT RED palette (background + border) so
    // it visually pairs with the .l3-col.in-candidate-warn pane styling. The
    // clean state stays gold. The banner header "draft" stays the same color
    // in both states; only the chrome changes.
    const warnFlag = d.has_warning
      ? ` <span style="color:#e0555c; font-size:9.5px;">⚠ has non-MERGE join</span>`
      : '';
    const bannerBg = d.has_warning
      ? 'rgba(224,85,92,0.14)'
      : 'rgba(245,196,58,0.18)';
    const bannerBorder = d.has_warning
      ? 'rgba(224,85,92,0.75)'
      : 'rgba(245,196,58,0.85)';
    // v4 turn 106: in window-resolution mode, banner shows the window range
    // not the L2 range, since the user is operating below the L2 layer.
    const isWindowMode = d.resolution === 'W' && d.start_w != null && d.end_w != null;
    const headerLabel = isWindowMode
      ? `w ${d.start_w + 1}…${d.end_w + 1} (${d.end_w - d.start_w + 1} window${(d.end_w - d.start_w + 1) > 1 ? 's' : ''})`
      : `L2 ${d.l2_left}…${d.l2_right} (${span} L2${span > 1 ? 's' : ''})`;
    const stepHint = isWindowMode
      ? `↑/↓ step by ${state.stepMode || 'win1'} · Enter commit · Esc cancel`
      : `↑ extend right · ↓ shrink · Enter commit · Esc cancel`;
    html += `<div style="background: ${bannerBg}; ` +
            `border: 1px solid ${bannerBorder}; ` +
            `border-radius: 3px; padding: 4px 8px; margin-bottom: 6px; ` +
            `font-family: var(--mono); font-size: 10px; color: var(--ink);">` +
              `<b style="color:#c97000;">draft</b> · ` +
              headerLabel +
              warnFlag +
              `<br><span class="dim" style="font-size:9px;">` +
                stepHint +
              `</span>` +
            `</div>`;
  }
  // Window-level metrics for this L2 envelope. v3.72 hoists the invariant
  // metrics (windows / span / SNPs / density) into a flowing inline chip row;
  // when called from a K=3+6 stack, the caller passes skipInvariantMeta:true
  // to avoid rendering the invariant block twice.
  const skipInvariantMeta = !!(options && options.skipInvariantMeta);
  if (!skipInvariantMeta) {
    const stats = _l2InvariantStats(cl, env, l2idx);
    html += _invariantMetaInlineHtml(stats);
  }
  // K-dependent chips: per group / center PC1. Always rendered (these
  // genuinely differ between K=3 and K=6 sections). v3.83: l2idx is now passed
  // so the sub-band chip (if applicable) can resolve its labels.
  // v3.99 turn 6: when skipKSpecificMeta is set, the caller renders these
  // chips themselves ABOVE the mini-PCA (smaller, tight font). Skipping
  // here prevents duplication.
  const skipKSpecificMeta = !!(options && options.skipKSpecificMeta);
  if (!skipKSpecificMeta) {
    html += _kSpecificMetaInlineHtml(cl, l2idx);
  }
  html += `<div class="ct-row"><span class="lbl">power</span><span class="val">${cl.ok ? 'OK' : (cl.reason || 'WEAK')}</span></div>`;
  // Conservation score: fraction of samples whose K-means group is preserved
  // across the L2's boundaries with its neighbors. High = clustering is stable
  // across the boundary; low = real transition.
  if (l2idx != null) {
    const nb = state.l2NeighborsInL1 && state.l2NeighborsInL1.get(l2idx);
    const concords = [];
    // v4.1 continue: route through compareL2Pair_byMode so conservation
    // matches the contingency table's clustering (otherwise users see
    // contradictory numbers — high concord in the picked mode but a
    // different conservation value computed under default K-means).
    const reMode = state.l3ReclusterMode || 'kmeans-K3';
    const cmpFn = (l, r) => (reMode !== 'kmeans-K3' && typeof compareL2Pair_byMode === 'function')
      ? compareL2Pair_byMode(l, r, reMode)
      : compareL2Pair(l, r);
    if (nb && nb.left != null) {
      const cmpL = cmpFn(nb.left, l2idx);
      if (cmpL && isFinite(cmpL.concord)) concords.push(cmpL.concord);
    }
    if (nb && nb.right != null) {
      const cmpR = cmpFn(l2idx, nb.right);
      if (cmpR && isFinite(cmpR.concord)) concords.push(cmpR.concord);
    }
    if (concords.length > 0) {
      const conservation = concords.reduce((a, b) => a + b, 0) / concords.length;
      const cvStr = (conservation * 100).toFixed(0) + '%';
      const isLow = conservation < 0.50;   // boundary likely real
      html += `<div class="ct-row"><span class="lbl">conservation</span>` +
              `<span class="val" style="color:${isLow ? 'var(--accent)' : 'var(--ink)'}">${cvStr}</span></div>`;
    }
  }
  // Halves coherence (D16 v3.2 metric for over-merged L2 detection)
  if (cl.coherence != null && isFinite(cl.coherence)) {
    const cv = cl.coherence;
    const cvStr = cv.toFixed(2);
    const isInco = cl.incoherent;
    html += `<div class="ct-row"><span class="lbl">coherence (halves)</span>` +
            `<span class="val" style="color:${isInco ? 'var(--bad)' : 'var(--ink)'}">${cvStr}</span></div>`;
    if (isInco) {
      html += `<div class="verdict separate" style="background:var(--bad);">INCOHERENT · L2 over-merged?</div>`;
    }
  }
  // Family purity (only if family info loaded)
  if (cl.fam_purity != null && isFinite(cl.fam_purity)) {
    const fp = cl.fam_purity;
    const fpStr = fp.toFixed(2);
    const isFamLD = fp >= 0.70;
    html += `<div class="ct-row"><span class="lbl">fam_purity</span>` +
            `<span class="val" style="color:${isFamLD ? 'var(--bad)' : 'var(--ink)'}">${fpStr}</span></div>`;
    if (isFamLD) {
      html += `<div class="verdict separate" style="background:var(--bad);">FAM-LD? · bands ARE families</div>`;
    }
  }
  if (cl.n_below_threshold) {
    html += `<div class="verdict lownwin">LOW_NWIN (${cl.nW} &lt; ${state.minNWin})</div>`;
  } else if (!cl.ok) {
    html += `<div class="verdict skip">${cl.reason || 'LOW_POWER'}</div>`;
  }
  // Group counts as colored, INTERACTIVE chips (v3.44).
  // Click a chip to toggle whether it's KEPT (default) or DROPPED.
  // A drop-state chip has reduced opacity + a strikethrough. The selection
  // is per-L2 and stored in state.bandSelection[l2idx].
  // Chips carry data-K so the toggle handler knows the K-resolution at which
  // this selection applies (matters when l3KMode = 'both' renders K=3 + K=6
  // panes simultaneously — each set of chips toggles its own selection).
  const _selK = (cl.usedK != null) ? cl.usedK : state.k;
  const sel0 = (state.bandSelection && state.bandSelection[l2idx])
             ? state.bandSelection[l2idx] : null;
  const selKept = (sel0 && sel0.K === _selK)
    ? new Set(sel0.keep) : null;   // null means "no active selection — all kept"
  const restrictActive = !!selKept;
  html += `<div style="margin-top:8px; font-family: var(--mono); font-size: 11px;` +
          ` display: flex; flex-wrap: wrap; align-items: center; gap: 6px;"` +
          ` data-l2idx="${l2idx}" data-band-toolbar="1">`;
  html += `<span class="dim" style="font-size: 10px;" ` +
          `title="Click chips to drop bands. Restricted concord uses only kept bands. ` +
          `Per-L2 selection — focal-only.">restrict (K=${_selK}):</span>`;
  cl.n_per_group.forEach((c, k) => {
    const kept = !restrictActive || selKept.has(k);
    const css = kept
      ? `background: var(--panel-2); border: 1px solid ${groupColor(k)}; color: var(--ink);`
      : `background: transparent; border: 1px dashed var(--rule); color: var(--ink-dimmer); ` +
        `text-decoration: line-through;`;
    html += `<button class="band-chip" data-l2idx="${l2idx}" data-bandk="${k}" data-bandkres="${_selK}" ` +
            `data-kept="${kept ? '1' : '0'}" ` +
            `style="${css} padding: 2px 8px; border-radius: 12px; font-family: var(--mono); ` +
            `font-size: 10.5px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;" ` +
            `title="Click to ${kept ? 'drop' : 'keep'} band g${k}">` +
            `<span class="swatch" style="background:${groupColor(k)}; opacity: ${kept ? 1 : 0.45};"></span>` +
            `g${k}:${c}</button>`;
  });
  // Sub-toolbar: keep all
  html += `<button class="band-chip-action" data-l2idx="${l2idx}" data-bandkres="${_selK}" data-action="all" ` +
          `style="background: transparent; border: 1px solid var(--rule); color: var(--ink-dim); ` +
          `padding: 1px 7px; border-radius: 12px; font-family: var(--mono); font-size: 10px; ` +
          `cursor: pointer; margin-left: 4px;" title="Reset to keep all bands">` +
          `keep all</button>`;
  if (restrictActive) {
    html += `<span class="dim" style="font-size: 10px; margin-left: 6px;">` +
            `(${selKept.size}/${cl.n_per_group.length} kept)</span>`;
  }
  html += `</div>`;
  // v3.92: band diagnostics — confounder/support per band. Two render
  // paths: mini-chip pills (always visible when there's anything to
  // report) + a collapsible full table (15 columns + flags).
  const _diag = computeBandDiagnostics(_pageState, cl, env, l2idx);
  if (_diag) {
    cl.__bandDiagnostics = _diag;
    html += bandDiagsMiniChipsHtml(_pageState, _diag, cl.usedK, l2idx);
    html += bandDiagsPanelHtml(_diag, cl.usedK);
  }
  // Per-cluster top family breakdown (small, mono font)
  if (cl.fam_per_cluster) {
    const lines = cl.fam_per_cluster.map((fp, k) => {
      if (fp.total === 0) return null;
      const famLabel = fp.top_family != null ? `F${fp.top_family}` : '?';
      return `<span class="dim">k${k}:</span> ${famLabel} (${fp.top_count}/${fp.total}, ${(fp.purity*100).toFixed(0)}%)`;
    }).filter(Boolean);
    if (lines.length > 0) {
      html += `<div style="margin-top:6px; font-family: var(--mono); font-size: 10px; line-height:1.4;">` +
              lines.join('<br>') + `</div>`;
    }
  }

  // v3.65: tracked-samples readout. Shows which K-group each watchlist sample
  // falls into for this L2's clustering. Empty if no samples are being tracked.
  // Uses cl.labels (the focal pane's own labels — these are the canonical g0..gK-1
  // assignments, so g0 means the same thing whether you're in K=3 or K=6 mode
  // because it's relative to THIS L2's clustering).
  if (cl && cl.labels && cl.usedK != null && typeof trackedSamplesHtml === 'function') {
    html += trackedSamplesHtml(cl.labels, cl.usedK);
  }

  // v3.68: band-continuity metric. Tests the "nested arrangements" hypothesis
  // by counting how often samples stay in the same band, move to a neighboring
  // band, or jump farther across L2s.
  // v3.69: now respects state.l3BcScope (carousel | draft | chrom) chosen from
  // the L3 toolbar — only the selected scope is computed and displayed. The
  // 'draft' scope falls back to 'carousel' when there's no active draft (so
  // the user always sees something useful).
  if (l2idx != null && cl && cl.usedK != null && typeof bandContinuity === 'function') {
    const K = cl.usedK;
    const envs = state.data.l2_envelopes;
    if (envs && envs.length >= 2) {
      const wantScope = state.l3BcScope || 'carousel';
      // Determine if a draft is available for this focal
      const haveDraft = !!(state.candidateMode && state.l3Draft &&
                          state.l3Draft.focal_l2idx === l2idx);
      // Resolve the requested scope to an actual L2 index list. If the user
      // selected 'draft' but none is active, fall back to 'carousel' rather
      // than rendering nothing — and label the row accordingly.
      let scope = wantScope;
      if (scope === 'draft' && !haveDraft) scope = 'carousel';
      let l2_ids = null;
      let scopeLabel = scope;
      if (scope === 'draft') {
        const d = state.l3Draft;
        l2_ids = [];
        for (let i = d.l2_left; i <= d.l2_right; i++) l2_ids.push(i);
        // v4 turn 106: label the scope by window range when draft is in
        // window resolution; users see what they actually drew.
        scopeLabel = (d.resolution === 'W' && d.start_w != null && d.end_w != null)
          ? `draft · w${d.start_w + 1}…w${d.end_w + 1}`
          : `draft · L2 ${d.l2_left}…${d.l2_right}`;
      } else if (scope === 'chrom') {
        l2_ids = envs.map((_, i) => i);
        scopeLabel = `chrom · ${envs.length} L2s`;
      } else {
        // carousel (default)
        const carousel_ids = [];
        for (let off = -2; off <= 2; off++) {
          const id = (typeof l2NeighborAt === 'function')
            ? l2NeighborAt(l2idx, off) : null;
          if (id != null && id >= 0) carousel_ids.push(id);
        }
        carousel_ids.sort((a, b) => a - b);
        l2_ids = carousel_ids;
        scopeLabel = `carousel · ${carousel_ids.length} L2s`;
        // If user wanted draft but we fell back, append a hint
        if (wantScope === 'draft' && !haveDraft) {
          scopeLabel += ' (no draft active — fell back)';
        }
      }
      const metric = bandContinuity(l2_ids, K);
      // Color verdicts
      const verdictColor = (v) => {
        if (v === 'NESTED')       return '#7c3aed';
        if (v === 'UNSTABLE')     return 'var(--bad)';
        if (v === 'INTERMEDIATE') return 'var(--accent)';
        return 'var(--ink-dim)';
      };
      const fmtPct = (v) => isFinite(v) ? (v * 100).toFixed(0) + '%' : '—';
      if (metric) {
        html += `<div style="margin-top: 8px; padding-top: 6px; ` +
                `border-top: 1px solid var(--rule); font-family: var(--mono); ` +
                `font-size: 10px;">` +
                  `<div class="dim" style="font-size: 9.5px; ` +
                          `text-transform: uppercase; letter-spacing: 0.05em; ` +
                          `margin-bottom: 3px;" ` +
                          `title="Tests the nested-arrangements hypothesis. ` +
                          `Continuity = same-band + adjacent-band rate; jump = far-band rate. ` +
                          `High continuity + low jump rate → bands are nested sub-bands of a stable inversion system. ` +
                          `Switch the scope from the L3 toolbar.">` +
                    `band continuity (K=${K}) · ` +
                    `<span style="text-transform: none; letter-spacing: 0; color: var(--ink-dim);">${scopeLabel}</span>` +
                  `</div>` +
                  `<table style="border-collapse: collapse; font-size: 10px; line-height: 1.5;">` +
                    `<tr style="color: var(--ink-dimmer); font-size: 9px;">` +
                      `<th style="text-align: right; font-weight: normal; padding: 0 6px 1px 0;">cont.</th>` +
                      `<th style="text-align: right; font-weight: normal; padding: 0 6px 1px;">jump</th>` +
                      `<th style="text-align: right; font-weight: normal; padding: 0 6px 1px;">n pairs</th>` +
                      `<th style="text-align: left; font-weight: normal; padding: 0 0 1px 6px;">verdict</th>` +
                    `</tr>` +
                    `<tr>` +
                      `<td style="text-align: right; padding: 1px 6px 1px 0;">${fmtPct(metric.band_continuity)}</td>` +
                      `<td style="text-align: right; padding: 1px 6px; color: ${metric.major_jump_rate > 0.20 ? 'var(--bad)' : 'var(--ink)'};">${fmtPct(metric.major_jump_rate)}</td>` +
                      `<td style="text-align: right; padding: 1px 6px; color: var(--ink-dim);">${metric.n_pairs}</td>` +
                      `<td style="padding: 1px 0 1px 6px; color: ${verdictColor(metric.verdict)}; font-weight: 500;">${metric.verdict}</td>` +
                    `</tr>` +
                  `</table>` +
                `</div>`;
      }
    }
  }

  // ---- σ profile + 4-band hypothesis test --------------------------------
  // For L2s where K used >= 4, classify the source of extra bands:
  //   TWO_INVERSIONS — all samples low σ (joint karyotypes are stable)
  //   CROSSOVER_ARTIFACTS — bimodal σ with small high-σ tail
  //   NOISY_REGION — everyone's σ is high
  // INTEGRATION GAP: shared/per_l2_cluster.js exports sigmaProfileL2 with a
  // different signature (ctx, l2idx, usedK) and renamed verdicts
  // (STACKED_INVERSIONS / DOUBLE_CROSSOVER_LIKELY / NOISY / NORMAL) — and no
  // `top_high` field. Wiring it here requires building a ctx via
  // contextFromState(state), mapping the new verdicts back to the labels this
  // panel renders, and either dropping the drifter list or extending the
  // shared function to also return top_high. Until that's done, the legacy
  // global isn't present and this block stays skipped — same render as before.
  if (l2idx != null && cl.usedK != null && cl.usedK >= 4 && typeof sigmaProfileL2 === 'function') {
    const profile = sigmaProfileL2(l2idx, cl.usedK);
    if (profile) {
      let badgeColor = 'var(--ink-dim)';
      if (profile.verdict === 'TWO_INVERSIONS') badgeColor = '#7c3aed';     // purple — distinct biology
      else if (profile.verdict === 'CROSSOVER_ARTIFACTS') badgeColor = 'var(--accent)';
      else if (profile.verdict === 'NOISY_REGION') badgeColor = 'var(--bad)';
      html += `<div style="margin-top:8px; padding-top:6px; border-top:1px solid var(--rule);">`;
      html += `<div class="ct-row"><span class="lbl">σ q50 / q90 / q95</span>` +
              `<span class="val">${profile.q50.toFixed(3)} / ${profile.q90.toFixed(3)} / ${profile.q95.toFixed(3)}</span></div>`;
      html += `<div class="ct-row"><span class="lbl">drifters (σ>2·q50)</span>` +
              `<span class="val">${profile.n_high} (${(profile.ratio_high*100).toFixed(0)}%)</span></div>`;
      html += `<div class="ct-row"><span class="lbl">bimodality coef</span>` +
              `<span class="val">${profile.bimodality_coef.toFixed(2)} <span class="dim" style="font-size:10px;">${profile.is_bimodal ? '(bimodal)' : '(unimodal)'}</span></span></div>`;
      html += `<div class="verdict" style="background:${badgeColor};">${profile.verdict}</div>`;
      html += `<div class="dim" style="font-size:10px; margin-top:2px;">${profile.reason}</div>`;
      // Clickable list of top drifters — click to add to tracked set
      if (profile.top_high && profile.top_high.length > 0) {
        const items = profile.top_high.map(({si, sigma}) => {
          const cga = (state.data.samples[si].cga || state.data.samples[si].ind);
          return `<span class="drifter-tag" data-si="${si}" style="cursor:pointer; padding:2px 5px; margin:2px; background:var(--panel-2); border:1px solid var(--rule); border-radius:3px; font-family:var(--mono); font-size:10px;">${cga} σ${sigma.toFixed(3)}</span>`;
        }).join('');
        html += `<div style="margin-top:4px;">` +
                `<span class="dim" style="font-size:10px;">click to track:</span><br>` +
                items + `</div>`;
      }
      html += `</div>`;
    }
  }

  // ---------------------------------------------------------------------------
  // Manual-groups × K-means contingency (v3.39 sub-step B)
  // ---------------------------------------------------------------------------
  // When manual groups exist, append a contingency block showing how this
  // L2's K-means clusters partition into the user's curated groups. Rows =
  // K-means clusters (k0..k_K), columns = manual groups + "unassigned".
  //
  // This is the founder-null diagnostic in editable form: if the user's
  // curation is right, each K-means cluster should map cleanly to one
  // manual group (high diagonal). If the K-means cluster cuts across manual
  // groups, EITHER the user's curation is wrong OR K-means is being misled
  // by family LD / coverage gradient / etc.
  //
  // This block only renders if (1) manual groups exist, (2) we have cluster
  // labels for this L2, and (3) at least one sample is in a manual group.
  const _mgGroups = state.manualGroups || [];
  if (_mgGroups.length > 0 && cl && cl.labels) {
    // Build cluster × group count matrix. Rows = 0..K-1, cols = group_idx + 1
    // for "unassigned" (col 0).
    const K = cl.usedK || (Math.max(...cl.labels) + 1);
    const nGroups = _mgGroups.length;
    const nCols = nGroups + 1;        // +1 for unassigned
    const tbl = Array.from({length: K}, () => new Int32Array(nCols));
    let anyAssigned = 0;
    for (let si = 0; si < cl.labels.length; si++) {
      const k = cl.labels[si];
      if (k == null || k < 0 || k >= K) continue;
      const g = (typeof manualGroupForSample === 'function') ? manualGroupForSample(si) : null;
      if (g) {
        const gIdx = _mgGroups.findIndex(x => x.id === g.id);
        if (gIdx >= 0) { tbl[k][gIdx + 1]++; anyAssigned++; }
        else            tbl[k][0]++;
      } else {
        tbl[k][0]++;
      }
    }
    if (anyAssigned > 0) {
      // Per-cluster purity = max group share (excluding unassigned)
      const perClusterPurity = [];
      for (let k = 0; k < K; k++) {
        let assigned = 0, maxShare = 0;
        for (let c = 1; c < nCols; c++) { assigned += tbl[k][c]; if (tbl[k][c] > maxShare) maxShare = tbl[k][c]; }
        perClusterPurity.push(assigned > 0 ? (maxShare / assigned) : NaN);
      }
      const meanPurity = perClusterPurity.filter(isFinite).reduce((a,b)=>a+b, 0) /
                         Math.max(1, perClusterPurity.filter(isFinite).length);

      let mgHtml = `<div style="margin-top:10px; padding-top:6px; border-top:1px dashed var(--rule);">` +
        `<div style="font-family: var(--mono); font-size: 10.5px; ` +
        `color: var(--ink-dim); margin-bottom:4px;">` +
        `K-means × manual groups ` +
        `<span style="color: ${meanPurity >= 0.85 ? 'var(--good)' : meanPurity >= 0.65 ? 'var(--ink)' : 'var(--bad)'};">` +
        `purity ${(meanPurity * 100).toFixed(0)}%</span></div>`;
      // Compact contingency table
      mgHtml += `<table class="ct-table" style="font-size: 10.5px;"><tr>` +
        `<th><span class="dim" style="font-size:9px;">k\\group</span></th>`;
      // Header row: unassigned + each group
      mgHtml += `<th title="Samples in this K-means cluster but not in any manual group">` +
        `<span class="swatch" style="background:#5a6472"></span>—</th>`;
      for (const g of _mgGroups) {
        mgHtml += `<th title="${escapeHtml(g.name)} (n=${g.members.length})">` +
          `<span class="swatch" style="background:${g.color}"></span>` +
          `${escapeHtml(g.name.slice(0, 8))}</th>`;
      }
      mgHtml += `</tr>`;
      // Data rows
      for (let k = 0; k < K; k++) {
        mgHtml += `<tr><th><span class="swatch" style="background:${groupColor(k)}"></span>k${k}</th>`;
        for (let c = 0; c < nCols; c++) {
          const v = tbl[k][c];
          // Highlight max cell per row to make the diagonal pop
          let rowMax = 0;
          for (let cc = 0; cc < nCols; cc++) if (tbl[k][cc] > rowMax) rowMax = tbl[k][cc];
          const isMax = (v > 0 && v === rowMax);
          const cellStyle = isMax ? 'font-weight:600; color: var(--ink);'
                                  : 'color: var(--ink-dim);';
          mgHtml += `<td class="num" style="${cellStyle}">${v || ''}</td>`;
        }
        mgHtml += `</tr>`;
      }
      mgHtml += `</table>`;
      // Verdict line
      if (meanPurity >= 0.85) {
        mgHtml += `<div class="verdict merge" style="margin-top:6px;">` +
          `K-means agrees with manual curation</div>`;
      } else if (meanPurity < 0.65) {
        mgHtml += `<div class="verdict separate" style="margin-top:6px; background: var(--bad);">` +
          `K-means cuts across manual groups — investigate</div>`;
      }
      mgHtml += `</div>`;
      html += mgHtml;
    }
  }

  return html;
}

// =============================================================================
// ctHtml — legacy lines 50680-50893
// =============================================================================
// Builds the HTML for a neighbor pane's contingency table (focal vs neighbor).
// Includes the Cramér's V / NMI / AMI / ARI metric chip (cycle-on-click via
// the document-level handler installed in renderL3Panel). When the metric
// helpers (chiSquare / nmi / ami / ari / restrictedConcord / trackedSamplesHtml)
// aren't ported yet, we render zeros / skip — the table itself still draws.
function ctHtml(cmp, offset, alignedLabels) {
  const state = _pageState;
  if (!cmp) return '<div class="dim">no comparison available</div>';
  const K = cmp.K;
  const arrow = offset < 0 ? '←' : '→';
  const rowLabel = offset < 0 ? 'this' : 'focal';
  const colLabel = offset < 0 ? 'focal' : 'this';
  let tbl = `<table class="ct-table"><tr><th><span class="dim" style="font-size:9px;">${rowLabel}\\${colLabel}</span></th>`;
  for (let c = 0; c < K; c++) {
    // v4 turn 6: data-c on header lets the spotlight handler highlight
    // the entire column corresponding to focal's cluster for the spotlight
    // sample. Same for data-r on row headers below.
    tbl += `<th data-c="${c}"><span class="swatch" style="background:${groupColor(c)}"></span>g${c}</th>`;
  }
  tbl += `</tr>`;
  for (let r = 0; r < K; r++) {
    tbl += `<tr><th data-r="${r}"><span class="swatch" style="background:${groupColor(r)}"></span>g${r}</th>`;
    for (let c = 0; c < K; c++) {
      const cls = (r === c) ? 'diag' : 'off';
      tbl += `<td class="${cls}" data-r="${r}" data-c="${c}">${cmp.table[r][c]}</td>`;
    }
    tbl += `</tr>`;
  }
  tbl += `</table>`;
  // Compute n via a typed-array-safe nested loop. Array.flat() on regular
  // arrays containing Int32Arrays leaves the typed arrays unflattened, and
  // .reduce(+) then concatenates them as strings. This silently corrupted
  // both the displayed `n` AND the Cramér's V computation, which used the
  // string-typed `n` and hit the `n > 0` guard returning 0. v3.42 fix.
  let n = 0;
  for (let r = 0; r < K; r++) for (let c = 0; c < K; c++) n += cmp.table[r][c];

  // Compute chi-square once for both p-value and Cramér's V (effect size).
  // Cramér's V is in [0,1], N-independent — fixes the "p≈0 with random data"
  // misreading: V is the right diagnostic for "are these clusterings associated?"
  // (p answers "do we have power to reject independence?" which is always yes
  // when sample identity persists across windows.)
  const cs = chiSquare(cmp.table, K);
  const cramerV = (n > 0 && K > 1) ? Math.sqrt(cs.chi2 / (n * (K - 1))) : 0;

  // Random-baseline concord under independence with Hungarian alignment.
  // For balanced K-cluster random labels, the expected best-matching diagonal
  // is approximately 1/K · max_perm_overlap. Empirical Monte Carlo values
  // tuned at N=226 (LG28 cohort), 5000 trials per K.
  const NULL_CONCORD = { 2: 0.55, 3: 0.39, 4: 0.30, 5: 0.25, 6: 0.24 };
  const nullConcord = NULL_CONCORD[K] || 0.24;

  // v4.1: compute partition-comparison metrics alongside Cramér's V.
  // NMI, AMI, ARI all take the K×K contingency table directly.
  const nmiVal = nmiFromTable(cmp.table, K);
  const amiVal = amiFromTable(cmp.table, K);
  const ariVal = ariFromTable(cmp.table, K);

  // Effect-size labels per metric (independent thresholds — cluster-comparison
  // literature uses different cutoffs per metric).
  const metricBands = (() => {
    function band(v, t1, t2, t3) {
      if (v >= t3) return 'large';
      if (v >= t2) return 'medium';
      if (v >= t1) return 'small';
      return 'none';
    }
    return {
      cramer: { val: cramerV, label: "Cramér's V", band: band(cramerV, 0.10, 0.30, 0.50),
                tip: 'Effect size of association in contingency table; N-independent. Does NOT account for label permutations — answers "are these variables associated?" not "are these the same partition?"' },
      nmi:    { val: nmiVal,  label: 'NMI',          band: band(nmiVal, 0.30, 0.50, 0.75),
                tip: 'Normalized Mutual Information (Strehl-Ghosh, geometric-mean variant). [0,1]. Standard for partition comparison; permutation-invariant. Slightly sensitive to imbalanced cluster sizes.' },
      ami:    { val: amiVal,  label: 'AMI',          band: band(amiVal, 0.20, 0.40, 0.65),
                tip: 'Adjusted Mutual Information (Vinh-Epps-Bailey 2010). Corrects NMI for chance agreement under hypergeometric null. Best metric for imbalanced K-means partitions like the hatchery 180/30/16 split.' },
      ari:    { val: ariVal,  label: 'ARI',          band: band(ariVal, 0.20, 0.40, 0.65),
                tip: 'Adjusted Rand Index (Hubert-Arabie 1985). [-1,1] with 0 = chance. Counts agreeing sample-pairs across both partitions, adjusted for expectation under random labelling. Robust to cluster-size imbalance.' },
    };
  })();

  // Active secondary metric (cycle state — persisted to state, defaults to 'cramer').
  const cycleOrder = ['cramer', 'nmi', 'ami', 'ari'];
  const activeKey = (state.l3SecondaryMetric && cycleOrder.includes(state.l3SecondaryMetric))
                  ? state.l3SecondaryMetric
                  : 'cramer';
  const m = metricBands[activeKey];

  let stats = `<div class="ct-row"><span class="lbl">concord</span>` +
              `<span class="val">${(cmp.concord * 100).toFixed(1)}%` +
              ` <span class="dim" style="font-size:10px;">vs null ${(nullConcord*100).toFixed(0)}%</span></span></div>` +
              `<div class="ct-row l3-metric-chip" data-metric-active="${activeKey}"` +
                ` data-cramer="${cramerV.toFixed(4)}" data-nmi="${nmiVal.toFixed(4)}"` +
                ` data-ami="${amiVal.toFixed(4)}" data-ari="${ariVal.toFixed(4)}"` +
                ` style="cursor: pointer; user-select: none;"` +
                ` title="${m.tip}\n\nClick to cycle: Cramér's V → NMI → AMI → ARI → Cramér's V">` +
              `<span class="lbl">${m.label} <span class="dim" style="font-size:9px; opacity:0.6;">▸</span></span>` +
              `<span class="val">${m.val.toFixed(2)} <span class="dim" style="font-size:10px;">${m.band}</span></span></div>` +
              `<div class="ct-row"><span class="lbl">${cmp.test_kind} p</span>` +
              `<span class="val">${_fmtP(cmp.p_value)}</span></div>` +
              `<div class="ct-row"><span class="lbl">n</span><span class="val">${n}</span></div>`;
  // Warning if the two L2s prefer different K under adaptive (table forced to state.k)
  if (state.kMode === 'adaptive' && cmp.cl_usedK != null && cmp.cr_usedK != null
      && (cmp.cl_usedK !== K || cmp.cr_usedK !== K)) {
    stats += `<div class="ct-row"><span class="lbl">K mismatch</span>` +
             `<span class="val" style="color: var(--accent); font-size: 10px;">` +
             `A→K${cmp.cl_usedK} · B→K${cmp.cr_usedK} · forced to K${K}` +
             `</span></div>`;
  }
  let vClass = 'separate', vText = 'SEPARATE';
  if (cmp.verdict === 'MERGE') { vClass = 'merge'; vText = 'MERGE'; }
  else if (cmp.verdict === 'LOW_POWER') {
    vClass = 'skip';
    const reasons = [cmp.cl_reason, cmp.cr_reason].filter(Boolean).join('/');
    vText = 'LOW POWER' + (reasons ? ' · ' + reasons : '');
  }
  const verdict = `<div class="verdict ${vClass}">${vText} ${arrow}</div>`;

  // ---- Restricted concord (v3.44 + v3.45 sub-step B slab variant) ----------
  // If the FOCAL has a band selection active, compute restricted concord
  // using only samples whose focal cluster is in the keep set. Show as a
  // separate line beneath the strict verdict.
  let restrictedHtml = '';
  let sel = null;
  if (cmp && cmp.isSlabPair) {
    // Slab mode: focal range is rightRange when offset<0, leftRange when offset>=0.
    const focalRange = (offset < 0) ? cmp.rightRange : cmp.leftRange;
    if (focalRange) {
      const focalKey = `slab_${focalRange[0]}_${focalRange[1]}_K${K}`;
      const candidate = state.bandSelection ? state.bandSelection[focalKey] : null;
      if (candidate && Array.isArray(candidate.keep) && candidate.keep.length > 0 &&
          candidate.K === K) sel = candidate;
    }
  } else {
    // L2 mode: focal index is whichever side matches state.windowToL2[state.cur].
    const focalIdx = (state && state.windowToL2 && state.cur != null)
      ? state.windowToL2[state.cur] : -1;
    const candidate = (focalIdx != null && focalIdx >= 0 && state.bandSelection
                 && state.bandSelection[focalIdx]) ? state.bandSelection[focalIdx] : null;
    if (candidate && Array.isArray(candidate.keep) && candidate.keep.length > 0 &&
        candidate.K === K) sel = candidate;
  }
  if (sel) {
    // Restricted concord uses the FOCAL row indices (sel.keep). The aligned
    // table has focal = rows for offset>=0, focal = cols for offset<0. We
    // need the table where focal-on-rows: for offset<0, transpose conceptually.
    let table_focalRows = cmp.table;
    if (offset < 0) {
      table_focalRows = Array.from({length: K}, (_, r) => {
        const row = new Int32Array(K);
        for (let c = 0; c < K; c++) row[c] = cmp.table[c][r];
        return row;
      });
    }
    const rcmp = { table: table_focalRows };
    const restricted = restrictedConcord(rcmp, sel.keep, state.mergeThr || 0.85);
    if (restricted) {
      const rConcordPct = (restricted.concord * 100).toFixed(1);
      const keepLabel = sel.keep.map(k => `g${k}`).join('+');
      const rClass = restricted.verdict === 'MERGE' ? 'merge' :
                     restricted.verdict === 'LOW_POWER' ? 'lownwin' : 'separate';
      restrictedHtml =
        `<div class="ct-row" style="margin-top: 6px; border-top: 1px dashed var(--rule); padding-top: 4px;">` +
        `<span class="lbl" style="font-size: 10px;">restricted (${keepLabel}, n=${restricted.n})</span>` +
        `<span class="val">${rConcordPct}%</span></div>` +
        `<div class="verdict ${rClass}" style="margin-top: 4px; font-size: 10.5px;">` +
        `${restricted.verdict === 'MERGE' ? 'MERGE-restricted' :
          restricted.verdict === 'LOW_POWER' ? 'low power on subset' : 'SEPARATE-restricted'} ` +
        `${arrow}</div>`;
    }
  }
  // v3.65: tracked-samples readout. Shown at the end of the contingency block
  // when the caller passed Hungarian-aligned-to-focal labels for this pane.
  let trackedHtml = '';
  if (alignedLabels && cmp && cmp.K && typeof trackedSamplesHtml === 'function') {
    trackedHtml = trackedSamplesHtml(alignedLabels, cmp.K);
  }
  // v4 turn 4 (continue queue): wrap table + stats in a flex row so stats
  // sit to the RIGHT of the table instead of below it. flex-wrap: wrap
  // makes narrow panes fall back to the previous stacked layout.
  return `<div class="ct-flex" style="display: flex; flex-wrap: wrap;` +
         ` align-items: flex-start; gap: 8px;">` +
           `<div style="flex: 0 0 auto;">${tbl}</div>` +
           `<div style="flex: 1 1 180px; min-width: 0;">` +
             stats + verdict + restrictedHtml + trackedHtml +
           `</div>` +
         `</div>`;
}

// =============================================================================
// drawMiniPCA — legacy lines 51104-51724 (basic-scatter port)
// =============================================================================
// First-pass port: dot scatter colored by cluster labels (Hungarian-aligned
// to focal when caller passes alignedLabels), tracked-sample halos +
// optional CGA labels, axis/PC1-sign annotations on the focal pane, per-band
// legend + counts. Spotlight pass (state.spotlight) is included so cross-pane
// sample tracking works.
//
// TODO_MISSING (heavy overlays from legacy 51179-51720, ~440 LOC):
//   • convex-hull ghost backdrop for active candidate-mode bands
//     (_drawMiniPCAConvexHull + activeBandsSet logic)
//   • het-coloring overlay (_computeHetRateForL2 + _hetRateColor +
//     het swatch legend)
//   • representative-individual rings (centroid argmin pass)
//   • q-ancestry legend layout (_qaEnsureState + _qaProportionBars)
//   • dual-mode focal-aligned rings (paneRingColor draws are stubbed)
//   • H-label classification chips (_hlabelDrawChip)
//   • λ₁ / λ₂ axis labels — included; uses windows[wMid].lam1/lam2
// These overlays are opt-in via state flags and aren't required for the
// baseline "contingency renders without throwing" goal.
function drawMiniPCA(canvas, l2idx, alignedLabels, opts) {
  const state = _pageState;
  opts = opts || {};
  const paneOffset = (opts.paneOffset != null) ? opts.paneOffset : 0;
  const colorMode = opts.colorMode || state.l3ColorMode || 'shared';
  const focalLabels = opts.focalLabels || null;
  const drawSwatch = opts.drawSwatch !== false;   // default true
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  if (!state.data) return;
  const d = state.data;
  const env = d.l2_envelopes[l2idx];
  if (!env) return;

  // Pick the middle window of the envelope as the "representative" PCA frame.
  const wMid = Math.round((env._s0 + env._e0) / 2);
  const { pc1, pc2, sign } = getPC(state, wMid);
  const nS = d.n_samples;

  // Range over ALL samples in this single window
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (let si = 0; si < nS; si++) {
    const x = pc1[si] * sign, y = pc2[si];
    if (x < xMin) xMin = x; if (x > xMax) xMax = x;
    if (y < yMin) yMin = y; if (y > yMax) yMax = y;
  }
  const xPad = (xMax - xMin) * 0.08 || 0.01;
  const yPad = (yMax - yMin) * 0.08 || 0.01;
  xMin -= xPad; xMax += xPad; yMin -= yPad; yMax += yPad;

  // Focal pane gets extra padding for axis labels (PC1 on bottom, PC2 rotated
  // on left). Neighbor panes stay compact.
  const pad = (paneOffset === 0)
    ? { l: 18, r: 8, t: 14, b: 22 }
    : { l: 8,  r: 8, t: 14, b: 14 };
  const plotW = w - pad.l - pad.r, plotH = h - pad.t - pad.b;
  const toX = v => pad.l + ((v - xMin) / (xMax - xMin)) * plotW;
  const toY = v => pad.t + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  // v4 turn 6: cache render context for the click-spotlight hit-tester.
  canvas.__l3_render = {
    l2idx, wMid, sign, pad, plotW, plotH,
    xMin, xMax, yMin, yMax,
    cssW: w, cssH: h,
  };

  // Frame
  ctx.strokeStyle = themeColor('rule');
  ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, plotW, plotH);

  // Annotate window index used + PC1 sign
  ctx.fillStyle = themeColor('ink-dimmer');
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'left';
  const winTag = `w${wMid + 1}` +
    ((sign < 0 && paneOffset !== 0) ? ' (PC1 flipped)' : '');
  ctx.fillText(winTag, pad.l + 2, pad.t - 2);

  // Determine which labels to use for coloring
  // Priority: (a) Hungarian-aligned-to-focal labels from caller, else (b) own cluster
  let labels = alignedLabels;
  if (!labels) {
    const cl = getL2Cluster(state, l2idx);
    labels = cl && cl.labels ? cl.labels : null;
  }

  // TODO_MISSING (legacy 51179-51237): ghost-hull backdrop for candidate-mode
  // active bands. Skipped in first-pass port.

  // Determine effective dual-mode ring drawing. Only neighbors get rings;
  // focal pane (offset=0) skips them since fill IS the focal color.
  const drawDualRings = (colorMode === 'dual') && (paneOffset !== 0) && !!focalLabels;

  // TODO_MISSING (legacy 51252-51256): het-coloring override (_computeHetRateForL2
  // + _hetRateColor). Skipped in first-pass port.

  const trackedSet = new Set(state.tracked || []);
  // Non-tracked samples first
  for (let si = 0; si < nS; si++) {
    if (trackedSet.has(si)) continue;
    const x = toX(pc1[si] * sign), y = toY(pc2[si]);
    let baseCol;
    if (state.colorMode === 'cluster' && labels && labels[si] != null) {
      baseCol = paneClusterColor(paneOffset, labels[si], colorMode);
    } else {
      baseCol = getSampleColor(si, state.colorMode, null);
    }
    // Dual mode ring (desaturated focal-aligned color) drawn UNDER the fill.
    if (drawDualRings && state.colorMode === 'cluster') {
      const ringCol = paneRingColor(focalLabels[si]);
      if (ringCol) {
        ctx.strokeStyle = ringCol;
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.fillStyle = withAlpha(baseCol, state.colorMode === 'cluster' ? 0.55 : 0.7);
    ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
  }

  // TODO_MISSING (legacy 51299-51361): representative-individual ring per
  // cluster centroid. Skipped in first-pass port — the dot scatter is what
  // matters for "contingency renders without throwing".

  // Tracked samples on top — colored ring per group + identity dot.
  const tracked = Array.isArray(state.tracked) ? state.tracked : [];
  const showLabels = tracked.length > 0 && tracked.length <= 8;
  for (const si of tracked) {
    const x = toX(pc1[si] * sign), y = toY(pc2[si]);
    if (labels) {
      const gcol = paneClusterColor(paneOffset, labels[si], colorMode);
      ctx.strokeStyle = gcol; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.stroke();
    }
    if (drawDualRings && labels && focalLabels) {
      const ringCol = paneRingColor(focalLabels[si]);
      if (ringCol) {
        ctx.strokeStyle = ringCol; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(x, y, 6.2, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.fillStyle = trackedColor(si);
    ctx.strokeStyle = themeColor('bg'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, 2.8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (showLabels) {
      const name = state.data.samples[si].cga || state.data.samples[si].ind;
      ctx.fillStyle = trackedColor(si);
      ctx.font = '9px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.strokeStyle = themeColor('bg'); ctx.lineWidth = 2.5;
      ctx.strokeText(name, x + 5, y + 3);
      ctx.fillText(name, x + 5, y + 3);
    }
  }

  // v4 turn 6: spotlight pass — render labels for samples that should be
  // visible across all panes even when the standard tracked-loop wouldn't
  // render them.
  if (state.spotlightTrackedAll && !showLabels && tracked.length > 0) {
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'left';
    for (const si of tracked) {
      const x = toX(pc1[si] * sign), y = toY(pc2[si]);
      const name = state.data.samples[si].cga || state.data.samples[si].ind;
      ctx.fillStyle = trackedColor(si);
      ctx.strokeStyle = themeColor('bg'); ctx.lineWidth = 2.5;
      ctx.strokeText(name, x + 5, y + 3);
      ctx.fillText(name, x + 5, y + 3);
    }
  }
  if (state.spotlight != null && state.spotlight >= 0 && state.spotlight < nS) {
    const si = state.spotlight;
    const x = toX(pc1[si] * sign), y = toY(pc2[si]);
    ctx.strokeStyle = 'rgba(245,165,36,0.95)';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = themeColor('bg'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const name = state.data.samples[si].cga || state.data.samples[si].ind;
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(245,165,36,0.95)';
    ctx.strokeStyle = themeColor('bg'); ctx.lineWidth = 3;
    ctx.strokeText(name, x + 8, y + 3);
    ctx.fillText(name, x + 8, y + 3);
  }

  // Axis labels (focal pane only): PC1 / PC2 with eigenvalue context.
  if (paneOffset === 0) {
    const wObj = d.windows[wMid];
    const lam1 = wObj && wObj.lam1;
    const lam2 = wObj && wObj.lam2;
    ctx.fillStyle = themeColor('ink-dim');
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const xLab = (lam1 != null && isFinite(lam1))
      ? `PC1 · λ₁=${fmt(lam1)}${sign < 0 ? ' (flipped)' : ''}`
      : `PC1${sign < 0 ? ' (flipped)' : ''}`;
    ctx.fillText(xLab, pad.l + plotW / 2, pad.t + plotH + 2);
    ctx.save();
    ctx.translate(pad.l - 4, pad.t + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const yLab = (lam2 != null && isFinite(lam2))
      ? `PC2 · λ₂=${fmt(lam2)}`
      : 'PC2';
    ctx.fillText(yLab, 0, 0);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // TODO_MISSING (legacy 51484-51528): het-coloring legend swatch. Skipped.
  // TODO_MISSING (legacy 51545-51628): q-ancestry legend layout. Skipped.

  // Per-band legend with counts (paper-style: g0 (n=N) etc.). Stacks
  // vertically in the top-right inside the plot frame.
  if (drawSwatch && state.colorMode === 'cluster' && labels) {
    let K = 0;
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] != null && labels[i] >= 0 && labels[i] + 1 > K) K = labels[i] + 1;
    }
    K = Math.min(K, 6);
    const counts = new Array(K).fill(0);
    for (let i = 0; i < labels.length; i++) {
      const lk = labels[i];
      if (lk != null && lk >= 0 && lk < K) counts[lk]++;
    }

    const swH = 7, swW = 7, rowH = 10;
    ctx.font = '9px ui-monospace, monospace';
    ctx.textBaseline = 'top';
    // First-pass: simple 'g<k> (n=N)' labels. TODO_MISSING: vocab-aware
    // detailed labels (H1/H1 etc.) via _karyoLabelEnsureVocab + getKaryotypeLabel.
    const legendLabelFor = (k) => 'g' + k + ' (n=' + counts[k] + ')';
    let widest = 0;
    for (let k = 0; k < K; k++) {
      const t = legendLabelFor(k);
      const tw = ctx.measureText(t).width;
      if (tw > widest) widest = tw;
    }
    const legendW = swW + 4 + widest + 2;
    const lx = pad.l + plotW - legendW - 3;
    const ly = pad.t + 3;
    ctx.fillStyle = withAlpha(themeColor('bg'), 0.94);
    ctx.fillRect(lx - 2, ly - 1, legendW + 4, K * rowH + 2);
    ctx.strokeStyle = withAlpha(themeColor('rule'), 0.6);
    ctx.lineWidth = 1;
    ctx.strokeRect(lx - 2 + 0.5, ly - 1 + 0.5, legendW + 4 - 1, K * rowH + 2 - 1);
    for (let k = 0; k < K; k++) {
      const ry = ly + k * rowH;
      ctx.fillStyle = paneClusterColor(paneOffset, k, colorMode);
      ctx.fillRect(lx, ry + 1, swW, swH);
      ctx.fillStyle = themeColor('ink-dim');
      ctx.fillText(legendLabelFor(k), lx + swW + 4, ry);
    }
    ctx.textBaseline = 'alphabetic';
  }
}

// =============================================================================
// drawSlabMiniPCA — legacy lines 49550-49685 (minimal stub)
// =============================================================================
// Minimal slab variant: aggregates the slab via aggregateSlab, draws a dot
// scatter colored by group labels, and frames the plot. Used only when
// state.compareUnit !== 'L2' (slab mode), which the user reports as rare.
// TODO_MISSING (legacy 49607-49684, ~80 LOC): het-coloring overlay + het
// swatch legend + axis hints. Skipped in first-pass port.
function drawSlabMiniPCA(canvas, range, labels) {
  const state = _pageState;
  if (!canvas) return;
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  if (!state.data || !range) return;
  const agg = aggregateSlab(range[0], range[1]);
  if (!agg) return;
  const pad = { l: 22, r: 22, t: 12, b: 14 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  if (plotW < 10 || plotH < 10) return;
  // 1D slab K-means but we plot mean PC1 vs mean PC2 for a 2D feel.
  const nS = state.data.n_samples;
  const xs = agg.xs;
  // PC2 mean — recompute since aggregateSlab only stores ys when aggMethod=mean_pc12
  const ys2 = new Float64Array(nS);
  const nW = range[1] - range[0] + 1;
  for (let w0 = range[0]; w0 <= range[1]; w0++) {
    const { pc2 } = getPC(state, w0);
    for (let si = 0; si < nS; si++) ys2[si] += pc2[si];
  }
  for (let si = 0; si < nS; si++) ys2[si] /= nW;
  // X / Y ranges
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (let si = 0; si < nS; si++) {
    if (xs[si] < xMin) xMin = xs[si]; if (xs[si] > xMax) xMax = xs[si];
    if (ys2[si] < yMin) yMin = ys2[si]; if (ys2[si] > yMax) yMax = ys2[si];
  }
  const xPad = (xMax - xMin) * 0.08 || 0.01;
  const yPad = (yMax - yMin) * 0.08 || 0.01;
  xMin -= xPad; xMax += xPad; yMin -= yPad; yMax += yPad;
  const toX = v => pad.l + ((v - xMin) / (xMax - xMin)) * plotW;
  const toY = v => pad.t + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  // turn 148: cache render context for the click-spotlight hit-tester.
  const slabMid = (range[0] + range[1]) >> 1;
  const { sign: slabSign } = getPC(state, slabMid);
  canvas.__l3_render = {
    l2idx: null,                     // slab variant — no L2 index
    isSlab: true, slabRange: range.slice(),
    wMid: slabMid, sign: slabSign,
    pad, plotW, plotH,
    xMin, xMax, yMin, yMax,
    cssW: w, cssH: h,
  };
  // Frame
  ctx.strokeStyle = themeColor('rule');
  ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, plotW, plotH);
  // Dots, colored by slab K-means label.
  for (let si = 0; si < nS; si++) {
    const k = labels ? labels[si] : 0;
    ctx.fillStyle = groupColor(k);
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(toX(xs[si]), toY(ys2[si]), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Axis hints
  ctx.fillStyle = themeColor('ink-dim');
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`PC1 (slab mean)`, pad.l + 4, h - 3);
  ctx.save(); ctx.translate(10, pad.t + plotH / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillText('PC2', 0, 0); ctx.restore();
}

// =============================================================================
// Inline meta-chip helpers — legacy lines 49772, 49817, 49829, 49867, 49774
// =============================================================================
// _metaChip and _kSpecificMetaInlineHtml are called UNGUARDED inside the
// focal-pane render (line 445), so on every L3 render with state.k=3 the
// pane builder needs them. _l2InvariantStats and _invariantMetaInlineHtml
// only fire when l3KMode === 'both' but we ship them too — small.

const WINDOW_DEFAULT_SNPS_FALLBACK = 100;

// --- _metaChip — legacy lines 49817-49824 ---
function _metaChip(label, value, suffix) {
  let html = `<span class="meta-chip">` +
             `<span class="meta-chip-lbl">${label}</span> ` +
             `<b class="meta-chip-val">${value}</b>`;
  if (suffix) html += ` <span class="dim" style="font-size:9.5px;">${suffix}</span>`;
  html += `</span>`;
  return html;
}

// --- _kSpecificMetaInlineHtml — legacy lines 49867-49900 ---
// Inline-flow row for K-DEPENDENT meta: per-group n + center PC1.
function _kSpecificMetaInlineHtml(cl, l2idx) {
  if (!cl) return '';
  const state = _pageState;
  const chips = [];
  if (cl.n_per_group) {
    chips.push(_metaChip('per group', cl.n_per_group.join(' / '), 'lo→hi PC1'));
  }
  if (cl.centers) {
    chips.push(_metaChip('center PC1',
      Array.from(cl.centers).map(v => v.toFixed(3)).join(' / ')));
  }
  // v3.83: sub-band annotation when in a draft context at K=6 — guarded with
  // typeof checks since _currentSubbandContext / _resolveSubbandLabelsForColumn
  // are legacy globals not yet ported.
  if (l2idx != null && cl.usedK === 6 && typeof _currentSubbandContext === 'function') {
    const ctx = _currentSubbandContext();
    if (ctx && ctx.active && typeof _resolveSubbandLabelsForColumn === 'function') {
      const labels = _resolveSubbandLabelsForColumn(l2idx, 6, ctx);
      if (labels && labels.length === 6) {
        const verdictHint = ctx.verdict === 'NESTED'      ? 'aligned to draft anchor'
                          : ctx.verdict === 'CROSS_CUTTING' ? 'draft K=6 cuts across K=3'
                          : ctx.verdict === 'MIXED'        ? 'partial nesting in draft'
                                                           : 'aligned to draft anchor';
        chips.push(_metaChip('sub-bands', labels.join(' / '), verdictHint));
      }
    }
  }
  if (chips.length === 0) return '';
  return `<div class="meta-inline">${chips.join('')}</div>`;
}

// --- _l2InvariantStats — legacy lines 49774-49814 ---
// Computes K-INVARIANT stats for an L2 envelope (windows, span, SNPs, density).
function _l2InvariantStats(cl, env, l2idx) {
  const state = _pageState;
  const WINDOW_DEFAULT_SNPS = (state && state.windowDefaultSnps != null)
    ? state.windowDefaultSnps : WINDOW_DEFAULT_SNPS_FALLBACK;
  let l2_n_snps = 0;
  let l2_n_snps_seen = 0;
  let l2_n_snps_defaulted = 0;
  if (l2idx != null && state && state.data && Array.isArray(state.data.windows)) {
    const env_l2 = state.data.l2_envelopes[l2idx];
    if (env_l2) {
      const s0 = env_l2._s0, e0 = env_l2._e0;
      for (let wi = s0; wi <= e0; wi++) {
        const wObj = state.data.windows[wi];
        if (wObj && (wObj.n_snps != null) && isFinite(wObj.n_snps)) {
          l2_n_snps += wObj.n_snps;
          l2_n_snps_seen++;
        } else if (wObj) {
          l2_n_snps += WINDOW_DEFAULT_SNPS;
          l2_n_snps_defaulted++;
        }
      }
    }
  }
  const l2_span_bp = (env && env.end_bp != null && env.start_bp != null)
    ? (env.end_bp - env.start_bp) : null;
  const l2_span_kb = (l2_span_bp != null) ? (l2_span_bp / 1000) : null;
  const l2_span_mb = (l2_span_bp != null) ? (l2_span_bp / 1e6) : null;
  const l2_win_per_mb = (l2_span_mb != null && l2_span_mb > 0)
    ? (cl.nW / l2_span_mb) : null;
  const l2_mean_win_kb = (l2_span_kb != null && cl.nW > 0)
    ? (l2_span_kb / cl.nW) : null;
  const l2_snp_density_per_kb = ((l2_n_snps_seen + l2_n_snps_defaulted) > 0 &&
                                  l2_span_kb != null && l2_span_kb > 0)
    ? (l2_n_snps / l2_span_kb) : null;
  return {
    n_windows_used: cl.nW,
    span_bp: l2_span_bp, span_kb: l2_span_kb, span_mb: l2_span_mb,
    n_snps: l2_n_snps, n_snps_seen: l2_n_snps_seen, n_snps_defaulted: l2_n_snps_defaulted,
    win_per_mb: l2_win_per_mb, mean_win_kb: l2_mean_win_kb,
    snp_density_per_kb: l2_snp_density_per_kb,
  };
}

// --- _invariantMetaInlineHtml — legacy lines 49829-49857 ---
function _invariantMetaInlineHtml(stats) {
  if (!stats) return '';
  const chips = [];
  chips.push(_metaChip('windows', stats.n_windows_used,
    stats.mean_win_kb != null ? `mean ${stats.mean_win_kb.toFixed(1)} kb` : null));
  if (stats.span_kb != null) {
    const spanLabel = (stats.span_mb >= 1)
      ? `${stats.span_mb.toFixed(2)} Mb`
      : `${stats.span_kb.toFixed(1)} kb`;
    chips.push(_metaChip('span', spanLabel,
      stats.win_per_mb != null ? `${stats.win_per_mb.toFixed(1)} W/Mb` : null));
  }
  if ((stats.n_snps_seen + stats.n_snps_defaulted) > 0) {
    let footnote = null;
    if (stats.n_snps_seen === 0 && stats.n_snps_defaulted > 0) {
      footnote = `${stats.n_snps_defaulted}×${WINDOW_DEFAULT_SNPS_FALLBACK} default`;
    } else if (stats.n_snps_seen > 0 && stats.n_snps_defaulted > 0) {
      footnote = `${stats.n_snps_seen} real + ${stats.n_snps_defaulted} default`;
    }
    chips.push(_metaChip('SNPs', stats.n_snps.toLocaleString(), footnote));
    if (stats.snp_density_per_kb != null) {
      chips.push(_metaChip('density', stats.snp_density_per_kb.toFixed(1), 'SNPs/kb'));
    }
  }
  return `<div class="meta-inline">${chips.join('')}</div>`;
}
