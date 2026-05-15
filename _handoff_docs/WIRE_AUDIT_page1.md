# WIRE_AUDIT — page1 broken / missing wires

**Authored**: 2026-05-15 (chat continuation)
**Scope**: page1 (the local PCA |Z| big-page scrubber). Catalogues
every visible control that doesn't work, with diagnosis + the fix
pattern.

**Root cause** (consistent across this audit): during the chat-35
round-4 split of the legacy `Inversion_atlas.html` monolith into
the modular tree under `atlases/inversion/pages/discovery/page1/`,
many click/change handlers from the legacy `wireBindings()`-style
init code were NOT extracted. Symptoms vary:

- **Type A — orphan checkbox/button**: the HTML element exists with
  the right `id`, but no event listener exists anywhere in the
  modular tree. Clicking does nothing.
- **Type B — ReferenceError**: a handler exists but calls an
  undefined function (e.g. `setLinesYsources(...)`, `getSlabClusterAt(...)`).
  The handler runs, throws silently, downstream logic skipped.
- **Type C — aside / compact mirror not wired**: the legacy
  hidden checkbox IS wired (e.g. `#flipPC1`), but the visible
  mirror in the right sidebar (`#flipPC1Aside`) or compact mode
  panel (`#flipPC1Compact`) is not. Same UX gap.
- **Type D — handler exists but reads from wrong slot**: e.g. the
  `pcaLassoActive` slot is read by the lasso pointerdown handler,
  but no toggle writes to it.

**Already fixed** (this session — commits `2490d79` + `637169f`):
- ✅ `#pcaLassoToggle` / `#pcaLassoToggleCompact` (Type A)
- ✅ `#flipPC1Aside` / `#flipPC1Compact` (Type C)
- ✅ `#l3HetToggle` (Type A)
- ✅ Lines source checkboxes (PC1/PC2/het/GHSL clicks) — fixed
  `setLinesYsources` ReferenceError (Type B)
- ✅ `#linesColorModeSelect` change handler (Type A)
- ✅ `getSlabClusterAt` + `clusterSlabAtK` ported from legacy
  (Type B) → fixes L3 slab mode at K=6 / K=3+6

---

## Still broken — priority list

Group A — Lines-panel header buttons (all Type A unless noted):

| id | what it should do | priority | notes |
|----|-------------------|----------|-------|
| `linesTransRateToggle` | toggle structural-haplotype transition-rate strip | **high** | user-reported 2026-05-15 |
| `linesRegimeBreadthToggle` | toggle regime-breadth strip (narrow / medium / wide) | high | |
| `linesPanelLineageToggle` (?) | toggle lineage strip | medium | id may be different — locate in page1.html |
| `linesBandTraceToggle` | toggle the band-trace strip globally | high | per SPEC_distant_band_concordance_fish_trajectory §5 |
| `linesBandTraceTraceBtn` (🔍 trace) | set state.bandTraceFishSet from current tracked / lassoed set | **high** | user-reported 2026-05-15 |
| `linesBandTraceLargestBtn` (largest ▾) | dropdown — pick the largest cohort by some metric | medium | |
| `linesBandTraceTSVBtn` (📊 TSV) | export band-trace TSV | medium | calls `_bandTraceDownloadTSV` per SPEC §6 |
| `linesBandTraceRunsBtn` (📊 runs) | render the regime-runs view | medium | |
| `linesBandTraceLinkageBtn` (🔗 linkage) | open the lasso-linkage modal | **high** | user-reported 2026-05-15; calls `_openLassoLinkagePopover` per SPEC_lasso_inheritance_backgrounds §4 |
| `linesPanelCandBandsToggle` (✓ cand bands) | toggle per-candidate vertical band highlights | medium | calls `setLinesPanelCandidateBands(state, b)` from lines_panel.js#1294 — already exists, just needs change wire |
| `linesLassoToggle` | toggle lines-lasso mode | likely wired | check `attachLinesLasso` exists |

Group B — SNP-density 3-state buttons (the "off / strip / shade" trio):

| id | what it should do | priority | notes |
|----|-------------------|----------|-------|
| `[data-snpdens-mode]` buttons (3) | toggle SNP-density visualisation | **high** | user explicitly asked: REMOVE "off" — should be a single button that toggles on/off. Today it's 3-state (off / strip / shade). |

**User's redesign for SNP dens** (2026-05-15):
> "snp dens: off strip shade — remove off because we just need strip
> OR shade but inactive by default if we click active if click again
> inactive."

