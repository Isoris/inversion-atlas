// analysis/scrubber_main_validator.js
// =====================================================================
// Entry shim. Splits into:
//
//   ./scrubber_main_validator/compute.js        pure JSON-in / JSON-out
//   ./scrubber_main_validator/adapter_atlas.js  resolves schema +
//                                                bridges to atlas
//                                                runtime
//   ./scrubber_main_validator/schema_in.json
//   ./scrubber_main_validator/schema_out.json
//   ./scrubber_main_validator/example_input.json
//   ./scrubber_main_validator/example_output.json
//
// Importers can either:
//   - import { compute } from './scrubber_main_validator/compute.js'
//     to validate a JSON payload against a caller-supplied schema
//     (recommended for tests + CLI), OR
//   - import { gateLoad, buildInput, saveOutput, resolveSchema }
//     from './scrubber_main_validator/adapter_atlas.js' for the
//     atlas-runtime load-path hook (resolves the registry schema
//     and optionally throws on error).
// =====================================================================

import { compute } from './scrubber_main_validator/compute.js';
import {
  buildInput,
  saveOutput,
  resolveSchema,
  gateLoad,
} from './scrubber_main_validator/adapter_atlas.js';

/**
 * Legacy registry-callable entry: accepts either a schema_in payload
 * (→ compute()) or a request+ctx pair (→ gateLoad).
 */
export function validateScrubberMain(arg1, arg2) {
  if (arg1 && typeof arg1 === 'object' && ('payload' in arg1) && ('schema' in arg1)) {
    return compute(arg1);
  }
  return gateLoad(arg1 && arg1.payload, arg2 || {});
}

export { compute, buildInput, saveOutput, resolveSchema, gateLoad };
