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

## 0. Biological foundation (one-screen orientation)

The whole framework rests on one biological fact: in an
arrangement heterozygote, crossovers inside the inversion
produce unbalanced gametes, so **recombination is suppressed
between non-homologous arrangements**. Two consequences make
the data model possible:

1. Distinct arrangements accumulate distinct SNP haplotypes
   inside the inverted span → the dosage_heatmap can separate
   them.
2. Recombination resumes at the breakpoints / flanks → regimes
   have soft, real edges (`transition_zone`s), not clustering
   artefacts.

Therefore:

- A **regime** behaves like a single Mendelian locus with
  `n_arrangements ≥ 2` alleles.
- The number of observed segregation states relates to N by
  `n_states_max = N·(N+1)/2` (2→3, 3→6, 4→10). Missing states
  are informative (incompatibility or sampling), not failure.
- The arrangement labels `A, B, C` are opaque. Ancestral
  identity is assigned by the `evolution` atlas, NOT by the
  decoder.

Each cohort plays a different role and must not be pooled:

| Cohort | Role |
|--------|------|
| `f1_hybrid` | Mendelian inheritance, recombinants, breakpoint refinement |
| `cgar_hatchery_226` | Cohort frequencies, HWE deviation, selection signals |
| `cmac_wild` | Wild frequencies, ancestral state via outgroup |

## 1. Master rule (5-stage pipeline)

> Long-range regime detection **segments** the genome. Each
> regime gets its own dosage heatmap. The dosage heatmap assigns
> karyotype_calls (arrangement pairs `H_i/H_j`). Mendelian
> validation tests those calls. Breakpoints support regime
> boundaries. PODs are created only after validated regimes.

**Proposal vs validation is a hard separation.** Stages 1–3
propose a model from dosage alone; Stage 4 tests it
independently with families; Stage 5 combines them into a
verdict.

| # | Stage | Input | Output | Uses Mendelian? |
|---|-------|-------|--------|-----------------|
| 1 | Long-range regime detection | candidate_region | regime boundaries | no |
| 2 | Dosage heatmap | regime + samples × diagnostic SNPs | segregation_states `S1..Sk` (Layer A) | no |
| 3 | Arrangement compatibility graph | states from Stage 2 | hidden arrangements `A, B, C, …` + arrangement_combinations (Layer B) | no |
| 4 | Mendelian validation | proposed model from Stage 3 + pedigree | validated / likely / complex / unresolved per regime | yes (f1_hybrid only) |
| 5 | Final classification | Stages 3 + 4 | POD-eligible flag | combines |

In one line:

```
candidate_region
  → regimes (Stage 1)
  → dosage_heatmap → segregation_states (Stage 2)
  → arrangement_compatibility_graph → arrangement_combinations (Stage 3)   ─── proposal
  → mendelian_validation_graph → verdict (Stage 4)                          ─── validation
  → final_classification (Stage 5)
  → POD (only if validated)
```

The two graphs (`arrangement_compatibility_graph`,
`mendelian_validation_graph`) live in different stages and
serve different roles: the first **proposes** hidden
arrangements from dosage states, the second **tests** whether
the proposed arrangements transmit correctly in families. They
are related but not the same.

Breakpoints (cross-species atlas) feed **into boundaries**, not
into karyotypes. A breakpoint is an edge, not a state. HWE
(§12.3 of SPEC) is a cohort-level sanity check on Stage 3
output for `cgar_hatchery_226` / `cmac_wild`; it does NOT
override Stage 4 Mendelian validation.

## 2. Canonical vocabulary (binding)

Use these terms with these meanings. Do not invent synonyms.
Do not let any session redefine them.

