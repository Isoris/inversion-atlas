# help — help — Page Capability Contract

**Atlas**: inversion · **Stage**: help · **Status**: active (static)

## Purpose

Static quick-reference / help page. ~1158 LOC of HTML help content
(help / vocabulary / hotkeys / pipeline reference). **No interactive
elements requiring JS.**

This page IS the user guide for the atlas.

## Label correction

`HANDOFF_BATCH_5.md` mislabelled help as "Multi-species comparison
page" — that is **incorrect**. The actual multi-species cockpit is
**multi_species_cockpit**. help is help. (Preserved as a corrected note in the
module header.)

## Capabilities

- Display static HTML help content. That's it.

## Required data

None.

## User interactions

None — purely declarative HTML.

## Outputs

None.

## Exports

- `renderPage5()` — true no-op (kept for tabBar router contract)
- `PAGE5_META` = `{id: 'help', stage: 'help', label: 'help', num: 16, static: true}` — read by the tabBar router at legacy line 5142

## Sub-modules in `help/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter (degenerate; renderPage5 is no-op) |

## Documents

- **Registry doc**: `pages.registry.json` → `pages.help._doc`
- **Handoffs**: `atlases/inversion/pages/comparative/BATCH_5_NOTES.md`
  (with the label-correction note)
- **User guide**: self — this page IS the user guide
- **Legacy source**: `legacy/Inversion_atlas.html` lines 8159-9316
  (HTML help content) + CSS 2054-2071 + tabBar router 5142

**Confidence**: high
