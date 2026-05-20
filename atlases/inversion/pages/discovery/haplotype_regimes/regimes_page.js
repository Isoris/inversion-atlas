// pages/discovery/regimes_page/regimes_page.js
//
// Long-range haplotype regimes page.
//
// Hosts FOUR panels in a 2×2 grid plus a top header bar with the focal-
// voter selector and mode toggles:
//
//   ┌───────────────────────────────────┬──────────────────────────────┐
//   │ chrom-scope · target-band lanes   │ genome-scope · target-band   │
//   │ (lanes-CHROM)                     │ (lanes-GENOME)               │
//   ├───────────────────────────────────┼──────────────────────────────┤
//   │ chrom-scope · PC1 lines           │ genome-scope · PC1 lines     │
//   │ (pc1-CHROM)                       │ (pc1-GENOME)                 │
//   └───────────────────────────────────┴──────────────────────────────┘
//
// All four read from a SINGLE shared state.regimesPanel record. The
// focal-voter selector + arrow keys mutate that one record, and the
// page redraws all four panels synchronously.
//
// To keep performance manageable on a phone, the genome-scope panels
// are gated behind an explicit "Compute genome view" button — they
// don't auto-redraw on every arrow press. The chrom-scope panels
// always redraw immediately.
//
// HOW THE STATE IS SHARED:
//
//   The two scope modes need DIFFERENT tracks (different windowList
//   length, different cache key). To support that with a single
//   state.regimesPanel, the page maintains two SEPARATE state-shaped
//   wrappers internally — `_chromState` and `_genomeState` — and just
//   re-uses the same focal/seed/band_mask/locus selection between
//   them. Each draw call into a chrom panel uses _chromState; each
//   draw into a genome panel uses _genomeState. The wrappers share
//   state.tracked, state.linesColorMode, etc. by reference so user
//   changes propagate.
// =====================================================================

import {
  initRegimesPanelFromBandingResult,
  ensureRegimesTrack,
  drawRegimesPanel,
  buildRegimesPanel,
  getActiveBandSubsets,
  enumerateBandSubsets,
  enumerateAdditiveBandSubsets,
  PATTERN_CLASS_COLORS,
} from './regimes_panel.js';

import {
  drawRegimesPC1Panel,
  buildRegimesPC1Panel,
} from './regimes_pc1_panel.js';

// ---------------------------------------------------------------------
// initRegimesPage — single entry point. Sets up all four panels.
//
// Required DOM (host page must provide):
//   #regimesPageHeader        — for the focal-voter readout + buttons
//   #regimesPanel             — the chrom-lanes panel (target-band lanes)
//     #regimesCanvasContainer
//   #regimesGenomePanel       — the genome-lanes panel
//     #regimesGenomeCanvasContainer
//   #regimesPC1Panel          — the chrom-pc1 panel
//     #regimesPC1CanvasContainer
//   #regimesPC1GenomePanel    — the genome-pc1 panel
//     #regimesPC1GenomeCanvasContainer
//
// args.bandingResult, args.getLabels, args.getK, args.getPC1, args.classifyFn
// follow the same shape as initRegimesPanelFromBandingResult.
// ---------------------------------------------------------------------

/**
 * @param {object} state
 * @param {object} args
 *   args.bandingResult, args.getLabels, args.getK, args.getPC1,
 *   args.getDosage, args.classifyFn, args.classifyOpts,
 *   args.chromosomes, args.bandComboMode, args.stride,
 *   args.current_chromosome_idx
 *   args.enable_genome_view: boolean (DEFAULT FALSE — keeps the
 *     UI focused on per-chromosome scope to avoid cognitive overload.
 *     The genome-scope panels are not displayed at all when this flag
 *     is false; the user can opt in via the toolbar toggle in the
 *     header bar).
 */
