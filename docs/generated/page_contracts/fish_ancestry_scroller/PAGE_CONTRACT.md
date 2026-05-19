# fish_ancestry_scroller — Fish Ancestry Scroller — Page Capability Contract

**Atlas**: inversion · **Stage**: classification · **Status**: active (registered 2026-05-15)

## Registration status (resolved 2026-05-15)

Previously unregistered. As of 2026-05-15 the entry is in
`manifest.json` AND `pages.registry.json` (commit
`docs(manifest): register fish_ancestry_scroller`). The shell can
now mount the page.

**Still pending**: the caller-supplies-model contract — `mount()`
expects a fully-prepared `model` derived from
`shared/ancestry_alignment.js` + `shared/ancestry_bricks.js` +
cluster-side `instant_q` (Engine B). The derivation pipeline that
glues these into the model isn't wired automatically yet, so an
empty mount today shows the page's empty-state ("model not
provided").

## Purpose

Review-stage page that renders 3 numbered layers + brick metrics +
cohort summary for one selected inversion candidate (one chromosome
viewport). Consumer of shared ancestry primitives — does NOT compute
alignment or bricks itself; caller supplies a fully-prepared `model`
to `mount()`.

## UI layout (v2)

- **Layer 1**: PC1 Band per fish
- **Layer 2**: Ancestry Bricks per fish (six color modes)
- **Layer 3**: Brick summary cohort view
- **5-row brick-metrics heatmap**
- **Tab strip**: Overview / Candidates / Ancestry / Pop Stats /
  Regimes / Markers / Breakpoints
- **Right panel**: 3 blocks (Context explainer / View-mode + overlay
  controls / third block)

## Headline metric

**Mean |ΔQ|** (global vs local).

## Critical: F-based label-switching alignment

The page enforces a strict alignment pipeline:
- F-based label-switching alignment (canonical)
- Q-fallback only in flanks
- Regime-aware smoothing
- **FAIL = grey, not coloured** — no inferred colour without
  alignment confidence

## Capabilities

- Render the 3 numbered layers (Layer 1 / 2 / 3).
- Brick-metrics heatmap (5 rows).
- Tab strip switcher.
- Right-side panel (3 blocks).
- Brick hit-test on Layer 2 click → resolve brick under pixel.

## Input contract

`model` (passed to `mount()`) — pre-computed from
`shared/ancestry_alignment.js` + `shared/ancestry_bricks.js`. Empty
model → empty-state.

## Outputs

Preview-only. No committable outputs (selection persists in
selection store but is in-memory).

## Vocabulary discipline (per SPEC)

The ancestry bricks layer is a **derived simplification** merging
RFs into bricks with multi-metric labels (`RARE_ANCESTRY`,
`HIGH_HET`, `REGIME_DISCORDANT`, etc.). It is NOT a discovery
system. **"We discovered N bricks" is forbidden phrasing per the SPEC.**

## Sub-modules in `fish_ancestry_scroller/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |
| `layers.js` | renderers for the 3 numbered layers + brick-metrics block |
| `right_panel.js` | 3-block right side panel |
| `selection.js` | brick hit-test (Layer 2 canvas click → brick under pixel) |

## Connected analyses / adapters

- `shared/ancestry_alignment.js` — produces aligned Q with
  label-switching fixed (drives Layer 2 brick K assignment + ΔQ)
- `shared/ancestry_bricks.js` — produces per-fish bricks + flags
- Consumes `instant_q` (Engine B) per-RF output — cluster-side
  producer.

## Documents

- **Registry doc**: NOT registered (not in `pages.registry.json` and
  not in `atlases/inversion/manifest.json`)
- **Specs (todo)**: `specs_todo/SPEC_fish_ancestry_scroller.md`
  (UI layout v2 — canonical)
- **Mockups**: `plots/ancestry_atlas_mockup_v2.png`,
  `plots/ancestry_scroller_mockup.png` (existence unknown)
- **User guide**: unknown

**Confidence**: high (on the implementation; **unknown** on whether
the page is intended to ship)
