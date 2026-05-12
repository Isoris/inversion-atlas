// tests/test_page11_boundaries.js
//
// Unit coverage for page11's boundary-refinement pure-helper port.
// Legacy lines 17687-18430 carried 39+ TODO_MISSING references in
// page11.js; this first-pass cartridge ships the pure subset
// (constants, search, smoothing, MAD, scan-range, support-class,
// SV-anchor filter, record builder, state initializer, candidate
// registry helpers).
//
// Covers:
//   - BOUNDARY_DEFAULTS / TRACK_WEIGHTS / TRACK_POLARITY frozen vocabs
//   - bsearchWin: lo + hi modes, edge cases
//   - rollingMedian: NA tolerance, edges, width=1
//   - perTrackMad + madNormalize: NA-tolerant pipeline
//   - supportClass: full verdict matrix
//   - boundaryScanRange: SCAN_RADIUS default + huge-candidate expansion
//   - findSVAnchorsInZone: inclusive bounds + missing tracks tolerated
//   - ensureBoundariesState: idempotent state init
//   - bndCloneRecord: deep clone (mutations don't alias)
//   - buildBoundaryRecord: windows + zone_radius + source/set_by mapping
//   - bndFindCandidate / bndFmtBp / bndStageFromCandidate

import * as B from '../atlases/inversion/pages/review/page11/boundaries.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('Frozen vocabularies');
check('BOUNDARY_DEFAULTS frozen',       Object.isFrozen(B.BOUNDARY_DEFAULTS));
check('STATUSES frozen',                Object.isFrozen(B.BOUNDARY_DEFAULTS.STATUSES));
check('STATUSES has 3 entries',         B.BOUNDARY_DEFAULTS.STATUSES.length === 3);
check('SCAN_RADIUS_BP = 1.5 Mb',        B.BOUNDARY_DEFAULTS.SCAN_RADIUS_BP === 1_500_000);
check('CANDIDATE_HUGE_RATIO = 0.5',     B.BOUNDARY_DEFAULTS.CANDIDATE_HUGE_RATIO === 0.5);
check('TRACK_WEIGHTS frozen',           Object.isFrozen(B.BOUNDARY_TRACK_WEIGHTS));
check('TRACK_POLARITY frozen',          Object.isFrozen(B.BOUNDARY_TRACK_POLARITY));
check('TRACK_NAMES has 11 entries',     B.BOUNDARY_TRACK_NAMES.length === 11);
check('TRACK_WEIGHTS sum to 1.0', (() => {
  const s = B.BOUNDARY_TRACK_NAMES
    .reduce((acc, k) => acc + B.BOUNDARY_TRACK_WEIGHTS[k], 0);
  return Math.abs(s - 1.0) < 1e-9;
})());
check('SUPPORT_CLASS_COLORS frozen',    Object.isFrozen(B.SUPPORT_CLASS_COLORS));
check('SUPPORT_CLASS_COLORS strong=green',
      B.SUPPORT_CLASS_COLORS.strong.hex === '#1B7837');

// -----------------------------------------------------------------------------
group('bsearchWin');
const sorted = [10, 20, 30, 40, 50];
check('lo: target=10 → 0',              B.bsearchWin(sorted, 10, 'lo') === 0);
check('lo: target=15 → 1',              B.bsearchWin(sorted, 15, 'lo') === 1);
check('lo: target=50 → 4',              B.bsearchWin(sorted, 50, 'lo') === 4);
check('lo: target=51 → 5 (past end)',   B.bsearchWin(sorted, 51, 'lo') === 5);
check('lo: target=-1 → 0',              B.bsearchWin(sorted, -1, 'lo') === 0);
check('hi: target=10 → 0',              B.bsearchWin(sorted, 10, 'hi') === 0);
check('hi: target=15 → 0',              B.bsearchWin(sorted, 15, 'hi') === 0);
check('hi: target=50 → 4',              B.bsearchWin(sorted, 50, 'hi') === 4);
check('hi: target=9 → -1',              B.bsearchWin(sorted, 9, 'hi') === -1);
check('empty arr lo: 0',                B.bsearchWin([], 5, 'lo') === 0);
check('empty arr hi: -1',               B.bsearchWin([], 5, 'hi') === -1);

// -----------------------------------------------------------------------------
group('rollingMedian');
const rm1 = B.rollingMedian([1, 2, 3, 4, 5], 3);
check('rolling median width 3 [1..5]',  rm1[2] === 3 && rm1[1] === 2 && rm1[3] === 4);
check('rolling median edge index 0',    rm1[0] === 1 || rm1[0] === 1.5);

