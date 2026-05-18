# Critique of the registry-upgrade proposal

**Read this before writing any code from the proposal.** I audited the
current state, then evaluated each part of what was proposed. This
document is the result. There is real work in here. There is also
work that already exists, and one structural confusion that, if not
fixed, will produce a third registry layer on top of the two we
already have.

---

## TL;DR

The proposal is **roughly half right**. Specifically:

- ✅ **Candidate versioning + lineage (the v1/v2/v3 + split into 001A/001B
  story)** — this is a real gap. The toolkit's `candidate_interval`
  schema has `parent_id` but no version history. Worth implementing.
- ✅ **Dependency-hash + stale detection for derived analyses** — this
  already exists for *manuscript-pipeline* outputs (`provenance.config_hash`
  + `who_*.group_version` in `result_row.schema.json`), but does NOT
  exist for *browser-side analysis caching*. That's the real gap.
- ✅ **`analysis/mendelian_inheritance.js` as a separate module** — yes,
  this is the right home for it. Maps cleanly onto the existing
  `analysis/` directory next to `analysis/mendelian.js`.
- ⚠️ **`reg$` as a global "domain librarian" object in the browser** —
  partially right idea, badly named. The name `reg$` *already means
  something else* in this project (it's the R object in the toolkit
  pipeline). Reusing it in the browser will create a third registry
  layer and a naming collision in the docs.
- ❌ **"Wrap toolkit_registries cleanly" / "expose `reg$` globally"** —
  this misreads the architecture. The toolkit registries are *server-
  side R/Python files on LANTA*. The browser doesn't and shouldn't
  wrap them. Anything the browser sees from the toolkit registries
  comes through `popstats_server.py`.
- ❌ **`reg$.relatedness.getResult(...)` etc. as new browser API** — this
  duplicates the existing `registry.resolve('relatedness_xxx', args)`
  which is what the resolver-registry already does. Adding a parallel
  API on top is a third layer with no new capability.

The proposal is essentially saying: "the resolver-registry doesn't
have domain-specific facade methods; let's add them." That's a
defensible move *as a thin facade layer*, but the way it's framed —
as if `reg$` is something separate from the existing registry —
suggests the author hasn't read `atlas-core/docs/TWO_REGISTRIES.md`
and doesn't realize:

1. There already are TWO registries (`TWO_REGISTRIES.md`).
2. The R-side `reg$` is one of them.
3. The thing being proposed is, accurately described, "domain-facade
   helpers on top of the JS resolver-registry" — which is just one
   small file.

---

## What the project already has

| Layer | Where | What it does |
|---|---|---|
| **Toolkit registries** | `atlas-core/toolkit_registries/` (mounted from LANTA) | Server-side R/Python/bash 4-table database. Has `reg$samples`, `reg$intervals`, `reg$evidence`, `reg$results` *in R*. Has `result_row.schema.json` with `provenance.config_hash` + `who.group_version` for stale detection. Has `candidate_interval.schema.json` with `parent_id` for nesting. |
| **Resolver-registry** | `atlas-core/core/registry_core.js` + per-atlas `registries/data/*.json` | Browser-side runtime data router. `resolve(key, args)` returns hot/warm/cold tiered values. Knows about layers, operations, files, pages, slots. Biology-blind. |
| **Analysis modules** | `inversion-atlas/atlases/inversion/analysis/*.js` | Browser-side compute. Currently has only `mendelian.js` (one file). |
| **Per-atlas schemas** | `inversion-atlas/atlases/inversion/registries/schemas/` | 18 schemas including `relatedness.schema.json`, `mendelian_test.schema.json`, `karyotype_assignment.schema.json`, `arrangement_calls.schema.json`. |

So when the proposal says "we already have an old pipeline-side
registry called `toolkit_registries/` and a newer runtime/browser
registry layer" — that's correct. When it says "we need to wrap it
cleanly" with `reg$.relatedness`, `reg$.inversion`, etc. — that's
where it goes off the rails, because:

- The existing R-side `reg$` already has `reg$samples`, `reg$evidence`,
  `reg$results`, `reg$compute`. Same name, same shelves-of-domains
  pattern. Three of the proposed shelves (`reg$.samples`,
  `reg$.relatedness`-as-a-results-shelf, `reg$.inversion`-as-an-
  intervals-shelf) are **conceptually duplicates of what already
  exists in R**, just expressed in JavaScript.
- Calling the new JS object `reg$` will mean two completely different
  things in the project share the same name. `TWO_REGISTRIES.md`
  exists exactly because that confusion already happened once.

---

## Part-by-part evaluation

### Part 1: "Mental model: toolkit_registries / registry_core.js / reg$"

**Verdict: ⚠️ structurally confused.**

The proposal sets up three layers:
1. `toolkit_registries/` (durable, pipeline-side)
2. `core/registry_core.js` (runtime resolver, biology-blind)
3. `reg$` (global "domain librarian")

Layers 1 and 2 already exist and are correctly described. Layer 3
is described as "global Atlas central librarian" — but it's not
clear whether this is meant to be:

(a) A thin **facade** on top of `registry_core.js` that exposes
    `reg$.relatedness.getResult(...)` as sugar for
    `registry.resolve('relatedness_xxx', args)`, or
(b) A new **caching/storage layer** parallel to `registry_core.js`
    that has its own state, or
(c) A **bridge** that talks to the toolkit registries on LANTA.

The proposed API examples (`reg$.inversion.saveIntermediate(...)`,
`reg$.inversion.promoteToCatalogue(...)`) sound like (b) — a new
storage layer with its own write path. That would be a third
registry, which we should not build.

**The right read:** what's actually being asked for is (a) — a thin
facade. Specifically: the resolver-registry returns by *layer name*
(`fst_dxy_thetapi_groupwise`, `candidate_boundaries`, etc.); the
proposal wants it grouped *by domain* (`reg$.inversion.getCandidate(id)`,
`reg$.relatedness.getResult(name, opts)`). That's a 200-line file,
not a new architecture.

**Recommendation:** call it `domain_facade.js`, not `reg$`. Examples:
```js
// inversion-atlas/atlases/inversion/analysis/domain_facade.js
import { Registry } from '../../../atlas-core/core/registry_core.js';

export function makeDomainFacade(registry) {
  return {
    relatedness: {
      getResult: (name, opts) => registry.resolve(`relatedness_${name}`, opts),
      listResults: () => registry.listLayersByPrefix('relatedness_'),
      getSchema: (name) => registry.getSchema(`relatedness_${name}`),
    },
    inversion: {
      getCandidate: (id) => registry.resolve('candidate_boundaries', { candidate_id: id }),
      getActiveVersion: (id) => /* see Part 4 */,
      saveIntermediate: (id, payload) => /* see Part 5 */,
      // etc.
    },
    samples: {
      getResult: (name, opts) => registry.resolve(`samples_${name}`, opts),
    },
  };
}
```

That's the whole "reg$ upgrade." It's a facade over the existing
resolver. No new state, no new caching, no new files-on-disk.

---

### Part 2: "reg$.relatedness should be data access only, not analysis"

**Verdict: ✅ correct in principle, ❌ named wrong.**

The principle — **registry = data access, analysis = scientific
filtering, pages = UI** — is exactly the boundary the existing
codebase already enforces:

- `core/registry_core.js` is biology-blind. ✓
- `analysis/mendelian.js` exists separately. ✓
- Pages call `await registry.resolve(...)` not `fetch(...)`. ✓ (per the
  page-migration recipe).

So the *boundary* the proposal advocates is the boundary that's
already designed in. The proposal is writing it down again.

