# Stage assignment audit — 2026-05-18

User concern (chat 2026-05-18): "audit each page because I think that
we are mixing evolution and inversion detection."

The audit confirms it. 8 pages sit in the wrong stage; 1 stage
(`comparative`, 2 pages) is redundant with `evolution`; 1 stage
(`synthesis`) is missing from the manifest even though `overview`'s
own `_doc` says that's its legacy origin.

Below: per-page verdict, evidence from `_doc`, and proposed re-stage.

## TL;DR re-stage table

| page | now | propose | reason |
|---|---|---|---|
| `ancestry_per_window` | classification | **evolution** | per-fish ancestry from NGSadmix; canonical evolution question |
| `fish_ancestry_scroller` | classification | **evolution** | per-fish ancestry brick painting; same |
| `boundary_refinement` | classification | **discovery_2** | refines a candidate's start_bp/end_bp; detection-refinement, not classification |
| `sv_evidence` | classification | **discovery_2** | per-candidate SV-call evidence; supports "is this a real inversion?" |
| `popstats` | classification | **synthesis** *(new)* | per-window pop-gen stack (|Z|, π, F_ST, Hobs); cohort-level summary, not per-candidate classification |
| `stats_profile` | classification | **synthesis** | manuscript-level inversion stats; `_doc` literally says "Statistical profile of inversion-associated genomic features" |
| `overview` | classification | **synthesis** | `_doc` says legacy stage was synthesis ("data-page='overview' data-stage='synthesis'") — the slug rename put it in classification by accident |
| `cross_species_breakpoints` | comparative | **evolution** | cross-species rearrangements ARE evolution; only 1 page left in `comparative` after this |
| `multi_species_cockpit` | comparative | **evolution** | as above; drops `comparative` stage entirely |
| `annotation_cockpit` | catalogue | classification *(optional)* | per-candidate tag/annotation; borderline. Could stay in catalogue. |

Net: drop `comparative` (now empty), add `synthesis` (3 pages),
populate `evolution` with 4 more pages (total 13), shrink
`classification` from 9 → 3–4.

## Per-page evidence

### Should move OUT of `classification`

**ancestry_per_window** (now: classification → propose: evolution)

> "Per-window ancestry view for the active chromosome. Reuses the
> popstats stack architecture (canvas tracks gated by chip toggles in
> #ancViewChips). Three view chips: K-cluster label (per-window
> argmax-Q assignment), Q-value heatmap (top-1 ancestry component
> intensity), delta12 …"

Ancestry analysis. Q-values come from NGSadmix. This is the
canonical *"which population did each haplotype come from?"*
question — pure post-detection evolutionary biology. Should sit
next to `polarize_msa_stacked` and `haplotype_network`.

**fish_ancestry_scroller** (now: classification → propose: evolution)

> "Layer 1: PC1 Band per fish. Layer 2: Ancestry Bricks per fish (six
> color modes; derived simplification of RFs merged into bricks …"

Same — RF (Risers/Fall = ancestry deconvolution) brick painting.
Per-fish ancestry visualization. Belongs with the evolution stack.

**boundary_refinement** (now: classification → propose: discovery_2)

> "Refines a promoted candidate's [start_bp, end_bp] into approximate
> left/right boundary zones using multiple evidence tracks. Auto-
> propose runs the BOUNDARY_TRACK_WEIGHTS-weighted algorithm …"

Refining the bp coordinates of a detected candidate. That's
detection workflow, not classification. Sits between
`candidate_focus` and `catalogue` in the natural flow: detect →
focus → refine boundaries → catalogue.

**sv_evidence** (now: classification → propose: discovery_2)

> "Read-only candidate-level view of SV calls clustered around a
> candidate's boundaries, scored against the karyotype groups. Loads
> json/sv_genotype_counts/<cid>.json per candidate …"

Supports the question *"is this region really an inversion?"* (vs
some other SV class). That's detection-supporting, not
classification of the karyotype. Belongs in `discovery_2` next to
`candidate_focus`.

**popstats** (now: classification → propose: synthesis)

> "Per-window popstats track stack for the active chromosome. … |Z|,
> SNP density, BEAGLE imputation uncertainty, depth/coverage,
> theta_pi (per-window Tajima pi), F_ST (between karyotype groups),
> Hobs/Hexp"

Not per-candidate classification — it's a chromosome-wide pop-gen
summary. Several tracks (F_ST between karyotype groups, Hobs/Hexp)
ARE downstream of classification, but the panel as a whole is a
synthesis surface, not the "what kind of inversion?" surface.

**stats_profile** (now: classification → propose: synthesis)

> "Statistical profile of inversion-associated genomic features.
> Comparative summary of breakpoint context, genomic composition,
> functional cargo, population variation, and breeding-relevant
> burden across parental catfish genomes."

The doc literally calls it a "statistical profile" — manuscript-
level synthesis. Belongs with `overview`.