| Term | Definition | Where it lives |
|------|------------|----------------|
| `candidate_region` | A broad bp interval flagged as potentially carrying structural variation. Pre-segmentation. Produced by the candidate-detector. | `inversion` atlas, discovery pages |
| `arrangement` | A discrete sequence configuration at a regime. Labelled `A, B, C, …` (or `H1, H2, H3, …`). The atomic unit of karyotype. | `inversion` atlas, regime decoder |
| `regime` | An internally coherent segregation segment inside a candidate_region. Carries `n_arrangements ≥ 2`. Produced by long-range regime detection (segmentation). | `inversion` atlas, `haplotype_regimes` |
| `dosage_heatmap` | The (samples × diagnostic_SNPs) matrix computed for ONE regime. NEVER spans multiple regimes. | `inversion` atlas, per-regime decoder |
| `segregation_state` | One of the recurrent dosage-supported sample-grouping classes found inside a regime. Labelled `S1, S2, …`. The unit of decoder output. Always emitted. | `inversion` atlas, per-regime decoder (Layer A) |
| `state_type` | Classification of a `segregation_state`: one of `HOM-like`, `HET-like`, `complex`, `unresolved`. Behaviour, not identity. | per-regime decoder (Layer A) |
| `arrangement_combination` | The putative mapping from a `segregation_state` to an arrangement pair (`A/A`, `A/B`, `A/C?`, …). Emitted only when dosage + Mendelian support it; otherwise `null`. | per-regime decoder (Layer B) |
| `karyotype_call` | A sample's unordered arrangement pair at one regime: `{A_i, A_j}`. This is **Layer B** of the decoder — it depends on a supported `arrangement_combination`. If unsupported, the sample carries `state_id` only. | per-regime decoder (Layer B) |
| `POD` (point of diagnosis) | A regime that has passed Mendelian validation. Only PODs are used for cargo/phenotype interpretation downstream. | `popstats` atlas validates → `inversion` flag |
| `cargo` | Genes / features physically contained inside a POD. | `evolution` / annotation layer |
| `breakpoint` | A bp coordinate where two arrangements differ in genomic order, supported by cross-species evidence. Supports regime BOUNDARIES, never karyotypes. | `cross-species` atlas |
| `arrangement_compatibility_graph` | The Stage-3 **proposal** graph. Built from dosage states. Has two layout views: *arrangement view* (nodes = hidden arrangements `A, B, C, …`, edges = observed HET pairs) and *state view* (nodes = `segregation_state`s, edges = shared-arrangement links). One graph, two views. | per-regime decoder, `haplotype_regimes` UI |
| `mendelian_validation_graph` | The Stage-4 **test** graph. Built from family transmissions, not from dosage. Has two layout views: *trio view* (nodes = samples coloured by Mendelian consistency, edges = parent-offspring pedigree links) and *transmission-table view* (bipartite: parent state pairs → offspring states with observed/expected counts). Only meaningful when pedigree is available (currently `f1_hybrid`). | per-regime decoder, `haplotype_regimes` UI |
| `compatibility_edge` | An edge in either graph's layouts; carries a `compatibility_type` and a weight. For arrangement_compatibility_graph: `shares_one_arrangement` / `opposite_homozygotes` / `hom_evidence` / `het_evidence`. For mendelian_validation_graph: `parent_offspring_consistent` / `parent_offspring_inconsistent` / `parent_offspring_ambiguous`. | per-regime decoder |
| `recombination_suppression` | The biological reason a regime exists: in an arrangement heterozygote, crossovers inside the inversion produce inviable gametes, so the two arrangements do not recombine and accumulate distinct haplotypes. | basis of the whole framework |
| `transition_zone` | The bp range at a regime's flank where recombination resumes — the soft edge between regimes. Not a clustering artefact, biological reality. | `inversion` atlas, per-regime decoder |
| `compound_heterozygote` | A sample heterozygous at BOTH an outer regime and a nested inner regime (e.g. `A/B` outer + `B_inner1/B_inner2` inner). Emitted as a structured combined call, NEVER as a single ad-hoc K class. | per-regime decoder, nested-regime path |
| `nested_regime` | A regime whose dosage system is conditional on a parent regime's state (e.g. inner inversion only present in `B/B` carriers). Has a parent-child link in the data model. | per-regime decoder |
| `polarisation` / `ancestral_arrangement` | The determination of which arrangement at a regime is ancestral. NOT done by this atlas's decoder — done by the `evolution` atlas via outgroup synteny + BUSCO 4D + doubleton SFS. | `evolution` atlas |
| `pseudo_arrangement` | A multi-state cluster that looks like an arrangement system but is actually population structure, batch effect, sex confound, family structure, or assembly artefact. Flagged in `false_positive_flags[]`. | per-regime decoder, validation |
| `mendelian_support` | A per-regime score `1 − χ²(observed vs expected segregation)` over family trios in `f1_hybrid`. Independent of HWE; tests inheritance, not panmixia. | per-regime decoder, `popstats` validator |
| `hwe` | Cohort-level Hardy-Weinberg expectations for the segregation states given arrangement frequencies. Applies to `cgar_hatchery_226` / `cmac_wild`; NOT to `f1_hybrid`. | per-regime decoder, popstats |
| `het_deficit` | Systematic deficit of HET-like states across a cohort, suggesting underdominance / selection against heterokaryotypes. Recorded, NOT corrected. | per-regime decoder |

