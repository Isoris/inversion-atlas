// tests/test_shared_candidate_lanes.js
//
// Unit coverage for shared/candidate_lanes.js — lane-stacking helper
// for overlapping candidates (legacy lines 32503-32562).

import * as CL from '../atlases/inversion/shared/candidate_lanes.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('assignCandidateLanes: empty / null');
check('empty list: n_lanes = 1',
      CL.assignCandidateLanes([]).n_lanes === 1);
check('empty list: empty Map',
      CL.assignCandidateLanes([]).assignments.size === 0);
check('null: n_lanes = 1',
      CL.assignCandidateLanes(null).n_lanes === 1);
check('non-array: n_lanes = 1',
      CL.assignCandidateLanes({}).n_lanes === 1);

// -----------------------------------------------------------------------------
group('assignCandidateLanes: non-overlapping');
const cands1 = [
  { id: 'a', start_w: 0,  end_w: 10 },
  { id: 'b', start_w: 20, end_w: 30 },
  { id: 'c', start_w: 40, end_w: 50 },
];
const r1 = CL.assignCandidateLanes(cands1);
check('3 non-overlapping: 1 lane',     r1.n_lanes === 1);
check('all in lane 0',
      r1.assignments.get('a') === 0
      && r1.assignments.get('b') === 0
      && r1.assignments.get('c') === 0);

// -----------------------------------------------------------------------------
group('assignCandidateLanes: overlapping');
const cands2 = [
  { id: 'a', start_w: 0,  end_w: 30 },
  { id: 'b', start_w: 20, end_w: 50 },   // overlaps a
  { id: 'c', start_w: 40, end_w: 60 },   // overlaps b but not a (40 > 30)
];
const r2 = CL.assignCandidateLanes(cands2);
check('2 lanes needed',                r2.n_lanes === 2);
check('a in lane 0',                   r2.assignments.get('a') === 0);
check('b in lane 1',                   r2.assignments.get('b') === 1);
check('c re-uses lane 0 (40>30)',      r2.assignments.get('c') === 0);

// Edge case: touching candidates (a.end_w === b.start_w) reuse the lane
// per legacy convention ("strict start_w > previous end_w").
// Actually the test is the OPPOSITE — touching does NOT reuse since
// `c.start_w > lanes[i]` requires strict gt. Let me double check.
const candsTouch = [
  { id: 'a', start_w: 0,  end_w: 10 },
  { id: 'b', start_w: 10, end_w: 20 },   // touches a (start_w === a.end_w)
];
const rT = CL.assignCandidateLanes(candsTouch);
// b.start_w (10) > a.end_w (10) is FALSE → b doesn't fit lane 0 → lane 1
check('touching candidates: separate lanes (strict gt)',
      rT.n_lanes === 2);

// -----------------------------------------------------------------------------
group('assignCandidateLanes: greedy first-fit');
// Many overlapping candidates — verify lane count is minimal
const cands3 = [
  { id: 'a', start_w: 0,  end_w: 100 },
  { id: 'b', start_w: 10, end_w: 90 },
  { id: 'c', start_w: 20, end_w: 80 },
  { id: 'd', start_w: 30, end_w: 70 },   // all 4 overlap
];
const r3 = CL.assignCandidateLanes(cands3);
check('4 mutually overlapping → 4 lanes',  r3.n_lanes === 4);

// -----------------------------------------------------------------------------
group('assignCandidateLanes: sort stability');
// Same start_w → sort by id lexicographically (Z then A → A first)
const candsTie = [
  { id: 'zzz', start_w: 0, end_w: 10 },
  { id: 'aaa', start_w: 0, end_w: 5 },
];
const rTie = CL.assignCandidateLanes(candsTie);
// aaa places first (lane 0), zzz doesn't fit (start_w=0 not > 5) → lane 1
check('id tiebreaker: aaa first',
      rTie.assignments.get('aaa') === 0
      && rTie.assignments.get('zzz') === 1);

// -----------------------------------------------------------------------------
group('assignCandidateLanes: skip invalid');
const candsBad = [
  { id: 'a', start_w: 0, end_w: 10 },
  { id: 'b' /* missing start_w + end_w */ },
  { id: 'c', start_w: 'x', end_w: 20 },  // non-integer
  null,
  { id: 'd', start_w: 50, end_w: 60 },
];
const rBad = CL.assignCandidateLanes(candsBad);
check('invalid entries skipped',     rBad.assignments.size === 2);
check('valid entries still assigned',
      rBad.assignments.get('a') === 0 && rBad.assignments.get('d') === 0);

// -----------------------------------------------------------------------------
group('candidateAtClick: hit-test');
const cands4 = [
  { id: 'a', start_w: 0,  end_w: 2 },
  { id: 'b', start_w: 5,  end_w: 7 },
];
const windows = [
  { center_mb: 0.0 }, { center_mb: 0.5 }, { center_mb: 1.0 },
  { center_mb: 1.5 }, { center_mb: 2.0 }, { center_mb: 2.5 },
  { center_mb: 3.0 }, { center_mb: 3.5 },
];
// toX maps mb [0..3.5] → px [0..700]
const toX = (mb) => mb * 200;

// Click on candidate a (lane 0): x in [0, 200], y in [0, 20]
const hitA = CL.candidateAtClick(100, 10, 0, 20, toX, cands4, windows);
check('click on cand a returns a',  hitA && hitA.id === 'a');

// Click outside y region
check('click above bar → null',     CL.candidateAtClick(100, -5, 0, 20, toX, cands4, windows) === null);
check('click below bar → null',     CL.candidateAtClick(100, 25, 0, 20, toX, cands4, windows) === null);

// Click in gap between a and b (x=400 = 2 Mb, after a, before b)
check('click in gap → null',        CL.candidateAtClick(400, 10, 0, 20, toX, cands4, windows) === null);

// Empty list
check('empty list → null',          CL.candidateAtClick(100, 10, 0, 20, toX, [], windows) === null);
check('null cands → null',          CL.candidateAtClick(100, 10, 0, 20, toX, null, windows) === null);
check('null windows → null',        CL.candidateAtClick(100, 10, 0, 20, toX, cands4, null) === null);
check('null toX → null',            CL.candidateAtClick(100, 10, 0, 20, null, cands4, windows) === null);

// Overlapping candidates: click on lane 1 returns the lane-1 candidate
const cands5 = [
  { id: 'a', start_w: 0, end_w: 5 },
  { id: 'b', start_w: 2, end_w: 7 },   // overlaps a, goes to lane 1
];
const r5 = CL.assignCandidateLanes(cands5);
check('cands5: 2 lanes',            r5.n_lanes === 2);
// y=15 is in lane 1 (top half lane 0, bottom half lane 1 with h_total=20)
const hitB = CL.candidateAtClick(500, 15, 0, 20, toX, cands5, windows);
check('click in lane 1: returns b', hitB && hitB.id === 'b');

const hitANeg = CL.candidateAtClick(500, 5, 0, 20, toX, cands5, windows);
check('click in lane 0 over a: returns a', hitANeg && hitANeg.id === 'a');

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
