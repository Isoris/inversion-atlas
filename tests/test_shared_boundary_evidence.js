// tests/test_shared_boundary_evidence.js

import {
  BOUNDARY_DEFAULTS,
  BOUNDARY_TRACK_WEIGHTS,
  BOUNDARY_TRACK_POLARITY,
  BOUNDARY_TRACK_NAMES,
  SUPPORT_CLASS_COLORS,
  boundaryScanRange,
  findSVAnchorsInZone,
} from '../atlases/inversion/shared/boundary_evidence.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('BOUNDARY_DEFAULTS');
check('frozen',                                Object.isFrozen(BOUNDARY_DEFAULTS));
check('SCAN_RADIUS_BP = 1.5 Mb',               BOUNDARY_DEFAULTS.SCAN_RADIUS_BP === 1_500_000);
check('ZONE_RADIUS_WINDOWS = 5',               BOUNDARY_DEFAULTS.ZONE_RADIUS_WINDOWS === 5);
check('SMOOTH_WINDOW = 3 (odd)',               BOUNDARY_DEFAULTS.SMOOTH_WINDOW === 3);
check('EXCLUDE_OUTER_PCT = 0.10',              BOUNDARY_DEFAULTS.EXCLUDE_OUTER_PCT === 0.10);
check('SUPPORT_INCLUSION = 0.5',               BOUNDARY_DEFAULTS.SUPPORT_INCLUSION === 0.5);
check('CANDIDATE_HUGE_BP = 3 Mb',              BOUNDARY_DEFAULTS.CANDIDATE_HUGE_BP === 3_000_000);
check('CANDIDATE_HUGE_RATIO = 0.5',            BOUNDARY_DEFAULTS.CANDIDATE_HUGE_RATIO === 0.5);
check('STATUSES is array',                     Array.isArray(BOUNDARY_DEFAULTS.STATUSES));
check('STATUSES frozen',                       Object.isFrozen(BOUNDARY_DEFAULTS.STATUSES));
check('STATUSES has boundary_zone_only',
      BOUNDARY_DEFAULTS.STATUSES.includes('boundary_zone_only'));
check('STATUSES has SV_supported',
      BOUNDARY_DEFAULTS.STATUSES.includes('SV_supported'));
check('STATUSES has junction_supported',
      BOUNDARY_DEFAULTS.STATUSES.includes('junction_supported'));

// =====================================================================
group('BOUNDARY_TRACK_WEIGHTS');
check('frozen',                                Object.isFrozen(BOUNDARY_TRACK_WEIGHTS));
{
  const sum = Object.values(BOUNDARY_TRACK_WEIGHTS).reduce((a, b) => a + b, 0);
  check('weights sum to 1.0',                   Math.abs(sum - 1.0) < 1e-9);
}
check('11 tracks declared',
      Object.keys(BOUNDARY_TRACK_WEIGHTS).length === 11);
check('pca_drop = 0.20',                       BOUNDARY_TRACK_WEIGHTS.pca_drop === 0.20);
check('dosage_transition = 0.18',              BOUNDARY_TRACK_WEIGHTS.dosage_transition === 0.18);
check('sv_anchor = 0.02 (rarest)',             BOUNDARY_TRACK_WEIGHTS.sv_anchor === 0.02);

// =====================================================================
group('BOUNDARY_TRACK_POLARITY');
check('frozen',                                Object.isFrozen(BOUNDARY_TRACK_POLARITY));
check('same key set as WEIGHTS',
      Object.keys(BOUNDARY_TRACK_POLARITY).length === Object.keys(BOUNDARY_TRACK_WEIGHTS).length);
check('every weight key has polarity',
      Object.keys(BOUNDARY_TRACK_WEIGHTS).every(k => k in BOUNDARY_TRACK_POLARITY));
check('every polarity is +1 or -1',
      Object.values(BOUNDARY_TRACK_POLARITY).every(p => p === +1 || p === -1));
check('pca_drop polarity = +1',                BOUNDARY_TRACK_POLARITY.pca_drop === +1);
check('band_continuity_drop = -1',             BOUNDARY_TRACK_POLARITY.band_continuity_drop === -1);
check('theta_pi_step = -1 (drops inside)',     BOUNDARY_TRACK_POLARITY.theta_pi_step === -1);
check('similarity_edge = -1',                  BOUNDARY_TRACK_POLARITY.similarity_edge === -1);

