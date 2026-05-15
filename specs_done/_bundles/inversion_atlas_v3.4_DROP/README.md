# Inversion Banding — Cramer's V → Haplotype Regimes → Dosage (v3.4)

End-to-end pipeline for detecting and classifying inversion-banding
systems in the 226-sample pure *Clarias gariepinus* hatchery cohort.
This drop completes the architecture from local-PCA seed discovery all
the way through long-range haplotype regime visualization with dosage
overlay, leaving the user "unstuck" to apply per-band dosage and resolve
internal sub-band structure.

## The full pipeline (one diagram)

```
                        per-window local PCA labels
                                  │
                                  ▼
        ┌─────────────────────────────────────────────────┐
   1.   │  STAGE 1 — V-driven seed discovery              │
        │  per chromosome, find windows with high          │
        │  Cramer's V + low off-diagonal entropy → seeds   │
        │  (anchor_signals.js, window_classification.js,   │
        │   seed_discovery.js)                             │
        └──────────────────────┬──────────────────────────┘
                               │ seeds = [{ chrom, s_window,
                               │            e_window, K }, ...]
                               ▼
        ┌─────────────────────────────────────────────────┐
   2.   │  STAGE 2 — cross-seed voting (N×N pattern_class)│
        │  every seed votes on every other seed; build     │
        │  linkage groups via informative-vote agreement   │
        │  (cross_seed_voting.js)                          │
        └──────────────────────┬──────────────────────────┘
                               │ linkage_groups = [{ seed_ids, ... }]
                               ▼
        ┌─────────────────────────────────────────────────┐
   3.   │  STAGE 3 — per-seed chain walk + per-band       │
        │  sample-set construction inside each seed's      │
        │  footprint                                       │
        │  (locus_construction.js)                         │
        └──────────────────────┬──────────────────────────┘
                               │ stage3_loci = [{
                               │   K, per_band_samples,
                               │   chromosome_idx, s_window,
                               │   e_window, seed_id }, ...]
                               ▼
        ┌─────────────────────────────────────────────────┐
   4.   │  STAGE 4 — bruteforce: every seed band votes on │
        │  every other locus's bands                       │
        │  · projection.js (classifyProjection,            │
        │    classifyProjectionWithStability)              │
        │  · breadth_voting.js (voters → targets →         │
        │    voteRecords → consensus_partition)            │
        │  · banding_pipeline.js (orchestrator)            │
        └──────────────────────┬──────────────────────────┘
                               │ per_target = [{
                               │   target_locus_id, voteRecords,
                               │   consensus_partition }, ...]
                               ▼
        ┌─────────────────────────────────────────────────┐
   5.   │  HAPLOTYPE REGIMES PAGE — visualisation         │
        │  · regimes_panel.js (target-band lanes)          │
        │  · regimes_pc1_panel.js (PC1 lines + overlay)    │
        │  · regimes_page.js (page wrapper, 4 panels)      │
        │  · 'you are here' rectangle on active seed loci  │
        │  · per-window pattern_class strip on top         │
        │  · per-band dosage tints when getMacroDosage     │
        │    callback is wired (BLUE/WHITE/RED)            │
        └──────────────────────┬──────────────────────────┘
                               │ user navigates with arrow keys
                               ▼
        ┌─────────────────────────────────────────────────┐
   5.5  │  ANNOTATION LAYER (SPEC ONLY — NOT IMPLEMENTED) │
        │  · REGIME_ANNOTATION_SPEC.md                     │
        │  · Detection-vs-interpretation conceptual frame  │
        │  · 4 layers per regime:                          │
        │    (1) positional: centromeric / pericentromeric │
        │        / interstitial / subtelomeric / arm-scale │
        │    (2) structure: simple / nested / sharp /      │
        │        diffuse / arm-scale                       │
        │    (2b) biological-mechanism classification      │
        │         (skeleton): inversion-like / ancestry-   │
        │         linked / balanced / sweep-like / super-  │
        │         gene-like / LD-block / incompatibility / │
        │         hyperdivergent / unresolved-complex      │
        │    (3) POD-compatible — three nested levels:     │
        │        3a variant: POD_candidate_variant         │
        │        3b load: HOM/HET exposed-burden contrast  │
        │        3c fitness: phenotype (usually missing)   │
        │    (4) UNDERDOM-compatible: weak/medium/high     │
        │  · Uses BEAGLE GLs throughout (not hard calls)   │
        │  · Three interpretation traps enforced as        │
        │    column independence rules                     │
        │  · References: Waller 2021, Salson 2025,         │
        │    Pazhayam 2024, Abu-Awad 2023, Todesco 2020,   │
        │    Moya 2024, Lee 2021, Sabeti 2002              │
        │  · STATUS: awaiting audit before implementation  │
        └──────────────────────┬──────────────────────────┘
                               │
                               ▼
        ┌─────────────────────────────────────────────────┐
   5.6  │  COPY-ORIGIN PAINTING (SPEC ONLY — NOT IMPL)    │
        │  · COPY_ORIGIN_PAINTING_SPEC.md                  │
        │  · Paralogue ancestry painting: assign each      │
        │    breakpoint-proximal window to its most likely │
        │    duplicated-copy background                    │
        │  · Steps A→E: copy dictionary, PSV markers,      │
        │    window calls, mechanism classification, HOM/  │
        │    HET integration                               │
        │  · Output: 05_breakpoint_switches.tsv with       │
        │    NAHR-compatible / NHEJ/MMEJ-compatible /      │
        │    complex paralogue mosaic / no mosaic evidence │
        │  · Reuses instant_q analogy (Engine B from       │
        │    MODULE_2B) — copies-as-ancestry-sources       │
        │  · STATUS: awaiting audit before implementation  │
        └──────────────────────┬──────────────────────────┘
                               │
                               ▼
        ┌─────────────────────────────────────────────────┐
   5.7  │  FISH ANCESTRY SCROLLER (SPEC ONLY — NOT IMPL)  │
        │  · FISH_ANCESTRY_SCROLLER_SPEC.md                │
        │  · Ancestry-aware inversion browser page         │
        │  · v2 canonical UI: 3 numbered layers (PC1 Band  │
        │    per fish / Ancestry Bricks per fish / Brick   │
        │    summary cohort view) + 5-row brick metrics    │
        │    heatmap + tab strip (Overview / Candidates /  │
        │    Ancestry / Pop Stats / Regimes / Markers /    │
        │    Breakpoints).                                  │
        │  · Headline metric: mean |ΔQ| (global vs local)  │
        │  · CRITICAL: label-switching alignment pipeline  │
        │    (F-based, Q-fallback only in flanks, regime-  │
        │    aware smoothing, FAIL = grey not coloured)    │
        │  · Ancestry bricks layer: derived simplification │
        │    merging RFs into bricks with labels (RARE_    │
        │    ANCESTRY, HIGH_HET, REGIME_DISCORDANT etc.).  │
        │    Six color modes. NOT a discovery system —     │
        │    "we discovered N bricks" is forbidden phrasing │
        │  · v1 8-track sketch preserved as superseded     │
        │    alternative for historical reference          │
        │  · Consumes instant_q (Engine B) per-RF output   │
        │  · STATUS: awaiting audit before implementation  │
        └──────────────────────┬──────────────────────────┘
                               │
                               ▼
        ┌─────────────────────────────────────────────────┐
   6.   │  DOSAGE OVERLAY — per macro-band classification │
        │  · dosage_overlay.js (HOM_REF/HET/HOM_INV/       │
        │    AMBIGUOUS classifier, HET-disjointness        │
        │    axis counter)                                 │
        │  · dosage_bridge.py (cluster-side endpoint that  │
        │    serves /api/dosage/chunk to feed              │
        │    sampleMeanDosage callback)                    │
        └─────────────────────────────────────────────────┘
```