**overview** (now: classification → propose: synthesis)

> "Synthesis-stage tab declared but EMPTY in legacy/Inversion_atlas.html.
> Tab button at legacy line 5138 (data-page='overview' data-stage='synthesis')"

The page's own `_doc` records that the LEGACY stage was `synthesis`.
Current `classification` is a misclassification from the rename
sweep — needs to go back to its declared stage.

### Drop the `comparative` stage

**cross_species_breakpoints** (now: comparative → propose: evolution)

> "Cross-species comparative dashboard for chromosome-scale
> rearrangements between Cgar and Cmac, derived from a wfmash 1-to-1
> alignment …"

Cross-species evolution. Belongs in `evolution`.

**multi_species_cockpit** (now: comparative → propose: evolution)

> "Multi-species classification cockpit. Place each Cgar<->Cmac
> breakpoint on the catfish phylogeny …"

Same — places breakpoints on a phylogeny. Pure evolution.

With both moved, `comparative` becomes empty and should be removed
from the stage list in `manifest.json` (release the 2.5 ordering
slot for re-use).

### Edge cases worth flagging (no proposed change)

**annotation_cockpit** (now: catalogue, borderline classification)

Per-candidate annotation — could read as `catalogue` (storage/browse
of confirmed candidates) or `classification` (per-candidate tagging).
The catalogue framing is fine; leaving as-is.

**marker_readiness** (now: classification, stays)

Tiered markers for genotyping. Stays in classification — it IS
per-candidate ("does this candidate have a clean marker set?").

**confirmed_carousel** (now: catalogue, stays)

Walks the confirmed list. Catalogue is correct.

## Proposed final stage map

| stage | pages | count |
|---|---|---|
| `discovery` | local_pca_dosage, local_pca_theta_pi, local_pca_ghsl | 3 |
| `discovery_2` | candidate_focus, haplotype_regimes, pca_comparator, **boundary_refinement**, **sv_evidence** | 5 |
| `catalogue` | catalogue, window_summary_table, negative_regions, confirmed_carousel, marker_panels, annotation_cockpit | 6 |
| `classification` | karyotype_tier, marker_readiness | 2 |
| `evolution` | polarize_msa_stacked, haplotype_network, polarize_synteny_vote, age_divergence, mosaicism_leakage, inv_internal_substructure, layer_cleaning, event_tree_relative_ordering, archaeology_synthesis_card, **ancestry_per_window**, **fish_ancestry_scroller**, **cross_species_breakpoints**, **multi_species_cockpit** | 13 |
| `synthesis` *(new)* | overview, stats_profile, popstats | 3 |
| `tooling` | tree_panel, fingerprint_track, similarity_matrix, pca_scatter_per_window, dosage_heatmap, nested_inversion_detector, dosage_cluster_adaptive_k | 7 |
| `help` | help | 1 |

Total: 40 (was 40 — adds pca_comparator from a few commits ago).

`comparative` stage removed.

`classification` shrinks dramatically (9 → 2). That's actually
correct — most of what got dumped in there was either
detection-refinement, ancestry, or synthesis, none of which is
"figure out the karyotype of a per-candidate carrier set". The 2
that remain (`karyotype_tier`, `marker_readiness`) ARE the actual
classification surfaces.

## What shipping this looks like

1. Update `atlases/inversion/manifest.json`: stage field on each
   moved page (8 pages).
2. Remove the `comparative` stage entry from the manifest's stages
   list (if it has one — verify).
3. Add `synthesis` to the stages list with its ordering slot.
4. Update `atlases/inversion/registries/data/pages.registry.json`:
   matching stage updates on the same 8 pages.
5. Update per-page `docs/generated/page_contracts/<id>/page.manifest.json`
   if they have a `stage` field.
6. Update cross-refs in READMEs (`pages/discovery/README.md`,
   `pages/review/README.md` etc.) and `docs/generated/PAGE_CONTRACT_INDEX.md`.

No code-behaviour change. Tests don't read stage. The user-visible
change is the tab grouping in the atlas-core shell — discovery
pages stay clustered, evolution pages get 4 more, classification
shrinks to 2.

## Why this matters

The 5-stage workflow user mental model is:

1. **Discover** an inversion (scanners)
2. **Confirm + refine** boundaries (focus, sv_evidence, boundary refinement)
3. **Catalogue** the result
4. **Classify** carriers (karyotype + markers)
5. **Synthesise + study evolution** (everything downstream — ancestry,
   age, polarization, manuscript figures)

Today the manifest fuses steps 4 and 5 (`classification` carries
both real classification AND ancestry AND manuscript synthesis),
which is exactly what the user noticed.

After the re-stage, the tab grouping matches the workflow:
discovery → discovery_2 → catalogue → classification (very narrow)
→ evolution (broad) → synthesis (publication-ready).
