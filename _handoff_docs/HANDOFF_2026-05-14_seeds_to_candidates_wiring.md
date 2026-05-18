# HANDOFF — 2026-05-14 — seeds → bands → long-range regimes → candidates wiring

**Date**: 2026-05-14 (post Phase 1 audit + polish PR #17)
**Continues from**: Phase 1 audit (PRs #13 / #14 / #15 / #16 / #17), the
"make sure the full workflow from JSON loading … is complete" task chain.
**Project**: `MS_Inversions_North_african_catfish` — 226-sample pure
*C. gariepinus* hatchery cohort, LANTA HPC.

---

## TL;DR (60-second orientation)

The banding pipeline (`shared/band_tracking/banding_pipeline.runBandingPipeline`)
emits a 4-stage result:

```
stage1.seeds[]   — anchor_w, s_window, e_window, classifications,
                   tracked_samples, K_a per seed
stage2           — cross-seed reliability verdicts + linkage groups
stage3.loci[]    — per-locus: seed_id, s_window, e_window, K,
                   per_band_samples (Set<int>[]), stage2_linkage_group
stage4           — per-target consensus_partition, voter records
```

**The wiring gap**: `stage3.loci[]` carry per-band sample membership
(== "which fish carry which arrangement at this locus") and link to
long-range haplotype regimes via `stage2_linkage_group` — but they
never reach `state.candidateList`. Downstream pages (karyotype_tier karyotype,
stats_profile stats, page_evolution_*) read `state.candidateList`, so the
seeds-to-regimes work is a dead-end output.

This handoff specs **`analysis/seeds_to_candidates`** — a JSON-in /
JSON-out compute module + adapter that:

1. Reads a `runBandingPipeline` result.
2. Emits one candidate record per locus, with provenance back to
   `seed_id` + `stage2_linkage_group` + (optional) `stage4_consensus_class`.
3. Optionally promotes the candidate records into `state.candidateList`
   so the karyotype + tier + popstats + evolution pipelines consume them.

Same architecture pattern as PR #13–17: pure JSON in / out compute +
registry-aware adapter.

---

## The wiring trace

```
scrubber_main.json
  ↓ (page1 / page22 load)
state.data.windows[].labels, .K, .band_quality, .pc1
  ↓ (page22 ctx)
runBandingPipeline(ctx) — shared/band_tracking/banding_pipeline.js
  ↓
{ stage1.seeds[], stage2, stage3.loci[], stage4 }
  ↓
state._regimesResult   (page22-private)
  │
  ├── _exportCatalogue → buildCatalogue → catalogue.json
  │     (filesystem export; downloads regime catalogue)
  │
  └── ??? — stage3.loci[] NEVER reach state.candidateList
            karyotype_tier / stats_profile / page_evolution_* therefore have no
            seed-derived candidates to operate on.
```

After this handoff lands, the second branch becomes:

```
  └── analysis/seeds_to_candidates.compute(banding_result, ctx)
        → candidates[]  (each with seed_id + linkage_group + per_band_samples)
        → state.candidateList    (via adapter.saveOutput with promote=true)
            ↓
        karyotype_tier (karyotype/tier)          via PR #13 karyotype_assignment
        stats_profile (stats profile)          via existing legacy
        polarize_msa_stacked     via canonical candidate shape
        archaeology_synthesis_card etc.
```

Window-chain candidates from PR #14 (`window_chain_to_candidates`)
follow the **same downstream path**: that module already produces
`candidate[]` records and pushes them onto candidateList. The
`seeds_to_candidates` module is the equivalent for the
`runBandingPipeline` output.

---

## Contract — `analysis/seeds_to_candidates/`

Layout matches PRs #13 / #14 / #15 / #16:

```
analysis/seeds_to_candidates/
  schema_in.json       input contract
  schema_out.json      output contract
  compute.js           pure JSON-in / JSON-out
  adapter_atlas.js     registry / atlasState bridge, optional
                        candidateList promote
  example_input.json   3-locus fixture from a minimal banding result
  example_output.json  precomputed reference
analysis/seeds_to_candidates.js   thin shim
```

### `schema_in.json` (concept)

```json
{
  "chrom":          "LG28",
  "banding_result": { /* full runBandingPipeline output */ },
  "sample_ids":     ["CGA001", "CGA002", ...],
  "window_bp_map": [
    { "idx": 0, "start_bp": 1000000, "end_bp": 1100000 },
    ...
  ],
  "params": {
    "include_stage4_consensus": true,   // default true
    "drop_noise_seeds": true,           // skip stage2.reliability=NOISE
    "id_prefix": "regime_locus",        // candidate.id = {prefix}_{chrom}_{start_bp}_{end_bp}
    "min_per_band_size": 2              // drop loci with any band <2 samples
  },
  "input_layer_ids": ["scrubber_main:LG28", "regimes_result:LG28"]
}
```

### `schema_out.json` (concept)

```json
{
  "chrom": "LG28",
  "candidates": [
    {
      "id":                       "regime_locus_LG28_15000000_18000000",
      "chrom":                    "LG28",
      "start_bp":                 15000000,
      "end_bp":                   18000000,
      "start_w":                  150,
      "end_w":                    180,
      "K":                        3,
      "n_samples":                226,
      "seed_id":                  7,
      "anchor_w":                 165,
      "stage2_linkage_group":     2,
      "stage2_verdict":           "VALID",
      "stage4_consensus_class":   "CLEAN_PARTITION",
      "stage4_consensus_score":   0.8667,
      "per_band_samples":         [["CGA001",...], ["CGA042",...], ["CGA118",...]],
      "per_band_size":            [60, 106, 60],
      "per_band_first_size":      [60, 106, 60],
      "band_set_aggregation":     "majority",
      "min_internal_jaccard":     0.93,
      "n_unreliable_skipped":     0,
      "source":                   "seeds_to_candidates",
      "chain_type":               "regime_locus",
      "confirmed":                false
    }
  ],
  "n_candidates":            1,
  "n_dropped_low_band_size": 0,
  "n_dropped_noise_seeds":   2,
  "source":                  "compute",
  "input_layer_ids":         ["scrubber_main:LG28", "regimes_result:LG28"],
  "params_used":             { ... }
}
```

### Compute responsibilities

1. **Drop NOISE seeds** (stage2 verdict) when `params.drop_noise_seeds === true`.
2. **Per locus**:
   - Resolve `start_bp` / `end_bp` via `window_bp_map[locus.s_window].start_bp`
     and `window_bp_map[locus.e_window].end_bp`.
   - Build `id` = `{params.id_prefix}_{chrom}_{start_bp}_{end_bp}`.
   - Resolve `per_band_samples` from `Set<int>[]` to `string[][]` via
     `sample_ids`.
   - Drop loci where any populated band has size < `params.min_per_band_size`.
   - Stamp `stage2_linkage_group`, `stage2_verdict` (already on the locus).
   - Look up `stage4.per_target[i].consensus.consensus_class` keyed by
     seed_id when stage4 is present, else null.
3. **Provenance**: round-trip `input_layer_ids`; record `params_used`.

### Adapter responsibilities

1. `buildInput(request, ctx)`:
   - Pull `banding_result` from `atlasState.inversion._regimesResult` or
     `aplr.resolveLayer(request.banding_result_layer_id)`.
   - Pull `sample_ids` from `atlasState.data.samples` (existing convention).
   - Build `window_bp_map` from `atlasState.data.windows[].start_bp/end_bp`.
2. `saveOutput(result, request, ctx)`:
   - Write `candidate_chain_set`-shaped layer via `aplr.commitLayer`
     (or local stash on `atlasState.inversion._seed_chain_sets[chrom]`).
   - When `request.promote === true`, push each candidate onto
     `atlasState.candidateList` (de-duplicated by `id`).
3. `runSeedsToCandidates(request, ctx)` — one-shot orchestrator.

---

## Test plan

- `tests/test_analysis_seeds_to_candidates_compute.js`
  - Empty input → safe empty result.
  - Single-locus fixture → 1 candidate with correct bp mapping.
  - Multi-locus fixture (3 loci) → 3 candidates, all with seed_id +
    linkage_group provenance.
  - NOISE seed drop test: stage2.reliability=NOISE for one seed →
    excluded.
  - `min_per_band_size` filter test: locus with a band of size 1 →
    dropped.
  - Stage4 stitch test: candidate carries `stage4_consensus_class`
    when stage4 present.
  - JSON round-trip + provenance.

- `tests/test_analysis_seeds_to_candidates_adapter.js`
  - `buildInput` resolves from atlasState path.
  - `buildInput` resolves from `aplr.resolveLayer` path.
  - `saveOutput` local-stash fallback path.
  - `saveOutput` aplr `commitLayer` path.
  - `promote: true` pushes candidates onto candidateList.
  - Re-promote is idempotent (de-dupe by `id`).

Target: ~25 unit + ~15 adapter, total ~40 new assertions.

---

## Order of operations

1. **This commit**: HANDOFF doc on `claude/handoff-seeds-to-candidates-Ul7cd`.
2. **Next commit (separate PR)**: implement
   `analysis/seeds_to_candidates/` per this spec. Branch:
   `claude/seeds-to-candidates-Ul7cd`. Same JSON-in / out + adapter
   template as PR #13.
3. **Optional follow-on**: a `_wireRegimePromote()` button in page22's
   action bar that calls `runSeedsToCandidates({promote: true})`.
   Smaller follow-up.

---

## Non-goals (intentional)

- This handoff does NOT cover the producer-side push (HPC catalogue
  → atlas precomp). That's upstream.
- It does NOT touch `runBandingPipeline` internals. Stage 3 already
  computes `per_band_samples` correctly; this is purely an adapter
  layer.
- It does NOT modify `state.candidateList` schema. The new candidates
  match the existing shape (`id`, `chrom`, `start_bp`, `end_bp`, etc.).

---

## Acceptance criteria

When the implementation PR lands:

- [ ] `analysis/seeds_to_candidates/` module exists with all 7 files
      (schema_in, schema_out, compute.js, adapter_atlas.js,
      example_input.json, example_output.json, parent shim).
- [ ] At least 25 compute + 15 adapter tests pass.
- [ ] Suite remains green at the previous baseline + the new tests.
- [ ] When `promote: true` is set, a regime pipeline run on the LG28
      precomp produces ≥ 1 candidate visible in `state.candidateList`
      with `source: 'seeds_to_candidates'` and a non-null
      `stage2_linkage_group`.
- [ ] `karyotype_assignment.assignKaryotypes(candidate)` (PR #13) runs
      successfully on the promoted candidate (no missing fields).

---

## Files affected (implementation PR, not this commit)

```
new  atlases/inversion/analysis/seeds_to_candidates.js
new  atlases/inversion/analysis/seeds_to_candidates/
       schema_in.json
       schema_out.json
       compute.js
       adapter_atlas.js
       example_input.json
       example_output.json
new  tests/test_analysis_seeds_to_candidates_compute.js
new  tests/test_analysis_seeds_to_candidates_adapter.js
edit _tooling/run_migrated_tests.sh    (register the two new tests)
```

No edits to `shared/band_tracking/*` (the pipeline is correct).
No edits to existing pages until the optional follow-on.

---

## How this slots into the Phase 1 audit chain

| PR | Topic | Closes audit gap |
|---|---|---|
| #13 | karyotype_assignment | BLOCKER 1 — analysis module missing |
| #14 | window_chain_to_candidates | bonus — het + hom-separation chains → candidates |
| #15 | scrubber_main_validator + json_schema_lite | BLOCKER 2 — no schema validation at load |
| #16 | anchor_track_cache | BLOCKER 3 — V/H_off not externally addressable |
| #17 | shared-V polish | unify the chain V signal scale |
| **this** | **seeds_to_candidates handoff + impl** | **completes the seeds → candidateList wiring** |

After the implementation PR lands, the full workflow from JSON load to
karyotyped-and-classifiable candidates is unbroken end to end.

---

## Resolved decisions

1. **Dedup policy — source-tagged, no dedup (decision 2026-05-14)**:
   Every candidate carries a `source` tag — one of
   `'seeds_pipeline'`, `'het_chain'`, `'hom_chain'` — so the catalogue
   page can show overlaps side-by-side and the user reviews them
   manually. `seeds_to_candidates` does NOT attempt to merge against
   existing `state.candidateList` entries from
   `window_chain_to_candidates` (PR #14). Both sources coexist;
   downstream review/filtering modules can dedupe later if needed.
   - **Schema impact**: `schema_out.json` requires a `source` field
     on every candidate (enum of the three tags above).
   - **Adapter impact**: `saveOutput` appends to
     `state.candidateList` without inspecting prior entries.
   - **Test impact**: add a test that runs `seeds_to_candidates`
     after `window_chain_to_candidates` on a fixture that overlaps,
     asserts both are present, asserts both carry distinct `source`
     tags.

2. **id collisions on re-run**: when the same locus is found at
   slightly different boundaries by re-runs, the deterministic
   `{prefix}_{chrom}_{start_bp}_{end_bp}` id changes — so re-runs
   create new candidates rather than updating old ones. Acceptable
   for v1; if re-run idempotency becomes needed, switch to
   interval-overlap-based dedupe in the adapter.

---

## Session URL footer (convention)

https://claude.ai/code/session_01KN8Jkn7aaWJvu53xd3EGnx
