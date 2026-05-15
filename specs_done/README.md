# `specs_done/` — completed specifications

**Purpose**: home for SPECs whose described system has shipped. Kept
**forever** as the historical record of what each subsystem was
designed to do, which is the seed material for the manual.

## The non-negotiable rule

**Do not delete a SPEC after the code lands.** Move the SPEC from
`specs_todo/` to `specs_done/` and update its top-matter status line
(`Status: SPEC ONLY → Status: SHIPPED`). That's the workflow.

The provenance audit (`_handoff_docs/SPECS_AUDIT.md`, 2026-05-14)
showed that the legacy tarball had a `specs_done/` folder that did
not survive the import into this repo. That's not happening again.
If you implement a SPEC, you move it here. You never delete it.

## Workflow

```
specs_todo/SPEC_foo.md          ← author the SPEC
            │
            │  implement
            ▼
specs_done/SPEC_foo.md          ← move (preserve byte-identical content
                                  except status line + "Implemented in:"
                                  pointer to commit / file paths)
```

When you move a SPEC into here, **add two lines** at the top:

```
**Status**: SHIPPED — was SPEC ONLY until <commit-sha> / <date>.
**Implemented in**: <list of file paths, one per line>
```

That single block is what lets future-you (or the next contributor)
re-derive the manual from the SPECs without re-reading the code.

## What's in here right now

| SPEC | what it describes | implementation |
|------|-------------------|----------------|
| `SPEC_registry_v2.md` | 9-item v2 registry design (versioning + write contract + cache invalidation) | `atlases/inversion/registries/data/*.registry.json` + `atlas-core/server/` Registry.write half is partially shipped; see `specs_todo/SPEC_registry_write_and_page_isolation.md` for the un-shipped half |
| `SPEC_band_track_extraction_and_l3_single_band_rows.md` | het-anchored band-track skeleton + L3 single-band-rows contingency view | `atlases/inversion/shared/band_tracking/` (32 modules) + `pages/discovery/page1/l3_panel.js` + `pages/discovery/page1/band_diagnostics.js` |
| `SPEC_sv_evidence_page.md` | SV evidence page + producer pipeline (sv_genotype_counts_v1 schema, pattern-label decision rule, zone classification, FDR gating) | `pages/review/page_sv_evidence.js` (page) + `js/atlas_sv_evidence.js` (external renderer) + `engines/producers/sv_evidence/` (4 Python scripts) |
| `SPEC_l2_sweep_inheritance.md` | L2-sweep auto-promote pipeline: usability filter, inheritance-group clustering on every usable L2, 6 promotion gates, dismissed-set persistence, cache invalidation, `confirmed: false` discipline | `pages/discovery/page1/l2_sweep.js` (444 LOC) + `pages/discovery/page1.js#applyData` + `shared/inheritance_groups.js` |
| `SPEC_g_panel_unified_groups.md` | G-panel unified-groups popup (Slice 1 shipped: Manual tab re-host + 3-surface single-source-of-truth render; Slice 2 Karyotype + Slice 3 Inheritance pending) | `pages/discovery/page1.html#gPanelOpenBtn` + `pages/discovery/page1/pca_panel.js#renderManualGroupsList` + `pages/discovery/page1/manual_groups.js` |
| `SPEC_lines_panel_candidate_bands.md` | Per-candidate vertical band highlights on page1 lines panel — pure-background paint layer, confirmed-only filter, palette stable across zoom, default-ON cohort-persisted toggle, defensive try/catch | `pages/discovery/page1/lines_panel.js#setLinesPanelCandidateBands` + `pages/discovery/page1/candidates.js#_paintCandidateBands` |
| `SPEC_lasso_inheritance_backgrounds.md` | Fish-set linkage table (Slices 1 + 3 shipped: pure compute + cache + TSV + modal popover; Slices 2 alpha intervals + 4 enlarged page + 5 candidate-page integration deferred) | legacy turn 164 (`_computeLassoLinkage`, `_lassoLinkageGetOrCompute`, `_openLassoLinkagePopover` etc.); migration to modular tree TBD |
| `SPEC_l3_het_dosage_coloring.md` | L3 mini-PCA dot fill by per-sample heterozygosity rate (cold blue → neutral → warm red); K-cluster halo on tracked dots stays K-coloured; toggle disabled until dosage_chunks layer loads; cohort-persisted | `pages/discovery/page1.html#l3HetToggle` + `pages/discovery/page1/l3_panel.js` + `shared/het_rate.js#hetRateColor` |

(See `SPECS.md` at the repo root for the cross-cutting index.)

## Cross-references

- **TODO inventory**: `specs_todo/`
- **mgl_adapter sub-library** (self-contained spec tree): `specs_todo/mgl_adapter/`
- **Master index**: `SPECS.md` at repo root
- **Provenance audit** (why old specs went missing): `_handoff_docs/SPECS_AUDIT.md`
- **Convention origin**: `Atlas/specs_done/` per `_handoff_docs/AUDIT_LOG.md:3517`
