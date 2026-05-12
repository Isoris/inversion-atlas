// tests/test_shared_repeat_density.js
//
// Unit tests for atlases/inversion/shared/repeat_density.js — the TE
// density data layer + user prefs. Mocks localStorage on globalThis
// so persistence paths can be exercised headlessly (Node has no
// localStorage by default).

// --- Mock localStorage --- must be installed BEFORE importing the module,
// because the module probes typeof localStorage at call time, not import time.
class MockLS {
  constructor() { this.store = new Map(); }
  setItem(k, v) { this.store.set(String(k), String(v)); }
  getItem(k) { const v = this.store.get(String(k)); return v == null ? null : v; }
  removeItem(k) { this.store.delete(String(k)); }
  clear() { this.store.clear(); }
  get length() { return this.store.size; }
  key(i) {
    const keys = Array.from(this.store.keys());
    return i < keys.length ? keys[i] : null;
  }
}
globalThis.localStorage = new MockLS();

const {
  REPEAT_DENSITY_LS_PREFIX,
  REPEAT_DENSITY_PREFS_LS_KEY,
  REPEAT_DENSITY_Y_MODES,
  REPEAT_DENSITY_VIEW_MODES,
  REPEAT_DENSITY_LOESS_BANDS,
  PRIORITY_CLASSES,
  TSD_CLASSES,
  PRIORITY_Y_MODE_DEFAULTS,
  isRepeatDensityJSON,
  validateRepeatDensityChrom,
  storeRepeatDensity,
  persistRepeatDensity,
  restoreRepeatDensity,
  clearRepeatDensity,
  getRepeatDensity,
  resolveRepeatDensityClass,
  repeatDensityChromList,
  repeatDensityPrefs,
  persistRepeatDensityPrefs,
  restoreRepeatDensityPrefs,
  setRepeatDensityActiveClass,
} = await import('../atlases/inversion/shared/repeat_density.js');

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

function makeV2JSON(chrom, classes) {
  const n_windows = 4;
  const by_class = {};
  for (const cls of classes) {
    by_class[cls] = {
      densities: [0.1, 0.2, 0.3, 0.4],
      loess:     [0.15, 0.20, 0.30, 0.40],
      max_density: 0.4,
      loess_span: 0.3,
    };
  }
  return {
    version: 2,
    species: 'fClaHyb_Gar',
    binning_source: 'scrubber_windows',
    precomp_chrom: chrom,
    n_chromosomes: 1,
    n_classes: classes.length,
    classes,
    default_class: classes.includes('all_TE') ? 'all_TE' : classes[0],
    loess_span: 0.3,
    generated_at: '2026-05-12T00:00:00Z',
    chromosomes: [{
      chrom, n_windows,
      window_centers_mb: [0.1, 0.2, 0.3, 0.4],
      window_start_bp:   [0,     100000, 200000, 300000],
      window_end_bp:     [99999, 199999, 299999, 399999],
      by_class,
    }],
  };
}

// =====================================================================
group('constants');
check('LS_PREFIX is pca_scrubber_v3.repeatDensity.',
      REPEAT_DENSITY_LS_PREFIX === 'pca_scrubber_v3.repeatDensity.');
check('PREFS_LS_KEY matches legacy',
      REPEAT_DENSITY_PREFS_LS_KEY === 'pca_scrubber_v3.repeatDensity.prefs');
check('Y_MODES has 6 entries',                REPEAT_DENSITY_Y_MODES.length === 6);
check('Y_MODES includes auto / q99 / linear',
      REPEAT_DENSITY_Y_MODES.includes('auto')
      && REPEAT_DENSITY_Y_MODES.includes('q99')
      && REPEAT_DENSITY_Y_MODES.includes('linear'));
check('Y_MODES frozen',                       Object.isFrozen(REPEAT_DENSITY_Y_MODES));
check('VIEW_MODES = [full, zoomed]',
      REPEAT_DENSITY_VIEW_MODES.length === 2
      && REPEAT_DENSITY_VIEW_MODES.includes('full')
      && REPEAT_DENSITY_VIEW_MODES.includes('zoomed'));
