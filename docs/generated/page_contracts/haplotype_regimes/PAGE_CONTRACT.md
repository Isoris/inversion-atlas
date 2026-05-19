# haplotype_regimes (was haplotype_regimes) — Stage 4 bruteforce projection — Page Capability Contract

**Atlas**: inversion
**Stage**: discovery_2 (round 2)
**Page type**: core_page (pipeline-driven scanner)
**Status**: active
**Bundle source**: `inversion_atlas_v3.4_DROP` (2026-05-08) +
`banding_unified_v3.4_AUDIT_BUNDLE`

## Purpose

Wires the **v3.4 banding pipeline** (Stage 1 seed discovery → Stage 2
cross-seed voting → Stage 3 chain walk → Stage 4 bruteforce
projection) into the atlas-core shell. Hosts the four-canvas
regimes_page (chrom-lanes, chrom-PC1, genome-lanes, genome-PC1) plus
the catalogue-export action bar.

This is the **only page in the atlas that ships its own end-user
user guide** — see `specs_done/_bundles/HOW_TO_USE_haplotype_regimes.md`.

## Capabilities

- Run the full v3.4 banding pipeline on the active chromosome on
  demand (`runBandingPipeline`).
- Visualize the result in 4 panels (2×2 grid):
  - target-band lanes (chrom scope, default)
  - PC1 lines (chrom scope, default)
  - target-band lanes (genome scope, opt-in via `g`)
  - PC1 lines (genome scope, opt-in via `g`)
- Cycle through seed loci with ←/→; cycle band combos with ↑/↓.
- Show a focal-voter selector in the header (which seed band is
  the active voter).
- Tint the "you are here" rectangle on each panel by **dosage class**
  (HOM_REF blue / HET white / HOM_INV red / AMBIGUOUS slate) when a
  `getMacroDosage` callback is wired by the host.
- Export the catalogue as 3 deterministic JSON files (keyed by
  interval_id × cohort_id × reference_id × pipeline_version ×
  knob_hash).

## Pattern class taxonomy

Stage 4 classifies each voter→target pair:

| class | meaning | colour |
|-------|---------|--------|
| `SINGLE` | voter hits one target band cleanly (≥80%) | green |
| `SUBSET` | voter hits 2 bands, each ≥20%, total ≥80% | blue |
| `SPLIT_TWO` | voter splits exactly 2 bands (canonical 50/50) | amber |
| `SUBSET_SPLIT` | voter splits 3+ bands (static classifier) | violet |
| `COHERENT_SPLIT` | 3+ bands AND daughters stable across neighbouring windows (Hungarian-aligned median Jaccard ≥ 0.7) — real sub-structure | pink |
| `RANDOM_FAN` | splits but daughters are unstable — noise | red |
| `SCATTER` | mass diffuse, no concentration | slate |
| `EMPTY` | no overlap or K_target < 2 | near-bg |

Per target locus, Stage 4 runs `consensus_partition` over all set
partitions of the K bands. Output classes: `CLEAN_PARTITION`,
`SOFT_PARTITION`, `AMBIGUOUS_BAND`, `OVERLAPPING_VOTES`,
`MULTI_LAYER_STRUCTURE`, `NO_CLEAN_CONSENSUS`.

## Required data

- **Layers**: `scrubber_main`
- **Slots**: `activeChrom`

## Optional / runtime data

- `getMacroDosage(locus, sample_set)` callback — host-provided; the
  panel doesn't talk to the dosage server directly.

## User interactions

- **Run pipeline button** — fires `runBandingPipeline(ctx, opts)`.
- **Export catalogue button** — `buildCatalogue()` + 3-file download.
- **Hotkeys**:
  - `g` — toggle genome-scope panels
  - `←/→` — cycle seeds
  - `↑/↓` — cycle band combos
- **Focal voter selector** — which seed band is the active voter.

## Outputs

