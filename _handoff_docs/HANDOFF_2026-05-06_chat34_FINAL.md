# HANDOFF — registry v2 done + toolkit_registries cleaned + master_config v1; next is page1 migration round 3

**Date:** 2026-05-06 (chat ~34)
**Reads:** `_handoff_docs/AUDIT_LOG.md` top entry (chat ~34 has TWO entries; read both), then this file, then proceed.
**Project:** MS_Inversions_North_african_catfish — 226-sample pure
*C. gariepinus* hatchery cohort, LANTA HPC.

---

## 30-second orientation

Three things landed this session:

1. **Registry v2 plumbing.** `Registry.write()`, persist hook on
   operations, version_id requirement on per-candidate paths, server
   allowlist on POST /file. 23 new test assertions; 43/43 total pass.

2. **Toolkit_registries cleanup.** Deleted ~5500 LOC of LANTA-only
   R/Python/bash loaders and their tests. Deleted 3 docs that were
   either LANTA-only or wrongly framed. Rewrote DATABASE_DESIGN.md
   intro to anchor on the 4-role model as method namespaces (not
   on-disk tables). Added README.md.

3. **Master config v1.** `atlas-core/master_config.example.yaml` is
   the new contract for path-free atlas code. 14 named roots with
   role + writable + ephemeral flags; server settings folded in;
   engines + defaults sections. Schema lives in toolkit_registries.
   MASTER_CONFIG.md spec doc explains the contract.

The next phase is **page-by-page migration from
`legacy/Inversion_atlas.html` into the 22 split page files**, starting
with page1.

Quentin's discipline: each migrated function either uses an existing
registry layer, surfaces a real registry gap (add a layer with proper
schema; if it lives at a new root, add to master_config.yaml first),
or proves a layer is unused (delete it). No speculative registry
expansion.

---

## What this session shipped

**Engine (`atlas-core/`):**
- `Registry.write(layer, args, payload)` — public method (~80 LOC).
- Persist hook in `_fetchFromSource` for `source: operation` layers
  with `persist: true`.
- `version_id` requirement on file-source layers using both
  `{candidate_id}` and `{version_id}` — throws clear error before fetch.
- `stableHashHex` / `stableStringify` exported helpers.
- Layer meta-schema extended: `writable`, `persist`, `cache_layout`.
- 23 new test assertions; total 43/43 passing.

**Master config (`atlas-core/master_config.example.yaml`):**
- 14 roots covering precomp / cohort / cohort_relatedness /
  cohort_ancestry / cohort_dosage / beagle / bams / reference /
  candidates / arrangement_calls / comparative / review_sessions /
  working_dir / cache.
- Cache root defaults to `/mnt/e/inversion-atlas-cache/`.
- Server / engines / defaults sections folded in from the old
  `popstats_server.config.example.yaml`.

**Toolkit_registries (`atlas-core/toolkit_registries/`):**
- NEW: `README.md` (orientation), `MASTER_CONFIG.md` (spec),
  `schemas/registry_schemas/master_config.schema.json`.
- REWRITTEN: `DATABASE_DESIGN.md` intro — 4-role model as method
  namespaces, not on-disk tables.
- STAMPED: `SPEC_DEFERRED.md` — status header marking it as
  LANTA-era reference.
- DELETED: `api/R/`, `api/python/`, `api/bash/`, `tests/`,
  `HOW_TO_USE.md`, `API_CHEATSHEET.md` (~5500 LOC + 640 doc LOC).

**Inversion atlas registry (`inversion-atlas/`):**
- `candidate_lineage` layer (NEW), schema for it (220 LOC).
- `{version_id}` inserted into 7 candidate path templates.
- `persist: true` on 5 expensive operation layers.
- `writable: true` on 8 layers.
- `server_results_cache` file scope on layer registry.

**Server (`popstats_server.py`):**
- `_is_path_allowed_for_write` enforcing 5 canonical prefixes.
- `_resolve_write_target` rewriting `_cache/server_results/*`.
- `SERVER_RESULTS_CACHE_ROOT` configurable (still uses old
  `popstats_server.config.yaml` shape; future task: read
  master_config directly).
- `GET /file/{path}` rewrites the cache prefix too.

**Atlas-core docs:**
- NEW: `docs/SERVER_PERSIST_CACHE.md` — persist mechanism reference.
- DELETED: `docs/TWO_REGISTRIES.md` — wrong "they're separate" framing.

**Inversion-atlas handoff docs:**
- `_handoff_docs/AUDIT_LOG.md` — two new entries for chat ~34.
- This file (`HANDOFF_2026-05-06_chat34_registry_v2_done.md`).

---

## What does NOT change this session

