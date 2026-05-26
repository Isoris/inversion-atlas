// atlases/inversion/analysis/mendelian.js
// =====================================================================
// Shim — re-exports the real implementation from popstats-atlas.
//
// Why: the canonical mendelian.js lives in popstats-atlas (where the
// chi-sq math + the orchestrator mendelian_inheritance.js are
// co-located). The inversion-atlas registry entry `mendelian_test`
// declares `analysis: 'analysis/mendelian.js#runMendelianTest'`, and
// atlas-core's registry_core.js#_runAnalysis resolves that relative to
// the declaring atlas's directory (atlases/inversion/analysis/...).
// Rather than duplicating the file or migrating the registry entry to
// popstats (which uses a different layers-registry shape — array of
// objects vs object of objects), this thin shim keeps the inversion
// registry valid and routes execution to the single source of truth.
//
// Path resolution: the assembled workspace places both atlases under
// `atlas-workspace/atlases/{inversion,popstats}/`, so the relative
// import below resolves to the popstats implementation.
//
// If a future refactor unifies the two registry shapes, delete this
// shim and migrate the `mendelian_test` registry entry over to
// popstats-atlas's layers.registry.json.
// =====================================================================

export {
  runMendelianTest,
  MODULE_VERSION,
} from '../../popstats/analysis/mendelian.js';
