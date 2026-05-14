// analysis/anchor_track_cache.js
// =====================================================================
// Entry shim. Splits into:
//
//   ./anchor_track_cache/compute.js        pure JSON-in / JSON-out
//   ./anchor_track_cache/adapter_atlas.js  bridges to atlasState +
//                                          aplr + exposes
//                                          buildLiveCache for fast
//                                          in-memory queries
//   ./anchor_track_cache/schema_in.json
//   ./anchor_track_cache/schema_out.json
//   ./anchor_track_cache/example_input.json
//   ./anchor_track_cache/example_output.json
//
// Two consumers:
//   1. JSON path (compute / runAnchorTrackCache) — for batch jobs,
//      cross-language harnesses, persistence into the registry.
//   2. Live path (buildLiveCache) — for page22 / window_chain_to_
//      candidates / future genome-scale scans that want hot in-memory
//      getV(anchor_w, w) / getHoff(anchor_w, w) accessors.
// =====================================================================

import { compute } from './anchor_track_cache/compute.js';
import {
  buildInput,
  saveOutput,
  buildLiveCache,
  runAnchorTrackCache,
} from './anchor_track_cache/adapter_atlas.js';

/**
 * Registry-callable entry. Accepts a schema_in payload (→ compute()),
 * a request+ctx pair (→ runAnchorTrackCache), or an atlasState (→
 * buildLiveCache — synchronous live API).
 */
export function anchorTrackCache(arg1, arg2) {
  if (arg1 && Array.isArray(arg1.windows) && Array.isArray(arg1.anchors)) {
    return compute(arg1);
  }
  if (arg1 && (arg1.window_layer_id || (arg2 && arg2.atlasState))) {
    return runAnchorTrackCache(arg1, arg2);
  }
  return buildLiveCache(arg1);
}

export { compute, buildInput, saveOutput, buildLiveCache, runAnchorTrackCache };
