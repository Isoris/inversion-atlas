# `atlases/inversion/pages/` — page directory

This directory hosts all 38 pages of the Inversion Atlas, organised
by **stage** (the user-facing workflow grouping).

**Read first**:
- Root → `atlases/inversion/manifest.json` — the authoritative page
  registry (id, label, stage, paths, tooltip)
- Per-page metadata → `atlases/inversion/registries/data/pages.registry.json`
  — `_doc` + `requires_layers` + `requires_slots` + `preloads`
- Per-page contract → `docs/generated/page_contracts/<page_id>/`
  — what each page does, in/out adapters, hotkeys, known issues
- Cross-cutting findings → `docs/generated/PAGE_CONTRACT_INDEX.md`
- Spec library → `specs_done/` + `specs_todo/` + `SPECS.md`

## Stages (7)

| order | stage | rough role | pages |
|------:|-------|-----------|------:|
| 1 | `discovery` | local-PCA detection scanners (\|Z\|, θπ, GHSL) | 3 |
| 2 | `discovery_2` | supplementary detection / inspection cartridges | 10 |
| 3 | `classification` | per-candidate karyotype / popstats / boundaries / SV / ancestry scroller (absorbs legacy refinement + classification + synthesis) | 6 |
| 4 | `catalogue` | cohort-level catalogues, marker panels, annotation cockpit | 6 |
| 5 | `evolution` | polarize / age / mosaicism / archaeology | 9 |
| 6 | `comparative` | cross-species (Cgar × Cmac × multi-species) | 2 |
| 7 | `help` | static reference (in-app help page) | 1 |

Per-stage READMEs:
- `pages/discovery/README.md`
- `pages/review/README.md`           (the `classification` stage's pages live here on disk)
- `pages/catalogue/README.md`
- `pages/evolution/README.md`
- `pages/comparative/README.md`

## Directory ≠ stage (known discrepancies)

The directory a page lives in does **NOT** always match its
`manifest.json` stage:

| page | dir | manifest stage |
|------|-----|---------------|
| window_summary_table | `pages/discovery/` | `catalogue` |
| negative_regions | `pages/discovery/` | `catalogue` |
| stats_profile | `pages/catalogue/` | `classification` |
| marker_readiness | `pages/catalogue/` | `classification` |
| overview | `pages/catalogue/` | `classification` |
| help | `pages/comparative/` | `help` |

The **stage** is authoritative for the shell's tab grouping.

## Adding a new page

1. Pick a stage (per the manifest's `stages` list).
2. Create `pages/<dir>/<page_id>.html` + `pages/<dir>/<page_id>.js`
   + `pages/<dir>/<page_id>/_state.js` (and other sub-modules as
   needed; see existing pages for the pattern).
3. Add an entry to `manifest.json`'s `pages` array (with `id`,
   `label`, `stage`, `fragment`, `module`, optional `tooltip`).
4. Add an entry to `pages.registry.json`'s `pages` object (with
   `_label`, `_doc`, `requires_layers`, `requires_operations`,
   `requires_slots`, `preloads`).
5. Generate `docs/generated/page_contracts/<page_id>/` —
   `page.manifest.json` + `PAGE_CONTRACT.md`. See existing examples;
   the format is documented at the top of
   `docs/generated/PAGE_CONTRACT_INDEX.md`.
6. If the page exposes a new behaviour, file a SPEC at
   `specs_todo/SPEC_<name>.md` (per `specs_todo/README.md`).

## Subdirectories

Each page entry typically has a sibling subdirectory containing the
page-private sub-modules:

```
pages/discovery/local_pca_dosage.html        ← HTML shell
pages/discovery/local_pca_dosage.js          ← main entry (mount/unmount/applyData)
pages/discovery/local_pca_dosage/            ← sub-modules
    _state.js                       ← _pageState + setter
    _data.js                        ← schema detection + accessors
    sim_panel.js                    ← per-panel renderers
    z_panel.js
    lines_panel.js
    pca_panel.js
    l3_panel.js
    candidates.js
    events.js
    hotkeys.js
    sidebar.js
    ...
```

The `_state.js` convention (per the round-4 split methodology):
each page owns a `_pageState` live binding that the sub-modules
import; the entry's `mount()` calls `_setActiveState(state)` so the
sub-modules see the active mount's state via ES module live-binding.

## Tier breakdown (per `PAGE_CONTRACT_INDEX.md`)

- ✅ **shipped** (full renderer present): ~25 pages
- 🟡 **stub / empty-state / Phase 1** (renderers TODO or
  partial): ~10 pages
- 🔵 **thin-loader** (external `window.*` renderer): 3 pages
  (popstats, ancestry_per_window, sv_evidence)
- 🆕 **fresh implementations** (legacy shipped HTML shell only):
  4 pages (catalogue, window_summary_table, confirmed_carousel, negative_regions)
