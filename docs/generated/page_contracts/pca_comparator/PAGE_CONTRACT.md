# pca_comparator — page contract

**Slug**: `pca_comparator` · **Stage**: `discovery_2` · **Status**: Phase 1
shipped 2026-05-18

## Purpose

Three synchronized mini-PCA panels at the active window, one per
evidence axis: dosage / θπ / GHSL. Each panel uses its native PCA
coordinate system. K-band coloring inherits from the anchor's K-means
(default: dosage) so each sample keeps its band color across all 3
panels — the question *"is this fish consistently in band g0 across all
3 axes?"* is answered by color + position agreement.

Per [SPEC_local_pca_comparator.md](../../../specs_todo/SPEC_local_pca_comparator.md)
Phase 1 = side-by-side. Phases 2 + 3 (per-sample trajectory, Procrustes
overlay) are deferred — see SPEC for rationale.

## Files

- HTML: `atlases/inversion/pages/discovery/pca_comparator.html`
- JS entry: `atlases/inversion/pages/discovery/pca_comparator.js`
- Sub-modules: `atlases/inversion/pages/discovery/pca_comparator/`
  - `_state.js` — `_pageState` binding (mirrors `tree_panel/_state.js`)
  - `renderer.js` — `paintPanel` + `findSampleAtPixel` + retina-correct
    canvas fit + per-layer data accessors

## Data sources

| panel | source | availability |
|-------|--------|--------------|
| dosage | `state.data.windows[w].pc1[] / pc2[]` | always |
| θπ | `state.data.theta_pi_local_pca[w]` | optional (loaded with θπ JSON) |
| GHSL | `state.data.ghsl_panel.local_pca[w]` | optional (loaded with GHSL JSON) |

When the optional layers are absent, the corresponding panel shows
`absent` in its header status badge. The dosage panel always renders.

## Interactions

- **Anchor selector** — picks which evidence axis drives the K-band
  palette. Phase 1 informational (all anchors pull from dosage K-means
  since θπ + GHSL don't yet ship clusterings).
- **←/→** — scrubs the shared window cursor (state.cur). Shift+arrow =
  20-window quick-skip. Hotkey gated to not fire in INPUT/TEXTAREA/SELECT
  and only when this page is active.
- **Hover** — moving the cursor over a dot in any panel highlights that
  sample in all 3 panels via `state.hoveredSample`. The header
  readout shows the CGA / individual ID.

## State surface (read-only consumer)

Reads:
- `atlasState.inversion._local_pca_dosage_state` — the shared atlas state
  (windows, samples, cur, tracked, lockedLabels, candidate). The
  comparator NEVER writes to this slot.
- `atlasState.inversion._page_pca_comparator_state` — local panel state
  (anchor, hoveredSample, teardown handlers).

Writes: none.

## Known issues / pending

- Procrustes overlay (Phase 3) not implemented — the panels show their
  native coordinate spaces.
- θπ + GHSL anchor options currently route to the dosage K-means since
  they don't ship their own clusterings yet.
- Slab-mode aggregation (compareUnit win5 / win10) not honoured — Phase 1
  uses the cursor window only.

## References

- `specs_todo/SPEC_local_pca_comparator.md` — design exploration with
  the 3 options (side-by-side, Procrustes overlay, per-sample trajectory)
  and the phased rollout rationale.
- `docs/generated/page_contracts/local_pca_dosage/PAGE_CONTRACT.md` —
  the page's drawPCA architecture that the renderer is a small
  adaptation of.
