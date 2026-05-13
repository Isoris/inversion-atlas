# mgl_adapter spec set — inversion-atlas slice

This is the inversion-atlas-side mirror of the mgl_adapter spec set
(multi-allelic / tri-allelic SNP extension to the inversion atlas).
Dropped here from `mgl_adapter_v22_dragdrop_fixed.tar.gz`.

The full spec architecture lives in `SPEC_0_master.md` (1449 LOC).
Use it as the single source of truth for cross-cutting concerns
(JSON shapes, anchor modes, shared rendering state).

---

## What's in this folder

| File | Purpose | Repo |
|---|---|---|
| `SPEC_0_master.md`           | Canonical reference for the whole spec set | cross-cutting |
| `README_specs.md`            | Original spec-set README from the drop | cross-cutting |
| `HANDOFF_1_producer.md`      | Per-window PCA + heatmap JSON producer | catfish-inversion-analysis (VS) |
| `HANDOFF_3_validation.md`    | Real-data LG28 sanity check | catfish-inversion-analysis (VS) |
| `HANDOFF_7_nested_inversion.md` | Nested inversion detection (conditional re-scan) | catfish-inversion-analysis (VS) |
| `HANDOFF_8_dosage_clustering.md` | Adaptive Stickleback-style dosage curves | catfish-inversion-analysis (VS) |
| `HANDOFF_9_dosage_similarity.md` | Dosage similarity matrix + outer/inner blocks | catfish-inversion-analysis (VS) |

The producer side (already implemented in `mgl_adapter/v5`) lives
in the **catfish-population-analysis** repo:
`MODULE_X_mgl_adapter/`. The 4 catfish-inversion-analysis modules
that consume it (anchored_pca, validation, fingerprinter, tree)
are NOT in this repo — they're slated for VS-side implementation.

---

## What inversion-atlas does with these specs

The atlas-side handoffs (already in place at `specs_todo/pages_*/_to_do/`):

| Handoff | Atlas-side folder | What it builds |
|---|---|---|
| HANDOFF_2_atlas_ui  | `specs_todo/pages_candidate_mode/_to_do/`   | Page-1 candidate mode UI (dropdown for 4 views × 2 weighting × 2 anchor modes) |
| HANDOFF_4_caching_custom | `specs_todo/pages_custom_views/_to_do/`  | Custom user views + caching |
| HANDOFF_5_tree (atlas side) | `specs_todo/pages_tree_panel/_to_do/`   | Inversion-core haplotype tree panel |
| HANDOFF_6_fingerprinter (atlas side) | `specs_todo/pages_fingerprint_track/_to_do/` | Per-window fingerprint regime track |
| HANDOFF_10_atlas_similarity | `specs_todo/pages_similarity_panel/_to_do/` | Interactive scrubbable similarity-matrix panel |

These specs depend on JSON outputs from the producer modules (in
catfish-inversion-analysis). The atlas-side work is mostly:
- consumer modules in `shared/` (JSON parsers, validators, derivers)
- page cartridges in `pages/<group>/page_*` (renderers)
- per-page state shape extending the existing `state.candidateMode`
  slot already shipped in page1

---

## What's actionable in this repo (today)

| Item | Scope | Notes |
|---|---|---|
| Validate JSON shapes from SPEC_0 §8 (PCA), §9 (heatmap) | atlas-side, pure compute | Add `shared/mgl_pca_json.js` + `shared/mgl_heatmap_json.js` with `validate*Payload` + `extract*Layers` |
| Pre-build shared rendering state (SPEC_0 §10) | atlas-side, pure state | Add `shared/mgl_render_state.js` with `centering / polarity / color_mode / sample_order` derivers |
| Stub the candidate-mode state slot extension on page1 | cartridge wiring | Extend `pages/discovery/page1/_state.js` per HANDOFF_2 §"candidate-mode state machine" |
| Build the tree-panel state slot + parsing helpers | atlas-side, pure compute | HANDOFF_5 atlas-side scaffolding |
| Build the fingerprinter track state slot + helpers | atlas-side, pure compute | HANDOFF_6 atlas-side scaffolding |

Each of these can ship before any producer JSONs exist — they're
empty-state-tolerant by design (consumers, not producers).

---

## What needs cross-repo work (VS-side)

| Item | Repo |
|---|---|
| MODULE_5_anchored_pca producer | catfish-inversion-analysis |
| MODULE_5_validation runner | catfish-inversion-analysis |
| MODULE_7_fingerprinter | catfish-inversion-analysis |
| MODULE_6_tree | catfish-inversion-analysis |

These produce the JSON layers the atlas consumes. Atlas can be
built against the documented shapes (SPEC_0 §8-9) before the producer
ships.

---

## Recommended build order (atlas-side)

1. **JSON-shape primitives** (`shared/mgl_pca_json.js`,
   `shared/mgl_heatmap_json.js`) — validators + accessors for the
   producer's JSON contracts. Pure compute, fully testable without
   any producer output.

2. **Shared rendering state** (`shared/mgl_render_state.js`) — the
   centering / polarity / color-mode / sample-order derivers from
   SPEC_0 §10. Powers the dual-panel coordination so PCA dots and
   heatmap rows move together when controls change.

3. **Candidate-mode state extension on page1** — extend the existing
   `pages/discovery/page1/_state.js` slot per HANDOFF_2 §"candidate-
   mode state machine". Sets the contract for when producer JSONs
   arrive.

4. **Stubs for the 3 new panels** (`pages/discovery/page1/tree_panel.js`,
   `fingerprint_track.js`, `similarity_panel.js`). Each empty-state
   tolerant: when its layer isn't loaded, show a "not computed"
   message.

After the producer ships, fill in the renderers for the four panels.

---

## Why this lives under specs_todo/mgl_adapter/

The spec set is canonical for the multi-allelic extension. Keeping
the cross-cutting specs in one folder (rather than scattering them
into `specs_todo/SPEC_*.md`) preserves the navigation pattern
established by the drop's `README_specs.md`. The per-panel atlas-side
handoffs stay in their `specs_todo/pages_*/_to_do/` homes (matches
where the eventual page cartridges will live).

When work on a handoff is done, move it from `_to_do/` to `done/`
(or delete it) per the convention in the drop's README.
