# SPEC — Registry.write() + page-isolation principle

**Filed:** 2026-05-12.
**Status:** design — `Registry.write()` not implemented yet (lives in
atlas-core, deferred from chat-36 step-11 handoff "Piece δ").
**Why now:** Quentin pushed back on the legacy-style cross-page wiring
that the verbatim extractions reintroduce. This SPEC captures the
target shape so future rounds don't keep coupling pages together.

---

## The principle (Quentin's framing)

> "Most things you need to write them to some registry IDB or yeah to a
> file, but not wire internally."

In the legacy single-HTML-file architecture, cross-page state lived in
one global `state` object + `localStorage` + `IndexedDB`. Pages shared
JavaScript closures because there was only one tab, one script context.

In the new architecture (`atlas-workspace = atlas-core + cartridge`),
pages are mounted independently by `atlas_router` and the **Registry**
is the system of record for anything multiple pages need to agree on.
Pages should:

- Read state via `registry.resolve(layer, params)` (✅ already wired)
- Write state via `registry.write(layer, key, value)` (❌ not built yet)
- **Never reach into another page's module to fetch state** — that's
  the legacy global-state pattern in disguise.

## What "wired internally" means (anti-patterns to avoid)

```
// ❌ page2/_list.js → page1/inheritance.js
import { isAutoCandidate } from '../page1/inheritance.js';

// ❌ page22.js → page1/_state.js
import { _setActiveState as _setPage1ActiveState } from './page1/_state.js';

// ❌ page2/_html_builders.js → page2.js's runtime state
const cand = state.candidates[id];   // reading another page's _pageState
```

What's allowed:

```
// ✅ Pure compute / predicates live in shared/
import { isAutoCandidate } from '../../../shared/candidate_predicates.js';

// ✅ Persistence helpers wrap localStorage / IDB / (future) registry
import { persistActiveCandidateId } from '../../../shared/active_candidate.js';

// ✅ Within-page imports (page1/lines_panel.js → page1/z_panel.js) are fine
import { drawZ } from './z_panel.js';
```

## The persistence layer

Today, the cartridge can only persist through browser primitives:

| State              | Mechanism today                     | Future (Registry.write())                     |
|--------------------|-------------------------------------|-----------------------------------------------|
| activeCandidateId  | localStorage (shared/active_candidate.js) | `registry.write('state/activeCandidateId', id)` |
| candidateList      | (in-memory only, not persisted)     | `registry.write('inversion/candidateList', list)` |
| bandTraceFishSet   | localStorage (page1/band_trace_state.js) | `registry.write('inversion/bandTrace/fishSet', set)` |
| bandTraceOn        | localStorage                        | `registry.write('inversion/bandTrace/on', bool)` |
| l2SweepDismissed   | localStorage (per-chrom)            | `registry.write('inversion/l2sweep/dismissed/<chrom>', set)` |
| activeSampleSet    | localStorage (shared/active_samples? actually page1/active_samples.js) | `registry.write('inversion/activeSamples', set)` |
| chromCache         | IndexedDB (page1/idb.js)            | `registry.write('inversion/chromCache/<chrom>', data)` |
| enrichments        | IndexedDB                           | `registry.write('inversion/enrichments/<name>', data)` |
| inheritanceResult  | (in-memory, recomputed per session) | possibly cache via registry.write for slow cases |
| lineageResult      | (in-memory, recomputed per session) | possibly cache via registry.write for slow cases |

**The helper modules I've extracted already isolate the persistence
calls.** Every page calls through a helper, not `localStorage.setItem`
directly. So when `Registry.write()` ships, the swap is one-line per
helper. The call sites don't change.

## Page-isolation contract

When a future round picks up a new feature, the checklist is:

1. **Does it cross page boundaries?** If yes, the state goes through
   the persistence layer (helper module wrapping localStorage / IDB /
   registry). Page A writes; page B reads. No direct imports.
2. **Is it pure compute?** Put it in `shared/`. Anything page-shaped
   that doesn't need state goes there.
3. **Is it page-local?** Keep it under `pages/<stage>/<page>/`. Other
   pages don't import from it.
4. **Is it DOM-bound but generic?** Headless-tolerant helpers go in
   `shared/` too (e.g. an SVG builder, a tooltip positioner). Page-
   specific renderers stay under the page.

## Registry.write() — proposed contract

(This goes in atlas-core, not the cartridge, but the cartridge call
sites will compose against it.)

```javascript
// Synchronous (cache-write only, server-write fire-and-forget)
registry.write(layerName, key, value)
  // Triggers:
  //  - In-memory cache update on the current page
  //  - Background fetch to server's PUT /atlas/state/<layer>/<key>
  //  - Broadcast to other open pages via BroadcastChannel
  // Returns: void

// Async (waits for server-write confirmation)
registry.writeSync(layerName, key, value)
  // Same as write() but resolves the Promise after server-write.
  // Returns: Promise<void>

// Subscribe to changes from other pages / tabs / sessions
registry.subscribe(layerName, key, handler)
  // handler receives (value, meta) on changes from any source.
  // Returns: unsubscribe function
```

The first two satisfy "persist state". The third satisfies "page B
sees page A's update without a reload" — replaces the legacy pattern
of pages directly calling each other's `refresh*` UI functions.

## Acceptance criteria

A future round implementing Registry.write() and refactoring the cart-
ridge to use it can call this SPEC done when:

- [ ] `registry.write(layer, key, value)` exists in atlas-core with the
      semantics above
- [ ] `registry.subscribe(layer, key, handler)` exists
- [ ] Every existing `persist*` helper (active_candidate.js, idb.js,
      band_trace_state.js, l2_sweep.js, active_samples.js) gets a
      one-line swap from localStorage/IDB to `registry.write`
- [ ] No page module imports from another page module. Cross-page
      state flows exclusively through registry layers.
- [ ] An audit grep `from '\.\./page[0-9]+\b'` in
      `atlases/inversion/pages/` returns zero hits (except within-page
      sub-module imports like `./z_panel.js`).

## What this SPEC does NOT say

- It doesn't dictate that EVERY state has to go through the server.
  Cursor position, hover state, mousedrag state — those are inherently
  per-page and stay in `_pageState`. The principle applies to state
  that needs to *survive page reloads* or *be visible to other pages*.
- It doesn't require deleting the localStorage / IDB helpers. They
  stay as the fallback when the server is unreachable. Registry.write
  should use them as its local-cache tier.
- It doesn't block any in-flight extraction work. The pattern I've
  established (small helper per persistence concern + page imports
  the helper) is exactly what makes the eventual swap mechanical.
