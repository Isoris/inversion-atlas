# local_pca_theta_pi — local PCA θπ — Page Capability Contract

**Atlas**: inversion
**Stage**: discovery (round 1 — local-PCA scanners)
**Page type**: core_page (sister to local_pca_dosage)
**Status**: active (empty-state until θπ layers ship)
**Also known as**: page_theta_pi, "θπ scanner"

## Purpose

Sister page to local_pca_dosage — same six-panel architecture, but driven by
per-sample nucleotide diversity (θπ) rather than dosage. This is a
chromosome-wide diversity scanner that provides an **orthogonal
evidence axis** to local_pca_dosage. Regions hit by both local_pca_dosage and local_pca_theta_pi are
near-certainly real biology; regions hit only by local_pca_theta_pi are sweeps
/ balancing selection invisible to genotype-based scrubbers.

## Capabilities

- Render six panels mirroring local_pca_dosage but on θπ axis:
  CUSUM hero, sim_mat, |Z|, lines, anchor strip, PCA.
- Toggle layer-status chips (per `[data-th-layer]` selector) based
  on whether each θπ layer is present in `state.layersPresent`.
- Activate panels when the corresponding θπ data layer arrives
  (empty-state placeholder hides on first layer arrival).
- Dispatch panel renderers from local_pca_dosage's `applyData()` when θπ layers
  are present in the loaded chromosome JSON (so the θπ panels paint
  alongside local_pca_dosage's PCA panels on shared chromosome data).

## Required data

- **Layers**: `scrubber_main` (mandatory; same as local_pca_dosage)
- **Slots**: `activeChrom`

## Optional layers (drive panel visibility)

- `theta_pi_per_window`
- `theta_pi_local_pca`
- `theta_pi_envelopes`
- `cusum_theta`

## User interactions

- Scrubber cursor — shared with local_pca_dosage (`state.cur`).
- Layer status chips — visual only (🟢 loaded / ⚪ not loaded).

## Outputs

**Preview-only**:
- θπ per-window CUSUM
- θπ-based sim_mat
- θπ robust |Z|
- θπ per-sample lines
- θπ PCA scatter

**Committable**: none — local_pca_theta_pi is a read-only diversity scanner.

## Connected analyses / adapters

Reused primitives from `atlases/inversion/shared/`:
- `per_l2_cluster.js` — `contextFromState`, `clusterL2`,
  `ClusterCache`
- `het_rate.js` — `hetRateColor`
- `hungarian.js` — `alignLabels`, `hungarianChainProjection`,
  `concordanceMatrix`
- `contingency.js` — `buildContingency`, `computeARI`, `computeNMI`,
  `cramersV`
- `kmeans.js` — `kmeans1D`, `kmeans2D`, `silhouette1D`, `adaptiveK1D`
- `color_helpers.js` — `simColor`

## Mirror dispatch from local_pca_dosage

local_pca_dosage's `applyData()` looks at the loaded chromosome JSON; if any
`theta_pi_*` layer is present it dispatches the 8 panel renderers
from this file. This means **local_pca_theta_pi panels are rendered while local_pca_dosage
is mounted** (not only on local_pca_theta_pi directly). The local_pca_theta_pi module also
exports its own atlas-router lifecycle for when the page is mounted
directly.

## Sub-modules in `local_pca_theta_pi/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter — mirrors local_pca_dosage lifecycle pattern |

## Status and known issues

- Empty-state until R pipeline ships any θπ layer.
- L3 contingency panel mirror is not wired (local_pca_dosage has it; local_pca_theta_pi
  stops at PCA). Adding it would close the parity gap.
- All 13 chat-33 TODO_MISSING markers in this module were resolved
  on 2026-05-07 (round 5 step 10): every flagged name turned out to
  be closure-scoped (extractor didn't model lexical scope).

## Documents

- **Registry doc**: `atlases/inversion/registries/data/pages.registry.json` → `pages.local_pca_theta_pi._doc`
- **Specs**: none directly
- **Handoffs**: `_handoff_docs/HANDOFF_2026-05-07_chat36_round5_step10_done.md`,
  `atlases/inversion/pages/discovery/BATCH_1_NOTES.md`
- **User guide**: unknown
- **Legacy source**: `legacy/Inversion_atlas.html` lines 53045-54168 (verbatim 8 helpers)

**Confidence**: high
