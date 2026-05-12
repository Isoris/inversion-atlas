// tests/test_shared_atlas_export.js
//
// Unit coverage for shared/atlas_export.js — atlas candidate export
// envelope (legacy lines 61035 + 61364-61435).

import * as AE from '../atlases/inversion/shared/atlas_export.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('Constants');
check('format_version exported',
      AE.ATLAS_EXPORT_FORMAT_VERSION === 'atlas_candidate_export_v2');
check('default version string',
      typeof AE.ATLAS_DEFAULT_VERSION_STRING === 'string');

// -----------------------------------------------------------------------------
group('dumpAtlasConstants');
const constants = AE.dumpAtlasConstants();
check('diamond section: 3 keys',
      Object.keys(constants.diamond).length === 3);
check('diamond split ratio = 1.5',
      constants.diamond._DD_SPLIT_RATIO_THRESHOLD === 1.5);
check('band_reach section: 4 keys',
      Object.keys(constants.band_reach).length === 4);
check('band_reach narrow_threshold = 2',
      constants.band_reach._BREACH_NARROW_THRESHOLD === 2);
check('band_reach_bimodality section: 5 keys',
      Object.keys(constants.band_reach_bimodality).length === 5);
check('inheritance section: cosine threshold',
      typeof constants.inheritance._IGC_DEFAULT_COSINE_DIST_THRESHOLD === 'number');

// -----------------------------------------------------------------------------
group('dumpHaplotypeVocabs');
check('no state → {}',         Object.keys(AE.dumpHaplotypeVocabs(null)).length === 0);
check('no field → {}',         Object.keys(AE.dumpHaplotypeVocabs({})).length === 0);

const vocabs = AE.dumpHaplotypeVocabs({
  haplotypeVocabs: { cand_A: 'detailed', cand_B: 'legacy' },
});
check('vocabs propagated',     vocabs.cand_A === 'detailed' && vocabs.cand_B === 'legacy');
// Returned object is a copy, not the original ref
const orig = { cand_X: 'detailed' };
const copy = AE.dumpHaplotypeVocabs({ haplotypeVocabs: orig });
check('returns a copy not original ref',  copy !== orig);

// -----------------------------------------------------------------------------
group('buildCohortInheritanceBlock');
check('no state → null',       AE.buildCohortInheritanceBlock(null) === null);
check('no result → null',      AE.buildCohortInheritanceBlock({}) === null);

const inhBlock = AE.buildCohortInheritanceBlock({
  inheritanceResult: {
    dendrogram: { dummy: true },
    items_meta: [{ id: 'cA' }, { id: 'cB' }],
    rtab: { foo: 'bar' },
    cut: { group_id_per_band: [0, 1] },
  },
  gPanelInheritanceThreshold: 0.20,
});
check('dendrogram preserved',  inhBlock.dendrogram.dummy === true);
check('items_meta cloned',     inhBlock.items_meta.length === 2);
check('threshold propagated',  inhBlock.threshold === 0.20);

// Missing threshold → null
const inhNoThr = AE.buildCohortInheritanceBlock({
  inheritanceResult: { dendrogram: {}, items_meta: [], rtab: {}, cut: {} },
});
check('missing threshold → null',  inhNoThr.threshold === null);

// -----------------------------------------------------------------------------
group('buildAtlasCandidateExport: empty state paths');
// Null state → empty envelope (still emits format_version + provenance)
const empty1 = AE.buildAtlasCandidateExport(null);
check('null state: format_version present', empty1.format_version === AE.ATLAS_EXPORT_FORMAT_VERSION);
check('null state: candidates empty',       empty1.candidates.length === 0);
check('null state: provenance.mode default',
      empty1.atlas_provenance.mode === 'default');

const empty2 = AE.buildAtlasCandidateExport({});
check('no candidates dict: empty bundle',   empty2.candidates.length === 0);

// -----------------------------------------------------------------------------
group('buildAtlasCandidateExport: populated');
const state = {
  k: 3,
  kMode: 'fixed_k_3',
  activeMode: 'default',
  haplotypeVocabs: { cand_A: 'detailed' },
  candidates: {
    cand_A: { id: 'cand_A', start_bp: 1_000_000, end_bp: 2_000_000 },
    cand_B: { id: 'cand_B', start_bp:   500_000, end_bp: 1_500_000 },
  },
  data: {
    chrom: 'LG28',
    n_windows: 120,
    samples: [
      { id: 'S1', family_id: 1 },
      { id: 'S2', family_id: 2 },
    ],
  },
  gPanelInheritanceThreshold: 0.15,
  inheritanceResult: {
    dendrogram: { foo: 1 }, items_meta: [{ id: 'cand_A' }],
    rtab: {}, cut: { group_id_per_band: [0] },
  },
};

const now = new Date('2026-05-12T12:00:00Z');
const exp = AE.buildAtlasCandidateExport(state, {
  buildRecord: (c) => ({
    candidate_id: c.id, start_bp: c.start_bp, end_bp: c.end_bp,
  }),
  atlasVersion: 'v4.test',
  now,
});

