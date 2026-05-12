// tests/test_shared_haplotype_vocab.js
//
// Unit tests for atlases/inversion/shared/haplotype_vocab.js — the
// per-candidate haplotype vocabulary picker + per-band classifier.

class MockLS {
  constructor() { this.store = new Map(); }
  setItem(k, v) { this.store.set(String(k), String(v)); }
  getItem(k) { const v = this.store.get(String(k)); return v == null ? null : v; }
  removeItem(k) { this.store.delete(String(k)); }
  clear() { this.store.clear(); }
  get length() { return this.store.size; }
  key(i) { const keys = Array.from(this.store.keys()); return i < keys.length ? keys[i] : null; }
}
globalThis.localStorage = new MockLS();

const {
  HAP_VOCAB_LS_KEY,
  HAP_VOCAB_OPTIONS,
  HAP_CLEAR_HET_RATIO,
  HAP_RECOMBINANT_MIN_N,
  autoSelectVocabForCandidate,
  getHaplotypeVocab,
  setHaplotypeVocab,
  candPerBandStats,
  autoClassifyCandidate,
} = await import('../atlases/inversion/shared/haplotype_vocab.js');

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
// Fixture builder: K=3 clean K-means with a deliberate het band.
// 12 fish total: 5 in band 0 (centroid pc1 = -1), 4 in band 1 (het,
// centroid 0 but wobbles), 3 in band 2 (centroid +1).
//
// Per-window pc1 is built so:
//   - The window offset is CENTERED around 0 (so centroids round-trip
//     exactly to -1 / 0 / +1, not drifted by an asymmetric wobble).
//   - Homozygote bands wobble by a small baseline amp (0.05) so they
//     produce a non-zero sigma. Without this the median sigma would be
//     0 and hetRatio = maxSigma / medianSigma would degenerate to 1,
//     suppressing the "clear het" branch the classifier needs to flag
//     HET / HOM_REF / HOM_INV at high confidence.
//   - The het band wobbles by hetWobbleAmp, much larger than baseline,
//     so the het ratio comfortably clears HAP_CLEAR_HET_RATIO.
// =====================================================================
function makeStateAndCand({ K, labels, hetWobbleAmp = 0.5, windows = 4 }, candId) {
  const n = labels.length;
  const winList = [];
  for (let w = 0; w < windows; w++) {
    const pc1 = new Array(n).fill(0);
    // Centered offset so the mean across windows is zero.
    const offset = (w - (windows - 1) / 2);
    for (let s = 0; s < n; s++) {
      const k = labels[s];
      if (K === 3) {
        const center = k === 0 ? -1 : k === 1 ? 0 : 1;
        const amp = (k === 1) ? hetWobbleAmp : 0.05;
        pc1[s] = center + offset * amp;
      } else {
        // Generic centred linear: band 0 → -(K-1)/2, band K-1 → +(K-1)/2
        const center = k - (K - 1) / 2;
        const amp = 0.05;
        pc1[s] = center + offset * amp;
      }
    }
    winList.push({ pca: { pc1 } });
  }
  const state = { data: { windows: winList, n_samples: n, n_windows: windows } };
  const c = {
    id: candId || 'cand1', chrom: 'LG28', K,
    locked_labels: labels,
    start_w: 0, end_w: windows - 1,
  };
  return { state, c };
}

// =====================================================================
group('constants');
check('LS_KEY',                                HAP_VOCAB_LS_KEY === 'inversion_atlas.hap_vocabs');
check('OPTIONS frozen',                        Object.isFrozen(HAP_VOCAB_OPTIONS));
check('OPTIONS.standard frozen',               Object.isFrozen(HAP_VOCAB_OPTIONS.standard));
check('standard = [HOM_REF, HET, HOM_INV, RECOMBINANT]',
      HAP_VOCAB_OPTIONS.standard.length === 4
      && HAP_VOCAB_OPTIONS.standard[0] === 'HOM_REF'
      && HAP_VOCAB_OPTIONS.standard[3] === 'RECOMBINANT');
