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

### 9. Annotation spec audit (REGIME_ANNOTATION_SPEC.md)

A 4-layer regime annotation system was added as a spec doc this chat
but **not implemented**. The spec has grown substantially across
iterations and now includes:
- Detection-vs-interpretation conceptual frame at the top.
- Three-level POD evidence hierarchy (variant / load / fitness).
- Layer 2b — biological-mechanism classification skeleton
  (inversion-like / ancestry-linked / balanced / selected /
  supergene-like / low-recombination LD / incompatibility-linked /
  hyperdivergent / unresolved-complex). Scaffold only; per-
  mechanism evaluation modules not implemented yet.
- Layer 3a — per-variant candidate enumeration (was Layer 3b).
- Layer 3b — per-arrangement-group load contrast.
- Layer 3c — fitness/phenotype level (usually missing).
- Three interpretation traps with explicit anti-conflation rules.
- Measurement specifics for centromere proximity, low-recombination
  metrics, and the score-breakdown system.
- Verified references (Waller 2021, Abu-Awad & Waller 2023, Salson
  et al. 2025 Nat Commun, Pazhayam et al. 2024 Genetics).
- Suggested manuscript Results structure (3 sections).

The next chat should:

- Read `REGIME_ANNOTATION_SPEC.md` end to end.
- Verify the detection-vs-interpretation frame is preserved in
  every layer and every output column. The frame is the single
  most important conceptual element.
- Verify the 4-layer logic is internally consistent (positional /
  structure / POD / underdominance, with centromere overlap kept
  independent of mechanism).
- Specifically audit the scoring weights and cutoffs — defensible
  against Waller 2021 / Salson et al. 2025 / pearl millet methods?
- Verify the spec's audit-questions section (now **15 open
  questions** at the end of the doc) and answer them or escalate
  to Quentin.
- Confirm that upstream data dependencies exist:
  - Centromere/telomere calls for the C. gariepinus Gar haplotype
    (28 LGs). If not, positional layer can't run. The spec
    suggests synteny-based inference from a related species as a
    fallback.
  - Per-sample deleterious burden from MODULE_CONSERVATION (VESM,
    SIFT, SnpEff, GERP++/phastCons). Required for POD layer.
  - BEAGLE-phased GL output for the 226-sample cohort. **Mandatory**
    — Layer 3a / 3b / 4 all compute from GL posteriors, not from
    hard genotype calls. (Same input the popstats_server already
    consumes for Fst / HoverE.)
  - HWE departure per arrangement, computed from GL-derived expected
    counts. Required for underdominance layer.
  - Phenotype data (growth, survival, fertility, broodstock success).
    If absent, Layer 3c stays empty and the spec's
    `POD_compatible_*` ceiling stands. If present, Layer 3c becomes
    the manuscript's headline.
- Decide implementation strategy: in-browser JS module vs post-hoc
  R/Python batch with per-chromosome JSON output. Spec recommends
  post-hoc batch.
- Build a fixture with known POD / underdominance / centromere-only
  regimes and verify the scoring system gets them right.
- **NEW — audit Layer 3a (per-variant candidate enumeration)**:
  - Verify the filtering thresholds (polarisation ≥ 0.6, deleterious
    score ≥ 0.7, GL peak ≥ 0.85 in ≥ 80% samples, ≥ 5 per group).
  - Verify the polarity filter is symmetric — must enumerate variants
    fixed-on-INV AND fixed-on-STD; never assume one direction.
  - Grep all downstream code, scripts, and figure captions for
    "POD variant" (without "candidate" / "compatible") and flag every
    occurrence. The spec mandates `POD_candidate_variant` or
    `POD_compatible_recessive_load_variant` — never "POD variant."
    This is a manuscript-correctness issue that grows over time.
- **NEW — audit the score-breakdown independence**:
  - Verify the implementation keeps `centromere_score` and
    `POD_genetic_score` as **independent columns**, never summing
    them into one composite score. The spec mandates this to enforce
    Trap 3 (centromere overlap is NOT POD evidence).
- **NEW — pearl millet template (Salson et al. 2025) as method
  reference**:
  - The pearl millet study is the closest empirical analogue:
    diploid, outcrossing, cultivated population, LLR regions with
    POD signatures. The audit chat should read its methods section
    in full and verify the spec's metrics align. Their code repo:
    https://github.com/msalson/low-recombining_regions_study.

**Critical wording rules** (must be preserved downstream):
- Regime level: "POD-compatible", never "POD found."
- Variant level: "POD_candidate_variant" or
  "POD_compatible_recessive_load_variant", never "POD variant."
