// tests/test_shared_band_tracking_anchor_track_cache.js
//
// Memoised V(anchor_w, w) / H_off(anchor_w, w) cache. Verifies the
// math matches computeAnchorTracksRange (it should — the cache wraps
// that helper) and that REGIME_END classification fires for windows
// where V drops below the moderate threshold.

import { createAnchorTrackCache }
  from '../atlases/inversion/shared/band_tracking/anchor_track_cache.js';
import {
  computeAnchorTracksRange,
  captureAnchor,
} from '../atlases/inversion/shared/band_tracking/anchor_signals.js';
import {
  classifyWindow,
  WINDOW_CLASS,
} from '../atlases/inversion/shared/band_tracking/window_classification.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
// Test chromosome: 10 windows of 8 samples. Labels:
//   anchor at w=4 has perfect K=2 split [0,0,0,0,1,1,1,1]
//   w=3,5 identical to anchor → V should be ~1.0 (INTERIOR territory)
//   w=2,6 also identical          → ditto
//   w=0,1,7,8,9 randomised      → V should drop → REGIME_END territory
// =====================================================================

const SAMPLES_PER_WINDOW = 8;
const N_WINDOWS = 10;
const ANCHOR_W = 4;

const _identical   = [0, 0, 0, 0, 1, 1, 1, 1];
const _flipped     = [1, 1, 1, 1, 0, 0, 0, 0]; // same partition, swapped IDs → V still 1.0
const _broken_lo   = [1, 0, 1, 0, 1, 0, 1, 0]; // random → V should drop sharply
const _broken_hi   = [0, 1, 0, 1, 0, 1, 0, 1]; // also broken

const labelsByWindow = new Map();
labelsByWindow.set(0, Int8Array.from(_broken_lo));
labelsByWindow.set(1, Int8Array.from(_broken_lo));
labelsByWindow.set(2, Int8Array.from(_identical));
labelsByWindow.set(3, Int8Array.from(_identical));
labelsByWindow.set(4, Int8Array.from(_identical));
labelsByWindow.set(5, Int8Array.from(_flipped));
labelsByWindow.set(6, Int8Array.from(_identical));
labelsByWindow.set(7, Int8Array.from(_broken_hi));
labelsByWindow.set(8, Int8Array.from(_broken_hi));
labelsByWindow.set(9, Int8Array.from(_broken_hi));

const getLabels = (w) => labelsByWindow.get(w) || null;
const getK      = (w) => labelsByWindow.has(w) ? 2 : 0;
const getBandQuality = (_w) => 0.9;

// =====================================================================
group('createAnchorTrackCache — basic API');
{
  const cache = createAnchorTrackCache({
    getLabels, getK,
    chr_s_window: 0,
    chr_e_window: N_WINDOWS - 1,
  });
  check('cache exposes getV',                   typeof cache.getV === 'function');
  check('cache exposes getHoff',                typeof cache.getHoff === 'function');
  check('cache exposes getKWindow',             typeof cache.getKWindow === 'function');
  check('cache exposes getTracks',              typeof cache.getTracks === 'function');
  check('cache exposes clear',                  typeof cache.clear === 'function');
  check('cache exposes stats',                  typeof cache.stats === 'function');
}

// =====================================================================
group('cache — values match computeAnchorTracksRange directly');
{
  const cache = createAnchorTrackCache({
    getLabels, getK,
    chr_s_window: 0, chr_e_window: N_WINDOWS - 1,
  });
  // Compute the reference directly.
  const anchor = captureAnchor({
    win_idx: ANCHOR_W, labels: labelsByWindow.get(ANCHOR_W), K: 2,
  });
  const ref = computeAnchorTracksRange({
    anchor_labels: anchor.labels, K_a: anchor.K,
    getLabels, getK, s_window: 0, e_window: N_WINDOWS - 1,
  });
  let allMatch = true;
  for (let w = 0; w < N_WINDOWS; w++) {
    const cachedV = cache.getV(ANCHOR_W, w);
    const refV    = ref.v_track[w];
    const a = Number.isFinite(cachedV) ? cachedV : null;
    const b = Number.isFinite(refV)    ? refV    : null;
    if (a !== b && Math.abs((a || 0) - (b || 0)) > 1e-9) allMatch = false;
  }
  check('getV matches computeAnchorTracksRange at every window',
        allMatch);
  // Same for H_off.
  let hoffAllMatch = true;
  for (let w = 0; w < N_WINDOWS; w++) {
    const a = cache.getHoff(ANCHOR_W, w);
    const b = ref.h_off_track[w];
    const aN = Number.isFinite(a) ? a : null;
    const bN = Number.isFinite(b) ? b : null;
    if (aN !== bN && Math.abs((aN || 0) - (bN || 0)) > 1e-9) hoffAllMatch = false;
  }
  check('getHoff matches computeAnchorTracksRange at every window',
        hoffAllMatch);
}

