# page10 — marker panels — Page Capability Contract

**Atlas**: inversion · **Stage**: catalogue · **Status**: active

## Purpose

Diagnostic PCR marker panel cards for each candidate inversion
regime. Reproduces the genome-based regime call (g0/g1/g2 from
`fish_regime_calls.tsv`) using 3–10 markers per candidate. Activates
when `marker_panel_summary` is present in `state.data._layers_present`.

## Capabilities

- Render one marker-panel card per `marker_panel_summary` entry.
  Each card shows:
  - candidate id + coords
  - regime counts
  - tier badge (HIGH / MEDIUM / LOW) — colour-coded
  - expected accuracy
  - n markers
  - panel class
  - per-regime marker counts (g0 / g1 / g2 diagnostic)
  - Tm range + multiplex spread (≤4°C = safe; otherwise tight)
  - warning tags
- When `marker_catalogue` + `marker_primers` layers also loaded:
  per-marker table with `marker_id`, position, `variant_type`,
  `target_regime`, `specificity_score`, `freq_g0/g1/g2`,
  `family_spread_score`, amplicon size, Tm forward/reverse.
- Textual interpretation block: which markers support which regime
  + combined-panel accuracy on the calibration cohort.
- Empty-state with drag-in instructions when `marker_panel_summary`
  is not present.

## Required data

- **Layers**: `scrubber_main`
- **Slots**: `activeChrom`

## Activation layer

- `marker_panel_summary` (page renders empty-state until this layer
  is present)

## Enhances with

- `marker_catalogue` (adds per-marker table)
- `marker_primers` (adds Tm + amplicon size to the table)

## Outputs

Preview-only. No committable outputs.

## Sub-modules in `page10/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |

## Status and known issues

- The module header references **SCHEMA §10** for the marker layer
  column contracts, but the prose SCHEMA doc does not exist on disk.
  The 26 JSON schemas in `registries/schemas/` cover layer formats
  but not the prose explanation.

## Documents

- **Registry doc**: `pages.registry.json` → `pages.page10._doc`
- **Schema doc referenced but missing**: SCHEMA §10
- **User guide**: unknown
- **Legacy source**: `legacy/Inversion_atlas.html` lines 57837-58043

**Confidence**: high
