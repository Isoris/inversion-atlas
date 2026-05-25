// shared/dosage_chunks.js
//
// Dosage-chunk readers + per-L2 het-rate computation (legacy lines
// 16540-16800). Reads from the existing dosage_chunks LRU cache to
// produce per-sample het rates over a bp range. The synchronous-only
// design matches the legacy convention: when no covering chunk is in
// cache, the helper returns an all-NaN buffer rather than triggering
// an async fetch (callers paint dim and rely on the user-driven
// dosage UI to populate the cache).
//
// All compute is pure: caller passes state explicitly and supplies
// the chunk-fetcher via `opts.getCachedChunk(startBp, endBp)`. The
// legacy reached `window.popgenDosage.getCachedChunk` as a runtime
// global — the cartridge port keeps that lookup at the call site.

/**
 * Read a single dosage cell out of a loaded chunk. Returns null when
 * the chunk / row / cell is missing or carries the -1 NA sentinel.
 *
 * @param {{dosage?:Array<ArrayLike<number>>}} chunk
 * @param {number} marker_idx
 * @param {number} sample_idx
 * @returns {number|null}
 */
export function chunkGet(chunk, marker_idx, sample_idx) {
  if (!chunk || !chunk.dosage) return null;
  const row = chunk.dosage[marker_idx];
  if (!row) return null;
  const v = row[sample_idx];
  if (v == null || !Number.isFinite(v) || v < 0) return null;
  return v;
}

// =====================================================================
// Per-L2 / per-range het-rate compute
// =====================================================================

function _emptyNaN(nS) {
  const out = new Float32Array(nS);
  for (let si = 0; si < nS; si++) out[si] = NaN;
  return out;
}

// =====================================================================
// 2026-05-20: sample-id alias matching.
//
// The chunk fetcher returns `chunk.samples` as the raw lines of the
// server-side samples.tsv (one ID per line, first column). The atlas
// cohort `state.data.samples` ships from a precomp JSON and can be
// any of:
//   - plain string: "CGA001"
//   - object: { id: "CGA001" }
//   - object: { cga: "CGA001", ind: "1_CGA001" }
//   - object with prefixes / suffixes / underscores
//
// The pre-2026-05-20 matcher tried `s.id || s.cga || s.ind || s.sample`.
// Real-world precomps have shipped with `s.name`, `s.sample_id`, `s.ID`,
// plain strings, and prefixed IDs ("1_CGA001"). The matcher returned
// nothing → 0 samples matched → every cohort cell stayed NaN → grey.
//
// New strategy: build aliases per cohort sample (multiple keys map to
// the same cohort idx) so the chunk's IDs hit on at least one. Also
// log a one-shot diagnostic when the match-rate is poor so the
// console makes the cause obvious instead of "everything is silently
// grey".
// =====================================================================

function _normId(s) {
  return String(s == null ? '' : s).trim();
}

function _normIdCanon(s) {
  // Lowercase + strip non-alphanum so "CGA-001" / "cga_001" / "CGA001"
  // all collapse to "cga001". Use as a last-chance fuzzy match.
  return _normId(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Strip filesystem path + common alignment file extensions so that
// "/path/to/CGA009.bam", "CGA009.bam", "CGA009.cram", "CGA009" all
// collapse to "CGA009". Mirrors the R-side 08a_build_sample_metadata.R
// cleaning step:
//   clean_cga <- vapply(bam_ids, function(x) {
//     base <- basename(x)
//     sub("\\.(bam|cram|sam)$", "", base, ignore.case = TRUE)
//   }, character(1))
// Critical when the server's dosage samples.tsv ships bam-file paths
// (or just basenames-with-extensions) while the cohort precomp's `cga`
// field carries the cleaned IDs — without this step, no exact match.
function _stripPathAndExt(s) {
  if (!s) return s;
  // basename: handle both POSIX and Windows separators
  const slash = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  let base = slash >= 0 ? s.slice(slash + 1) : s;
  // strip .bam / .cram / .sam (case-insensitive), plus optional .gz
  base = base.replace(/\.(bam|cram|sam)(\.gz)?$/i, '');
  return base;
}

// Strip common species/dataset prefixes both directions so e.g.
// "C_gar_CGA001" ↔ "CGA001" / "CGA-001" / "cga001" all match.
// Examples of prefixes seen in the wild: "C_gar_", "Cgar_",
// "C_mac_", "INV_", "SAM_", "1_" (digits).
const _PREFIX_PATTERNS = [
  /^[A-Za-z]+_[A-Za-z]+_/,   // species_subset_ (e.g. "C_gar_")
  /^[A-Za-z]+_/,             // single_token_ (e.g. "INV_", "SAM_")
  /^\d+_/,                   // numeric_ (e.g. "1_")
];

function _stripPrefixes(id) {
  // Apply each prefix pattern at most once and collect every reachable
  // intermediate form so any of them can match the chunk side.
  const out = new Set([id]);
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const re of _PREFIX_PATTERNS) {
      const m = re.exec(cur);
      if (m) {
        const next = cur.slice(m[0].length);
        if (next && !out.has(next)) {
          out.add(next);
          stack.push(next);
        }
      }
    }
  }
  return Array.from(out);
}

function _aliasesForCohortEntry(s, fallbackIdx) {
  const out = [];
  const seen = new Set();
  const _add = (v) => {
    if (v == null || v === '') return;
    const cleaned = _stripPathAndExt(_normId(v));
    // Push the raw normalised form first (so exact-string matchers hit it),
    // then the path/extension-stripped variant, then prefix-stripped
    // variants of both. The chunk side runs the same cleaning at lookup
    // time so most chains end up pointing at the same canonical form.
    for (const raw of [_normId(v), cleaned]) {
      if (raw && !seen.has(raw)) { seen.add(raw); out.push(raw); }
      for (const stripped of _stripPrefixes(raw)) {
        if (!seen.has(stripped)) { seen.add(stripped); out.push(stripped); }
      }
    }
  };
  if (s == null) {
    out.push('S' + fallbackIdx);
    return out;
  }
  if (typeof s === 'string' || typeof s === 'number') {
    _add(s);
    if (out.length === 0) out.push('S' + fallbackIdx);
    return out;
  }
  // Object — pull every plausible identifier field.
  const fields = ['id', 'cga', 'ind', 'sample', 'sample_id',
                  'name', 'label', 'ID', 'IND', 'CGA',
                  'sampleId', 'sampleID', 'individual', 'idx',
                  'bam', 'bamfile', 'path'];
  for (const f of fields) _add(s[f]);
  if (out.length === 0) out.push('S' + fallbackIdx);
  return out;
}

