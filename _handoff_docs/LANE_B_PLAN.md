# Lane B — registry plumbing, high-level plan

**Status: planning, no code yet.** This doc is for review before any
schema gets written or any layer entry gets edited. The point is to
agree on shape, location, and ownership boundaries so the
implementation chats don't reinvent things.

Three plumbing pieces, in dependency order:

1. **Candidate versioning** — make v1/v2/v3-of-the-same-lineage a
   first-class entity in the toolkit + a routable resource in the
   resolver-registry.
2. **Relatedness layer wrapper** — make the ngsRelate folder
   plug-and-play: file discovery, schema, parsed-rows access, columns
   selection. Nothing analysis-specific.
3. **Browser → toolkit write path + transitive invalidation** — let
   `analysis/mendelian_inheritance.js` save its intermediate result
   back to the canonical evidence registry, and make sure dependent
   cache entries get evicted when candidate boundaries change.

Each is described as: what entity, where it lives, what reads it,
what writes it, and what's the smallest first cut.

---

## Piece 1 — Candidate versioning

### What's the entity

A **candidate version** is a specific definition (boundaries, source
methods, active callset) of one biological candidate at one moment.

A **candidate lineage** is the stable biological hypothesis, identified
by `candidate_id`. It owns multiple versions over time and points at
exactly one as `active_version_id`.

A **candidate split** is when long-range / theta / GHSL evidence shows
a candidate is actually two independent systems. This is **not** a
new version; it's a new candidate (or two), with the original
candidate's `status` set to `"split"` and the children's `parent_id`
pointing at the original. The existing `parent_id` field already
supports this.

So three operations:

| Operation                  | Effect on lineage              | Effect on candidate row(s)                           |
|----------------------------|--------------------------------|------------------------------------------------------|
| Boundary refinement        | New version within same lineage | No change to candidate row; new row in versions table |
| Switch active version      | Pointer move                    | Update `active_version_id` on candidate row          |
| Split into child candidates | Lineage becomes deprecated      | Mark parent `status="split"`; create child candidates with `parent_id=parent_cid` |

This split-vs-version distinction is the key design decision. It
keeps `candidate_intervals` rows stable as biological-hypothesis
identifiers and pushes all the boundary churn into a separate table.

### Where it lives (toolkit side)

Two new things in `interval_registry/`:

```
interval_registry/
  candidate_intervals.tsv          (existing — minimal change)
  candidate_versions.tsv           (NEW)
  candidate_active_version.tsv     (NEW; pointer file)
```

**`candidate_versions.tsv`** rows, schema fields:
- `candidate_id` — FK into `candidate_intervals.candidate_id`
- `version_id` — string, e.g. `v1_localPCA_initial`, `v2_theta_refined`
- `chrom`, `start_bp`, `end_bp` — version-specific boundaries
- `source_methods` — array, e.g. `["localPCA"]`, `["localPCA","thetaPi"]`
- `parent_version_id` — nullable, FK to a previous version_id within
  the same candidate_id (so version history is itself a DAG)
- `active_callset_id` — string, e.g. `localPCA_K3_v1`, references a
  karyotype callset (callsets need their own naming convention but
  the table that owns them can come later — for now, a string)
- `status` — enum: `initial`, `refined`, `final`, `deprecated`
- `created_at` — timestamp, doubles as `version` for stale detection
  (mirrors `sample_groups.created`)
- `dependency_hash` — short hash of `{chrom, start_bp, end_bp,
  active_callset_id, source_methods}` so downstream blocks can
  detect "the version I was computed against has changed."
- `notes` — free text, allowed but not analysis-relevant

**`candidate_active_version.tsv`** rows:
- `candidate_id` — PK, FK into `candidate_intervals`
- `active_version_id` — FK into `candidate_versions`
- `set_at` — when this version became active

Two tables not one because:
- `candidate_versions` is **append-only**. Old versions don't get
  deleted; they get a `status="deprecated"` if needed.
- `candidate_active_version` is **rewrite-in-place**. Single source of
  truth for "what's current," safe to update without losing history.

### Minimal change to `candidate_intervals.tsv`