export function initRegimesPage(state, args) {
  // Shared focal record
  const sharedFocal = { seed_index: 0, band_mask: 1 };
  const enableGenome = args.enable_genome_view === true;

  // Build the chrom-scope state (drives the two chrom panels)
  initRegimesPanelFromBandingResult(state, Object.assign({}, args, {
    scope: 'chrom',
    current_chromosome_idx: args.current_chromosome_idx != null
      ? args.current_chromosome_idx
      : (args.bandingResult.stage3.loci[0]
          ? args.bandingResult.stage3.loci[0].chromosome_idx : 0),
    bandComboMode: args.bandComboMode || 'additive',
  }));
  if (!state.regimesPanel) return;
  state.regimesPanel.focal = sharedFocal;
  state._regimesEnableGenome = enableGenome;

  // Genome state is built only if explicitly enabled. Default focus is
  // per-chromosome, matching Quentin's convention of one-chromosome-at-a-time
  // working scope (per-chrom JSON, per-chrom tables).
  state._regimesGenomeState = null;
  state._regimesGenomeComputed = false;
  if (enableGenome) {
    state._regimesGenomeState = {
      tracked: state.tracked,
      linesColorMode: state.linesColorMode,
      regimesPanel: Object.assign({}, state.regimesPanel, {
        scope: 'genome',
        track: null,
        windowList: null,
        ctx_callbacks: state.regimesPanel.ctx_callbacks,
        stage3_loci:    state.regimesPanel.stage3_loci,
        chromosomes:    state.regimesPanel.chromosomes,
        classifyFn:     state.regimesPanel.classifyFn,
        classifyOpts:   state.regimesPanel.classifyOpts,
        bandComboMode:  state.regimesPanel.bandComboMode,
        stride:         args.stride || 5,
        focal:          sharedFocal,
      }),
    };
  }

  // DOM scaffolding for chrom panels (always)
  buildRegimesPanel(state);                          // chrom · lanes
  buildRegimesPC1Panel(state);                       // chrom · pc1

  // Genome DOM only built if enabled. Hide the containers when disabled
  // (so a host page can blanket-include all four DOM nodes and we'll
  // hide the genome ones cleanly).
  if (enableGenome) {
    _buildGenomeLanesPanel(state);
    _buildGenomePC1Panel(state);
  } else {
    _hideGenomePanels();
  }

  // Draw the chrom panels immediately. Genome panels stay placeholdered
  // (or hidden) until enabled and computed.
  drawRegimesPanel(state);
  drawRegimesPC1Panel(state);
  if (enableGenome) {
    _drawGenomePlaceholder('regimesGenomeCanvasContainer',
      'Genome-scope target-band lanes — click "Compute genome view" to render.');
    _drawGenomePlaceholder('regimesPC1GenomeCanvasContainer',
      'Genome-scope PC1 lines — click "Compute genome view" to render.');
  }

  // Header bar (focal-voter readout + mode buttons)
  _renderHeader(state);

  // Keyboard nav: drives all four panels (or just chrom if genome disabled)
  _installPageKeyboardNav(state);
}

// Hide the genome panel containers if they exist. Tolerant of absence
// (the host might not include them in the DOM at all).
function _hideGenomePanels() {
  for (const id of ['regimesGenomePanel', 'regimesPC1GenomePanel']) {
    const el = document.getElementById(id);
    if (el && el.style) el.style.display = 'none';
  }
}

// Show + initialise the genome panels when the user opts in via the
// toolbar toggle. Does the DOM scaffolding + initial placeholder draw.
function _enableGenomePanels(state) {
  if (state._regimesEnableGenome) return;     // already on
  state._regimesEnableGenome = true;
  // Build sibling state if missing
  if (!state._regimesGenomeState) {
    state._regimesGenomeState = {
      tracked: state.tracked,
      linesColorMode: state.linesColorMode,
      regimesPanel: Object.assign({}, state.regimesPanel, {
        scope: 'genome',
        track: null,
        windowList: null,
        ctx_callbacks: state.regimesPanel.ctx_callbacks,
        stage3_loci:    state.regimesPanel.stage3_loci,
        chromosomes:    state.regimesPanel.chromosomes,
        classifyFn:     state.regimesPanel.classifyFn,
        classifyOpts:   state.regimesPanel.classifyOpts,
        bandComboMode:  state.regimesPanel.bandComboMode,
        stride:         5,
        focal:          state.regimesPanel.focal,    // SAME ref
      }),
    };
  }
  for (const id of ['regimesGenomePanel', 'regimesPC1GenomePanel']) {
    const el = document.getElementById(id);
    if (el && el.style) el.style.display = '';
  }
  _buildGenomeLanesPanel(state);
  _buildGenomePC1Panel(state);
  _drawGenomePlaceholder('regimesGenomeCanvasContainer',
    'Genome-scope target-band lanes — click "Compute genome view" to render.');
  _drawGenomePlaceholder('regimesPC1GenomeCanvasContainer',
    'Genome-scope PC1 lines — click "Compute genome view" to render.');
}

