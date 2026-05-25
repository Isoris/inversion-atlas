// tests/test_shared_ensure_chrom_tracks.js
//
// Behavior tests for shared/ensure_chrom_tracks.js. Pins the contract
// every page that calls ensureChromTracks now depends on (candidate_focus,
// catalogue, annotation_cockpit, marker_panels, marker_readiness,
// stats_profile, boundary_refinement).

import { ensureChromTracks } from '../atlases/inversion/shared/ensure_chrom_tracks.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

function makeRegistry(resolveFn) {
  return { resolve: resolveFn };
}

// =====================================================================
group('no-op cases');
{
  // No activeChrom at all.
  const r1 = await ensureChromTracks({ shared: {} }, makeRegistry(() => ({})));
  check('no activeChrom → ok:false, reason:no-active-chrom',
        r1 && r1.ok === false && r1.reason === 'no-active-chrom');

  // Tracks already present for the active chrom — should NOT re-resolve.
  let resolveCalls = 0;
  const r2 = await ensureChromTracks(
    {
      shared: { activeChrom: 'LG01' },
      inversion: { tracks: { LG01: { chrom: 'LG01', precomputed: true } } },
    },
    makeRegistry(() => { resolveCalls++; return {}; }),
  );
  check('tracks already present → ok:false, reason:tracks-already-present',
        r2 && r2.ok === false && r2.reason === 'tracks-already-present');
  check('tracks already present → registry NOT consulted',
        resolveCalls === 0);

  // No registry provided.
  const r3 = await ensureChromTracks(
    { shared: { activeChrom: 'LG01' }, inversion: {} },
    null,
  );
  check('no registry → ok:false, reason:no-registry',
        r3 && r3.ok === false && r3.reason === 'no-registry');
}

// =====================================================================
group('successful resolve path');
{
  const atlasState = {
    shared: { activeChrom: 'LG01' },
    inversion: {},  // no tracks yet
  };
  const fakeData = { chrom: 'LG01', n_windows: 1234, windows: [{ start_bp: 1 }] };
  let resolvedWith = null;
  const r = await ensureChromTracks(atlasState, makeRegistry((layer, ctx) => {
    resolvedWith = { layer, ctx };
    return fakeData;
  }));
  check('resolve returns data → ok:true',
        r && r.ok === true);
  check('resolve called with layer=scrubber_main',
        resolvedWith && resolvedWith.layer === 'scrubber_main');
  check('resolve called with { chrom }',
        resolvedWith && resolvedWith.ctx && resolvedWith.ctx.chrom === 'LG01');
  check('atlasState.inversion.tracks[chrom] stashed',
        atlasState.inversion.tracks && atlasState.inversion.tracks.LG01 === fakeData);
  check('return value carries data + chrom',
        r.data === fakeData && r.chrom === 'LG01');
}

// =====================================================================
group('async resolve (cold-cache Promise)');
{
  const atlasState = {
    shared: { activeChrom: 'LG02' },
    inversion: {},
  };
  const fakeData = { chrom: 'LG02', n_windows: 99 };
  const r = await ensureChromTracks(atlasState, makeRegistry(
    () => Promise.resolve(fakeData),
  ));
  check('async resolve → ok:true', r && r.ok === true);
  check('async resolve → tracks stashed',
        atlasState.inversion.tracks && atlasState.inversion.tracks.LG02 === fakeData);
}

// =====================================================================
group('resolve failures');
{
  // Resolve throws synchronously.
  const a1 = { shared: { activeChrom: 'LG03' }, inversion: {} };
  const r1 = await ensureChromTracks(a1, makeRegistry(() => {
    throw new Error('boom');
  }));
  check('sync throw → ok:false, reason:resolve-threw',
        r1 && r1.ok === false && r1.reason === 'resolve-threw');
  check('sync throw → no tracks stashed',
        !a1.inversion.tracks || !a1.inversion.tracks.LG03);

  // Resolve rejects (async).
  const a2 = { shared: { activeChrom: 'LG04' }, inversion: {} };
  const r2 = await ensureChromTracks(a2, makeRegistry(
    () => Promise.reject(new Error('async boom')),
  ));
  check('async reject → ok:false, reason:resolve-threw',
        r2 && r2.ok === false && r2.reason === 'resolve-threw');

  // Resolve returns null/undefined.
  const a3 = { shared: { activeChrom: 'LG05' }, inversion: {} };
  const r3 = await ensureChromTracks(a3, makeRegistry(() => null));
  check('null resolve → ok:false, reason:resolve-empty',
        r3 && r3.ok === false && r3.reason === 'resolve-empty');
  check('null resolve → no tracks stashed',
        !a3.inversion.tracks || !a3.inversion.tracks.LG05);
}

// =====================================================================
group('atlasState mutation: creates missing nested objects');
{
  // atlasState has no inversion bucket at all yet.
  const atlasState = { shared: { activeChrom: 'LG06' } };
  const fakeData = { chrom: 'LG06' };
  const r = await ensureChromTracks(atlasState, makeRegistry(() => fakeData));
  check('missing inversion bucket → still ok:true',
        r && r.ok === true);
  check('inversion bucket created',
        !!atlasState.inversion);
  check('tracks slot created',
        !!atlasState.inversion.tracks);
  check('data stashed',
        atlasState.inversion.tracks.LG06 === fakeData);
}

// =====================================================================
group('setChromSummary contribution (when present)');
{
  let summaryCalls = [];
  const atlasState = {
    shared: { activeChrom: 'LG07' },
    inversion: {},
    setChromSummary: (chrom, summary) => {
      summaryCalls.push({ chrom, summary });
    },
  };
  // Provide minimum-viable data so buildChromSummary doesn't throw.
  const fakeData = {
    chrom: 'LG07',
    n_windows: 50, n_samples: 10,
    windows: [{ start_bp: 1, end_bp: 1000 }],
  };
  await ensureChromTracks(atlasState, makeRegistry(() => fakeData));
  // The chrom_summary import is dynamic so we can't pin exactly when /
  // whether the call fired (the import might fail in a test environment).
  // Just verify the helper didn't crash on the setChromSummary code path.
  check('setChromSummary path did not crash the helper',
        atlasState.inversion.tracks.LG07 === fakeData);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
