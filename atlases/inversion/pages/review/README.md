# `pages/review/` — disk dir hosting pages now spread across 4 stages

This directory hosts pages whose source still lives on disk under
`pages/review/` for historical reasons, but whose manifest stages
diverged after the 2026-05-18 stage re-org (`STAGE_AUDIT_2026-05-18.md`).
The `review` dir name no longer matches a single manifest stage — see
the per-page stage column below for the current routing.

(Same dir/stage divergence pattern as `pages/discovery/page8`, which
lives there for historical grouping but routes under `catalogue`.)

## What each page does after the re-org

| page | manifest stage | label | summary |
|------|----------------|-------|---------|
| `karyotype_tier` | classification | karyotype / tier | per-candidate karyotype rows (K=3 H-system locked labels) + 14-axis tier classification grid |
| `marker_readiness` | classification | marker readiness | private-indel architecture tiers (1–4) for genotyping-marker design |
| `boundary_refinement` | discovery_2 | boundaries | boundary-zone refinement (9 scan radii; E/F/B/R/A hotkeys; TE + ncRNA + focal-vs-bg panels) |
| `sv_evidence` | discovery_2 | SV evidence | per-candidate SV table + UpSet + dosage heatmap; thin loader for `window.AtlasSVEvidence` object |
| `ancestry_per_window` | evolution | ancestry | per-window ancestry view (K-cluster label / Q-value heatmap / Δ12 confidence); thin loader for `window.renderAncestryPage` |
| `fish_ancestry_scroller` | evolution | Fish Ancestry Scroller | per-fish ancestry painting with F-based label-switching alignment + ancestry bricks (3 numbered layers + brick-metrics heatmap) |
| `popstats` | synthesis | popstats | per-window track stack (\|Z\|, SNP density, BEAGLE uncertainty, depth, θπ, F_ST, Hobs/Hexp, ancestry Δ12); thin loader for `window.renderPopstatsPage` |

## Why pages diverged across stages

The stage audit (`_handoff_docs/STAGE_AUDIT_2026-05-18.md`) flagged
that the original `review`-as-`classification` grouping conflated
three distinct workflow concerns:

- **Detection refinement** — `boundary_refinement` + `sv_evidence`
  answer *"is this region really an inversion, and where exactly?"*.
  That's late-detection, not classification of a confirmed candidate.
  → moved to `discovery_2`.
- **Ancestry analysis** — `ancestry_per_window` + `fish_ancestry_scroller`
  ARE evolution. They answer *"where did each haplotype come from?"*
  → moved to `evolution`.
- **Cohort synthesis** — `popstats` is a chromosome-wide pop-gen
  summary, not per-candidate classification.
  → moved to `synthesis`.

`classification` shrank from 9 pages to just `karyotype_tier` +
`marker_readiness`, which is the workflow-correct scope: classify the
karyotype of a per-candidate carrier set, then design the markers.

The 5 review-stage entries that legacy used (refinement,
classification, synthesis) are recovered across this disk dir and
the new stages.


## Vocabulary contracts (critical)

The review stage has multiple vocabulary contracts that downstream
code depends on:

### Karyotype labels (per `karyotype_tier/karyo_labels.js`)

K=3 H-system locked labels, ordered by median PC1:

| label | meaning |
|-------|---------|
| `HOMO_1` | homozygous for reference arrangement |
| `HET` | heterozygous |
| `HOMO_2` | homozygous for derived arrangement |

K=3..K=6 detailed vocabularies live in `karyotype_tier/karyo_labels.js`;
persistence: localStorage.

### Boundary terminology (per `specs_done/SPEC_l2_sweep_inheritance` + boundary_refinement)

| term | meaning |
|------|---------|
| `boundary_zone` | default verdict — what auto-propose produces |
| `exact_breakpoint` | **reserved** for junction-level evidence only — do NOT use for the boundary-zone output |

### Confirmation flag (per `specs_done/SPEC_l2_sweep_inheritance §6`)

