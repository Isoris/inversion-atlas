#!/usr/bin/env bash
# run_both_focals.sh -- full comparative breakpoint catalog: Gar-vs-each AND Mac-vs-each
# Run from the dir holding the scripts + orthologs_18sp.tsv (+ results/).
set -euo pipefail
TABLE="${1:-orthologs_18sp.tsv}"
OUT="${2:-results}"
MERGE_KB="${3:-200}"
mkdir -p "$OUT"

for FOCAL in fClaHyb_Gar fClaHyb_Mac; do
  echo "=== $FOCAL vs each species ==="
  python3 pairwise_all_species.py --table "$TABLE" \
    --focal-species "$FOCAL" \
    --out-long   "$OUT/pairwise_long_${FOCAL}.tsv" \
    --out-summary "$OUT/pairwise_summary_${FOCAL}.tsv" \
    --edge-merge-kb "$MERGE_KB"
done

echo ""
echo "Outputs:"
echo "  $OUT/pairwise_summary_fClaHyb_Gar.tsv   (Gar-frame: focal edges + n_species + species_list)"
echo "  $OUT/pairwise_summary_fClaHyb_Mac.tsv   (Mac-frame)"
echo "  $OUT/pairwise_long_*.tsv                (per focal-edge x species detail)"