check('LOESS_BANDS has 6 (ultra/narrow/tight/medium/wide/custom)',
      REPEAT_DENSITY_LOESS_BANDS.length === 6);
check('LOESS_BANDS frozen',                   Object.isFrozen(REPEAT_DENSITY_LOESS_BANDS));
check('PRIORITY_CLASSES[0] = all_TE',         PRIORITY_CLASSES[0] === 'all_TE');
check('PRIORITY_CLASSES frozen',              Object.isFrozen(PRIORITY_CLASSES));
check('TSD_CLASSES has 2',                    TSD_CLASSES.length === 2);
check('Y_MODE_DEFAULTS.all_TE = auto',        PRIORITY_Y_MODE_DEFAULTS['all_TE'] === 'auto');
check('Y_MODE_DEFAULTS.insertion_count = q99',
      PRIORITY_Y_MODE_DEFAULTS['insertion_count'] === 'q99');

// =====================================================================
group('isRepeatDensityJSON');
check('valid v2 JSON → true',
      isRepeatDensityJSON(makeV2JSON('LG28', ['all_TE'])) === true);
check('null → false',                         isRepeatDensityJSON(null) === false);
check('version !== 2 → false',
      isRepeatDensityJSON({ ...makeV2JSON('LG28', ['all_TE']), version: 1 }) === false);
check('wrong binning_source → false',
      isRepeatDensityJSON({ ...makeV2JSON('LG28', ['all_TE']), binning_source: 'genome_windows' }) === false);
check('empty chromosomes → false',
      isRepeatDensityJSON({ ...makeV2JSON('LG28', ['all_TE']), chromosomes: [] }) === false);
check('no chromosomes array → false',
      isRepeatDensityJSON({ version: 2, binning_source: 'scrubber_windows' }) === false);

// =====================================================================
group('validateRepeatDensityChrom');
check('valid block → true',
      validateRepeatDensityChrom(makeV2JSON('LG28', ['all_TE']).chromosomes[0]) === true);
check('null → false',                         validateRepeatDensityChrom(null) === false);
{
  const bad = makeV2JSON('LG28', ['all_TE']).chromosomes[0];
  bad.window_centers_mb = [0.1, 0.2];   // wrong length
  check('wrong window_centers_mb length → false', validateRepeatDensityChrom(bad) === false);
}
{
  const bad = makeV2JSON('LG28', ['all_TE']).chromosomes[0];
  bad.by_class.all_TE.densities = [0.1, 0.2];
  check('wrong densities length → false',     validateRepeatDensityChrom(bad) === false);
}
{
  const bad = makeV2JSON('LG28', ['all_TE']).chromosomes[0];
  bad.by_class = null;
  check('missing by_class → false',           validateRepeatDensityChrom(bad) === false);
}

// =====================================================================
group('storeRepeatDensity — happy path');
{
  const state = {};
  const chrom = storeRepeatDensity(state, makeV2JSON('LG28', ['all_TE', 'young_TE_all']));
  check('returns chrom name',                  chrom === 'LG28');
  check('state.repeatDensity created',         !!state.repeatDensity);
  check('LG28 entry present',                  !!state.repeatDensity.LG28);
  const entry = state.repeatDensity.LG28;
  check('version stored',                      entry.version === 2);
  check('species stored',                      entry.species === 'fClaHyb_Gar');
  check('default_class stored',                entry.default_class === 'all_TE');
  check('chrom_block stored',                  entry.chrom_block.n_windows === 4);
  check('classes copied (not shared ref)',     entry.classes !== makeV2JSON('LG28', []).classes
                                               && entry.classes[0] === 'all_TE');
}
{
  const state = {};
  check('storeRepeatDensity(null) → null',     storeRepeatDensity(state, null) === null);
  check('storeRepeatDensity(non-v2) → null',   storeRepeatDensity(state, { version: 1 }) === null);
  check('storeRepeatDensity(null state) → null', storeRepeatDensity(null, makeV2JSON('LG28', ['all_TE'])) === null);
}