The bad part: naming the data-access shelf `reg$.relatedness` when
the existing layer name is `relatedness` (per
`inversion-atlas/atlases/inversion/registries/schemas/relatedness.schema.json`)
and the registry is already accessed as
`registry.resolve('relatedness', args)`. The proposed API
`reg$.relatedness.getResult('ngsrelate', { schema: 'ngsrelate_v1', columns: [...] })`
is a 1-line wrapper around `registry.resolve('relatedness', { tool: 'ngsrelate', columns: [...] })`.

**Recommendation:** keep the wrapper as syntactic sugar (Part 1 facade),
but do NOT introduce ngsRelate-specific API surface like
`reg$.relatedness.getResult('ngsrelate', ...)`. The *layer name* is
`relatedness`. The *tool* and *schema* are arguments. If we
encode ngsRelate into the API path, then KING / PLINK / hap-IBD
relatedness will need parallel `getResult('king', ...)` methods,
which is the path to API bloat.

Better: `domain.relatedness.get({ tool: 'ngsrelate', columns: [...] })`
and let the operation/layer registry route by tool internally.

---

### Part 3: "analysis/mendelian_inheritance.js"

**Verdict: ✅ yes, do this.**

Currently `inversion-atlas/atlases/inversion/analysis/` has only
`mendelian.js`. The proposal correctly identifies that:

- Mendelian inheritance is QC, not data access.
- It depends on candidate version, callset, relatedness data, sample
  metadata, and configurable thresholds.
- It should `await` clean inputs from the registry and do filtering/
  joining itself.
- It should return a structured result object with provenance fields.

The **return shape** the proposal describes is good and matches the
toolkit's `result_row` provenance pattern:

```
candidate_id, candidate_version_id, callset_id,
relatedness_result_id, sample_set_id, analysis_version,
dependency_hash, status, metrics, per-pair table, warnings
```

This maps almost 1:1 to existing `result_row.schema.json` fields:
`where.candidate_id`, `who_*.group_id` + `group_version`,
`provenance.engine_version`, `provenance.config_hash`. We should
**reuse the existing schema, not invent a new one**.

**Caveat — `mendelian.js` already exists**: before writing
`mendelian_inheritance.js`, read what's in `mendelian.js`. It may
already cover part of this. The proposal doesn't mention this file.

```bash
cat inversion-atlas/atlases/inversion/analysis/mendelian.js
```

If `mendelian.js` is the "compute Mendelian transmission" core math
and the proposal is asking for the candidate-version-aware *wrapper*
around it, then the right move is `mendelian_inheritance.js` =
orchestrator that calls `mendelian.js` for the core math. If
`mendelian.js` is empty/skeletal, then implement directly there.

---

### Part 4: "Candidate versioning"

**Verdict: ✅ this is a real gap. Implement it.**

Current state: `candidate_interval.schema.json` has:
- `candidate_id` (PK)
- `chrom`, `start_bp`, `end_bp`
- `scale` (e.g. '100', '50')
- `parent_id` (for nesting/split)
- No `version_id`, no `active_version_id`, no version history.

What the proposal describes — one biological candidate lineage with
multiple boundary refinements over time — is **not currently
representable in the toolkit registry**. You can split a candidate
(via `parent_id`) but you cannot say "this is candidate LG28_INV_001
v2_theta_refined which supersedes v1_localPCA_initial."

The proposal's data model is sound:

```
candidate_id        → stable biological hypothesis
version_id          → specific definition at a time
active_version_id   → currently used by Atlas pages
parent_version_id   → previous version this was derived from
status              → initial / refined / final / deprecated / split
active_callset_id   → which karyotype callset is bound to this version
```

This is a first-class entity that needs:
- A new schema file: `candidate_version.schema.json`
- A new toolkit registry table or an extension to `interval_registry`
- Resolver-registry layer entries so the browser can fetch versions
- The `analysis/mendelian_inheritance.js` module needs to ask for
  the *active version*, not the candidate.

**Implementation strategy:**

1. **Don't break the existing `candidate_interval.schema.json`** —
   it's the FK target for many existing manuscript-pipeline outputs.
   Add versions as a *child* table rather than retrofitting.