## Pattern-class taxonomy

The Stage 4 projection classifier classifies the way a stable voter
band lands on every other locus into one of:

| class           | meaning                                                | colour  |
|-----------------|--------------------------------------------------------|---------|
| `SINGLE`        | voter hits one target band cleanly (≥80% concentrate)  | green   |
| `SUBSET`        | voter hits 2 bands, each ≥20%, total ≥80%              | blue    |
| `SPLIT_TWO`     | voter splits exactly 2 bands (canonical 50/50 case)    | amber   |
| `SUBSET_SPLIT`  | voter splits 3+ bands (static classifier)              | violet  |
| `COHERENT_SPLIT`| voter splits 3+ bands AND daughters are stable across  | pink    |
|                 | neighbouring target windows (Hungarian-aligned median  |         |
|                 | Jaccard ≥ 0.7) — real sub-structure                   |         |
| `RANDOM_FAN`    | voter splits but daughters are unstable — noise        | red     |
| `SCATTER`       | voter mass diffuse, no concentration anywhere          | slate   |
| `EMPTY`         | no overlap or K_target < 2                             | near-bg |

The COHERENT_SPLIT vs RANDOM_FAN distinction is the chat-transcript
correction: a 1→4 split is *not* automatically a fan; if the daughters
reproduce across neighbouring windows, it's hidden sub-structure
(nested inversion, founder package, secondary axis) — not noise.

