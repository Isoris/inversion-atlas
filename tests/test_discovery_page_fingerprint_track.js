// tests/test_discovery_page_fingerprint_track.js
//
// Unit coverage for pages/discovery/page_fingerprint_track — the
// HANDOFF_6 atlas-side cartridge that paints per-window regime IDs
// + switch markers. Renderer + selection are pure JS; the full
// mount/unmount lifecycle is exercised in the smoke (DOM polyfill).

import * as page from '../atlases/inversion/pages/discovery/page_fingerprint_track.js';
import * as state from '../atlases/inversion/pages/discovery/page_fingerprint_track/_state.js';
import {
  paintFingerprintTrack,
  findWindowAtPixel,
  findSwitchAtPixel,
  buildRegimeColorMap,
} from '../atlases/inversion/pages/discovery/page_fingerprint_track/renderer.js';
import {
  createFingerprintSelection,
  summariseWindow,
} from '../atlases/inversion/pages/discovery/page_fingerprint_track/selection.js';
import {
  MGL_ARCHITECTURE_SCENARIOS,
  MGL_SWITCH_TYPES,
  fingerprintCandidate,
} from '../atlases/inversion/shared/mgl_fingerprinter.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('page entry — public exports');

check('mount exported',                       typeof page.mount === 'function');
check('unmount exported',                     typeof page.unmount === 'function');
check('refreshFingerprintTrack exported',     typeof page.refreshFingerprintTrack === 'function');
check('initFingerprintTrackToolbar exported', typeof page.initFingerprintTrackToolbar === 'function');

// =====================================================================
group('_state.js — live-binding pattern');

check('_pageState exported',                  '_pageState' in state);
check('_setActiveState fn',                   typeof state._setActiveState === 'function');
check('_pageState starts null',               state._pageState === null);
state._setActiveState({ marker: 'F' });
check('_setActiveState mutates',              state._pageState && state._pageState.marker === 'F');
state._setActiveState(null);
check('_setActiveState(null) clears',         state._pageState === null);

// =====================================================================
group('renderer.buildRegimeColorMap');

const cm = buildRegimeColorMap(3);
check('color map has 0..3',                   ['0','1','2','3'].every(k => typeof cm[k] === 'string'));
check('regime 0 = grey',                      cm[0].toLowerCase() === '#888888');
check('regime 1 differs from 0',              cm[1] !== cm[0]);
const cmOver = buildRegimeColorMap(2, { 1: '#aabbcc' });
check('overrides applied',                    cmOver[1] === '#aabbcc');
check('overrides leave others intact',        cmOver[0] === '#888888');
check('zero regimes still has slot 0',        typeof buildRegimeColorMap(0)[0] === 'string');

// =====================================================================
group('renderer.paintFingerprintTrack — fake canvas');

class FakeContext {
  constructor() {
    this.calls = [];
    this.fillStyle = ''; this.strokeStyle = ''; this.lineWidth = 0; this.font = '';
  }
  clearRect() { this.calls.push('clearRect'); }
  beginPath() {}
  moveTo()   {}
  lineTo()   {}
  stroke()   { this.calls.push('stroke'); }
  fillRect() { this.calls.push('fillRect'); }
  strokeRect() { this.calls.push('strokeRect'); }
  fillText() { this.calls.push('fillText'); }
}
class FakeCanvas {
  constructor() { this.width = 800; this.height = 120; this._ctx = new FakeContext(); }
  getContext() { return this._ctx; }
}

// Build a synthetic fingerprint: 6 windows with regime sequence
// [1,1,1,2,2,1] — has a return-switch in the middle.
const bands = ['A', 'B', 'C'];
function mkProfile(piA, piB, piC, dab, dac, dbc, fab, fac, fbc) {
  return {
    theta_pi_A: piA, theta_pi_B: piB, theta_pi_C: piC,
    dXY_A_B: dab, dXY_A_C: dac, dXY_B_C: dbc,
    Fst_A_B: fab, Fst_A_C: fac, Fst_B_C: fbc,
  };
}
const winProfiles = [
  mkProfile(0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.1, 0.2, 0.3),
  mkProfile(0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.1, 0.2, 0.3),
  mkProfile(0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.1, 0.2, 0.3),
  // Different rank pattern → regime 2
  mkProfile(0.03, 0.02, 0.01, 0.06, 0.05, 0.04, 0.3, 0.2, 0.1),
  mkProfile(0.03, 0.02, 0.01, 0.06, 0.05, 0.04, 0.3, 0.2, 0.1),
  mkProfile(0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.1, 0.2, 0.3),
];
const fp = fingerprintCandidate(winProfiles, bands);
check('fingerprint built',                    fp && fp.windows.length === 6);
check('fingerprint has ≥ 2 regimes',          fp.n_regimes >= 2);
check('fingerprint has a return-switch',
      fp.switches.some(s => s.type === MGL_SWITCH_TYPES.RETURN_SWITCH));
