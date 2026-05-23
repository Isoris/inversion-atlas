// shared/busco_anchors.js
//
// Atlas-side primitives for the BUSCO single-copy-protein anchors
// layer (specs_todo/SPEC_busco_anchors_v1.md). Pure JS — no DOM, no
// fetch, no globals. Consumes a `busco_anchors_v1.json` payload
// matching the spec's "Layer schema" section.
//
// Six exports drive the page-16 ribbon-plot ticks + the page-14
// architecture-class auto-suggest:
//
//   1. isBuscoAnchorsJSON(data) → {ok, reasons}
//        Schema validator. Returns ok=false with a structured reason
//        list when the payload is malformed (caller can show the
//        first reason to the user verbatim).
//
//   2. indexAnchorsBySpecies(data) → Map<species, Map<chrom, Array>>
//        Build a per-species per-chromosome anchor index, with each
//        chromosome's anchors sorted by start_bp ascending. Hot path
//        for all the density/window helpers.
//
//   3. deriveHomologyPairs(data) → Array<homology_pair>
//        Return data.homology_pairs verbatim if present, otherwise
//        compute pairs on the fly: every busco_id present in ≥ 2
//        species becomes a homology pair (spec §"Layer schema":
//        "If absent, the atlas can compute cross-species BUSCO
//        pairings on the fly").
//
//   4. buscoDensityInWindow(idx, species, chrom, start_bp, end_bp)
//        Anchors / Mb inside the bp window. The depletion-vs-flank
//        diagnostic (spec §"How the atlas uses this — Page 16")
//        builds on this.
//
//   5. buscoSyntenyScore(idx, speciesA, chromA, speciesB, chromB)
//        Count shared BUSCO IDs + Spearman correlation of their bp
//        positions across the two chromosomes — the BUSCO topology
//        signal that the spec mentions for chromosome-homology
//        confirmation.
//
//   6. suggestArchitectureClass(idx, focal..., sister...)
//        Class B (synteny-boundary inversion) vs Class C
//        (fission/fusion-associated) page-14 hypothesis-registry
//        suggestion. Spec §"How the atlas uses this — Page 14":
//        "if Cgar LG28 has BUSCOs A-B-C-D-E and Cmac has A-B-C on
//        LG01 + D-E on LG06, that's a clear fission".

// =====================================================================
// Vocab
// =====================================================================

/** Schema-identifier constants per the §Layer schema header. */
export const BUSCO_ANCHORS_TOOL = 'busco_anchors_v1';
export const BUSCO_ANCHORS_SCHEMA_VERSION = 1;

/** Architecture-class verdicts emitted by suggestArchitectureClass. */
export const BUSCO_ARCHITECTURE_CLASSES = Object.freeze({
  SYNTENY_BOUNDARY:   'B_synteny_boundary',
  FUSION_FISSION:     'C_fusion_fission',
  INSUFFICIENT_BUSCO: 'insufficient_busco',
  UNCERTAIN:          'uncertain',
});

/** Minimum shared BUSCOs required for a class suggestion. */
export const BUSCO_MIN_SHARED_FOR_SUGGEST = 5;

/** Default flank size in bp for depletion-vs-flank diagnostic. */
export const BUSCO_DEFAULT_FLANK_BP = 500_000;

// =====================================================================
// 1. Schema validator
// =====================================================================

/**
 * Validate a parsed `busco_anchors_v1.json` payload.
 *
 * Returns `{ok:true}` on success, `{ok:false, reasons:string[]}`
 * otherwise. Caller can render `reasons[0]` directly in a status pill.
 *
 * @param {Object} data
 * @returns {{ok:boolean, reasons?:Array<string>}}
 */