- 22 pages in `atlases/inversion/pages/` — untouched.
- `page1.js` 4588 LOC, 34 stubbed functions — untouched.
- 6 scaffolded-but-pending layers (relatedness_ngsrelate, ancestry,
  cross_species) — still pending real data files.
- 41 structured-block schemas — kept as-is, polished per-page during
  migration.
- Engine path-resolution code — still uses literal paths from layer
  entries. The root-aware `_fillTemplate` refactor is deferred until
  page1 migration drives a need.
- Layer entry paths — not yet rebased onto `root` + `path_under_root`.
  Per-page refactor during migration.
- popstats_server.py config loader — still reads the old YAML shape.
  Future task: teach it to read master_config.

---

## Reading order for next chat

1. **`AUDIT_FIRST.md`** — pre-flight checklist. Run it.
2. **`AUDIT_LOG.md` two latest entries (chat ~34)** — what just shipped.
3. **`atlas-core/toolkit_registries/MASTER_CONFIG.md`** — the new
   contract. The atlas is path-free now (or will be, as layers get
   refactored per-page).
4. **`atlas-core/toolkit_registries/DATABASE_DESIGN.md`** §"The four
   roles" — the organizing logic.
5. **`atlas-core/docs/DATA_LIFECYCLE.md`** — when to precomp vs raw
   vs per-candidate (still canonical).
6. **`PAGE_MIGRATION_RECIPE.md`** — round-by-round playbook.
7. **`legacy/Inversion_atlas.html`** — grep on demand; don't read
   whole.

Skip the old intermediate docs (`REGISTRY_PROPOSAL_CRITIQUE.md`,
`REG_DOLLAR_REVISITED.md`, `LANE_B_PLAN.md`,
`ARCHITECTURE_READINESS.md`, `READ_MODES_CONFIRMED.md`,
`SCROLL_VS_CANDIDATE.md`, `SV_CHROM_VS_CANDIDATE.md`) unless
reconstructing why a decision was made. The active reference set is
small now: AUDIT_LOG / MASTER_CONFIG / DATABASE_DESIGN /
DATA_LIFECYCLE / PAGE_MIGRATION_RECIPE.

---

## Next-session plan: page1 migration round 3

Per Quentin: *"focus page by page... we get a working registry and
server then we go back to merging page 1 or bringing it from legacy
to the inversion atlas. Resolve all TODOs and we upgrade our registry
little by little based on the needs of the page."*

**Working file:** `atlases/inversion/pages/discovery/page1.js`
(4588 LOC; 34 stubbed module-level no-op functions; 0 TODO_MISSING).

**Method per stub:**
1. Find the function name in `legacy/Inversion_atlas.html`.
2. Extract the body verbatim into the page1.js stub.
3. Identify what data the body reads. If it's
   `state.data.<thing>`, that's a registry layer hit — verify the
   layer exists; if it doesn't, add the layer (with schema; if it
   needs a new root, add to master_config first) BEFORE migrating
   the function.
4. Replace direct fetches / `state.data` reads with
   `await registry.resolve('<layer>', { ... })`.
5. If the function writes (e.g. saves boundaries, pushes a karyotype
   call), use `registry.write('<layer>', { candidate_id, version_id }, payload)`.
6. Test the page in the browser; iterate until the migrated
   function works the same as legacy.

**Suggested first stub:** the smallest / most-isolated. The
PAGE_MIGRATION_RECIPE has scope-check rule and suggested order — first
hoist `simColor / simColorPDF / zColorPDF` to
`shared/color_helpers.js`, then peel off independent stubs one at a
time.

**Discipline reminders:**
- Audit-first: before adding a registry layer, confirm it doesn't
  exist already. The 45 layers cover most of what page1 needs.
- DATA_LIFECYCLE rule: classify new data (Category 1 precomp /
  Category 2 raw folder / Category 3 per-candidate-per-version) before
  adding the layer.
- Mode A (curated atlas-shaped JSON) vs Mode B (raw tool output with
  `fields:` filter) — pick deliberately. Default is Mode A unless the
  data is genuinely re-subsettable.
- One commit per migrated function with the legacy line range in the
  commit message.
- If a layer needs a new root that's not in master_config, add the
  root to master_config.yaml FIRST. Layers reference roots by name,
  not by path.

---

## Communication preferences (unchanged)

Quentin is French-native, fluent English, based in Bangkok. PhD on
LANTA HPC. Manuscript v19→v20 targeting Nature Communications. Terse
and direct. Wants signal not flattery. Prefers fully-local browser
flows where possible, HPC only for big analyses. Pushes back
immediately when outputs are wrong. The work is advanced —
self-doubt may surface but doesn't reflect actual quality.