2. **New schema** `candidate_version.schema.json` with FK to
   `candidate_interval.candidate_id`, fields per the proposal's data
   model, plus a `dependency_hash` for change-detection.
3. **Add a `candidate_active_version` pointer file** (single-row TSV
   or per-candidate JSON) that names the currently-active version.
   This is what the atlas reads to decide "which version's
   boundaries / callset do I render?"
4. **Resolver-registry layers**:
   - `candidate_versions(candidate_id)` → list of versions
   - `candidate_active_version(candidate_id)` → one version object
   - `candidate_callset(version_id)` → karyotype calls for this version
5. The split case (`LG28_INV_001` → `LG28_INV_001A` + `LG28_INV_001B`)
   uses the existing `parent_id` field on the *child candidates*, NOT
   on versions. Versions are within-lineage refinement; splits are
   lineage divisions.

This is real architectural work, ~2-3 sessions. Can be done independently
of the page1 migration that's currently in flight.

---

### Part 5: "Where do analysis outputs live? Stale detection? Dependency hash?"

**Verdict: ✅ correct intent, ❌ duplicates existing pipeline mechanism.**

The proposal asks for:
- Folder structure `04_intermediate/inversions/<cid>/<analysis>.<ver>.json`
- `dependency_hash` per output
- `status: current/stale/reviewed/final`
- `reg$.inversion.saveIntermediate` / `getIntermediate` / `promoteToCatalogue`

**Existing mechanism in toolkit:**
- `result_row.schema.json` already has `provenance.config_hash`,
  `provenance.upstream_files`, `who_*.group_version`. These together
  ARE the dependency hash.
- `results_registry/manifest.tsv` is the manifest of all derived
  numerical artifacts with full provenance.
- `evidence_registry/per_candidate/<cid>/structured/<block>.json` is
  the storage location for per-candidate intermediate outputs.

So the proposed:

```
04_intermediate/inversions/LG28_INV_001/mendelian_inheritance.v2_theta_refined.json
```

is, in toolkit terms, just:

```
evidence_registry/per_candidate/LG28_INV_001/structured/mendelian_inheritance.json
```

with provenance fields naming `candidate_version_id` and `callset_id`.
The folder layout is already specified and used by the manuscript
pipeline.

**What's actually missing:**

1. **No structured-block schema for `mendelian_inheritance` yet.** The
   `structured_block_schemas/` directory has 41 schemas but none for
   Mendelian inheritance. **This is the file to write.**
2. **No browser-side write path.** The toolkit registry is written
   from R/Python on LANTA, not from the browser. If we want
   browser-side analysis modules to write intermediate results, we
   need an HTTP endpoint on `popstats_server.py` that calls the
   toolkit's `reg$evidence$write_block(cid, "mendelian_inheritance", data)`.
3. **No version-aware key.** The toolkit's evidence blocks are keyed
   by `candidate_id` but not by `candidate_version_id`. Adding the
   version dimension means either:
   - Filename suffix: `mendelian_inheritance.<version_id>.json`
   - Folder layer: `per_candidate/<cid>/<version_id>/structured/...`
   - Field inside the JSON: `{candidate_version_id: ...}` and an
     append-only log

**Recommendation:** do not invent `04_intermediate/` and
`05_catalogues/` folders. Use the existing
`evidence_registry/per_candidate/<cid>/structured/` location. Add a
`candidate_version_id` field to all derived blocks. The
`promoteToCatalogue` action becomes a manuscript-pipeline step that
reads the current evidence block and writes a final-form output to
`results_registry`.

---

### Part 6: "Pages should be simple — call analysis, render"

**Verdict: ✅ already the design. No work.**

The page-migration recipe (read it: `PAGE_MIGRATION_RECIPE.md`)
explicitly states:

> Pages should not: fetch raw TSV/JSON paths directly, parse files,
> save files manually, duplicate registry logic.
> Pages should: read UI state, call registry/analysis modules,
> render the result.

