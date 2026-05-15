# SPEC — L3 Het / Dosage Coloring

**Status**: SHIPPED (Slice 1) — was SPEC ONLY (referenced from
`pages/discovery/page1.html` without an on-disk doc) until 2026-05-15.
**Authored from shipped code** (recovery of a missing SPEC).
**Originator turn**: turn 128d (per inline `// turn 128d Slice 1
(SPEC_l3_het_dosage_coloring.md):` comments at the implementation
sites).

**Implemented in (Slice 1)**:
- `atlases/inversion/pages/discovery/page1.html` lines 1407-1425 —
  `#l3HetToggle` checkbox + `#l3HetToggleLabel` wrapper
- `atlases/inversion/pages/discovery/page1/l3_panel.js` — paint
  logic for L3 mini-PCA dots when `state.l3HetColoring === true`
- `atlases/inversion/shared/het_rate.js` — `hetRateColor(het_rate)`
  primitive (cold blue → neutral → warm red ramp)
- `atlases/inversion/pages/discovery/page1/_state.js` — toggle
  setter + localStorage persistence

**Page contract**: `docs/generated/page_contracts/page1/`
(L3 panel listed under `panels[].id = 'l3_panel'`)

**Companion specs**:
- `specs_done/SPEC_band_track_extraction_and_l3_single_band_rows.md`
  (parent — defines L3 contingency + the single-band rows view this
  toggle layers on top of)

---

## §1. Purpose

When ON, every **L3 mini-PCA dot** in the L3 contingency panel is
painted by the per-sample **heterozygosity rate** (computed from the
`dosage_chunks` layer) **instead of the K-means band colour**.

Cold blue = low het (homozygous), neutral = expected ~0.5 het (HET
band), warm red = excess het.

Goal: surface samples whose het rate disagrees with their K-means
band assignment — e.g. **"this sample is in band g0 but its het
rate suggests g1"**.

## §2. Capability + visual contract

### §2.1 Mini-PCA dot fill

When `state.l3HetColoring === true`:

- Each dot's **fill color** = `hetRateColor(per_sample_het_rate)`
  (from `shared/het_rate.js`)
- Per-sample het rate is computed from the loaded `dosage_chunks`
  layer (a per-window dosage matrix that the dosage producer ships
  alongside the precomp).

When `state.l3HetColoring === false` (default):

- Each dot's fill = the K-means band colour (the legacy behaviour).

### §2.2 Tracked-sample halo

Tracked samples (in `state.tracked`) get a **halo ring** around their
dot. The halo's colour stays **K-cluster-coloured** regardless of
the het toggle — so the user can see:

- **Fill** = "what the het rate says about this sample"
- **Halo** = "what K-means assigned this sample"

When the two disagree, the visual signal is "fill colour ≠ halo
colour". This is the diagnostic users are looking for.

### §2.3 Color ramp (`hetRateColor`)

Defined in `shared/het_rate.js`. Continuous mapping:

| het rate | colour | meaning |
|----------|--------|---------|
| 0.0 | deep blue | homozygous (no het sites) |
| ~0.5 | near-neutral | expected for true HET |
| 1.0 | deep red | excess heterozygosity |

Mid-points interpolate smoothly. Out-of-range values clamp.

## §3. Toggle + persistence

### §3.1 State slot

`state.l3HetColoring` — boolean; default `false`.

### §3.2 DOM control

```
#l3HetToggleLabel  ← wrapper <label>
  └ #l3HetToggle   ← <input type="checkbox">
```

Tooltip on the wrapper:

> Color L3 mini-PCA dots by per-sample heterozygosity rate
> (computed from dosage_chunks layer). Cold blue = low het
> (homozygous), neutral = expected ~0.5 het (HET band), warm red =
> excess het. The K-cluster halo on tracked dots stays
> K-cluster-colored. Disabled until a dosage_chunks JSON layer is
> loaded.

### §3.3 Persistence

`localStorage` key: `pca_scrubber_v3.l3HetColoring` — stores `'1'`
or `'0'`. Cohort-level (not per-chrom).

### §3.4 Disable rules

The toggle is **disabled** (greyed out, unclickable) when the
`dosage_chunks` layer is not present in `state.layersPresent`.
Disabling logic lives in `_isLinesColorModeAvailable` /
`refreshL3HetToggle` (in `l3_panel.js`).

When disabled, the tooltip explains what's missing
("Disabled until a dosage_chunks JSON layer is loaded.").

## §4. Why per-sample het rate

The het rate per sample comes from the `dosage_chunks` layer's
allele-dosage matrix, NOT from a separate het-rate layer. This is
deliberate:

- `dosage_chunks` is already loaded for the active candidate (page2
  uses it for the dosage heatmap).
- Computing het rate is `O(n_markers)` per sample — cheap.
- Avoids needing yet another producer step / layer.

Het rate per sample = fraction of markers in the window where the
sample's dosage falls in the heterozygous range (typically
`0.5 ± window_width`; window_width is configurable in
`shared/het_rate.js`).

## §5. K-mode interaction

The L3 panel supports three K-mode views (per the `K=3` / `K=6 ⚠`
/ `K=3+6` buttons immediately above the het toggle in `page1.html`):

- **K=3** — coarse split into {REF, HET, INV}-like bands
- **K=6 ⚠** — sub-resolves into nested haplotype clusters (warning
  about over-interpretation)
- **K=3+6** — both stacked side-by-side

The het toggle **applies to all three K-mode views simultaneously**.
The fill colour mapping is K-mode-independent; the halo colour
follows the active K-mode.

## §6. Diagnostic value

The intended user workflow:

1. User opens page1, loads precomp + `dosage_chunks` layer.
2. User looks at the L3 panel with K=3 bands coloured by K-means.
3. User clicks the `het` toggle.
4. The fill colour redraws by per-sample het rate.
5. **If fill colour matches halo colour** → K-means and het rate
   agree → confidence in the band assignment.
6. **If fill colour disagrees with halo colour** → potential
   miscall:
   - "Looks like band g0 (homozygous) by K-means but het rate is high
     → maybe a HET that K-means clustered with g0 due to noise?"
   - Sample worth flagging / inspecting on page2.

## §7. References

- **DOM control**: `pages/discovery/page1.html#l3HetToggle` +
  `#l3HetToggleLabel`
- **State slot**: `state.l3HetColoring`
- **Persistence key**: `pca_scrubber_v3.l3HetColoring`
- **Color ramp**: `atlases/inversion/shared/het_rate.js#hetRateColor`
- **Source layer**: `dosage_chunks` (per-window allele-dosage
  matrix; producer-side)
- **L3 panel renderer**: `pages/discovery/page1/l3_panel.js`
  (`renderL3Panel`, `renderL3PanelSlab`, `renderL3PanelScaleStability`)
- **Companion controls in same toolbar block** (`l3-more-item`):
  het toggle, L2-sweep toggle (per
  `specs_done/SPEC_l2_sweep_inheritance.md`)
- **K-mode buttons**: `data-l3k="k3" | "k6" | "both"` in
  `page1.html` lines 1399-1406

---

**Authored**: 2026-05-15 from `pages/discovery/page1.html` lines
1407-1425 + the inline turn-128d annotation on the toggle. One of
the 8 SPECs identified as missing on disk in
`_handoff_docs/SPECS_AUDIT.md`.
