// =============================================================================
// popstats/_tracks.js
// =============================================================================
// Track inventory + per-track data getters for the popstats stack. Ported from
// the legacy POPSTATS_TRACKS const + collectPopstatsTracks() in
// Inversion_atlas.html. De-globalized: `data` is passed explicitly and getData
// closures operate on it directly.
//
// Categories
//   always   — visible regardless of user opt-in (ideogram, sim_mat, |Z|)
//   popstats — population-genetic statistics; chip-visible by default,
//              canvas-visible once data lands
//   qc       — data-quality diagnostics; off by default
//   other    — auto-discovered (data.tracks dict) that don't match a
//              popstats name pattern; visible when hasData
//
// Chip strip sort: always → popstats → qc → other. Inverted from the original
// legacy order so the user's eye lands on the scientifically interesting
// chips first (Quentin, 2026-05-20).
// =============================================================================

const STATIC_TRACKS = [
  { id: 'ideogram', label: 'ideogram', height: 50, category: 'always',
    renderer: 'ideogram', alwaysOn: true },
  { id: 'sim_collapse', label: 'sim_mat', height: 50, category: 'always',
    renderer: 'sim_collapse',
    loadHint: 'sim_mat is part of precomp; load any precomp JSON.',
    getData: (data) => (data && (data.sim_mat_collapse || data.sim_mat)) ? {} : null },
  { id: 'z', label: 'Z', height: 110, category: 'always',
    renderer: 'line', color: '#1f4e79', yLabel: 'Robust Z',
    edgeTop: 'outlier', edgeBot: 'typical',
    getData: (data) => {
      if (!data || !data.windows) return null;
      const mb     = data.windows.map(w => w.center_mb);
      const values = data.windows.map(w => Math.abs(w.z || 0));
      return { mb, values, refLine: 3.0 };
    } },
  // ─ popstats — chip-visible by default; tracks paint when data lands
  // either via precomp `data.tracks` (auto-discovered, dedup'd by id) or via
  // the live server (POST /api/popstats/groupwise — needs `groups` slot).
  { id: 'theta_pi', label: 'θπ', height: 90, category: 'popstats',
    renderer: 'line', color: '#3cc08a', yLabel: 'θπ',
    edgeTop: 'diverse', edgeBot: 'low π',
    loadHint: 'Load Q04 enrichment with theta_pi track, or compute via /api/popstats/groupwise.' },
  { id: 'theta_invgt', label: 'θπ by invgt', height: 90, category: 'popstats',
    renderer: 'multiline', yLabel: 'θπ invgt',
    edgeTop: 'diverse', edgeBot: 'low π',
    loadHint: 'Per-genotype θπ; needs groups + /api/popstats/groupwise (one line per karyotype group).' },
  { id: 'fst_hom1_hom2', label: 'Fst Hom1-Hom2', height: 90, category: 'popstats',
    renderer: 'line', color: '#7b3294', yLabel: 'Fst',
    edgeTop: 'differentiated', edgeBot: 'panmictic',
    loadHint: 'Live FST needs groups + /api/popstats/groupwise.' },
  { id: 'hobs_hexp', label: 'Hobs/Hexp', height: 90, category: 'popstats',
    renderer: 'multiline', yLabel: 'Hobs/Hexp',
    edgeTop: 'het excess (~2)', edgeBot: 'hom deficit (~0)',
    loadHint: 'Hobs/Hexp needs groups + /api/popstats/hobs_groupwise (one line each for Hobs + Hexp).' },
  { id: 'delta12', label: 'ancestry Δ12', height: 90, category: 'popstats',
    renderer: 'line', color: '#2c7a39', yLabel: 'Δ12',
    edgeTop: 'clear', edgeBot: 'ambiguous',
    loadHint: 'Load Q04 enrichment with ancestry Δ12 track.' },
  { id: 'delta12_multi', label: 'Δ12 multi-scale', height: 90, category: 'popstats',
    renderer: 'multiline', yLabel: 'Δ12 (1×/5×/10×)',
    edgeTop: 'scale-stable', edgeBot: 'scale-dep',
    loadHint: 'Multi-scale Δ12 — one line per window-scale (1× / 5× / 10×).' },
  // ─ QC ─ off by default
  { id: 'snp_density', label: 'SNP density', height: 90, category: 'qc',
    renderer: 'line', color: '#2c7a39', yLabel: 'SNPs/10kb',
    edgeTop: 'dense', edgeBot: 'sparse',
    loadHint: 'Load Q04 enrichment with snp_density track.' },
  { id: 'beagle_unc', label: 'BEAGLE uncert', height: 90, category: 'qc',
    renderer: 'line', color: '#7b3294', yLabel: 'uncert frac',
    edgeTop: 'low-conf', edgeBot: 'confident',
    loadHint: 'Load Q04 enrichment with BEAGLE uncertainty track.' },
  { id: 'coverage', label: 'coverage', height: 90, category: 'qc',
    renderer: 'line', color: '#c0504d', yLabel: 'mean cov',
    loadHint: 'Load Q04 enrichment with coverage track.' },
];

