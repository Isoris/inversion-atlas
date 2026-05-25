// tests/test_shared_manuscript_bundle.js
//
// Behavior tests for atlases/inversion/shared/manuscript_bundle.js
// (SPEC_manuscript_bundle_export Slice 2 — boilerplate generators).
//
// Covers:
//   - renderCandidateParagraph emits the SPEC §2 paragraph for a full
//     candidate
//   - sentences disappear cleanly when their fields are missing (no
//     `{placeholder}` leakage)
//   - karyotype counts sentence only appears when n_ref/n_het/n_inv
//     are all numeric
//   - neighbor Cramér's V flips "indicating"/"not indicating" at 0.5
//   - boundary sentence renders 5' alone, 3' alone, or both
//   - p-value formatting picks the right format (fixed vs scientific)
//   - renderResultsBoilerplate auto-numbers via seq_num and forwards
//     n_candidates_total for Bonferroni
//   - renderBundleReadme includes the canonical file table
//
// Run from repo root:
//   node tests/test_shared_manuscript_bundle.js

import {
  renderCandidateParagraph,
  renderResultsBoilerplate,
  renderBundleReadme,
  renderSupplementaryTableS1,
  renderKaryotypeMatrix,
  renderAtlasLinks,
  buildManuscriptBundleBlob,
} from '../atlases/inversion/shared/manuscript_bundle.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// ---------------------------------------------------------------------------
group('renderCandidateParagraph — full candidate emits SPEC §2 paragraph');
{
  const md = renderCandidateParagraph({
    id: 'INV01', seq_num: 1, chr: 'C_gar_LG07',
    start_bp: 12_000_000, end_bp: 14_500_000,
    K: 3, n_samples: 226, n_ref: 100, n_het: 90, n_inv: 36,
    p_value: 1.5e-12,
    cluster_verdict: 'nested', n_pure: 5, n_with_data: 6, purity_threshold: 0.85,
    neighbor: { id: 'INV02', start_bp: 18_000_000, end_bp: 19_500_000, cramers_v: 0.72 },
    boundary_5: { method: 'PCA-edge', bp: 12_010_000, ci_bp: 8_000 },
    boundary_3: { method: 'recombination-suppression', bp: 14_490_000, ci_bp: 15_000 },
  }, { n_candidates_total: 30 });

  check('paragraph starts with seq_num + coords',
        md.startsWith('**Inversion 1 — C_gar_LG07, 12.00–14.50 Mb**'));
  check('span sentence renders 2.50 Mb',  md.includes('2.50 Mb'));
  check('karyotype counts sentence present',
        md.includes('100 REF') && md.includes('90 HET') && md.includes('36 INV'));
  check('K=3 noted',                       md.includes('K=3'));
  check('p-value scientific form',         md.includes('p = 1.50e-12'));
  check('Bonferroni note includes n=30',   md.includes('30 candidates'));
  check('cluster_verdict sentence',        md.includes('substructure within the heterozygote class was nested'));
  check('purity fraction 5/6 ≥ 0.85',      md.includes('5/6 K=6 groups pure') && md.includes('0.85'));
  check('neighbor sentence with INV02',    md.includes('INV02') && md.includes('0.720'));
  check('indicates shared ancestry (V≥0.5)', md.includes('indicating shared chromosome ancestry'));
  check("5'-end boundary present",         md.includes("5'-end PCA-edge"));
  check("3'-end boundary present",         md.includes("3'-end recombination-suppression"));
  check('no {placeholder} leakage',        !/\{[a-z_]+\}/i.test(md));
}

// ---------------------------------------------------------------------------
group('renderCandidateParagraph — minimal candidate degrades gracefully');
{
  const md = renderCandidateParagraph({
    id: 'INV-X', chr: 'C_gar_LG02',
    start_bp: 5_000_000, end_bp: 6_000_000,
  });
  check('heading still rendered',           md.startsWith('**Inversion — C_gar_LG02, 5.00–6.00 Mb**'));
  check('span sentence still rendered',     md.includes('1.00 Mb'));
  check('no karyotype counts sentence',     !md.includes('REF') && !md.includes('HET'));
  check('no p-value sentence',              !md.includes('Cochran-Armitage'));
  check('no substructure sentence',         !md.includes('substructure'));
  check('no neighbor sentence',             !md.includes('Cramér'));
  check('no boundary sentence',             !md.includes('Boundary resolution'));
  check('no placeholder leakage',           !/\{[a-z_]+\}/i.test(md));
}

