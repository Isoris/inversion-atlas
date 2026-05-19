# `pages/comparative/` — comparative-stage pages

This directory hosts pages for the **comparative** workflow stage —
cross-species inversion analysis between *C. gariepinus* (Cgar)
and *C. macrocephalus* (Cmac), plus phylogenetic placement across
catfish lineages. Also hosts the static `help` page (help) because
of historical grouping.

## What comparative is for

> "We have a set of inversions in C. gariepinus. Now we want to
> know: does this inversion exist as a polymorphism in Cmac too?
> Is it lineage-restricted? Where does the breakpoint sit on the
> catfish phylogeny?"

The comparative stage answers that.

## Pages in this directory

### Stage `comparative`

| page | label | summary |
|------|-------|---------|
| `cross_species_breakpoints` | cross-species breakpoints | Cgar × Cmac wfmash 1-to-1 alignment (`cs_breakpoints_v1` schema); 6-panel dashboard — toolbar, catalogue, focus card, synteny, dotplot, focal-vs-bg permutation test |
| `multi_species_cockpit` | multi-species cockpit | place each Cgar↔Cmac breakpoint on the catfish phylogeny; click species → homologous-region detail; auto-suggests architecture class A-F from lineage distribution; owns 6 JSON layers |

### Stage `help`

| page | label | summary |
|------|-------|---------|
| `help` | help | static quick-reference / help page (~1158 LOC HTML); `renderPage5()` is a no-op; PAGE5_META carries tab metadata |

## Three-cohort discipline (CRITICAL)

The most important contract in this directory:

> F1 hybrid (assembly paper) ≠ 226-sample pure *C. gariepinus*
> (current inversion atlas) ≠ pure *C. macrocephalus* wild (future
> paper). **Three cohorts must NEVER conflate.**

Every page in this directory carries this discipline. The
`cs_breakpoints_v1` schema is from the wfmash 1-to-1 alignment of
the Cgar and Cmac REFERENCE genomes (not the F1 hybrid; not wild
populations). When a page reads `state.crossSpecies`, the data
came from this specific cohort, and any conclusions are scoped to
it.

## Cross-page dependencies

- **multi_species_cockpit** reads `state.crossSpecies` (owned by cross_species_breakpoints). If
  cross_species_breakpoints hasn't been mounted on the same chromosome first, multi_species_cockpit
  shows empty-state.
- **cross_species_breakpoints** owns `_csGetSyntenyBlocks` + `_csPermutationTest`
  exports, consumed by **stats_profile** (synthesis stats profile, lives
  in `pages/catalogue/`). Cross-stage dep.

## Architecture classes (multi_species_cockpit auto-suggest)

The 6 classes auto-suggested from lineage distribution:

| class | meaning |
|-------|---------|
| A | conserved across all sampled species |
| B | shared with at least one ancestral lineage |
| C | restricted to a recent lineage subset |
| D | private to Cgar |
| E | discordant — breakpoint placement disagrees with phylogeny |
| F | architecture unclear |

(See multi_species_cockpit source / SPEC for the precise decision tree.)

## multi_species_cockpit owns 6 JSON layers

These are drag-droppable cross-species layers:

| layer | purpose |
|-------|---------|
| `dotplot_mashmap_v1` | mashmap dotplots between species pairs |
| `synteny_multispecies_v1` | extended synteny across multiple species |
| `phylo_tree_v1` | the catfish phylogeny (replaces the default 9-species reference tree) |
| `dxy_per_inversion_v1` | per-inversion dXY across species |
| `comparative_te_breakpoint_fragility_v1` | TE fragility at breakpoints across species |
| `karyotype_lineage_v1` | per-lineage karyotype calls |

User classifications persist to `localStorage` as
`inversion_atlas.classifications.v1`; per-layer caches to
`inversion_atlas.<layer>.v1`.

## Default 9-species reference tree

Shown when no `phylo_tree_v1` layer is loaded:
**Tros, Smer, Tfulv, Ipun, Hwyc, Phyp, Capus, Cfus, Cmac, Cgar**.

## SPECs relevant to comparative

In `specs_done/`:
- `SCHEMA.md` (§12 cross-species breakpoints — `cs_breakpoints_v1`)
- `SPEC_band_track_extraction_and_l3_single_band_rows.md` (parent
  band-track spec; the Spalax-style TE enrichment at breakpoints is
  the manuscript hook cross_species_breakpoints ships toward)

In `specs_todo/`:
- `SPEC_busco_anchors_v1.md` (would feed cross_species_breakpoints's ribbon-plot ticks
  once page integration ships)

## help special case (the help page)

`help` lives in `pages/comparative/` for **historical reasons**.
Its manifest stage is `help`, not `comparative`. The grouping is
incorrect from a directory-layout perspective but the stage is
authoritative for shell routing.

The page is purely static HTML — ~1158 LOC of help / vocabulary /
hotkeys / pipeline reference content. **It is the only in-app user
help.** PAGE5_META carries `{id, stage, label, num:16, static:true}`
which the tab router reads.

**NB**: `HANDOFF_BATCH_5.md` mislabelled help as
"Multi-species comparison page" — that is WRONG. The actual
multi-species cockpit is **multi_species_cockpit**. Don't confuse the two.

## Per-page contracts

`docs/generated/page_contracts/<page_id>/` — every page has a
contract.

## Notes for new contributors

- **cross_species_breakpoints is the second-heaviest layer page** (after multi_species_cockpit's 6
  JSON layers). Loading is a drag-drop affair; cache discipline
  matters.
- **cross_species_breakpoints's Spalax-style TE enrichment is the manuscript hook**.
  If you work on this page, that's the user-facing result to
  preserve.
- **Don't add more pages to this dir under `help` stage** — help
  is unique and shouldn't have siblings. New help pages should
  live in their own `pages/help/` dir if/when they ship.
- **cross_species_breakpoints → stats_profile cross-page dep**: stats_profile (stats profile, in
  `pages/catalogue/`) imports `_csGetSyntenyBlocks` +
  `_csPermutationTest` from cross_species_breakpoints via runtime guards. Round 5
  step 11 promoted these to proper ES exports but stats_profile still
  uses guard imports — promote-to-imports is a follow-up task.
