#!/usr/bin/env bash
# =============================================================================
# run_wfmash_all_species_LANTA.sh
# RUN THIS ON LANTA (where the genome FASTAs live), NOT the laptop.
# All-pairs wfmash -> per-pair PAF -> breakpoint tables in the same format as
# the existing results_bpatlas/03_breakpoints/breakpoints_raw.tsv.
#
# This is the "sequence method for all species" layer. It's an HPC job:
# 18 chromosome-scale genomes, all-vs-focal alignment. Submit with sbatch.
# =============================================================================
#SBATCH --job-name=wfmash_allsp
#SBATCH --partition=compute
#SBATCH -N1 -n16 --mem=64G -t 24:00:00
set -euo pipefail

# ---------------- CONFIG (EDIT on LANTA) ----------------
GENOME_DIR="/project/lt200308-agbsci/02-TE_catfish/00-GENOMES"   # the 18 genomes
FOCALS=("fClaHyb_Gar_LG.fa" "fClaHyb_Mac_LG.fa")                  # both focal frames
OUT="${SLURM_SUBMIT_DIR:-.}/wfmash_all_species"
THREADS="${SLURM_CPUS_ON_NODE:-16}"
# wfmash params matching your existing BPATLAS run (approx-map two-pass):
SEG=100000   # -s
MAPQ_N=1     # -n
# --------------------------------------------------------

command -v wfmash >/dev/null || { echo "load wfmash module first (module load / conda activate)"; exit 1; }
mkdir -p "$OUT/paf" "$OUT/breakpoints"

# index genomes once
for g in "$GENOME_DIR"/*.fa; do [[ -f "$g.fai" ]] || samtools faidx "$g"; done

for FOCAL in "${FOCALS[@]}"; do
  fpath="$GENOME_DIR/$FOCAL"; fname="${FOCAL%.fa}"
  [[ -f "$fpath" ]] || { echo "MISSING focal $fpath"; continue; }
  for g in "$GENOME_DIR"/*.fa; do
    gname=$(basename "$g" .fa)
    [[ "$gname" == "$fname" ]] && continue
    paf="$OUT/paf/${fname}__vs__${gname}.paf"
    echo "[wfmash] $fname vs $gname"
    wfmash -t "$THREADS" -s "$SEG" -n "$MAPQ_N" -m "$fpath" "$g" > "$paf" 2>>"$OUT/wfmash.log"
  done
done

echo "[done] PAFs in $OUT/paf/"
echo "Next: run STEP_BP2_call_breakpoints.py (from MODULE_BPATLAS) on these PAFs"
echo "to produce breakpoints_raw.tsv-format tables, then copy back to the laptop"
echo "and add as --source wfmash_allsp:... in cluster_breakpoints.py."
