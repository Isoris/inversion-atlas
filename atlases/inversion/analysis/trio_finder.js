// atlases/inversion/analysis/trio_finder.js
// =====================================================================
// Shim — re-exports from popstats-atlas. Same shim rationale as the
// other analysis modules in this directory. The trio-finding logic
// itself lives in popstats/analysis/mendelian.js (as findTrios); the
// popstats analysis wrapper at popstats/analysis/trio_finder.js
// resolves cohort_relatedness via the registry + returns a stable
// payload for the `trio_inventory` layer.
// =====================================================================

export {
  findCohortTrios,
  MODULE_VERSION,
} from '../../popstats/analysis/trio_finder.js';
