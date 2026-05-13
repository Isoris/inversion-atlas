// tests/test_shared_mgl_beagle_parser.js
//
// Unit coverage for shared/mgl_beagle_parser.js — PCAngsd-style
// Beagle GL parser + sidecar parser.

import {
  parseBeagleHeader,
  parseBeagleToDosage,
  parseBeagleSidecar,
  attachSidecar,
  dosageRowForMarker,
  dosageColumnForSample,
} from '../atlases/inversion/shared/mgl_beagle_parser.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('parseBeagleHeader');

// Standard PCAngsd: name repeats 3×.
const h1 = parseBeagleHeader(
  'marker\tallele1\tallele2\tind0\tind0\tind0\tind1\tind1\tind1\tind2\tind2\tind2'
);
check('3 samples detected',         h1.n_samples === 3);
check('samples[0] = ind0',          h1.samples[0] === 'ind0');
check('samples[2] = ind2',          h1.samples[2] === 'ind2');
check('expected_cols = 12',         h1.expected_cols === 12);

// Some producers write ind0_AA / ind0_Aa / ind0_aa — should strip
// the suffix and detect 'ind0'.
const h2 = parseBeagleHeader(
  'marker\tallele1\tallele2\tind0_AA\tind0_Aa\tind0_aa\tind1_AA\tind1_Aa\tind1_aa'
);
check('suffix-stripped samples[0]', h2.samples[0] === 'ind0');
check('suffix-stripped samples[1]', h2.samples[1] === 'ind1');
check('n_samples = 2 after strip',  h2.n_samples === 2);

// Malformed: fewer than 6 cols
const h_bad = parseBeagleHeader('marker\tallele1');
check('too few cols → 0 samples',   h_bad.n_samples === 0);

// Sample-cols count not multiple of 3 → 0 samples
const h_odd = parseBeagleHeader('marker\ta1\ta2\tind0\tind0');
check('non-3-multiple → 0 samples', h_odd.n_samples === 0);

// =====================================================================
group('parseBeagleToDosage — 3 samples × 4 markers');

// Build a tiny fixture: 4 markers, 3 samples.
// Sample0 dosage targets: 0, 1, 2, 1
// Sample1 dosage targets: 1, 0, 1, 2
// Sample2 dosage targets: 2, 2, 0, 0
// Encode as GL triples: dosage d ↔ {GL_AA, GL_Aa, GL_aa}
// Easy mapping: d=0 → (1,0,0), d=1 → (0,1,0), d=2 → (0,0,1)
function dToGL(d) {
  if (d === 0) return [1, 0, 0];
  if (d === 1) return [0, 1, 0];
  return [0, 0, 1];
}
function row(marker, a1, a2, dosages) {
  return [marker, a1, a2, ...dosages.flatMap(dToGL)].join('\t');
}
const beagle = [
  'marker\tallele1\tallele2\tind0\tind0\tind0\tind1\tind1\tind1\tind2\tind2\tind2',
  row('LG28_15234521_M0', 0, 1, [0, 1, 2]),
  row('LG28_15234521_M1', 0, 2, [1, 0, 2]),
  row('LG28_15300000_M2', 1, 2, [2, 1, 0]),
  row('LG28_15400000_M3', 0, 1, [1, 2, 0]),
].join('\n');

const parsed = parseBeagleToDosage(beagle);
check('parsed: 4 markers',           parsed.n_markers === 4);
check('parsed: 3 samples',           parsed.n_samples === 3);
check('parsed: samples preserved',
      parsed.samples[0] === 'ind0' && parsed.samples[2] === 'ind2');
check('parsed: marker name preserved',
      parsed.markers[0] === 'LG28_15234521_M0');
check('parsed: allele codes preserved',
      parsed.allele1[1] === 0 && parsed.allele2[1] === 2);
check('parsed: n_dropped = 0',       parsed.n_dropped === 0);

