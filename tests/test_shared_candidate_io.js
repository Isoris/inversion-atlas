// tests/test_shared_candidate_io.js
//
// Unit coverage for shared/candidate_io.js — candidate JSON round-trip
// (legacy lines 56789-57300).

import * as IO from '../atlases/inversion/shared/candidate_io.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('MAX_TRACKS + id minter');
check('MAX_TRACKS = 2',                  IO.MAX_TRACKS === 2);
const id1 = IO.makeCandidateId();
const id2 = IO.makeCandidateId();
check('makeCandidateId starts with cand_', id1.startsWith('cand_'));
check('two calls yield different ids',     id1 !== id2);

IO._resetCandIdCounter(0);
check('reset counter: no throw',           true);

// -----------------------------------------------------------------------------
group('defaultSingleTrack');
const dst = IO.defaultSingleTrack({ K: 6, confirmed: true, notes: 'hi' });
check('K=6 → active_bands [0..5]',         dst.active_bands.length === 6 && dst.active_bands[5] === 5);
check('confirmed propagated',              dst.confirmed === true);
check('notes propagated',                  dst.notes === 'hi');
check('track_idx = 0',                     dst.track_idx === 0);

const dstNoK = IO.defaultSingleTrack(null);
check('null cand → K=3 default',           dstNoK.active_bands.length === 3);

// -----------------------------------------------------------------------------
group('ensureTracks: synthesis + normalisation');
const candNoTracks = { K: 3 };
IO.ensureTracks(candNoTracks);
check('missing tracks → single-track default',
      candNoTracks.tracks.length === 1 && candNoTracks.tracks[0].active_bands.length === 3);

// Empty array → single-track default
const candEmpty = { K: 3, tracks: [] };
IO.ensureTracks(candEmpty);
check('empty tracks → single-track default',  candEmpty.tracks.length === 1);

// Cap at MAX_TRACKS
const candMany = { K: 3, tracks: [
  { track_idx: 0, active_bands: [0] },
  { track_idx: 1, active_bands: [1] },
  { track_idx: 2, active_bands: [2] },
] };
IO.ensureTracks(candMany);
check('truncates at MAX_TRACKS',           candMany.tracks.length === 2);

// Out-of-range bands filtered out
const candBad = { K: 3, tracks: [{ active_bands: [0, 5, -1, 2, 'x'] }] };
IO.ensureTracks(candBad);
check('out-of-range bands filtered',
      candBad.tracks[0].active_bands.join(',') === '0,2');

// Per-track normalisation
const candPart = { K: 3, tracks: [{ active_bands: [0] }] };
IO.ensureTracks(candPart);
const cleaned = candPart.tracks[0];
check('track_idx defaults to position',    cleaned.track_idx === 0);
check('regime_id defaults to null',        cleaned.regime_id === null);
check('confirmed defaults to false',       cleaned.confirmed === false);
check('notes defaults to empty string',    cleaned.notes === '');

// -----------------------------------------------------------------------------
group('candidateToJSON');
const cand = {
  id: 'cand_A', source: 'manual', chrom: 'LG28',
  l2_indices: new Int32Array([0, 1, 2]),
  ref_l2: 1, ref_window: 10,
  K: 3,
  locked_labels: new Int8Array([0, 1, 2, 0, 1, 2]),
  start_w: 0, end_w: 100,
  start_bp: 1000000, end_bp: 2000000,
  created_at: 1700000000,
  notes: 'note',
  confirmed: true,
  resolution: 'L2',
  l3_cuts: [50, 75],
  parent_split_id: 'split_X',
  aggregate_concordance: 0.85,
  band_continuity_pct: 0.92,
  band_continuity_verdict: 'GOOD',
  regime_counts: [10, 20, 30],
  fish_calls: ['a', 'b'],
  qc_status: 'PASS',
};
const json = IO.candidateToJSON(cand);
check('id propagated',                     json.id === 'cand_A');
check('l2_indices: typed → Array',         Array.isArray(json.l2_indices));
check('locked_labels: typed → Array',      Array.isArray(json.locked_labels) && json.locked_labels.length === 6);
check('confirmed bool',                    json.confirmed === true);
check('l3_cuts cloned',                    json.l3_cuts !== cand.l3_cuts && json.l3_cuts.length === 2);
check('regime_counts cloned',              json.regime_counts !== cand.regime_counts);
check('tracks synthesized when missing',   json.tracks.length === 1);

// Null candidate
check('null → null',                       IO.candidateToJSON(null) === null);

// Round-trip
const restored = IO.candidateFromJSON(json);
check('round-trip: id preserved',          restored.id === 'cand_A');
check('round-trip: K preserved',           restored.K === 3);
check('round-trip: locked_labels Int8Array',
      restored.locked_labels instanceof Int8Array);
check('round-trip: locked_labels values',  restored.locked_labels[3] === 0);
check('round-trip: confirmed preserved',   restored.confirmed === true);
check('round-trip: l3_cuts preserved',     restored.l3_cuts.join(',') === '50,75');
check('round-trip: l2_indices preserved',  restored.l2_indices.length === 3);
check('round-trip: tracks ensured',        restored.tracks.length === 1);

// -----------------------------------------------------------------------------
group('candidateFromJSON: missing-field back-compat');
const minimal = { K: 3 };
const minimalRestored = IO.candidateFromJSON(minimal);
check('missing id minted',                 minimalRestored.id.startsWith('cand_'));
check('missing resolution defaults L2',    minimalRestored.resolution === 'L2');
check('missing l3_cuts defaults []',       Array.isArray(minimalRestored.l3_cuts) && minimalRestored.l3_cuts.length === 0);
check('missing aggregate_concordance → undefined',
      minimalRestored.aggregate_concordance === undefined);
