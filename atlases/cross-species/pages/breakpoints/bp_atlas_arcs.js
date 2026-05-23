// atlases/cross-species/pages/breakpoints/bp_atlas_arcs.js
//
// BP atlas arcs page — renders a minimal arc visualisation from
// atlas_paf_arcs.json. Phase 1a: scaffold. Full BP5 figure
// reproduction stays in the R scripts (engines/figures/bp_atlas/);
// this canvas is the in-browser preview for the breakpoint-arc
// arrangement.

let _pageState = null;

export async function mount(root, atlasState, registry) {
  _pageState = { atlasState, registry, arcs: null, meta: null };
  await _load(root, registry);
}

export async function unmount(_root) { _pageState = null; }

export function refresh(_state) {
  if (typeof document === 'undefined') return;
  const root = document.getElementById('bp_atlas_arcs');
  if (root) _paint(root);
}

async function _load(root, registry) {
  if (!root || typeof document === 'undefined') return;
  const statusEl = root.querySelector('#bpArcsStatus');
  if (statusEl) statusEl.textContent = 'loading arcs…';
  let arcs = null, meta = null;
  if (registry && typeof registry.resolve === 'function') {
    try { arcs = await registry.resolve('cross-species.bp_atlas_arcs_v1'); }
    catch (e) { console.warn('bp_atlas_arcs: arcs load failed —', e); }
    try { meta = await registry.resolve('cross-species.atlas_data_v1'); }
    catch (e) { console.warn('bp_atlas_arcs: atlas_data load failed —', e); }
  }
  if (_pageState) { _pageState.arcs = arcs; _pageState.meta = meta; }
  if (!arcs) {
    _showEmpty(root,
      'No bp_atlas_arcs_v1 layer loaded. Run the bp_atlas_pipeline ' +
      'workflow through stage BP5 to produce atlas_paf_arcs.json. ' +
      'The R scripts in engines/figures/bp_atlas/ render the same data ' +
      'as static figures (ribbons + dotplots + montage).');
    if (statusEl) statusEl.textContent = 'no data';
    return;
  }
  if (statusEl) {
    const n = Array.isArray(arcs && arcs.arcs) ? arcs.arcs.length
            : Array.isArray(arcs) ? arcs.length : 0;
    statusEl.textContent = `${n} arc${n === 1 ? '' : 's'}`;
  }
  _paint(root);
}

function _showEmpty(root, msg) {
  const empty = root.querySelector('#bpArcsEmpty');
  if (empty) {
    empty.textContent = msg;
    empty.style.display = 'flex';
  }
}
function _hideEmpty(root) {
  const empty = root.querySelector('#bpArcsEmpty');
  if (empty) empty.style.display = 'none';
}

function _paint(root) {
  if (typeof document === 'undefined' || !_pageState) return;
  const canvas = root.querySelector('#bpArcsCanvas');
  if (!canvas) return;
  const arcs = _pageState.arcs;
  if (!arcs) return;
  _hideEmpty(root);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // DPR-fit + clear
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const cssW = Math.max(1, (canvas.clientWidth  | 0));
  const cssH = Math.max(1, (canvas.clientHeight | 0));
  canvas.width  = Math.max(1, (cssW * dpr) | 0);
  canvas.height = Math.max(1, (cssH * dpr) | 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  // Arc data shape (per BP5): expect arcs = { arcs: [...], chrom_order: [...] }
  // or arcs as a flat list.
  const arcList = Array.isArray(arcs && arcs.arcs) ? arcs.arcs
                : Array.isArray(arcs) ? arcs : [];
  if (arcList.length === 0) return;

  // Minimal layout: chromosome axis along bottom, arcs above. Caller
  // supplies arc.from_bp + arc.to_bp + arc.chrom + optional arc.color.
  const padL = 60, padR = 12, padT = 14, padB = 50;
  const plotW = Math.max(1, cssW - padL - padR);
  const plotH = Math.max(1, cssH - padT - padB);
  // Pull chromosome list + lengths from meta if available; else fall back
  // to the unique arc.chrom set.
  const chroms = (_pageState.meta && Array.isArray(_pageState.meta.chrom_order))
               ? _pageState.meta.chrom_order
               : Array.from(new Set(arcList.map(a => a.chrom).filter(Boolean)));
  if (chroms.length === 0) return;
  const colWidth = plotW / chroms.length;
  const chromX = (name) => {
    const i = chroms.indexOf(name);
    return i < 0 ? null : padL + (i + 0.5) * colWidth;
  };
  // Axis baseline
  ctx.strokeStyle = 'rgba(120,140,170,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT + plotH + 0.5);
  ctx.lineTo(padL + plotW, padT + plotH + 0.5);
  ctx.stroke();
  // Chrom labels
  ctx.fillStyle = 'rgba(160,180,200,0.7)';
  ctx.font = '9.5px ui-monospace, monospace';
  ctx.textAlign = 'center';
  for (const c of chroms) {
    const x = chromX(c);
    if (x == null) continue;
    ctx.fillText(c, x, padT + plotH + 14);
  }
  // Arcs
  ctx.lineWidth = 1.5;
  for (const a of arcList) {
    const x1 = chromX(a.chrom_from || a.chrom);
    const x2 = chromX(a.chrom_to   || a.chrom);
    if (x1 == null || x2 == null) continue;
    const midX = (x1 + x2) / 2;
    const dist = Math.abs(x2 - x1);
    const radius = Math.max(20, dist / 2);
    ctx.strokeStyle = a.color || 'rgba(95,179,255,0.45)';
    ctx.beginPath();
    ctx.arc(midX, padT + plotH, radius, Math.PI, 0, false);
    ctx.stroke();
  }
}
