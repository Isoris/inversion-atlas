// tests/test_shared_busco_anchors.js
//
// Unit coverage for shared/busco_anchors.js — schema validator +
// per-species indexing + homology-pair derivation + density / synteny
// / architecture-class helpers.

import {
  BUSCO_ANCHORS_TOOL,
  BUSCO_ANCHORS_SCHEMA_VERSION,
  BUSCO_ARCHITECTURE_CLASSES,
  BUSCO_MIN_SHARED_FOR_SUGGEST,
  BUSCO_DEFAULT_FLANK_BP,
  isBuscoAnchorsJSON,
  indexAnchorsBySpecies,
  deriveHomologyPairs,
  buscoCountInWindow,
  buscoDensityInWindow,
  buscoDepletionVsFlank,
  buscoSyntenyScore,
  suggestArchitectureClass,
} from '../atlases/cross-species/shared/busco_anchors.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('constants');

check('TOOL = busco_anchors_v1',
      BUSCO_ANCHORS_TOOL === 'busco_anchors_v1');
check('SCHEMA_VERSION = 1',
      BUSCO_ANCHORS_SCHEMA_VERSION === 1);
check('ARCHITECTURE_CLASSES frozen',
      Object.isFrozen(BUSCO_ARCHITECTURE_CLASSES));
check('MIN_SHARED_FOR_SUGGEST = 5',
      BUSCO_MIN_SHARED_FOR_SUGGEST === 5);
check('DEFAULT_FLANK_BP = 500_000',
      BUSCO_DEFAULT_FLANK_BP === 500_000);

// =====================================================================
// Fixture: 3 species, 2 chromosomes each, mix of shared + private BUSCOs
// =====================================================================
function fixture() {
  return {
    tool: 'busco_anchors_v1',
    schema_version: 1,
    lineage_dataset: 'actinopterygii_odb10',
    n_buscos_in_dataset: 3640,
    species: [
      {
        species: 'C_gariepinus',
        assembly: 'fClaHyb_Gar_LG',
        n_complete_single_copy: 3000,
        completeness_pct: 90,
        anchors: [
          // LG28: a long collinear chromosome with 8 BUSCOs
          { busco_id: 'B1', chrom: 'LG28', start_bp:  1_000_000, end_bp:  1_002_000 },
          { busco_id: 'B2', chrom: 'LG28', start_bp:  3_000_000, end_bp:  3_002_000 },
          { busco_id: 'B3', chrom: 'LG28', start_bp:  5_000_000, end_bp:  5_002_000 },
          { busco_id: 'B4', chrom: 'LG28', start_bp:  7_000_000, end_bp:  7_002_000 },
          { busco_id: 'B5', chrom: 'LG28', start_bp: 11_000_000, end_bp: 11_002_000 },
          { busco_id: 'B6', chrom: 'LG28', start_bp: 13_000_000, end_bp: 13_002_000 },
          { busco_id: 'B7', chrom: 'LG28', start_bp: 15_000_000, end_bp: 15_002_000 },
          { busco_id: 'B8', chrom: 'LG28', start_bp: 17_000_000, end_bp: 17_002_000 },
          // LG29: 1 BUSCO
          { busco_id: 'BX', chrom: 'LG29', start_bp:    500_000, end_bp:    502_000 },
        ],
      },
      {
        species: 'C_macrocephalus',
        assembly: 'fClaHyb_Mac_LG',
        n_complete_single_copy: 2900,
        completeness_pct: 89,
        anchors: [
          // Inversion case: same chromosome, reversed BUSCO order vs Cgar
          { busco_id: 'B1', chrom: 'LG01', start_bp: 16_000_000, end_bp: 16_002_000 },
          { busco_id: 'B2', chrom: 'LG01', start_bp: 14_000_000, end_bp: 14_002_000 },
          { busco_id: 'B3', chrom: 'LG01', start_bp: 12_000_000, end_bp: 12_002_000 },
          { busco_id: 'B4', chrom: 'LG01', start_bp: 10_000_000, end_bp: 10_002_000 },
          { busco_id: 'B5', chrom: 'LG01', start_bp:  6_000_000, end_bp:  6_002_000 },
          { busco_id: 'B6', chrom: 'LG01', start_bp:  4_000_000, end_bp:  4_002_000 },
          { busco_id: 'B7', chrom: 'LG01', start_bp:  2_000_000, end_bp:  2_002_000 },
          { busco_id: 'B8', chrom: 'LG01', start_bp:  1_000_000, end_bp:  1_002_000 },
        ],
      },
      {
        species: 'H_longifilis',
        anchors: [
          // Fission case: half on LG14, half on LG06
          { busco_id: 'B1', chrom: 'Het_LG14', start_bp: 1_000_000, end_bp: 1_002_000 },
          { busco_id: 'B2', chrom: 'Het_LG14', start_bp: 2_000_000, end_bp: 2_002_000 },
          { busco_id: 'B3', chrom: 'Het_LG14', start_bp: 3_000_000, end_bp: 3_002_000 },
          { busco_id: 'B4', chrom: 'Het_LG14', start_bp: 4_000_000, end_bp: 4_002_000 },
          { busco_id: 'B5', chrom: 'Het_LG06', start_bp: 1_000_000, end_bp: 1_002_000 },
          { busco_id: 'B6', chrom: 'Het_LG06', start_bp: 2_000_000, end_bp: 2_002_000 },
          { busco_id: 'B7', chrom: 'Het_LG06', start_bp: 3_000_000, end_bp: 3_002_000 },
          { busco_id: 'B8', chrom: 'Het_LG06', start_bp: 4_000_000, end_bp: 4_002_000 },
        ],
      },
    ],
  };
}