check('scenario = one_inv_with_recombinant',
      fp.scenario === MGL_ARCHITECTURE_SCENARIOS.ONE_INVERSION_WITH_RECOMBINANT);

const canvas = new FakeCanvas();
const paint = paintFingerprintTrack(canvas, fp, {});
check('paint: window_hit_regions = 6',         paint.window_hit_regions.length === 6);
check('paint: each window region has w > 0',
      paint.window_hit_regions.every(h => h.w > 0));
check('paint: each window region has h > 0',
      paint.window_hit_regions.every(h => h.h > 0));
check('paint: each region carries regime_id',
      paint.window_hit_regions.every(h => typeof h.regime_id === 'number'));
check('paint: canvas cleared',                 canvas._ctx.calls.includes('clearRect'));
check('paint: track outlined',                 canvas._ctx.calls.includes('strokeRect'));
check('paint: fillRect for every window',
      canvas._ctx.calls.filter(c => c === 'fillRect').length === 6);
check('paint: switch glyph fillText present',  canvas._ctx.calls.includes('fillText'));
// Brief switches default-hidden, but our synthetic has no brief
// switches so toggling show_brief_switches should leave the count
// equal to the non-brief switch count.
const nonBriefCount = fp.switches.filter(s => s.type !== MGL_SWITCH_TYPES.BRIEF_SWITCH).length;
check('switch hits = non-brief switches',      paint.switch_hit_regions.length === nonBriefCount);

// Empty / null inputs
const emptyPaint = paintFingerprintTrack(canvas, null);
check('null fingerprint: 0 window hits',       emptyPaint.window_hit_regions.length === 0);
check('null fingerprint: 0 switch hits',       emptyPaint.switch_hit_regions.length === 0);
const nullCanvas = paintFingerprintTrack(null, fp);
check('null canvas: 0 window hits',            nullCanvas.window_hit_regions.length === 0);
const emptyWindows = paintFingerprintTrack(canvas, { windows: [], n_regimes: 0, switches: [], scenario: 'x' });
check('empty windows: 0 window hits',          emptyWindows.window_hit_regions.length === 0);

// Brief-switch visibility toggle (build a fingerprint that has a brief switch).
// regime sequence [1,1,2,1,1] — middle [2] has length 1, < min_run_windows (2),
// so it should be BRIEF_SWITCH.
const winBrief = [
  mkProfile(0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.1, 0.2, 0.3),
  mkProfile(0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.1, 0.2, 0.3),
  mkProfile(0.03, 0.02, 0.01, 0.06, 0.05, 0.04, 0.3, 0.2, 0.1),
  mkProfile(0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.1, 0.2, 0.3),
  mkProfile(0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.1, 0.2, 0.3),
];
const fpBrief = fingerprintCandidate(winBrief, bands);
check('brief fixture has BRIEF_SWITCH',
      fpBrief.switches.some(s => s.type === MGL_SWITCH_TYPES.BRIEF_SWITCH));
const briefHidden = paintFingerprintTrack(new FakeCanvas(), fpBrief, { show_brief_switches: false });
const briefShown  = paintFingerprintTrack(new FakeCanvas(), fpBrief, { show_brief_switches: true });
check('brief hidden: fewer switch hits than shown',
      briefHidden.switch_hit_regions.length < briefShown.switch_hit_regions.length);

// =====================================================================
group('renderer.findWindowAtPixel / findSwitchAtPixel');

