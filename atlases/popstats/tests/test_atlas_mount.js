// atlases/popstats/tests/test_atlas_mount.js
//
// Smokes for the popstats atlas scaffold. Run with:
//
//   node atlases/popstats/tests/test_atlas_mount.js

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

async function readJson(rel) {
  const txt = await fs.readFile(path.join(ATLAS_ROOT, rel), 'utf8');
  return JSON.parse(txt);
}
async function exists(rel) {
  try { await fs.access(path.join(ATLAS_ROOT, rel)); return true; }
  catch (_) { return false; }
}

group('manifest');
const manifest = await readJson('manifest.json');
check('atlas_id is popstats', manifest.atlas_id === 'popstats');
check('cohorts includes cgar_hatchery_226',
      Array.isArray(manifest.cohorts) && manifest.cohorts.includes('cgar_hatchery_226'));
check('manifest declares 3 pages', Array.isArray(manifest.pages) && manifest.pages.length === 3);
for (const p of manifest.pages || []) {
  check(`page '${p.id}' fragment exists`, await exists(p.fragment.replace(/^atlases\/popstats\//, '')), p.fragment);
  check(`page '${p.id}' module exists`,   await exists(p.module.replace(/^atlases\/popstats\//, '')),   p.module);
}

group('registries parse');
const layers     = await readJson('registries/data/layers.registry.json');
const pages      = await readJson('registries/data/pages.registry.json');
const ops        = await readJson('registries/data/operations.registry.json');
const files      = await readJson('registries/data/files.registry.json');
const slots      = await readJson('registries/data/slots.registry.json');
const workflows  = await readJson('registries/data/workflows.registry.json');
check('layers.registry parses',     Array.isArray(layers.layers));
check('pages.registry has 3 pages', Array.isArray(pages.pages) && pages.pages.length === 3);
check('operations.registry parses', Array.isArray(ops.operations));
check('files.registry parses',      Array.isArray(files.files));
check('slots.registry parses',      Array.isArray(slots.slots));
check('workflows.registry parses',  Array.isArray(workflows.workflows));

group('moved shared modules + analysis exist');
const expectedFiles = [
  'shared/band_tracking/regime_mendelian.js',
  'shared/band_tracking/regime_dyad_mendelian.js',
  'shared/band_tracking/regime_pedigree.js',
  'shared/band_tracking/regime_linkage.js',
  'shared/cohort_diversity.js',
  'shared/cohort_export.js',
  'shared/relatedness.js',
  'shared/inheritance_cache_key.js',
  'shared/inheritance_compute.js',
  'shared/inheritance_gather.js',
  'shared/inheritance_groups.js',
  'shared/mendelian_family_test.js',
  'shared/mendelian_para_vs_peri.js',
  'shared/mendelian_segregation.js',
  'shared/q_ancestry.js',
  'shared/sample_spread.js',
  'shared/ancestry_alignment.js',
  'shared/ancestry_bricks.js',
  'shared/ancestry_confound.js',
  'shared/lineage_clustering.js',
  'shared/karyotype_lineage.js',
  'shared/karyotype_rows.js',
  'analysis/mendelian.js',
  'analysis/mendelian_inheritance.js',
  'specs_todo/SPEC_msmc_per_founder_background.md',
];
for (const rel of expectedFiles) check(`exists: ${rel}`, await exists(rel));

group('page JS modules parse + export mount');
for (const p of manifest.pages) {
  const moduleRel = p.module.replace(/^atlases\/popstats\//, '');
  try {
    const mod = await import(path.join(ATLAS_ROOT, moduleRel));
    check(`page '${p.id}' exports mount`, typeof mod.mount === 'function');
    let threw = false;
    try { await mod.mount(null, { shared: {}, inversion: {} }, null); } catch (_) { threw = true; }
    check(`page '${p.id}' mount(null,...) does not throw`, !threw);
  } catch (e) {
    fail++; console.log('  ✗', `page '${p.id}' module failed to import — ${e.message}`);
  }
}

console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
