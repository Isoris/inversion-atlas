// shared/band_tracking/anchor_track_cache.js
// =====================================================================
// Memoised V(anchor_w, w) and H_off(anchor_w, w) accessors. Wraps
// shared/band_tracking/anchor_signals.computeAnchorTracksRange so
// callers other than discoverSeedFromAnchor can consult the same
// anchor-relative concordance signal without recomputing.
//
// Cache key: anchor_w (the labelling that defines the V scale) +
// chr_s_window + chr_e_window. For a given chromosome scan we
// typically have a single (s, e) range; the cache then memoises
// per anchor.
//
// API:
//   createAnchorTrackCache({ getLabels, getK, n_windows? })
//     → { getV, getHoff, getKWindow, getTracks, clear, stats }
//
// All compute is pure. No DOM, no fetch.
// =====================================================================

import { computeAnchorTracksRange, captureAnchor } from './anchor_signals.js';

/**
 * @param {Object} args
 *   getLabels:   (w:number) => Int8Array|null
 *   getK:        (w:number) => number
 *   n_windows?:  number   (used to compute default ranges; falls back
 *                          to computing the range from the explicit
 *                          (s, e) args of each getV call when omitted)
 *   chr_s_window?, chr_e_window?:  default chromosome range
 * @returns {Object}    cache API
 */
export function createAnchorTrackCache(args) {
  const a = args || {};
  if (typeof a.getLabels !== 'function' || typeof a.getK !== 'function') {
    return _disabledCache();
  }
  const default_s = Number.isFinite(a.chr_s_window) ? (a.chr_s_window | 0) : 0;
  const default_e = Number.isFinite(a.chr_e_window) ? (a.chr_e_window | 0)
                  : (Number.isFinite(a.n_windows) ? (a.n_windows - 1) : null);
  if (default_e == null) return _disabledCache();
  const tracksByAnchor = new Map();
  let nComputed = 0, nHits = 0;

  function _key(anchor_w, s_window, e_window) {
    return anchor_w + '|' + s_window + '|' + e_window;
  }

  function _ensure(anchor_w, s_window, e_window) {
    const key = _key(anchor_w, s_window, e_window);
    if (tracksByAnchor.has(key)) {
      nHits++;
      return tracksByAnchor.get(key);
    }
    const labels = a.getLabels(anchor_w);
    const K_a    = a.getK(anchor_w);
    if (!labels || K_a < 2) {
      // Cache the disabled state so we don't keep retrying.
      const empty = { v_track: null, h_off_track: null, k_w_track: null,
                      n_used_track: null, s_window, e_window, disabled: true };
      tracksByAnchor.set(key, empty);
      return empty;
    }
    const anchor = captureAnchor({ win_idx: anchor_w, labels, K: K_a });
    const tracks = computeAnchorTracksRange({
      anchor_labels: anchor.labels,
      K_a:           anchor.K,
      getLabels:     a.getLabels,
      getK:          a.getK,
      s_window, e_window,
    });
    tracksByAnchor.set(key, tracks);
    nComputed++;
    return tracks;
  }

  function getV(anchor_w, w, opts) {
    const o = opts || {};
    const s = Number.isFinite(o.s_window) ? (o.s_window | 0) : default_s;
    const e = Number.isFinite(o.e_window) ? (o.e_window | 0) : default_e;
    if (w < s || w > e) return NaN;
    const tracks = _ensure(anchor_w, s, e);
    if (tracks.disabled || !tracks.v_track) return NaN;
    return tracks.v_track[w - s];
  }

  function getHoff(anchor_w, w, opts) {
    const o = opts || {};
    const s = Number.isFinite(o.s_window) ? (o.s_window | 0) : default_s;
    const e = Number.isFinite(o.e_window) ? (o.e_window | 0) : default_e;
    if (w < s || w > e) return NaN;
    const tracks = _ensure(anchor_w, s, e);
    if (tracks.disabled || !tracks.h_off_track) return NaN;
    return tracks.h_off_track[w - s];
  }

  function getKWindow(anchor_w, w, opts) {
    const o = opts || {};
    const s = Number.isFinite(o.s_window) ? (o.s_window | 0) : default_s;
    const e = Number.isFinite(o.e_window) ? (o.e_window | 0) : default_e;
    if (w < s || w > e) return 0;
    const tracks = _ensure(anchor_w, s, e);
    if (tracks.disabled || !tracks.k_w_track) return 0;
    return tracks.k_w_track[w - s];
  }

  function getTracks(anchor_w, opts) {
    const o = opts || {};
    const s = Number.isFinite(o.s_window) ? (o.s_window | 0) : default_s;
    const e = Number.isFinite(o.e_window) ? (o.e_window | 0) : default_e;
    return _ensure(anchor_w, s, e);
  }

  function clear() {
    tracksByAnchor.clear();
    nComputed = 0; nHits = 0;
  }

  function stats() {
    return {
      n_entries:  tracksByAnchor.size,
      n_computed: nComputed,
      n_hits:     nHits,
      default_s_window: default_s,
      default_e_window: default_e,
    };
  }

  return { getV, getHoff, getKWindow, getTracks, clear, stats };
}

function _disabledCache() {
  return {
    getV()        { return NaN; },
    getHoff()     { return NaN; },
    getKWindow()  { return 0;   },
    getTracks()   { return { v_track: null, h_off_track: null, disabled: true }; },
    clear()       { /* no-op */ },
    stats()       { return { n_entries: 0, n_computed: 0, n_hits: 0, disabled: true }; },
  };
}
