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

Second manuscript sentence added 2026-05-26 (verbatim from
user), to be used together with the above to make the
proposal-vs-validation separation explicit:

> We first inferred candidate arrangement states from dosage
> heatmaps within long-range regimes. Mendelian inheritance was
> then used as an independent validation layer to evaluate
> whether the inferred states were compatible with diploid
> transmission.

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

### 11.6 Two graphs, two pipeline stages (corrected 2026-05-26)

User correction 2026-05-26 — verbatim:

> actually its 2 graphs in the floating panel, not 1.
>
> Long-range + dosage proposes the model. Mendelian tests the
> model.
>
> Arrangement compatibility graph: built from dosage states →
> propose hidden arrangements.
> Mendelian validation graph: built from family transmissions →
> test if proposed arrangements inherit correctly.
> They are related but not the same.

This corrects an earlier conflation. The two graphs live in
**different pipeline stages**:

| # | Stage | What it produces | Graph emitted |
|---|-------|------------------|---------------|
| 1 | Long-range regime detection | Coherent segment (boundaries) | — |
| 2 | Dosage heatmap | Candidate states `S1..Sk` | — |
| 3 | **Arrangement compatibility graph (proposal)** | Hidden arrangements `A, B, C, …` inferred from dosage states | **arrangement_compatibility_graph** |
| 4 | **Mendelian validation (test)** | Pass/fail/likely for each proposed arrangement model | **mendelian_validation_graph** |
| 5 | Final classification | `validated / likely / complex / unresolved` | — |

Steps 1–3 are **proposal** (dosage-based, no Mendelian).
Step 4 is **independent validation** (family-based, no dosage).
Step 5 combines them into a verdict.

### 11.7 Arrangement compatibility graph (the proposal graph)

Sections §11.1–§11.5 describe ONE object: the
**arrangement_compatibility_graph**. It has two layout views,
both rendered from the same underlying data:

- **arrangement view** (formerly "Graph A"): nodes are hidden
  arrangements `A, B, C, …`; edges are observed HET pairs;
  het-only-inferred arrangements drawn dashed. Best for
  reading "which arrangements does this regime contain?".
- **state view** (formerly "Graph B"): nodes are observed
  segregation_states `S1..Sk` coloured by `state_type`; edges
  link states that share one hidden arrangement, labelled with
  the shared arrangement. Best for reading "which observed
  clusters are biologically related?".

These are not two graphs. They are two layouts of the same
graph. The floating panel switches layouts with a sub-toggle.

The §11.3 decoder output contract is unchanged; `arrangement_graph`
and `dosage_state_graph` are now understood as the two layout
projections of the single `arrangement_compatibility_graph`
object. (Renaming the keys is deferred to implementation; the
JSON shape is fine.)

### 11.8 Mendelian validation graph (the test graph)

Built **only after** the arrangement compatibility graph
proposes a model. Uses pedigree information that exists only
for `f1_hybrid`.

Two layout views of one object:

- **trio view**: nodes are samples (one per F1 trio member);
  edges are parent-offspring relationships drawn from the
  pedigree; each node carries its assigned arrangement
  combination from §10/§11; edge colour = Mendelian
  consistency:
  - green = transmission consistent with the proposed model;
  - red = transmission impossible under the proposed model
    (e.g. `A/A × B/B` parents producing a `C/C` offspring);
  - amber = transmission possible but unlikely given expected
    1:1 / 1:2:1 ratios.
- **transmission-table view**: bipartite. Top nodes are parent
  state pairs (`A/A × A/B`, `A/B × A/B`, `A/B × A/C`, …);
  bottom nodes are offspring states; edges carry
  `n_observed / n_expected` and the per-edge χ² contribution.

Per-regime emitted object (sibling of `arrangement_compatibility_graph`
in `regime._decoded`):

