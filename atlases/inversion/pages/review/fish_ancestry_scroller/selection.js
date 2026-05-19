// pages/review/fish_ancestry_scroller/selection.js
// =====================================================================
// Selection state for the Ancestry Scroller. Tracks the currently
// selected brick (Layer 2 click), exposes a pure resolver that maps a
// Layer-2 canvas click coordinate to the brick under that pixel, and
// emits an update callback the main entry uses to repaint the
// right-panel "Selected brick" card.
// =====================================================================

/**
 * Resolve which (fish_row, brick) was clicked, given canvas-relative
 * coordinates. Returns null when the click misses the grid.
 *
 * Coordinates use the same fish-row × window-column grid the Layer 2
 * renderer paints into (canvas pixel space).
 *
 * @param {{x:number, y:number, canvas_w:number, canvas_h:number}} px
 * @param {{fish_rows:Array, window_grid:Array, bricks:Object}} model
 * @returns {{fish_id:string, brick:Object}|null}
 */
export function resolveClick(px, model) {
  if (!px || !model) return null;
  const fishRows = model.fish_rows || [];
  const windows  = model.window_grid || [];
  if (fishRows.length === 0 || windows.length === 0) return null;
  const colW = px.canvas_w / windows.length;
  const rowH = px.canvas_h / fishRows.length;
  if (!Number.isFinite(colW) || colW <= 0) return null;
  if (!Number.isFinite(rowH) || rowH <= 0) return null;
  const c = Math.floor(px.x / colW);
  const r = Math.floor(px.y / rowH);
  if (r < 0 || r >= fishRows.length) return null;
  if (c < 0 || c >= windows.length) return null;
  const fishId = fishRows[r];
  const rowBricks = (model.bricks || {})[fishId] || [];
  for (const b of rowBricks) {
    if (b.start_idx <= c && c <= b.end_idx) {
      return { fish_id: fishId, brick: b };
    }
  }
  return null;
}

/**
 * Create a selection store. Stores the current selection and notifies
 * subscribers on change.
 *
 * @returns {{
 *   get: () => Object|null,
 *   set: (sel:Object|null) => void,
 *   subscribe: (cb:Function) => Function
 * }}
 */
export function createSelectionStore() {
  let current = null;
  const subs = new Set();
  return {
    get()         { return current; },
    set(sel)      {
      current = sel;
      for (const cb of subs) {
        try { cb(current); } catch (e) { /* swallow */ }
      }
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}
