# Candidate versioning — using the existing registry, browser-local

This is the corrected plan. The previous draft was about TSV tables
in `toolkit_registries/`. That was wrong — for candidates, the atlas
is fully local: one folder per candidate, one JSON file per aspect,
loaded through registry layers, cached in IndexedDB, identity tracked
in `AtlasState.shared.activeCandidate`.

## What the existing architecture already gives us

Reading `atlas-core/core/atlas_state.js` and the existing candidate_*
layers in `layers.registry.json`:

```
state.shared.activeCandidate              ← single object, current active
state.shared.activeCandidate.id           ← stable lineage ID (timestamp-based)
setActiveCandidate(cand) → emits          ← shared.activeCandidate.changed event
                                            (prewarm scheduler picks it up)
localStorage persists ONLY the .id        ← full candidate is "registry-resolved"
                                            (per the comment in atlas_state.js:173)

Per-candidate data, all under data/candidates/{candidate_id}/:
  candidate_boundaries        → boundaries_refined.json     (validated schema!)
  candidate_gene_cargo        → gene_cargo.json
  candidate_sv_counts         → sv_genotype_counts.json
  candidate_marker_primers    → marker_primers.json
  candidate_breeding_card     → breeding_readiness_card.json
  candidate_karyotype_per_sample, candidate_final_class, etc.

All preload_on: candidate_change, tier: warm.
```

So a candidate is **not** a single JSON. It's **a folder of named
aspects**, each aspect served by its own registry layer, each
preloaded when `candidate_change` fires. The candidate `id` is the
folder name. That's the existing contract.

## What's missing for versioning

The current path template says `data/candidates/{candidate_id}/...`.
If you refine boundaries from v1 to v2, the new
`boundaries_refined.json` overwrites the old one — v1 is gone. The
gene_cargo, sv_counts, etc. that were computed against v1 boundaries
are now silently inconsistent with the v2 boundaries written next to
them.

Three small additions fix this without breaking the existing model:

### 1. Path templates gain a `{version_id}` slot

```
Before:  data/candidates/{candidate_id}/boundaries_refined.json
After:   data/candidates/{candidate_id}/{version_id}/boundaries_refined.json
```

Every per-candidate layer gets the same one-segment insertion. Old
data without version subfolders remains readable by setting
`{version_id}` to a default literal (`current` or `v1_initial`)
when no version is set.

### 2. One new layer: `candidate_lineage`

A small JSON at `data/candidates/{candidate_id}/lineage.json` that
describes the version history, **without** version-specific data:

```json
{
  "candidate_id": "1715000000000_a4b",
  "active_version_id": "v2_theta_refined",
  "status": "active",
  "versions": {
    "v1_localPCA_initial": {
      "version_id":         "v1_localPCA_initial",
      "parent_version_id":  null,
      "source_methods":     ["localPCA"],
      "callset_id":         "localPCA_K3_v1",
      "status":             "deprecated",
      "created_at":         "2026-05-06T08:30:00Z",
      "dependency_hash":    "a3f1b9...",
      "notes":              "Initial localPCA K=3"
    },
    "v2_theta_refined": {
      "version_id":         "v2_theta_refined",
      "parent_version_id":  "v1_localPCA_initial",
      "source_methods":     ["localPCA", "thetaPi"],
      "callset_id":         "thetaRefined_K3_v2",
      "status":             "active",
      "created_at":         "2026-05-06T11:15:00Z",
      "dependency_hash":    "f72c4e...",
      "notes":              "θπ-refined, narrows to high-Fst shelf"
    }
  }
}
```

Boundaries, K, locked_labels are NOT in here. Those live where they
already live: `data/candidates/{cid}/{version_id}/boundaries_refined.json`,
etc. The lineage file is just the index that names what versions
exist and which is active.

This becomes its own registry layer:

```jsonc
"candidate_lineage": {
  "tier": "warm",
  "preload_on": "candidate_change",
  "source": "file",
  "path": "data/candidates/{candidate_id}/lineage.json",
  "schema": "schemas/candidate_lineage.schema.json"
}
```

### 3. A small AtlasState method to resolve version

```js
// in atlas_state.js, alongside setActiveCandidate
async setActiveCandidateVersion(version_id) {
  // Fires shared.activeCandidate.changed too, so prewarm
  // re-fetches all preload_on:candidate_change layers under the
  // new version subfolder.
}
```

Implementation: when called, walks the registry's candidate-scoped
layer cache and invalidates entries for the old `{candidate_id}/{old_version_id}/`
prefix, then sets `state.activeCandidateVersionId` and fires the
event. The prewarm scheduler already handles the rest because every
candidate-scoped layer's path templates on `{candidate_id}` and now
`{version_id}` — different version → different cache key → fresh
fetch.

## What this doesn't change

- `state.shared.activeCandidate` stays a single object with `.id`.
  The id stays stable across refinements (lineage identity).
- `setActiveCandidate(cand)` stays as-is. The `cand` object now
  carries an `active_version_id` field whose default is the active
  version per `lineage.json`, but readers that ignore it keep
  working.
- All existing per-candidate layer entries stay valid. The path
  template gains one more `{version_id}` slot; old data can read by
  defaulting that slot to a literal.
- `localStorage` still persists only `id`. Add `versionId` next to
  it; rehydration still goes through the registry the same way.