Decide: ship as ONE button (e.g. "strip") that toggles on/off, OR
two buttons ("strip" / "shade") each independently togglable. The
user's wording suggests EITHER strip OR shade, not both. Default
is off (no button active). State slot: `state.linesSnpDensMode`
∈ `{null, 'strip', 'shade'}`.

Group C — Tracked-samples panel controls (aside / compact mirrors):

| id | what it should do | priority | notes |
|----|-------------------|----------|-------|
| `screeToggle` / `screeToggleAside` | toggle scree-plot inset in PCA scatter (mini bar plot of top-k eigenvalues) | **high** | user-reported 2026-05-15 "scree plot in tracked samples local pca nothing appears" — likely Type A |
| `eigenvaluesPanel` arrow-down | expand/collapse eigenvalues panel | **high** | user-reported — unclear which control; need DOM inspect |
| `clearPicksAside` / `clearPicksCompact` | clear `state.tracked` | medium | Type C — legacy `#clearPicks` is wired |
| `autoPickRadial*` (3 mirrors) | auto-pick samples radially | medium | Type C |
| `cycleKAside` / cycle K | cycle K=3..6 | medium | likely Type C |
| `flipPC1Aside` / `flipPC1Compact` | already fixed in 2490d79 | ✅ done | |
| `pcaLassoToggle` / Compact | already fixed in 2490d79 | ✅ done | |