// =====================================================================
group('storeRepeatDensity — stale-override invalidation');
{
  // Case (a): user override points at a class not present in new JSON
  const state = { repeatDensityActiveClass: { LG28: 'gone_class' } };
  storeRepeatDensity(state, makeV2JSON('LG28', ['all_TE']));
  check('case (a): saved class absent → cleared',
        !state.repeatDensityActiveClass.LG28);
}
{
  // Case (b): freshLoad + TEfull + legacy-era saved class → cleared
  const state = { repeatDensityActiveClass: { LG28: 'repeat_fragment' } };
  storeRepeatDensity(state,
    makeV2JSON('LG28', ['all_TE', 'repeat_fragment']),
    true);
  check('case (b): fresh TEfull + legacy class → cleared',
        !state.repeatDensityActiveClass.LG28);
}
{
  // Case (b) negative: NOT fresh load → preserve
  const state = { repeatDensityActiveClass: { LG28: 'repeat_fragment' } };
  storeRepeatDensity(state,
    makeV2JSON('LG28', ['all_TE', 'repeat_fragment']),
    false);
  check('case (b) negative: restore path → preserved',
        state.repeatDensityActiveClass.LG28 === 'repeat_fragment');
}
{
  // Case (b) negative: priority class is kept on fresh load
  const state = { repeatDensityActiveClass: { LG28: 'young_TE_all' } };
  storeRepeatDensity(state,
    makeV2JSON('LG28', ['all_TE', 'young_TE_all']),
    true);
  check('priority class preserved on fresh load',
        state.repeatDensityActiveClass.LG28 === 'young_TE_all');
}

// =====================================================================
group('persistRepeatDensity / restoreRepeatDensity');
{
  globalThis.localStorage.clear();
  const state = {};
  storeRepeatDensity(state, makeV2JSON('LG28', ['all_TE']));
  storeRepeatDensity(state, makeV2JSON('LG14', ['all_TE', 'young_TE_all']));
  check('persist LG28 → true',                persistRepeatDensity(state, 'LG28') === true);
  check('persist LG14 → true',                persistRepeatDensity(state, 'LG14') === true);
  check('persist non-existent chrom → false', persistRepeatDensity(state, 'LG99') === false);
  // Round-trip
  const state2 = {};
  const n = restoreRepeatDensity(state2);
  check('restored 2 chroms',                  n === 2);
  check('LG28 restored',                      !!state2.repeatDensity.LG28);
  check('LG14 restored',                      !!state2.repeatDensity.LG14);
  check('restored default_class',             state2.repeatDensity.LG28.default_class === 'all_TE');
}

// =====================================================================
group('clearRepeatDensity');
{
  globalThis.localStorage.clear();
  const state = {};
  storeRepeatDensity(state, makeV2JSON('LG28', ['all_TE']));
  persistRepeatDensity(state, 'LG28');
  check('chrom in memory before clear',       !!state.repeatDensity.LG28);
  check('chrom in localStorage before clear',
        globalThis.localStorage.getItem(REPEAT_DENSITY_LS_PREFIX + 'LG28') !== null);
  clearRepeatDensity(state, 'LG28');
  check('chrom removed from memory',          !state.repeatDensity.LG28);
  check('chrom removed from localStorage',
        globalThis.localStorage.getItem(REPEAT_DENSITY_LS_PREFIX + 'LG28') === null);
  // No-throw for null state
  let threw = false;
  try { clearRepeatDensity(null, 'LG28'); } catch (_) { threw = true; }
  check('null state: no throw',               !threw);
}

