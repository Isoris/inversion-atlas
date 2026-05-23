# SPEC — `inversion_age_atlas_surface`: per-candidate age + divergence display

**Status**: shipped 2026-05-20 (audit reconstruction from shipped code).
**Authored**: turn 117 (per the AMENDMENT's `Amends:` line); the original
turn-117 text was not preserved across the tarball import that lost
`Atlas/specs_done/` (see [`_handoff_docs/SPECS_AUDIT.md`](../_handoff_docs/SPECS_AUDIT.md)).
**This SPEC** documents what the atlas currently ships under that name,
reconstructed from the shipped modules + the AMENDMENT's negative
space (what it explicitly KEEPS vs REMOVES vs ADDS). Voice discipline
and the three-method framework live in the AMENDMENT — read both
together.

**Companion SPEC** (lives in `specs_todo/`, intentionally):
[`SPEC_inversion_age_atlas_surface_AMENDMENT.md`](../specs_todo/SPEC_inversion_age_atlas_surface_AMENDMENT.md) —
drops absolute-My displays, adds three-μ BUSCO 4D bracketing (Method 3),
adds supporting popstats panel (Row D), commits to the four-method
triangulation voice. The AMENDMENT's row-by-row layout (Rows A/B/C/D
on Page 3, "rel age" column on Page 5) remains partially shipped — see
§3 below for slice-by-slice status.

**Implemented in:**
- [`atlases/inversion/shared/mgl_inversion_divergence.js`](../atlases/inversion/shared/mgl_inversion_divergence.js) — the per-candidate compute primitive: per-site allele freqs by class, dXY, Hudson F_ST, private/fixed counts, age-class verdict (young_clean / old_divergent / old_swept / leaky / insufficient)
- [`atlases/inversion/shared/age_model_suggester.js`](../atlases/inversion/shared/age_model_suggester.js) — age-model recommendation reading lineage distribution + dXY + karyo verdict (sibling to the divergence engine, used by downstream age-rendering logic)
- [`atlases/inversion/shared/busco_4d_age.js`](../atlases/inversion/shared/busco_4d_age.js) — BUSCO 4D-neutral-site three-μ bracketing primitives (`computeAgeFromDxy`, `computeAllThreeAges`, `buildBuscoAgeBracketsBlock`, `validateBuscoAgeBracketsBlock`, formatters); the Method-3 compute side
- [`atlases/inversion/pages/evolution/age_divergence.html`](../atlases/inversion/pages/evolution/age_divergence.html) + [`age_divergence.js`](../atlases/inversion/pages/evolution/age_divergence.js) — the surface: four sparkline-style summary bars (π_inv, π_std, dXY, F_ST) + private / fixed counts + age-class verdict + per-class reason string
- [`tests/smoke_evolution_age_divergence_round5.mjs`](../tests/smoke_evolution_age_divergence_round5.mjs) — page smoke
- Page registry doc: [`atlases/inversion/registries/data/pages.registry.json`](../atlases/inversion/registries/data/pages.registry.json) → `pages.age_divergence._doc`

---

## 1. What this is

A per-candidate atlas surface for inversion age + deep-divergence
context. The user picks a candidate (via `state.candidate`); the
surface reads its per-class dosage matrix (INV samples vs STD samples)
and shows four primary numbers plus an age-class verdict.

Two compute primitives feed the surface:

| primitive | input | output |
|---|---|---|
| `mgl_inversion_divergence.computeDivergence(args)` | `{ dosage, n_markers, n_samples, inv_idx, std_idx, opts? }` | `{ pi_inv, pi_std, dxy, fst_hudson, private_inv, private_std, fixed_differences, age_class, age_class_reason, n_called_avg }` |
| `busco_4d_age.buildBuscoAgeBracketsBlock(args, opts?)` | `{ dxy_4d_between_arrangements, n_busco_genes_in_inversion, n_4d_sites_used, dxy_ci95? }` | `{ schema_version, n_busco_genes_in_inversion, n_4d_sites_used, dxy_4d_between_arrangements, mu_low, mu_mid, mu_high }` (each μ block: `{ value, age_my, age_my_ci95, rationale }`) |

The first runs **client-side** from per-candidate dosage already in
state (no JSON fetch). The second runs **cluster-side** (per the
AMENDMENT's `STEP_C01f_e_emit_busco_4d_age.py`); the atlas only renders
the JSON block.

## 2. Age-class verdict — the spec contract

`mgl_inversion_divergence.ageClass(metrics)` returns one of:

| class                | meaning |
|----------------------|---------|
| `young_clean`        | Low π in both classes, low dXY → recent inversion, no diverged haplotypes yet |
| `old_divergent`      | Elevated π_inv + elevated dXY + fixed differences → old, both haplotypes preserved |
| `old_swept`          | π_inv ≪ π_std (or vice-versa) → old, one class swept (BGS / selective sweep candidate) |
| `leaky`              | dXY low but private counts non-zero → gene flow between arrangements (incomplete suppression) |
| `complex_or_unclear` | doesn't fit a clean class (used by the renderer's color palette; not emitted by `ageClass()` in v1 — kept as a reserved label for future Tajima-D triangulation) |
| `insufficient`       | `n_called_avg < min_called_per_class` (default 4) — verdict suppressed |

Color palette (page-side, in `age_divergence.js`):