check('missing tracks → ensured default',
      minimalRestored.tracks.length === 1);

// W-resolution explicit
const wRes = IO.candidateFromJSON({ K: 3, resolution: 'W' });
check('explicit "W" preserved',            wRes.resolution === 'W');

// Other values fall through to L2
const badRes = IO.candidateFromJSON({ K: 3, resolution: 'mystery' });
check('unknown resolution → L2',           badRes.resolution === 'L2');

// Null input
check('null → null',                       IO.candidateFromJSON(null) === null);

// -----------------------------------------------------------------------------
group('candidateFromJSON: recomputePerTrackAssignments callback');
let recomputeCalled = false;
const recomputedCand = IO.candidateFromJSON({ K: 3 }, {
  recomputePerTrackAssignments: (cand) => { recomputeCalled = true; cand._touched = true; },
});
check('recompute callback fired',          recomputeCalled);
check('callback can mutate cand',          recomputedCand._touched === true);

// Callback that throws: silently swallowed
let safe = true;
try {
  IO.candidateFromJSON({ K: 3 }, {
    recomputePerTrackAssignments: () => { throw new Error('boom'); },
  });
} catch (_) { safe = false; }
check('throwing callback: swallowed',  safe);

// -----------------------------------------------------------------------------
group('Boundary records round-trip');
const candWithBoundaries = {
  K: 3,
  boundary_left: { zone_start_bp: 100, zone_end_bp: 200, score: 0.7,
                   support: ['x'], support_class: 'weak', source: 'manual',
                   sv_anchors_in_zone: [{ kind: 'DEL', pos_bp: 150 }],
                   notes: 'hand-set', set_at: '2025', set_by: 'scrubber_manual' },
  boundary_right: null,
};
const jsonB = IO.candidateToJSON(candWithBoundaries);
check('boundary_left cloned (not aliased)',
      jsonB.boundary_left !== candWithBoundaries.boundary_left
        && jsonB.boundary_left.zone_start_bp === 100);
check('boundary_left.support cloned',
      jsonB.boundary_left.support !== candWithBoundaries.boundary_left.support);
check('boundary_left.sv_anchors_in_zone cloned',
      jsonB.boundary_left.sv_anchors_in_zone[0] !== candWithBoundaries.boundary_left.sv_anchors_in_zone[0]);

const restoredB = IO.candidateFromJSON(jsonB);
check('round-trip: boundary_left preserved',
      restoredB.boundary_left.zone_start_bp === 100);

// -----------------------------------------------------------------------------
group('recomputePerTrackAssignments');
// Two-track candidate: bands 0..1 in track 0, bands 2..3 in track 1.
const twoTrack = {
  K: 4,
  regime_counts: [10, 20, 30, 40],
  fish_calls: [
    { fish: 'a', regime: 0 }, { fish: 'b', regime: 1 },
    { fish: 'c', regime: 2 }, { fish: 'd', regime: 3 },
    { fish: 'e', regime: -1 },  // ambiguous → dropped from BOTH tracks
  ],
  aggregate_concordance: 0.85,
  band_continuity_pct: 0.90,
  band_continuity_verdict: 'GOOD',
  tracks: [
    { track_idx: 0, active_bands: [0, 1], regime_counts: null, fish_calls: null },
    { track_idx: 1, active_bands: [2, 3], regime_counts: null, fish_calls: null },
  ],
};
IO.recomputePerTrackAssignments(twoTrack);
check('track 0: regime_counts derived',
      twoTrack.tracks[0].regime_counts.join(',') === '10,20,0,0');
check('track 1: regime_counts derived',
      twoTrack.tracks[1].regime_counts.join(',') === '0,0,30,40');
check('track 0: fish_calls filtered to bands 0,1',
      twoTrack.tracks[0].fish_calls.length === 2
        && twoTrack.tracks[0].fish_calls.every(f => f.regime === 0 || f.regime === 1));
check('track 1: fish_calls filtered to bands 2,3',
      twoTrack.tracks[1].fish_calls.length === 2);
check('ambiguous fish (regime=-1) dropped from both tracks',
      !twoTrack.tracks[0].fish_calls.some(f => f.fish === 'e')
        && !twoTrack.tracks[1].fish_calls.some(f => f.fish === 'e'));
check('aggregate_concordance copied to track',
      twoTrack.tracks[0].aggregate_concordance === 0.85);
check('band_continuity_verdict copied',
      twoTrack.tracks[1].band_continuity_verdict === 'GOOD');

// Single-track candidate: no-op
const singleTrack = { K: 3, tracks: [{ active_bands: [0, 1, 2], regime_counts: [10, 20, 30] }] };
const before = JSON.stringify(singleTrack.tracks[0].regime_counts);
IO.recomputePerTrackAssignments(singleTrack);
check('single-track: tracks unchanged',
      JSON.stringify(singleTrack.tracks[0].regime_counts) === before);

// One track has empty active_bands → not "true two-track" → no-op
const fakeTwoTrack = {
  K: 4,
  regime_counts: [1, 2, 3, 4],
  tracks: [
    { active_bands: [0, 1], regime_counts: [99] },  // unchanged
    { active_bands: [],     regime_counts: [88] },  // empty bands
  ],
};
IO.recomputePerTrackAssignments(fakeTwoTrack);
check('fake two-track (empty bands): no-op',
      fakeTwoTrack.tracks[0].regime_counts[0] === 99);

// Null candidate
let safeNull = true;
try { IO.recomputePerTrackAssignments(null); } catch (_) { safeNull = false; }
check('null cand: no-op no-throw',  safeNull);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
