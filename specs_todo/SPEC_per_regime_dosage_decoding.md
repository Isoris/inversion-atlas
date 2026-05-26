# SPEC — per-regime dosage decoding on the haplotype_regimes page

**Status**: SPEC ONLY — authored 2026-05-23 from user-articulated
architectural insight (verbatim user text preserved below in §3).
Implementation pending.

**Companion**: `docs/PIPELINE_ANALYSIS_ORDER.md` Cluster 3
(`haplotype_regime.refineRegimesFromIntervals`).

---

## 1. The problem

Today the haplotype_regimes page Cluster 3 produces refined regimes
(intervals with arrangement-identity classified as EXTENSION /
NESTED / SHARED_HET / SWAPPED / UNRELATED). The view-toggle "long-range
regimes" surfaces a summary table.

What it does NOT do: re-decode each regime with its OWN dosage
heatmap + independent K=3 classification.

Concrete failure case: a candidate covers LG xx : 10–30 Mb. Inside
this 20 Mb range there are TWO distinct segregation regimes —
10–18 Mb (A/B segregation) and 18–30 Mb (C/D segregation) —
representing two adjacent but independent arrangements. Forcing one
K=3 dosage model across the entire 20 Mb produces a messy K=6 pattern
("Candidate_07 = complex K=6 structure"). The two underlying biallelic
inversions are hidden by the merged model.

## 2. The fix

Treat the long-range regime layer as a **segmentation** layer, not a
karyotyping layer. Then for each regime independently, run the
dosage decoder with its own K=3 (or K=2, K=4 — whatever fits the
regime). This gives clean per-regime labels:

```
Candidate_07a = biallelic regime 10–18 Mb,  HOM_A / HET_AB / HOM_B
Candidate_07b = biallelic regime 18–30 Mb,  HOM_C / HET_CD / HOM_D
Candidate_07c = transition zone / breakpoint / recombinant
```

Instead of: `Candidate_07 = complex K=6`.

## 3. Architecture (user's words — preserved verbatim)

> Yes — that is the cleanest interpretation.
>
> The long-range regime layer is not there to assign final karyotypes.
> It is there to say:
>
> > "This genomic region contains one or more coherent segregation
> > regimes. Treat each regime separately."
>
> Then the dosage heatmap layer says:
>
> > "Within each regime, what are the actual genotype/karyotype
> > states?"
>
> So if the same broad region has two regimes, you do two dosage
> heatmaps, not one mixed heatmap.
>
> Region LGxx: 10–30 Mb
>
> Regime 1: 10–18 Mb
> → dosage heatmap 1
> → classify HOM_A / HET_AB / HOM_B or complex
>
> Regime 2: 18–30 Mb
> → dosage heatmap 2
> → classify HOM_C / HET_CD / HOM_D or complex
>
> That makes much more sense than forcing the whole 10–30 Mb block
> into one K=3 model.

### Why this is important

> If you merge two regimes into one heatmap, you can create fake
> complexity:
>
> Regime 1 has A/B segregation
> Regime 2 has C/D segregation
> Combined heatmap = messy 4–6 cluster pattern
>
> But if you split them:
>
> Regime 1 = clean biallelic model
> Regime 2 = clean biallelic model
>
> or maybe:
>
> Regime 1 = biallelic inversion
> Regime 2 = complex/nested event
>
> So the long-range layer is basically a segmentation layer.

### Better architecture

> Your atlas logic should be:
>
> 1. Detect long-range segregation regimes
>    output: regime intervals
>
> 2. For each regime independently:
>    build dosage heatmap
>    select diagnostic SNPs
>    cluster samples
>    assign karyotype model
>    score confidence
>
> 3. Compare neighboring regimes:
>    same sample grouping? → maybe merge
>    different grouping? → keep separate
>    partially shared grouping? → nested/recombined/complex
>
> 4. Run Mendelian validation per regime

### Cleaner final labels

