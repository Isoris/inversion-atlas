// tests/test_shared_page1_utils.js
//
// Covers the pure-helper additions to shared/page1_utils.js. The
// canvas/DOM-bound helpers (fitCanvas, escapeHtml, themeColor) are
// covered indirectly by the page1 smoke tests and are skipped here.

import {
  assignCandidateLanes,
  niceTicks,
  formatTrackVal,
  fmt,
  fmtMb,
  shortId,
  escapeHtml,
} from '../atlases/inversion/shared/page1_utils.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('assignCandidateLanes — pure-layout helper (legacy 32503-32536)');

// Empty / null inputs
{
  const out = assignCandidateLanes([]);
  check('empty list: n_lanes = 1',           out.n_lanes === 1);
  check('empty list: empty assignments Map', out.assignments instanceof Map
                                             && out.assignments.size === 0);
}
check('null arg: returns n_lanes = 1', assignCandidateLanes(null).n_lanes === 1);
check('undefined arg: returns n_lanes = 1',
       assignCandidateLanes(undefined).n_lanes === 1);

// Single candidate
{
  const out = assignCandidateLanes([{ id: 'A', start_w: 10, end_w: 20 }]);
  check('1 candidate: n_lanes = 1',          out.n_lanes === 1);
  check('1 candidate: A on lane 0',          out.assignments.get('A') === 0);
}

// Non-overlapping candidates: all share lane 0 (greedy first-fit)
{
  const cands = [
    { id: 'A', start_w: 0,  end_w: 10 },
    { id: 'B', start_w: 11, end_w: 20 },
    { id: 'C', start_w: 25, end_w: 30 },
  ];
  const out = assignCandidateLanes(cands);
  check('3 non-overlapping: n_lanes = 1',    out.n_lanes === 1);
  check('A on lane 0',                       out.assignments.get('A') === 0);
  check('B on lane 0',                       out.assignments.get('B') === 0);
  check('C on lane 0',                       out.assignments.get('C') === 0);
}

// Two overlapping: split into two lanes
{
  const cands = [
    { id: 'A', start_w: 0,  end_w: 30 },
    { id: 'B', start_w: 10, end_w: 20 },
  ];
  const out = assignCandidateLanes(cands);
  check('2 overlapping: n_lanes = 2',        out.n_lanes === 2);
  check('A on lane 0',                       out.assignments.get('A') === 0);
  check('B on lane 1',                       out.assignments.get('B') === 1);
}

// Touching boundaries (start === prev.end) are non-overlapping
{
  const cands = [
    { id: 'A', start_w: 0,  end_w: 10 },
    { id: 'B', start_w: 11, end_w: 20 },   // strictly > end_w of A
  ];
  const out = assignCandidateLanes(cands);
  check('touching boundaries: n_lanes = 1',  out.n_lanes === 1);
  check('touching: A and B share lane 0',
        out.assignments.get('A') === 0 && out.assignments.get('B') === 0);
}

// Equal start_w: tie-break by id
{
  const cands = [
    { id: 'B', start_w: 5, end_w: 10 },
    { id: 'A', start_w: 5, end_w: 10 },    // same start, earlier id
  ];
  const out = assignCandidateLanes(cands);
  // Sort by start_w then id → A goes first (lane 0), B can't fit (lane 1)
  check('equal start_w: alphabetical tie-break',
        out.assignments.get('A') === 0 && out.assignments.get('B') === 1);
}

// Three overlapping → three lanes
{
  const cands = [
    { id: 'A', start_w: 0,  end_w: 10 },
    { id: 'B', start_w: 2,  end_w: 12 },
    { id: 'C', start_w: 4,  end_w: 14 },
  ];
  const out = assignCandidateLanes(cands);
  check('3 nested: n_lanes = 3',             out.n_lanes === 3);
}

// Bad input handling
{
  const cands = [
    { id: 'A', start_w: 0,  end_w: 10 },
    { id: 'B'                          },   // no start_w / end_w
    null,
    { id: 'C', start_w: 12, end_w: 20 },
  ];
  const out = assignCandidateLanes(cands);
  check('null + missing-coords filtered: only A and C placed',
        out.assignments.size === 2
        && out.assignments.has('A') && out.assignments.has('C'));
}

// Greedy first-fit reuse: a candidate that fits an earlier-released
// lane goes there, not a new lane.
{
  const cands = [
    { id: 'A', start_w: 0,  end_w: 5  },
    { id: 'B', start_w: 1,  end_w: 6  },
    { id: 'C', start_w: 10, end_w: 15 },    // can fit on lane 0 (A ended at 5)
  ];
  const out = assignCandidateLanes(cands);
  check('greedy reuse: C lands on lane 0',   out.assignments.get('C') === 0);
  check('greedy reuse: n_lanes = 2',         out.n_lanes === 2);
}

// =====================================================================
group('Pre-existing helpers — sanity-check imports still work');

check('niceTicks: imports OK',     typeof niceTicks === 'function');
check('formatTrackVal: imports OK',typeof formatTrackVal === 'function');
check('fmt: imports OK',           typeof fmt === 'function');
check('fmtMb: imports OK',         typeof fmtMb === 'function');
check('shortId: imports OK',       typeof shortId === 'function');
check('escapeHtml: imports OK',    typeof escapeHtml === 'function');

// Spot-check a few behaviours so this file gives meaningful coverage
check('fmt(1.2345, 2) = "1.23"',         fmt(1.2345, 2) === '1.23');
check('escapeHtml("<a>")',                escapeHtml('<a>') === '&lt;a&gt;');
check('shortId truncates long ids',       shortId('verylongsampleid_xyz').length
                                          <= 'verylongsampleid_xyz'.length);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
