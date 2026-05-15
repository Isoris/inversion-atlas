# page11 — boundaries — Page Capability Contract

**Atlas**: inversion · **Stage**: classification · **Status**: active

## Purpose

Refines a promoted candidate's `[start_bp, end_bp]` into approximate
left/right **boundary zones** using multiple evidence tracks.
Auto-propose runs a `BOUNDARY_TRACK_WEIGHTS`-weighted algorithm;
manual override at the scrubber cursor via E (left) / F (right)
hotkeys.

## Terminology contract

- `boundary_zone` — default verdict; what auto-propose ever produces
- `exact_breakpoint` — reserved for junction-level evidence only

## Capabilities

- **Auto-propose** boundary zones from weighted multi-track evidence
  (`_bndAutoPropose`).
- **Manual override** of left or right boundary at the scrubber
  cursor.
- **Save** the boundary annotation onto the candidate.
- **Reset** to clear the proposal.
- **9 scan radii**: 1 kb / 5 kb / 10 kb / 25 kb / 100 kb / 1 Mb /
  1.5 Mb / 2 Mb / 5 Mb. Smaller four match MODULE_3 θπ scales
  (`win5000.step1000`, `win10000.step2000`); upper four kick in
  automatically beyond `CANDIDATE_HUGE_BP` via `_boundaryScanRange`.
- **Status selector**: `boundary_zone_only` / `SV_supported` /
  `junction_supported`.
- **Panels**: track stack, summary, auto-scan classification, TE
  density (turn 18), ncRNA density (rRNA / tRNA / ncRNA-other,
  turn 116), focal-vs-background widget (turn 117).

## Required data

- **Slots**: `activeCandidate`
- **Actually consumed**:
  - `state.candidate` — active candidate id / chrom / start_bp / end_bp / K
  - `state.candidateList` — for the candidate dropdown
  - `state.data` — transient sub-fields
  - `state.repeatDensity` — per-chrom TE density (lazily created)
  - `state.ncRNADensity` — per-chrom ncRNA layer
- **Registry says (mismatched)**: `candidate_final_class`,
  `candidate_breeding_card` (see Known issues)

## User interactions / hotkeys

- **E** — left override (at scrubber cursor)
- **F** — right override
- **B** — save
- **R** — reset
- **A** — auto-propose

## Outputs

**Preview-only**:
- per-track weighted score along the candidate's flanks
- auto-propose left/right boundary zones
- TE / ncRNA / focal-vs-bg panels

**Committable**:
- boundary annotation persisted onto the candidate
  (`state.candidate.boundary_zone`)

Commit policy: manual only.

## Sub-modules in `page11/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |
| `boundaries.js` | pure-helper port — constants + binary search + smoothing + MAD normalization |
| `boundaries_ui.js` | toolbar wiring + state-mutating actions |

## Status and known issues

- **REGISTRY MISMATCH (flagged step 22)**: declared
  `candidate_final_class + candidate_breeding_card` look misplaced.
  `candidate_final_class` looks like page4's territory;
  `candidate_breeding_card` does not appear anywhere in page11
  source. **Swap hypothesis**: may have been swapped with page4's
  declared `candidate_sv_counts + candidate_boundaries`.
- **31 TODO_MISSING helpers** (`_bnd*` / `_wireRepeatDensity*`) —
  mount-time render is wrapped in try/catch because the populated
  path hits these. Cross-page audit confirms they are
  page11-private (not fold-in opportunities).
- `mount()` installs document-level keydown listener for E/F/B/R/A;
  `unmount()` removes via `_bndDetachHotkeys`.

## The final migration

This was step 22 — **the final review-stage migration**. Migration
of the 21 review-stage pages was declared complete at this point
(see HANDOFF_2026-05-07_chat36_round5_step22_done.md).

## Documents

- **Registry doc**: `pages.registry.json` → `pages.page11._doc` (the
  fourth registry mismatch flag; swap hypothesis with page4)
- **Handoffs**:
  `_handoff_docs/HANDOFF_2026-05-07_chat36_round5_step22_done.md`
  (the final migration),
  `atlases/inversion/pages/review/BATCH_2_NOTES.md`
- **User guide**: unknown
- **Legacy source**: `legacy/Inversion_atlas.html` lines 7906-7921
  (HTML shell) + 30175-30314 (`renderBoundariesPage`) + 30318-30345
  (hotkey hub) + 17763-20941 (31 TODO_MISSING `_bnd*` helpers)

**Confidence**: high
