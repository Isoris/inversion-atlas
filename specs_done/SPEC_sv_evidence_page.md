# SPEC — SV Evidence Page (`sv_evidence`)

**Status**: SHIPPED — was SPEC ONLY (referenced from page + producer
without an on-disk doc) until 2026-05-15.
**Authored from shipped code** (recovery of a missing SPEC).
**Implemented in**:
- Page (browser): `atlases/inversion/pages/review/sv_evidence.{html,js}`
  + external renderer `js/atlas_sv_evidence.js`
- Producer pipeline (cluster-side): `atlases/inversion/engines/producers/sv_evidence/`
  - `STEP_SV_GT_AGG_aggregate_genotype_counts.py`
  - `STEP_SV_EVID_COMB_emit_combinations.py`
  - `STEP_SV_SUPPORT_emit_support_by_sample.py`
  - `write_candidate_folder.py` (shared library)
  - `run_sv_evidence_pipeline.slurm` (LANTA wrapper)

**Page contract**: `docs/generated/page_contracts/sv_evidence/`

---

## §1. Purpose

A **read-only candidate-level view of SV calls** clustered around a
candidate's boundaries, scored against the karyotype groups. The
page consumes per-candidate JSON layers produced by the cluster-side
pipeline and renders three stacked panels: SV table, UpSet plot of
caller intersections, dosage heatmap.

Cohort discipline: **226-sample pure *C. gariepinus* hatchery only**
— NOT F1 hybrid, NOT *C. macrocephalus* wild.

## §2. Data layout

Per-candidate folder under `<out-root>/<chrom_label>/candidates/<candidate_id>/`:

```
<out-root>/
└── C_gar_LG28/
    ├── manifest.json                          ← chrom-level index
    └── candidates/
        └── INV_LG28_003/
            ├── sv_genotype_counts.json        ← steps 1-4 (this SPEC)
            ├── sv_evidence_combinations.json  ← step 5 UpSet panel
            └── sv_support_by_sample.json      ← step 6 heatmap
```

The atlas page accepts **either** drag-dropping the candidate folder
directly (folder-walk via `webkitGetAsEntry()` picks up every JSON
inside) **or** dropping a single layer at a time.

---

## §3. Producer step 1: `STEP_SV_GT_AGG`

### §3.1 Inputs

| flag | required | description |
|------|----------|-------------|
| `--vcf` or `--tsv` | one of | merged DELLY+Manta VCF (with GT field) OR tabular TSV: `sv_id chrom position_bp end_bp sv_type sample_id GT [quality] [callers]` |
| `--candidate` | yes | candidate JSON (must include `candidate_id`, `chrom`, `boundary_left_bp`, `boundary_right_bp`; optional `zone_definitions_bp`) |
| `--karyotype` | yes | TSV: `sample_id <tab> label` where label ∈ {`HOMO_1`, `HET`, `HOMO_2`} (the annotation_cockpit lock format) |
| `--out-root` | yes | output root directory |
| `--fdr-cutoff` | no | FDR threshold for "associated" classification (default 0.05) |
| `--indent` | no | JSON indent (default: compact one-line; use 2 for debug) |

### §3.2 Per-SV pipeline

For each SV call within the candidate window:

1. **Bin samples** into the three karyotype groups H1/H1, H1/H2,
   H2/H2 from the locked karyotype labels.
2. **Compute counts** per group: `AA / AB / BB / miss`.
3. **Fisher's exact test** on the H1/H1 vs H2/H2 contingency
   (log-space hypergeometric) → `OR` + raw `p_value`.
4. **Benjamini-Hochberg FDR** correction across all SVs in the
   candidate window → `fdr_bh`.
5. **Zone classification**: assign each SV to one of
   `left_flank` / `left_boundary` / `inversion_body` /
   `right_boundary` / `right_flank` based on `position_bp` relative
   to `boundary_{left,right}_bp` and any `zone_definitions_bp`
   override. Default boundary zones span ±500 kb either side of the
   refined boundary.
6. **Pattern-label classification** (§3.3 below).
7. Build `boundary_summary.{left,right}.by_sv_type` aggregate counts
   for the right-rail tables.

### §3.3 Pattern-label decision rule

The classifier assigns one of:
- `canonical_breakpoint_marker`
- `dominant_presence_marker`
- `het_specific_marker`
- `sub_haplotype_marker`
- `internal_linked_marker`
- `uninformative`

#### Definitions