```js
mendelian_validation_graph: {
  cohort_id: "f1_hybrid",
  n_trios_total:        <int>,
  n_trios_evaluable:    <int>,   // both parents resolved
  n_trios_consistent:   <int>,
  n_trios_inconsistent: <int>,
  n_trios_ambiguous:    <int>,
  per_cross: [
    { parents: "A/B × A/B",
      n_offspring: 24,
      expected: { "A/A": 6, "A/B": 12, "B/B": 6 },
      observed: { "A/A": 7, "A/B": 11, "B/B": 6 },
      chisq_p: 0.92,
      verdict: "consistent" },
    { parents: "A/B × A/C",
      n_offspring: 8,
      expected: { "A/A": 2, "A/B": 2, "A/C": 2, "B/C": 2 },
      observed: { "A/A": 2, "A/B": 1, "A/C": 3, "B/C": 2 },
      chisq_p: 0.77,
      verdict: "consistent" },
    …
  ],
  overall_chisq_p: 0.85,
  verdict: "validated" | "likely" | "complex" | "unresolved",
  impossibilities: [
    { trio_id: "T_42", parent_states: "A/A × A/A",
      offspring_state: "A/B", reason: "forbidden_under_model" }
  ]
}
```

`impossibilities[]` are the model-killing observations: if
non-empty, the proposed arrangement model is **rejected** and
the regime drops to `final_classification: "complex"` or
`"unresolved"` even if the dosage clustering looked clean.

### 11.9 Final classification (Stage 5)

Per regime, combine the two graphs:

| arrangement_compatibility_graph fit | mendelian_validation_graph verdict | final_classification |
|-------------------------------------|------------------------------------|----------------------|
| high | validated | `validated` |
| high | likely | `likely` |
| high | complex / impossibilities present | `complex` |
| medium | validated | `likely` |
| medium | likely | `likely` |
| medium | complex | `complex` |
| low / unsupported | any | `unresolved` |
| any | n_trios_evaluable < 5 (e.g. `cmac_wild`) | inherit dosage confidence, label `dosage_only` |

Only regimes reaching `validated` are eligible to become POD
(see master rule).

### 11.10 UI — floating panel (binding requirement)

User instruction: "need graph of compatibility for haplotype
regime page. but need as floating panel because its so crowded.
actually its 2 graphs in the floating panel, not 1."

The floating panel holds **two graphs** corresponding to
Stage 3 (proposal) and Stage 4 (validation). It is the
single panel — not two separate windows.

Requirements:

1. **Floating**: absolute / fixed position, top-right by default,
   above the page chrome (z-index above the seeds table but
   below modals).
2. **Draggable**: header is a drag handle; position persisted in
   `localStorage` per regime.