Add one optional field: `status` ∈ `{active, split, deprecated}`,
default `active`. Nothing else changes. The `chrom/start_bp/end_bp`
fields on `candidate_intervals` continue to mean "the canonical
boundaries for this lineage" but in practice every reader should
prefer the active-version boundaries. We keep them in the candidate
row for backward compatibility with any existing scripts that read
`candidate_intervals.tsv` directly; they get a stable answer (the
active version's boundaries, mirrored). That's a write-time job: the
"set active version" operation copies the version's boundaries into
the candidate row.

Why mirror instead of breaking the field: the existing manuscript
pipeline has scripts that read `candidate_intervals` rows. Removing
the boundary fields would break them. Mirroring is one line of code
on write and keeps every reader working.

### Where it lives (resolver-registry / browser side)

Three new layer entries in `layers.registry.json`:

- `candidate_versions` — `source: file`, scope `per_candidate`, returns
  the array of versions for a given `candidate_id`. Tier `warm`.
- `candidate_active_version` — `source: file`, scope `per_candidate`,
  returns the single active-version object for a given `candidate_id`.
  Tier `warm`. Preload on `candidate_change`.
- `candidate_callset_for_version` — `source: file`, returns the
  karyotype assignments for `(candidate_id, version_id)`. Tier `warm`.

All three are file-backed reads from disk. No new operations. No new
server endpoints.

### Smallest first cut

1. Schema files: `candidate_version.schema.json` (the row),
   `candidate_active_version.schema.json` (the pointer).
2. Two empty TSV files seeded with the headers.
3. **One** existing candidate (e.g. `LG28_INV_001`) gets a `v1` row
   in `candidate_versions` and a pointer row, hand-written. This is
   the migration baseline.
4. R bindings in `interval_registry.R` (file doesn't exist yet — to
   be created paired with the existing `sample_registry.R`):
   `reg$intervals$add_version(cid, payload)`,
   `reg$intervals$set_active_version(cid, vid)`,
   `reg$intervals$get_active_version(cid)`.
5. Three layer entries in `layers.registry.json` so the browser can
   read them.
6. Done. No browser-side write yet (Piece 3 handles that).

### Open question worth raising before coding

Should `active_callset_id` be a string field on `candidate_versions`,
or should there be a separate `candidate_callsets.tsv` table FK'd from
versions? The proposal had it as just a string. That's fine for v1.
But a separate table becomes useful when:
- A single callset is re-used across multiple versions (currently
  unlikely, but possible if only boundaries change).
- The callset itself has a schema (sample → karyotype mapping) that
  benefits from validation.

**Recommendation for v1:** string field, defer the callsets table to
a later iteration. Decide when an actual conflict shows up.

---

## Piece 2 — Relatedness layer wrapper

### What's the entity

A **relatedness result** is one tool's output for one cohort: ngsRelate
2-column-pair table, KING IBD segment table, hap-IBD output, etc. The
file format and column set differ per tool. The atlas should be able
to pick a tool by name and a column subset.

### Where it lives (toolkit side)

This already largely exists. ngsRelate output files live somewhere on
LANTA (path needs confirming with you — typical convention would be
`results_registry/relatedness/ngsrelate/<run_id>/output.tsv`). What's
missing is:

- A **schema** for the file shape (currently a placeholder in
  `inversion-atlas/atlases/inversion/registries/schemas/relatedness.schema.json`).
- A **reader/parser**, on whichever side reads it. If pages need it
  in the browser, the parser is the resolver-registry's `format: tsv`
  + numeric coercion (already implemented in `layer_router.js`). If
  only the manuscript pipeline reads it, the parser is the toolkit's
  `data.table::fread`.

### Where it lives (resolver-registry / browser side)

One layer entry in `layers.registry.json`:

```
relatedness_ngsrelate:
  tier: warm
  source: file
  path: data/relatedness/ngsrelate/{run_id}/relatedness.tsv
  format: tsv
  schema: schemas/relatedness_ngsrelate.schema.json
  scope: cohort   (i.e. one per cohort, not per-candidate)
```

The path templates on `{run_id}` because we may have multiple
ngsRelate runs over time (different parameters, different sample
sets). Default `run_id` lives in atlas state.

### How it gets used

In `analysis/mendelian_inheritance.js`:

```js
const rel = await registry.resolve('relatedness_ngsrelate', {
  run_id: 'broodstock_qc_pass_v1',
  // optional: columns: ['sample1', 'sample2', 'theta', 'IBS0', 'kinship']
});
// rel is an array of row objects, numeric columns auto-coerced.
```

That's the entire wrapper. Not a `reg$.relatedness.getResult(...)`
facade — just a layer entry the analysis module reads through the
existing `registry.resolve(...)`.

### What about column subset?

The proposal asked for `columns: [...]` filtering. The resolver
currently returns the full parsed file. Two options:

(a) **Add a `fields` filter at the layer-entry level** — the
    `layer_entry` schema already has a `fields` array. Make
    `layer_router.js` honor it: parse the file, return only the named
    columns. ~10 LOC change.
(b) **Filter in the analysis module** — `rel.map(r => ({sample1: r.sample1, ...}))`.
    Zero change to engine.

**Recommendation:** (a), because relatedness files can be large (226
samples × pairs = ~25k rows × 12+ columns) and the analysis module
doesn't need most columns. Cheap optimization, keeps the analysis
module clean.

### Smallest first cut

1. Confirm the actual ngsRelate output path and column set with you.
2. Replace the placeholder `relatedness.schema.json` with a real
   schema for ngsRelate columns.
3. Add the `relatedness_ngsrelate` layer entry.
4. Add the `fields` filter to `layer_router.js` (~10 LOC).
5. Done. Reading a relatedness file from inside an analysis module
   is now one `await registry.resolve(...)` call.

KING / hap-IBD / etc. each get their own layer entry when they're
actually wired. Don't pre-build slots that no one fills.

---

## Piece 3 — Browser → toolkit write path + transitive invalidation

### What's the entity

When `analysis/mendelian_inheritance.js` finishes computing, it has a
result object. That object has to land in
`evidence_registry/per_candidate/<cid>/structured/mendelian_inheritance.<version_id>.json`
where every other consumer (manuscript R scripts, other atlas pages,
reviewers) can find it.

### Where it lives (toolkit side)

Already designed. The `evidence_registry/per_candidate/<cid>/structured/`
directory is the right home, and the toolkit already has 41 schemas
under `structured_block_schemas/`. We just add a 42nd:
`mendelian_inheritance.schema.json`.

The schema mirrors the proposal's payload but reuses existing toolkit
provenance conventions (`config_hash` not `dependency_hash`,
`who_1.group_version` for sample-set identity, etc.). Filename is
suffixed with `version_id` to support per-version outputs:
`mendelian_inheritance.v2_theta_refined.json`.

### Where it lives (server side)

**Already exists.** `popstats_server.py:1365` has:

```
@app.post("/file/{path:path}")
async def file_post(path: str, request: Request) -> Dict[str, Any]:
    target = _safe_project_path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(body)
    return {"ok": True, "path": path, "bytes": len(body)}
```

So the transport is solved. The browser POSTs a JSON body to
`/file/evidence_registry/per_candidate/LG28_INV_001/structured/mendelian_inheritance.v2_theta_refined.json`
and it lands.

What's missing on the browser side: a wrapper so analysis modules
don't reach into `fetch(...)` directly.

### Where it lives (resolver-registry side)

Two additions:

**A. `Registry.write(key, args, payload)` method** — ~50 LOC. Looks
up the key in `layers.registry.json`, refuses unless the layer has
`writable: true` (the meta-schema already supports this flag for file
entries; extend to layer entries), templates the path with `args`,
POSTs to `/file/<path>`, returns the server's `{ok, path, bytes}`
response. On success, **invalidates its own cache entry** so the next
`resolve(...)` re-reads from disk.

**B. Transitive invalidation on `candidate_change`** — when
`AtlasState.shared.activeCandidate` changes (or a candidate version
gets switched), evict every cache entry whose key contains the
candidate id. ~30 LOC in `Registry.invalidate`. Implementation:
walk `cache.hot.keys()` and `cache.warm.keys()`, drop entries
matching `cache_key.includes(\`:${candidate_id}:\`)`.

The transitive piece is the smaller of the two but matters more for
correctness. Without it, refining a candidate leaves stale Mendelian
results in cache until the user hard-refreshes.

### How analysis modules use it

In `analysis/mendelian_inheritance.js`:

```js
const result = computeMendelianFromInputs({...});

await registry.write('mendelian_inheritance_block', {
  candidate_id: candidate.id,
  version_id: activeVersion.version_id,
}, result);
```

The layer entry decides where on disk that lands. The analysis module
doesn't care.

### Smallest first cut

1. `mendelian_inheritance.schema.json` in toolkit
   `structured_block_schemas/`.
2. `mendelian_inheritance_block` layer entry in
   `layers.registry.json` with `writable: true`, scope
   `per_candidate`, path templated on `{candidate_id, version_id}`.
3. `Registry.write` method (~50 LOC).
4. `Registry.invalidate` extension for candidate-prefix matching
   (~30 LOC).
5. Wire `AtlasState.setActiveCandidate` to call
   `Registry.invalidateAllForCandidate(oldCandidateId)` when the
   active candidate changes.
6. Done. One pattern, applies to every future analysis module that
   needs to write results.

### Open question worth raising before coding

The server's `POST /file/{path:path}` accepts any path under the
project root. That's fine on a developer's tunneled-only LANTA
session. If the same server is ever exposed beyond your laptop, this
becomes a security hole: the browser can write arbitrary files. Two
options:

(a) **Path allowlist in the server** — restrict POST writes to paths
    matching `evidence_registry/per_candidate/.+/structured/.+\.json$`
    or similar. ~20 LOC in `popstats_server.py`.
(b) **Schema validation server-side** — the server validates the
    posted body against the structured-block schema before writing.
    Slower but stricter.

**Recommendation:** (a) for v1. Don't post-validate in the server;
the browser already validates against the schema before posting (the
analysis module is in control of its own output shape). Keep server
write semantics simple but path-restricted.

---

## Order, effort, and blocking relationships

```
Piece 1 (candidate versioning)
  ├── Piece 2 (relatedness wrapper)         ← parallel, independent
  └── Piece 3 (write path + invalidation)
        │
        └── analysis/mendelian_inheritance.js orchestrator
                │
                └── Mendelian review page mount wrapper
```

| Piece | Sessions | Blocks |
|---|---|---|
| 1 | 2 | 3 partially (versioned filenames), `mendelian_inheritance.js` fully |
| 2 | 1 | `mendelian_inheritance.js` (relatedness input) |
| 3 | 1 | `mendelian_inheritance.js` (output write) |
| `analysis/mendelian_inheritance.js` | 1-2 | the review page |
| Mendelian review page wiring | 1 | nothing |

So six sessions total, with pieces 1 + 2 parallelizable. Piece 3 can
be split: the `Registry.write` half is independent of versioning;
the transitive-invalidation half just needs the activeCandidate event
which is already wired.

---

## What I'd ask you before writing the first schema

Three questions, each cheap:

1. **Where do ngsRelate output files live on LANTA right now?** I'll
   write the `relatedness.schema.json` against the actual columns,
   not a guess. If they don't exist yet and we're seeding from a
   mock, say so and I'll mock with the canonical ngsRelate columns
   (`a, b, theta, IBS0, kinship, ...`).

2. **For candidate versioning, do we need a separate callsets table
   in v1, or is `active_callset_id` as a string field enough?** I'd
   default to "string field, defer the table" unless you have a
   case where one callset is shared across versions.

3. **For the write path, are you OK with the server-side path
   allowlist (option (a) above), or do you want schema validation
   server-side from the start (option (b))?** Default: allowlist
   only, browser validates before sending.

If you give one-line answers to those three, the schema-design
session is unblocked.

---

## What's NOT in this plan

- No `reg$.X` global object. The naming-collision argument from the
  previous critique stands. If a domain facade wants to exist later,
  it's syntactic sugar over `registry.resolve(...)` — not a peer of
  it. Build last, if at all.
- No `04_intermediate/` / `05_catalogues/` folder structure. Use
  `evidence_registry/per_candidate/<cid>/structured/` (existing) and
  `results_registry/manifest.tsv` (existing) for the two roles.
- No new "central librarian" architecture. The toolkit registries +
  resolver-registry + analysis modules + pages are already the four
  layers. We're adding entities (versions, callsets, mendelian
  blocks) and one method (`Registry.write`). No new layer.
- No browser-side discovery of relatedness folders. The atlas knows
  the path template; the discovery is server-side or pipeline-side,
  not in the browser.

The architecture stays the same. Three plumbing additions. That's all.
