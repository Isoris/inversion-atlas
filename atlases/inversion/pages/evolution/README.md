# `pages/evolution/` — evolution-stage pages

This directory hosts pages for the **evolution** workflow stage —
per-candidate evolutionary characterization. All 9 cartridges in
this directory belong to the evolution stage exclusively.

## What evolution is for

> "We have a classified candidate inversion. Now we want to know:
> when did it happen, what's its ancestry, is it leaking
> recombinants, what mechanism formed it, and how does it relate to
> sibling inversions on the same chromosome?"

The evolution stage answers that, per the manifest's stage doc:

> Per-candidate evolution stage: polarize ancestral vs derived
> arrangement, reconstruct founder-like / MRCA-like consensus,
> build haplotype networks of INV chromosomes, estimate age +
> leakage + internal substructure.

## Pages in this directory

| page | label | summary |
|------|-------|---------|
| `page_evolution_polarize_msa` | polarize · MSA | stacked-consensus MSA viewer (outgroup + INV founder-like + INV subgroups by 2D-SFS doubleton + STD) using the dosage-heatmap painter |
| `page_evolution_haplotype_network` | haplotype network | MSN of INV chromosomes — Hamming-radius nodes coloured by 2D-SFS subgroup; force-directed layout |
| `page_evolution_polarize_synteny` | polarize · synteny | per-outgroup-species breakpoint-vote (HOM_A / HOM_B / unresolved) aggregated to an arrangement verdict |
| `page_evolution_age` | age + divergence | π_inv / π_std / dXY / F_ST sparklines + private/fixed counts + age-class verdict |
| `page_evolution_mosaicism` | mosaicism / leakage | per-INV-sample × window leakage heatmap (recombinant-tract / polarity-switch detector) |
| `page_evolution_internal_history` | internal history | sub-PCA on derived-only samples (haplotype clusters / nested rearrangements / sublineages inside INV class) |
| `page_evolution_layer_cleaning` | layer cleaning | per-sample weighting bar (kinship + family-size downweighting + hatchery-duplicate exclusion) |
| `page_evolution_event_tree` | event tree | per-candidate × per-candidate relationship matrix (nested / sister / independent / mutual_exclusive) across multiple inversions on same chromosome |
| `page_evolution_archaeology_card` | archaeology card | Step-6 synthesis card — pulls polarity, age class, integrity, mosaicism, frequency, π/dXY/F_ST, private/fixed, confidence into one verdict |

## Cartridge architecture (uniform across all 9 pages)

Each page is a thin atlas-side cartridge with the following shape:

1. **Entry**: `pages/evolution/<page_id>.js` reads
   `atlasState.inversion.<page_id>_state` (a `model` blob populated
   by the caller; the page does NOT compute upstream primitives).
2. **State module**: `pages/evolution/<page_id>/_state.js` carries
   the standard `_pageState` + `_setActiveState` live binding.
3. **Compute**: delegated to a single `shared/mgl_*.js` primitive
   (see table below). The page calls the primitive on mount + reads
   the result.
4. **Renderer**: canvas-based (some HTML + canvas; see per-page
   contract for which). Most cartridges have a `renderer.js`
   sub-module; the simpler ones (mosaicism, internal_history, etc.)
   render directly from the entry.
5. **Selection**: hover / click selection store in `selection.js`
   (where present).

## Connected primitives (`shared/mgl_*.js` family)

| page | primary primitive |
|------|-------------------|
| `polarize_msa` | `shared/mgl_founder_consensus.js` + `shared/mgl_doubleton_sfs_clusters.js` (feeds `page_dosage_heatmap` painter for the row-stack render) |
| `haplotype_network` | `shared/mgl_haplotype_network.js` |
| `polarize_synteny` | `shared/mgl_outgroup_synteny.js` |
| `age` | `shared/mgl_inversion_divergence.js` (`computeDivergence`) |
| `mosaicism` | `shared/mgl_mosaicism_detector.js` |
| `internal_history` | `shared/mgl_pca_compute.js` (`pcaForWindow`) |
| `layer_cleaning` | `shared/mgl_kinship_downweight.js` |
| `event_tree` | `shared/mgl_event_tree.js` |
| `archaeology_card` | `shared/mgl_archaeology_classifier.js` |

