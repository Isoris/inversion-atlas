#!/usr/bin/env bash
# Run all migrated-page tests + loader infrastructure tests.
# Page migration: 21 unit + 21 smoke (1224 assertions, baseline).
# Loader infrastructure (post-step22, 2026-05-07): +2 smokes covering
# the qopt loader pattern (the first activate/extract two-schema
# wired example).
# Master config (post-step23, 2026-05-08): +2 unit tests covering the
# YAML reader, validator, ${roots.X.path} substitution, root resolution,
# and the registry's new `root:` + `path_under_root:` form. The legacy
# `path:` form keeps working unchanged.
# Discovery group COMPLETE (6/6).
# Catalogue group COMPLETE (7/7).
# Comparative group COMPLETE (3/3).
# Review group COMPLETE (5/5).
# **MIGRATION COMPLETE 21/21** as of step 22.
# **First loader pattern wired** as of step 23 (post-step22 design round).
# **Master config wired** as of step 24 (post-step23 master_config round).
set -u
WS=/home/claude/workspace/atlas-workspace
cd "$WS"
export WORKSPACE="$WS"

UNITS=(
  test_discovery_page1.js
  test_discovery_page2.js
  test_discovery_page8.js
  test_discovery_page15.js
  test_discovery_page19.js
  test_catalogue_page3.js
  test_catalogue_page9.js
  test_catalogue_page10.js
  test_discovery_page12.js
  test_comparative_page5.js
  test_comparative_page16.js
  test_catalogue_page17.js
  test_catalogue_page18.js
  test_catalogue_page21.js
  test_catalogue_page_overview.js
  test_review_page7.js
  test_review_page6.js
  test_review_page_sv_evidence.js
  test_comparative_page16b.js
  test_review_page4.js
  test_review_page11.js
  test_master_config.js
  test_registry_master_config.js
)

SMOKES=(
  smoke_discovery_page1_round4.mjs
  smoke_discovery_page2_round5.mjs
  smoke_discovery_page8_round5.mjs
  smoke_discovery_page15_round5.mjs
  smoke_discovery_page19_round5.mjs
  smoke_catalogue_page3_round5.mjs
  smoke_catalogue_page9_round5.mjs
  smoke_catalogue_page10_round5.mjs
  smoke_discovery_page12_round5.mjs
  smoke_comparative_page5_round5.mjs
  smoke_comparative_page16_round5.mjs
  smoke_catalogue_page17_round5.mjs
  smoke_catalogue_page18_round5.mjs
  smoke_catalogue_page21_round5.mjs
  smoke_catalogue_page_overview_round5.mjs
  smoke_review_page7_round5.mjs
  smoke_review_page6_round5.mjs
  smoke_review_page_sv_evidence_round5.mjs
  smoke_comparative_page16b_round5.mjs
  smoke_review_page4_round5.mjs
  smoke_review_page11_round5.mjs
  smoke_qopt_loader.mjs
  smoke_qopt_wiring.mjs
)

TOTAL_P=0
TOTAL_F=0
for f in "${UNITS[@]}" "${SMOKES[@]}"; do
  out=$(node "tests/$f" 2>&1)
  p=$(echo "$out" | grep -oP 'pass:\s*\K\d+' | tail -1)
  fa=$(echo "$out" | grep -oP 'fail:\s*\K\d+' | tail -1)
  if [ -z "$p" ]; then
    echo "  ✗ $f -> NO_RESULT"
    echo "$out" | tail -10
    TOTAL_F=$((TOTAL_F + 1))
  else
    if [ "$fa" != "0" ]; then
      echo "  ✗ $f -> $p/$fa"
    else
      printf "  ✓ %-50s %3d\n" "$f" "$p"
    fi
    TOTAL_P=$((TOTAL_P + p))
    TOTAL_F=$((TOTAL_F + fa))
  fi
done
echo "==================="
echo "TOTAL: pass=$TOTAL_P fail=$TOTAL_F"