3. **Dismissable**: × button in the panel header closes it;
   reopened from the regimes-table row context menu ("show
   regime graphs").
4. **Resizable**: bottom-right resize handle; min ~ 320×320,
   default ~ 520×480 (taller than the §11.6 first draft, to
   fit both graphs).
5. **Top-level tab toggle (two graphs)**:
   - Tab 1 — **Arrangement compatibility** (Stage 3). Sub-toggle
     switches between *arrangement view* (nodes = `A,B,C…`,
     edges = observed HETs) and *state view* (nodes = `S1..Sk`,
     edges = shared arrangement).
   - Tab 2 — **Mendelian validation** (Stage 4). Sub-toggle
     switches between *trio view* (pedigree colored by
     consistency) and *transmission-table view* (parent-cross
     bipartite with χ²). Disabled / "no pedigree" placeholder
     when the active cohort is not `f1_hybrid` or
     `n_trios_evaluable < 5`.
6. **Panel header shows the verdict pipeline left-to-right**:
   `REG_id · best_n_arrangements · dosage_conf · mendelian_verdict · final_classification`.
   This makes the proposal-vs-validation separation visible at
   a glance.
7. **Bound to the regimes table**: clicking a regime row updates
   the panel to that regime.
8. **No mandatory render**: panel is closed by default. Page
   load does not pay the layout cost.

Implementation note: re-use any existing floating-panel
primitive in `atlases/inversion/shared/` if one exists; do not
introduce a new floating-panel framework just for this. Use SVG
for both graphs (regime ≤ 10 nodes, family ≤ ~200 nodes).

### 11.7 Master doc additions

Add to `docs/ARCHITECTURE_MASTER.md` §2 vocabulary:

- `arrangement_graph` (Graph A — hidden arrangements as nodes,
  observed HET pairs as edges);
- `dosage_state_graph` (Graph B — observed states as nodes,
  shared-arrangement edges);
- `compatibility_edge` (edge in either graph, with weight and
  compatibility_type ∈ {shares_one_arrangement,
  opposite_homozygotes, hom_evidence, het_evidence}).

---

## 12. Biological foundation (added 2026-05-26, biological pass)

This section grounds the data model in the biology that makes
it work. None of the decoder's choices are arbitrary — each is
a consequence of one of the following facts.

### 12.1 Why arrangements stay distinct: recombination suppression

A regime exists at all because **recombination is suppressed
between non-homologous arrangements** inside an inversion. A
heterozygote `A/B` forms an inversion loop at meiosis; single
crossovers inside the loop produce unbalanced (duplicated /
deleted) gametes that are largely inviable. Net effect:

- Inside the inverted span, the two arrangements **do not
  recombine** at appreciable rates over many generations.
- They therefore accumulate distinct SNP haplotypes that
  segregate together — this is what the dosage_heatmap reads.
- At the **breakpoints and flanks** recombination resumes, so
  the regime has soft edges. The transition zones from §5 are
  the biological boundary, not a clustering artefact.

Consequences for the decoder:

1. Inside a regime, **diagnostic SNPs are in tight LD with the
   arrangement identity.** This is what makes per-regime
   dosage clustering work at all.
2. Within an arrangement, recombination still proceeds between
   *its own* haplotypes (allelic at the same arrangement). So
   intra-arrangement diversity is normal genome-wide diversity;
   inter-arrangement divergence is the inversion signal.
3. A regime should be **internally LD-coherent.** If LD drops
   in the middle of a candidate_region, that drop is itself a
   segmentation cue (cluster 3 should already use it; see
   `docs/PIPELINE_ANALYSIS_ORDER.md`).
4. Occasional **gene conversion / double crossovers** do
   introduce small patches of one arrangement into another.
   These show up as samples whose dosage profile is "mostly
   A/A but with a B-like stretch." Flag as
   `state_type: complex` with sub-flag `gene_conversion_suspect`.

### 12.2 Mendelian segregation as independent validation (NOT inference)

Mendelian inheritance is the **validation layer**, never part
of proposal. The user is explicit (2026-05-26):

> Long-range + dosage proposes the model. Mendelian tests the
> model.

So:

- Stages 1–3 (regime, dosage states, arrangement compatibility
  graph) run **without** Mendelian. They produce a proposed
  model from dosage alone.
- Stage 4 takes the proposed model AS GIVEN and asks: do
  observed family transmissions fit?
- A failed Mendelian test does NOT modify the proposed model;
  it labels it `complex` or `unresolved` and lets the operator
  inspect.

This decoupling lets the same proposal be re-tested when the
pedigree expands (e.g. an F2 generation arrives), without
re-running dosage clustering.

Once Layer B has assigned `arrangement_combination`s, the
classical Mendelian ratios apply *per regime* (each regime
inherits as one locus, because recombination is suppressed
inside it):

| Cross | Expected offspring (per regime) |
|-------|---------------------------------|
| `A/A × A/A` | 100% `A/A` |
| `A/A × B/B` | 100% `A/B` |
| `A/A × A/B` | 50% `A/A`, 50% `A/B` |
| `A/B × A/B` | 25% `A/A`, 50% `A/B`, 25% `B/B` |
| `A/B × A/C` | 25% `A/A`, 25% `A/B`, 25% `A/C`, 25% `B/C` |
| `A/B × B/C` | 25% `A/B`, 25% `A/C`, 25% `B/B`, 25% `B/C` |

`mendelian_support` per regime (used in §11.5 confidence
columns) is `1 − χ² p-value` of observed vs expected counts
across all family trios in the cohort. Drop trios whose parents
are themselves unresolved.

Selection against heterokaryotypes (underdominance) appears as
a systematic deficit of HET-like states. The decoder should
NOT correct for this — record it as a separate field
`het_deficit` and let downstream popstats interpret.

### 12.3 Hardy-Weinberg as a cohort-level sanity check

Within a panmictic cohort with arrangement frequencies
`p_A, p_B, p_C, …` (Σ p_i = 1), the expected state frequencies
under HWE are:

```
freq(A_i / A_i) = p_i²
freq(A_i / A_j) = 2 · p_i · p_j   (i ≠ j)
```

The decoder emits, per regime:

```
hwe: {
  p_arrangement: { A: 0.43, B: 0.51, C: 0.06 },
  expected_state_freqs: { …HWE prediction… },
  observed_state_freqs: { …from layer A… },
  chisq_p: <float>,
  inbreeding_F: <float>     // optional, multi-locus
}
```

Deviation from HWE flags:

- **Excess homozygotes** → assortative mating, population
  substructure, or null allele.
- **Excess heterozygotes** → balancing selection or
  laboratory-bias of the F1 cohort (expected for `f1_hybrid`).
- **Missing one or more het classes** → meiotic incompatibility
  or sampling.

HWE expectations apply to `cgar_hatchery_226` and `cmac_wild`,
NOT to `f1_hybrid` (which by construction has known parents).

### 12.4 Polarisation: which arrangement is ancestral?

The decoder labels arrangements `A, B, C` arbitrarily (by
sample-set order or frequency rank). The **identity of which
is ancestral** is a separate question handled by the
`evolution` atlas using:

- outgroup synteny vote (the arrangement matching outgroup
  gene order is ancestral);
- BUSCO 4D-site age estimates inside the inverted span;
- doubleton SFS pattern.

This SPEC's decoder MUST emit `arrangement_id` as opaque
labels `A, B, C`. It MUST NOT assign "ancestral / derived"
itself. The evolution atlas reads `regime._decoded.states` and
annotates per-regime polarity in a separate layer
(`inversion.arrangement_polarity_v1`, future SPEC).

### 12.5 Nested regimes and compound heterozygotes

A candidate_region may contain a **nested inversion** —
arrangement `B` itself carries an inner inversion that
arrangement `A` does not. Then within `B/B` samples, an inner
biallelic system `B_inner1 / B_inner2` segregates.

Handling:

1. The segmentation step (cluster 3) MUST detect the inner
   regime as a child of the outer regime (smaller bp span,
   sample subset = the `B/B` carriers only).
2. The decoder runs **independently** on the inner regime,
   using only the sample subset that carries `B` at the outer
   regime.
3. The output graph at the candidate_region level has a
   parent-child link:

   ```
   regime_outer: A/A, A/B, B/B
                                 │
                                 └── child regime_inner (active only in B/B carriers):
                                       B_inner1/B_inner1,
                                       B_inner1/B_inner2,
                                       B_inner2/B_inner2
   ```

4. A `compound_heterozygote` is a sample heterozygous at both
   the outer and an inner regime (e.g., `A/B` outer AND
   `B_inner1/B_inner2` inner). Emit as a structured combined
   call:

   ```
   { regime_outer: "A/B",
     regime_inner: { active: false, reason: "only_active_in_B/B" } }

   { regime_outer: "B/B",
     regime_inner: "B_inner1/B_inner2" }
   ```

5. NEVER collapse outer+inner into one ad-hoc K. Nesting must
   be visible in the data model and the graph.

### 12.6 Cohort-specific signal (binding)

Each cohort answers a different question. The decoder must NOT
pool them.

| Cohort | What it tells you | What it cannot tell you |
|--------|------------------|------------------------|
| `f1_hybrid` | Mendelian inheritance, parent-offspring transmission, recombinant detection inside transition zones | Population frequencies, ancestral state |
| `cgar_hatchery_226` | Cohort-level arrangement frequencies, HWE deviation, selection signatures, het_deficit | Truly wild frequencies (hatchery bias), cross-species comparison |
| `cmac_wild` | Wild-type frequencies, ancestral arrangement (with outgroup), cross-species polarisation | Mendelian (no known pedigree), F1-specific recombinants |

The decoder runs per cohort and emits one
`regime._decoded[<cohort_id>]` per regime per cohort. The
inter-regime / inter-graph comparison code runs WITHIN one
cohort by default. Cross-cohort comparison is a separate
explicit operation (`compareCohorts(regime, cohorts)`).

### 12.7 Pseudo-arrangements (false positives)

Not every multi-state cluster is an arrangement system. The
decoder must reject these false positives:

| Pattern | Looks like | Actually is | Test |
|---------|-----------|-------------|------|
| State_set correlates with `q_ancestry` | 2-3 arrangement system | population structure | per-state ancestry homogeneity ≥ 0.85 |
| State_set correlates with sequencing batch / lane | arrangements | batch effect | per-batch state-frequency χ² |
| HOM-like states with very low intra-state diversity | arrangements | inbred lines | π_within / π_between ratio < 0.1 → suspicious |
| State boundaries aligned with chrom ends / N-gaps | regime | assembly artefact | overlap with N-mask > 50% → reject |
| Sex-correlated state frequencies on autosome | arrangement | sex-linked variant mismapped | per-sex χ² |
| State == single rare family | arrangement | family structure | one family contributes ≥ 50% of a state's members → flag |

Each failed test emits a flag in
`regime._decoded.false_positive_flags[]`. The decoder still
emits the states (do not silently drop), but downstream
consumers (popstats, manuscript) skip flagged regimes by
default.

### 12.8 Sex chromosomes and ploidy

For sex chromosomes (LG identity TBD per Cgar / Cmac
karyotypes — TODO: add the LG mapping when available):

1. The heterogametic sex carries **one** arrangement per
   regime, not two. Emit `state_type: hemizygous_X` or
   `hemizygous_Z` per the system's sex determination.
2. The homogametic sex behaves normally (two arrangements,
   standard Mendelian).
3. The pseudoautosomal region (PAR), if any, behaves as
   autosomal.
4. The decoder MUST take `sex` from the sample metadata layer
   and treat hemizygous-sex samples as a separate stratum;
   do not let them pull a HOM-like cluster into a false HET
   shape.

For mitochondrial-only regimes: out of scope of this SPEC
(uniparental inheritance, no diploid states). If a candidate
region falls on a mitochondrial contig, skip with reason
`uniparental_locus`.

### 12.9 Detection limits

The decoder honestly reports when a regime is below resolution
(extending §5):

| Limit | Threshold | Action |
|-------|-----------|--------|
| `n_windows` in regime | < 5 | skip, mark `below_resolution` |
| `n_diagnostic_snps` | < 20 | skip, mark `below_snp_resolution` |
| `n_samples` per candidate state | < 3 | merge into nearest state OR mark `unresolved` |
| `regime_bp_span` | < 50 kb | flag `short_regime` — still decode but cap confidence at `medium` |
| Best `n_arrangements` requires ≥ 5 missing het classes | always | reject the model in favour of the next-smaller m |

### 12.10 Implications for §11's compatibility graph

Cross-reference biology back into the graph contract:

- Edges in the `arrangement_graph` weighted by `n_samples`
  reflect **mating compatibility × population frequency**. An
  absent edge is informative (incompatibility OR sampling).
- The `dosage_state_graph` topology distinguishes:
  - **Linear** path (`A/A — A/B — B/B`) → biallelic.
  - **Triangle of HOMs with HETs on edges** → 3-arrangement.
  - **Disconnected components** → either pseudo-arrangements
    OR truly disjoint sub-cohorts that should be analysed
    separately (likely §12.7 population structure).
- A `compatibility_edge` of type `opposite_homozygotes` (e.g.
  `A/A — B/B`) does NOT imply mating impossibility, only that
  the two states share zero arrangements. The actual `A × B`
  mating produces `A/B` which appears as a separate node.

---

## 13. Open biological questions (extends §7)

Carried over from §7 plus new ones from §12:

5. **Inversion size cutoff for confident decoding.** Below ~50
   kb, dosage signal is weak. Should we run a chrom-wide power
   analysis to set the threshold per cohort instead of a
   constant?
6. **Underdominance vs sampling missingness.** When a het class
   is absent, how do we distinguish meiotic incompatibility
   from "we just didn't sample enough"? Need a power model
   conditional on cohort sample size and observed HOM
   frequencies.
7. **Polarisation when no outgroup is available** for a regime
   (cmac_wild only). Fall back to derived-allele frequency
   skew? Or refuse to polarise and label `ancestral: unknown`?
8. **Recombinant vs gene-conversion in transition zones.**
   §12.1 lumps them. Are the bp-scales separable (gene
   conversion is < 1 kb, recombination products span the full
   regime tail)?
9. **Cohort weighting in the cross-cohort summary.** When
   merging `cgar_hatchery_226` and `cmac_wild`, do we weight
   by sample count, by population effective size, or report
   both separately?
10. **Inversion-on-inversion (compound heterozygote)
    confidence ceiling.** When BOTH outer and inner regimes
    are HET in the same sample, the dosage signal is the sum
    of both layers; can we separate them, or do we cap
    confidence at `medium` and label `compound_het_observed`?
