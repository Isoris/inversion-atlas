#!/usr/bin/env bash
# run_wfmash_tiered.sh -- wfmash focal-vs-each, identity threshold TIERED by
# phylogenetic distance (from the BUSCO timetree). Loops 2-3 -p scales so each
# species is aligned at a threshold it can actually clear.
#
# Tiers (from the timetree, ~MYA to focal Clarias):
#   TIER1  p90  : within Clarias / Clariidae (~<25 MYA)   C_fuscus C_apus C_bouderius? 
#   TIER2  p80  : other Siluriformes (~40-65 MYA)         Ictalurus, Silurus, Tachysurus,
#                                                          Hemibagrus, Pangasianodon, A_melas,
#                                                          N_graeffei, C_bouderius
#   TIER3  skip : deep outgroups (~85-100 MYA)            P_lineatus, T_rosablanca
#                 -> gene-order only (wfmash can't align; don't waste the run)
#
# One pair at a time (RAM safe). Resumable. Your proven base params: -X -s 50000.
set -uo pipefail

GDIR="/mnt/e/01-catfish_assembly_manuscript_CGA/catfish_bundle_no_genomes_no_EDTA/catfish_phylogenomics_v1.0/phylogeny/results_tree_busco_catfish"
FOCAL_DIR="/mnt/e/01-catfish_assembly_manuscript_CGA/cross_species_breakpoints/00_fastas"
OUT="/mnt/e/01-catfish_assembly_manuscript_CGA/cross_species_breakpoints/tiered"
S=50000; N=1; T=4
declare -A FOCAL=( [Gar]="$FOCAL_DIR/fClaHyb_Gar_LG.fa" [Mac]="$FOCAL_DIR/fClaHyb_Mac_LG.fa" )

# species -> tier p-value (0 = skip, gene-order only)
declare -A PTIER=(
  [C_fuscus]=90 [C_apus]=90
  [C_bouderius]=80 [I_furcatus]=80 [I_punctatus]=80 [A_melas]=80
  [S_aristotelis]=80 [S_meridionalis]=80 [T_fulvidraco]=80 [T_vachellii]=80
  [H_wyckioides]=80 [P_hypophthalmus]=80 [N_graeffei]=80
  [P_lineatus]=0 [T_rosablanca]=0
)
# the REAL cs-breakpoint detector (the one that made cs_breakpoints_v1.json):
CALLER="STEP_CS01_extract_breakpoints.py"   # keep alongside this script
# optional TE-density dirs for flanking annotation (leave empty to skip):
TE_DIR=""        # Cgar TE-density JSON dir
MAC_TE_DIR=""    # comparison-species TE-density dir (usually empty for non-Mac)

mkdir -p "$OUT/paf"
command -v wfmash >/dev/null || { echo "wfmash not in PATH (conda activate assembly)"; exit 1; }

for fk in "${!FOCAL[@]}"; do
  FA="${FOCAL[$fk]}"; [[ -f "$FA" ]] || { echo "MISSING focal $FA"; continue; }
  [[ -s "$FA.fai" ]] || samtools faidx "$FA"
  for sp in "${!PTIER[@]}"; do
    P=${PTIER[$sp]}
    if [[ "$P" -eq 0 ]]; then echo "[skip:deep] $fk vs $sp -> gene-order only"; continue; fi
    G="$GDIR/$sp.fa"; [[ -f "$G" ]] || { echo "MISSING $G"; continue; }
    [[ -s "$G.fai" ]] || samtools faidx "$G"
    PAF="$OUT/paf/${fk}__vs__${sp}.p${P}.paf"
    [[ -s "$PAF" ]] && { echo "[skip] $fk vs $sp (done)"; continue; }
    echo "[wfmash] $fk vs $sp  p$P  ($(date +%H:%M))"
    wfmash "$FA" "$G" -X -p "$P" -s "$S" -n "$N" -t "$T" > "$PAF" 2>>"$OUT/wfmash.log" \
      || { echo "  *** failed; rm"; rm -f "$PAF"; continue; }
    rows=$(wc -l < "$PAF")
    echo "  -> $rows rows"
    [[ "$rows" -lt 10 ]] && echo "  NOTE: <10 rows -- $sp too diverged even at p$P; rely on gene-order"
    if [[ -n "$CALLER" && -f "$CALLER" && "$rows" -ge 2 ]]; then
      mkdir -p "$OUT/json"
      TEARG=""; [[ -n "$TE_DIR" ]] && TEARG="--te-dir $TE_DIR"
      MTEARG=""; [[ -n "$MAC_TE_DIR" ]] && MTEARG="--mac-te-dir $MAC_TE_DIR"
      python3 "$CALLER" --paf "$PAF" --out "$OUT/json/${fk}__vs__${sp}.json" \
        --min-mapq 1 --min-block-bp 50000 --cluster-radius-bp 50000 --flank-bp 100000 \
        --species-query "Clarias gariepinus" --species-target "$sp" \
        --haplotype-query "fClaHyb_${fk}_LG" --haplotype-target "$sp" \
        $TEARG $MTEARG 2>>"$OUT/caller.log" \
        && echo "  -> json/${fk}__vs__${sp}.json" || echo "  (caller failed; PAF kept)"
    fi
  done
done
echo ""
echo "[done] tiered PAFs in $OUT/paf/."
echo "TIER1(p90)=Clarias  TIER2(p80)=other Siluriformes  TIER3=deep(P_lineatus,T_rosablanca)=gene-order only"
echo "Row counts tell you empirically where wfmash stops working -- that boundary IS a result"
echo "(it shows the divergence limit of whole-genome alignment in catfish)."