// Dosage check — row-major: matrix[r * n_samples + s]
const M = parsed.dosage_matrix;
const ns = parsed.n_samples;
check('marker 0 / sample 0: dosage 0',  Math.abs(M[0 * ns + 0] - 0) < 1e-9);
check('marker 0 / sample 1: dosage 1',  Math.abs(M[0 * ns + 1] - 1) < 1e-9);
check('marker 0 / sample 2: dosage 2',  Math.abs(M[0 * ns + 2] - 2) < 1e-9);
check('marker 1 / sample 0: dosage 1',  Math.abs(M[1 * ns + 0] - 1) < 1e-9);
check('marker 1 / sample 2: dosage 2',  Math.abs(M[1 * ns + 2] - 2) < 1e-9);
check('marker 2 / sample 0: dosage 2',  Math.abs(M[2 * ns + 0] - 2) < 1e-9);

// =====================================================================
group('parseBeagleToDosage — malformed row tolerance');

const badBeagle = [
  'marker\tallele1\tallele2\tind0\tind0\tind0\tind1\tind1\tind1',
  row('M0', 0, 1, [0, 1]),
  'M1\tbroken_row',     // wrong col count
  row('M2', 0, 1, [1, 2]),
].join('\n');

const bp = parseBeagleToDosage(badBeagle);
check('malformed: 2 markers kept',    bp.n_markers === 2);
check('malformed: 1 dropped',         bp.n_dropped === 1);
check('malformed: M0, M2 preserved',
      bp.markers[0] === 'M0' && bp.markers[1] === 'M2');

// Strict mode: throws
let threw = false;
try { parseBeagleToDosage(badBeagle, { skipMalformedRows: false }); }
catch (_) { threw = true; }
check('strict mode: throws on malformed row', threw);

// =====================================================================
group('parseBeagleToDosage — edge cases');

check('null → null',                 parseBeagleToDosage(null) === null);
check('empty string → null',         parseBeagleToDosage('') === null);
check('header only → 0 markers',
      parseBeagleToDosage('marker\tallele1\tallele2\tind0\tind0\tind0').n_markers === 0);

// =====================================================================
group('parseBeagleSidecar');

const sidecar = [
  'marker\tchrom\tpos\tn_alleles_obs\trole_a\trole_b\tallele_a\tallele_b\tpair_count\tmaf_pair',
  'LG28_15234521_M0\tLG28\t15234521\t2\tMAJOR\tMINOR1\tA\tG\t1834\t0.36',
  'LG28_15234521_M1\tLG28\t15234521\t3\tMAJOR\tMINOR2\tA\tT\t312\t0.18',
].join('\n');

const sm = parseBeagleSidecar(sidecar);
check('sidecar: 2 rows',             sm.size === 2);
const row0 = sm.get('LG28_15234521_M0');
check('sidecar row chrom',           row0.chrom === 'LG28');
check('sidecar row pos parsed numeric', row0.pos === 15234521);
check('sidecar row maf_pair parsed numeric',
      Math.abs(row0.maf_pair - 0.36) < 1e-9);
check('sidecar row role_a string',   row0.role_a === 'MAJOR');

check('null → null',                 parseBeagleSidecar(null) === null);
check('empty → null',                parseBeagleSidecar('') === null);

// =====================================================================
group('attachSidecar');

const withMeta = attachSidecar(parsed, sm);
check('metadata: 4 entries',         withMeta.metadata.length === 4);
check('metadata[0] populated',       withMeta.metadata[0] && withMeta.metadata[0].chrom === 'LG28');
check('metadata[2] = null (no match)', withMeta.metadata[2] === null);

// =====================================================================
group('Slice helpers');

const dr = dosageRowForMarker(parsed, 1);
check('row for marker 1: 3 entries', dr.length === 3);
check('row for marker 1: matches matrix',
      Math.abs(dr[1] - 0) < 1e-9 && Math.abs(dr[2] - 2) < 1e-9);
check('row for OOB marker → null',   dosageRowForMarker(parsed, 99) === null);

const dc = dosageColumnForSample(parsed, 1);
check('col for sample 1: 4 entries', dc.length === 4);
check('col for sample 1: matches matrix',
      Math.abs(dc[0] - 1) < 1e-9 && Math.abs(dc[1] - 0) < 1e-9);
check('col for OOB sample → null',   dosageColumnForSample(parsed, 99) === null);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
