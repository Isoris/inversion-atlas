// docs/atlas-core-proposals/reference_impl/cross_atlas_imports.js
//
// Reference implementation of the cross-atlas-imports resolver described
// in SPEC_cohorts_v1.md §7. Designed to drop into atlas-core/core/ as-is.
//
// The resolver is the read-time gateway that enforces three-cohort discipline
// (or N-cohort, with arbitrary cohorts) across atlas boundaries.
//
// Public API:
//   class CohortMismatchError extends Error
//   class LayerNotFoundError  extends Error
//   class AtlasNotInstalledError extends Error
//   resolveCrossAtlasRead({...})  → Promise<{data, meta}>
//
// Dependencies (injected via opts so this stays unit-testable):
//   - getCohortsForAtlas, findHandoff      from cohorts_registry.js
//   - getWorkflow, getStatusForWorkflow,
//     isWorkflowOutputStale                from workflows_registry.js
//   - layerReader(atlasId, layerRef)       → Promise<{data, cohort_id, produced_by}>
//
// In atlas-core the layerReader is provided by the existing layer_router.js;
// in tests it's a fake.

export class CohortMismatchError extends Error {
  constructor(msg, detail) {
    super(msg);
    this.name = 'CohortMismatchError';
    this.detail = detail || {};
  }
}

export class LayerNotFoundError extends Error {
  constructor(msg, layerRef) {
    super(msg);
    this.name = 'LayerNotFoundError';
    this.layerRef = layerRef;
  }
}

export class AtlasNotInstalledError extends Error {
  constructor(msg, atlasId) {
    super(msg);
    this.name = 'AtlasNotInstalledError';
    this.atlasId = atlasId;
  }
}

/**
 * Resolve a cross-atlas read, enforcing cohort discipline + attaching
 * workflow status metadata.
 *
 * @param {object} args
 * @param {string} args.consumer_atlas_id        e.g. 'inversion'
 * @param {string} args.layer_ref                e.g. 'crossSpecies.bp_atlas_reciprocity_v1'
 *                                                or with tree-path 'crossSpecies.bp_atlas_results_v1.03_breakpoints.reciprocity.reciprocity_table.tsv'
 * @param {string} [args.consumer_tree_path]     optional tree-path suffix (alternative form)
 * @param {boolean} [args.allow_cohort_mismatch] default false (hard-refuse on mismatch)
 * @param {string|null} [args.knob_hash]         caller's expected knob_hash (opt-in staleness check)
 *
 * @param {object} deps
 * @param {object} deps.cohortsRegistry
 * @param {object} deps.installedAtlases         { '<atlas_id>': { layersRegistry, workflowsRegistry, atlasRoot } }
 * @param {Function} deps.layerReader            (atlasId, layerRef, treePath?) → Promise<{ data, cohort_id, produced_by }>
 * @param {Function} deps.getCohortsForAtlas
 * @param {Function} deps.findHandoff
 * @param {Function} deps.getWorkflow
 * @param {Function} deps.getStatusForWorkflow
 * @param {Function} deps.isWorkflowOutputStale
 *
 * @returns {Promise<{ data, meta }>}
 */