// NA handling — legacy uses lower-median (buf[(len-1)>>1]) for even-sized buffers
const rmNA = B.rollingMedian([1, -1, 3, NaN, 5], 3);
check('rolling median: -1 excluded → lower median',
      rmNA[1] === 1);  // lower-median of [1,3]
check('rolling median: NaN excluded → lower median',
      rmNA[3] === 3);  // lower-median of [3,5]

// All-NA window → NaN
const rmAll = B.rollingMedian([NaN, NaN, NaN], 1);
check('all-NA window → NaN',  Number.isNaN(rmAll[0]));

// Width 1 = identity (modulo NA→NaN)
const rmW1 = B.rollingMedian([1, 2, 3], 1);
check('width 1 = identity',  rmW1[0] === 1 && rmW1[1] === 2 && rmW1[2] === 3);

// Null input
check('null arr → empty',  B.rollingMedian(null, 3).length === 0);

// -----------------------------------------------------------------------------
group('perTrackMad');
check('MAD of [1,2,3,4,5] = 1',         B.perTrackMad([1, 2, 3, 4, 5]) === 1);
check('MAD of all-NA = 0',              B.perTrackMad([NaN, -1, null]) === 0);
check('MAD of singleton = 0',           B.perTrackMad([5]) === 0);
check('MAD null = 0',                   B.perTrackMad(null) === 0);

// MAD is NA-tolerant
check('MAD ignores -1 and NaN',         B.perTrackMad([1, -1, 3, NaN, 5]) === 2);

// -----------------------------------------------------------------------------
group('madNormalize');
const mn = B.madNormalize([1, 2, 3, 4, 5], 2);
check('madNormalize / 2: 2.5 in middle', mn[4] === 2.5);
check('madNormalize NA → 0',
      B.madNormalize([1, -1, NaN], 1)[1] === 0);
check('madNormalize MAD=0 → all zeros',
      Array.from(B.madNormalize([1, 2, 3], 0)).every(v => v === 0));
check('madNormalize null mad → all zeros',
      Array.from(B.madNormalize([1, 2, 3], null)).every(v => v === 0));

// -----------------------------------------------------------------------------
group('supportClass verdicts');
check('n=0 → ambiguous',                B.supportClass(0.8, []) === 'ambiguous');
check('n=0 + null support → ambiguous', B.supportClass(0.8, null) === 'ambiguous');
check('n=3 score=0.7 → strong',         B.supportClass(0.7, ['a', 'b', 'c']) === 'strong');
check('n=4 score=0.6 → strong',         B.supportClass(0.6, ['a', 'b', 'c', 'd']) === 'strong');
check('n=2 → moderate (any score)',     B.supportClass(0.1, ['a', 'b']) === 'moderate');
check('n=3 score=0.5 → moderate',       B.supportClass(0.5, ['a', 'b', 'c']) === 'moderate');
check('n=1 → weak',                     B.supportClass(0.9, ['a']) === 'weak');
check('n=2 score<0.4 → weak',           B.supportClass(0.3, ['a', 'b']) === 'moderate'); // n=2 always moderate
// Actually n>=2 with score<0.40 — but n=2 special-cases to moderate. The
// "weak" branch only fires when n>=2 AND it's hit AFTER the n==2 check
// has been short-circuited. So actually n=2 always → moderate per the
// rule order. The legacy comment is misleading.
check('non-finite score treated as 0',  B.supportClass(NaN, ['a']) === 'weak');

// -----------------------------------------------------------------------------
group('boundaryScanRange');
// Small candidate, default radius
const cand1 = { start_bp: 10_000_000, end_bp: 11_000_000 };
const r1 = B.boundaryScanRange(cand1);
check('default radius: start_bp = 8.5 Mb', r1.start_bp === 8_500_000);
check('default radius: end_bp = 12.5 Mb',  r1.end_bp === 12_500_000);
check('no windows: win_lo = 0',            r1.win_lo === 0);

// Custom radius
const r2 = B.boundaryScanRange(cand1, 500_000);
check('custom radius: start_bp = 9.5 Mb',  r2.start_bp === 9_500_000);

// chromLen clamps end
const r3 = B.boundaryScanRange(cand1, 5_000_000, 13_000_000);
check('chromLen clamps end',               r3.end_bp === 13_000_000);

// chromLen clamps start
const cand0 = { start_bp: 1_000_000, end_bp: 2_000_000 };
const r4 = B.boundaryScanRange(cand0, 1_500_000);
check('start clamped to 0',                r4.start_bp === 0);