// =====================================================================
group('BOUNDARY_TRACK_NAMES');
check('frozen',                                Object.isFrozen(BOUNDARY_TRACK_NAMES));
check('matches weight key count',              BOUNDARY_TRACK_NAMES.length === 11);
check('order matches weight declaration',
      BOUNDARY_TRACK_NAMES[0] === 'pca_drop' && BOUNDARY_TRACK_NAMES[10] === 'sv_anchor');

// =====================================================================
group('SUPPORT_CLASS_COLORS');
check('frozen',                                Object.isFrozen(SUPPORT_CLASS_COLORS));
check('4 support classes',                     Object.keys(SUPPORT_CLASS_COLORS).length === 4);
check('strong is green',                       SUPPORT_CLASS_COLORS.strong.hex === '#1B7837');
check('moderate is amber',                     SUPPORT_CLASS_COLORS.moderate.hex === '#F4A582');
check('weak is peach',                         SUPPORT_CLASS_COLORS.weak.hex === '#FDDBC7');
check('ambiguous is grey',                     SUPPORT_CLASS_COLORS.ambiguous.hex === '#BDBDBD');
check('every entry has opacity in [0, 1]',
      Object.values(SUPPORT_CLASS_COLORS).every(v =>
        v.opacity >= 0 && v.opacity <= 1));

// =====================================================================
group('boundaryScanRange — defaults + no state');
check('null cand → null',                      boundaryScanRange({}, null) === null);
{
  // 100 kb candidate, default radius (1.5 Mb each side)
  const cand = { start_bp: 10_000_000, end_bp: 10_100_000 };
  const r = boundaryScanRange({}, cand);
  check('returns object',                       !!r);
  check('start_bp = max(0, 10M - 1.5M)',        r.start_bp === 8_500_000);
  check('end_bp = 10.1M + 1.5M',                r.end_bp === 11_600_000);
  check('no windows: win_lo = 0',               r.win_lo === 0);
  check('no windows: win_hi = 0',               r.win_hi === 0);
}
{
  // start_bp clamped at 0
  const cand = { start_bp: 100_000, end_bp: 200_000 };
  const r = boundaryScanRange({}, cand);
  check('start_bp clamped at 0',                r.start_bp === 0);
}

// =====================================================================
group('boundaryScanRange — huge-candidate expansion');
{
  // 5 Mb span > 3 Mb threshold → radius = max(1.5M, 5M * 0.5) = max(1.5M, 2.5M) = 2.5M
  const cand = { start_bp: 10_000_000, end_bp: 15_000_000 };
  const r = boundaryScanRange({}, cand);
  check('huge: radius = span * 0.5',            r.start_bp === 10_000_000 - 2_500_000);
  check('huge: right end expanded too',         r.end_bp === 15_000_000 + 2_500_000);
}
{
  // 2 Mb span (BELOW 3 Mb threshold) → default radius
  const cand = { start_bp: 10_000_000, end_bp: 12_000_000 };
  const r = boundaryScanRange({}, cand);
  check('< huge_bp: keeps default radius',      r.start_bp === 10_000_000 - 1_500_000);
}
{
  // Explicit scan_radius_bp override
  const cand = { start_bp: 10_000_000, end_bp: 10_100_000 };
  const r = boundaryScanRange({}, cand, 500_000);
  check('explicit radius respected',            r.start_bp === 9_500_000);
}
{
  // Explicit radius + huge candidate: still expands to max(explicit, span*0.5)
  const cand = { start_bp: 10_000_000, end_bp: 15_000_000 };
  const r = boundaryScanRange({}, cand, 100_000);
  check('huge candidate: explicit < computed → use computed',
        r.start_bp === 10_000_000 - 2_500_000);
}

// =====================================================================
group('boundaryScanRange — chromLen clamp');
{
  const cand = { start_bp: 10_000_000, end_bp: 10_100_000 };
  const r = boundaryScanRange({}, cand, null, 11_000_000);
  check('chromLen clamps right end',            r.end_bp === 11_000_000);
}
{
  const cand = { start_bp: 10_000_000, end_bp: 10_100_000 };
  const r = boundaryScanRange({}, cand, null, 99_999_999_999);
  check('chromLen above scan: no clamp',        r.end_bp === 11_600_000);
}

