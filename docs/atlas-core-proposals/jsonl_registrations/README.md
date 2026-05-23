# JSONL registrations — for atlas-core's master workflow catalogue brain

**Status**: proposal. Authored 2026-05-23 in response to user
question: *"can we register our workflows in the workflow
orchestrator?"*

These files are the per-atlas equivalents of what the
unified-ancestry session produces for popstats — the four JSONL
blocks that atlas-core's `toolkit_registries/<atlas>/01_registry/`
ingests to surface workflows on the Catalogue (page 4) chrome.

The format is the unified-ancestry-defined format:

| File | Purpose |
|---|---|
| `module_registry.jsonl` | One row per biomod module backing the analyses. All tagged `atlas: "<atlas_id>"`. Columns include `module_name, version, family, atlas, biomod_status, installed, ready, stale, stale_reason, parent, derivatives, last_run_id, ..., biomod_env, synced_at`. |
| `analysis_registry.jsonl` | One row per atomic analysis + one per chain. Columns: `analysis_id, family, label, description, produces, status`. |
| `analysis_modes.jsonl` | Exactly one row per bloc (single stat OR chain). No scope-fanout — scope is a runtime parameter. Columns: `analysis_type, mode, label, module_name, produces, required_dimensions, group_policy, interval_policy, site_policy, value_policy, notes`. |
| `layer_registry.jsonl` | Any output layer ids referenced by `produces`. Columns: `layer_id, source_kind: "analysis_result", entity_type, label, description, status`. |

## `biomod_status` vocabulary

Standard 3-state set used across the 4 atlases:

| status | meaning |
|---|---|
| `installed` | cluster-side producer; runs offline; biomod has the binary + conda env. cross-species's BP_ATLAS scripts are all `installed`. |
| `spec_only` | SPEC exists; producer not yet implemented. Examples: popstats's MSMC, evolution's copy_origin_painting. |
| **`in_browser`** | atlas-side JS module; runs in-page in the browser. **New status added 2026-05-23** to register inversion + evolution analyses that don't have cluster-side producers yet. Drop-in compatible with atlas-core's smoke test (we verified — the 3 constraints don't depend on biomod_status value). Future externalization just flips the status to `installed` + fills in `conda_env_path` / `biomod_env`; the analysis_registry / analysis_modes / layer_registry rows don't need to change. |

## Atlas-core's smoke-test constraints

The unified-ancestry prompt names three hard constraints atlas-core
enforces:

1. Every `analysis_modes.analysis_type` ∈ `analysis_registry.analysis_id`
2. Every `analysis_modes.produces` is single-valued AND ∈ that
   registry row's declared `produces`
3. Every `analysis_modes.module_name` ∈ `module_registry.module_name`

All JSONL files in this proposal satisfy these (verified by
`node`-based cross-validation; see commit history).

---

## Per-atlas coverage

| Atlas | Status | Module count | Analysis count | Chain count | Layer count |
|---|---|---|---|---|---|
| **cross-species** | `installed` — real cluster-side producers (BP_ATLAS + gene-order) | 9 | 8 atomic + 2 chains | 2 chains | 13 |
| **popstats** | mixed: `installed` (popstats_server, regime_*) + `spec_only` (MSMC) | 4 | 4 atomic + 4 chains | 4 chains | 8 |
| **inversion** | `in_browser` — entire haplotype-regimes pipeline runs as atlas-side JS | 11 | 9 atomic + 2 chains | 2 chains | 9 |
| **evolution** | `in_browser` + `spec_only` (copy_origin_painting) — all atlas-side JS | 12 | 11 atomic + 0 chains | 0 chains (the archaeology_synthesis IS the chain at the analysis level) | 10 |
| **TOTAL** | — | 36 | 32 atomic + 8 chains | 8 chains | 40 |

---

## SUGGESTED CHAINS (per user request 2026-05-23)

The `parent` field on each module captures the immediate dependency,
but full chains tell the story better. Atlas-core's catalogue chrome
can use these chains to surface "what must run before X?" and "what
unlocks after X completes?"

### inversion atlas — haplotype-regimes pipeline (in-browser)

**Foundation chain** — always starts from dosage (per-window K-means
on the local-PCA PC1):

```
[upstream: scrubber_main JSON + cohort dosage chunks]
   ↓
local_pca_kmeans                 (per_l2_cluster — Cluster 0)
   ↓
band_quality_scoring              (band_quality, gates seed selection)
   ↓
   ┌──────────────────────────────┐
   ↓ Path A (V-walker)             ↓ Path B (het-skeleton)
seed_discovery_v_walker          het_skeleton_detection
   │                                │
   └──────────────┬─────────────────┘
                  ↓
   breadth_voting                  (Cluster 2 — 5 sub-modules
                                   in projection + vote_evidence +
                                   band_voters + partition_enumerate +
                                   partition_consensus)
                  ↓
   haplotype_regime_refine         (Cluster 3 — arrangement identity)
                  ↓
   regime_topology                 (cross-regime topology)
                  ↓
   genome_scale_aggregation        (on-page subset of genome_scale.js)
                  ↓
   regime_catalogue_serialize      (the catalogue triple — cross-page
                                    contract for evolution + popstats)
```

**Two chain entry points**:
- `banding_pipeline_full` — Path A from V-walker
- `haplotype_regimes_het_mode` — Path B from het-skeleton

Both converge at `breadth_voting` and produce the same
`regime_catalogue_v1` at the end.

### cross-species atlas — sequence + gene-order (cluster-side)

**Sequence chain** (BP_ATLAS):

```
[upstream: haplotype_manifest_CROSSSPECIES.tsv + 18 genome FASTAs]
   ↓
pairwise_wfmash_two_pass          (STEP_BP1; Pass A + Pass B)
   ↓
breakpoint_events                 (STEP_BP2; per-PAF event extraction)
   ↓
breakpoint_zones                  (STEP_BP3; clusters events into zones)
   ↓
breakpoint_reciprocity            (STEP_BP3c; both-anchor validated)
   ↓
   ┌────────────────────────────┐
   ↓                              ↓
breakpoint_paf_arcs             breakpoint_joint_classify
(STEP_BP5; figures)             (STEP_BP6; A-E classification)
```

Chain entry: `bp_atlas_pipeline` (runs STEP_BP1..BP6 via
`run_bp_atlas_LAPTOP.sh` or `SLURM_run_bp_atlas_PARALLEL.sh`).

**Gene-order chain** (independent method family):

```
[upstream: BUSCO single-copy ortholog tables — orthologs_18sp.tsv
            + orthologs_5sp.tsv from macrosyntR .RData]
   ↓
gene_order_breakpoints            (wide_orthologs_to_breakpoints.py;
                                   produces synteny_18sp + synteny_5sp)
   ↓
[parallel: consume bp_atlas_reciprocity_v1 from BP_ATLAS]
   ↓
gene_order_cluster_consolidation  (cluster_breakpoints.py;
                                   tolerance-cluster sweep 500kb→1kb;
                                   cross_method flag)
   ↓
breakpoints_consolidated_v1       (the headline catalogue)
```

Chain entry: `gene_order_consolidation`. **Cross-method validation
requires bp_atlas_pipeline to have completed first** (this is the
critical dependency between the two cross-species chains).

### evolution atlas — per-candidate archaeology (in-browser)

All evolution chains consume `inversion.regime_catalogue_v1` (cross-
atlas read via `bp_atlas_to_hatchery_join` handoff once atlas-core
lands the cohorts registry). Multiple per-candidate chains compose
into a single archaeology synthesis card.

**Age + polarity + integrity → synthesis chain**:

```
[upstream: inversion.regime_catalogue_v1 (cross-atlas read,
            candidate_id selector); crossSpecies.synteny_18sp_v1]
   ↓
age_estimation_busco_4d           (busco_4d_age; per-candidate dxy → age)
   ↓ optional age_model_suggest
   │
   ↓ parallel polarity:
   ┌──────────────────────────────┐
   ↓                                ↓
polarize_synteny_vote           polarize_msa_stacked
(outgroup synteny — reads        (founder consensus + doubleton
crossSpecies.synteny_18sp_v1)    SFS clusters)
   ↓                                ↓
   └──────────────┬─────────────────┘
                  ↓
   inversion_polarity_v1 (verdict from either method or both)
                  +
   mosaicism_leakage (mgl_mosaicism_detector — runs in parallel,
                      no dependency)
                  +
   inv_internal_substructure (sub-PCA — runs in parallel)
                  ↓
   archaeology_synthesis           (mgl_archaeology_classifier —
                                    THE chain entry; pulls together
                                    polarity + age + mosaicism into
                                    one verdict card)
                  ↓
   archaeology_synthesis_v1
```

**Event-tree chain** (per-chromosome, consumes per-candidate ages):

```
[upstream: inversion.regime_catalogue_v1 + multiple
            inversion_age_v1 outputs for the same chromosome]
   ↓
event_tree_order                  (mgl_event_tree — relative ordering)
   ↓
event_tree_v1
```

**Ancestry chain** (separate workflow):

```
[upstream: sample_kinship_matrix (from KING/ngsRelate)]
   ↓
layer_cleaning_kinship            (mgl_kinship_downweight)
   ↓
cleaned_ancestry_layers_v1
```

### popstats atlas — atomic stats + Cluster 4 (mixed)

**Atomic stats** (no chain — single-stat blocs):

```
fst_pairwise   →  fst_windows_v1
theta_pi       →  theta_pi_windows_v1
dxy            →  dxy_windows_v1
tajimas_d      →  tajimas_d_windows_v1
```

Each runs via `popstats_server` with `sample_set` + `interval`
runtime params; scope is NOT a registry row (per the
unified-ancestry "no scope-fanout" rule).

**Inversion-aware popstats chain** (manuscript path B):

```
[upstream: inversion.candidates_v1 + inversion.regime_catalogue_v1
            via cross-atlas read]
   ↓
inversion_karyotypes              (per-sample karyotype call —
                                   homA / het / homB partition)
   ↓
group_set                         (build sample sets per karyotype)
   ↓
inversion_groupwise_popstats      (popstats_server — runs the atomic
                                   stats within each karyotype group
                                   inside the candidate interval)
   ↓
popstats_result_v1
```

**Cluster 4 Mendelian + pedigree chain**:

```
[upstream: inversion.regime_catalogue_v1 + KING-PO kinship edges
            + trios/families/dyads (cohort metadata)]
   ↓
   ┌──────────────────────────────────┐
   ↓ parallel:                          ↓
regime_mendelian_annotation         regime_pedigree_inference
(Method A trios + Method B          (inverse — regime co-membership
families)                            → relatedness verdicts)
   ↓                                    ↓
regime_mendelian_v1                 regime_pedigree_v1
```

**Demography chain (SPEC ONLY)** — per `SPEC_msmc_per_founder_background.md`:

```
[upstream: long-range haplotype regimes from
            inversion.regime_catalogue_v1]
   ↓
regime_sharing_matrix             (compute pairwise regime sharing)
   ↓
founder_groups                    (spectral cluster on sharing matrix)
   ↓
neutral_collinear_callable_mask   (exclude inversions / LRR / ROH /
                                   repeats / low-mappability)
   ↓
clean_msmc_representatives        (per-group unrelated representatives)
   ↓
msmc_per_founder_background       (MSMC2 per group)
   ↓
founder_diversity_validation      (cross-check with π/θ_W/D/LD/FROH)
   ↓
msmc_per_group_v1
```

---

## Cross-atlas chains (the cohort_handoffs view)

Two chains span atlas boundaries via the registered
`cross_reference_handoffs` in atlas-core's `cohorts.registry.json`
(per `SPEC_cohorts_v1`):

### Cross-method headline (cross-species ↔ inversion)

`bp_atlas_pipeline` (cross-species) emits `bp_atlas_reciprocity_v1`
on the F1-hybrid comparative cohort → consumed by
`gene_order_cluster_consolidation` (cross-species) to produce the
cross-method-validated `breakpoints_consolidated_v1` →
coordinate-handoff to inversion-atlas for its own per-candidate
review (inversion never inherits the comparative-cohort claims).

### Inversion → evolution + popstats (regime_catalogue_v1)

`regime_catalogue_serialize` (inversion) emits `regime_catalogue_v1`
on the 226-Cgar hatchery cohort. Both evolution + popstats read this
via same-cohort path (no handoff needed — they all sit on
`cgar_hatchery_226`).

---

## Relationship to per-atlas `workflows.registry.json`

`docs/atlas-core-proposals/SPEC_workflows_v1.md` defined a per-atlas
`workflows.registry.json` schema (JSON form, declared inside each
atlas's `registries/data/`). Each atlas's
`workflows.registry.json` already exists where applicable (cross-
species + popstats; inversion + evolution have stubs).

These JSONL files are the *external-catalogue* projection of that
internal registry — atlas-core's master brain reads JSONL, our
atlases declare JSON. The mapping:

- `workflows.registry.json::workflows[].workflow_id` →
  `analysis_registry.jsonl::analysis_id` (the chain) +
  `analysis_modes.jsonl::analysis_type`
- `workflows.registry.json::workflows[].stages[].script` →
  `module_registry.jsonl::module_name` (basename of script, or JS
  module file)
- `workflows.registry.json::workflows[].stages[].produces` →
  `layer_registry.jsonl::layer_id` + same in `analysis_registry`

The JSONL files in this folder are generated to mirror the
per-atlas JSON. When either changes, regenerate the other.

## How to apply

When atlas-core is touched: copy each
`<atlas>/01_registry/*.jsonl` to atlas-core's
`toolkit_registries/<atlas>/01_registry/`. Run atlas-core's
smoke-test to verify the 3 constraints. The Catalogue (page 4)
chrome will surface the registered workflows automatically.

For `biomod_status: in_browser` modules, atlas-core's chrome should
render them with a tag like *"runs in-browser"* and disable any
"rerun on cluster" affordance until status flips to `installed`.