// =====================================================================
group('isBuscoAnchorsJSON');

check('valid fixture → ok',
      isBuscoAnchorsJSON(fixture()).ok === true);

check('null → ok=false',
      isBuscoAnchorsJSON(null).ok === false);
check('wrong tool → ok=false',
      isBuscoAnchorsJSON({ ...fixture(), tool: 'wrong_v1' }).ok === false);
check('wrong schema_version → ok=false',
      isBuscoAnchorsJSON({ ...fixture(), schema_version: 99 }).ok === false);
check('no species → ok=false',
      isBuscoAnchorsJSON({ ...fixture(), species: [] }).ok === false);
{
  // Missing anchor fields
  const bad = fixture();
  bad.species[0].anchors[0] = { chrom: 'X' };  // missing busco_id / start_bp / end_bp
  check('malformed anchor → ok=false',
        isBuscoAnchorsJSON(bad).ok === false);
}
{
  // homology_pairs must be array if present
  const f = fixture();
  f.homology_pairs = 'whatever';
  check('non-array homology_pairs → ok=false',
        isBuscoAnchorsJSON(f).ok === false);
}
check('reasons[] populated on failure',
      Array.isArray(isBuscoAnchorsJSON(null).reasons));

// =====================================================================
group('indexAnchorsBySpecies');

{
  const idx = indexAnchorsBySpecies(fixture());
  check('3 species indexed',           idx.size === 3);
  const garByChrom = idx.get('C_gariepinus');
  check('Cgar: 2 chroms',              garByChrom.size === 2);
  check('Cgar LG28: 8 anchors',        garByChrom.get('LG28').length === 8);
  check('Cgar LG28: sorted asc',
        garByChrom.get('LG28').every((a, i, arr) =>
          i === 0 || arr[i - 1].start_bp <= a.start_bp));
  const macByChrom = idx.get('C_macrocephalus');
  check('Cmac LG01: 8 anchors',        macByChrom.get('LG01').length === 8);
  check('Cmac LG01: sorted asc',
        macByChrom.get('LG01').every((a, i, arr) =>
          i === 0 || arr[i - 1].start_bp <= a.start_bp));
}
check('null data → empty map',         indexAnchorsBySpecies(null).size === 0);

// =====================================================================
group('deriveHomologyPairs — derive on the fly');

{
  const pairs = deriveHomologyPairs(fixture());
  // B1..B8 shared in all 3 species; BX only in Cgar (1 species → skip)
  check('8 cross-species pairs',       pairs.length === 8);
  check('pair shape: busco_id',
        pairs[0].busco_id && pairs[0].busco_id.startsWith('B'));
  check('pair shape: species_locations',
        pairs[0].species_locations
        && typeof pairs[0].species_locations === 'object');
  const p1 = pairs.find(p => p.busco_id === 'B1');
  check('B1 in all 3 species',
        Object.keys(p1.species_locations).length === 3);
  check('B1 Cgar location',
        p1.species_locations.C_gariepinus.chrom === 'LG28');
  check('BX private → not in pairs',
        !pairs.find(p => p.busco_id === 'BX'));
}

