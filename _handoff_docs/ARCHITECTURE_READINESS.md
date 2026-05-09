# Does the architecture support the chain you described?

The question now is concrete: walk the data flow

```
Local PCA → auto-merge envelopes → het-dosage backbones →
  auto-propose candidates → candidate update + versioning →
  re-test statistics → pass candidate to mendelian.js →
  mendelian asks relatedness registry → computes →
  writes intermediate to inversion registry → other downstream consumers
```

For each step, the answer is one of:
- ✅ **Already works** — the architecture has it.
- ⚠️ **Works partially** — exists but with a gap that needs filling.
- ❌ **Doesn't work yet** — genuinely missing.
- 🚫 **Blocked by something else** — works only after a prior gap is closed.

---

## Step-by-step

### 1. Local PCA → envelope merge → het-dosage backbones

✅ **Already works.** This is what the existing toolkit pipeline + `pca_scrubber_v3` browser tool already do. Output lands in `evidence_registry/per_candidate/<cid>/structured/` as Tier-2 blocks. The atlas resolver-registry can read those via `source: file` layer entries.

### 2. Auto-propose candidates

⚠️ **Works partially.** The toolkit's `interval_registry/candidate_intervals.tsv` is the place candidates land. The schema (`candidate_interval.schema.json`) supports `parent_id` for nesting and `scale` for detection scale.

Gap: the *automation* is currently a manual `reg$evidence$write_block(...)` from R. There's no browser-side trigger. That's fine if candidate proposal happens in the pipeline (which is the canonical path) but not fine if you want the atlas to propose candidates from inside the browser. **Decide which side proposes.** I'd say pipeline.

### 3. Candidate update + versioning

❌ **Doesn't work yet.** This is the genuine gap. The toolkit has *one* `candidate_intervals.tsv` row per candidate. There's no concept of v1/v2/v3 within the same lineage.

What's needed:
- A second table `candidate_versions.tsv` keyed `(candidate_id, version_id)` with FK to candidates. Fields: `chrom`, `start_bp`, `end_bp`, `source_methods`, `parent_version_id`, `status`, `active_callset_id`, `dependency_hash`, `created_at`.
- A pointer file `candidate_active_version.tsv` (single row per candidate) saying which version is currently active. Updating the pointer is the "promote v2 over v1" action.
- Splits are still handled by creating new candidates with `parent_id` set, exactly as the schema already supports.

Effort: ~1 session for schema + R bindings, ~1 session for browser-side resolver-registry layers.

**This is the foundational piece. Until it lands, the rest of the chain works but only against a single "current" version, not against a lineage.**

### 4. Re-test statistics when candidate updates

⚠️ **Works partially.** The mechanism exists; the policy doesn't.

What works: the resolver-registry caches results by `cache_key` templates that already include candidate-affecting parameters. When you call `registry.invalidate('popstats_groupwise', { candidate_id: 'X', ... })` the cache entry goes away.

What doesn't: there's no *transitive* invalidation. If `candidate_boundaries` changes for `LG28_INV_001`, nothing automatically marks `popstats_groupwise(LG28_INV_001, ...)`, `mendelian_inheritance(LG28_INV_001, ...)`, etc. as stale. Each consumer has to know what depends on candidate boundaries.

The toolkit side has the right primitives — `provenance.config_hash` + `who.group_version` in `result_row` — to detect staleness on read. So the recompute pattern works but it's "check on read" rather than "invalidate on write." That's actually fine for an analysis-on-demand pattern; it just needs to be the explicit policy.

What's needed:
- A small **dependency-edge table** in the toolkit: `(downstream_kind, downstream_keys) ← (upstream_kind, upstream_keys)`. When candidate boundaries change, a script walks the edges and marks downstream rows `stale=true`. Pages reading a stale row see the flag and re-trigger the analysis.
- Browser-side: when `setActiveCandidate` fires, the prewarm scheduler already gets `candidate_change` events. We can hook a "forget any cache entries containing `candidate_id=X`" routine in `Registry.invalidate`. ~30 LOC.

Effort: ~1 session.

