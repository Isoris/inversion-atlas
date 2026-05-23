#!/usr/bin/env bash
# =============================================================================
# RUN_JOIN.sh -- synteny breakpoints x hatchery polymorphic inversions
# Stage 1 (extract from macrosyntR) -> Stage 2 (join to hatchery inversions)
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"   # the SYNTENY_INVERSION_JOIN folder

# ---------------- CONFIG ----------------
MACROSYNTR_BLOCKS="$ROOT/inputs/macrosyntr_blocks.tsv"   # <- your macrosyntR block table
FOCAL_LABEL="fClaHyb_Gar"
HATCHERY_INVERSIONS="$ROOT/inputs/hatchery_inversions.tsv" # inv_id chrom start_mb end_mb
TOL_KB=150
# Optionally ALSO fold in wfmash BPATLAS / CSBP zones as extra breakpoint sources:
EXTRA_BREAKPOINTS=()   # e.g. (/mnt/e/.../all_zones.tsv  /mnt/e/.../BPATLAS_cgar_inversions.tsv)
# ----------------------------------------

BP="$ROOT/results/synteny_breakpoints.tsv"
echo "[1] extract breakpoints from macrosyntR blocks"
python3 "$HERE/synteny_to_breakpoints.py" --blocks "$MACROSYNTR_BLOCKS" \
    --focal-label "$FOCAL_LABEL" --out "$BP"

# merge any extra breakpoint sources (BPATLAS, CSBP) into one file
MERGED="$ROOT/results/all_breakpoints_merged.tsv"
cp "$BP" "$MERGED"
for x in "${EXTRA_BREAKPOINTS[@]}"; do
    [[ -f "$x" ]] && tail -n +2 "$x" >> "$MERGED" && echo "  + merged $x"
done

echo "[2] join to hatchery inversions"
python3 "$HERE/join_breakpoints_to_inversions.py" \
    --inversions "$HATCHERY_INVERSIONS" --breakpoints "$MERGED" --tol-kb "$TOL_KB" \
    --out-hits "$ROOT/results/join_hits.tsv" \
    --out-summary "$ROOT/results/inversion_summary.tsv"

echo "DONE. See $ROOT/results/inversion_summary.tsv"