// Map a track id from `data.tracks` to one of our STATIC_TRACKS entries so
// the chip + canvas get the canonical styling/loadHint rather than a generic
// auto-discovered placeholder.
const TRACK_ID_ALIASES = {
  theta_pi: 'theta_pi',
  thetapi:  'theta_pi',
  pi:       'theta_pi',
  fst:      'fst_hom1_hom2',
  fst_hom1_hom2: 'fst_hom1_hom2',
  delta12:  'delta12',
  ancestry_delta12: 'delta12',
  hobs:     'hobs_hexp',
  hexp:     'hobs_hexp',
  hobs_hexp: 'hobs_hexp',
};

// Patterns used to bucket auto-discovered tracks into the right category.
// Anything that looks like a popgen metric goes into 'popstats'; everything
// else (mostly GHSL/QC overlays) stays in 'other'.
const POPSTATS_NAME_RX = /(^|_)(theta|pi|fst|dxy|hobs|hexp|h\w*exp|ancestry|delta12|tajd|tajima|pi_|s_per_window)/i;
const PALETTE_BY_PREFIX = {
  ghsl:     '#7b3294',
  ancestry: '#3cc08a',
  fst:      '#7b3294',
  theta:    '#3cc08a',
  hobs:     '#e07b3a',
  delta:    '#2c7a39',
};

function _paletteFor(name) {
  for (const k of Object.keys(PALETTE_BY_PREFIX)) {
    if (name.toLowerCase().startsWith(k)) return PALETTE_BY_PREFIX[k];
  }
  return '#2c7a39';
}

function _categoryFor(name) {
  return POPSTATS_NAME_RX.test(name) ? 'popstats' : 'other';
}

/**
 * Build a per-track getter against `data.tracks[trkName]`. Returns either a
 * single-series `{mb, values, min, max}` payload or a multi-series
 * `{mb, series: [{name, color?, values}, ...]}` payload, depending on the
 * precomp's shape. The renderer dispatches off `Array.isArray(td.series)`.
 *
 * Supported shapes on `data.tracks[name]`:
 *   1. `{ values: number[], pos_bp?: number[] }`                    — single line
 *   2. `{ series: [{name, color?, values}, ...], pos_bp? }`         — already multi
 *   3. `{ values_by_group: {GROUP: number[]}, pos_bp? }`            — keyed by group
 *   4. `{ values: { GROUP: number[] }, pos_bp? }`                   — same, alt key
 *
 * Per-window `pos_bp` falls back to `data.windows[*].center_mb` when absent.
 */
