// =============================================================================
// popstats/_canvas.js
// =============================================================================
// Canvas primitives used by the popstats stack renderer. Ported from the
// legacy Inversion_atlas.html monolith (themeColor / fitCanvas / drawPopstats*).
// De-globalized: no state, no window.* lookups; the renderer threads the
// per-track context bag in explicitly.
// =============================================================================

const _THEME_FALLBACK_DARK = {
  bg: '#11151b', panel: '#1a2029', 'panel-2': '#222a36', 'panel-3': '#2a3340',
  ink: '#d8dde4', 'ink-dim': '#9aa3ad', 'ink-dimmer': '#6f7780',
  rule: '#2f3a47', accent: '#f5a524',
};

const _CSS_VAR_MAP = {
  bg: '--bg', panel: '--panel', 'panel-2': '--panel-2', 'panel-3': '--panel-3',
  ink: '--ink', 'ink-dim': '--ink-dim', 'ink-dimmer': '--ink-dimmer',
  rule: '--rule', accent: '--accent', dim: '--ink-dim',
};

export function themeColor(name) {
  const fallback = _THEME_FALLBACK_DARK[name] || name;
  if (typeof getComputedStyle !== 'function') return fallback;
  const cssVar = _CSS_VAR_MAP[name];
  if (!cssVar) return name;
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
    return v || fallback;
  } catch (_) { return fallback; }
}

export function fitCanvas(canvas) {
  const dpr  = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width  = Math.floor(rect.width  * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: rect.width, h: rect.height };
}

export function drawFrame(ctx, pad, plotW, plotH) {
  ctx.strokeStyle = themeColor('rule');
  ctx.lineWidth = 1;
  ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, plotW, plotH);
}

export function drawBreakpoints(ctx, toX, pad, plotH, bps) {
  if (!bps || bps.length === 0) return;
  ctx.save();
  ctx.strokeStyle = '#e0555c';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([4, 3]);
  ctx.globalAlpha = 0.65;
  for (const b of bps) {
    if (!isFinite(b)) continue;
    const xb = toX(b);
    ctx.beginPath();
    ctx.moveTo(Math.round(xb) + 0.5, pad.t);
    ctx.lineTo(Math.round(xb) + 0.5, pad.t + plotH);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawCrosshair(ctx, toX, pad, plotH, mb) {
  if (!isFinite(mb)) return;
  ctx.strokeStyle = '#f5a524';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  const xc = toX(mb);
  ctx.moveTo(Math.round(xc) + 0.5, pad.t);
  ctx.lineTo(Math.round(xc) + 0.5, pad.t + plotH);
  ctx.stroke();
}

export function drawIdeogram(ctx, toX, pad, plotW, plotH, mbMin, mbMax, bps) {
  const y0 = pad.t + 4, hh = plotH - 8;
  ctx.fillStyle = '#e8ebef';
  ctx.fillRect(pad.l, y0, plotW, hh);
  ctx.strokeStyle = '#555e69';
  ctx.lineWidth = 0.6;
  ctx.strokeRect(pad.l + 0.5, y0 + 0.5, plotW, hh);
  ctx.strokeStyle = '#c8cdd2';
  ctx.lineWidth = 0.5;
  const start = Math.ceil(mbMin), end = Math.floor(mbMax);
  for (let mb = start; mb <= end; mb += 2) {
    const x = toX(mb);
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, y0 + 1);
    ctx.lineTo(Math.round(x) + 0.5, y0 + hh - 1);
    ctx.stroke();
  }
  if (bps && bps.length === 2 && bps[0] < bps[1]) {
    const xa = toX(bps[0]), xb = toX(bps[1]);
    ctx.fillStyle = 'rgba(224,85,92,0.55)';
    ctx.fillRect(xa, y0, xb - xa, hh);
    ctx.strokeStyle = '#8a2b30';
    ctx.lineWidth = 0.6;
    ctx.strokeRect(xa + 0.5, y0 + 0.5, xb - xa, hh);
  }
  ctx.fillStyle = themeColor('dim');
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`${mbMin.toFixed(2)} Mb`, pad.l + 2, y0 + hh + 9);
  ctx.textAlign = 'right';
  ctx.fillText(`${mbMax.toFixed(2)} Mb`, pad.l + plotW - 2, y0 + hh + 9);
}