Group D — Color modes on PCA scatter (#colorModeBar):

| add buttons | dispatch already exists | priority | notes |
|----|-----|-----|-----|
| `cluster_dosage` button | yes — in `getSampleColor` line 204 | high | per user: "color the local PCA by het dosage" |
| `cluster_theta_pi` button | yes — line 205 | high | per user: "...theta..." |
| `cluster_ghsl` button | yes — line 206 | high | per user: "...and GHSL" |
| `q_ancestry` button (already has #colorModeBar `ancestry`?) | yes — line 210 | low | verify the existing `data-mode="ancestry"` button routes to q_ancestry vs the older ancestryColor |

**Important**: the user said "for every local pca panel whether page
1 2 3 of local PCA" — meaning ALSO page12 (θπ) and page15 (GHSL).
The dispatch should mirror across all three. Page22's PCA is
separate (its color modes are different — keep as-is).

Group E — L3 panel transforms (U/V rotations + reclusterMode):

| id | what it should do | priority | notes |
|----|-------------------|----------|-------|
| L3 recluster mode `kmeans-K6` | now works after `getSlabClusterAt` port (637169f) | ✅ fixed | |
| L3 recluster mode `uv-rotated` etc. | broken — `clusterSlab_UVRotated` and 4 sibling functions not ported from legacy | **high** | user-reported 2026-05-15 "all of the transforms in PC space like u v rotations and so on its inactive" |

Functions needing port from legacy (per the legacy `getSlabClusterByMode` switch around line 11985):
- `clusterSlab_UVRotated`
- `clusterSlab_DistanceUV` (alias for uv-rotated)
- Plus 3-4 more — need to read the full switch statement in legacy

Group F — Cross-page features:

| feature | what it should do | priority | notes |
|---------|-------------------|----------|-------|
| Connect dosage heatmap | add a "show dosage" button somewhere that opens `page_dosage_heatmap` for the active candidate | medium | user-requested 2026-05-15 "can you connect the dosage heatmap so that we can have it." The page exists at `pages/discovery/page_dosage_heatmap.{html,js}` — just needs an entry point from page1 / page2 |
| Silhouette display in L3 + tracked-samples | render the `cl.silhouette` value next to K-badge in L3 slab; add a row in tracked-samples panel | high | compute is now wired (637169f); display TBD |
| **CTRL-cycles cluster-label notation** | hold/press CTRL → overlay group labels around K-means cluster centroids on the PCA scatter; each CTRL press cycles through notation modes | **high** | user-requested 2026-05-15. Per the user's spec: default = no notations → `g1 g2 g3` → `HOMO_1 HET HOMO_2` → `H1/H1 H1/H2 H2/H2`. Cycle wraps to default. Needs: (1) new state slot `state.pcaClusterLabelMode` ∈ `{null, 'g123', 'homo_het', 'h_pair'}`, persisted to localStorage. (2) keydown listener for CTRL key (handled at document level, gated on `state.activePage === 'page1'` and not in INPUT/TEXTAREA/SELECT). (3) Render hook in `drawPCA` (page1/pca_panel.js) that paints labels at each cluster centroid using the active mode's vocabulary. (4) Mirror cycle in pages with their own local PCAs (page12 θπ, page15 GHSL, page2 candidate focus). Label sources: `g1/g2/g3` ← literal; `HOMO_1/HET/HOMO_2` ← `pages/review/page4/karyo_labels.js#K3_H_SYSTEM`; `H1/H1 etc.` ← H-pair notation (find in karyo_labels.js or build inline from band index). Position labels at cluster centroid (from `cl.centers`) with halo for legibility. |

---

## Layout bugs (separate from wires)

| symptom | diagnosis | fix |
|---------|-----------|-----|
| Fixed layout: panels overflow above viewport, black space at top of cartridge area | `main#page1` grid was `grid-template-rows: 40px 520px 100px auto 0px 28px 1fr 360px` — fixed pixels totalling 1048 px minimum. On <1100px viewports, the `auto + 1fr` cells collapse to 0 and rows overflow. | **Fixed** in this session — changed to `minmax(MIN, FRAC)` pattern in `css/inversion.css` lines 363, 503. |
| Per-sample-lines header wraps to 3 rows | Too many controls in `#linesYsourceBar` for one row; `flex-wrap: wrap` lets them spill | **PENDING** — collapse all "secondary" controls (everything after `color:` picker) into a `<details>` element or a "⋯ more" disclosure. Pattern already exists in L3 toolbar (`l3-more-item` class + disclosure button). |
| Tracked-samples panel styling less advanced than legacy | The legacy had per-K coloring on the K-band buttons, richer per-sample chips, etc. The round-4 port simplified. | **PENDING** — review `legacy/Inversion_atlas.html` `_drawTrackedAside` (or similar function) for the original styling. The K-color palette is in `shared/page1_data_helpers.js#groupColor`. |

---

## Banner reorg (atlas-core shell — NOT in this cartridge)

User-requested 2026-05-15:

1. **Atlas selector** → move to uppermost banner, leftmost position
   (currently in middle row with the tab pills, crowding them)
2. **Chromosome selector** → next to atlas selector on uppermost banner
3. **Tab pills** → full width of their (now uncluttered) row
4. **Settings button** → top-left of uppermost banner, OR top-right
   of viewport

This requires changes to `atlas-core/index.html` + `atlas-core/css/base.css`
+ the `loadAtlasStylesheets` / `renderTabBar` machinery. **None of
those files live in this cartridge** (the inversion-atlas repo only
hosts the cartridge, not the shell).

**Action**: file a separate issue / PR against atlas-core. From this
cartridge's side, the contract that needs updating is:
- `atlases/inversion/manifest.json` — `scope_pickers` array (currently
  declares the `activeChrom` picker; the shell builds it into the
  topbar). If the atlas selector moves to the same row, the
  `manifest.json` may want a new field or the shell may need to
  consume an `atlas_label` field for the dropdown label.

---

## Test plan tomorrow

Recommended order — fix in groups, ship per-group commits:

1. **Group A** (lines-panel header buttons) — 10 wires, 1 commit
2. **Group B** (SNP-dens redesign) — UI change + 1 wire
3. **Group C** (tracked-samples aside/compact mirrors) — ~5 mirrors
4. **Group D** (PCA color modes) — 3-4 new buttons in #colorModeBar +
   one-line wire each (dispatch already there)
5. **Group E** (L3 U/V transforms) — port 4-5 functions from legacy
   (similar to the L3 slab port done today)
6. **Group F** + **Group: cross-page** (dosage heatmap link,
   silhouette display) — 2 small features

Per-group commit lets reviewer audit each change cleanly.

---

## Reference

- Today's wire-fix commits: `2490d79` (4 controls), `637169f`
  (L3 slab + lines color-mode select)
- Today's layout commit: this session — `inversion.css` grid changes
- Today's user guides for the affected pages:
  `specs_done/_bundles/HOW_TO_USE_page1.md`,
  `HOW_TO_USE_page2.md`, `HOW_TO_USE_page4.md`,
  `HOW_TO_USE_page11.md`, `HOW_TO_USE_page_sv_evidence.md`,
  `HOW_TO_USE_page22.md`
- Page contract: `docs/generated/page_contracts/page1/`

Each broken wire fix should:
- Match the established pattern (idempotent `dataset.wired = '1'`
  flag, sync current state value to checkbox.checked on attach,
  reflect changes back to all mirrors in the group)
- Cite the user-reported symptom in the commit message
- Update the corresponding HOW_TO_USE doc if behaviour changes