check('provenance: atlas_version override',
      exp.atlas_provenance.atlas_version === 'v4.test');
check('provenance: exported_at uses passed now',
      exp.atlas_provenance.exported_at === '2026-05-12T12:00:00.000Z');
check('provenance: mode = default',
      exp.atlas_provenance.mode === 'default');
check('provenance: atlas_constants embedded',
      exp.atlas_provenance.atlas_constants.diamond._DD_SPLIT_RATIO_THRESHOLD === 1.5);
check('provenance: haplotype_vocabs propagated',
      exp.atlas_provenance.haplotype_vocabs.cand_A === 'detailed');
check('provenance: active_K = 3',
      exp.atlas_provenance.active_K === 3);
check('provenance: kMode',
      exp.atlas_provenance.kMode === 'fixed_k_3');

check('cohort.n_samples',        exp.cohort.n_samples === 2);
check('cohort.chrom',             exp.cohort.chrom === 'LG28');
check('cohort.n_windows',         exp.cohort.n_windows === 120);
check('cohort.samples populated', exp.cohort.samples.length === 2);
check('cohort.inheritance_result present',
      exp.cohort.inheritance_result && exp.cohort.inheritance_result.threshold === 0.15);

check('candidates: 2 records',          exp.candidates.length === 2);
check('candidates sorted by start_bp',  exp.candidates[0].candidate_id === 'cand_B');

// candidate_id filter
const singleExp = AE.buildAtlasCandidateExport(state, {
  buildRecord: (c) => ({ candidate_id: c.id }),
  candidate_id: 'cand_A',
});
check('candidate_id filter: 1 record',  singleExp.candidates.length === 1);
check('candidate_id filter: matches',   singleExp.candidates[0].candidate_id === 'cand_A');

// No buildRecord → empty candidates array
const noBuilder = AE.buildAtlasCandidateExport(state);
check('no buildRecord: candidates empty + cohort still emitted',
      noBuilder.candidates.length === 0 && noBuilder.cohort.n_samples === 2);

// buildRecord that throws → skipped silently
const withThrowing = AE.buildAtlasCandidateExport(state, {
  buildRecord: (c) => {
    if (c.id === 'cand_A') throw new Error('boom');
    return { candidate_id: c.id };
  },
});
check('throwing buildRecord: bad candidate skipped',
      withThrowing.candidates.length === 1 &&
      withThrowing.candidates[0].candidate_id === 'cand_B');

// Mode override → detailed
const stateDetailed = Object.assign({}, state, {
  candidates_detailed: { dA: { id: 'dA', start_bp: 0, end_bp: 100 } },
});
const detailedExp = AE.buildAtlasCandidateExport(stateDetailed, {
  mode: 'detailed',
  buildRecord: (c) => ({ candidate_id: c.id }),
});
check('detailed mode: reads candidates_detailed',
      detailedExp.candidates.length === 1 && detailedExp.candidates[0].candidate_id === 'dA');

// -----------------------------------------------------------------------------
group('downloadAtlasExport');
let downloadCalls = [];
const result = AE.downloadAtlasExport(state, {
  buildRecord: (c) => ({ candidate_id: c.id, start_bp: c.start_bp }),
  onDownload: (name, content, mime) => downloadCalls.push({ name, content, mime }),
  now: new Date('2026-05-12T10:30:45Z'),
});
check('returns the envelope',
      result && result.format_version === AE.ATLAS_EXPORT_FORMAT_VERSION);
check('onDownload fired',                 downloadCalls.length === 1);
check('mime = application/json',          downloadCalls[0].mime === 'application/json');
check('filename has atlas_candidate_export',
      downloadCalls[0].name.startsWith('atlas_candidate_export'));
check('filename ends with .json',         downloadCalls[0].name.endsWith('.json'));
check('content is valid JSON',
      (() => { try { JSON.parse(downloadCalls[0].content); return true; }
                 catch (_) { return false; } })());
check('content contains cohort.chrom',
      downloadCalls[0].content.includes('"LG28"'));

// candidate_id filter: appears in filename
downloadCalls = [];
AE.downloadAtlasExport(state, {
  buildRecord: (c) => ({ candidate_id: c.id }),
  candidate_id: 'cand_A',
  onDownload: (name, _c, _m) => downloadCalls.push({ name }),
});
check('candidate_id appears in filename',
      downloadCalls[0].name.includes('cand_A'));

// Custom filename
downloadCalls = [];
AE.downloadAtlasExport(state, {
  buildRecord: (c) => ({ candidate_id: c.id }),
  filename: 'my_custom_export.json',
  onDownload: (name) => downloadCalls.push(name),
});
check('custom filename respected',  downloadCalls[0] === 'my_custom_export.json');

// Throwing onDownload: silent
let safe = true;
try {
  AE.downloadAtlasExport(state, {
    buildRecord: (c) => ({ candidate_id: c.id }),
    onDownload: () => { throw new Error('boom'); },
  });
} catch (_) { safe = false; }
check('throwing onDownload: silent',  safe);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
