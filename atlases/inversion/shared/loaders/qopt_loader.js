// shared/loaders/qopt_loader.js
// =====================================================================
// NGSadmix .qopt loader — the first worked example of the
// "activate-schema + extract-schema" pattern (Quentin's chat 39 cont.,
// post-step22 design conversation, 2026-05-07).
//
// What this is
// ------------
// A small adapter that reads NGSadmix's native output (a .qopt file
// of K floats per sample, no header, plus a sidecar samples.txt with
// one sample ID per line) and emits a self-describing JSON artifact
// conforming to ancestry_global_q_v1.schema.json.
//
// Why a loader and not a layer entry directly
// -------------------------------------------
// NGSadmix's on-disk shape carries metadata in conventions:
//   - K is encoded in the directory (.../K6/ngsadmix.qopt)
//   - sample order lives in a sidecar samples.txt
//   - seed lives nowhere (slurm log, if anywhere)
// The loader's job is to translate those conventions into a single
// self-describing JSON that the rest of the system consumes uniformly.
// After the loader, no other code in the project needs to know that
// .qopt is headerless or that samples.txt is a sidecar.
//
// The two-schema pattern
// ----------------------
//   - **Activate-schema**: producers/load_ngsadmix_qopt.activate.json
//     Describes what the loader needs to be invoked: paths and any
//     metadata that can't be inferred (run_id, seed, etc).
//
//   - **Extract-schema**: schemas/ancestry_global_q_v1.schema.json
//     Describes the artifact this loader produces: envelope with
//     schema/produced_by/inputs/samples/Q.
//
// Both schemas live alongside the loader. Filling the activate-schema
// is sufficient to invoke the loader; the loader's output is
// guaranteed to validate against the extract-schema.
//
// Local-only assumption
// ---------------------
// Per Quentin's design directive (post-step22): all I/O is local.
// The loader takes filesystem-style paths and reads via fetch() against
// the dev server which serves the data folder. No HTTP round-trips
// across networks; no IndexedDB caching tier (warm-tier is a no-op
// locally). The artifact lives in hot-tier RAM for the session.
// =====================================================================

import { parseDelimited } from '../../../../core/layer_router.js';

/**
 * Load an NGSadmix .qopt + sidecar samples.txt and return a
 * self-describing ancestry_global_q_v1 artifact.
 *
 * @param {Object} args
 * @param {string} args.qopt_path     Path to the .qopt file (headerless,
 *                                    whitespace-separated).
 * @param {string} args.samples_path  Path to the sidecar samples.txt
 *                                    (one sample_id per line).
 * @param {Object} args.params        Producer params for provenance
 *                                    (e.g. { K, run_id, seed }). At
 *                                    minimum K is required. Other fields
 *                                    are optional but encouraged.
 * @param {Object} [args.fetcher]     Optional fetcher with .text(path)
 *                                    method. Defaults to using global
 *                                    fetch(). Tests inject a mock here.
 *
 * @returns {Promise<Object>} The self-describing artifact.
 */