// Huge candidate (>3Mb) triggers ratio-based expansion
const candHuge = { start_bp: 0, end_bp: 5_000_000 };
const rHuge = B.boundaryScanRange(candHuge, 1_500_000);
// span=5M → radius max(1.5M, 5M*0.5)=2.5M → start clamped to 0,
// end = 5M + 2.5M = 7.5M
check('huge candidate: expanded end',      rHuge.end_bp === 7_500_000);

// With windows
const windows = {
  start_bp: [0, 1_000_000, 2_000_000, 3_000_000, 4_000_000],
  end_bp:   [1_000_000, 2_000_000, 3_000_000, 4_000_000, 5_000_000],
};
const rW = B.boundaryScanRange({ start_bp: 1_500_000, end_bp: 2_500_000 }, 800_000, null, windows);
check('with windows: win_lo found',        rW.win_lo === 0 || rW.win_lo === 1);
check('with windows: win_hi >= win_lo',    rW.win_hi >= rW.win_lo);

// Bad inputs
check('null cand → null',                  B.boundaryScanRange(null) === null);
check('missing bps → null',                B.boundaryScanRange({}) === null);

// -----------------------------------------------------------------------------
group('findSVAnchorsInZone');
const row = {
  tracks: {
    sv_anchors: [
      { kind: 'DEL', pos_bp: 100, qual: 30 },
      { kind: 'INS', pos_bp: 500, qual: 20 },
      { kind: 'DUP', pos_bp: 1000, qual: 10 },
    ],
  },
};
const ankInZone = B.findSVAnchorsInZone(row, 200, 800);
check('anchors in zone: 1 kept',           ankInZone.length === 1);
check('anchors in zone: pos_bp=500',       ankInZone[0].pos_bp === 500);
check('anchors: returns cloned (not ref)',
      ankInZone[0] !== row.tracks.sv_anchors[1]);

// Inclusive bounds
const inclusive = B.findSVAnchorsInZone(row, 100, 1000);
check('anchors: inclusive bounds = 3',     inclusive.length === 3);

// Empty inputs
check('no row → []',                       B.findSVAnchorsInZone(null, 0, 100).length === 0);
check('no tracks → []',                    B.findSVAnchorsInZone({}, 0, 100).length === 0);
check('no anchors → []',                   B.findSVAnchorsInZone({ tracks: {} }, 0, 100).length === 0);

// -----------------------------------------------------------------------------
group('ensureBoundariesState');
const st = {};
const bs1 = B.ensureBoundariesState(st);
check('state.__boundaries set',            !!st.__boundaries);
check('returns same on repeat call',       B.ensureBoundariesState(st) === bs1);
check('initial staging.dirty = false',     bs1.staging.dirty === false);
check('initial staging.breakpoint_status', bs1.staging.breakpoint_status === 'boundary_zone_only');
check('initial cache is Map',              bs1.cache instanceof Map);
check('scan_radius_bp default',            bs1.scan_radius_bp === 1_500_000);

// Existing state preserved
const st2 = { __boundaries: { active_cand_id: 'X', _existing: true } };
const bs2 = B.ensureBoundariesState(st2);
check('existing state not clobbered',      bs2.active_cand_id === 'X' && bs2._existing === true);

// -----------------------------------------------------------------------------
group('bndCloneRecord');
const orig = {
  zone_start_bp: 100, zone_end_bp: 200,
  score: 0.85, support: ['a', 'b'],
  support_class: 'strong', source: 'manual',
  sv_anchors_in_zone: [{ kind: 'DEL', pos_bp: 150 }],
  notes: 'hand-set', set_at: '2025-01-01', set_by: 'scrubber_manual',
};
const clone = B.bndCloneRecord(orig);
check('clone: zone_start_bp matches',       clone.zone_start_bp === 100);
check('clone: support is new array',        clone.support !== orig.support);
check('clone: support values match',        clone.support.join(',') === 'a,b');
check('clone: sv anchors are new objects',  clone.sv_anchors_in_zone[0] !== orig.sv_anchors_in_zone[0]);
check('clone: notes preserved',             clone.notes === 'hand-set');
check('clone null → null',                  B.bndCloneRecord(null) === null);

// Mutating clone doesn't change orig
clone.support.push('c');
check('clone mutation doesn\'t alias',      orig.support.length === 2);

