# How to use page11 — boundaries

**Page**: `page11` · stage `classification` · label "boundaries"
**Atlas**: `inversion` (the C. gariepinus 226-cohort atlas)

## What this page does

Refines a promoted candidate's `[start_bp, end_bp]` into approximate
**left / right boundary zones** using multiple evidence tracks.

- **Auto-propose** runs a weighted multi-track algorithm
  (`bndAutoPropose` from `page11/boundaries_ui.js`) using the
  weights in `BOUNDARY_TRACK_WEIGHTS` (`page11/boundaries.js`).
- **Manual override** at the scrubber cursor via hotkeys E (left)
  / F (right).
- **Save** persists the boundary annotation onto the candidate;
  **Reset** clears.

## Vocabulary contract

| term | meaning |
|------|---------|
| `boundary_zone` | default verdict — what auto-propose ever produces |
| `exact_breakpoint` | reserved for junction-level evidence ONLY — do NOT use for the boundary-zone output |

## Where the pieces live

```
atlases/inversion/
├── pages/review/
│   ├── page11.html                                ← shell: 4 DOM ids only
│   │                                                (#page11, #page11Header,
│   │                                                #page11Subtitle, #page11Content)
│   ├── page11.js                                  ← entry; renderBoundariesPage
│   │                                                builds the toolbar inside
│   │                                                #page11Content via innerHTML
│   └── page11/
│       ├── _state.js                                ← _pageState + setter
│       ├── boundaries.js                            ← pure helpers (809 LOC)
│       │                                            constants, binary search,
│       │                                            rolling-median smoothing, MAD
│       │                                            normalization, scan-range
│       │                                            computation, support-class
│       │                                            verdict, boundary record
│       │                                            builder, edge solver
│       └── boundaries_ui.js                         ← UI wiring (689 LOC)
│                                                    state-mutating actions
│                                                    + toolbar handlers
└── shared/
    └── candidate_nav.js                           ← _renderCandidateNavInline
                                                     (the prev/next nav bar
                                                     inserted above the toolbar)
```

## DOM (built dynamically by `renderBoundariesPage`)

The HTML shell only contains 4 ids (page wrapper, header, subtitle,
content slot). The toolbar + panels below are built once at mount
time by `slot.innerHTML = ...` inside `renderBoundariesPage()` and
guarded by `slot.__bndBuilt` so the build runs once per mount.

DOM ids created at mount:

**Toolbar** (`.bnd-toolbar`):
- `#bndCandSelect` — candidate dropdown
- `.bnd-radius-btn[data-radius=...]` — 9 scan-radius buttons
- `#bndAutoProposeBtn` (also "primary" styled)
- `#bndOverrideLBtn`
- `#bndOverrideRBtn`
- `#bndResetBtn`
- `#bndSaveBtn`
- `#bndStatusSel`

**Panels** (top-to-bottom):
- `#bndInfo` — empty-state / readout
- `#bndTracks` — track stack (auto-propose evidence)
- `#bndSummary` — summary
- `#bndClassSummary` — auto-scan class summary (v4 turn 25)
- `#bndRepeatDensity` — TE density panel (v4 turn 18)
- `#bndNcRNADensity` — rRNA / tRNA / ncRNA-other panel (turn 116)
- `#bndFocalVsBg` — focal-vs-background widget (turn 117)

Plus a `_renderCandidateNavInline` bar inserted between the page
header and the toolbar — re-rendered on every `renderBoundariesPage()`
call so prev/next button state stays in sync. The page's own
`#bndCandSelect` dropdown and these prev/next buttons both write
through `_navigateToCandidate` and stay synchronized.

## The 9 scan radii (verified)