Per target locus, Stage 4 runs `consensus_partition` over all set-
partitions of the target's K bands, scoring each by pair-weighted vote
agreement. Output classes:

`CLEAN_PARTITION`, `SOFT_PARTITION`, `AMBIGUOUS_BAND` (hidden sub-
resolution), `OVERLAPPING_VOTES`, `MULTI_LAYER_STRUCTURE`,
`NO_CLEAN_CONSENSUS`.

## Dosage classes (post-polarized)

The atlas's `dosage_overlay.js` consumes per-sample mean polarized
dosage and classifies each macro-band:

| class               | mean range          | colour      | meaning                  |
|---------------------|---------------------|-------------|--------------------------|
| `HOM_REF`           | ≤ 0.3               | blue        | homozygous REF allele    |
| `HET`               | 0.7 .. 1.3          | near-white  | heterozygous             |
| `HOM_INV`           | ≥ 1.7               | red         | homozygous INV allele    |
| `AMBIGUOUS_DOSAGE`  | otherwise           | slate grey  | classifier indeterminate |
| `NO_SAMPLES`        | empty band          | transparent | no membership            |

Plus a `min_samples_for_class` floor (default 5) — bands with fewer
samples are demoted to `AMBIGUOUS_DOSAGE` regardless of their mean.

## Files

