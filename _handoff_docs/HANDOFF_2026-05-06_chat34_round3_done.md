# HANDOFF — local_pca_dosage migration round 3 done; round 4 next (state-bound color helpers)

**Date:** 2026-05-06 (chat ~34, sixth pass)
**Reads:** `AUDIT_LOG.md` top entry (chat ~34 sixth pass), then this file,
then `PAGE_MIGRATION_RECIPE.md` migration log tail, then proceed.
**Project:** MS_Inversions_North_african_catfish — 226-sample pure
*C. gariepinus* hatchery cohort, LANTA HPC.

---

## 30-second orientation

Page1 migration round 3 landed. The "easy tier" of round-2 stubs is
done: 5 stubs (3 pure color helpers + 2 pure-state-read accessors)
replaced with real legacy bodies. 1 new shared module created
(`shared/color_helpers.js`). local_pca_theta_pi now imports from it too.

Stubs in local_pca_dosage.js: 34 → 29 (5 resolved: 3 imported, 2 promoted to
real bodies). 0 TODO_MISSING markers. 0 registry
changes. 0 master_config changes. 0 schema changes. No engine code
touched. All `node --check` clean; 23/23 registry write tests still
pass.

Next is **round 4 — state-bound color helpers**. Same pattern as
round 3 (verbatim from legacy, refactored to take `state` as first
arg) but they touch state slots that may need registering in
`shared/state.js` SLOT_REGISTRY first.

---

## What round 3 shipped

**New file:**
- `atlases/inversion/shared/color_helpers.js` (~95 LOC)
  - Exports: `simColor`, `simColorPDF`, `zColorPDF`
  - Module-private: `hex`, `lerpRGB`, `SIM_PDF_COLORS`,
    `Z_LOW`, `Z_MID`, `Z_HIGH`
  - Pure, no state, no DOM. Verbatim from legacy 31256-31263,
    31281-31294, 31299-31307.

**Modified:**
- `atlases/inversion/pages/discovery/local_pca_dosage.js`
  - New import for the 3 color helpers from `shared/color_helpers.js`
  - Removed round-2 stubs: simColor, simColorPDF, zColorPDF
  - `getActiveSimScale(state)` body extracted from legacy 31311-31329
  - `currentMbRange(state)` body extracted from legacy 31781-31834
  - 8 call sites updated to pass `state` (2 × getActiveSimScale,
    6 × currentMbRange)
  - Round-2 accounting comment refreshed
- `atlases/inversion/pages/discovery/local_pca_theta_pi.js`
  - New import: `import { simColor } from '../../shared/color_helpers.js'`
  - The `(typeof simColor === 'function')` guard at line 613 now
    resolves against the imported binding. Guard kept intact.

**Audit/log entries:**
- `_handoff_docs/AUDIT_LOG.md` — new top entry (sixth pass)
- `_handoff_docs/PAGE_MIGRATION_RECIPE.md` — migration log appended
- This file (`HANDOFF_2026-05-06_chat34_round3_done.md`)

## What round 3 did NOT touch

- inversion-atlas registry — no layer added, modified, or removed.
- master_config.example.yaml — unchanged. No new root needed.
- schemas — none added, modified, or removed.
- atlas-core engine — no JS edits, no test edits. 9/9 parse-clean,
  23/23 assertions still passing.
- popstats_server.py — unchanged.
- 29 still-stubbed helpers in local_pca_dosage.js — see "Open for round 4" below.
- 29 TODO_MISSING_SLOT markers in local_pca_dosage.js — round 4 will register
  the slots actually needed by the round-4 extractions.

---

## Round 4 plan: state-bound color helpers (next)

**Working file:** `atlases/inversion/pages/discovery/local_pca_dosage.js`
(4672 LOC; 29 stubs remaining; 0 TODO_MISSING; 29 TODO_MISSING_SLOT.)

**Round-4 targets (4 stubs):**

| Stub | Round-2 default | What it likely reads |
|---|---|---|
| `_vColor(v)` | `'rgba(160,160,160,0.85)'` | Probably state.colorMode + a numeric value |
| `trackedColor(si)` | `'rgba(160,160,160,0.85)'` | state.tracked / tracked palette |
| `getSampleColor(si, mode, groupLabels)` | `'rgba(160,160,160,0.85)'` | state.colorMode, group palette, family colors |
| `_resolveSampleScopeColor(si, lcMode)` | `'rgba(160,160,160,0.85)'` | state.linesColorMode → dispatch to the above |

