# page21 — annotation cockpit — Page Capability Contract

**Atlas**: inversion · **Stage**: catalogue · **Status**: active

## Purpose

Per-sample-lines canvas with cursor-driven candidate selection.
The chromosome-wide **annotation cockpit**: each promoted candidate
appears as a faint rectangle in mb-space; per-sample PC1
trajectories drawn beneath, optionally coloured by the active
candidate's K-means band assignment.

## Capabilities

- Render per-sample PC1 trajectory canvas (`#annoCockpitCanvas`).
- Overlay candidate rectangles in mb-space.
- Shade by K-means band on hover / select.
- Cursor-driven candidate / band selection:
  - ←/→ step cursor
  - Shift+arrow jump boundaries
  - Esc clear cursor
  - digit keys 0–9 select a band of the candidate under the cursor
- Update `state.tracked` → drives linkage shading + linkage table +
  haplotype-annotation panel.

## Required data

- **Layers**: `scrubber_main`
- **Slots**: `activeChrom`

## User interactions / hotkeys

- ←/→ — step cursor
- Shift+arrow — jump candidate boundaries
- Esc — clear cursor
- 0..9 — select band of candidate under cursor

## Outputs

**Preview-only**:
- per-sample PC1 trajectory canvas
- candidate rectangles
- K-means band shading
- linkage table panel
- haplotype-annotation panel

**Committable**:
- `state.tracked` updates (linkage assignments) — persistence
  mechanism unknown (likely registry write path or localStorage).

## Sub-modules in `page21/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |

## Status and known issues

- `HANDOFF_BATCH_3.md` mislabels this page as "Manual karyotype
  groups list" — that is **incorrect** per the module header's
  authoritative line-range check. This page IS the annotation
  cockpit.

## Documents

- **Registry doc**: `pages.registry.json` → `pages.page21._doc`
- **Handoffs**: `atlases/inversion/pages/catalogue/BATCH_3_NOTES.md` (note the label correction)
- **User guide**: unknown
- **Legacy source**: `legacy/Inversion_atlas.html` lines 46938-47616
  (JS body) + 7822-7859 (HTML shell). Public entry:
  `refreshAnnotationCockpit` (legacy line 47590)

**Confidence**: high
