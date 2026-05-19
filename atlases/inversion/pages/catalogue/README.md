# `pages/catalogue/` — catalogue-stage pages

This directory hosts pages for the **catalogue** workflow stage —
cohort-level rollup views once classification is complete. Plus 3
pages whose manifest stage is `classification` but live here on disk.

## What catalogue is for

> "We have a set of classified candidates. Now we need a rollup
> view: catalogue, exports, manuscript bundle, statistical profile,
> marker readiness."

Catalogue answers that. The user works through:

1. **Browse** the full catalogue (`catalogue`).
2. **Walk** through confirmed candidates one at a time (`confirmed_carousel`).
3. **Annotate** with cursor-driven candidate selection (`annotation_cockpit`).
4. **Diagnose** with PCR marker panels (`marker_panels`).
5. **Profile** statistically across the cohort (`stats_profile`).
6. **Plan** marker readiness for breeding (`marker_readiness`).

## Pages in this directory

### Stage `catalogue`

| page | label | summary |
|------|-------|---------|
| `catalogue` | catalogue | sortable / filterable table of L2 envelopes (or L1-merged inversions); Turn-146 breeding-card export pipeline (HTML + JSON, tier-gated) |
| `confirmed_carousel` | confirmed carousel | prev/next walk through `state.candidateList.filter(c => c.confirmed === true)`; reuses candidate_focus's renderer |
| `marker_panels` | marker panels | diagnostic PCR marker panel cards per candidate; activates when `marker_panel_summary` layer ships |
| `annotation_cockpit` | annotation cockpit | per-sample-lines canvas with cursor-driven candidate selection (←/→ + Shift / Esc / 0..9 hotkeys); drives `state.tracked` |

### Stage `classification` (live here for historical reasons)

| page | label | summary |
|------|-------|---------|
| `stats_profile` | stats profile | manuscript synthesis figure — comparative stats profile across cohort (breakpoint context, genomic composition, functional cargo, population variation, breeding burden); cross-page dep on cross_species_breakpoints |
| `marker_readiness` | marker readiness panel | private-indel architecture with 4 tier levels (T1 highest → T4 exploratory); live computes private_score / dosage_score / gel_visibility from `variant_afs.json` |
| `overview` | overview | empty stub (synthesis-stage tab declared but body never shipped even in legacy) |

## Tier hierarchy (marker_readiness, per its module header)

| tier | criterion |
|------|-----------|
| **T1** (highest) | private indel/SNP with clean dosage — `AF_STD ≤ 0.02` AND `AF_HET ∈ [0.25, 0.75]` AND `AF_INV ≥ 0.80` |
| **T2** | multi-marker haplotype panel OR strong-tag with imperfect het |
| **T3** (demoted) | breakpoint PCR candidate — breakpoint precision uncertain |
| **T4** | exploratory |

## Cross-page dependencies

- **confirmed_carousel** reuses **candidate_focus**'s `renderCandidateMetadata` (each
  carousel card is a full candidate_focus detail card).
- **stats_profile** calls **cross_species_breakpoints**'s `_csGetSyntenyBlocks` +
  `_csPermutationTest` (cross-page runtime dep; round 5 step 11
  promoted these from typeof-guarded calls to proper ES exports;
  stats_profile's import-promote is a follow-up task).
- **annotation_cockpit** mutates `state.tracked` which drives **local_pca_dosage**'s
  linkage shading + linkage table.

## Fresh-implementation pages (legacy was HTML shell only)

Three pages in this dir have **no JS heritage from
`legacy/Inversion_atlas.html`** — the HTML shells exist there with
wired IDs but no JS handlers. The current modules are **fresh
implementations**, not verbatim ports:

- **catalogue** — `renderCatalogue` was referenced via typeof guards
  in legacy but never defined. Current implementation in
  `catalogue/catalogue.js`.
- **confirmed_carousel** — confirmed-carousel JS does NOT exist in legacy
  (confirmed by grep). Current in `confirmed_carousel/carousel.js`.
- **negative_regions** lives on disk in `pages/discovery/` but its manifest
  stage is `catalogue` — fresh implementation in
  `pages/discovery/negative_regions/negative_regions.js`.

## SPECs relevant to catalogue

In `specs_done/`:
- `SCHEMA.md` (§10 marker layer column contracts; §19 14-axis
  classification carried over from karyotype_tier)
- `SPEC_l2_sweep_inheritance.md` (the auto-promote pipeline that
  populates `candidateList` — catalogue sorts auto candidates to the
  bottom per `SPEC_review_surfaces_auto_and_lineages`)

In `specs_todo/`:
- `SPEC_arrangement_color_mode_and_arrangement_calls_v1.md` (would
  add an arrangement-color mode to annotation_cockpit's annotation cockpit
  once the `arrangement_calls_v1.json` producer ships)

## Per-page contracts

`docs/generated/page_contracts/<page_id>/` — every catalogue page
has a contract.

## Notes for new contributors

- **annotation_cockpit was mislabelled in HANDOFF_BATCH_3.md** as "Manual
  karyotype groups list" — that is WRONG. Per the line-range check
  in the module header, annotation_cockpit IS the annotation cockpit. Don't
  rename. The handoff label is the bug.
- **overview is empty by design** — legacy never shipped a
  body. Reserved for a future synthesis overview (workflow summary,
  candidate counts per stage, layer-presence checklist). Module
  exists so the page registry has a non-throwing entry.
- **window_summary_table + negative_regions** (negative regions + per-window summary) live
  in `pages/discovery/` but their manifest stage is `catalogue`.
  Don't move files; stage is authoritative.

## Stage discrepancies summary

Of the 9 pages logically in catalogue stage:
- 5 live in `pages/catalogue/` (catalogue, confirmed_carousel, marker_panels, annotation_cockpit, overview where the stage is classification but historically grouped here)
- 3 live in `pages/catalogue/` but have stage=`classification` (stats_profile, marker_readiness, overview)
- 2 live in `pages/discovery/` but have stage=`catalogue` (window_summary_table, negative_regions)

The stage is authoritative for the shell's tab grouping. The dir is historical.
