// tests/test_boundary_refinement_boundaries_ui.js
//
// Unit coverage for boundary_refinement's boundary-refinement UI module.
// Covers the toolbar wiring + action functions that legacy lines
// 18351-18626 + 30175-30314 implemented. Pairs with the algorithmic
// pipeline in test_page11_boundaries.js.
//
// Covers:
//   - populateCandidateSelect: option list + ✓ marker + active select
//   - updateRadiusButtons: .active class on matching radius
//   - updateSaveButton: enabled + .dirty class state
//   - updateStatusSelect: value sync
//   - selectCandidate: state mutation, stages from existing boundaries
//   - bndReset: clears both boundaries + dirty
//   - bndSave: commits onto candidate, fires onSave
//   - bndOverrideLeft / Right: manual edge records, dirty
//   - bndAutoPropose: end-to-end pipeline (data → tracks → edges → stage)
//   - refreshBoundariesUi: orchestrator updates all UI elements
//   - wireBoundariesToolbar: idempotent install + change/click handlers
//   - teardownBoundariesToolbar: handler removal, idempotent

import * as UI from '../atlases/inversion/pages/review/boundary_refinement/boundaries_ui.js';
import { ensureBoundariesState } from '../atlases/inversion/pages/review/boundary_refinement/boundaries.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// DOM mocks
// -----------------------------------------------------------------------------

class FakeNode {
  constructor(id, tag) {
    this.id = id; this.tagName = tag || 'div';
    this.innerHTML = ''; this.textContent = '';
    this.style = {}; this.value = ''; this._listeners = {};
    this.children = []; this._attrs = {};
    this.disabled = false;
    this.classList = {
      _set: new Set(),
      add: (c)    => this.classList._set.add(c),
      remove: (c) => this.classList._set.delete(c),
      contains: (c) => this.classList._set.has(c),
    };
  }
  addEventListener(evt, cb) { (this._listeners[evt] = this._listeners[evt] || []).push(cb); }
  removeEventListener(evt, cb) {
    const list = this._listeners[evt] || [];
    const idx = list.indexOf(cb);
    if (idx >= 0) list.splice(idx, 1);
  }
  appendChild(c) { this.children.push(c); }
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return this._attrs[k]; }
  fire(evt, payload) {
    (this._listeners[evt] || []).forEach(cb => cb(payload || { target: this }));
  }
}

const _nodes = new Map();
function _ensure(id) {
  if (!_nodes.has(id)) _nodes.set(id, new FakeNode(id));
  return _nodes.get(id);
}

// Track radius buttons separately so querySelectorAll returns them.
const _radiusBtns = [];
function _addRadiusBtn(radius) {
  const b = new FakeNode('radbtn:' + radius, 'button');
  b.setAttribute('data-radius', String(radius));
  _radiusBtns.push(b);
  return b;
}
_addRadiusBtn(1000);
_addRadiusBtn(10000);
_addRadiusBtn(1500000);

const _radiusGroup = new FakeNode('radius-group', 'div');

global.document = {
  body: new FakeNode('body'),
  getElementById: (id) => _ensure(id),
  querySelectorAll: (sel) => {
    if (sel === '#boundary_refinement .bnd-radius-btn') return _radiusBtns;
    return [];
  },
  querySelector: (sel) => {
    if (sel === '#boundary_refinement .bnd-radius-group') return _radiusGroup;
    return null;
  },
  createElement: (tag) => new FakeNode('<' + tag + '>', tag),
};
global.window = global;

// -----------------------------------------------------------------------------
// Build a populated state with a fixture data shape
// -----------------------------------------------------------------------------

