#!/usr/bin/env bash
# sweep_both_focals.sh -- Gar-vs-each AND Mac-vs-each, swept across edge-merge-kb.
# Same idea as the cross-method tolerance sweep: stable = real, collapsing = artifact.
set -euo pipefail
TABLE="${1:-orthologs_18sp.tsv}"
OUT="${2:-results}"
mkdir -p "$OUT/sweep"
KBS=(500 250 200 150 100 50 25 10 5 1)

for FOCAL in fClaHyb_Gar fClaHyb_Mac; do
  echo "############ $FOCAL ############"
  for KB in "${KBS[@]}"; do
    python3 pairwise_all_species.py --table "$TABLE" \
      --focal-species "$FOCAL" \
      --out-long   "$OUT/sweep/long_${FOCAL}_${KB}kb.tsv" \
      --out-summary "$OUT/sweep/summary_${FOCAL}_${KB}kb.tsv" \
      --edge-merge-kb "$KB" 2>&1 | grep '\[pairwise\]' | sed "s/^/  ${KB}kb: /"
  done
  echo ""
done
echo "Summaries per tolerance in $OUT/sweep/. The >=3-species count is the stability signal."