function _buildSampleIdMap(state, chunkSamples) {
  const cohortSamples = (state && state.data && state.data.samples) || [];
  // 2026-05-21 perf (Tier-C finding #5): the alias resolution + the
  // first two map-build passes are PURELY cohort-derived — they don't
  // depend on chunkSamples at all. Cache the cohort-only piece on
  // state, invalidated by identity drift on state.data.samples. The
  // per-chunk path then just clones the cached map and attaches
  // chunk-specific `_byPos` + runs the diagnostic. Before: 2 × O(n_cohort)
  // calls to _aliasesForCohortEntry per chunk fetch, each call doing
  // string normalisation; after: zero alias calls on the hot path.
  const _cached = state && state._cohortSampleAliasMap;
  let map;
  if (_cached && _cached.samples === cohortSamples) {
    // Clone the cached cohort-only map so chunk-specific fields
    // (`_byPos`) don't pollute the cache.
    map = new Map(_cached.map);
  } else {
    map = new Map();
    // Compute aliases ONCE per cohort sample (instead of twice — once
    // for pass 1, once for pass 2 — as the legacy code did).
    const aliasesPerSample = new Array(cohortSamples.length);
    for (let ci = 0; ci < cohortSamples.length; ci++) {
      aliasesPerSample[ci] = _aliasesForCohortEntry(cohortSamples[ci], ci);
    }
    // Pass 1: exact + variant aliases per cohort sample.
    for (let ci = 0; ci < cohortSamples.length; ci++) {
      for (const a of aliasesPerSample[ci]) {
        if (!map.has(a)) map.set(a, ci);
      }
    }
    // Pass 2: canonicalised form as a fallback. Only filled when the
    // canonical key isn't already taken by an exact alias.
    for (let ci = 0; ci < cohortSamples.length; ci++) {
      for (const a of aliasesPerSample[ci]) {
        const c = _normIdCanon(a);
        if (c && !map.has(c)) map.set(c, ci);
      }
    }
    if (state) state._cohortSampleAliasMap = { samples: cohortSamples, map: new Map(map) };
  }
  // Pass 3: positional fallback. The beagle (which the server reads as
  // the dosage matrix's column order) often ships placeholder IDs like
  // "Ind", "Ind1", "Ind2" OR even all-literal "Ind" duplicates, while
  // the cohort precomp uses real names like "CGA001". Quentin: "maybe
  // because in the beagle its Ind Ind Ind and in the samples its CGA".
  // The columns ARE ordered the same way (beagle column order is
  // preserved through both pipelines), so chunk.samples[i] corresponds
  // to cohort.samples[i] — that's the bamlist-to-Ind mapping the
  // catfish-inversion-analysis precomp documents as the canonical
  // identity binding.
  //
  // We DON'T stuff positional aliases into `map` because if the chunk
  // ships duplicate strings (e.g. all literal "Ind"), the first
  // map.set("Ind", 0) wins and every chunk index >0 still misses.
  // Instead we attach a parallel `_byPos` table the lookup wrapper
  // walks AFTER all string-based passes fail. Only safe when lengths
  // agree — different cohort sizes would mis-align.
  if (chunkSamples && chunkSamples.length === cohortSamples.length
      && cohortSamples.length > 0) {
    map._byPos = new Array(chunkSamples.length);
    for (let i = 0; i < chunkSamples.length; i++) map._byPos[i] = i;
    // Pre-compute name-rate to decide whether positional should ALSO
    // win on per-cell misses. If name matching has any hits at all,
    // positional is only used for samples that didn't string-match.
    // If name matching has zero hits (beagle-placeholder case), every
    // sample resolves positionally.
  }
  // One-shot diagnostic per page load. Always logs the first match so
  // there's evidence whether the matcher is finding samples or not.
  // After the first log, only re-logs when window.__dosageDbg is true
  // (so the console isn't spammed once we know the rate). The match-rate
  // count uses the same lookup path as the per-marker projection so the
  // printed number is the actually-achieved rate.
  if (chunkSamples && chunkSamples.length > 0
      && cohortSamples.length > 0
      && typeof console !== 'undefined'
      && state && (!state.__dosageMatchRateLogged
                   || (typeof window !== 'undefined' && window.__dosageDbg === true))) {
    let matched = 0;
    const coveredCohortIdx = new Set();
    for (let i = 0; i < chunkSamples.length; i++) {
      const ci = _lookupCohortIdx(map, chunkSamples[i], i);
      if (ci >= 0) {
        matched++;
        coveredCohortIdx.add(ci);
      }
    }
    const rate = matched / chunkSamples.length;
    // 2026-05-26: also report cohort coverage — match rate of 100% on
    // a small chunk can still leave most cohort samples uncovered (which
    // shows up as L3 het pills "?" and grey PCA points for the missing
    // half). The "covers" half is the actually-load-bearing number when
    // troubleshooting "het looks broken".
    const coveredFrac = coveredCohortIdx.size / cohortSamples.length;
    const cohortSample = cohortSamples[0];
    const cohortPreview = (typeof cohortSample === 'string' || typeof cohortSample === 'number')
      ? cohortSample
      : JSON.stringify(cohortSample);
    const fn = (rate === 0 || coveredFrac < 0.5) ? 'warn' : 'log';
    console[fn]('[dosage_chunks] sample-id match:',
      `${matched}/${chunkSamples.length} = ${(rate * 100).toFixed(0)}%`,
      `· covers ${coveredCohortIdx.size}/${cohortSamples.length} cohort (${(coveredFrac * 100).toFixed(0)}%)`,
      '· chunk ID example:', JSON.stringify(chunkSamples[0]),
      '· cohort entry example:', cohortPreview,
      '· cohort aliases for [0]:', _aliasesForCohortEntry(cohortSample, 0));
    state.__dosageMatchRateLogged = true;
  }
  return map;
}

