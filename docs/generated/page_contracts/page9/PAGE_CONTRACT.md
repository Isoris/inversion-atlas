# page9 — confirmed carousel — Page Capability Contract

**Atlas**: inversion · **Stage**: catalogue · **Status**: active (fresh implementation)

## Purpose

Carousel walk-through of all candidates marked **confirmed** on
page2. `state.candidateList.filter(c => c.confirmed === true)`.
Prev/next buttons cycle through the confirmed set; each card reuses
page2's candidate-detail renderer.

## Capabilities

- Render a nav bar with prev / next buttons and a position counter.
- Render the active confirmed candidate as a full detail card
  (delegates to page2's `renderCandidateMetadata`).
- Show an empty-state when no candidates are confirmed.

## Required data

- **Layers**: `scrubber_main`
- **Slots**: `activeChrom`

## User interactions

- `#confirmedNavPrev` button
- `#confirmedNavNext` button

## Outputs

Preview-only — no committable outputs. Commit gestures (confirm /
unconfirm) happen on page2.

## Sub-modules in `page9/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |
| `carousel.js` | fresh implementation; legacy had only the HTML shell |

## Status and known issues

- Legacy had HTML shell only — no carousel JS existed. This module's
  `carousel.js` is a fresh implementation.

## Documents

- **Registry doc**: `pages.registry.json` → `pages.page9._doc`
- **Handoffs**: `_handoff_docs/HANDOFF_2026-05-07_chat36_round5_step7_done.md`
- **User guide**: unknown
- **Legacy source**: `legacy/Inversion_atlas.html` lines 7782-7812 (HTML shell ONLY)

**Confidence**: high