function _disableGenomePanels(state) {
  state._regimesEnableGenome = false;
  state._regimesGenomeComputed = false;
  _hideGenomePanels();
}

// ---------------------------------------------------------------------
// Genome panels — DOM scaffolding (mirrors buildRegimesPanel /
// buildRegimesPC1Panel but for the GENOME-scope DOM ids).
// ---------------------------------------------------------------------

function _buildGenomeLanesPanel(state) {
  const panel     = document.getElementById('regimesGenomePanel');
  const container = document.getElementById('regimesGenomeCanvasContainer');
  if (!panel || !container) return;
  if (panel.style) panel.style.display = '';
  if ('innerHTML' in container) container.innerHTML = '';
  if (container.style) {
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
  }
  const sub = document.createElement('div');
  sub.className = 'regimes-genome-lanes-subpanel';
  sub.style.cssText = 'position: relative; flex: 1 1 0; min-height: 0; ' +
                      'border-bottom: 1px solid var(--rule, #2a3242);';
  const cv = document.createElement('canvas');
  cv.style.cssText = 'display: block; width: 100%; height: 100%; cursor: crosshair;';
  cv.tabIndex = 0;
  sub.appendChild(cv);
  container.appendChild(sub);
}

function _buildGenomePC1Panel(state) {
  const panel     = document.getElementById('regimesPC1GenomePanel');
  const container = document.getElementById('regimesPC1GenomeCanvasContainer');
  if (!panel || !container) return;
  if (panel.style) panel.style.display = '';
  if ('innerHTML' in container) container.innerHTML = '';
  if (container.style) {
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
  }
  const sub = document.createElement('div');
  sub.className = 'regimes-genome-pc1-subpanel';
  sub.style.cssText = 'position: relative; flex: 1 1 0; min-height: 0; ' +
                      'border-bottom: 1px solid var(--rule, #2a3242);';
  const cv = document.createElement('canvas');
  cv.style.cssText = 'display: block; width: 100%; height: 100%; cursor: crosshair;';
  cv.tabIndex = 0;
  sub.appendChild(cv);
  container.appendChild(sub);
}

function _drawGenomePlaceholder(containerId, message) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const sub = container.querySelector('div');
  if (!sub) return;
  const cv = sub.querySelector('canvas');
  if (!cv) return;
  const ctx = cv.getContext && cv.getContext('2d');
  if (!ctx) return;
  // Size the canvas to its CSS box
  const rect = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(1, rect.width * dpr | 0);
  cv.height = Math.max(1, rect.height * dpr | 0);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = 'rgba(180,190,210,0.8)';
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(message, rect.width / 2, rect.height / 2);
}

// ---------------------------------------------------------------------
// Compute-genome-view button — populates state._regimesGenomeState
// tracks for the current focal voter, then draws the two genome
// panels. Subsequent arrow presses still don't auto-recompute; the
// user must click again. (Or we can flip a "live" toggle later.)
// ---------------------------------------------------------------------

export function computeGenomeView(state) {
  if (!state._regimesGenomeState) return;
  // Force track rebuild for the genome state
  state._regimesGenomeState.regimesPanel.track = null;
  ensureRegimesTrack(state._regimesGenomeState);
  // Render to the genome DOM ids by temporarily aliasing the
  // regimes_panel module's DOM lookup. Cleanest path: temporarily swap
  // the container ids on the document.
  _withDOMAliases(
    [
      ['regimesCanvasContainer',    'regimesGenomeCanvasContainer'],
      ['regimesPanel',              'regimesGenomePanel'],
    ],
    () => drawRegimesPanel(state._regimesGenomeState));
  _withDOMAliases(
    [
      ['regimesPC1CanvasContainer', 'regimesPC1GenomeCanvasContainer'],
      ['regimesPC1Panel',           'regimesPC1GenomePanel'],
    ],
    () => drawRegimesPC1Panel(state._regimesGenomeState));
  state._regimesGenomeComputed = true;
}

