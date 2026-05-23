# JSONL registrations — for atlas-core's master workflow catalogue brain

**Status**: proposal. Authored 2026-05-23 in response to user
question: *"can we register our workflows in the workflow
orchestrator?"*

These files are the per-atlas equivalents of what the
unified-ancestry session is producing for popstats — the four JSONL
blocks that atlas-core's `toolkit_registries/<atlas>/01_registry/`
ingests to surface workflows on the Catalogue (page 4) chrome.

The format is the unified-ancestry-defined format:

| File | Purpose |
|---|---|
| `module_registry.jsonl` | One row per biomod module backing the analyses. All tagged `atlas: "<atlas_id>"`. Columns: `module_name, version, family, atlas, biomod_status, installed, ready, stale, stale_reason, parent, derivatives, last_run_id, last_run_status, last_run_qc, last_run_started, last_run_seconds, n_samples, conda_env_path, biomod_env, synced_at`. |
| `analysis_registry.jsonl` | One row per atomic analysis + one per chain. Columns: `analysis_id, family, label, description, produces, status` (single declared `produces` per row). |
| `analysis_modes.jsonl` | Exactly one row per bloc (single stat OR chain). Columns: `analysis_type, mode, label, module_name, produces, required_dimensions, group_policy, interval_policy, site_policy, value_policy, notes`. |
| `layer_registry.jsonl` | Any new output layer ids referenced by `produces`. Columns: `layer_id, source_kind: "analysis_result", entity_type, label, description, status`. |

## Atlas-core's smoke-test constraints

The unified-ancestry prompt names three hard constraints atlas-core
enforces:

1. Every `analysis_modes.analysis_type` ∈ `analysis_registry.analysis_id`
2. Every `analysis_modes.produces` is single-valued AND ∈ that
   registry row's declared `produces`
3. Every `analysis_modes.module_name` ∈ `module_registry.module_name`

All JSONL files in this proposal satisfy these.

## Per-atlas registration coverage

| Atlas | Registered? | Notes |
|---|---|---|
| **cross-species** | YES — full | 9 modules + 10 analyses + 13 layers. Real cluster-side producer workflows (BP_ATLAS + gene-order). See `cross-species/01_registry/`. |
| **popstats** | YES — experimental | 4 modules + 4 atomic stats + 1 chain. Wraps the cluster-side popstats server endpoints (fst, π, dXY, tajimas_d) and the SPEC-stage MSMC chain (`SPEC_msmc_per_founder_background.md`). See `popstats/01_registry/`. |
| **inversion** | NO — in-browser only | The banding pipeline (Clusters 1-3 of the haplotype-regimes pipeline per `docs/PIPELINE_ANALYSIS_ORDER.md`) runs in-page. No cluster-side producers. Atlas-core's workflow brain is for offline producers, so inversion has nothing to register. |
| **evolution** | NO — in-browser only | Age estimation (busco_4d_age, age_model_suggester) runs in-page. No producer workflows declared. |

## Relationship to per-atlas `workflows.registry.json`

`docs/atlas-core-proposals/SPEC_workflows_v1.md` defined a per-atlas
`workflows.registry.json` schema (JSON form, declared inside each
atlas's `registries/data/`). Each atlas's
`workflows.registry.json` already exists for our 4-atlas split.

These JSONL files are the *external-catalogue* projection of that
internal registry — atlas-core's master brain reads JSONL, our
atlases declare JSON. The mapping:

- `workflows.registry.json::workflows[].workflow_id` →
  `analysis_registry.jsonl::analysis_id` (the chain) +
  `analysis_modes.jsonl::analysis_type`
- `workflows.registry.json::workflows[].stages[].script` →
  `module_registry.jsonl::module_name` (basename of script)
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
