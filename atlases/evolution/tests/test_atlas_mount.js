// atlases/evolution/tests/test_atlas_mount.js
//
// Smokes for the evolution atlas scaffold. Run with:
//
//   node atlases/evolution/tests/test_atlas_mount.js
//
// Covers:
//   - manifest.json parses + declares 9 pages
//   - 6 registries parse
//   - all 9 page .html + .js files exist
//   - all 12 moved shared modules exist
//   - moved page JS modules export mount (refresh + unmount optional)
//   - moved page mount(null, ...) doesn't throw in headless env

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

// ---------------------------------------------------------------------------
group('manifest');
const manifest = await readJson('manifest.json');
check('atlas_id is evolution', manifest.atlas_id === 'evolution');
check('cohorts includes cgar_hatchery_226',
      Array.isArray(manifest.cohorts) && manifest.cohorts.includes('cgar_hatchery_226'));
check('reference_id is fClaHyb_Gar_LG', manifest.reference_id === 'fClaHyb_Gar_LG');
check('manifest declares 9 pages', Array.isArray(manifest.pages) && manifest.pages.length === 9);
for (const p of manifest.pages || []) {
  check(`page '${p.id}' fragment exists`,
        await exists(p.fragment.replace(/^atlases\/evolution\//, '')),
        p.fragment);
  check(`page '${p.id}' module exists`,
        await exists(p.module.replace(/^atlases\/evolution\//, '')),
        p.module);
}

// ---------------------------------------------------------------------------
group('registries parse');
const layers     = await readJson('registries/data/layers.registry.json');
const pages      = await readJson('registries/data/pages.registry.json');
const ops        = await readJson('registries/data/operations.registry.json');
const files      = await readJson('registries/data/files.registry.json');
const slots      = await readJson('registries/data/slots.registry.json');
const workflows  = await readJson('registries/data/workflows.registry.json');
check('layers.registry parses',     Array.isArray(layers.layers));
check('pages.registry has 9 pages', Array.isArray(pages.pages) && pages.pages.length === 9);
check('operations.registry parses', Array.isArray(ops.operations));
check('files.registry parses',      Array.isArray(files.files));
check('slots.registry parses',      Array.isArray(slots.slots));
check('workflows.registry parses',  Array.isArray(workflows.workflows));

// ---------------------------------------------------------------------------
group('migrated shared modules exist');
const expectedShared = [
  'shared/mgl_inversion_divergence.js',
  'shared/mgl_outgroup_synteny.js',
  'shared/mgl_haplotype_network.js',
  'shared/mgl_doubleton_sfs_clusters.js',
  'shared/mgl_archaeology_classifier.js',
  'shared/mgl_event_tree.js',
  'shared/mgl_founder_consensus.js',
  'shared/mgl_kinship_downweight.js',
  'shared/mgl_mosaicism_detector.js',
  'shared/age_model_suggester.js',
  'shared/busco_4d_age.js',
  'shared/copy_origin_painting.js',
];
for (const rel of expectedShared) {
  check(`exists: ${rel}`, await exists(rel));
}

// ---------------------------------------------------------------------------
group('page JS modules parse + export mount');
for (const p of manifest.pages) {
  const moduleRel = p.module.replace(/^atlases\/evolution\//, '');
  try {
    const mod = await import(path.join(ATLAS_ROOT, moduleRel));
    check(`page '${p.id}' exports mount`, typeof mod.mount === 'function');
    let threw = false;
    try { await mod.mount(null, { shared: {}, inversion: {} }, null); }
    catch (_) { threw = true; }
    check(`page '${p.id}' mount(null,...) does not throw`, !threw);
  } catch (e) {
    fail++;
    console.log('  ✗', `page '${p.id}' module failed to import — ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
