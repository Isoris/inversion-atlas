// atlases/inversion/analysis/karyotype_assignment.js
// =====================================================================
// Shim — re-exports from popstats-atlas. Same shim rationale as
// inversion/analysis/mendelian.js: the inversion-atlas registry entry
// `candidate_karyotype_per_sample` declares
//   analysis: 'analysis/karyotype_assignment.js#assignKaryotypes'
// and atlas-core resolves that relative to the declaring atlas's
// directory. Implementation lives in popstats (co-located with
// mendelian.js + mendelian_inheritance.js); this file keeps the
// inversion registry path valid without duplication.
// =====================================================================

export {
  assignKaryotypes,
  MODULE_VERSION,
} from '../../popstats/analysis/karyotype_assignment.js';
