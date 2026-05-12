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
# Locate repo root (one dir up from this script's _tooling/ folder).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WS="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$WS"
export WORKSPACE="$WS"

UNITS=(
  # foundation (shared/ modules — locked, must stay green)
  test_shared_contingency.js
  test_shared_hungarian.js
  test_shared_het_rate.js
  test_shared_kmeans.js
  test_shared_state.js
  test_shared_per_l2_cluster.js
  test_shared_page1_utils.js
  test_shared_color_helpers.js
  test_band_consensus.js
  test_modular_smoke.js
  test_page1_active_samples.js
  test_shared_band_trace.js
  test_page1_band_trace_state.js
  test_shared_clustering.js
  test_page1_lineage.js
  test_shared_inheritance_groups.js
  test_page1_inheritance.js
  test_page1_band_trace_tooltip.js
  test_page1_inheritance_tooltip.js
  test_page1_l2_sweep.js
  test_page1_idb.js
  test_page1_fish_inspect_popover.js
  test_page1_enrichment.js
  test_shared_active_candidate.js
  test_page1_chrom_cache.js
  test_page1_idb_restore.js
  test_page1_band_diagnostics.js
  test_page1_band_diagnostics_html.js
  test_shared_candidate_predicates.js
  test_shared_sample_color.js
  test_analysis_mendelian.js
  test_analysis_mendelian_inheritance.js
  test_relatedness_schema.js
  test_page1_diag_residuals.js
  test_shared_cross_page_clusters.js
  test_shared_q_ancestry.js
  test_shared_repeat_density.js
  test_shared_ncrna_density.js
  test_shared_cheat30_results.js
  test_shared_cohort_diversity.js
  test_shared_dxy_per_inversion.js
  test_shared_te_fragility.js
  test_shared_synteny_multispecies.js
  test_shared_classifications.js
  test_shared_newick.js
  test_shared_cross_species.js
  test_shared_dotplot_mashmap.js
  test_shared_atlas_server.js
  test_shared_haplotype_vocab.js
  test_shared_candidate_pca_mode.js
  test_shared_candidate_pca_ordering.js
  test_shared_karyotype_lineage.js
  test_shared_json_classify.js
  test_shared_recent_files.js
  test_shared_schema_layers.js
  test_shared_session_io.js
  test_shared_divergence_network.js
  test_shared_relatedness.js
  test_shared_ghsl_panel.js
  test_shared_wilcoxon.js
  test_shared_stats_helpers.js
  test_shared_window_coords.js
  test_shared_boundary_evidence.js
  test_shared_regimes_registry.js
  test_shared_scale_stability.js
  test_shared_ancestry_confound.js
  test_shared_dbscan.js
  test_shared_uv_rotation.js
  test_shared_k_bands.js
  test_shared_lasso_linkage.js
  test_shared_cross_candidate.js
  test_shared_candidate_nav.js
  test_shared_diamond_detection.js
  test_shared_transition_graph.js
  test_shared_band_reach.js
  test_shared_tracked_linkage.js
  test_shared_band_divergence.js
  test_shared_candidate_display_name.js
  test_shared_cheat30_render.js
  test_shared_band_composition.js
  test_shared_inheritance_cache_key.js
  test_shared_inheritance_gather.js
  test_shared_snp_density.js
  test_shared_haplotype_labels.js
  test_shared_candidate_mode.js
  test_shared_candidate_io.js
  test_shared_candidate_registry.js
  test_shared_pc_accessors.js
  test_shared_sample_spread.js
  test_shared_cohort_export.js
  test_shared_atlas_export.js
  test_shared_sigma_profile.js
  test_shared_candidate_export_record.js
  test_shared_lineage_clustering.js
  test_shared_candidate_lanes.js
  test_shared_dosage_chunks.js
  test_shared_candidate_promote.js
  test_shared_inheritance_compute.js
  test_shared_mendelian_segregation.js
  test_shared_age_model_suggester.js
  test_shared_band_haplotype_assign.js
  test_shared_karyotype_rows.js
  test_shared_cross_species_summary.js
  test_shared_dosage_marker_select.js
  test_shared_band_mode_detect.js
  test_shared_k6_parent_map.js
  test_shared_candidate_pca_sample_color.js
  test_shared_similarity_matrix.js
  test_shared_similarity_blocks.js
  test_shared_newick_tree_layout.js
  test_shared_fingerprint_rank.js
  test_shared_busco_anchors.js
  test_shared_xpehh_per_window.js
  test_page9_carousel.js
  test_page19_negative_regions.js
  test_page8_window_summary.js
  test_page3_catalogue.js
  test_page4_karyotype.js
  test_page11_boundaries.js
  test_page11_boundaries_ui.js
  # page modules (cartridge-only — independent of atlas-core)
  test_discovery_page8.js
  test_discovery_page15.js
  test_discovery_page19.js
  test_discovery_page22.js
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
)

# Tests that depend on atlas-core (core/ modules) — only runnable
# inside an assembled atlas-workspace where atlas-core has been merged
# in. Run these by checking out atlas-core to ../atlas-core/ and
# symlinking ./core -> ../atlas-core/core. Until then they fail with
# ERR_MODULE_NOT_FOUND on core/atlas_api.js / core/layer_router.js /
# core/registry_core.js / core/master_config.js.
CORE_DEPENDENT_UNITS=(
  test_discovery_page1.js
  test_discovery_page2.js
  test_master_config.js
  test_registry_master_config.js
)

SMOKES=(
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
)

# Smokes that depend on atlas-core — see CORE_DEPENDENT_UNITS above.
CORE_DEPENDENT_SMOKES=(
  smoke_discovery_page1_round4.mjs
  smoke_discovery_page2_round5.mjs
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

# Core-dependent tests: only run if a sibling atlas-core/ provides
# core/ at the workspace root. Detected via existence of core/atlas_api.js.
if [ -f "$WS/core/atlas_api.js" ]; then
  echo
  echo "--- core-dependent tests (atlas-core detected at $WS/core) ---"
  for f in "${CORE_DEPENDENT_UNITS[@]}" "${CORE_DEPENDENT_SMOKES[@]}"; do
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
else
  echo
  echo "--- core-dependent tests SKIPPED (atlas-core not present at $WS/core) ---"
  for f in "${CORE_DEPENDENT_UNITS[@]}" "${CORE_DEPENDENT_SMOKES[@]}"; do
    echo "  ⊘ $f"
  done
fi

echo "==================="
echo "TOTAL: pass=$TOTAL_P fail=$TOTAL_F"