check('binary length 4',                       HAP_VOCAB_OPTIONS.binary.length === 4);
check('multi2 length 4',                       HAP_VOCAB_OPTIONS.multi2.length === 4);
check('multi3 length 7',                       HAP_VOCAB_OPTIONS.multi3.length === 7);
check('free is empty',                         HAP_VOCAB_OPTIONS.free.length === 0);
check('CLEAR_HET_RATIO = 1.4',                 HAP_CLEAR_HET_RATIO === 1.4);
check('RECOMBINANT_MIN_N = 5',                 HAP_RECOMBINANT_MIN_N === 5);

// =====================================================================
group('autoSelectVocabForCandidate');
check('K=2 → standard',                        autoSelectVocabForCandidate({ K: 2 }) === 'standard');
check('K=3 → standard',                        autoSelectVocabForCandidate({ K: 3 }) === 'standard');
check('K=4 → multi2',                          autoSelectVocabForCandidate({ K: 4 }) === 'multi2');
check('K=5 → multi2',                          autoSelectVocabForCandidate({ K: 5 }) === 'multi2');
check('K=6 → multi3',                          autoSelectVocabForCandidate({ K: 6 }) === 'multi3');
check('K=7 → free',                            autoSelectVocabForCandidate({ K: 7 }) === 'free');
check('K=10 → free',                           autoSelectVocabForCandidate({ K: 10 }) === 'free');
check('null candidate → standard',             autoSelectVocabForCandidate(null) === 'standard');
check('no K → standard (K=0)',                 autoSelectVocabForCandidate({}) === 'standard');
check('K_used fallback',                       autoSelectVocabForCandidate({ K_used: 6 }) === 'multi3');

// =====================================================================
group('getHaplotypeVocab / setHaplotypeVocab');
{
  globalThis.localStorage.clear();
  const state = {};
  const c = { id: 'cand1', chrom: 'LG28', K: 3 };
  // No user pick → auto-select
  check('default → autoSelect',                 getHaplotypeVocab(state, c) === 'standard');
  // User picks 'binary'
  setHaplotypeVocab(state, c, 'binary');
  check('user pick wins',                       getHaplotypeVocab(state, c) === 'binary');
  // Persists across fresh state via LS
  const state2 = {};
  check('persisted to LS, restored',            getHaplotypeVocab(state2, c) === 'binary');
}
{
  // Multiple candidates have independent vocabs
  globalThis.localStorage.clear();
  const state = {};
  const cA = { id: 'cA', chrom: 'LG28', K: 3 };
  const cB = { id: 'cB', chrom: 'LG14', K: 6 };
  setHaplotypeVocab(state, cA, 'binary');
  setHaplotypeVocab(state, cB, 'free');
  check('per-candidate dict (cA = binary)',     getHaplotypeVocab(state, cA) === 'binary');
  check('per-candidate dict (cB = free)',       getHaplotypeVocab(state, cB) === 'free');
  // Chrom prefix is part of the key
  const cC = { id: 'cA', chrom: 'LG14', K: 3 };   // same id, different chrom
  check('chrom in key: different chrom = no pick → autoSelect',
        getHaplotypeVocab(state, cC) === 'standard');
}
{
  // Malformed LS payload → defaults
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(HAP_VOCAB_LS_KEY, '{not json}');
  const state = {};
  let threw = false;
  try { getHaplotypeVocab(state, { id: 'cX', chrom: 'LG28', K: 3 }); }
  catch (_) { threw = true; }
  check('malformed LS: no throw',                !threw);
  check('malformed LS → autoSelect',
        getHaplotypeVocab(state, { id: 'cX', chrom: 'LG28', K: 3 }) === 'standard');
}
check('getHaplotypeVocab null candidate → standard',
      getHaplotypeVocab({}, null) === 'standard');
