// shared/regime_annotation/index.js
// =====================================================================
// Public API for the regime-annotation layer
// (specs_todo/SPEC_regime_annotation_v34.md, Stage 5.5).
//
// Annotation is the "explain why" layer that sits on top of the
// detection stack (Layers 1-5 in band_tracking/). It NEVER changes
// the detection output — it adds interpretation tags per regime.
//
// Currently shipped:
//   Layer 1 — Positional (chrom location vs centromere / telomere /
//             arm scale)
//   Layer 2 — Structure  (regime M / band count / sharpness / nesting)
//
// Pending (need real cohort data to validate the math):
//   Layer 2b — Biological-mechanism classification (skeleton in spec)
//   Layer 3  — POD-aware annotation (3-level evidence: variant / load /
//              fitness)
//   Layer 4  — Underdominance-aware annotation
// =====================================================================

export {
  REGIME_POSITIONAL_LABELS,
  REGIME_POSITIONAL_DEFAULTS,
  annotateRegimePosition,
  annotateRegimePositions,
} from './positional.js';

export {
  REGIME_STRUCTURE_LABELS,
  REGIME_STRUCTURE_DEFAULTS,
  annotateRegimeStructure,
  annotateRegimeStructures,
} from './structure.js';