| button | bp | notes (per the verbatim button tooltips) |
|--------|---:|------------------------------------------|
| `1 kb` | 1,000 | for SV-supported breakpoints with split-read evidence; most PCA tracks won't render meaningfully at this scale |
| `5 kb` | 5,000 | fine breakpoint inspection; matches MODULE_3 win5000.step1000 θπ scale |
| `10 kb` | 10,000 | boundary zone refinement; matches MODULE_3 win10000.step2000 θπ scale |
| `25 kb` | 25,000 | typical breakpoint working scale for `boundary_zone_only` verdicts |
| `100 kb` | 100,000 | broader boundary context; matches hobs_profile / fst_profile distances_kb default |
| separator | — | visual separator between fine and broad |
| `1 Mb` | 1,000,000 | whole-region context — useful when SV and PCA boundaries disagree by hundreds of kb |
| `1.5 Mb` | 1,500,000 | (no inline tooltip) |
| `2 Mb` | 2,000,000 | (no inline tooltip) |
| `5 Mb` | 5,000,000 | broadest context; kicks in automatically at `>CANDIDATE_HUGE_BP` via `_boundaryScanRange` |

**Default**: `BOUNDARY_DEFAULTS.SCAN_RADIUS_BP = 1_500_000` (1.5 Mb).
**Huge-candidate threshold**: `CANDIDATE_HUGE_BP = 3_000_000` (3 Mb)
— beyond this the radius switches to `0.5 × span` instead of fixed
(see `boundaryScanRange` in `boundaries.js`).

## The status select (3 values, verified)

```
#bndStatusSel
  ├ boundary_zone_only      ← default; what auto-propose sets
  ├ SV_supported            ← manually-promote after reviewing SV evidence
  └ junction_supported      ← manually-promote after junction evidence
```

The tooltip on the select reads: *"Strongest available evidence —
auto only ever sets `boundary_zone_only`; promote manually after
reviewing SV/junction evidence."*

## Auto-propose: the 11-track weighted score

`BOUNDARY_TRACK_WEIGHTS` (per `page11/boundaries.js`, sums to 1.0):

| track | weight | polarity (per `BOUNDARY_TRACK_POLARITY`) |
|-------|------:|:----------------------------------------:|
| `pca_drop` | 0.20 | +1 |
| `dosage_transition` | 0.18 | +1 |
| `band_continuity_drop` | 0.14 | −1 |
| `ghsl_step` | 0.12 | +1 |
| `polarity_change` | 0.10 | +1 |
| `het_transition` | 0.06 | +1 |
| `similarity_edge` | 0.05 | −1 |
| `fst_edge` | 0.05 | +1 |
| `theta_pi_step` | 0.04 | −1 |
| `discordant_pile` | 0.04 | +1 |
| `sv_anchor` | 0.02 | +1 |

`+1` = track rises INSIDE the inversion; `−1` = track falls inside
(flipped before summing).

The full pipeline in `boundaries.js`:
- `buildBoundaryTrackScores(data, cand, scanRange, opts)` → per-track
  per-window scores
- `computeBoundaryEdges(trackScores, weights, opts)` → left + right
  edge proposals
- `bndStageFromCandidate(state, cand)` → stage them into
  `state.__boundaries` (page-private — `ensureBoundariesState`
  initialises it)

## Hotkeys (verified — only 5)

Installed at mount via `_bndAttachHotkeys()`; removed at unmount via
`_bndDetachHotkeys()`. Idempotent (guard: `_bndKeyHandlerAttached`).

| key | action | guard |
|-----|--------|-------|
| `E` | override LEFT boundary at the current focal window | requires `Number.isFinite(state.cur)` |
| `F` | override RIGHT boundary at the current focal window | requires `Number.isFinite(state.cur)` |
| `B` | save (persist staging onto candidate) | always |
| `R` | reset (clear staging boundaries) | always |
| `A` | auto-propose | always |

Hotkey discipline:
- Listener runs at `document` level
- Skips when `#page11` is not the active page (checks `.active`
  class)
- Skips when focus is in INPUT / TEXTAREA / SELECT
- Skips when Ctrl / Meta / Alt is held

## How to run

1. **Pick a candidate** (cross-page slot — same as page2 / page4):
   the candidate dropdown `#bndCandSelect` is populated by
   `populateCandidateSelect(state)` from `state.candidateList`.
   Both the dropdown and the prev/next nav bar above the toolbar
   write through `_navigateToCandidate`, so they stay in sync.

2. **Pick a scan radius** by clicking one of the 9 buttons. The
   active button gets a `.active` class. The default is 1.5 Mb.