export async function loadQopt(args) {
  const { qopt_path, samples_path, params, fetcher } = args || {};

  // Validate required inputs (this is what an activate-schema validator
  // would do; doing it inline keeps the loader self-contained).
  if (!qopt_path)     throw new Error('loadQopt: qopt_path is required');
  if (!samples_path)  throw new Error('loadQopt: samples_path is required');
  if (!params)        throw new Error('loadQopt: params is required (at least { K })');
  if (params.K === undefined || params.K === null) {
    throw new Error('loadQopt: params.K is required');
  }
  const K = Number(params.K);
  if (!Number.isInteger(K) || K < 2 || K > 50) {
    throw new Error(`loadQopt: params.K must be an integer in [2, 50] (got ${params.K})`);
  }

  // Read both files. Local-only: a thin fetcher abstraction lets tests
  // inject mocked content without spinning up a real HTTP server.
  const fetchText = (fetcher && fetcher.text)
    ? fetcher.text
    : async (path) => {
        const resp = await fetch(path);
        if (!resp.ok) {
          throw new Error(`loadQopt: GET ${path} → HTTP ${resp.status}`);
        }
        return resp.text();
      };

  const [qoptText, samplesText] = await Promise.all([
    fetchText(qopt_path),
    fetchText(samples_path),
  ]);

  // Parse samples.txt: one sample_id per line, blank/comment lines skipped.
  const samples = samplesText
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('#'));
  if (samples.length === 0) {
    throw new Error(`loadQopt: samples_path '${samples_path}' is empty`);
  }

  // Parse .qopt: headerless, whitespace-separated, one row per sample,
  // K floats per row. parseDelimited returns rows keyed by synthesized
  // 'col_0'..'col_{K-1}'; we re-flatten into a Q array per row.
  const qoptRows = parseDelimited(
    qoptText,
    'whitespace',
    null,
    { hasHeader: false }
  );

  // Cross-check: row count must match sample count.
  if (qoptRows.length !== samples.length) {
    throw new Error(
      `loadQopt: row-count mismatch — .qopt has ${qoptRows.length} rows ` +
      `but samples.txt has ${samples.length} entries ` +
      `(qopt='${qopt_path}', samples='${samples_path}')`
    );
  }

  // Cross-check: every row should have exactly K columns.
  for (let i = 0; i < qoptRows.length; i++) {
    const row = qoptRows[i];
    const cols = Object.keys(row);
    if (cols.length !== K) {
      throw new Error(
        `loadQopt: row ${i} (sample '${samples[i]}') has ${cols.length} ` +
        `columns but params.K = ${K} (qopt='${qopt_path}')`
      );
    }
  }

  // Build the Q matrix in canonical column order (col_0..col_{K-1}).
  // Each Q[i] is an array of K numbers in [0,1] summing to ~1.
  const Q = qoptRows.map((row, i) => {
    const q = new Array(K);
    for (let k = 0; k < K; k++) {
      const v = row[`col_${k}`];
      if (v === null || v === '' || !Number.isFinite(v)) {
        throw new Error(
          `loadQopt: row ${i} (sample '${samples[i]}') has invalid value ` +
          `for cluster ${k}: ${JSON.stringify(v)}`
        );
      }
      q[k] = v;
    }
    return q;
  });

  // Assemble the self-describing artifact.
  const artifact = {
    schema: 'ancestry_global_q_v1',
    produced_by: {
      tool: 'ngsadmix',
      params: { ...params, K },
    },
    inputs: {
      qopt_path,
      samples_path,
    },
    samples,
    Q,
  };

  return artifact;
}

// =====================================================================
// Notes for follow-up rounds
// --------------------------
// 1. **Per-band ancestry** (the conditional case Quentin raised) does
//    NOT use this loader. It calls the popgen_server's ancestry_groupwise_q
//    endpoint with a sample-subset artifact as input. That's a different
//    producer with a different activate-schema, but it emits the SAME
//    extract-schema (ancestry_global_q_v1). The two-schema pattern is
//    what makes them interchangeable downstream.
//
// 2. The artifact's `produced_by.params` is freeform on purpose.
//    Different invocations carry different metadata (run_id, seed,
//    chrom, snp_set, ...). The extract-schema pins the envelope shape
//    (schema/produced_by/inputs/samples/Q) but lets producers stuff
//    whatever provenance they have into produced_by.params.
//
// 3. Numeric validation (Q rows summing to ~1) is intentionally NOT
//    done here. NGSadmix's output sometimes drifts to 0.999 or 1.001
//    due to optimisation tolerance; rejecting those would be wrong.
//    Downstream consumers that need exactly-1 should normalise
//    themselves; this loader is honest about what NGSadmix emitted.
// =====================================================================


