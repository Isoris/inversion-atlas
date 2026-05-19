// pages/review/karyotype_tier/tier_axes.js
//
// 14-axis tier classification schema + color palette + grid renderer
// (legacy lines 63322-63548). Cartridge port — pure HTML builder, no
// DOM lookups.

/** The 14 tier axes, grouped into 6 sections. Each axis carries:
 *  { id, label, group, desc, cats }. Frozen at module load. */
export const TIER_AXES = Object.freeze([
  Object.freeze({ id: 'existence_layer_a',  label: 'Existence — Layer A',  group: 'existence',
    desc: 'Local PCA evidence (sim_mat triangle, robust |Z|, λ ratio).',
    cats: Object.freeze(['pass', 'fail', 'unknown']) }),
  Object.freeze({ id: 'existence_layer_b',  label: 'Existence — Layer B',  group: 'existence',
    desc: 'SV callers (DELLY, Manta) breakpoint evidence.',
    cats: Object.freeze(['pass', 'fail', 'unknown']) }),
  Object.freeze({ id: 'existence_layer_c',  label: 'Existence — Layer C',  group: 'existence',
    desc: 'GHSL within-sample haplotype divergence.',
    cats: Object.freeze(['pass', 'fail', 'unknown']) }),
  Object.freeze({ id: 'existence_layer_d',  label: 'Existence — Layer D',  group: 'existence',
    desc: 'Fisher genotype × breakpoint association.',
    cats: Object.freeze(['pass', 'fail', 'unknown']) }),
  Object.freeze({ id: 'boundary_quality',   label: 'Boundary quality',     group: 'boundary',
    desc: 'Sharpness of the L-R transition zones.',
    cats: Object.freeze(['sharp', 'fuzzy', 'unknown']) }),
  Object.freeze({ id: 'group_validation',   label: 'Group validation',     group: 'groups',
    desc: 'Independent verification of K-means karyotype groups.',
    cats: Object.freeze(['VALIDATED', 'SUPPORTED', 'UNCERTAIN', 'SUSPECT', 'NONE']) }),
  Object.freeze({ id: 'internal_structure', label: 'Internal structure',   group: 'groups',
    desc: 'Pattern of similarity inside the inversion.',
    cats: Object.freeze(['clean', 'gradient', 'composite_undecomposed', 'unknown']) }),
  Object.freeze({ id: 'recombinant_class',  label: 'Recombinant class',    group: 'groups',
    desc: 'Rare recombinant haplotype class within the inversion.',
    cats: Object.freeze(['none', 'gene_conversion', 'double_crossover', 'mixed', 'unknown']) }),
  Object.freeze({ id: 'family_linkage',     label: 'Family linkage',       group: 'population',
    desc: 'How carrier samples partition by founder family.',
    cats: Object.freeze(['multi_family', 'few_family', 'single_family', 'pca_family_confounded', 'unknown']) }),
  Object.freeze({ id: 'polymorphism_class', label: 'Polymorphism class',   group: 'population',
    desc: 'Distribution of arrangement classes across cohort.',
    cats: Object.freeze(['cohort_wide', 'lineage_restricted', 'family_restricted', 'unclassified']) }),
  Object.freeze({ id: 'mechanism_class',    label: 'Formation mechanism',  group: 'biology',
    desc: 'Inferred molecular mechanism of inversion formation.',
    cats: Object.freeze(['NAHR', 'NHEJ', 'MMBIR', 'unknown']) }),
  Object.freeze({ id: 'age_class',          label: 'Age class',            group: 'biology',
    desc: 'Relative age (Tajima D coalescent proxy + θπ asymmetry).',
    cats: Object.freeze(['young', 'intermediate', 'ancient', 'unknown']) }),
  Object.freeze({ id: 'burden_class',       label: 'Burden class',         group: 'biology',
    desc: 'Deleterious-variant burden inside vs outside the inversion.',
    cats: Object.freeze(['enriched', 'neutral', 'depleted', 'unknown']) }),
  Object.freeze({ id: 'confidence_tier',    label: 'Confidence tier',      group: 'tier',
    desc: 'Overall tier from independence layers + group validation.',
    cats: Object.freeze(['T1', 'T2', 'T3', 'T4', 'SV_only', 'Layer_C_only', 'unknown']) }),
]);

/** The 6 axis groups + display labels. */
export const TIER_GROUPS = Object.freeze([
  Object.freeze({ key: 'existence',  label: 'EXISTENCE LAYERS' }),
  Object.freeze({ key: 'boundary',   label: 'BOUNDARIES' }),
  Object.freeze({ key: 'groups',     label: 'KARYOTYPE GROUPS' }),
  Object.freeze({ key: 'population', label: 'POPULATION GENETICS' }),
  Object.freeze({ key: 'biology',    label: 'BIOLOGY' }),
  Object.freeze({ key: 'tier',       label: 'OVERALL TIER' }),
]);

/**
 * Resolve the pill background color for an axis value. Returns a CSS
 * rgba() string. Conservative palette: green = positive, amber =
 * intermediate, red = negative / contradicted; grey = unknown / null.
 *
 * @param {string} axisId
 * @param {string} value
 * @returns {string}
 */
