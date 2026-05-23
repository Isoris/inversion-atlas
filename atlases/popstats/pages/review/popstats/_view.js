// =============================================================================
// popstats/_view.js
// =============================================================================
// Persisted chip-toggle state for the popstats track stack. Mirrors the legacy
// scrubber_v3_popstats localStorage key so users keep their visibility choices
// across sessions and across the inversion-atlas <-> atlas-core migration.
//
// Shape: { hidden: Set<trackId>, shown: Set<trackId> }
//   - hidden  — tracks the user has explicitly hidden (default-on tracks they
//               want off)
//   - shown   — tracks the user has explicitly shown (off-by-default qc /
//               popstats categories they want on)
// =============================================================================

const STORAGE_KEY = 'scrubber_v3_popstats';

export function loadView() {
  const out = { hidden: new Set(), shown: new Set() };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return out;
    const v = JSON.parse(raw);
    if (v && typeof v === 'object') {
      if (Array.isArray(v.hiddenChips)) for (const id of v.hiddenChips) out.hidden.add(id);
      if (Array.isArray(v.shownChips))  for (const id of v.shownChips)  out.shown.add(id);
    }
  } catch (_) { /* ignore */ }
  return out;
}

export function saveView(view) {
  let hidden, shown;
  if (view instanceof Set) {
    hidden = view; shown = new Set();
  } else if (view && typeof view === 'object') {
    hidden = view.hidden instanceof Set ? view.hidden : new Set();
    shown  = view.shown  instanceof Set ? view.shown  : new Set();
  } else {
    hidden = new Set(); shown = new Set();
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      hiddenChips: Array.from(hidden),
      shownChips:  Array.from(shown),
    }));
  } catch (_) { /* localStorage may be disabled */ }
}

export function categoryOf(track) {
  return (track && typeof track.category === 'string') ? track.category : 'other';
}

export function isVisible(track, view) {
  if (track.alwaysOn) return true;
  if (view.hidden.has(track.id)) return false;
  const cat = categoryOf(track);
  if (cat === 'always') return !!track.hasData;
  if (cat === 'qc' || cat === 'popstats') return view.shown.has(track.id);
  return !!track.hasData;
}

export function toggle(track, view) {
  const cat = categoryOf(track);
  if (cat === 'qc' || cat === 'popstats') {
    if (view.shown.has(track.id)) {
      view.shown.delete(track.id);
    } else {
      view.shown.add(track.id);
      view.hidden.delete(track.id);
    }
  } else {
    if (isVisible(track, view)) {
      view.hidden.add(track.id);
    } else {
      view.hidden.delete(track.id);
    }
  }
}
