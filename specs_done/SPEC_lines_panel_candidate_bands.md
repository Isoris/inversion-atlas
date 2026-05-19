# SPEC — Lines-panel Candidate Bands (per-candidate vertical highlights)

**Status**: SHIPPED — was SPEC ONLY (referenced from `pages/discovery/
local_pca_dosage/lines_panel.js` + `MIGRATION_INVENTORY.md` + the band-track
parent SPEC without an on-disk doc) until 2026-05-15.
**Authored from shipped code** (recovery of a missing SPEC).
**Originator turn**: turn 141 (per inline `// turn 141 Slice 1:`
comments at the implementation site).

**Implemented in**:
- `atlases/inversion/pages/discovery/local_pca_dosage/lines_panel.js` —
  `setLinesPanelCandidateBands(state, b)` (line 1286);
  `_paintCandidateBands` call site (line 184-203)
- `atlases/inversion/pages/discovery/local_pca_dosage/candidates.js` —
  `_paintCandidateBands(ctx, opts)` (legacy lines 33945-33992)
- `atlases/inversion/shared/page1_utils.js` — `_assignCandidateLanes`
  (re-exported through `candidates.js`)

**Page contract**: `docs/generated/page_contracts/local_pca_dosage/`

**Companion specs**:
- `specs_done/SPEC_band_track_extraction_and_l3_single_band_rows.md`
  (parent — defines candidates + L1/L2 envelopes)
- `specs_done/SPEC_l2_sweep_inheritance.md` (defines how
  auto-promoted candidates land — only `confirmed === true` are
  painted)

---

## §1. Purpose

Paint **per-candidate vertical band highlights** on local_pca_dosage's lines
panel as a pure-background layer beneath the per-sample PC1 traces.
Each confirmed candidate becomes a faint coloured rectangle spanning
its `[start_bp, end_bp]` in mb-space.

Goal: **make candidate location visible at a glance** while the user
scrubs the cursor, without obscuring the per-sample lines.

## §2. Layering contract

```
Z-order (bottom → top):
  1. Background fill
  2. Candidate vertical band highlights      ← THIS SPEC
  3. Per-sample PC1 traces
  4. Tracking highlights (gold for tracked
     samples, etc.)
  5. Cursor crosshair
  6. Inheritance pill labels strip
  7. Frame + axis ticks
```

Bands paint FIRST so they're pure background. Wrapped in `try/catch`
so a misbehaving candidate (malformed bp value, etc.) cannot take
out the whole panel — band drawing is **purely additive and safe to
skip**.

## §3. Toggle + persistence

State slot: `state.linesPanelCandidateBands` (boolean; default
ON / `true`).

Setter:

```js
export function setLinesPanelCandidateBands(state, b) {
  _setActiveState(state);
  state.linesPanelCandidateBands = !!b;
  try {
    localStorage.setItem(_LINES_PANEL_CAND_BANDS_KEY, b ? '1' : '0');
  } catch (_) {}
  drawLinesPanel(state);
}
```

Persistence: `localStorage` key
`_LINES_PANEL_CAND_BANDS_KEY` (cohort-level, not per-chrom).

Reset behaviour: if `state.linesPanelCandidateBands === false`, the
paint call is skipped entirely (early-out at line 189 of
`lines_panel.js`):

```js
if (state.linesPanelCandidateBands !== false) {
  try {
    _paintCandidateBands(ctx, { ... });
  } catch (e) { console.warn('[lines/candBands] paint failed:', e); }
}
```

## §4. Filter rules

A candidate is painted **only if** ALL of:

1. `c.confirmed === true` — auto-promoted candidates
   (`source: 'auto_l2_sweep'`, `confirmed: false` per
   `SPEC_l2_sweep_inheritance §6`) are NOT painted until the user
   confirms them.
2. `chrom` filter: `c.chrom === state.data.chrom` (or `c.chrom`
   absent — defensively included).
3. `c.start_bp` and `c.end_bp` are finite numbers with `end_bp > start_bp`.
4. The candidate's `[start_bp, end_bp]` overlaps the visible
   `[mbMin, mbMax]` in mb-space.

Off-screen candidates that pass filters 1-3 but fail 4 (visible
overlap) **still bump `chromIdx`** so palette assignment stays
stable across zoom changes — the user must NOT see "yellow" jump
from candidate 1 to candidate 2 when scrolling. See §6.

## §5. Paint contract

