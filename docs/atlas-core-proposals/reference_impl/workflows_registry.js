// docs/atlas-core-proposals/reference_impl/workflows_registry.js
//
// Reference implementation of the workflows registry described in
// SPEC_workflows_v1.md. Designed to drop into atlas-core/core/ as-is.
//
// No external dependencies. Pure JS, ES modules. Node ≥ 18.
//
// Public API (re-exported below):
//   loadWorkflowsRegistry(atlasRoot)               → registry object
//   validateWorkflowsRegistry(registry,
//                              layersRegistry,
//                              cohortsRegistry)    → array of error strings
//   getWorkflow(registry, workflow_id)             → workflow or null
//   listWorkflows(registry)                        → array of workflow summaries
//   getStatusForWorkflow(atlasRoot, wf)            → status.json contents or null
//   isWorkflowOutputStale(atlasRoot, wf, status)   → boolean
//
// Internal helpers (not re-exported) at the bottom.
//
// The reader is `fs.promises`-based. In a browser-side atlas-core this gets
// swapped for a fetch-based reader; the validation + lookup logic is
// transport-agnostic.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const MAJOR_VERSION = 1;
const SCHEMA_FILE   = 'workflows.schema.json';

const VALID_RUNNER_IDS  = ['laptop', 'slurm', 'cloud', 'local_test', 'manual'];
const SLUG_RE_ATLAS     = /^[a-z][a-z0-9_-]{1,31}$/;
const SLUG_RE_WORKFLOW  = /^[a-z][a-z0-9_]{1,63}$/;
const SLUG_RE_STAGE     = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const SLUG_RE_COHORT    = /^[a-z][a-z0-9_]{1,63}$/;

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Load an atlas's workflows.registry.json from disk.
 *
 * @param {string} atlasRoot  Absolute path to the atlas root directory
 *                            (the dir containing manifest.json + registries/).
 * @returns {Promise<object>} Parsed registry, or { atlas_id: null, workflows: [] }
 *                            if the file is absent.
 */
