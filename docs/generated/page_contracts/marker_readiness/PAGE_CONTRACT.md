# marker_readiness — marker readiness panel — Page Capability Contract

**Atlas**: inversion · **Stage**: classification · **Status**: active

## Purpose

Marker readiness panel — **private-indel architecture**. The atlas
computes `private_score` / `dosage_score` / `gel_visibility` live
from `variant_afs.json`. Auto-suggests positive / negative control
samples from candidate karyotype state. Includes a 5-step pilot
validation checklist with cross-species controls.

## Tier hierarchy (manuscript spec)

| tier | description | criterion |
|------|-------------|-----------|
| **Tier 1** (highest) | private indel/SNP tag with clean dosage | `AF_STD ≤ 0.02` AND `AF_HET ∈ [0.25, 0.75]` AND `AF_INV ≥ 0.80` |
| **Tier 2** | multi-marker haplotype panel OR strong-tag with imperfect het | — |
| **Tier 3** (DEMOTED) | breakpoint PCR candidate | breakpoint precision uncertain |
| **Tier 4** (lowest) | exploratory | — |

## Capabilities

- Render tier-classified marker cards.
- Live compute `private_score`, `dosage_score`, `gel_visibility`
  from `variant_afs.json`.
- Auto-suggest positive / negative control samples from the
  candidate's karyotype state.
- Display the 5-step pilot validation checklist with cross-species
  controls.

## Required data

- **Layers**: `scrubber_main`
- **Slots**: `activeChrom`
- **Primary input**: `variant_afs.json` (drag-drop)

## User interactions

- Drag-drop `variant_afs.json`.
- Tier filter.

## Outputs

Preview-only. Committable: unknown (likely export selected markers).

## Sub-modules in `marker_readiness/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |

## Status and known issues

- Directory / stage discrepancy: `manifest.json` says
  `stage: "classification"` but the file lives under
  `pages/catalogue/`.

## Documents

- **Registry doc**: `pages.registry.json` → `pages.marker_readiness._doc`
- **Handoffs**: `atlases/inversion/pages/catalogue/BATCH_4_NOTES.md`
- **User guide**: unknown
- **Legacy source**: `legacy/Inversion_atlas.html` lines 29307-30160
  (JS body) + 8134-8157 (HTML shell)

**Confidence**: high