// ---------------------------------------------------------------------------
group('neighbor sentence — V < 0.5 → "not indicating"');
{
  const md = renderCandidateParagraph({
    id: 'INV-A', chr: 'LG01', start_bp: 0, end_bp: 1_000_000,
    neighbor: { id: 'INV-B', start_bp: 2_000_000, end_bp: 3_000_000, cramers_v: 0.12 },
  });
  check('V = 0.12 → not indicating shared ancestry',
        md.includes('not indicating shared chromosome ancestry'));
}

// ---------------------------------------------------------------------------
group('boundary sentence renders 5\'-only and 3\'-only');
{
  const md5 = renderCandidateParagraph({
    id: 'X', chr: 'LG01', start_bp: 0, end_bp: 1_000_000,
    boundary_5: { method: 'PCA-edge', bp: 100, ci_bp: 50 },
  });
  check("5'-only boundary sentence",      md5.includes("5'-end PCA-edge") && !md5.includes("3'-end"));

  const md3 = renderCandidateParagraph({
    id: 'X', chr: 'LG01', start_bp: 0, end_bp: 1_000_000,
    boundary_3: { method: 'TE-anchor', bp: 999000, ci_bp: 250 },
  });
  check("3'-only boundary sentence",      md3.includes("3'-end TE-anchor") && !md3.includes("5'-end"));
}

// ---------------------------------------------------------------------------
group('p-value formatting picks fixed vs scientific');
{
  const mdFixed = renderCandidateParagraph({
    id: 'X', chr: 'LG01', start_bp: 0, end_bp: 1_000_000, p_value: 0.04,
  });
  check('p = 0.04 → fixed 0.040', mdFixed.includes('p = 0.040'));

  const mdSci = renderCandidateParagraph({
    id: 'X', chr: 'LG01', start_bp: 0, end_bp: 1_000_000, p_value: 3.2e-8,
  });
  check('p < 0.01 → scientific 3.20e-8', mdSci.includes('p = 3.20e-8'));
}

// ---------------------------------------------------------------------------
group('renderResultsBoilerplate — auto-numbers + Bonferroni');
{
  const cands = [
    { id: 'INV01', chr: 'LG01', start_bp: 0,         end_bp: 1_000_000, p_value: 0.001 },
    { id: 'INV02', chr: 'LG02', start_bp: 2_000_000, end_bp: 3_000_000, p_value: 0.5 },
    { id: 'INV03', chr: 'LG03', start_bp: 5_000_000, end_bp: 6_000_000 },   // no p-value
  ];
  const md = renderResultsBoilerplate(cands);
  check('paragraph 1 numbered "Inversion 1"',  md.includes('**Inversion 1 — LG01'));
  check('paragraph 2 numbered "Inversion 2"',  md.includes('**Inversion 2 — LG02'));
  check('paragraph 3 numbered "Inversion 3"',  md.includes('**Inversion 3 — LG03'));
  check('Bonferroni note uses total = 3',      md.includes('3 candidates'));
  check('paragraphs separated by blank line',  md.split('\n\n').length >= 3);
  check('candidate without p-value skips test sentence',
        // INV03 paragraph should not include 'Cochran-Armitage'
        md.split('**Inversion 3')[1] && !md.split('**Inversion 3')[1].includes('Cochran-Armitage'));
}

// ---------------------------------------------------------------------------
group('renderResultsBoilerplate — empty/invalid input');
{
  const empty = renderResultsBoilerplate([]);
  check('empty array → friendly placeholder',  empty.includes('No confirmed candidates'));
  const noArr = renderResultsBoilerplate(null);
  check('null input → friendly placeholder',   noArr.includes('No confirmed candidates'));
}

// ---------------------------------------------------------------------------
group('renderBundleReadme — file table + metadata');
{
  const md = renderBundleReadme({
    atlas_version: 'v0.42',
    generated_at: '2026-05-26T10:00:00Z',
    n_candidates: 7,
    chrom_set: ['C_gar_LG01', 'C_gar_LG02', 'C_gar_LG07'],
  });
  check('headline includes "Manuscript bundle"', md.startsWith('# Manuscript bundle'));
  check('atlas version surfaced',                md.includes('v0.42'));
  check('generated date surfaced',               md.includes('2026-05-26'));
  check('n_candidates surfaced',                 md.includes('7'));
  check('chrom list surfaced',                   md.includes('C_gar_LG07'));
  check('lists candidate_catalogue.tsv',         md.includes('`candidate_catalogue.tsv`'));
  check('lists results_boilerplate.md',          md.includes('`results_boilerplate.md`'));
  check('lists supplementary_table_S1.tsv',      md.includes('`supplementary_table_S1.tsv`'));
  check('NOT-included section present',          md.includes('does NOT include'));
}