// =====================================================================
group('deriveHomologyPairs — fast-path when cached');

{
  const data = fixture();
  data.homology_pairs = [
    { busco_id: 'cached', species_locations: { X: { chrom: 'X', pos_bp: 1 } } },
  ];
  const pairs = deriveHomologyPairs(data);
  check('uses cached pairs verbatim',
        pairs.length === 1 && pairs[0].busco_id === 'cached');
}

// =====================================================================
group('buscoCountInWindow + buscoDensityInWindow');

{
  const idx = indexAnchorsBySpecies(fixture());
  // Cgar LG28 has 8 BUSCOs at 1, 3, 5, 7, 11, 13, 15, 17 Mb
  check('window [0, 8Mb]: 4 BUSCOs',
        buscoCountInWindow(idx, 'C_gariepinus', 'LG28', 0, 8_000_000) === 4);
  check('window [8Mb, 20Mb]: 4 BUSCOs',
        buscoCountInWindow(idx, 'C_gariepinus', 'LG28', 8_000_000, 20_000_000) === 4);
  // Density: 4 BUSCOs across 8 Mb = 0.5 / Mb
  check('density [0, 8Mb]: 0.5 / Mb',
        approx(
          buscoDensityInWindow(idx, 'C_gariepinus', 'LG28', 0, 8_000_000),
          0.5));
  // Unknown species → 0
  check('unknown species → count 0',
        buscoCountInWindow(idx, 'nobody', 'LG28', 0, 100_000_000) === 0);
  // Negative-span window
  check('end < start → density 0',
        buscoDensityInWindow(idx, 'C_gariepinus', 'LG28', 1_000_000, 500_000) === 0);
}

// =====================================================================
group('buscoDepletionVsFlank');

{
  const idx = indexAnchorsBySpecies(fixture());
  // Window [8Mb, 10Mb]: 0 BUSCOs (gap between B4@7Mb and B5@11Mb)
  // Flanks 500kb each side → [7.5, 8] + [10, 10.5] → 0 BUSCOs in flanks
  const empty = buscoDepletionVsFlank(idx, 'C_gariepinus', 'LG28',
    8_000_000, 10_000_000, { flank_bp: 500_000 });
  check('empty window: ok=true',         empty.ok === true);
  check('empty window: n_in = 0',        empty.n_in === 0);

  // Window [4, 6Mb]: B3 @ 5Mb → 1 BUSCO
  // Flanks [3.5, 4] + [6, 6.5] → B2 not inside (at 3Mb), no BUSCO in flanks
  // So flank density = 0; ratio = null
  const r2 = buscoDepletionVsFlank(idx, 'C_gariepinus', 'LG28',
    4_000_000, 6_000_000, { flank_bp: 500_000 });
  check('flank density 0 → ratio null', r2.ratio === null);

  // Bigger flank: [2.5, 4] + [6, 7.5] → catches B2 @ 3Mb + B4 @ 7Mb → 2
  const r3 = buscoDepletionVsFlank(idx, 'C_gariepinus', 'LG28',
    4_000_000, 6_000_000, { flank_bp: 1_500_000 });
  check('flank with hits: ratio finite',
        Number.isFinite(r3.ratio));

  // Invalid window
  check('invalid window → ok=false',
        buscoDepletionVsFlank(idx, 'C_gariepinus', 'LG28',
          1, 0).ok === false);
}

// =====================================================================
group('buscoSyntenyScore');

