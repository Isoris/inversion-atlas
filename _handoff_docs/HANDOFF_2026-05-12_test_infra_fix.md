# HANDOFF — cartridge test infrastructure fix, page22 unit test,
# table-based metrics extracted to shared/contingency.js

**Date:** 2026-05-12
**Branch:** `claude/legacy-atlas-merge-Ul7cd`
**Reads:** this file first, then the chat-36 step-11 handoff for the page
migration playbook, then `_tooling/run_migrated_tests.sh`.

## 30-second orientation

The cartridge repo was in a state where `node tests/test_shared_*.js` could
not run — eight test files (and one runner) referenced `shared/` paths that
didn't exist at the repo root. The shared modules live at
`atlases/inversion/shared/`, not `shared/`. This session repointed the
imports, fixed two broken re-export blocks in
`shared/band_tracking/index.js`, and parameterised the test runner so it
works from the cartridge root instead of an assembled atlas-workspace path
that doesn't exist on this machine.

Page22 (long-range haplotype regimes) was the only migrated page with no
test — a unit test was added (37 assertions, all green).

**Current cartridge-only baseline: 1465 pass / 0 fail across 30 test
files.** Eight further tests depend on `core/` from atlas-core and are
skipped with a runner notice; they will run automatically if a sibling
atlas-core is checked out and symlinked to `./core/`.

## What this session shipped

### Test infrastructure repointed (round 1)

- 7 `tests/test_shared_*.js` files: `../shared/X.js` →
  `../atlases/inversion/shared/X.js`.
- `tests/test_band_consensus.js`: same repoint to `band_tracking/index.js`.
- `tests/test_modular_smoke.js`: `resolve(ROOT, 'shared/state_io.js')` →
  `resolve(ROOT, 'atlases/inversion/shared/state_io.js')`.

### band_tracking/index.js made loadable (round 1)

The production `index.js` re-exported from six modules that were never
extracted from the legacy monolith
(`single_band.js`, `het.js`, `hom.js`, `iv.js`, `trajectory.js`,
`karyotype_model.js`). It also re-exported four `bp_*` names from
`projection.js` that don't exist there — `projection.js` exposes
`classifyProjection` / `classifyProjectionWithStability` instead.

Both blocks have been replaced with documented TODO notes listing the
exact symbols the legacy extraction is expected to surface. The
projection re-export block now lists the symbols that genuinely exist.
`manifest.json` continues to declare `index.js` as the production entry,
and downstream consumers (currently only `test_band_consensus.js` and the
manifest itself) can load it.

### Runner script repaired (round 1)

`_tooling/run_migrated_tests.sh` was hardcoded to
`WS=/home/claude/workspace/atlas-workspace` (a path from a prior
assembled-workspace session). It now derives `WS` from the script's own
location (`SCRIPT_DIR/..`), so it runs from any clone of the cartridge.

Foundation tests (the eight `test_shared_*` / `test_band_consensus` /
`test_modular_smoke`) and the four `core/`-dependent tests are now
separated into distinct buckets. Core-dependent tests skip with a
`⊘ filename` notice unless `$WS/core/atlas_api.js` is present
(atlas-core merged in).

### Page22 unit test added (round 2)

`tests/test_discovery_page22.js` covers:
- `mount` / `unmount` exports on `pages/discovery/page22.js`
- `initRegimesPage` / `computeGenomeView` on `page22/regimes_page.js`
- 18 exports on `page22/regimes_panel.js`
- 2 exports on `page22/regimes_pc1_panel.js`
- Pure-helper behaviour: `enumerateBandSubsets(3)` length,
  `maskToBands(0b101, 3)` shape, `maskLabel` string output,
  `_dosageClassColour('HET', 1)` returns CSS
- `PATTERN_CLASS_COLORS` taxonomy: 8 required classes present + frozen
- `unmount(null)` does not throw

**37/37 pass.** Added to the runner under the cartridge-only UNITS bucket.