> Instead of one confusing candidate:
>
> Candidate_07 = complex K=6 structure
>
> You may get:
>
> Candidate_07a = biallelic regime, HOM_A/HET_AB/HOM_B
> Candidate_07b = biallelic regime, HOM_C/HET_CD/HOM_D
> Candidate_07c = transition zone / breakpoint / recombination zone
>
> That is much more interpretable.

### Manuscript framing

> Long-range segregation analysis was used to segment broad candidate
> regions into internally coherent regimes. Dosage heatmaps were then
> generated independently for each regime, allowing karyotype states
> to be assigned within each segment rather than forcing a single
> genotype model across structurally heterogeneous regions.

### Bottom line

> Long-range regime = segmentation. Dosage heatmap = karyotype
> decoding.
>
> If there are two regimes in the same broad region, make two dosage
> heatmaps, one per regime. This will probably solve many of the
> "K=3 is weird" problems.

---

## 4. Implementation plan

### 4.1 Where this lives

`atlases/inversion/pages/discovery/haplotype_regimes.js` — extend the
existing post-pipeline tail (`_runPostSeedingTail`) to add a per-
regime decoder step after `refineRegimesFromIntervals` and before
the catalogue serializer.

### 4.2 New per-regime decode pass

After Cluster 3 produces `state._regimesPostSeeding.refined.regimes`,
loop:

```js
for (const regime of refined.regimes) {
  const { start_bp, end_bp, member_interval_ids } = regime;

  // 1. Collect dosage signal restricted to this regime's bp range.
  //    Already cached in state.data via the chrom precomp.
  const dosageSlab = _sliceDosage(state.data, start_bp, end_bp);

  // 2. Optionally select diagnostic SNPs: variants whose minor allele
  //    frequency differs most across the regime's identified sample
  //    cores (hom_a_intersect / hom_b_intersect / het_union).
  const diagnosticMask = _pickDiagnosticSnps(dosageSlab,
                          regime.hom_a_intersect, regime.hom_b_intersect);

  // 3. Per-regime K-means / clustering. Try K=2 + K=3 + K=4, pick
  //    by silhouette + biological plausibility (single HET class
  //    expected for biallelic).
  const decoded = decodeRegimeKaryotype({
    dosage: dosageSlab,
    mask: diagnosticMask,
    expected_n_classes: regime.n_intervals === 1 ? 3 : null,
  });

  // 4. Score confidence: silhouette + size_balance + within-class π
  //    + cross-class FST (the existing band_quality formula extended).
  const confidence = scoreRegimeDecoding(decoded);

  // 5. Attach per-regime decoded output to the regime record.
  regime._decoded = {
    K:                decoded.K,
    labels:           decoded.labels,
    karyotype_classes: decoded.classes,
    confidence,
  };
}
```

### 4.3 New layer

Add `inversion.per_regime_decoding_v1` to `layers.registry.json`:

```jsonc
{
  "layer_id": "per_regime_decoding_v1",
  "kind": "scalar",
  "leaf_kind": "json",
  "label": "Per-regime dosage decoding",
  "version": 1,
  "cohort_id": "cgar_hatchery_226",
  "reference_id": "fClaHyb_Gar_LG",
  "produced_by": "banding_pipeline",
  "description": "For each refined regime, an independent K-clustering on dosage restricted to the regime's bp span. Avoids the fake-complexity failure mode of forcing K=3 across structurally heterogeneous candidates."
}
```

### 4.4 UI

In the "long-range regimes" view (the toggle we added 2026-05-20), the
regimes summary table grows three columns:

| existing | new |
|---|---|
| id, chrom, bp span, n_intervals, hom_a, het, hom_b, chain | **K_decoded** (best-fit K per regime), **karyotype** ("HOM_A/HET/HOM_B" or "complex"), **confidence** (0-1 from scoreRegimeDecoding) |

And a new per-regime mini dosage heatmap renders below the summary
table when a regime row is hovered/clicked:

```
[hover regime_007a]
  → bp span 10.0–18.0 Mb
  → K=3, HOM_A=24 / HET=11 / HOM_B=23 (biallelic, conf 0.91)
  → mini dosage heatmap (samples sorted by decoded label):
       ████████████        █████████████
       ████████████        █████████████   ← HOM_A
       ████████████  ░░░░  █████████████
       ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   ← HET (mixed)
       ████████░░░░  ████  █████████████   ← HOM_B
                ...
```

### 4.5 Inter-regime comparison

After per-regime decoding, compare adjacent regimes:

```
For each adjacent pair (regime_i, regime_{i+1}):
  jaccard_hom_a = |HOM_A_i ∩ HOM_A_{i+1}| / |HOM_A_i ∪ HOM_A_{i+1}|
  jaccard_hom_b = |HOM_B_i ∩ HOM_B_{i+1}| / |HOM_B_i ∪ HOM_B_{i+1}|

  if both jaccards ≥ 0.85:    merge_suggestion = MERGE
  if both jaccards ≤ 0.15:    merge_suggestion = INDEPENDENT
  if mixed (one high, one low): merge_suggestion = TRANSITION / RECOMBINANT
  else:                         merge_suggestion = NESTED / PARTIAL
```

Surface this as a "merge/split suggestion" column in the regimes
table. Don't auto-merge; let the user decide.

### 4.6 Mendelian validation per regime (deferred to Phase 2 of this SPEC)

Once per-regime karyotypes exist, the popstats atlas's Cluster 4
modules (`regime_mendelian` / `regime_dyad_mendelian`) can run on each
regime independently. This is a cross-atlas read pattern already
established (inversion → popstats), so no new infrastructure needed.

---

## 5. Edge cases