// Wrapper so chunk.samples lookups go through the canonicalisation +
// prefix-strip + positional fallbacks when the exact-string lookup
// misses. Match order: exact → exact-without-prefix → canonical →
// canonical-without-prefix → positional (chunk index === cohort index).
// Positional only fires when map._byPos was set (lengths agree) so
// mis-sized cohorts don't get aligned to the wrong rows.
function _lookupCohortIdx(map, chunkId, chunkIdx) {
  if (chunkId != null) {
    const raw = _normId(chunkId);
    // 2026-05-26: chunk samples often ship as bam paths from the server
    // (e.g. "/path/to/CGA009.bam") while the cohort precomp's `cga`
    // field carries the cleaned ID ("CGA009"). Try the path/extension-
    // stripped form FIRST so the common case hits without falling back
    // to canonical or positional alignment.
    const cleaned = _stripPathAndExt(raw);
    if (map.has(cleaned)) return map.get(cleaned);
    if (map.has(raw)) return map.get(raw);
    for (const stripped of _stripPrefixes(cleaned)) {
      if (map.has(stripped)) return map.get(stripped);
    }
    const canon = _normIdCanon(cleaned);
    if (map.has(canon)) return map.get(canon);
    for (const stripped of _stripPrefixes(cleaned)) {
      const c = _normIdCanon(stripped);
      if (c && map.has(c)) return map.get(c);
    }
  }
  // Positional last-resort. Handles the beagle-placeholder case
  // (chunk samples are all literal "Ind") + any other shape where
  // name-based binding fails but column order is trusted.
  if (map._byPos && Number.isFinite(chunkIdx)
      && chunkIdx >= 0 && chunkIdx < map._byPos.length) {
    return map._byPos[chunkIdx];
  }
  return -1;
}

function _ensureHetRateCache(state) {
  if (!state.__hetRateCache || !(state.__hetRateCache instanceof Map)) {
    state.__hetRateCache = new Map();
  }
  return state.__hetRateCache;
}

/**
 * Invalidate the per-L2 / per-range het-rate cache. Called when the
 * dosage_chunks layer rotates (new chunk-index, manual reset).
 * @param {Object} state
 */
export function invalidateHetRateCache(state) {
  if (state && state.__hetRateCache instanceof Map) {
    state.__hetRateCache.clear();
  }
}

/**
 * 2026-05-26: per-chrom reset hook. Called from applyData() when a new
 * chromosome's precomp lands. Clears:
 *   - het-rate cache + dosage-mean cache (cacheKey-keyed by bp range, no
 *     chrom prefix — coincident L2 bp ranges between chroms would alias
 *     and return stale values)
 *   - all one-shot diagnostic flags (so the user gets a fresh
 *     chunk-shape / sample-id / marker-filter / all-NaN log for the new
 *     chrom instead of "already logged once this session")
 *   - alias map cache (cohort.samples identity changes on chrom load,
 *     but explicit clear is cheap defence against future precomp shapes
 *     that reuse the array)
 *
 * NOT cleared: state.__dosageChunkLru. The LRU keys include chrom and
 * its covering-fallback explicitly filters by chrom prefix, so cross-chrom
 * leakage is already prevented. Keeping it around lets navigating
 * back to a previous chrom reuse already-fetched chunks (free perf).
 *
 * @param {Object} state
 */
export function resetDosageDiagnosticsForChromChange(state) {
  if (!state) return;
  if (state.__hetRateCache instanceof Map) state.__hetRateCache.clear();
  if (state.__dosageMeanCache instanceof Map) state.__dosageMeanCache.clear();
  state.__cohortSampleAliasMap = null;
  state.__chunkShapeValidated = false;
  state.__dosageMatchRateLogged = false;
  state.__hetAllNanLogged = false;
  state.__hetMarkerFilterLogged = false;
  state.__dosageMeanAllNanLogged = false;
  state.__dosageMeanMarkerFilterLogged = false;
}

/**
 * Compute per-sample het rates over a bp range. Returns Float32Array
 * of length n_samples; entries are NaN for samples with no calls in
 * the range, [0, 1] otherwise.
 *
 * Reads dosage cells synchronously from the chunk that
 * `opts.getCachedChunk(startBp, endBp)` returns. When no chunk is
 * available (callback missing or returns null), the result is
 * all-NaN.
 *
 * Optional `cacheKey` memoises across calls — pass null to skip
 * caching. The legacy code keys per-L2 by index and per-slab by
 * 'slab:start_w:end_w'.
 *
 * Chunk contract: `{ samples: [id, ...], markers: [{pos_bp}, ...],
 * dosage: [[per-sample, ...], ...] }`. The mapping from chunk
 * sample-index to cohort sample-index is rebuilt from sample ids
 * (s.id || s.cga || s.ind || s.sample fallback chain — matches the
 * legacy convention).
 *
 * @param {Object} state
 * @param {number} startBp
 * @param {number} endBp
 * @param {{getCachedChunk?:Function, cacheKey?:string|number}} opts
 * @returns {Float32Array}
 */