function buildState() {
  const n = 16;
  const windows = {
    start_bp: new Array(n).fill(0).map((_, i) => i * 100_000),
    end_bp:   new Array(n).fill(0).map((_, i) => (i + 1) * 100_000 - 1),
    pve1:     new Array(n).fill(0).map((_, i) => (i >= 5 && i <= 10) ? 1.0 : 0),
  };
  return {
    candidate: null,
    candidateList: [
      { id: 'cand_A', chrom: 'LG28', start_bp: 500_000, end_bp: 1_100_000 },
      { id: 'cand_B', chrom: 'LG14', start_bp: 200_000, end_bp: 700_000,
        boundary_left: { zone_start_bp: 100, zone_end_bp: 200, score: 0.7,
                         support: ['x'], support_class: 'weak', source: 'manual',
                         sv_anchors_in_zone: [], notes: '', set_at: '2025', set_by: 'sm' } },
    ],
    data: { windows, n_bp: 1_600_000 },
  };
}

// -----------------------------------------------------------------------------
group('populateCandidateSelect');
const s1 = buildState();
ensureBoundariesState(s1);
UI.populateCandidateSelect(s1);
const sel = _ensure('bndCandSelect');
check('select: opening placeholder present', sel.innerHTML.includes('— select candidate —'));
check('select: cand_A in options',           sel.innerHTML.includes('cand_A'));
check('select: cand_B with ✓ marker',         sel.innerHTML.includes('cand_B ·') && sel.innerHTML.includes('✓'));
// cand_A's option label is "cand_A · X.YZ Mb" with no ✓ — match the
// option tag (no nested options) to isolate it.
const candAOption = sel.innerHTML.match(/<option value="cand_A"[^>]*>([^<]*)</);
check('select: cand_A option label has no ✓',
      candAOption && !candAOption[1].includes('✓'));

// -----------------------------------------------------------------------------
group('updateRadiusButtons');
const s2 = buildState();
const bs2 = ensureBoundariesState(s2);
bs2.scan_radius_bp = 10000;
UI.updateRadiusButtons(s2);
const radActive = _radiusBtns.find(b => b._attrs['data-radius'] === '10000');
const radInactive = _radiusBtns.find(b => b._attrs['data-radius'] === '1000');
check('radius: 10000 marked .active',  radActive.classList.contains('active'));
check('radius: 1000 not .active',      !radInactive.classList.contains('active'));

// -----------------------------------------------------------------------------
group('updateSaveButton');
const s3 = buildState();
const bs3 = ensureBoundariesState(s3);
UI.updateSaveButton(s3);
const saveBtn = _ensure('bndSaveBtn');
check('save: disabled with no active cand',  saveBtn.disabled === true);
check('save: no .dirty class initially',     !saveBtn.classList.contains('dirty'));

bs3.staging.cand_id = 'cand_A';
bs3.staging.dirty = true;
UI.updateSaveButton(s3);
check('save: enabled when staging has cand_id', saveBtn.disabled === false);
check('save: .dirty when staging.dirty',         saveBtn.classList.contains('dirty'));

bs3.staging.dirty = false;
UI.updateSaveButton(s3);
check('save: .dirty cleared when staging clean', !saveBtn.classList.contains('dirty'));

// -----------------------------------------------------------------------------
group('updateStatusSelect');
const s4 = buildState();
const bs4 = ensureBoundariesState(s4);
bs4.staging.breakpoint_status = 'SV_supported';
UI.updateStatusSelect(s4);
const statSel = _ensure('bndStatusSel');
check('status: synced to SV_supported',  statSel.value === 'SV_supported');

// -----------------------------------------------------------------------------
group('selectCandidate');
const s5 = buildState();
UI.selectCandidate(s5, 'cand_B');
const bs5 = ensureBoundariesState(s5);
check('select: active_cand_id set',        bs5.active_cand_id === 'cand_B');
check('select: staging.cand_id matches',   bs5.staging.cand_id === 'cand_B');
check('select: existing boundary staged',  bs5.staging.boundary_left
                                            && bs5.staging.boundary_left.zone_start_bp === 100);
check('select: dirty cleared',             bs5.staging.dirty === false);

UI.selectCandidate(s5, 'cand_A');
check('select cand_A: no existing boundary → null staging',
      bs5.staging.boundary_left === null);

UI.selectCandidate(s5, null);
check('select null: active cleared',       bs5.active_cand_id === null);