export function drawSimCollapse(ctx, toX, pad, plotW, plotH, wins, simMat) {
  const N = wins.length;
  let collapse;
  if (Array.isArray(simMat) && simMat.length === N) {
    collapse = new Float32Array(N);
    const K = Math.max(5, Math.floor(N * 0.01));
    for (let i = 0; i < N; i++) {
      const lo = Math.max(0, i - K), hi = Math.min(N - 1, i + K);
      let sum = 0, cnt = 0;
      for (let j = lo; j <= hi; j++) {
        const v = simMat[i][j];
        if (isFinite(v)) { sum += v; cnt++; }
      }
      collapse[i] = cnt > 0 ? sum / cnt : NaN;
    }
  } else {
    collapse = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const z = Math.abs(wins[i].z || 0);
      collapse[i] = 1 / (1 + z);
    }
  }
  let yMin = Infinity, yMax = -Infinity;
  for (const v of collapse) if (isFinite(v)) { if (v < yMin) yMin = v; if (v > yMax) yMax = v; }
  if (!isFinite(yMin) || !isFinite(yMax) || yMin === yMax) return;
  const toY = (v) => pad.t + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  ctx.fillStyle = 'rgba(207,169,115,0.6)';
  ctx.beginPath();
  ctx.moveTo(toX(wins[0].center_mb), pad.t + plotH);
  for (let i = 0; i < N; i++) {
    if (!isFinite(collapse[i])) continue;
    ctx.lineTo(toX(wins[i].center_mb), toY(collapse[i]));
  }
  ctx.lineTo(toX(wins[N - 1].center_mb), pad.t + plotH);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#8a6b3b';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  let first = true;
  for (let i = 0; i < N; i++) {
    if (!isFinite(collapse[i])) continue;
    const x = toX(wins[i].center_mb), y = toY(collapse[i]);
    if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

export function drawLine(ctx, toX, pad, plotW, plotH, data, trackDef) {
  const { mb, values, refLine } = data;
  if (!Array.isArray(mb) || !Array.isArray(values) || mb.length !== values.length) return;
  let yMin = Infinity, yMax = -Infinity;
  if (isFinite(data.min) && isFinite(data.max)) {
    yMin = data.min; yMax = data.max;
  } else {
    for (const v of values) if (isFinite(v)) { if (v < yMin) yMin = v; if (v > yMax) yMax = v; }
  }
  if (!isFinite(yMin) || !isFinite(yMax)) return;
  if (yMin === yMax) { yMin -= 0.5; yMax += 0.5; }
  const toY = (v) => pad.t + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  if (isFinite(refLine)) {
    ctx.save();
    ctx.strokeStyle = '#c0504d';
    ctx.lineWidth = 0.6;
    ctx.setLineDash([4, 3]);
    const yr = toY(refLine);
    ctx.beginPath();
    ctx.moveTo(pad.l, yr); ctx.lineTo(pad.l + plotW, yr);
    ctx.stroke();
    ctx.restore();
  }
  // Halo
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  let first = true;
  for (let i = 0; i < mb.length; i++) {
    if (!isFinite(values[i])) { first = true; continue; }
    const x = toX(mb[i]), y = toY(values[i]);
    if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // Core
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = trackDef.color || '#1f4e79';
  ctx.beginPath();
  first = true;
  for (let i = 0; i < mb.length; i++) {
    if (!isFinite(values[i])) { first = true; continue; }
    const x = toX(mb[i]), y = toY(values[i]);
    if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // Y range tick text
  ctx.fillStyle = themeColor('dim');
  ctx.font = '8px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.fillText(yMax.toFixed(2), pad.l - 4, pad.t + 8);
  ctx.fillText(yMin.toFixed(2), pad.l - 4, pad.t + plotH);
}

export function drawEdgeLabels(ctx, pad, plotW, plotH, trackDef) {
  if (trackDef.edgeTop) {
    ctx.fillStyle = themeColor('dim');
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(trackDef.edgeTop, pad.l + plotW + 4, pad.t + 8);
  }
  if (trackDef.edgeBot) {
    ctx.fillStyle = themeColor('dim');
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(trackDef.edgeBot, pad.l + plotW + 4, pad.t + plotH);
  }
  if (trackDef.yLabel) {
    ctx.save();
    ctx.fillStyle = themeColor('ink');
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(trackDef.yLabel, pad.l - 6, pad.t + plotH / 2);
    ctx.restore();
  }
}
