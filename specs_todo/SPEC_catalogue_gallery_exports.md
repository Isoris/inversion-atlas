# SPEC — catalogue gallery exports (SVG / PNG / PDF)

**Status**: SPEC ONLY — authored 2026-05-21 from the dead-button audit
(Group 3). The three `<button>` elements ship in [`catalogue.html:97-99`](../atlases/inversion/pages/catalogue/catalogue.html#L97-L99)
with descriptive titles but no handlers. Wiring blocked on the design
decisions captured below.

**Implemented in**: nothing yet. Implementation surface:
- New module: `atlases/inversion/pages/catalogue/_gallery_export.js`
- Wire from: `atlases/inversion/pages/catalogue/catalogue/catalogue.js`
  (inside `wireCatalogueToolbar`, alongside the working `catExportTSV`/`MD`/`JSON` wires)
- Reuses: confirmed-candidate filter logic in
  [`atlases/inversion/shared/manuscript_bundle.js`](../atlases/inversion/shared/manuscript_bundle.js)
  (the breeding-card export already filters by `state.candidateList`
  where `confirmed === true`).

---

## 1. Goal

A one-click manuscript-figure export: pick a format (SVG / PNG / PDF),
get a single multi-panel image file with one panel per confirmed
candidate, sorted by `start_bp`. Used to drop a "Figure 2 — atlas of
discovered inversions" into a paper.

Three formats because journals demand different things:
- **SVG**: vector, infinitely scalable, journal-preferred for line art.
  The source-of-truth artifact.
- **PNG**: rasterized fallback at ~300 DPI equivalent. Use when a
  journal demands raster.
- **PDF**: vector PDF via the browser's print-to-PDF flow. Hands off
  font rendering to the OS, which yields high-quality output without
  bundling a PDF library.

Trigger buttons live in the catalogue toolbar under a "📷 gallery"
export-group (currently rendered + tooltipped but inert).

## 2. Inputs

- **Candidates**: `state.candidateList.filter(c => c.confirmed)` — the
  same source the breeding-card export uses.
- **Sort order**: by `chrom` then `start_bp` ascending. Matches the
  catalogue's default row order so the figure reads in the same direction.
- **Per-candidate panel data**: the panels need ONE summary view per
  candidate. Open question: which summary? See §6.

## 3. Output shape

### 3.1 SVG (source of truth)

Single `<svg width="W" height="H" viewBox="0 0 W H">` document with:
- One `<g class="cand-panel" transform="translate(x, y)">` per candidate.
- Grid layout: N candidates → ⌈√N⌉ columns × ⌈N / cols⌉ rows.
- Per-panel size: ~280 × 200 px (tunable via a top-of-file constant).
- Page margins + grid gutter: 20 px / 16 px.
- Title above each panel: `cand_<id_short> · chr · start–end Mb · K=<K>`.
- Background: white (manuscripts) — distinct from the atlas's dark theme.

File download via `Blob` + `URL.createObjectURL` (same pattern as
`candListExportBtn` shipped in the karyotype Group-4 work).

### 3.2 PNG

Rendered from the SVG via HTML5 Canvas:
1. Build the SVG document in memory.
2. Create an `<img>` with `img.src = "data:image/svg+xml;base64,..."`.
3. Wait for `img.onload`.
4. Create a `<canvas>` at 4× the SVG dimensions (≈ 300 DPI when the
   target print width is 1 inch per 75 SVG px).
5. `ctx.drawImage(img, 0, 0, W*4, H*4)`.
6. `canvas.toBlob(blob => download(blob))` with `type: 'image/png'`.

Cap canvas dimensions at the browser limit (~16k × 16k); fall back to
2× scale with a console warning if the 4× canvas would exceed it.

### 3.3 PDF

Browser print-to-PDF flow:
1. Build the SVG document.
2. `window.open('', '_blank', 'noopener')` to a blank tab.
3. Write an HTML document into it:
   ```html
   <!DOCTYPE html>
   <html><head>
     <title>Catalogue gallery — {chrom} — {timestamp}</title>
     <style>@page { size: A4 landscape; margin: 8mm; } body { margin: 0; }</style>
   </head><body>{svg-string}</body></html>
   ```
4. `newWin.document.write(...)`, then call `newWin.print()`.
5. The user picks "Save as PDF" from the print dialog.

Trade-off: not a true "one-click download" — user has to acknowledge
the print dialog. Acceptable because the alternative (a PDF library
like `jsPDF`) bloats the bundle by 300+ KB.

## 4. Per-panel rendering — the open question

The headline design decision: **what does ONE panel show**?

Three candidates, picked in increasing order of effort:

### 4.1 Option A — minimal summary card (recommended for v1)

Each panel is a static text-and-chip card with:
- Candidate id + chromosome + bp range
- K-band pill row (one swatch per band, with carrier counts)
- Verdict pill (TWO_INVERSIONS / CROSSOVER_ARTIFACTS / NOISY_REGION / NA)
- Source pill (auto_cramers_v_local / lock_promote / etc.)
- 3-line stats: q50, ratio_high, span_mb

No canvases, no per-candidate compute. Pure SVG text + rects. Fastest
to ship; gives the reader a scannable atlas of "what was discovered."

### 4.2 Option B — sigma profile mini-chart

Adds to Option A: a small (~200 × 60 px) line chart of the candidate's
per-sample σ profile (the same data `drawCandidateSigmaChart` paints on
candidate_focus). Helps the reader spot CROSSOVER_ARTIFACTS visually.

Implementation: call `sigmaProfileCandidate(c)` for the data (memo
already cached on `state.data._sigmaProfileCache` per the candidate_focus
perf work — re-use the cache), render the polyline directly into the
panel's SVG. No canvas roundtrip.

### 4.3 Option C — mini PCA scatter

Adds to Option B: a small (~200 × 200 px) scatter of per-sample PC1/PC2
at the candidate's reference window, coloured by `locked_labels`. The
visual signature of the inversion.

Implementation: would need `drawSlabMiniPCA` (currently a Canvas
renderer) ported to SVG. Bigger lift; defer to v2.

**Recommendation**: ship Option A first (1–2 days), then add Option B's
sigma chart (~1 day) as a v1.1 enhancement. Option C is v2 work.

## 5. State + UI contract

### 5.1 No new state slots required
The export reads `state.candidateList` + the in-DOM toolbar selection
(currently inert; future regime-filter dropdown could add a scope
parameter). All compute is on-demand at click time.

### 5.2 Empty-state handling
If `state.candidateList.filter(c => c.confirmed).length === 0`:
disable all three buttons + tooltip = "no confirmed candidates yet —
promote at least one to enable the gallery export."

### 5.3 Progress UI for PNG/PDF
PNG canvas-rasterization can take 500 ms+ on a 50-panel gallery.
Show a transient toast or button-spinner during the export so the
user doesn't double-click.

## 6. Failure modes

| # | condition | behaviour |
|---|---|---|
| 6.1 | Zero confirmed candidates | buttons disabled (see 5.2); empty state surfaced via tooltip |
| 6.2 | PNG canvas exceeds 16k × 16k browser limit | fall back to 2× scale + console warning; show toast "exported at 2× scale (cohort too large for 4×)" |
| 6.3 | PDF window.open blocked by popup blocker | catch the null return + show toast "popup blocker prevented PDF — allow popups for this site and retry" |
| 6.4 | SVG generation throws (e.g. malformed candidate) | catch + toast "failed: <error.message>" — never silent |

## 7. Per-button status matrix

| button | format | open work |
|---|---|---|
| `catExportGallerySVG` | SVG | All of §1–§6 |
| `catExportGalleryPNG` | PNG | Same + §3.2 (canvas rasterization + 16k guard) |
| `catExportGalleryPDF` | PDF | Same + §3.3 (popup flow + print stylesheet) |

All three share the SVG generation pipeline (§3.1 / §4); PNG and PDF
are post-processing steps on the SVG. Implementation order: SVG → PNG →
PDF (each builds on the previous).

## 8. Decision rationale

- **Why not bundle jsPDF / pdfmake**: bundle size cost (300+ KB) for one
  flow that browsers handle natively via print-to-PDF. The trade-off is
  an extra click for the user, but the bundle savings are atlas-wide.
- **Why 4× canvas for PNG**: 4 ≈ 300 DPI ÷ 75 (default SVG-to-px
  conversion). Yields a raster that prints cleanly at the SVG's native
  layout size. Less = visibly fuzzy on dense panels; more hits the
  16k browser limit on cohorts > 30 candidates.
- **Why grid layout (not single column)**: a 28-candidate single-column
  PDF is 28+ pages; a 6×5 grid fits one A4-landscape page. The grid
  shape (⌈√N⌉ cols) matches the typical "supplementary figure" layout.
- **Why white background instead of the atlas dark theme**: manuscript
  figures expect white. Reuses the dark-→-light convention already
  established in the breeding-card export.

## 9. Open questions for Quentin

1. **Per-panel content**: option A / B / C from §4? Default: A for v1.
2. **Per-panel size**: 280 × 200 px sounds right for ~16 candidates on
   A4 landscape. Should it auto-scale for larger cohorts, or stay
   fixed (and overflow to multiple SVG documents)?
3. **Sort order**: chrom then start_bp? Or by tier / verdict / span?
4. **Confirmed-only filter**: also expose an "include unconfirmed
   (preview)" toggle in the toolbar?
5. **File-naming convention**: `gallery_<chrom>_<timestamp>.{svg,png,pdf}`
   or include the cohort id?