```
                 ── stages 1–3 ──
seed_discovery.js          Stage 1 — V-driven seed discovery per chromosome
window_classification.js   three-way classifier (V + H_off + band_quality)
anchor_signals.js          per-window V and off-diagonal entropy
cross_seed_voting.js       Stage 2 — cross-seed N×N pattern_class voting
locus_construction.js      Stage 3 — chain walk + per-band majority sample-sets

                 ── stage 4 ──
projection.js              classifyProjection (static, two-tier visited)
                           classifyProjectionWithStability (daughter-stability →
                           COHERENT_SPLIT vs RANDOM_FAN)
breadth_voting.js          voters → targets → voteRecords → consensus_partition
banding_pipeline.js        runStage1 / runStage3 / runStage4 / runBandingPipeline

                 ── pre-existing band-tracking modules ──
vote_evidence.js                from inversion-atlas
band_voters.js                  from inversion-atlas
partition_enumerate.js          from inversion-atlas
partition_consensus.js          from inversion-atlas

                 ── visualisation ──
regimes_panel.js           Target-band-lanes panel; scope-aware
                           (chrom default, genome opt-in); ←/→
                           cycles seeds, ↑/↓ cycles band combos
regimes_pc1_panel.js       PC1-lines variant — same focal voter logic
                           but y-axis is PC1 from upstream local PCA
regimes_page.js            Page wrapper; chrom panels by default,
                           genome panels hidden until "Show genome view"

                 ── dosage ──
dosage_overlay.js          macroBandDosage, classifyMacroBands,
                           countAxesByHetDisjointness, DOSAGE_CLASS,
                           DOSAGE_DEFAULTS

                 ── annotation (SPEC ONLY — not implemented) ──
REGIME_ANNOTATION_SPEC.md  4-layer annotation system:
                           (1) positional (centromeric / interstitial /
                               subtelomeric / arm-scale)
                           (2) regime structure (simple / nested /
                               sharp / diffuse)
                           (3) POD-compatibility scoring (BEAGLE GLs)
                               + Layer 3b: per-variant candidate
                                 enumeration — POD_candidate_variant
                                 / POD_compatible_recessive_load_variant
                           (4) UNDERDOM-compatibility scoring (BEAGLE GLs)
                           Awaiting audit before implementation.

                 ── copy-origin painting (SPEC ONLY — not implemented) ──
COPY_ORIGIN_PAINTING_SPEC.md  Paralogue ancestry painting for
                           breakpoint mechanism classification:
                           (A) copy dictionary per SD family
                           (B) paralogue-informative markers (PSVs)
                           (C) per-window copy support / call
                           (D) mechanism: NAHR / NHEJ-MMEJ / mosaic
                           (E) HOM/HET arrangement-group integration
                           Reuses instant_q analogy.
                           Awaiting audit before implementation.

                 ── ancestry scroller (SPEC ONLY — not implemented) ──
FISH_ANCESTRY_SCROLLER_SPEC.md  Ancestry-aware inversion browser:
                           per-RF local ancestry painting with
                           label-switching alignment guard, |ΔQ|
                           diagnostic, global vs local Q comparison,
                           switch-rate + entropy + alignment-confidence
                           tracks, dosage cross-check. Plus ancestry
                           bricks derived layer (RF merging,
                           multi-metric labels: RARE_ANCESTRY /
                           HIGH_HET / REGIME_DISCORDANT etc., six
                           color modes). Consumes instant_q (Engine B)
                           per-RF output. Awaiting audit before
                           implementation.

                 ── tests ──
smoke_test_v2.mjs          5 phases on a 2-chrom synthetic
integration_test_v2.mjs    18 assertions on a 4-chrom synthetic
                           (Stage 1-4 + projection + COHERENT_SPLIT)
regimes_panel_smoke.mjs    51 assertions (panel data path, both scopes,
                           cache invalidation, dosage palette + classifier)
```

## How the regimes page knows about dosage

The panels do NOT talk to the dosage server directly. The host page
provides a callback `getMacroDosage(locus, sample_set) → {
dosage_class, dosage_mean, n_with_data }` which encapsulates:

1. Calling `dosage_overlay.js`'s `macroBandDosage` for the sample set
2. With a `sampleMeanDosage(si)` callback that fetches per-sample mean
   polarized dosage from the upstream LRU chunk cache (which talks to
   `/api/dosage/chunk` on the cluster-side `dosage_bridge.py`)
3. Then calling `classifyDosageMean` to get the class

The panels just consume the result and tint the seed-loci "you are
here" rectangle accordingly. This keeps the panel pure-frontend with
no direct server coupling — same separation that
`popstats_server` / `dosage_bridge.py` already maintain (the atlas
decides what a group **is**, the server only computes statistics on
explicit member lists).

When `getMacroDosage` is null (default), the rectangle uses the legacy
gold tint.

## The "you are here" rectangle

The rectangle is **stratified** into K horizontal stripes, one per
band of the active seed locus. Each stripe:

- Is filled with the **dosage colour** of that band (blue/white/red/
  grey when `getMacroDosage` is wired).
- Renders at **alpha 1.0** if the band is part of the active focal
  voter (in `focal.band_mask`).
