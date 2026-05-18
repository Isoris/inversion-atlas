# SPEC — Review Surfaces: Auto + Lineages

**Status**: SHIPPED partially (Slices 0 + 1 + 2) — was SPEC ONLY
(referenced from `atlases/inversion/css/inversion.css`,
`docs/MIGRATION_INVENTORY.md`, the band-track parent SPEC, and the
turn-130 + turn-165 handoffs without an on-disk doc) until 2026-05-15.
**Authored from shipped code + handoffs** (recovery of a missing SPEC).

**Slice plan + status (2026-05-15)**:

| slice | what ships | status |
|-------|-----------|--------|
| **Slice 0** | Infrastructure: `is-auto` CSS class + `cli-auto-prefix` + sort-to-bottom + `_isAutoCandidate` predicate | ✅ shipped (turn 130 follow-up) |
| **Slice 1** | Full dashed-outline visual treatment: cross-candidate matrix filter + lines-panel band skip + confirm-drops-dashed | ✅ shipped (turn 130) — discovered already-shipped during turn 165 audit |
| **Slice 2** | `auto` G-panel review tab: per-row Confirm / Dismiss / Inspect + bulk actions | ✅ shipped (turn 165) |
| **Slice 3** | `lineages` G-panel tab: Track / Pin as group / Dismiss | 🟡 deferred |

**Implemented in**:
- `atlases/inversion/css/inversion.css` lines ~947-960 — `is-auto`
  class styling (dashed outline, opacity 0.85, `🤖` prefix slot)
- `legacy/Inversion_atlas.html` (turn 165, +373 LOC) — G-panel
  `auto` tab body + per-row Confirm / Dismiss / Inspect handlers +
  bulk actions
- `legacy/Inversion_atlas.html` (turn 130) — `_isAutoCandidate`
  predicate, `_gatherActiveCandidatesForInheritance` filter,
  `_paintCandidateBands` confirmed-only filter

**Companion specs**:
- `specs_done/SPEC_g_panel_unified_groups.md` (parent — the G-panel
  popup that hosts these review tabs)
- `specs_done/SPEC_l2_sweep_inheritance.md` (the producer of
  `source = 'auto_l2_sweep'`, `confirmed = false` candidates)
- `specs_done/SPEC_lines_panel_candidate_bands.md` (Slice 1's
  paint-skip rule)
- `specs_done/SPEC_band_track_extraction_and_l3_single_band_rows.md`
  (parent — cites this SPEC as a sibling extension point)

---

## §1. Purpose

The L2-sweep auto-promote pipeline (per
`SPEC_l2_sweep_inheritance`) creates candidates tagged
`source = 'auto_l2_sweep'`, `confirmed = false`. **Without dedicated
review surfaces**, these flood `state.candidateList` and confuse the
UI between human-curated and machine-proposed candidates.

This SPEC defines the **review surfaces** that:

1. Visually distinguish auto-promoted candidates from human-confirmed
   ones (Slice 0 + 1 — dashed outline + opacity reduction + `🤖`
   prefix).
2. Filter machine candidates out of inheritance / paint pipelines
   until they're confirmed (Slice 1).
3. Provide a dedicated **review tab** in the G-panel popup with
   Confirm / Dismiss / Inspect actions (Slice 2).
4. Future: surface lineage groups for tracking / pinning (Slice 3).

## §2. Slice 0 — Infrastructure (shipped turn 130 follow-up)

### §2.1 `_isAutoCandidate(cand)` predicate

Returns `true` iff:

```js
cand.source === 'auto_l2_sweep' && cand.confirmed !== true
```

The `confirmed !== true` test means: as soon as the user confirms an
auto candidate, the predicate returns false and ALL downstream
"is-auto" treatment falls off automatically.

### §2.2 CSS class hooks

`atlases/inversion/css/inversion.css` lines 947-960:

```css
/* turn 130 follow-up — auto-promoted candidates (algorithm-proposed,
   awaiting user confirm). Dashed outline, slight opacity reduction so
   the user can distinguish at a glance without missing them. The 🤖
   prefix in the label reinforces. is-auto rows are sorted to the
   bottom of the list by refreshCandidateListUI. Confirm/dismiss
   actions ship with the G-panel `auto` review tab (Slice 2 of
   SPEC_review_surfaces_auto_and_lineages.md). */
#candListContainer .cand-list-item.is-auto {
  border-style: dashed;
  border-left-style: dashed;
  opacity: 0.85;
  background: rgba(255, 255, 255, 0.02);
}
#candListContainer .cand-list-item.is-auto:hover { opacity: 1; }
```

### §2.3 Label decorator

Auto rows render with a `🤖` prefix span
(`.cli-auto-prefix`) before the candidate id label.

### §2.4 Sort discipline

`refreshCandidateListUI` sorts auto candidates **to the bottom** of
the candidate-list. This keeps human-curated candidates above the
fold; the auto fold is a "review queue" the user works through.

## §3. Slice 1 — Full dashed-outline visual treatment

Three concrete items, all shipped in turn 130 (verified in turn-165
audit):

### §3.1 Cross-candidate matrix filter

`_gatherActiveCandidatesForInheritance` filters out auto-candidates
(turn 130 hook at legacy line 41218). The cross-candidate
inheritance matrix (built via `renderInheritanceMatrix`) does NOT
include auto candidates — so the inheritance-group clustering only
sees human-curated input.

This means: auto candidates **don't pollute the cross-candidate
inheritance pipeline** (and by extension, the `lines_panel`
inheritance pills strip + L2-sweep group-touching gate).

### §3.2 Lines-panel band-skip

