# HANDOFF — full audit requested for next chat

**Date**: 2026-05-08
**Project**: MS_Inversions_North_african_catfish (Quentin Andres, Kasetsart University)
**Bundle**: `banding_unified_v3.4.tar.gz`
**Status**: ALL TESTS PASSING. NEXT CHAT: AUDIT EVERYTHING.

---

## What the next chat needs to do

> "We will audit all of these results"

The next chat is an **audit chat**. Do not extend, do not add features, do not refactor for elegance. The job is to verify that what was built across chats v3.0 → v3.4 actually does what the code, comments, and README claim it does — and to flag every gap, bug, fragility, and overstatement.

The bundle has been declared "ready" but no real-data validation has happened. The synthetic tests pass (74/74 across 3 suites) but synthetic tests verify the architecture, not the calibration. Nothing here has touched the real 226-sample LG28 cohort yet.

---

## Audit checklist

### 1. Pipeline correctness audit (Cramer's V → Stage 4)

For each module below, the auditor should:
- Re-read the module's top comment block.
- Cross-check it against the spec from chat-transcript turns (the stage descriptions in the README's "full pipeline" diagram).
- Run the unit tests.
- Identify any place where the comment claims one thing and the code does another.

Modules in pipeline order:

```
anchor_signals.js              — V and H_off computation per window
window_classification.js       — three-way classifier
seed_discovery.js              — Stage 1 V-driven seed discovery
cross_seed_voting.js           — Stage 2 N×N pattern_class matrix
locus_construction.js          — Stage 3 chain walk + per-band majority
projection.js                  — classifyProjection (static + stability)
breadth_voting.js              — Stage 4 driver, voteRecords, consensus
banding_pipeline.js            — orchestrator
```

**Specific suspicions to verify**:

- **Two-tier visited rule in `projection.js`** — does the rule actually
  produce SUBSET on a 2-band split with each ≥ 0.20 and total ≥ 0.80?
  Verify by hand on a worked example.
- **Daughter-stability in `classifyProjectionWithStability`** — the
  Hungarian-aligned median Jaccard ≥ 0.7 threshold. Walk through the
  code path that promotes SUBSET_SPLIT to COHERENT_SPLIT. Test on an
  edge case where 2/3 daughters are stable but 1/3 is not.
- **`consensus_partition` in `partition_consensus.js`** — what scoring
  function does it actually use? Compare to the README's claim of
  "pair-weighted vote agreement". Is the AMBIGUOUS_BAND threshold
  hardcoded or configurable?
- **B8 was dropped in integration_test_v2** — the test note says "fixture
  artefact, not algorithm failure." Is that actually true? Re-read the
  fixture (4-chrom synthetic, chr 2 = i%3 partition) and verify whether
  removing chr 3 voters SHOULD or SHOULD NOT clean up chr 0's consensus.
  If it should, B8 is a real bug, not a fixture artefact.

### 2. Regimes panels visual correctness audit (NEEDS BROWSER)

These panels were built but **never rendered to a real browser** in this
chat — `node --check` confirms they parse, the data-builder smoke test
confirms the data path, but the canvas drawing has not been visually
inspected. The next chat should:

- Wire the four panels into a minimal HTML test page.
- Load real LG28 data.
- Verify the four panels actually look right:
  - `regimes_panel.js` (target-band lanes, per-chrom): does the lane
    layout match `max_K`? Do the per-sample lines actually jump between
    lanes at every window? Is the pattern-class strip on top legible?
  - `regimes_pc1_panel.js` (PC1, per-chrom): do the per-sample lines
    look like the existing `lines_panel.js` PC1 view? Is the "you are
    here" rectangle correctly positioned over the seed window range?
    Are voter samples coloured gold/cyan/violet by their voter band?
  - Both panels: is the dosage tinting on the rectangle visible? Are
    HOM_REF stripes blue, HET stripes white, HOM_INV stripes red?
  - Genome panels (opt-in): when "Show genome view" is toggled, do the
    containers appear? Does "Compute genome view" populate them
    without freezing the browser? What's the actual wall-clock time
    for a real LG28 voter projected onto the full genome?

### 3. Keyboard handler audit

The keyboard handler in `regimes_page.js` mutates shared state on every
arrow press. Verify:

- Pressing `→` rapidly doesn't desync the chrom-scope and genome-scope
  states (they share `focal` by reference, but `focal.band_mask` is
  reset on seed change).
- `Shift+←/→` correctly stays at the same seed and only cycles the
  single-band voters.
- The `c` key (next chromosome) correctly invalidates `rp.track` so
  the next render rebuilds.
- The `g` key auto-enables genome panels then computes — verify the
  enable + compute sequence doesn't double-render or leak DOM elements.

### 4. Dosage integration audit

The `getMacroDosage` callback is plumbed through but never tested
against a real dosage source in this chat. The next chat should:

- Wire `getMacroDosage` against a real `state.data.dosage_chunks`
  index for LG28.
- Verify the LG28 prototype inversion (15.115–18.005 Mb) shows three
  dosage classes: HOM_REF on band 0 (60 samples), HET on band 1 (106
  samples), HOM_INV on band 2 (60 samples). This is the validated
  60/106/60 karyotype from the chat-transcript.
- Verify the colour ordering is biologically correct (blue → white →
  red as REF allele dosage decreases).
- Stress-test with a band that has < 5 samples (`min_samples_for_class`
  floor) — should classify as AMBIGUOUS_DOSAGE, not crash.
- Stress-test with a band that has all-NA dosage — should classify as
  AMBIGUOUS_DOSAGE.

### 5. Calibration knobs audit

The README admits the Stage 4 calibration knobs are at synthetic-test
defaults. The auditor should:

- List every `_DEFAULTS` constant in the codebase.
- For each, identify which were set by spec and which were tuned
  against the synthetic.
- Mark which knobs are blockers for real-data deployment (need to be
  re-tuned on LG28) vs which are likely safe.

Specific knobs:

```
v_high                    = 0.70    (window_classification.js)
v_moderate                = 0.40
h_off_low                 = 0.40
h_off_high                = 0.70
band_quality_min          = 0.40
anchor_stride             = 25
local_radius              = 200
termination_consecutive   = 2
subset_purity             = 0.80    (projection.js — 2-tier visited)
min_reliability_frac      = 0.30
min_seed_interior_frac    = 0.50
band_set_min_majority_frac = 0.50
daughter_stability_threshold = 0.70 (projection.js — Hungarian Jaccard)
neighbour_radius          = 3
```

The LG28-validated 60/106/60 karyotype call (15.115-18.005 Mb,
HWE p≈0.5, shelf Fst_Hom1_Hom2 = 0.308, flanking Fst 0.032-0.055,
flat lostruct Z plateau mean 1.75 SD 0.14) is the calibration target.
If runStage1 on real LG28 doesn't reproduce that boundary call, the
knobs are wrong, not the algorithm.

### 6. Three-cohort separation audit

CRITICAL. The user's userMemories explicitly state:

> Three separate catfish cohorts must never be conflated:
> (1) F1 hybrid (C. gariepinus × C. macrocephalus) — ONLY for the
>     genome assembly paper.
> (2) 226-sample pure C. gariepinus hatchery cohort on LANTA — current
>     work, "MS_Inversions_North_african_catfish."
> (3) Pure C. macrocephalus wild cohort — future paper.

The next chat must verify:
- Every test fixture and every comment that mentions "samples" is
  unambiguously about cohort (2) — the 226-sample pure C. gariepinus
  hatchery cohort.
- Nothing in the regimes-page UI implies F1-hybrid or wild-macrocephalus
  data.
- The reference assembly mentioned (`fClaHyb_Gar_LG.fa`) is correct: it
  IS the F1 hybrid assembly (28 LGs), but it's used as the COORDINATE
  SYSTEM for the pure-gariepinus cohort. That's correct usage. The
  cohort ITSELF is not F1.

### 7. Code duplication audit

The PC1 panel and lanes panel duplicate the "you are here" rectangle
code (~50 lines each). This is intentional — the panels are siblings,
not subclasses — but the auditor should verify the two implementations
stay in sync. If one changes the alpha-1.0 / 0.95 contrast convention
and the other doesn't, the user gets visual inconsistency between
panels.

Other potential duplications:
- `_dosageClassColour` exists in both `regimes_panel.js` (exported as
  `_dosageClassColour`) and inline in `regimes_pc1_panel.js` (as
  `_dosagePC1ClassColour`). Should they share one symbol?
- The chromosome boundary tick drawing logic is in both panels.

### 8. Test coverage gaps

The 51 panel tests all use synthetic data. Notable gaps:
- No test verifies the canvas actually receives the right draw calls
  (no DOM mock).
- No test verifies the `_withDOMAliases` trick works correctly (the
  trick that lets one draw function write to either chrom or genome
  DOM ids by temporarily aliasing `document.getElementById`).
- No test for the "Show genome view" toggle button click path.
- No test for the `enable_genome_view: false` default — verified only
  by reading the code, not by exercising the init path.

---

## What's in this bundle

```
banding_unified_v3.4.tar.gz
├── README.md                        end-to-end pipeline doc
├── HANDOFF.md                       this file
│
├── pipeline modules (Cramer's V → Stage 4)
│   ├── anchor_signals.js
│   ├── window_classification.js
│   ├── seed_discovery.js
│   ├── cross_seed_voting.js
│   ├── locus_construction.js
│   ├── projection.js                NEW — production projection runner
│   ├── breadth_voting.js            NEW — Stage 4 driver
│   └── banding_pipeline.js          orchestrator
│
├── pre-existing band-tracking modules
│   ├── vote_evidence.js
│   ├── band_voters.js
│   ├── partition_consensus.js
│   ├── partition_enumerate.js
│   ├── hungarian.js
│   └── contingency.js
│
├── visualisation (NEW in v3.0–v3.4)
│   ├── regimes_panel.js             scope-aware lanes panel
│   ├── regimes_pc1_panel.js         PC1-lines variant
│   └── regimes_page.js              4-panel page wrapper
│
├── dosage
│   └── dosage_overlay.js            macro-band classifier
│
├── tests
│   ├── smoke_test_v2.mjs            5-phase Stage 1+2+3 smoke
│   ├── integration_test_v2.mjs      18 assertions, Stage 1-4
│   └── regimes_panel_smoke.mjs      51 assertions, panel + dosage
│
└── reference (uploaded by user this chat — kept for context)
    ├── lines_panel.js               existing PC1 lines (NOT modified)
    ├── pca_panel.js                 existing PCA panel (reference)
    ├── dosage_bridge.py             cluster endpoint
    ├── lazy_windows_json.py         windows-JSON cache
    └── SERVER_README.md             popstats_server architecture
```

## Test results at handoff time

```
$ node smoke_test_v2.mjs
=== ALL PHASES DONE ===                          (5 phases, all pass)

$ node integration_test_v2.mjs
=== 18 passed, 0 failed ===

$ node regimes_panel_smoke.mjs
=== 51 passed, 0 failed ===

TOTAL: 74/74 synthetic-data assertions
TOTAL: 0  real-data assertions
```

## Architecture diagram (full pipeline)

```
       per-window local PCA labels (from upstream)
                       │
          ┌────────────┴────────────┐
          │                         │
   Stage 1: V-driven         (existing inversion-
   seed discovery            atlas modules)
   per chromosome
   ↓ seeds[]                        │
                                    │
   Stage 2: cross-seed              │
   voting (N×N matrix)              │
   ↓ linkage_groups                 │
                                    │
   Stage 3: chain walk +            │
   per-band sample-sets             │
   ↓ stage3_loci[]                  │
                                    │
   Stage 4: bruteforce              │
   projection — every               │
   seed band → every                │
   target locus                     │
   ↓ per_target[]                   │
                                    │
   ┌──────────────────────────┐     │
   │  HAPLOTYPE REGIMES PAGE  │ ◄───┘
   │                          │
   │  4 canvases:             │
   │  - chrom · lanes         │  default: 2 of 4 visible
   │  - chrom · pc1           │
   │  - genome · lanes (opt-in)
   │  - genome · pc1   (opt-in)
   │                          │
   │  Focal voter = (seed,    │  ←/→ cycles seeds
   │  band_mask)              │  ↑/↓ cycles band combos
   │                          │  c cycles chromosome
   │                          │  g enables + computes genome
   │                          │
   │  "You are here" rect     │  K stripes, dosage-tinted
   │  on active seed          │  blue/white/red/grey
   │                          │  active α=1.0, inactive α=0.95
   └──────────────┬───────────┘
                  │
                  │ getMacroDosage(locus, sample_set)
                  ▼
   ┌──────────────────────────┐
   │   dosage_overlay.js      │
   │                          │
   │  macroBandDosage()       │
   │  classifyDosageMean() →  │
   │     HOM_REF / HET /      │
   │     HOM_INV / AMBIGUOUS  │
   │                          │
   │  countAxesByHetDis-      │
   │  jointness() → n_axes    │
   └──────────────┬───────────┘
                  │
                  │ sampleMeanDosage(si) callback
                  ▼
   ┌──────────────────────────┐
   │   dosage_bridge.py       │     cluster-side
   │   /api/dosage/chunk      │     popstats_server
   │   on LANTA               │     port 8765
   └──────────────────────────┘     SSH-tunnelled
```

## Design decisions audit log

These are the design calls made across v3.0 → v3.4. The auditor should
verify each one is still appropriate given what they discover:

1. **Stage 4 = bruteforce, not heuristic.** Every voter band projects onto
   every target window. Cost: O(n_seeds² · K_avg² · n_windows). Decision:
   fine for chromosome-scale, gated behind compute button for genome.

2. **COHERENT_SPLIT vs RANDOM_FAN distinction.** Daughter-stability
   classifier with Hungarian-aligned Jaccard ≥ 0.7. Decision: prevents
   misclassifying real sub-structure as noise.

3. **Per-chromosome by default.** Genome panels hidden until
   `enable_genome_view: true`. Decision: matches the project's tabular
   convention (per-chrom JSON, per-chrom tables).

4. **`getMacroDosage` callback, not direct server coupling.** The panels
   stay pure-frontend. Decision: same separation pattern as
   `popstats_server` — atlas decides what a group is, server only
   computes stats.

5. **Stratified "you are here" rectangle.** K horizontal stripes, one per
   seed band, dosage-tinted. Active bands at α=1.0, inactive at α=0.95.
   Decision: per Quentin's chat-message specification.

6. **PC1 panel as sibling of lines_panel.js, not modification.** The
   regimes-page work does not touch the existing local_pca_dosage. Decision:
   isolation.

7. **Three band-combo modes.** additive (default, K steps), informative
   (filter by signal), all (2^K-1). Decision: solves the K=6 problem.

8. **`_withDOMAliases` trick for genome rendering.** Temporarily
   redirects `document.getElementById` to write the genome panels with
   the same draw functions used for chrom. Decision: avoids duplicating
   the panel code; one drawback is the trick depends on no other code
   running synchronously inside the alias scope.

## Open questions for the audit

1. Is the `additive` enumeration the right default? With K=3, additive
   gives [b0, b0+b1, b0+b1+b2] which never visits b1 or b2 alone. Is
   that what Quentin actually wants, or does he want singletons first
   (b0, b1, b2, then b0+b1, etc., which is the "all" mode's first K
   entries)?
2. The dosage colour for HET is `#f8fafc` (near-white). Against a dark
   background this reads as white, against a light background it
   disappears. Should the panel detect theme and pick a colour that
   contrasts?
3. The genome-view "Compute" button does the full bruteforce
   synchronously. On a real 50k-window genome with K=3 average and
   stride=5, that's ~30k classifyProjection calls. Estimated cost:
   1-3 seconds. Should this be moved to a Web Worker?
4. The `_dosageClassColour` helper is exported with a leading underscore
   (idiomatic "internal but accessible"). Is that the right convention
   for this codebase? `regimes_panel.js` exports `PATTERN_CLASS_COLORS`
   without underscore. Inconsistent.

## Empirical work plan (post-audit)

Once the audit is complete and passes, the next steps on real data:

1. Per-window V + H_off render at LG28 16.5 Mb anchor.
2. Run runStage1 on LG28 alone. Compare seed boundaries with the
   validated 15.115–18.005 Mb call.
3. Run runStage1 on 2-3 more chromosomes for variety.
4. Cross-seed vote on 4-5 confirmed seeds.
5. Wire `getMacroDosage` against real dosage chunks for LG28.
6. Visual inspection of the regimes page on LG28.
7. Tune knobs if needed.
8. Scale to genome-wide.

---

## Final notes for the next chat

**Be paranoid.** The author of this code (me) is a language model that
cannot run the browser-side code. Every visual claim about how the
panels look is inferred from the canvas API specification, not
observed. Every claim about timing is estimated, not measured. Every
claim about "this should work on real data" is hopeful, not validated.

**Read every comment block sceptically.** Comments age faster than
code. If a comment claims an invariant that isn't enforced by an
assertion, treat the comment as suspect.

**Check the Stage 4 corner cases.** What happens with K=1 targets
(no partition possible)? With empty voters? With voters that don't
overlap any target band? Are these handled gracefully or do they
produce silent garbage?

**Don't trust the test count.** 74 passing tests with synthetic data
proves the architecture is internally consistent. It does not prove it
matches biology. Real-data validation is the audit's primary job.

— end handoff —