- Renders at **alpha 0.95** if the band is part of the same seed locus
  but NOT in the active mask — slight contrast cue so the user can see
  the band layout but their selection stays emphasised.

Thin separator lines mark the band boundaries inside the rectangle.
A dashed border on the whole rectangle reads as "active region."

The PC1 panel uses the same stratified rectangle (same dosage tints,
same alpha treatment), painted as a translucent overlay on top of the
PC1 line cloud.

## Per-chromosome by default

The two genome-scope panels (lanes + PC1, on the right side of the
2×2 grid) are **hidden by default** — `args.enable_genome_view = false`.
Toolbar button "Show genome view" toggles them on; once on, "Compute
genome view" populates them. This matches the project's tabular
convention: results are stored per-chromosome, JSONs are attached
per-chromosome, multi-chromosome tables are explicitly avoided.

The genome view exists for the exploratory "is this voter supported
anywhere else in the genome" case; it's not part of the daily working
loop.

## Band-combo enumeration — the K=6 problem

K=6 has 63 non-empty subsets. Three modes, cycle with `\`` or the
toolbar button:

| mode          | enumeration                                            |
|---------------|--------------------------------------------------------|
| `additive`    | `{b0}, {b0,b1}, {b0,b1,b2}, ..., {b0..bK-1}` — K steps |
| `informative` | filter `all` to subsets producing informative classes  |
|               | on ≥10% of in-scope windows                            |
| `all`         | full 2^K-1 enumeration (cardinality-major lex order)   |

`additive` is the default. With K=6 it gives 6 steps, not 63.

## DOM contract

```html
<div id="regimesPageHeader"></div>
<div class="regimes-grid">
  <div id="regimesPanel">                    <!-- chrom · lanes (always shown) -->
    <div id="regimesCanvasContainer"></div>
  </div>
  <div id="regimesGenomePanel">              <!-- genome · lanes (opt-in) -->
    <div id="regimesGenomeCanvasContainer"></div>
  </div>
  <div id="regimesPC1Panel">                 <!-- chrom · pc1 (always shown) -->
    <div id="regimesPC1CanvasContainer"></div>
  </div>
  <div id="regimesPC1GenomePanel">           <!-- genome · pc1 (opt-in) -->
    <div id="regimesPC1GenomeCanvasContainer"></div>
  </div>
</div>
```

## Usage

```js
import { runBandingPipeline }   from './banding_pipeline.js';
import { classifyProjection }   from './projection.js';
import { initRegimesPage }      from './regimes_page.js';
import {
  classifyMacroBands, macroBandDosage, classifyDosageMean,
} from './dosage_overlay.js';

// 1. Run the bruteforce
const bandingResult = runBandingPipeline(ctx, { stage4_scope: 'seeds_only' });

// 2. Build the dosage callback. The host page is responsible for
//    wiring sampleMeanDosage to the upstream LRU chunk cache (which
//    talks to dosage_bridge.py / popstats_server).
function getMacroDosage(locus, sample_set) {
  // Returns the band's dosage class. The atlas resolves
  // sampleMeanDosage(si) from its dosage_chunks index, scoped to the
  // locus's [s_bp, e_bp] genomic range.
  const sampleMeanDosage = (si) =>
    state.data.dosage_chunks.meanForSampleInRange(si, locus.s_bp, locus.e_bp);
  const d = macroBandDosage(sample_set, sampleMeanDosage);
  const cls = classifyDosageMean(d.mean);
  return { dosage_mean: d.mean, dosage_class: cls,
           n_with_data: d.n_with_data };
}

// 3. Wire the page
initRegimesPage(state, {
  bandingResult,
  getLabels:    ctx.getLabels,        // (w) => Int8Array
  getK:         ctx.getK,             // (w) => number
  getPC1:       ctx.getPC1,           // (w) => Float32Array (PC1 panels)
  getMacroDosage,                      // (locus, sample_set) => { dosage_class, ... }
  classifyFn:   classifyProjection,
  classifyOpts: {},
  bandComboMode: 'additive',
  current_chromosome_idx: 0,
  enable_genome_view: false,           // DEFAULT — chrom only
});
```

