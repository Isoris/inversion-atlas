// tests/test_shared_scale_stability.js

import {
  SCALE_STABILITY_VERDICTS,
  SCALE_STABILITY_DEFAULTS,
  SCALE_STABILITY_PANE_DEFAULTS,
  scaleStabilityVerdict,
  scaleStabilityFingerprint,
  scaleStabilityVerdictText,
  scaleStabilityVerdictCss,
  scaleStabilityPaneLabel,
  ensureScaleStabilityState,
  snpBandRange,
  kbBandRange,
  resolvePaneRange,
} from '../atlases/inversion/shared/scale_stability.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

function panes(K1, K2, K3) {
  return [{ K: K1, ok: true }, { K: K2, ok: true }, { K: K3, ok: true }];
}
function pair(ari, fuses, splits) {
  return {
    ari,
    fuseEvents:  Array(fuses).fill({}),
    splitEvents: Array(splits).fill({}),
  };
}

// =====================================================================
group('constants');
check('VERDICTS frozen + 5 entries',           Object.isFrozen(SCALE_STABILITY_VERDICTS)
                                               && SCALE_STABILITY_VERDICTS.length === 5);
check('VERDICTS contains STABLE_3BAND',        SCALE_STABILITY_VERDICTS.includes('STABLE_3BAND'));
check('VERDICTS contains UNSTABLE (fallback)', SCALE_STABILITY_VERDICTS.includes('UNSTABLE'));
check('DEFAULTS.ari_stable = 0.85',            SCALE_STABILITY_DEFAULTS.ari_stable === 0.85);
check('DEFAULTS.ari_edge = 0.70',              SCALE_STABILITY_DEFAULTS.ari_edge === 0.70);
check('DEFAULTS frozen',                       Object.isFrozen(SCALE_STABILITY_DEFAULTS));

// =====================================================================
group('scaleStabilityVerdict — shape guards');
check('non-array panes → UNSTABLE',            scaleStabilityVerdict(null, []) === 'UNSTABLE');
check('wrong-length panes → UNSTABLE',         scaleStabilityVerdict(panes(3, 3, 3).slice(0, 2), []) === 'UNSTABLE');
check('non-array pairwise → UNSTABLE',         scaleStabilityVerdict(panes(3, 3, 3), null) === 'UNSTABLE');
check('wrong-length pairwise → UNSTABLE',      scaleStabilityVerdict(panes(3, 3, 3), [pair(0.9, 0, 0)]) === 'UNSTABLE');
{
  // ok=false anywhere → UNSTABLE
  const p = panes(3, 3, 3); p[1].ok = false;
  check('pane ok=false → UNSTABLE',            scaleStabilityVerdict(p, [pair(0.9, 0, 0), pair(0.9, 0, 0)]) === 'UNSTABLE');
}

// =====================================================================
group('scaleStabilityVerdict — STABLE_3BAND');
{
  const r = scaleStabilityVerdict(panes(3, 3, 3), [pair(0.9, 0, 0), pair(0.9, 0, 0)]);
  check('all K=3, no fuse/split, high ARI → STABLE_3BAND', r === 'STABLE_3BAND');
}
{
  // Just below ari_stable threshold → UNSTABLE (no fuses/splits to fall into NESTED/OVERLAP)
  const r = scaleStabilityVerdict(panes(3, 3, 3), [pair(0.84, 0, 0), pair(0.9, 0, 0)]);
  check('ARI just below 0.85: not STABLE',     r !== 'STABLE_3BAND');
}
{
  // Custom threshold relaxes the gate
  const r = scaleStabilityVerdict(panes(3, 3, 3), [pair(0.7, 0, 0), pair(0.7, 0, 0)], { ari_stable: 0.65 });
  check('custom ari_stable: STABLE_3BAND',     r === 'STABLE_3BAND');
}

