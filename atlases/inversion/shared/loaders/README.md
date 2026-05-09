# Tool loaders — the activate/extract pattern

This directory is where each external tool's output gets wired into
the atlas. The pattern was established 2026-05-07 (chat 39 cont.,
post-step22 design conversation). See AUDIT_LOG.md for the full
context.

## The rule

**Each tool gets at minimum two schemas:**

- An **activate-schema** (`registries/producers/<producer>.activate.json`)
  describing what the producer needs to be invoked: input paths,
  parameters, sample subsets.
- An **extract-schema** (`registries/schemas/<artifact>_v1.schema.json`)
  describing what the producer emits: a self-describing artifact
  with envelope `{ schema, produced_by, inputs, samples, <data> }`.

Multiple producers can share one extract-schema. Example: the .qopt
loader (this directory) and a future server-side ancestry runner both
emit `ancestry_global_q_v1`. They have different activate-schemas
(different inputs needed) but identical extract-schemas (same artifact
shape downstream).

## Why

Raw tool outputs (`.qopt`, `.res`, `.beagle.gz`, `.fai`, ...) are
just numbers. Their meaning lives in folder names, sidecar files,
slurm logs, and the analyst's head. The loader translates that into
a self-describing JSON. After the loader, **no other code in the
project needs to know the tool's conventions** — sample identity,
parameters, provenance all travel with the artifact.

## The worked example

`qopt_loader.js` reads NGSadmix's `.qopt` output (headerless
whitespace-separated) plus its sidecar `samples.txt` and emits an
`ancestry_global_q_v1` artifact. It's the smallest non-trivial case
because:

- The on-disk format is unusual (no header, mixed-whitespace separators).
- Metadata lives in the directory name (K) and a sidecar file (samples).
- The same artifact shape is also producible by a server-side run
  (the conditional-ancestry case), demonstrating the one-extract
  many-activates property.

## Template for the next tool

For each new tool you wire (e.g. `.res` from ngsRelate, `.fopt`,
KING `.kin`, pyrho), follow this pattern:

1. **Inspect the raw file.** Get a real example. Note the format
   quirks (header? separator? comment lines? missing-value sentinels?
   sidecar files?).

2. **Write the loader.** Put it here at
   `shared/loaders/<tool>_loader.js`. Export one function that takes
   `{paths, params, fetcher}` and returns the self-describing
   artifact. Cross-check inputs (row counts, K, sample counts).
   Throw early on mismatch with informative messages.

3. **Write the extract-schema.** Put it at
   `registries/schemas/<artifact>_v1.schema.json`. Describe the
   envelope: `schema`, `produced_by` (tool/version/params),
   `inputs`, `samples` (or whatever ID axis), and the data field(s).
   Mark `additionalProperties: true` on `produced_by.params` and
   `inputs` so different producers can stuff producer-specific
   metadata.

4. **Write the activate-schema.** Put it at
   `registries/producers/<producer>.activate.json`. Describe the
   inputs needed to invoke the loader. Include a `producer` block
   declaring the loader's module path, function name, and what it
   `emits`. Add `_examples` for common invocations.

5. **Write a smoke test.** At `tests/smoke_<tool>_loader.mjs`. Use a
   mock fetcher (no real HTTP). Cover happy path + cross-check
   firings + missing-input validation. Aim for ~25-40 assertions.

6. **Optional: wire into `layers.registry.json`.** If the artifact
   is consumed by a page via `registry.resolve(...)`, add a layer
   entry pointing at the loader as `source: analysis` (or extend
   the source enum in a future round to recognise `loader` as its
   own kind).

## What this is NOT

- **Not a workflow runner.** Snakemake / Nextflow / dvc are static
  DAGs; this is interactive analysis where the next step depends on
  the previous result. Loaders just *load* — they don't *run* the
  upstream tool. Running NGSadmix happens on the cluster, manually,
  and produces files this loader then reads.
- **Not a generic data-frame layer.** The pattern is per-tool, not
  per-shape. Each loader knows its tool's conventions; the substrate
  is just JSON.
- **Not validation-first.** Schema content is documentation of what
  the loader produces, not pre-flight validation. The loader's
  cross-checks (row counts, K, etc.) are the real safety net;
  schemas are auxiliary.

## Local-only assumption

Per Quentin's design directive 2026-05-07: all I/O is local. The
fetcher abstraction in each loader exists primarily so tests can
inject mock content; in production it wraps `fetch()` against the
dev server serving the data folder. No HTTP across networks; no
cluster round-trips from the browser.

## Provenance

This pattern was designed in conversation between Quentin Andres
and Claude (Anthropic) on 2026-05-07, immediately after the
migration round closed (21/21 pages migrated, 1224/1224 tests
passing). The audit pass at `handoff/REGISTRY_AUDIT_2026-05-07_pre_v2_design.md`
established that the substrate (atlas-core engine + four-registry
system) was already 70-80% built. This pattern fills one of the
identified gaps (Gap A, row-shaped tool outputs) and establishes the
template for filling more.