```
n11, n12, n22 = total non-missing genotypes in H1/H1, H1/H2, H2/H2
c11, c12, c22 = carriers (AB or BB) in each group
f11, f12, f22 = c / n      (carrier fraction per group)
```

#### Rule order (first match wins)

1. **Het-specific marker** — checked **BEFORE the FDR gate**:
   ```
   n12 ≥ 5
   AND (h12.AB / n12) ≥ 0.5
   AND f11 ≤ 0.1
   AND f22 ≤ 0.1
   ```
   **Why before FDR**: by construction a het-specific marker is
   invisible to the H1/H1-vs-H2/H2 Fisher test (both homozygote
   groups carry at the same near-zero rate), so its FDR will be ~1
   even though the marker is real and important. Recognized by
   group-fraction structure instead of the OR.

2. **FDR gate** — all subsequent rules require `fdr < fdr_cutoff`
   (default 0.05). If `fdr >= fdr_cutoff` → `uninformative`.

3. **Canonical breakpoint marker**:
   ```
   zone ∈ {left_boundary, right_boundary}
   AND OR ≥ 10
   AND ((f22 ≥ 0.7 AND f11 ≤ 0.1) OR (f11 ≥ 0.7 AND f22 ≤ 0.1))
   ```

4. **Dominant presence marker** (zone-agnostic):
   ```
   (f22 ≥ 0.6 AND f11 ≤ 0.05)
   OR (f11 ≥ 0.6 AND f22 ≤ 0.05)
   ```

5. **Sub-haplotype marker** — bimodal in one homozygous group:
   ```
   ∃ g ∈ {h11, h22}: n(g) ≥ 10 AND 0.2 ≤ carriers(g)/n(g) ≤ 0.5
   ```

6. **Internal linked marker**:
   ```
   zone == "inversion_body"
   AND OR ≥ 3
   ```

7. Otherwise → `uninformative`.

### §3.4 Output schema — `sv_genotype_counts_v1`

```json
{
  "format_version":      "sv_genotype_counts_v1",
  "candidate_id":        "<string>",
  "chrom":               "<string>",
  "boundary_left_bp":    <int>,
  "boundary_right_bp":   <int>,
  "zone_definitions_bp": { "<zone>": [<lo>, <hi>], ... },
  "groups_used": {
    "H1/H1": { "n": <int>, "members": [<sample_id>, ...] },
    "H1/H2": { "n": <int>, "members": [<sample_id>, ...] },
    "H2/H2": { "n": <int>, "members": [<sample_id>, ...] }
  },
  "sv_calls": [
    {
      "sv_id":        "<string>",
      "chrom":        "<string>",
      "position_bp":  <int>,
      "end_bp":       <int>,
      "sv_type":      "BND" | "INV" | "DEL" | "DUP" | <other>,
      "callers":      [<string>, ...],
      "zone":         "left_flank" | "left_boundary" | "inversion_body" | "right_boundary" | "right_flank",
      "gt_counts": {
        "H1/H1": { "AA": <int>, "AB": <int>, "BB": <int>, "miss": <int> },
        "H1/H2": { ... },
        "H2/H2": { ... }
      },
      "fisher": {
        "odds_ratio":  <float | null>,    // null encodes infinity
        "p_value":     <float>,
        "fdr_bh":      <float>
      },
      "pattern_label":  "<see §3.3>",
      "notes":          "<string>"
    },
    ...
  ],
  "boundary_summary": {
    "left":  { "interval_bp": [<lo>, <hi>], "by_sv_type": { "BND": {"n_total": <int>, "n_associated_fdr_lt_0_05": <int>}, "INV": {...}, "DEL": {...}, "DUP": {...}, "Other": {...} } },
    "right": { ... }
  },
  "upset_top_combinations": []     // populated by STEP_SV_EVID_COMB; empty here
}
```

### §3.5 Default zone definitions

If `zone_definitions_bp` is not provided in the candidate JSON:

| zone | range |
|------|-------|
| `left_flank` | `(-∞, boundary_left_bp - 500 kb)` plus the immediate `[boundary_left_bp - 500 kb, boundary_left_bp)` band |
| `left_boundary` | `[boundary_left_bp, boundary_left_bp + 500 kb)` |
| `inversion_body` | `[boundary_left_bp + 500 kb, boundary_right_bp - 500 kb)` |
| `right_boundary` | `[boundary_right_bp - 500 kb, boundary_right_bp + 500 kb)` |
| `right_flank` | `[boundary_right_bp + 500 kb, +∞)` |

