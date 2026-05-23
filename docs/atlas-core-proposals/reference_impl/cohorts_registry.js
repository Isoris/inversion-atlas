// docs/atlas-core-proposals/reference_impl/cohorts_registry.js
//
// Reference implementation of the global cohorts registry described in
// SPEC_cohorts_v1.md. Designed to drop into atlas-core/core/ as-is.
//
// No external deps. Pure JS, ES modules. Node ≥ 18.
//
// Public API:
//   loadCohortsRegistry(coreRoot)                 → registry object
//   validateCohortsRegistry(registry, atlasesIndex) → array of error strings
//   getCohort(registry, cohort_id)                → cohort or null
//   listCohorts(registry)                         → array of cohort summaries
//   getCohortsForAtlas(registry, atlas_id)        → array of cohorts
//   findHandoff(registry, from, to, layerRef)     → handoff or null
//   listHandoffs(registry)                        → array of handoffs
//
// Cohort discipline is the load-bearing thing. This module is the registry
// half; the enforcement half is cross_atlas_imports.js.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const COHORT_ID_RE = /^[a-z][a-z0-9_]{1,63}$/;
const ATLAS_ID_RE  = /^[a-z][a-z0-9_-]{1,31}$/;
const VALID_HANDOFF_KINDS = ['coordinate_handoff', 'reference_join', 'annotation_only', 'none_yet'];

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Load the global cohorts.registry.json from atlas-core's core/ directory.
 *
 * @param {string} coreRoot  Absolute path to atlas-core's core/ directory.
 * @returns {Promise<object>} Parsed registry.
 */