function _autoTrackGetData(trkName) {
  return (d) => {
    const t = d && d.tracks && d.tracks[trkName];
    if (!t) return null;

    // Resolve the X axis (mb) once — every shape shares it.
    let mb = null;
    const N = _seriesLen(t);
    if (N == null) return null;
    if (Array.isArray(t.pos_bp) && t.pos_bp.length === N) {
      mb = t.pos_bp.map(bp => bp / 1e6);
    } else if (d.windows && d.windows.length === N) {
      mb = d.windows.map(w => w.center_mb);
    } else {
      return null;
    }

    // Shape 2 — explicit series array.
    if (Array.isArray(t.series) && t.series.length > 0) {
      return { mb, series: t.series.map(s => ({
        name:   s.name || '',
        color:  s.color,
        values: s.values || [],
      })) };
    }

    // Shape 3 / 4 — group-keyed bag.
    const grouped = (t.values_by_group && typeof t.values_by_group === 'object')
      ? t.values_by_group
      : (t.values && typeof t.values === 'object' && !Array.isArray(t.values))
        ? t.values : null;
    if (grouped) {
      const series = [];
      for (const g of Object.keys(grouped)) {
        const v = grouped[g];
        if (Array.isArray(v) && v.length === N) {
          series.push({ name: g, values: v });
        }
      }
      if (series.length > 0) return { mb, series };
    }

    // Shape 1 — single-series legacy values array.
    if (Array.isArray(t.values)) {
      return { mb, values: t.values, min: t.min, max: t.max };
    }
    return null;
  };
}

/**
 * Compute the length of whatever values shape `t` carries, so we can pair
 * pos_bp / data.windows against it. Returns null if no values are present.
 */
function _seriesLen(t) {
  if (!t) return null;
  if (Array.isArray(t.values)) return t.values.length;
  if (Array.isArray(t.series) && t.series.length > 0) {
    const s0 = t.series[0];
    if (s0 && Array.isArray(s0.values)) return s0.values.length;
  }
  const grouped = (t.values_by_group && typeof t.values_by_group === 'object')
    ? t.values_by_group
    : (t.values && typeof t.values === 'object' && !Array.isArray(t.values))
      ? t.values : null;
  if (grouped) {
    for (const k of Object.keys(grouped)) {
      const v = grouped[k];
      if (Array.isArray(v)) return v.length;
    }
  }
  return null;
}

/**
 * Collect the full track list, annotated with `hasData` per the loaded precomp.
 * Auto-discovered tracks from `data.tracks` are appended after the static list,
 * with two special cases:
 *   1. If the track name matches a STATIC_TRACKS id (or an alias in
 *      TRACK_ID_ALIASES), the static entry adopts the auto-discovered
 *      getData → the chip lights up with real data on the same canvas.
 *   2. Otherwise a fresh entry is created and bucketed by name pattern into
 *      `popstats` (theta/fst/pi/hobs/hexp/ancestry/delta12/…) or `other`.
 *
 * Sort order: always → popstats → qc → other. Static-list order preserved
 * within a category.
 */
export function collectTracks(data) {
  // Index static entries by id so auto-discovered tracks can adopt them.
  const byId = new Map();
  const out = [];
  for (const t of STATIC_TRACKS) {
    const clone = { ...t };
    out.push(clone);
    byId.set(clone.id, clone);
  }

  // Walk data.tracks. Adopt into a static entry when names match; else push
  // as a fresh auto-discovered chip with the right category + palette.
  if (data && data.tracks) {
    for (const trkName of Object.keys(data.tracks)) {
      const aliasTarget = TRACK_ID_ALIASES[trkName.toLowerCase()];
      const targetId = aliasTarget || trkName;
      const existing = byId.get(targetId);
      const getData = _autoTrackGetData(trkName);
      if (existing) {
        // Light up the static placeholder with the precomp's data.
        existing.getData = getData;
        continue;
      }
      const id = `tracksdict_${trkName}`;
      if (byId.has(id)) continue;
      const entry = {
        id,
        label:    trkName,
        height:   90,
        renderer: 'line',
        color:    _paletteFor(trkName),
        yLabel:   trkName,
        category: _categoryFor(trkName),
        loadHint: '',
        getData,
      };
      out.push(entry);
      byId.set(id, entry);
    }
  }

  // Annotate hasData against the resolved data.
  for (const t of out) {
    if (t.alwaysOn) { t.hasData = true; continue; }
    if (typeof t.getData === 'function') {
      t.hasData = t.getData(data) !== null;
    } else if (t.id === 'z') {
      t.hasData = !!(data && data.windows);
    } else {
      t.hasData = false;
    }
  }

  const order = { always: 0, popstats: 1, qc: 2, other: 3 };
  out.sort((a, b) => {
    const ca = order[a.category] ?? 99;
    const cb = order[b.category] ?? 99;
    return ca - cb;
  });
  return out;
}
