// pages/discovery/dosage_cluster_adaptive_k_worker.js
// =====================================================================
// Dedicated web worker for adaptiveKDosageClustering.
//
// Why: the K-means multi-start + bootstrap + silhouette pass takes
// 3–8 s on a 226-sample × 9k-window chromosome. Running it on the main
// thread freezes the entire tab for that duration even though
// dosage_cluster_adaptive_k.js shows a "computing…" hint first. With
// the compute on a worker, the user can keep scrubbing other pages
// while it runs; the final result posts back via message and the
// page state updates without ever blocking the UI thread.
//
// Protocol (page ↔ worker):
//
//   page  →  worker:  { type: 'compute', D, nS, nW, opts }
//                     D is a Float64Array (passed as a transferable
//                     ArrayBuffer; the page surrenders ownership for
//                     the duration of the call)
//
//   worker → page:    { type: 'result', result }                (success)
//                     { type: 'error',  message }               (failure)
//                     { type: 'progress', stage, k? }           (optional)
//
// The worker is an ES module (loaded via `new Worker(url, { type:
// 'module' })`). It imports the same compute helper the main thread
// would call, so behavior is byte-identical.
// =====================================================================

import { adaptiveKDosageClustering } from '../../shared/mgl_dosage_clustering.js';

self.addEventListener('message', (ev) => {
  const msg = ev && ev.data;
  if (!msg || msg.type !== 'compute') return;
  const { D, nS, nW, opts } = msg;
  try {
    // D arrives as an ArrayBuffer (transferred). Re-wrap as the
    // typed array the compute expects.
    const arr = (D instanceof ArrayBuffer) ? new Float64Array(D) : D;
    const result = adaptiveKDosageClustering(arr, nS, nW, opts || {});
    // Result is plain JSON; structuredClone via postMessage is fine.
    self.postMessage({ type: 'result', result });
  } catch (e) {
    self.postMessage({
      type: 'error',
      message: (e && e.message) ? e.message : String(e),
    });
  }
});
