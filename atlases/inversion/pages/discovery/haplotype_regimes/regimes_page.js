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

  // Keyboard nav: drives all four panels (or just chrom if genome disabled).
  // 2026-05-20: if a previous initRegimesPage call left a teardown closure
  // on state, call it FIRST so we don't stack listeners. _afterPipelineRun
  // calls initRegimesPage on every pipeline re-run; without this guard each
  // re-run installs another document-level keydown handler and the arrow
  // keys would advance the focal seed N times per press.
  if (typeof state._regimesTeardownKeyboard === 'function') {
    try { state._regimesTeardownKeyboard(); }
    catch (_) {}
  }
  state._regimesTeardownKeyboard = _installPageKeyboardNav(state);

  // Click-to-expand wirer (2026-05-24). Idempotent — safe to call on every
  // pipeline re-run; uses the same dedup guard as the keyboard nav.
  if (typeof state._regimesTeardownExpand === 'function') {
    try { state._regimesTeardownExpand(); }
    catch (_) {}
  }
  state._regimesTeardownExpand = _installExpandButtons(state);

  return state._regimesTeardownKeyboard;
}

// ---------------------------------------------------------------------
// _installExpandButtons — click-to-enlarge for the 4 regimes panels.
//
// Each `.rg-panel-title button.rg-expand-btn` toggles `.rg-panel-expanded`
// on its parent `<div id="regimes*Panel">`. Expanded panel takes
// position:fixed full viewport (minus a small inset) with a semi-transparent
// backdrop. Click backdrop or press Escape to restore.
//
// After toggling, dispatches a `window.resize` event so the canvas
// fitCanvas() path runs and the renderer repaints at the new size.
// drawRegimesPanel + drawRegimesPC1Panel both read `cv.clientWidth/Height`
// at every call, so a fresh draw against the resized container picks up
// the new dims without additional plumbing.
// ---------------------------------------------------------------------
function _installExpandButtons(state) {
  if (typeof document === 'undefined') return () => {};
  // One-time injection of the CSS for the expanded state + backdrop.
  if (!document.getElementById('rg-panel-expand-css')) {
    const style = document.createElement('style');
    style.id = 'rg-panel-expand-css';
    style.textContent = `
      .rg-panel-expanded {
        position: fixed !important;
        inset: 4vh 4vw !important;
        z-index: 1001 !important;
        box-shadow: 0 12px 48px rgba(0,0,0,0.6),
                    0 0 0 1px var(--accent, #f5a524);
        border-radius: 4px;
      }
      .rg-expand-backdrop {
        position: fixed; inset: 0; z-index: 1000;
        background: rgba(8, 12, 20, 0.65);
        backdrop-filter: blur(2px);
        -webkit-backdrop-filter: blur(2px);
      }
      .rg-expand-btn:hover { color: var(--accent, #f5a524) !important;
                              border-color: var(--accent, #f5a524) !important; }
    `;
    document.head.appendChild(style);
  }

  // Per-panel redraw dispatch. Each panel has its own (state, drawFn) pair —
  // genome panels read from state._regimesGenomeState, chrom from state.
  const panelSpec = {
    regimesPanel:           { state: state,                            draw: drawRegimesPanel },
    regimesGenomePanel:     { state: state._regimesGenomeState,        draw: drawRegimesPanel },
    regimesPC1Panel:        { state: state,                            draw: drawRegimesPC1Panel },
    regimesPC1GenomePanel:  { state: state._regimesGenomeState,        draw: drawRegimesPC1Panel },
  };
  const handlers = [];
  let backdrop = null;
  let expandedPanelId = null;

  function _redrawAfterLayout() {
    // rAF so the .rg-panel-expanded layout commits BEFORE the canvas
    // queries clientWidth/Height via fitCanvas(). Without the rAF the
    // canvas measures the pre-expand box and renders too small.
    const fire = () => {
      for (const pid of Object.keys(panelSpec)) {
        const spec = panelSpec[pid];
        if (!spec || !spec.state || typeof spec.draw !== 'function') continue;
        try { spec.draw(spec.state); } catch (_) { /* fail-soft per-panel */ }
      }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fire);
    else setTimeout(fire, 0);
  }

  function collapse() {
    if (!expandedPanelId) return;
    const panel = document.getElementById(expandedPanelId);
    if (panel) panel.classList.remove('rg-panel-expanded');
    expandedPanelId = null;
    if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    backdrop = null;
    _redrawAfterLayout();
  }

  function expand(panelId) {
    if (expandedPanelId === panelId) { collapse(); return; }
    if (expandedPanelId) collapse();
    const panel = document.getElementById(panelId);
    if (!panel) return;
    backdrop = document.createElement('div');
    backdrop.className = 'rg-expand-backdrop';
    backdrop.addEventListener('click', collapse);
    document.body.appendChild(backdrop);
    panel.classList.add('rg-panel-expanded');
    expandedPanelId = panelId;
    _redrawAfterLayout();
  }

  for (const pid of Object.keys(panelSpec)) {
    const panel = document.getElementById(pid);
    if (!panel) continue;
    const btn = panel.querySelector('.rg-expand-btn');
    if (!btn) continue;
    const onClick = (e) => { e.preventDefault(); e.stopPropagation(); expand(pid); };
    btn.addEventListener('click', onClick);
    handlers.push(() => btn.removeEventListener('click', onClick));
  }

  // ESC dismisses.
  const onKey = (e) => {
    if (e.key === 'Escape' && expandedPanelId) {
      e.preventDefault();
      collapse();
    }
  };
  document.addEventListener('keydown', onKey);
  handlers.push(() => document.removeEventListener('keydown', onKey));

  // Teardown closure — called on next initRegimesPage to prevent
  // listener-stacking on re-runs.
  return function teardownExpand() {
    if (expandedPanelId) collapse();
    for (const fn of handlers) { try { fn(); } catch (_) {} }
  };
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
  // 2026-05-20: position:absolute + inset:0 anchors the canvas to the
  // relative sub directly. width/height:100% relies on the parent
  // resolving a definite height — which a flex-basis:0 parent doesn't
  // always do, hence the empty-canvas bug.
  cv.style.cssText = 'display: block; position: absolute; inset: 0; cursor: crosshair;';
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
  // 2026-05-20: position:absolute + inset:0 anchors the canvas to the
  // relative sub directly. width/height:100% relies on the parent
  // resolving a definite height — which a flex-basis:0 parent doesn't
  // always do, hence the empty-canvas bug.
  cv.style.cssText = 'display: block; position: absolute; inset: 0; cursor: crosshair;';
  cv.tabIndex = 0;
  sub.appendChild(cv);
  container.appendChild(sub);
}