// ---------------------------------------------------------------------------
group('renderSupplementaryTableS1 — header + rows');
{
  const cands = [
    {
      id: 'INV01', chr: 'LG07', start_bp: 1_000_000, end_bp: 3_500_000,
      span_kb: 2500, K: 3, verdict: 'tier1', source: 'haplotype_regimes',
      n_samples: 226, n_ref: 100, n_het: 90, n_inv: 36,
      p_value: 1.2e-9, silhouette: 0.72, coherence: 0.81, fam_purity: 0.94,
      cluster_ok: true,
      neighbor: { id: 'INV02', cramers_v: 0.5 },
      boundary_5: { method: 'PCA-edge', bp: 1_010_000, ci_bp: 8_000 },
      boundary_3: { method: 'TE-anchor', bp: 3_490_000, ci_bp: 12_000 },
    },
    {
      id: 'INV02', chr: 'LG08', start_bp: 9_000_000, end_bp: 10_000_000,
      // sparse — most fields absent
    },
  ];
  const tsv = renderSupplementaryTableS1(cands);
  const lines = tsv.split('\n');
  check('header has 26 columns',  lines[0].split('\t').length === 26);
  check('first column is seq_num', lines[0].startsWith('seq_num\t'));
  check('row count = 2 + header',  lines.length === 3);
  // Inspect a few cells of row 1 (full candidate).
  const row1 = lines[1].split('\t');
  check('row1.seq_num = 1',        row1[0] === '1');
  check('row1.id = INV01',         row1[1] === 'INV01');
  check('row1.K = 3',              row1[6] === '3');
  check('row1.p_value preserved',  row1[13] === '1.2e-9' || row1[13] === String(1.2e-9));
  check('row1.cluster_ok = "true"',row1[17] === 'true');
  check('row1.neighbor_id INV02', row1[18] === 'INV02');
  check('row1.boundary_5_method', row1[20] === 'PCA-edge');
  // Sparse row — missing numerics render as empty string, not 'null'/'undefined'.
  const row2 = lines[2].split('\t');
  check('row2.span_kb empty',      row2[5] === '');
  check('row2.K empty',            row2[6] === '');
  check('row2.cluster_ok empty',   row2[17] === '');
  check('row2.neighbor_id empty',  row2[18] === '');
  check('no "null" tokens leak',   !tsv.includes('\tnull\t') && !tsv.includes('\tundefined\t'));
}

// ---------------------------------------------------------------------------
group('renderSupplementaryTableS1 — strips embedded tab/newline from string cells');
{
  // A bad verdict string with embedded tab would shift columns; the
  // renderer must scrub it.
  const tsv = renderSupplementaryTableS1([
    { id: 'INVX', chr: 'LG01', verdict: 'tier1\tweird', source: 'auto\nflagged' },
  ]);
  const row = tsv.split('\n')[1].split('\t');
  check('verdict tab scrubbed',     row[7] === 'tier1 weird');
  check('source newline scrubbed',  row[8] === 'auto flagged');
  check('row still has 26 columns', row.length === 26);
}

// ---------------------------------------------------------------------------
group('renderKaryotypeMatrix — sample × candidate grid');
{
  const cands = [
    { id: 'INV01', locked_labels: new Int8Array([0, 1, 2, -1]),
      label_map: { 0: 'REF', 1: 'HET', 2: 'INV' } },
    { id: 'INV02', locked_labels: [0, 0, 1, 1] },  // no label_map → raw band ids
    { id: 'INV03' },                                // no locked_labels → all NA
  ];
  const samples = [
    { cga: 'CGA_001' },
    { cga: 'CGA_002' },
    { id: 'S2' },
    { sample: 'S3' },
  ];
  const tsv = renderKaryotypeMatrix(cands, samples);
  const lines = tsv.split('\n');
  check('header includes "sample"',   lines[0].split('\t')[0] === 'sample');
  check('header lists all 3 candidates',
        lines[0].includes('INV01') && lines[0].includes('INV02') && lines[0].includes('INV03'));
  check('row count = 4 samples + header', lines.length === 5);
  const row1 = lines[1].split('\t');
  check('CGA_001 row id',              row1[0] === 'CGA_001');
  check('CGA_001 INV01 → "REF" (mapped)', row1[1] === 'REF');
  check('CGA_001 INV02 → "0" (raw band id)', row1[2] === '0');
  check('CGA_001 INV03 → "NA"',        row1[3] === 'NA');
  const row4 = lines[4].split('\t');
  check('S3 sample id',                row4[0] === 'S3');
  check('S3 INV01 → "NA" (locked_labels[3] = -1)', row4[1] === 'NA');
  check('S3 INV02 → "1"',              row4[2] === '1');
}