- The variant alone is not POD. The *pattern across genotypes* is
  POD-compatible. POD is a regime-level mechanism.
- Detection level: the regime is the **observed object**. POD,
  underdominance, ancestry, centromere — all of these are
  **interpretations** of why the regime exists. The two layers
  must not collapse.
- **Statistic-naming convention (the I/S collision resolution)**:
  the spec mandates `HWE_FIS` over bare `FIS`, and
  `arrangement_FST_like` (or `FAT_arrangement`) over bare `FST`,
  in spec-owned columns/figures/captions. The reason is that
  inversion-context manuscripts pair `STD/INV` (where I = Inversion)
  with `FIS` (where I = Inbreeding), creating an ambiguity
  reviewers will flag. The `HWE_` prefix forces the right reading.
  Existing references to upstream popstats_server Hudson Fst / ANGSD
  HoverE / etc. are unchanged because those are external-tool
  published-metric names.

**Critical independence rule from the spec**: centromere overlap is NOT
evidence for POD. A regime can be both centromeric AND POD-compatible,
OR centromeric AND ancestry-associated. These axes must stay
independent. The auditor should verify the spec's logic preserves this.

**Critical BEAGLE-GL rule**: hard-calling genotypes at the
breakpoint region — where genotyping accuracy is worst and where
both the POD masking and the underdominance HET-deficit signals are
most diagnostic — would systematically bias HET counts and produce
false signals. All Layer 3a / 3b / 4 metrics use GL posteriors,
never hard calls. The audit chat must verify this is plumbed
correctly in any implementation.

