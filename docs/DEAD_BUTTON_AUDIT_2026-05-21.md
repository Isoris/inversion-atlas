# Dead-button audit — 2026-05-21

Audit pass over all 126 unique `<button id="...">` IDs in the inversion-atlas page HTMLs. Cross-referenced each against the JS handler surface across `atlases/inversion/` and `atlas-core/`. **31 buttons came up dead — 1 false positive, 30 real.**

Disposition recorded here so the rationale + rescue path for each is preserved, even when the button is removed or hidden.

---

## False positive (resurrected)

| ID | Page | Why it looked dead |
|---|---|---|
| `sidebarFloatBtn` | local_pca_dosage.html:73 | Wired by [`atlas-core/core/sidebar_floating.js:81`](../../../atlas-core/core/sidebar_floating.js), auto-installed on every `shell.page_mount`. My grep only walked `atlases/inversion/`. Real working button. |

---

## Group 1 — self-admitted TODO stubs (8 buttons, all `local_pca_dosage.html`)

These already had `[TODO — not implemented]` in their own `title` attribute. **Not yet swept** as of 2026-05-21; left in place because hiding them was queued behind the rest of the audit work. If/when swept, recommended action is `style="display:none"` with a comment pointing here.

| ID | Label | Line | Title says |
|---|---|---|---|
| `cmFlipBtn` | `F flip L2↔W` | 1997 | TODO — flip active draft between L2 and W resolutions |
| `cmBoundaryBtn` | `B set boundary` | 2000 | TODO — snap nearer edge of active W-resolution to candidate boundary |
| `cmCutBtn` | `C ✂ cut` | 2003 | TODO — toggle cut marker at cursor's window index |
| `cmTrack1Btn` | `1` | 2012 | TODO — edit track 1 (default) |
| `cmTrack2Btn` | `2` | 2016 | TODO — edit track 2 (overlapping inversions) |
| `l3ActMergeBtn` | `merge ↑` | 1966 | TODO — extend draft candidate to include previous L2 |
| `l3ActSeparateBtn` | `separate ↓` | 1969 | TODO — shrink draft candidate from the next L2 |
| `l3ActConfirmBtn` | `confirm [Enter]` | 1972 | TODO — commit current draft as confirmed candidate |

**Recovery path**: each title preserves the design intent. If the "candidate mode" mini-toolbar (cmFlip/cmBoundary/cmCut/cmTrack1/cmTrack2) and the L3-actions toolbar (merge/separate/confirm) are still wanted, implement the corresponding state mutations + re-render handlers. If superseded by the haplotype_regimes promotion workflow, delete.

---

## Group 2 — popup mirrors of working sidebar buttons (3 buttons, `local_pca_dosage.html`)

**Status: ✅ wired** in [`local_pca_dosage/sidebar.js`](../atlases/inversion/pages/discovery/local_pca_dosage/sidebar.js) — 3 one-line additions. Handlers already existed for the sidebar twins; the popup variants were just missed when the variant lists were extended.

| ID | Sidebar twin | Fix |
|---|---|---|
| `kCycleBtnPopup` | `kCycleBtnAside` | Added to wire-loop at sidebar.js:1591 |
| `clearPicksPopup` | `clearPicksAside` | Added to `compactClicks` table at sidebar.js:1631 |
| `autoPickRadialPopup` | `autoPickRadialAside` | Added to `compactClicks` table at sidebar.js:1637 |

**Recovery path**: N/A — done.

---

## Group 3 — catalogue exports + regime UI (7 buttons, `catalogue.html`)

**Status: ⏳ deferred to spec** — each is a real feature that needs design decisions before implementation. SPECs filed under `specs_todo/`:

| ID | Label | SPEC |
|---|---|---|
| `catExportGallerySVG` | SVG | [`SPEC_catalogue_gallery_exports.md`](../specs_todo/SPEC_catalogue_gallery_exports.md) |
| `catExportGalleryPNG` | PNG | (same SPEC) |
| `catExportGalleryPDF` | PDF | (same SPEC) |
| `catRegimeRegistry` | 🏷 regimes | [`SPEC_catalogue_regime_registry.md`](../specs_todo/SPEC_catalogue_regime_registry.md) |
| `catRegimeAssignSel` | 🏷 assign sel | (same SPEC) |
| `catViewL1` | L1 merged | [`SPEC_catalogue_view_modes.md`](../specs_todo/SPEC_catalogue_view_modes.md) |
| `catViewL3` | L3 | (same SPEC) |

**Recovery path**: implement per SPEC.

---

## Group 4 — karyotype_tier bulk actions (7 buttons, `karyotype_tier.html`)

**Status: ✅ 4 wired, ⏳ 3 disabled-with-reason, ✅ floating-pane toggle shipped**.

Wired ([`karyotype_tier.js:523-650`](../atlases/inversion/pages/review/karyotype_tier.js)):