// ---------------------------------------------------------------------------
group('renderKaryotypeMatrix — empty inputs');
{
  const t1 = renderKaryotypeMatrix([], []);
  check('empty cands+samples → just header', t1 === 'sample');
  const t2 = renderKaryotypeMatrix(null, null);
  check('null inputs → just header',         t2 === 'sample');
  const t3 = renderKaryotypeMatrix([{ id: 'X' }], []);
  check('candidates without samples → header only',
        t3.split('\n').length === 1 && t3.startsWith('sample\tX'));
}

// ---------------------------------------------------------------------------
group('renderAtlasLinks — per-candidate sections + 5 deep links');
{
  const md = renderAtlasLinks([
    { id: 'INV01', chr: 'LG07', start_bp: 12_000_000, end_bp: 14_500_000 },
    { id: 'INV02', chr: 'LG28', start_bp: 1_000_000, end_bp: 2_500_000 },
  ]);
  check('top header present',                  md.startsWith('# Atlas links'));
  check('INV01 section present',               md.includes('## INV01 — LG07 12.00–14.50 Mb'));
  check('INV02 section present',               md.includes('## INV02 — LG28 1.00–2.50 Mb'));
  check('Catalogue link for INV01',
        md.includes('[Catalogue row](#/inversion/catalogue?candidate_id=INV01)'));
  check('Candidate focus link for INV01',
        md.includes('[Candidate focus — multi-panel deep-dive](#/inversion/candidate_focus?candidate_id=INV01)'));
  check('Boundary refinement link for INV01',
        md.includes('[Boundary refinement](#/inversion/boundary_refinement?candidate_id=INV01)'));
  check('Haplotype regimes link uses chrom hint',
        md.includes('[Haplotype regimes (chrom LG07)](#/inversion/haplotype_regimes?chrom=LG07)'));
  check('Local PCA on dosage link uses chrom hint',
        md.includes('[Local PCA on dosage (chrom LG07)](#/inversion/local_pca_dosage?chrom=LG07)'));
  check('5 link bullets per candidate × 2 candidates = 10 bullets',
        (md.match(/^- \[/gm) || []).length === 10);
}

// ---------------------------------------------------------------------------
group('renderAtlasLinks — opts.base_url + opts.atlas_id');
{
  const md = renderAtlasLinks(
    [{ id: 'INV99', chr: 'LG01', start_bp: 0, end_bp: 1_000_000 }],
    { base_url: 'https://atlas.example.com/', atlas_id: 'evolution' });
  check('base_url prepended',
        md.includes('](https://atlas.example.com/#/evolution/catalogue?'));
  check('atlas_id swapped to evolution',
        md.includes('#/evolution/candidate_focus?candidate_id=INV99'));
}

// ---------------------------------------------------------------------------
group('renderAtlasLinks — encodeURIComponent on funky ids/chroms');
{
  const md = renderAtlasLinks([
    { id: 'INV/01 weird', chr: 'C_gar LG07', start_bp: 0, end_bp: 1_000_000 },
  ]);
  check('id is URL-encoded in links',
        md.includes('candidate_id=INV%2F01%20weird'));
  check('chrom is URL-encoded in links',
        md.includes('chrom=C_gar%20LG07'));
}

// ---------------------------------------------------------------------------
group('renderAtlasLinks — empty/invalid input');
{
  const md1 = renderAtlasLinks([]);
  check('empty array → friendly placeholder',  md1.includes('No candidates to link'));
  const md2 = renderAtlasLinks(null);
  check('null input → friendly placeholder',   md2.includes('No candidates to link'));
  // Candidates without an id are silently skipped, not rendered as section without title.
  const md3 = renderAtlasLinks([{ chr: 'LG01' }, { id: 'GOOD', chr: 'LG02', start_bp: 0, end_bp: 1 }]);
  check('candidate without id is skipped',     !md3.includes('## undefined'));
  check('valid candidate still renders',       md3.includes('## GOOD'));
}

// ---------------------------------------------------------------------------
group('buildManuscriptBundleBlob — assembles a valid zip with all artefacts');
{
  // Stub Blob for Node (zip_store.toBlob returns a Blob); we also have
  // .toBytes via createZip directly, but buildManuscriptBundleBlob is the
  // public surface so we test through it. Node 18+ has a global Blob;
  // older harnesses fall back to a thin shim.
  if (typeof globalThis.Blob === 'undefined') {
    globalThis.Blob = class {
      constructor(parts) {
        const total = parts.reduce((n, p) => n + (p.length || p.byteLength || 0), 0);
        this._buf = new Uint8Array(total);
        let off = 0;
        for (const p of parts) {
          const u8 = (p instanceof Uint8Array) ? p : new Uint8Array(p);
          this._buf.set(u8, off);
          off += u8.length;
        }
        this.size = total;
      }
      async arrayBuffer() { return this._buf.buffer.slice(this._buf.byteOffset, this._buf.byteOffset + this._buf.byteLength); }
    };
  }

  const candidates = [
    { id: 'INV01', chr: 'LG07', start_bp: 12_000_000, end_bp: 14_500_000,
      n_samples: 226, n_ref: 100, n_het: 90, n_inv: 36, p_value: 1e-9,
      locked_labels: [0, 1, 2], label_map: { 0: 'REF', 1: 'HET', 2: 'INV' } },
    { id: 'INV02', chr: 'LG28', start_bp: 1_000_000, end_bp: 2_500_000,
      locked_labels: [1, 0, 2] },
  ];
  const samples = [{ cga: 'CGA_001' }, { cga: 'CGA_002' }, { cga: 'CGA_003' }];

  const blob = await buildManuscriptBundleBlob({
    candidates, samples,
    meta: { atlas_version: 'v0.42', generated_at: '2026-05-26T10:00:00Z' },
    figures: [{ name: 'F1_ideogram.svg', svg: '<svg/>' }],
  });
  check('returns a Blob',         blob && typeof blob.arrayBuffer === 'function');
  check('blob size is non-trivial', blob.size > 500);

  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  check('starts with local file header signature',
        dv.getUint32(0, true) === 0x04034b50);
  // EOCD at the end — count must include README + 7 text artefacts + 1 figure = 9
  // (README, catalogue.tsv, catalogue.json, methods.md, results.md, S1.tsv,
  //  S2.tsv, atlas_links.md, generation_metadata.json) + figure = 10
  const eocdAt = buf.length - 22;
  check('EOCD signature at expected offset',
        dv.getUint32(eocdAt, true) === 0x06054b50);
  check('bundle contains exactly 10 files (9 text + 1 figure)',
        dv.getUint16(eocdAt + 8, true) === 10);

  // Spot-check that one of the filenames appears in the zip's raw bytes
  // (filenames are stored as utf-8 right after each local file header).
  const dec = new TextDecoder();
  const text = dec.decode(buf);
  check('contains "README.md" filename',                 text.includes('README.md'));
  check('contains "results_boilerplate.md" filename',    text.includes('results_boilerplate.md'));
  check('contains "supplementary_table_S2.tsv" filename', text.includes('supplementary_table_S2.tsv'));
  check('contains "figures/F1_ideogram.svg" filename',   text.includes('figures/F1_ideogram.svg'));
  check('contains "INV01" somewhere in the contents',    text.includes('INV01'));
}

// ---------------------------------------------------------------------------
group('buildManuscriptBundleBlob — pass-through catalogueTSV + custom methods');
{
  const blob = await buildManuscriptBundleBlob({
    candidates: [{ id: 'X', chr: 'LG01', start_bp: 0, end_bp: 1 }],
    samples: [],
    catalogueTSV: 'custom\theader\nrow1\trow2',
    methodsBoilerplate: '# Custom methods\n\nText.',
  });
  const buf = new Uint8Array(await blob.arrayBuffer());
  const text = new TextDecoder().decode(buf);
  check('caller-supplied catalogueTSV header present',
        text.includes('custom\theader'));
  check('caller-supplied methodsBoilerplate present',
        text.includes('# Custom methods'));
  check('stub methods boilerplate NOT present',
        !text.includes('placeholder. Slice 2'));
}

// ---------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
