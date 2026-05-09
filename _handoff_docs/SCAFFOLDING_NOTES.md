# SCAFFOLDING_NOTES — relatedness / ancestry / cross_species

**Date:** 2026-05-06 (chat ~32)
**Done:** folder structure + READMEs + real schemas + layer entries
for three data domains. No real data files yet, no engine changes,
no analysis modules.

This is **registry scaffolding**, per Quentin's request. The columns
are stable across runs, so the layer entries can be wired against
expected column sets even without real data on disk. When the
pipeline drops a real run into `data/<domain>/<tool>/<run_id>/`,
the existing layer entries pick it up — flip `schema_status` from
`pending` to `validated` to enable strict validation.

---

## What was created

### Folders (with READMEs)

The canonical `data/` layout (defined in `data/README.md`) has five
locked subfolders separated by **who writes them** (precomp, cohort,
candidates, comparative, review). Domain-specific subfolders live
*inside* the lifecycle-cut folders, not alongside them. So:

```
inversion-atlas/atlases/inversion/data/
├── cohort/
│   ├── relatedness/
│   │   ├── README.md                  ← contract + ngsRelate column set
│   │   └── ngsrelate/                 ← <run_id>/ folders go here
│   └── ancestry/
│       ├── README.md                  ← contract + Q matrix conventions
│       ├── global/                    ← K<k>/ folders go here
│       └── windows/                   ← <chrom>_K<k>.tsv files go here
└── comparative/
    └── cross_species/
        ├── README.md                  ← contract + pair-naming convention
        ├── synteny/                   ← <pair>/ folders go here
        ├── breakpoints/               ← <pair>/ folders go here
        └── multi_species/             ← <run_id>/ folders go here
```

Relatedness and ancestry are cohort-level (independent of any single
candidate or chromosome region), so they go under `cohort/`.
Cross-species comparison is genome-vs-genome, so it goes under
`comparative/`. This preserves Quentin's "you can `rm -rf
data/precomp/<chrom>` without losing curation work" guarantee from
`data/README.md` §2.

### Schemas (real, not placeholder)

```
inversion-atlas/atlases/inversion/registries/schemas/
├── relatedness_ngsrelate.schema.json           ← 23 ngsRelate columns
├── relatedness_samples_order.schema.json       ← samples.txt sidecar
├── ancestry_global_q.schema.json               ← .qopt rows
├── ancestry_local_q_windows.schema.json        ← long-format Q-by-window
├── cross_species_synteny_blocks.schema.json    ← aggregated synteny blocks
└── cross_species_breakpoint_reuse.schema.json  ← shared breakpoints
```

The existing `relatedness.schema.json` placeholder is **kept** (still
referenced by the existing `cohort_relatedness` layer, which is
provisional/owned_by population). The new ngsRelate schema lives
alongside it under a tool-specific name.

### New layer entries in `layers.registry.json`

Added 7 layer entries (44 total, up from 37):

| Layer | Source | Tier | Templated on | Owned by |
|---|---|---|---|---|
| `relatedness_ngsrelate` | file | warm | `{run_id}` | population |
| `relatedness_samples_order` | file | warm | `{run_id}` | population |
| `ancestry_global_q` | file | warm | `{K}` | population |
| `ancestry_global_q_samples` | file | warm | `{K}` | population |
| `ancestry_local_q_windows` | file | warm | `{chrom}, {K}` | population |
| `cross_species_synteny_blocks` | file | cold | `{pair}` | genome |
| `cross_species_breakpoint_reuse` | file | cold | `{pair}` | genome |

All `provisional: true`. All `schema_status: pending`. All ready to
flip to `validated` when real data lands.

### Existing layers — NOT changed

- `cohort_relatedness` (the original placeholder) — left in place.
  Coexists with `relatedness_ngsrelate`. Future work can deprecate
  `cohort_relatedness` if `relatedness_ngsrelate` covers its use.
- `synteny_multispecies` — left in place. Coexists with the new
  `cross_species_*` layers as the "curated multi-species view"
  (Mode A) while the new layers serve raw evidence (Mode B).
- `ancestry_q_groupwise` — left in place. Operation-backed runtime
  layer; complements the new file-backed static ancestry layers.

### Audit log

The audit-first rule found three important things before any layer
entry got written:

1. **`cohort_relatedness` already exists** with `provisional: true,
   owned_by: "population"`. New layers added alongside, not over.
2. **`fields:` is already in the meta-schema** but not yet honored
   by `layer_router.js`. Documented as TODO; not implemented in this
   pass to keep scope tight.
3. **A pre-baked relatedness JSON already lives at
   `data/precomp/catfish_226_relatedness.json`** — 226 samples,
   25,425 pairs in COLUMNAR shape (`pairs.a[]`, `pairs.b[]`,
   `pairs.theta[]`), with Manichaikul thresholds (0.177/0.0884/0.0442)
   and pre-computed hub-membership flags. It carries only 3 of
   ngsRelate's 23 columns. This is the existing Mode A artifact the
   `cohort_relatedness` layer points at. **It illustrates exactly
   why the new Mode B layer is needed**: the 20 dropped columns
   (IBS0/IBS1/IBS2, J7/J8/J9, KING, R0/R1, etc.) are needed for
   Mendelian inheritance QC and can't be recovered without re-baking
   the JSON. With Mode B, analysis modules read whatever ngsRelate
   columns they need straight from the TSV — no re-baking.

---

## What's still pending (do NOT skip these before going live)

### TODO 1 — engine: implement the `fields:` filter ✅ DONE (2026-05-06 chat ~33)

The meta-schema's `layer_entry.fields` array is now honored by the
engine.

**Changes:**
- `atlas-core/core/layer_router.js`: `parseDelimited(text, sep, fieldsAllowList = null)`
  drops out-of-list columns at parse time. `LayerRouter.fetchFile(path, format, fields = null)`
  forwards the allow-list to the parser.
- `atlas-core/core/registry_core.js`: `_resolveFields(entry, args)`
  computes the effective allow-list (per-call `args.fields` overrides
  layer-level `entry.fields`). `_fetchFromSource` forwards it to the
  router. `_buildCacheKey` includes a sorted `#fields=` suffix so
  different subsets cache separately and order-invariantly.

