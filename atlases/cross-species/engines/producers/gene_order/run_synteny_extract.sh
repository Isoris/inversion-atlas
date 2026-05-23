#!/usr/bin/env bash
# run_synteny_extract.sh -- extract breakpoints from your RIdeogram synteny files
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
D="${1:?usage: run_synteny_extract.sh /mnt/c/Users/quent/Desktop/MS_CGA/macrosyntR_6}"
OUT="${2:-$HERE/../results}"
mkdir -p "$OUT"

# hybrid_haps = Gar(Chr_1) vs Mac(Chr_2), hybrid frame, colored fills (richest)
python3 "$HERE/rideogram_to_breakpoints.py" --synteny "$D/synteny_hybrid_haps.txt" \
    --focal-name HybGar --query-name HybMac --collapse-orientation-runs \
    --out "$OUT/synteny_bp_hybrid_haps.tsv"

# optional: frame check against karyotype (no .fa needed)
python3 "$HERE/verify_frame_from_karyotype.py" --synteny "$D/synteny_hybrid_haps.txt" \
    --karyotype "$D/karyotype_hybrid_haps.txt" --focal-species HybGar || true

echo "synteny breakpoints -> $OUT/synteny_bp_hybrid_haps.tsv"