export function isBuscoAnchorsJSON(data) {
  const reasons = [];
  if (!data || typeof data !== 'object') {
    return { ok: false, reasons: ['payload is not an object'] };
  }
  if (data.tool !== BUSCO_ANCHORS_TOOL) {
    reasons.push('tool !== "' + BUSCO_ANCHORS_TOOL + '"');
  }
  if (data.schema_version !== BUSCO_ANCHORS_SCHEMA_VERSION) {
    reasons.push('schema_version !== ' + BUSCO_ANCHORS_SCHEMA_VERSION);
  }
  if (!Array.isArray(data.species) || data.species.length === 0) {
    reasons.push('species[] missing or empty');
  } else {
    for (let i = 0; i < data.species.length; i++) {
      const sp = data.species[i];
      if (!sp || typeof sp !== 'object') {
        reasons.push('species[' + i + '] is not an object');
        continue;
      }
      if (typeof sp.species !== 'string' || !sp.species) {
        reasons.push('species[' + i + '].species missing');
      }
      if (!Array.isArray(sp.anchors)) {
        reasons.push('species[' + i + '].anchors[] missing');
        continue;
      }
      for (let j = 0; j < sp.anchors.length; j++) {
        const a = sp.anchors[j];
        if (!a || typeof a.busco_id !== 'string'
            || typeof a.chrom !== 'string'
            || !Number.isFinite(a.start_bp)
            || !Number.isFinite(a.end_bp)) {
          reasons.push('species[' + i + '].anchors[' + j + ']'
            + ' is missing busco_id / chrom / start_bp / end_bp');
          break;   // one report per species is enough
        }
      }
    }
  }
  if (data.homology_pairs != null && !Array.isArray(data.homology_pairs)) {
    reasons.push('homology_pairs is not an array (must be array or absent)');
  }
  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true };
}

// =====================================================================
// 2. Indexing
// =====================================================================

/**
 * Build the per-species per-chromosome anchor index. Each chromosome
 * bucket is sorted by `start_bp` ascending so binary-search / window
 * scans are fast.
 *
 * Returns `Map<species, Map<chrom, Array<anchor>>>`. Empty map on
 * malformed input (no exceptions).
 *
 * @param {Object} data
 * @returns {Map<string, Map<string, Array<Object>>>}
 */
export function indexAnchorsBySpecies(data) {
  const out = new Map();
  if (!data || !Array.isArray(data.species)) return out;
  for (const sp of data.species) {
    if (!sp || !Array.isArray(sp.anchors) || typeof sp.species !== 'string') {
      continue;
    }
    const byChrom = new Map();
    for (const a of sp.anchors) {
      if (!a || typeof a.chrom !== 'string') continue;
      if (!Number.isFinite(a.start_bp) || !Number.isFinite(a.end_bp)) continue;
      if (!byChrom.has(a.chrom)) byChrom.set(a.chrom, []);
      byChrom.get(a.chrom).push(a);
    }
    for (const arr of byChrom.values()) {
      arr.sort((x, y) => x.start_bp - y.start_bp);
    }
    out.set(sp.species, byChrom);
  }
  return out;
}

// =====================================================================
// 3. Homology-pair derivation
// =====================================================================

/**
 * Return cross-species homology pairs. Fast-path: when
 * `data.homology_pairs` is present, return it verbatim. Otherwise
 * derive on the fly: every busco_id that appears in ≥ 2 species
 * becomes one pair, with `species_locations[species]` = { chrom,
 * pos_bp } where pos_bp is the midpoint of the anchor's
 * [start_bp, end_bp].
 *
 * @param {Object} data
 * @returns {Array<{busco_id:string, species_locations:Object}>}
 */
export function deriveHomologyPairs(data) {
  if (data && Array.isArray(data.homology_pairs)) {
    return data.homology_pairs.slice();
  }
  if (!data || !Array.isArray(data.species)) return [];
  const byBuscoId = new Map();
  for (const sp of data.species) {
    if (!sp || !Array.isArray(sp.anchors) || typeof sp.species !== 'string') continue;
    for (const a of sp.anchors) {
      if (!a || typeof a.busco_id !== 'string' || typeof a.chrom !== 'string') continue;
      if (!Number.isFinite(a.start_bp) || !Number.isFinite(a.end_bp)) continue;
      if (!byBuscoId.has(a.busco_id)) byBuscoId.set(a.busco_id, {});
      byBuscoId.get(a.busco_id)[sp.species] = {
        chrom: a.chrom,
        pos_bp: Math.round(0.5 * (a.start_bp + a.end_bp)),
      };
    }
  }
  const out = [];
  for (const [busco_id, locs] of byBuscoId) {
    if (Object.keys(locs).length >= 2) {
      out.push({ busco_id, species_locations: locs });
    }
  }
  return out;
}

