#!/usr/bin/env bash
#SBATCH -p compute
#SBATCH -N 1
#SBATCH --cpus-per-task=32
#SBATCH --mem=64GB
#SBATCH -t 12:00:00
#SBATCH -J angsd_glf10
#SBATCH -o angsd_glf10.%j.out
#SBATCH -e angsd_glf10.%j.err
###############################################################################
# SLURM_A05_glf10_interval.sh
#
# Run ANGSD with -doGlf 1 to produce full 10-genotype-likelihood output for ONE
# candidate interval. This is the input to mgl10_to_beagle.R.
#
# Usage:
#   sbatch SLURM_A05_glf10_interval.sh \
#     <chrom> <start> <end> <out_prefix>
#
# Example:
#   sbatch SLURM_A05_glf10_interval.sh \
#     C_gar_LG28 15115000 18005000 \
#     /scratch/.../mgl10/LG28_15.115_18.005
#
# Outputs (next to <out_prefix>):
#   <out_prefix>.glf.gz         binary GLF10
#   <out_prefix>.glf.pos.gz     chrom, pos, major_angsd, minor_angsd
#   <out_prefix>.mafs.gz        site-level MAFs
#   <out_prefix>.counts.gz      per-ind A,C,G,T counts (-dumpCounts 3)
#   <out_prefix>.arg            ANGSD argument log
###############################################################################
set -euo pipefail
source ~/.bashrc; mamba activate assembly
source "$(dirname "$0")/../config.sh"

CHROM="${1:?ERROR: provide chrom}"
START="${2:?ERROR: provide start}"
END="${3:?ERROR: provide end}"
OUT_PREFIX="${4:?ERROR: provide out_prefix}"

OUT_DIR="$(dirname "$OUT_PREFIX")"
mkdir -p "$OUT_DIR"

# Build the region argument and a single-line rf file
RF_FILE="${OUT_PREFIX}.rf.txt"
echo "${CHROM}:${START}-${END}" > "$RF_FILE"

P="${SLURM_CPUS_PER_TASK:-32}"

echo "[$(date)] ANGSD -doGlf 1 on ${CHROM}:${START}-${END}"
echo "[$(date)] out_prefix: ${OUT_PREFIX}"
echo "[$(date)] threads:    ${P}"

angsd -b "${BAMLIST}" -ref "${REF}" \
  -GL "${ANGSD_GL}" \
  -doGlf 1 \
  -doMajorMinor 1 \
  -doMaf 1 \
  -doCounts 1 \
  -dumpCounts 3 \
  -doDepth 1 \
  -SNP_pval "${SNP_PVAL}" \
  -minMaf "${MIN_MAF}" \
  -skipTriallelic 0 \
  -minQ "${ANGSD_MINQ}" \
  -minMapQ "${ANGSD_MINMAPQ}" \
  -baq "${ANGSD_BAQ}" \
  -C "${ANGSD_C}" \
  -setMinDepthInd "${ANGSD_MINDEPTHIND}" \
  -setMaxDepthInd "${ANGSD_MAXDEPTHIND}" \
  -minInd "${ANGSD_MININD}" \
  -remove_bads 1 \
  -uniqueOnly 1 \
  -only_proper_pairs 1 \
  -rf "${RF_FILE}" \
  -sites "${CALLABLE_SITES}" \
  -P "${P}" \
  -out "${OUT_PREFIX}" \
  2>&1 | tee "${OUT_PREFIX}.angsd.log"

# Sanity checks
for ext in glf.gz glf.pos.gz mafs.gz counts.gz; do
  f="${OUT_PREFIX}.${ext}"
  if [[ ! -s "$f" ]]; then
    echo "[ERROR] missing or empty: $f" >&2
    exit 1
  fi
  echo "[$(date)] OK: $f ($(du -h "$f" | cut -f1))"
done

echo "[$(date)] [DONE] GLF10 dump for ${CHROM}:${START}-${END}"
echo "[$(date)] Next: Rscript mgl10_to_beagle.R --glf ${OUT_PREFIX}.glf.gz ..."
