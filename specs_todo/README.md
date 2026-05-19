# `specs_todo/` — pending specifications

**Purpose**: SPECs that have been authored but whose described system
has not fully shipped. The "design backlog".

## Workflow

```
write SPEC here  →  implement  →  move file to specs_done/
                                  (update Status line + add
                                   Implemented in: pointer)
```

**Critical rule** (see `specs_done/README.md`): **never delete a SPEC**.
When the system ships, move the file to `specs_done/`. That's the
single source of truth for what the system was designed to do, and
the seed material for the manual.

## Current contents (audited 2026-05-15)

Each row shows the **shipped half** (atlas-side JS already in
`shared/` or `analysis/`) vs the **pending half** (producer pipeline
NOT yet built, OR page integration NOT yet wired).

A SPEC stays here as long as ANY required half is pending. Once
fully shipped: move to `specs_done/` with an `Implemented in:` block.

| SPEC | shipped half | pending half | net status |
|------|--------------|--------------|-----------|
| `SPEC_arrangement_color_mode_and_arrangement_calls_v1.md` | `shared/arrangement_calls.js` (decoder, palette, per-sample voting, JSON validator); `shared/sample_color.js` arrangement mode dispatcher | `arrangement_calls_v1.json` producer (atlas-side runner OR LANTA-side step — §6) | **PARTIAL — producer pending** |
| `SPEC_busco_4d_age_brackets.md` | `shared/busco_4d_age.js` (3 frozen μ values, dxy→age_my, block builder, JSON validator, formatters) | `STEP_C01f_e_emit_busco_4d_age.py` (LANTA Python producer; spec defines it but does not exist yet) | **PARTIAL — producer pending** |
| `SPEC_busco_anchors_v1.md` | `shared/busco_anchors.js` (6 exports: schema validator, indexing, density / window helpers) | page-16 ribbon-plot ticks integration; page-14 architecture-class auto-suggest integration | **PARTIAL — page integration pending** |
| `SPEC_copy_origin_painting.md` | none | full implementation — explicitly SPEC ONLY per its own status line ("awaiting audit before implementation"). Stage 5.6 of the v3.4 pipeline. | **SPEC ONLY** |
| `SPEC_fish_ancestry_scroller.md` | `pages/review/fish_ancestry_scroller/` (4-module subdir + entry .js/.html) + `shared/ancestry_alignment.js` + `shared/ancestry_bricks.js` | manifest.json registration (page exists on disk but shell can't mount it); cluster-side `instant_q` (Engine B) per-RF producer integration | **PARTIAL — unregistered + producer pending** |
| `SPEC_functional_burden_per_candidate_v1.md` | `shared/functional_burden.js` + `shared/wilcoxon.js` + `shared/contingency.js` (primitives all ship) | per-candidate overlay panel + producer schema | **PARTIAL — UI + producer pending** |
| `SPEC_inversion_age_atlas_surface_AMENDMENT.md` | various age-class JS pieces ship (`shared/age_model_suggester.js`, `shared/busco_4d_age.js`) | the **parent** `SPEC_inversion_age_atlas_surface.md` is missing from disk (referenced from this amendment + age_divergence but never authored) | **AMENDMENT — parent missing** |
| `SPEC_inversion_divergence_network_v1.md` | `shared/divergence_network.js` (overlay primitive ships) | per-candidate overlay panel wiring; cluster-side dxy-by-arrangement producer | **PARTIAL — UI + producer pending** |
| `SPEC_mendelian_inheritance_para_vs_peri_v1.md` | `analysis/mendelian.js` + `analysis/mendelian_inheritance.js` (3-state Mendelian verdict — base) + `shared/contingency.js` (fisher2x2 + chiSquare) + `shared/haplotype_vocab.js` | v1 extension (paracentric-vs-pericentric cohort comparison + per-candidate goodness-of-fit) — extends the base verdict | **PARTIAL — v1 extension pending** |
| `SPEC_page1_candidate_mode_ui.md` | `shared/candidate_mode.js` (Parallel Candidate Registry — turn 88) + local_pca_dosage candidate-mode infrastructure | HANDOFF-2 detailed mode (16 PCA JSONs + 4 heatmap JSONs per candidate); local_pca_dosage detailed-mode UI is not wired | **PARTIAL — detailed mode pending** |
| `SPEC_regime_annotation_v34.md` | none | full annotation layer (Stage 5.5) — explicitly SPEC ONLY per its own status line ("awaiting audit before implementation") | **SPEC ONLY** |
| `SPEC_registry_v1.md` | n/a — superseded | use `specs_done/SPEC_registry_v2.md` | **SUPERSEDED** |
| `SPEC_registry_write_and_page_isolation.md` | page-isolation discipline (zero cross-page imports as of commit 4e695f7) | Registry.write contract (defers to `specs_done/SPEC_registry_v2.md`) | **HALF SHIPPED** |
| `SPEC_xpehh_per_window_track.md` | `shared/xpehh_per_window.js` (compute primitive ships) | popstats / ancestry page integration | **PARTIAL — page integration pending** |
| `mgl_adapter/` | self-contained spec sub-tree (SPEC_0_master + 10 numbered HANDOFFs + 2 READMEs); per-page consumer pages all ship (HANDOFF_5 → tree_panel, HANDOFF_6 → fingerprint_track, etc. — see page contracts) | full cluster-side producer pipeline + atlas-core promotion | **PARTIAL — library complete, integration in flight** |

### Net audit summary

- **2 SPEC ONLY** (explicit in their status lines): `SPEC_copy_origin_painting`, `SPEC_regime_annotation_v34`
- **10 PARTIAL** (some half ships, some half pending) — these are
  the priority for full-stack shipping
- **1 AMENDMENT to a missing parent** (`SPEC_inversion_age_atlas_surface_AMENDMENT`)
- **1 SUPERSEDED** (`SPEC_registry_v1`)
- **1 HALF SHIPPED** (`SPEC_registry_write_and_page_isolation`)

### Decision when a SPEC reaches "fully shipped"

When both halves ship for a PARTIAL SPEC:
1. Move the file from `specs_todo/` to `specs_done/`.
2. Replace its top status block with:
   ```
   **Status**: SHIPPED — was PARTIAL until <commit-sha> / <date>.
   **Implemented in**: <list of file paths>
   ```
3. Update both `specs_todo/README.md` (this file) and
   `specs_done/README.md` to move the row.
4. Audit any cross-references (in code comments, in other SPECs)
   and update paths if needed.

## Cross-references

- **Completed specs**: `specs_done/`
- **Master index**: `SPECS.md` at repo root
- **Missing SPEC names** (referenced in code but not on disk anywhere): see the *referenced but missing* table in `_handoff_docs/SPECS_AUDIT.md`
