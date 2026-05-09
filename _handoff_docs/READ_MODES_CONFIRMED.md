# Yes — exactly. Two read modes, one registry surface.

You're right. The thing you just described is the design we should
commit to:

> **Some results we pre-bake as JSON because the JSON is itself the
> deliverable. Other results live as raw files in folders, and the
> registry interfaces the folder for us — no useless re-export pass.**

Both modes are already supported by the existing source-kind system.
You don't need a new architecture; you need to be deliberate about
which mode each domain uses. This doc fixes that for v2.

---

## The two modes, mapped to existing source kinds

| Mode | Source kind | When to use | Cost |
|---|---|---|---|
| **A. Pre-baked JSON** | `source: file`, file is a single JSON | The result IS a curated, atlas-shaped artifact (catalogues, manual review queues, candidate cards). Often human-edited. Often small. | One JSON write per result. Fast read, simple cache. |
| **B. Raw-folder interface** | `source: file`, path templated on `{run_id}` etc., format `tsv`/`csv`/`binary`, optional `fields` filter | The result is a tool's native output (ngsRelate, instant_q .qopt, BEAGLE, ANGSD outputs). Lots of files, large, you don't want to re-emit. | Zero. Atlas reads the file the pipeline already wrote. |

Both modes use the **same** layer-entry shape in `layers.registry.json`.
The difference is just `format` and whether the path templates on
identifiers (per-candidate JSON = one file, per-run TSV = path with
`{run_id}`).

### Concrete examples

**Mode A — pre-baked JSON (one per candidate):**
```jsonc
"candidate_breeding_card": {
  "tier": "warm",
  "source": "file",
  "path": "data/candidates/{candidate_id}/breeding_card.json",
  "format": "json",
  "schema": "schemas/candidate_breeding_card.schema.json"
}
```

**Mode B — raw folder interface (one ngsRelate run = one folder):**
```jsonc
"cohort_relatedness_ngsrelate": {
  "tier": "warm",
  "source": "file",
  "path": "data/relatedness/ngsrelate/{run_id}/relatedness.tsv",
  "format": "tsv",
  "schema": "schemas/relatedness_ngsrelate.schema.json",
  "fields": null
}
```

The atlas asks once for `cohort_relatedness_ngsrelate` with
`{run_id: "broodstock_qc_pass_v1"}`, the resolver fetches the TSV,
parses it, caches it warm, returns rows. **No JSON re-export pass
ever happens.** That's the cost saving you correctly identified.

---

## What lives in `atlas-core/toolkit_registries/`