// =====================================================================
group('getRepeatDensity / repeatDensityChromList');
{
  const state = {};
  storeRepeatDensity(state, makeV2JSON('LG28', ['all_TE']));
  storeRepeatDensity(state, makeV2JSON('LG14', ['all_TE']));
  storeRepeatDensity(state, makeV2JSON('LG07', ['all_TE']));
  check('get returns entry',                  !!getRepeatDensity(state, 'LG28'));
  check('get unknown → null',                 getRepeatDensity(state, 'LG99') === null);
  check('get null state → null',              getRepeatDensity(null, 'LG28') === null);
  check('chromList sorted alpha',
        JSON.stringify(repeatDensityChromList(state)) === JSON.stringify(['LG07', 'LG14', 'LG28']));
  check('chromList no data → []',             repeatDensityChromList({}).length === 0);
}

// =====================================================================
group('resolveRepeatDensityClass');
{
  const state = {};
  storeRepeatDensity(state, makeV2JSON('LG28', ['all_TE', 'young_TE_all', 'repeat_fragment']));
  check('default → JSON default_class (all_TE)',
        resolveRepeatDensityClass(state, 'LG28') === 'all_TE');
  // User override
  state.repeatDensityActiveClass = { LG28: 'young_TE_all' };
  check('override → young_TE_all',
        resolveRepeatDensityClass(state, 'LG28') === 'young_TE_all');
  // Override points at missing class → fallback to default
  state.repeatDensityActiveClass = { LG28: 'no_such_class' };
  check('override missing class → default_class',
        resolveRepeatDensityClass(state, 'LG28') === 'all_TE');
  check('unknown chrom → null',               resolveRepeatDensityClass(state, 'LG99') === null);
}
{
  // No default_class + no all_TE → falls to repeat_fragment
  const state = {};
  const json = makeV2JSON('LG28', ['repeat_fragment', 'X']);
  json.default_class = 'nope';
  storeRepeatDensity(state, json);
  // default_class is 'nope', not in by_class → falls through to repeat_fragment
  check('missing default → repeat_fragment',
        resolveRepeatDensityClass(state, 'LG28') === 'repeat_fragment');
}
{
  // No default_class, no repeat_fragment → first available
  const state = {};
  const json = makeV2JSON('LG28', ['custom_X', 'custom_Y']);
  json.default_class = 'nope';
  storeRepeatDensity(state, json);
  check('no priority/legacy → first class',
        resolveRepeatDensityClass(state, 'LG28') === 'custom_X');
}

// =====================================================================
group('repeatDensityPrefs');
{
  const state = {};
  const prefs = repeatDensityPrefs(state);
  check('init returns prefs object',          !!prefs);
  check('default yMode = auto',               prefs.yMode === 'auto');
  check('default viewMode = full',            prefs.viewMode === 'full');
  check('default loessBands.medium = true',   prefs.loessBands.medium === true);
  check('default loessBands.ultra = false',   prefs.loessBands.ultra === false);
  check('default customSpan = 0.20',          prefs.customSpan === 0.20);
  const prefs2 = repeatDensityPrefs(state);
  check('idempotent (same object)',           prefs === prefs2);
}
{
  // Backfill: older shape without loessBands gets defaults
  const state = {
    repeatDensityPrefs: { yMode: 'q99', viewMode: 'zoomed' },
  };
  const prefs = repeatDensityPrefs(state);
  check('backfill creates loessBands',        !!prefs.loessBands);
  check('backfill medium = true',             prefs.loessBands.medium === true);
  check('backfill customSpan = 0.20',         prefs.customSpan === 0.20);
  check('existing yMode preserved',           prefs.yMode === 'q99');
}
{
  // Backfill: partial loessBands gets missing ids
  const state = {
    repeatDensityPrefs: { loessBands: { medium: false, custom: true } },
  };
  const prefs = repeatDensityPrefs(state);
  check('partial backfill: medium preserved (false)', prefs.loessBands.medium === false);
  check('partial backfill: custom preserved (true)',  prefs.loessBands.custom === true);
  check('partial backfill: ultra defaulted (false)',  prefs.loessBands.ultra === false);
}

