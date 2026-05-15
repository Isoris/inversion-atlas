# How to use page22 — haplotype regimes

**Page**: `page22` · stage `discovery` · label "haplotype regimes"
**Atlas**: `inversion` (the C. gariepinus 226-cohort atlas)
**Wiring**: registered in `manifest.json` after page19; registry entry in `registries/data/pages.registry.json`

## What this page does

Runs the audited v3.4 banding pipeline (Stage 1 seed discovery → Stage 2 cross-seed voting → Stage 3 chain walk → Stage 4 bruteforce projection) on the active chromosome's per-window data and renders the results in a four-canvas regimes view. Exports the result as a regime catalogue JSON (cohort-level evidence-registry artefact).

This is **Phase 1** of the post-audit empirical work plan — single-chromosome run, calibration target is the LG28 prototype at 15.115–18.005 Mb with the validated 60/106/60 karyotype.

## Where the pieces live

```
atlases/inversion/
├── manifest.json                          ← page22 entry added
├── registries/data/pages.registry.json    ← page22 entry added
├── pages/discovery/
│   ├── page22.html                        ← the fragment (4-canvas grid + action bar)
│   ├── page22.js                          ← module entry (mount / unmount)
│   └── page22/
│       ├── regimes_page.js                ← 4-panel orchestrator
│       ├── regimes_panel.js               ← chrom + genome lanes panels
│       └── regimes_pc1_panel.js           ← chrom + genome PC1 panels
└── shared/band_tracking/
    ├── projection.js                      ← UPGRADED (was a stub; now the audited full version)
    ├── anchor_signals.js                  ← NEW (Stage 1 V + H_off)
    ├── window_classification.js           ← NEW (Stage 1 three-way classifier)
    ├── seed_discovery.js                  ← NEW (Stage 1 seed walker)
    ├── locus_construction.js              ← NEW (Stage 3 chain walk)
    ├── cross_seed_voting.js               ← NEW (Stage 2 N×N voting)
    ├── breadth_voting.js                  ← NEW (Stage 4 driver)
    ├── banding_pipeline.js                ← NEW (top-level orchestrator)
    ├── dosage_overlay.js                  ← NEW (HOM_REF/HET/HOM_INV classifier)
    └── regime_catalogue.js                ← NEW (catalogue serializer)
```

The atlas already had `partition_consensus.js`, `partition_enumerate.js`, `vote_evidence.js`, and `band_voters.js` in `shared/band_tracking/`. The previous `projection.js` was a stub; it has been **replaced** by the audited full version. All audit findings (especially Findings 2 and 3) now apply directly to the atlas runtime.

## How to run

1. **Drop the atlas into the core shell.** The two tarballs go side-by-side as before:
   ```
   atlas-core/
   atlases/
     inversion/             ← drop the new bundle here
   ```
   No `atlas-core` changes were needed — the existing `atlas_router` and `loadAtlasStylesheets` machinery picks page22 up automatically from the manifest.

2. **Start the shell** (e.g. `python -m http.server` from the atlas-core directory) and open `index.html`. The discovery tab now shows **page22 — haplotype regimes** alongside the existing pages.

3. **Pick a chromosome** in the topbar (the page reads `atlasState.shared.activeChrom`). Click the page22 tab.

4. The header and action bar render with status `loaded {chrom} · {n_windows} windows · {n_samples} samples · ready`. The four canvases are blank — the pipeline hasn't run yet.

5. **Click "run pipeline".** The status updates to `running pipeline…`, then to `pipeline ran in {ms}ms · {n_seeds} seeds · {n_loci} loci · …`. The four canvases populate.

6. **Navigate**:
   - `←/→` — prev/next seed
   - `↑/↓` — prev/next band combo (additive enumeration by default)
   - `Shift+←/→` — stay on this seed, cycle single-band voters
   - `Home / End` — first / last seed
   - `` ` `` (backtick) — cycle band-combo mode (`additive` / `informative` / `all`)
   - `c` — next chromosome (only meaningful once we wire multi-chrom)
   - `g` — enable + compute the genome-scope panels (right column)

7. **Click "export catalogue"** to download three JSON files:
   - `{cohort_id}__{knob_hash}__manifest.json`
   - `{cohort_id}__{knob_hash}__knobs.json`
   - `{cohort_id}__{knob_hash}__catalogue.json`

   These are the cohort-level evidence-registry artefact. Drop them into `cohort_id/reference_id/regime_catalogue/{pipeline_version}/{knob_hash}/` in your registry layout. The `interval_id` field in each record is the join key into the interval registry.

## How the data flows

```
atlasState.shared.activeChrom (e.g. "LG28")
        ↓
