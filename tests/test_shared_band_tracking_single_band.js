// tests/test_shared_band_tracking_single_band.js
//
// Unit coverage for shared/band_tracking/single_band.js — Layer 1a
// of the band-tracking pipeline.

import {
  SINGLE_BAND_DEFAULTS,
  bandMembers,
  bandJaccard,
  single_band_track_from_seed,
  single_band_score_continuity,
} from '../atlases/inversion/shared/band_tracking/single_band.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('defaults');

check('frozen',                    Object.isFrozen(SINGLE_BAND_DEFAULTS));
check('min_jaccard = 0.5',          SINGLE_BAND_DEFAULTS.min_jaccard === 0.5);

// =====================================================================
group('bandMembers');

const labels = Int8Array.of(0, 1, 0, 2, 1, 0);
const m0 = bandMembers(labels, 0);
check('band 0: 3 members',         m0.size === 3);
check('band 0 contains 0',         m0.has(0));
check('band 0 contains 5',         m0.has(5));
check('band 2: 1 member',          bandMembers(labels, 2).size === 1);
check('band 99: empty',            bandMembers(labels, 99).size === 0);
check('null labels: empty',        bandMembers(null, 0).size === 0);

// =====================================================================
group('bandJaccard');

const A = new Set([0, 1, 2, 3]);
const B = new Set([2, 3, 4, 5]);
const C = new Set([0, 1, 2, 3]);
check('identical → 1',             bandJaccard(A, C) === 1);
check('half-overlap → 2/6',
      Math.abs(bandJaccard(A, B) - 2 / 6) < 1e-9);
check('disjoint → 0',
      bandJaccard(new Set([1, 2]), new Set([3, 4])) === 0);
check('empty A → 0',               bandJaccard(new Set(), A) === 0);
check('null → 0',                  bandJaccard(null, A) === 0);

// =====================================================================
group('single_band_track_from_seed — clean track');

// 5 windows, 6 samples. Band 1 = {0, 1, 2} consistently. Band 0
// (the "other" hom) = {3, 4, 5}.
const windowLabels = {
  0: Int8Array.of(1, 1, 1, 0, 0, 0),
  1: Int8Array.of(1, 1, 1, 0, 0, 0),
  2: Int8Array.of(1, 1, 1, 0, 0, 0),
  3: Int8Array.of(1, 1, 1, 0, 0, 0),
  4: Int8Array.of(1, 1, 1, 0, 0, 0),
};
const getLabelsClean = (w) => windowLabels[w] || null;
const getK = () => 2;

const tr = single_band_track_from_seed({
  getLabels: getLabelsClean, getK,
  chr_s_window: 0, chr_e_window: 4,
  seed_w: 2, seed_k: 1,
});
check('ok=true',                   tr.ok === true);
check('5 windows',                 tr.windows.length === 5);
check('s_window = 0',              tr.s_window === 0);
check('e_window = 4',              tr.e_window === 4);
check('all band k = 1',            tr.windows.every(w => w.k === 1));
check('jaccard at seed = 1',
      tr.windows.find(w => w.w === 2).jaccard_from_prev === 1);

// =====================================================================
group('single_band_track_from_seed — fading band stops track');

// Window 3: only 1 of the 3 members remains in band 1 → Jaccard drops.
const windowsFade = {
  0: Int8Array.of(1, 1, 1, 0, 0, 0),
  1: Int8Array.of(1, 1, 1, 0, 0, 0),
  2: Int8Array.of(1, 1, 1, 0, 0, 0),
  3: Int8Array.of(1, 0, 0, 0, 0, 0),    // band 1 dropped to {0}
};
const trFade = single_band_track_from_seed({
  getLabels: (w) => windowsFade[w] || null,
  getK: () => 2,
  chr_s_window: 0, chr_e_window: 3,
  seed_w: 1, seed_k: 1,
}, { min_jaccard: 0.5 });
check('walks to window 2',         trFade.e_window === 2);
check('stops before w=3',
      trFade.windows.every(w => w.w <= 2));
check('stop_reason_right = low_jaccard',
      trFade.stop_reason_right === 'low_jaccard');

// =====================================================================
group('single_band_track_from_seed — no labels stops track');

const windowsMiss = {
  0: Int8Array.of(1, 1, 0, 0),
  1: Int8Array.of(1, 1, 0, 0),
  // window 2 missing
};
const trMiss = single_band_track_from_seed({
  getLabels: (w) => windowsMiss[w] || null,
  getK: () => 2,
  chr_s_window: 0, chr_e_window: 5,
  seed_w: 1, seed_k: 1,
});
check('stop_reason_right = no_labels',
      trMiss.stop_reason_right === 'no_labels');

// =====================================================================
group('single_band_track_from_seed — error paths');

check('missing callbacks → ok=false',
      single_band_track_from_seed({}, {}).ok === false);
check('null seed labels → ok=false',
      single_band_track_from_seed({
        getLabels: () => null, getK: () => 2,
        chr_s_window: 0, chr_e_window: 0,
        seed_w: 0, seed_k: 0,
      }).ok === false);
check('bad seed_k → ok=false',
      single_band_track_from_seed({
        getLabels: getLabelsClean, getK,
        chr_s_window: 0, chr_e_window: 4,
        seed_w: 2, seed_k: 99,
      }).ok === false);

// Empty seed band
const windowsEmpty = { 0: Int8Array.of(0, 0, 0) };
check('empty seed band → ok=false',
      single_band_track_from_seed({
        getLabels: (w) => windowsEmpty[w] || null,
        getK: () => 2,
        chr_s_window: 0, chr_e_window: 0,
        seed_w: 0, seed_k: 1,
      }).ok === false);

// =====================================================================
group('single_band_score_continuity');

const cont = single_band_score_continuity(tr);
check('n_steps = 4',               cont.n_steps === 4);
check('mean_jaccard = 1',          cont.mean_jaccard === 1);
check('min_jaccard = 1',           cont.min_jaccard === 1);

// Fading track: only the kept windows are in the track (the low-J
// step that triggered termination is excluded). All retained
// Jaccards = 1; the FADE shows up as stop_reason_right, not as a
// low intra-track Jaccard.
const contFade = single_band_score_continuity(trFade);
check('fading: kept windows still Jaccard 1',
      contFade.min_jaccard === 1);
check('fading: stop_reason_right = low_jaccard',
      trFade.stop_reason_right === 'low_jaccard');

// Step-level diagnostics
check('first step has w_from/w_to',
      cont.steps[0].w_from === 0 && cont.steps[0].w_to === 1);
check('step n_retained sensible',  cont.steps[0].n_retained === 3);

// Empty track
check('empty track → n_steps 0',
      single_band_score_continuity({ ok: false }).n_steps === 0);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