3. **Click "auto-propose"** (or hit `A`). The system:
   - calls `buildBoundaryTrackScores(state.data, cand, scanRange)`
   - feeds those into `computeBoundaryEdges` with
     `BOUNDARY_TRACK_WEIGHTS`
   - stages the proposed left + right edges into
     `state.__boundaries`
   - updates the `#bndTracks` + `#bndSummary` + `#bndClassSummary`
     panels

4. **Inspect** the panels:
   - `#bndTracks` — per-track score traces
   - `#bndSummary` — aggregate summary
   - `#bndClassSummary` — support-class verdict (auto-scan v4 t25)
   - `#bndRepeatDensity` — TE density across the scan range
   - `#bndNcRNADensity` — rRNA / tRNA / ncRNA-other annotation
   - `#bndFocalVsBg` — focal-vs-background statistical widget

5. **Refine manually** if needed:
   - Move page1's cursor (state.cur) to a different window
   - Hit `E` to set the left edge there; `F` for the right

6. **Save** (`B` or the "save" button) — persists the boundary
   annotation onto `state.candidate.boundary_zone` (the exact
   field name and shape are in `bndSave`'s implementation; the
   verdict respects whatever `#bndStatusSel` is set to —
   `boundary_zone_only` by default).

7. **Reset** (`R` or "reset") — clears `state.__boundaries`
   staging. Does NOT touch what's persisted on the candidate
   itself; reset is "undo the unsaved staging".

## Public entries (from `boundaries_ui.js` header)

| function | purpose |
|---------|---------|
| `populateCandidateSelect(state)` | fill `#bndCandSelect` with options |
| `updateRadiusButtons(state)` | toggle `.active` on radius buttons |
| `updateSaveButton(state)` | enabled + `.dirty` class |
| `updateStatusSelect(state)` | set `#bndStatusSel` value |
| `selectCandidate(state, candId)` | set active candidate + stage |
| `bndReset(state)` | clear staging boundaries |
| `bndSave(state, opts?)` | commit staging onto candidate |
| `bndOverrideLeft(state, wIdx, opts?)` | manual left edge at window |
| `bndOverrideRight(state, wIdx, opts?)` | manual right edge at window |
| `bndAutoPropose(state, opts?)` | data → tracks → edges → stage |
| `refreshBoundariesUi(state)` | run all update fns + onChange |
| `wireBoundariesToolbar(state, opts?)` | install handlers |
| `teardownBoundariesToolbar()` | remove handlers |

## State slots used

| slot | source | meaning |
|------|--------|---------|
| `state.candidate` | cross-atlas slot | the active candidate (id, chrom, start_bp, end_bp, K) |
| `state.candidateList` | cross-atlas registry | feeds the dropdown + prev/next |
| `state.data` | per-chromosome precomp | windows + per-layer arrays |
| `state.__boundaries` | page-private | staging — initialised by `ensureBoundariesState` |
| `state.cur` | cross-atlas cursor | feeds the `E` / `F` override-at-cursor hotkeys |

## Defaults summary (`BOUNDARY_DEFAULTS`, verified)

| key | value | meaning |
|-----|------:|---------|
| `SCAN_RADIUS_BP` | 1,500,000 | default scan radius (1.5 Mb each side) |
| `ZONE_RADIUS_WINDOWS` | 5 | ±5 windows per zone |
| `SMOOTH_WINDOW` | 3 | rolling-median width (odd) |
| `EXCLUDE_OUTER_PCT` | 0.10 | ignore outermost 10% |
| `SUPPORT_INCLUSION` | 0.5 | ≥ 0.5 × median nonzero → in support[] |
| `CANDIDATE_HUGE_BP` | 3,000,000 | 3 Mb threshold for scan expansion |
| `CANDIDATE_HUGE_RATIO` | 0.5 | 0.5×span instead of fixed radius |
| `STATUSES` | (3 values frozen) | `boundary_zone_only` / `SV_supported` / `junction_supported` |

## Common gotchas

1. **"`E` / `F` does nothing."** The override-at-cursor hotkeys
   require `state.cur` to be a finite number. If page1 hasn't been
   mounted on the same chromosome (or the cursor hasn't been set
   yet), `state.cur` is null/undefined and the hotkey is a no-op.
   Move the cursor on page1 first.