export function computeHetRateForRange(state, startBp, endBp, opts) {
  const o = opts || {};
  const nS = (state && state.data && state.data.n_samples) || 0;
  const cache = state ? _ensureHetRateCache(state) : null;
  const cacheKey = o.cacheKey != null ? o.cacheKey : null;
  if (cacheKey != null && cache && cache.has(cacheKey)) return cache.get(cacheKey);

  const out = _emptyNaN(nS);
  // 2026-05-20: previously we cached this all-NaN placeholder under the
  // cacheKey on invalid-bp + chunk-miss paths. That defeated the
  // onLoad-triggered repaint loop: chunk arrives, drawLinesPanel calls
  // computeHetRateForRange with the same cacheKey, the stale NaN array
  // wins, lines stay grey forever. Now: only cache when we actually
  // compute a real result. Misses re-run on the next call.
  if (!Number.isFinite(startBp) || !Number.isFinite(endBp) || endBp < startBp) {
    return out;
  }

  const getCachedChunk = o.getCachedChunk;
  const chunk = (typeof getCachedChunk === 'function')
    ? getCachedChunk(startBp, endBp) : null;
  if (!chunk || !Array.isArray(chunk.markers) || !Array.isArray(chunk.dosage)
      || !Array.isArray(chunk.samples)) {
    return out;
  }

  // chunk-sample-id → cohort-index lookup. Robust matcher: see
  // _buildSampleIdMap for the multi-pass alias strategy.
  const idToCohort = _buildSampleIdMap(state, chunk.samples);

  // Filter markers to bp span. 2026-05-26: pos_bp coerced through
  // Number(...) so a server that serialises bp positions as strings
  // ("13350000" instead of 13350000) still filters correctly. JSON
  // bigints sometimes ship as strings.
  const inRange = [];
  let nMarkersWithBp = 0;          // markers that have a finite pos_bp at all
  let markerMinBp = Infinity;
  let markerMaxBp = -Infinity;
  for (let mi = 0; mi < chunk.markers.length; mi++) {
    const m = chunk.markers[mi];
    if (!m) continue;
    const bp = (typeof m.pos_bp === 'number') ? m.pos_bp : Number(m.pos_bp);
    if (!Number.isFinite(bp)) continue;
    nMarkersWithBp++;
    if (bp < markerMinBp) markerMinBp = bp;
    if (bp > markerMaxBp) markerMaxBp = bp;
    if (bp < startBp || bp > endBp) continue;
    inRange.push(mi);
  }
  if (inRange.length === 0) {
    // 2026-05-26: one-shot diagnostic for the marker-shape failure mode.
    // Distinguishes "no markers had pos_bp at all" (chunk shape unexpected
    // — server returns markers as something other than {pos_bp:…} objects)
    // from "markers exist but all fall outside the requested bp range"
    // (chunk-cache key off, or covering-chunk fallback returned a chunk
    // for a different span).
    if (state && !state.__hetMarkerFilterLogged && typeof console !== 'undefined') {
      const m0 = chunk.markers[0];
      console.warn('[dosage_chunks] computeHetRateForRange: 0 markers in bp range:',
        `requested ${startBp}-${endBp}`,
        `· chunk has ${chunk.markers.length} markers`,
        `· markers with finite pos_bp: ${nMarkersWithBp}/${chunk.markers.length}`,
        `· marker bp span: ${isFinite(markerMinBp) ? markerMinBp : '—'}…${isFinite(markerMaxBp) ? markerMaxBp : '—'}`,
        `· first marker shape: ${typeof m0 === 'object' ? JSON.stringify(Object.keys(m0 || {})) : typeof m0}`,
        `· first marker value: ${JSON.stringify(m0)}`);
      state.__hetMarkerFilterLogged = true;
    }
    return out;
  }

  // Count het + non-NA calls per chunk-sample
  const nChunkS = chunk.samples.length;
  const hetCounts = new Int32Array(nChunkS);
  const nonNaCounts = new Int32Array(nChunkS);
  for (const mi of inRange) {
    const row = chunk.dosage[mi];
    if (!row) continue;
    for (let ci = 0; ci < nChunkS; ci++) {
      const v = row[ci];
      if (v == null || !Number.isFinite(v) || v < 0) continue;
      nonNaCounts[ci]++;
      if (v === 1) hetCounts[ci]++;
    }
  }

  // Project to cohort space — _lookupCohortIdx handles exact and
  // canonicalised (alphanumeric-lowercase) fallbacks so prefix /
  // separator / case variants still match.
  let nProjected = 0, nWithCalls = 0;
  let sumNonNa = 0;
  for (let ci = 0; ci < nChunkS; ci++) {
    const cohortIdx = _lookupCohortIdx(idToCohort, chunk.samples[ci], ci);
    if (cohortIdx < 0 || cohortIdx >= nS) continue;
    nProjected++;
    sumNonNa += nonNaCounts[ci];
    if (nonNaCounts[ci] > 0) nWithCalls++;
    out[cohortIdx] = (nonNaCounts[ci] === 0)
      ? NaN
      : hetCounts[ci] / nonNaCounts[ci];
  }

  // 2026-05-26: one-shot diagnostic for "all-NaN despite chunk landing".
  // Fires when the chunk projects to ZERO real values across the cohort,
  // which is the "het looks grey" failure mode. Tells you whether the
  // chain broke at projection (0 chunk samples mapped to cohort) or at
  // calls (markers in range but every cell is -1 NA).
  if (state && !state.__hetAllNanLogged && typeof console !== 'undefined'
      && (nWithCalls === 0 || nProjected === 0)) {
    console.warn('[dosage_chunks] computeHetRateForRange produced all-NaN:',
      `bp range ${startBp}-${endBp}`,
      `· markers in range: ${inRange.length}/${chunk.markers.length}`,
      `· chunk samples: ${nChunkS}`,
      `· projected to cohort: ${nProjected}/${nS}`,
      `· with non-NA calls: ${nWithCalls}/${nProjected}`,
      `· avg non-NA per sample: ${nProjected > 0 ? (sumNonNa / nProjected).toFixed(1) : 0}`,
      `· first chunk dosage row sample: ${chunk.dosage[inRange[0]] && Array.from(chunk.dosage[inRange[0]]).slice(0, 5)}`);
    state.__hetAllNanLogged = true;
  }

  if (cacheKey != null && cache) cache.set(cacheKey, out);
  return out;
}

/**
 * Per-L2 het rate. Thin wrapper over computeHetRateForRange that
 * pulls the bp span from state.data.l2_envelopes[l2idx] and uses
 * `l2idx` as the cache key.
 *
 * @param {Object} state
 * @param {number} l2idx
 * @param {{getCachedChunk?:Function}} opts
 * @returns {Float32Array}
 */
export function computeHetRateForL2(state, l2idx, opts) {
  const env = state && state.data && Array.isArray(state.data.l2_envelopes)
    && state.data.l2_envelopes[l2idx];
  if (!env) {
    const nS = (state && state.data && state.data.n_samples) || 0;
    return _emptyNaN(nS);
  }
  return computeHetRateForRange(state, env.start_bp, env.end_bp,
    Object.assign({}, opts, { cacheKey: l2idx }));
}

/**
 * Per-slab (start_w → end_w) het rate. Translates window-indices to
 * bp via state.data.windows.start_bp / end_bp and delegates to
 * computeHetRateForRange.
 *
 * @param {Object} state
 * @param {number} startW
 * @param {number} endW
 * @param {{getCachedChunk?:Function}} opts
 * @returns {Float32Array}
 */