// =====================================================================
group('cache — V ≈ 1.0 at identical windows, drops at randomised');
{
  const cache = createAnchorTrackCache({
    getLabels, getK,
    chr_s_window: 0, chr_e_window: N_WINDOWS - 1,
  });
  const vAnchor   = cache.getV(ANCHOR_W, ANCHOR_W);
  const vIdentical= cache.getV(ANCHOR_W, 3);
  const vFlipped  = cache.getV(ANCHOR_W, 5);
  const vBroken   = cache.getV(ANCHOR_W, 0);
  check('V(anchor) = 1.0',                       Math.abs(vAnchor - 1.0) < 1e-6);
  check('V(identical neighbour) = 1.0',          Math.abs(vIdentical - 1.0) < 1e-6);
  check('V(flipped-id neighbour) = 1.0 (same partition, relabelled)',
        Math.abs(vFlipped - 1.0) < 1e-6);
  check('V(broken-randomised) drops below moderate',
        vBroken < 0.7);
}

// =====================================================================
group('cache — REGIME_END fires for low-V windows');
{
  const cache = createAnchorTrackCache({
    getLabels, getK,
    chr_s_window: 0, chr_e_window: N_WINDOWS - 1,
  });
  // Verify REGIME_END classification at w=0 (broken_lo, V near 0).
  const cls = classifyWindow({
    v_to_anchor:  cache.getV(ANCHOR_W, 0),
    h_off:        cache.getHoff(ANCHOR_W, 0),
    band_quality: getBandQuality(0),
  });
  check('w=0 (broken) classifies as REGIME_END',
        cls === WINDOW_CLASS.REGIME_END);
  // Verify INTERIOR at the anchor window.
  const clsAnchor = classifyWindow({
    v_to_anchor:  cache.getV(ANCHOR_W, ANCHOR_W),
    h_off:        cache.getHoff(ANCHOR_W, ANCHOR_W),
    band_quality: getBandQuality(ANCHOR_W),
  });
  check('w=anchor (V=1.0) classifies as INTERIOR',
        clsAnchor === WINDOW_CLASS.INTERIOR);
  // Verify UNRELIABLE when band_quality is low.
  const clsBad = classifyWindow({
    v_to_anchor:  cache.getV(ANCHOR_W, ANCHOR_W),
    h_off:        cache.getHoff(ANCHOR_W, ANCHOR_W),
    band_quality: 0.0,
  });
  check('low band_quality forces UNRELIABLE',
        clsBad === WINDOW_CLASS.UNRELIABLE);
}

// =====================================================================
group('cache — memoisation');
{
  const cache = createAnchorTrackCache({
    getLabels, getK,
    chr_s_window: 0, chr_e_window: N_WINDOWS - 1,
  });
  // First call: compute.
  cache.getV(ANCHOR_W, 3);
  let s = cache.stats();
  check('first call → n_computed = 1',          s.n_computed === 1);
  check('first call → n_hits = 0',              s.n_hits === 0);
  // Repeated calls in the same range: hit.
  cache.getV(ANCHOR_W, 4);
  cache.getV(ANCHOR_W, 5);
  cache.getHoff(ANCHOR_W, 6);
  cache.getKWindow(ANCHOR_W, 7);
  s = cache.stats();
  check('repeat queries → n_hits grows',        s.n_hits >= 4);
  check('repeat queries → n_computed unchanged', s.n_computed === 1);
  // Different anchor → new compute.
  cache.getV(3, 3);
  s = cache.stats();
  check('new anchor → n_computed grows',        s.n_computed === 2);
  // clear() resets.
  cache.clear();
  s = cache.stats();
  check('clear() resets n_entries',             s.n_entries === 0);
  check('clear() resets n_computed',            s.n_computed === 0);
}

// =====================================================================
group('cache — disabled paths');
{
  const cache = createAnchorTrackCache({});  // no accessors
  check('disabled: getV returns NaN',           Number.isNaN(cache.getV(0, 0)));
  check('disabled: getHoff returns NaN',        Number.isNaN(cache.getHoff(0, 0)));
  check('disabled: stats reports disabled',     cache.stats().disabled === true);
  // No n_windows + no chr_e_window: also disabled.
  const cache2 = createAnchorTrackCache({ getLabels, getK });
  check('no range info → disabled',             cache2.stats().disabled === true);
}

// =====================================================================
group('cache — out-of-range query returns NaN');
{
  const cache = createAnchorTrackCache({
    getLabels, getK, chr_s_window: 0, chr_e_window: N_WINDOWS - 1,
  });
  check('w below range → NaN',                  Number.isNaN(cache.getV(ANCHOR_W, -1)));
  check('w above range → NaN',                  Number.isNaN(cache.getV(ANCHOR_W, 99)));
}

// =====================================================================
group('cache — bad anchor (no labels / K<2) caches the empty state');
{
  const cache = createAnchorTrackCache({
    getLabels: (_w) => null, getK: (_w) => 0,
    chr_s_window: 0, chr_e_window: N_WINDOWS - 1,
  });
  check('bad anchor: getV returns NaN',         Number.isNaN(cache.getV(0, 0)));
  // Repeated calls don't trigger recomputation.
  cache.getV(0, 0); cache.getV(0, 0);
  const s = cache.stats();
  check('bad anchor: cached + memoised',        s.n_entries === 1 && s.n_computed === 0);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
