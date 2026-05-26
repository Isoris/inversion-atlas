# SPEC — catalogue regime registry + bulk assignment

**Status**: SPEC ONLY — authored 2026-05-21 from the dead-button audit
(Group 3). The two `<button>` elements ship in
[`catalogue.html:69-70`](../atlases/inversion/pages/catalogue/catalogue.html#L69-L70)
with tooltips referencing "Deliverable C" but no handlers + no UI surface
behind them. Implementation needs the modal/dialog scaffolding described
below.

**Implemented in**: partially — the underlying data layer exists.
- [`shared/regimes_registry.js`](../atlases/inversion/shared/regimes_registry.js) — read/write API for the regime annotation set (per chrom)
- [`shared/regime_topology.js`](../atlases/inversion/shared/regime_topology.js) — topology graph + chain detection
- [`shared/regime_annotation/`](../atlases/inversion/shared/regime_annotation/) — positional + structural annotations (Layers 1+2 shipped, see `specs_done/SPEC_regime_annotation_v34.md`)

Missing pieces: the catalogue-side editor UI (modal) + the bulk-assign
flow that takes selected catalogue rows → regime membership.

---

## 1. Goal

User-curated annotation layer on top of the L2 catalogue: "these L2s
belong to inversion-system X, those to system Y." Two distinct UI
surfaces:

### 1.1 `catRegimeRegistry` 🏷 regimes
Opens a modal/dialog that lists every regime annotation defined on the
active chromosome. Each row shows: regime label, member L2 count,
member L2 list (collapsible), color swatch, delete/edit buttons.
Footer row: "+ new regime" inline editor.

### 1.2 `catRegimeAssignSel` 🏷 assign sel
Reads `state.catalogueSelection` (the checkbox-selected catalogue
rows). Opens the SAME modal in "assign mode" with:
- All currently-selected L2 IDs staged in a "to assign" list at the top.
- A "+ create new regime" option that pre-populates with the staged L2s.
- Each existing regime in the list gets an "+ add staged" button that
  appends the staged L2s to its membership.
- After assign, the modal closes (or stays open for further work — see §5).

## 2. The regime annotation shape

Already defined by [`shared/regimes_registry.js`](../atlases/inversion/shared/regimes_registry.js).
For this SPEC's purpose:

```js
{
  id:          'regime_<uuid>',
  label:       'Inversion system A',        // user-editable display name
  color:       '#f5a524',                    // user-picked hex
  chrom:       'C_gar_LG07',
  l2_indices:  [12, 13, 14, 27],             // L2 envelope indices in this chrom
  notes:       '(optional free text)',
  created_at:  '2026-05-21T14:30:00Z',
  updated_at:  '2026-05-21T15:02:00Z',
}
```

Persistence: a chrom-keyed key in localStorage today (per the existing
`regimes_registry` API); future migration to the per-cohort registry is
out of scope for this SPEC.

## 3. Modal layout

Single `<div id="catRegimeModal" class="modal">` with the standard
atlas-modal scaffolding (backdrop + close button). Body sections:

```
+─ Regimes on <chrom> ─────────────────────── × ─+
│                                                 │
│ Staged for assign (only in assign mode):        │
│ [L2#12]  [L2#13]  [L2#14]  [L2#27]  (4 L2s)     │
│                                                 │
│ ─── Existing regimes ───                         │
│ ● Inversion system A    (4 L2s)  [+ add staged] │
│   ▸ L2#12, L2#13, L2#14, L2#27                  │
│   [edit] [delete]                                │
│                                                 │
│ ● Inversion system B    (2 L2s)  [+ add staged] │
│   ▸ L2#5, L2#6                                  │
│   [edit] [delete]                                │
│                                                 │
│ ─── + Create new regime ───                      │
│ label: [____________]  color: [▢] [create]      │
│                                                 │
+─────────────────────────────────────────────────+
```

In standalone-registry mode (entered via `catRegimeRegistry`), the
"Staged for assign" section is hidden + the "[+ add staged]" buttons
are hidden.

## 4. State + data flow

### 4.1 New state slots
- `state.catalogueSelection`: `Set<l2_index>` — already maintained by the
  existing checkbox handlers (catSelectAll / catClearSel + per-row clicks
  on the catalogue table). Read-only here.
- `state._regimeModalMode`: `'registry' | 'assign' | null` — drives the
  modal's open state and which subsections are visible.

### 4.2 Reads
- `regimes_registry.getRegimesForChrom(state.data.chrom)` returns the
  existing annotations.
- `state.data.l2_envelopes` is the L2 inventory (for resolving indices
  to display labels like `LG07_L2_27`).

### 4.3 Writes
All mutations go through `regimes_registry`:
- `createRegime({chrom, label, color, l2_indices, notes})` — returns id.
- `updateRegime(id, {label?, color?, notes?})` — partial update.
- `addL2sToRegime(id, l2_indices)` — append.
- `removeL2sFromRegime(id, l2_indices)` — remove (for the row delete button).
- `deleteRegime(id)` — hard delete with confirm prompt.

After every mutation: re-render the modal body (it's small) +
re-render the catalogue table (regime membership shows up as a coloured
row dot in the catalogue's regime column — currently rendered but
always empty because no regimes exist).

## 5. UX details

### 5.1 Assign-mode close behaviour
After "+ add staged" on an existing regime: the staged L2s move from
the "Staged" section to the regime's "▸" member list (visual feedback
that the add succeeded). The modal STAYS OPEN so the user can:
- Assign the same staged set to multiple regimes (rare but supported).
- Assign different subsets via the "+ create new regime" flow.
- Close manually when done (× button or Esc).

### 5.2 Validation
- Label: required, max 60 chars, no leading/trailing whitespace.
- Color: required, hex `#rrggbb`. Picker offers a default 6-swatch
  palette + a free-form color input.
- L2 indices: must exist in `state.data.l2_envelopes`. Reject silently
  (with console.warn) for unknown indices.

### 5.3 Empty states
- Registry mode, no regimes defined: show "No regimes on this chrom yet.
  Use the form below to create the first one."
- Assign mode, no selection: button is disabled (tooltip "select at
  least one row in the catalogue first"). Wire the disable state into
  `_refreshRegimeAssignBtn(state)` called after every selection change.

## 6. Wire-up

```js
// catalogue.js, inside wireCatalogueToolbar:

const regBtn = document.getElementById('catRegimeRegistry');
const asnBtn = document.getElementById('catRegimeAssignSel');

if (regBtn) {
  regBtn.addEventListener('click', () => {
    state._regimeModalMode = 'registry';
    openRegimeModal(state);
  });
}
if (asnBtn) {
  asnBtn.addEventListener('click', () => {
    if (!state.catalogueSelection || state.catalogueSelection.size === 0) return;
    state._regimeModalMode = 'assign';
    openRegimeModal(state);
  });
  _refreshRegimeAssignBtn(state);   // sets initial disabled state
}
```

Plus a `_refreshRegimeAssignBtn(state)` call inside the existing
selection-change handlers so the button's enabled state tracks the
selection size.

## 7. Failure modes

| # | condition | behaviour |
|---|---|---|
| 7.1 | regimes_registry write fails (quota / disabled localStorage) | catch + show toast "regime save failed: <reason>"; modal stays open with the user's draft preserved |
| 7.2 | User confirms delete on a regime currently assigned to a candidate | regime gone from registry; the catalogue's regime column for that row reverts to "—". Candidate persistence is independent — the candidate keeps its `regime_id` slot but it now points at nothing. Cleanup is on the user (or a future "orphan regime_id" sweep) |
| 7.3 | Two browser tabs edit the same chrom's regimes concurrently | Last write wins. No optimistic locking. Acceptable for the single-user workflow this targets |

## 8. Decision rationale

- **Why one modal for both buttons** (not a separate registry view +
  inline assign-row in the catalogue toolbar): the staged-L2 list +
  the existing-regime list need to be visible side-by-side for the user
  to make assignment decisions. Splitting them is more clicks for
  worse comprehension.
- **Why localStorage and not server-side persistence**: matches the
  existing regimes_registry behaviour. Server-side is its own SPEC
  (registry v2 + sync). Local-only is fine for the single-user case
  these buttons serve.
- **Why "stays open after assign"**: a typical workflow is "I'm
  classifying these 10 selected L2s; 3 go to regime A, 4 to regime B,
  3 to a new regime C." Closing after each click would force re-opening
  + re-staging.

## 9. Open questions for Quentin

1. **Color palette**: ship a 6-default-color picker + free-form input,
   OR a richer picker (palette swap, "use brand color X")?
2. **Regime ordering** in the modal list: by creation order, by member
   count, by label alphabetical? Default: creation order (matches how
   `regimes_registry` returns them today).
3. **Catalogue display**: the catalogue table currently has a regime
   column that's always empty. Once regimes exist, render the regime
   label + colored swatch in that column. (Out of scope of this SPEC
   to design, but please confirm the row visualization that's wanted.)
4. **Bulk-delete L2s from a regime**: the row UI shows individual L2
   member chips; do they need a per-chip "✕" remove? Or is the assumption
   that the user re-creates the regime when membership changes
   significantly?
5. **Regime export**: should the regime list participate in
   `catExportTSV` / `catExportJSON` as an extra column? Or get its own
   download button?