**Method (same as round 3):**

1. Find each function in `legacy/Inversion_atlas.html`.
2. Extract the body verbatim into the local_pca_dosage.js stub.
3. If the body references `state.X` directly (legacy global), refactor
   to take `state` as first arg.
4. For each `state.X` referenced, check `shared/state.js` SLOT_REGISTRY:
   - If registered → done, just keep the reference.
   - If not registered AND it's in the local_pca_dosage.js TODO_MISSING_SLOT list
     → register it in SLOT_REGISTRY with appropriate default + scope
     before extracting the body.
5. Update call sites if the signature changes (round 3 added `state`
   to two functions; round 4 may add `state` to all four).
6. `node --check local_pca_dosage.js`.

**Likely SLOT_REGISTRY work:**
The TODO_MISSING_SLOT names that look most likely to be touched:
`state.colorMode`, `state.ancestryPalette`, `state.hubFamilies`.
Also `state.cacheKey`, `state.l2GroupCache` for downstream rounds.
Audit `shared/state.js` first to see which already exist.

**Discipline reminder (from chat-34 handoff):**
> No speculative registry expansion. Each migrated function either
> uses an existing layer/slot, surfaces a real gap (add it with proper
> schema), or proves a layer/slot is unused (delete it).

For round 4 specifically: SLOT_REGISTRY additions are gated by
"this extracted body actually reads it." Don't pre-register the whole
TODO_MISSING_SLOT list.

---

## After round 4: what's left in local_pca_dosage.js

After the 4 state-bound color helpers, the remaining stubs split into
three tiers, in the recommended order to tackle them:

**Tier B — grid accessors and PCA render (6 stubs).**
`getLinesGrid`, `getLinesSignAt`, `getLinesValuesAt`, `getL2Cluster`,
`allSampleIdx`, `getPCRender`. These read `state.data.lines`,
`state.l2Cache`, `state.data.n_samples`, `state.pcaRender`. May
require `shared/per_l2_cluster.js` integration for getL2Cluster.

**Tier C — candidate / window-nav helpers (8 stubs).**
`_assignCandidateLanes`, `_paintCandidateBands`, `_winNavBand`,
`_wRowBand`, `_drawWRow`, `_drawWinNavLane`, `_ensureCsOverlayIndex`,
`drawCandidateBar`. These touch the candidate registry layers
(`candidates`, `candidate_lineage`). When extracting these, check
whether the candidate layer entries cover what's needed; if a body
references a registry layer that doesn't exist, that's the round
where a layer gets added per the chat-34 discipline.

**Tier D — strip renderers (9 stubs).**
`_drawBandTraceStrip`, `_drawDiamondOverlay`,
`_drawInheritanceLabelsStrip`, `_drawLineageStrip`,
`_drawRegimeBreadthStrip`, `_drawSnpDensityShade`,
`_drawSnpDensityStrip`, `_drawTrackedLinkageStrip`,
`_drawTransitionRateStrip`. Each strip is gated by a data layer that
isn't wired yet (band traces, lineage, snp density, etc.). Don't
force-extract these — leave them stubbed until the data layers land.

**Tier E — misc (2 stubs).** `recomputeAnchorConcord`,
`_refreshScreeInset`. Side-effect functions that mutate
`state._anchorConcord` and `state._screeInset`. Extract once
SLOT_REGISTRY covers those.

---

## Reading order for next chat

1. `AUDIT_FIRST.md` — pre-flight checklist.
2. `AUDIT_LOG.md` top entry (chat ~34 sixth pass) — what just shipped.
3. This file.
4. `PAGE_MIGRATION_RECIPE.md` — recipe + migration log tail.
5. `atlases/inversion/shared/state.js` — SLOT_REGISTRY before round 4.
6. `legacy/Inversion_atlas.html` — grep on demand for the 4 round-4
   targets. Don't read whole.

Skip the deeper docs (`HIERARCHY_SPEC.md`, `MASTER_CONFIG.md`,
`DATABASE_DESIGN.md`) for round 4 — they're only relevant when a page
needs cohort/genome-aware data resolution, which the round-4 color
helpers don't.

---

## Communication preferences (unchanged)

Quentin is French-native, fluent English, based in Bangkok. PhD on
LANTA HPC. Manuscript v19→v20 targeting Nature Communications. Terse
and direct. Wants signal not flattery. Pushes back immediately when
outputs are wrong. The work is advanced.