// =====================================================================
// Registry adapter
// ----------------
// The registry's `source: analysis` dispatch (registry_core.js
// `_runAnalysis`) calls analysis functions with `(registry, ctx)`
// where `ctx` is the resolve args. Our `loadQopt` takes a flat args
// object including a `fetcher`. This adapter bridges the two: it
// derives qopt_path and samples_path from the layer entry's path
// template (already template-filled by the caller passing K through
// args), supplies the default fetch-based fetcher, and forwards
// to loadQopt.
//
// Layer entry shape (in layers.registry.json):
//
//   "ancestry_global_q": {
//     "tier": "warm",
//     "source": "analysis",
//     "analysis": "shared/loaders/qopt_loader.js#registryAdapter",
//     "schema": "schemas/ancestry_global_q_v1.schema.json",
//     "cache_key": "ancestry_global_q:{K}:{run_id}",
//     "qopt_path_template":    "data/cohort/ancestry/global/K{K}/ngsadmix.qopt",
//     "samples_path_template": "data/cohort/ancestry/global/K{K}/samples.txt"
//   }
//
// Resolve call shape (consumer side):
//
//   const artifact = await registry.resolve('ancestry_global_q', {
//     K: 6,
//     run_id: 'cohort_226_genome_wide_v1',
//     // optional: seed, snp_set, samples_subset, scope, chrom
//   });
//
// The cache_key on the layer entry ensures different (K, run_id)
// combinations cache as distinct artifacts.
// =====================================================================

/**
 * Registry-shaped adapter. Called by atlas-core/core/registry_core.js
 * `_runAnalysis`. Translates the (registry, ctx) calling convention
 * into a flat call to loadQopt.
 *
 * Reads two layer-entry fields off the resolve args (the registry
 * passes through the per-call args from `resolve(key, args)`):
 *   - K        (required) — number of ancestry components
 *   - run_id   (optional but encouraged) — identifier for the run
 *   - any other producer params (seed, snp_set, samples_subset,
 *     scope, chrom) flow through to produced_by.params
 *
 * Path templates are NOT in the args — they're in the layer entry,
 * which is not directly visible from `_runAnalysis`. So the adapter
 * accepts paths via args.qopt_path / args.samples_path (the caller
 * is expected to template-fill them) OR falls back to conventional
 * paths derived from {K} + optional {run_id}.
 *
 * @param {Object} registry  Registry instance (unused here; would be
 *                           used if this adapter needed to resolve
 *                           sub-artifacts).
 * @param {Object} ctx       Per-call args from registry.resolve().
 * @returns {Promise<Object>} ancestry_global_q_v1 artifact.
 */
export async function registryAdapter(registry, ctx) {
  const args = ctx || {};
  if (args.K === undefined || args.K === null) {
    throw new Error("registryAdapter: args.K is required (e.g. registry.resolve('ancestry_global_q', { K: 6, run_id: ... }))");
  }
  const K = args.K;

  // Path resolution. Two modes:
  //   (a) Caller passes explicit qopt_path + samples_path (used by
  //       tests, and by consumers wiring custom layouts).
  //   (b) Default convention from K (and optional run_id):
  //         data/cohort/ancestry/global/K{K}/ngsadmix.qopt
  //         data/cohort/ancestry/global/K{K}/samples.txt
  //       If args.run_id is provided, the run_id slots between
  //       'global' and 'K{K}': data/cohort/ancestry/global/{run_id}/K{K}/...
  const qopt_path    = args.qopt_path    || _defaultQoptPath(K, args.run_id);
  const samples_path = args.samples_path || _defaultSamplesPath(K, args.run_id);

  // Build params dict for provenance — everything the caller passed
  // except path overrides.
  const params = {};
  for (const k of Object.keys(args)) {
    if (k === 'qopt_path' || k === 'samples_path' || k === 'fetcher') continue;
    params[k] = args[k];
  }
  // K is already in params (copied from args); ensure it's present
  // even if the caller passed it weirdly.
  params.K = K;

  return loadQopt({
    qopt_path,
    samples_path,
    params,
    fetcher: args.fetcher,  // tests inject; production passes undefined → uses fetch()
  });
}

function _defaultQoptPath(K, run_id) {
  if (run_id) return `data/cohort/ancestry/global/${run_id}/K${K}/ngsadmix.qopt`;
  return `data/cohort/ancestry/global/K${K}/ngsadmix.qopt`;
}

function _defaultSamplesPath(K, run_id) {
  if (run_id) return `data/cohort/ancestry/global/${run_id}/K${K}/samples.txt`;
  return `data/cohort/ancestry/global/K${K}/samples.txt`;
}
