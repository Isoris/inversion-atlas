#!/usr/bin/env bash
###############################################################################
# run_pair_pca_matrix.sh
#
# After SLURM_A05 has dumped GLF10 for a candidate interval, this driver:
#   1) Master: GLF10 -> all-pairs Beagle + sidecar (no filtering)        [adapter]
#   2) Views:  filter master by role + support thresholds                [filter]
#   3) Weight: optionally downweight rows by support (PCA-only output)   [weighter]
#   4) Global PCA: PCAngsd on each Beagle (unweighted and weighted)
#   5) Local PCA: sliding-window per-window PCA -> JSON for atlas       [local_pca]
#   6) Compare:  side-by-side PDF for visual inspection
#   7) Scan:     rare-pair window scan over master sidecar               [scanner]
#   8) Manifest: write manifest.json
#
# Usage:
#   bash run_pair_pca_matrix.sh <out_prefix>
#
# Override defaults via env vars:
#   MIN_PAIR_ALLELE_COUNT  (default 6)
#   MIN_MAF_PAIR           (default 0.02)
#   MIN_N_SAMPLES_MINOR    (default 3)
#   WEIGHT_MODE            (default max; alternatives: median, fixed, none)
#   WEIGHT_STAT            (default pair_count; alternative: min_pair_allele_count)
#   LOCAL_PCA_WINDOW_MODE  (default bp_span)
#   LOCAL_PCA_WINDOW_SIZE  (default 50000)
#   LOCAL_PCA_BACKEND      (default direct; alternative: pcangsd)
#   GROUPS_TSV             (optional: 2-col TSV for compare-plot coloring)
#   SCAN_WINDOW_BP         (default 100000)
#   SCAN_MIN_CARRIERS      (default 4)
#   SCAN_MAX_CARRIERS      (default 30)
###############################################################################
set -euo pipefail

OUT_PREFIX="${1:?ERROR: provide out_prefix used by SLURM_A05}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADAPTER="${SCRIPT_DIR}/mgl10_to_beagle.R"
FILTER="${SCRIPT_DIR}/beagle_filter_pairs.R"
WEIGHTER="${SCRIPT_DIR}/beagle_weight_by_support.R"
LOCAL_PCA="${SCRIPT_DIR}/beagle_to_local_pca_json.R"
COMPARE="${SCRIPT_DIR}/compare_local_pca.R"
SCANNER="${SCRIPT_DIR}/scan_rare_pairs.R"
BAMLIST="${BAMLIST:-${SCRIPT_DIR}/../config_bamlist.txt}"

# Filter defaults
MIN_PAIR_ALLELE_COUNT="${MIN_PAIR_ALLELE_COUNT:-6}"
MIN_MAF_PAIR="${MIN_MAF_PAIR:-0.02}"
MIN_N_SAMPLES_MINOR="${MIN_N_SAMPLES_MINOR:-3}"

# Weighter defaults
WEIGHT_MODE="${WEIGHT_MODE:-max}"
WEIGHT_STAT="${WEIGHT_STAT:-pair_count}"

# Local PCA defaults
LOCAL_PCA_WINDOW_MODE="${LOCAL_PCA_WINDOW_MODE:-bp_span}"
LOCAL_PCA_WINDOW_SIZE="${LOCAL_PCA_WINDOW_SIZE:-50000}"
LOCAL_PCA_BACKEND="${LOCAL_PCA_BACKEND:-direct}"
GROUPS_TSV="${GROUPS_TSV:-}"

# Scanner defaults
SCAN_WINDOW_BP="${SCAN_WINDOW_BP:-100000}"
SCAN_MIN_CARRIERS="${SCAN_MIN_CARRIERS:-4}"
SCAN_MAX_CARRIERS="${SCAN_MAX_CARRIERS:-30}"

WORK_DIR="$(dirname "$OUT_PREFIX")/pair_pca_$(basename "$OUT_PREFIX")"
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

MASTER_BEAGLE="master_all_pairs.beagle.gz"
MASTER_SIDECAR="master_all_pairs.beagle.pairs.tsv"

# ---- Step 1: Master conversion ----
if [[ ! -s "$MASTER_BEAGLE" ]]; then
  echo "[$(date)] [1/6] GLF10 -> master all-pairs Beagle (no filtering)"
  Rscript "$ADAPTER" \
    --glf      "${OUT_PREFIX}.glf.gz" \
    --pos      "${OUT_PREFIX}.glf.pos.gz" \
    --counts   "${OUT_PREFIX}.counts.gz" \
    --bamlist  "$BAMLIST" \
    --out      "$MASTER_BEAGLE"
else
  echo "[$(date)] [1/6] [SKIP] $MASTER_BEAGLE exists"
