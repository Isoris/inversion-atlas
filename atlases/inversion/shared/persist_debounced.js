// shared/persist_debounced.js
// =====================================================================
// Debounced localStorage writer — coalesces rapid writes per key into a
// single setItem call, so a UI gesture that toggles 5 settings in one
// frame produces one storage write per setting instead of one per
// individual toggle.
//
// Motivation (2026-05-21 perf audit, Tier-S finding #2):
// sidebar.js alone contains 27 synchronous localStorage.setItem call
// sites, each one a main-thread blocking write. K-cycle / mode-toggle
// gestures fire 5+ in a single frame. Cumulative cost is ~30-50ms of
// blocked render per gesture on the affected scrubber pages.
//
// Semantics:
//   persistDebounced(key, value, ms?)
//     - Coalesces multiple calls on the same key into one setItem; last
//       value wins.
//     - Different keys are debounced independently.
//     - Values are stringified at call time (JSON.stringify for non-
//       strings) so the caller can freely mutate the source object
//       after the call.
//     - try/catch wraps the actual setItem so quota errors silently
//       drop (matches the existing `try { ... } catch (_) {}` pattern
//       used at every call site this helper replaces).
//
// Flush triggers:
//   - The scheduled timer fires after `ms` milliseconds (default 300).
//   - flushPersistNow() flushes all pending writes immediately.
//   - `pagehide`, `beforeunload`, and `visibilitychange→hidden` all
//     flush automatically — closing the tab never loses a pending
//     write.
//
// READS:
// Reads should still go through localStorage.getItem(). Within a
// debounce window a read returns the stale (pre-coalesce) value.
// This is fine for the call sites this helper targets — they all
// hold the live value in JS state and only persist for next-session
// restore. None of them read-after-write within the same gesture.
// If a future caller needs read-your-write semantics, add a
// getPersisted(key) helper that checks _PENDING_VALUES first.
// =====================================================================

const _TIMERS         = new Map();   // key → timeoutId
const _PENDING_VALUES = new Map();   // key → string (latest pending value)

/** Debounce-write a value to localStorage under `key`.
 *  Non-string values are JSON.stringified at call time.
 *  Multiple calls within `ms` coalesce: only the LAST value is written.
 *  Default `ms` is 300 (covers the 16-50ms rapid-click window with
 *  margin without making page-close persistence feel laggy). */
export function persistDebounced(key, value, ms = 300) {
  const s = (typeof value === 'string') ? value : JSON.stringify(value);
  _PENDING_VALUES.set(key, s);
  const prev = _TIMERS.get(key);
  if (prev !== undefined) {
    if (typeof clearTimeout === 'function') clearTimeout(prev);
  }
  if (typeof setTimeout !== 'function') {
    // Non-browser env (e.g. Node smoke tests) — write through.
    _flushKey(key);
    return;
  }
  _TIMERS.set(key, setTimeout(() => _flushKey(key), ms));
}

/** Flush ALL pending writes synchronously. Called on page hide / unload
 *  to guarantee the latest values survive a tab close. Also exported so
 *  callers can force-persist before navigation or an explicit save. */
export function flushPersistNow() {
  for (const key of [..._TIMERS.keys()]) {
    const t = _TIMERS.get(key);
    if (t !== undefined && typeof clearTimeout === 'function') clearTimeout(t);
    _flushKey(key);
  }
}

/** Read the currently-pending (not-yet-flushed) value for `key`, or
 *  null when nothing is pending. Test-only helper; production code
 *  should use localStorage.getItem() directly. */
export function _pendingValueForTesting(key) {
  return _PENDING_VALUES.has(key) ? _PENDING_VALUES.get(key) : null;
}

function _flushKey(key) {
  const v = _PENDING_VALUES.get(key);
  _TIMERS.delete(key);
  _PENDING_VALUES.delete(key);
  if (v === undefined) return;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, v);
  } catch (_) { /* quota / disabled / SecurityError → drop silently */ }
}

// Auto-flush on page hide so a tab close doesn't drop pending writes.
// `pagehide` is the modern equivalent of `unload` (fires on bfcache too);
// `beforeunload` keeps Safari happy; `visibilitychange→hidden` is the
// only reliable hook on iOS Safari where pagehide is unreliable.
if (typeof window !== 'undefined') {
  try {
    window.addEventListener('pagehide',     flushPersistNow);
    window.addEventListener('beforeunload', flushPersistNow);
  } catch (_) {}
}
if (typeof document !== 'undefined') {
  try {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushPersistNow();
    });
  } catch (_) {}
}