export function computeHetRateForSlab(state, startW, endW, opts) {
  const nS = (state && state.data && state.data.n_samples) || 0;
  const w = state && state.data && state.data.windows;
  if (!w || !w.start_bp || !w.end_bp
      || !Number.isInteger(startW) || !Number.isInteger(endW)
      || startW < 0 || endW >= w.start_bp.length || endW < startW) {
    return _emptyNaN(nS);
  }
  const start_bp = w.start_bp[startW];
  const end_bp   = w.end_bp[endW];
  const cacheKey = 'slab:' + startW + ':' + endW;
  return computeHetRateForRange(state, start_bp, end_bp,
    Object.assign({}, opts, { cacheKey }));
}

// =====================================================================
// Per-sample MEAN dosage across a bp range (2026-05-18 — Group D
// completion). Mirrors computeHetRateForRange but sums dosage VALUES
// (0/1/2) instead of HET indicators. Used by the lines-panel 'dosage'
// color mode and any future per-sample dosage summary.
// =====================================================================
function _ensureDosageMeanCache(state) {
  if (!state.__dosageMeanCache || !(state.__dosageMeanCache instanceof Map)) {
    state.__dosageMeanCache = new Map();
  }
  return state.__dosageMeanCache;
}

export function invalidateDosageMeanCache(state) {
  if (state && state.__dosageMeanCache instanceof Map) {
    state.__dosageMeanCache.clear();
  }
}

/**
 * Per-sample mean dosage across markers whose pos_bp falls in
 * [startBp, endBp]. Returns Float32Array of length n_samples; NaN
 * where no non-missing call was observed for that sample.
 *
 * Same chunk-projection semantics as computeHetRateForRange:
 * chunk.samples → cohort-index lookup via state.data.samples[*].id /
 * cga / ind / sample.
 *
 * @param {Object} state
 * @param {number} startBp
 * @param {number} endBp
 * @param {{getCachedChunk?:Function, cacheKey?:string|number}} opts
 * @returns {Float32Array}
 */
export function computeDosageMeanForRange(state, startBp, endBp, opts) {
  const o = opts || {};
  const nS = (state && state.data && state.data.n_samples) || 0;
  const cache = state ? _ensureDosageMeanCache(state) : null;
  const cacheKey = o.cacheKey != null ? o.cacheKey : null;
  if (cacheKey != null && cache && cache.has(cacheKey)) return cache.get(cacheKey);

  const out = _emptyNaN(nS);
  // 2026-05-20: don't cache the placeholder on chunk-miss / invalid-bp
  // paths — see the matching note on computeHetRateForRange. Caching
  // NaN here used to lock the lines panel into grey even after the
  // chunk landed and onLoad fired a repaint.
  if (!Number.isFinite(startBp) || !Number.isFinite(endBp) || endBp < startBp) {
    return out;
  }

  const getCachedChunk = o.getCachedChunk;
  const chunk = (typeof getCachedChunk === 'function')
    ? getCachedChunk(startBp, endBp) : null;
  if (!chunk || !Array.isArray(chunk.markers) || !Array.isArray(chunk.dosage)
      || !Array.isArray(chunk.samples)) {
    return out;
  }

  // chunk-sample-id → cohort-index lookup. Robust matcher: see
  // _buildSampleIdMap for the multi-pass alias strategy.
  const idToCohort = _buildSampleIdMap(state, chunk.samples);

  // Filter markers to bp span. Same string-coercion fix as
  // computeHetRateForRange above.
  const inRange = [];
  let nMarkersWithBp = 0;
  let markerMinBp = Infinity;
  let markerMaxBp = -Infinity;
  for (let mi = 0; mi < chunk.markers.length; mi++) {
    const m = chunk.markers[mi];
    if (!m) continue;
    const bp = (typeof m.pos_bp === 'number') ? m.pos_bp : Number(m.pos_bp);
    if (!Number.isFinite(bp)) continue;
    nMarkersWithBp++;
    if (bp < markerMinBp) markerMinBp = bp;
    if (bp > markerMaxBp) markerMaxBp = bp;
    if (bp < startBp || bp > endBp) continue;
    inRange.push(mi);
  }
  if (inRange.length === 0) {
    // 2026-05-26: mirror of the diagnostic in computeHetRateForRange.
    if (state && !state.__dosageMeanMarkerFilterLogged && typeof console !== 'undefined') {
      const m0 = chunk.markers[0];
      console.warn('[dosage_chunks] computeDosageMeanForRange: 0 markers in bp range:',
        `requested ${startBp}-${endBp}`,
        `· chunk has ${chunk.markers.length} markers`,
        `· markers with finite pos_bp: ${nMarkersWithBp}/${chunk.markers.length}`,
        `· marker bp span: ${isFinite(markerMinBp) ? markerMinBp : '—'}…${isFinite(markerMaxBp) ? markerMaxBp : '—'}`,
        `· first marker shape: ${typeof m0 === 'object' ? JSON.stringify(Object.keys(m0 || {})) : typeof m0}`,
        `· first marker value: ${JSON.stringify(m0)}`);
      state.__dosageMeanMarkerFilterLogged = true;
    }
    return out;
  }

  // Sum dosage + count non-NA per chunk-sample
  const nChunkS = chunk.samples.length;
  const sumDos = new Float64Array(nChunkS);
  const nNonNa = new Int32Array(nChunkS);
  for (const mi of inRange) {
    const row = chunk.dosage[mi];
    if (!row) continue;
    for (let ci = 0; ci < nChunkS; ci++) {
      const v = row[ci];
      if (v == null || !Number.isFinite(v) || v < 0) continue;
      sumDos[ci] += v;
      nNonNa[ci]++;
    }
  }

  // Project to cohort space — _lookupCohortIdx handles exact and
  // canonicalised (alphanumeric-lowercase) fallbacks so prefix /
  // separator / case variants still match.
  let nProjected = 0, nWithCalls = 0;
  let sumNonNa = 0;
  for (let ci = 0; ci < nChunkS; ci++) {
    const cohortIdx = _lookupCohortIdx(idToCohort, chunk.samples[ci], ci);
    if (cohortIdx < 0 || cohortIdx >= nS) continue;
    nProjected++;
    sumNonNa += nNonNa[ci];
    if (nNonNa[ci] > 0) nWithCalls++;
    out[cohortIdx] = (nNonNa[ci] === 0)
      ? NaN
      : sumDos[ci] / nNonNa[ci];
  }

  // 2026-05-26: one-shot diagnostic mirroring computeHetRateForRange's.
  if (state && !state.__dosageMeanAllNanLogged && typeof console !== 'undefined'
      && (nWithCalls === 0 || nProjected === 0)) {
    console.warn('[dosage_chunks] computeDosageMeanForRange produced all-NaN:',
      `bp range ${startBp}-${endBp}`,
      `· markers in range: ${inRange.length}/${chunk.markers.length}`,
      `· chunk samples: ${nChunkS}`,
      `· projected to cohort: ${nProjected}/${nS}`,
      `· with non-NA calls: ${nWithCalls}/${nProjected}`,
      `· avg non-NA per sample: ${nProjected > 0 ? (sumNonNa / nProjected).toFixed(1) : 0}`,
      `· first chunk dosage row sample: ${chunk.dosage[inRange[0]] && Array.from(chunk.dosage[inRange[0]]).slice(0, 5)}`);
    state.__dosageMeanAllNanLogged = true;
  }

  if (cacheKey != null && cache) cache.set(cacheKey, out);
  return out;
}