// -----------------------------------------------------------------------------
group('bndReset');
const s6 = buildState();
UI.selectCandidate(s6, 'cand_B');
const bs6 = ensureBoundariesState(s6);
check('pre-reset: boundary_left present',  !!bs6.staging.boundary_left);
UI.bndReset(s6);
check('reset: boundary_left = null',       bs6.staging.boundary_left === null);
check('reset: boundary_right = null',      bs6.staging.boundary_right === null);
check('reset: dirty = true',               bs6.staging.dirty === true);

// Reset when nothing to clear → still no-throw, dirty stays
const s6b = buildState();
const bs6b = ensureBoundariesState(s6b);
bs6b.staging.dirty = false;
UI.bndReset(s6b);
check('reset no-op: dirty stays false',    bs6b.staging.dirty === false);

// -----------------------------------------------------------------------------
group('bndOverrideLeft / Right');
const s7 = buildState();
UI.selectCandidate(s7, 'cand_A');
const bs7 = ensureBoundariesState(s7);
UI.bndOverrideLeft(s7, 5, { now: new Date('2026-05-12T10:00:00Z') });
check('override left: record built',       !!bs7.staging.boundary_left);
check('override left: source = manual',    bs7.staging.boundary_left.source === 'manual');
check('override left: support = []',       bs7.staging.boundary_left.support.length === 0);
check('override left: dirty = true',       bs7.staging.dirty === true);
check('override left: set_at uses passed now',
      bs7.staging.boundary_left.set_at === '2026-05-12T10:00:00.000Z');

UI.bndOverrideRight(s7, 10);
check('override right: record built',      !!bs7.staging.boundary_right);
check('override right: source = manual',   bs7.staging.boundary_right.source === 'manual');

// -----------------------------------------------------------------------------
group('bndSave');
const s8 = buildState();
UI.selectCandidate(s8, 'cand_A');
UI.bndOverrideLeft(s8, 5);
UI.bndOverrideRight(s8, 10);
let onSaveFired = null;
const ok = UI.bndSave(s8, { onSave: (st, cand) => { onSaveFired = cand.id; } });
check('save: returns true',                ok === true);
check('save: onSave fired with candidate', onSaveFired === 'cand_A');
const candA = s8.candidateList.find(c => c.id === 'cand_A');
check('save: candidate.boundary_left set', !!candA.boundary_left);
check('save: candidate.boundary_right set', !!candA.boundary_right);
const bs8 = ensureBoundariesState(s8);
check('save: dirty cleared after save',    bs8.staging.dirty === false);

// Save fails when no active cand
const s8b = buildState();
const okEmpty = UI.bndSave(s8b);
check('save: returns false w/o active cand', okEmpty === false);

// -----------------------------------------------------------------------------
group('bndAutoPropose');
const s9 = buildState();
UI.selectCandidate(s9, 'cand_A');
const result = UI.bndAutoPropose(s9);
check('autoPropose: result returned',      !!result);
check('autoPropose: scanRange computed',   !!result.scanRange);
check('autoPropose: trackScores has pca_drop',
      !!result.trackScores.tracks.pca_drop);
check('autoPropose: edges include left',   !!result.edges.left);
check('autoPropose: staging.boundary_left set',
      !!ensureBoundariesState(s9).staging.boundary_left);
check('autoPropose: source = auto on staged record',
      ensureBoundariesState(s9).staging.boundary_left.source === 'auto');
check('autoPropose: staging.dirty = true', ensureBoundariesState(s9).staging.dirty === true);

// AutoPropose w/o active candidate → null
const s9b = buildState();
const noActive = UI.bndAutoPropose(s9b);
check('autoPropose: null w/o active',      noActive === null);

// AutoPropose with missing windows → null
const s9c = buildState();
s9c.data.windows = null;
UI.selectCandidate(s9c, 'cand_A');
const noWin = UI.bndAutoPropose(s9c);
check('autoPropose: null w/o windows',     noWin === null);

// -----------------------------------------------------------------------------
group('refreshBoundariesUi orchestrator');
const sR = buildState();
const bsR = ensureBoundariesState(sR);
bsR.scan_radius_bp = 1500000;
UI.selectCandidate(sR, 'cand_A');
UI.refreshBoundariesUi(sR);
check('refresh: candidate options populated',
      _ensure('bndCandSelect').innerHTML.includes('cand_A'));