| `confirmed` value | implications |
|-------------------|--------------|
| `false` | candidate visible in review UI; NOT visible in inheritance pills, NOT in lines-panel highlights, NOT in confirmed_carousel carousel |
| `true` | full visibility everywhere |

### Pattern-label discipline (per `specs_done/SPEC_sv_evidence_page §3.3`)

`het_specific_marker` is classified **before** the FDR gate (it's
invisible to the H1/H1-vs-H2/H2 Fisher test). All other pattern
labels gate on `fdr < fdr_cutoff` (default 0.05).

## Cross-page dependencies

- **karyotype_tier** reads `state.candidate` (cross_atlas slot) +
  `state.data.final_classification` (the cluster-side 14-axis
  classification keyed by candidate_id) + `state.data.classification`
  (the 4-axis per-layer cluster-emit, per SCHEMA §9)
- **boundary_refinement** owns the **boundary annotation** that lives on the
  candidate (`state.candidate.boundary_zone`). E/F/B/R/A hotkeys
  install a document-level keydown listener.
- **sv_evidence** loads `json/sv_genotype_counts/<cid>.json`
  per candidate; producer pipeline at
  `engines/producers/sv_evidence/` (4 Python scripts).
- **fish_ancestry_scroller** consumes `instant_q` (Engine B) per-RF
  output — cluster-side producer integration pending.

## Known registry mismatches (flagged for renumbering round)

Per `pages.registry.json` `_doc` fields:

1. **karyotype_tier** — declares `candidate_sv_counts + candidate_boundaries`
   but consumes `state.data.final_classification +
   state.data.classification`.
2. **popstats** — declares `candidate_gene_cargo + activeCandidate`
   but is chromosome-level (should be `popstats_tracks +
   activeChrom`).
3. **ancestry_per_window** — declares `candidate_marker_primers + activeCandidate`
   but is chromosome-level (should be `ancestry_phase4 +
   activeChrom`).
4. **boundary_refinement** — declares `candidate_final_class +
   candidate_breeding_card` but consumes boundaries.

**Swap hypothesis**: karyotype_tier's declared layers may have been swapped
with boundary_refinement's. Deferred to a renumbering round; do NOT silently
fix because downstream code may rely on the current declaration.

## SPECs relevant to classification

In `specs_done/`:
- `SPEC_sv_evidence_page.md` (sv_evidence + producer pipeline)
- `SPEC_review_surfaces_auto_and_lineages.md` (auto-promoted
  candidate review surfaces — dashed CSS + G-panel auto tab)
- `SCHEMA.md` (§9 cluster-emit `classification` layer + §13
  evidence framework + §19 14-axis tier grid + §14 SV evidence
  schema)

In `specs_todo/`:
- `SPEC_fish_ancestry_scroller.md` (fish_ancestry_scroller UI v2;
  page registered 2026-05-15 but `model` derivation pipeline still
  pending)
- `SPEC_busco_anchors_v1.md` (page-16 ribbon-plot integration —
  could fold into a future classification-stage SV-evidence
  enrichment view)

## Per-page contracts

`docs/generated/page_contracts/<page_id>/` — every classification
page has a contract.

## Notes for new contributors

- **The 3 thin-loader pages** (popstats, ancestry_per_window, sv_evidence)
  depend on external `js/atlas_*.js` files NOT inlined in the
  modular tree. When mounted with the external module absent, they
  show empty-state fallback messages. Migrating these into the
  modular tree is a separate task.
- **31 TODO_MISSING helpers in boundary_refinement** — boundaries page's
  populated path hits these. mount() wraps render in try/catch so a
  cold mount works; full functionality needs a future extraction
  round. Confirmed boundary_refinement-private (no fold-in opportunities from
  other migrated pages).
- **The review group is the most stage-mismatched** — every page
  here lives in `pages/review/` but the manifest stage is
  `classification`. Don't move files; the stage is authoritative.
