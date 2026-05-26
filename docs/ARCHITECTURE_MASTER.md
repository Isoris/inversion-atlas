# ARCHITECTURE_MASTER — single control document

**Status**: BINDING. Authored 2026-05-26 by user instruction.
All Claude sessions, all atlases, all SPECs in this repo must
obey the master rule and the canonical vocabulary below. Any
contradictory text elsewhere is **superseded** by this file.

This file is owned by the user (architect). Claude sessions are
**workers**, not architects. Workers may extend with detail but
may NOT redefine the vocabulary or the master rule without an
explicit, signed-off user message updating this file.

---

## 1. Master rule

> Long-range regime detection **segments** the genome. Each
> regime gets its own dosage heatmap. The dosage heatmap assigns
> karyotype_calls (arrangement pairs `H_i/H_j`). Mendelian
> validation tests those calls. Breakpoints support regime
> boundaries. PODs are created only after validated regimes.

In one line:

```
candidate_region → regimes → dosage_heatmap (per regime)
                          → karyotype_calls (per sample, per regime)
                          → Mendelian validation
                          → POD
```

Breakpoints (cross-species atlas) feed **into boundaries**, not
into karyotypes. A breakpoint is an edge, not a state.

## 2. Canonical vocabulary (binding)

Use these terms with these meanings. Do not invent synonyms.
Do not let any session redefine them.

| Term | Definition | Where it lives |
|------|------------|----------------|
| `candidate_region` | A broad bp interval flagged as potentially carrying structural variation. Pre-segmentation. Produced by the candidate-detector. | `inversion` atlas, discovery pages |
| `arrangement` | A discrete sequence configuration at a regime. Labelled `H1, H2, H3, …`. The atomic unit of karyotype. | `inversion` atlas, regime decoder |
| `regime` | An internally coherent segregation segment inside a candidate_region. Carries `n_arrangements ≥ 2`. Produced by long-range regime detection (segmentation). | `inversion` atlas, `haplotype_regimes` |
| `dosage_heatmap` | The (samples × diagnostic_SNPs) matrix computed for ONE regime. NEVER spans multiple regimes. | `inversion` atlas, per-regime decoder |
| `karyotype_call` | A sample's unordered arrangement pair at one regime: `{H_i, H_j}`. Labelled `H_i/H_j` (or `COMPLEX` or `NO_CALL`). | `inversion` atlas, per-regime decoder |
| `POD` (point of diagnosis) | A regime that has passed Mendelian validation. Only PODs are used for cargo/phenotype interpretation downstream. | `popstats` atlas validates → `inversion` flag |
| `cargo` | Genes / features physically contained inside a POD. | `evolution` / annotation layer |
| `breakpoint` | A bp coordinate where two arrangements differ in genomic order, supported by cross-species evidence. Supports regime BOUNDARIES, never karyotypes. | `cross-species` atlas |

### 2.1 Forbidden usages

- "K=3" is **not** the karyotype model. It is one special case
  (`n_arrangements = 2`). Do not hard-code K=3 anywhere as a
  binding assumption.
- "band", "cluster", "candidate" are not synonyms for "regime".
  Use the table above.
- A "POD" is **not** the same as a "regime". A regime becomes a
  POD only after Mendelian validation passes.

## 3. Pipeline order (binding)

```
[cross-species atlas]            [inversion atlas]                    [popstats atlas]   [evolution atlas]
                                                                                         
 BP_ATLAS pipeline               candidate-detector                                       
       │                              │                                                  
       │ breakpoint coords            ▼                                                   
       └────────────►          candidate_region                                           
                                      │                                                  
                                      ▼                                                  
                              long-range regime                                          
                              segmentation                                               
                                      │                                                  
                                      ▼                                                  
                          ┌── regime ──┐ regime ── regime ── …                           
                          │ per-regime │                                                 
                          │ dosage     │                                                 
                          │ heatmap    │                                                 
                          │     │      │                                                 
                          │     ▼      │                                                 
                          │ karyotype  │                                                 
                          │ calls      │                                                 
                          │  H_i/H_j   │                                                 
                          └─────┬──────┘                                                 
                                │ per-sample karyotype calls                             
                                └─────────────────────────►   Mendelian validation       
                                                                       │                 
                                                                       ▼                 
                                                                  POD flag ──►  cargo /  
                                                                                age /    
                                                                                origin   
```

Cross-atlas reads use the documented `cross_atlas_imports`
contract (see `docs/atlas-core-proposals/`). No atlas reaches
into another atlas's internals.

## 4. Arrangement reality (do not regress to biallelic-only)

A regime may carry `n_arrangements ∈ {2, 3, 4, …}`. The number
of observed karyotype classes K relates to `N = n_arrangements`
by `K_max = N · (N+1) / 2`. Some heterozygous classes may be
absent (meiotic incompatibility or demographic absence) — that is
**information**, not failure.

| N | hom states | het states | K_max | comment |
|---|------------|------------|-------|---------|
| 2 | 2          | 1          | 3     | classic biallelic |
| 3 | 3          | 3          | 6     | real K=6 — do NOT mistake for two-regimes-glued |
| 4 | 4          | 6          | 10    | rare, possible |

Disambiguation rule: if classes split into two **disjoint bp
clusters** along the regime, this is a segmentation failure
(under-split) — recommend split. If classes are **bp-mixed**
across the regime, this is a real multi-arrangement regime.
See `specs_todo/SPEC_per_regime_dosage_decoding.md` §9 for the
decoder spec.

## 5. Three-cohort discipline (binding)

Never conflate these three cohorts. Each result is labelled with
the cohort it came from.

| Cohort | Code | Use |
|--------|------|-----|
| F1 hybrid | `f1_hybrid` | Inheritance / Mendelian validation |
| 226-Cgar hatchery | `cgar_hatchery_226` | Population frequency, karyotype distribution |
| Cmac wild | `cmac_wild` | Cross-species comparison, ancestral state |

## 6. What a worker session may do

- Implement code matching this architecture.
- Author SPECs in `specs_todo/` that **extend** this file.
- Refactor inside one atlas.
- Run tests.

## 7. What a worker session may NOT do

- Redefine any term in §2.
- Reorder the pipeline in §3.
- Hard-code `K = 3` as the karyotype model.
- Merge atlases or invent new top-level atlas names.
- Treat a regime as a POD before Mendelian validation has run.
- Promote any of its own SPECs from `specs_todo/` to binding
  architecture. Only the user does that, by editing this file.

## 8. Where to look first

- `specs_todo/` — pending architecture (NOT yet binding).
- `docs/PIPELINE_ANALYSIS_ORDER.md` — the 4-cluster pipeline order
  for the discovery side.
- `docs/MIGRATION_4_ATLASES.md` — the atlas split.
- `docs/atlas-core-proposals/` — cross-atlas import contract.
- This file — vocabulary + master rule, binding.

---

*Owner: user (architect). Last user-signed update: 2026-05-26.*
