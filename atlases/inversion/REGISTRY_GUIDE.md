# REGISTRY_GUIDE — for anyone editing this atlas

**This atlas is a cartridge. The engine is `atlas-core`.** Pages do not talk
to each other. Pages talk to `atlas-core` (the shared state container + the
registry), and `atlas-core` routes everything else — server compute on
localhost, IndexedDB cache, file fetches, cross-page hand-offs.

The shape is **page → atlas-core → page**, never **page ↔ page**.

This file exists so future contributors (and Claude Code sessions) stop
re-introducing direct page-to-page wiring while atlas-core is still being
finished. The contract here lets us **declare inputs/outputs now and wire
them later** by flipping a config flag, with zero churn in page code.

---

## 1. The rule

When editing a page, you may NOT:

- Import another page's module to read its state.
- Read or write a `window.*` global to share data with another page.
- Read or write a page-private `localStorage` key to share data with another page.
- Call another atlas's code directly.
- Add `fetch(...)` calls that hit the local server outside an `operation` entry.

When editing a page, you MUST:

- Read shared state from `atlasState.shared.*` (or `atlasState.<atlas_id>.*`).
- Read derived data via `await registry.resolve(<layer_key>, args)`.
- Write shared state via the AtlasState setter (`atlasState.setActiveCandidate(...)`,
  `atlasState.setActiveChrom(...)`, etc.).
- Declare every new input/output in the five registry config files
  before writing the page logic that depends on it.

If the wiring on the atlas-core side isn't live yet, declare the contract
anyway. "Wire it later" means: flip `preload_on` from `"explicit"` to
`"candidate_change"` (or similar) once core's prewarm scheduler honors it.
Pages do not have to change.

---

## 2. Where inputs and outputs live

Every page declares its I/O in **`registries/data/*.json`**. These five
files ARE the page's contract with the rest of the system:

| File | Declares |
|------|----------|
| `pages.registry.json` | Per page: which layers it needs (`requires_layers`), which slots it reads (`requires_slots`), which layers to pre-warm on mount (`preloads`). |
| `layers.registry.json` | Every named result a page can `resolve()`. Tier (hot/warm/cold), source kind (file / operation / inline / analysis), prewarm trigger. |
| `operations.registry.json` | Every server-side compute. Endpoint, inputs, output schema, cache tier. |
| `slots.registry.json` | Per-atlas state fields that this atlas owns inside `AtlasState.<atlas_id>`. Type, default, persist flag, scope. |
| `files.registry.json` | Raw files on disk that layers point at (path templates, per-chrom / per-candidate scopes, writable flag). |

**Rule of thumb:** if a page needs something it doesn't currently have,
the first edit is in one of these JSON files, not in the page's JS.

---

## 3. The I/O header every page module must carry

At the top of every `pages/.../<page>.js`, keep an I/O comment block in
sync with the registry entry. This is the part a reviewer (human or LLM)
reads first to know what the page touches without scanning the whole file:

```js
// =====================================================================
// I/O CONTRACT — keep in sync with registries/data/pages.registry.json
// =====================================================================
//   requires_slots:      ["activeChrom", "activeCandidate"]
//   requires_layers:     ["scrubber_main", "candidate_tracks"]
//   requires_operations: ["fst_hom1_hom2"]
//   writes_slots:        []                ← if the page sets shared.* fields
//   emits_events:        []                ← if the page calls atlasState.emit(...)
//   produces_layers:     []                ← if the page writes a writable layer
// =====================================================================
```

If your edit changes what the page reads/writes, update BOTH the header
comment and `pages.registry.json` in the same commit. The header is the
quick-read; the JSON is the authoritative contract atlas-core enforces.

---

## 4. How to add a new input (page wants to read something new)

1. Decide what kind of thing it is:
   - **Existing shared slot** (e.g. `activeChrom`) — just read it from
     `atlasState.shared.<slot>`. Add it to `requires_slots` in
     `pages.registry.json`. Done.
   - **Existing layer** (already in `layers.registry.json`) — call
     `await registry.resolve('<layer_key>', args)`. Add it to
     `requires_layers` (and `preloads` if you want it pre-warmed).
   - **New derived data** — go to §5.
   - **New shared field across pages/atlases** — go to §6.

2. Update the I/O header at the top of the page module.

3. Do NOT call `fetch()`, do NOT touch `window.*`, do NOT read another
   page's globals.

---

## 5. How to add a new output / derived data (page produces something new)

If the new thing is **derived** (computed from existing data, possibly on
the server), it belongs in the registry, not in the page.

1. Add an entry in `layers.registry.json`:

   ```json
   "my_new_layer": {
     "tier": "warm",                   // hot / warm / cold
     "source": "operation",            // file / operation / inline / analysis
     "operation": "my_new_op",         // when source=operation
     "schema": "registries/schemas/my_new_layer.schema.json",
     "schema_status": "pending",       // until the schema is written
     "preload_on": "candidate_change"  // wire-later trigger
   }
   ```