## Input contracts (per cartridge)

Every cartridge reads `atlasState.inversion.<page>_state`. Shape
varies per page, but the standard fields are:

```
{
  dosage:           Float64Array | Array<Float64Array>,
  n_markers, n_samples,
  inv_idx:          number[]   INV-class sample indices
  std_idx?:         number[]   STD-class sample indices
  outgroup_idx?:    number[]   outgroup sample indices
  sample_labels?:   string[]
  candidate_label?: string,
  opts?:            object,    page-specific options
  view_state?:      object,    page-specific view controls
}
```

See `docs/generated/page_contracts/<page_id>/PAGE_CONTRACT.md` for
the per-page input contract.

## Outputs

**All 9 pages are read-only** — no committable outputs. Selection
stores are in-memory; the next time the page mounts on the same
candidate, the selection resets. The cartridges are pure inspectors.

## Pipeline order

Per the v3.4 pipeline diagram (in
`specs_done/_bundles/inversion_atlas_v3.4_DROP/README.md` +
`specs_done/_bundles/banding_unified_v3.4_AUDIT_BUNDLE/README.md`),
the evolution-stage pages occupy Stages 5+ after Stage 4's bruteforce
projection:

```
Stage 5.0 Polarization        →  page_evolution_polarize_msa
                                 page_evolution_polarize_synteny
Stage 5.1 Founder reconstruct →  (reuses Stage 5.0 founder consensus)
Stage 5.2 Haplotype network   →  page_evolution_haplotype_network
Stage 5.3 Internal history    →  page_evolution_internal_history
Stage 5.4 Layer cleaning      →  page_evolution_layer_cleaning
Stage 5.5 Age + divergence    →  page_evolution_age
Stage 5.6 Mosaicism           →  page_evolution_mosaicism
Stage 5.7 Event tree          →  page_evolution_event_tree
Stage 6   Archaeology card    →  page_evolution_archaeology_card
```

Pipeline stages 5.5/5.6/5.7 in the original v3.4 diagram (the
annotation layer, copy-origin painting, fish ancestry scroller)
are SPEC ONLY per their own status lines — the v3.4 pipeline's
"awaiting audit before implementation" group.

## SPECs relevant to evolution

In `specs_done/`:
- `SCHEMA.md` (§13 evidence framework — populated by the
  archaeology card)

In `specs_todo/`:
- `SPEC_regime_annotation_v34.md` (Stage 5.5 from the v3.4 drop —
  SPEC ONLY)
- `SPEC_copy_origin_painting.md` (Stage 5.6 — SPEC ONLY)
- `SPEC_fish_ancestry_scroller.md` (Stage 5.7 — partial; the
  page is now registered as `page_ancestry_scroller` in the
  classification stage, NOT evolution)
- `SPEC_inversion_age_atlas_surface_AMENDMENT.md` (parent SPEC
  missing on disk — flagged in `_handoff_docs/SPECS_AUDIT.md`)

## Per-page contracts

`docs/generated/page_contracts/<page_id>/` — every evolution page
has a contract.

## Notes for new contributors

- **None of these pages are in `pages.registry.json` originally**
  — they were added 2026-05-15 by porting the page contracts'
  purpose statements into `pages.registry.json`. So if you read
  legacy / pre-2026-05-15 docs, you might see "evolution pages
  not in pages.registry.json"; that's now fixed.
- **All evolution cartridges are Phase 1** — they implement the
  minimum viable visualisation per HANDOFF_5 / 6 / 7 / 8 / SPEC_0.
  Phase 2 work (cross-panel linkage, real-coordinate axes, more
  control surfaces) is deferred.
- **Confidence in the page contracts**: 4 of 9 are `high`, 5 of 9
  are `medium` — the medium ones have single-file subdirs
  (`_state.js` only) so verification was limited. If you work on
  one of these, update the contract's confidence as you learn more.
