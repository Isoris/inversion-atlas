// tests/test_shared_candidate_pca_mode.js

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
  CANDIDATE_PCA_VIEWS,
  CANDIDATE_PCA_ANCHOR_MODES,
  CANDIDATE_PCA_CENTERINGS,
  CANDIDATE_PCA_POLARITIES,
  CANDIDATE_PCA_ROW_ORDERS,
  CANDIDATE_PCA_COL_ORDERS,
  CANDIDATE_PCA_SAMPLE_COLOR_MODES,
  CANDIDATE_PCA_DISPLAY_MODES,
  CANDIDATE_PCA_DEFAULTS,
  ensureCandidatePCAMode,
  activateCandidatePCAMode,
  deactivateCandidatePCAMode,
  setCandidatePCAField,
  pcaJSONKey,
  heatmapJSONKey,
  currentPCAKey,
  currentHeatmapKey,
  getLoadedPCA,
  getLoadedHeatmap,
  stashLoadedPCA,
  stashLoadedHeatmap,
  parseCandidateURLParam,
  loadCandidateManifest,
  loadCandidatePCAJSON,
  loadCandidateHeatmapJSON,
} = await import('../atlases/inversion/shared/candidate_pca_mode.js');

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('constants');
check('VIEWS frozen, 4 entries',              Object.isFrozen(CANDIDATE_PCA_VIEWS) && CANDIDATE_PCA_VIEWS.length === 4);
check('VIEWS includes all_pairs',             CANDIDATE_PCA_VIEWS.includes('all_pairs'));
check('ANCHOR_MODES 3 entries',               CANDIDATE_PCA_ANCHOR_MODES.length === 3);
check('CENTERINGS includes custom',           CANDIDATE_PCA_CENTERINGS.includes('custom'));
check('ROW_ORDERS includes pc1_anchor',       CANDIDATE_PCA_ROW_ORDERS.includes('pc1_anchor'));
check('COL_ORDERS 4 entries',                 CANDIDATE_PCA_COL_ORDERS.length === 4);
check('SAMPLE_COLOR_MODES has 5 entries',     CANDIDATE_PCA_SAMPLE_COLOR_MODES.length === 5);
check('DISPLAY_MODES includes genotype_state', CANDIDATE_PCA_DISPLAY_MODES.includes('genotype_state'));
check('DEFAULTS frozen',                      Object.isFrozen(CANDIDATE_PCA_DEFAULTS));
check('DEFAULTS.view_name = all_pairs',       CANDIDATE_PCA_DEFAULTS.view_name === 'all_pairs');
check('DEFAULTS.weighted = true',             CANDIDATE_PCA_DEFAULTS.weighted === true);
check('DEFAULTS.anchor_mode = bi_baseline',   CANDIDATE_PCA_DEFAULTS.anchor_mode === 'bi_baseline');

// =====================================================================
group('ensureCandidatePCAMode');
{
  const state = {};
  const m = ensureCandidatePCAMode(state);
  check('initializes slot',                     !!m);
  check('active starts false',                  m.active === false);
  check('candidate_id null',                    m.candidate_id === null);
  check('interval null',                        m.interval === null);
  check('view_name defaulted',                  m.view_name === 'all_pairs');
  check('weighted defaulted true',              m.weighted === true);
  check('loaded_pca is empty {}',               Object.keys(m.loaded_pca).length === 0);
  check('loaded_heatmap is empty {}',           Object.keys(m.loaded_heatmap).length === 0);
  const m2 = ensureCandidatePCAMode(state);
  check('idempotent (same object)',             m === m2);
}
check('null state → null',                     ensureCandidatePCAMode(null) === null);