// =====================================================================
// 4. Density / window helpers
// =====================================================================

function _chromArr(idx, species, chrom) {
  if (!idx) return [];
  const byChrom = idx.get(species);
  if (!byChrom) return [];
  return byChrom.get(chrom) || [];
}

/**
 * Number of BUSCO anchors with midpoint inside [start_bp, end_bp].
 *
 * @param {Map} idx                from indexAnchorsBySpecies
 * @param {string} species
 * @param {string} chrom
 * @param {number} start_bp
 * @param {number} end_bp
 * @returns {number}
 */
export function buscoCountInWindow(idx, species, chrom, start_bp, end_bp) {
  if (!Number.isFinite(start_bp) || !Number.isFinite(end_bp) || end_bp < start_bp) {
    return 0;
  }
  const arr = _chromArr(idx, species, chrom);
  if (arr.length === 0) return 0;
  let n = 0;
  for (const a of arr) {
    const mid = 0.5 * (a.start_bp + a.end_bp);
    if (mid >= start_bp && mid <= end_bp) n++;
  }
  return n;
}

/**
 * BUSCO anchors per Mb inside [start_bp, end_bp]. Zero when the
 * window has zero / negative bp span.
 *
 * @param {Map} idx
 * @param {string} species
 * @param {string} chrom
 * @param {number} start_bp
 * @param {number} end_bp
 * @returns {number}
 */
export function buscoDensityInWindow(idx, species, chrom, start_bp, end_bp) {
  const span_bp = end_bp - start_bp;
  if (!(span_bp > 0)) return 0;
  const n = buscoCountInWindow(idx, species, chrom, start_bp, end_bp);
  return n / (span_bp / 1_000_000);
}

/**
 * Ratio of in-candidate density vs combined-flank density.
 *
 * Returns:
 *   {
 *     ok: boolean,
 *     density_in:   anchors/Mb inside [start_bp, end_bp]
 *     density_flank: anchors/Mb across the L + R flanks of width
 *                    `opts.flank_bp` (default BUSCO_DEFAULT_FLANK_BP)
 *     ratio:        density_in / density_flank  (null when flank is 0)
 *     depletion:    true when ratio < 0.5  (heuristic; spec calls out
 *                   "depletion at breakpoints" as a flag, not a
 *                   threshold-defined verdict)
 *     n_in, n_flank, span_in_mb, span_flank_mb
 *   }
 *
 * @param {Map} idx
 * @param {string} species
 * @param {string} chrom
 * @param {number} start_bp
 * @param {number} end_bp
 * @param {{flank_bp?:number}} [opts]
 * @returns {Object}
 */
export function buscoDepletionVsFlank(idx, species, chrom, start_bp, end_bp, opts) {
  const o = opts || {};
  const flank_bp = Number.isFinite(o.flank_bp) ? o.flank_bp : BUSCO_DEFAULT_FLANK_BP;
  const span_in = end_bp - start_bp;
  if (!(span_in > 0)) return { ok: false, reason: 'invalid_window' };
  const n_in = buscoCountInWindow(idx, species, chrom, start_bp, end_bp);
  const lo_start = Math.max(0, start_bp - flank_bp);
  const lo_end   = Math.max(0, start_bp);
  const hi_start = end_bp;
  const hi_end   = end_bp + flank_bp;
  const n_lo = buscoCountInWindow(idx, species, chrom, lo_start, lo_end);
  const n_hi = buscoCountInWindow(idx, species, chrom, hi_start, hi_end);
  const n_flank = n_lo + n_hi;
  const span_flank = (lo_end - lo_start) + (hi_end - hi_start);
  const density_in = n_in / (span_in / 1_000_000);
  const density_flank = span_flank > 0
    ? n_flank / (span_flank / 1_000_000)
    : 0;
  const ratio = density_flank > 0 ? density_in / density_flank : null;
  return {
    ok: true,
    density_in,
    density_flank,
    ratio,
    depletion: ratio != null && ratio < 0.5,
    n_in, n_flank,
    span_in_mb: span_in / 1_000_000,
    span_flank_mb: span_flank / 1_000_000,
  };
}