Note the asymmetry around `boundary_left_bp`: any SV within
`[bL - 500 kb, bL)` is classified as `left_flank` (not
`left_boundary`); the boundary zone starts AT `bL`. This matches
the producer's fallback inference and the convention of "the
boundary is the rightmost flank of the inversion body."

---

## §4. Producer step 2: `STEP_SV_EVID_COMB`

Produces `sv_evidence_combinations.json` for the UpSet plot panel.
Contract: per-candidate top-N caller intersections with sample
counts. (Schema details: see source.)

## §5. Producer step 3: `STEP_SV_SUPPORT` (future / step 6)

Produces `sv_support_by_sample.json` for the dosage heatmap panel.
Per-sample SV support across the candidate's flanking + body zones.

---

## §6. Page integration

### §6.1 Architecture

`sv_evidence` is a **thin loader stub**. The renderer is
`window.AtlasSVEvidence` — an **object** with `.init` /
`.loadCandidate` / `.destroy` methods (distinct from popstats/ancestry_per_window's
single-function renderers). Defined externally in
`js/atlas_sv_evidence.js` (NOT inlined in legacy
`Inversion_atlas.html`).

### §6.2 Lifecycle

```
mount()                  → showSvEvidencePage(legacyState)
                            → if window.AtlasSVEvidence absent:
                                paint missing-module fallback in
                                #sv_evidence_root (guarded by
                                .__svInitFailed)
                              else:
                                AtlasSVEvidence.init() ONCE
                                  (guarded by mod.__pageInitDone)
                                AtlasSVEvidence.loadCandidate(cid)
                                  (guarded by mod.__lastCid; refired
                                  only when activeCandidate id changes)

unmount()                → hideSvEvidencePage()
                            → AtlasSVEvidence.destroy() if available
```

### §6.3 Inputs from atlas state

- `state.candidate.id` — drives `loadCandidate(cid)`.
- File path: `json/sv_genotype_counts/<cid>.json` (relative to data
  root).

### §6.4 Three stacked panels

1. **SV table** — columns: `caller`, `type`, `chrom`, `pos`, `len`,
   `support`, gt-counts. Filterable / sortable.
2. **UpSet plot** — caller intersections from
   `sv_evidence_combinations.json` (or fallback if only `sv_genotype_counts.json` is loaded).
3. **Dosage heatmap** — step-6 spec dosage view from
   `sv_support_by_sample.json`.

---

## §7. Outputs

### Preview-only (rendered in browser)

- SV table per candidate
- UpSet plot of caller intersections
- Dosage heatmap

### Committable

None. This page is read-only.

If live SV-evidence aggregation is wanted, an endpoint must be added
to `popstats_server.py` first; the page's contract assumes
precomputed JSONs.

---

## §8. Open questions / future work

- **v2 het-specific contrast**: A separate Fisher contrast (het vs
  homs combined) for het-specific markers — a clean addition for
  schema v2. Current rule gates `het_specific_marker` *before* FDR
  (per §3.3 rule 1) because the H1/H1-vs-H2/H2 contrast is blind to
  it.
- **Live SV evidence endpoint**: would let the page work without
  precomputed `sv_genotype_counts.json`. Requires adding a route to
  `popstats_server.py`.
- **Cross-candidate SV reuse panel**: would surface SVs that appear
  at the same position in multiple candidates (likely shared
  mechanism). Out of scope for the current per-candidate page.

---

## §9. References

- **Page contract**: `docs/generated/page_contracts/sv_evidence/`
- **Producer README**: `atlases/inversion/engines/producers/sv_evidence/README.md`
- **Server**: `atlases/inversion/server/SERVER_README.md` (the
  popstats live server; no SV endpoint today)
- **Karyotype lock format**: annotation_cockpit / karyotype_tier produce the
  `HOMO_1` / `HET` / `HOMO_2` locked labels consumed by `--karyotype`
- **Three-cohort discipline**: see `atlases/inversion/manifest.json`
  + `_handoff_docs/SCAFFOLDING_NOTES.md`

---

**Authored**: 2026-05-15 from shipped code (sv_evidence.js +
STEP_SV_GT_AGG_aggregate_genotype_counts.py:208-265 + producer
README). One of the 8 SPECs identified as missing on disk in
`_handoff_docs/SPECS_AUDIT.md`.