const winRegions = [
  { window_idx: 0, x: 10, y: 20, w: 30, h: 40, regime_id: 1 },
  { window_idx: 1, x: 40, y: 20, w: 30, h: 40, regime_id: 2 },
  { window_idx: 2, x: 70, y: 20, w: 30, h: 40, regime_id: 1 },
];
check('window hit inside cell 0',              findWindowAtPixel(winRegions, 20, 40) === 0);
check('window hit on edge of cell 1',          findWindowAtPixel(winRegions, 41, 30) === 1);
check('window miss above strip',               findWindowAtPixel(winRegions, 20, 10) === null);
check('window miss below strip',               findWindowAtPixel(winRegions, 20, 100) === null);
check('window miss right of strip',            findWindowAtPixel(winRegions, 200, 30) === null);
check('null window regions → null',            findWindowAtPixel(null, 0, 0) === null);

const swRegions = [
  { switch_idx: 0, x: 100, y: 10, r: 6, type: 'return_switch' },
  { switch_idx: 1, x: 200, y: 10, r: 6, type: 'terminal_switch' },
];
check('switch hit at center',                  findSwitchAtPixel(swRegions, 100, 10) === 0);
check('switch hit at edge',                    findSwitchAtPixel(swRegions, 205, 10) === 1);
check('switch miss',                           findSwitchAtPixel(swRegions, 0, 0) === null);
check('null switch regions → null',            findSwitchAtPixel(null, 0, 0) === null);

// =====================================================================
group('selection.createFingerprintSelection');

const sel = createFingerprintSelection();
let n = 0;
sel.subscribe(() => { n++; });

check('initial: getHoveredWindow = null',      sel.getHoveredWindow() === null);
check('initial: getHoveredSwitch = null',      sel.getHoveredSwitch() === null);
check('initial: selected is empty',            sel.getSelected().size === 0);
check('getHovered convenience returns window', sel.getHovered() === null);

sel.setHoveredWindow(2);
check('hover window notifies',                 n === 1);
check('hovered window = 2',                    sel.getHoveredWindow() === 2);
sel.setHoveredWindow(2);  // no-op
check('repeat hover does not re-notify',       n === 1);
sel.setHoveredWindow(null);
check('clear hover notifies',                  n === 2);

sel.setHoveredSwitch(1);
check('hover switch notifies',                 n === 3);
check('switch idx = 1',                        sel.getHoveredSwitch() === 1);
sel.setHoveredSwitch(null);
check('clear switch hover notifies',           n === 4);

sel.toggleSelected(3);
sel.toggleSelected(5);
check('two selected',                          sel.getSelected().size === 2);
sel.toggleSelected(3);
check('toggle removes',                        !sel.getSelected().has(3));
sel.clearSelection();
check('clearSelection empties',                sel.getSelected().size === 0);

// Non-finite inputs coerce to null / skip
sel.setHoveredWindow('abc');
check('non-numeric hover → null',              sel.getHoveredWindow() === null);
sel.toggleSelected(null);
check('toggleSelected(null) no-op',            sel.getSelected().size === 0);

const unsub = sel.subscribe(() => { n += 100; });
sel.setHoveredWindow(7);
check('multi-subscriber notifies all',         n > 100);
unsub();
const before = n;
sel.setHoveredWindow(null);
check('unsubscribed not called',               n - before < 100);

// =====================================================================
group('selection.summariseWindow');

const win = {
  idx: 4,
  regime_id: 2,
  rank_signature: { pi_rank: [1, 2, 3], dxy_rank: [3, 2, 1], fst_rank: [2, 1, 3] },
  signature_key: 'x',
};
const s = summariseWindow(win);
check('summary mentions idx 4',                s.indexOf('4') >= 0);
check('summary mentions regime 2',             s.indexOf('regime 2') >= 0);
check('summary has pi[1,2,3]',                 s.indexOf('pi[1,2,3]') >= 0);
check('summary has dxy[3,2,1]',                s.indexOf('dxy[3,2,1]') >= 0);
check('summary has fst[2,1,3]',                s.indexOf('fst[2,1,3]') >= 0);

check('null window → "—"',                     summariseWindow(null) === '—');
const noSig = { idx: 1, regime_id: 0, rank_signature: null };
check('no-signature → "no data"',              summariseWindow(noSig).indexOf('no data') >= 0);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