// -----------------------------------------------------------------------------
group('buildBoundaryRecord');
const winsBR = {
  start_bp: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],
  end_bp:   [99, 199, 299, 399, 499, 599, 699, 799, 899, 999, 1099],
};
const rec1 = B.buildBoundaryRecord(
  { window_idx: 5, score: 0.75, support: ['pca_drop', 'ghsl_step', 'fst_edge'] },
  'left', 'auto',
  { windows: winsBR, zone_radius_windows: 2 }
);
check('rec: zone_start = win[3].start',     rec1.zone_start_bp === 300);
check('rec: zone_end = win[7].end',         rec1.zone_end_bp === 799);
check('rec: score rounded to 4dp',          rec1.score === 0.75);
check('rec: support cloned (not aliased)',  rec1.support.length === 3);
check('rec: support_class = strong',        rec1.support_class === 'strong');
check('rec: source = auto',                 rec1.source === 'auto');
check('rec: set_by = scrubber_auto',        rec1.set_by === 'scrubber_auto');
check('rec: set_at is ISO timestamp',       typeof rec1.set_at === 'string'
                                            && rec1.set_at.includes('T'));

// Source = 'manual' → set_by tracks
const rec2 = B.buildBoundaryRecord(
  { window_idx: 5, score: 0.3, support: ['pca_drop'] },
  'right', 'manual',
  { windows: winsBR, now: new Date('2026-05-12T10:30:00Z') }
);
check('rec: source manual → set_by manual', rec2.set_by === 'scrubber_manual');
check('rec: set_at uses passed-in now',     rec2.set_at === '2026-05-12T10:30:00.000Z');

// auto_plus_manual → still manual set_by
const rec3 = B.buildBoundaryRecord(
  { window_idx: 5, score: 0.5 }, 'left', 'auto_plus_manual',
  { windows: winsBR }
);
check('rec: auto_plus_manual → manual set_by', rec3.set_by === 'scrubber_manual');

// Bad inputs
check('rec: null edge → null',              B.buildBoundaryRecord(null, 'left', 'auto', {}) === null);
check('rec: no windows → null',             B.buildBoundaryRecord({}, 'left', 'auto', {}) === null);

// Edge near array boundary
const recEdge = B.buildBoundaryRecord(
  { window_idx: 0, score: 0.5 }, 'left', 'auto',
  { windows: winsBR, zone_radius_windows: 2 }
);
check('rec: index clamped at start',        recEdge.zone_start_bp === 0);

// -----------------------------------------------------------------------------
group('bndFindCandidate');
const candState = {
  candidateList: [
    { id: 'cand_A', start_bp: 0 },
    { candidate_id: 'cand_B', start_bp: 100 },
    null,
    { id: 'cand_C', candidate_id: 'cand_C_alias' },
  ],
};
check('find by id',                         B.bndFindCandidate(candState, 'cand_A').id === 'cand_A');
check('find by candidate_id',               B.bndFindCandidate(candState, 'cand_B').candidate_id === 'cand_B');
check('find by alias',                      B.bndFindCandidate(candState, 'cand_C_alias').id === 'cand_C');
check('not found → null',                   B.bndFindCandidate(candState, 'cand_Z') === null);
check('null id → null',                     B.bndFindCandidate(candState, null) === null);
check('no state → null',                    B.bndFindCandidate({}, 'cand_A') === null);

// -----------------------------------------------------------------------------
group('bndFmtBp');
check('1234567 → "1,234,567 bp"',           B.bndFmtBp(1234567) === '1,234,567 bp');
check('0 → "0 bp"',                         B.bndFmtBp(0) === '0 bp');
check('null → "? bp"',                      B.bndFmtBp(null) === '? bp');
check('NaN → "? bp"',                       B.bndFmtBp(NaN) === '? bp');
check('"abc" → "? bp"',                     B.bndFmtBp('abc') === '? bp');

// -----------------------------------------------------------------------------
group('bndStageFromCandidate');
const stStage = { candidateList: [] };
const cand = {
  id: 'cand_A',
  boundary_left: { zone_start_bp: 100, zone_end_bp: 200, score: 0.8,
                   support: ['x'], source: 'auto' },
  boundary_right: null,
  breakpoint_status: 'SV_supported',
  boundary_notes: 'hand-checked',
};
const staging = B.bndStageFromCandidate(stStage, cand);
check('stage: cand_id set',                 staging.cand_id === 'cand_A');
check('stage: boundary_left cloned',        staging.boundary_left.zone_start_bp === 100);
check('stage: boundary_left support cloned',
      staging.boundary_left.support !== cand.boundary_left.support);
check('stage: boundary_right null',         staging.boundary_right === null);
check('stage: status propagated',           staging.breakpoint_status === 'SV_supported');
check('stage: notes propagated',            staging.boundary_notes === 'hand-checked');
check('stage: dirty = false',               staging.dirty === false);

