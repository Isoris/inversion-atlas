# HANDOFF — page1 data helpers HOISTED to shared/; next is page2 body migration

**Date:** 2026-05-07 (chat ~36, round 5 step 1)
**Reads:** This file FIRST, then `HANDOFF_2026-05-06_chat34_page2_plan.md`
(round-5-step-2 plan — the 41-helper extraction), then the audit log
top entry, then `PAGE_MIGRATION_RECIPE.md` tail.
**Project:** MS_Inversions_North_african_catfish — 226-sample pure
*C. gariepinus* hatchery cohort, LANTA HPC.

---

## 30-second orientation

**The page1 data helpers are now in shared/.** This is the round-5
prep step that the chat-35 round-4-done handoff flagged as required
before the page2 body migration. It's a file-move-only change — zero
body edits — verified by an unchanged 33/33 smoke test.

```
atlases/inversion/
├── shared/
│   └── page1_data_helpers.js     665 LOC ← NEW. 21 functions/constants,
│                                            byte-verbatim bodies from _data.js.
├── pages/discovery/
│   ├── page1.js                  431 LOC ← unchanged.
│   ├── page1.js.bak             6684 LOC ← unchanged (delete after round 5).
│   └── page1/
│       ├── _data.js               38 LOC ← shrunk from 643. Now a re-export shim.
│       ├── _state.js             185 LOC ← FAMILY_PALETTE_BASE export dropped.
│       └── ... (8 other modules) unchanged.
```

The 6 panel sub-modules' `import { ... } from './_data.js'` statements
keep working because the shim re-exports every public name from the
shared module (live re-export — same function identity, not a copy).

**Verifications passed:**
- `node --check` clean on every JS file under `atlases/inversion/`.
- `tests/test_discovery_page1.js`: **103/103** (was 61/61; +42 new
  assertions covering shared/shim consistency).
- `tests/test_discovery_page2.js`: **3/3** (stale path fixed —
  `../inversion_discovery/page2.js` → `../atlases/inversion/pages/discovery/page2.js`).
- `tests/smoke_discovery_page1_round4.mjs`: **33/33 unchanged**.
  This is the strongest check — it exercises mount/applyData/setCur(25)/
  full-draw-chain/unmount end-to-end through `atlas_api.bootstrap`.
- Symbol-level identity check (custom one-shot): for each of the 21
  hoisted names, `shim[name] === shared[name]` (live re-export, not
  duplication). 70/70 incl. negative checks (internal names not exposed,
  `FAMILY_PALETTE_BASE` no longer exported from `_state.js`).

---

## What this round shipped

### `atlases/inversion/shared/page1_data_helpers.js` (new, 665 LOC)

The 17 public + 4 internal helpers that `_data.js` used to own. All
take `state` as first arg — pure or pure-from-state, no `_pageState`
shim. DOM access is limited to `populateSimScales` (writes a `<select>`)
and `loadViewControls`/`saveViewControls` (localStorage); these remain
fine because they never read `_pageState`.

| Public (re-exported from `_data.js` shim) | |
|---|---|
| `getActiveSimScale(state)` | `currentMbRange(state)` |
| `_LINES_COLOR_MODES` (const) | `_isLinesColorModeAvailable(state, modeId)` |
| `detectSchemaAndLayers(data)` | `listLayers(state)` |
| `availablePCs(state)` | `getPCRender(state, winIdx, axisX, axisY)` |
| `getPC(state, winIdx)` | `buildIndexes(state)` |
| `computePC1Signs(state)` | `populateSimScales(state)` |
| `buildFamilyPalette(state)` | `loadViewControls(state)` |
| `reconcileViewControlsForData(state)` | `getL2Cluster(state, l2idx)` |
| `getL2ClusterAt(state, l2idx, K)` | `getLinesValuesAt(state, winIdx, source)` |
| `getLinesGrid(state, source)` | `getLinesSignAt(state, winIdx, source)` |
| `allSampleIdx(state)` | |

