// atlases/cross-species/tests/test_atlas_mount.js
//
// Smokes for the cross-species atlas scaffold. Run with:
//
//   node atlases/cross-species/tests/test_atlas_mount.js
//
// Covers:
//   - manifest.json parses + declares 3 pages
//   - 5 registries parse + are internally consistent
//   - layers reference workflows that exist
//   - workflows reference layers that exist (produces + consumes)
//   - workflow scripts referenced exist on disk
//   - 3 page JS modules parse + export mount / unmount / refresh
//   - all imported BP_ATLAS scripts exist on disk
//
// No external deps. Node ≥ 18.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ATLAS_ROOT = path.dirname(path.dirname(__filename));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else      { fail++; console.log('  ✗', name, detail ? '— ' + detail : ''); }
}
function group(label) { console.log('\n--- ' + label + ' ---'); }

// ---------------------------------------------------------------------------
async function readJson(rel) {
  const txt = await fs.readFile(path.join(ATLAS_ROOT, rel), 'utf8');
  return JSON.parse(txt);
}
async function exists(rel) {
  try { await fs.access(path.join(ATLAS_ROOT, rel)); return true; }
  catch (_) { return false; }
}

// ---------------------------------------------------------------------------
group('manifest');
const manifest = await readJson('manifest.json');
check('atlas_id is cross-species', manifest.atlas_id === 'cross-species');
check('reference_id is fClaHyb_Gar_LG', manifest.reference_id === 'fClaHyb_Gar_LG');
check('cohorts includes f1_hybrid_cga_cma',
      Array.isArray(manifest.cohorts) && manifest.cohorts.includes('f1_hybrid_cga_cma'));