2. If `source: "operation"`, also add to `operations.registry.json`:

   ```json
   "my_new_op": {
     "endpoint": "/api/<atlas_id>/my_new_op",
     "method": "POST",
     "inputs": ["activeChrom", "activeCandidate.id"],
     "output_schema": "registries/schemas/my_new_layer.schema.json",
     "cache_key": "my_new_op:{activeChrom}:{activeCandidate.id}",
     "cache_tier": "warm",
     "estimated_latency_ms": 2000,
     "engine": "engines/<atlas_id>/my_new_engine.py"
   }
   ```

3. Drop the schema file under `registries/schemas/` (start as `{}` if
   you don't have one yet; `schema_status: "pending"` accepts any shape).

4. If the operation is server-side, add the route under
   `server-adapters/` — the assembly step mounts it under
   `server/api/<atlas_id>/`. **Do NOT** put a server route inside the
   page module.

5. In the page, just call:
   ```js
   const value = await registry.resolve('my_new_layer', { candidate_id });
   ```

That's the complete loop: page → registry → operation_runner → localhost
server → cache → page. No wire ever skips atlas-core.

---

## 6. How to add a new shared field (page wants to share state with other pages)

If the field is **per-atlas private** (only this atlas's pages read it),
declare it in `slots.registry.json`:

```json
"slots": {
  "mySharedField": {
    "type": "object",
    "default": null,
    "persist": false,
    "scope": "private"
  }
}
```

Read it as `atlasState.<atlas_id>.mySharedField`. Write it the same way.
For notifications, call `atlasState.emit('<atlas_id>.mySharedField.changed', {...})`
and document the event name in the writing page's I/O header.

If the field is **cross-atlas shared** (e.g. a new `activeRegion`), do
NOT add it to this atlas. Open a contract request against atlas-core
(`atlas-core/core/atlas_state.js` `SHARED_DEFAULTS` plus a setter that
emits the event). Until atlas-core lands it, do not invent a
work-around with localStorage or window globals — leave the field
unwritten and surface a TODO in the page header.

---

## 7. What to do when you'd otherwise reach for `localStorage` / `window.*` / a sibling page

| Temptation | Do this instead |
|------------|-----------------|
| `localStorage.setItem('myAtlas.foo', ...)` from a page | Add slot to `slots.registry.json` with `persist: true`; assign to `atlasState.<atlas_id>.foo`. AtlasState handles localStorage round-trip. |
| `window.MY_SHARED_CACHE = {...}` | Add a `layer_entry` with `tier: "warm"`; `registry.resolve()` is the cache. |
| `import { state as page1State } from '../page1/_state.js'` (from page2) | Page1 should publish what page2 needs via a shared slot or a writable layer. Page2 reads through atlasState/registry. |
| Direct `fetch('http://localhost:8000/api/...')` in a page | Add an `operation_entry`; call `registry.resolve()`. |
| New `window.addEventListener('myAtlasEvent', ...)` for cross-page signal | Use `atlasState.subscribe('<event_name>', cb)` / `atlasState.emit(...)`. |

If you cannot avoid one of these because the engine on atlas-core's
side isn't ready yet, write a comment that says exactly which registry
entry would replace this workaround, and tag it `TODO(registry-bridge)`.
Future cleanup is then `rg TODO(registry-bridge)` and follow the trail.

---

## 8. The "wire later" promise

The registry entries above let you commit the **contract** without the
**wire** yet. Concretely:

- A layer declared with `preload_on: "explicit"` is registered with
  atlas-core but never auto-resolves. The first `await registry.resolve(...)`
  still works (cold fetch). When atlas-core's prewarm scheduler is ready
  to fan out `candidate_change`, you change `"explicit"` →
  `"candidate_change"` in the JSON and every page that resolves that
  layer becomes instant on selection. Zero JS edits.

- An operation declared with `cache_tier: "cold"` becomes warm by editing
  one field; the page never knew.

- A slot declared `persist: false` becomes a remembered field across
  reloads by flipping to `true`. Page code unchanged.

This is why declaring the I/O contract eagerly matters even when the
engine side is still half-built: every "wire later" step is one config
edit, not a page rewrite.

---

## 9. Self-check before opening a PR

Run through this list. If any answer is NO, the PR is not ready:

- [ ] Every new `await registry.resolve(...)` call has a matching entry
      in `layers.registry.json`.
- [ ] Every new layer with `source: "operation"` has a matching entry
      in `operations.registry.json`.
- [ ] Every new server endpoint lives under `server-adapters/`, not
      inside a page module.
- [ ] The page module's I/O header at the top reflects the actual reads
      and writes.
- [ ] The page's entry in `pages.registry.json` lists every layer /
      operation / slot the page references.
- [ ] No new `window.*` global, no new `localStorage` key, no import
      from a sibling page's module.
- [ ] If the page emits a state event, the event name is documented in
      the I/O header.

---

## 10. Where to look when in doubt

- Architectural overview: `atlas-core/docs/ARCHITECTURE.md`
- Core ↔ atlas pairing: `atlas-core/README_PAIRING.md`
- Registry contract: `atlas-core/docs/SPEC_registry_v1.md`
- Meta-schema (what the five JSON files must satisfy):
  `atlas-core/core/registry_core.schema.json`
- Minimal working example: `atlas-core/tests/mock-atlas/`

End of REGISTRY_GUIDE.
