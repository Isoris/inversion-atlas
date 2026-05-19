// tests/test_discovery_nested_inversion_detector.js
//
// Unit coverage for pages/discovery/nested_inversion_detector — HANDOFF_7
// atlas-side cartridge.

import * as page from '../atlases/inversion/pages/discovery/nested_inversion_detector.js';
import * as state from '../atlases/inversion/pages/discovery/nested_inversion_detector/_state.js';
import {
  paintNestedTracks,
  findBandAtPixel,
  findIntervalAtPixel,
  totalWindowCount,
  verdictColor,
  verdictLabel,
  stratumColor,
} from '../atlases/inversion/pages/discovery/nested_inversion_detector/renderer.js';
import {
  createNestedDetectorSelection,
  summariseInterval,
  candidateCountsByStratum,
} from '../atlases/inversion/pages/discovery/nested_inversion_detector/selection.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('page entry — public exports');
check('mount exported',                          typeof page.mount === 'function');
check('unmount exported',                        typeof page.unmount === 'function');
check('refreshNestedDetector exported',          typeof page.refreshNestedDetector === 'function');
check('initNestedDetectorToolbar exported',      typeof page.initNestedDetectorToolbar === 'function');

// =====================================================================
group('_state.js — live-binding');
check('_pageState exported',                     '_pageState' in state);
check('_pageState starts null',                  state._pageState === null);
state._setActiveState({ marker: 'N' });
check('_setActiveState mutates',                 state._pageState.marker === 'N');
state._setActiveState(null);
check('_setActiveState(null) clears',            state._pageState === null);

// =====================================================================
group('renderer.verdictColor / verdictLabel');
check('verdictColor: nested = red',              verdictColor('nested_detected') === '#D04545');
check('verdictColor: no_structure = green',      verdictColor('no_nested_structure') === '#2BAA50');
check('verdictColor: insufficient = grey',       verdictColor('insufficient_data') === '#888888');
check('verdictColor: unknown → grey',            verdictColor('weird') === '#888888');
check('verdictLabel: known label',
      verdictLabel('nested_detected') === 'Nested detected');
check('verdictLabel: unknown passthrough',
      verdictLabel('something_else') === 'something_else');

// =====================================================================
group('renderer.stratumColor');
check('stratumColor: HOM1',                      stratumColor('HOM1') === '#3074C8');
check('stratumColor: HET',                       stratumColor('HET') === '#D8A030');
check('stratumColor: HOM2',                      stratumColor('HOM2') === '#D04545');
check('stratumColor: unknown → grey',            stratumColor('XX') === '#888888');

// =====================================================================
group('renderer.totalWindowCount');
check('null → 0',                                totalWindowCount(null) === 0);
check('empty → 0',                               totalWindowCount({}) === 0);
check('counts max+1',
      totalWindowCount({
        per_stratum_candidates: {
          HOM1: [{ window_start: 3, window_end: 5 }],
          HET:  [{ window_idx: 7 }],
        },
        inner_intervals: [{ window_start: 0, window_end: 9 }],
      }) === 10);

// =====================================================================
group('renderer.paintNestedTracks');

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
  arc()      {}
  fill()     { this.calls.push('fill'); }
  fillText() { this.calls.push('fillText'); }
}
class FakeCanvas {
  constructor(w, h) { this.width = w || 800; this.height = h || 160; this._ctx = new FakeContext(); }
  getContext() { return this._ctx; }
}

const result = {
  verdict: 'nested_detected',
  strata_scanned: ['HOM1', 'HET'],
  per_stratum_candidates: {
    HOM1: [
      { window_start: 2, window_end: 4, silhouette: 0.6 },
      { window_start: 7, window_end: 8, silhouette: 0.5 },
    ],
    HET:  [
      { window_start: 3, window_end: 5, silhouette: 0.7 },
    ],
    HOM2: [],
  },
  inner_intervals: [
    { window_start: 2, window_end: 5, strata: ['HOM1', 'HET'], combined_silhouette: 0.65 },
  ],
};

const c1 = new FakeCanvas();
const p1 = paintNestedTracks(c1, result, { n_windows: 10 });
check('paint: 3 stratum candidates → 3 bands',
      p1.band_hit_regions.length === 3);
check('paint: 1 inner interval → 1 hit',
      p1.interval_hit_regions.length === 1);
check('paint: clearRect called',                 c1._ctx.calls.includes('clearRect'));
check('paint: fillRect for each candidate + interval',
      c1._ctx.calls.filter(c => c === 'fillRect').length >= 3 + 1);
check('paint: stratum labels rendered (fillText)',
      c1._ctx.calls.filter(c => c === 'fillText').length >= 3);
