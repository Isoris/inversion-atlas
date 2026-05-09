// tests/smoke_qopt_loader.mjs
//
// Smoke test for shared/loaders/qopt_loader.js — the first worked
// example of the activate-schema → extract-schema pattern (Quentin's
// chat 39 cont., post-step22 design, 2026-05-07).
//
// What this verifies:
//   - Loader reads .qopt + samples.txt and emits a self-describing
//     artifact with the canonical envelope.
//   - Headerless whitespace-separated parsing works (parseDelimited
//     was extended this round with hasHeader: false + 'whitespace'
//     sentinel sep).
//   - Cross-checks fire: row-count mismatch, K mismatch, missing
//     params, missing paths, invalid values.
//   - Q matrix is shaped [N_samples × K] with numeric values.
//   - sample order in the artifact matches samples.txt (not .qopt
//     row order — they should match anyway by NGSadmix convention,
//     but the artifact's ground truth is samples.txt).
//
// Local-only assumption: tests inject a mock fetcher; no real HTTP.

const WORKSPACE = process.env.WORKSPACE || '/home/claude/workspace/atlas-workspace';
const { loadQopt } = await import(
  `${WORKSPACE}/atlases/inversion/shared/loaders/qopt_loader.js`
);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// Mock fetcher: returns the right text for known paths.
function makeFetcher(files) {
  return {
    text: async (path) => {
      if (!(path in files)) {
        throw new Error(`mock fetcher: no content for path '${path}'`);
      }
      return files[path];
    },
  };
}

// -----------------------------------------------------------------------------
// Synthesize a minimal NGSadmix-style .qopt + samples.txt for K=3, N=4.
// Each row sums to ~1.0; mixture of single-space and tab separators
// to verify the 'whitespace' sentinel handles both.
const QOPT_K3_N4 = [
  '0.91 0.05 0.04',           // sample 1: dominant cluster 0
  '0.85\t0.10\t0.05',          // sample 2: tab-separated this time
  '0.20  0.70  0.10',          // sample 3: doubled-space, dominant cluster 1
  '0.05 0.10 0.85',            // sample 4: dominant cluster 2
].join('\n') + '\n';

const SAMPLES_N4 = [
  'sample_001',
  'sample_002',
  'sample_003',
  'sample_004',
].join('\n') + '\n';

// -----------------------------------------------------------------------------
group('Happy path: loads K=3, N=4 .qopt cleanly');

const fetcher1 = makeFetcher({
  '/data/cohort/ancestry/global/K3/ngsadmix.qopt': QOPT_K3_N4,
  '/data/cohort/ancestry/global/K3/samples.txt':   SAMPLES_N4,
});

let artifact;
try {
  artifact = await loadQopt({
    qopt_path:    '/data/cohort/ancestry/global/K3/ngsadmix.qopt',
    samples_path: '/data/cohort/ancestry/global/K3/samples.txt',
    params:       { K: 3, run_id: 'test_run_v1', seed: 42 },
    fetcher:      fetcher1,
  });
  check('loadQopt returned without throwing', true);
} catch (e) {
  check('loadQopt returned without throwing', false, e.message);
  process.exit(1);
}

check('artifact.schema === "ancestry_global_q_v1"',
      artifact.schema === 'ancestry_global_q_v1');
check('artifact.produced_by.tool === "ngsadmix"',
      artifact.produced_by && artifact.produced_by.tool === 'ngsadmix');
check('artifact.produced_by.params.K === 3',
      artifact.produced_by.params.K === 3);
check('artifact.produced_by.params.run_id preserved',
      artifact.produced_by.params.run_id === 'test_run_v1');
check('artifact.produced_by.params.seed preserved',
      artifact.produced_by.params.seed === 42);
check('artifact.inputs.qopt_path preserved',
      artifact.inputs.qopt_path === '/data/cohort/ancestry/global/K3/ngsadmix.qopt');
check('artifact.inputs.samples_path preserved',
      artifact.inputs.samples_path === '/data/cohort/ancestry/global/K3/samples.txt');

check('artifact.samples is an array of length 4',
      Array.isArray(artifact.samples) && artifact.samples.length === 4);
check('artifact.samples[0] === "sample_001"',
      artifact.samples[0] === 'sample_001');
check('artifact.samples[3] === "sample_004"',
      artifact.samples[3] === 'sample_004');

check('artifact.Q is an array of length 4',
      Array.isArray(artifact.Q) && artifact.Q.length === 4);
check('artifact.Q[0] is array of length 3',
      Array.isArray(artifact.Q[0]) && artifact.Q[0].length === 3);
