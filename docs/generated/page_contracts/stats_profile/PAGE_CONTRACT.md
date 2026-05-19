# stats_profile — stats profile — Page Capability Contract

**Atlas**: inversion · **Stage**: classification (per manifest.json) · **Status**: active

## Purpose

Statistical profile of inversion-associated genomic features.
Comparative summary of breakpoint context, genomic composition,
functional cargo, population variation, breeding burden.

This is the manuscript's **synthesis figure**: "what is statistically
special about inversion regions?"

## Capabilities

- Auto-derive rows from `cs_breakpoints` + the candidate list.
- Accept `stats_profile` JSON/TSV overlay (drag-drop) for rows that
  require annotation: gene density, GO/KEGG, ROH, deleterious
  burden, F_ST.
- Render the comparative summary table in `#spBody`.

## Required data

- **Layers**: `scrubber_main`
- **Slots**: `activeChrom`

## Auto-derives from

- `cs_breakpoints` (cross-species breakpoint catalogue)
- candidate list

## Optional overlay

- `stats_profile` JSON / TSV (drag-drop)

## Outputs

**Preview-only**: comparative stats profile table.
**Committable**: unknown (likely export buttons).

## Cross-page dependency

Calls `_csGetSyntenyBlocks` + `_csPermutationTest`, both exported
from cross_species_breakpoints. Round 5 step 11 promoted these from runtime guards to
proper ES exports. Imports still go through runtime guards as of the
chat-36 split; promote-to-imports is a follow-up task.

## Sub-modules in `stats_profile/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |

## Status and known issues

- Directory / stage discrepancy: `manifest.json` says
  `stage: "classification"` but the file lives under
  `pages/catalogue/`.
- Cross-page runtime dependency on cross_species_breakpoints; see above.

## Documents

- **Registry doc**: `pages.registry.json` → `pages.stats_profile._doc`
- **Handoffs**: `atlases/inversion/pages/catalogue/BATCH_4_NOTES.md`,
  `_handoff_docs/HANDOFF_2026-05-07_chat36_round5_step11_done.md`
- **User guide**: unknown
- **Legacy source**: `legacy/Inversion_atlas.html` lines 28420-29306
  (JS body) + 8110-8127 (HTML shell)

**Confidence**: high
