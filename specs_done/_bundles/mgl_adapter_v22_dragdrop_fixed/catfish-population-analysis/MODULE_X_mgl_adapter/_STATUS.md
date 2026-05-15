# Status: IMPLEMENTED (v5, tested on synthetic data)

The multi-allelic Beagle adapter. Beagle GLs are population-level data
used by downstream modules in catfish-population-analysis,
catfish-diversity-analysis, and catfish-inversion-analysis.

Module number `MODULE_X` is a placeholder — assign per your repo
numbering convention (likely after the existing genotype-likelihood
modules).

## Files

- mgl10_to_beagle.R          → ANGSD GLF10 → master all-pairs Beagle + sidecar
- beagle_filter_pairs.R      → filter master to produce PCA-ready view
- beagle_weight_by_support.R → reweight by per-row pair support
- scan_rare_pairs.R          → discovery scanner for rare-pair windows
- SLURM_A05_glf10_interval.sh → ANGSD GLF10 dump wrapper
- run_pair_pca_matrix.sh     → end-to-end driver
- make_test_data.R           → synthetic test generator
- README.md                  → tool documentation

## Outputs this module produces

- bi_baseline.beagle.gz        ← biallelic baseline view (PCA default)
- all_pairs.beagle.gz          ← multi-allelic view (new contribution)
- bi_baseline.beagle.pairs.tsv ← sidecar with pair_id, support
- all_pairs.beagle.pairs.tsv   ← multi-allelic sidecar

## Downstream consumers (cross-repo)

- catfish-population-analysis/ — additional PCA / structure analyses
- catfish-diversity-analysis/  — heterozygosity, θπ, ROH on Beagle GLs
- catfish-inversion-analysis/  — all inversion modules (HANDOFFs 1, 5-10)

## Validation

`Rscript make_test_data.R` then `bash run_pair_pca_matrix.sh` should run
end-to-end on synthetic data. See README.md.

## Spec reference

Canonical spec: Specs_WIP_modules/mgl_adapter/specs/SPEC_0_master.md
Sections 1-6 cover this module specifically.