function _drawGenomePlaceholder(containerId, message) {
  // 2026-05-20: defer the actual paint to a RAF. Previously this ran
  // synchronously from _enableGenomePanels which had JUST flipped the
  // panel container from display:none to display:'' — at sync-call
  // time the browser hadn't laid out the new flex children yet, so
  // canvas.getBoundingClientRect() returned 0×0. The canvas bitmap
  // was set to 1×1, the fillRect/fillText painted into 1 pixel, and
  // the user saw a black panel (user report: "When we show genome
  // view the panels are black"). A single RAF lets layout settle;
  // if the rect is STILL zero we retry once on the next frame, then
  // log + bail so a stuck panel doesn't loop forever.
  const paint = (attemptsLeft) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    const sub = container.querySelector('div');
    if (!sub) return;
    const cv = sub.querySelector('canvas');
    if (!cv) return;
    const ctx = cv.getContext && cv.getContext('2d');
    if (!ctx) return;
    const rect = cv.getBoundingClientRect();
    if ((rect.width < 4 || rect.height < 4) && attemptsLeft > 0) {
      requestAnimationFrame(() => paint(attemptsLeft - 1));
      return;
    }
    if (rect.width < 4 || rect.height < 4) {
      console.warn('[regimes] _drawGenomePlaceholder: canvas has zero box',
        '— parent layout collapsed. containerId=', containerId,
        'rect=', rect.width, 'x', rect.height);
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, rect.width * dpr | 0);
    cv.height = Math.max(1, rect.height * dpr | 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);   // reset any stale scale
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = 'rgba(180,190,210,0.8)';
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message, rect.width / 2, rect.height / 2);
  };
  requestAnimationFrame(() => paint(2));
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

  // 2026-05-20: shared dark-theme button styling so the dynamically-
  // created header buttons match the action-bar .rg-tb-btn buttons
  // instead of rendering as browser-default white buttons.
  const RG_BTN_CSS = 'margin-left:4px; padding:3px 10px; cursor:pointer; ' +
    'background: var(--panel-3, #232a36); color: var(--ink, #e6edf6); ' +
    'border: 1px solid var(--rule, #2a3242); border-radius: 3px; ' +
    'font: 10.5px var(--mono, ui-monospace, monospace); white-space: nowrap;';

  // Genome-view toggle. Default is OFF; click to opt in. When on,
  // the genome panels appear as placeholders until the user clicks
  // "Compute genome view" (the same button that becomes "Recompute" once
  // results exist).
  const genomeToggleBtn = document.createElement('button');
  genomeToggleBtn.textContent = state._regimesEnableGenome
    ? 'Hide genome view' : 'Show genome view';
  genomeToggleBtn.style.cssText = RG_BTN_CSS;
  genomeToggleBtn.title = 'Show/hide the right column of genome-wide panels '
    + '(target loci across all chromosomes). Off by default — turn on '
    + 'before clicking "Compute genome view".';
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
    computeBtn.style.cssText = RG_BTN_CSS;
    computeBtn.title = 'Project the focal voter onto every target locus '
      + 'across all chromosomes. May take a few seconds.';
    computeBtn.onclick = () => {
      computeGenomeView(state);
      _renderHeader(state);
    };
    row.appendChild(computeBtn);
  }

  // Cycle bandComboMode. Switches how K bands are combined into voter
  // subsets — additive = one voter per band, all = every non-empty
  // bitmask (2^K - 1 voters), informative = curated stable subsets.
  // 2026-05-20: guarded against missing locus (was throwing silently
  // when the pipeline produced no Stage 3 loci yet).
  const modeBtn = document.createElement('button');
  modeBtn.textContent = `Cycle combo mode (${rp.bandComboMode})`;
  modeBtn.style.cssText = RG_BTN_CSS;
  modeBtn.title = 'Cycle through band-combination modes for the focal '
    + 'voter:\n'
    + '  • additive — one voter per band (b0, b1, …)\n'
    + '  • all — every non-empty bitmask over K bands\n'
    + '  • informative — curated subsets producing stable projections\n'
    + 'The voter (focal.band_mask) is rebuilt as the UNION of the '
    + 'chosen bands\' samples on each cycle.';
  modeBtn.onclick = () => {
    const order = ['additive', 'all', 'informative'];
    const cur = order.indexOf(rp.bandComboMode);
    const next = order[(cur + 1) % order.length];
    rp.bandComboMode = next;
    if (state._regimesGenomeState) {
      state._regimesGenomeState.regimesPanel.bandComboMode = next;
    }
    // Snap focal.band_mask onto first subset of the new mode. Guard
    // against missing locus (no Stage 3 loci → focal.seed_index points
    // at undefined → throw on locus.K). Without the guard the button
    // appeared broken when clicked before "run pipeline".
    const K = locus ? locus.K : 1;
    try {
      const newSubs = getActiveBandSubsets(rp, K).subsets;
      rp.focal.band_mask = newSubs[0] || 1;
    } catch (e) {
      console.warn('[cycleCombo] subset enum threw —', e);
      rp.focal.band_mask = 1;
    }
    _redrawAll(state);
    _renderHeader(state);
  };
  row.appendChild(modeBtn);

  // Cycle current_chromosome_idx (chrom-scope target chromosome)
  const chrBtn = document.createElement('button');
  chrBtn.textContent = `Next chrom (${rp.current_chromosome_idx})`;
  chrBtn.style.cssText = RG_BTN_CSS;
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

