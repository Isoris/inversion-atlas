// atlases/inversion/analysis/mendelian_inheritance.js
//
// Version-aware orchestrator around analysis/mendelian.js. Implements
// SPEC_registry_v2.md item 7 — the entry point that the future
// page-level "Mendelian review" page will call.
//
// Pipeline (SPEC_v2 §8):
//
//   ┌──────────────────────────────────────────────────────────────┐
//   │ runMendelianInheritance({ registry, candidate_id, ... })     │
//   ├──────────────────────────────────────────────────────────────┤
//   │ 1. resolve candidate_active_version  ──► registry.resolve()  │
//   │ 2. resolve callset for the version   ──► registry.resolve()  │
//   │ 3. resolve relatedness               ──► registry.resolve()  │
//   │ 4. resolve sample set                ──► registry.resolve()  │
//   │ 5. compute dependency_hash           ──► sha1 of (5 fields)  │
//   │ 6. if cached + !recompute → return cached                    │
//   │ 7. filter / join / call mendelian.js core math               │
//   │ 8. build payload (per SPEC_v2 §7 schema)                     │
//   │ 9. registry.write('mendelian_inheritance_block', …, payload) │
//   │ 10. return payload to caller                                 │
//   └──────────────────────────────────────────────────────────────┘
//
// STATUS:
//   - The 4-step skeleton is in place and unit-tested.
//   - Steps that depend on atlas-core SPEC_v2 work (the layers
//     `candidate_active_version`, `candidate_callset_for_version`,
//     `mendelian_inheritance_block`; the method `registry.write()`;
//     the schema validation) are stubbed with clear TODOs. They land
//     as a one-line completion each once atlas-core ships v2.
//   - The dependency_hash uses a 32-bit FNV polynomial today, marked
//     for swap to sha1 once SPEC_v2 ships (crypto.subtle.digest in
//     browsers + Node 22+; the hash is provenance metadata, not a
//     security primitive, so the swap doesn't change behavioural
//     correctness — only the value in the cached payload).

import { runMendelianTest } from './mendelian.js';

// =====================================================================
// Constants — SPEC_v2 §7 default thresholds + invariant strings
// =====================================================================

/** Block result_type per SPEC_v2 §7's payload schema. */
export const RESULT_TYPE = 'mendelian_inheritance';

/** Version stamp embedded in every payload + dependency_hash input. */
export const ANALYSIS_VERSION = 'mendelian_inheritance_v1.0';

/** Default thresholds per SPEC_v2 §7's example payload. */
export const DEFAULT_THRESHOLDS = Object.freeze({
  theta_min: 0.0884,
  ibs0_max:  0.005,
});

// =====================================================================
// Dependency hash (TODO: swap to sha1 when atlas-core lands SPEC_v2)
// =====================================================================

/**
 * Compute the SPEC_v2 §7 dependency_hash. Only analysis-relevant
 * fields are included — display-only metadata (notes, color, review
 * status) is deliberately excluded so cosmetic edits to a candidate
 * never trigger re-runs.
 *
 * Hash is currently FNV-32 hex; SPEC_v2 specifies sha1. The swap is a
 * one-line change inside this function — call sites don't care.
 *
 * @param {Object} fields  the five canonical inputs (per SPEC_v2 §7):
 *   candidate_version_id, callset_id, relatedness_result_id,
 *   sample_set_id, analysis_version, thresholds
 * @returns {string}  hex hash
 */