The example flow the proposal gives for `renderMendelianPage` is
precisely the flow `page_review/boundary_refinement.js` etc. should follow. This
is what `mount(root, atlasState, registry)` is for.

**Recommendation:** when `analysis/mendelian_inheritance.js` is
written, the corresponding page mount wrapper will be ~30 LOC. No
new architecture needed.

---

### Part 7: "Candidate refinement and splitting"

**Verdict: ✅ this is the real architectural question. See Part 4.**

The biological story is correct:
1. Local PCA finds a candidate.
2. θπ / GHSL refines boundaries.
3. Long-range haplotypes may show it's two systems.
4. Mendelian inheritance becomes a model-comparison QC across
   candidate versions.

The proposal correctly notes that **Mendelian inheritance is QC of a
specific (candidate_version, callset) pair**, not of an abstract
candidate. This argues strongly for Part 4 (versioning is real) and
Part 5 (intermediate results are version-keyed).

The "model-comparison QC" framing — running Mendelian on the merged
v1, the refined v2, and the split children, then comparing
contradiction rates — is **a feature of the analysis module**, not
the registry. It's:

```js
const merged   = await computeMendelianInheritance({ candidateId: 'LG28_INV_001', versionId: 'v1' });
const refined  = await computeMendelianInheritance({ candidateId: 'LG28_INV_001', versionId: 'v2' });
const splitA   = await computeMendelianInheritance({ candidateId: 'LG28_INV_001A', versionId: 'v1' });
const splitB   = await computeMendelianInheritance({ candidateId: 'LG28_INV_001B', versionId: 'v1' });

// Compare contradiction rates → which model fits best
```

Three computeMendelian calls, one comparison view. The registry
does not need a `compareMendelianAcrossVersions` method. The page or
analysis-orchestration module does.

---

### Part 8: "Implement in small steps"

**Verdict: ✅ correct workflow, but the order needs adjusting.**

The proposed step list (1-8) is reasonable but two steps reverse
the right order:

- Step 2 ("create global reg$ object") — this is the facade. It
  should come AFTER candidate versioning (step 4) because the facade
  is just sugar over already-existing registry calls; without the
  versioning groundwork, the facade has nothing meaningful to wrap.
- Step 3 ("reg$.relatedness as data access") — should be deferred.
  The current `relatedness.schema.json` is a placeholder; until we
  have real ngsRelate output files in `data/`, building a domain
  facade is premature.

**Recommended order, prioritised against current project state:**

```
1. (already done) Round 2 page1 stub work — DONE.
2. Round 3 page1 body extraction — ALREADY THE NEXT TASK per HANDOFF.
   This is in flight. Don't interrupt.
3. Candidate version schema + toolkit-side data model
   (candidate_version.schema.json + active_version pointer).
4. Browser-side resolver-registry layers for candidate versions.
5. analysis/mendelian_inheritance.js (orchestrator),
   reuses existing analysis/mendelian.js for core math if present.
6. structured_block_schemas/mendelian_inheritance.schema.json
   in the toolkit (NOT a new folder structure).
7. Domain facade (a single ~200 LOC file), if and only if pages start
   to suffer from raw `registry.resolve('layer_name', args)` calls
   being awkward to write. Optional. Don't build pre-emptively.
8. Page wiring for the Mendelian review page.
```

Items 3-6 are independent of page1 round 3 and can be parallelised.

---

## What I would NOT do from the proposal

1. **Do not call the new object `reg$`** — name collision with the
   R-side `reg$` in `toolkit_registries/`. Use `domain` or `atlas$`
   or `registryFacade`.
2. **Do not invent `04_intermediate/` and `05_catalogues/` folders** —
   the toolkit's `evidence_registry/per_candidate/` is the existing
   location for this. Extend, don't fork.
3. **Do not write `reg$.relatedness.getResult('ngsrelate', ...)` API** —
   encode tool name as an argument, not a method. Otherwise we
   commit to per-tool API surface forever.