/**
 * 2026-05-26 — diagnostic helper for the "PCA scatter still shows grey
 * when colored by dosage/het" UX. Builds a per-tracked-sample row with
 * the cohort id, the computed dosage value, the computed het value,
 * and the active bp range that was queried. Lets the user see at a
 * glance whether the chunk produced numbers (id-projection success)
 * or NaN (chunk-miss / id-mismatch / no markers in range).
 *
 * Returns:
 *   {
 *     range:       { startBp, endBp, startW, endW, chrom },
 *     lruKeys:     Array<string>      cached chunk keys for this chrom,
 *     trackedRows: Array<{ sample_idx, sample_id, dosage, het }>,
 *     diagnosis:   string             one-line human-readable verdict,
 *   }
 *
 * @param {Object} state              local_pca_dosage page state
 * @param {Array<number>} trackedIdx  fall-back to state.tracked when null
 * @param {{startW, endW}} [range]    fall-back to L2 envelope around cur
 */
export function buildDosageDebugReport(state, trackedIdx, range) {
  const d = state && state.data;
  if (!d) {
    return { range: null, lruKeys: [], trackedRows: [], diagnosis: 'no state.data' };
  }
  const tracked = (trackedIdx && trackedIdx.length > 0)
    ? Array.from(trackedIdx)
    : (Array.isArray(state.tracked) ? state.tracked.slice() : []);

  // Pick the range — caller may override; default mirrors drawPCA's
  // L2-envelope logic so the debug panel reports on the same window
  // range the PCA paint just used.
  let startW, endW;
  if (range && Number.isFinite(range.startW) && Number.isFinite(range.endW)) {
    startW = range.startW; endW = range.endW;
  } else {
    const cur = state.cur | 0;
    const curL2 = state.windowToL2 ? state.windowToL2[cur] : -1;
    if (curL2 >= 0 && d.l2_envelopes && d.l2_envelopes[curL2]) {
      const env = d.l2_envelopes[curL2];
      startW = (env._s0 != null) ? env._s0 : (env.start_w - 1);
      endW   = (env._e0 != null) ? env._e0 : (env.end_w - 1);
    } else {
      const slabHalf = 20;
      startW = Math.max(0, cur - slabHalf);
      endW   = Math.min((d.n_windows | 0) - 1, cur + slabHalf);
    }
  }
  const ws = (d.windows || [])[startW];
  const we = (d.windows || [])[endW];
  const startBp = ws ? (ws.start_bp != null ? ws.start_bp : ws.center_bp) : NaN;
  const endBp   = we ? (we.end_bp   != null ? we.end_bp   : we.center_bp) : NaN;

  // Drop the cached values for this exact cacheKey so the recompute
  // below reflects what the chunk currently contains (not a stale
  // NaN-array from before the chunk landed).
  const cacheKeyD = `lines:dosage:${startW}-${endW}`;
  const cacheKeyH = `lines:${startW}-${endW}`;
  const cache = state.__dosageMeanCache;
  if (cache && cache.delete) { cache.delete(cacheKeyD); cache.delete(cacheKeyH); }

  const dosVals = computeDosageMeanForRange(state, startBp, endBp, {
    getCachedChunk: state._linesPanelGetCachedChunk || null,
    cacheKey: cacheKeyD,
  });
  const hetVals = computeHetRateForRange(state, startBp, endBp, {
    getCachedChunk: state._linesPanelGetCachedChunk || null,
    cacheKey: cacheKeyH,
  });

  const samples = Array.isArray(d.samples) ? d.samples : [];
  const trackedRows = tracked.map((si) => {
    const sample = samples[si] || null;
    const sid = (sample && (sample.cga || sample.id || sample.sample || sample.ind)) || `S${si}`;
    return {
      sample_idx: si,
      sample_id:  sid,
      dosage: dosVals && Number.isFinite(dosVals[si]) ? dosVals[si] : NaN,
      het:    hetVals && Number.isFinite(hetVals[si]) ? hetVals[si] : NaN,
    };
  });

  const lru = state.__dosageChunkLru;
  const lruKeys = lru ? Array.from(lru.keys()) : [];

  // 2026-05-26: id-projection forensic — when the diagnosis lands on
  // "sample-id mismatch", the user wants to SEE which chunk ids didn't
  // match which cohort ids. Walks the same matcher (_buildSampleIdMap +
  // _lookupCohortIdx) the real per-marker projection uses, so what
  // shows up here is the actual contributor to NaN.
  let idProjection = null;
  try {
    const chunkForProbe = (typeof state._linesPanelGetCachedChunk === 'function')
      ? state._linesPanelGetCachedChunk(startBp, endBp) : null;
    if (chunkForProbe && Array.isArray(chunkForProbe.samples)) {
      const cohortSamples = (state.data && state.data.samples) || [];
      const map = _buildSampleIdMap(state, chunkForProbe.samples);
      const sampleMap = [];
      let matchedCount = 0;
      for (let i = 0; i < chunkForProbe.samples.length; i++) {
        const chunkId = chunkForProbe.samples[i];
        const cohortIdx = _lookupCohortIdx(map, chunkId, i);
        const matched = cohortIdx >= 0;
        if (matched) matchedCount++;
        const cohortEntry = matched ? cohortSamples[cohortIdx] : null;
        const cohortId = (cohortEntry
          && (cohortEntry.cga || cohortEntry.id || cohortEntry.sample || cohortEntry.ind))
          || (matched ? `S${cohortIdx}` : null);
        sampleMap.push({
          chunk_idx: i,
          chunk_id: typeof chunkId === 'string' ? chunkId : String(chunkId),
          cohort_idx: cohortIdx,
          cohort_id: cohortId,
          matched,
        });
      }
      idProjection = {
        chunk_n:        chunkForProbe.samples.length,
        cohort_n:       cohortSamples.length,
        matched:        matchedCount,
        unmatched:      chunkForProbe.samples.length - matchedCount,
        match_rate:     chunkForProbe.samples.length > 0
                          ? matchedCount / chunkForProbe.samples.length : 0,
        sample_map:     sampleMap,
      };
    }
  } catch (_) { /* never block the report on a forensic probe */ }

  // One-line verdict so the user knows WHY it's grey, when it is.
  // 2026-05-26: branch on the actual projection rate before blaming
  // sample-id mismatch. With 100% projection but all-NaN values the
  // failure mode is "server returned -1 for every cell in this range"
  // or "no markers in this bp range" — NOT id mismatch. Misdiagnosing
  // it sent users hunting in the wrong layer of the chain.
  const nDosNaN = trackedRows.filter(r => !Number.isFinite(r.dosage)).length;
  const nHetNaN = trackedRows.filter(r => !Number.isFinite(r.het)).length;
  const projRate = idProjection ? idProjection.match_rate : null;
  const projOk = projRate != null && projRate >= 0.99;
  let diagnosis;
  if (!state._linesPanelGetCachedChunk) {
    diagnosis = 'getCachedChunk not installed — installDosageChunkFetcher never ran (no dosage_chunks layer?).';
  } else if (lruKeys.length === 0) {
    diagnosis = 'No chunks cached yet — the first fetch is in flight or failed. Watch the network tab for /dosage/chunk.';
  } else if (trackedRows.length === 0) {
    diagnosis = 'No tracked samples — nothing to colour. Lasso or click PCA points to track them first.';
  } else if (nDosNaN === trackedRows.length && nHetNaN === trackedRows.length) {
    // All NaN — but the cause depends on the projection rate.
    if (projRate != null && projRate < 0.5) {
      diagnosis = `All tracked samples NaN AND chunk projection is ${(projRate * 100).toFixed(0)}% — sample-id mismatch between chunk.samples and data.samples. Check chunk ID example vs cohort entry example in the [dosage_chunks] sample-id match: console line.`;
    } else if (projOk) {
      diagnosis = `All tracked samples NaN BUT chunk projection is ${(projRate * 100).toFixed(0)}% — IDs are matching. Either (a) no markers in this bp range (server returned a chunk whose markers fall outside [startBp, endBp]), or (b) every dosage cell is -1 (NA) for this region. Check the [dosage_chunks] computeHetRateForRange produced all-NaN warn in console for the marker count + non-NA stats.`;
    } else {
      diagnosis = 'All tracked samples NaN for both dosage AND het. Projection rate unknown — check the [dosage_chunks] sample-id match: console line for the breakdown.';
    }
  } else if (nDosNaN === trackedRows.length) {
    diagnosis = 'Dosage NaN for all tracked — chunk loaded but no markers in this bp range, or all dosage values were -1 / NaN.';
  } else if (nDosNaN > 0) {
    diagnosis = `${trackedRows.length - nDosNaN}/${trackedRows.length} tracked samples have a dosage value — the others are NaN (chunk markers may not cover every sample).`;
  } else {
    diagnosis = 'All tracked samples have dosage + het values — the PCA scatter should be coloured. If it isn\'t, check state.colorMode / state._pcaModePsVals.mode parity.';
  }

  return {
    range: { startBp, endBp, startW, endW, chrom: d.chrom || null },
    lruKeys,
    trackedRows,
    idProjection,
    diagnosis,
  };
}

