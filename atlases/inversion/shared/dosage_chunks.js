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

function _aliasesForCohortEntry(s, fallbackIdx) {
  const out = [];
  if (s == null) {
    out.push('S' + fallbackIdx);
    return out;
  }
  if (typeof s === 'string' || typeof s === 'number') {
    out.push(_normId(s));
    return out;
  }
  // Object — pull every plausible identifier field.
  const fields = ['id', 'cga', 'ind', 'sample', 'sample_id',
                  'name', 'label', 'ID', 'IND', 'CGA',
                  'sampleId', 'sampleID', 'individual', 'idx'];
  for (const f of fields) {
    const v = s[f];
    if (v != null && v !== '') out.push(_normId(v));
  }
  // Variants: strip leading "N_" prefix (e.g. "1_CGA001" → "CGA001")
  // and prepend "N_" stripped values so both directions match.
  const variants = [];
  for (const id of out) {
    const m = /^\d+_(.+)$/.exec(id);
    if (m) variants.push(m[1]);
  }
  for (const v of variants) {
    if (!out.includes(v)) out.push(v);
  }
  if (out.length === 0) out.push('S' + fallbackIdx);
  return out;
}

function _buildSampleIdMap(state, chunkSamples) {
  const cohortSamples = (state && state.data && state.data.samples) || [];
  const map = new Map();
  // Pass 1: exact + variant aliases per cohort sample.
  for (let ci = 0; ci < cohortSamples.length; ci++) {
    const aliases = _aliasesForCohortEntry(cohortSamples[ci], ci);
    for (const a of aliases) {
      if (!map.has(a)) map.set(a, ci);
    }
  }
  // Pass 2: canonicalised form as a fallback. Only filled when the
  // canonical key isn't already taken by an exact alias.
  for (let ci = 0; ci < cohortSamples.length; ci++) {
    const aliases = _aliasesForCohortEntry(cohortSamples[ci], ci);
    for (const a of aliases) {
      const c = _normIdCanon(a);
      if (c && !map.has(c)) map.set(c, ci);
    }
  }
  // One-shot diagnostic: when window.__dosageDbg is true OR match-rate is
  // 0% on a non-empty chunk, log enough to diagnose the mismatch.
  if (chunkSamples && chunkSamples.length > 0
      && (typeof window === 'undefined' ? false : window.__dosageDbg === true
          || !state || !state.__dosageMatchRateLogged)) {
    let matched = 0;
    for (const cid of chunkSamples) {
      const key = _normId(cid);
      if (map.has(key) || map.has(_normIdCanon(key))) matched++;
    }
    const rate = matched / chunkSamples.length;
    const shouldLog = (typeof window !== 'undefined' && window.__dosageDbg === true)
                  || (rate === 0 && cohortSamples.length > 0);
    if (shouldLog && typeof console !== 'undefined') {
      const cohortSample = cohortSamples[0];
      const cohortPreview = (typeof cohortSample === 'string' || typeof cohortSample === 'number')
        ? cohortSample
        : JSON.stringify(cohortSample);
      console.warn('[dosage_chunks] sample-id match:',
        `${matched}/${chunkSamples.length} = ${(rate * 100).toFixed(0)}%`,
        '· chunk ID example:', chunkSamples[0],
        '· cohort entry example:', cohortPreview,
        '· cohort aliases for [0]:', _aliasesForCohortEntry(cohortSample, 0));
      if (state) state.__dosageMatchRateLogged = true;
    }
  }
  return map;
}

// Wrapper so chunk.samples lookups go through the canonicalisation
// fallback when the exact-string lookup misses. Both Maps are checked.
function _lookupCohortIdx(map, chunkId) {
  if (chunkId == null) return -1;
  const key = _normId(chunkId);
  if (map.has(key)) return map.get(key);
  const canon = _normIdCanon(key);
  if (map.has(canon)) return map.get(canon);
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

  // Filter markers to bp span
  const inRange = [];
  for (let mi = 0; mi < chunk.markers.length; mi++) {
    const m = chunk.markers[mi];
    if (!m || !Number.isFinite(m.pos_bp)) continue;
    if (m.pos_bp < startBp || m.pos_bp > endBp) continue;
    inRange.push(mi);
  }
  if (inRange.length === 0) {
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
  for (let ci = 0; ci < nChunkS; ci++) {
    const cohortIdx = _lookupCohortIdx(idToCohort, chunk.samples[ci]);
    if (cohortIdx < 0 || cohortIdx >= nS) continue;
    out[cohortIdx] = (nonNaCounts[ci] === 0)
      ? NaN
      : hetCounts[ci] / nonNaCounts[ci];
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

  // Filter markers to bp span
  const inRange = [];
  for (let mi = 0; mi < chunk.markers.length; mi++) {
    const m = chunk.markers[mi];
    if (!m || !Number.isFinite(m.pos_bp)) continue;
    if (m.pos_bp < startBp || m.pos_bp > endBp) continue;
    inRange.push(mi);
  }
  if (inRange.length === 0) {
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
  for (let ci = 0; ci < nChunkS; ci++) {
    const cohortIdx = _lookupCohortIdx(idToCohort, chunk.samples[ci]);
    if (cohortIdx < 0 || cohortIdx >= nS) continue;
    out[cohortIdx] = (nNonNa[ci] === 0)
      ? NaN
      : sumDos[ci] / nNonNa[ci];
  }

  if (cacheKey != null && cache) cache.set(cacheKey, out);
  return out;
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
