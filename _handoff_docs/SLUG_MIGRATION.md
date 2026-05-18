# SLUG MIGRATION — page id → slug rollover plan

**Date**: 2026-05-16
**Status**: Stage 1 shipped (slug field on every page in
`manifest.json`); Stage 2-4 pending.

## Why this exists

User-reported pain (`AUDIT_local_pca_merge_vs_rename.md` §Q2):

> "rename page 1 and every number by simply the name of the page bc
> I don't know what is what."

Numeric ids (`page1`, `page12`, `page16b`, etc.) are opaque. They
caused real bugs:
- page21 mislabelled "Manual karyotype groups" in HANDOFF_BATCH_3
  (it's the annotation cockpit)
- page5 mislabelled "Multi-species comparison" (it's the help page;
  the actual multi-species cockpit is page16b)
- The page4 / page6 / page7 / page11 swap-hypothesis registry
  mismatches partly come from numeric confusion

Self-documenting slugs solve this:
`#inversion/local_pca_dosage` is unambiguous; `#inversion/page1`
requires a lookup.

## What stage 1 shipped

Every page entry in `atlases/inversion/manifest.json` now carries a
`slug` field alongside its existing `id`:

```json
{
  "id": "page22",
  "slug": "haplotype_regimes",
  "label": "haplotype regimes",
  "stage": "discovery_2",
  ...
}
```

39 / 39 pages have slugs. The `id` field is unchanged (still the
authoritative routing key for now); the `slug` is informational
until Stage 4 flips the primary route.

No DOM ids changed, no file paths changed, no DOM selectors broke,
no tests fail.

## The full slug vocabulary (locked 2026-05-16)

| current id | slug | rationale |
|---|---|---|
| `page1` | `local_pca_dosage` | the big page — dosage local PCA scanner |
| `page12` | `local_pca_theta_pi` | sister scanner driven by θπ |
| `page15` | `local_pca_ghsl` | third evidence axis (GHSL) |
| `page2` | `candidate_focus` | per-candidate deep dive |
| `page22` | `haplotype_regimes` | v3.4 banding pipeline runner |
| `page4` | `karyotype_tier` | review-stage 2-tab page |
| `page6` | `popstats` | popstats track stack |
| `page7` | `ancestry_per_window` | per-window ancestry view |
| `page11` | `boundary_refinement` | boundary zone refinement |
| `page_sv_evidence` | `sv_evidence` | (drop the `page_` prefix) |
| `page_ancestry_scroller` | `fish_ancestry_scroller` | per-fish ancestry painting |
| `page3` | `catalogue` | L2 envelopes table |
| `page9` | `confirmed_carousel` | walk through confirmed candidates |
| `page10` | `marker_panels` | diagnostic PCR marker cards |
| `page17` | `stats_profile` | manuscript synthesis figure |
| `page18` | `marker_readiness` | private-indel tier panel |
| `page21` | `annotation_cockpit` | per-sample lines + cursor-driven candidate selection |
| `page8` | `window_summary_table` | per-window \|Z\| / λ / SNP counts |
| `page19` | `negative_regions` | complement of catalogue |
| `page_overview` | `overview` | synthesis-stage overview (empty stub) |
| `page16` | `cross_species_breakpoints` | Cgar × Cmac wfmash |
| `page16b` | `multi_species_cockpit` | catfish phylogeny classifier |
| `page5` | `help` | static help page |
| `tree_panel` | `tree_panel` | NJ sample tree |
| `fingerprint_track` | `fingerprint_track` | diversity-regime fingerprint |
| `similarity_matrix` | `similarity_matrix` | sample × sample heatmap |
| `pca_scatter_per_window` | `pca_scatter_per_window` | per-window PC1×PC2 |
| `dosage_heatmap` | `dosage_heatmap` | sample × marker dosage heatmap |
| `nested_inversion_detector` | `nested_inversion_detector` | 3-stratum detector |
| `dosage_cluster_adaptive_k` | `dosage_cluster_adaptive_k` | adaptive-K clustering |
| `polarize_msa_stacked` | `polarize_msa_stacked` | stacked-consensus MSA |
| `haplotype_network` | `haplotype_network` | MSN of INV chromosomes |
| `polarize_synteny_vote` | `polarize_synteny_vote` | per-outgroup vote |
| `age_divergence` | `age_divergence` | π / dXY / F_ST / private |
| `mosaicism_leakage` | `mosaicism_leakage` | recombinant-tract detector |
| `inv_internal_substructure` | `inv_internal_substructure` | sub-PCA on derived |
| `layer_cleaning` | `layer_cleaning` | kinship downweighting |
| `event_tree_relative_ordering` | `event_tree_relative_ordering` | cross-candidate ordering |
| `archaeology_synthesis_card` | `archaeology_synthesis_card` | Step-6 verdict |

## What stages 2-4 will do (NOT YET SHIPPED)

### Stage 2: per-page rename, one at a time

For each page (in priority order — user-stated priority is
`page22 → haplotype_regimes` first):

1. **Manifest**: id → slug (swap)
2. **`pages.registry.json`**: top-level key rename
3. **File paths**: `pages/<stage>/page<N>.{html,js}` →
   `pages/<stage>/<slug>.{html,js}`; same for the `page<N>/` subdir
4. **DOM ids**: `#page<N>`, `#page<N>Inner`, `#page<N>Header`, etc.
   → `#<slug>`, `#<slug>Inner`, `#<slug>Header`
5. **CSS selectors**: `.page#page<N>.active`, `main#page<N>`, etc.
   → match the new DOM ids
6. **Page contracts**: `docs/generated/page_contracts/page<N>/` →
   `<slug>/`
7. **Tests**: `tests/test_discovery_page<N>.js` →
   `test_discovery_<slug>.js`; same for smoke tests
8. **HOW_TO_USE docs**: `specs_done/_bundles/HOW_TO_USE_page<N>.md`
   → `HOW_TO_USE_<slug>.md`
9. **SPEC cross-refs**: every reference to `page<N>` in SPECs +
   per-stage READMEs → use the slug
10. Verify all tests pass after each rename.

Per-page rename cost: ~2-4 focused hours, shippable as one PR per
page (for easy review + revert).

### Stage 3: bulk continue — rename remaining ~37 pages

Same recipe × 37. Schedule at user's pace, no rush. Each rename is
a separate PR for review independence.

### Stage 4: deprecate `id`

Once all pages have been renamed:
1. Drop the `id` field from `manifest.json` entries
2. Drop the legacy id-based routing in atlas-core shell (if it
   honours `id` over `slug` today)
3. Remove this doc's transition notes; the slug is now canonical

## Tomorrow's recommended first rename: `page22` → `haplotype_regimes`

The user said:
> "we can work easily on the haplotype regime page later"

So `page22` is the priority rename. It's also:
- **Mid-complexity**: 1 entry file + 3-module subdir + 1 HOW_TO_USE
  doc + 1 SPEC reference + 1 page contract
- **Well-documented**: full SPEC at
  `specs_done/SPEC_band_track_extraction_and_l3_single_band_rows.md`
  (parent) + per-Slice handoffs + bundle museum
- **Tested**: `tests/test_discovery_page22.js` + smoke test

Practice run before bulk renames.

## Decision log

- **Why not flip the route now (Stage 4 immediately)?** The atlas-
  core shell routes by `id`. Until the shell is updated to honour
  `slug` (or we ship a one-line equivalence in the cartridge), the
  `id` field MUST stay for the shell to find pages. Stage 1 (this
  shipment) adds slug informationally without breaking anything.
- **Why not rename DOM ids now?** Same reason — page-level scripts
  + CSS reference DOM ids. Renaming everything atomically is risky;
  per-page renames let us verify each one works before moving on.
- **Why not just URL-redirect from id to slug?** Atlas-core shell
  change. Same blocker. The cartridge can't unilaterally change
  routing logic. When the shell ships a "accept either id or slug"
  patch, both URL forms work; until then `#page1` is what the
  shell understands.

## References

- Audit doc (Q2): `_handoff_docs/AUDIT_local_pca_merge_vs_rename.md`
- Manifest: `atlases/inversion/manifest.json`
- Page contracts: `docs/generated/page_contracts/<page_id>/` (still
  keyed by id; will rename in Stage 2)
- HOW_TO_USE docs: `specs_done/_bundles/HOW_TO_USE_<page_id>.md`
  (likewise; rename in Stage 2)
- Tests: `tests/test_discovery_page<N>.js`,
  `tests/smoke_discovery_page<N>_round5.mjs` (likewise)
