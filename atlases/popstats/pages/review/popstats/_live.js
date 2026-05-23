// =============================================================================
// popstats/_live.js
// =============================================================================
// Thin client for the popstats live-server endpoints exposed by
// atlas-core/server/atlas_server.py. Port of the chat-A `popgenLive` request
// layer, scoped down to what the popstats page actually consumes.
//
// Endpoints (POST):
//   /api/popstats/groupwise       — per-window FST/dxy/theta_pi etc. across
//                                   pairwise group splits (engine F).
//   /api/popstats/hobs_groupwise  — per-window Hobs/Hexp via ANGSD + hobs_windower.
//
// Both endpoints require `groups: { name: [sample_id, ...] }` with each group
// holding at least `min_group_n` samples (server default 10). When no groups
// are wired into atlas-state yet, callers should pass {} and handle the
// resulting 400; the renderer falls through to the static auto-discovered
// tracks (theta_pi / Δ12 / GHSL / etc.) so the page still paints.
// =============================================================================

const DEFAULT_METRICS = ['fst', 'dxy', 'theta_pi'];

export async function fetchPopstatsGroupwise(opts) {
  const {
    serverBaseUrl, chrom, groups, region = null,
    metrics = DEFAULT_METRICS, winBp = 50000, stepBp = 10000,
    winType = 2, downsample = 1, ncores = 4,
  } = opts;
  if (!chrom) throw new Error('fetchPopstatsGroupwise: chrom required');
  const base = serverBaseUrl || '';
  const body = {
    chrom, region, groups, metrics,
    win_bp: winBp, step_bp: stepBp, win_type: winType,
    downsample, ncores,
  };
  const resp = await fetch(`${base}/api/popstats/groupwise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`POST /api/popstats/groupwise → ${resp.status}: ${text}`);
  }
  return resp.json();
}

export async function fetchHobsGroupwise(opts) {
  const { serverBaseUrl, chrom, groups, region = null, scales = ['10kb'] } = opts;
  if (!chrom) throw new Error('fetchHobsGroupwise: chrom required');
  const base = serverBaseUrl || '';
  const body = { chrom, region, groups, scales };
  const resp = await fetch(`${base}/api/popstats/hobs_groupwise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`POST /api/popstats/hobs_groupwise → ${resp.status}: ${text}`);
  }
  return resp.json();
}

/**
 * Adapt a popstats groupwise response into per-track {mb, values} bags keyed
 * by column id. The response has `windows: [{...}]` rows with one column per
 * metric × group pair (e.g. `fst_HOM1_HOM2`, `theta_pi_HOM1`).
 *
 * Returns { [columnId]: { mb, values } } so the renderer can splice these into
 * the auto-discovered tracks list without knowing the server's column shape.
 */
export function adaptGroupwiseResponse(envelope) {
  if (!envelope || !Array.isArray(envelope.windows)) return {};
  const wins = envelope.windows;
  const mb = wins.map(w => {
    if (typeof w.center_mb === 'number') return w.center_mb;
    if (typeof w.start === 'number' && typeof w.end === 'number') {
      return (w.start + w.end) / 2 / 1e6;
    }
    return null;
  });
  const out = {};
  const columns = Array.isArray(envelope.columns) ? envelope.columns : [];
  for (const col of columns) {
    if (col === 'start' || col === 'end' || col === 'center_mb') continue;
    out[col] = {
      mb,
      values: wins.map(w => {
        const v = w[col];
        return (v == null || Number.isNaN(v)) ? null : Number(v);
      }),
    };
  }
  return out;
}

/**
 * Stitch a popstats groupwise response into the same track-name shape the
 * popstats renderer already consumes via `data.tracks[name]`. Returns a dict
 * keyed by the canonical popstats chip ids:
 *
 *   theta_invgt   — one series per group (theta_pi_<group> columns)
 *   fst_pairs     — one series per group-pair (Fst_<g1>_<g2> columns).
 *                   When there's only one pair, ALSO sets `fst_hom1_hom2`
 *                   (single series) so the dedicated chip lights up.
 *   dxy_pairs     — one series per group-pair (dXY_<g1>_<g2> columns)
 *   dA_pairs / MI_pairs / MInorm_pairs — same shape (gallery tracks)
 *
 * Caller's typical wiring:
 *   const tracks = stitchTracksFromGroupwise(envelope);
 *   for (const [name, t] of Object.entries(tracks)) {
 *     data.tracks[name] = t;
 *   }
 *   renderPopstatsPage({ root, data, ... });
 *
 * Each emitted track carries `series: [{name, values}, ...]` + `pos_bp` so
 * the auto-discover path in popstats/_tracks.js picks it up as a multi-series
 * track without further code changes.
 */
export function stitchTracksFromGroupwise(envelope) {
  if (!envelope || !Array.isArray(envelope.windows)) return {};
  const wins = envelope.windows;
  const columns = Array.isArray(envelope.columns) ? envelope.columns : [];
  // Resolve per-window position (bp). The renderer prefers pos_bp; otherwise
  // it'll fall back to data.windows[*].center_mb. Carry whichever the
  // envelope offers.
  const pos_bp = wins.map(w => {
    if (Number.isFinite(w.start) && Number.isFinite(w.end)) {
      return Math.round((w.start + w.end) / 2);
    }
    if (Number.isFinite(w.center_mb)) return Math.round(w.center_mb * 1e6);
    return null;
  });
  const numCol = (col) => wins.map(w => {
    const v = w[col];
    return (v == null || Number.isNaN(v)) ? null : Number(v);
  });

  const out = {};

  // Per-group θπ → theta_invgt (one line per group)
  const thetaCols = columns.filter(c => c.startsWith('theta_pi_'));
  if (thetaCols.length > 0) {
    out.theta_invgt = {
      pos_bp,
      series: thetaCols.map(c => ({
        name:   c.slice('theta_pi_'.length),
        values: numCol(c),
      })),
    };
  }

  // Fst pairs. One pair → also emit single-series fst_hom1_hom2.
  const fstCols = columns.filter(c => c.startsWith('Fst_'));
  if (fstCols.length === 1) {
    const c = fstCols[0];
    const values = numCol(c);
    out.fst_hom1_hom2 = { pos_bp, values };
    out.fst_pairs    = { pos_bp, series: [{ name: c.slice('Fst_'.length), values }] };
  } else if (fstCols.length > 1) {
    out.fst_pairs = {
      pos_bp,
      series: fstCols.map(c => ({
        name:   c.slice('Fst_'.length).replace('_', ' vs '),
        values: numCol(c),
      })),
    };
  }

  // dXY / dA / MI / MInorm pairs — same pattern.
  for (const [prefix, trackId] of [
    ['dXY_',     'dxy_pairs'],
    ['dA_',      'da_pairs'],
    ['MI_',      'mi_pairs'],
    ['MInorm_',  'minorm_pairs'],
  ]) {
    const matched = columns.filter(c => c.startsWith(prefix));
    if (matched.length === 0) continue;
    out[trackId] = {
      pos_bp,
      series: matched.map(c => ({
        name:   c.slice(prefix.length).replace('_', ' vs '),
        values: numCol(c),
      })),
    };
  }

  return out;
}
