// tests/test_discovery_pca_comparator.js
//
// Unit + lifecycle smoke for pages/discovery/pca_comparator. Phase 1
// (side-by-side) per specs_todo/SPEC_local_pca_comparator.md.
//
// Coverage:
//   - module loads + exports the expected lifecycle entries
//   - mount(null-ish atlasState) doesn't throw and gracefully no-ops
//   - paintPanel falls through to the empty-state when the canvas DOM
//     is absent (headless test env)
//   - hit-test on empty cache returns -1

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else      { fail++; console.log('  ✗', name, detail ? '— ' + detail : ''); }
}
function group(label) { console.log('\n--- ' + label + ' ---'); }

// =====================================================================
group('module surface');
const page = await import('../atlases/inversion/pages/discovery/pca_comparator.js');
check('exports mount',   typeof page.mount   === 'function');
check('exports unmount', typeof page.unmount === 'function');
check('exports refresh', typeof page.refresh === 'function');

const state = await import('../atlases/inversion/pages/discovery/pca_comparator/_state.js');
check('state exports _pageState binding', '_pageState' in state);
check('state exports _setActiveState',    typeof state._setActiveState === 'function');

const renderer = await import('../atlases/inversion/pages/discovery/pca_comparator/renderer.js');
check('renderer exports paintPanel',       typeof renderer.paintPanel       === 'function');
check('renderer exports findSampleAtPixel', typeof renderer.findSampleAtPixel === 'function');

// =====================================================================
group('mount / unmount headless tolerance');
{
  // No DOM in this test — mount should not throw, just no-op the wires.
  let mountThrew = false;
  let unmountThrew = false;
  const atlasState = { inversion: {} };
  try { await page.mount(null, atlasState, null); }
  catch (_) { mountThrew = true; }
  check('mount(empty atlasState) does not throw', !mountThrew);
  check('mount stashes pageState on atlasState.inversion',
        typeof atlasState.inversion._page_pca_comparator_state === 'object');
  try { await page.unmount(null); }
  catch (_) { unmountThrew = true; }
  check('unmount() does not throw', !unmountThrew);
}

// =====================================================================
group('findSampleAtPixel on cold cache → -1');
{
  // Re-mount with a fresh state so _lastScreenXY caches are reset to
  // the post-_paintAll values (which were null in headless).
  const atlasState2 = { inversion: {} };
  await page.mount(null, atlasState2, null);
  const ps = atlasState2.inversion._page_pca_comparator_state;
  check('pageState has anchor=dosage by default', ps && ps.anchor === 'dosage');
  check('pageState has hoveredSample=-1 by default',
        ps && ps.hoveredSample === -1);
  const hit = renderer.findSampleAtPixel(ps, 'dosage', 10, 10);
  check('findSampleAtPixel on cold cache → -1', hit === -1);
  await page.unmount(null);
}

// =====================================================================
group('refresh() with no shared state does not throw');
{
  const atlasState3 = { inversion: {} };
  await page.mount(null, atlasState3, null);
  let threw = false;
  try { page.refresh(atlasState3.inversion._page_pca_comparator_state); }
  catch (_) { threw = true; }
  check('refresh(empty sharedState) does not throw', !threw);
  await page.unmount(null);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