## Keyboard

| key         | action                                          |
|-------------|-------------------------------------------------|
| ←/→         | prev/next seed (auto-snaps chrom_idx)           |
| shift+←/→   | stay at seed, cycle single-band voters          |
| ↑/↓         | prev/next band combo (mode-driven enumeration)  |
| home / end  | first / last seed                               |
| `\``        | cycle bandComboMode                             |
| c           | next chromosome (chrom-scope target)            |
| g           | enable + Compute genome view                    |

## Test results

```
$ node smoke_test_v2.mjs                # 5 phases pass (Stage 1+2+3)
$ node integration_test_v2.mjs          # 18/18 (Stage 1-4 + projection)
$ node regimes_panel_smoke.mjs          # 51/51 (panel data path + dosage)
```

Test coverage:

- **smoke_test_v2** — Stage 1 + 2 + 3 on a 2-chrom synthetic; verifies
  seed discovery, cross-seed pattern matrix, linkage grouping, locus
  construction with majority sample sets.
- **integration_test_v2** — Stage 1-4 + classifyProjection + classifyProjectionWithStability
  on a 4-chrom synthetic with planted G0a/G0b sub-resolution at chr 3.
  Verifies SPLIT_TWO detection, AMBIGUOUS_BAND for hidden sub-resolution,
  the bruteforce orchestrator, and the daughter-stability classifier.
- **regimes_panel_smoke** — panel data path on the same 4-chrom synthetic.
  Tests:
  - subset enumeration (all / additive / informative)
  - focal-voter union from band masks
  - per-window pattern_class track over both chrom and genome scopes
  - cache invalidation on seed/mask/scope/chromosome changes
  - PATTERN_CLASS_COLORS palette completeness
  - DOSAGE_CLASS_COLOURS palette + `_dosageClassColour` rgba conversion
  - getMacroDosage callback shape with synthetic G0/G1/G2 →
    HOM_REF/HET/HOM_INV classification

## What is NOT yet wired (for the next chat or empirical work)

1. **Real-data validation on LG28.** The Stage 4 calibration knobs
   (v_high, h_off thresholds, daughter_stability_threshold, etc.)
   are at synthetic-test defaults. Empirical work plan: per-window V +
   H_off render at 16.5 Mb anchor, classify each window, run runStage1
   on LG28, compare boundaries with the validated 15.115–18.005 Mb
   call, repeat on 2-3 more chromosomes, scale.
2. **Live `getMacroDosage` host plumbing.** The callback is plumbed
   into the panel; the host page needs to wire `sampleMeanDosage`
   against `state.data.dosage_chunks` + `dosage_bridge.py`. A tested
   reference implementation is the existing `renderDosageHeatmap` path
   in `Inversion_atlas.html` — same chunk-loading pattern.
3. **Annotations on the `you are here` rectangle.** The dosage class
   tints the rectangle; a future enhancement is annotating the dosage
   mean (numeric, with confidence interval if `n_with_data` is large
   enough) and the polarity_check status from
   `countAxesByHetDisjointness`.
4. **Long-range dosage view.** When the focal voter projects onto a
   far-away target locus and the consensus_partition produces 2-3
   macro-bands, those macro-bands also have dosage classes — a future
   panel could show those long-range macro-band dosages alongside the
   close-range ones, helping the user see whether a hidden sub-axis
   has consistent dosage signal.

## What was deliberately NOT changed

- `lines_panel.js` is untouched. The PC1-lines panel here is a sibling
  implementation with the focal-voter overlay, intended to live on its
  own page.
- `dosage_overlay.js` is the existing module; not modified this chat.
- `popstats_server` / `dosage_bridge.py` are cluster-side; not
  modified, only consumed.
