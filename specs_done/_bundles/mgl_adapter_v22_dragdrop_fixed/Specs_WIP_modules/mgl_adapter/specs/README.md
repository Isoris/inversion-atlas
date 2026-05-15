# SPECS — multi-allelic inversion atlas

This directory holds the specs that arose from a long design conversation
about extending the inversion-detection pipeline to handle tri-allelic
and multi-allelic SNPs, and integrating the result into the
`pca_scrubber_v3` atlas Page-1 candidate mode.

## What's here

| File | Purpose | Use when |
|---|---|---|
| `SPEC_0_master.md` | Full architectural reference (~1200 lines) | Anytime — the canonical source of truth |
| `HANDOFF_1_producer.md` | Build the PCA + heatmap producer | Starting work on the per-window JSON producer |
| `HANDOFF_2_atlas_ui.md` | Build atlas Page-1 candidate mode UI | Starting work on the JS/UI integration |
| `HANDOFF_3_validation.md` | Real-data validation on LG28 | Before committing to producer + atlas, verify multi-allelic adds anything |
| `HANDOFF_4_caching_custom.md` | Custom user views + caching | Polish-tier; build last |
| `HANDOFF_5_tree.md` | Inversion-core haplotype tree (3rd panel) | After PCA + heatmap, for the paper figure and atlas tree panel |
| `HANDOFF_6_fingerprinter.md` | Regime detection + recombinant tract identification | Diagnose double crossovers / nested inversions / adjacent inversions before tree-building |
| `HANDOFF_7_nested_inversion.md` | Nested inversion detection via conditional re-scanning | Test whether candidate contains a second karyotype axis nested inside (top-down stratification) |
| `HANDOFF_8_dosage_clustering.md` | Adaptive dosage-profile clustering (Stickleback-style curves) | Self-defining visualization without K=3 assumption (sample-shape clustering) |
| `HANDOFF_9_dosage_similarity.md` | Dosage similarity matrix + outer/inner block separation | Population-level diagnostic: per-window catfish × catfish similarity, asymmetric subdivision test (pairwise angle) |
| `HANDOFF_10_atlas_similarity.md` | Interactive scrubbable similarity matrix panel | Atlas UI: scroll genome left/right, switch scale (100 kb-1 Mb), lasso/select samples, see matrix update in real time |

## How to use these

**For Claude in a fresh chat**: paste one HANDOFF file as context. Each
is self-contained with the minimum architectural background to start
work, plus pointers to SPEC_0 for the full reference.

**For Quentin returning to the project later**: SPEC_0 is the single
source of truth. The handoffs are slices of it organized by build phase.
If something seems contradictory, SPEC_0 wins.

## Recommended order

1. **HANDOFF 3** (validation) first. Run the pipeline on real LG28 data
   and decide whether multi-allelic is worth integrating into the atlas.
2. **HANDOFF 8** (dosage clustering) early. Per-chromosome scan
   produces Stickleback-style figures that visualize structure
   landscape; per-candidate adaptive K is a sanity check before
   committing to deeper analyses.
3. **HANDOFF 6 Phase 1+2.5+3** (fingerprinter) on the validation
   candidate. Confirms whether the candidate is a single inversion or
   has recombinant tracts / multiple inversions.
4. **HANDOFF 7 Phase 1+2** (nested detector, top-down stratification)
   on validated candidates.
5. **HANDOFF 9 Phase 1+2+3** (dosage similarity matrix, pairwise
   angle) on validated candidates. Produces the per-candidate paper
   figure for nested-architecture cases.
6. **HANDOFF 5 Phase 1+2** (tree) for the paper figure. Use HANDOFF 6's
   recombinant carrier list as `--exclude_samples` for the clean-core
   tree. If HANDOFFs 7/9 find nested structure, optionally re-run tree
   within each stratum.
7. **HANDOFF 1** (producer) if multi-allelic passes validation.
8. **HANDOFF 2** (atlas UI) after the producer is making JSONs.
9. **HANDOFFs 5+6+7+8+9** atlas integration.
10. **HANDOFF 4** (custom views) last, if/when it's useful.

Build chain: validation → dosage curves (overview) → fingerprinter
(architecture: regimes/transitions) → nested detector (architecture:
top-down stratification) → dosage similarity matrix (architecture:
pairwise blocks) → tree (haplotype clades, with carriers excluded) →
multi-allelic atlas integration. The five diagnostic handoffs (5, 6,
7, 8, 9) are partially independent — they catch different signals
from different angles and cross-validate each other.

## What's already done

`mgl_adapter/v5` covers SPEC_0 Sections 1-6 fully:

- ✅ Master Beagle + sidecar adapter
- ✅ Filter (role + 7 numerical thresholds)
- ✅ Weighter (4 modes × 3 stats × power)
- ✅ Rare-pair scanner
- ✅ ANGSD wrapper
- ✅ Driver: 4 views × 2 weighting + 8 PCAngsd + scan + manifest
- ✅ Synthetic test data + end-to-end verification

What remains (Sections 7-11 of SPEC_0) is everything atlas-side: the
producer JSONs, the UI panels, anchor modes, custom views.

## Why three layers

The cardinal architectural decision is:

| Layer | Question | Component |
|---|---|---|
| Master | Is this pair observable? | Adapter (done) |
| View | Is it trustworthy? | Filter (done) |
| Weight | How much does it count? | Weighter (done) |

Master keeps everything. Views filter. Weights downweight low-support
rows so PCA doesn't treat a 4-read pair the same as a 1000-read pair.
PCA itself happens in the producer (HANDOFF 1) on filtered + weighted
input.

## Why anchor modes matter

Standard PCA on different views gives different bases (eigenvectors
rotate). Comparing PC1 of `bi_baseline` to PC1 of `all_pairs` is awkward
because they're in different coordinate systems.

**Anchor 1** fixes the basis using `bi_baseline` eigenvectors and
projects all other views into it. PC axes don't rotate when switching
views; sample positions move along the same axes. Multi-allelic adds
*displacement* relative to biallelic.

**Anchor 2** (view-self) uses each view's own biallelic-equivalent
rows as the basis. For views without `MAJOR_MINOR1`, falls back to
the lowest-rank pair available.

Both are produced; atlas toggles between them. See SPEC_0 Section 7.

## Why no "best pair per site"

Pre-collapsing tri-allelic sites to one pair before PCA does PCA's job
badly. PCA finds variance axes by itself; pre-selecting a pair forces a
projection. A rare-inversion signal lives in MINOR2/MINOR3 rows; a
"best pair" rule based on support stats would systematically discard
exactly those. Keep all pairs; weight by support.

## Why both PCA and heatmap

They're two views of the same dosage matrix. PCA reduces along the
sample axis (eigendecomposition); heatmap displays the matrix directly.
Shared rendering state (sample order, colors, polarity, centering) keeps
them coordinated so switching the view dropdown doesn't scramble the
layout — points move along the same axes, heatmap rows stay in the same
order, only column count changes.

This is "the normal thing that works" — a coordinated dual-panel view
where controls change *what's shown* without scrambling *how it's
organized*.
