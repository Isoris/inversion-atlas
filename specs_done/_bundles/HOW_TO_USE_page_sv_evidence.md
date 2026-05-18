# How to use sv_evidence — SV evidence

**Page**: `sv_evidence` · stage `classification` · label "SV evidence"
**Atlas**: `inversion` (the C. gariepinus 226-cohort atlas)

## What this page does

Read-only **candidate-level view of SV calls** clustered around a
candidate's boundaries, scored against the karyotype groups. The
page loads `json/sv_genotype_counts/<cid>.json` (precomputed by
the cluster-side pipeline) and renders three stacked panels:

1. **SV table** — caller / type / chrom / pos / len / support / gt-counts
2. **UpSet plot** of caller intersections
3. **Dosage heatmap** (per the producer's step-6 spec)

The full schema + classification rules are in
`specs_done/SPEC_sv_evidence_page.md`.

## Architecture: thin loader for an external module

The atlas-side module (`sv_evidence.js`) is a **thin loader
stub**. The actual rendering lives in
`window.AtlasSVEvidence` — an OBJECT with `.init`,
`.loadCandidate(cid)`, and `.destroy()` methods, defined in
`js/atlas_sv_evidence.js` (an external script NOT in the modular
tree).

If `window.AtlasSVEvidence` is missing at mount, the page renders
an explicit fallback message:

> **SV evidence module not loaded**
>
> The `AtlasSVEvidence` renderer ships in `js/atlas_sv_evidence.js`,
> an external script that wasn't included in this build. Drop the
> file alongside `inversion_review.html` and reload to enable this
> page.

This fallback is guarded by `root.__svInitFailed` so it renders
once per page mount.

## Where the pieces live

```
atlases/inversion/
├── pages/review/
│   ├── sv_evidence.html               ← shell — 2 DOM ids only
│   │                                         (#sv_evidence, #sv_evidence_root)
│   ├── sv_evidence.js                 ← thin loader (3 exports)
│   └── sv_evidence/
│       └── _state.js                         ← _pageState + setter
├── engines/producers/sv_evidence/         ← cluster-side producers
│   ├── STEP_SV_GT_AGG_aggregate_genotype_counts.py
│   ├── STEP_SV_EVID_COMB_emit_combinations.py
│   ├── STEP_SV_SUPPORT_emit_support_by_sample.py
│   ├── write_candidate_folder.py            ← shared library
│   ├── run_sv_evidence_pipeline.slurm       ← LANTA wrapper
│   └── README.md                            ← producer-side docs
└── (external — NOT in modular tree)
    └── js/atlas_sv_evidence.js             ← the renderer
```

## DOM (verified — 2 ids only)

| id | role |
|----|------|
| `#sv_evidence` | page wrapper (visibility toggled by router) |
| `#sv_evidence_root` | single inner mount slot — owned by AtlasSVEvidence |

That's it. Everything else inside `#sv_evidence_root` is built by
the external `AtlasSVEvidence` module.

## Lifecycle (verified from `sv_evidence.js`)

| event | what runs |
|-------|-----------|
| `mount()` | calls `showSvEvidencePage(legacyState)` |
| `showSvEvidencePage(state)` | if `window.AtlasSVEvidence` absent → empty-state fallback; else: `mod.init({rootSelector: '#sv_evidence_root'})` (once, guarded by `mod.__pageInitDone`); then `mod.loadCandidate(cid)` if `cid !== mod.__lastCid` |
| `refreshPageSvEvidence(state)` | state-aware wrapper → calls `showSvEvidencePage(state)` |
| `hideSvEvidencePage()` | if `mod.destroy` exists → calls it (errors swallowed) |
| `unmount()` | calls `hideSvEvidencePage()` |

The double-guarding (`__pageInitDone` + `__lastCid`) means:
- `init` runs **once** per page activation, even if `showSvEvidencePage`
  is called multiple times
- `loadCandidate` re-fires **only** when the active candidate's id
  changes

## Per-candidate data file

The producer emits one JSON per candidate at:

```
<data-root>/<chrom>/candidates/<candidate_id>/sv_genotype_counts.json
```

Schema: `sv_genotype_counts_v1` — fully documented in
`specs_done/SPEC_sv_evidence_page.md` §3.4.

Key fields:
- `format_version: "sv_genotype_counts_v1"`
- `candidate_id`, `chrom`, `boundary_left_bp`, `boundary_right_bp`
- `groups_used` — per-group sample lists (H1/H1, H1/H2, H2/H2)
- `sv_calls[]` — per-SV record:
  - `sv_id`, `chrom`, `position_bp`, `end_bp`, `sv_type`,
    `callers`
  - `zone` — `left_flank` | `left_boundary` | `inversion_body` |
    `right_boundary` | `right_flank`
  - `gt_counts` per group (AA / AB / BB / miss)
  - `fisher` — `odds_ratio`, `p_value`, `fdr_bh`
  - `pattern_label` — one of 6 classes (see §3.3 of the SPEC)
- `boundary_summary` — per-side per-SV-type aggregate counts
- `upset_top_combinations` — populated by step 2 (or empty
  fallback if only step 1 ran)

## Pattern labels (per SPEC §3.3)

The producer classifies each SV into one of:

| label | rule (summary; see SPEC for exact thresholds) |
|-------|-------------------------------------------------|
| `canonical_breakpoint_marker` | in a boundary zone, OR ≥ 10, one homozygous group dominates |
| `dominant_presence_marker` | one homozygous group >> the other, zone-agnostic |
| `het_specific_marker` | gates BEFORE FDR — invisible to the H1/H1-vs-H2/H2 contingency by construction |
| `sub_haplotype_marker` | bimodal in one homozygous group |
| `internal_linked_marker` | inversion-body zone with significant OR |
| `uninformative` | FDR ≥ cutoff (default 0.05) and not het-specific |

## How to run

1. **Pick a candidate** — the page reads `state.candidate.id` and
   calls `AtlasSVEvidence.loadCandidate(cid)`. Routes that populate
   `state.candidate`: local_pca_dosage click, candidate_focus prev/next, catalogue row click,
   etc.

2. **Open the SV evidence tab.**

3. If `js/atlas_sv_evidence.js` is loaded, init runs once, the
   `loadCandidate` call fetches the per-candidate JSON, and the
   three panels render in `#sv_evidence_root`.

4. If the external script is missing, you get the fallback empty
   state. Two options:
   - Drop the file in `js/atlas_sv_evidence.js` and reload
   - Migrate the renderer into the modular tree (out of scope for
     this guide — see `_handoff_docs/` for migration notes)

5. **Switch candidates** — `loadCandidate(new_cid)` fires
   automatically on candidate change (guarded by `mod.__lastCid`).

## Producing the data file

If you need to generate `sv_genotype_counts.json` from scratch:

```bash
python3 atlases/inversion/engines/producers/sv_evidence/STEP_SV_GT_AGG_aggregate_genotype_counts.py \
  --vcf /path/to/merged_delly_manta.vcf \
  --candidate /path/to/candidate.json \
  --karyotype /path/to/karyotype.locked_labels.tsv \
  --out-root /path/to/atlas_outputs/sv_evidence
```

Required inputs (per the producer's README):
- `--vcf` or `--tsv` — SV calls (one of: merged VCF with GT field,
  OR tabular TSV with `sv_id chrom position_bp end_bp sv_type
  sample_id GT [quality] [callers]`)
- `--candidate` — JSON with `candidate_id`, `chrom`,
  `boundary_left_bp`, `boundary_right_bp`, optional
  `zone_definitions_bp`
- `--karyotype` — TSV `sample_id <tab> label` where label ∈
  `{HOMO_1, HET, HOMO_2}` (the annotation_cockpit / karyotype_tier lock format)
- `--out-root` — output root

Optional:
- `--fdr-cutoff` (default 0.05)
- `--indent` (default: compact one-line; use 2 for debug)

## State slots used (verified)

| slot | source | meaning |
|------|--------|---------|
| `state.candidate` | cross-atlas | drives `loadCandidate(cid)` |
| `state.candidate.id` | cross-atlas | the per-candidate JSON filename |

That's it — this page is otherwise stateless from the atlas's
perspective. All rendering state lives inside the external
AtlasSVEvidence module.

## Common gotchas

1. **"Empty state says 'SV evidence module not loaded'."** Per
   above — `js/atlas_sv_evidence.js` isn't in the build. Drop the
   file alongside the atlas HTML; it autoloads.

2. **"Module is loaded but `init` keeps re-running."** Check
   `mod.__pageInitDone` — if something resets that flag externally,
   init re-runs. The double-guard convention means
   AtlasSVEvidence itself can be more lax about idempotency.

3. **"`loadCandidate(null)` is called when I clear `state.candidate`."**
   Yes — `cid` becomes `null`, `mod.__lastCid` is whatever the
   previous candidate's id was, so the guard fires. The external
   module is expected to handle `null` by rendering its own
   empty-state.

4. **"Per-SV `pattern_label` says `uninformative` for an SV I know
   is real."** Most likely cause: FDR ≥ `--fdr-cutoff` (default 0.05).
   Re-run the producer with a higher cutoff if you want to inspect
   sub-threshold SVs. Note that `het_specific_marker` deliberately
   bypasses the FDR gate (per SPEC §3.3 rule 1).

5. **"My SV at the boundary got classified as `dominant_presence_marker`
   instead of `canonical_breakpoint_marker`."** The canonical-breakpoint
   rule requires BOTH:
   - `zone` ∈ {`left_boundary`, `right_boundary`}
   - `odds_ratio` ≥ 10 AND clear majority in one homozygous group
     (`f22 ≥ 0.7 AND f11 ≤ 0.1`, or symmetric)

   If OR is between 3 and 10, or the carrier-fraction asymmetry is
   modest, the rule falls through to `dominant_presence_marker`.
   See SPEC §3.3 for the exact decision tree.

## What sv_evidence does NOT do

- **It does NOT compute live** — everything is precomputed by the
  producer pipeline. The atlas reads the JSON. If you want live
  SV aggregation, you'd need to add an endpoint to
  `popstats_server.py` (out of scope for v1).
- **It does NOT refine boundaries** — that's `boundary_refinement`. This page
  shows what SV evidence EXISTS around the boundaries boundary_refinement has
  already produced.
- **It does NOT call breakpoints to base-pair resolution** — same
  vocabulary contract as boundary_refinement: `boundary_zone` is the verdict;
  `exact_breakpoint` requires junction-level evidence (e.g.
  split-read consensus) the producer doesn't claim.
- **It does NOT classify the candidate** — that's karyotype_tier's Tier
  grid. Pattern labels here feed Layer B (SV callers) of the
  14-axis existence-tier on karyotype_tier.

## Related specs

In `specs_done/`:
- `SPEC_sv_evidence_page.md` (the full producer + page contract —
  authored 2026-05-15 from shipped code; §3.3 has the pattern-
  label rule, §3.4 has the JSON schema, §6 has the page lifecycle)
- `SCHEMA.md` §14 (SV evidence schema cross-reference)

## Producer-side docs

`atlases/inversion/engines/producers/sv_evidence/README.md` —
covers the LANTA SLURM workflow, the het-specific marker
explanation, the FDR rationale, and the per-step CLI examples.

## Per-page contract

`docs/generated/page_contracts/sv_evidence/PAGE_CONTRACT.md`

## Cohort discipline

226-sample pure C. gariepinus hatchery only — per the producer's
README: *"Cohort: 226-sample pure C. gariepinus hatchery only (NOT
F1 hybrid; NOT C. macrocephalus wild)."*

---

**Authored**: 2026-05-15 from `pages/review/sv_evidence.js`
(lines 32-48, 127-191) + `pages/review/sv_evidence.html` (2
DOM ids confirmed) + `specs_done/SPEC_sv_evidence_page.md` (the
SPEC authored earlier today from shipped producer code). All
lifecycle behaviour + DOM ids + state slot usage verified against
shipped code.