// =====================================================================
group('scaleStabilityVerdict — STABLE_6BAND');
{
  const r = scaleStabilityVerdict(panes(6, 6, 6), [pair(0.9, 0, 0), pair(0.9, 0, 0)]);
  check('all K=6, no fuse/split, high ARI → STABLE_6BAND', r === 'STABLE_6BAND');
}
{
  // K=6 with fuses → not stable
  const r = scaleStabilityVerdict(panes(6, 6, 6), [pair(0.9, 1, 0), pair(0.9, 0, 0)]);
  check('K=6 with fuse → not STABLE_6BAND',    r !== 'STABLE_6BAND');
}

// =====================================================================
group('scaleStabilityVerdict — NESTED_3IN6');
{
  // K=6, K=6, K=3 — collapse at 2↔3 gap. ARI will be low (~0.4) but
  // explained by the 3 fuses, so NOT UNSTABLE.
  const r = scaleStabilityVerdict(panes(6, 6, 3), [pair(0.9, 0, 0), pair(0.4, 3, 0)]);
  check('6/6/3 with 3 fuses on 2↔3 → NESTED_3IN6', r === 'NESTED_3IN6');
}
{
  // K=6, K=3, K=3 — collapse at 1↔2 gap.
  const r = scaleStabilityVerdict(panes(6, 3, 3), [pair(0.4, 3, 0), pair(0.9, 0, 0)]);
  check('6/3/3 with 3 fuses on 1↔2 → NESTED_3IN6', r === 'NESTED_3IN6');
}
{
  // K=6, K=3, K=3 with wrong fuse count → NOT nested
  const r = scaleStabilityVerdict(panes(6, 3, 3), [pair(0.4, 2, 0), pair(0.9, 0, 0)]);
  check('6/3/3 with 2 fuses (not 3) → NOT NESTED_3IN6', r !== 'NESTED_3IN6');
}
{
  // K=6, K=3, K=3 with fuses + splits → NOT nested
  const r = scaleStabilityVerdict(panes(6, 3, 3), [pair(0.4, 3, 1), pair(0.9, 0, 0)]);
  check('6/3/3 with split too → NOT NESTED_3IN6', r !== 'NESTED_3IN6');
}

// =====================================================================
group('scaleStabilityVerdict — OVERLAP_BREAKS_3');
{
  // K=3, K=6, K=3 with structure on both gaps
  const r = scaleStabilityVerdict(panes(3, 6, 3), [pair(0.5, 1, 1), pair(0.5, 1, 1)]);
  check('3/6/3 with structure on both gaps → OVERLAP_BREAKS_3', r === 'OVERLAP_BREAKS_3');
}
{
  // 3/6/3 with structure on only one gap → NOT overlap
  const r = scaleStabilityVerdict(panes(3, 6, 3), [pair(0.5, 1, 1), pair(0.9, 0, 0)]);
  check('3/6/3 structure on only one gap → NOT OVERLAP_BREAKS_3', r !== 'OVERLAP_BREAKS_3');
}

// =====================================================================
group('scaleStabilityVerdict — UNSTABLE fallbacks');
{
  // K=3,3,6 — not handled by any specific pattern
  const r = scaleStabilityVerdict(panes(3, 3, 6), [pair(0.9, 0, 0), pair(0.9, 0, 0)]);
  check('3/3/6 with no structure → UNSTABLE',  r === 'UNSTABLE');
}
{
  // Low ARI with no fuse/split explanation → UNSTABLE
  const r = scaleStabilityVerdict(panes(3, 3, 3), [pair(0.4, 0, 0), pair(0.9, 0, 0)]);
  check('low ARI unexplained → UNSTABLE',      r === 'UNSTABLE');
}
{
  // ARI NaN: treated as not finite, ariStable false → won't be STABLE_*
  const r = scaleStabilityVerdict(panes(3, 3, 3), [pair(NaN, 0, 0), pair(NaN, 0, 0)]);
  check('NaN ARI → UNSTABLE',                  r === 'UNSTABLE');
}

