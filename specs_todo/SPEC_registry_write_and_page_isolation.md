# SPEC — Page-isolation principle (companion to SPEC_registry_v2)

**Filed:** 2026-05-12.
**Status:** the page-isolation half is enforced in the cartridge as of
commit `4e695f7` (zero cross-page imports). The Registry.write half
defers to `specs_done/SPEC_registry_v2.md` which is the canonical
design.
**Why this file still exists:** SPEC_registry_v2.md describes the
atlas-core Registry.write contract. This file captures the
*cartridge-side* page-isolation discipline that lets the Registry
swap work mechanically when v2 lands.

**Canonical reference for Registry.write semantics, layer
`writable: true` flag, server transport, schema validation, cache
invalidation: `specs_done/SPEC_registry_v2.md`.** Read that first.

This SPEC is **complementary**, not parallel. It says: regardless of
how persistence works, pages must not import from each other.

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

## Registry.write() — see SPEC_registry_v2

The full contract — signature `registry.write(key, args, payload)`,
`writable: true` flag on layer entries, path templating, schema
validation before send, `POST /file/{path:path}` transport, cache
invalidation on success, transitive invalidation on candidate_change
— is specified in `specs_done/SPEC_registry_v2.md` items 4 + 5.
Don't duplicate it here.

The signature I sketched in an earlier revision of this file
(`registry.write(layerName, key, value)` with broadcast / subscribe)
was not aligned with SPEC_v2. The canonical surface is:

```
registry.resolve(key, args)        — read cached/fresh
registry.write(key, args, payload) — write through to canonical store
registry.invalidate(key, args)     — drop one cache entry
registry.invalidateAllForCandidate(cid) — drop all candidate-scoped entries
```

No `subscribe`, no `BroadcastChannel`. SPEC_v2 §11 explicitly rules
those out for v2.

## Acceptance criteria (cartridge half)

The page-isolation half is **already met** in the cartridge as of
commit `4e695f7`:

- [x] No page module imports from another page module. Cross-page
      state flows exclusively through `shared/` (pure compute /
      predicates) and persistence helpers (localStorage / IDB).
- [x] Audit grep `from '\.\./page[0-9]'` in
      `atlases/inversion/pages/` returns zero hits.
- [x] Audit grep `from '\./page1/'` in
      `atlases/inversion/pages/` (excluding `page1.js` itself) returns
      zero hits.

The Registry.write half (depends on atlas-core changes per SPEC_v2):

- [ ] `registry.write(key, args, payload)` exists in
      `core/registry_core.js` per SPEC_v2 §5
- [ ] `registry.invalidateAllForCandidate(cid)` exists per SPEC_v2 §6
- [ ] Server-side path allowlist on `POST /file/{path}` per SPEC_v2 §9
- [ ] Every existing `persist*` helper (`shared/active_candidate.js`,
      `page1/idb.js`, `page1/band_trace_state.js`, `page1/l2_sweep.js`,
      `page1/active_samples.js`) gets a one-line swap from localStorage
      / IDB to `registry.write`. The call signatures I built were
      designed for this swap — each helper takes the same arguments
      `registry.write` will need, so the change is mechanical per
      module.

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
