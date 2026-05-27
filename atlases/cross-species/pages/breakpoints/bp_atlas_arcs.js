// atlases/cross-species/pages/breakpoints/bp_atlas_arcs.js
//
// BP atlas arcs page — renders a minimal arc visualisation from
// atlas_paf_arcs.json. Phase 1a: scaffold. Full BP5 figure
// reproduction stays in the R scripts (engines/figures/bp_atlas/);
// this canvas is the in-browser preview for the breakpoint-arc
// arrangement.

import { applyOnboarding, resetOnboarding } from '../../shared/onboarding.js';

let _pageState = null;

export async function mount(root, atlasState, registry) {
  resetOnboarding('bp_atlas_arcs');
  _pageState = {
    atlasState, registry,
    arcs: null, meta: null,
    hit_regions: [],    // [{x1, x2, midX, radius, arc}, ...]
    hover_idx:   -1,
    _teardowns:  [],
  };
  await _load(root, registry);
  _wireHover(root);
}

export async function unmount(_root) {
  if (_pageState && Array.isArray(_pageState._teardowns)) {
    for (const t of _pageState._teardowns) { try { t(); } catch (_) {} }
  }
  _pageState = null;
}

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
    applyOnboarding('bp_atlas_arcs');
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
  // Arcs — capture hit regions so onMove can identify the hovered arc.
  _pageState.hit_regions = [];
  ctx.lineWidth = 1.5;
  for (let i = 0; i < arcList.length; i++) {
    const a = arcList[i];
    const x1 = chromX(a.chrom_from || a.chrom);
    const x2 = chromX(a.chrom_to   || a.chrom);
    if (x1 == null || x2 == null) continue;
    const midX = (x1 + x2) / 2;
    const dist = Math.abs(x2 - x1);
    const radius = Math.max(20, dist / 2);
    const isHovered = (i === _pageState.hover_idx);
    ctx.strokeStyle = isHovered
      ? 'rgba(255,210,90,0.95)'
      : (a.color || 'rgba(95,179,255,0.45)');
    ctx.lineWidth = isHovered ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.arc(midX, padT + plotH, radius, Math.PI, 0, false);
    ctx.stroke();
    _pageState.hit_regions.push({
      idx: i,
      midX, radius,
      baseY: padT + plotH,
      arc: a,
    });
  }
  ctx.lineWidth = 1;
  // Hovered-arc tooltip card, anchored above the arc apex.
  if (_pageState.hover_idx >= 0) {
    const hr = _pageState.hit_regions[_pageState.hover_idx];
    if (hr) _paintArcTooltip(ctx, hr, cssW, cssH);
  }
}

function _paintArcTooltip(ctx, hr, cssW, cssH) {
  const a = hr.arc || {};
  const lines = [];
  if (a.chrom_from || a.chrom_to) {
    lines.push(`${a.chrom_from || a.chrom} → ${a.chrom_to || a.chrom}`);
  } else if (a.chrom) {
    lines.push(String(a.chrom));
  }
  if (a.event_class) lines.push('class: ' + a.event_class);
  if (Number.isFinite(a.from_bp) || Number.isFinite(a.to_bp)) {
    const f = Number.isFinite(a.from_bp) ? (a.from_bp / 1e6).toFixed(2) + ' Mb' : '?';
    const t = Number.isFinite(a.to_bp)   ? (a.to_bp   / 1e6).toFixed(2) + ' Mb' : '?';
    lines.push(`${f} – ${t}`);
  }
  if (a.label) lines.push(String(a.label));
  if (lines.length === 0) return;
  ctx.font = '10px ui-monospace, monospace';
  let maxW = 0;
  for (const ln of lines) maxW = Math.max(maxW, Math.ceil(ctx.measureText ? ctx.measureText(ln).width : ln.length * 6));
  const padPx = 6;
  const lineH = 13;
  const boxW = maxW + 2 * padPx;
  const boxH = lines.length * lineH + 2 * padPx;
  const apexY = hr.baseY - hr.radius;
  let bx = hr.midX - boxW / 2;
  let by = apexY - boxH - 8;
  bx = Math.max(4, Math.min(cssW - boxW - 4, bx));
  by = Math.max(4, by);
  ctx.fillStyle = 'rgba(20, 25, 35, 0.95)';
  ctx.strokeStyle = 'rgba(255, 210, 90, 0.9)';
  ctx.lineWidth = 1;
  if (typeof ctx.fillRect === 'function')   ctx.fillRect(bx, by, boxW, boxH);
  if (typeof ctx.strokeRect === 'function') ctx.strokeRect(bx + 0.5, by + 0.5, boxW, boxH);
  ctx.fillStyle = '#ffe6a8';
  if (typeof ctx.textBaseline !== 'undefined') ctx.textBaseline = 'top';
  for (let i = 0; i < lines.length; i++) {
    if (typeof ctx.fillText === 'function') {
      ctx.fillText(lines[i], bx + padPx, by + padPx + i * lineH);
    }
  }
  if (typeof ctx.textBaseline !== 'undefined') ctx.textBaseline = 'alphabetic';
}

function _wireHover(root) {
  if (!_pageState || typeof document === 'undefined') return;
  const canvas = root && root.querySelector ? root.querySelector('#bpArcsCanvas') : null;
  if (!canvas || typeof canvas.addEventListener !== 'function') return;
  const onMove = (ev) => {
    if (!_pageState || !_pageState.hit_regions || _pageState.hit_regions.length === 0) return;
    const rect = typeof canvas.getBoundingClientRect === 'function'
      ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
    const x = ((ev && ev.clientX) || 0) - (rect.left || 0);
    const y = ((ev && ev.clientY) || 0) - (rect.top  || 0);
    let hit = -1;
    let bestDist = 8;     // px tolerance from the arc curve
    for (const hr of _pageState.hit_regions) {
      // Distance from (x,y) to the arc circle (centre = midX, baseY,
      // radius). The arc is the upper half (y ≤ baseY) — only count
      // hits above the baseline.
      if (y > hr.baseY) continue;
      const dx = x - hr.midX, dy = y - hr.baseY;
      const d = Math.sqrt(dx * dx + dy * dy);
      const off = Math.abs(d - hr.radius);
      if (off < bestDist) { bestDist = off; hit = hr.idx; }
    }
    if (hit !== _pageState.hover_idx) {
      _pageState.hover_idx = hit;
      _paint(root);
    }
  };
  const onLeave = () => {
    if (!_pageState) return;
    if (_pageState.hover_idx !== -1) {
      _pageState.hover_idx = -1;
      _paint(root);
    }
  };
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  _pageState._teardowns.push(() => {
    try { canvas.removeEventListener('mousemove', onMove); } catch (_) {}
    try { canvas.removeEventListener('mouseleave', onLeave); } catch (_) {}
  });
}
