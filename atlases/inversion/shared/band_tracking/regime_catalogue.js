// shared/band_tracking/regime_catalogue.js
// =====================================================================
// REGIME CATALOGUE SERIALIZER
//
// Turns the in-memory output of runBandingPipeline() into a stable,
// disk-writable JSON catalogue that plugs into the four-registry
// toolkit (sample / interval / evidence / results).
//
// CONCEPTUAL FRAMING (from chat-transcript discussion):
//
//   The catalogue is an EVIDENCE-REGISTRY artefact. It is keyed by:
//     (interval_id, cohort_id, reference_id, pipeline_version, knob_hash)
//   and its content is a deterministic function of those keys plus the
//   per-window labels/PCA inputs used at runtime.
//
//   It is NOT the cross-cohort, interval-level annotation. That object
//   (the "population-scale genomic annotation") is built by aggregating
//   multiple cohort catalogues that share the same reference_id. Cross-
//   cohort aggregation is OUT OF SCOPE for this module.
//
//   In particular, two cohorts on different reference assemblies (e.g.
//   pure C. gariepinus on fClaHyb_Gar_LG vs C. macrocephalus on its own
//   genome) MUST NOT be aggregated by interval_id at this layer. That
//   requires a cross-species inversion map and is a separate page.
//
// PRIMITIVES:
//   - SAMPLE: identified by an opaque string ID. The pipeline's internal
//             integer indices are mapped to these IDs at serialization.
//   - INTERVAL: identified by `f"{chrom_name}:{start_bp}-{end_bp}"`,
//             deterministic from genomic coordinates on the reference.
//
// SERIALIZED FILE LAYOUT:
//   {output_dir}/
//     manifest.json        — cohort/reference/version/timestamp/n_intervals
//     knobs.json           — fully-resolved opts dict (auditable by knob_hash)
//     catalogue.json       — array of regime_observation records
//
// One file-set per (cohort_id, reference_id, knob_hash). Re-running with
// the same inputs produces byte-identical files (modulo the timestamp).
// =====================================================================

// Pure-JS SHA-1 implementation — no Node / Web-Crypto dependency.
// Used here for content-addressing (knob_hash); SHA-1 is a checksum, not
// a security primitive in this codepath. Reference implementation:
// FIPS 180-4 §6.1.2 (block compression) + §5.1.1 (preprocessing). The
// node:crypto / Web Crypto path is intentionally avoided because:
//   - `import { createHash } from 'node:crypto'` is parsed eagerly by the
//     browser ES-module loader and fails CORS at page load, breaking the
//     entire catalogue export module chain (and any page that imports it
//     transitively).
//   - `globalThis.crypto.subtle.digest` is async-only, which would force
//     computeKnobHash → buildCatalogue → caller into async, rippling
//     through haplotype_regimes.js's export-catalogue handler.
// A 12-char hex prefix of SHA-1 gives ~48 bits of entropy — comfortable
// for cache keys at this scale.

function _sha1Hex(str) {
  // UTF-8 encode the input string into bytes.
  const utf8 = (typeof TextEncoder !== 'undefined')
    ? new TextEncoder().encode(str)
    : _utf8EncodeFallback(str);
  return _sha1HexBytes(utf8);
}

function _utf8EncodeFallback(str) {
  // Minimal fallback for environments without TextEncoder (very old,
  // largely hypothetical at this point — modern browsers and Node 12+
  // ship TextEncoder globally).
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0xd800 || c >= 0xe000) {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      // surrogate pair
      i++;
      const c2 = str.charCodeAt(i);
      const cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
  }
  return new Uint8Array(out);
}

function _sha1HexBytes(bytes) {
  const len = bytes.length;
  const bitLen = len * 8;
  // Padding: append 0x80, then 0x00s, then 8-byte big-endian length.
  const paddedLen = ((len + 9 + 63) >>> 6) << 6;
  const m = new Uint8Array(paddedLen);
  m.set(bytes);
  m[len] = 0x80;
  // Length in bits as 64-bit big-endian. JS numbers are 53-bit; for
  // strings well under 2^32 bytes (always true here) the high 32 bits
  // are zero.
  const lenHi = Math.floor(bitLen / 0x100000000) >>> 0;
  const lenLo = (bitLen & 0xffffffff) >>> 0;
  const dv = new DataView(m.buffer);
  dv.setUint32(paddedLen - 8, lenHi);
  dv.setUint32(paddedLen - 4, lenLo);

  let h0 = 0x67452301 | 0;
  let h1 = 0xefcdab89 | 0;
  let h2 = 0x98badcfe | 0;
  let h3 = 0x10325476 | 0;
  let h4 = 0xc3d2e1f0 | 0;
  const w = new Uint32Array(80);

  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20)      { f = (b & c) | ((~b) & d);              k = 0x5a827999 | 0; }
      else if (i < 40) { f = b ^ c ^ d;                          k = 0x6ed9eba1 | 0; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d);        k = 0x8f1bbcdc | 0; }
      else             { f = b ^ c ^ d;                          k = 0xca62c1d6 | 0; }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
      e = d; d = c; c = ((b << 30) | (b >>> 2)) | 0; b = a; a = t;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }

  const toHex = (n) => (n >>> 0).toString(16).padStart(8, '0');
  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4);
}

