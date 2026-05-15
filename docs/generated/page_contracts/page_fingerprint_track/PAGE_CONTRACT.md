# page_fingerprint_track — fingerprint track — Page Capability Contract

**Atlas**: inversion
**Stage**: discovery_2
**Page type**: core_page (Phase 1 cartridge)
**Status**: active (Phase 1)

## Purpose

Per-window diversity-regime fingerprint track. Cartridge
implementation of HANDOFF_6. Shows a horizontal regime strip across
the candidate's windows, switch markers above the strip, a scenario
badge in the header, and a treemap of regime fragment proportions.

## Capabilities (Phase 1)

- Render a single horizontal regime strip across the candidate
  (canvas-based).
- Display switch markers above the strip:
  - ▲ return switch
  - ▼ terminal switch
  - · brief switch (hidden by default)
- Show a **scenario badge** in the header — verdict among:
  `stable`, `recombinant_tract`, `two_adjacent`, `nested`, `complex`,
  `insufficient`.
- Render a **proportions treemap** of regime fragment proportions
  (same colour palette as the main strip).
- Hover linkage on the window cells and the switch markers.
- Click-to-toggle a window into the panel's selection store.
- Optionally display window labels under the strip.

## Deferred (not in Phase 1)

- Genomic coordinates axis (start_bp / end_bp) — needs window
  metadata wired through `atlasState`. Today uses window indices.
- Cross-panel linkage with tree / PCA / heatmap (separate commit
  once HANDOFF_2's candidate-mode slot is wired).
- Stage 1 in-browser π / dXY / Fst from Beagle (separate primitive).

## Required data

- **Slots**: `activeCandidate` (reads
  `atlasState.inversion.fingerprint_track_state`)

## Input contract

```
atlasState.inversion.fingerprint_track_state = {
  fingerprint_result:    shared/mgl_fingerprinter output,
  candidate_label?:      string for the header,
  regime_colors_by_id?:  Object<number,string> overrides,
  window_labels?:        Array<string>,
}
```

This object must be populated by an upstream producer.

## User interactions

- Hover a window cell — selection store hover state.
- Hover a switch marker — selection store hover state.
- Click a window — toggles it in / out of the selected window set.

## Outputs

**Preview-only**:
- fingerprint regime strip
- switch markers (return / terminal / brief)
- scenario badge verdict
- fragment proportions treemap

**Committable**: none.

## Connected analyses / adapters

- `shared/mgl_fingerprinter.js` — `fingerprintCandidate` (the
  producer; the page consumes the result via the input contract).

## Sub-modules in `page_fingerprint_track/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |
| `renderer.js` | canvas painter for the fingerprint strip + switch markers |
| `proportions.js` | treemap-style regime fragment proportions plot |
| `selection.js` | hover (window cell or switch marker) + click-to-toggle selected window set |

## Status and known issues

- Phase 1 only; coordinate axis and cross-panel linkage deferred.
- Page not present in `pages.registry.json` — only registered in
  `manifest.json`. Unknown why the discrepancy.

## Documents

- **Registry doc**: unknown (not in `pages.registry.json`)
- **Specs (todo)**:
  - `specs_todo/mgl_adapter/HANDOFF_6_fingerprinter.md` (canonical)
  - `specs_todo/pages_fingerprint_track/_to_do/HANDOFF_6_fingerprinter.md` (duplicate)
- **Handoffs**: HANDOFF_6 (above)
- **User guide**: unknown
- **Legacy source**: n/a — new cartridge

**Confidence**: high