// =====================================================================
// 2026-05-19 — lazy chunk fetcher (closes the dosage-coloring loop)
//
// The synchronous design above was inherited from the monolith: callers
// (`computeDosageMeanForRange`, `computeHetRateForRange`) take
// `opts.getCachedChunk(startBp, endBp)` and return NaN if no chunk is
// available. Nothing in the ported atlas populated that cache, so the
// per-sample lines panel's "color: dosage" / "color: het" modes always
// painted everything grey even though `dosage_chunks` was marked
// present (the synthetic-bridge layer attaches a TEMPLATE url; the
// actual fetch never happened until this fetcher was installed).
//
// `installDosageChunkFetcher(state, opts)` attaches a callback at
// `state._linesPanelGetCachedChunk(startBp, endBp)` that:
//   - looks up the requested range in an LRU on state.__dosageChunkLru
//   - if hit, returns the cached chunk synchronously
//   - if miss, fires an async fetch against the templated URL in
//     state.data.dosage_chunks.chunks[0].url and returns null. The
//     fetch resolves into the LRU and invokes `opts.onLoad()` so the
//     lines panel can repaint with the freshly cached values.
//
// One in-flight request per range; LRU bounded to 12 chunks.
// =====================================================================

const _DOSAGE_LRU_SIZE = 12;

function _ensureChunkLru(state) {
  if (!state.__dosageChunkLru) state.__dosageChunkLru = new Map();
  return state.__dosageChunkLru;
}

function _chunkKey(chrom, startBp, endBp) {
  return `${chrom}:${startBp | 0}-${endBp | 0}`;
}

function _templateUrl(template, chrom, startBp, endBp, cap) {
  return template
    .replace('__CHROM__', encodeURIComponent(chrom))
    .replace('__START__', String(startBp | 0))
    .replace('__END__',   String(endBp | 0))
    .replace('__CAP__',   String(cap | 0));
}

