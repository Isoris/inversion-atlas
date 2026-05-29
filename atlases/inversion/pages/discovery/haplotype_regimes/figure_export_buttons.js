// pages/discovery/haplotype_regimes/figure_export_buttons.js
// =====================================================================
// Wires the ⇩ PNG + ⇩ SVG export buttons on the 4 regime panels:
//
//   #regimesPanel             → chrom · target-band lanes
//   #regimesGenomePanel       → genome · target-band lanes
//   #regimesPC1Panel          → chrom · PC1 lines
//   #regimesPC1GenomePanel    → genome · PC1 lines
//
// v1 strategy (no refactor of draw functions):
//   1. Temporarily set window.devicePixelRatio = 4 (via defineProperty
//      since the property is read-only by spec).
//   2. Call the panel's draw function — fitCanvas() reads dpr=4 and
//      sizes the backing buffer 4× larger than CSS pixels, so the
//      paint code lays down vector-equivalent detail.
//   3. canvas.toBlob('image/png') → download.
//   4. Restore dpr + repaint to clean up the on-screen flash.
//
// SVG export: same high-DPI raster wrapped inside <svg><image>. Not
// editable as vector (Illustrator will see one image), but stays
// resolution-independent for placement / print scaling. True
// per-element vector requires extracting paintCore(ctx,…) from each
// draw function and is deferred to a v2.
// =====================================================================

// 2026-05-29: drawRegimesPanel + drawRegimesPC1Panel live in their own
// panel modules, NOT regimes_page.js (which only exports initRegimesPage
// + computeGenomeView). The wrong path here was a broken named import,
// which threw at module-eval and stopped the entire haplotype_regimes
// chain from loading — the tab switched but the page never mounted.
import { drawRegimesPanel } from './regimes_panel.js';
import { drawRegimesPC1Panel } from './regimes_pc1_panel.js';
import { downloadString, downloadCanvasAsPNG } from '../../../shared/figure_export.js';

const DPR_HIGHQ = 4;     // 4× — ≈ 288 DPI at typical CSS sizes (print-ready)

/**
 * Wire all 8 buttons (4 panels × { PNG, SVG }).
 * Idempotent — re-running just re-binds the handlers.
 *
 * @param {HTMLElement} root  page root (has the panels)
 * @param {Object} state      haplotype_regimes page state (has _atlasState)
 */
export function wireRegimeFigureExportButtons(root, state) {
  if (!root || !state) return;
  const panels = [
    {
      panelId: 'regimesPanel',
      containerId: 'regimesCanvasContainer',
      drawFn: drawRegimesPanel,
      drawState: () => state,
      slug: 'chrom_lanes',
    },
    {
      panelId: 'regimesGenomePanel',
      containerId: 'regimesGenomeCanvasContainer',
      drawFn: drawRegimesPanel,
      drawState: () => state._regimesGenomeState,
      slug: 'genome_lanes',
    },
    {
      panelId: 'regimesPC1Panel',
      containerId: 'regimesPC1CanvasContainer',
      drawFn: drawRegimesPC1Panel,
      drawState: () => state,
      slug: 'chrom_pc1',
    },
    {
      panelId: 'regimesPC1GenomePanel',
      containerId: 'regimesPC1GenomeCanvasContainer',
      drawFn: drawRegimesPC1Panel,
      drawState: () => state._regimesGenomeState,
      slug: 'genome_pc1',
    },
  ];
  for (const p of panels) _wirePanel(root, state, p);
}