// Temporarily swap getElementById results so a draw function written
// against the chrom DOM ids ends up writing to the genome DOM ids. We
// do this by overriding document.getElementById for the duration of
// the call, only for the listed id pairs. This is necessary because
// regimes_panel.js and regimes_pc1_panel.js hardcode their container
// ids (a deliberate choice that mirrors how lines_panel.js works in
// the existing codebase). Keeping the panels DOM-id-coupled is
// idiomatic for this project; the alias trick is a clean isolation.
function _withDOMAliases(pairs, fn) {
  const orig = document.getElementById;
  const lookup = new Map(pairs);
  document.getElementById = function(id) {
    const target = lookup.get(id) || id;
    return orig.call(document, target);
  };
  try { fn(); } finally { document.getElementById = orig; }
}

// ---------------------------------------------------------------------
// Header — shows current focal voter, scope, mode + the buttons that
// cycle bandComboMode and trigger Compute-genome-view.
// ---------------------------------------------------------------------

function _renderHeader(state) {
  const hdr = document.getElementById('regimesPageHeader');
  if (!hdr) return;
  const rp = state.regimesPanel;
  const locus = rp.stage3_loci[rp.focal.seed_index];
  const K = locus ? locus.K : 1;
  const bands = [];
  for (let b = 0; b < K; b++) if (rp.focal.band_mask & (1 << b)) bands.push(b);
  const voterLabel = bands.length === 1 ? `b${bands[0]}` : `b${bands.join('+')}`;
  const seedText = `seed ${rp.focal.seed_index} (chr ${locus ? locus.chromosome_idx : '?'}` +
                   `, w=${locus ? locus.s_window : '?'}..${locus ? locus.e_window : '?'})`;
  hdr.innerHTML = '';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex; gap:8px; align-items:center; ' +
                      'font-family: ui-monospace, monospace; font-size: 12px;';
  row.innerHTML =
    `<span style="font-weight:600">${seedText}</span>` +
    `<span style="opacity:0.85">· voter ${voterLabel}</span>` +
    `<span style="opacity:0.7">· combo mode: ${rp.bandComboMode}</span>` +
    `<span style="opacity:0.7">· chrom_idx: ${rp.current_chromosome_idx}</span>`;
  hdr.appendChild(row);

  // Genome-view toggle. Default is OFF; click to opt in. When on,
  // the genome panels appear as placeholders until the user clicks
  // "Compute genome view" (the same button that becomes "Recompute" once
  // results exist).
  const genomeToggleBtn = document.createElement('button');
  genomeToggleBtn.textContent = state._regimesEnableGenome
    ? 'Hide genome view' : 'Show genome view';
  genomeToggleBtn.style.cssText = 'margin-left:8px; padding:4px 10px; cursor:pointer;';
  genomeToggleBtn.onclick = () => {
    if (state._regimesEnableGenome) _disableGenomePanels(state);
    else _enableGenomePanels(state);
    _renderHeader(state);
  };
  row.appendChild(genomeToggleBtn);

  // Compute / Recompute genome view (only meaningful when genome enabled)
  if (state._regimesEnableGenome) {
    const computeBtn = document.createElement('button');
    computeBtn.textContent = state._regimesGenomeComputed
      ? 'Recompute genome view' : 'Compute genome view';
    computeBtn.style.cssText = 'margin-left:4px; padding:4px 10px; cursor:pointer;';
    computeBtn.onclick = () => {
      computeGenomeView(state);
      _renderHeader(state);
    };
    row.appendChild(computeBtn);
  }

  // Cycle bandComboMode
  const modeBtn = document.createElement('button');
  modeBtn.textContent = `Cycle combo mode (${rp.bandComboMode})`;
  modeBtn.style.cssText = 'margin-left:4px; padding:4px 10px; cursor:pointer;';
  modeBtn.onclick = () => {
    const order = ['additive', 'all', 'informative'];
    const cur = order.indexOf(rp.bandComboMode);
    const next = order[(cur + 1) % order.length];
    rp.bandComboMode = next;
    if (state._regimesGenomeState) {
      state._regimesGenomeState.regimesPanel.bandComboMode = next;
    }
    // Snap focal.band_mask onto first subset of the new mode
    const newSubs = getActiveBandSubsets(rp, locus.K).subsets;
    rp.focal.band_mask = newSubs[0] || 1;
    _redrawAll(state);
    _renderHeader(state);
  };
  row.appendChild(modeBtn);

  // Cycle current_chromosome_idx (chrom-scope target chromosome)
  const chrBtn = document.createElement('button');
  chrBtn.textContent = `Next chrom (${rp.current_chromosome_idx})`;
  chrBtn.style.cssText = 'margin-left:4px; padding:4px 10px; cursor:pointer;';
  chrBtn.onclick = () => {
    const n = rp.chromosomes.length;
    rp.current_chromosome_idx = (rp.current_chromosome_idx + 1) % n;
    if (state._regimesGenomeState) {
      state._regimesGenomeState.regimesPanel.current_chromosome_idx =
        rp.current_chromosome_idx;
    }
    rp.track = null;   // invalidate so chrom-scope refetches
    _redrawAll(state);
    _renderHeader(state);
  };
  row.appendChild(chrBtn);

  // Pattern-class legend
  const legend = document.createElement('div');
  legend.style.cssText = 'display:flex; gap:8px; align-items:center; ' +
                         'margin-left:12px; font-family: ui-monospace, monospace; ' +
                         'font-size: 10px;';
  for (const [cls, colour] of Object.entries(PATTERN_CLASS_COLORS)) {
    if (cls === 'FAN') continue;     // alias
    const item = document.createElement('span');
    item.style.cssText = 'display:inline-flex; gap:3px; align-items:center;';
    const sw = document.createElement('span');
    sw.style.cssText = `display:inline-block; width:10px; height:10px; background:${colour};`;
    item.appendChild(sw);
    const t = document.createElement('span');
    t.textContent = cls;
    item.appendChild(t);
    legend.appendChild(item);
  }
  row.appendChild(legend);
}