- No new write path needed for v1. Versioning becomes useful once a
  refinement is computed somewhere (boundary_refinement boundaries refinement,
  later analysis modules); the act of saving a new version is a
  download-JSON / re-upload step like the existing review-session
  writes, OR uses the `Registry.write` we'll add in SPEC item 4.

## What "split" means in this model

Splits stay candidate-level, not version-level. When LG28_INV_001 is
shown to be two systems by long-range evidence:

1. The parent candidate `1715000000000_a4b` gets `lineage.json.status = "split"`.
2. Two new candidates are created — new ids `1715111000000_x1y` and
   `1715111000000_z2w` — each with their own folder, their own
   `lineage.json`, version history starting at `v1_from_parent_split`.
3. The new candidates' `lineage.json` carries a top-level
   `parent_candidate_id: "1715000000000_a4b"` field for the back-link.

So "version" lives inside a candidate folder, "split" creates new
candidates. Same distinction as before, expressed in JSON instead of
TSV.

## What "the registry instead" means here, concretely

You said: *use registry instead of loading JSON one by one*. With
this model:

- Pages **never** read `data/candidates/.../*.json` directly. They
  call `await registry.resolve('candidate_lineage', { candidate_id,
  version_id })` and `await registry.resolve('candidate_boundaries',
  { candidate_id, version_id })`.
- Switching the active candidate fires one event; the prewarm
  scheduler resolves all 8 per-candidate layers in parallel; warm
  cache holds them across sessions; second visit is instant.
- Switching the active version fires the same event with a different
  `version_id` — cache misses on the new sub-key, fetches fresh, old
  version's data sits in cache too (until LRU evicts) so flipping
  back is also instant.
- Analysis modules that use these layers ask for what they need
  through the same `registry.resolve(...)` call — they don't know
  whether the file is on disk, in IndexedDB, or just got written by
  a previous step.

That's the "central librarian" idea, but pointing at things the
registry **already serves**. No new global object, no `reg$`, no
parallel storage tree.

## Implementation effort

Three small steps:

1. **`candidate_lineage.schema.json`** — schema for the lineage
   index. ~30 LOC of JSON. (Mode A — curated atlas-shaped JSON.)
2. **One new layer entry** in `layers.registry.json` for
   `candidate_lineage`. ~15 LOC of JSON.
3. **Path-template update** for the seven existing per-candidate
   layers — insert `/{version_id}` segment. ~7 small JSON edits.
   Defaulting: the registry's templateFill should treat
   `{version_id}` as `'current'` when not set, so existing data
   without subfolders stays readable.
4. **Optional** `setActiveCandidateVersion(id)` method on
   `AtlasState`. ~20 LOC of JS, only needed once a page has a
   version-switcher UI.

Tests:
- A small smoke test that resolves `candidate_lineage` from a
  hand-written example JSON.
- A test that two different `version_id` args produce different
  cache keys (already true via `_buildCacheKey`).

No engine code change beyond the optional state method. The
`fields:` filter pass already proved the pattern: the engine doesn't
need to know about candidate versions specifically — paths and
cache keys do the work.

## What this enables for Mendelian inheritance later

When `analysis/mendelian_inheritance.js` runs (SPEC item 7), it will:

```js
const cand    = state.shared.activeCandidate;        // {id, ...}
const lineage = await registry.resolve('candidate_lineage',
                                       { candidate_id: cand.id });
const versionId = state.activeCandidateVersionId      // user-selected
                  ?? lineage.active_version_id;       // fallback
const boundaries = await registry.resolve('candidate_boundaries',
                                          { candidate_id: cand.id,
                                            version_id: versionId });
const callsetId  = lineage.versions[versionId].callset_id;
const callset    = await registry.resolve('candidate_karyotype_per_sample',
                                          { candidate_id: cand.id,
                                            version_id: versionId });

const rel = await registry.resolve('relatedness_ngsrelate', {
  run_id: 'broodstock_qc_pass_v1',
  fields: ['a','b','theta','IBS0','IBS1','IBS2','KING']
});

// ... compute Mendelian metrics
// ... write back: registry.write('mendelian_inheritance_block', {
//                   candidate_id: cand.id, version_id: versionId
//                 }, payload);
//   path templates to:
//     data/candidates/{cand_id}/{version_id}/mendelian_inheritance.json
```

Three resolve calls, one write. The candidate ID, the version ID,
the callset ID, the relatedness run ID, and the column subset are
all explicit at call time. The dependency hash for the result is
computed from exactly those identifiers. Re-running with a different
version produces a different cache entry, a different file path, a
different dependency hash — no silent overwrites.

## Open questions before any code lands

1. **Default `version_id` for legacy data without subfolders.**
   `'current'` or `'v1_initial'`? Either works. `'current'` reads
   nicely (`data/candidates/{cid}/current/boundaries.json`) and
   stays valid even when there's only ever one version.
2. **Version-switcher UI.** Page11 currently auto-proposes new
   boundaries. Does saving a refinement create a new
   `{version_id}` automatically (with a generated ID like
   `v2_theta_refined_<timestamp>`), or does the user name it? My
   default: auto-generate, let the user rename via a notes field.
3. **`lineage.json` write path.** Same answer as Mendelian results:
   either user downloads + re-uploads (matches the existing
   `review_session_writes` convention), or `Registry.write` POSTs
   to the local server when one is running. The data shape doesn't
   depend on the choice.

Three one-line answers unblock implementation.