export async function loadWorkflowsRegistry(atlasRoot) {
  const p = path.join(atlasRoot, 'registries', 'data', 'workflows.registry.json');
  let raw;
  try { raw = await fs.readFile(p, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return { atlas_id: null, version: '1.0', workflows: [] };
    throw e;
  }
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

/**
 * Validate a workflows registry against the SPEC + cross-validate against
 * the atlas's layers registry + the global cohorts registry.
 *
 * @returns {string[]} Array of validation errors. Empty = valid.
 */
export function validateWorkflowsRegistry(registry, layersRegistry, cohortsRegistry) {
  const errors = [];
  if (!registry || typeof registry !== 'object') {
    errors.push('workflows registry is not an object');
    return errors;
  }
  const { atlas_id, version, workflows } = registry;
  if (atlas_id != null && !SLUG_RE_ATLAS.test(atlas_id)) {
    errors.push(`atlas_id '${atlas_id}' is not a valid slug`);
  }
  if (!version || typeof version !== 'string') {
    errors.push('version is required (semver string)');
  }
  if (!Array.isArray(workflows)) {
    errors.push('workflows must be an array');
    return errors;
  }
  const workflowIds = new Set();
  const layerIds = new Set(
    (layersRegistry && Array.isArray(layersRegistry.layers))
      ? layersRegistry.layers.map(l => l.layer_id)
      : []
  );
  const cohortIds = new Set(
    (cohortsRegistry && Array.isArray(cohortsRegistry.cohorts))
      ? cohortsRegistry.cohorts.map(c => c.cohort_id)
      : []
  );

  for (const [wfIdx, wf] of workflows.entries()) {
    const wfPath = `workflows[${wfIdx}]`;
    if (!wf || typeof wf !== 'object') { errors.push(`${wfPath} is not an object`); continue; }
    const id = wf.workflow_id;
    if (!id || !SLUG_RE_WORKFLOW.test(id)) {
      errors.push(`${wfPath}.workflow_id '${id}' is not a valid slug`);
    } else if (workflowIds.has(id)) {
      errors.push(`${wfPath}.workflow_id '${id}' is duplicated`);
    }
    workflowIds.add(id);
    if (!wf.label) errors.push(`${wfPath}.label is required`);
    if (!wf.version) errors.push(`${wfPath}.version is required`);
    if (!wf.outputs_root) errors.push(`${wfPath}.outputs_root is required`);
    if (!wf.cohort_id) {
      errors.push(`${wfPath}.cohort_id is required`);
    } else if (cohortsRegistry && !cohortIds.has(wf.cohort_id)) {
      errors.push(`${wfPath}.cohort_id '${wf.cohort_id}' is not in cohorts.registry.json`);
    } else if (wf.cohort_id && !SLUG_RE_COHORT.test(wf.cohort_id)) {
      errors.push(`${wfPath}.cohort_id '${wf.cohort_id}' is not a valid slug`);
    }

    // Stages
    if (!Array.isArray(wf.stages) || wf.stages.length === 0) {
      errors.push(`${wfPath}.stages must be a non-empty array`);
    } else {
      const stageIds = new Set();
      const produced = new Set();
      const consumed = new Set();
      for (const [sIdx, st] of wf.stages.entries()) {
        const sPath = `${wfPath}.stages[${sIdx}]`;
        if (!st || typeof st !== 'object') { errors.push(`${sPath} is not an object`); continue; }
        if (!st.stage_id || !SLUG_RE_STAGE.test(st.stage_id)) {
          errors.push(`${sPath}.stage_id '${st.stage_id}' is not a valid slug`);
        } else if (stageIds.has(st.stage_id)) {
          errors.push(`${sPath}.stage_id '${st.stage_id}' is duplicated in this workflow`);
        }
        stageIds.add(st.stage_id);
        if (!st.script) errors.push(`${sPath}.script is required`);
        if (!Array.isArray(st.produces)) errors.push(`${sPath}.produces must be an array`);
        else for (const layerId of st.produces) {
          produced.add(layerId);
          if (layersRegistry && !layerIds.has(layerId)) {
            errors.push(`${sPath}.produces references layer '${layerId}' not in layers.registry.json`);
          }
        }
        if (st.consumes != null && !Array.isArray(st.consumes)) {
          errors.push(`${sPath}.consumes must be an array`);
        }
        if (Array.isArray(st.consumes)) for (const layerId of st.consumes) {
          consumed.add(layerId);
        }
      }
      // DAG check: no stage consumes a layer that's produced later.
      // (Topological order is assumed; cycle detection is the producer order.)
      const seenProduced = new Set();
      for (const st of wf.stages) {
        for (const layerId of (st.consumes || [])) {
          if (produced.has(layerId) && !seenProduced.has(layerId)) {
            errors.push(`${wfPath}.stages[${st.stage_id}] consumes '${layerId}' before it's produced (DAG order violated)`);
          }
        }
        for (const layerId of (st.produces || [])) seenProduced.add(layerId);
      }
    }

    // Runners
    if (!Array.isArray(wf.runners) || wf.runners.length === 0) {
      errors.push(`${wfPath}.runners must be a non-empty array`);
    } else for (const [rIdx, r] of wf.runners.entries()) {
      const rPath = `${wfPath}.runners[${rIdx}]`;
      if (!r || typeof r !== 'object') { errors.push(`${rPath} is not an object`); continue; }
      if (!VALID_RUNNER_IDS.includes(r.runner_id)) {
        errors.push(`${rPath}.runner_id '${r.runner_id}' is not in [${VALID_RUNNER_IDS.join(',')}]`);
      }
      if (!r.script) errors.push(`${rPath}.script is required`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export function getWorkflow(registry, workflowId) {
  if (!registry || !Array.isArray(registry.workflows)) return null;
  return registry.workflows.find(w => w.workflow_id === workflowId) || null;
}

export function listWorkflows(registry) {
  if (!registry || !Array.isArray(registry.workflows)) return [];
  return registry.workflows.map(w => ({
    workflow_id: w.workflow_id,
    label:       w.label,
    version:     w.version,
    n_stages:    Array.isArray(w.stages) ? w.stages.length : 0,
    n_runners:   Array.isArray(w.runners) ? w.runners.length : 0,
    cohort_id:   w.cohort_id,
  }));
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Read a workflow's status.json. Returns null if missing.
 */
export async function getStatusForWorkflow(atlasRoot, wf) {
  if (!wf) return null;
  const rel = wf.status_file || path.join(wf.outputs_root, '_status.json');
  const p = path.join(atlasRoot, rel);
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

/**
 * Decide whether a workflow's outputs are stale relative to its current
 * default knob set. Conservative: returns true on any uncertainty.
 *
 * @param {string} atlasRoot
 * @param {object} wf       Workflow entry
 * @param {object|null} status  Result of getStatusForWorkflow, or null
 * @returns {Promise<boolean>}
 */
export async function isWorkflowOutputStale(atlasRoot, wf, status) {
  if (!wf || !status) return true;        // never run = stale by definition
  if (status.stages_failed && status.stages_failed.length > 0) return true;
  if (wf.default_knob_hash && wf.default_knob_hash !== 'auto'
      && status.knob_hash && status.knob_hash !== wf.default_knob_hash) {
    return true;
  }
  // Stages that should have run but aren't in stages_completed
  const expectedStages = Array.isArray(wf.stages) ? wf.stages.map(s => s.stage_id) : [];
  if (Array.isArray(status.stages_completed)) {
    for (const sid of expectedStages) {
      if (!status.stages_completed.includes(sid)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

export const _MAJOR_VERSION = MAJOR_VERSION;
export const _SCHEMA_FILE   = SCHEMA_FILE;