### 5. Pass candidate (with version) to `mendelian_inheritance.js`

⚠️ **Works partially.** The `analysis` source kind already exists in the resolver-registry meta-schema:

```json
"source_kind": ["file", "operation", "inline", "analysis"]
```

with the comment

> `analysis = browser-side compute via an analysis module`

and the layer entry can point at `analysis: 'analysis/mendelian_inheritance.js#runMendelianTest'`. The hook is wired. `analysis/mendelian.js` already exists in the inversion atlas as the math home.

Gap: nothing currently CALLS the analysis module with full provenance args. The existing `analysis/mendelian.js` is invoked as a free function, not through the registry. To make it candidate-version-aware:

- The analysis module's signature should take `(candidate_id, version_id)` and pull everything else from the registry itself.
- The resolver-registry layer entry for `mendelian_inheritance` should template the cache key on `(candidate_id, version_id, callset_id, relatedness_id, sample_set_id, thresholds_hash, analysis_version)`. That cache key IS the dependency hash.

Effort: ~1 session, mostly mechanical.

### 6. mendelian asks relatedness registry → samples registry → inversion registry

✅ **Already works in principle.** This is just three `await registry.resolve(...)` calls inside the analysis module. The relatedness layer needs an entry in `layers.registry.json` (the schema file `relatedness.schema.json` is already there as a placeholder). Same for `samples_metadata`. The inversion-active-callset layer needs to come into existence as part of step 3 (versioning).

The naming-confusion I flagged in the previous critique still applies: don't dress this up as `reg$.relatedness.getResult(...)`. It's `registry.resolve('relatedness', { tool, columns })`. A single-line domain facade can wrap it later if you want. Optional.

### 7. mendelian computes and writes intermediate to inversion registry

⚠️ **Works partially.** The write path exists at the server (`POST /file/{path:path}` → `popstats_server.py:1365`). The browser CAN write a JSON to the toolkit's evidence-registry directory if it knows the right path.

What's missing on the resolver-registry side:
- A `writable: true` flag on file entries already exists in the meta-schema. It's not currently used.
- There is no `Registry.write(key, value, args)` method. There's `Registry.set(key, value, args)` which writes to the cache, not to disk.

So the analysis module currently has two options:
- (a) Call `fetch('POST', '/file/<path>', { body: JSON })` directly. Works today. Ugly.
- (b) Add a thin `Registry.write(key, args, payload)` method that consults a `writable` layer entry, templates the path, and POSTs. ~50 LOC.

Either way the *transport* works. The architecture supports browser-side analysis writing back to the canonical evidence registry today. What's missing is just the wrapper.

**One decision worth making explicit:** browser-side writes hit the server with no auth (the server is on a tunnel, behind the LANTA login). For atlas use that's fine. If this ever runs unprivileged, the write endpoint needs auth. Note for later.

Effort: ~30 min for the `Registry.write` wrapper.

### 8. Downstream consumers see new intermediate

✅ **Already works.** Once the file lands in `evidence_registry/per_candidate/<cid>/structured/mendelian_inheritance.json`, any layer entry with `source: file` and that path will pick it up on the next `resolve()`. If we did step 4 (transitive invalidation), the cache eviction is automatic. If we didn't, the page just calls `registry.invalidate(...)` after the write and gets fresh data on the next read.

---

## The honest architectural summary

The chain you described **works end-to-end with the architecture we have**, with three additions:

1. **Candidate versioning schema + active-version pointer** (step 3). Foundational. Without this, "v1 vs v2 vs v3 of the same lineage" is not representable. Everything downstream pretends versions exist; this is where they actually become real entities. ~1-2 sessions.

2. **Dependency edges + transitive invalidation** (step 4). Tiny piece on the browser side (~30 LOC in `Registry.invalidate`); slightly bigger on the toolkit side (the dependency-edge table). Without this, recomputes happen only on explicit user request, not automatically on parameter change. Acceptable as a v1 — explicit recompute is fine, but you should know that's what you're choosing.

