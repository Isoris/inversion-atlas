#!/usr/bin/env bash
# bundle_all.sh -- gather every result TSV + scripts + manifest into one folder
# and a tarball, ready to send to the thesis-table chat.
# Run from the dir holding scripts/ + results/.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # the INVERSION_ARC dir
SRC="${1:-$HERE}"                  # where results/ lives (default: arc dir)
STAMP="$(date +%Y%m%d)"
BUNDLE="$SRC/COMPARATIVE_BREAKPOINTS_BUNDLE_${STAMP}"
mkdir -p "$BUNDLE/results" "$BUNDLE/scripts" "$BUNDLE/inputs_note"

# 1. all result TSVs
cp -v "$SRC"/results/*.tsv "$BUNDLE/results/" 2>/dev/null || true
[[ -d "$SRC/results/sweep" ]] && cp -rv "$SRC/results/sweep" "$BUNDLE/results/" 2>/dev/null || true

# 2. all scripts that produced them
cp -v "$SRC"/scripts/*.py "$SRC"/scripts/*.sh "$BUNDLE/scripts/" 2>/dev/null || true

# 3. manifest: what each file is
cat > "$BUNDLE/MANIFEST.md" <<EOF
# Comparative cross-species breakpoint bundle ($STAMP)

COHORT: comparative / assembly (18 catfish genomes + hybrid subgenomes).
FRAME : focal genomes fClaHyb_Gar / fClaHyb_Mac (hybrid, matches wfmash BPATLAS).
NOTE  : NO hatchery cohort here. Haploblock-bounding join is a SEPARATE next chat.

## Method families (independence matters for claims)
- gene_order : synteny18, synteny5, genejson  (all BUSCO gene-order; correlated)
- sequence   : wfmash                          (sequence alignment; independent)
A breakpoint corroborated by gene_order AND sequence = cross-method (strong).
Many species agreeing = recurrent (one method), NOT multi-method.

## Files in results/
- breakpoint_clusters.tsv          consolidated clusters across all sources;
                                   cross_method=yes flags gene_order+sequence agreement.
                                   HEADLINE cross-method: LG27 (12.4 & 16.5 Mb), LG23 (4.0).
- synteny_18sp_breakpoints.tsv     multi-species gene-order, 18 species, focal=Gar
- synteny_5sp_breakpoints.tsv      denser gene-order, 5 species (positional sharpening)
- csbp_json_breakpoints.tsv        strand-aware gene-order (Gar vs Mac), 3 called bps
- pairwise_summary_fClaHyb_Gar.tsv Gar-vs-EACH species: focal edge + n_species + species_list
- pairwise_summary_fClaHyb_Mac.tsv Mac-vs-EACH species (Mac frame)
- pairwise_long_*.tsv              per (focal edge x species) detail, both focals
- sweep/                           edge-merge-kb tolerance sweep (stability check)
- evidence_matrix.tsv              (older fixed-bin view; superseded by clusters)

## wfmash status
breakpoints_raw.tsv (results_bpatlas, on /mnt/e) was the sequence source used.
wfmash-for-ALL-species must be run on LANTA (genomes there):
  scripts/run_wfmash_all_species_LANTA.sh   (sbatch on LANTA, then re-cluster)

## For the thesis-table chat
Build styled supplementary tables (S-series, landscape, method-column shading,
anti-overclaim captions) from breakpoint_clusters.tsv + the two pairwise_summary
files. Two-tier framing:
  Tier 1: cross-method corroborated breakpoints (gene_order + sequence)
  Tier 2: recurrent multi-species breakpoints (gene_order, high n_species)
Keep cohort wording strict: these are cross-species fixed-divergence breakpoints,
to be intersected with hatchery haploblocks in a LATER analysis (coordinates only).
EOF

# 4. tarball
( cd "$SRC" && tar czf "COMPARATIVE_BREAKPOINTS_BUNDLE_${STAMP}.tar.gz" "$(basename "$BUNDLE")" )
echo ""
echo "Bundle folder: $BUNDLE"
echo "Tarball:       $SRC/COMPARATIVE_BREAKPOINTS_BUNDLE_${STAMP}.tar.gz"
echo "Copy to /mnt/e:  cp -r $BUNDLE /mnt/e/01-catfish_assembly_manuscript_CGA/"