| class                | hex      |
|----------------------|----------|
| `young_clean`        | `#3074C8` |
| `old_divergent`      | `#D04545` |
| `old_swept`          | `#A060B8` |
| `leaky`              | `#D8A030` |
| `complex_or_unclear` | `#888888` |
| `insufficient`       | `#888888` |

These hex codes are not yet sourced from `XP_K_PALETTE` (the cross-page
shared palette) because the age-class enum doesn't map onto K-clusters.
Future work: promote to a dedicated `AGE_CLASS_PALETTE` in `shared/`.

## 3. Surface — per-slice shipped vs deferred (vs the AMENDMENT)

The AMENDMENT §4 / §8 prescribes a rich Page-3 row layout (A/B/C/D) and
a Page-5 "rel age" column. Slice-by-slice against the shipped code:

| AMENDMENT slice | status | location |
|---|---|---|
| State slot `state.inversionAge[candidate]` loader for `inversion_age_v1.json` | **deferred** — JSON loader not present; the shipped surface reads dosage in-state and computes client-side via `computeDivergence` | — |
| State slot `state.regionPopstats[candidate]` loader for `region_popstats_v1.json` | **deferred** — same JSON loader gap | — |
| Page-3 Row A (Method 1: between-inversion ranking) | **deferred** — no rank-bar UI yet | — |
| Page-3 Row B (Method 2: within-arrangement ranking, π ratios) | **partial** — `pi_inv`, `pi_std` and `pi_inv/pi_std` are computed and rendered as two of the four bars on `age_divergence`; explicit rank labelling not surfaced | `pages/evolution/age_divergence.{html,js}` |
| Page-3 Row C (Method 3: BUSCO 4D three-μ brackets) | **compute shipped; render deferred** — `busco_4d_age.js` ships all compute + validators + formatters; no Page-3 Row C UI consumes them yet | `shared/busco_4d_age.js` |
| Page-3 Row D (supporting popstats: dXY trace, π traces, Tajima D shape) | **deferred** — `region_popstats_v1` loader + traces not present | — |
| Page-5 catalogue "rel age" column (rank + × chrom-median) | **deferred** — no catalogue-side column yet | — |
| Manuscript bundle entry combining the four methods | **deferred** | — |

What IS shipped: a single-page per-candidate **summary surface** (the
four-bar age_divergence page) that produces the verdict + supporting
metrics, but not the Methods 1/2/3/D row layout. The compute primitives
for Method 3 are ready to plug into a future Row-C renderer.

## 4. Input contract — `age_divergence` page

The page consumes a single state slot:

```js
atlasState.inversion.age_state = {
  dosage,              // Float64Array (n_markers × n_samples) or per-marker Array<Array<number>>
  n_markers,           // integer
  n_samples,           // integer
  inv_idx: [...],      // sample indices classified as INV (per-candidate karyotype call)
  std_idx: [...],      // sample indices classified as STD
  candidate_label?,    // optional string for the page header
  opts?: {
    fix_threshold?,        // default 0.95
    min_called_per_class?, // default 4
  },
};
```

The page is **inert** when `inv_idx.length === 0 || std_idx.length === 0`
or `n_called_avg < min_called_per_class` — surfaces an `insufficient`
verdict + grey palette. No JSON fetch; no localStorage. Pure
state-as-first-arg.

## 5. Voice discipline

Inherited from the AMENDMENT §7 — never display absolute-My from
single-μ estimates outside the three-μ bracket framing. The
age_divergence page does NOT show My values today (it shows ratios
and verdicts), so the discipline is honored by omission. When Row C
ships, it must render all three μ values together (see AMENDMENT §4.1).

## 6. Why the parent SPEC is reconstructed, not the turn-117 original

Per [`_handoff_docs/SPECS_AUDIT.md`](../_handoff_docs/SPECS_AUDIT.md)
the legacy tarball's `Atlas/specs_done/` directory was lost at import
time. The turn-117 `SPEC_inversion_age_atlas_surface.md` text was in
that directory. This file is not a verbatim restoration — it
documents the **as-shipped surface** that the AMENDMENT was meant to
modify. The AMENDMENT's "Removed surfaces" and "Added surfaces" lists
imply most of the original prescription; the SHIPPED code confirms a
narrower scope actually landed (four-bar verdict page, no Row layout,
no JSON loader). Future work should either implement the full
AMENDMENT layout (promoting it from `specs_todo/` to `specs_done/`)
or formally retire the deferred slices in a successor SPEC.

## 7. Cross-references

- AMENDMENT (see top of file) — the source of voice discipline + the
  prescribed row layout (most slices still deferred)
- [`SPEC_busco_4d_age_brackets.md`](../specs_todo/SPEC_busco_4d_age_brackets.md) —
  Method 3 producer + JSON schema (cluster-side step `STEP_C01f_e_emit_busco_4d_age.py`)
- [`SPEC_inversion_divergence_network_v1.md`](SPEC_inversion_divergence_network_v1.md) —
  candidate-scoped FST node-link diagram (this SPEC's diagnostic
  sibling on the page-1 PCA overlay; uses the same per-class compute
  vocabulary)
- [`atlases/inversion/registries/data/pages.registry.json`](../atlases/inversion/registries/data/pages.registry.json)
  → `pages.age_divergence._doc` for the per-page narrative