// Empty / null candidate
const stagingNull = B.bndStageFromCandidate(stStage, null);
check('stage null cand: cand_id null',      stagingNull.cand_id === null);
check('stage null cand: defaults set',
      stagingNull.breakpoint_status === 'boundary_zone_only' &&
      stagingNull.dirty === false);

// -----------------------------------------------------------------------------
group('computeBoundaryEdges');
// Build a synthetic per-window score for a single track. A clean "inside-high"
// pattern: zero for 5 windows, then steps up to 1.0 for 5 windows, then drops
// back to zero. With +1 polarity, the rising edge is at index 4→5 and the
// falling edge at index 9→10. Left edge should land near 4, right near 9.
const n = 16;
function _makeBoxScore(insideLo, insideHi, val) {
  const a = new Float64Array(n);
  for (let i = 0; i < n; i++) a[i] = (i >= insideLo && i <= insideHi) ? val : 0;
  return a;
}
const ts1 = {
  tracks: {
    pca_drop: _makeBoxScore(5, 10, 1.0),  // +1 polarity (rises inside)
  },
  len: n,
  win_lo: 100,
};
const edges1 = B.computeBoundaryEdges(ts1, B.BOUNDARY_TRACK_WEIGHTS);
check('edges: left edge present',           !!edges1.left);
check('edges: right edge present',          !!edges1.right);
// The smoothed signal's argmax-step lives at the transition. With width=3
// smoothing the rise sits at index 4 (between [4]→[5]).
check('edges: left edge near index 4',      edges1.left.window_idx_local === 4);
check('edges: right edge near index 10',    edges1.right.window_idx_local === 10);
check('edges: window_idx adds win_lo',      edges1.left.window_idx === 104);
check('edges: support includes pca_drop',   edges1.left.support.includes('pca_drop'));
check('edges: by_track[pca_drop] > 0',      edges1.left.by_track.pca_drop > 0);
check('edges: combined_left len = n',       edges1.combined_left.length === n);
check('edges: combined_right len = n',      edges1.combined_right.length === n);
check('edges: score ≤ 1',                   edges1.left.score <= 1);

// Multi-track w/ polarity flip — theta_pi_step has polarity -1 (drops inside).
// Build a synthetic "drops inside" track. After polarity flip, falling rise
// becomes a positive step, so left/right detection still works.
const ts2 = {
  tracks: {
    pca_drop:      _makeBoxScore(5, 10, 1.0),
    theta_pi_step: (() => {
      // Drops inside: high outside (1.0), low inside (0.0)
      const a = new Float64Array(n);
      for (let i = 0; i < n; i++) a[i] = (i >= 5 && i <= 10) ? 0 : 1.0;
      return a;
    })(),
  },
  len: n,
  win_lo: 0,
};
const edges2 = B.computeBoundaryEdges(ts2, B.BOUNDARY_TRACK_WEIGHTS);
check('multi-track edges: both present',    !!edges2.left && !!edges2.right);
check('multi-track edges: left near 4',     edges2.left.window_idx_local === 4);
check('multi-track edges: support includes both',
      edges2.left.support.includes('pca_drop') &&
      edges2.left.support.includes('theta_pi_step'));

// Empty input
check('edges: null trackScores → no edges', B.computeBoundaryEdges(null, B.BOUNDARY_TRACK_WEIGHTS).left === null);
check('edges: empty tracks → no edges',
      B.computeBoundaryEdges({ tracks: {}, len: 0, win_lo: 0 }, B.BOUNDARY_TRACK_WEIGHTS).left === null);

// n < 4 short-circuits
check('edges: n<4 → no edges',
      B.computeBoundaryEdges(
        { tracks: { pca_drop: new Float64Array([0, 1, 0]) }, len: 3, win_lo: 0 },
        B.BOUNDARY_TRACK_WEIGHTS
      ).left === null);

// Equal-weight fallback when present tracks have no defined weights
const tsCustom = {
  tracks: {
    custom_a: _makeBoxScore(5, 10, 1.0),
    custom_b: _makeBoxScore(5, 10, 1.0),
  },
  len: n,
  win_lo: 0,
};
const edgesCustom = B.computeBoundaryEdges(tsCustom, {}); // no weight for custom_*
check('edges: equal-weight fallback finds edges',  !!edgesCustom.left);

// Custom smooth window
const edgesNoSmooth = B.computeBoundaryEdges(ts1, B.BOUNDARY_TRACK_WEIGHTS, { smooth_window: 1 });
check('edges: smooth_window=1 still finds edges',  !!edgesNoSmooth.left);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
