// docs/atlas-core-proposals/tests/workflows_registry.test.js
//
// Smokes for reference_impl/workflows_registry.js. Run with:
//
//   node docs/atlas-core-proposals/tests/workflows_registry.test.js
//
// No external deps; uses ad-hoc fixtures.

import {
  loadWorkflowsRegistry,
  validateWorkflowsRegistry,
  getWorkflow,
  listWorkflows,
  isWorkflowOutputStale,
} from '../reference_impl/workflows_registry.js';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else      { fail++; console.log('  ✗', name, detail ? '— ' + detail : ''); }
}
function group(label) { console.log('\n--- ' + label + ' ---'); }

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const goodLayersRegistry = {
  layers: [
    { layer_id: 'bp_atlas_passA_paf_v1' },
    { layer_id: 'bp_atlas_passB_paf_v1' },
    { layer_id: 'bp_atlas_events_v1' },
    { layer_id: 'bp_atlas_zones_v1' },
    { layer_id: 'bp_atlas_reciprocity_v1' },
    { layer_id: 'haplotype_manifest_v1' },
  ]
};

const goodCohortsRegistry = {
  cohorts: [{ cohort_id: 'f1_hybrid_cga_cma' }, { cohort_id: 'cgar_hatchery_226' }],
  cross_reference_handoffs: [],
};

const goodRegistry = {
  atlas_id: 'cross-species',
  version: '1.0',
  workflows: [
    {
      workflow_id: 'bp_atlas_pipeline',
      label: 'BP_ATLAS pipeline',
      version: '1.0',
      outputs_root: 'data/breakpoints/results_bpatlas/',
      cohort_id: 'f1_hybrid_cga_cma',
      stages: [
        { stage_id: 'BP1', script: 'engines/producers/bp_atlas/scripts/STEP_BP1.sh',
          produces: ['bp_atlas_passA_paf_v1', 'bp_atlas_passB_paf_v1'],
          consumes: ['haplotype_manifest_v1'] },
        { stage_id: 'BP2', script: 'engines/producers/bp_atlas/scripts/STEP_BP2.py',
          produces: ['bp_atlas_events_v1'],
          consumes: ['bp_atlas_passA_paf_v1'] },
        { stage_id: 'BP3', script: 'engines/producers/bp_atlas/scripts/STEP_BP3.py',
          produces: ['bp_atlas_zones_v1'],
          consumes: ['bp_atlas_events_v1', 'bp_atlas_passB_paf_v1'] },
        { stage_id: 'BP3c', script: 'engines/producers/bp_atlas/scripts/STEP_BP3c.py',
          produces: ['bp_atlas_reciprocity_v1'],
          consumes: ['bp_atlas_zones_v1'] },
      ],
      runners: [
        { runner_id: 'laptop', script: 'engines/producers/bp_atlas/runners/run_LAPTOP.sh' },
        { runner_id: 'slurm',  script: 'engines/producers/bp_atlas/runners/SLURM.sh' },
      ],
    }
  ]
};

// ---------------------------------------------------------------------------
// Validate — valid registry produces no errors
// ---------------------------------------------------------------------------

group('valid registry');
{
  const errs = validateWorkflowsRegistry(goodRegistry, goodLayersRegistry, goodCohortsRegistry);
  check('valid registry produces 0 errors', errs.length === 0, JSON.stringify(errs));
}

// ---------------------------------------------------------------------------
// Validate — missing required fields
// ---------------------------------------------------------------------------

group('missing required fields');
{
  const bad = JSON.parse(JSON.stringify(goodRegistry));
  delete bad.workflows[0].cohort_id;
  const errs = validateWorkflowsRegistry(bad, goodLayersRegistry, goodCohortsRegistry);
  check('missing cohort_id → error', errs.some(e => /cohort_id/.test(e)),
        errs.join(' / '));
}
{
  const bad = JSON.parse(JSON.stringify(goodRegistry));
  bad.workflows[0].workflow_id = 'BAD-ID-WITH-CAPS';
  const errs = validateWorkflowsRegistry(bad, goodLayersRegistry, goodCohortsRegistry);
  check('invalid workflow_id slug → error', errs.some(e => /workflow_id/.test(e)));
}
{
  const bad = JSON.parse(JSON.stringify(goodRegistry));
  bad.workflows[0].runners = [];
  const errs = validateWorkflowsRegistry(bad, goodLayersRegistry, goodCohortsRegistry);
  check('empty runners → error', errs.some(e => /runners/.test(e)));
}
{
  const bad = JSON.parse(JSON.stringify(goodRegistry));
  bad.workflows[0].runners[0].runner_id = 'unknown_runner';
  const errs = validateWorkflowsRegistry(bad, goodLayersRegistry, goodCohortsRegistry);
  check('invalid runner_id → error', errs.some(e => /runner_id/.test(e)));
}

