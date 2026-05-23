#!/usr/bin/env bash
# peek_rideogram.sh -- show the format of RIdeogram synteny + karyotype files
# Usage: bash peek_rideogram.sh /mnt/c/Users/quent/Desktop/MS_CGA/macrosyntR_6
D="${1:?give the macrosyntR_6 dir}"
for f in synteny_hybrid_haps.txt synteny_bighead_hybrid.txt synteny_ternary.txt \
         karyotype_hybrid_haps.txt karyotype_bighead_hybrid.txt karyotype_ternary.txt; do
  p="$D/$f"
  [[ -f "$p" ]] || { echo "--- $f : MISSING ---"; continue; }
  echo "===== $f ($(wc -l < "$p") lines) ====="
  head -4 "$p"
  echo "  ... (delim check: $(head -1 "$p" | grep -q $'\t' && echo TAB || echo 'SPACE/other'))"
  echo ""
done