// =====================================================================
// 5. Synteny score (one chromosome pair, two species)
// =====================================================================

function _spearman(xs, ys) {
  // xs, ys are paired numeric arrays. Returns Spearman ρ ∈ [-1, 1].
  const n = xs.length;
  if (n < 2) return 0;
  const ranked = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const ranks = new Array(n);
    for (let i = 0; i < n; i++) ranks[idx[i][1]] = i + 1;
    return ranks;
  };
  const rx = ranked(xs);
  const ry = ranked(ys);
  let dSq = 0;
  for (let i = 0; i < n; i++) {
    const d = rx[i] - ry[i];
    dSq += d * d;
  }
  return 1 - (6 * dSq) / (n * (n * n - 1));
}

/**
 * BUSCO-based synteny score between one chromosome of species A and
 * one chromosome of species B. Returns the count of shared BUSCO IDs
 * + Spearman ρ on their bp positions (high |ρ| = collinear; sign
 * indicates relative orientation: positive = same orientation,
 * negative = inverted relative to each other on a chromosome-wide
 * scale).
 *
 * @param {Map} idx
 * @param {string} speciesA
 * @param {string} chromA
 * @param {string} speciesB
 * @param {string} chromB
 * @returns {{n_shared:number, rho:number, n_a:number, n_b:number}}
 */
export function buscoSyntenyScore(idx, speciesA, chromA, speciesB, chromB) {
  const a = _chromArr(idx, speciesA, chromA);
  const b = _chromArr(idx, speciesB, chromB);
  const bById = new Map();
  for (const x of b) bById.set(x.busco_id, x);
  const posA = [];
  const posB = [];
  for (const x of a) {
    const m = bById.get(x.busco_id);
    if (!m) continue;
    posA.push(0.5 * (x.start_bp + x.end_bp));
    posB.push(0.5 * (m.start_bp + m.end_bp));
  }
  return {
    n_shared: posA.length,
    rho: _spearman(posA, posB),
    n_a: a.length,
    n_b: b.length,
  };
}

// =====================================================================
// 6. Architecture-class suggest
// =====================================================================

/**
 * Suggest the page-14 architecture class for a candidate from BUSCO
 * topology around its chromosome and one sister-species chromosome
 * (spec §"How the atlas uses this — Page 14").
 *
 * Class B (synteny-boundary inversion):
 *   - All flank BUSCOs of the focal candidate land on ONE sister
 *     chromosome AND ρ is strongly negative (signature of an
 *     inversion superimposed on otherwise collinear chromosomes).
 *
 * Class C (fission/fusion):
 *   - Flank BUSCOs of the focal candidate split across TWO sister
 *     chromosomes — i.e. one half of the BUSCO IDs maps to one
 *     sister chromosome and the other half to another. Spec example:
 *     "Cgar LG28 has BUSCOs A-B-C-D-E and Cmac has A-B-C on LG01 +
 *     D-E on LG06".
 *
 * Returns:
 *   {
 *     verdict: BUSCO_ARCHITECTURE_CLASSES.*,
 *     n_shared, evidence: { ... },
 *   }
 *
 * The auto-suggest never rules out other architecture classes; the
 * user-facing UI should treat this as a hint, not a decision.
 *
 * @param {Map} idx
 * @param {{species:string, chrom:string, candidate_start_bp:number,
 *          candidate_end_bp:number}} focal
 * @param {{species:string}} sister
 * @param {{flank_bp?:number, min_shared?:number,
 *          synteny_rho_threshold?:number,
 *          fission_min_minor_frac?:number}} [opts]
 * @returns {Object}
 */
