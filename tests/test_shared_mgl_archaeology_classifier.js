// tests/test_shared_mgl_archaeology_classifier.js
import {
  normaliseMetrics, classifyArchaeology, buildArchaeologyCard,
  MGL_ARCHAEOLOGY_VERDICTS, MGL_ARCHAEOLOGY_DEFAULTS,
} from '../atlases/inversion/shared/mgl_archaeology_classifier.js';

let pass=0, fail=0;
function check(l,c){ if (c) {pass++; console.log('  ✓',l);} else {fail++; console.log('  ✗',l);} }
function group(n){ console.log('\n--- '+n+' ---'); }

group('exports');
check('verdicts frozen', Object.isFrozen(MGL_ARCHAEOLOGY_VERDICTS));
check('defaults frozen', Object.isFrozen(MGL_ARCHAEOLOGY_DEFAULTS));
check('verdicts include young_clean', MGL_ARCHAEOLOGY_VERDICTS.includes('young_clean'));
check('verdicts include complex_nested', MGL_ARCHAEOLOGY_VERDICTS.includes('complex_nested'));

group('normaliseMetrics');
check('null → null', normaliseMetrics(null) === null);
const n = normaliseMetrics({ pi_inv: 0.01, dxy: NaN, outgroup_present: true });
check('finite passes through', n.pi_inv === 0.01);
check('NaN → null', n.dxy === null);
check('boolean propagated', n.outgroup_present === true);

group('classifyArchaeology — canonical patterns');
// young_clean
check('young_clean fixture',
      classifyArchaeology({
        pi_inv: 0.001, dxy: 0.005, fst_hudson: 0.6,
        private_inv: 5, fixed_differences: 0,
      }).verdict === 'young_clean');
// old_divergent
check('old_divergent fixture',
      classifyArchaeology({
        pi_inv: 0.012, dxy: 0.015, fst_hudson: 0.5,
        private_inv: 50, fixed_differences: 0,
      }).verdict === 'old_divergent');
// old_swept
check('old_swept fixture',
      classifyArchaeology({
        pi_inv: 0.001, dxy: 0.015, fst_hudson: 0.5,
        private_inv: 0, fixed_differences: 0,
      }).verdict === 'old_swept');
// old_leaky
check('old_leaky fixture',
      classifyArchaeology({
        pi_inv: 0.012, dxy: 0.001, fst_hudson: 0.05,
        private_inv: 0, fixed_differences: 0,
      }).verdict === 'old_leaky');
// complex_nested
check('complex_nested fixture',
      classifyArchaeology({
        pi_inv: 0.005, dxy: 0.005, n_regimes: 4, fst_hudson: 0.2,
        private_inv: 10, fixed_differences: 0,
      }).verdict === 'complex_nested');
// recently_swept
check('recently_swept fixture',
      classifyArchaeology({
        pi_inv: 0.001, dxy: 0.001, arrangement_frequency: 0.55,
        private_inv: 0, fixed_differences: 0,
      }).verdict === 'recently_swept');
// insufficient — pi_inv missing
check('insufficient when pi_inv missing',
      classifyArchaeology({ dxy: 0.01, pi_inv: null }).verdict === 'insufficient');
// null metrics
check('null metrics → insufficient',
      classifyArchaeology(null).verdict === 'insufficient');
// leakage triggers old_leaky
check('high leakage_score → old_leaky',
      classifyArchaeology({
        pi_inv: 0.005, dxy: 0.005, leakage_score: 0.5, private_inv: 0, fixed_differences: 0,
      }).verdict === 'old_leaky');
// fixed_diffs alone → old_divergent
check('many fixed → old_divergent',
      classifyArchaeology({
        pi_inv: 0.005, dxy: 0.005, fixed_differences: 20, private_inv: 5,
      }).verdict === 'old_divergent');
// unresolved fallback
check('unresolved fallback',
      classifyArchaeology({
        pi_inv: 0.005, dxy: 0.005, fst_hudson: 0.2,
        private_inv: 5, fixed_differences: 0,
      }).verdict === 'unresolved');

group('buildArchaeologyCard');
const card = buildArchaeologyCard({
  pi_inv: 0.001, dxy: 0.005, fst_hudson: 0.6,
  private_inv: 5, fixed_differences: 0,
});
check('card has verdict', card.verdict === 'young_clean');
check('card has reason', typeof card.reason === 'string' && card.reason.length > 0);
check('card has confidence', Number.isFinite(card.confidence));
check('card has interpretation', typeof card.interpretation === 'string');
check('card.metrics normalised', card.metrics && card.metrics.pi_inv === 0.001);
check('null metrics → insufficient verdict',
      buildArchaeologyCard(null).verdict === 'insufficient');

console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
