// analysis/window_chain_to_candidates.js
// =====================================================================
// Entry shim. Splits into:
//
//   ./window_chain_to_candidates/compute.js        pure JSON-in / JSON-out
//   ./window_chain_to_candidates/adapter_atlas.js  registry + atlasState bridge
//   ./window_chain_to_candidates/schema_in.json
//   ./window_chain_to_candidates/schema_out.json
//   ./window_chain_to_candidates/example_input.json
//   ./window_chain_to_candidates/example_output.json
//
// Two parallel chain branches inside compute():
//
//   1. HET-CHAIN BRANCH         — for K=3-ish windows with a HET band.
//                                 Reuses shared/band_tracking/het.js.
//
//   2. HOM-SEPARATION BRANCH    — for K=2 windows (or K=3 with no HET
//                                 band) — i.e. fixed-different
//                                 homozygous inversions. Uses Cramérs V
//                                 on the L3 contingency vs anchor.
//
// Overlapping chains from the two branches are deduped per
// `params.dedupe_prefer`; when both branches independently fire on
// the same region the chain is tagged 'mixed' (richer evidence).
// =====================================================================

import { compute } from './window_chain_to_candidates/compute.js';
import {
  buildInput,
  saveOutput,
  runWindowChainToCandidates,
} from './window_chain_to_candidates/adapter_atlas.js';

/**
 * Registry-callable entry. Accepts either a schema_in payload (pure
 * compute) or a request+ctx pair (atlas-runtime path).
 *
 * @returns {Object|Promise<Object>}
 */
export function chainWindowsToCandidates(arg1, arg2) {
  if (arg1 && Array.isArray(arg1.windows)) return compute(arg1);
  return runWindowChainToCandidates(arg1, arg2);
}

export { compute, buildInput, saveOutput, runWindowChainToCandidates };
