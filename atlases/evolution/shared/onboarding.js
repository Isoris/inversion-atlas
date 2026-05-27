// shared/onboarding.js
// =====================================================================
// Per-page onboarding empty-state configs for the evolution atlas.
// Each entry is a function that returns the same shape as
// renderEmptyStatePanel's `cfg`. Keeping all configs in one file means
// updates (e.g. renaming a discovery page, adding a new data source)
// touch a single registry instead of every page module.
//
// HTML contract: each page already has a sentinel <div id="…Empty">
// with `display:none;` toggled by the page's compute path. The page
// calls `applyOnboarding(pageId)` whenever it enters the empty branch.
// =====================================================================

import { renderEmptyStatePanel, navigateToPage } from './empty_state_panel.js';

const REGISTRY = {
  haplotype_network: {
    sentinelId: 'hapNetEmpty',
    cfg: () => ({
      title: 'Haplotype network not loaded',
      description:
        'Minimum-spanning haplotype network of the inversion (INV) '
        + 'chromosomes. Nodes are Hamming-radius clusters, sized by '
        + 'chromosome count; edges are pairwise mutational distance.',
      sources: [
        'Open a chromosome in the discovery atlas (local PCA · |z|).',
        'Pick a candidate region so an inv_idx partition can be derived.',
        'Return here — the network builds automatically from the dosage chunk.',
      ],
      actions: [
        { label: 'Open discovery (local PCA)', primary: true,
          onClick: () => navigateToPage('local_pca_dosage') },
        { label: 'Open candidate focus',
          onClick: () => navigateToPage('candidate_focus') },
      ],
    }),
  },
  age_divergence: {
    sentinelId: 'ageEmpty',
    cfg: () => ({
      title: 'Divergence not loaded',
      description:
        'Deep-divergence metrics for the inversion class: π_INV, π_STD, '
        + 'dXY between arrangements, Hudson FST, private variants per '
        + 'class, fixed differences. Maps to an age-class verdict.',
      sources: [
        'Open a chromosome + candidate in the discovery atlas.',
        'Both inv_idx and std_idx are inferred from PC1 at the candidate.',
        'Return here — the four bars + age-class fill in automatically.',
      ],
      actions: [
        { label: 'Open discovery (local PCA)', primary: true,
          onClick: () => navigateToPage('local_pca_dosage') },
        { label: 'Open candidate focus',
          onClick: () => navigateToPage('candidate_focus') },
      ],
    }),
  },
  inv_internal_substructure: {
    sentinelId: 'ihEmpty',
    cfg: () => ({
      title: 'INV substructure PCA not loaded',
      description:
        'PCA on the INV-class samples only — surfaces sublineages '
        + 'inside the derived arrangement (cryptic founder pulses, '
        + 'nested SVs, or population structure within the inversion).',
      sources: [
        'Open a chromosome + candidate in the discovery atlas.',
        'Return here — the INV-only PCA recomputes automatically.',
      ],
      actions: [
        { label: 'Open discovery (local PCA)', primary: true,
          onClick: () => navigateToPage('local_pca_dosage') },
        { label: 'Open candidate focus',
          onClick: () => navigateToPage('candidate_focus') },
      ],
    }),
  },
  mosaicism_leakage: {
    sentinelId: 'mosEmpty',
    cfg: () => ({
      title: 'Mosaicism / leakage detector not loaded',
      description:
        'Per-sample, per-marker flags for haplotype leakage — '
        + 'sites where a sample\'s dosage disagrees with its '
        + 'assigned arrangement core. Highlights gene conversion '
        + 'tracts and recombinant chromosomes.',
      sources: [
        'Open a chromosome + candidate in the discovery atlas.',
        'Run the haplotype-regimes pipeline so cores are assigned.',
        'Return here — the leakage matrix recomputes automatically.',
      ],
      actions: [
        { label: 'Open haplotype regimes', primary: true,
          onClick: () => navigateToPage('haplotype_regimes') },
        { label: 'Open discovery (local PCA)',
          onClick: () => navigateToPage('local_pca_dosage') },
      ],
    }),
  },
  layer_cleaning: {
    sentinelId: 'lcEmpty',
    cfg: () => ({
      title: 'Layer-cleaning not loaded',
      description:
        'Per-marker assessment of whether a site segregates with '
        + 'the inversion or carries cross-class noise (kinship leakage, '
        + 'low coverage, mapping artefact).',
      sources: [
        'Open a chromosome + candidate in the discovery atlas.',
        'Return here — the per-marker cleanliness ranking fills in.',
      ],
      actions: [
        { label: 'Open candidate focus', primary: true,
          onClick: () => navigateToPage('candidate_focus') },
      ],
    }),
  },
  polarize_msa_stacked: {
    sentinelId: 'polarizeMsaEmpty',
    cfg: () => ({
      title: 'Polarisation MSA not loaded',
      description:
        'Stacked multi-sequence alignment of cross-species sequences '
        + 'inside the inversion span. Used to vote on which '
        + 'arrangement matches the outgroup (= ancestral).',
      sources: [
        'Open the cross-species atlas and pick the inversion under study.',
        'BUSCO + outgroup alignments must be available for the chrom.',
      ],
      actions: [
        { label: 'Open cross-species atlas', primary: true,
          onClick: () => navigateToPage('cross_species_breakpoints') },
        { label: 'Open synteny vote',
          onClick: () => navigateToPage('polarize_synteny_vote') },
      ],
    }),
  },
  polarize_synteny_vote: {
    sentinelId: 'syntenyEmpty',
    cfg: () => ({
      title: 'Synteny polarisation vote not loaded',
      description:
        'Per-block synteny direction votes for the inversion span — '
        + 'majority vote picks the ancestral arrangement.',
      sources: [
        'Open the cross-species atlas and pick the inversion.',
        'Cross-species synteny tracks must be loaded.',
      ],
      actions: [
        { label: 'Open cross-species atlas', primary: true,
          onClick: () => navigateToPage('cross_species_breakpoints') },
      ],
    }),
  },
  event_tree_relative_ordering: {
    sentinelId: 'etEmpty',
    cfg: () => ({
      title: 'Event tree not loaded',
      description:
        'Relative ordering of structural events along the chromosome — '
        + 'nested / partially nested / independent events.',
      sources: [
        'Run the haplotype-regimes pipeline so events are catalogued.',
        'Return here — the event tree builds from the catalogue.',
      ],
      actions: [
        { label: 'Open haplotype regimes', primary: true,
          onClick: () => navigateToPage('haplotype_regimes') },
      ],
    }),
  },
  archaeology_synthesis_card: {
    sentinelId: 'acEmpty',
    cfg: () => ({
      title: 'Synthesis card not loaded',
      description:
        'One-page evolutionary synthesis of the candidate inversion — '
        + 'age class, divergence summary, polarisation verdict, '
        + 'archaeology classification.',
      sources: [
        'Open the upstream evolution pages (age, divergence, polarisation).',
        'Return here — the card aggregates whatever is available.',
      ],
      actions: [
        { label: 'Open age + divergence', primary: true,
          onClick: () => navigateToPage('age_divergence') },
        { label: 'Open haplotype network',
          onClick: () => navigateToPage('haplotype_network') },
      ],
    }),
  },
};

// Per-page render-guard so the panel renders once per page lifecycle.
// Set to false on mount; flipped to true on first empty-state render.
const _RENDERED = Object.create(null);

/**
 * Reset the render guard for `pageId`. Call from each page's `mount`
 * so the panel re-renders when the user navigates back.
 */
export function resetOnboarding(pageId) {
  _RENDERED[pageId] = false;
}

/**
 * Render the onboarding card for `pageId` into its sentinel <div>,
 * if it exists in the registry and hasn't been rendered already in
 * this lifecycle. Safe to call from any paint pass.
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
  renderEmptyStatePanel(el, entry.cfg());
}

/** Expose for tests. */
export const _REGISTRY = REGISTRY;
