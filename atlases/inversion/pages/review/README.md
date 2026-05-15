# `pages/review/` — classification-stage pages

This directory hosts pages for the **classification** workflow
stage — where the user takes a promoted candidate from discovery
and **reviews + refines** it.

(Per legacy naming: this dir is `review` but the manifest stage is
`classification` — which absorbed the legacy refinement +
classification + synthesis stages in the chat-36 stage
consolidation.)

## What classification is for

> "We have a promoted candidate. Now we need to characterize it and
> commit to it as a real call."

The classification stage answers that. The user opens a candidate
on page2 (discovery_2 deep-dive), then walks through the review
pages to:

1. Verify the karyotype assignment (`page4` karyotype sub-view).
2. Read population stats around the candidate (`page6` popstats).
3. Check ancestry confound (`page7` ancestry + `page_ancestry_scroller`).
4. Refine the boundary zones (`page11` boundaries).
5. Inspect SV evidence around the breakpoints (`page_sv_evidence`).
6. Score the candidate on 14 axes (`page4` Tier sub-view).

Once a candidate passes review, it's flipped to `confirmed: true`
(typically on page2) and becomes visible to the inheritance pipeline
+ lines-panel highlights + page9 confirmed carousel.

## Pages in this directory

| page | label | summary |
|------|-------|---------|
| `page4` | karyotype / tier | per-candidate karyotype rows (K=3 H-system locked labels) + 14-axis tier classification grid |
| `page6` | popstats | per-window track stack (\|Z\|, SNP density, BEAGLE uncertainty, depth, θπ, F_ST, Hobs/Hexp, ancestry Δ12); thin loader for `window.renderPopstatsPage` |
| `page7` | ancestry | per-window ancestry view (K-cluster label / Q-value heatmap / Δ12 confidence); thin loader for `window.renderAncestryPage` |
| `page11` | boundaries | boundary-zone refinement (9 scan radii; E/F/B/R/A hotkeys; TE + ncRNA + focal-vs-bg panels) |
| `page_sv_evidence` | SV evidence | per-candidate SV table + UpSet + dosage heatmap; thin loader for `window.AtlasSVEvidence` object |
| `page_ancestry_scroller` | Fish Ancestry Scroller | per-fish ancestry painting with F-based label-switching alignment + ancestry bricks (3 numbered layers + brick-metrics heatmap) |

## Vocabulary contracts (critical)

The review stage has multiple vocabulary contracts that downstream
code depends on:

### Karyotype labels (per `page4/karyo_labels.js`)

K=3 H-system locked labels, ordered by median PC1:

| label | meaning |
|-------|---------|
| `HOMO_1` | homozygous for reference arrangement |
| `HET` | heterozygous |
| `HOMO_2` | homozygous for derived arrangement |

K=3..K=6 detailed vocabularies live in `page4/karyo_labels.js`;
persistence: localStorage.

### Boundary terminology (per `specs_done/SPEC_l2_sweep_inheritance` + page11)

| term | meaning |
|------|---------|
| `boundary_zone` | default verdict — what auto-propose produces |
| `exact_breakpoint` | **reserved** for junction-level evidence only — do NOT use for the boundary-zone output |

### Confirmation flag (per `specs_done/SPEC_l2_sweep_inheritance §6`)

| `confirmed` value | implications |
|-------------------|--------------|
| `false` | candidate visible in review UI; NOT visible in inheritance pills, NOT in lines-panel highlights, NOT in page9 carousel |
| `true` | full visibility everywhere |

### Pattern-label discipline (per `specs_done/SPEC_sv_evidence_page §3.3`)

`het_specific_marker` is classified **before** the FDR gate (it's
invisible to the H1/H1-vs-H2/H2 Fisher test). All other pattern
labels gate on `fdr < fdr_cutoff` (default 0.05).

## Cross-page dependencies

- **page4** reads `state.candidate` (cross_atlas slot) +
  `state.data.final_classification` (the cluster-side 14-axis
  classification keyed by candidate_id) + `state.data.classification`
  (the 4-axis per-layer cluster-emit, per SCHEMA §9)
- **page11** owns the **boundary annotation** that lives on the
  candidate (`state.candidate.boundary_zone`). E/F/B/R/A hotkeys
  install a document-level keydown listener.
- **page_sv_evidence** loads `json/sv_genotype_counts/<cid>.json`
  per candidate; producer pipeline at
  `engines/producers/sv_evidence/` (4 Python scripts).
- **page_ancestry_scroller** consumes `instant_q` (Engine B) per-RF
  output — cluster-side producer integration pending.

## Known registry mismatches (flagged for renumbering round)

Per `pages.registry.json` `_doc` fields:

1. **page4** — declares `candidate_sv_counts + candidate_boundaries`
   but consumes `state.data.final_classification +
   state.data.classification`.
2. **page6** — declares `candidate_gene_cargo + activeCandidate`
   but is chromosome-level (should be `popstats_tracks +
   activeChrom`).
3. **page7** — declares `candidate_marker_primers + activeCandidate`
   but is chromosome-level (should be `ancestry_phase4 +
   activeChrom`).
4. **page11** — declares `candidate_final_class +
   candidate_breeding_card` but consumes boundaries.

**Swap hypothesis**: page4's declared layers may have been swapped
with page11's. Deferred to a renumbering round; do NOT silently
fix because downstream code may rely on the current declaration.

## SPECs relevant to classification

In `specs_done/`:
- `SPEC_sv_evidence_page.md` (page_sv_evidence + producer pipeline)
- `SPEC_review_surfaces_auto_and_lineages.md` (auto-promoted
  candidate review surfaces — dashed CSS + G-panel auto tab)
- `SCHEMA.md` (§9 cluster-emit `classification` layer + §13
  evidence framework + §19 14-axis tier grid + §14 SV evidence
  schema)

In `specs_todo/`:
- `SPEC_fish_ancestry_scroller.md` (page_ancestry_scroller UI v2;
  page registered 2026-05-15 but `model` derivation pipeline still
  pending)
- `SPEC_busco_anchors_v1.md` (page-16 ribbon-plot integration —
  could fold into a future classification-stage SV-evidence
  enrichment view)

## Per-page contracts

`docs/generated/page_contracts/<page_id>/` — every classification
page has a contract.

## Notes for new contributors

- **The 3 thin-loader pages** (page6, page7, page_sv_evidence)
  depend on external `js/atlas_*.js` files NOT inlined in the
  modular tree. When mounted with the external module absent, they
  show empty-state fallback messages. Migrating these into the
  modular tree is a separate task.
- **31 TODO_MISSING helpers in page11** — boundaries page's
  populated path hits these. mount() wraps render in try/catch so a
  cold mount works; full functionality needs a future extraction
  round. Confirmed page11-private (no fold-in opportunities from
  other migrated pages).
- **The review group is the most stage-mismatched** — every page
  here lives in `pages/review/` but the manifest stage is
  `classification`. Don't move files; the stage is authoritative.