// ---------------------------------------------------------------------
// Schema version — bump when the catalogue.json shape changes in a
// breaking way. Consumers should reject mismatched schema versions.
// ---------------------------------------------------------------------

export const CATALOGUE_SCHEMA_VERSION = '1.0.0';

// ---------------------------------------------------------------------
// stableJson — JSON.stringify with sorted keys. Required for
// reproducible knob_hash: opts dicts produced by Object.assign carry
// insertion-order keys, which would otherwise make the hash depend on
// argument order.
// ---------------------------------------------------------------------

function stableJson(obj) {
  return JSON.stringify(obj, function replacer(_, value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sorted = {};
      for (const k of Object.keys(value).sort()) sorted[k] = value[k];
      return sorted;
    }
    return value;
  });
}

// ---------------------------------------------------------------------
// computeKnobHash — SHA1 of the resolved opts dict. SHA1 is used here
// as a content-addressing checksum, not for cryptographic security.
// 12 hex chars is plenty of collision resistance for cache keys.
// ---------------------------------------------------------------------

export function computeKnobHash(opts) {
  const canonical = stableJson(opts || {});
  return _sha1Hex(canonical).slice(0, 12);
}

// ---------------------------------------------------------------------
// intervalId — deterministic string from genomic coordinates. Format:
//   "{chrom_name}:{start_bp}-{end_bp}"
// where bp coordinates are 1-based, inclusive on both ends (BED-style
// would be 0-based half-open; we choose 1-based-closed because that's
// what Quentin's existing reports use).
//
// The chromosome name is the user-facing label ("LG28"), not the
// internal integer index. Reference-assembly-agnostic at this layer
// (the full key includes reference_id at the manifest level).
// ---------------------------------------------------------------------

export function intervalId(chromName, startBp, endBp) {
  if (typeof chromName !== 'string' || chromName.length === 0) {
    throw new Error('intervalId: chromName must be a non-empty string');
  }
  if (!Number.isFinite(startBp) || !Number.isFinite(endBp) ||
      startBp < 1 || endBp < startBp) {
    throw new Error(
      `intervalId: invalid bp coords (chrom=${chromName} ` +
      `start=${startBp} end=${endBp})`);
  }
  return `${chromName}:${startBp}-${endBp}`;
}

// ---------------------------------------------------------------------
// resolveSampleSet — turn a Set<int> of internal sample indices into a
// sorted array of opaque string sample IDs. Throws if any index is
// out-of-range for the provided sample_ids array.
// ---------------------------------------------------------------------

function resolveSampleSet(intSet, sample_ids) {
  if (!intSet) return [];
  const out = [];
  for (const i of intSet) {
    if (i < 0 || i >= sample_ids.length) {
      throw new Error(
        `resolveSampleSet: sample index ${i} out of range ` +
        `[0, ${sample_ids.length})`);
    }
    out.push(sample_ids[i]);
  }
  out.sort();   // stable order; opaque-string sort
  return out;
}

// ---------------------------------------------------------------------
// buildLocusRecord — one regime_observation per Stage 3 locus.
//
// Carries:
//   - identity (interval_id, locus_index, seed_id)
//   - genomic coordinates (chrom_name, s_bp, e_bp)
//   - window-space coordinates (s_window, e_window) for cross-reference
//   - K (number of raw bands at this locus)
//   - per_band: array of K records, one per raw band, each containing
//       band_id, n_samples, sample_ids[]
//   - chain QC (n_unreliable_skipped, min_internal_jaccard)
//   - upstream Stage 2 metadata (verdict, linkage_group)
//   - Stage 4 results (consensus + voteRecords) if present
//
// Note: per_band_samples are stored as resolved sample_ids[], NOT as
// integer indices. This makes the catalogue joinable to the sample
// registry without requiring a cohort-level index lookup at every read.
// ---------------------------------------------------------------------

