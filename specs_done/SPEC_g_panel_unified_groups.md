# SPEC — G-panel Unified Groups (popup)

**Status**: SHIPPED (Slice 1) — was SPEC ONLY (referenced from
page1.html + page1/pca_panel.js + page1/manual_groups.js without an
on-disk doc) until 2026-05-15.
**Authored from shipped code** (recovery of a missing SPEC).
**Implemented in (Slice 1)**:
- `atlases/inversion/pages/discovery/page1.html` — `#gPanelOpenBtn`
  trigger button (lines ~1461-1478)
- `atlases/inversion/pages/discovery/page1/manual_groups.js` —
  popup re-host plumbing (line 309+)
- `atlases/inversion/pages/discovery/page1/pca_panel.js` —
  `renderManualGroupsList` writes to all 3 surfaces (sidebar +
  compact + popup) via `#manualGroupsListPopup`
- (Slices 2 + 3 pending — see §6)

**Page contract**: `docs/generated/page_contracts/page1/`

**Originator turn**: turn 135 (per inline `// turn 135 Slice 1
(SPEC_g_panel_unified_groups.md):` comments at the implementation
sites).

---

## §1. Purpose

A single **unified popup** consolidating three previously-scattered
group concepts into one place — opened with the lowercase `g`
hotkey or the `G ▾` button on the page1 toolbar's `⋯ more`
expansion area.

Three tabs, in left-to-right order:

| tab | content | scope | requires |
|-----|---------|-------|----------|
| **Karyotype** | per-candidate band membership (HOMO_1 / HET / HOMO_2 in the H-system, ordered by median PC1) | per-candidate | a focused candidate |
| **Inheritance** | cross-candidate Jaccard clusters from the inheritance-groups pipeline | cohort-level | ≥ 2 confirmed candidates |
| **Manual** | user-curated cohort splits (lasso/click/grab-K-band) | cohort or per-chromosome | always available |

The popup is a **single source of truth** view: each tab edits the
same underlying state surface that the existing inline / sidebar
controls also write to. When the popup is open, edits propagate to
the sidebar / compact / popup mirrors via the same renderer.

## §2. Slice plan

| slice | what ships | status (2026-05-15) |
|-------|-----------|---------------------|
| **Slice 1** | Popup scaffold + Manual tab re-host | ✅ shipped |
| **Slice 2** | Karyotype tab — per-candidate band membership view | 🟡 pending |
| **Slice 3** | Inheritance tab — cross-candidate Jaccard cluster view | 🟡 pending |

Slices 2 + 3 currently render a "Slice N pending" empty-state in
their tab body.

## §3. Trigger contract

### §3.1 Button

`#gPanelOpenBtn` — sits in the L3 toolbar `⋯ more` collapsible
expansion area (page1.html ~line 1471). Label: `G ▾`. Tooltip
reads:

> Open the unified groups popup — three tabs covering karyotype
> groups (per-candidate band membership), inheritance groups
> (cross-candidate Jaccard clusters), and manual groups
> (user-curated cohort splits). Hotkey: g. Slice 1 implements the
> manual tab; karyotype and inheritance ship in later slices.

### §3.2 Hotkey

Lowercase `g` (no modifiers, NOT in input field) toggles the popup.
Wired in `page1/hotkeys.js` (alongside `f`, `b`, `c`, `n`, `p`,
arrows, etc.).

The `g` key intentionally does **NOT** require a focused candidate —
the popup is cohort-level. Karyotype tab will gracefully empty-state
when no candidate is focused.

## §4. Scope semantics

The popup itself is **cohort-level** in the sense that it works
whether or not chromosome data is loaded:

- **Manual tab** — always works (manual groups can be drafted
  without data; saving is gated by data presence per existing
  `manual_groups.js` rules).
- **Karyotype tab** — needs `state.candidate` (a focused candidate's
  K-banding from page1 / page2).
- **Inheritance tab** — needs `state.candidateList.filter(c =>
  c.confirmed === true)` to have at least 2 entries (so the
  inheritance-group clustering has something to compare).

When prerequisites aren't met, each tab shows its own empty state
explaining what's needed.

## §5. Manual tab re-host (Slice 1 contract)

The Manual tab body contains a `#manualGroupsListPopup` div that is
**filled by the same renderer that fills the sidebar and compact
mirrors** (`pca_panel.js#renderManualGroupsList`).

### §5.1 Three-surface single-source-of-truth render

```js
const containers = [];
const sidebar = document.getElementById('manualGroupsList');
const compact = document.getElementById('manualGroupsListCompact');
const popup   = document.getElementById('manualGroupsListPopup');
if (sidebar) containers.push(sidebar);
if (compact) containers.push(compact);
if (popup)   containers.push(popup);
// ... write the same innerHTML to every container in containers[]
```

This means whether the user edits a group via the sidebar, compact
view, or popup, **the same `state.manualGroups` array is mutated**
and **all three surfaces re-render together**.

### §5.2 Per-row controls (carried over from sidebar/compact)

Each manual group row inside the popup (and the sibling surfaces):