// =====================================================================
group('scaleStabilityFingerprint');
{
  const fp = scaleStabilityFingerprint({});
  check('empty state → defined string',         typeof fp === 'string');
  check('empty state → has separators',         fp.includes('//'));
}
{
  const state1 = {
    cur: 5,
    scaleStabilityPanes: [
      { scale: '5w', K: 6 },
      { scale: '10w', K: 6 },
      { scale: 'L2', K: 3 },
    ],
    aggMethod: 'mean',
    minNGroup: 5,
    candidate: { id: 'cand_abc' },
    data: { chrom: 'LG28' },
  };
  const fp1 = scaleStabilityFingerprint(state1);
  // Same state → same fingerprint
  const fp1b = scaleStabilityFingerprint(state1);
  check('same state: same fingerprint',         fp1 === fp1b);

  // Change cur → fingerprint changes
  const state2 = { ...state1, cur: 6 };
  check('different cur: different fingerprint', scaleStabilityFingerprint(state2) !== fp1);

  // Change pane K → fingerprint changes
  const state3 = { ...state1, scaleStabilityPanes: [
    { scale: '5w', K: 3 },                       // K changed
    { scale: '10w', K: 6 },
    { scale: 'L2', K: 3 },
  ]};
  check('different pane K: different fingerprint', scaleStabilityFingerprint(state3) !== fp1);

  // Change chrom → fingerprint changes
  const state4 = { ...state1, data: { chrom: 'LG14' } };
  check('different chrom: different fingerprint', scaleStabilityFingerprint(state4) !== fp1);

  // Change candidate → fingerprint changes
  const state5 = { ...state1, candidate: { id: 'cand_xyz' } };
  check('different candidate: different fingerprint', scaleStabilityFingerprint(state5) !== fp1);
}
check('null state: returns string',           typeof scaleStabilityFingerprint(null) === 'string');

// =====================================================================
group('scaleStabilityVerdictText');
check('STABLE_3BAND text includes "STABLE 3-band"',
      scaleStabilityVerdictText('STABLE_3BAND').includes('STABLE 3-band'));
check('STABLE_6BAND text includes "multiband"',
      scaleStabilityVerdictText('STABLE_6BAND').includes('multiband'));
check('NESTED_3IN6 text mentions "NESTED 3-in-6"',
      scaleStabilityVerdictText('NESTED_3IN6').includes('NESTED 3-in-6'));
check('OVERLAP_BREAKS_3 text mentions "OVERLAP"',
      scaleStabilityVerdictText('OVERLAP_BREAKS_3').includes('OVERLAP'));
check('UNSTABLE text mentions "artifact-suspect"',
      scaleStabilityVerdictText('UNSTABLE').includes('artifact-suspect'));
check('unknown verdict → "UNKNOWN"',           scaleStabilityVerdictText('GARBAGE') === 'UNKNOWN');
check('null verdict → "UNKNOWN"',              scaleStabilityVerdictText(null) === 'UNKNOWN');

// =====================================================================
group('scaleStabilityVerdictCss');
check('STABLE_3BAND → stable',                 scaleStabilityVerdictCss('STABLE_3BAND') === 'stable');
check('STABLE_6BAND → stable',                 scaleStabilityVerdictCss('STABLE_6BAND') === 'stable');
check('NESTED_3IN6 → nested',                  scaleStabilityVerdictCss('NESTED_3IN6') === 'nested');
check('OVERLAP_BREAKS_3 → overlap',            scaleStabilityVerdictCss('OVERLAP_BREAKS_3') === 'overlap');
check('UNSTABLE → unstable',                   scaleStabilityVerdictCss('UNSTABLE') === 'unstable');
check('unknown verdict → unstable (default)',  scaleStabilityVerdictCss('GARBAGE') === 'unstable');