check('manifest declares 3 pages', Array.isArray(manifest.pages) && manifest.pages.length === 3);
for (const p of manifest.pages || []) {
  check(`page '${p.id}' fragment exists`,
        await exists(p.fragment.replace(/^atlases\/cross-species\//, '')),
        p.fragment);
  check(`page '${p.id}' module exists`,
        await exists(p.module.replace(/^atlases\/cross-species\//, '')),
        p.module);
}

// ---------------------------------------------------------------------------
group('registries parse');
const layers     = await readJson('registries/data/layers.registry.json');
const workflows  = await readJson('registries/data/workflows.registry.json');
const pages      = await readJson('registries/data/pages.registry.json');
const ops        = await readJson('registries/data/operations.registry.json');
const files      = await readJson('registries/data/files.registry.json');
const slots      = await readJson('registries/data/slots.registry.json');
check('layers.registry has 15 layers',     Array.isArray(layers.layers)    && layers.layers.length === 15);
check('workflows.registry has 2 workflows', Array.isArray(workflows.workflows) && workflows.workflows.length === 2);
check('pages.registry has 3 pages',        Array.isArray(pages.pages)      && pages.pages.length === 3);
check('operations.registry parses',        Array.isArray(ops.operations));
check('files.registry parses',             Array.isArray(files.files));
check('slots.registry has 1 slot',         Array.isArray(slots.slots)      && slots.slots.length === 1);

// ---------------------------------------------------------------------------
group('layer ↔ workflow cross-references');
const layerIds    = new Set(layers.layers.map(l => l.layer_id));
const workflowIds = new Set(workflows.workflows.map(w => w.workflow_id));
for (const layer of layers.layers) {
  if (!layer.produced_by) continue;
  check(`layer '${layer.layer_id}' producer '${layer.produced_by}' is a known workflow`,
        workflowIds.has(layer.produced_by),
        layer.produced_by);
}
for (const wf of workflows.workflows) {
  for (const stage of wf.stages) {
    for (const prod of (stage.produces || [])) {
      check(`workflow '${wf.workflow_id}' stage '${stage.stage_id}' produces layer '${prod}' which exists`,
            layerIds.has(prod), prod);
    }
    for (const cons of (stage.consumes || [])) {
      // Consumed layers may be from another atlas or another workflow's
      // produce. Skip the cross-atlas case here; just check intra-atlas.
      if (!cons.includes('.')) {
        check(`workflow '${wf.workflow_id}' stage '${stage.stage_id}' consumes layer '${cons}' which exists`,
              layerIds.has(cons), cons);
      }
    }
  }
}

// ---------------------------------------------------------------------------
group('workflow runner scripts exist on disk');
for (const wf of workflows.workflows) {
  for (const runner of wf.runners) {
    check(`workflow '${wf.workflow_id}' runner '${runner.runner_id}' script exists`,
          await exists(runner.script), runner.script);
  }
  for (const stage of wf.stages) {
    check(`workflow '${wf.workflow_id}' stage '${stage.stage_id}' script exists`,
          await exists(stage.script), stage.script);
  }
}

// ---------------------------------------------------------------------------
group('imported BP_ATLAS scripts exist');
const expectedBpAtlasScripts = [
  'engines/producers/bp_atlas/scripts/STEP_BP1_pairwise_wfmash.sh',
  'engines/producers/bp_atlas/scripts/STEP_BP2_call_breakpoints.py',
  'engines/producers/bp_atlas/scripts/STEP_BP3_cluster_zones.py',
  'engines/producers/bp_atlas/scripts/STEP_BP3c_reciprocity.py',
  'engines/producers/bp_atlas/scripts/STEP_BP4_overlap_population.py',
  'engines/producers/bp_atlas/scripts/STEP_BP5_prep_atlas_data.py',
  'engines/producers/bp_atlas/scripts/STEP_BP6_joint_classify.py',
  'engines/producers/bp_atlas/runners/run_bp_atlas_LAPTOP.sh',
  'engines/producers/bp_atlas/runners/SLURM_run_bp_atlas_PARALLEL.sh',
  'engines/producers/bp_atlas/runners/run_fold_into_clusters_LAPTOP.sh',
  'engines/producers/bp_atlas/config/00_bpatlas_config.sh',
  'engines/producers/cs/STEP_CS01_extract_breakpoints.py',
  'engines/producers/gene_order/wide_orthologs_to_breakpoints.py',
  'engines/producers/gene_order/cluster_breakpoints.py',
  'engines/producers/gene_order/csbp_json_to_breakpoints.py',
  'engines/producers/inversion_join/scripts/RUN_JOIN.sh',
  'engines/figures/bp_atlas/STEP_BP5_atlas_figures.R',
  'engines/figures/bp_atlas/bp5_ribbon_lib.R',
  'data/manifests/haplotype_manifest_CROSSSPECIES.tsv',
  'data/manifests/haplotype_manifest_5hap.tsv',
];
for (const rel of expectedBpAtlasScripts) {
  check(`exists: ${rel}`, await exists(rel));
}

// ---------------------------------------------------------------------------
group('docs imported');
const expectedDocs = [
  'docs/HANDOFF_COMPLETE.md',
  'docs/CHANGES_LAPTOP_FIXES.md',
  'docs/CS_vs_BPATLAS_RELATIONSHIP.md',
  'docs/MASTER_BUNDLE_README.md',
  'README.md',
];
for (const rel of expectedDocs) {
  check(`exists: ${rel}`, await exists(rel));
}

// ---------------------------------------------------------------------------
group('page JS modules parse + export mount');
for (const p of manifest.pages) {
  const moduleRel = p.module.replace(/^atlases\/cross-species\//, '');
  try {
    const mod = await import(path.join(ATLAS_ROOT, moduleRel));
    check(`page '${p.id}' exports mount`,    typeof mod.mount    === 'function');
    check(`page '${p.id}' exports unmount`,  typeof mod.unmount  === 'function');
    check(`page '${p.id}' exports refresh`,  typeof mod.refresh  === 'function');
    // Headless mount tolerance: pass minimal args and verify no throw.
    let threw = false;
    try { await mod.mount(null, { shared: {} }, null); }
    catch (_) { threw = true; }
    check(`page '${p.id}' mount(null,...) does not throw`, !threw);
  } catch (e) {
    fail++;
    console.log('  ✗', `page '${p.id}' module failed to import — ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
group('cohort tag on every layer');
for (const layer of layers.layers) {
  check(`layer '${layer.layer_id}' has cohort_id`,
        layer.cohort_id === 'f1_hybrid_cga_cma',
        layer.cohort_id || 'missing');
}

// ---------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