function buildLocusRecord(args) {
  const { locus, locus_index, sample_ids, chromName, windowToBp,
          stage4_per_target } = args;

  const chrom_name = chromName(locus.chromosome_idx);
  const s_bp = windowToBp(locus.chromosome_idx, locus.s_window);
  const e_bp = windowToBp(locus.chromosome_idx, locus.e_window);
  if (!Number.isFinite(s_bp) || !Number.isFinite(e_bp) || e_bp < s_bp) {
    throw new Error(
      `buildLocusRecord: invalid bp range for chr_idx=${locus.chromosome_idx} ` +
      `windows=[${locus.s_window},${locus.e_window}] -> bp=[${s_bp},${e_bp}]`);
  }

  // per_band_samples is a Set<int>[] in memory — map to opaque-string arrays
  const per_band = [];
  for (let b = 0; b < locus.K; b++) {
    const sample_set = locus.per_band_samples[b];
    const ids = resolveSampleSet(sample_set, sample_ids);
    per_band.push({
      band_id:    b,
      n_samples:  ids.length,
      // Flag bands that fell below the configured majority size — the
      // pipeline's per_band_size already reflects post-aggregation count
      first_size: locus.per_band_first_size
                    ? locus.per_band_first_size[b] : null,
      majority_size: locus.per_band_size ? locus.per_band_size[b] : null,
      sample_ids: ids,
    });
  }

  const record = {
    locus_index,
    seed_id:                 locus.seed_id,
    chrom_name,
    chrom_idx:               locus.chromosome_idx,
    s_bp, e_bp,
    span_bp:                 e_bp - s_bp + 1,
    interval_id:             intervalId(chrom_name, s_bp, e_bp),
    s_window:                locus.s_window,
    e_window:                locus.e_window,
    n_windows:               locus.e_window - locus.s_window + 1,
    K:                       locus.K,
    per_band,
    n_samples_dropped:       locus.n_samples_dropped || 0,
    band_set_aggregation:    locus.band_set_aggregation,
    chain_qc: {
      n_unreliable_skipped: locus.n_unreliable_skipped || 0,
      min_internal_jaccard: locus.min_internal_jaccard,
    },
    stage2: {
      verdict:       locus.stage2_verdict,
      linkage_group: locus.stage2_linkage_group,
    },
  };

  // Attach Stage 4 results if available. We MATCH BY seed_id, since the
  // breadth-voting layer uses target_locus_id which corresponds to the
  // locus index in the stage3.loci array — verify this is the case in
  // the host. Here we accept either keying convention via a lookup map.
  if (stage4_per_target) {
    const T = stage4_per_target.get(locus_index);
    if (T) {
      record.stage4 = {
        target_locus_id: T.target_locus_id,
        n_voters:        T.n_voters,
        consensus:       _serializeConsensus(T.consensus),
        vote_pattern_class_counts: _summarizeVotePatternClasses(T.voteRecords),
        // Full vote records are large (one per voter); include opaque
        // summary by default. Set include_full_votes:true to emit raw.
      };
      if (args.include_full_votes && T.voteRecords) {
        record.stage4.vote_records = T.voteRecords.map(v => _serializeVote(v, sample_ids));
      }
    }
  }
  return record;
}

function _serializeConsensus(consensus) {
  if (!consensus) return null;
  return {
    consensus_class:    consensus.consensus_class,
    reasoning:          consensus.reasoning || [],
    ambiguous_band_ids: consensus.ambiguous_band_ids || null,
    // partition_consensus.js attaches more fields (top picks, scores,
    // per-band records) — pass through everything except the heavy
    // per-vote arrays which can be reconstructed from voteRecords.
    top_partitions: consensus.top_partitions ? consensus.top_partitions.map(p => ({
      blocks:            p.blocks,
      score:             p.score,
      total_pair_weight: p.total_pair_weight,
    })) : null,
    per_band: consensus.per_band ? consensus.per_band.map(b => ({
      band:                    b.band,
      hidden_regime_residual:  b.hidden_regime_residual,
      conflict_score:          b.conflict_score,
    })) : null,
  };
}

function _summarizeVotePatternClasses(voteRecords) {
  const counts = {};
  if (!voteRecords) return counts;
  for (const v of voteRecords) {
    counts[v.pattern_class] = (counts[v.pattern_class] || 0) + 1;
  }
  return counts;
}