### Table-based metrics extracted from legacy (round 3)

`page1/l3_panel.js` had five TODO_MISSING markers referencing
table-based contingency metrics (chiSquare, nmiFromTable, amiFromTable,
ariFromTable, restrictedConcord). All five legacy implementations exist
at lines 30915–31178 of `legacy/Inversion_atlas.html` and are pure
functions (no `state`, no DOM). They've been extracted to
`atlases/inversion/shared/contingency.js` and the l3_panel.js
imports/typeof guards have been replaced with explicit ES imports.

Extracted exports (added to shared/contingency.js):
- `chiSquare(table, K)` → `{chi2, df, p_approx, n}` (Wilson–Hilferty
  approximation, matches legacy verbatim)
- `normalCDF(z)` (Abramowitz–Stegun 7.1.26)
- `nmiFromTable(table, K)` (Strehl–Ghosh geometric-mean variant)
- `amiFromTable(table, K)` (Vinh–Epps–Bailey 2010, exact hypergeometric
  expectation — adequate for K≤6, N≤few hundred)
- `ariFromTable(table, K)` (Hubert–Arabie 1985)
- `restrictedConcord(cmp, keep, mergeThr)` (focal-row subset concord,
  returns LOW_POWER on empty keep set)
- `fisher2x2(table)` (exact two-tailed p-value via lgamma)
- `logFact(n)`, `logChoose(n,k)` (cached helpers)

The legacy `sigmaProfileL2` site in l3_panel.js stays typeof-guarded —
a modern version exists in `shared/per_l2_cluster.js` but with an
incompatible signature `(ctx, l2idx, usedK)`, renamed verdicts
(`STACKED_INVERSIONS` / `DOUBLE_CROSSOVER_LIKELY` / `NOISY` / `NORMAL`),
and no `top_high` field. Wiring requires building a ctx via
`contextFromState(state)`, mapping verdicts back to the panel's
expected labels (`TWO_INVERSIONS` / `CROSSOVER_ARTIFACTS` /
`NOISY_REGION`), and either dropping the drifter list or extending
shared to return top_high. Comment updated to describe the gap.

`computeBandDiagnostics` (legacy 15254–15583, ~330 LOC) is the largest
remaining TODO_MISSING in l3_panel. It depends on page1-specific
`state.data` slots (ghsl_panel, theta_pi_panel, roh_intervals,
sample_froh) and belongs in a page1 sub-module rather than `shared/`.
Deferred to a separate round.

40 new contingency-table assertions added to
`tests/test_shared_contingency.js`:
- normalCDF symmetry + boundary cases
- chiSquare on independent / diagonal / 3×3 tables
- nmi/ami/ariFromTable on perfect-agreement and uniform tables
- ARI table vs label-array parity check against `computeARI`
- restrictedConcord verdict logic + mergeThr threshold sweep
- fisher2x2 independent vs diagonal cases

**Cartridge-only baseline now 1505 pass / 0 fail across 31 test files.**

## Current state of the merge

Per the chat-36 step-11 handoff, the merge was at 11/22 pages. The
committed code shows steps 12–24 have all landed (see comments in the
page modules):

| Step | Round | What landed |
|---|---|---|
| 12 | page17 guard promotion | `_csGetSyntenyBlocks` + `_csPermutationTest` promoted from `typeof X === 'function'` runtime guards to ES imports from `page16` |
| 13 | page8 migration | discovery stub |
| 14 | page19 migration | discovery stub |
| 15 | page15 migration | GHSL mirror |
| 16 | page5 migration | comparative help |
| 17 | page7 migration | review ancestry |
| 18 | page6 migration | review popstats |
| 19 | page_sv_evidence | review SV evidence |
| 20 | page16b migration | comparative multi-species (2744 LOC) |
| 21 | page4 migration | review karyotype/tier |
| 22 | runner annotation | "MIGRATION COMPLETE 21/21" |
| 23 | qopt loader pattern | first activate/extract two-schema example |
| 24 | master config | YAML reader + `root:` / `path_under_root:` |