// =====================================================================
group('scaleStabilityPaneLabel');
{
  const cfg = { scale: '5w', K: 6 };
  check('basic: Σ₁ fine · 5w · K=6',           scaleStabilityPaneLabel(0, cfg, null) === 'Σ₁ fine · 5w · K=6');
  check('Σ₂ medium label',                     scaleStabilityPaneLabel(1, cfg, null) === 'Σ₂ medium · 5w · K=6');
  check('Σ₃ coarse label',                     scaleStabilityPaneLabel(2, cfg, null) === 'Σ₃ coarse · 5w · K=6');
}
{
  // Scale label translation
  check('100SNPs → "100 SNPs"',
        scaleStabilityPaneLabel(0, { scale: '100SNPs', K: 3 }, null) === 'Σ₁ fine · 100 SNPs · K=3');
  check('500kb → "500 kb"',
        scaleStabilityPaneLabel(0, { scale: '500kb', K: 3 }, null) === 'Σ₁ fine · 500 kb · K=3');
  check('unknown scale: passed through verbatim',
        scaleStabilityPaneLabel(0, { scale: 'custom_xx', K: 3 }, null) === 'Σ₁ fine · custom_xx · K=3');
}
{
  // Meta extras
  check('snps meta adds count',
        scaleStabilityPaneLabel(0, { scale: '100SNPs', K: 3 },
          { meta: { kind: 'snps', total_snps: 247 } })
          === 'Σ₁ fine · 100 SNPs (247 SNPs) · K=3');
  check('kb meta adds bp',
        scaleStabilityPaneLabel(0, { scale: '500kb', K: 3 },
          { meta: { kind: 'kb', total_bp: 487_000 } })
          === 'Σ₁ fine · 500 kb (487.0 kb) · K=3');
  check('windows meta adds count',
        scaleStabilityPaneLabel(0, { scale: '5w', K: 3 },
          { meta: { kind: 'windows', n: 5 } })
          === 'Σ₁ fine · 5w (5w) · K=3');
  check('L2 meta adds 1-indexed idx',
        scaleStabilityPaneLabel(0, { scale: 'L2', K: 3 },
          { meta: { kind: 'L2', l2idx: 7 } })
          === 'Σ₁ fine · L2 (8) · K=3');
  check('L1 meta adds 1-indexed idx',
        scaleStabilityPaneLabel(0, { scale: 'L1', K: 3 },
          { meta: { kind: 'L1', l1idx: 2 } })
          === 'Σ₁ fine · L1 (3) · K=3');
  // asymmetric chip
  check('asymmetric chip appended',
        scaleStabilityPaneLabel(0, { scale: '5w', K: 3 },
          { meta: { kind: 'windows', n: 5, asymmetric: true } })
          === 'Σ₁ fine · 5w (5w) asym · K=3');
  // partial chip
  check('target_met=false adds partial',
        scaleStabilityPaneLabel(0, { scale: '5w', K: 3 },
          { meta: { kind: 'windows', n: 5, target_met: false } })
          === 'Σ₁ fine · 5w (5w) partial · K=3');
  // Both chips
  check('both chips: asym + partial',
        scaleStabilityPaneLabel(0, { scale: '5w', K: 3 },
          { meta: { kind: 'windows', n: 5, asymmetric: true, target_met: false } })
          === 'Σ₁ fine · 5w (5w) asym partial · K=3');
}
check('null cfg → empty string',               scaleStabilityPaneLabel(0, null, null) === '');
check('paneIdx > 2: Σ fallback',
      scaleStabilityPaneLabel(5, { scale: '5w', K: 3 }, null).startsWith('Σ '));

// =====================================================================
// State lifecycle + pane-range resolvers
// =====================================================================