function _serializeVote(v, sample_ids) {
  // Vote records carry source_w (window) and source_k (band index at
  // source). They DO NOT carry sample IDs — those would be reconstructable
  // from the source locus's per_band_samples. Keep votes in window-index
  // space for now; cross-reference via source_w.
  return {
    source_w:           v.source_w,
    source_k:           v.source_k,
    n_source:           v.n_source,
    target_locus_id:    v.target_locus_id,
    target_w:           v.target_w,
    visited_bands:      Array.from(v.visited_bands || []),
    excluded_bands:     Array.from(v.excluded_bands || []),
    pattern_class:      v.pattern_class,
    // purity_vector is a Float64Array — convert to plain array for JSON
    purity_vector:      v.purity_vector ? Array.from(v.purity_vector) : null,
    daughter_stability: v.daughter_stability != null
                          ? Number(v.daughter_stability) : null,
    stability_upgraded: !!v.stability_upgraded,
    static_class:       v.static_class || v.pattern_class,
  };
}

// ---------------------------------------------------------------------
// buildCatalogue — the main entry point.
//
// Inputs:
//   bandingResult: the object returned by runBandingPipeline()
//   args:
//     cohort_id          opaque string, e.g. "226_gariepinus_hatchery_v1"
//     reference_id       opaque string, e.g. "fClaHyb_Gar_LG"
//     pipeline_version   semver string, e.g. "3.4.0"
//     sample_ids         array<string> of length ctx.n_samples (mapping
//                          internal index → opaque ID)
//     chromName          (chromosome_idx:int) => string ("LG28")
//     windowToBp         (chromosome_idx:int, window_idx:int) => bp:int
//     resolved_opts      the FULL opts dict passed to runBandingPipeline,
//                          AFTER Object.assign with defaults — used for
//                          the knob_hash. Caller is responsible for
//                          passing the resolved version.
//     include_full_votes optional boolean (default false) — emit raw
//                          vote records per locus. Inflates file size
//                          significantly; use for debugging.
//
// Returns:
//   { manifest, knobs, catalogue }
//   Caller writes these to disk as separate JSON files.
// ---------------------------------------------------------------------

