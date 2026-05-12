# SPEC — Mendelian inheritance, paracentric vs pericentric (v1)

**Status**: drafted 2026-05-12
**Scope**: per-candidate Mendelian goodness-of-fit + cohort-level
comparison of segregation distortion frequency between paracentric
and pericentric inversions.
**Builds on**: `atlases/inversion/analysis/mendelian.js` (already ships
a 3-state verdict: mendelian / non-mendelian / insufficient_data),
`atlases/inversion/shared/contingency.js` (fisher2x2 + chiSquare +
chiSqSurvival), and `atlases/inversion/shared/haplotype_vocab.js`
(per-band classifier → STD/HET/INV labels).

---

## 1. The framing

The right question is **not**:

> Does paracentric have a different Mendelian ratio than pericentric?

The right question is:

> Do paracentric and pericentric candidates differ in how often they
> *deviate* from Mendelian expectation?

This is a **two-stage** analysis. First test every candidate against
its own expected ratio; then compare paracentric vs pericentric as
groups by how often each class shows distortion.

---

## 2. Per-candidate test (Stage 1)

For each (candidate × family) test:

1. Infer parental karyotypes from the K-means band classifier:

   - `AA` = standard homozygote
   - `AB` = heterozygote
   - `BB` = inverted homozygote

2. Choose the Mendelian expectation from the cross:

   | Cross         | Expected ratio          |
   |---------------|-------------------------|
   | `AA × AB`     | 1 AA : 1 AB             |
   | `AB × BB`     | 1 AB : 1 BB             |
   | `AB × AB`     | 1 AA : 2 AB : 1 BB      |
   | `AA × BB`     | 100% AB                 |
   | `AA × AA`     | (no test — uninformative)|
   | `BB × BB`     | (no test — uninformative)|

3. Compare observed offspring counts to expected counts via
   chi-square goodness-of-fit (uses `chiSqSurvival` from
   `shared/contingency.js`).

### 2.1 Worked examples

```
Candidate:  INV_LG27_001
Type:       paracentric
Cross:      AB × AB
Expected:   1 AA : 2 AB : 1 BB
Observed:   8 AA : 18 AB : 7 BB
Result:     consistent with Mendelian inheritance
```

```
Candidate:  INV_LG14_002
Type:       pericentric
Cross:      AB × AB
Expected:   1 AA : 2 AB : 1 BB
Observed:   12 AA : 30 AB : 1 BB
Result:     distorted (BB deficit)
```

Both are results — the second is **not a failure**.

---

## 3. Cohort-level comparison (Stage 2)

After running Stage 1 across every (candidate × family), summarize:

```
paracentric candidates:
  18/25 family tests Mendelian
   7/25 distorted

pericentric candidates:
   9/24 family tests Mendelian
  15/24 distorted
```

Build a 2×2 contingency table:

|              | Mendelian | distorted |
|--------------|-----------|-----------|
| paracentric  | 18        | 7         |
| pericentric  | 9         | 15        |

Test:
- **Fisher's exact** (`shared/contingency.js#fisher2x2`) when any cell ≤ 5
- **Chi-square** (`shared/contingency.js#chiSquare`) when all cells > 5

Answer: *Are pericentric inversions more often segregation-distorted
than paracentric inversions?*

---

## 4. Reliability tier

A Mendelian (or distorted) result is reliable when:

1. Parents are correctly assigned
2. Parental karyotypes are confidently called
3. Offspring karyotypes are confidently called
4. Family size is large enough
5. Candidate is not too complex/nested
6. No strong missing-data bias
7. The marker/band classification matches the inversion interval

### 4.1 Tier definitions

| Tier   | Both parents called | Offspring n | Call rate | Karyotype clarity | Confound check |
|--------|---------------------|-------------|-----------|-------------------|----------------|
| `high`   | confidently both   | ≥ 20        | ≥ 90 %    | clear 2/3-class   | no strong confound; breakpoint OR strong population support |
| `medium` | one slightly uncertain | 10–20    | ≥ 80 %    | mostly clear      | useful, not definitive |
| `low`    | unclear            | < 10        | < 80 %    | weak separation   | complex/nested |

For the manuscript: `high` + `medium` are formal evidence;
`low` lands in the supplementary / exploratory table.

---

## 5. Segregation status enum (extends mendelian.js)

The current `mendelian.js` verdict is 3-state (`mendelian` /
`non-mendelian` / `insufficient_data`). This spec extends it to:

| Status              | Meaning                                      |
|---------------------|----------------------------------------------|
| `MENDELIAN`         | observed ≈ expected (p ≥ α; or close enough) |
| `DISTORTED`         | observed ≠ expected (p < α); reliability ≥ medium |
| `AMBIGUOUS`         | observed ≠ expected but reliability low; or borderline p |
| `UNDERPOWERED`      | n offspring too small to discriminate        |
| `COMPLEX_MODEL`     | candidate is multi-haplotype / nested; 1:2:1 model doesn't apply cleanly |
| `PARENT_UNCERTAIN`  | one or both parental karyotypes ambiguous    |

Non-Mendelian is **not a failure** — it's a biological or technical
signal worth labeling explicitly. Possible biological causes:

- segregation distortion
- reduced viability of one karyotype
- meiotic drive
- fertility effects
- embryo mortality
- inverted translocation

Possible technical causes (mostly handled by the `AMBIGUOUS` /
`PARENT_UNCERTAIN` / `COMPLEX_MODEL` tags):

- wrong structural model
- complex/nested inversion
- bad karyotype calls
- parent misassignment

---

## 6. Effect-direction tag

When status is `DISTORTED`, annotate which class is over/under-represented:

| Tag                       | Pattern                                |
|---------------------------|-----------------------------------------|
| `AA_deficit`              | observed AA < expected AA              |
| `AB_deficit`              | observed AB < expected AB              |
| `BB_deficit`              | observed BB < expected BB              |
| `heterozygote_excess`     | obs AB > exp AB                         |
| `heterozygote_deficit`    | obs AB < exp AB                         |
| `one_parent_transmission_bias` | one parent's allele over-transmitted to offspring |
| `none`                    | MENDELIAN case (no significant skew)   |

`one_parent_transmission_bias` requires phased / parent-of-origin
information; defaults to `none` until that signal is plumbed.

---

## 7. Output schema (one row per family-candidate test)

```jsonc
{
  "candidate_id":      "INV_LG27_001",
  "inversion_type":    "paracentric",   // 'paracentric' | 'pericentric' | 'unknown'
  "family_id":         "FAM_004",
  "parent1_call":      "AB",            // STD/HET/INV-style call from haplotype_vocab
  "parent2_call":      "AB",
  "expected_ratio":    "1:2:1",         // string for display; numeric internally
  "n_offspring":       33,
  "obs_AA":            8,
  "obs_AB":            18,
  "obs_BB":            7,
  "p_value":           0.91,            // chi-square goodness-of-fit
  "effect_direction":  "none",
  "reliability":       "high",          // 'high' | 'medium' | 'low'
  "segregation_status":"MENDELIAN"      // §5 enum
}
```

### 7.1 Worked example — distorted

```json
{
  "candidate_id":      "INV_LG14_002",
  "inversion_type":    "pericentric",
  "family_id":         "FAM_011",
  "parent1_call":      "AB",
  "parent2_call":      "AB",
  "expected_ratio":    "1:2:1",
  "n_offspring":       43,
  "obs_AA":            12,
  "obs_AB":            30,
  "obs_BB":            1,
  "p_value":           0.003,
  "effect_direction":  "BB_deficit",
  "reliability":       "high",
  "segregation_status":"DISTORTED"
}
```

---

## 8. The three cohort-level questions

After per-candidate Stage 1 runs across the cohort:

1. **Do paracentric and pericentric inversions both follow Mendelian
   expectations?** (Per-class summary: % MENDELIAN / DISTORTED / etc.)

2. **Are pericentric inversions more likely to show distorted
   segregation?** (2×2 contingency, Fisher's exact or chi-square.)

3. **When distorted, is the distortion mostly homozygote deficit,
   heterozygote excess, or one-arrangement loss?** (Stratify
   `effect_direction` within each inversion type.)

### 8.1 Expected biological interpretation

- **Paracentric**: often clean Mendelian; strong recombination
  suppression reduces viable recombinants — but the loop-recombinant
  products are dicentric / acentric and lost meiotically rather than
  in offspring → expected 1:2:1 at the karyotype level.
- **Pericentric**: also can be Mendelian, but may show more distortion
  if centromere-linked structure affects segregation, recombination
  products, or post-zygotic viability of unbalanced gametes.
- **Complex / nested**: do NOT force the simple 1:2:1 model. Mark
  `COMPLEX_MODEL` and exclude from the para-vs-peri test.

---

## 9. Where this fits in the cartridge

- `atlases/inversion/analysis/mendelian.js` (already shipped):
  - Currently emits `verdict: 'mendelian' | 'non-mendelian' | 'insufficient_data'`.
  - Extend with `segregation_status` (§5) + `effect_direction` (§6) +
    `reliability` (§4) as additional fields. Existing `verdict` stays
    for back-compat.

- `atlases/inversion/analysis/mendelian_inheritance.js` (already
  shipped — SPEC_v2 item 7 orchestrator):
  - Currently wraps the core to compute `dependency_hash` and write
    through the registry.
  - Extend the per-candidate result row with the new fields above.
  - Add a top-level summary stage that emits the 2×2 contingency
    table per (paracentric, pericentric) and runs Fisher's exact /
    chi-square via `shared/contingency.js`.

- `atlases/inversion/registries/schemas/`:
  - Add `mendelian_inheritance_block.schema.json` listing the
    per-row fields in §7 and the cohort summary shape.

- `atlases/inversion/shared/`:
  - No new module — all primitives needed (chi-sq, Fisher's exact,
    karyotype labels) already exist. The cartridge-side compute is a
    thin orchestrator that pulls from `mendelian.js` + extends with
    the §5/§6 tagging.

---

## 10. Manuscript sentence

> We tested inheritance of karyotype-defined inversion arrangements
> against Mendelian expectations within available families. Candidates
> were classified as Mendelian, distorted, ambiguous, or underpowered
> according to parental call confidence, offspring sample size, and
> karyotype separation. Paracentric and pericentric candidates were
> then compared for the frequency and direction of segregation
> distortion, allowing centromere-spanning rearrangements to be
> evaluated as a potential source of non-Mendelian transmission.

Mendelian = validation.
Non-Mendelian = biological or technical signal worth labeling.
Underpowered = not interpretable yet.

All three are useful results when labeled honestly.

---

## 11. Deferred to v2

- `one_parent_transmission_bias` requires phasing / parent-of-origin
  inference. The cartridge ships `state.data.relatedness` (hub ids)
  but not phased trios; landing this needs a producer-side phasing
  step.
- Combined likelihood model that lets `COMPLEX_MODEL` candidates
  contribute (e.g. K=6 multi-haplotype crosses with their own
  expected-ratio matrix). Requires the `multi3` / `multi2` vocab from
  `haplotype_vocab.js` to be wired through the test.
- Bayesian shrinkage across families per candidate (combine multiple
  family tests on the same candidate into one summary). For now,
  each (candidate × family) row stands alone.