// =====================================================================
group('boundaryScanRange — with state.data.windows');
{
  // windows.start_bp = [0, 1000, 2000, 3000, 4000]
  // windows.end_bp   = [1000, 2000, 3000, 4000, 5000]
  const state = {
    data: {
      windows: {
        start_bp: new Int32Array([0, 1000, 2000, 3000, 4000]),
        end_bp:   new Int32Array([1000, 2000, 3000, 4000, 5000]),
      },
    },
  };
  const cand = { start_bp: 1500, end_bp: 2500 };
  // Default radius is 1.5 Mb >> chrom length, so scan covers whole panel
  const r = boundaryScanRange(state, cand, 100, null);
  check('with windows: win_lo computed',         r.win_lo >= 0);
  check('with windows: win_hi >= win_lo',        r.win_hi >= r.win_lo);
  // scan: start_bp = 1500-100 = 1400, end_bp = 2500+100 = 2600
  // bsearchWin(start_bp, 1400, 'lo') = first index >= 1400 → 2 (arr[2]=2000? wait...)
  // Actually: arr=[0, 1000, 2000, 3000, 4000]. 1400: arr[0]=0<1400, arr[1]=1000<1400, arr[2]=2000>=1400 → lo=2
  // bsearchWin(end_bp, 2600, 'hi') = last index <= 2600 → arr=[1000,2000,3000,4000,5000]; 2000<=2600, 3000>2600 → 1
  // win_hi = max(2, 1) = 2
  check('precise win_lo for example',            r.win_lo === 2);
  check('precise win_hi (clamped to win_lo)',    r.win_hi === 2);
}

// =====================================================================
group('findSVAnchorsInZone');
{
  const row = {
    tracks: {
      sv_anchors: [
        { kind: 'INV', pos_bp: 1000, qual: 60, ct: '3to3' },
        { kind: 'DEL', pos_bp: 2000, qual: 50 },
        { kind: 'INV', pos_bp: 3000 },     // no qual, no ct
        { kind: 'INV', pos_bp: 4000, qual: 30, ct: '5to5' },
      ],
    },
  };
  const r = findSVAnchorsInZone(row, 1500, 3500);
  check('returns 2 anchors in zone',             r.length === 2);
  check('anchor 0: pos_bp = 2000',               r[0].pos_bp === 2000);
  check('anchor 1: pos_bp = 3000',               r[1].pos_bp === 3000);
  check('kind preserved',                        r[0].kind === 'DEL' && r[1].kind === 'INV');
  check('qual preserved (50)',                   r[0].qual === 50);
  check('missing qual → null',                   r[1].qual === null);
  check('missing ct → null',                     r[1].ct === null);
}
{
  // Inclusive endpoints
  const row = { tracks: { sv_anchors: [
    { kind: 'INV', pos_bp: 1000 },
    { kind: 'INV', pos_bp: 5000 },
  ] } };
  const r = findSVAnchorsInZone(row, 1000, 5000);
  check('inclusive start',                       r.some(a => a.pos_bp === 1000));
  check('inclusive end',                         r.some(a => a.pos_bp === 5000));
}
{
  // Returns copies (not references)
  const row = { tracks: { sv_anchors: [
    { kind: 'INV', pos_bp: 1000, qual: 50, ct: '3to3' },
  ] } };
  const r = findSVAnchorsInZone(row, 0, 9999);
  check('returns copies',                        r[0] !== row.tracks.sv_anchors[0]);
}
{
  // Anchors with no pos_bp dropped
  const row = { tracks: { sv_anchors: [
    { kind: 'INV', pos_bp: 1000 },
    { kind: 'DEL' },                      // no pos_bp
    null,                                 // null entry
  ] } };
  const r = findSVAnchorsInZone(row, 0, 9999);
  check('null + no-pos_bp dropped',              r.length === 1);
}
check('null row → []',                         findSVAnchorsInZone(null, 0, 100).length === 0);
check('no tracks → []',                        findSVAnchorsInZone({}, 0, 100).length === 0);
check('no sv_anchors → []',
      findSVAnchorsInZone({ tracks: {} }, 0, 100).length === 0);
check('sv_anchors not array → []',
      findSVAnchorsInZone({ tracks: { sv_anchors: 'oops' } }, 0, 100).length === 0);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
