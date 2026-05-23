# Synteny breakpoints x hatchery polymorphic inversions

Folder for the JOIN between:
  - comparative cohort: cross-species macrosyntR synteny breakpoints (18 genomes)
  - hatchery cohort:     226-sample C. gariepinus polymorphic inversions (local adaptation)

These are DIFFERENT cohorts. A cross-species breakpoint = fixed divergence between
species; a hatchery inversion = segregating variation in one breeding population.
The join asks: which hatchery polymorphic inversions sit at regions that are ALSO
labile breakpoints across the catfish phylogeny? -> recurrent-rearrangement signal.

inputs/    macrosyntR synteny blocks/breakpoints + hatchery inversion intervals
results/   the join table + concordance hits
scripts/   extraction + join scripts

Copy to /mnt/e/:
  cp -r SYNTENY_INVERSION_JOIN /mnt/e/01-catfish_assembly_manuscript_CGA/