export function suggestArchitectureClass(idx, focal, sister, opts) {
  const o = opts || {};
  const flank_bp = Number.isFinite(o.flank_bp) ? o.flank_bp : BUSCO_DEFAULT_FLANK_BP;
  const minShared = Number.isFinite(o.min_shared)
    ? o.min_shared : BUSCO_MIN_SHARED_FOR_SUGGEST;
  const rhoThr = Number.isFinite(o.synteny_rho_threshold)
    ? o.synteny_rho_threshold : 0.7;
  const minorFrac = Number.isFinite(o.fission_min_minor_frac)
    ? o.fission_min_minor_frac : 0.25;

  if (!focal || !sister) {
    return {
      verdict: BUSCO_ARCHITECTURE_CLASSES.UNCERTAIN,
      reason: 'missing_focal_or_sister',
    };
  }
  const focalArr = _chromArr(idx, focal.species, focal.chrom);
  // Flank BUSCOs of the focal candidate
  const lo_start = Math.max(0, focal.candidate_start_bp - flank_bp);
  const lo_end   = focal.candidate_start_bp;
  const hi_start = focal.candidate_end_bp;
  const hi_end   = focal.candidate_end_bp + flank_bp;
  const flankIds = [];
  for (const a of focalArr) {
    const mid = 0.5 * (a.start_bp + a.end_bp);
    if ((mid >= lo_start && mid <= lo_end)
        || (mid >= hi_start && mid <= hi_end)) {
      flankIds.push(a.busco_id);
    }
  }
  // Where do those BUSCOs land in the sister species?
  const sisterByChrom = idx ? idx.get(sister.species) : null;
  if (!sisterByChrom) {
    return {
      verdict: BUSCO_ARCHITECTURE_CLASSES.INSUFFICIENT_BUSCO,
      reason: 'sister_species_not_in_index',
      n_shared: 0,
    };
  }
  const chromCounts = new Map();
  let totalLanded = 0;
  for (const [chrom, anchors] of sisterByChrom) {
    const ids = new Set();
    for (const a of anchors) ids.add(a.busco_id);
    let hits = 0;
    for (const id of flankIds) if (ids.has(id)) hits++;
    if (hits > 0) chromCounts.set(chrom, hits);
    totalLanded += hits;
  }
  if (totalLanded < minShared) {
    return {
      verdict: BUSCO_ARCHITECTURE_CLASSES.INSUFFICIENT_BUSCO,
      reason: 'too_few_shared_buscos',
      n_shared: totalLanded,
    };
  }
  const sorted = Array.from(chromCounts.entries()).sort((a, b) => b[1] - a[1]);
  const [topChrom, topCount] = sorted[0];
  const secondCount = sorted.length > 1 ? sorted[1][1] : 0;

  // Class C heuristic: ≥ 2 sister chromosomes carry flank BUSCOs AND
  // the second chromosome has ≥ `minorFrac` of the total hits.
  if (sorted.length >= 2 && (secondCount / totalLanded) >= minorFrac) {
    return {
      verdict: BUSCO_ARCHITECTURE_CLASSES.FUSION_FISSION,
      n_shared: totalLanded,
      evidence: {
        top_chrom: topChrom, top_count: topCount,
        second_chrom: sorted[1][0], second_count: secondCount,
        all_landings: sorted,
      },
    };
  }
  // Class B heuristic: all (or near-all) BUSCOs go to one sister
  // chromosome AND the synteny score is strongly negative (inverted).
  // Compute synteny against that sister chrom using all BUSCOs of
  // the focal chrom (not just flanks) for a more stable ρ estimate.
  const synteny = buscoSyntenyScore(idx,
    focal.species, focal.chrom, sister.species, topChrom);
  if (synteny.n_shared >= minShared && synteny.rho <= -rhoThr) {
    return {
      verdict: BUSCO_ARCHITECTURE_CLASSES.SYNTENY_BOUNDARY,
      n_shared: totalLanded,
      evidence: {
        top_chrom: topChrom, top_count: topCount,
        synteny_rho: synteny.rho,
        synteny_n_shared: synteny.n_shared,
      },
    };
  }
  return {
    verdict: BUSCO_ARCHITECTURE_CLASSES.UNCERTAIN,
    n_shared: totalLanded,
    evidence: {
      top_chrom: topChrom, top_count: topCount,
      synteny_rho: synteny.rho,
      synteny_n_shared: synteny.n_shared,
    },
  };
}
