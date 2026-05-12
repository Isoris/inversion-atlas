// tests/test_shared_scale_stability.js

import {
  SCALE_STABILITY_VERDICTS,
  SCALE_STABILITY_DEFAULTS,
  scaleStabilityVerdict,
  scaleStabilityFingerprint,
  scaleStabilityVerdictText,
  scaleStabilityVerdictCss,
  scaleStabilityPaneLabel,
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
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
