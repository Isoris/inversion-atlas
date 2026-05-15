# page16b — multi-species classification cockpit — Page Capability Contract

**Atlas**: inversion · **Stage**: comparative · **Status**: active

## Purpose

Place each Cgar ↔ Cmac breakpoint on the **catfish phylogeny**;
click a species in the tree to see how its homologous region
compares (chromosome context, orientation, boundary status).
Auto-suggests architecture class (A–F) from the lineage distribution.

## Capabilities

- Render three-column layout: tree (left) + classification +
  lineage table (center) + per-species detail (right).
- Show the active breakpoint as a ribbon in the header.
- Place breakpoints on the catfish phylogeny.
- Click a species in the tree → show homologous-region detail.
- Auto-suggest architecture class (A–F) from lineage distribution.
- Drag-drop 6 JSON layers.

## Required data

- **Layers**: `synteny_multispecies`, `cs_breakpoints`,
  `te_fragility`, `phylo_tree`

## Owns 6 JSON layers

- `dotplot_mashmap_v1`
- `synteny_multispecies_v1`
- `phylo_tree_v1`
- `dxy_per_inversion_v1`
- `comparative_te_breakpoint_fragility_v1`
- `karyotype_lineage_v1`

## Reads from page16

- `state.crossSpecies` — active breakpoint catalogue from
  `cs_breakpoints_v1`. Cross-page dependency: if page16 hasn't been
  mounted on the same chromosome, this page is empty-state.

## Default reference tree

9-species reference tree (shown when no `phylo_tree_v1` layer is
loaded): Tros, Smer, Tfulv, Ipun, Hwyc, Phyp, Capus, Cfus, Cmac,
Cgar.

## Persistence

- User classifications → `localStorage` as
  `inversion_atlas.classifications.v1`
- Per-layer caches → `inversion_atlas.<layer>.v1`

## Outputs

**Preview-only**:
- active breakpoint placement
- per-species detail
- auto-suggested architecture class (A–F)
- lineage table

**Committable**:
- per-breakpoint architecture classification (localStorage)

Commit policy: manual only.

## Sub-modules in `page16b/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |

## Status and known issues

- Owns 6 JSON layers — heaviest layer load of any page after page1.
- Cross-page read of `state.crossSpecies` (page16's data) — fragile
  coupling.

## Documents

- **Registry doc**: `pages.registry.json` → `pages.page16b._doc`
- **Handoffs**: `atlases/inversion/pages/comparative/BATCH_5_NOTES.md`,
  `_handoff_docs/HANDOFF_2026-05-07_chat36_round5_step20_done.md`
  (AST-shim methodology — 39/64 helpers got shim; 77 explicit ES
  exports added)
- **User guide**: unknown
- **Legacy source**: `legacy/Inversion_atlas.html` lines 26026-28366
  (full body) + 26016-26024 (prelude)

**Confidence**: high