**Tests:**
- `atlas-core/tests/test_layer_router_fields.js` — 14 assertions on
  the parser (filter, unknown columns ignored, NA→null preserved,
  string columns preserved).
- `atlas-core/tests/test_registry_cache_key_fields.js` — 6 assertions
  on the cache-key derivation (different subsets → different keys,
  field order normalised, layer default vs per-call override).

All 20/20 pass.

**Net behavioral change:** when an analysis module calls

```js
await registry.resolve('relatedness_ngsrelate', {
  run_id: 'broodstock_qc_pass_v1',
  fields: ['a', 'b', 'theta', 'IBS0', 'KING']
});
```

the parser drops the other 18 ngsRelate columns at parse time. Cache
entry is keyed on the sorted-fields suffix so subsequent calls with a
different subset miss the cache and parse fresh, while calls with the
same subset (in any order) hit cache.

### TODO 2 — engine: add `header: false` flag for `.qopt`

NGSadmix `.qopt` is space-separated with no header. Either:
(a) Add `header: false` to the layer_entry schema and have
    `layer_router.parseDelimited` skip header reading, generating
    column names like `Q1, Q2, ..., QK` from a separate `K` arg.
(b) The pipeline pre-emits a TSV-with-header sibling next to the
    `.qopt`, and the atlas reads the sibling.

Recommendation: (b) for minimum engine change. The pipeline already
knows K when it writes the file.

### TODO 3 — confirm canonical LANTA paths

Three open path questions before flipping `schema_status` to
`validated`:

1. ngsRelate: does the pipeline write to
   `data/relatedness/ngsrelate/<run_id>/relatedness.tsv`, or somewhere
   else? If different, update the layer entry's `path` template.
2. NGSadmix global Q: where on LANTA? The current template
   `data/ancestry/global/K{K}/ngsadmix.qopt` is a guess.
3. wfmash synteny: does wfmash output land in
   `data/cross_species/synteny/<pair>/alignment.paf` and is
   `synteny_blocks.tsv` aggregated by an existing pipeline script?

### TODO 4 — populate one real run per domain

Once paths are confirmed:

- Drop one `data/relatedness/ngsrelate/<run_id>/relatedness.tsv` to
  exercise the schema. Flip `schema_status` to `validated`.
- Drop one `data/ancestry/global/K8/` to exercise the global-Q
  schema.
- Drop one `data/cross_species/synteny/<pair>/synteny_blocks.tsv` to
  exercise the synteny schema.

After each, the corresponding layer is "live" — analysis modules can
call `registry.resolve(...)` and get parsed rows.

---

## What this scaffolding enables next

Three downstream tasks now have a clean dependency:

### 1. `analysis/mendelian_inheritance.js` (SPEC v2 item 7)

Once `relatedness_ngsrelate` is live, the orchestrator can:

```js
const rel = await registry.resolve('relatedness_ngsrelate', {
  run_id: state.relatedness.activeRunId,
  // future: fields: ['a', 'b', 'theta', 'IBS0', 'KING']
});
const samples = await registry.resolve('relatedness_samples_order', {
  run_id: state.relatedness.activeRunId
});
// then filter, join, compute, write back via Registry.write
```

### 2. Local-ancestry scrubber

The future ancestry-scrubber page can use `ancestry_local_q_windows`
with `preload_on: chrom_change`. Already wired.

### 3. Cross-species evidence panel

Once the genome atlas is being built, it inherits all
`cross_species_*` layers via the succession rule
(`provisional: true, owned_by: genome`). Inversion atlas keeps
reading them as fallback until the genome atlas registers.

---

## What was NOT done in this pass

- ❌ Engine code (`layer_router.js`, `registry_core.js`) — untouched.
  Adding the `fields` filter is TODO 1.
- ❌ `Registry.write(...)` method — SPEC v2 item 4, separate session.
- ❌ Candidate versioning schema — SPEC v2 item 1, separate session.
- ❌ `analysis/mendelian_inheritance.js` — SPEC v2 item 7, separate
  session, depends on this scaffolding.
- ❌ `DATA_DOMAINS.md` inventory — SPEC v2 item 9, can be written
  once two more domains have layer entries (samples + diversity
  already exist, so the inventory becomes useful right after this
  pass).
- ❌ Real data files. Path templates assume conventions; flip
  `schema_status` from `pending` to `validated` once real files
  arrive.

---

## File-by-file diff summary

```
NEW:
  inversion-atlas/atlases/inversion/data/SCAFFOLDING_NOTES.md
  inversion-atlas/atlases/inversion/data/cohort/relatedness/README.md
  inversion-atlas/atlases/inversion/data/cohort/relatedness/ngsrelate/.gitkeep
  inversion-atlas/atlases/inversion/data/cohort/ancestry/README.md
  inversion-atlas/atlases/inversion/data/cohort/ancestry/global/.gitkeep
  inversion-atlas/atlases/inversion/data/cohort/ancestry/windows/.gitkeep
  inversion-atlas/atlases/inversion/data/comparative/cross_species/README.md
  inversion-atlas/atlases/inversion/data/comparative/cross_species/synteny/.gitkeep
  inversion-atlas/atlases/inversion/data/comparative/cross_species/breakpoints/.gitkeep
  inversion-atlas/atlases/inversion/data/comparative/cross_species/multi_species/.gitkeep
  inversion-atlas/atlases/inversion/registries/schemas/relatedness_ngsrelate.schema.json
  inversion-atlas/atlases/inversion/registries/schemas/relatedness_samples_order.schema.json
  inversion-atlas/atlases/inversion/registries/schemas/ancestry_global_q.schema.json
  inversion-atlas/atlases/inversion/registries/schemas/ancestry_local_q_windows.schema.json
  inversion-atlas/atlases/inversion/registries/schemas/cross_species_synteny_blocks.schema.json
  inversion-atlas/atlases/inversion/registries/schemas/cross_species_breakpoint_reuse.schema.json

MODIFIED:
  inversion-atlas/atlases/inversion/registries/data/layers.registry.json
    +7 layer entries, +3 _doc separator keys

UNCHANGED:
  All engine code (atlas-core/core/*)
  All page code
  All other atlas registries (operations/files/pages/slots)
  Existing schemas and layers
  data/README.md (canonical layout doc — followed, not modified)
```