export async function loadCohortsRegistry(coreRoot) {
  const p = path.join(coreRoot, 'cohorts.registry.json');
  const raw = await fs.readFile(p, 'utf8');
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

/**
 * Validate the cohorts registry against the SPEC + cross-validate
 * atlases[] references against the installed atlases index.
 *
 * @param {object} registry        cohorts.registry.json contents
 * @param {object} atlasesIndex    atlases/_index.json contents
 * @returns {string[]} Validation errors (empty = valid)
 */
export function validateCohortsRegistry(registry, atlasesIndex) {
  const errors = [];
  if (!registry || typeof registry !== 'object') {
    errors.push('cohorts registry is not an object'); return errors;
  }
  if (!registry.version) errors.push('version is required');
  if (!Array.isArray(registry.cohorts) || registry.cohorts.length === 0) {
    errors.push('cohorts must be a non-empty array'); return errors;
  }
  const installedAtlases = new Set(
    (atlasesIndex && Array.isArray(atlasesIndex.atlases)) ? atlasesIndex.atlases : []
  );
  const seenIds = new Set();
  for (const [idx, c] of registry.cohorts.entries()) {
    const p = `cohorts[${idx}]`;
    if (!c || typeof c !== 'object') { errors.push(`${p} is not an object`); continue; }
    if (!c.cohort_id || !COHORT_ID_RE.test(c.cohort_id)) {
      errors.push(`${p}.cohort_id '${c.cohort_id}' is not a valid slug`);
    } else if (seenIds.has(c.cohort_id)) {
      errors.push(`${p}.cohort_id '${c.cohort_id}' is duplicated`);
    }
    seenIds.add(c.cohort_id);
    if (!c.label) errors.push(`${p}.label is required`);
    if (!c.reference_id) errors.push(`${p}.reference_id is required`);
    if (!c.scope) errors.push(`${p}.scope is required`);
    if (!Array.isArray(c.atlases)) {
      errors.push(`${p}.atlases must be an array (may be empty)`);
    } else {
      for (const aid of c.atlases) {
        if (!ATLAS_ID_RE.test(aid)) {
          errors.push(`${p}.atlases includes '${aid}' which is not a valid atlas slug`);
        } else if (atlasesIndex && !installedAtlases.has(aid)) {
          errors.push(`${p}.atlases includes '${aid}' but atlas is not in atlases/_index.json`);
        }
      }
    }
  }
  // Handoffs
  if (registry.cross_reference_handoffs != null) {
    if (!Array.isArray(registry.cross_reference_handoffs)) {
      errors.push('cross_reference_handoffs must be an array');
    } else {
      const seenHandoffIds = new Set();
      const seenTuples = new Set();
      for (const [idx, h] of registry.cross_reference_handoffs.entries()) {
        const p = `cross_reference_handoffs[${idx}]`;
        if (!h || typeof h !== 'object') { errors.push(`${p} is not an object`); continue; }
        if (!h.handoff_id) errors.push(`${p}.handoff_id required`);
        if (seenHandoffIds.has(h.handoff_id)) {
          errors.push(`${p}.handoff_id '${h.handoff_id}' is duplicated`);
        }
        seenHandoffIds.add(h.handoff_id);
        if (!seenIds.has(h.from_cohort)) {
          errors.push(`${p}.from_cohort '${h.from_cohort}' is not a registered cohort`);
        }
        if (!seenIds.has(h.to_cohort)) {
          errors.push(`${p}.to_cohort '${h.to_cohort}' is not a registered cohort`);
        }
        if (!VALID_HANDOFF_KINDS.includes(h.handoff_kind)) {
          errors.push(`${p}.handoff_kind '${h.handoff_kind}' not in [${VALID_HANDOFF_KINDS.join(',')}]`);
        }
        if (!h.rationale || h.rationale.length < 20) {
          errors.push(`${p}.rationale is required (min 20 chars)`);
        }
        if (!h.via_layer_pattern) {
          errors.push(`${p}.via_layer_pattern is required`);
        } else {
          try { new RegExp(h.via_layer_pattern); }
          catch (e) { errors.push(`${p}.via_layer_pattern is not a valid regex: ${e.message}`); }
        }
        const tuple = `${h.from_cohort}|${h.to_cohort}|${h.via_layer_pattern}`;
        if (seenTuples.has(tuple)) {
          errors.push(`${p} duplicates an earlier handoff with the same (from_cohort, to_cohort, via_layer_pattern)`);
        }
        seenTuples.add(tuple);
      }
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export function getCohort(registry, cohortId) {
  if (!registry || !Array.isArray(registry.cohorts)) return null;
  return registry.cohorts.find(c => c.cohort_id === cohortId) || null;
}

export function listCohorts(registry) {
  if (!registry || !Array.isArray(registry.cohorts)) return [];
  return registry.cohorts.map(c => ({
    cohort_id:    c.cohort_id,
    label:        c.label,
    reference_id: c.reference_id,
    n_atlases:    Array.isArray(c.atlases) ? c.atlases.length : 0,
    scope:        c.scope,
  }));
}

export function getCohortsForAtlas(registry, atlasId) {
  if (!registry || !Array.isArray(registry.cohorts)) return [];
  return registry.cohorts.filter(c =>
    Array.isArray(c.atlases) && c.atlases.includes(atlasId));
}

/**
 * Look up a handoff matching (from_cohort, to_cohort, layerRef).
 * Returns the first matching handoff or null.
 *
 * @param {object} registry
 * @param {string} fromCohort
 * @param {string} toCohort
 * @param {string} layerRef   '<atlas_id>.<layer_id>'
 * @returns {object|null}
 */
export function findHandoff(registry, fromCohort, toCohort, layerRef) {
  if (!registry || !Array.isArray(registry.cross_reference_handoffs)) return null;
  for (const h of registry.cross_reference_handoffs) {
    if (h.from_cohort !== fromCohort) continue;
    if (h.to_cohort !== toCohort) continue;
    try {
      const re = new RegExp(h.via_layer_pattern);
      if (re.test(layerRef)) return h;
    } catch (_) { /* invalid regex; validation should have caught it */ }
  }
  return null;
}

export function listHandoffs(registry) {
  if (!registry || !Array.isArray(registry.cross_reference_handoffs)) return [];
  return registry.cross_reference_handoffs.map(h => ({
    handoff_id:        h.handoff_id,
    from_cohort:       h.from_cohort,
    to_cohort:         h.to_cohort,
    handoff_kind:      h.handoff_kind,
    via_layer_pattern: h.via_layer_pattern,
  }));
}