// =====================================================================
group('activateCandidatePCAMode');
{
  const state = {};
  const ok = activateCandidatePCAMode(state, {
    candidate_id: 'LG28_15.115_18.005',
    interval: { chrom: 'LG28', start: 15.115, end: 18.005 },
  });
  check('returns true',                         ok === true);
  const m = state.candidatePCAMode;
  check('active = true',                        m.active === true);
  check('candidate_id stored',                  m.candidate_id === 'LG28_15.115_18.005');
  check('interval stored (chrom)',              m.interval.chrom === 'LG28');
  check('interval stored (start)',              m.interval.start === 15.115);
  check('interval stored (end)',                m.interval.end === 18.005);
  check('view_name reset to default',           m.view_name === 'all_pairs');
}
{
  // With overrides
  const state = {};
  activateCandidatePCAMode(state, {
    candidate_id: 'X',
    interval: { chrom: 'X', start: 0, end: 1 },
    overrides: { view_name: 'tri_extras', weighted: false },
  });
  check('overrides applied (view_name)',        state.candidatePCAMode.view_name === 'tri_extras');
  check('overrides applied (weighted)',         state.candidatePCAMode.weighted === false);
  check('non-default fields preserved',         state.candidatePCAMode.anchor_mode === 'bi_baseline');
}
{
  // Re-activation clears caches
  const state = {};
  activateCandidatePCAMode(state, {
    candidate_id: 'A', interval: { chrom: 'X', start: 0, end: 1 },
  });
  state.candidatePCAMode.loaded_pca['stale'] = { foo: 1 };
  activateCandidatePCAMode(state, {
    candidate_id: 'B', interval: { chrom: 'Y', start: 0, end: 2 },
  });
  check('re-activate clears loaded_pca',        Object.keys(state.candidatePCAMode.loaded_pca).length === 0);
  check('re-activate switches candidate_id',    state.candidatePCAMode.candidate_id === 'B');
}
check('missing args → false',                  activateCandidatePCAMode({}, null) === false);
check('missing candidate_id → false',
      activateCandidatePCAMode({}, { interval: { chrom: 'X', start: 0, end: 1 } }) === false);
check('missing interval → false',              activateCandidatePCAMode({}, { candidate_id: 'X' }) === false);
check('bad interval (chrom not string) → false',
      activateCandidatePCAMode({}, { candidate_id: 'X',
        interval: { chrom: 123, start: 0, end: 1 } }) === false);
check('bad interval (end < start) → false',
      activateCandidatePCAMode({}, { candidate_id: 'X',
        interval: { chrom: 'X', start: 5, end: 3 } }) === false);
check('null state → false',                    activateCandidatePCAMode(null, {}) === false);

// =====================================================================
group('deactivateCandidatePCAMode');
{
  const state = {};
  activateCandidatePCAMode(state, {
    candidate_id: 'X', interval: { chrom: 'X', start: 0, end: 1 },
  });
  state.candidatePCAMode.loaded_pca['k'] = {};
  deactivateCandidatePCAMode(state);
  const m = state.candidatePCAMode;
  check('active = false',                       m.active === false);
  check('candidate_id null',                    m.candidate_id === null);
  check('interval null',                        m.interval === null);
  check('loaded_pca cleared',                   Object.keys(m.loaded_pca).length === 0);
  let threw = false;
  try { deactivateCandidatePCAMode(null); } catch (_) { threw = true; }
  check('null state: no throw',                 !threw);
}

// =====================================================================
group('setCandidatePCAField');
{
  const state = {};
  ensureCandidatePCAMode(state);
  // valid enum value
  check('set view_name to bi_baseline',         setCandidatePCAField(state, 'view_name', 'bi_baseline') === true);
  check('view_name updated',                    state.candidatePCAMode.view_name === 'bi_baseline');
  // invalid enum value
  check('reject invalid view_name',             setCandidatePCAField(state, 'view_name', 'not_a_view') === false);
  check('view_name unchanged after reject',     state.candidatePCAMode.view_name === 'bi_baseline');
  // weighted boolean
  check('set weighted = false',                 setCandidatePCAField(state, 'weighted', false) === true);
  check('weighted updated',                     state.candidatePCAMode.weighted === false);
  check('reject non-boolean weighted',          setCandidatePCAField(state, 'weighted', 'yes') === false);
  // unknown field rejected
  check('reject unknown field',                 setCandidatePCAField(state, 'random_field', 1) === false);
  // null state
  check('null state → false',                   setCandidatePCAField(null, 'view_name', 'all_pairs') === false);
}

// =====================================================================
group('pcaJSONKey + heatmapJSONKey');
check('pca: all_pairs + weighted + bi_baseline',
      pcaJSONKey({ view_name: 'all_pairs', weighted: true, anchor_mode: 'bi_baseline' })
      === 'all_pairs_weighted_bi_baseline');
check('pca: bi_baseline + unweighted + view_self',
      pcaJSONKey({ view_name: 'bi_baseline', weighted: false, anchor_mode: 'view_self' })
      === 'bi_baseline_unweighted_view_self');
