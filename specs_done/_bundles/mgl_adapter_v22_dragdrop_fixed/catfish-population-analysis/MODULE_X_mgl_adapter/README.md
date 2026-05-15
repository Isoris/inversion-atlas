# mgl_adapter — multi-allelic Beagle for ANGSD GLF10

Convert ANGSD's full 10-genotype-likelihood output (`-doGlf 1`) into a
PCAngsd-ready Beagle with **one row per (site, allele-pair)**, full per-pair
support metadata, optional support-weighted GLs, sliding-window local PCA in
the JSON shape `pca_scrubber_v3` already loads, and a rare-pair scanner.

## Architecture

```
ANGSD -doGlf 1 (one expensive job per candidate interval)
       │
       ↓
  ┌──────────────────────────────────────────────┐
  │  master_all_pairs.beagle.gz   (UNFILTERED)   │ ──→ scan_rare_pairs.R
  │  master_all_pairs.beagle.pairs.tsv (sidecar) │     ↓
  └────────────────────┬─────────────────────────┘    rare_pair_windows.tsv
                       │ beagle_filter_pairs.R
                       │ (role + support filters)
       ┌───────────────┼───────────────────┐
       ↓               ↓                   ↓
   bi_baseline    tri_extras            all_pairs
   .beagle.gz    .beagle.gz            .beagle.gz
       │               │                   │
       │               │                   ├── beagle_weight_by_support.R
       │               │                   │   ↓
       │               │                   │  *.weighted.beagle.gz (PCA-only)
       │               │                   │
       ├───────────────┼───────────────────┤
       │                                   │
       ↓ NGSadmix / evalAdmix / ngsRelate  ↓ PCAngsd (global)
                                           │
                                           ↓ beagle_to_local_pca_json.R
                                           ↓
                                          local_pca_*.json  (atlas-ready)
                                           ↓
                                          compare_local_pca.R → PDF
```

## Three layers of decisions

| Question | Where | Default |
|---|---|---|
| Is this pair real / observable? | adapter | yes if both alleles ≥ 1 read |
| Is this pair statistically trustworthy? | filter | configurable thresholds |
| How much should it count? | weighter | `sqrt(pair_count / max_pair_count)` |

**Master is unfiltered.** Filters and weights are downstream operations on
copies. Same master serves many threshold choices and exploratory subsets.

## Convention

Roles defined per-site by total cohort read count:

| Role     | Definition                          | Defined at       |
|----------|-------------------------------------|------------------|
| `MAJOR`  | Allele with highest total count     | All sites        |
| `MINOR1` | 2nd highest                         | All sites (≥2)   |
| `MINOR2` | 3rd highest                         | Tri+ allelic     |
| `MINOR3` | 4th highest                         | Quad-allelic     |

Pairs emitted in master:

| Site type     | Pairs                                                             | Rows |
|---------------|-------------------------------------------------------------------|------|
| Biallelic     | `MAJOR_MINOR1`                                                    | 1    |
| Tri-allelic   | `MAJOR_MINOR1`, `MAJOR_MINOR2`, `MINOR1_MINOR2`                   | 3    |
| Quad-allelic  | All 6 pairs of MAJOR/MINOR1/MINOR2/MINOR3                         | 6    |

Marker name: `<chrom>_<pos>_<ROLE_a>_<ROLE_b>_<allele_a>_<allele_b>`

## Files

| File                              | Purpose                                                   |
|-----------------------------------|-----------------------------------------------------------|
| `SLURM_A05_glf10_interval.sh`     | ANGSD `-doGlf 1` on one candidate interval                |
| `mgl10_to_beagle.R`               | Layer 1: GLF10 → master all-pairs Beagle + sidecar        |
| `beagle_filter_pairs.R`           | Layer 2: filter master → PCA/admixture-ready view         |
| `beagle_weight_by_support.R`      | Layer 3: support-weight GLs (PCA-only)                    |
| `beagle_to_local_pca_json.R`      | Local PCA: per-window PCA → atlas JSON                    |
| `compare_local_pca.R`             | Side-by-side PDF: bi vs all_pairs vs weighted             |
| `scan_rare_pairs.R`               | Discovery: flag windows with rare multi-allelic pairs     |
| `run_pair_pca_matrix.sh`          | Driver: 8-step pipeline including atlas JSONs and compare |
| `make_test_data.R`                | Tiny synthetic test (5 inds, 4 sites)                     |
| `make_test_data_localpca.R`       | Larger synthetic test (30 inds in 3 groups, 200 sites)    |

## Local PCA producer

`beagle_to_local_pca_json.R` slides a window along a Beagle and emits the
JSON shape that `pca_scrubber_v3/pca_panel.js` loads:

```json
{
  "n_windows": N,
  "n_samples": M,
  "samples": ["S001", ...],
  "view": "all_pairs",
  "weighted": false,
  "window_def": {"mode": "bp_span", "size": 50000, "step": 50000},
  "backend": "direct",
  "windows": [
    {
      "wi": 0, "chrom": "C_gar_LG28", "start": 15115000, "end": 15165000,
      "n_pairs": 2847, "n_unique_sites": 1923,
      "pair_count_median": 312, "n_alleles_obs_mean": 2.18,
      "lam1": 0.043, "lam2": 0.018,
      "pc1": [...], "pc2": [...]
    }, ...
  ]
}
```

**Window definitions:**

| `--window_mode` | Behavior |
|---|---|
| `bp_span` (default) | Fixed bp width per window; variable rows per window. Good for visual spatial uniformity. |
| `n_pairs` | Fixed pair-row count per window; variable bp span. Good for uniform statistical power. |

**Decomposition backends:**

| `--backend` | Behavior |
|---|---|
| `direct` (default) | In-R: posterior dosage → row-centered → covariance → eigendecomposition. Fast (~200 windows/sec). Equivalent to single-E-step PCAngsd with flat prior — standard local-PCA math. |
| `pcangsd` | Per-window: write subset Beagle → `pcangsd -b ... -o ...` → parse `.cov`. Slow but matches PCAngsd's iterative HWE-prior estimate. Use for a reference comparison. |

The `direct` backend produces results that match PCAngsd's flat-prior
single-iteration output and is what most local-PCA tools (lostruct etc.)
actually use. Differences from PCAngsd-iterative are usually small.

## Sidecar columns

Master metadata, one row per Beagle row:

| Column                  | Meaning                                              |
|-------------------------|------------------------------------------------------|
| `marker`                | Same as Beagle col 1                                 |
| `chrom`, `pos`          | Site coordinates                                     |
| `n_alleles_obs`         | 2, 3, or 4                                           |
| `site_total_count`      | Sum of observed allele counts at this site          |
| `role_a`, `role_b`      | `MAJOR`, `MINOR1`, `MINOR2`, `MINOR3`               |
| `allele_a`, `allele_b`  | Actual nucleotides                                   |
| `count_a`, `count_b`    | Cohort read counts                                   |
| `pair_count`            | `count_a + count_b`                                  |
| `pair_fraction`         | `pair_count / site_total_count`                     |
| `min_pair_allele_count` | `min(count_a, count_b)` ← bottleneck support        |
| `n_samples_with_a/b/either` | Inds with ≥1 read                                |
| `maf_pair`              | within-pair MAF                                      |

## End-to-end usage

```bash
# 1) ANGSD job per candidate interval
sbatch SLURM_A05_glf10_interval.sh \
  C_gar_LG28 15115000 18005000 \
  /scratch/.../mgl10/LG28_15.115_18.005

# 2) Run the full matrix:
#    master + 4 views × (unweighted, weighted) +
#    global PCAs + local PCAs + compare PDF + rare-pair scan
GROUPS_TSV=/scratch/.../karyotype_calls.tsv \
LOCAL_PCA_WINDOW_SIZE=50000 \
bash run_pair_pca_matrix.sh \
  /scratch/.../mgl10/LG28_15.115_18.005

# 3) Look at compare_local_pca.pdf to decide if multi-allelic adds anything.
#    If yes → load local_pca_*.json files into pca_scrubber_v3 atlas.
#    If no  → biallelic was sufficient; skip atlas integration.
```

## What this answers

- **"Does multi-allelic information change PCA?"** — Run global PCA on
  `bi_baseline` vs `all_pairs` and compare; or look at `compare_local_pca.pdf`.
  Synthetic-data test shows that when biallelic already separates groups
  cleanly, multi-allelic gives near-identical PC1 directions.
- **"Does support-weighting change PCA?"** — Compare `all_pairs` vs
  `all_pairs.weighted`. On synthetic data with mostly well-supported pairs,
  the answer is "barely" (eigenvalues drop ~10%, PC directions unchanged).
- **"Could this find rare inversions?"** — Run scanner; load the windows it
  flags into the atlas; look at minor PCs.

## What this doesn't do

- **Not a tri-allelic SAF/SFS.** Use standard ANGSD biallelic pipeline for θ.
- **Doesn't call hard genotypes.** Likelihoods only.
- **Not whole-genome.** Run on candidate intervals only.

## Verification

`make_test_data_localpca.R` builds a 30-individual, 200-site synthetic
dataset with 3 latent groups and a simulated inversion in pos 50000-150000.
Running the full chain produces local-PCA JSONs where:

- λ₁ inside the inversion region is ~10× higher than outside
- PC1 cleanly separates the 3 groups inside the inversion
- PC1 collapses to noise outside
- Biallelic-only and all_pairs give near-identical PC1 directions
- Weighted variant gives near-identical PC1, slightly lower λ₁

This is the expected behavior for a clean, well-powered inversion signal.
On real data, deviations from this pattern are diagnostic.