| ID | Handler |
|---|---|
| `candListExportBtn` ⬇ | JSON download via `candidateToJSON` + Blob URL |
| `candListImportBtn` ⬆ | File picker → JSON parse → `addCandidateToList` per entry |
| `candListClearBtn` ✕ | Confirm → `state.candidateList = []` → `persistCandidateList` |
| `candListBundleBtn` 📝 | Markdown table + TSV bundle download |

Plus a 📌 toggle injected at runtime — pops `#candListPane` out of the page grid into a draggable floating window. Position + floating state persist to localStorage (`atlas.candListFloat.mode` + `atlas.candListFloat.pos`).

Disabled with explanatory tooltip:

| ID | Disabled because |
|---|---|
| `candListRegistryBtn` | Needs per-cohort candidate-registry schema (SCHEMA §20). Use ⬇ export JSON until that ships. |
| `loadRegistryBtn` | Needs the multi-file registry loader (sample_groups.tsv, candidate_intervals.tsv, results_registry/manifest.tsv, evidence_registry/...). |
| `enrichmentImportBtn` | Needs enrichment JSON schema (cluster phases 6+: breakpoints_refined, groups_validated). |

**Recovery path for the 3 disabled**: ship the matching server-side schema, then wire each like the 4 working ones (same `addCandidateToList` pattern, different parser).

**Known limitation of the floating pane**: belongs to karyotype_tier's DOM, so navigating away unmounts it. True cross-page floating ("keep it visible while promoting on haplotype_regimes") requires lifting the panel into atlas-core/shell scope — same code in `core/candidate_mgmt_floater.js` with the candidate-list read from `atlasState.inversion.candidateList`. Deferred until requested.

---

## Group 5 — forgotten L3 features (5 buttons, `local_pca_dosage.html`)

**Status: ✅ 1 deleted, ✅ 2 wired, ⏳ 2 hidden** (each with rationale).

### Deleted (1)

| ID | Was supposed to | Why removed |
|---|---|---|
| `l3PromoteCandBtn` | Promote focal L2 → confirmed candidate | Pure duplicate of `#promoteCandidateBtn` (the working golden promote button above). Per Quentin: "delete." |

### Wired (2)

The rendering branches for `state.spotlight` (single-sample marker) and `state.spotlightTrackedAll` (cross-pane tracked highlight) were already in [`l3_panel.js:3003, 3015, 3184, 3196`](../atlases/inversion/pages/discovery/local_pca_dosage/l3_panel.js); only the click handlers were missing. Wired in [`sidebar.js:454-509`](../atlases/inversion/pages/discovery/local_pca_dosage/sidebar.js):

| ID | Handler |
|---|---|
| `l3SpotlightTrackedBtn` | Toggles `state.spotlightTrackedAll` + persists + re-renders L3 panel + syncs button styling. |
| `l3SpotlightClearBtn` | Clears `state.spotlight` + turns off `state.spotlightTrackedAll` + re-syncs button + re-renders. |

### Hidden (2)

| ID | Was supposed to | Why hidden |
|---|---|---|
| `dhCursorToggleBtn` | Toggle live dosage heatmap (±5 windows around cursor) | Per Quentin: "live dosage ... must be made floating or move to tooling bc later tooling becomes floating." The renderer (`redrawCursorHeatmap` in [`events.js:208`](../atlases/inversion/pages/discovery/local_pca_dosage/events.js)) stays wired so the heatmap still updates when `state.cursorHeatmapOn === true`. Toggle UI needs to land in tooling/floating scope. **Recovery path**: surface a trigger button from the new home (tooling page or floating panel); the state slot + renderer are ready. |
| `l3DetailedBtn` | Show per-tracked-sample → group readout in focal pane | Surprise finding: `state.l3Detailed` is referenced ONLY in the L3 render-fingerprint ([`l3_panel.js:1760`](../atlases/inversion/pages/discovery/local_pca_dosage/l3_panel.js)); no rendering code actually branches on it. Wiring the button alone would force re-render with no visible change. **Recovery path**: implement the missing render branch in `l3_panel.js` (a new conditional block guarded by `if (state.l3Detailed) { ... }` that renders the tracked-sample → group rows), then wire the button. |

---

## Reading-this-doc shortcut for a future audit

If you re-run the dead-button scan and want to know which entries are intentional vs newly-orphaned:

```
For each `<button id="X" style="display:none">` in the page HTML, search this file for "X".
  - Hit: intentional (recovery path described).
  - Miss: newly orphaned — audit individually.
```

The 5 currently-hidden-with-reason are: `l3DetailedBtn`, `dhCursorToggleBtn`, plus the 3 disabled (`candListRegistryBtn`, `loadRegistryBtn`, `enrichmentImportBtn`). The deleted one (`l3PromoteCandBtn`) is gone from HTML — only this doc records it ever existed.
