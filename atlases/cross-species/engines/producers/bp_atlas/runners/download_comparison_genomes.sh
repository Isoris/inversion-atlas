#!/usr/bin/env bash
# download_comparison_genomes.sh -- fetch the 16 comparison genomes by GCA accession
# into 00_fastas/, named to match the orthologs table (C_fuscus.fa etc.).
# Uses NCBI datasets CLI if present, else wget the datasets API.
set -uo pipefail
OUT="${1:-.}"; mkdir -p "$OUT"

# species_id  accession   (from your species_metadata.tsv)
read -r -d '' SPECIES <<'EOF'
A_melas	GCA_012411365.1
C_apus	GCA_030522415.1
C_bouderius	GCA_023630585.1
C_fuscus	GCA_030347435.1
C_gariepinus	GCA_024256425.2
H_wyckioides	GCA_019097595.1
I_furcatus	GCA_023375685.2
I_punctatus	GCA_001660625.3
N_graeffei	GCA_027579695.1
P_hypophthalmus	GCA_027358585.1
P_lineatus	GCA_024760905.1
S_aristotelis	GCA_946808225.1
S_meridionalis	GCA_014805685.1
T_fulvidraco	GCA_022655615.1
T_rosablanca	GCA_030014385.1
T_vachellii	GCA_030014155.1
EOF

have_datasets=0; command -v datasets >/dev/null && have_datasets=1

while IFS=$'\t' read -r sp acc; do
  [[ -z "$sp" ]] && continue
  target="$OUT/${sp}.fa"
  if [[ -s "$target" ]]; then echo "[skip] $sp already present"; continue; fi
  echo "[get] $sp ($acc)"
  tmp="$OUT/.tmp_$sp"; mkdir -p "$tmp"; cd "$tmp"
  if [[ $have_datasets -eq 1 ]]; then
    datasets download genome accession "$acc" --include genome 2>>"$OUT/download.log" \
      && unzip -o ncbi_dataset.zip >/dev/null 2>&1 \
      && cp ncbi_dataset/data/$acc/*_genomic.fna "$target"
  else
    url="https://api.ncbi.nlm.nih.gov/datasets/v2/genome/accession/${acc}/download?include_annotation_type=GENOME_FASTA"
    wget -q -O ds.zip "$url" && unzip -o ds.zip >/dev/null 2>&1 \
      && cp ncbi_dataset/data/$acc/*_genomic.fna "$target"
  fi
  cd "$OUT"; rm -rf "$tmp"
  if [[ -s "$target" ]]; then samtools faidx "$target"; echo "  -> $target ($(du -h "$target"|cut -f1))"
  else echo "  *** FAILED $sp -- check $OUT/download.log"; fi
done <<< "$SPECIES"
echo "done. genomes in $OUT/"
