# SCHEMA — Inversion Atlas Layer + Schema Reference

**Status**: Authored 2026-05-15 to resolve the long-standing
`SCHEMA.md` / `SCHEMA_V2.md` references that lived only inline in
`pages.registry.json` page _doc fields, page module headers, and
`shared/{regimes_registry, scale_stability}.js` source comments.

**Convention**: When a page or module says **"see SCHEMA §N"**, the
section is in this file. When it says **"SCHEMA_V2.md §19"**, treat
that as referring to §19 in this file (the V2 designation is
historical — there is one schema doc, this one).

**Companion to**:
- The 26 JSON schemas in `atlases/inversion/registries/schemas/*.schema.json`
  (machine-readable layer formats)
- `atlases/inversion/registries/data/layers.registry.json` (which
  layers exist, which pages need them)
- `specs_done/SPEC_band_track_extraction_and_l3_single_band_rows.md`
  (defines L1/L2 envelopes + K-means band semantics that several
  schemas reference)

---

## §0. Reading order

1. **§1-§8** — registry conventions + JSON-schema status legend
2. **§9-§14** — cluster-emit layers (the R-side pipeline outputs)
3. **§15-§22** — atlas-side derived layers + structural scaffolds
4. **§23-§30** — vocabulary + decision-tree references

You can read any section standalone; cross-refs are explicit.

---

## §1. The two registries

The inversion atlas has **two** "registry" concepts that share a
word but do completely different jobs (per
`_handoff_docs/AUDIT_LOG.md`):

1. **Atlas resolver-registry** (this doc) — runtime data routing in
   the browser. The 26 JSON schemas in `registries/schemas/` define
   the on-disk shape of each layer. The 5 registry files in
   `registries/data/` (layers / files / operations / pages / slots)
   wire each page to the layers it needs.
2. **Toolkit registry** (separate concern) — a persistent
   file-based database used by the manuscript pipeline. See
   `atlas-core/docs/TWO_REGISTRIES.md` and
   `atlas-core/toolkit_registries/`. NOT covered here.

This file is about (1).

## §2. Schema status legend

Every JSON schema has a `_status` field:

| status | meaning |
|--------|---------|
| `pending` | placeholder; accepts any object. Replace when the data shape stabilizes. |
| `validated` | real schema; strict validation. Can reject malformed JSON. |
| `unknown` | no `_status` set; check `_doc` for inline note. Effectively pending. |

Of the 26 schemas (2026-05-15):
- 14 are `pending` placeholders
- 9 carry real `_doc` describing the actual JSON shape
- The remaining are `unknown` (effectively pending)

A `pending` schema means: the layer's file exists, drag-drop works,
the page renders — but if upstream sends a malformed payload, no
validation will catch it. `validated` schemas are gradually
replacing the placeholders as each layer's shape stabilizes.

## §3. The 5 registry files

Located in `atlases/inversion/registries/data/`:

| file | purpose |
|------|---------|
| `layers.registry.json` | every layer the atlas knows about, with `schema_status` + which pages need it |
| `files.registry.json` | per-file metadata (path, format, refresh discipline) |
| `operations.registry.json` | live-server endpoints (POST /api/popstats/*) and their schemas |
| `pages.registry.json` | per-page `_doc` + required layers/operations/slots + preloads |
| `slots.registry.json` | the cross-atlas slots (activeChrom, activeCandidate, etc.) |

## §4. Mode A vs Mode B file interfaces

Per the `relatedness*` schemas + `_handoff_docs/READ_MODES_CONFIRMED.md`:

- **Mode A (parsed-JSON)** — layer is shipped as a JSON file with the
  exact shape the atlas reads.
- **Mode B (raw-folder)** — layer is shipped as a TSV / CSV; the
  resolver-registry parses + applies the atlas's filters + emits the
  in-memory shape.

Most layers are Mode A. The relatedness layers are Mode B (raw
ngsRelate output).

## §5. Per-candidate vs cohort-level vs chromosome-level

Three scopes of layers, by `requires_slots`:

- **Per-candidate** (`activeCandidate`) — keyed by candidate_id;
  drag-dropped per candidate or fetched on candidate switch.
- **Per-chromosome** (`activeChrom`) — keyed by chrom; loaded with
  the precomp.
- **Cohort-level** (no slot) — global; loaded once.

`pages.registry.json` flags requires_slots so the shell can
empty-state when prerequisites aren't met.

## §6. The candidate JSON shape

Per `pages/discovery/page1/candidates.js` + the field references
across the codebase:

```
{
  id:              <string>             // 'auto_l2sweep_<chrom>_<l2idx>_<ts>' OR user-assigned
  source:          'auto_l2_sweep' | 'manual'   // see SPEC_review_surfaces_auto_and_lineages
  chrom:           <string>
  l2_indices:      [<int>, ...]
  ref_l2:          <int>
  ref_window:      <int> | null
  K:               2..6                  // K-means K used
  locked_labels:   [<int>, ...]          // per-sample band assignment in this candidate
  start_w, end_w:  <int> | null          // window indices
  start_bp, end_bp: <int>
  created_at:      <ISO 8601>
  auto_promoted_at: <ISO 8601> | absent
  notes:           <string>
  confirmed:       <boolean>             // see SPEC_l2_sweep_inheritance §6
  active_band:     <int> | absent        // for two-track candidates (see §13)
  // ... plus completion + characterization blocks (see §13)
}
```

## §7. The state.data envelope

A loaded chromosome JSON populates `state.data` with:

```
{
  chrom:               <string>
  windows:             [{ start_bp, end_bp, ... }, ...]
  l2_envelopes:        [{ start_bp, end_bp, _s0, _e0, ... }, ...]
  l1_envelopes:        [{ start_bp, end_bp, ... }, ...]
  per_sample_pca:      [...]               // per-window PCA
  // optional per-layer extensions:
  theta_pi_per_window: [...]               // §22
  ghsl_panel:          {...}               // §22
  dosage_chunks:       [...]               // §11
  classification:      {...}               // §9
  final_classification: { <cid>: ... }     // §19
  _layers_present:     <Set>               // which layers are loaded
  ...
}
```

`state.layersPresent` (a `Set`) is the source of truth for which
layers are currently loaded — used by every `_isLinesColorModeAvailable`
check + every `[data-th-layer]`/`[data-gh-layer]` chip.

## §8. Versioning

Per `specs_done/SPEC_registry_v2.md`:

- Each layer has a `format_version` field at the JSON root (e.g.
  `"sv_genotype_counts_v1"`).
- Schemas are versioned via filename suffix (`ancestry_global_q.schema.json`
  vs `ancestry_global_q_v1.schema.json`).
- Major version bumps add a new schema file; minor bumps update
  in-place with a `_changelog` field.

---

## §9. Cluster-emit `classification` layer

**Source**: cluster-side R pipeline (final step). **Consumers**:
`page4` Tier sub-view (`state.data.classification`).

Shape:

```
state.data.classification = {
  <candidate_id>: {
    layer_a: 'pass' | 'fail' | 'unknown',   // local PCA evidence
    layer_b: 'pass' | 'fail' | 'unknown',   // SV callers
    layer_c: 'pass' | 'fail' | 'unknown',   // GHSL within-sample div
    layer_d: 'pass' | 'fail' | 'unknown',   // Fisher GT × BP
    confidence_tier: <T1..T4>,
    // ...
  },
  ...
}
```

This is the per-axis classification; the full 14-axis grid lives in
`final_classification.json` (§19).

## §10. Marker layer column contracts

**Source**: cluster-side; per-candidate. **Consumers**: `page10`
(marker panels).

`marker_panel_summary.json` (per-candidate row):

| column | type | meaning |
|--------|------|---------|
| `candidate_id` | string | matches candidate.id |
| `chrom`, `start_bp`, `end_bp` | string, int, int | candidate locus |
| `n_markers` | int | 3-10 typically |
| `panel_class` | string | private_indel / haplotype_tag / breakpoint_pcr / exploratory |
| `tier` | `HIGH` / `MEDIUM` / `LOW` | per Tier 1-4 hierarchy in `specs_done/SPEC_sv_evidence_page` analog |
| `expected_accuracy` | float [0,1] | calibration cohort estimate |
| `regime_counts` | object | { g0, g1, g2 } counts assignable by panel |
| `tm_min`, `tm_max` | float | multiplex spread (≤4°C = safe) |
| `warning_tags` | string[] | optional tags |

Per-marker detail (when `marker_catalogue` + `marker_primers` also
loaded):

| column | type | meaning |
|--------|------|---------|
| `marker_id` | string | unique within candidate |
| `position_bp` | int | absolute |
| `variant_type` | string | snp / indel / mnp / sv |
| `target_regime` | g0 / g1 / g2 / mixed | which regime this marker diagnoses |
| `specificity_score` | float [0,1] | how cleanly this marker separates target from non-target |
| `freq_g0`, `freq_g1`, `freq_g2` | float [0,1] | allele frequency per regime |
| `family_spread_score` | float [0,1] | how evenly distributed across founder families |
| `amplicon_size_bp` | int | for PCR |
| `tm_fwd`, `tm_rev` | float | primer Tm in °C |

## §11. Dosage / heterozygosity (`dosage_chunks` layer)

**Source**: cluster-side (per-window dosage matrix). **Consumers**:
`page2` FIG_C08 dosage heatmap, `dosage_heatmap`,
`dosage_cluster_adaptive_k`, `page1` L3 het-coloring (per
`specs_done/SPEC_l3_het_dosage_coloring.md`), `page1`
`linesColorMode='dosage'` and `'het'`.

Shape (per chrom or per candidate):

```
{
  format_version: 'dosage_chunks_v1',
  chrom: <string>,
  windows: [{ start_bp, end_bp }, ...],
  samples: [<sample_id>, ...],
  dosage:  Float32Array | Array<Float32Array>,    // n_samples × n_markers; row-major; 0..2 alt-allele dosage
}
```

`het_rate` per sample = fraction of markers in the window where the
sample's dosage falls in the heterozygous range (typically
`0.5 ± window_width`; window_width is configurable in
`shared/het_rate.js`).

## §12. Cross-species breakpoints (`cs_breakpoints_v1`)

**Source**: `STEP_CS01_extract_breakpoints.py` (cluster-side wfmash
1-to-1 alignment of Cgar × Cmac). **Consumers**: `page16`,
indirectly `page16b` + `page17`.

See `registries/schemas/cross_species_breakpoint_reuse.schema.json`
for the JSON shape. Three-cohort discipline: F1 hybrid ≠ 226 pure
C. gariepinus ≠ wild C. macrocephalus.

## §13. Evidence framework (per-candidate completion + characterization)

The candidate object (per §6) carries optional **completion** +
**characterization** blocks populated by the cluster-side pipeline
or by the user via page4:

```
candidate.completion = {
  layer_a, layer_b, layer_c, layer_d: 'pass' | 'fail' | 'unknown',
  boundary_quality, boundary_quality_left, boundary_quality_right,
  // ...
}

candidate.characterization = {
  group_validation, internal_structure, recombinant_class,
  family_linkage, polymorphism_class, mechanism_class,
  age_class, burden_class, confidence_tier,
  // ...
}
```

These feed §19's 14-axis grid.

## §14. SV evidence (`sv_genotype_counts_v1`)

See `specs_done/SPEC_sv_evidence_page.md` for full schema and
classifier rules (§3.4 of that SPEC). Highlights:

- Per-SV: caller, type, position, FDR-corrected Fisher OR vs
  H1/H1-vs-H2/H2 contingency, zone classification
  (left_flank/left_boundary/inversion_body/right_boundary/right_flank),
  pattern label.
- Pattern labels: canonical_breakpoint_marker /
  dominant_presence_marker / het_specific_marker (gates BEFORE FDR;
  see SPEC §3.3) / sub_haplotype_marker / internal_linked_marker /
  uninformative.
- Boundary summary per side, per SV type.

---

## §15-§18. Atlas-side derived layers

Reserved for: lineage (§15 — see
`specs_done/SPEC_distant_band_concordance_fish_trajectory.md`),
band-trace (§16 — same SPEC), inheritance-group clustering (§17 —
`shared/inheritance_groups.js`), candidate-list (§18 — page2 +
candidate_io.js).

These are computed in the browser, not loaded as files. They cache
on `state.{lineageResult, bandTraceCache, inheritanceCacheKey,
candidateList}`.

## §19. 14-axis tier classification

**Source**: cluster-side; ships as `final_classification.json` keyed
by `candidate_id`. **Consumers**: `page4` Tier sub-view.

The 14 axes, grouped into 6 sections (per
`pages/review/page4/tier_axes.js#TIER_AXES`):

### Existence (4 axes — independent layers)

| axis | meaning | categories |
|------|---------|------------|
| `existence_layer_a` | local PCA evidence (sim_mat triangle, robust |Z|, λ ratio) | pass / fail / unknown |
| `existence_layer_b` | SV callers (DELLY, Manta) breakpoint evidence | pass / fail / unknown |
| `existence_layer_c` | GHSL within-sample haplotype divergence | pass / fail / unknown |
| `existence_layer_d` | Fisher genotype × breakpoint association | pass / fail / unknown |

### Boundary

| axis | meaning | categories |
|------|---------|------------|
| `boundary_quality` | sharpness of L-R transition zones | sharp / fuzzy / unknown |

### Groups (3 axes)

| axis | meaning | categories |
|------|---------|------------|
| `group_validation` | independent verification of K-means karyotype groups | VALIDATED / SUPPORTED / UNCERTAIN / SUSPECT / NONE |
| `internal_structure` | pattern of similarity inside the inversion | clean / gradient / composite_undecomposed / unknown |
| `recombinant_class` | rare recombinant haplotype class within | none / gene_conversion / double_crossover / mixed / unknown |

### Population (2 axes)

| axis | meaning | categories |
|------|---------|------------|
| `family_linkage` | how carrier samples partition by founder family | multi_family / few_family / single_family / pca_family_confounded / unknown |
| `polymorphism_class` | distribution of arrangement classes across cohort | cohort_wide / lineage_restricted / family_restricted / unclassified |

### Biology (3 axes)

| axis | meaning | categories |
|------|---------|------------|
| `mechanism_class` | inferred molecular mechanism of inversion formation | NAHR / NHEJ / MMBIR / unknown |
| `age_class` | relative age (Tajima D coalescent proxy + θπ asymmetry) | young / intermediate / ancient / unknown |
| `burden_class` | deleterious-variant burden inside vs outside | enriched / neutral / depleted / unknown |

### Tier (1 axis — synthesis)

| axis | meaning | categories |
|------|---------|------------|
| `confidence_tier` | overall tier from independence layers + group validation | T1 / T2 / T3 / T4 / unknown |

The page4 Tier view renders these as a colour-coded grid. Empty
state shows the axis schema only — no values — until
`final_classification.json` ships from cluster-side.

---

## §20-§21. Reserved

For arrangement_calls + boundary annotations (referenced in page11
`boundary_zone` per SPEC_l2_sweep + page1 candidate.boundary_zone).
Both currently `pending` placeholder schemas; will be expanded when
the boundary refinement output schema stabilizes.

## §22. Structural scaffold (θπ / GHSL panels)

**Cited by**: `pages/discovery/page12.html:13`,
`pages.registry.json -> pages.page12._doc`.

The structural scaffold is the empty-state architecture for
**evidence-axis pages** that ship UI without data:

- Empty-state placeholder visible until R pipeline ships at least
  one of the relevant layers
- First layer landing hides placeholder + reveals the relevant
  panels
- `[data-th-layer]` / `[data-gh-layer]` indicator chips tied to
  `state.layersPresent`

Pages following this scaffold:
- **page12** — θπ scanner (chips for `theta_pi_per_window`,
  `theta_pi_local_pca`, `theta_pi_envelopes`, `cusum_theta`)
- **page15** — GHSL scanner (chips for `ghsl_panel`,
  `ghsl_kstripes`, `ghsl_karyotype_runs`, `ghsl_d17_envelopes`,
  `cusum_ghsl`)

The scaffold rationale: build the page once; populate as the R
pipeline ships layers. Avoids two parallel codepaths (with-data /
without-data).

---

## §23-§25. Reserved

For: relatedness layers (§23 — three schemas: `relatedness`,
`relatedness_ngsrelate`, `relatedness_samples_order`), ancestry
layers (§24 — `ancestry_global_q`, `ancestry_global_q_v1`,
`ancestry_local_q_windows`), candidate lineage versioning (§25 —
`candidate_lineage`).

## §26. `axis_topology` vocabulary

**Cited by**: `shared/regimes_registry.js:49`.

User-chosen vocabulary; never auto-assigned. The set of allowed
values for the `axis_topology` field on any candidate or regime
record:

| value | meaning |
|-------|---------|
| `linear_diploid` | normal — REF / HET / ALT axis aligned with diploid count |
| `inversion` | the canonical inversion axis (presence/absence of inverted arrangement) |
| `multi_axis` | two or more independent axes (e.g. nested inversion) |
| `unknown` | axis topology not yet classified |

(Plus historical / deprecated values — see `regimes_registry.js`
source for the full enum.)

## §27. Scale-stability verdict tags

**Cited by**: `shared/scale_stability.js:33` (the 5 verdict tags are
**FROZEN**).

Three panes (NN20 / NN40 / NN80) + two pairwise comparisons →
decision tree → one of 5 verdicts:

| verdict | meaning |
|---------|---------|
| `STABLE_HIGH` | all 3 scales agree at high resolution |
| `STABLE_MEDIUM` | all 3 scales agree at medium resolution |
| `STABLE_LOW` | all 3 scales agree but at low resolution (less informative) |
| `SCALE_DEPENDENT` | verdict shifts as you change scale (resolution effect) |
| `UNRESOLVED` | can't render a verdict (insufficient data) |

The decision tree itself is in `shared/scale_stability.js`'s
exported pure functions; this section freezes the **vocabulary** so
downstream code can switch on these tags safely.

## §28. Reserved

For: regime annotation v3.4 (the Stage 5.5 layer per
`specs_todo/SPEC_regime_annotation_v34.md`).

## §29. Reserved

For: cohort_diversity, cohort_sample_froh, ancestry_confound (the
ancestry-confound calculations consumed by page2's ancestry
confound panel).

## §30. Reserved

For future extensions. When you author a new layer, claim a
section here and add the `_doc` to its JSON schema.

---

## Schema-by-schema index

The 26 schema files in `atlases/inversion/registries/schemas/` keyed
by section:

| schema file | _status | section in this doc |
|-------------|---------|--------------------|
| `ancestry_global_q.schema.json` | unknown | §24 |
| `ancestry_global_q_v1.schema.json` | unknown | §24 |
| `ancestry_local_q_windows.schema.json` | unknown | §24 |
| `arrangement_calls.schema.json` | pending | §20 (reserved) |
| `beagle_uncertainty.schema.json` | pending | §11 (`dosage_chunks` companion) |
| `candidate_lineage.schema.json` | unknown | §25 (reserved) |
| `cohort_diversity.schema.json` | pending | §29 (reserved) |
| `coverage.schema.json` | pending | §11 (companion) |
| `cross_species_breakpoint_reuse.schema.json` | unknown | §12 |
| `cross_species_synteny_blocks.schema.json` | unknown | §12 |
| `dxy.schema.json` | pending | §11 (companion) |
| `fst_hom1_hom2.schema.json` | pending | §11 (companion) |
| `karyotype_assignment.schema.json` | pending | §6 (candidate.locked_labels) |
| `lof_burden.schema.json` | pending | §19 axis `burden_class` |
| `marker_panel.schema.json` | pending | §10 |
| `mendelian_test.schema.json` | pending | §17 (inheritance) |
| `permutation.schema.json` | pending | §13 (page17 evidence) |
| `pseudogenisation.schema.json` | pending | §13 |
| `relatedness.schema.json` | unknown | §23 |
| `relatedness_ngsrelate.schema.json` | unknown | §23 (Mode B) |
| `relatedness_samples_order.schema.json` | unknown | §23 (companion) |
| `repeat_density.schema.json` | pending | §11 (TE density companion) |
| `sample_froh.schema.json` | pending | §29 (ancestry confound input) |
| `scrubber_main.schema.json` | pending | §7 (state.data envelope core) |
| `split_read.schema.json` | pending | §14 (SV evidence companion) |
| `theta_pi.schema.json` | pending | §22 |
| `schema_in/run_popstats_v1.schema.json` | (operation input) | §3 |
| `schema_out/fst_windows_v1.schema.json` | (operation output) | §3 |

## Migration plan: pending → validated

The 14 `pending` placeholder schemas should be replaced as their
data shapes stabilize. Per `_handoff_docs/AUDIT_LOG.md`: many can be
replaced with `../../../../toolkit_registries/schemas/structured_block_schemas/<type>.schema.json`
references (the toolkit registry has 41 structured-block schemas
covering most evidence-block JSON types).

When you replace a placeholder:
1. Author the real schema, validate with a sample payload.
2. Update `_status` from `pending` to `validated`.
3. Add a `_doc` field if not present.
4. If the schema now corresponds to a section in this doc, add the
   section pointer to its `_doc` (e.g.
   `"_doc": "... See SCHEMA §10 for the prose contract."`).

---

## What to do when you can't find a §N

If you read a `SCHEMA §N` reference in code and §N is reserved
above, the prose isn't authored yet. Two options:

1. Author it. Put the prose here, then update the reference in code
   to point to a stable section number.
2. Mark it inline. Add a `// SCHEMA §N — prose pending` note
   adjacent to the code reference so the reader knows it's
   intentionally vague.

Avoid: a third state where code says `SCHEMA §N` but no §N exists
and no inline note acknowledges that. That's the original problem
this doc solves.

---

**Authored**: 2026-05-15 to resolve the SCHEMA / SCHEMA_V2.md
references from `pages.registry.json` page4 _doc + page12 _doc +
page10 module header + `shared/regimes_registry.js:49` +
`shared/scale_stability.js:3, 33, 298`. Also pulls in the 14-axis
schema from `pages/review/page4/tier_axes.js#TIER_AXES`.

**Future**: as more schemas move from `pending` to `validated`, this
file accumulates the §N anchors that downstream code can reference.