check('paint: every band hit has stratum',
      p1.band_hit_regions.every(b => b.stratum === 'HOM1' || b.stratum === 'HET' || b.stratum === 'HOM2'));

// Hover-state changes the interval stroke colour but should still
// produce the same hit regions.
const c2 = new FakeCanvas();
const p2 = paintNestedTracks(c2, result, { n_windows: 10, hovered_interval_idx: 0 });
check('paint with hover: same band count',
      p2.band_hit_regions.length === p1.band_hit_regions.length);

// Null safety.
check('null canvas → empty',
      paintNestedTracks(null, result).band_hit_regions.length === 0);
check('null result → empty',
      paintNestedTracks(new FakeCanvas(), null).band_hit_regions.length === 0);
check('zero windows → empty',
      paintNestedTracks(new FakeCanvas(),
        { per_stratum_candidates: {} }, { n_windows: 0 }).band_hit_regions.length === 0);

// =====================================================================
group('renderer.findBandAtPixel / findIntervalAtPixel');

const bandHits = p1.band_hit_regions;
const ivHits   = p1.interval_hit_regions;
const center = (h) => ({ x: h.x + h.w / 2, y: h.y + h.h / 2 });
const b0 = center(bandHits[0]);
check('band hit at center',
      findBandAtPixel(bandHits, b0.x, b0.y) === bandHits[0]);
check('band miss off-axis',
      findBandAtPixel(bandHits, -50, -50) === null);
check('null hits → null',                        findBandAtPixel(null, 0, 0) === null);

const iv0 = center(ivHits[0]);
check('interval hit at center',
      findIntervalAtPixel(ivHits, iv0.x, iv0.y) === 0);
check('interval miss off-axis',
      findIntervalAtPixel(ivHits, -50, -50) === null);
check('null hits → null',                        findIntervalAtPixel(null, 0, 0) === null);

// =====================================================================
group('selection.createNestedDetectorSelection');

const sel = createNestedDetectorSelection();
let n = 0;
sel.subscribe(() => { n++; });

check('initial: hoveredBand = null',             sel.getHoveredBand() === null);
check('initial: hoveredInterval = null',         sel.getHoveredInterval() === null);
check('initial: no selected intervals',          sel.getSelectedIntervals().size === 0);

sel.setHoveredBand({ stratum: 'HOM1', band_id: 3, candidate_idx: 0 });
check('hover band notifies',                     n === 1);
sel.setHoveredBand({ stratum: 'HOM1', band_id: 3, candidate_idx: 0 });
check('repeat hover band no-op',                 n === 1);
sel.setHoveredBand(null);
check('clear hover band notifies',               n === 2);

sel.setHoveredInterval(2);
check('hover interval notifies',                 n === 3);
sel.setHoveredInterval(null);
check('clear hover interval notifies',           n === 4);

sel.toggleSelectedInterval(0);
sel.toggleSelectedInterval(2);
check('two intervals selected',                  sel.getSelectedIntervals().size === 2);
sel.toggleSelectedInterval(0);
check('toggle removes',                          !sel.getSelectedIntervals().has(0));
sel.clearSelection();
check('clearSelection empties',                  sel.getSelectedIntervals().size === 0);
check('toggleSelectedInterval(null) no-op',
      (sel.toggleSelectedInterval(null), sel.getSelectedIntervals().size === 0));

// =====================================================================
group('selection.summariseInterval');

const sum = summariseInterval({
  window_start: 2, window_end: 5,
  start_bp: 100000, end_bp: 200000,
  strata: ['HOM1', 'HET'], combined_silhouette: 0.612,
});
check('summary has Windows row',
      sum.find(r => r.label === 'Windows').value === '2–5');
check('summary has Range row',
      sum.find(r => r.label === 'Range').value === '100000–200000 bp');
check('summary has Strata row',
      sum.find(r => r.label === 'Strata').value === 'HOM1, HET');
check('summary has Mean silhouette row',
      sum.find(r => r.label === 'Mean silhouette').value === '0.612');
check('summary null → "—"',
      summariseInterval(null)[0].value === '—');

// =====================================================================
group('selection.candidateCountsByStratum');
const counts = candidateCountsByStratum(result);
check('counts: 3 strata returned',                counts.length === 3);
check('counts: HOM1 = 2',
      counts.find(([s]) => s === 'HOM1')[1] === 2);
check('counts: HET = 1',
      counts.find(([s]) => s === 'HET')[1] === 1);
check('counts: HOM2 = 0',
      counts.find(([s]) => s === 'HOM2')[1] === 0);
check('counts: null → []',                       candidateCountsByStratum(null).length === 0);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