check('pca: missing view_name → null',
      pcaJSONKey({ weighted: true, anchor_mode: 'bi_baseline' }) === null);
check('pca: weighted not boolean → null',
      pcaJSONKey({ view_name: 'x', weighted: 'yes', anchor_mode: 'bi_baseline' }) === null);
check('pca: empty args → null',                pcaJSONKey() === null);
check('hm: all_pairs + all',                   heatmapJSONKey({ view_name: 'all_pairs', centering: 'all' }) === 'all_pairs_all');
check('hm: bi_baseline + het',                 heatmapJSONKey({ view_name: 'bi_baseline', centering: 'het' }) === 'bi_baseline_het');
check('hm: missing centering → null',          heatmapJSONKey({ view_name: 'x' }) === null);

// =====================================================================
group('currentPCAKey + currentHeatmapKey');
{
  const state = {};
  check('inactive mode → null (pca)',           currentPCAKey(state) === null);
  check('inactive mode → null (hm)',            currentHeatmapKey(state) === null);
  activateCandidatePCAMode(state, {
    candidate_id: 'X', interval: { chrom: 'X', start: 0, end: 1 },
  });
  check('active mode: pca key from defaults',   currentPCAKey(state) === 'all_pairs_weighted_bi_baseline');
  check('active mode: hm key from defaults',    currentHeatmapKey(state) === 'all_pairs_all');
  setCandidatePCAField(state, 'view_name', 'bi_baseline');
  setCandidatePCAField(state, 'weighted', false);
  check('keys reflect field changes',           currentPCAKey(state) === 'bi_baseline_unweighted_bi_baseline');
}

// =====================================================================
group('loaded_pca + loaded_heatmap cache');
{
  const state = {};
  activateCandidatePCAMode(state, {
    candidate_id: 'X', interval: { chrom: 'X', start: 0, end: 1 },
  });
  const json = { windows: [{ pc1: [0.1, 0.2], pc2: [0.3, 0.4] }] };
  check('stash pca returns true',                stashLoadedPCA(state, 'k1', json) === true);
  check('get pca returns same ref',              getLoadedPCA(state, 'k1') === json);
  check('get pca unknown key → null',            getLoadedPCA(state, 'k2') === null);
  check('stash hm returns true',                 stashLoadedHeatmap(state, 'hmk1', { foo: 1 }) === true);
  check('get hm returns object',                 getLoadedHeatmap(state, 'hmk1').foo === 1);
  check('stash null key → false',                stashLoadedPCA(state, '', json) === false);
  check('get null state → null',                 getLoadedPCA(null, 'k1') === null);
}

// =====================================================================
group('parseCandidateURLParam');
check('basic chrom_start_end',
      JSON.stringify(parseCandidateURLParam('?candidate=LG28_15.115_18.005'))
      === JSON.stringify({ candidate_id: 'LG28_15.115_18.005',
                            interval: { chrom: 'LG28', start: 15.115, end: 18.005 } }));
check('without leading ?',
      parseCandidateURLParam('candidate=LG28_15_18').interval.chrom === 'LG28');
check('chrom with embedded underscores',
      parseCandidateURLParam('?candidate=C_gar_LG28_15.0_18.0').interval.chrom === 'C_gar_LG28');
check('chrom with embedded underscores: start',
      parseCandidateURLParam('?candidate=C_gar_LG28_15.0_18.0').interval.start === 15.0);
check('chrom with embedded underscores: end',
      parseCandidateURLParam('?candidate=C_gar_LG28_15.0_18.0').interval.end === 18.0);
check('URL-encoded values decoded',
      parseCandidateURLParam('?candidate=LG28_15.5_18.5&foo=bar').interval.start === 15.5);
check('multiple params: candidate picked',
      parseCandidateURLParam('?foo=bar&candidate=X_1_2&baz=qux').interval.chrom === 'X');
check('missing param → null',                  parseCandidateURLParam('?foo=bar') === null);
check('empty string → null',                   parseCandidateURLParam('') === null);
check('null → null',                           parseCandidateURLParam(null) === null);
check('non-numeric start → null',
      parseCandidateURLParam('?candidate=X_oops_2') === null);
check('end < start → null',
      parseCandidateURLParam('?candidate=X_5_2') === null);
check('only one underscore → null',
      parseCandidateURLParam('?candidate=X_5') === null);