// ---------------------------------------------------------------------
// Redraw all four panels. Chrom panels always redraw; genome panels
// only redraw if they were already computed (otherwise stay in
// placeholder).
// ---------------------------------------------------------------------

function _redrawAll(state) {
  drawRegimesPanel(state);
  drawRegimesPC1Panel(state);
  if (state._regimesEnableGenome && state._regimesGenomeComputed
      && state._regimesGenomeState) {
    // Force track rebuild for genome state since focal/scope may have
    // moved since last compute
    state._regimesGenomeState.regimesPanel.track = null;
    _withDOMAliases(
      [
        ['regimesCanvasContainer', 'regimesGenomeCanvasContainer'],
        ['regimesPanel',           'regimesGenomePanel'],
      ],
      () => drawRegimesPanel(state._regimesGenomeState));
    _withDOMAliases(
      [
        ['regimesPC1CanvasContainer', 'regimesPC1GenomeCanvasContainer'],
        ['regimesPC1Panel',           'regimesPC1GenomePanel'],
      ],
      () => drawRegimesPC1Panel(state._regimesGenomeState));
  }
}

// ---------------------------------------------------------------------
// Keyboard nav for the page — drives all four panels.
//
//   ←/→         next/prev seed    (resets band_mask to first subset)
//   ↑/↓         next/prev band combo (mode-driven enumeration)
//   shift+←/→   stay at seed, cycle single-band voter
//   home/end    first/last seed
//   ` (tilde)   cycle bandComboMode
//   c           cycle current_chromosome_idx
//   g           Compute genome view
// ---------------------------------------------------------------------

