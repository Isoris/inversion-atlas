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

## Current contents (2026-05-15)

| SPEC | rough status |
|------|--------------|
| `SPEC_arrangement_color_mode_and_arrangement_calls_v1.md` | possibly DONE — `shared/arrangement_calls.js` exists; needs verification |
| `SPEC_busco_4d_age_brackets.md` | possibly DONE — `shared/busco_4d_age.js` exists; needs verification |
| `SPEC_busco_anchors_v1.md` | possibly DONE — `shared/busco_anchors.js` exists; needs verification |
| `SPEC_copy_origin_painting.md` | SPEC ONLY per its status line ("awaiting audit before implementation") |
| `SPEC_fish_ancestry_scroller.md` | partial — `pages/review/page_ancestry_scroller/` exists on disk but not in `manifest.json`; needs wiring |
| `SPEC_functional_burden_per_candidate_v1.md` | unknown |
| `SPEC_inversion_age_atlas_surface_AMENDMENT.md` | amendment to a parent SPEC that itself isn't in the repo |
| `SPEC_inversion_divergence_network_v1.md` | unknown |
| `SPEC_mendelian_inheritance_para_vs_peri_v1.md` | partial — `atlases/inversion/analysis/mendelian.js` + `mendelian_inheritance.js` ship; needs verification |
| `SPEC_page1_candidate_mode_ui.md` | likely DONE — page1 candidate mode ships |
| `SPEC_regime_annotation_v34.md` | SPEC ONLY per its status line |
| `SPEC_registry_v1.md` | superseded by `specs_done/SPEC_registry_v2.md` |
| `SPEC_registry_write_and_page_isolation.md` | half SHIPPED (page-isolation enforced), half pending (Registry.write contract) |
| `SPEC_xpehh_per_window_track.md` | unknown |
| `mgl_adapter/` | self-contained spec sub-tree (SPEC_0_master + 5 numbered HANDOFFs); see its own README |

The "needs verification" / "possibly DONE" rows are a one-time
classification debt — a follow-up audit should:
1. Open each SPEC
2. Check whether the named code paths exist + match the SPEC's contract
3. If shipping: move to `specs_done/` and add the `Implemented in:` block
4. If not: leave here and add a clearer status line

## Cross-references

- **Completed specs**: `specs_done/`
- **Master index**: `SPECS.md` at repo root
- **Missing SPEC names** (referenced in code but not on disk anywhere): see the *referenced but missing* table in `_handoff_docs/SPECS_AUDIT.md`