// ---------------------------------------------------------------------------
// Validate — cross-validation against layers + cohorts
// ---------------------------------------------------------------------------

group('cross-validation');
{
  const bad = JSON.parse(JSON.stringify(goodRegistry));
  bad.workflows[0].stages[0].produces.push('nonexistent_layer_v1');
  const errs = validateWorkflowsRegistry(bad, goodLayersRegistry, goodCohortsRegistry);
  check('produces unknown layer → error', errs.some(e => /nonexistent_layer_v1/.test(e)));
}
{
  const bad = JSON.parse(JSON.stringify(goodRegistry));
  bad.workflows[0].cohort_id = 'nonexistent_cohort';
  const errs = validateWorkflowsRegistry(bad, goodLayersRegistry, goodCohortsRegistry);
  check('cohort_id not in cohorts.registry → error',
        errs.some(e => /nonexistent_cohort/.test(e)));
}

// ---------------------------------------------------------------------------
// DAG check
// ---------------------------------------------------------------------------

group('DAG ordering');
{
  // Reorder so BP2 comes before BP1 — BP2 consumes BP1's output.
  const bad = JSON.parse(JSON.stringify(goodRegistry));
  const [bp1, bp2, bp3, bp3c] = bad.workflows[0].stages;
  bad.workflows[0].stages = [bp2, bp1, bp3, bp3c];
  const errs = validateWorkflowsRegistry(bad, goodLayersRegistry, goodCohortsRegistry);
  check('DAG order violation → error', errs.some(e => /DAG/.test(e)));
}

// ---------------------------------------------------------------------------
// Duplicate workflow_id
// ---------------------------------------------------------------------------

group('duplicates');
{
  const bad = JSON.parse(JSON.stringify(goodRegistry));
  bad.workflows.push(JSON.parse(JSON.stringify(bad.workflows[0])));
  const errs = validateWorkflowsRegistry(bad, goodLayersRegistry, goodCohortsRegistry);
  check('duplicate workflow_id → error', errs.some(e => /duplicated/.test(e)));
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

group('lookup');
{
  const wf = getWorkflow(goodRegistry, 'bp_atlas_pipeline');
  check('getWorkflow returns the workflow', wf && wf.workflow_id === 'bp_atlas_pipeline');
  check('getWorkflow returns null for missing', getWorkflow(goodRegistry, 'nope') === null);
  const list = listWorkflows(goodRegistry);
  check('listWorkflows returns 1 entry', list.length === 1);
  check('list entry has n_stages = 4', list[0].n_stages === 4);
  check('list entry has n_runners = 2', list[0].n_runners === 2);
}

// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

group('staleness');
{
  const wf = goodRegistry.workflows[0];
  // No status → stale.
  (async () => {
    const stale = await isWorkflowOutputStale('/tmp/never', wf, null);
    check('null status → stale', stale === true);
  })();

  // Status with all stages complete + matching knob → not stale.
  (async () => {
    const status = {
      stages_completed: ['BP1', 'BP2', 'BP3', 'BP3c'],
      stages_failed: [],
      knob_hash: 'auto',
    };
    const stale = await isWorkflowOutputStale('/tmp/never', wf, status);
    check('all-stages + auto knob → not stale', stale === false);
  })();

  // Status with one stage failed → stale.
  (async () => {
    const status = {
      stages_completed: ['BP1', 'BP2', 'BP3'],
      stages_failed: ['BP3c'],
      knob_hash: 'auto',
    };
    const stale = await isWorkflowOutputStale('/tmp/never', wf, status);
    check('failed stage → stale', stale === true);
  })();

  // Status missing a stage → stale.
  (async () => {
    const status = {
      stages_completed: ['BP1', 'BP2', 'BP3'],   // BP3c missing
      stages_failed: [],
      knob_hash: 'auto',
    };
    const stale = await isWorkflowOutputStale('/tmp/never', wf, status);
    check('missing stage → stale', stale === true);
  })();
}

// Wait for async checks to flush.
await new Promise(r => setTimeout(r, 50));

console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
