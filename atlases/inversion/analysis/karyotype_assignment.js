// analysis/karyotype_assignment.js
// =====================================================================
// Entry shim used by the legacy registry-resolver path. The actual
// implementation is split into:
//
//   ./karyotype_assignment/compute.js        (pure JSON-in / JSON-out)
//   ./karyotype_assignment/adapter_atlas.js  (registry / atlasState
//                                             bridge)
//   ./karyotype_assignment/schema_in.json    (input schema)
//   ./karyotype_assignment/schema_out.json   (output schema)
//   ./karyotype_assignment/example_input.json
//   ./karyotype_assignment/example_output.json
//
// Importers can either:
//   - import { compute } from './karyotype_assignment/compute.js'
//     for direct JSON-in/JSON-out calls (recommended for tests + CLI
//     + future Python wrappers), OR
//   - import { runKaryotypeAssignment, buildInput, saveOutput }
//     from './karyotype_assignment/adapter_atlas.js' for the
//     atlas-runtime path (resolves layers + commits results).
//
// This shim re-exports the registry-callable `assignKaryotypes`
// signature that the legacy `registries/data/layers.registry.json`
// declared at `analysis="analysis/karyotype_assignment.js#assignKaryotypes"`.
// =====================================================================

import { compute } from './karyotype_assignment/compute.js';
import {
  buildInput,
  saveOutput,
  runKaryotypeAssignment,
} from './karyotype_assignment/adapter_atlas.js';

/**
 * Legacy registry-callable entry point. Accepts either:
 *   - a schema_in.json-conforming JSON  → calls compute() directly, OR
 *   - a request + ctx pair               → delegates to the adapter.
 *
 * @param {Object} arg1
 * @param {Object} [arg2]   ctx (atlasState / aplr) when arg1 is a request
 * @returns {Promise<Object>|Object}
 */
export function assignKaryotypes(arg1, arg2) {
  if (arg1 && arg1.candidate && (arg1.candidate.labels || arg1.candidate.K)) {
    // Looks like a schema_in payload — pure compute.
    return compute(arg1);
  }
  // Otherwise treat as a registry request.
  return runKaryotypeAssignment(arg1, arg2);
}

export { compute, buildInput, saveOutput, runKaryotypeAssignment };