### 2.1 Forbidden usages

- "K=3" is **not** the karyotype model. It is one special case
  (`n_arrangements = 2`). Do not hard-code K=3 anywhere as a
  binding assumption.
- "band", "cluster", "candidate" are not synonyms for "regime".
  Use the table above.
- A "POD" is **not** the same as a "regime". A regime becomes a
  POD only after Mendelian validation passes.
- A `segregation_state` is **not** the same as an
  `arrangement_combination`. The state is the empirical cluster
  (`S1, S2, …` with a `state_type`); the arrangement_combination
  (`A/A`, `A/B`, …) is the *interpretation* of that state and
  is emitted only when evidence supports it. Do not collapse
  Layer A and Layer B.
- Do not describe a 5-state or 6-state regime as "K=3 failed".
  Such a regime is a multiallelic structural haplotype system
  with multiple HOM-like and HET-like states.
- Do not use Mendelian inheritance as part of arrangement
  *proposal* (Stages 1–3). It is *validation* only (Stage 4).
  The proposal step has no access to the pedigree.
- Do not draw the `arrangement_compatibility_graph` and the
  `mendelian_validation_graph` as variants of the same object.
  They live in different stages and use different inputs.

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
of observed segregation states relates to `N = n_arrangements`
by `n_states_max = N · (N+1) / 2`. Some heterozygous states may
be absent (meiotic incompatibility, demographic absence,
selection) — that is **information**, not failure.

| N | HOM-like (max) | HET-like (max) | n_states_max | comment |
|---|----------------|----------------|--------------|---------|
| 2 | 2              | 1              | 3            | classic biallelic |
| 3 | 3              | 3              | 6            | real 6-state regime — NOT a "K=3 failure" |
| 4 | 4              | 6              | 10           | rare, possible |

### 4.1 Asymmetric observability

Per architect 2026-05-26: "sometimes we observe them as HET
but not as HOM."

- A HET-like state can exist without the matching HOM-like
  state in the cohort. The het pair `A/C` may be observed even
  if no `C/C` homozygote is sampled.
- A HOM-like state can exist without all its possible het
  partners.
- The decoder emits each segregation_state on its own evidence.
  Arrangement-set inference (Layer B) may flag arrangements as
  HET-only-observed; see SPEC §10.3.

### 4.2 Disambiguation rules

- **bp-disjoint states** along the regime → segmentation
  failure (under-split). Recommend split.
- **bp-mixed states** across the regime → real multi-arrangement
  regime.
- **n_states > n_arrangements·(n_arrangements+1)/2** for any
  reasonable N → recheck dosage / window choice; likely noise
  or a true `complex` state was mis-split.

See `specs_todo/SPEC_per_regime_dosage_decoding.md` §9–§11 for
the decoder spec, the two-layer output contract, the
`HET-only-observed` inference rule, the per-regime table schema,
the arrangement / dosage-state graphs, and the floating-panel UI
contract for `haplotype_regimes`.

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
- Polarise arrangements (decide ancestral identity) inside the
  `inversion` atlas decoder. That is the `evolution` atlas's
  job.
- Pool cohorts (`f1_hybrid` / `cgar_hatchery_226` / `cmac_wild`)
  for any per-regime statistic without an explicit cross-cohort
  comparison call. The default is per-cohort.
- Silently drop regimes flagged as `pseudo_arrangement`. Emit
  the states + the flags; let downstream decide.

## 8. Where to look first

- `specs_todo/` — pending architecture (NOT yet binding).
- `docs/PIPELINE_ANALYSIS_ORDER.md` — the 4-cluster pipeline order
  for the discovery side.
- `docs/MIGRATION_4_ATLASES.md` — the atlas split.
- `docs/atlas-core-proposals/` — cross-atlas import contract.
- This file — vocabulary + master rule, binding.

---

*Owner: user (architect). Last user-signed update: 2026-05-26.*