2. **"Auto-propose returned nothing."** The scan range is
   determined by `boundaryScanRange(cand, SCAN_RADIUS_BP, chromLen,
   windows)`. If the candidate has no `start_bp` / `end_bp`, or
   `state.data.windows` is empty, the range is empty. Check
   `bndCandSelect` actually selected a real candidate.

3. **"Save button is greyed out."** The button has a `.dirty` class
   when staging differs from what's persisted on the candidate.
   No staging changes ⇒ no dirty ⇒ no save needed.

4. **"My save flipped to `SV_supported` automatically."** No it
   didn't. Auto-propose ONLY ever sets `boundary_zone_only`. The
   tooltip on `#bndStatusSel` is explicit:
   *"Strongest available evidence — auto only ever sets
   boundary_zone_only; promote manually after reviewing SV/junction
   evidence."* The select retains whatever you set it to.

5. **"Hotkeys fire when I'm typing in a textarea."** They don't —
   `_bndKeyHandler` early-returns when
   `document.activeElement.tagName` is INPUT / TEXTAREA / SELECT.
   If a hotkey IS firing during text input, the active element
   doesn't have one of those tag names (e.g. a contenteditable
   div); please file a bug.

## What page11 does NOT do

- **It does NOT call exact breakpoints** — the verdict is a
  **boundary zone**, not a base-pair junction. `exact_breakpoint`
  is reserved for junction-level evidence (e.g. split-read
  consensus, optical mapping confirmation) which the atlas does
  NOT compute itself.
- **It does NOT validate the SV-supported / junction-supported
  promotions** — those are manual user gestures. Page_sv_evidence
  is the place to inspect SV evidence; this page just lets you
  record the verdict.
- **It does NOT run a live server compute** — everything operates
  on the precomp + the per-chromosome `state.data`. Producer-side
  tracks (`pca_drop`, `dosage_transition`, etc.) come from layers
  already loaded.

## Registry mismatch flagged

Per `pages.registry.json` `_doc` for page11: the registered
`requires_layers` are **`candidate_final_class +
candidate_breeding_card`**, which look misplaced. Page11 actually
reads:

- `state.candidate` (cross-atlas slot)
- `state.candidateList` (cross-atlas array)
- `state.data` (transient sub-fields — windows + per-layer arrays)
- `state.repeatDensity` (per-chrom TE density layer, lazily
  created)
- `state.ncRNADensity` (per-chrom ncRNA layer)

A **swap hypothesis** has been raised: page11's declared layers
may have been swapped with page4's declared
`candidate_sv_counts + candidate_boundaries`. Do NOT silently fix;
deferred to a future renumbering round.

## Related specs

In `specs_done/`:
- `SPEC_band_track_extraction_and_l3_single_band_rows.md` (parent
  band-track spec — the per-track shapes consumed by
  `buildBoundaryTrackScores`)
- `SPEC_l2_sweep_inheritance.md` (the auto-promote pipeline that
  produces the candidates page11 then refines; defines the
  `confirmed: false` discipline)
- `SPEC_sv_evidence_page.md` (sv_evidence's per-SV
  classification feeds the `sv_anchor` track at weight 0.02 +
  the user's decision to promote to `SV_supported`)
- `SCHEMA.md` (§12 / §20 reserve sections for SV evidence + the
  `arrangement_calls` / boundary annotations the page writes back)

## Per-page contract

`docs/generated/page_contracts/page11/PAGE_CONTRACT.md`

## Cohort discipline

226-sample pure C. gariepinus hatchery only. Three cohorts never
conflate.

---

**Authored**: 2026-05-15 from `pages/review/page11.js` (lines
193-300, 307-337) + `pages/review/page11/boundaries.js` (lines
17-65, exports list) + `pages/review/page11/boundaries_ui.js`
(header block + lines 1-100). All facts (scan radii, hotkey set,
track weights, defaults, DOM ids) verified against shipped code.
The page contract previously cited "31 TODO_MISSING _bnd*
helpers" — that count came from a chat-33 audit before the
cartridge port; the helpers shipped since.
