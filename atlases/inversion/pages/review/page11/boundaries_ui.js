// pages/review/page11/boundaries_ui.js
//
// Page11 boundary-refinement UI wiring (legacy lines 18351-18626 +
// 30175-30314). Cartridge port of the toolbar wiring + state-mutating
// actions; uses the pure helpers from ./boundaries.js for all
// computation. The canvas-rendering layer (_bndDrawTracks) is deferred
// to a follow-up round.
//
// Public entries:
//   populateCandidateSelect(state)   : fill #bndCandSelect with options
//   updateRadiusButtons(state)       : toggle .active on radius buttons
//   updateSaveButton(state)          : enabled + .dirty class
//   updateStatusSelect(state)        : set #bndStatusSel value
//   selectCandidate(state, candId)   : set active candidate + stage
//   bndReset(state)                  : clear staging boundaries
//   bndSave(state, opts?)            : commit staging onto candidate
//   bndOverrideLeft(state, wIdx, opts?)  : manual left edge at window
//   bndOverrideRight(state, wIdx, opts?) : manual right edge at window
//   bndAutoPropose(state, opts?)     : data → tracks → edges → stage
//   refreshBoundariesUi(state)       : run all update fns + onChange
//   wireBoundariesToolbar(state, opts?) : install handlers
//   teardownBoundariesToolbar()      : remove handlers
//
// State slots used:
//   state.candidate        : currently-active candidate (cross-atlas)
//   state.candidateList    : registry array
//   state.data             : per-chromosome precomp (windows, layers)
//   state.__boundaries     : page-private state initialised by
//                            ensureBoundariesState from ./boundaries.js

import {
  BOUNDARY_DEFAULTS,
  BOUNDARY_TRACK_WEIGHTS,
  ensureBoundariesState,
  bndFindCandidate,
  bndCloneRecord,
  bndStageFromCandidate,
  buildBoundaryTrackScores,
  computeBoundaryEdges,
  buildBoundaryRecord,
  boundaryScanRange,
  findSVAnchorsInZone,
} from './boundaries.js';