function makeWindowsState(n, opts) {
  opts = opts || {};
  const windows = [];
  for (let i = 0; i < n; i++) {
    windows.push({
      n_snps: opts.flatSnps != null ? opts.flatSnps : (10 + (i % 5)),
      start_bp: i * 1000,
      end_bp:   (i + 1) * 1000,
      span_bp:  1000,
    });
  }
  return {
    data: {
      windows,
      l2_envelopes: opts.l2_envelopes || [],
      l1_envelopes: opts.l1_envelopes || [],
    },
    windowToL2: opts.windowToL2,
    windowToL1: opts.windowToL1,
    candidate: opts.candidate,
    compareUnitN: opts.compareUnitN,
  };
}

group('SCALE_STABILITY_PANE_DEFAULTS');
check('frozen outer array',                    Object.isFrozen(SCALE_STABILITY_PANE_DEFAULTS));
check('3 panes',                               SCALE_STABILITY_PANE_DEFAULTS.length === 3);
check('pane 0: 5w / K=6',
      SCALE_STABILITY_PANE_DEFAULTS[0].scale === '5w' && SCALE_STABILITY_PANE_DEFAULTS[0].K === 6);
check('pane 1: L2 / K=6',
      SCALE_STABILITY_PANE_DEFAULTS[1].scale === 'L2' && SCALE_STABILITY_PANE_DEFAULTS[1].K === 6);
check('pane 2: candidate / K=3',
      SCALE_STABILITY_PANE_DEFAULTS[2].scale === 'candidate' && SCALE_STABILITY_PANE_DEFAULTS[2].K === 3);

group('ensureScaleStabilityState');
{
  const state = {};
  ensureScaleStabilityState(state);
  check('l3Mode defaulted',                    state.l3Mode === 'contingency');
  check('panes defaulted to 3 entries',        state.scaleStabilityPanes.length === 3);
  check('panes are mutable copies (not frozen)',
        Object.isFrozen(state.scaleStabilityPanes) === false
        && Object.isFrozen(state.scaleStabilityPanes[0]) === false);
  check('scaleStabilityCache = null',          state.scaleStabilityCache === null);
}
{
  // Idempotent + respects pre-existing values
  const state = {
    l3Mode: 'other_mode',
    scaleStabilityPanes: [{ scale: 'Nw', K: 4, custom_n: 7 }],
  };
  ensureScaleStabilityState(state);
  check('idempotent: preserves l3Mode',        state.l3Mode === 'other_mode');
  check('idempotent: preserves panes',         state.scaleStabilityPanes.length === 1);
  check('idempotent: pane 0 preserved',        state.scaleStabilityPanes[0].custom_n === 7);
}
{
  // Mutation isolation: changes to state.scaleStabilityPanes don't bleed
  // back into SCALE_STABILITY_PANE_DEFAULTS
  const state = {};
  ensureScaleStabilityState(state);
  state.scaleStabilityPanes[0].K = 99;
  check('mutation does not leak into defaults', SCALE_STABILITY_PANE_DEFAULTS[0].K === 6);
}
// Null state: no-throw
{
  let threw = false;
  try { ensureScaleStabilityState(null); } catch (_) { threw = true; }
  check('null state: no throw',                !threw);
}

group('snpBandRange');
{
  const state = makeWindowsState(20, { flatSnps: 10 });
  // Total 200 SNPs available. Target 100 from focal 10 → centered band
  // grows: 10..10 (10), then ±1 alternating until ≥ 100.
  const r = snpBandRange(state, 10, 100);
  check('returns object',                       !!r);
  check('focal included',                       r.s <= 10 && r.e >= 10);
  check('total ≥ target',                       r.total_snps >= 100);
  check('target_met = true',                    r.target_met === true);
  check('not asymmetric (interior focal)',      r.asymmetric === false);
}
{
  // Edge-forced asymmetric
  const state = makeWindowsState(20, { flatSnps: 10 });
  const r = snpBandRange(state, 0, 100);
  check('left-edge focal: asymmetric',          r.asymmetric === true);
  check('left-edge focal: s = 0',               r.s === 0);
}
{
  // Target exceeds total available
  const state = makeWindowsState(5, { flatSnps: 1 });
  const r = snpBandRange(state, 2, 1000);
  check('huge target: target_met = false',      r.target_met === false);
  check('huge target: full chrom range',        r.s === 0 && r.e === 4);
}
check('null state → null',                    snpBandRange(null, 0, 100) === null);
check('null targetSnps → null',               snpBandRange(makeWindowsState(5), 0, null) === null);
check('focal out of bounds → null',           snpBandRange(makeWindowsState(5), 99, 100) === null);
check('negative target → null',               snpBandRange(makeWindowsState(5), 0, -1) === null);