- **Color swatch** (`.mg-swatch`)
- **Editable name** (`.mg-name` — `contenteditable="true"`)
- **Member count** (`.mg-count` — `n=<members.length>`)
- **Pin button** (`.mg-pin` — toggles cohort-vs-per-chrom scope)
- **Delete button** (`.mg-del`)

### §5.3 Empty state

When `state.manualGroups.length === 0`:

> No groups yet — pick samples or grab a K-band.

## §6. Slice 2 (Karyotype tab) — outline

Not yet implemented. The tab body will mirror `karyotype_tier`'s karyotype
sub-view but scoped to the single focused candidate:

- Per-sample row showing locked K=3 label (HOMO_1 / HET / HOMO_2)
- Ordered by median PC1
- Colour swatch matching the page1 `lines_panel` band paint
- Click-to-select samples → adds to a new manual group?
  (UX decision pending)
- Re-uses `karyotype_tier/karyo_rows.js` pure helpers + `karyotype_tier/karyo_labels.js`
  vocabulary.

Empty state when no `state.candidate` focused:

> Focus a candidate (page2 prev/next, or click on a candidate
> rectangle in page1) to see its karyotype groups here.

## §7. Slice 3 (Inheritance tab) — outline

Not yet implemented. The tab body will surface the
inheritance-group clustering result (the same compute used by
`l2_sweep.js` and the `lines_panel.js` inheritance pills):

- One row per inheritance group (Jaccard-clustered across
  confirmed candidates)
- Group members: candidate ids touching the group
- Per-group sample count + per-candidate share
- Click-to-track: select a group → fill `state.tracked` with its
  members
- Filter: minimum candidates touching, minimum group size

Empty state when `< 2` confirmed candidates:

> Confirm at least 2 candidates (page2 — set the confirmed flag) to
> see cross-candidate inheritance groups.

## §8. Why "unified"

Before Slice 1, the three group concepts were **scattered**:

| concept | pre-Slice-1 surface |
|---------|---------------------|
| Karyotype | only on karyotype_tier (deep-dive review page) |
| Inheritance | only as `lines_panel` pills + `l2_sweep` clustering result; no list view |
| Manual | sidebar list + compact list (no popup) |

Each lived in its own corner; comparing them required navigating
between pages or panels. The G-panel pulls them into a single
popup over page1 so the user can:

- Review karyotype assignment for the focused candidate
- See which inheritance group each sample belongs to (cohort-wide)
- Cross-check against manually-curated splits

…all without leaving page1.

## §9. State surface (read by the popup; written by the existing controls)

| field | tab consumed by | mutated by |
|-------|-----------------|------------|
| `state.manualGroups` | Manual | sidebar / compact / popup edits + lasso (`page1/pca_panel.js#attachPcaLasso`) |
| `state.candidate` | Karyotype | page1 / page2 candidate-mode |
| `state.candidateList` | Inheritance | page2 import/export, l2_sweep auto-promote |
| `state.lineageResult` (cached) | Inheritance | `page1/lineage.js`, `inheritance.js` |
| `state.l2SweepResult` (cached) | (read by Inheritance hover hints) | `page1/l2_sweep.js#runL2SweepInheritance` |

## §10. Persistence

The popup itself is **not persisted** (open/closed state is
in-memory only). The underlying state surfaces persist as before:

- `state.manualGroups` — localStorage (per existing
  `manual_groups.js` rules; per-chrom OR cohort scope)
- `state.candidate.locked_labels` — persisted with the candidate in
  `state.candidateList`
- `state.lineageResult` — recomputed on demand (cached in-session
  via `lineageCacheKey`)

## §11. Hotkey conflicts

`g` is currently used **only** for this popup (per `page1/hotkeys.js`
audit). No conflict with existing single-letter hotkeys (`n`, `p`,
`f`, `b`, `c`, `j`).

## §12. References

- **Trigger button**: `pages/discovery/page1.html` lines 1461-1478
  (`#gPanelOpenBtn`)
- **Manual tab popup div**: `#manualGroupsListPopup` (in popup body,
  page1.html — lookup by `getElementById` in `pca_panel.js`)
- **Renderer**: `pages/discovery/page1/pca_panel.js#renderManualGroupsList`
- **Manual groups state**: `pages/discovery/page1/manual_groups.js`
- **Hotkey wiring**: `pages/discovery/page1/hotkeys.js` (unverified
  in this audit; check during Slice 2/3 work)
- **Karyotype primitives** (Slice 2 prep):
  `pages/review/karyotype_tier/karyo_rows.js`, `karyo_labels.js`
- **Inheritance primitives** (Slice 3 prep):
  `pages/discovery/page1/inheritance.js`,
  `shared/inheritance_groups.js`

---

**Authored**: 2026-05-15 from `pages/discovery/page1.html` lines
1461-1478 + `pages/discovery/page1/pca_panel.js` line 740-790 +
`pages/discovery/page1/manual_groups.js` line 309+. One of the 8
SPECs identified as missing on disk in
`_handoff_docs/SPECS_AUDIT.md`. Slice 1 only — Slices 2 + 3 will
extend this SPEC with their own implementation notes when they
ship.
