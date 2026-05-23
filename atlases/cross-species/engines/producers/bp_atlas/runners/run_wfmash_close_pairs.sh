#!/usr/bin/env bash
# run_wfmash_close_pairs.sh -- wfmash ONLY for close relatives (Clariidae).
# Uses YOUR exact working params (-X -p 90 -s 50000, block-min 250k via caller).
# wfmash needs >=90% identity, so it ONLY works within ~Clarias/Clariidae.
# Distant species are covered by GENE-ORDER (pairwise_all_species.py), not wfmash.
# Watchable, one pair at a time, ~10-20 min each. NOT an overnight all-species job.
set -uo pipefail

GDIR="/mnt/e/01-catfish_assembly_manuscript_CGA/catfish_bundle_no_genomes_no_EDTA/catfish_phylogenomics_v1.0/phylogeny/results_tree_busco_catfish"
OUT="/mnt/e/01-catfish_assembly_manuscript_CGA/cross_species_breakpoints/close_pairs"
# YOUR proven params:
P=90; S=50000; N=1; T=4
# focal genomes (use the _LG hybrid-frame ones from 00_fastas, NOT the GCA copies):
FOCAL_DIR="/mnt/e/01-catfish_assembly_manuscript_CGA/cross_species_breakpoints/00_fastas"
declare -A FOCAL=( [Gar]="$FOCAL_DIR/fClaHyb_Gar_LG.fa" [Mac]="$FOCAL_DIR/fClaHyb_Mac_LG.fa" )
# close relatives only (Clariidae) -- the ones wfmash can actually align at p90:
CLOSE=(C_fuscus C_apus C_bouderius)
CALLER=""   # <-- set to the STEP that made cs_breakpoints_v1.json, to auto-convert PAF->JSON

mkdir -p "$OUT/paf"
command -v wfmash >/dev/null || { echo "wfmash not in PATH (conda activate assembly)"; exit 1; }

for fk in "${!FOCAL[@]}"; do
  FA="${FOCAL[$fk]}"
  [[ -f "$FA" ]] || { echo "MISSING focal $FA"; continue; }
  [[ -s "$FA.fai" ]] || samtools faidx "$FA"
  for sp in "${CLOSE[@]}"; do
    G="$GDIR/$sp.fa"
    [[ -f "$G" ]] || { echo "MISSING $G"; continue; }
    [[ -s "$G.fai" ]] || samtools faidx "$G"
    PAF="$OUT/paf/${fk}__vs__${sp}.paf"
    [[ -s "$PAF" ]] && { echo "[skip] $fk vs $sp"; continue; }
    echo "[wfmash] $fk vs $sp  ($(date +%H:%M))  -- watch RAM"
    # target=focal (coords on focal frame), query=comparison
    wfmash "$FA" "$G" -X -p $P -s $S -n $N -t $T > "$PAF" 2>>"$OUT/wfmash.log" \
      || { echo "  *** failed; rm empty paf"; rm -f "$PAF"; continue; }
    rows=$(wc -l < "$PAF")
    echo "  -> $PAF ($rows rows)"
    [[ "$rows" -lt 10 ]] && echo "  NOTE: very few rows -- $sp may be too diverged for p90 (expected for non-Clarias)"
    [[ -n "$CALLER" && -f "$CALLER" ]] && python3 "$CALLER" --paf "$PAF" \
      --query-species "$sp" --target-species "$fk" \
      --out "$OUT/${fk}__vs__${sp}.json" 2>>"$OUT/caller.log" || true
  done
done
echo "[done] close-pair PAFs in $OUT/paf/. Distant species: use gene-order catalog."