export function tierAxisValueColor(axisId, value) {
  if (value == null || value === 'unknown' || value === '') return 'rgba(120,130,145,0.35)';
  if (typeof axisId === 'string' && axisId.startsWith('existence_layer_')) {
    if (value === 'pass') return 'rgba(34,160,80,0.85)';
    if (value === 'fail') return 'rgba(224,85,92,0.85)';
  }
  if (axisId === 'boundary_quality') {
    if (value === 'sharp') return 'rgba(34,160,80,0.85)';
    if (value === 'fuzzy') return 'rgba(245,200,60,0.85)';
  }
  if (axisId === 'group_validation') {
    if (value === 'VALIDATED') return 'rgba(34,160,80,0.85)';
    if (value === 'SUPPORTED') return 'rgba(60,192,138,0.85)';
    if (value === 'UNCERTAIN') return 'rgba(245,200,60,0.85)';
    if (value === 'SUSPECT')   return 'rgba(245,165,36,0.85)';
    if (value === 'NONE')      return 'rgba(224,85,92,0.85)';
  }
  if (axisId === 'confidence_tier') {
    if (value === 'T1')           return 'rgba(34,160,80,0.85)';
    if (value === 'T2')           return 'rgba(60,192,138,0.85)';
    if (value === 'T3')           return 'rgba(245,200,60,0.85)';
    if (value === 'T4')           return 'rgba(245,165,36,0.85)';
    if (value === 'SV_only')      return 'rgba(180,120,200,0.85)';
    if (value === 'Layer_C_only') return 'rgba(180,120,200,0.85)';
  }
  if (axisId === 'family_linkage') {
    if (value === 'pca_family_confounded') return 'rgba(224,85,92,0.85)';
    if (value === 'single_family')         return 'rgba(245,165,36,0.85)';
    if (value === 'few_family')            return 'rgba(245,200,60,0.85)';
    if (value === 'multi_family')          return 'rgba(34,160,80,0.85)';
  }
  if (axisId === 'polymorphism_class') {
    if (value === 'cohort_wide')        return 'rgba(34,160,80,0.85)';
    if (value === 'lineage_restricted') return 'rgba(245,200,60,0.85)';
    if (value === 'family_restricted')  return 'rgba(245,165,36,0.85)';
  }
  return 'rgba(120,140,180,0.65)';
}

function _escape(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build the HTML for the 14-axis tier grid. Each section renders the
 * axes in that group as a card with a pill (the value when present,
 * or "— not yet computed" otherwise) + description + cats list.
 *
 * Pass `axisValues = null` (the default) to render the empty/preview
 * grid; pass an object keyed by axis id to render the value pills.
 *
 * @param {Object|null} axisValues
 * @returns {string}
 */
export function renderTierAxesGrid(axisValues) {
  const grouped = new Map();
  for (const g of TIER_GROUPS) grouped.set(g.key, []);
  for (const ax of TIER_AXES) {
    if (grouped.has(ax.group)) grouped.get(ax.group).push(ax);
  }

  const sectionHtml = (g) => {
    const axes = grouped.get(g.key) || [];
    const cards = axes.map(ax => {
      const raw = (axisValues && axisValues[ax.id] != null) ? String(axisValues[ax.id]) : null;
      const v = raw == null ? null : _escape(raw);
      const pill = v
        ? '<span style="display:inline-block; padding: 2px 10px; border-radius: 3px; '
          + 'background: ' + tierAxisValueColor(ax.id, raw) + '; color: #0e1116; '
          + 'font-family: var(--mono); font-size: 11px; font-weight: 600; '
          + 'text-transform: ' + (ax.id === 'group_validation' ? 'uppercase' : 'none') + ';">'
          + v + '</span>'
        : '<span style="display:inline-block; padding: 2px 10px; border-radius: 3px; '
          + 'background: rgba(120,130,145,0.20); color: var(--ink-dim); '
          + 'font-family: var(--mono); font-size: 11px; font-style: italic;">'
          + '— not yet computed</span>';
      return '<div style="padding: 10px 14px; background: var(--panel-2); '
        + 'border: 1px solid var(--rule); border-radius: 4px; margin-bottom: 6px;">'
        + '<div style="display: flex; justify-content: space-between; '
        + 'align-items: baseline; gap: 12px;">'
        + '<div style="font-weight: 600; font-size: 12px; color: var(--ink);">'
        + _escape(ax.label) + '</div>'
        + pill
        + '</div>'
        + '<div style="margin-top: 4px; font-size: 11px; color: var(--ink-dim); '
        + 'line-height: 1.45;">' + _escape(ax.desc) + '</div>'
        + '<div style="margin-top: 4px; font-size: 10px; color: var(--ink-dimmer); '
        + 'font-family: var(--mono);">categories: ' + _escape(ax.cats.join(' · ')) + '</div>'
        + '</div>';
    }).join('');
    return '<div style="margin-bottom: 18px;">'
      + '<div style="font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.10em; '
      + 'color: var(--ink-dim); font-family: var(--mono); font-weight: 600; '
      + 'margin-bottom: 6px;">' + _escape(g.label) + '</div>'
      + cards
      + '</div>';
  };
  return TIER_GROUPS.map(sectionHtml).join('');
}