check('getHaplotypeVocab null state → autoSelect',
      getHaplotypeVocab(null, { id: 'c', chrom: 'LG28', K: 6 }) === 'multi3');
check('setHaplotypeVocab null state → false',  setHaplotypeVocab(null, { id: 'c' }, 'standard') === false);
check('setHaplotypeVocab null candidate → false', setHaplotypeVocab({}, null, 'standard') === false);

// =====================================================================
group('candPerBandStats — clean K=3');
{
  globalThis.localStorage.clear();
  // 12 fish: 5 in band 0, 4 in band 1 (het), 3 in band 2
  const labels = [0,0,0,0,0, 1,1,1,1,1, 2,2,2,2,2];
  const { state, c } = makeStateAndCand({ K: 3, labels, hetWobbleAmp: 0.5 },
    'cand_stats');
  const stats = candPerBandStats(state, c);
  check('returns array len K=3',                stats.length === 3);
  check('band 0 n=5',                           stats[0].n === 5);
  check('band 1 n=5',                           stats[1].n === 5);
  check('band 2 n=5',                           stats[2].n === 5);
  check('band 0 centroid ≈ -1',                 Math.abs(stats[0].centroid_pc1 - (-1)) < 1e-9);
  check('band 1 centroid ≈ 0 (wobble symmetric)',
        Math.abs(stats[1].centroid_pc1 - 0) < 1e-9);
  check('band 2 centroid ≈ +1',                 Math.abs(stats[2].centroid_pc1 - 1) < 1e-9);
  // With the centred-baseline fixture, hom bands have small but non-zero
  // sigma (baseline wobble 0.05) and the het band has substantially more.
  check('band 0 sigma small (baseline)',        stats[0].mean_sigma > 0 && stats[0].mean_sigma < 0.1);
  check('band 1 sigma > band 0 (het wobbles)',  stats[1].mean_sigma > stats[0].mean_sigma);
  check('band 2 sigma small (baseline)',        stats[2].mean_sigma > 0 && stats[2].mean_sigma < 0.1);
  check('het ratio clearly exceeds threshold',  stats[1].mean_sigma / stats[0].mean_sigma > 1.4);
}
check('null state → null',                     candPerBandStats(null, { K: 3, locked_labels: [0] }) === null);
check('no candidate.K → null',                 candPerBandStats({ data: { windows: [] } }, { locked_labels: [0] }) === null);
check('no locked_labels → null',               candPerBandStats({ data: { windows: [] } }, { K: 3 }) === null);
check('no state.data.windows → null',          candPerBandStats({}, { K: 3, locked_labels: [0] }) === null);

// =====================================================================
group('autoClassifyCandidate — standard vocab clean K=3');
{
  globalThis.localStorage.clear();
  const labels = [0,0,0,0,0, 1,1,1,1,1, 2,2,2,2,2];
  const { state, c } = makeStateAndCand({ K: 3, labels, hetWobbleAmp: 0.5 },
    'cand_standard');
  const r = autoClassifyCandidate(state, c);
  check('returns object',                       !!r);
  check('vocab = standard',                     r.vocab === 'standard');
  check('per_band length 3',                    r.per_band.length === 3);
  // Band 0 (leftmost): HOM_REF
  check('band 0 = HOM_REF',                     r.per_band[0].label === 'HOM_REF');
  check('band 0 confidence high (clear het)',   r.per_band[0].confidence === 'high');
  // Band 1 (highest sigma): HET
  check('band 1 = HET',                         r.per_band[1].label === 'HET');
  check('band 1 confidence high',               r.per_band[1].confidence === 'high');
  // Band 2 (rightmost): HOM_INV
  check('band 2 = HOM_INV',                     r.per_band[2].label === 'HOM_INV');
  check('band 2 confidence high',               r.per_band[2].confidence === 'high');
}