check('refresh: radius 1500000 active',
      _radiusBtns.find(b => b._attrs['data-radius'] === '1500000').classList.contains('active'));
check('refresh: info shows candidate range',
      _ensure('bndInfo').textContent.includes('cand_A'));

UI.selectCandidate(sR, null);
UI.refreshBoundariesUi(sR);
check('refresh: info shows "No candidate selected"',
      _ensure('bndInfo').textContent === 'No candidate selected.');

// -----------------------------------------------------------------------------
group('wireBoundariesToolbar: events');
const sW = buildState();
let changeCalls = 0;
let cursorIdx = 5;
UI.wireBoundariesToolbar(sW, {
  onChange: () => { changeCalls++; },
  getCursorWindowIdx: () => cursorIdx,
});

// Candidate change
const candSel = _ensure('bndCandSelect');
candSel.value = 'cand_A';
candSel.fire('change', { target: candSel });
check('wire: candidate change → active set',
      ensureBoundariesState(sW).active_cand_id === 'cand_A');
check('wire: onChange fired',  changeCalls === 1);

// Radius click — fire on group with target = radius button
const radBtn1000 = _radiusBtns.find(b => b._attrs['data-radius'] === '1000');
_radiusGroup.fire('click', { target: radBtn1000 });
check('wire: radius click → scan_radius_bp updated',
      ensureBoundariesState(sW).scan_radius_bp === 1000);

// Restore wider radius so the auto-propose pipeline can find edges
// inside the fixture's window range (transitions at idx 4→5 and 10→11).
ensureBoundariesState(sW).scan_radius_bp = 1_500_000;
// Auto-propose button
const autoBtn = _ensure('bndAutoProposeBtn');
autoBtn.fire('click', {});
check('wire: auto button populates staging',
      !!ensureBoundariesState(sW).staging.boundary_left
      || !!ensureBoundariesState(sW).staging.boundary_right);

// Override buttons read cursor
const lBtn = _ensure('bndOverrideLBtn');
lBtn.fire('click', {});
check('wire: override left applies at cursor wIdx',
      !!ensureBoundariesState(sW).staging.boundary_left);

// Override w/o cursor returns no-op (cursorIdx = null)
cursorIdx = null;
ensureBoundariesState(sW).staging.boundary_left = null;
ensureBoundariesState(sW).staging.dirty = false;
lBtn.fire('click', {});
check('wire: override no-op without cursor',
      ensureBoundariesState(sW).staging.boundary_left === null);

// Reset button
cursorIdx = 5;
ensureBoundariesState(sW).staging.boundary_left = {
  zone_start_bp: 0, zone_end_bp: 100, score: 0.5, support: [],
  support_class: 'weak', source: 'manual', sv_anchors_in_zone: [],
  notes: '', set_at: '2025', set_by: 'sm',
};
const resetBtn = _ensure('bndResetBtn');
resetBtn.fire('click', {});
check('wire: reset clears boundary_left',
      ensureBoundariesState(sW).staging.boundary_left === null);

// Save button
UI.bndOverrideLeft(sW, 5);
let onSaveGotId = null;
// Re-wire with onSave
UI.wireBoundariesToolbar(sW, {
  getCursorWindowIdx: () => cursorIdx,
  onSave: (_, c) => { onSaveGotId = c.id; },
});
const saveBtn2 = _ensure('bndSaveBtn');
saveBtn2.fire('click', {});
check('wire: save fires onSave',  onSaveGotId === 'cand_A');

// Status select
const statSel2 = _ensure('bndStatusSel');
statSel2.value = 'SV_supported';
statSel2.fire('change', { target: statSel2 });
check('wire: status change mutates staging',
      ensureBoundariesState(sW).staging.breakpoint_status === 'SV_supported');
check('wire: status change marks dirty',
      ensureBoundariesState(sW).staging.dirty === true);