registry.resolve('scrubber_main', { chrom })
        ↓
data = { n_windows, n_samples, windows[], l2_envelopes[], samples[], chrom, ... }
        ↓
state._regimesCtx = {
  getLabels(w):       clusterL2(ctx, windowToL2[w]).labels       ← per-L2 K-means, cached
  getK(w):            clusterL2(ctx, windowToL2[w]).usedK
  getBandQuality(w):  data.windows[w].band_quality
  getL2Idx(w):        windowToL2[w]
  isWindowValid(w):   getK(w) >= 2
  n_samples:          data.n_samples
  chromosomes:        [ { s_window: 0, e_window: N-1 } ]   ← single-chrom
}
        ↓
runBandingPipeline(ctx, opts) → { stage1, stage2, stage3, stage4, summary }
        ↓
initRegimesPage(state, { bandingResult, getLabels, getK, getPC1, ... })
        ↓
state.regimesPanel.{ stage3_loci, focal: { seed_index, band_mask }, track, ... }
        ↓
drawRegimesPanel(state)        — chrom lanes
drawRegimesPC1Panel(state)     — chrom PC1
(optional, after `g`:)
drawRegimesPanel(genomeState)  — genome lanes
drawRegimesPC1Panel(genomeState) — genome PC1
        ↓ on "export catalogue":