function _installPageKeyboardNav(state) {
  const handler = (e) => {
    if (!state.regimesPanel || !state.regimesPanel.stage3_loci) return;
    const rp = state.regimesPanel;
    const loci = rp.stage3_loci;
    if (loci.length === 0) return;
    const curLocus = loci[rp.focal.seed_index];
    const curK = curLocus ? curLocus.K : 1;
    const active = getActiveBandSubsets(rp, curK);
    const subsets = active.subsets;
    let curIdx = active.curIdx;

    let handled = false;
    if (e.key === 'ArrowRight') {
      if (e.shiftKey) {
        const singles = enumerateAdditiveBandSubsets(curK).slice(0, 0);
        // shift+→: cycle through the singletons of the current seed
        const allSingles = [];
        for (let b = 0; b < curK; b++) allSingles.push(1 << b);
        const cur = allSingles.indexOf(rp.focal.band_mask);
        rp.focal.band_mask = allSingles[(cur < 0 ? 0 : (cur + 1) % allSingles.length)];
      } else {
        rp.focal.seed_index = (rp.focal.seed_index + 1) % loci.length;
        const newK = loci[rp.focal.seed_index].K;
        const newSubs = getActiveBandSubsets(rp, newK).subsets;
        rp.focal.band_mask = newSubs[0] || 1;
        // When seed moves to a different chromosome, snap chrom panels too
        const newChr = loci[rp.focal.seed_index].chromosome_idx;
        if (newChr != null && newChr !== rp.current_chromosome_idx) {
          rp.current_chromosome_idx = newChr;
          if (state._regimesGenomeState) {
            state._regimesGenomeState.regimesPanel.current_chromosome_idx = newChr;
          }
          rp.track = null;
        }
      }
      handled = true;
    } else if (e.key === 'ArrowLeft') {
      if (e.shiftKey) {
        const allSingles = [];
        for (let b = 0; b < curK; b++) allSingles.push(1 << b);
        const cur = allSingles.indexOf(rp.focal.band_mask);
        rp.focal.band_mask = allSingles[
          (cur < 0 ? allSingles.length - 1 : (cur - 1 + allSingles.length) % allSingles.length)];
      } else {
        rp.focal.seed_index = (rp.focal.seed_index - 1 + loci.length) % loci.length;
        const newK = loci[rp.focal.seed_index].K;
        const newSubs = getActiveBandSubsets(rp, newK).subsets;
        rp.focal.band_mask = newSubs[0] || 1;
        const newChr = loci[rp.focal.seed_index].chromosome_idx;
        if (newChr != null && newChr !== rp.current_chromosome_idx) {
          rp.current_chromosome_idx = newChr;
          if (state._regimesGenomeState) {
            state._regimesGenomeState.regimesPanel.current_chromosome_idx = newChr;
          }
          rp.track = null;
        }
      }
      handled = true;
    } else if (e.key === 'ArrowDown') {
      curIdx = (curIdx + 1) % subsets.length;
      rp.focal.band_mask = subsets[curIdx];
      handled = true;
    } else if (e.key === 'ArrowUp') {
      curIdx = (curIdx - 1 + subsets.length) % subsets.length;
      rp.focal.band_mask = subsets[curIdx];
      handled = true;
    } else if (e.key === 'Home') {
      rp.focal.seed_index = 0;
      rp.focal.band_mask = 1;
      handled = true;
    } else if (e.key === 'End') {
      rp.focal.seed_index = loci.length - 1;
      rp.focal.band_mask = 1;
      handled = true;
    } else if (e.key === '`' || e.key === '~') {
      const order = ['additive', 'all', 'informative'];
      const cur = order.indexOf(rp.bandComboMode);
      rp.bandComboMode = order[(cur + 1) % order.length];
      if (state._regimesGenomeState) {
        state._regimesGenomeState.regimesPanel.bandComboMode = rp.bandComboMode;
      }
      const newSubs = getActiveBandSubsets(rp, curK).subsets;
      rp.focal.band_mask = newSubs[0] || 1;
      handled = true;
    } else if (e.key === 'c' || e.key === 'C') {
      const n = rp.chromosomes.length;
      rp.current_chromosome_idx = (rp.current_chromosome_idx + 1) % n;
      if (state._regimesGenomeState) {
        state._regimesGenomeState.regimesPanel.current_chromosome_idx =
          rp.current_chromosome_idx;
      }
      rp.track = null;
      handled = true;
    } else if (e.key === 'g' || e.key === 'G') {
      if (!state._regimesEnableGenome) {
        _enableGenomePanels(state);
      }
      computeGenomeView(state);
      handled = true;
    }
    if (handled) {
      e.preventDefault();
      _redrawAll(state);
      _renderHeader(state);
    }
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}

// Console-debug
if (typeof window !== 'undefined') {
  window._initRegimesPage   = initRegimesPage;
  window._computeGenomeView = computeGenomeView;
  // 2026-05-20: hook used by the seeds inspector strip in
  // haplotype_regimes.js. After mutating state.regimesPanel.focal.*
  // (e.g. on a chip click) the strip calls this to redraw the 4 panels
  // without going through the full initRegimesPage rebuild.
  window._refreshRegimesPanels = function _refreshRegimesPanels(state) {
    if (!state || !state.regimesPanel) return;
    try { _renderHeader(state); } catch (_) {}
    try { drawRegimesPanel(state); } catch (_) {}
    try { drawRegimesPC1Panel(state); } catch (_) {}
    if (state._regimesGenomeState) {
      try { drawRegimesPanel(state._regimesGenomeState); } catch (_) {}
      try { drawRegimesPC1Panel(state._regimesGenomeState); } catch (_) {}
    }
  };
}