// Idempotent re-wire
UI.wireBoundariesToolbar(sW, {});
check('rewire: candidate sel single handler',
      (candSel._listeners.change || []).length === 1);

// -----------------------------------------------------------------------------
group('teardownBoundariesToolbar');
UI.teardownBoundariesToolbar();
check('teardown: cand select handler removed',
      (candSel._listeners.change || []).length === 0);
check('teardown: auto button handler removed',
      (autoBtn._listeners.click || []).length === 0);

let teardown2OK = true;
try { UI.teardownBoundariesToolbar(); } catch (_) { teardown2OK = false; }
check('teardown: idempotent', teardown2OK);

// -----------------------------------------------------------------------------
group('renderBoundaryTracksHtml + renderBoundaryTracks');
// Empty state
const sT0 = buildState();
const htmlEmpty = UI.renderBoundaryTracksHtml(sT0);
check('tracks empty: shows "No candidate selected"',
      htmlEmpty.includes('No candidate selected'));

// Candidate but no window grid → window grid empty message
const sT1 = buildState();
UI.selectCandidate(sT1, 'cand_A');
sT1.data.windows = null;
const htmlNoWin = UI.renderBoundaryTracksHtml(sT1);
check('tracks: missing windows → message',
      htmlNoWin.includes('No window grid loaded'));

// Populated state — fixture has pve1 transitions, so present tracks > 0
const sT2 = buildState();
UI.selectCandidate(sT2, 'cand_A');
const html2 = UI.renderBoundaryTracksHtml(sT2, { wrapWidth: 600 });
check('tracks: contains pca_drop track',     html2.includes('pca_drop'));
check('tracks: includes weight in label',    html2.includes('w='));
check('tracks: combined row rendered',       html2.includes('combined'));
check('tracks: cand anchor overlay present', html2.includes('bnd-anchor'));
check('tracks: SVG polyline rendered',       html2.includes('<polyline'));

// With staging boundary set → zone overlay
const bsT = ensureBoundariesState(sT2);
bsT.staging.boundary_left = {
  zone_start_bp: 500_000, zone_end_bp: 700_000,
  score: 0.7, support: ['pca_drop'], support_class: 'weak',
  source: 'auto', sv_anchors_in_zone: [], notes: '',
  set_at: '2025', set_by: 'scrubber_auto',
};
const htmlZone = UI.renderBoundaryTracksHtml(sT2, { wrapWidth: 600 });
check('tracks: zone overlay rendered',       htmlZone.includes('bnd-zone'));
check('tracks: zone label shows L: weak',    htmlZone.includes('L: weak'));

// Cursor marker
sT2.cur = 7;
const htmlCur = UI.renderBoundaryTracksHtml(sT2, { wrapWidth: 600 });
check('tracks: cursor marker present',       htmlCur.includes('bnd-cur'));

// HTML escape
const sT3 = buildState();
sT3.candidateList.push({ id: 'cand_<bad>', chrom: '<x>', start_bp: 0, end_bp: 1, K: 1 });
UI.selectCandidate(sT3, 'cand_<bad>');
const htmlEsc = UI.renderBoundaryTracksHtml(sT3);
check('tracks: escapes < in id',  !htmlEsc.includes('<bad>') || htmlEsc.includes('&lt;bad&gt;'));

// renderBoundaryTracks DOM mutator
const sT4 = buildState();
UI.selectCandidate(sT4, 'cand_A');
UI.renderBoundaryTracks(sT4);
check('renderBoundaryTracks: #bndTracks populated',
      _ensure('bndTracks').innerHTML.length > 0);

// -----------------------------------------------------------------------------
group('Headless tolerance');
const savedDoc = global.document;
delete global.document;
let headlessOK = true;
try {
  UI.refreshBoundariesUi({});
  UI.wireBoundariesToolbar({});
  UI.teardownBoundariesToolbar();
  UI.populateCandidateSelect({});
  UI.updateRadiusButtons({});
  UI.updateSaveButton({});
} catch (_) { headlessOK = false; }
check('headless: silent without document', headlessOK);
global.document = savedDoc;

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