4. **Do not write `reg$.inversion.saveIntermediate` as a browser-side
   write path** until there's an HTTP endpoint on
   `popstats_server.py` that authorizes and validates the write.
   Browser-side write to LANTA is a real security/integrity decision,
   not a casual API addition.
5. **Do not implement all 8 steps in one chat.** Do step 3 (candidate
   versioning schema) first, get Quentin's review on the data model,
   THEN proceed.

---

## What is genuinely new and worth building

In priority order:

1. **`candidate_version.schema.json` + version-pointer mechanism**
   in the toolkit. Real biological need. ~1 session.
2. **`structured_block_schemas/mendelian_inheritance.schema.json`** in
   the toolkit. ~30 minutes, mechanical work modeled on existing
   schemas like `boundary_refined.schema.json`.
3. **Resolver-registry layer entries** for
   `candidate_active_version`, `candidate_callset_for_version`,
   `mendelian_inheritance_block`. ~1 hour.
4. **`analysis/mendelian_inheritance.js`** orchestrator that pulls
   inputs from resolver-registry, computes, and returns a structured
   result. ~1-2 sessions.
5. **HTTP write endpoint** on `popstats_server.py` for saving
   browser-computed analysis results back into the toolkit's evidence
   registry. ~1 session, requires deciding the auth model.
6. **(Optional) Domain facade** if syntactic sugar is wanted. ~200
   LOC, can wait until pages actually feel cluttered.

---

## What this means for current chat sequence

The HANDOFF I just wrote at the end of round 2 says **next chat = round
3 page1 body extraction**. That hasn't changed. The registry-upgrade
proposal is **NOT in the same lane** as the page migration; it's
parallel work.

If Quentin wants to switch lanes — pause the page migration and start
on candidate versioning — that's fine, but it's a project-level
decision. Worth surfacing explicitly rather than letting "implement
the proposal" drift over the migration work.

If both lanes are active, recommended split:
- **Page migration (this chat sequence)**: continues round 3 →
  page2 → ... per existing recipe.
- **Registry/versioning (a new chat sequence)**: starts with
  `candidate_version.schema.json` design review, separate from page
  work.

I would NOT recommend doing both in the same chat. They touch
different files, need different audits, and the contexts collide.

---

## Direct answer to "is this aligned or nonsense?"

**Aligned (real needs, build these):**
- Candidate versioning + lineage data model.
- Mendelian inheritance as a candidate-version-aware QC analysis module.
- Dependency-hash + stale detection for browser-cached analysis.
- The boundary "registry = data, analysis = science, pages = UI."

**Nonsense (don't build, already exists or duplicates):**
- A new global `reg$` object — name collision with R-side `reg$`.
- New `04_intermediate/`/`05_catalogues/` folder hierarchy — the
  toolkit's `evidence_registry/per_candidate/` is the existing home.
- Per-tool API surface (`getResult('ngsrelate', ...)`) — encode tool
  as argument.
- "Wrap toolkit_registries cleanly from the browser" — the toolkit
  registries are server-side; the browser already accesses them
  through `popstats_server.py`. There's no wrapping needed; there's
  routing already.

**Misframed (good idea, wrong layer):**
- The "domain librarian" facade — useful, but it's a thin layer over
  `registry_core.js`, not a peer of it. Build it last, if at all.

---

## One concrete next-step recommendation

Before doing ANYTHING from this proposal, do two things:

1. **Read `atlas-core/docs/TWO_REGISTRIES.md`** end-to-end (it's 200
   lines). It already addresses the conceptual confusion the proposal
   is trying to solve.
2. **Read `atlas-core/toolkit_registries/HOW_TO_USE.md`** to see what
   the R-side `reg$` already does. If after that you still want a
   browser-side `reg$`, at least it'll be deliberate and named
   differently.

Then, if the candidate-versioning piece is what matters most for the
manuscript, start there with a schema design — not a JS facade.