| Internal (module-private; not exposed) |
|---|
| `VIEW_CONTROLS_STORAGE_KEY` (const) |
| `inferLayersFromV1(data)` |
| `getPCByAxis(state, winIdx, axis)` |
| `saveViewControls(state)` |

The `FAMILY_PALETTE_BASE` constant (used by `buildFamilyPalette`) was
also hoisted into this file — it lived in `_state.js` only because
the round-3 split was done before the shared/ hoist plan crystallized.
Now it's where `buildFamilyPalette` lives.

### `pages/discovery/page1/_data.js` reduced to 38-LOC re-export shim

```js
export {
  getActiveSimScale, currentMbRange, _LINES_COLOR_MODES,
  _isLinesColorModeAvailable, detectSchemaAndLayers, listLayers,
  availablePCs, getPCRender, getPC, buildIndexes, computePC1Signs,
  populateSimScales, buildFamilyPalette, loadViewControls,
  reconcileViewControlsForData, getL2Cluster, getL2ClusterAt,
  getLinesValuesAt, getLinesGrid, getLinesSignAt, allSampleIdx,
} from '../../../shared/page1_data_helpers.js';
```

The 6 panel sub-modules don't know the bodies moved. The shim is fully
transparent. **Delete the shim only when every panel module's import
has been rewritten to point at `shared/page1_data_helpers.js` directly**
— defer that mass-rename to a later cleanup round (it's churn-only).

### `pages/discovery/page1/_state.js` (185 LOC, unchanged size)

`FAMILY_PALETTE_BASE` declaration removed (moved to shared); the three
small-cohort fallbacks (`FAMILY_COLOR_SMALL`, `_SINGLETON`, `_UNMATCHED`)
stay because they're only used by the in-module `familyColor()`.
Comment block grew while constant block shrunk — same total LOC.

### Tests

- `tests/test_discovery_page1.js`: 61 → 103 assertions. The 42 new ones
  iterate the 21 hoisted public names and check (a) `shared/page1_data_helpers.js`
  exports each, (b) `_data.js` shim re-exports the same identity.
- `tests/test_discovery_page2.js`: stale path corrected. Body still in
  the chat-33 stub state; round 5 step 2 will rewrite it.

---

## What this round did NOT touch

- **atlas-core engine** — completely unchanged.
- **The other 9 page1 sub-modules** — only their `_data.js` import
  target changed under them, transparently. Same source bytes.
- **Page2 body migration** — that is round 5 step 2.
- **Page2 registry-entry mismatch** (page2 plan "Step 0"): `pages.registry.json`
  still lists page2 as cohort-overview but the code is candidate-detail.
  Defer to round 5 step 2 — the chat doing that migration has the most
  context.
- **Color helpers in `_state.js`** (`trackedColor`, `_vColor`, `_lineageColor`,
  etc.) read `_pageState` via the shim. Hoisting them needs body edits
  (refactor to take `state` as first arg) — defer until a page actually
  needs them shared.
- **HTML, CSS, server, schemas, master_config** — JS-only round.
- **Sibling pages** (page8, page12, page15, page19, page2-stub, page3,
  4, 5, 6, 7, 9, 10, 11, 16, 16b, 17, 18, 21, _overview) — only
  parse-checked.

---

## What to do NEXT (round 5 step 2: page2 body migration)

The page2 plan (`HANDOFF_2026-05-06_chat34_page2_plan.md`) is still
the controlling document. **One thing has changed**: Step 5 ("Cross-page
imports") is now resolved — page2's panel modules import the shared
helpers directly:

```js
// In page2's new sub-modules (or in page2.js if not splitting yet):
import {
  getPC, getPCRender, getL2Cluster, getL2ClusterAt,
  availablePCs, currentMbRange, allSampleIdx,
  getLinesValuesAt, getLinesGrid, getLinesSignAt,
  buildIndexes, computePC1Signs, populateSimScales,
  buildFamilyPalette, loadViewControls,
  reconcileViewControlsForData, detectSchemaAndLayers,
  listLayers, _isLinesColorModeAvailable, _LINES_COLOR_MODES,
  getActiveSimScale,
} from '../../shared/page1_data_helpers.js';
```

These helpers all take `state` as first arg — **page2 never imports
or sets page1's `_pageState`**. Page2 has its own `_pageState` (in
its own `_state.js` if you split, or local to `page2.js` if you don't),
and that one is set only by page2's own entry-points.

Otherwise the page2 plan is unchanged: 41 helpers, 40 found in legacy
with real bodies (~2359 LOC), 1 forever-stub (`renderCatalogue` —
likely page-4 territory). The recipe is the same as page1's eighth
pass + this round's split.

**Step 0 from the page2 plan is still open** — the registry-entry
mismatch. Resolve it as the first move in round 5 step 2; getting it
wrong cascades through every layer requirement check.

**Recommended sequence for chat 37:**
1. Read this file, then the page2 plan handoff, then the audit log
   top entry. Skim the recipe.
2. Resolve the page2 registry-entry mismatch (page2 plan "Step 0").
3. Audit page2.html fragment + CSS for `#candidate*` selectors
   (page2 plan "Step 1"–"Step 2").
4. Extract the 40 helpers verbatim from `legacy/Inversion_atlas.html`
   using the script pattern in the page2 plan "Step 3".
5. Wire `_pageState` in page2.js (page2 plan "Step 4").
6. Use `import { ... } from '../../shared/page1_data_helpers.js'`
   for the cross-page helpers (page2 plan "Step 5", now resolved
   per this handoff).
7. Smoke-test (page2 plan "Step 6").
8. Update audit log + recipe + write a fresh handoff.

If page2 turns out to be ≥3000 LOC after extraction, also split it
into sub-modules following the round-4 pattern. The legacy bodies are
mostly HTML-builder strings, which should be much less coupled than
page1's panels — the split is likely simpler, possibly into just 4–5
sub-modules (`_state.js`, `_html_builders.js`, `_wires.js`,
`_draw_panels.js`).

---

## Files NOT to drop / what's in this handoff bundle

- `0_READ_ME_FIRST.md` (regenerated for this round) — entry point
- `HANDOFF_2026-05-07_chat36_round5_step1_done.md` (THIS FILE)
- `HANDOFF_2026-05-06_chat34_page2_plan.md` — round 5 step 2 plan
  (still controlling; only Step 5 is now resolved per this handoff)
- `HANDOFF_2026-05-06_chat35_round4_done.md` — round 4 outcome (kept;
  the round-5-prep section is now executed)
- `PAGE_MIGRATION_RECIPE.md` — full migration log incl. round 5 step 1
- `AUDIT_LOG.md` — top entry is round 5 step 1
- (older chat-34 handoffs kept for historical reference only)

Plus the two project tarballs:
- `atlas-core_2026-05-07_chat36_round5_step1.tar.gz` — engine
  (unchanged this round; same bytes as round 4)
- `inversion-atlas_2026-05-07_chat36_round5_step1.tar.gz` — atlas tree
  with the hoist applied

---

## Communication preferences (unchanged)

Quentin is French-native, fluent English, based in Bangkok. PhD on
LANTA HPC. Manuscript v19→v20 targeting Nature Communications. Terse
and direct. Wants signal not flattery. Pushes back precisely when
outputs are wrong.

**Three-cohort discipline (NEVER violate):**
- F₁ hybrid (*C. gariepinus* × *C. macrocephalus*) — genome assembly
  paper only.
- 226-sample pure *C. gariepinus* hatchery cohort on LANTA — current
  inversion atlas work; K clusters reflect hatchery broodline structure,
  NOT species admixture.
- Pure *C. macrocephalus* wild cohort — future paper.