fi

# ---- Step 2: Canonical filter views ----
declare -A VIEW_PAIRS=(
  [bi_baseline]="MAJOR_MINOR1"
  [tri_extras]="MAJOR_MINOR2,MINOR1_MINOR2"
  [quad_extras]="MAJOR_MINOR2,MINOR1_MINOR2,MAJOR_MINOR3,MINOR1_MINOR3,MINOR2_MINOR3"
  [all_pairs]=""
)
declare -A VIEW_LABEL=(
  [bi_baseline]="Biallelic baseline (MAJOR vs MINOR1)"
  [tri_extras]="Tri-allelic extras (MAJOR_MINOR2, MINOR1_MINOR2)"
  [quad_extras]="All multi-allelic extras"
  [all_pairs]="All pairs (full multi-allelic)"
)

echo "[$(date)] [2/6] Filtering canonical views"
for view in "${!VIEW_PAIRS[@]}"; do
  pairs="${VIEW_PAIRS[$view]}"
  out="${view}.beagle.gz"
  if [[ -s "$out" ]]; then
    echo "  [SKIP] $out exists"
    continue
  fi
  pair_arg=""
  [[ -n "$pairs" ]] && pair_arg="--pairs $pairs"
  Rscript "$FILTER" \
    --beagle  "$MASTER_BEAGLE" \
    --sidecar "$MASTER_SIDECAR" \
    --out     "$out" \
    --min_pair_allele_count    "$MIN_PAIR_ALLELE_COUNT" \
    --min_maf_pair             "$MIN_MAF_PAIR" \
    --min_n_samples_with_minor "$MIN_N_SAMPLES_MINOR" \
    $pair_arg 2>&1 | grep -E "kept|out:" | sed 's/^/  /'
done

# ---- Step 3: Weighted variants (for PCA only) ----
echo "[$(date)] [3/6] Building weighted variants (mode=${WEIGHT_MODE} stat=${WEIGHT_STAT})"
for view in "${!VIEW_PAIRS[@]}"; do
  in_b="${view}.beagle.gz"
  in_s="${view}.beagle.pairs.tsv"
  out="${view}.weighted.beagle.gz"
  if [[ -s "$out" ]]; then
    echo "  [SKIP] $out exists"
    continue
  fi
  if [[ ! -s "$in_b" || ! -s "$in_s" ]]; then
    echo "  [SKIP] $view inputs missing"
    continue
  fi
  Rscript "$WEIGHTER" \
    --beagle  "$in_b" \
    --sidecar "$in_s" \
    --mode    "$WEIGHT_MODE" \
    --weight_stat "$WEIGHT_STAT" \
    --out     "$out" 2>&1 | grep -E "wrote|reference|output:" | sed 's/^/  /'
done

# ---- Step 4: PCAngsd on unweighted + weighted (global, whole interval) ----
echo "[$(date)] [4/8] Global PCAngsd on each Beagle"
for view in "${!VIEW_PAIRS[@]}"; do
  for variant in "" ".weighted"; do
    inb="${view}${variant}.beagle.gz"
    out_pca="pca_${view}${variant//./_}"
    if [[ -s "${out_pca}.cov" ]]; then
      echo "  [SKIP] PCAngsd done for ${view}${variant}"
      continue
    fi
    if [[ ! -s "$inb" ]]; then continue; fi
    echo "  PCAngsd: ${view}${variant}"
    pcangsd -b "$inb" -o "$out_pca" -t 8 \
      > "${out_pca}.log" 2>&1 || {
        echo "  [WARN] PCAngsd failed for ${view}${variant} (see ${out_pca}.log)"
        continue
      }
  done
done

# ---- Step 5: Local PCA per view × (raw, weighted) -> JSON ----
echo "[$(date)] [5/8] Local PCA (window_mode=${LOCAL_PCA_WINDOW_MODE} size=${LOCAL_PCA_WINDOW_SIZE} backend=${LOCAL_PCA_BACKEND})"
for view in "${!VIEW_PAIRS[@]}"; do
  for variant in "" ".weighted"; do
    inb="${view}${variant}.beagle.gz"
    ins="${view}.beagle.pairs.tsv"  # sidecar always from unweighted
    out_json="local_pca_${view}${variant//./_}.json"
    if [[ -s "$out_json" ]]; then
      echo "  [SKIP] $out_json exists"
      continue
    fi
    if [[ ! -s "$inb" || ! -s "$ins" ]]; then continue; fi
    weighted_flag="FALSE"
    [[ "$variant" == ".weighted" ]] && weighted_flag="TRUE"
    Rscript "$LOCAL_PCA" \
      --beagle  "$inb" \
      --sidecar "$ins" \
      --out     "$out_json" \
      --window_mode "$LOCAL_PCA_WINDOW_MODE" \
      --window_size "$LOCAL_PCA_WINDOW_SIZE" \
      --backend "$LOCAL_PCA_BACKEND" \
      --view_name "$view" \
      --weighted "$weighted_flag" 2>&1 | grep -E "windows|wrote|done" | sed 's/^/  /'
  done