group('kbBandRange');
{
  const state = makeWindowsState(20);
  // Each window = 1000 bp; target 5 kb → 5 windows
  const r = kbBandRange(state, 10, 5);
  check('returns object',                       !!r);
  check('target_bp = targetKb × 1000',          r.target_bp === 5000);
  check('total ≥ target',                       r.total_bp >= 5000);
  check('target_met = true',                    r.target_met === true);
}
{
  // span_bp absent: fallback to end_bp - start_bp
  const state = makeWindowsState(20);
  for (const w of state.data.windows) delete w.span_bp;
  const r = kbBandRange(state, 10, 5);
  check('span_bp fallback to end_bp-start_bp works', r.target_met === true);
}
check('null state → null',                    kbBandRange(null, 0, 100) === null);
check('null targetKb → null',                 kbBandRange(makeWindowsState(5), 0, null) === null);

group('resolvePaneRange — window-count scales');
{
  const state = makeWindowsState(20);
  // 5w centered on 10 → [8, 12]
  let r = resolvePaneRange(state, 10, { scale: '5w', K: 3 });
  check('5w: kind=windows',                     r.kind === 'windows');
  check('5w: n = 5',                            r.n === 5);
  check('5w: s = 8, e = 12',                    r.s === 8 && r.e === 12);
  // 1w
  r = resolvePaneRange(state, 7, { scale: '1w', K: 3 });
  check('1w: s = e = focal',                    r.s === 7 && r.e === 7);
  // 10w (even) — biases right: focal at (10-1)/2 = 4 from left
  r = resolvePaneRange(state, 10, { scale: '10w', K: 3 });
  check('10w: n = 10',                          r.n === 10);
  check('10w: 5 right + 4 left of focal',       r.e - r.s === 9);
  // Edge clamping
  r = resolvePaneRange(state, 0, { scale: '5w', K: 3 });
  check('edge focal: clamped to 0',             r.s === 0);
  check('edge focal: e clipped',                r.e >= 0 && r.e <= 19);
}
{
  // Nw with custom_n
  const state = makeWindowsState(20);
  let r = resolvePaneRange(state, 10, { scale: 'Nw', K: 3, custom_n: 7 });
  check('Nw with custom_n: n = 7',              r.n === 7);
  // Nw falls back to state.compareUnitN
  state.compareUnitN = 3;
  r = resolvePaneRange(state, 10, { scale: 'Nw', K: 3, custom_n: null });
  check('Nw with no custom_n: state.compareUnitN', r.n === 3);
  // Nw with no source at all → defaults to 1
  delete state.compareUnitN;
  r = resolvePaneRange(state, 10, { scale: 'Nw', K: 3, custom_n: null });
  check('Nw with no source: n = 1',             r.n === 1);
}