function _escape(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _canListen(t) {
  return t
    && typeof t.addEventListener === 'function'
    && typeof t.removeEventListener === 'function';
}

// =====================================================================
// Update fns — small DOM mutators that read state and write the toolbar
// =====================================================================

/**
 * Build the candidate-select <option> list from state.candidateList.
 * Marks the active candidate as selected; appends ✓ to entries that
 * already carry a saved boundary.
 */
export function populateCandidateSelect(state) {
  if (typeof document === 'undefined') return;
  const sel = document.getElementById('bndCandSelect');
  if (!sel) return;
  const list = (state && state.candidateList) || [];
  const bs = ensureBoundariesState(state);
  const cur = bs ? bs.active_cand_id : null;

  let html = '<option value="">— select candidate —</option>';
  for (const c of list) {
    if (!c) continue;
    const id = (c.id != null) ? c.id : c.candidate_id;
    if (id == null) continue;
    const span = (Number.isFinite(c.end_bp) && Number.isFinite(c.start_bp))
      ? (c.end_bp - c.start_bp) : 0;
    const spanMb = (span / 1e6).toFixed(2);
    const hasBoundaries = !!(c.boundary_left || c.boundary_right);
    const mark = hasBoundaries ? ' ✓' : '';
    const label = _escape(id) + ' · ' + spanMb + ' Mb' + mark;
    const selAttr = (id === cur) ? ' selected' : '';
    html += '<option value="' + _escape(id) + '"' + selAttr + '>' + label + '</option>';
  }
  sel.innerHTML = html;
}

/** Toggle .active on the radius buttons that match state's scan radius. */
export function updateRadiusButtons(state) {
  if (typeof document === 'undefined') return;
  if (typeof document.querySelectorAll !== 'function') return;
  const bs = ensureBoundariesState(state);
  if (!bs) return;
  const btns = document.querySelectorAll('#page11 .bnd-radius-btn');
  if (!btns || typeof btns.forEach !== 'function') return;
  btns.forEach(b => {
    const r = parseInt(b.getAttribute && b.getAttribute('data-radius'), 10);
    if (!b.classList) return;
    if (r === bs.scan_radius_bp) b.classList.add('active');
    else                          b.classList.remove('active');
  });
}

/** Enable/disable save button + mark .dirty when staging has changes. */
export function updateSaveButton(state) {
  if (typeof document === 'undefined') return;
  const btn = document.getElementById('bndSaveBtn');
  if (!btn) return;
  const bs = ensureBoundariesState(state);
  if (!bs) return;
  if (bs.staging && bs.staging.dirty && btn.classList) btn.classList.add('dirty');
  else if (btn.classList) btn.classList.remove('dirty');
  btn.disabled = !(bs.staging && bs.staging.cand_id != null);
}

/** Sync #bndStatusSel value with state.__boundaries.staging. */
export function updateStatusSelect(state) {
  if (typeof document === 'undefined') return;
  const sel = document.getElementById('bndStatusSel');
  if (!sel) return;
  const bs = ensureBoundariesState(state);
  if (!bs) return;
  sel.value = (bs.staging && bs.staging.breakpoint_status) || 'boundary_zone_only';
}

// =====================================================================
// Action fns — state mutators that drive the staging workflow
// =====================================================================

/**
 * Select a candidate. Sets active_cand_id, stages from existing
 * boundaries on that candidate (if any), and clears dirty.
 */
export function selectCandidate(state, candId) {
  const bs = ensureBoundariesState(state);
  if (!bs) return;
  const cand = bndFindCandidate(state, candId);
  bs.active_cand_id = cand ? (cand.id != null ? cand.id : cand.candidate_id) : null;
  bndStageFromCandidate(state, cand);
}

/** Clear both boundaries from staging. Marks dirty if anything changed. */
export function bndReset(state) {
  const bs = ensureBoundariesState(state);
  if (!bs || !bs.staging) return;
  const had = !!(bs.staging.boundary_left || bs.staging.boundary_right);
  bs.staging.boundary_left = null;
  bs.staging.boundary_right = null;
  if (had) bs.staging.dirty = true;
}

/**
 * Commit staging onto the candidate's boundary_left / boundary_right /
 * breakpoint_status / boundary_notes. Returns true on success, false
 * when no active candidate. Optionally fires opts.onSave(state, cand).
 */
export function bndSave(state, opts) {
  const bs = ensureBoundariesState(state);
  if (!bs || !bs.staging || bs.staging.cand_id == null) return false;
  const cand = bndFindCandidate(state, bs.staging.cand_id);
  if (!cand) return false;
  cand.boundary_left      = bndCloneRecord(bs.staging.boundary_left);
  cand.boundary_right     = bndCloneRecord(bs.staging.boundary_right);
  cand.breakpoint_status  = bs.staging.breakpoint_status || 'boundary_zone_only';
  cand.boundary_notes     = bs.staging.boundary_notes || '';
  bs.staging.dirty = false;
  if (opts && typeof opts.onSave === 'function') {
    try { opts.onSave(state, cand); } catch (_) { /* swallow */ }
  }
  return true;
}

/**
 * Manual override of the LEFT boundary at the given window index.
 * Builds a boundary record via buildBoundaryRecord (source='manual')
 * with an empty support[] (no auto signal participated). Requires
 * opts.windows (state.data.windows) for the bp range.
 *
 * `wIdx` is the global window index (not local to the scan range).
 */
export function bndOverrideLeft(state, wIdx, opts) {
  const bs = ensureBoundariesState(state);
  if (!bs || !bs.staging) return;
  const o = opts || {};
  const W = o.windows || (state && state.data && state.data.windows) || null;
  if (!W) return;
  const rec = buildBoundaryRecord(
    { window_idx: wIdx, score: 0, support: [] },
    'left', 'manual',
    { windows: W, zone_radius_windows: o.zone_radius_windows, now: o.now }
  );
  if (!rec) return;
  bs.staging.boundary_left = rec;
  bs.staging.dirty = true;
}

/** Manual override of the RIGHT boundary. Mirror of bndOverrideLeft. */
export function bndOverrideRight(state, wIdx, opts) {
  const bs = ensureBoundariesState(state);
  if (!bs || !bs.staging) return;
  const o = opts || {};
  const W = o.windows || (state && state.data && state.data.windows) || null;
  if (!W) return;
  const rec = buildBoundaryRecord(
    { window_idx: wIdx, score: 0, support: [] },
    'right', 'manual',
    { windows: W, zone_radius_windows: o.zone_radius_windows, now: o.now }
  );
  if (!rec) return;
  bs.staging.boundary_right = rec;
  bs.staging.dirty = true;
}

/**
 * Run the auto-propose pipeline against the active candidate:
 *   1. boundaryScanRange(cand, scan_radius, chromLen, windows)
 *   2. buildBoundaryTrackScores(data, cand, scanRange, opts)
 *   3. computeBoundaryEdges(trackScores, weights)
 *   4. buildBoundaryRecord(edge, side, 'auto', { windows, sv_anchors })
 *
 * Populates state.__boundaries.staging.boundary_{left,right}.
 * Returns the { left, right, scanRange, trackScores, edges } bundle
 * (also cached on bs.cache by candidate id) or null if no active cand.
 */
export function bndAutoPropose(state, opts) {
  const bs = ensureBoundariesState(state);
  if (!bs || bs.active_cand_id == null) return null;
  const cand = bndFindCandidate(state, bs.active_cand_id);
  if (!cand) return null;
  const o = opts || {};
  const data = (state && state.data) || {};
  const windows = data.windows || null;
  if (!windows) return null;
  const chromLen = data.n_bp != null ? data.n_bp
                : data.chrom_length != null ? data.chrom_length : null;

  const scanRange = boundaryScanRange(cand, bs.scan_radius_bp, chromLen, windows);
  if (!scanRange) return null;

  const trackScores = buildBoundaryTrackScores(data, cand, scanRange, {
    dosageMeans: o.dosageMeans,
  });
  const weights = o.weights || BOUNDARY_TRACK_WEIGHTS;
  const edges = computeBoundaryEdges(trackScores, weights, o.edgeOpts);

  // boundary_evidence row for SV anchors
  let beRow = null;
  if (Array.isArray(data.boundary_evidence)) {
    beRow = data.boundary_evidence.find(r => r && r.candidate_id === cand.id) || null;
  }
  const buildRec = (edge, side) => {
    if (!edge) return null;
    // SV anchors that fall inside this edge's zone window range
    const zR = (o.zone_radius_windows != null) ? o.zone_radius_windows : BOUNDARY_DEFAULTS.ZONE_RADIUS_WINDOWS;
    const lo = Math.max(0, edge.window_idx - zR);
    const hi = Math.min(windows.start_bp.length - 1, edge.window_idx + zR);
    const zoneStart = windows.start_bp[lo];
    const zoneEnd   = windows.end_bp[hi];
    const svAnchors = findSVAnchorsInZone(beRow, zoneStart, zoneEnd);
    return buildBoundaryRecord(edge, side, 'auto', {
      windows, zone_radius_windows: zR, sv_anchors: svAnchors, now: o.now,
    });
  };
  const leftRec  = buildRec(edges.left,  'left');
  const rightRec = buildRec(edges.right, 'right');

  bs.staging.boundary_left  = leftRec;
  bs.staging.boundary_right = rightRec;
  bs.staging.dirty = true;

  // Cache the result for the radius-change invalidation flow
  if (bs.cache && typeof bs.cache.set === 'function') {
    bs.cache.set(cand.id, { scanRange, trackScores, edges });
  }
  return { left: leftRec, right: rightRec, scanRange, trackScores, edges };
}

// =====================================================================
// Orchestrator
// =====================================================================

/** Run all the update fns. Idempotent. */
export function refreshBoundariesUi(state) {
  if (typeof document === 'undefined') return;
  populateCandidateSelect(state);
  updateRadiusButtons(state);
  updateSaveButton(state);
  updateStatusSelect(state);

  // Info line
  const info = document.getElementById('bndInfo');
  const bs = ensureBoundariesState(state);
  if (info && bs) {
    if (!bs.active_cand_id) {
      info.textContent = 'No candidate selected.';
    } else {
      const cand = bndFindCandidate(state, bs.active_cand_id);
      if (cand) {
        const startMb = Number.isFinite(cand.start_bp) ? (cand.start_bp / 1e6).toFixed(2) : '?';
        const endMb   = Number.isFinite(cand.end_bp)   ? (cand.end_bp   / 1e6).toFixed(2) : '?';
        info.textContent = (cand.chrom || '?') + ' · ' + startMb + '–' + endMb + ' Mb'
          + ' · ' + (cand.id || '?');
      }
    }
  }
}

// =====================================================================
// Event wiring
// =====================================================================

let _candChangeHandler  = null;
let _radiusClickHandler = null;
let _autoBtnHandler     = null;
let _leftBtnHandler     = null;
let _rightBtnHandler    = null;
let _resetBtnHandler    = null;
let _saveBtnHandler     = null;
let _statusChangeHandler = null;
let _radiusGroupEl      = null;

/**
 * Install all toolbar handlers. Idempotent. State is mutated by the
 * handlers; opts callbacks fire after every mutation.
 *
 * @param {Object} state
 * @param {{onChange?:Function, onSave?:Function,
 *         getCursorWindowIdx?:Function}} opts
 */
export function wireBoundariesToolbar(state, opts) {
  if (typeof document === 'undefined') return;
  teardownBoundariesToolbar();
  ensureBoundariesState(state);

  const o = opts || {};
  const onChange = (typeof o.onChange === 'function') ? o.onChange : null;
  const onSave   = (typeof o.onSave   === 'function') ? o.onSave   : null;
  const getCursor = (typeof o.getCursorWindowIdx === 'function') ? o.getCursorWindowIdx : null;

  const candSel  = document.getElementById('bndCandSelect');
  const autoBtn  = document.getElementById('bndAutoProposeBtn');
  const lBtn     = document.getElementById('bndOverrideLBtn');
  const rBtn     = document.getElementById('bndOverrideRBtn');
  const resetBtn = document.getElementById('bndResetBtn');
  const saveBtn  = document.getElementById('bndSaveBtn');
  const statSel  = document.getElementById('bndStatusSel');
  // Radius button group — delegate via the parent for one listener.
  const radiusGroup = (typeof document.querySelector === 'function')
    ? document.querySelector('#page11 .bnd-radius-group') : null;

  const refresh = () => {
    refreshBoundariesUi(state);
    if (onChange) { try { onChange(state); } catch (_) {} }
  };

  _candChangeHandler = (evt) => {
    const v = (evt && evt.target && evt.target.value) || '';
    const id = (v === '') ? null
      : (Number.isFinite(parseInt(v, 10)) && /^-?\d+$/.test(v) ? parseInt(v, 10) : v);
    selectCandidate(state, id);
    refresh();
  };

  _radiusClickHandler = (evt) => {
    const t = evt && evt.target;
    if (!t || typeof t.getAttribute !== 'function') return;
    const r = parseInt(t.getAttribute('data-radius'), 10);
    if (!(Number.isFinite(r) && r > 0)) return;
    const bs = ensureBoundariesState(state);
    bs.scan_radius_bp = r;
    if (bs.active_cand_id != null && bs.cache && typeof bs.cache.delete === 'function') {
      bs.cache.delete(bs.active_cand_id);
    }
    refresh();
  };

  _autoBtnHandler = () => {
    bndAutoPropose(state, { now: o.now });
    refresh();
  };

  _leftBtnHandler = () => {
    const wIdx = getCursor ? getCursor(state) : null;
    if (!Number.isFinite(wIdx)) return;
    bndOverrideLeft(state, wIdx, { now: o.now });
    refresh();
  };

  _rightBtnHandler = () => {
    const wIdx = getCursor ? getCursor(state) : null;
    if (!Number.isFinite(wIdx)) return;
    bndOverrideRight(state, wIdx, { now: o.now });
    refresh();
  };

  _resetBtnHandler = () => {
    bndReset(state);
    refresh();
  };

  _saveBtnHandler = () => {
    bndSave(state, { onSave });
    refresh();
  };

  _statusChangeHandler = (evt) => {
    const bs = ensureBoundariesState(state);
    if (!bs || !bs.staging) return;
    bs.staging.breakpoint_status = (evt && evt.target && evt.target.value) || 'boundary_zone_only';
    bs.staging.dirty = true;
    refresh();
  };

  if (_canListen(candSel))  candSel.addEventListener('change',  _candChangeHandler);
  if (_canListen(radiusGroup)) {
    radiusGroup.addEventListener('click', _radiusClickHandler);
    _radiusGroupEl = radiusGroup;
  }
  if (_canListen(autoBtn))  autoBtn.addEventListener('click',  _autoBtnHandler);
  if (_canListen(lBtn))     lBtn.addEventListener('click',     _leftBtnHandler);
  if (_canListen(rBtn))     rBtn.addEventListener('click',     _rightBtnHandler);
  if (_canListen(resetBtn)) resetBtn.addEventListener('click', _resetBtnHandler);
  if (_canListen(saveBtn))  saveBtn.addEventListener('click',  _saveBtnHandler);
  if (_canListen(statSel))  statSel.addEventListener('change', _statusChangeHandler);
}

/** Remove all wired handlers. Idempotent. */
export function teardownBoundariesToolbar() {
  if (typeof document === 'undefined') return;
  const byId = [
    ['bndCandSelect',     'change', _candChangeHandler],
    ['bndAutoProposeBtn', 'click',  _autoBtnHandler],
    ['bndOverrideLBtn',   'click',  _leftBtnHandler],
    ['bndOverrideRBtn',   'click',  _rightBtnHandler],
    ['bndResetBtn',       'click',  _resetBtnHandler],
    ['bndSaveBtn',        'click',  _saveBtnHandler],
    ['bndStatusSel',      'change', _statusChangeHandler],
  ];
  for (const [id, evt, h] of byId) {
    if (!h) continue;
    const el = document.getElementById(id);
    if (_canListen(el)) el.removeEventListener(evt, h);
  }
  if (_radiusClickHandler && _radiusGroupEl && _canListen(_radiusGroupEl)) {
    _radiusGroupEl.removeEventListener('click', _radiusClickHandler);
  }
  _candChangeHandler = _radiusClickHandler = _autoBtnHandler = null;
  _leftBtnHandler    = _rightBtnHandler    = _resetBtnHandler = _saveBtnHandler = null;
  _statusChangeHandler = null;
  _radiusGroupEl = null;
}