// Synchronous all-panel paint. Caller's responsibility to coalesce.
function _redrawAllSync(state) {
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

// 2026-05-20: rAF-coalesced front-door. The keyboard handler and any
// other rapid-fire repaint trigger should go through this so multiple
// scrubs in a tick collapse to one paint per frame. The full coalescing
// machinery (including the skip-same-focal cache + force-redraw escape)
// lives in the window._refreshRegimesPanels installer at the bottom of
// the file; this helper just delegates to it.
function _redrawAll(state) {
  if (typeof window !== 'undefined' && typeof window._refreshRegimesPanels === 'function') {
    window._refreshRegimesPanels(state);
  } else {
    _redrawAllSync(state);
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
  //
  // Coalesced via requestAnimationFrame so rapid arrow-key scrubs collapse
  // to one paint per frame instead of N paints per tick. The original
  // un-coalesced form did ~2M canvas operations per call (see decimation
  // note in regimes_panel.js) and stacking those at 60+ keypresses/sec
  // hung the tab. Multiple calls within the same frame keep only the
  // latest state reference, so the user always sees the freshest focal.
  let _pendingState = null;
  let _rafHandle    = 0;
  // 2026-05-20: skip-same-focal cache. Key on the four state slots that
  // actually affect the painted pixels: focal.seed_index, focal.band_mask,
  // current_chromosome_idx, and the genome-state existence flag (since
  // showing the right column is itself a layout change). Any other
  // mutation that triggers _refreshRegimesPanels (e.g. side-effect calls
  // in the chip-click handler) collapses to a no-op when those four are
  // unchanged. Reset on every mount via clearFingerprint() below.
  let _lastFp = null;
  function _renderFp(state) {
    const rp = state.regimesPanel;
    if (!rp || !rp.focal) return '';
    return `${rp.focal.seed_index | 0}:${rp.focal.band_mask | 0}:`
      + `${rp.current_chromosome_idx | 0}:${state._regimesGenomeState ? 1 : 0}`;
  }
  function _flushRefresh() {
    _rafHandle = 0;
    const state = _pendingState;
    _pendingState = null;
    if (!state || !state.regimesPanel) return;
    const fp = _renderFp(state);
    if (fp && fp === _lastFp && state.__regimesForceRedraw !== true) return;
    _lastFp = fp;
    state.__regimesForceRedraw = false;
    try { _renderHeader(state); } catch (_) {}
    // _redrawAllSync paints both chrom-scope canvases AND, when genome
    // view is enabled + computed, the two genome-scope canvases via the
    // _withDOMAliases hack (so drawRegimesPanel reads from the genome
    // container instead of the chrom one). The previous flush bypassed
    // that hack and painted genome data into the chrom canvas — visible
    // as flicker or "wrong panel" repaints. Going through _redrawAllSync
    // matches what the keyboard handler used to do directly.
    try { _redrawAllSync(state); } catch (_) {}
  }
  window._refreshRegimesPanels = function _refreshRegimesPanels(state) {
    if (!state || !state.regimesPanel) return;
    _pendingState = state;
    if (_rafHandle) return;
    _rafHandle = (typeof requestAnimationFrame === 'function')
      ? requestAnimationFrame(_flushRefresh)
      : setTimeout(_flushRefresh, 16);
  };
  // Escape hatch for callers (e.g. pipeline re-run, chrom switch) that
  // need a guaranteed repaint regardless of the fingerprint cache. The
  // refresh runs on the next rAF tick as usual; only the cache check is
  // skipped for this one call.
  window._refreshRegimesPanelsForce = function _refreshRegimesPanelsForce(state) {
    if (!state || !state.regimesPanel) return;
    state.__regimesForceRedraw = true;
    _lastFp = null;
    window._refreshRegimesPanels(state);
  };
}
