# Atlas-core proposals — Phase 0 of the 4-atlas split

**Status**: proposals. These files are authored in `inversion-atlas` because that's the only repo this session has push access to. When `atlas-core` is touched (separate repo per `README_PAIRING.md`), the files in this directory copy across into the locations indicated below.

**Why this exists**: `docs/MIGRATION_4_ATLASES.md` §3.1 declares Phase 0 (atlas-core extensions) as independently shippable. The split itself (Phases 1-4) depends on Phase 0 being merged into atlas-core first. So Phase 0 is the unblocker for everything else.

## What's in this folder

```
docs/atlas-core-proposals/
├── README.md                                ← this file
├── SPEC_workflows_v1.md                     → atlas-core/docs/
├── SPEC_cohorts_v1.md                       → atlas-core/docs/
├── SPEC_tree_layers_v1.md                   → atlas-core/docs/
├── schemas/
│   ├── workflows.schema.json                → atlas-core/core/schemas/
│   ├── cohorts.schema.json                  → atlas-core/core/schemas/
│   └── tree_layer.schema.json               → atlas-core/core/schemas/
├── reference_impl/
│   ├── workflows_registry.js                → atlas-core/core/
│   ├── cohorts_registry.js                  → atlas-core/core/
│   └── cross_atlas_imports.js               → atlas-core/core/
└── tests/
    ├── workflows_registry.test.js           → atlas-core/tests/
    ├── cohorts_registry.test.js             → atlas-core/tests/
    └── cross_atlas_imports.test.js          → atlas-core/tests/
```

## What Phase 0 delivers

Three new registry concepts in atlas-core, all biology-neutral:

1. **`workflows.registry.json`** (per atlas) — declares cluster-side producer pipelines and the typed artifacts they produce. Today an atlas can declare *layers* but not the *workflow* that produces them. Multi-stage offline pipelines (like the BP_ATLAS bundle in the migration plan) need this so other atlases can declare consumption dependencies on their outputs.

2. **`cohorts.registry.json`** (atlas-core global) — declares which cohorts exist, their reference genome, scope, and which atlases they appear in. Plus a `cross_reference_handoffs` list that declares acceptable cross-cohort coordinate handoffs (the only way to read a layer whose `cohort_id` differs from your atlas's cohort). Three-cohort discipline (F1 hybrid / 226-Cgar hatchery / Cmac wild) becomes machine-enforceable instead of comment-policed.

3. **`tree_layer.schema.json`** (extension to the existing layer family) — promotes producer-output directory trees to first-class layers. Today some atlases handle multi-file outputs via "Mode B raw-folder interface" comments. The BP_ATLAS produces a deep tree (`02_paf_passA/`, `03_breakpoints/reciprocity/`, `05_atlas_data/`, `06_joint/`) and pages need typed access to sub-paths without each page implementing its own globber.

Plus one orchestrator module — `cross_atlas_imports.js` — that lets atlas A declare `import: atlasB.layer_v1` and enforces the cohort-discipline + workflow-currency checks at read time.

## What Phase 0 explicitly does NOT do

- Migrate any atlas content (that's Phases 1-4).
- Change any atlas-side API. Phase 0 is purely additive to atlas-core.
- Implement any new UI affordance in the atlas shell (the "run-status badges" mentioned in the migration plan §2.3 are a follow-up surface; the registry data they read is what Phase 0 ships).
- Touch `legacy/Inversion_atlas.html` or any in-flight port work.

## Validation strategy

Each reference implementation ships with a unit test file in `tests/`. The tests run under Node ≥ 18 with no external deps, mirroring the existing `inversion-atlas` test style (`node tests/test_*.js`). When ported to atlas-core they should slot into atlas-core's existing test runner.

## Application order (when atlas-core is touched)

1. Copy the three SPECs into `atlas-core/docs/`.
2. Copy the three schemas into `atlas-core/core/schemas/`.
3. Copy the three reference-impl modules into `atlas-core/core/`.
4. Copy the three test files into `atlas-core/tests/`.
5. Wire each module into atlas-core's `index.html` / module loader (one-line `import`s per module).
6. Extend the existing `layer_router.js` to dispatch tree-layer reads (sketch in `SPEC_tree_layers_v1.md` §6).
7. Run the test suite; expect all green.
8. Tag atlas-core a new minor version (per its `package.json`).

After step 8 atlas-core can ship Phase 0. Then the 4 atlas-side phases unblock.

## Open questions for the atlas-core maintainer

These are intentionally left in the SPECs for review rather than locked here:

- Whether `workflows.registry.json` should sit per-atlas (proposed) or in atlas-core as a global registry that all atlases contribute to. Per-atlas mirrors the existing 5 registries pattern; global would centralise cross-atlas workflow visibility.
- Whether `cross_atlas_imports.js` should hard-refuse cohort-mismatched reads or default to a warning + opt-in strict mode. Proposed: hard-refuse by default; strict opt-out via per-import `allow_cohort_mismatch: true` (which logs a banner). The migration plan assumed hard-refuse.
- Whether the tree-layer schema should allow nested tree-layer references (i.e. a tree-layer whose nodes are themselves tree-layers). Proposed: no, one level of tree is enough; nest by stacking layer dependencies instead.

Each is called out at the top of the relevant SPEC.

---

*Authored 2026-05-23. Part of the `claude/legacy-atlas-merge-Ul7cd` branch on `inversion-atlas`.*