group('resolvePaneRange — SNP-band + kb-band scales');
{
  const state = makeWindowsState(20, { flatSnps: 50 });
  const r1 = resolvePaneRange(state, 10, { scale: '100SNPs', K: 3 });
  check('100SNPs: kind = snps',                 r1.kind === 'snps');
  check('100SNPs: total ≥ 100',                 r1.total_snps >= 100);
  const r2 = resolvePaneRange(state, 10, { scale: '500 SNPs', K: 3 });
  check('with-space alias works',               r2.target === 500);
  const r3 = resolvePaneRange(state, 10, { scale: '1000SNPs', K: 3 });
  check('1000SNPs target',                      r3.target === 1000);
  const r4 = resolvePaneRange(state, 10, { scale: '100kb', K: 3 });
  check('100kb: kind = kb',                     r4.kind === 'kb');
  const r5 = resolvePaneRange(state, 10, { scale: '500 kb', K: 3 });
  check('500 kb (with space) works',            r5.target_bp === 500_000);
}

group('resolvePaneRange — envelope scales');
{
  const state = makeWindowsState(20, {
    l2_envelopes: [{ _s0: 0, _e0: 4 }, { _s0: 5, _e0: 12 }, { _s0: 13, _e0: 19 }],
    windowToL2:   [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2],
  });
  // Focal in L2 #1 (s=5, e=12)
  const r1 = resolvePaneRange(state, 8, { scale: 'L2', K: 3 });
  check('L2: kind = L2',                        r1.kind === 'L2');
  check('L2: s = env._s0',                      r1.s === 5);
  check('L2: e = env._e0',                      r1.e === 12);
  check('L2: l2idx = 1',                        r1.l2idx === 1);
  // Focal outside any L2 (windowToL2[i] = -1)
  const state2 = makeWindowsState(20, {
    l2_envelopes: [{ _s0: 0, _e0: 4 }],
    windowToL2:   [0, 0, 0, 0, 0, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
  });
  check('L2 outside envelope → null',           resolvePaneRange(state2, 10, { scale: 'L2', K: 3 }) === null);
  // No windowToL2 at all → null
  check('L2 without windowToL2 → null',
        resolvePaneRange(makeWindowsState(20), 10, { scale: 'L2', K: 3 }) === null);
}
{
  // L1
  const state = makeWindowsState(20, {
    l1_envelopes: [{ _s0: 0, _e0: 9 }, { _s0: 10, _e0: 19 }],
    windowToL1: [0,0,0,0,0,0,0,0,0,0, 1,1,1,1,1,1,1,1,1,1],
  });
  const r = resolvePaneRange(state, 5, { scale: 'L1', K: 3 });
  check('L1: kind = L1',                        r.kind === 'L1');
  check('L1: l1idx = 0',                        r.l1idx === 0);
}

group('resolvePaneRange — candidate scale');
{
  const state = makeWindowsState(20, { candidate: { id: 'cand_x', start_w: 3, end_w: 14 } });
  const r = resolvePaneRange(state, 8, { scale: 'candidate', K: 3 });
  check('candidate: kind = candidate',          r.kind === 'candidate');
  check('candidate: cand_id preserved',         r.cand_id === 'cand_x');
  check('candidate: s = start_w',               r.s === 3);
  check('candidate: e = end_w',                 r.e === 14);
}
{
  // No active candidate → null
  const state = makeWindowsState(20);
  check('candidate without state.candidate → null',
        resolvePaneRange(state, 8, { scale: 'candidate', K: 3 }) === null);
}
{
  // Missing start_w/end_w → null
  const state = makeWindowsState(20, { candidate: { id: 'cand_x' } });
  check('candidate without start_w/end_w → null',
        resolvePaneRange(state, 8, { scale: 'candidate', K: 3 }) === null);
}

group('resolvePaneRange — error paths');
check('null state → null',                    resolvePaneRange(null, 0, { scale: '5w', K: 3 }) === null);
check('null paneCfg → null',                  resolvePaneRange(makeWindowsState(5), 0, null) === null);
check('no scale → null',                      resolvePaneRange(makeWindowsState(5), 0, { K: 3 }) === null);
check('unknown scale → null',
      resolvePaneRange(makeWindowsState(5), 0, { scale: 'made_up', K: 3 }) === null);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