Plus page22 (long-range haplotype regimes) which is in the code but
wasn't documented in any handoff doc. It's now under test.

**All 22 pages are migrated.** The merge isn't done in the strict sense:
several pages still have `TODO_MISSING(…)` markers documenting helpers
that need to be extracted from the legacy monolith. Notable gaps:

- `page1` has many `typeof X === 'function'` graceful-degradation guards
  (lineage cache, band trace cache, θπ panels, GHSL panels) — these are
  follow-up extractions, not blockers.
- `page1/l3_panel.js` has TODO_MISSING for `_l2InvariantStats`,
  `computeBandDiagnostics`, `sigmaProfileL2`, `chiSquare`/`nmiFromTable`/
  etc., `restrictedConcord`, and the L3 heavy overlays (~440 LOC at
  legacy 51179–51720).
- `page8` (windows table) has `_renderWinSumTable`,
  `_drawWinSumStripCanvas`, `_wireWinSumFilters`, `_wireWinSumBisnpInfo`
  flagged.
- `page15` (GHSL mirror) has `_drawGhslZPanel` + 5 sibling panel
  renderers and `_refreshGhslPanelVisibility` flagged.
- `page19` (negatives) has `_nrRender`, `_nrLoadFile`, `_nrExportCsv`,
  `_nrReset` flagged.
- `shared/band_tracking/` is missing six upstream pipeline modules
  (`single_band.js`, `het.js`, `hom.js`, `iv.js`, `trajectory.js`,
  `karyotype_model.js`). The downstream consensus tail
  (`vote_evidence`, `band_voters`, `partition_enumerate`,
  `partition_consensus`) works and is under test.

## What this round did NOT touch

- **Page modules** — only the band_tracking `index.js` re-export block
  changed. No page code touched.
- **Foundation `shared/` modules** — unchanged. The 7 modules in
  `atlases/inversion/shared/` (excluding band_tracking) are byte-for-byte
  identical to step 11.
- **atlas-core dependency** — `core/` is still missing from the
  cartridge. The 4 core-dependent tests (page1, page2, master_config,
  registry_master_config + 4 smokes) skip. To unblock them, check out
  atlas-core to `../atlas-core/` and symlink `core` →
  `../atlas-core/core` at the cartridge root.
- **page1/page2 functional gaps** — these pages depend on
  `core/atlas_api.js` and have unported helpers. Out of scope here.

## Three-cohort discipline (CRITICAL — never violate)

1. **F₁ hybrid** (*C. gariepinus* × *C. macrocephalus*) — genome
   assembly paper only.
2. **226-sample pure *C. gariepinus* hatchery cohort on LANTA** —
   current inversion atlas work.
3. **Pure *C. macrocephalus* wild cohort** — future paper.

## What to do NEXT

| Priority | Work | Effort | Notes |
|---|---|---|---|
| 1 | Resolve `page8` / `page15` / `page19` TODO_MISSING markers | per page | extract small renderers from the legacy monolith into the page modules; same pattern as steps 13–15 used for the lifecycle |
| 2 | Resolve `page1/l3_panel.js` TODO_MISSING set | larger | five named markers, each in legacy ~31xxx–52xxx range |
| 3 | Promote `page1`'s `typeof X === 'function'` guards to explicit imports | per guard | same mechanic as step 12; each guard points at a function whose owner page exposes (or will expose) the symbol |
| 4 | Extract `shared/band_tracking/` upstream pipeline | substantial | six modules — `single_band` → `het` → `hom` → `iv` plus `trajectory` and `karyotype_model`. Restores the full pipeline that `regime_catalogue` documents |
| 5 | Wire atlas-core into the cartridge for local testing | trivial after atlas-core is present | clone or copy atlas-core; symlink `core/` |

The cheapest visible next round is **page19's `_nr*` renderers** — page19
is a small (96 LOC) negatives-region page and the four markers are
self-contained.