export function installDosageChunkFetcher(state, opts) {
  if (!state || !state.data) return;
  const dc = state.data.dosage_chunks;
  if (!dc || !Array.isArray(dc.chunks) || dc.chunks.length === 0) return;
  const template = dc.chunks[0].url || dc._endpoint || null;
  if (!template || template.indexOf('__START__') < 0) return;
  const cap = (dc.cap_default | 0) || 1000;
  const onLoad = (opts && typeof opts.onLoad === 'function') ? opts.onLoad : () => {};
  if (!state.__dosageInflight) state.__dosageInflight = new Map();
  const inflight = state.__dosageInflight;

  state._linesPanelGetCachedChunk = (startBp, endBp) => {
    const chrom = state.data && state.data.chrom;
    if (!chrom) return null;
    if (!Number.isFinite(startBp) || !Number.isFinite(endBp)) return null;
    const lru = _ensureChunkLru(state);
    const key = _chunkKey(chrom, startBp, endBp);
    if (lru.has(key)) return lru.get(key);
    // 2026-05-20: covering-chunk fallback. Before this, the LRU was
    // strict exact-key match — a chunk fetched at (1.0M, 1.5M) couldn't
    // satisfy a request for (1.1M, 1.2M), even though the bigger chunk
    // contains every marker the caller would filter to. Result: every
    // size-mismatched caller (PCA single-window color, L3 chips with
    // L2 ranges that happened to differ from the lines panel's visible
    // Mb range) refired a new fetch instead of reusing what was already
    // cached, and every visit showed grey points/`?` chips until the
    // second fetch landed. With the fallback, computeHetRateForRange /
    // computeDosageMeanForRange filter markers by their own startBp/
    // endBp predicate, so a wider-chunk return is functionally identical
    // to the exact-fit chunk would have been.
    // O(_DOSAGE_LRU_SIZE) — bounded at 12, negligible.
    for (const [k, chunk] of lru) {
      if (!chunk || typeof chunk !== 'object') continue;
      // Key shape: 'chrom:start-end'. Parse + verify same chrom.
      const sep = k.indexOf(':');
      if (sep < 0) continue;
      if (k.slice(0, sep) !== chrom) continue;
      const dash = k.indexOf('-', sep + 1);
      if (dash < 0) continue;
      const kStart = +k.slice(sep + 1, dash);
      const kEnd   = +k.slice(dash + 1);
      if (kStart <= startBp && kEnd >= endBp) {
        // Cached chunk's bp span fully covers the requested range.
        return chunk;
      }
    }
    if (inflight.has(key)) return null;
    const url = _templateUrl(template, chrom, startBp, endBp, cap);
    const pr = fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(chunk => {
        if (!chunk || typeof chunk !== 'object') return;
        // 2026-05-26: one-shot chunk-shape validation. Fires on the
        // FIRST chunk that lands per session, regardless of __dosageDbg.
        // Surfaces structural problems (no markers array, no dosage
        // matrix, markers don't have pos_bp, etc.) the moment a chunk
        // arrives — much earlier than the downstream all-NaN warns
        // and points directly at "what's wrong with the server response".
        if (!state.__chunkShapeValidated) {
          state.__chunkShapeValidated = true;
          const issues = [];
          if (!Array.isArray(chunk.markers)) {
            issues.push('chunk.markers is not an array (got ' + typeof chunk.markers + ')');
          } else if (chunk.markers.length === 0) {
            issues.push('chunk.markers is empty');
          } else {
            const m0 = chunk.markers[0];
            if (typeof m0 !== 'object' || m0 == null) {
              issues.push('chunk.markers[0] is not an object (got ' + typeof m0 + ')');
            } else if (!('pos_bp' in m0)) {
              const keys = Object.keys(m0);
              issues.push('chunk.markers[0] has no pos_bp field (has: ' + keys.join(', ') + ')');
            }
          }
          if (!Array.isArray(chunk.dosage)) {
            issues.push('chunk.dosage is not an array (got ' + typeof chunk.dosage + ')');
          } else if (chunk.dosage.length === 0) {
            issues.push('chunk.dosage is empty');
          } else {
            const row0 = chunk.dosage[0];
            if (!Array.isArray(row0) && !ArrayBuffer.isView(row0)) {
              issues.push('chunk.dosage[0] is not an array/TypedArray (got ' + typeof row0 + ')');
            }
          }
          if (!Array.isArray(chunk.samples)) {
            issues.push('chunk.samples is not an array (got ' + typeof chunk.samples + ')');
          }
          if (issues.length > 0) {
            console.warn('[dosage_chunks] first-chunk shape validation FAILED:',
              issues.join(' · '),
              '· chunk keys:', Object.keys(chunk).join(', '));
          } else if (typeof window !== 'undefined' && window.__dosageDbg === true) {
            console.log('[dosage_chunks] first-chunk shape OK:',
              `${chunk.markers.length} markers · ${chunk.samples.length} samples · ${chunk.dosage.length} dosage rows`,
              `· marker[0]:`, chunk.markers[0]);
          }
        }
        lru.set(key, chunk);
        while (lru.size > _DOSAGE_LRU_SIZE) {
          const firstKey = lru.keys().next().value;
          if (!firstKey) break;
          lru.delete(firstKey);
        }
        // 2026-05-20: one-time landing breadcrumb so the user can tell
        // the fetch loop is healthy when colors stay grey. Opt-in via
        // window.__dosageDbg = true; otherwise prints once per LRU
        // lifetime so there's some evidence chunks are arriving.
        if (typeof window !== 'undefined' && window.__dosageDbg === true) {
          console.log('[dosage_chunks] chunk landed:',
            `${chunk.markers ? chunk.markers.length : 0} markers ·`,
            `${chunk.samples ? chunk.samples.length : 0} samples ·`,
            `bp ${chunk.start_bp}–${chunk.end_bp}`);
        }
        // The per-sample lines panel caches its computed mean/het by
        // (mode, startW-endW) — invalidate so the next paint recomputes
        // against the freshly cached chunk instead of the stale NaN.
        try { invalidateDosageMeanCache(state); } catch (_) {}
        try { invalidateHetRateCache(state); }    catch (_) {}
        try { onLoad(); } catch (_) {}
      })
      .catch((e) => {
        console.warn('Dosage chunk fetch failed:', url, e);
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pr);
    return null;
  };
}