check('artifact.Q[0][0] ~= 0.91 (mixed-whitespace row 1 parsed)',
      Math.abs(artifact.Q[0][0] - 0.91) < 1e-9, `actual: ${artifact.Q[0][0]}`);
check('artifact.Q[1][1] ~= 0.10 (tab-separated row 2 parsed)',
      Math.abs(artifact.Q[1][1] - 0.10) < 1e-9, `actual: ${artifact.Q[1][1]}`);
check('artifact.Q[2][2] ~= 0.10 (double-space row 3 parsed)',
      Math.abs(artifact.Q[2][2] - 0.10) < 1e-9, `actual: ${artifact.Q[2][2]}`);
check('artifact.Q[3][2] ~= 0.85 (final row parsed)',
      Math.abs(artifact.Q[3][2] - 0.85) < 1e-9, `actual: ${artifact.Q[3][2]}`);

// Verify Q rows sum to ~1 (sanity, not a hard assertion against drift).
for (let i = 0; i < artifact.Q.length; i++) {
  const sum = artifact.Q[i].reduce((a, b) => a + b, 0);
  check(`Q row ${i} sums to ~1.0 (got ${sum.toFixed(4)})`,
        Math.abs(sum - 1.0) < 1e-6);
}

// -----------------------------------------------------------------------------
group('Cross-check: row-count mismatch is rejected');

const SAMPLES_N3 = ['s1', 's2', 's3'].join('\n');  // 3 samples, but qopt has 4
const fetcher2 = makeFetcher({
  '/qopt': QOPT_K3_N4,
  '/samples': SAMPLES_N3,
});

let mismatchOK = false; let mismatchErr = '';
try {
  await loadQopt({
    qopt_path: '/qopt', samples_path: '/samples',
    params: { K: 3 }, fetcher: fetcher2,
  });
} catch (e) {
  mismatchOK = true;
  mismatchErr = e.message;
}
check('loadQopt threw on row-count mismatch', mismatchOK);
check('error message mentions row-count mismatch',
      mismatchOK && /row-count mismatch/i.test(mismatchErr),
      mismatchErr);

// -----------------------------------------------------------------------------
group('Cross-check: K mismatch is rejected');

// .qopt has K=3 columns but caller claims K=4.
let kMismatchOK = false; let kMismatchErr = '';
try {
  await loadQopt({
    qopt_path: '/data/cohort/ancestry/global/K3/ngsadmix.qopt',
    samples_path: '/data/cohort/ancestry/global/K3/samples.txt',
    params: { K: 4 },
    fetcher: fetcher1,
  });
} catch (e) {
  kMismatchOK = true;
  kMismatchErr = e.message;
}
check('loadQopt threw on K mismatch', kMismatchOK);
check('error message mentions column count and K',
      kMismatchOK && /columns but params\.K = 4/.test(kMismatchErr),
      kMismatchErr);

// -----------------------------------------------------------------------------
group('Validation: missing required inputs');

const cases = [
  { label: 'missing qopt_path',
    args: { samples_path: '/s', params: { K: 3 } },
    pattern: /qopt_path is required/ },
  { label: 'missing samples_path',
    args: { qopt_path: '/q', params: { K: 3 } },
    pattern: /samples_path is required/ },
  { label: 'missing params',
    args: { qopt_path: '/q', samples_path: '/s' },
    pattern: /params is required/ },
  { label: 'missing params.K',
    args: { qopt_path: '/q', samples_path: '/s', params: {} },
    pattern: /params\.K is required/ },
  { label: 'invalid params.K (=1)',
    args: { qopt_path: '/q', samples_path: '/s', params: { K: 1 } },
    pattern: /params\.K must be an integer in \[2, 50\]/ },
];

for (const c of cases) {
  let threw = false; let msg = '';
  try { await loadQopt(c.args); }
  catch (e) { threw = true; msg = e.message; }
  check(c.label, threw && c.pattern.test(msg), msg);
}

// -----------------------------------------------------------------------------
group('Edge case: empty samples.txt is rejected');

const fetcher3 = makeFetcher({
  '/qopt': QOPT_K3_N4,
  '/samples': '\n# all comments\n# no real entries\n\n',
});
let emptyOK = false; let emptyErr = '';
try {
  await loadQopt({
    qopt_path: '/qopt', samples_path: '/samples',
    params: { K: 3 }, fetcher: fetcher3,
  });
} catch (e) { emptyOK = true; emptyErr = e.message; }
check('loadQopt threw on empty samples.txt', emptyOK);
check('error message mentions samples_path empty',
      emptyOK && /is empty/.test(emptyErr), emptyErr);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