// =====================================================================
group('persistRepeatDensityPrefs / restoreRepeatDensityPrefs');
{
  globalThis.localStorage.clear();
  const state = {
    repeatDensityActiveClass: { LG28: 'young_TE_all' },
    _repeatDensityYModeUserPicked: true,
  };
  const prefs = repeatDensityPrefs(state);
  prefs.yMode = 'log';
  prefs.viewMode = 'zoomed';
  prefs.customSpan = 0.42;
  prefs.loessBands.ultra = true;
  check('persist → true',                     persistRepeatDensityPrefs(state) === true);
  // Round-trip
  const state2 = {};
  check('restore → true',                     restoreRepeatDensityPrefs(state2) === true);
  const p2 = repeatDensityPrefs(state2);
  check('restored yMode = log',               p2.yMode === 'log');
  check('restored viewMode = zoomed',         p2.viewMode === 'zoomed');
  check('restored customSpan = 0.42',         p2.customSpan === 0.42);
  check('restored loessBands.ultra = true',   p2.loessBands.ultra === true);
  check('restored activeClass.LG28',          state2.repeatDensityActiveClass.LG28 === 'young_TE_all');
  check('restored stickiness flag',           state2._repeatDensityYModeUserPicked === true);
}
{
  // Restore rejects invalid yMode
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(REPEAT_DENSITY_PREFS_LS_KEY, JSON.stringify({
    yMode: 'NOT_A_MODE', viewMode: 'zoomed',
  }));
  const state = {};
  restoreRepeatDensityPrefs(state);
  check('invalid yMode rejected (keeps default)',
        repeatDensityPrefs(state).yMode === 'auto');
  check('valid viewMode applied',             repeatDensityPrefs(state).viewMode === 'zoomed');
}
{
  // Restore with no key → false, defaults
  globalThis.localStorage.clear();
  const state = {};
  check('restore with no key → false',        restoreRepeatDensityPrefs(state) === false);
}

// =====================================================================
group('setRepeatDensityActiveClass — y-mode auto-default');
{
  // First time setting a priority class: y-mode auto-applies
  globalThis.localStorage.clear();
  const state = {};
  setRepeatDensityActiveClass(state, 'LG28', 'all_TE');
  check('active class set',                   state.repeatDensityActiveClass.LG28 === 'all_TE');
  check('y-mode auto = auto (priority)',      repeatDensityPrefs(state).yMode === 'auto');
}
{
  // Switching to insertion_count auto-flips y to q99
  const state = {};
  repeatDensityPrefs(state).yMode = 'linear';
  setRepeatDensityActiveClass(state, 'LG28', 'insertion_count');
  check('switching to count → y=q99',         repeatDensityPrefs(state).yMode === 'q99');
}
{
  // Stickiness: user-picked y-mode is preserved
  const state = { _repeatDensityYModeUserPicked: true };
  repeatDensityPrefs(state).yMode = 'log';
  setRepeatDensityActiveClass(state, 'LG28', 'insertion_count');
  check('stickiness: user-picked y preserved', repeatDensityPrefs(state).yMode === 'log');
}
{
  // No-op when class hasn't changed (don't stomp user pref)
  const state = { repeatDensityActiveClass: { LG28: 'insertion_count' } };
  repeatDensityPrefs(state).yMode = 'linear';
  setRepeatDensityActiveClass(state, 'LG28', 'insertion_count');
  check('no-op on same class: y unchanged',   repeatDensityPrefs(state).yMode === 'linear');
}
{
  // Non-priority class: no y auto-default
  const state = {};
  repeatDensityPrefs(state).yMode = 'q90';
  setRepeatDensityActiveClass(state, 'LG28', 'some_long_tail_class');
  check('non-priority class: y unchanged',    repeatDensityPrefs(state).yMode === 'q90');
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
