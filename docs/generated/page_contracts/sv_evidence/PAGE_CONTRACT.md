# sv_evidence — SV evidence — Page Capability Contract

**Atlas**: inversion · **Stage**: classification · **Status**: active (thin loader)

## Purpose

Read-only candidate-level view of **SV calls** clustered around a
candidate's boundaries, scored against the karyotype groups. Loads
`json/sv_genotype_counts/<cid>.json` per candidate.

## Architecture

sv_evidence is a **thin loader stub**. The renderer is
`window.AtlasSVEvidence` — an **object** with `.init` /
`.loadCandidate` / `.destroy` methods (distinct from popstats/ancestry_per_window's
single-function renderers). Defined externally in
`js/atlas_sv_evidence.js`.

## Capabilities

Renders three stacked panels:

- **SV table** — caller, type, chrom, pos, len, support, gt-counts
- **UpSet plot** — caller intersections
- **Dosage heatmap** — step-6 spec dosage view

Lifecycle:
- `init` — guarded by `mod.__pageInitDone`; called once
- `loadCandidate(cid)` — guarded by `mod.__lastCid`; refired only on
  candidate id change
- `destroy` — called on unmount via `hideSvEvidencePage`

## Required data

- **Layers**: `candidate_sv_counts`
- **Slots**: `activeCandidate`

Registry alignment ✅ — unlike popstats and ancestry_per_window, this page's
registry entries match what the page actually does.

## Producer pipeline

`json/sv_genotype_counts/<cid>.json` is **precomputed** by:

- `atlases/inversion/engines/producers/sv_evidence/` (4 Python
  scripts + shared IO module)
- Aggregates per-caller SV genotype counts per candidate

There is **no live compute endpoint** for SV evidence. If live
aggregation is wanted, an endpoint must be added to
`popstats_server.py`.

## User interactions

- Candidate switch triggers `AtlasSVEvidence.loadCandidate(cid)`
  automatically.

## Outputs

Preview-only. No committable outputs.

## Sub-modules in `sv_evidence/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |

## Status and known issues

- External `window.AtlasSVEvidence` absent → empty-state fallback in
  `#sv_evidence_root` (guarded by `.__svInitFailed`).

## Documents

- **Registry doc**: `pages.registry.json` → `pages.sv_evidence._doc`
- **Specs (done)**: `specs_done/SPEC_sv_evidence_page.md` (authored 2026-05-15 from shipped code; previously listed as missing in SPECS_AUDIT.md)
- **Producer pipeline**: `atlases/inversion/engines/producers/sv_evidence/`
- **Handoffs**:
  `_handoff_docs/HANDOFF_2026-05-07_chat36_round5_step19_done.md`
  (third + final review tier-1 thin-loader-stub migration),
  `atlases/inversion/pages/review/BATCH_2_NOTES.md`
- **User guide**: unknown
- **Legacy source**: `legacy/Inversion_atlas.html` lines 9329-9331
  (HTML shell) + line 54981 (script tag)

**Confidence**: high
