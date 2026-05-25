// pages/discovery/local_pca_dosage/hotkeys.js
//
// Document-level keyboard shortcuts (round 4 port, 2026-05-11).
//
// Verbatim port from legacy lines 70203-70283 + 69220-69233:
//   - ←/→        : step by state.stepMode (1/5/10/N/L2). Shift = 20-window skip.
//   - n/p        : prev/next L2 or L1 depending on state.travelMode.
//   - f/b/c      : candidate-mode draft helpers (flip resolution, nudge
//                  boundary, toggle cut at cursor). All return false outside
//                  candidate mode + active draft.
//   - Space      : NO-OP outside candidate mode (legacy unbound this per
//                  OBSERVATIONS_TO_FIX turn 128c). Inside candidate mode:
//                  toggleL3DraftCutAtCursor at cursor.
//   - ↑/↓ (in candidate mode): extend/shrink L3 draft right edge.
//   - Enter / Escape (in candidate mode): commit / discard L3 draft.
//
// Listeners are attached to the `document`. The returned detach() function
// removes them; local_pca_dosage.js mount/unmount must call attach/detach so listeners
// don't accumulate across page navigations.

import { _setActiveState } from './_state.js';
import { jumpL1, jumpL2, setCur } from './events.js';

// attachHotkeys(state) -> detach()
// Wires the local_pca_dosage keyboard surface. Returns a function that removes every
// listener so unmount can call it cleanly.
export function attachHotkeys(state) {
  _setActiveState(state);

  // 2026-05-18 — release focus from <select> after the user picks an
  // option. Without this, the SELECT retains keyboard focus and any
  // subsequent ←/→ keypress cycles its options instead of stepping
  // windows. User reported: "in the per sample lines settings ... it
  // captures the cursor so when we go left and right on keyboard to
  // move in genomic coordinates ... it browses the list instead".
  // The main arrow handler below already bails on SELECT focus to
  // avoid double-firing — this listener returns focus to the body so
  // the next keypress is no longer consumed by the SELECT.
  // Idempotent via document._selectBlurAfterChangeWired.
  if (typeof document !== 'undefined' && !document._selectBlurAfterChangeWired) {
    document._selectBlurAfterChangeWired = true;
    document.addEventListener('change', (e) => {
      const t = e.target;
      if (t && t.tagName === 'SELECT' && typeof t.blur === 'function') {
        t.blur();
      }
    });
  }

  // Global ←/→ / n / p / f / b / c / Space handler. Mirrors legacy 70203.
  // Note: legacy used `window.addEventListener('keydown', ...)` here but
  // also stuck other keydown handlers on `document`. The new shell wants
  // a single detachable surface, so we attach to `document` (events
  // bubble to it from window anyway for keydown). Behavior is identical
  // because we use the same target checks and same `e.preventDefault()`.
  const mainHandler = (e) => {
    if (!state.data) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    // Don't intercept when an inline-editable element (e.g. manual-group
    // name) has keyboard focus.
    if (e.target.isContentEditable) return;

    // v4 turn 34 (Ask B): window-resolution candidate edits. All three keys
    // are no-ops when not in candidate mode + active draft, so installing
    // them globally is safe.
    if (e.key === 'f' || e.key === 'F') {
      if (typeof flipL3DraftResolution === 'function' && flipL3DraftResolution()) {
        e.preventDefault();
        return;
      }
    }
    else if (e.key === 'b' || e.key === 'B') {
      if (typeof nudgeL3DraftBoundary === 'function' && nudgeL3DraftBoundary()) {
        e.preventDefault();
        return;
      }
    }
    else if (e.key === 'c' || e.key === 'C') {
      if (typeof toggleL3DraftCutAtCursor === 'function' && toggleL3DraftCutAtCursor()) {
        e.preventDefault();
        return;
      }
    }
    // turn 128 (revised): spacebar is bound ONLY to "cut at cursor" in
    // candidate mode. Outside candidate mode it does nothing — Quentin
    // asked to unbind the legacy play/pause toggle. The Play button
    // (#playBtn) keeps its mouse-click handler.
    if (e.key === ' ') {
      if (state.candidateMode && typeof toggleL3DraftCutAtCursor === 'function') {
        try {
          if (toggleL3DraftCutAtCursor()) { e.preventDefault(); return; }
        } catch (_) { /* fall through silently */ }
      }
      /* no global play/pause anymore — return without preventDefault */
      return;
    }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const dir = (e.key === 'ArrowRight') ? +1 : -1;
      if (e.shiftKey) {
        // Shift always = 20-window quick-skip regardless of stepMode
        setCur(state, state.cur + dir * 20);
      } else if (state.stepMode === 'l2') {
        // L2 mode: arrows behave like n/p, jumping between envelopes
        jumpL2(state, dir);
      } else if (state.stepMode === 'win5') {
        setCur(state, state.cur + dir * 5);
      } else if (state.stepMode === 'win10') {
        setCur(state, state.cur + dir * 10);
      } else if (state.stepMode === 'winN') {
        // v3.49: custom N. When sync is on, prefer state.compareUnitN (the
        // L3 toolbar input) so the two stay in lockstep; otherwise use
        // stepModeN (the sidebar input). Default to 1 if both are unset.
        const n = state.stepModeSync
          ? Math.max(1, (state.compareUnitN | 0) || (state.stepModeN | 0) || 1)
          : Math.max(1, (state.stepModeN | 0) || 1);
        setCur(state, state.cur + dir * n);
      } else {
        // 'win1' or unknown — single-window step
        setCur(state, state.cur + dir);
      }
    }
    else if (e.key === 'n' || e.key === 'N') {
      state.travelMode === 'L1' ? jumpL1(state, +1) : jumpL2(state, +1);
    }
    else if (e.key === 'p' || e.key === 'P') {
      state.travelMode === 'L1' ? jumpL1(state, -1) : jumpL2(state, -1);
    }
  };

  // Candidate-mode arrow up/down + Enter/Escape handler. Mirrors legacy
  // 69220-69233. Bail-out conditions and helper calls match the legacy
  // verbatim.
  //
  // 2026-05-26 TODO: all five helpers (extendL3DraftRight, shrinkL3DraftRight,
  // commitL3Draft, discardL3Draft, _refreshCmActionButtons) are NOT defined
  // anywhere in the migrated code or in legacy/Inversion_atlas.html — the
  // candidate-mode L3 draft state machine was never implemented. The
  // `typeof X === 'function'` guards below make every key a silent no-op.
  // Once a key is pressed in candidate mode, _warnCandidateModeTodo logs a
  // one-time devtools hint so the dead state isn't invisible.
  let _candidateModeTodoLogged = false;
  function _warnCandidateModeTodo(keyName, helperName) {
    if (_candidateModeTodoLogged) return;
    _candidateModeTodoLogged = true;
    if (typeof console !== 'undefined' && console.debug) {
      console.debug(
        `[local_pca_dosage] candidate-mode key '${keyName}' fired but ` +
        `helper '${helperName}' is not implemented (and never was — ` +
        `the L3 draft state machine is aspirational). See ` +
        `local_pca_dosage/hotkeys.js:~130 and #l3ActionRow[data-todo].`
      );
    }
  }

  const candidateModeHandler = (ev) => {
    if (!state.candidateMode) return;
    // Don't intercept when user is typing in input/textarea/contenteditable.
    const t = ev.target;
    if (t && t.tagName) {
      const tag = t.tagName.toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (t.isContentEditable) return;
    }
    if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (typeof extendL3DraftRight === 'function') {
        try { extendL3DraftRight(); } catch (_) {}
      } else { _warnCandidateModeTodo('ArrowUp', 'extendL3DraftRight'); }
      if (typeof _refreshCmActionButtons === 'function') {
        try { _refreshCmActionButtons(); } catch (_) {}
      }
    }
    else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (typeof shrinkL3DraftRight === 'function') {
        try { shrinkL3DraftRight(); } catch (_) {}
      } else { _warnCandidateModeTodo('ArrowDown', 'shrinkL3DraftRight'); }
      if (typeof _refreshCmActionButtons === 'function') {
        try { _refreshCmActionButtons(); } catch (_) {}
      }
    }
    else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (typeof commitL3Draft === 'function') {
        try { commitL3Draft(); } catch (_) {}
      } else { _warnCandidateModeTodo('Enter', 'commitL3Draft'); }
      if (typeof _refreshCmActionButtons === 'function') {
        try { _refreshCmActionButtons(); } catch (_) {}
      }
    }
    else if (ev.key === 'Escape') {
      ev.preventDefault();
      if (typeof discardL3Draft === 'function') {
        try { discardL3Draft(); } catch (_) {}
      } else { _warnCandidateModeTodo('Escape', 'discardL3Draft'); }
      if (typeof _refreshCmActionButtons === 'function') {
        try { _refreshCmActionButtons(); } catch (_) {}
      }
    }
  };

  document.addEventListener('keydown', mainHandler);
  document.addEventListener('keydown', candidateModeHandler);

  return function detach() {
    document.removeEventListener('keydown', mainHandler);
    document.removeEventListener('keydown', candidateModeHandler);
  };
}