done

# ---- Step 6: Compare PDF (bi vs all_pairs vs all_pairs.weighted) ----
echo "[$(date)] [6/8] Building compare PDF"
group_arg=""
[[ -n "$GROUPS_TSV" && -s "$GROUPS_TSV" ]] && group_arg="--groups $GROUPS_TSV"
Rscript "$COMPARE" \
  --jsons "bi=local_pca_bi_baseline.json,all=local_pca_all_pairs.json,all_w=local_pca_all_pairs_weighted.json" \
  --out compare_local_pca.pdf \
  $group_arg 2>&1 | tail -1

# ---- Step 7: Rare-pair window scan ----
echo "[$(date)] [7/8] Rare-pair scan over master sidecar"
Rscript "$SCANNER" \
  --sidecar "$MASTER_SIDECAR" \
  --out     "rare_pair_windows.tsv" \
  --window_bp     "$SCAN_WINDOW_BP" \
  --min_carriers  "$SCAN_MIN_CARRIERS" \
  --max_carriers  "$SCAN_MAX_CARRIERS" \
  --min_pair_count "$MIN_PAIR_ALLELE_COUNT" \
  --min_pairs_per_window 5 2>&1 | grep -E "qualifying|flagged|top|output" | sed 's/^/  /'

# ---- Step 8: Manifest for pca_scrubber_v3 ----
echo "[$(date)] [8/8] Writing manifest.json"
{
  echo "{"
  echo "  \"interval_prefix\": \"$(basename "$OUT_PREFIX")\","
  echo "  \"thresholds\": {"
  echo "    \"min_pair_allele_count\": ${MIN_PAIR_ALLELE_COUNT},"
  echo "    \"min_maf_pair\":          ${MIN_MAF_PAIR},"
  echo "    \"min_n_samples_minor\":   ${MIN_N_SAMPLES_MINOR},"
  echo "    \"weight_mode\":           \"${WEIGHT_MODE}\","
  echo "    \"weight_stat\":           \"${WEIGHT_STAT}\","
  echo "    \"local_pca_window_mode\": \"${LOCAL_PCA_WINDOW_MODE}\","
  echo "    \"local_pca_window_size\": ${LOCAL_PCA_WINDOW_SIZE},"
  echo "    \"local_pca_backend\":    \"${LOCAL_PCA_BACKEND}\""
  echo "  },"
  echo "  \"master\": {"
  echo "    \"beagle\":  \"${MASTER_BEAGLE}\","
  echo "    \"sidecar\": \"${MASTER_SIDECAR}\","
  echo "    \"note\":    \"Unfiltered. All observed allele pairs. Per-pair support metadata in sidecar.\""
  echo "  },"
  echo "  \"rare_pair_windows\": \"rare_pair_windows.tsv\","
  echo "  \"compare_pdf\":      \"compare_local_pca.pdf\","
  echo "  \"views\": ["
  first=1
  for view in bi_baseline tri_extras quad_extras all_pairs; do
    [[ $first -eq 0 ]] && echo "    ,"
    first=0
    label="${VIEW_LABEL[$view]}"
    pairs="${VIEW_PAIRS[$view]:-ALL}"
    echo "    {"
    echo "      \"name\":    \"${view}\","
    echo "      \"label\":   \"${label}\","
    echo "      \"pairs\":   \"${pairs}\","
    echo "      \"unweighted\": {"
    echo "        \"beagle\":    \"${view}.beagle.gz\","
    echo "        \"global_cov\": \"pca_${view}.cov\","
    echo "        \"local_pca\":  \"local_pca_${view}.json\""
    echo "      },"
    echo "      \"weighted\": {"
    echo "        \"beagle\":    \"${view}.weighted.beagle.gz\","
    echo "        \"global_cov\": \"pca_${view}_weighted.cov\","
    echo "        \"local_pca\":  \"local_pca_${view}_weighted.json\""
    echo "      }"
    echo -n "    }"
  done
  echo
  echo "  ]"
  echo "}"
} > manifest.json

echo
echo "[$(date)] [DONE]"
echo "Workdir:   $WORK_DIR"
echo "Manifest:  $WORK_DIR/manifest.json"
echo "Master:    $MASTER_BEAGLE"
echo "Rare scan: $WORK_DIR/rare_pair_windows.tsv"