export function buildCatalogue(bandingResult, args) {
  if (!bandingResult || !bandingResult.stage3) {
    throw new Error('buildCatalogue: bandingResult must include stage3');
  }
  const required = ['cohort_id', 'reference_id', 'pipeline_version',
                    'sample_ids', 'chromName', 'windowToBp', 'resolved_opts'];
  for (const k of required) {
    if (args[k] == null) {
      throw new Error(`buildCatalogue: args.${k} is required`);
    }
  }
  if (!Array.isArray(args.sample_ids)) {
    throw new Error('buildCatalogue: args.sample_ids must be an array');
  }
  if (typeof args.chromName !== 'function' ||
      typeof args.windowToBp !== 'function') {
    throw new Error(
      'buildCatalogue: chromName and windowToBp must be functions');
  }

  // Build a lookup from locus_index → stage4 per_target record, since
  // breadth_voting emits target_locus_id which we treat as locus_index.
  // Verify the keying matches your runStage4 caller; otherwise pass
  // stage4_target_id_to_index map explicitly.
  let stage4_per_target = null;
  if (bandingResult.stage4 && bandingResult.stage4.per_target) {
    stage4_per_target = new Map();
    for (const T of bandingResult.stage4.per_target) {
      stage4_per_target.set(T.target_locus_id, T);
    }
  }

  // 2026-05-27: optional regime_summary_bundle (output of
  // shared/mgl_regime_consistency.buildRegimeTables) embedded into
  // each record so downstream consumers (manuscript_bundle, exporters)
  // don't have to re-run the stats compute. Bundle rows are matched
  // to records by stage3 emission index (pre-sort).
  const regimeBundle = args.regime_summary_bundle || null;
  const candById = (regimeBundle && Array.isArray(regimeBundle.candidate_regime_summary))
    ? regimeBundle.candidate_regime_summary : [];
  const samplesByCand = new Map();
  if (regimeBundle && Array.isArray(regimeBundle.sample_regime_calls)) {
    for (const r of regimeBundle.sample_regime_calls) {
      const key = r.candidate_id;
      if (!samplesByCand.has(key)) samplesByCand.set(key, []);
      samplesByCand.get(key).push(r);
    }
  }
  const windowsByCand = new Map();
  if (regimeBundle && Array.isArray(regimeBundle.window_regime_support)) {
    for (const r of regimeBundle.window_regime_support) {
      const key = r.candidate_id;
      if (!windowsByCand.has(key)) windowsByCand.set(key, []);
      windowsByCand.get(key).push(r);
    }
  }
  const qcByCand = new Map();
  if (regimeBundle && Array.isArray(regimeBundle.regime_qc_summary)) {
    for (const r of regimeBundle.regime_qc_summary) qcByCand.set(r.candidate_id, r);
  }

  const records = [];
  for (let i = 0; i < bandingResult.stage3.loci.length; i++) {
    const locus = bandingResult.stage3.loci[i];
    const rec = buildLocusRecord({
      locus, locus_index: i,
      sample_ids: args.sample_ids,
      chromName: args.chromName,
      windowToBp: args.windowToBp,
      stage4_per_target,
      include_full_votes: !!args.include_full_votes,
    });
    // Attach the matching regime-summary row (by stage3 index = locus.seed_id
    // when available, else by index position into candidate_regime_summary).
    if (candById.length > 0) {
      const cand = candById[i] || candById.find(r => r && r.candidate_id === locus.seed_id);
      if (cand) {
        rec.regime_summary = cand;
        const key = cand.candidate_id;
        if (samplesByCand.has(key)) rec.regime_sample_calls      = samplesByCand.get(key);
        if (windowsByCand.has(key)) rec.regime_window_support    = windowsByCand.get(key);
        if (qcByCand.has(key))      rec.regime_qc                = qcByCand.get(key);
      }
    }
    records.push(rec);
  }

  // Sort records by (chrom_idx, s_bp) for deterministic output. Avoids
  // the catalogue's byte content depending on stage3 emission order
  // (which itself is deterministic, but cohort-comparison diffs are
  // easier with a stable canonical order).
  records.sort((a, b) =>
    (a.chrom_idx - b.chrom_idx) || (a.s_bp - b.s_bp));

  // Reassign locus_index AFTER sort so it reflects the catalogue order
  // rather than the stage3 emission order. Old (stage3) index is kept
  // as `stage3_locus_index` for cross-reference back to in-memory results.
  for (let i = 0; i < records.length; i++) {
    records[i].stage3_locus_index = records[i].locus_index;
    records[i].locus_index = i;
  }

  const knob_hash = computeKnobHash(args.resolved_opts);

  const manifest = {
    schema_version:   CATALOGUE_SCHEMA_VERSION,
    cohort_id:        args.cohort_id,
    reference_id:     args.reference_id,
    pipeline_version: args.pipeline_version,
    knob_hash,
    n_samples:        args.sample_ids.length,
    n_intervals:      records.length,
    has_stage4:       !!bandingResult.stage4,
    has_regime_summary: !!regimeBundle,
    include_full_votes: !!args.include_full_votes,
    generated_at_utc: new Date().toISOString(),
    summary:          bandingResult.summary,
  };

  return {
    manifest,
    knobs: args.resolved_opts,
    catalogue: records,
  };
}

// ---------------------------------------------------------------------
// writeCatalogueToDir — Node-only convenience writer. The browser-side
// host should serialize the three objects and offer downloads instead.
// ---------------------------------------------------------------------

export async function writeCatalogueToDir(built, outputDir, fsModule) {
  // fsModule is the host's fs; in Node tests we'll pass node:fs/promises.
  // Browser hosts can use a different writer that triggers downloads.
  const { writeFile, mkdir } = fsModule;
  await mkdir(outputDir, { recursive: true });
  await writeFile(`${outputDir}/manifest.json`,
                  JSON.stringify(built.manifest, null, 2));
  await writeFile(`${outputDir}/knobs.json`,
                  JSON.stringify(built.knobs, null, 2));
  // catalogue.json: pretty-printed for human review. Tests check the
  // raw object; large-cohort runs may want to switch to compact form.
  await writeFile(`${outputDir}/catalogue.json`,
                  JSON.stringify(built.catalogue, null, 2));
  return outputDir;
}

// ---------------------------------------------------------------------
// Console-debug
// ---------------------------------------------------------------------
if (typeof window !== 'undefined') {
  window._buildCatalogue            = buildCatalogue;
  window._computeKnobHash           = computeKnobHash;
  window._intervalId                = intervalId;
  window._CATALOGUE_SCHEMA_VERSION  = CATALOGUE_SCHEMA_VERSION;
}