```js
_paintCandidateBands(ctx, {
  pad,                        // {l, t, r, b} canvas padding
  plotW, plotH,               // plot area dimensions in px
  toX,                        // function(mb) → x-pixel
  mbMin, mbMax,               // visible mb range
  candidates,                 // state.candidateList || []
  chrom,                      // state.data.chrom for filter
  alpha,                      // optional, default 0.10
});
```

Per surviving candidate:

```
xLo = toX(max(c.start_bp / 1e6, mbMin))
xHi = toX(min(c.end_bp / 1e6, mbMax))
ctx.fillStyle = _candidateBandColor(chromIdx, alpha)
ctx.fillRect(xLo, pad.t, xHi - xLo, plotH)
```

Returns the count of painted bands (used by the caller as a stat
indicator).

## §6. Palette assignment

**Walk `candidateList` in array order.** Index `chromIdx` is the
position in the chromosome-filtered, confirmed-only walk —
NOT the array index of `c` in `candidateList`.

The leftmost-saved candidate gets `chromIdx = 0` (yellow). The next
gets 1 (next palette colour). Etc. This **matches the candidate-strip
ordering** the user already reads above the |Z| panel.

Critical: `chromIdx` increments on **every** candidate that passes
filters 1-3 (confirmed + same chrom + finite bp), even if filter 4
(visible) fails. This keeps palette assignment stable across zoom.

Color resolver: `_candidateBandColor(chromIdx, alpha)` — defined in
`candidates.js` (uses `withAlpha` from `shared/page1_utils.js`).
Palette inherited from the candidate-strip palette.

## §7. Default-ON rationale

The toggle defaults to ON because:

- Candidate location is the most-asked question users have when
  staring at lines (per chat-31 user feedback).
- The 0.10 alpha is light enough to not obscure traces.
- Users who find it distracting can toggle off via the sidebar
  control (persists per cohort).

If ALL candidates are off-screen the paint is a no-op (returns 0)
so there's zero perceptual cost when the toggle is on but the user
has zoomed to a region without candidates.

## §8. Interaction with other layers

- **Inheritance pills** (top strip): paint on top, in their own
  region above `pad.t`. No overlap with candidate band fill.
- **Cursor crosshair**: paints on top, opaque line. Visible over
  all bands.
- **Tracking highlights** (gold lines for `state.tracked` samples):
  paint on top, with their own alpha. Visually layer over the
  faint band.
- **Lasso overlay** (`state.linesLassoActive`): paints on top, with
  its own selection rectangle. The rectangle's outline is fully
  opaque so users can see its bounds even over a candidate band.

## §9. Three reasons NOT to paint

The paint is skipped (early return, no work) when:

1. `state.linesPanelCandidateBands === false` (user toggled off).
2. `candidates` is empty or not an array.
3. Visible mb range is invalid (`mbMax <= mbMin` or non-finite).

Plus per-candidate: any candidate failing filters §4 is skipped (but
chromIdx still bumps to keep palette stable).

## §10. Performance

- Pure canvas `fillRect` per candidate; no DOM work.
- O(n_candidates) per redraw.
- `try/catch` wraps the whole paint so a single bad candidate cannot
  block the rest of `drawLinesPanel` from running.
- `drawLinesPanel` is itself called from the cursor-move redraw chain;
  `_paintCandidateBands` is part of the 60-fps target.

## §11. Exports

```js
// lines_panel.js
export function setLinesPanelCandidateBands(state, b): void;
export function drawLinesPanel(state): void;     // calls _paintCandidateBands

// candidates.js
export function _paintCandidateBands(ctx, opts): number;
export const _assignCandidateLanes;              // re-export from page1_utils
```

## §12. References

- **Setter**: `pages/discovery/local_pca_dosage/lines_panel.js#setLinesPanelCandidateBands`
  (legacy lines 34002-34007)
- **Paint helper**: `pages/discovery/local_pca_dosage/candidates.js#_paintCandidateBands`
  (legacy lines 33945-33992)
- **Lane layout** (companion, used elsewhere):
  `pages/discovery/local_pca_dosage/candidates.js#_assignCandidateLanes`
- **Palette**: `_candidateBandColor` (in `candidates.js`) +
  `withAlpha` (in `shared/page1_utils.js`)
- **Filter rule**: `c.confirmed === true` per
  `specs_done/SPEC_l2_sweep_inheritance.md §6`

---

**Authored**: 2026-05-15 from `pages/discovery/local_pca_dosage/lines_panel.js`
lines 184-203 + 1286-1292 + `pages/discovery/local_pca_dosage/candidates.js`
lines 48-95. One of the 8 SPECs identified as missing on disk in
`_handoff_docs/SPECS_AUDIT.md`.
