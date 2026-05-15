# page8 — per-window summary table — Page Capability Contract

**Atlas**: inversion · **Stage**: catalogue (per manifest.json) · **Status**: active (fresh implementation)

## Purpose

Per-window summary table for the active chromosome — a sortable
read-out of |Z|, λ1/λ2, eigenvalue ratio, and ANGSD biallelic-SNP
counts per window, alongside a per-window strip canvas coloured by
the active sortable column (default = |Z|) with L1/L2 zone bars
on top.

## Capabilities

- Sortable table of per-window metrics.
- Strip canvas coloured by the active sortable column.
- L1/L2 zone bars on top of the strip.
- Filter chips: L2 cluster + |Z| threshold.
- Read-only ANGSD bi-SNP discovery parameter panel (–GL / –minQ /
  –SNP_pval) for full provenance.

## Required data

- **Layers**: `scrubber_main`
- **Slots**: `activeChrom`

## Outputs

Preview-only. No committable outputs.

## Sub-modules in `page8/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |
| `window_summary.js` | fresh implementation; legacy had only the HTML shell |

## Status and known issues

- Directory / stage discrepancy: `manifest.json` says
  `stage: "catalogue"` but file lives under `pages/discovery/`.
- Legacy had no JS implementation; this is a fresh build.

## Documents

- **Registry doc**: `pages.registry.json` → `pages.page8._doc`
- **Handoffs**: `_handoff_docs/HANDOFF_2026-05-07_chat36_round5_step13_done.md`,
  `atlases/inversion/pages/discovery/BATCH_1_NOTES.md`
- **User guide**: unknown
- **Legacy source**: `legacy/Inversion_atlas.html` lines 7672-7774 (HTML shell ONLY)

**Confidence**: high