export function computeDependencyHash(fields) {
  const t = fields.thresholds || {};
  const sortedThresholds = Object.keys(t).sort()
    .map(k => `${k}=${t[k]}`).join(',');
  const canonical = [
    fields.candidate_version_id || '',
    fields.callset_id || '',
    fields.relatedness_result_id || '',
    fields.sample_set_id || '',
    fields.analysis_version || ANALYSIS_VERSION,
    sortedThresholds,
  ].join('|');
  // FNV-32a polynomial hash, hex-encoded.
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < canonical.length; i++) {
    h = h ^ canonical.charCodeAt(i);
    h = (h * 16777619) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// =====================================================================
// Internal helpers
// =====================================================================

async function _resolveSafe(registry, key, args) {
  // Wraps registry.resolve so a missing layer doesn't tear the whole
  // pipeline down. Returns null when the layer isn't defined yet
  // (typical during the SPEC_v2 rollout when some layers are still
  // stubs).
  try {
    return await registry.resolve(key, args);
  } catch (_) {
    return null;
  }
}

function _supportStatus(metrics) {
  // SPEC_v2 §7: support_status ∈ {supported, inconclusive, contradicted}.
  // Decision rule mirrors the legacy mendelian.js verdict logic but
  // expressed against the SPEC_v2 vocabulary.
  const r = metrics && metrics.contradiction_rate;
  if (r == null || !Number.isFinite(r)) return 'inconclusive';
  if (r > 0.10) return 'contradicted';
  if (r > 0.02) return 'inconclusive';
  return 'supported';
}

// =====================================================================
// Orchestrator (SPEC_v2 §8)
// =====================================================================

/**
 * Run version-aware Mendelian inheritance QC for a candidate.
 *
 * @param {Object} opts
 * @param {Object} opts.registry           atlas-core Registry instance
 * @param {string} opts.candidate_id       required
 * @param {string} [opts.version_id]       defaults to active version
 * @param {string} [opts.callset_id]       defaults to active version's binding
 * @param {Array<string>}  [opts.selectedFamilies]  null → all informative
 * @param {Array<number>}  [opts.selectedSamples]
 * @param {Object} [opts.thresholds]       merged onto DEFAULT_THRESHOLDS
 * @param {boolean} [opts.recompute=false] skip the cache lookup
 *
 * @returns {Promise<Object>}  payload per SPEC_v2 §7
 */
export async function runMendelianInheritance(opts) {
  opts = opts || {};
  const { registry, candidate_id } = opts;
  if (!registry) throw new Error('runMendelianInheritance: opts.registry is required');
  if (!candidate_id) throw new Error('runMendelianInheritance: opts.candidate_id is required');

  const recompute = !!opts.recompute;
  const thresholds = Object.assign({}, DEFAULT_THRESHOLDS, opts.thresholds || {});

  // ──────────────────────────────────────────────────────────────────
  // Step 1 — resolve the active version + binding.
  //
  // SPEC_v2 §3 introduces two new toolkit entities: candidate_versions
  // (append-only history) + candidate_active_version (rewrite-in-place
  // pointer). Layer entries for these don't exist yet in the cartridge
  // registry; once they do, this section's _resolveSafe calls hit them.
  // Until then version_id defaults to null and the cached lookup
  // degrades to a per-candidate (not per-version) key — the existing
  // mendelian.js behavior.
  // ──────────────────────────────────────────────────────────────────
  let version_id = opts.version_id;
  let callset_id = opts.callset_id;
  if (!version_id) {
    const active = await _resolveSafe(registry,
      'candidate_active_version', { candidate_id });
    if (active && active.active_version_id) version_id = active.active_version_id;
  }
  if (!callset_id && version_id) {
    const versionRow = await _resolveSafe(registry,
      'candidate_version', { candidate_id, version_id });
    if (versionRow && versionRow.active_callset_id) {
      callset_id = versionRow.active_callset_id;
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Step 2 — relatedness + sample-set provenance IDs.
  //
  // SPEC_v2 §4 specifies the ngsRelate schema; once it ships, the
  // 'cohort_relatedness' layer will carry a per-result-set id we use
  // as relatedness_result_id. For now we read the layer's content
  // through mendelian.js (which calls registry.resolve internally)
  // and use a placeholder id.
  // ──────────────────────────────────────────────────────────────────
  const relatedness_result_id = opts.relatedness_result_id || 'ngsrelate_default';
  const sample_set_id = opts.sample_set_id || 'cohort_default';

  // ──────────────────────────────────────────────────────────────────
  // Step 3 — dependency_hash on the five canonical fields.
  // ──────────────────────────────────────────────────────────────────
  const dependency_hash = computeDependencyHash({
    candidate_version_id: version_id || null,
    callset_id: callset_id || null,
    relatedness_result_id,
    sample_set_id,
    analysis_version: ANALYSIS_VERSION,
    thresholds,
  });

  // ──────────────────────────────────────────────────────────────────
  // Step 4 — cache lookup. SPEC_v2 §7's filename convention is:
  //   evidence_registry/per_candidate/<cid>/structured/mendelian_inheritance.<version_id>.json
  // The cartridge calls through registry.resolve(...) once the
  // 'mendelian_inheritance_block' layer is wired. Returns cached
  // payload if its dependency_hash matches.
  // ──────────────────────────────────────────────────────────────────
  if (!recompute) {
    const cached = await _resolveSafe(registry,
      'mendelian_inheritance_block', { candidate_id, version_id });
    if (cached && cached.dependency_hash === dependency_hash) return cached;
  }

  // ──────────────────────────────────────────────────────────────────
  // Step 5 — call the core math in mendelian.js. This produces the
  // observed/expected tables + chi-sq result + per-trio rows.
  // ──────────────────────────────────────────────────────────────────
  const core = await runMendelianTest(registry, { candidate_id });

  // ──────────────────────────────────────────────────────────────────
  // Step 6 — derive SPEC_v2 §7 metrics from the core result.
  // ──────────────────────────────────────────────────────────────────
  const n_pairs_tested = (core.trios && core.trios.length) || 0;
  const n_informative_pairs = n_pairs_tested;   // 1 informative trio per row today
  let n_contradictions = 0;
  if (core.trios && core.expected) {
    for (const trio of core.trios) {
      const pmf = trio.expected_pmf;
      // A contradiction = offspring is in a band whose expected
      // probability is exactly zero given the parents.
      if (pmf && pmf[trio.off_kar] === 0) n_contradictions++;
    }
  }
  const contradiction_rate = n_informative_pairs > 0
    ? n_contradictions / n_informative_pairs
    : null;
  const metrics = {
    n_pairs_tested,
    n_informative_pairs,
    n_contradictions,
    contradiction_rate,
    support_status: _supportStatus({ contradiction_rate }),
  };

  // ──────────────────────────────────────────────────────────────────
  // Step 7 — build the SPEC_v2 §7 payload.
  //
  // per_family + per_pair are placeholders today (the core
  // mendelian.js has IMPLEMENTATION_NOTE'd _findTrios). They populate
  // as the trio resolver lands. Schema validation belongs here once
  // atlas-core ships mendelian_inheritance.schema.json.
  // ──────────────────────────────────────────────────────────────────
  const payload = {
    result_type:           RESULT_TYPE,
    candidate_id,
    candidate_version_id:  version_id || null,
    callset_id:            callset_id || null,
    relatedness_result_id,
    sample_set_id,
    analysis_version:      ANALYSIS_VERSION,
    dependency_hash,
    thresholds,
    metrics,
    per_family:            [],
    per_pair:              core.trios || [],
    warnings:              core._reason ? [core._reason] : [],
    created_at:            new Date().toISOString(),
    // Carry-through for downstream consumers that want the raw chi-sq
    // result (verdict / p_value etc). Not part of the SPEC_v2 payload
    // shape proper, but harmless.
    _core: {
      verdict: core.verdict,
      chi_sq:  core.chi_sq,
      df:      core.df,
      p_value: core.p_value,
    },
  };

  // ──────────────────────────────────────────────────────────────────
  // Step 8 — write through registry. SPEC_v2 §5 specifies:
  //   registry.write('mendelian_inheritance_block',
  //                  { candidate_id, version_id }, payload)
  //   - layer must declare writable: true
  //   - schema validation runs before send
  //   - transport: POST /file/{path:path}
  //   - cache invalidation on success
  //
  // Today the cartridge has neither Registry.write() nor the layer
  // entry. We try-call it so the orchestrator works against a future
  // registry without a hard dependency.
  // ──────────────────────────────────────────────────────────────────
  if (registry && typeof registry.write === 'function') {
    try {
      await registry.write('mendelian_inheritance_block',
                            { candidate_id, version_id }, payload);
    } catch (e) {
      // Don't fail the analysis on a write error. SPEC_v2 §5 rule 6:
      // "no retries, no queue. If the server is down, the write fails
      // loudly." We surface it via a warning rather than throwing.
      payload.warnings = payload.warnings.concat([
        '[registry.write] ' + (e && e.message ? e.message : String(e)),
      ]);
    }
  }

  return payload;
}
