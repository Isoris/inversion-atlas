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
// Phase 3 (2026-05-26): Procrustes overlay.
check('renderer exports paintProcrustesOverlay', typeof renderer.paintProcrustesOverlay === 'function');
check('renderer exports _alignLayerToDosage',    typeof renderer._alignLayerToDosage === 'function');

// =====================================================================
group('Phase 3 — Procrustes alignment math');
{
  const align = renderer._alignLayerToDosage;
  // Reference (dosage) scatter — 4 samples.
  const ref = {
    xs: [0, 1, 1, 0],
    ys: [0, 0, 1, 1],
  };
  // Build a layer that is `ref` rotated +90° and scaled ×2 (+ shifted).
  // Procrustes must recover the inverse so the aligned points land back
  // on `ref`. Rotation +90°: (x,y) → (-y, x). Scale ×2, translate (+5,-3).
  const layer = { xs: [], ys: [] };
  for (let i = 0; i < 4; i++) {
    const x = ref.xs[i], y = ref.ys[i];
    layer.xs.push(2 * (-y) + 5);
    layer.ys.push(2 * ( x) - 3);
  }
  const aligned = align(ref, layer);
  check('alignment returns a result for a clean similarity transform', !!aligned);
  if (aligned) {
    check('recovered scale ≈ 0.5 (inverse of ×2)',
          Math.abs(aligned.scale - 0.5) < 1e-6,
          `got ${aligned.scale}`);
    let maxErr = 0;
    for (let i = 0; i < 4; i++) {
      maxErr = Math.max(maxErr,
        Math.abs(aligned.xs[i] - ref.xs[i]),
        Math.abs(aligned.ys[i] - ref.ys[i]));
    }
    check('aligned points land back on the reference (err < 1e-6)',
          maxErr < 1e-6, `maxErr=${maxErr}`);
  }
  // Degenerate: fewer than 2 paired finite points → null (no rotation defined).
  const sparse = align({ xs: [0, NaN, NaN], ys: [0, NaN, NaN] },
                       { xs: [1, NaN, NaN], ys: [1, NaN, NaN] });
  check('alignment returns null when < 2 paired points', sparse === null);
  // NaN samples in the layer stay NaN in the aligned output (not coerced to 0).
  const withGap = align(ref, {
    xs: [layer.xs[0], NaN, layer.xs[2], layer.xs[3]],
    ys: [layer.ys[0], NaN, layer.ys[2], layer.ys[3]],
  });
  check('missing layer sample → NaN in aligned output',
        withGap && Number.isNaN(withGap.xs[1]));
}

const heatmap = await import('../atlases/inversion/pages/discovery/pca_comparator/heatmap.js');
check('heatmap exports paintHeatmap',     typeof heatmap.paintHeatmap   === 'function');
check('heatmap exports findCellAtPixel',  typeof heatmap.findCellAtPixel === 'function');
check('heatmap findCellAtPixel on cold cache → null',
      heatmap.findCellAtPixel(10, 10) === null);

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