function _wirePanel(root, state, p) {
  const panel = root.querySelector('#' + p.panelId);
  if (!panel) return;
  const title = panel.querySelector('.rg-panel-title');
  if (!title) return;

  // Idempotent: skip if our buttons already exist.
  if (title.querySelector('.rg-figure-png-btn')) return;

  const btnPNG = _mkButton('PNG (4×)', 'rg-figure-png-btn', '⇩ PNG');
  const btnSVG = _mkButton('SVG (4× raster wrapped)', 'rg-figure-svg-btn', '⇩ SVG');
  // Insert before the expand button.
  const expandBtn = title.querySelector('.rg-expand-btn');
  if (expandBtn) {
    title.insertBefore(btnPNG, expandBtn);
    title.insertBefore(btnSVG, expandBtn);
  } else {
    title.appendChild(btnPNG);
    title.appendChild(btnSVG);
  }

  btnPNG.onclick = (e) => {
    e.preventDefault();
    const cv = _exportAtHighDPR(p, () => _findCanvas(p.containerId));
    if (!cv) return;
    const chrom = (state.activeChrom || 'chr');
    downloadCanvasAsPNG(cv, `${chrom}_${p.slug}_4x.png`);
  };
  btnSVG.onclick = (e) => {
    e.preventDefault();
    const cv = _exportAtHighDPR(p, () => _findCanvas(p.containerId));
    if (!cv) return;
    const chrom = (state.activeChrom || 'chr');
    const dataUrl = cv.toDataURL('image/png');
    // CSS size = pixel size / 4 (we rendered at 4× DPR). viewBox is in
    // CSS units so the SVG scales cleanly when placed in print.
    const cssW = Math.max(1, cv.width / DPR_HIGHQ);
    const cssH = Math.max(1, cv.height / DPR_HIGHQ);
    const svg =
      `<?xml version="1.0" encoding="UTF-8"?>\n`
      + `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" `
      + `width="${cssW}" height="${cssH}" viewBox="0 0 ${cssW} ${cssH}">\n`
      + `  <image x="0" y="0" width="${cssW}" height="${cssH}" preserveAspectRatio="none" `
      + `xlink:href="${dataUrl}"/>\n`
      + `</svg>\n`;
    downloadString(`${chrom}_${p.slug}_4x.svg`, svg, 'image/svg+xml');
  };
}

/**
 * Bump window.devicePixelRatio temporarily, repaint the panel, return
 * the canvas. Restores dpr + repaints to clean up the on-screen state.
 */
function _exportAtHighDPR(p, getCanvasFn) {
  const drawState = p.drawState();
  if (!drawState) return null;
  let cv = null;
  const originalDpr = window.devicePixelRatio || 1;
  let overrode = false;
  try {
    Object.defineProperty(window, 'devicePixelRatio',
      { value: DPR_HIGHQ, configurable: true });
    overrode = true;
    // High-DPR repaint — fitCanvas reads window.devicePixelRatio,
    // sizes the backing buffer 4× CSS px, and the panel paints into
    // it. Output canvas pixels are the same DOM node; we just read
    // them out before restoring.
    p.drawFn(drawState);
    cv = getCanvasFn();
    // Clone the bitmap into a fresh canvas so the user's downloaded
    // image survives the restore-repaint that follows.
    if (cv) {
      const cloned = document.createElement('canvas');
      cloned.width = cv.width;
      cloned.height = cv.height;
      const cctx = cloned.getContext('2d');
      if (cctx) cctx.drawImage(cv, 0, 0);
      cv = cloned;
    }
  } catch (e) {
    console.warn('[figure-export] high-DPR repaint threw —', e);
  } finally {
    if (overrode) {
      Object.defineProperty(window, 'devicePixelRatio',
        { value: originalDpr, configurable: true });
      // Restore screen rendering.
      try { p.drawFn(drawState); }
      catch (e) { console.warn('[figure-export] restore-repaint threw —', e); }
    }
  }
  return cv;
}

function _findCanvas(containerId) {
  const c = document.getElementById(containerId);
  if (!c) return null;
  // Drill into the subpanel wrapper (regimes_panel.js creates a
  // .regimes-subpanel or .regimes-genome-lanes-subpanel inside the
  // container, with the canvas inside that).
  return c.querySelector('canvas');
}

function _mkButton(title, cls, label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.title = title;
  b.textContent = label;
  b.style.cssText =
    'background: transparent; border: 1px solid var(--rule, #2a3242); '
    + 'color: var(--ink-dim, #8895a8); cursor: pointer; padding: 0 6px; '
    + 'border-radius: 2px; font: 10px ui-monospace, monospace;';
  return b;
}