// =====================================================================
group('autoClassifyCandidate — small band → RECOMBINANT');
{
  globalThis.localStorage.clear();
  // Band 1 has only 3 fish (< HAP_RECOMBINANT_MIN_N = 5)
  const labels = [0,0,0,0,0, 1,1,1, 2,2,2,2,2];
  const { state, c } = makeStateAndCand({ K: 3, labels }, 'cand_small');
  const r = autoClassifyCandidate(state, c);
  check('small band → RECOMBINANT',             r.per_band[1].label === 'RECOMBINANT');
  check('small band confidence medium',         r.per_band[1].confidence === 'medium');
  check('small band reason mentions samples',
        r.per_band[1].reason.includes('only 3 samples'));
}

// =====================================================================
group('autoClassifyCandidate — binary vocab');
{
  globalThis.localStorage.clear();
  const labels = [0,0,0,0,0, 1,1,1,1,1, 2,2,2,2,2];
  const { state, c } = makeStateAndCand({ K: 3, labels, hetWobbleAmp: 0.5 },
    'cand_binary');
  setHaplotypeVocab(state, c, 'binary');
  const r = autoClassifyCandidate(state, c);
  check('vocab = binary',                       r.vocab === 'binary');
  check('band 0 = AA',                          r.per_band[0].label === 'AA');
  check('band 1 = AB',                          r.per_band[1].label === 'AB');
  check('band 2 = BB',                          r.per_band[2].label === 'BB');
  check('band 1 (het) confidence high',         r.per_band[1].confidence === 'high');
}

// =====================================================================
group('autoClassifyCandidate — free vocab');
{
  globalThis.localStorage.clear();
  const labels = [0,0,0,0,0, 1,1,1,1,1, 2,2,2,2,2];
  const { state, c } = makeStateAndCand({ K: 3, labels }, 'cand_free');
  setHaplotypeVocab(state, c, 'free');
  const r = autoClassifyCandidate(state, c);
  check('vocab = free',                         r.vocab === 'free');
  check('free: all labels empty',
        r.per_band.every(b => b.label === '' || b.label === 'RECOMBINANT'));
  check('free: top-band reason "type your own"',
        r.per_band[0].reason === 'free vocabulary, type your own label'
        || r.per_band[2].reason === 'free vocabulary, type your own label');
}

// =====================================================================
group('autoClassifyCandidate — multi3 vocab K=6');
{
  globalThis.localStorage.clear();
  // 30 fish, 5 each across 6 bands. K=6 → autoSelect should pick multi3.
  // The makeStateAndCand K≠3 branch already spreads centers across
  // [-(K-1)/2, +(K-1)/2] with baseline wobble.
  const labels = [];
  for (let k = 0; k < 6; k++) for (let i = 0; i < 5; i++) labels.push(k);
  const { state, c } = makeStateAndCand({ K: 6, labels, windows: 4 },
    'cand_multi3');
  const r = autoClassifyCandidate(state, c);
  check('vocab = multi3',                       r.vocab === 'multi3');
  check('per_band length 6',                    r.per_band.length === 6);
  check('multi3 first → H1/H1',                 r.per_band[0].label === 'H1/H1');
  check('multi3 last → H3/H3',                  r.per_band[5].label === 'H3/H3');
  check('all multi3 labels are recognized vocab entries',
        r.per_band.every(b => HAP_VOCAB_OPTIONS.multi3.includes(b.label)));
}

// =====================================================================
group('autoClassifyCandidate — no per-window data');
{
  const c = { id: 'c', chrom: 'X', K: 3, locked_labels: [0,0,1,1,2,2] };
  const r = autoClassifyCandidate({}, c);
  check('returns object',                       !!r);
  check('per_band length = K',                  r.per_band.length === 3);
  check('all bands "no per-window data"',
        r.per_band.every(b => b.reason === 'no per-window data'
                              && b.confidence === 'none'));
}

// =====================================================================
group('autoClassifyCandidate — input validation');
check('null candidate → null',                 autoClassifyCandidate({}, null) === null);
check('no K → null',                           autoClassifyCandidate({}, { id: 'c' }) === null);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