This is the part where I want to be precise, because your phrasing
("we will have the full stuff with all schemas and reg$ and apis and
everything right?") is *almost* right but conflates two things that
should stay separate.

### What's already in `atlas-core/toolkit_registries/` today

```
atlas-core/toolkit_registries/
├── DATABASE_DESIGN.md     ← architectural rationale
├── API_CHEATSHEET.md      ← R/Python/bash usage examples
├── HOW_TO_USE.md          ← entry doc
├── SPEC_DEFERRED.md       ← future work
├── schemas/               ← 45 JSON schemas (4 table + 41 evidence-block)
├── api/
│   ├── R/                 ← R bindings: reg$samples, reg$evidence, reg$results, reg$compute
│   ├── python/            ← Python bindings (atomic reads + Tier-2 writes)
│   └── bash/              ← bash bindings (SLURM gates + path resolution)
├── data/                  ← seed data: sample_registry/groups/, etc.
└── tests/                 ← R + Python tests
```

This **is** the "full stuff with all schemas and APIs." It's
complete, recovered from the toolkit zip, vendored into atlas-core.

### What `reg$` means here

Inside `atlas-core/toolkit_registries/api/R/` — the `reg$` object is
**the R variable** that R scripts use:

```r
source("atlas-core/toolkit_registries/api/R/registry_loader.R")
reg$samples$get_groups_for_candidate("LG28_INV_001")
reg$evidence$write_block(cid, "mendelian_inheritance", payload)
reg$results$ask_what_for_candidate(cid)
```

**It is not a browser object.** It exists in R memory when you
`source()` it. It writes to and reads from the `data/` directory next
to it. This is the thing that already works.

### So your mental picture is right, with one rename

Your sentence:

> "We will have the full stuff with all schemas and reg$ and apis and
> everything right? So we can just easily interface it and also put
> our analysis results in any folder like and just have some master
> config pointing to it?"

is correct **if we read it as two complementary statements**:

1. **The pipeline side (`reg$`, R/Python/bash bindings):** writes
   raw results into structured folders under `data/`. ngsRelate runs
   leave their TSVs there. instant_q leaves Q-matrices. ANGSD leaves
   `.beagle.gz`. The toolkit registers these with provenance in
   `results_registry/manifest.tsv` so the pipeline can find them
   later.

2. **The atlas side (`registry.resolve(...)` in the browser):** reads
   those same folders through layer entries. The "master config
   pointing to it" is `atlases/inversion/registries/data/layers.registry.json`
   — that file IS the master config. Each entry says: name, path
   template, format, schema, tier. Pages call
   `registry.resolve('cohort_relatedness_ngsrelate', { run_id })`
   and the resolver does the rest.

The toolkit registries are the producer's lens. The resolver-registry
is the consumer's lens. They share the same files on disk.

---

## When to pick mode A vs mode B

A simple rule, not a guess:

> **Mode B (raw folder interface) when the pipeline already writes
> the file in a tool-native format and the atlas only needs to read
> it. Mode A (pre-baked JSON) when the result is curated, atlas-shaped,
> and meant to be human-readable or human-edited.**

Applied to current and future domains:

| Domain | Today's storage | Mode | Why |
|---|---|---|---|
| ngsRelate | tool-native TSV in folder | **B** | exactly your case — no JSON re-export |
| instant_q Q matrices | `.qopt` numeric files | **B** | server reads them via `/api/ancestry/groupwise_q`, no re-export |
| BEAGLE dosage | binary `.beagle.gz` | **B** | server reads chunked, no re-export |
| ANGSD `-doHWE` HoverE | server-cached, on-demand | **B** (operation-backed, not file) | popstats_server computes |
| Inversion candidate cards | curated JSON, hand-edited | **A** | reviewers edit these |
| Catalogues (`candidate_final_class`) | curated JSON | **A** | manuscript-facing |
| Manual review queue | session JSON, browser writes | **A** | UI artifact |
| Mendelian inheritance results | computed by browser, written back | **A** | matches the structured-block pattern in toolkit |
| KING / hap-IBD / pyrho | tool-native (when wired) | **B** | same logic as ngsRelate |
| local PCA outputs (lostruct etc.) | mixed: TSV per window + curated band JSONs | **B for raw, A for bands** | the band JSONs are what the atlas renders; the raw window TSVs are queried only when drilling down |

The split is honest. **Most large numerical outputs are Mode B —
read raw, no re-export.** Mode A is reserved for curated artifacts.

---

## Why this is better than what you used to do

You said: *"before we loaded JSON one by one... but some results like
ngsRelate its many files in a folder to me it makes no sense to make
a JSON of a file that we already have results."*

You're right, and the architecture already agrees with you. The old
"upload one JSON at a time into the browser" pattern was a
consequence of having no resolver — every file load was a manual
fetch. The resolver-registry replaces that with named layers, and the
layers can point at any format. **TSV-from-folder reads are not a
worse citizen than JSON reads.** Both go through `layer_router.js`
which already handles `format: tsv` with numeric coercion.

The only thing missing for Mode B today is the `fields:` filter —
when an ngsRelate TSV has 19 columns and you only want 5, parsing
all 19 wastes RAM. That's a 10-LOC change to `layer_router.js`. It's
in the v2 spec as part of item 3.

---

## What "master config pointing to it" looks like

Concretely, the master config is **already three files** in the
existing system:

```
inversion-atlas/atlases/inversion/registries/data/
├── layers.registry.json       ← named layers + paths + schemas + tiers
├── operations.registry.json   ← named server endpoints
├── files.registry.json        ← raw file scopes (per-chrom, per-candidate, etc.)
├── pages.registry.json        ← what each page needs
└── slots.registry.json        ← UI state slots
```

Adding a new ngsRelate-style domain is a one-row edit to
`layers.registry.json`. Adding a new pre-baked JSON catalogue is also
a one-row edit to the same file. The "master config" you're picturing
is `layers.registry.json`. It's already the central pointer table.

When `analysis/mendelian_inheritance.js` is written, it adds **two**
rows: one for reading inputs (relatedness layer in Mode B) and one
for writing output (Mendelian block in Mode A, with `writable: true`).
That's the entire wiring change for the new analysis. No new files,
no new architecture.

---

## Confirming your intuition in one sentence

> **The atlas can interface raw folders directly through the resolver
> (Mode B) and pre-bake curated JSON when that's the right artifact
> (Mode A). Both modes use the same layer-entry mechanism in
> `layers.registry.json`. Toolkit registries (`reg$` in R) sit on the
> producer side; the resolver-registry sits on the consumer side; they
> share the files on disk. We don't re-export raw tool output as JSON
> just to read it.**

That's the design. Nothing about it changed in this last back-and-forth
— it's just been made explicit. SPEC_registry_v2 is consistent with
this. The only thing the spec adds on top is the `fields` filter (so
Mode B doesn't waste RAM on unused columns) and the `Registry.write`
method (so Mode A pre-baked JSONs can be written back from analysis
modules).

---

## What I'd actually do if you say "go"

Two things, both small and immediately useful:

1. **Add a one-page note to `atlas-core/docs/`** — call it
   `READ_MODES.md` or fold it into the eventual `DATA_DOMAINS.md` —
   that documents Mode A vs Mode B with the rule and the table above.
   This prevents future chats from second-guessing whether to
   re-export ngsRelate output as JSON.

2. **Confirm the path** for ngsRelate output on LANTA. Once I know
   the real path, the layer entry takes 5 minutes. The schema takes
   another 30 minutes once I know the column set you actually run
   ngsRelate with (default columns vs `-l 1`-extended columns).

After those two, the next session can land item 3 (relatedness
schema + layer entry) end-to-end as a working example of Mode B,
which then unblocks `analysis/mendelian_inheritance.js`.

The candidate-versioning piece (item 1) is a separate session, but
it doesn't block Mode B. They can land in either order.