3. **`Registry.write(key, args, payload)` wrapper** (step 7). ~30 LOC. The transport (`POST /file/<path>`) already exists.

Everything else — `analysis` source kind, file/operation/inline source dispatch, hot/warm/cold caching, `candidate_change` events firing through the prewarm scheduler, `result_row.provenance.config_hash` for stale detection on the toolkit side, `analysis/mendelian.js` existing as the math home — is **already there**.

---

## What this means for the proposal you sent

Re-evaluating with this lens:

- The candidate-versioning piece (Part 4 of the proposal): ✅ correct and necessary. Build it.
- The dependency-hash piece (Part 5 of the proposal): ✅ correct in spirit; the toolkit already has the field (`provenance.config_hash`); we just need to compute it consistently for analysis-module outputs and add the transitive-invalidation hook on the browser side. Cheaper than the proposal suggested.
- The `analysis/mendelian_inheritance.js` piece (Part 3 of the proposal): ✅ correct; it's the orchestrator that calls existing `mendelian.js` math and pulls inputs from `registry.resolve(...)`. Standard pattern.
- The `reg$.X` facade (Parts 1, 2 of the proposal): ⚠️ syntactic sugar, build last if at all. The actual machinery underneath already exists. The naming collision with R-side `reg$` remains a real problem.
- The "wrap toolkit_registries cleanly" framing: ❌ misframed. The browser doesn't wrap toolkit registries. It calls server endpoints that read them. That's already how it works today.

---

## Order of operations going forward

Two parallel lanes of work:

### Lane A — page migration (this chat sequence)
Round 3 page1 body extraction → page2 → ... per the migration recipe. Independent of the registry work.

### Lane B — registry/versioning (separate chat sequence)

In order:
1. Design `candidate_version.schema.json` + `candidate_active_version.tsv` pointer. Get review before coding.
2. Toolkit-side R bindings to write/read versions (`reg$intervals$set_active_version(cid, vid)` etc.).
3. Browser-side resolver-registry layer entries: `candidate_versions`, `candidate_active_version`, `candidate_callset_for_version`.
4. `structured_block_schemas/mendelian_inheritance.schema.json` in the toolkit.
5. `analysis/mendelian_inheritance.js` orchestrator (separate from existing `mendelian.js` math file, or absorbed depending on what's in `mendelian.js`).
6. `Registry.write(...)` wrapper + `writable: true` layer entries.
7. Transitive invalidation on `candidate_change` events.
8. Page mount wrapper for the Mendelian review page.

Lane B is ~5-7 sessions. Lane A is also ~5-7 sessions. They don't collide.

---

## Will you get stuck later?

Short answer: **no, not on the architecture itself.** The architecture supports the dependency chain. What you'll get stuck on if you don't address it:

- If candidate versioning isn't in place before the manuscript needs to compare v1 vs v2 vs split-children: the toolkit can't store that comparison cleanly. It'll work as side-by-side files with manual naming, which is fragile. **Build versioning before the comparison view.**
- If transitive invalidation isn't wired before users start refining candidates interactively: stale data will show up in cached views until a manual refresh. Annoying but not catastrophic. Can ship without it and add later.
- If the `Registry.write` wrapper isn't built before pages need to save reviewed results: pages will reach into `fetch('POST', '/file/...')` directly, which is the anti-pattern the page-migration recipe warns against. **Build the wrapper before any page wants to save.**

So: not blocked on architecture; blocked on three small pieces of plumbing that all have a natural order and small individual cost. The big architectural decisions (resolver pattern, four source-kinds, three-tier cache, separate analysis modules, separate toolkit registries server-side, server endpoint as bridge) were the right ones — they accommodate the chain you described.

---

## One thing worth flagging for the manuscript timeline

The candidate-versioning piece (step 3) is also what makes the **"Mendelian inheritance as model-comparison QC"** framing in your proposal possible. You can't say "merged v1 contradiction rate = X, split children contradiction rate = Y, therefore the split model is biologically better" without versioned candidates. So if that comparison is part of the v20 manuscript story, versioning is on the critical path for the manuscript, not just the atlas. Worth pricing in.