check('no underscore → null',
      parseCandidateURLParam('?candidate=X') === null);

// =====================================================================
group('loadCandidateManifest (mocked)');
{
  const calls = [];
  const fakeServer = {
    read: async (path, opts) => {
      calls.push({ path, opts });
      return { ok: true, status: 200, json: { schema_version: 1, available_views: ['all_pairs'] } };
    },
  };
  const r = await loadCandidateManifest(fakeServer, 'C1');
  check('ok = true',                            r.ok === true);
  check('manifest returned',                    r.manifest.schema_version === 1);
  check('correct path',                         calls[0].path === 'candidates/C1/manifest.json');
  check('opts.as = json',                       calls[0].opts.as === 'json');
}
{
  const fakeServer = { read: async () => ({ ok: false, status: 404, error: 'not found' }) };
  const r = await loadCandidateManifest(fakeServer, 'C1');
  check('404 → ok=false',                       r.ok === false);
  check('status passed through',                r.status === 404);
}
{
  const fakeServer = { read: async () => ({ ok: true, status: 200 }) };  // no json
  const r = await loadCandidateManifest(fakeServer, 'C1');
  check('no json body → ok=false',              r.ok === false);
}
{
  const r = await loadCandidateManifest(null, 'C1');
  check('no atlasServer → ok=false',            r.ok === false);
}
{
  const fakeServer = { read: async () => ({ ok: true }) };
  const r = await loadCandidateManifest(fakeServer, '');
  check('no candidate_id → ok=false',           r.ok === false);
}

// =====================================================================
group('loadCandidatePCAJSON (mocked)');
{
  const state = {};
  activateCandidatePCAMode(state, {
    candidate_id: 'C1', interval: { chrom: 'X', start: 0, end: 1 },
  });
  const calls = [];
  const fakeServer = {
    read: async (path) => {
      calls.push(path);
      return { ok: true, status: 200, json: { source: 'fake', path } };
    },
  };
  const r = await loadCandidatePCAJSON(state, fakeServer, {
    view_name: 'all_pairs', weighted: true, anchor_mode: 'bi_baseline',
  });
  check('ok = true',                            r.ok === true);
  check('key returned',                         r.key === 'all_pairs_weighted_bi_baseline');
  check('correct path',                         calls[0] === 'candidates/C1/pca/all_pairs_weighted_bi_baseline.json');
  check('cached in loaded_pca',                 !!state.candidatePCAMode.loaded_pca[r.key]);
  // Second call hits cache
  const r2 = await loadCandidatePCAJSON(state, fakeServer, {
    view_name: 'all_pairs', weighted: true, anchor_mode: 'bi_baseline',
  });
  check('second call: cached = true',           r2.cached === true);
  check('no second fetch (calls.length still 1)', calls.length === 1);
}
{
  const state = {};   // not activated
  const r = await loadCandidatePCAJSON(state, { read: async () => ({}) }, {
    view_name: 'all_pairs', weighted: true, anchor_mode: 'bi_baseline',
  });
  check('mode inactive → ok=false',             r.ok === false);
}
{
  const state = {};
  activateCandidatePCAMode(state, {
    candidate_id: 'C1', interval: { chrom: 'X', start: 0, end: 1 },
  });
  const r = await loadCandidatePCAJSON(state, { read: async () => ({}) },
    { view_name: 'all_pairs' });   // missing fields
  check('invalid fields → ok=false',            r.ok === false);
}

// =====================================================================
group('loadCandidateHeatmapJSON (mocked)');
{
  const state = {};
  activateCandidatePCAMode(state, {
    candidate_id: 'C1', interval: { chrom: 'X', start: 0, end: 1 },
  });
  const calls = [];
  const fakeServer = {
    read: async (path) => {
      calls.push(path);
      return { ok: true, status: 200, json: { source: 'hm', path } };
    },
  };
  const r = await loadCandidateHeatmapJSON(state, fakeServer, {
    view_name: 'all_pairs', centering: 'all',
  });
  check('ok = true',                            r.ok === true);
  check('key from view + centering',            r.key === 'all_pairs_all');
  check('correct path',                         calls[0] === 'candidates/C1/heatmap/all_pairs_all.json');
  check('cached in loaded_heatmap',             !!state.candidatePCAMode.loaded_heatmap[r.key]);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