export async function resolveCrossAtlasRead(args, deps) {
  const {
    consumer_atlas_id,
    layer_ref,
    consumer_tree_path,
    allow_cohort_mismatch = false,
    knob_hash = null,
  } = args || {};
  if (!consumer_atlas_id) throw new TypeError('consumer_atlas_id required');
  if (!layer_ref)         throw new TypeError('layer_ref required');

  // Parse 'atlas_id.layer_id[.tree.path...]'
  const dotIdx = layer_ref.indexOf('.');
  if (dotIdx < 0) throw new TypeError(`layer_ref '${layer_ref}' must include atlas prefix (e.g. 'crossSpecies.layer_v1')`);
  const producer_atlas_id = layer_ref.slice(0, dotIdx);
  const layer_and_tail = layer_ref.slice(dotIdx + 1);
  // Layer id is the first segment of the tail; the rest is the tree-path
  const treeDot = layer_and_tail.indexOf('.');
  const layer_id   = treeDot < 0 ? layer_and_tail : layer_and_tail.slice(0, treeDot);
  const tree_path  = consumer_tree_path
                   || (treeDot < 0 ? null : layer_and_tail.slice(treeDot + 1));

  // Same atlas? Short-circuit. Cohort enforcement is intra-atlas job.
  if (producer_atlas_id === consumer_atlas_id) {
    const r = await deps.layerReader(producer_atlas_id, layer_id, tree_path);
    return {
      data: r.data,
      meta: {
        producer_atlas_id,
        producer_cohort_id: r.cohort_id || null,
        consumer_cohorts:   [],
        handoff_used:       null,
        same_atlas:         true,
        workflow_status:    'n/a',
      }
    };
  }

  // Cross-atlas: validate atlas exists.
  if (!deps.installedAtlases || !deps.installedAtlases[producer_atlas_id]) {
    throw new AtlasNotInstalledError(
      `consumer atlas '${consumer_atlas_id}' tried to read from atlas '${producer_atlas_id}' which is not installed`,
      producer_atlas_id);
  }

  // Read the layer (this throws LayerNotFoundError if missing).
  let r;
  try {
    r = await deps.layerReader(producer_atlas_id, layer_id, tree_path);
  } catch (e) {
    if (e instanceof LayerNotFoundError) throw e;
    throw new LayerNotFoundError(
      `layer '${layer_ref}' read failed: ${e.message}`,
      layer_ref);
  }
  const producer_cohort_id = r.cohort_id || null;

  // Cohort discipline.
  const consumerCohortObjs = deps.getCohortsForAtlas(deps.cohortsRegistry, consumer_atlas_id);
  const consumer_cohort_ids = consumerCohortObjs.map(c => c.cohort_id);
  let handoff_used = null;
  if (producer_cohort_id && consumer_cohort_ids.includes(producer_cohort_id)) {
    // Same cohort, no handoff needed.
  } else if (producer_cohort_id) {
    // Need a handoff. Try each consumer cohort.
    for (const to_cohort of consumer_cohort_ids) {
      const hf = deps.findHandoff(
        deps.cohortsRegistry,
        producer_cohort_id,
        to_cohort,
        layer_ref);
      if (hf) { handoff_used = hf; break; }
    }
    if (!handoff_used && !allow_cohort_mismatch) {
      throw new CohortMismatchError(
        `page in atlas '${consumer_atlas_id}' tried to read '${layer_ref}' ` +
        `(cohort: ${producer_cohort_id}) from atlas '${producer_atlas_id}' ` +
        `(consumer cohorts: [${consumer_cohort_ids.join(',')}]). No matching ` +
        `cross-reference handoff in cohorts.registry.json.`,
        { consumer_atlas_id, layer_ref, producer_cohort_id, consumer_cohort_ids });
    }
    if (!handoff_used && allow_cohort_mismatch) {
      // Log a banner; let it pass.
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn(
          '[cross_atlas_imports] cohort mismatch allowed for ' + layer_ref +
          ' (producer cohort: ' + producer_cohort_id +
          '; consumer cohorts: [' + consumer_cohort_ids.join(',') + ']). ' +
          'allow_cohort_mismatch=true was set; this read is not gated.');
      }
    }
  }

  // Workflow status. Optional; only computed if produced_by is set on
  // the layer and the producer atlas has a workflows registry.
  let workflow_status = 'n/a';
  if (r.produced_by && deps.installedAtlases[producer_atlas_id].workflowsRegistry) {
    const wf = deps.getWorkflow(
      deps.installedAtlases[producer_atlas_id].workflowsRegistry,
      r.produced_by);
    if (wf) {
      const status = await deps.getStatusForWorkflow(
        deps.installedAtlases[producer_atlas_id].atlasRoot, wf);
      if (!status) {
        workflow_status = 'never_run';
      } else if (Array.isArray(status.stages_failed) && status.stages_failed.length > 0) {
        workflow_status = 'failed';
      } else if (await deps.isWorkflowOutputStale(
                   deps.installedAtlases[producer_atlas_id].atlasRoot, wf, status)) {
        workflow_status = 'stale';
      } else {
        workflow_status = 'ok';
      }
      if (knob_hash && status.knob_hash && knob_hash !== status.knob_hash) {
        workflow_status = 'stale';
      }
    }
  }

  return {
    data: r.data,
    meta: {
      producer_atlas_id,
      producer_cohort_id,
      consumer_cohorts: consumer_cohort_ids,
      handoff_used:    handoff_used ? handoff_used.handoff_id : null,
      same_atlas:      false,
      workflow_status,
    }
  };
}