buildCatalogue(result, { cohort_id, reference_id, ..., sample_ids, windowToBp })
        ↓
{ manifest, knobs, catalogue } → 3 JSON files downloaded
```

## Key bridges

**Per-window labels via per-L2 clustering.** The pipeline expects `getLabels(w)` to return the K-means labels at window `w`. The atlas computes labels per L2-envelope (one set per L2, shared across all windows in that L2), so the bridge looks up `windowToL2[w]` and fetches `clusterL2(ctx, l2idx).labels`. A `ClusterCache` caches these. This is faithful to the atlas's existing semantics.

**Sample colouring borrowed from page1.** `_resolveSampleScopeColor` lives in `page1/_state.js`; page22 imports it directly via `'../page1/_state.js'`. To make this work, page22's `mount()` calls `_setActiveState` on page1's state shim with its own legacy state. **TODO**: hoist `_resolveSampleScopeColor` to a shared module so the cross-page coupling goes away.

**Catalogue export is browser-only for now.** The serializer's `writeCatalogueToDir` is for Node hosts (LANTA, post-processing). The browser path uses `_downloadJson` to trigger three downloads. To wire LANTA-side persistence, hook a POST endpoint into the popstats server and replace `_downloadJson` with `fetch`.

## Calibration discipline

This page's calibration is the validated **LG28 prototype**: 15.115–18.005 Mb, 60/106/60 karyotype, HWE p≈0.5, shelf Fst_Hom1_Hom2 = 0.308, flanking Fst 0.032–0.055, flat lostruct Z plateau (mean 1.75 SD 0.14).

When you run the pipeline on LG28:
1. Inspect Stage 1: there should be one seed near 15.1–18.0 Mb. If the seed boundary is ≥ ±100 kb off, **Findings 2 and 3 from the audit are blocking** — re-tune `subset_purity`, `split_total_purity`, and `ambiguous_threshold` first.
2. Inspect Stage 4: the LG28 seed's voteRecords should produce a `CLEAN_PARTITION` consensus with 3 macro-bands of sizes ≈ 60/106/60.
3. Wire `getMacroDosage` to a real dosage source (currently `null`); the "you are here" rectangle should then tint blue/white/red for the three bands.

If any of those three checks fails, **stop and re-tune** before scaling to genome-wide.

## Three-cohort discipline (registry-side)

The catalogue tags `cohort_id` and `reference_id` from the active dataset. **Two cohorts on different reference assemblies cannot be aggregated** at the catalogue layer — that requires a cross-species inversion map (separate page). Specifically:

| cohort | reference_id | aggregate-with |
|---|---|---|
| 226 pure *C. gariepinus* hatchery | `fClaHyb_Gar_LG` | future Vietnam *C. gariepinus* |
| future *C. macrocephalus* wild | (its own genome) | other macrocephalus only |

The `interval_id` join key (`{chrom}:{s_bp}-{e_bp}`) is meaningful **only within a reference_id**. The catalogue doesn't enforce this — it tags both fields and trusts the consumer to respect the boundary.

## Audit findings that this page inherits

Per `FINDINGS.md` from the audit chat, the v3.4 modules carry:

- **Finding 2 [MAJOR]** — greedy `break` on cumulative purity at `projection.js:248` drops the third band of distributions like 50/30/20 (reports SPLIT_TWO instead of SUBSET_SPLIT). One-line fix; not yet applied.
- **Finding 3 [BLOCKER]** — `ambiguous_threshold` doc says 0.5, code uses 0.10. Affects `excluded_bands` → coassociation matrix → consensus.
- Findings 1, 4–17 are documented in the audit output and apply to this page's runtime.

The audit recommends fixing 2 and 3 before LG28 deployment. **As of the page22 drop they are NOT yet fixed.** Decide and apply before serious empirical work.

## Smoke-test checklist before declaring this page "live"

1. ☐ Boot the atlas with the new bundle. Topbar shows "haplotype regimes" in the discovery group.
2. ☐ Pick a chromosome with `scrubber_main` data. Click page22. The four canvas containers render with placeholder content; status reads "loaded {chrom} … ready".
3. ☐ Click "run pipeline". Pipeline completes in < 5 s for one chromosome of the 226-sample cohort. Status reflects seed/loci counts.
4. ☐ The four canvases populate. Top-left shows target-band lanes; bottom-left shows PC1 lines. (Genome panels remain empty until `g` is pressed.)
5. ☐ Press `g`. The two right-column panels appear with placeholder text.
6. ☐ Click "Compute genome view" (or just rely on `g` re-press). Right panels render.
7. ☐ Press `←/→`. The focal voter cycles. Title bar updates.
8. ☐ Click "export catalogue". Three JSON files download.
9. ☐ Open `catalogue.json` — confirm records have `interval_id`, `chrom_name`, `s_bp`, `e_bp`, `per_band[].sample_ids`. The `knob_hash` in `manifest.json` matches the one returned by `computeKnobHash(knobs.json content)`.

## Known gaps / next steps

- **Real LG28 calibration** — Step B from the post-audit work plan. Run, inspect, decide on Findings 2 and 3 before genome-wide.
- **`getMacroDosage` plumbing** — wire against `state.data.dosage_chunks` + the popstats server's `/api/dosage/chunk` endpoint (`shared/dosage_bridge.py`). Until that's wired, the "you are here" rectangle is solid gold instead of dosage-tinted.
- **Per-sample karyotype calls** — Step D from the work plan. The catalogue carries macro-band sample sets and dosage; the call layer hasn't been built.
- **KING/IGKC dyad gates** — Step E. Inheritance-based validation per locus.
- **Multi-chromosome scope** — currently page22 is single-chromosome. The pipeline supports multi-chrom but the `chromosomes` array passed to `_regimesCtx` is a single-element array. Phase 2 of the work plan extends to LG28-as-voter projecting onto every chromosome as targets.
- **Catalogue persistence to disk** — currently browser-download only. For LANTA runs, add a POST endpoint to the popstats server (`/api/regime_catalogue/write`) that takes the three JSON payloads and writes to the four-registry layout.
- **Registry round-trip** — load a previously-written catalogue back into the page (skip "run pipeline", just visualize). Single line of code once the load-side endpoint exists.

## File diff summary

```
NEW    atlases/inversion/pages/discovery/page22.html
NEW    atlases/inversion/pages/discovery/page22.js
NEW    atlases/inversion/pages/discovery/page22/regimes_page.js
NEW    atlases/inversion/pages/discovery/page22/regimes_panel.js
NEW    atlases/inversion/pages/discovery/page22/regimes_pc1_panel.js
NEW    atlases/inversion/shared/band_tracking/anchor_signals.js
NEW    atlases/inversion/shared/band_tracking/banding_pipeline.js
NEW    atlases/inversion/shared/band_tracking/breadth_voting.js
NEW    atlases/inversion/shared/band_tracking/cross_seed_voting.js
NEW    atlases/inversion/shared/band_tracking/dosage_overlay.js
NEW    atlases/inversion/shared/band_tracking/locus_construction.js
NEW    atlases/inversion/shared/band_tracking/regime_catalogue.js
NEW    atlases/inversion/shared/band_tracking/seed_discovery.js
NEW    atlases/inversion/shared/band_tracking/window_classification.js
EDIT   atlases/inversion/shared/band_tracking/projection.js  (stub → full)
EDIT   atlases/inversion/manifest.json                       (added page22)
EDIT   atlases/inversion/registries/data/pages.registry.json (added page22)

UNCHANGED  everything in atlas-core/
UNCHANGED  every other page
UNCHANGED  every other shared/* module
```

— end HOW_TO_USE —
