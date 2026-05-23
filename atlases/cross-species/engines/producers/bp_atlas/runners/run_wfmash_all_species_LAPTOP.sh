#!/usr/bin/env bash
# run_wfmash_all_species_LAPTOP.sh
# Reuses YOUR working recipe (the one that made gar_vs_mac.paf -> cs_breakpoints_v1.json).
# Runs wfmash focal-vs-EACH-species, ONE PAIR AT A TIME (peak RAM = 2 genomes, ~1GB each,
# which already succeeded on your laptop). Resumable: skips pairs whose .paf exists.
#
# Then calls YOUR breakpoint caller on each PAF (point CALLER at the script that made
# cs_breakpoints_v1.json -- likely MODULE_BPATLAS/STEP_BP2_call_breakpoints.py or the
# cs-toolkit STEP_02_call_breakpoints.py).
set -uo pipefail

# ---------------- CONFIG (edit to match your machine) ----------------
FASTA_DIR="/mnt/e/01-catfish_assembly_manuscript_CGA/cross_species_breakpoints/00_fastas"
OUT="/mnt/e/01-catfish_assembly_manuscript_CGA/cross_species_breakpoints/all_species"
FOCALS=("fClaHyb_Gar_LG" "fClaHyb_Mac_LG")     # focal basenames (without .fa) in FASTA_DIR
# wfmash params -- COPY THE EXACT ONES FROM YOUR WORKING gar_vs_mac RUN (check wfmash.log):
WF_PARAMS="-s 50000 -p 70 -n 1"                # <-- EDIT to match your 01_wfmash/wfmash.log
THREADS=4
# breakpoint caller that produced cs_breakpoints_v1.json:
CALLER=""                                       # <-- EDIT: path to your STEP_*_call_breakpoints.py
# ---------------------------------------------------------------------

mkdir -p "$OUT/paf" "$OUT/breakpoints"
command -v wfmash >/dev/null || { echo "wfmash not found"; exit 1; }

for FBASE in "${FOCALS[@]}"; do
  FOCAL="$FASTA_DIR/${FBASE}.fa"
  [[ -f "$FOCAL" ]] || { echo "MISSING focal $FOCAL"; continue; }
  for G in "$FASTA_DIR"/*.fa; do
    GB=$(basename "$G" .fa)
    [[ "$GB" == "$FBASE" ]] && continue
    # skip the other focal's _LG suffix duplicate comparisons if undesired? keep all.
    PAF="$OUT/paf/${FBASE}__vs__${GB}.paf"
    if [[ -s "$PAF" ]]; then echo "[skip] ${FBASE} vs ${GB} (paf exists)"; continue; fi
    echo "[wfmash] ${FBASE} vs ${GB}  ($(date +%H:%M))"
    # query = comparison genome, target = focal (so coords are on focal frame), as in your run
    wfmash $WF_PARAMS -t "$THREADS" "$FOCAL" "$G" > "$PAF" 2>>"$OUT/wfmash.log" \
      || { echo "  *** wfmash failed ${FBASE} vs ${GB}; see wfmash.log"; rm -f "$PAF"; continue; }
    echo "  -> $PAF ($(du -h "$PAF"|cut -f1))"
    if [[ -n "$CALLER" && -f "$CALLER" ]]; then
      python3 "$CALLER" --paf "$PAF" --query-species "$GB" --target-species "$FBASE" \
        --out "$OUT/breakpoints/${FBASE}__vs__${GB}.json" 2>>"$OUT/caller.log" \
        || echo "  (caller failed; PAF kept for later)"
    fi
  done
done
echo ""
echo "[done] PAFs in $OUT/paf/, breakpoint JSONs in $OUT/breakpoints/ (if CALLER set)."
echo "Peak RAM stayed at 2 genomes at a time (your gar_vs_mac run already proved this works)."