**Preview-only** (recomputed when "run pipeline" is clicked):
- Stage 1 seeds (V-driven seed discovery)
- Stage 2 linkage groups (cross-seed voting)
- Stage 3 stage3_loci (per-band sample-set construction)
- Stage 4 voteRecords + consensus_partition per target
- pattern_class per voter→target pair
- consensus class per target
- dosage class per macro-band

**Committable**:
- **regime catalogue JSON** (cohort-level, 3 files, deterministic
  key)
- **stage3_loci → state.candidateList promotion** (per
  `_handoff_docs/HANDOFF_2026-05-14_seeds_to_candidates_wiring.md`,
  not yet implemented; promote step is manual today)

Commit policy: manual only.

## Three-cohort discipline (critical)

`cohort_id` + `reference_id` are tagged from the active dataset; the
catalogue does **not** aggregate across reference assemblies. F1
hybrid (assembly paper) ≠ 226-sample pure *C. gariepinus* (this
atlas) ≠ pure *C. macrocephalus* wild (future paper).

## Connected analyses / adapters

**Primitives** (in `atlases/inversion/shared/`):
- `per_l2_cluster.js` — `contextFromState`, `ClusterCache` (per-window
  K-means cache that bridges atlas-side state to pipeline ctx)

**Pipeline modules** (in `atlases/inversion/shared/band_tracking/`):
- `banding_pipeline.js` — `runBandingPipeline`,
  `BANDING_PIPELINE_DEFAULTS` (orchestrator)
- `seed_discovery.js` — Stage 1
- `cross_seed_voting.js` — Stage 2
- `locus_construction.js` — Stage 3
- `breadth_voting.js` — Stage 4 driver
- `projection.js` — `classifyProjection` (Stage 4 classifier)
- `regime_catalogue.js` — `buildCatalogue`, `computeKnobHash`
- `dosage_overlay.js` — HOM_REF/HET/HOM_INV classifier

## Sub-modules in `haplotype_regimes/`

| file | purpose |
|------|---------|
| `regimes_page.js` | page wrapper (4 panels + header bar) |
| `regimes_panel.js` | target-band lanes panel; scope-aware (chrom default, genome opt-in) |
| `regimes_pc1_panel.js` | PC1-lines variant — same focal-voter logic, y-axis = PC1 from upstream local PCA |

## Status and known issues

- **Phase 1 only**: LG28 → LG28 (per-chromosome). Genome-wide
  projection (Phase 2/3) needs a chromosomes manifest and a
  registry-cached version of the catalogue.
- **stage3.loci → state.candidateList wiring is the
  `seeds_to_candidates_wiring` HANDOFF** — not yet implemented;
  promotion is a manual step today.
- The annotation, copy-origin painting, and fish ancestry scroller
  layers (Stages 5.5, 5.6, 5.7 in the v3.4 pipeline diagram) are
  all **SPEC ONLY** per their own status lines.

## Calibration target

LG28 prototype 15.115–18.005 Mb, 60/106/60 karyotype.

## Documents

- **Registry doc**: `atlases/inversion/registries/data/pages.registry.json` → `pages.haplotype_regimes._doc`
- **Specs (done)**: `specs_done/SPEC_band_track_extraction_and_l3_single_band_rows.md`
- **Specs (todo)**: `specs_todo/SPEC_regime_annotation_v34.md`,
  `specs_todo/SPEC_copy_origin_painting.md`,
  `specs_todo/SPEC_fish_ancestry_scroller.md`
- **Bundle meta-docs**:
  `specs_done/_bundles/inversion_atlas_v3.4_DROP/{README, HANDOFF}.md`,
  `specs_done/_bundles/banding_unified_v3.4_AUDIT_BUNDLE/{README, HANDOFF}.md`
- **User guide**: `specs_done/_bundles/HOW_TO_USE_haplotype_regimes.md` (rare —
  end-user docs)
- **Handoffs**: `_handoff_docs/HANDOFF_2026-05-14_seeds_to_candidates_wiring.md`
- **Legacy source**: n/a — this page was new in v3.4

**Confidence**: high