{
  const idx = indexAnchorsBySpecies(fixture());
  // Cgar LG28 vs Cmac LG01: 8 shared BUSCOs, perfectly reversed → ρ = -1
  const r = buscoSyntenyScore(idx,
    'C_gariepinus', 'LG28', 'C_macrocephalus', 'LG01');
  check('8 shared BUSCOs',              r.n_shared === 8);
  check('reversed order → ρ ≈ -1',      approx(r.rho, -1, 0.01));

  // Cgar LG28 vs Het LG14: only B1..B4 shared (4 BUSCOs), same orientation
  // → ρ = +1
  const r2 = buscoSyntenyScore(idx,
    'C_gariepinus', 'LG28', 'H_longifilis', 'Het_LG14');
  check('4 shared with Het LG14',       r2.n_shared === 4);
  check('same orientation → ρ ≈ +1',    approx(r2.rho, 1, 0.01));

  // No shared BUSCOs (different chrom in same species)
  const r3 = buscoSyntenyScore(idx,
    'C_gariepinus', 'LG29', 'C_macrocephalus', 'LG01');
  check('no shared BUSCOs → n_shared 0', r3.n_shared === 0);

  // Unknown species → 0
  const r4 = buscoSyntenyScore(idx, 'nobody', 'X', 'C_gariepinus', 'LG28');
  check('unknown species → n_shared 0', r4.n_shared === 0);
}

// =====================================================================
group('suggestArchitectureClass — Class B (synteny boundary / inversion)');

{
  const idx = indexAnchorsBySpecies(fixture());
  // Cgar LG28 with candidate covering middle → flanks land entirely
  // on Cmac LG01, BUSCO order is fully reversed → Class B
  const r = suggestArchitectureClass(idx,
    { species: 'C_gariepinus', chrom: 'LG28',
      candidate_start_bp: 7_500_000, candidate_end_bp: 10_500_000 },
    { species: 'C_macrocephalus' },
    { flank_bp: 5_000_000 });
  check('Cgar→Cmac flanks → SYNTENY_BOUNDARY',
        r.verdict === BUSCO_ARCHITECTURE_CLASSES.SYNTENY_BOUNDARY);
  check('Class B: n_shared > 0',         r.n_shared > 0);
  check('Class B: evidence has top_chrom',
        r.evidence && r.evidence.top_chrom === 'LG01');
  check('Class B: synteny_rho ≈ -1',
        approx(r.evidence.synteny_rho, -1, 0.05));
}

// =====================================================================
group('suggestArchitectureClass — Class C (fission/fusion)');

{
  const idx = indexAnchorsBySpecies(fixture());
  // Cgar LG28 flanks → Het LG14 has B1..B4, Het LG06 has B5..B8.
  // Flanks of a middle-of-chromosome candidate hit both → Class C.
  const r = suggestArchitectureClass(idx,
    { species: 'C_gariepinus', chrom: 'LG28',
      candidate_start_bp: 7_500_000, candidate_end_bp: 10_500_000 },
    { species: 'H_longifilis' },
    { flank_bp: 5_000_000 });
  check('Cgar→Het: flanks split → FUSION_FISSION',
        r.verdict === BUSCO_ARCHITECTURE_CLASSES.FUSION_FISSION);
  check('Class C: evidence has both chroms',
        r.evidence.top_chrom && r.evidence.second_chrom
        && r.evidence.top_chrom !== r.evidence.second_chrom);
}

// =====================================================================
group('suggestArchitectureClass — insufficient BUSCO');

{
  const idx = indexAnchorsBySpecies(fixture());
  // Tiny flank → only 0-1 BUSCOs land → insufficient
  const r = suggestArchitectureClass(idx,
    { species: 'C_gariepinus', chrom: 'LG28',
      candidate_start_bp: 8_000_000, candidate_end_bp: 8_500_000 },
    { species: 'C_macrocephalus' },
    { flank_bp: 100_000 });
  check('tiny flank → insufficient',
        r.verdict === BUSCO_ARCHITECTURE_CLASSES.INSUFFICIENT_BUSCO);

  // Sister species unknown → insufficient
  const r2 = suggestArchitectureClass(idx,
    { species: 'C_gariepinus', chrom: 'LG28',
      candidate_start_bp: 5_000_000, candidate_end_bp: 15_000_000 },
    { species: 'nobody' });
  check('unknown sister → insufficient',
        r2.verdict === BUSCO_ARCHITECTURE_CLASSES.INSUFFICIENT_BUSCO);

  // Missing focal / sister → uncertain
  check('null focal → uncertain',
        suggestArchitectureClass(idx, null, { species: 'C_macrocephalus' })
          .verdict === BUSCO_ARCHITECTURE_CLASSES.UNCERTAIN);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
