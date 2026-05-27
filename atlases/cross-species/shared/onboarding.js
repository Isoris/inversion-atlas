// atlases/cross-species/shared/onboarding.js
// =====================================================================
// Cross-species-atlas onboarding registry. Mirrors the pattern in
// atlases/evolution/shared/onboarding.js — one entry per page, each
// pointing at the page's `<div id="…Empty">` sentinel and producing
// an onboarding cfg describing the workflow that populates the
// page's data layer.
//
// Reuses renderEmptyStatePanel from the evolution-atlas (cross-atlas
// import, same pattern other pages already use for compute helpers).
// =====================================================================

import { renderEmptyStatePanel } from '../../evolution/shared/empty_state_panel.js';

const REGISTRY = {
  bp_atlas_reciprocity: {
    sentinelId: 'bpRecEmpty',
    cfg: () => ({
      title: 'BP reciprocity table not loaded',
      description:
        'Both-anchor validated zones from BP3c (reciprocal anchors '
        + 'between species), with confidence tier + backbone-support '
        + 'flag. Strongest evidence tier in the breakpoint atlas — '
        + '"supported from both directions".',
      sources: [
        'Run engines/producers/bp_atlas/runners/run_bp_atlas_LAPTOP.sh '
          + 'through stage BP3c.',
        'Ensure cross-species.bp_atlas_reciprocity_v1 is registered in '
          + 'the data registry.',
      ],
      actions: [],
    }),
  },
  bp_atlas_arcs: {
    sentinelId: 'bpArcsEmpty',
    cfg: () => ({
      title: 'Breakpoint arcs not loaded',
      description:
        'In-browser preview of the BP5 atlas-arc layout — arcs '
        + 'connect breakpoint anchors across chromosomes. The full '
        + 'figure (ribbons + dotplots + montage) is rendered by the '
        + 'R scripts in engines/figures/bp_atlas/.',
      sources: [
        'Run the bp_atlas_pipeline workflow through stage BP5 to '
          + 'produce data/breakpoints/atlas_paf_arcs.json.',
        'cross-species.bp_atlas_arcs_v1 + cross-species.atlas_data_v1 '
          + 'must both be registered.',
      ],
      actions: [],
    }),
  },
  bp_catalogue: {
    sentinelId: 'bpCatEmpty',
    cfg: () => ({
      title: 'Breakpoint catalogue not loaded',
      description:
        'Tiered headline table — Tier 1 (cross-method, agreed by ≥2 '
        + 'detection methods) vs Tier 2 (recurrent single-method, '
        + '≥3 species). The catalogue\'s gating row in the breakpoint '
        + 'atlas.',
      sources: [
        'Run engines/producers/gene_order/cluster_breakpoints.py '
          + '(gene_order_consolidation workflow).',
        'Ensure data/breakpoints/breakpoint_clusters.tsv exists.',
        'cross-species.breakpoints_consolidated_v1 must be registered.',
      ],
      actions: [],
    }),
  },
};

const _RENDERED = Object.create(null);

/**
 * Reset the render guard for `pageId`. Call from each page's mount.
 */
export function resetOnboarding(pageId) {
  _RENDERED[pageId] = false;
}

/**
 * Render the onboarding card for `pageId` into its sentinel <div>,
 * if it exists and hasn't been rendered this lifecycle.
 *
 * @param {string} pageId
 */
export function applyOnboarding(pageId) {
  if (typeof document === 'undefined' || !document.getElementById) return;
  if (_RENDERED[pageId]) return;
  const entry = REGISTRY[pageId];
  if (!entry) return;
  const el = document.getElementById(entry.sentinelId);
  if (!el) return;
  _RENDERED[pageId] = true;
  el.style.display = '';
  renderEmptyStatePanel(el, entry.cfg());
}

/** Test hook. */
export const _REGISTRY = REGISTRY;