| Case | Behavior |
|---|---|
| Regime with `n_intervals = 1` | Standard K=3 attempt (biallelic expected); if silhouette < threshold, retry K=2; if still weak, label "complex". |
| Regime with `n_intervals ≥ 2` | Try K=3 + K=4 + K=5, pick by silhouette + biological plausibility (multi-axis HET-disjointness via dosage_overlay's existing `countAxesByHetDisjointness`). |
| Regime too short (n_windows < 5) | Skip decoding; mark as "below resolution". |
| Regime with NO dosage signal | Mark as "non-segregating" (fixed difference vs population structure artifact). |
| Adjacent regimes with identical sample partitions | Suggest MERGE (the segmentation was over-split — recombination break-detection too sensitive). |

## 6. Test plan

- Synthetic: 2 adjacent biallelic inversions with disjoint sample partitions → 2 clean K=3 regimes after split, NOT 1 messy K=6.
- LG28 known 60/106/60: single regime, K=3, HOM_REF=60 / HET=106 / HOM_INV=60 ± noise. The validation target from `INVERSION_PIPELINE_METHOD_v2.md`.
- Edge: forced single window — decoder should reject (below resolution) not produce garbage K.

## 7. Open questions

1. **Picking K per regime**: silhouette is the obvious metric but it can prefer over-fit K. Should we add a prior (K=3 for biallelic-presumed, K=2 fallback) or let it run free?
2. **Diagnostic SNP selection**: per-regime vs all-window. Picking only sites whose minor-allele freq differs across `hom_a_intersect` vs `hom_b_intersect` boosts signal but assumes Cluster 3's cores are correct. Alternative: all sites with MAF > threshold + per-site χ² filtering.
3. **Transition zones**: how wide must a "transition / recombinant" call zone be? The interval between two regimes is sometimes a single window — too narrow for confidence. Should we require ≥ 3 windows of mismatch before labeling TRANSITION?
4. **UI surface**: per-regime mini dosage heatmaps as a 4th panel below the existing 3 (above the regimes table) vs. inline-expanded rows in the regimes table. The 4th-panel approach is more visible; the inline approach is denser.

## 8. Out of scope

- Cross-chromosome regime correlations (a separate workflow).
- Producer-side dosage recomputation (popstats atlas).
- Manuscript figure recipes (downstream of the decoder existing).

---

## 9. Multi-arrangement reality (added 2026-05-26)

User feedback 2026-05-26 — verbatim:

> now the haplotype page it does only K3 but in reality its not like
> that real life its not same. real life uses arrangements that
> sometimes get in the same fish so that makes heterozygote for that
> arrangement. some are compatible some not.

### 9.1 What this means

A regime is NOT always biallelic. Within one internally-coherent
regime there can be `n_arrangements ≥ 2` distinct arrangements
(label them `H1, H2, H3, …`). A diploid sample's karyotype at the
regime is an unordered pair `{H_i, H_j}`. So the full state space
for `n_arrangements = N` is:

```
homozygotes:    N states         (H1/H1, H2/H2, …, HN/HN)
heterozygotes:  N·(N-1)/2 states (H1/H2, H1/H3, …)
total:          N·(N+1)/2 states
```

Special cases:

| N | hom | het | total K (max) | comment |
|---|-----|-----|---------------|---------|
| 2 | 2   | 1   | 3             | The biallelic "K=3" SPEC §1 assumed |
| 3 | 3   | 3   | 6             | A *real* K=6 inside one regime |
| 4 | 4   | 6   | 10            | Rare but possible |

So K=6 in one regime is NOT automatically the "two-regimes-glued-
together" failure of §1 — it can also be a real 3-arrangement regime.
The decoder must distinguish these two cases.

### 9.2 Compatibility (some arrangements don't co-occur)

Some heterozygous pairs are absent because:
- meiotic / mechanical incompatibility (large overlapping inversions
  → unbalanced gametes → no viable `H_i/H_j`);
- demographic absence (the two arrangements never met in the
  pedigree under study);
- selection against the heterozygote.

So the *observed* K can be less than `N·(N+1)/2`. The decoder
should accept missing het classes as informative, not as failure.

### 9.3 How the decoder must change

1. **Drop the hard K=3 prior.** Replace the
   `expected_n_classes: regime.n_intervals === 1 ? 3 : null`
   heuristic in §4.2 with a sweep over `K ∈ {2, 3, 4, 6, 10}`
   (the triangular numbers `N·(N+1)/2`).
2. **Recover `n_arrangements` from K.** For each candidate K,
   solve `K = N·(N+1)/2` for integer N. If no integer N exists,
   penalise (K=4 and K=5 are possible only with absent het classes;
   acceptable but flagged).
3. **Label classes as arrangement pairs, not "HOM_A / HET / HOM_B".**
   Output:
   ```
   karyotype_classes: [
     { label: "H1/H1", n_samples: 24, type: "hom",  arrangement: "H1" },
     { label: "H1/H2", n_samples: 11, type: "het",  pair: ["H1","H2"] },
     { label: "H2/H2", n_samples: 23, type: "hom",  arrangement: "H2" },
     { label: "H1/H3", n_samples: 4,  type: "het",  pair: ["H1","H3"] },
     …
   ]
   ```
4. **Discriminate "real K>3 regime" vs "two-regimes-glued-together":**
   bp-coordinate test. Compute, for each detected class, the
   *centroid bp position* of its members' diagnostic-SNP signal
   within the regime. If classes split into two disjoint bp clusters
   along the regime, this is the failure mode of §1 (segmentation
   under-split) → flag `recommend_split = true`. If classes are
   bp-mixed across the regime, this is a real multi-arrangement
   regime → flag `n_arrangements = N`.
5. **Compatibility matrix.** Per regime, emit an `N × N` matrix
   `het_observed[i][j] ∈ {0, 1}` listing which heterozygous pairs
   were seen. Manuscript / popstats can read this directly to
   call meiotic incompatibility.

### 9.4 Updated canonical vocabulary (binding on this SPEC)

Per user instruction 2026-05-26:

| Term | Meaning |
|------|---------|
| `candidate_region` | A broad bp interval flagged as potentially carrying structural variation. Pre-segmentation. |
| `arrangement` | A discrete sequence configuration at a regime (H1, H2, H3, …). The atomic unit of karyotype. |
| `regime` | An internally coherent segregation segment of a candidate_region, carrying `n_arrangements ≥ 2`. |
| `dosage_heatmap` | The samples × diagnostic-SNPs matrix computed for ONE regime. |
| `karyotype_call` | A sample's `{H_i, H_j}` state at one regime. Values: an arrangement-pair label, or `COMPLEX` or `NO_CALL`. |
| `POD` (point of diagnosis) | A regime that has passed Mendelian validation and is therefore usable for cargo / phenotype interpretation. |

### 9.5 Master rule (binding architecture)

> Long-range regime detection **segments** the genome. Each regime
> gets its own dosage heatmap. The dosage heatmap assigns
> karyotype_calls (arrangement pairs `H_i/H_j`). Mendelian
> validation tests those calls. Breakpoints support regime
> boundaries. PODs are created only after validated regimes.

This master rule is reproduced in `docs/ARCHITECTURE_MASTER.md`
and supersedes any contradictory language elsewhere in the atlas.

---

*End of SPEC. Authored from user feedback 2026-05-23. §9 added
from user feedback 2026-05-26. §10 added from user feedback
2026-05-26 (later). Awaiting audit + implementation approval.*

---

## 10. Segregation-state framing (added 2026-05-26, later)

User feedback 2026-05-26 (later) — verbatim:

> Instead of forcing every region into HOM_A / HET_AB / HOM_B
> you describe a segregation-state system: This region contains
> 5 or 6 recurrent dosage-supported states. Some states behave
> like homozygous arrangement classes, and some behave like
> heterokaryotype classes.
>
> Better vocabulary — do not call everything "K=6" biologically.
> Say: segregation states / arrangement states / dosage-supported
> states / candidate karyotype states. Then classify them as:
> HOM-like state / HET-like state / complex state / unresolved
> state.
>
> A 6-band region is not necessarily broken. It may mean: the
> region is not a simple biallelic inversion but a multiallelic
> structural haplotype system, with several homozygous and
> heterozygous arrangement combinations.
>
> its really like some arrangement they can make HET with another
> arrangement they are compatible. sometimes we observe them.
> sometimes we don't observe. sometimes we observe them as HET
> but not as HOM

### 10.1 Two-stage output (replaces §9.3 step 3)

The decoder must NOT directly emit `karyotype_call: "H_i/H_j"`.
It emits two layers:

**Layer A — segregation states (always emitted):**
```
{
  state_id: "S1",
  state_type: "HOM-like" | "HET-like" | "complex" | "unresolved",
  state_size: <n samples>,
  dosage_pattern: <vector summary>,
  members: [<sample_ids>]
}
```

**Layer B — putative arrangement combinations (emitted only
when dosage + Mendelian support it):**
```
{
  state_id: "S1",
  putative_arrangement_combination: "A/A" | "A/B" | null,
  evidence: {
    dosage_consistent: true|false,
    mendelian_support: <score 0..1 | null if untested>,
    confidence: "high" | "medium" | "low" | "unsupported"
  }
}
```

If Layer B's evidence is weak, the state stays at Layer A
(`state_type` only) and `putative_arrangement_combination`
stays `null`. Do NOT invent an arrangement assignment just to
fill the column.

### 10.2 Table schema (binding for output serialisation)

The per-regime decoder writes one row per state:

| column | type | example |
|--------|------|---------|
| `regime_id` | string | `REG_014` |
| `n_states_detected` | int | `6` |
| `state_id` | string | `S2` |
| `state_size` | int | `11` |
| `state_type` | enum | `HET-like` |
| `putative_arrangement_combination` | string \| null | `A/B` or `null` |
| `dosage_pattern` | json | summary vector |
| `mendelian_support` | float \| null | `0.83` |
| `interpretation` | string | free-text, optional |

Example for a 3-arrangement regime:

```
REG_014  6  S1  24  HOM-like  A/A    {...}  0.91  biallelic-like core
REG_014  6  S2  11  HET-like  A/B    {...}  0.87  observed het, A and B HOM also observed
REG_014  6  S3  23  HOM-like  B/B    {...}  0.92  biallelic-like core
REG_014  6  S4  4   HET-like  A/C    {...}  0.78  HET observed, but no C/C HOM in cohort
REG_014  6  S5  3   HET-like  B/C    {...}  0.71  HET observed, but no C/C HOM in cohort
REG_014  6  S6  null complex  null   {...}  null  unresolved residual cluster
```

### 10.3 Observed-as-HET-but-not-HOM inference rule

User stated: "sometimes we observe them as HET but not as HOM."

If the decoder finds two HET-like states that share a "shoulder"
arrangement with already-confirmed HOM states (e.g. `A/B` and
`A/C` exist; `A/A` is HOM-confirmed) but the third arrangement
(`C`) is never observed homozygous, the decoder MAY infer that
arrangement `C` exists in the cohort only in heterozygous form.

Rules:
1. The inferred arrangement (`C`) is labelled with a trailing
   `?` for one release cycle: `A/C?` → makes clear the `C`
   identity is HET-only inferred, not HOM-anchored.
2. `evidence.confidence` for HET-only-inferred states is capped
   at `"medium"`.
3. The cohort-frequency layer must record `hom_observed = 0`
   for `C` so downstream readers (popstats) know to treat the
   arrangement as cohort-limited.
4. If subsequent cohorts (e.g. cmac_wild) DO show a `C/C`
   homozygote, the `?` is dropped and confidence is recomputed.

### 10.4 Updated thesis sentence (for manuscript)

Verbatim from user, preserved for use in manuscript draft:

> Rather than assuming a fixed three-band inversion model,
> candidate regimes were treated as dosage-supported segregation
> systems. Simple regimes were consistent with three karyotype
> states, whereas complex regimes contained five to six recurrent
> states, suggesting multiallelic or nested structural haplotype
> systems capable of producing multiple heterokaryotype classes.

### 10.5 Decoder output contract (supersedes §4.2's `regime._decoded`)

Replace:
```js
regime._decoded = {
  K: decoded.K,
  labels: decoded.labels,
  karyotype_classes: decoded.classes,
  confidence,
};
```

with:
```js
regime._decoded = {
  n_states_detected: <int>,
  states: [
    {
      state_id: "S1",
      state_type: "HOM-like" | "HET-like" | "complex" | "unresolved",
      state_size: <int>,
      dosage_pattern: <vector summary>,
      members: [<sample_ids>],
      putative_arrangement_combination: <string|null>,
      evidence: {
        dosage_consistent: <bool>,
        mendelian_support: <float|null>,
        confidence: "high"|"medium"|"low"|"unsupported"
      }
    },
    ...
  ],
  interpretation_summary: <string>
};
```

### 10.6 Master doc update

The canonical vocabulary in `docs/ARCHITECTURE_MASTER.md` §2
gains:

- `segregation_state` (replaces "K class" as the unit of decoder
  output);
- `state_type ∈ {HOM-like, HET-like, complex, unresolved}`;
- `arrangement_combination` (the putative mapping from state to
  arrangement pair, evidence-gated);
- the explicit rule that `karyotype_call` is Layer B only —
  Layer A (the segregation state) always exists.

That update is made in the same commit as this §10.

---

## 11. Arrangement compatibility graph (added 2026-05-26, later)

User feedback 2026-05-26 (later) — verbatim excerpts:

> For the long-range regime + dosage system, the right object
> is an arrangement compatibility graph. Not just state = HOM
> or HET but state = combination of arrangements. So the graph
> represents which hidden arrangements can combine to produce
> the observed dosage states.
>
> For each long-range regime, dosage-supported states were
> represented as nodes in an arrangement compatibility graph.
> Candidate hidden arrangements were inferred by testing whether
> the observed states could be explained as diploid combinations
> of two or more arrangements. This generalized the simple
> three-state HOM/HET/HOM model to complex regimes with multiple
> homozygote-like and heterozygote-like states.
>
> need graph of compatibility for haplotype regime page. but
> need as floating panel because its so crowded.

### 11.1 Two graphs per regime (binding)

The decoder emits TWO graphs per regime. Both are derived from
the Layer A states and the Layer B putative assignments.

**Graph A — arrangement graph (hidden arrangements as nodes):**

- Nodes: the inferred hidden arrangements `A, B, C, …` for the
  regime.
- Edges: `A — B` iff a HET-like state `A/B` was observed in the
  cohort.
- Edge weight: `n_samples` carrying that het.
- Self-loops: optional, indicate the HOM-like state for that
  arrangement (`A — A` with weight `n_samples` of `A/A`).

Interpretation: if A connects to B and C but B and C never meet,
the cohort lacks the `B/C` heterozygote — either by sampling,
selection, or meiotic incompatibility.

**Graph B — dosage-state graph (observed states as nodes):**

- Nodes: the observed segregation states `S1, S2, …, Sk`.
- Edges: `S_i — S_j` iff they share exactly one hidden
  arrangement in their `arrangement_combination`.
- Edge label: the shared arrangement.
- Edge weight: structural similarity of the two states'
  dosage_pattern (a 0–1 score from the decoder).

Interpretation: this graph tells you which states are
biologically related (share an arrangement) without forcing a
linear HOM-HET-HOM topology.

### 11.2 Model selection by graph fit

For each regime, sweep candidate `n_arrangements ∈ {2, 3, 4}`
and pick the model whose predicted state-set best matches the
observed states.

```
predicted_n_states(m) = m * (m + 1) / 2

m = 2 → 3 predicted states (A/A, A/B, B/B)
m = 3 → 6 predicted states (… + A/C, B/C, C/C)
m = 4 → 10 predicted states
```

Scoring per candidate `m`:

```
score(m) = w1 * state_match_fraction
         + w2 * dosage_consistency
         + w3 * mendelian_consistency
         - w4 * missing_state_penalty
         - w5 * extra_state_penalty
```

`missing_state_penalty` is *soft* — missing HET states may
reflect incompatibility, not model failure (per §9.2 and §10.3).

### 11.3 Decoder output contract (extends §10.5)

```js
regime._decoded = {
  n_states_detected: <int>,
  best_n_arrangements: <int>,
  states: [ … as in §10.5 … ],

  arrangement_graph: {
    nodes: [
      { id: "A", hom_observed: true,  n_samples_hom: 24 },
      { id: "B", hom_observed: true,  n_samples_hom: 23 },
      { id: "C", hom_observed: false, n_samples_hom: 0,
        het_only_inferred: true }
    ],
    edges: [
      { a: "A", b: "B", n_samples: 11, state_id: "S2" },
      { a: "A", b: "C", n_samples: 4,  state_id: "S4" },
      { a: "B", b: "C", n_samples: 3,  state_id: "S5" }
    ]
  },

  dosage_state_graph: {
    nodes: [
      { id: "S1", state_type: "HOM-like", n_samples: 24,
        arrangement_combination: "A/A" },
      { id: "S2", state_type: "HET-like", n_samples: 11,
        arrangement_combination: "A/B" },
      …
    ],
    edges: [
      { a: "S1", b: "S2", shared_arrangement: "A",
        weight: 0.94 },
      { a: "S2", b: "S3", shared_arrangement: "B",
        weight: 0.91 },
      { a: "S1", b: "S3", shared_arrangement: null,
        relation: "opposite_homozygotes", weight: 0.88 }
    ]
  },

  interpretation_summary: <string>
};
```

### 11.4 Edge-table view (as user requested)

```
regime_id  state_1  state_2  shared_arrangement  compatibility_type        weight
REG_12     S1       S2       A                   shares_one_arrangement    0.94
REG_12     S2       S3       B                   shares_one_arrangement    0.91
REG_12     S1       S3       —                   opposite_homozygotes      0.88
```

### 11.5 Rich per-regime table (replaces §10.2 schema)

| column | type |
|--------|------|
| `regime_id` | string |
| `n_observed_states` | int |
| `best_n_arrangements` | int |
| `state_id` | string |
| `assigned_arrangement_combination` | string \| null |
| `state_type` | enum |
| `n_samples` | int |
| `dosage_confidence` | enum (high/medium/low) |
| `arrangement_graph_confidence` | enum |
| `mendelian_confidence` | enum |
| `final_call` | string |

Example:

```
REG_21  3  2  S1  A/A  HOM-like  41  high    high    high    A/A
REG_21  3  2  S2  A/B  HET-like  106 high    high    high    A/B
REG_21  3  2  S3  B/B  HOM-like  37  high    high    high    B/B

REG_44  6  3  S1  A/A  HOM-like  24  medium  medium  medium  A/A
REG_44  6  3  S2  A/B  HET-like  11  high    high    high    A/B
REG_44  6  3  S3  B/B  HOM-like  23  medium  medium  medium  B/B
REG_44  6  3  S4  A/C? HET-like  4   medium  medium  low     A/C?
REG_44  6  3  S5  B/C? HET-like  3   low     low     low     B/C?
REG_44  6  3  S6  C/C? HOM-like  2   low     low     unsupp  unresolved
```

### 11.6 UI — floating panel (binding requirement)

User instruction: "need graph of compatibility for haplotype
regime page. but need as floating panel because its so crowded."

The arrangement compatibility graph is rendered in a **floating,
draggable, dismissable panel** on the `haplotype_regimes` page,
NOT inline.

Requirements:

1. **Floating**: absolute / fixed position, top-right by default,
   above the page chrome (z-index above the seeds table but
   below modals).
2. **Draggable**: header is a drag handle; position persisted in
   `localStorage` per regime.
3. **Dismissable**: × button in the panel header closes it;
   reopened from the regimes-table row context menu ("show
   compatibility graph").
4. **Resizable**: bottom-right resize handle; min ~ 320×240,
   default ~ 480×360.
5. **Two-tab toggle**:
   - Tab 1 — *arrangement graph* (Graph A from §11.1). Nodes:
     `A, B, C…`. Edges: observed HET pairs. Het-only-inferred
     arrangements (no HOM observed) are drawn dashed.
   - Tab 2 — *dosage-state graph* (Graph B from §11.1). Nodes:
     `S1..Sk` coloured by `state_type` (HOM-like / HET-like /
     complex / unresolved). Edges labelled with the shared
     arrangement.
6. **Bound to the regimes table**: clicking a regime row updates
   the panel to that regime; the panel header shows `REG_id ·
   chrom · bp span · best_n_arrangements`.
7. **No mandatory render**: panel is closed by default. Page
   load does not pay the layout cost.

Implementation note: re-use any existing floating-panel
primitive in `atlases/inversion/shared/` if one exists; do not
introduce a new floating-panel framework just for this. Use SVG
for the graph (the regime is small — ≤ 10 nodes).

### 11.7 Master doc additions

Add to `docs/ARCHITECTURE_MASTER.md` §2 vocabulary:

- `arrangement_graph` (Graph A — hidden arrangements as nodes,
  observed HET pairs as edges);
- `dosage_state_graph` (Graph B — observed states as nodes,
  shared-arrangement edges);
- `compatibility_edge` (edge in either graph, with weight and
  compatibility_type ∈ {shares_one_arrangement,
  opposite_homozygotes, hom_evidence, het_evidence}).