**Critical three-level distinction**: the spec keeps variant
evidence, load evidence, and fitness evidence as three separate
layers. Most cohorts have variant + load. Few have fitness. The
manuscript's strongest possible claim is `POD-compatible genetic
architecture`, not `POD proven`, unless fitness data is available.

### 10. Copy-origin painting spec audit (NEW — COPY_ORIGIN_PAINTING_SPEC.md)

A paralogue-ancestry painting module was added as a spec doc this chat
but **not implemented**. The next chat should:

- Read `COPY_ORIGIN_PAINTING_SPEC.md` end to end.
- Verify the 5-step pipeline (A=copy dictionary, B=PSV markers,
  C=window painting, D=mechanism classification, E=HOM/HET
  integration) is internally consistent.
- Audit the calling thresholds (0.8 dominance, ≥5 informative
  markers) against real PSV density in the C. gariepinus SDs.
- Verify the "no mosaic evidence" label is consistently distinguished
  from "no rearrangement" — these are different biological scenarios
  and the spec must not let them be conflated.
- Confirm upstream data dependencies exist:
  - SD calls for the Gar haplotype assembly (28 LGs) — Quentin's
    `catfish-synteny-toolkit` may produce these.
  - PSV-calling pipeline. The spec marks this as the hardest step;
    a real PSV validation pass against long-read data is the gating
    item before any implementation.
- Audit the `instant_q` analogy. The spec proposes treating copies
  as ancestry sources and reusing Engine B's machinery (or its
  conceptual logic). Verify the analogy holds — is EM-style soft
  assignment appropriate for PSV-based copy calling?
- Verify the 10-question audit-questions list at the end of the
  spec — answer or escalate to Quentin.
- Decide implementation strategy: reuse `instant_q` C++ binary with
  a different reference matrix, or build a separate module. Spec
  notes both options.

**Critical caveats from the spec** (must be preserved downstream):

- "NAHR-compatible" never "NAHR-confirmed."
- "no mosaic evidence" does NOT mean "no breakpoint."
- The HOM/HET integration has a circular dependency on karyotype
  calls — if karyotypes are wrong near the breakpoint (a common
  problem), the painting will look noisy even when biology is clean.
- PSV calling is the accuracy floor. Bad PSVs → garbage in every
  downstream step.

**Critical connection to regime annotation**: a candidate regime
gets a `regime_class` from `REGIME_ANNOTATION_SPEC.md` (e.g.
`interstitial_inversion_like`) AND a `mechanism` from
`COPY_ORIGIN_PAINTING_SPEC.md` (e.g. `NAHR-compatible`). These are
complementary, not redundant: regime annotation explains the
*evolutionary mechanism*, copy-origin painting explains the
*molecular mechanism* of the breakpoint itself. The audit chat
should verify the two specs don't disagree on field names or
candidate_id semantics.

### 11. Fish Ancestry Scroller spec audit (NEW — FISH_ANCESTRY_SCROLLER_SPEC.md)

A new atlas page was added as a spec doc this chat: an ancestry-
aware inversion browser that visualises per-RF local ancestry
relative to genome-wide global Q, with |ΔQ| as the headline
diagnostic. **Two mockups exist** — an early 8-track horizontal
scroller (v1) and a three-numbered-layer atlas page (v2). The spec
marks **v2 as canonical**. For the MS_Inversions manuscript, the
cohort is the 226-sample pure C. gariepinus. The page is generic —
NOT species-specific.

The next chat should:

- Read `FISH_ANCESTRY_SCROLLER_SPEC.md` end to end.
- **PRIORITY: audit the label-switching alignment pipeline.**
  This is the load-bearing technical content. If the audit
  finds the alignment pipeline is wrong, broken, or incomplete,
  the whole page is unsafe to implement. Specifically:
  - Verify the F-based correlation method works on the existing
    instant_q (Engine B) per-RF output. Confirm `.fopt` format
    + SNP overlap pattern between local and global runs.
  - Verify Hungarian assignment (or K! brute-force for small K) is
    the correct permutation finder. `hungarian.js` already exists
    in the band-tracking modules — reuse.
  - Verify the Q-alignment fallback is restricted to flanking
    regions only. **Inside the inversion block, Q-alignment must
    NEVER be used** — it would hide the very signal the page
    exists to show. Confirm the spec language enforces this.
  - Test alignment confidence thresholds (PASS ≥ 0.85, WARN ≥ 0.70,
    FAIL < 0.70) on a known-stable region (high SNP coverage,
    coherent ancestry) and a known-unstable region (sparse SNPs).
  - Verify the regime-aware neighbour smoothing rule (override
    permutation when neighbours agree and the centre RF has
    lower align_score) is correct and doesn't over-smooth real
    biological transitions.
- Verify cohort identity is enforced. The dataset selector is the
  single source of truth; switching from salmon-demo to catfish
  must clear all panel state. Cross-cohort comparison is out of
  scope. Critical for the three-cohort separation rule (never
  mix F1 hybrid / 226-pure-gariepinus / wild C. macrocephalus).
- Verify the spec's 12 audit-questions section and answer them
  or escalate to Quentin.
- Confirm upstream data dependencies:
  - Per-RF instant_q (Engine B) NGSadmix output exists with
    paired `.qopt` + `.fopt` files for the 226-sample cohort.
  - The global Q/F reference is the same instant_q run used
    elsewhere in the project — not a separate run with different
    parameters.
  - Stage 4 regime calls are available (the "Regime A / B / C"
    track consumes these).
  - Dosage classifications are available (the dosage heatmap
    track consumes `dosage_overlay.js` output).
- Decide implementation strategy: offline batch (recommended for
  the alignment pipeline) + atlas-side page reading precomputed
  TSVs. The page should NOT run NGSadmix at request time, NOT
  do alignment in-browser.

**Critical caveats from the spec** (must be preserved downstream):

- "Aligned Q only" in the display layer. Raw `.qopt` colours are
  numerically valid but biologically meaningless — they will
  produce fake ancestry switches at every window boundary.
- FAIL-status RFs render grey, not coloured. A failed RF in an
  otherwise-clean block is informative ("alignment broke here");
  papering over it with a plausible-looking colour is dishonest.
- Q-alignment fallback must not be used inside the inversion
  block window range (it would suppress the |ΔQ| signal the
  page exists to display).
- Naming convention applies: `HWE_FIS` not bare `FIS` for any
  heterozygosity statistic shown in the per-block summary.

**Critical visual-honesty rule**: the user explicitly says "the UI
should not say 'blue changed to orange' until after label
correction." This is the most important guard. If the audit chat
finds any way the page could display raw labels in the main view,
that is a blocker.

**Connection to other specs**: the scroller's regime track consumes
Stage 4 regime calls (from the regimes page); the dosage track
consumes `dosage_overlay.js` + dosage_bridge output; the
HWE_FIS column in the per-block summary follows the naming
convention in `REGIME_ANNOTATION_SPEC.md`. The page is the
ancestry-interpretation companion to the regimes page's
discovery view.

**Ancestry bricks layer (new this iteration)**: the scroller spec
now includes a derived simplification layer that merges contiguous
aligned-Q RFs into bricks. Audit chat should specifically check:

- The brick merging rule (same dominant_K, ≥ min_purity, PASS/WARN/
  SMOOTHED status, no Stage-4 regime boundary in between) is
  internally consistent and reusable.
- Brick labels are measurable and neutral — `RARE_ANCESTRY`,
  `HIGH_HET`, `LOW_HET`, `HIGH_DELTA_Q`, `LOW_CONFIDENCE`,
  `REGIME_DISCORDANT`, `DOSAGE_DISCORDANT`, `BOUNDARY_BRICK`,
  `RECOMBINANT_LIKE`, `FRAGMENT`, `ROH_LIKE`, `COMMON`.
- "Strange" / "weird" / "interesting" are not used anywhere in the
  brick layer's UI or detail card.
- The REGIME_DISCORDANT and DOSAGE_DISCORDANT rules have explicit
  operational definitions (the spec defines both).
- Manuscript phrasing rule: "the inversion is associated with a
  K-enriched ancestry brick," never "we discovered N bricks." Same
  restraint as "POD-compatible" vs "POD found." Grep all downstream
  output for the words "we discovered" near "brick" or "bricks" and
  flag.
- Bricks output two new TSVs: `06_ancestry_bricks.tsv` and
  `07_brick_annotations.tsv`.
- Six color modes (ancestry / heterozygosity / delta_Q / entropy /
  discordance / confidence). Default composite encoding uses fill
  for ancestry, opacity for confidence, border for heterozygosity,
  icon for discordance.

**v2 mockup canonical UI (new this iteration)**: a second mockup
`ancestry_atlas_mockup_v2.png` is now the canonical layout. The
audit chat should specifically check:

- The v2 design organises the page as three numbered layers:
  ① PC1 Band / Regime (per fish, from Stage 4 banding), ②
  Ancestry Bricks (per fish, the headline interactive layer), and
  ③ Brick summary (cohort view — majority ancestry bar + fraction
  agreement area chart).
- Between Layer 2 and Layer 3, a "Brick metrics" multi-heatmap
  section shows five stacked rows: ΔQ, Heterozygosity z-score,
  Entropy, Confidence, Dosage concordance. Each row has a colour-
  scale legend in the right margin.
- The page sits inside a larger "Fish Atlas" tab strip:
  Overview / Candidates / Ancestry / Pop Stats / Regimes / Markers
  / Breakpoints. `Markers` is the copy-origin painting page;
  `Breakpoints` is a separate spec (LG28 prototype refinement) not
  in this bundle.
- Two header toggles `Show inversion` and `Show breakpoints` draw
  dashed vertical guides at the inversion endpoints across every
  track. The cross-layer alignment guarantee (same horizontal
  coordinate system, same fish ordering, same column positions)
  must be enforced.
- The right side panel has four blocks: explainer card, view-mode
  + overlay controls, Selected brick card, and an implicit colour-
  scale legend column for the metric heatmaps.
- The spec preserves the v1 8-track design as a superseded
  alternative for historical reference and because parts of the
  alignment-pipeline section reference v1's Track 2. The audit
  chat should decide whether any v1 elements (e.g. the bottom
  per-fish detail table — v1 has it explicitly; v2 uses the
  Selected brick card instead) should be ported back into v2.
- The mockup labels brick-metrics row as "③" in the context
  explainer but the actual Layer 3 is the Brick summary. The
  spec recommends labelling brick-metrics without a circled
  number to avoid this conflict — audit chat should verify the
  implementation picks one consistent numbering.

**v2-specific implementation guarantees to verify**:

- Single shared horizontal coordinate system across Layer 1,
  Layer 2, the five metric heatmaps, and Layer 3. Dashed inversion
  guides at the breakpoint positions hit the same pixel column on
  every track.
- Identical fish row ordering across Layer 1, Layer 2, and the
  metric heatmaps. Sorting by any column resorts all of them.
- Window size in the bottom legend is dynamic (the mockup shows
  "Each column = RF window (50 kb)" — this 50 kb must be the
  project's actual window size at render time, not hard-coded).
- Status icons (▢, ▲, ⚠, ⊗) on bricks render only when the
  `Show warnings` toggle is ON. When OFF, the underlying
  status_flags fields are still populated in output TSVs — the
  toggle is visual only, not data-suppressing.

---

## What's in this bundle

```
banding_unified_v3.4.tar.gz
├── README.md                        end-to-end pipeline doc
├── HANDOFF.md                       this file
├── REGIME_ANNOTATION_SPEC.md        4-layer regime annotation,
│                                    awaiting audit before implementation
├── COPY_ORIGIN_PAINTING_SPEC.md     paralogue ancestry painting
│                                    for breakpoint mechanism, awaiting
│                                    audit before implementation
├── FISH_ANCESTRY_SCROLLER_SPEC.md   NEW — ancestry-aware inversion
│                                    browser page with label-switching
│                                    alignment guard, awaiting audit
│                                    before implementation
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
   regimes-page work does not touch the existing page1. Decision:
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
