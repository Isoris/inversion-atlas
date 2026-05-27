// tests/test_shared_pc1_sign_align.js
//
// Locks down the rewrite of computePC1Signs from a walking nearest-
// neighbour correlator to a 2-pass reference-anchored aligner. The
// old algorithm flipped signs on noise at low-correlation windows
// and propagated the choice downstream, producing the X-shaped
// braids the user reported in the lines panel.

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

const { computePC1Signs } = await import('../atlases/inversion/shared/page1_data_helpers.js');

function makeState(pc1Vectors) {
  return {
    data: {
      windows: pc1Vectors.map((v) => ({ pc1: Float32Array.from(v) })),
    },
  };
}

// =====================================================================
group('basic correctness');

const st0 = { data: null };
computePC1Signs(st0);
check('null data is safe (no throw)', true);

const st1 = { data: { windows: [] } };
computePC1Signs(st1);
check('empty windows → zero-length signs', st1.pc1Sign && st1.pc1Sign.length === 0);

// =====================================================================
group('clean linear case — every window agrees');

// 5 samples on a stable PC1 direction across 4 windows. No flips.
const stClean = makeState([
  [-2, -1,  0,  1,  2],
  [-2, -1,  0,  1,  2],
  [-2, -1,  0,  1,  2],
  [-2, -1,  0,  1,  2],
]);
computePC1Signs(stClean);
check('clean case: every sign = +1',
      Array.from(stClean.pc1Sign).every(s => s === 1));

// =====================================================================
group('single-window flip — easy case');

// Window 2 is flipped. The aligner must flip it back.
const stOneFlip = makeState([
  [-2, -1,  0,  1,  2],
  [-2, -1,  0,  1,  2],
  [ 2,  1,  0, -1, -2],     // flipped — must be detected
  [-2, -1,  0,  1,  2],
]);
computePC1Signs(stOneFlip);
// After alignment, signs[2] should be -1 (multiplying by -1 brings
// the flipped vector back to agreement with the reference).
check('single-window flip: signs[2] = -1',  stOneFlip.pc1Sign[2] === -1);
check('single-window flip: signs[0,1,3] = +1',
      stOneFlip.pc1Sign[0] === 1 && stOneFlip.pc1Sign[1] === 1 && stOneFlip.pc1Sign[3] === 1);

// Verify the resulting sign-aligned vectors match.
const alignedFlip = stOneFlip.data.windows.map((w, i) =>
  Array.from(w.pc1, v => v * stOneFlip.pc1Sign[i]));
check('flipped window now agrees with reference',
      JSON.stringify(alignedFlip[2]) === JSON.stringify(alignedFlip[0]));

// =====================================================================
group('the X-braid case — noisy "uncorrelated" window between two clean ones');

// 5 samples on a stable PC1, but window 2 carries near-zero correlation
// noise (the canonical failure mode for the walking algorithm: it
// would commit to a sign based on tiny noise and propagate that choice
// to windows 3 and beyond).
// With the new reference-anchored aligner + hysteresis, window 2
// should NOT cause a flip in windows 3-4.
const stBraid = makeState([
  [-2, -1,  0,  1,  2],
  [-2, -1,  0,  1,  2],
  [ 0.01, -0.02, 0.005, 0.03, -0.01],   // ~uncorrelated noise
  [-2, -1,  0,  1,  2],
  [-2, -1,  0,  1,  2],
]);
computePC1Signs(stBraid);
check('X-braid: signs[0,1] = +1',     stBraid.pc1Sign[0] === 1 && stBraid.pc1Sign[1] === 1);
check('X-braid: signs[3,4] = +1 (not flipped by noisy window 2)',
      stBraid.pc1Sign[3] === 1 && stBraid.pc1Sign[4] === 1);

// =====================================================================
group('flip-then-restore pattern (eigenvector wobbles between two L2 blocks)');

const stWobble = makeState([
  [-2, -1,  0,  1,  2],
  [-2, -1,  0,  1,  2],
  [-2, -1,  0,  1,  2],
  [ 2,  1,  0, -1, -2],     // flipped block start
  [ 2,  1,  0, -1, -2],     // flipped block continues
  [ 2,  1,  0, -1, -2],     // flipped block continues
  [-2, -1,  0,  1,  2],     // back to original direction
  [-2, -1,  0,  1,  2],
]);
computePC1Signs(stWobble);
// The reference is the per-sample mean of seed-aligned signs. The
// majority-aligned direction should win — making the 5 "original"
// windows positive and the 3 "flipped" windows negative (so they
// flip back to match the reference).
check('wobble: windows 0-2 + 6-7 are +1',
      [0,1,2,6,7].every(i => stWobble.pc1Sign[i] === 1));
check('wobble: windows 3-5 are -1',
      [3,4,5].every(i => stWobble.pc1Sign[i] === -1));
// Final aligned vectors should all be identical.
const aligned = stWobble.data.windows.map((w, i) =>
  Array.from(w.pc1, v => v * stWobble.pc1Sign[i]));
for (let i = 1; i < aligned.length; i++) {
  check(`wobble: aligned[${i}] = aligned[0]`,
        JSON.stringify(aligned[i]) === JSON.stringify(aligned[0]));
}

// =====================================================================
group('non-finite values are skipped (NaN safety)');

const stNaN = makeState([
  [-2, -1,  0,  1,  2],
  [NaN, NaN, NaN, NaN, NaN],          // bad window — skipped from ref
  [-2, -1,  0,  1,  2],
]);
computePC1Signs(stNaN);
check('NaN window: signs has length 3', stNaN.pc1Sign.length === 3);
check('NaN window: signs[0,2] = +1',    stNaN.pc1Sign[0] === 1 && stNaN.pc1Sign[2] === 1);
// signs[1] inherits the previous sign (hysteresis when correlation is 0).
check('NaN window: signs[1] inherits neighbour',
      stNaN.pc1Sign[1] === 1);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
