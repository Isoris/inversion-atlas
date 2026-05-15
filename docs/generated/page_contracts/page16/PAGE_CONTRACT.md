# page16 — cross-species breakpoints — Page Capability Contract

**Atlas**: inversion · **Stage**: comparative · **Status**: active

## Purpose

Cross-species comparative dashboard for chromosome-scale
rearrangements between **C. gariepinus** (Cgar) and
**C. macrocephalus** (Cmac), derived from a wfmash 1-to-1 alignment
(`cs_breakpoints_v1` schema, output of
`STEP_CS01_extract_breakpoints.py`).

Each breakpoint renders both species' coordinates, a syntenic-block
linking line, and flanking repeat-element density on both species
(drawing from page11's TEfull JSONs already loaded into
`state.repeatDensity`).

**Spalax-style TE enrichment at breakpoints is the manuscript hook.**

## Three-cohort discipline (critical)

F1 hybrid (assembly paper) ≠ 226-sample pure *C. gariepinus*
(current inversion atlas) ≠ pure *C. macrocephalus* wild (future
paper). **Must NEVER conflate.**

## Capabilities

Six-panel layout:
- `#csToolbar` — filter + sort controls
- `#csCatalogue` — breakpoint catalogue table
- `#csFocus` — focus card for active breakpoint
- `#csSyntenyContent` — synteny section
- `#csDotplotContent` — dotplot panel
- `#csFocalVsBgContent` — focal-vs-background permutation test

Actions:
- Filter / sort the breakpoint catalogue.
- Click a row → select active breakpoint, populate focus card.
- Run focal-vs-background permutation test.

## Required data

- **Layers**: `cs_breakpoints`, `phylo_tree`
- **Preloads**: same
- **Owned state**: `state.crossSpecies` + cs* synteny caches +
  hover/wire flags

## Outputs

**Preview-only**:
- filtered / sorted catalogue
- focus card (both species coords + flanking repeat density)
- synteny linking lines
- dotplot
- focal-vs-background permutation test result

**Committable**: unknown (likely TSV export).

## Connected analyses / adapters

- `shared/cross_species.js`
- `shared/cross_species_summary.js`

## Cross-page exports

This page **owns** two helpers consumed by page17 (synthesis stats
profile):
- `_csGetSyntenyBlocks` (line ~1488)
- `_csPermutationTest` (line ~1791)

Round 5 step 11 promoted these from runtime-guarded references to
proper ES exports. page17 still imports via typeof guards (follow-up
task).

## Sub-modules in `page16/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |

## Schemas

- `cs_breakpoints_v1` (output of `STEP_CS01_extract_breakpoints.py`)
- `registries/schemas/cross_species_breakpoint_reuse.schema.json`
- `registries/schemas/cross_species_synteny_blocks.schema.json`

## Documents

- **Registry doc**: `pages.registry.json` → `pages.page16._doc`
- **Handoffs**: `atlases/inversion/pages/comparative/BATCH_5_NOTES.md`,
  `_handoff_docs/HANDOFF_2026-05-07_chat36_round5_step11_done.md`
  (AST-shim methodology — 50 helpers got shim)
- **User guide**: unknown
- **Legacy source**: `legacy/Inversion_atlas.html` lines 20971-21114
  (constants + IO/state) + 23717-26025 (runtime) + 28367-28419
  (permutation test HTML)

**Confidence**: high