`_paintCandidateBands` skips any candidate where
`c.confirmed !== true` (legacy line 33960; canonical version at
`pages/discovery/local_pca_dosage/candidates.js#_paintCandidateBands` per
`specs_done/SPEC_lines_panel_candidate_bands.md` §4 filter rule 1).

This means: **auto candidates are invisible in the lines-panel
band highlights** until confirmed. Visual cohort stays clean.

### §3.3 Confirm-action drops dashed

The "confirm action drops dashed" path is automatic. `_isAutoCandidate`
returns false when `cand.confirmed === true`, so the `is-auto` CSS
class is removed by the next `refreshCandidateListUI` cycle.

No special "promote to non-auto" logic needed — confirming flips
`confirmed: true`, which flips `_isAutoCandidate(cand)` to false,
which flips `.is-auto` off.

## §4. Slice 2 — G-panel `auto` review tab (shipped turn 165)

### §4.1 Tab placement

The `auto` tab sits in the G-panel popup (per
`specs_done/SPEC_g_panel_unified_groups.md`). When the G-panel popup
is open, a tab strip exposes:

```
[ karyotype ]  [ inheritance ]  [ manual ]  [ auto 🤖 ]  [ lineages ]
```

(The `lineages` tab is Slice 3 — currently shows a "pending"
empty-state.)

### §4.2 Tab body

Per-row in the auto tab:

| column | content |
|--------|---------|
| `cid` | candidate id (with `🤖` prefix) |
| `chrom` | chromosome label |
| `span (Mb)` | `start_bp` / `end_bp` formatted in Mb |
| `silhouette` | `meta.silhouette` from the L2-sweep result |
| `n groups` | inheritance groups touching the L2 (from `result.groups[].members`) |
| `n band` | min band size across K-means groups |
| **`Confirm`** | per-row action — flips `c.confirmed = true`; drops `is-auto` |
| **`Dismiss`** | per-row action — adds `l2idx` to per-chrom dismissed-set + removes from `candidateList` |
| **`Inspect`** | opens the L2-sweep inspector focused on this row's L2 |

### §4.3 Bulk actions

Above the table:

- **Confirm all** — confirms every row in the current tab. Confirmation
  prompt because this is non-reversible.
- **Dismiss all** — dismisses every row. Confirmation prompt.
- **Filter** — by silhouette / n_groups / n_band.

### §4.4 Empty state

When `state.candidateList.filter(_isAutoCandidate).length === 0`:

> No auto candidates pending review. Enable the L2-sweep toggle and
> load a chromosome to populate this tab.

### §4.5 Re-render triggers

The auto tab re-renders when:
- The popup opens
- A `Confirm` / `Dismiss` action runs
- A new chromosome loads (which may auto-promote candidates per
  `runL2SweepInheritance` in `applyData()`)
- The user toggles the L2-sweep enabled state (clears or repopulates)

## §5. Slice 3 — Lineages tab (deferred)

Not yet implemented. When it ships, the tab body will surface
`state.lineageResult` (per `pages/discovery/local_pca_dosage/lineage.js`) with:

- One row per lineage cluster
- Members: sample list + per-candidate share
- Per-row actions:
  - **Track** — fill `state.tracked` with lineage members
  - **Pin as group** — create a manual group from the lineage
    (writes to `state.manualGroups`; persists per
    `manual_groups.js` rules)
  - **Dismiss** — soft-hide the lineage from the tab

Empty state when `state.lineageResult` is null:

> Lineage clustering hasn't run on this chromosome yet. Confirm at
> least 2 candidates and click `compute lineages` in the L3 panel.

Deferred because Quentin hasn't exercised lineage compute on real
data yet (per turn 165 handoff §0); building the UI without
real-data exercise would be speculative.

## §6. Architectural rationale

The pattern across Slices 0-2 is: **machine output is gated until
human confirmation**. This is consistent across multiple subsystems:

- **L2-sweep** auto-promote → `confirmed: false` in `candidateList`
- **Inheritance pipeline** → filters out unconfirmed
- **Lines-panel paint** → skips unconfirmed
- **L3 single-band rows view** → confirmed-only (per
  `SPEC_band_track_extraction_and_l3_single_band_rows.md`)

The G-panel `auto` tab is the **single review surface** for all of
these. Without it, the user has to inspect each auto-promoted
candidate via the candidate strip, which gets crowded fast (an
LG28 sweep on 226 fish typically promotes 10-30 L2s; a manuscript
might do this across all chromosomes).

## §7. References

- **CSS hooks**: `atlases/inversion/css/inversion.css` lines 947-960
- **Predicate**: `_isAutoCandidate(cand)` (legacy turn 130, line TBD)
- **Inheritance filter**: `_gatherActiveCandidatesForInheritance`
  (turn 130 hook at legacy line 41218)
- **Paint filter**: `_paintCandidateBands` confirmed-only check
  (per `specs_done/SPEC_lines_panel_candidate_bands.md` §4)
- **Auto-tab impl**: turn 165 (+373 LOC in legacy)
- **Originating handoffs**:
  - `handoff_docs/HANDOFF_2026-05-05_turn165_g_panel_auto_tab.md`
  - turn 130 follow-up handoff (Slice 0 + 1)
- **Source of `auto_l2_sweep` candidates**:
  `specs_done/SPEC_l2_sweep_inheritance.md`

---

**Authored**: 2026-05-15 from CSS lines 947-960 + turn-165 handoff +
turn-130 follow-up trail. One of the 8 SPECs identified as missing
on disk in `_handoff_docs/SPECS_AUDIT.md`. Slices 0 + 1 + 2 SHIPPED;
Slice 3 (lineages tab) deferred pending real-data exercise.
