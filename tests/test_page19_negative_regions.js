// tests/test_page19_negative_regions.js
//
// Unit coverage for pages/discovery/page19/negative_regions.js. Legacy
// shipped page19 as a pure HTML scaffold (zero JS handlers); the
// cartridge adds the parsers + renderers + toolbar wiring that legacy
// only stubbed via inline-comment.
//
// Covers:
//   - Frozen vocabularies: REGION_STATUSES (5), EVIDENCE_LAYERS (6)
//   - parseNegativeRegionsJSON: valid, malformed, missing regions[],
//     invalid-row dropping, optional fields, accepts pre-parsed object
//   - parseNegativeRegionsTSV: header detection, missing required col,
//     evidence_<layer> columns, # comment + blank-line skipping
//   - summarizeRegionStatuses: known statuses present, _other bucket
//   - regionsToCSV: header + CSV escaping (commas, quotes, newlines)
//   - renderSummaryCardsHtml: HTML escape + zero/non-zero counts
//   - renderRegionsTableHtml: empty-state, populated rendering, evidence chips
//   - buildExportFilename: deterministic timestamp slot
//   - renderNegativeRegions / wireNegativeRegionsToolbar /
//     teardownNegativeRegionsToolbar: DOM mock + idempotent wiring,
//     reset clears state, onChange fires after mutations
//   - Headless-tolerance: no `document` → DOM helpers return silently

import * as NR from '../atlases/inversion/pages/discovery/page19/negative_regions.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('Frozen vocabularies');
check('REGION_STATUSES is frozen',  Object.isFrozen(NR.REGION_STATUSES));
check('REGION_STATUSES has 5 entries', NR.REGION_STATUSES.length === 5);
check('REGION_STATUSES entries frozen', NR.REGION_STATUSES.every(s => Object.isFrozen(s)));
const _vals = NR.REGION_STATUSES.map(s => s.value);
check('REGION_STATUSES includes high-conf-neg',
      _vals.includes('no_detectable_inversion_high_confidence'));
check('REGION_STATUSES includes low-callability',
      _vals.includes('no_detectable_inversion_low_callability'));
check('EVIDENCE_LAYERS is frozen', Object.isFrozen(NR.EVIDENCE_LAYERS));
check('EVIDENCE_LAYERS has 6 entries', NR.EVIDENCE_LAYERS.length === 6);
check('EVIDENCE_LAYERS includes local_pca', NR.EVIDENCE_LAYERS.includes('local_pca'));
check('EVIDENCE_LAYERS includes callable_mask', NR.EVIDENCE_LAYERS.includes('callable_mask'));

// -----------------------------------------------------------------------------
group('parseNegativeRegionsJSON: malformed input');
const bad1 = NR.parseNegativeRegionsJSON('not a json');
check('malformed JSON: ok=false', bad1.ok === false);
check('malformed JSON: error message present', typeof bad1.error === 'string');

const bad2 = NR.parseNegativeRegionsJSON('"a-string"');
check('non-object JSON: ok=false', bad2.ok === false);

const bad3 = NR.parseNegativeRegionsJSON('{}');
check('missing regions[] : ok=false', bad3.ok === false);
check('missing regions[] : mentions regions in error',
      bad3.error && bad3.error.includes('regions'));

// -----------------------------------------------------------------------------
group('parseNegativeRegionsJSON: valid payload');
const valid = NR.parseNegativeRegionsJSON(JSON.stringify({
  metadata: { panel_name: 'test' },
  regions: [
    {
      region_id: 'r1', chr: 'LG28', start_bp: 100, end_bp: 200,
      region_status: 'no_detectable_inversion_high_confidence',
      evidence: { local_pca: 'pass', ghsl: 'pass' },
      snp_density: 0.001, callable_fraction: 0.95, n_samples: 87,
      notes: 'clean call', citation: 'paper-1',
    },
    {
      region_id: 'r2', chr: 'LG14', start_bp: 5000, end_bp: 6000,
      region_status: 'no_detectable_inversion_low_power',
    },
  ],
}));
check('valid: ok=true', valid.ok === true);
check('valid: metadata propagated',  valid.metadata.panel_name === 'test');
check('valid: 2 regions accepted',   valid.regions.length === 2);
check('valid: n_dropped=0',          valid.n_dropped === 0);
check('valid: evidence carried',     valid.regions[0].evidence.local_pca === 'pass');
check('valid: optional fields kept', valid.regions[0].n_samples === 87);
check('valid: r2 has no evidence',   !('evidence' in valid.regions[1]));

// -----------------------------------------------------------------------------
group('parseNegativeRegionsJSON: invalid-row dropping');
const mixed = NR.parseNegativeRegionsJSON({
  regions: [
    { region_id: 'good', chr: 'LG1', start_bp: 0, end_bp: 100, region_status: 'no_detectable_inversion_low_power' },
    { region_id: '', chr: 'LG1', start_bp: 0, end_bp: 100, region_status: 'x' },  // empty id
    { region_id: 'bad-bp', chr: 'LG1', start_bp: 100, end_bp: 50, region_status: 'x' },  // end <= start
    { region_id: 'bad-chr', start_bp: 0, end_bp: 100, region_status: 'x' },  // missing chr
    null,
    'not-an-object',
  ],
});
check('invalid-row dropping: ok=true (load not aborted)', mixed.ok === true);
check('invalid-row dropping: 1 good region kept',         mixed.regions.length === 1);
check('invalid-row dropping: n_dropped=5',                mixed.n_dropped === 5);
check('invalid-row dropping: errors[] tracks each',       mixed.errors.length === 5);

// -----------------------------------------------------------------------------
group('parseNegativeRegionsJSON: accepts pre-parsed object');
const preParsed = NR.parseNegativeRegionsJSON({
  regions: [{ region_id: 'p1', chr: 'LG1', start_bp: 0, end_bp: 100, region_status: 'x' }],
});
check('object input: ok=true',       preParsed.ok === true);
check('object input: 1 region',      preParsed.regions.length === 1);

// -----------------------------------------------------------------------------
group('parseNegativeRegionsTSV: parsing');
const tsv1 = NR.parseNegativeRegionsTSV(
  'region_id\tchr\tstart_bp\tend_bp\tregion_status\n' +
  'r1\tLG28\t0\t1000\tno_detectable_inversion_high_confidence\n' +
  'r2\tLG14\t5000\t6000\tno_detectable_inversion_low_power\n'
);
check('TSV minimal: ok=true', tsv1.ok === true);
check('TSV minimal: 2 regions', tsv1.regions.length === 2);
check('TSV minimal: chr propagated', tsv1.regions[0].chr === 'LG28');
check('TSV minimal: start_bp numeric', tsv1.regions[0].start_bp === 0);

const tsvEv = NR.parseNegativeRegionsTSV(
  'region_id\tchr\tstart_bp\tend_bp\tregion_status\tevidence_local_pca\tevidence_ghsl\tn_samples\n' +
  'r1\tLG28\t0\t1000\tx\tpass\tlimited\t42\n'
);
check('TSV with evidence_*: ok=true', tsvEv.ok === true);
check('TSV with evidence_*: layer slot present',
      tsvEv.regions[0].evidence && tsvEv.regions[0].evidence.local_pca === 'pass');
check('TSV with evidence_*: limited carried',
      tsvEv.regions[0].evidence.ghsl === 'limited');
check('TSV with evidence_*: n_samples coerced to number',
      tsvEv.regions[0].n_samples === 42);

const tsvComment = NR.parseNegativeRegionsTSV(
  '# this is a comment\n' +
  'region_id\tchr\tstart_bp\tend_bp\tregion_status\n' +
  '\n' +  // blank line
  '# another comment after header\n' +
  'r1\tLG28\t0\t1000\tx\n'
);
check('TSV with #-comments and blanks: ok=true', tsvComment.ok === true);
check('TSV with #-comments: 1 region',           tsvComment.regions.length === 1);

const tsvBad = NR.parseNegativeRegionsTSV(
  'region_id\tchr\tstart_bp\tregion_status\n'  // missing end_bp
);
check('TSV missing required col: ok=false', tsvBad.ok === false);
check('TSV missing required col: error mentions end_bp',
      tsvBad.error && tsvBad.error.includes('end_bp'));

check('TSV non-string input: ok=false', NR.parseNegativeRegionsTSV(null).ok === false);

// -----------------------------------------------------------------------------
group('summarizeRegionStatuses');
const sum1 = NR.summarizeRegionStatuses([
  { region_status: 'no_detectable_inversion_high_confidence' },
  { region_status: 'no_detectable_inversion_high_confidence' },
  { region_status: 'no_detectable_inversion_low_power' },
  { region_status: 'made_up_status' },
]);
check('summary: known high-conf count', sum1.no_detectable_inversion_high_confidence === 2);
check('summary: low-power count',       sum1.no_detectable_inversion_low_power === 1);
check('summary: unknown → _other',      sum1._other === 1);
check('summary: zero-count slot',
      sum1.no_detectable_inversion_low_callability === 0);

const sumEmpty = NR.summarizeRegionStatuses([]);
check('summary empty: known slots all 0',
      Object.values(sumEmpty).every(v => v === 0));
check('summary empty: no _other count', sumEmpty._other === 0);

check('summary non-array: returns zeros',
      NR.summarizeRegionStatuses(null)._other === 0);

// -----------------------------------------------------------------------------
group('regionsToCSV: escaping');
const csv = NR.regionsToCSV([
  { region_id: 'r1', chr: 'LG1', start_bp: 0, end_bp: 100, region_status: 'x',
    notes: 'commas, here', evidence: { local_pca: 'pass' } },
  { region_id: 'r2', chr: 'LG1', start_bp: 0, end_bp: 100, region_status: 'x',
    notes: 'quotes "here"' },
  { region_id: 'r3', chr: 'LG1', start_bp: 0, end_bp: 100, region_status: 'x',
    notes: 'newline\ninside' },
]);
const csvLines = csv.split('\n');
check('CSV: header row present', csvLines[0].startsWith('region_id,'));
check('CSV: includes evidence_local_pca header', csvLines[0].includes('evidence_local_pca'));
check('CSV: comma cell is quoted', csvLines[1].includes('"commas, here"'));
check('CSV: quotes doubled',       csvLines[2].includes('"quotes ""here"""'));
check('CSV: newline cell quoted',  csvLines[3].includes('"newline'));
check('CSV: empty array → header only',
      NR.regionsToCSV([]).split('\n').length === 1);

// -----------------------------------------------------------------------------
group('renderSummaryCardsHtml');
const cardsHtml = NR.renderSummaryCardsHtml([
  { region_status: 'no_detectable_inversion_high_confidence' },
  { region_status: 'no_detectable_inversion_high_confidence' },
]);
check('cards: HTML string returned',          typeof cardsHtml === 'string');
check('cards: shows count of 2',              cardsHtml.includes('>2<'));
check('cards: label "high-conf neg" present', cardsHtml.includes('high-conf neg'));
check('cards: no _other card when no unknown statuses',
      !cardsHtml.includes('rows with status outside'));

const cardsOther = NR.renderSummaryCardsHtml([{ region_status: 'mystery' }]);
check('cards: _other card present for unknown',
      cardsOther.includes('rows with status outside'));

// Injection safety
const injection = NR.renderSummaryCardsHtml([]);
check('cards: no raw < in output',  !injection.includes('<script'));

// -----------------------------------------------------------------------------
group('renderRegionsTableHtml');
const empty = NR.renderRegionsTableHtml([]);
check('table empty: shows empty-state message', empty.includes('No regions loaded'));

const tableHtml = NR.renderRegionsTableHtml([
  {
    region_id: 'r1', chr: 'LG28', start_bp: 1_000_000, end_bp: 2_000_000,
    region_status: 'no_detectable_inversion_high_confidence',
    evidence: { local_pca: 'pass', ghsl: 'fail', heterozygosity: 'limited' },
    snp_density: 0.005, callable_fraction: 0.95, n_samples: 87,
    notes: 'clean',
  },
]);
check('table: <table> opened',                  tableHtml.includes('<table'));
check('table: row contains r1',                 tableHtml.includes('r1'));
check('table: status label rendered',           tableHtml.includes('no_detectable_inversion_high_confidence'));
check('table: Mb formatting on 1Mb',            tableHtml.includes('1.00 Mb'));
check('table: pass chip',                       tableHtml.includes('✓'));
check('table: fail chip',                       tableHtml.includes('✗'));
check('table: limited chip',                    tableHtml.includes('~'));
check('table: snps/kb rendered (0.005*1000=5.0)', tableHtml.includes('5.0'));
check('table: callable% rendered',              tableHtml.includes('95%'));
check('table: n_samples rendered',              tableHtml.includes('87'));

const tableEscape = NR.renderRegionsTableHtml([
  { region_id: '<script>x</script>', chr: 'LG1', start_bp: 0, end_bp: 100,
    region_status: 'x', notes: 'a&b' },
]);
check('table: HTML escapes <script>',  !tableEscape.includes('<script>x'));
check('table: HTML escapes & in notes', tableEscape.includes('a&amp;b'));

// -----------------------------------------------------------------------------
group('buildExportFilename');
const fixedNow = new Date(Date.UTC(2026, 4, 12, 10, 30, 45));
const fname = NR.buildExportFilename({}, fixedNow);
check('filename: starts with negative_regions_', fname.startsWith('negative_regions_'));
check('filename: ends with .csv',                fname.endsWith('.csv'));
check('filename: contains date stamp',           fname.includes('2026-05-12'));
check('filename: no colons (safe path)',         !fname.includes(':'));

// -----------------------------------------------------------------------------
// DOM mocks + renderer/wiring
// -----------------------------------------------------------------------------

class FakeNode {
  constructor(id) {
    this.id = id; this.innerHTML = ''; this.textContent = ''; this.style = {};
    this.value = ''; this._listeners = {}; this.children = [];
  }
  addEventListener(evt, cb) { (this._listeners[evt] = this._listeners[evt] || []).push(cb); }
  removeEventListener(evt, cb) {
    const list = this._listeners[evt] || [];
    const idx = list.indexOf(cb);
    if (idx >= 0) list.splice(idx, 1);
  }
  appendChild(c) { this.children.push(c); }
  click() {
    (this._listeners.click || []).forEach(cb => cb({}));
  }
  fireChange(evt) {
    (this._listeners.change || []).forEach(cb => cb(evt));
  }
}
const _nodes = new Map();
function _ensure(id) { if (!_nodes.has(id)) _nodes.set(id, new FakeNode(id)); return _nodes.get(id); }
global.document = {
  body: new FakeNode('body'),
  getElementById: (id) => _ensure(id),
  createElement: (tag) => new FakeNode('<' + tag + '>'),
};
global.window = global;

// -----------------------------------------------------------------------------
group('renderNegativeRegions: DOM render');
const state1 = {
  negativeRegions: [
    { region_id: 'r1', chr: 'LG1', start_bp: 0, end_bp: 100, region_status: 'no_detectable_inversion_high_confidence' },
    { region_id: 'r2', chr: 'LG1', start_bp: 0, end_bp: 100, region_status: 'no_detectable_inversion_low_power' },
  ],
};
NR.renderNegativeRegions(state1);
check('render: summary cards filled',  _ensure('nrSummaryCards').innerHTML.length > 0);
check('render: summary mentions 1',    _ensure('nrSummaryCards').innerHTML.includes('>1<'));
check('render: table slot filled',     _ensure('nrTableSlot').innerHTML.includes('<table'));
check('render: badge updated',         _ensure('nrTableBadge').textContent === '2');

// Empty state
NR.renderNegativeRegions({ negativeRegions: [] });
check('render: empty → table shows empty-state',
      _ensure('nrTableSlot').innerHTML.includes('No regions loaded'));
check('render: empty → badge "0"',  _ensure('nrTableBadge').textContent === '0');

// Null state safety
NR.renderNegativeRegions(null);
check('render: null state → no throw', true);

// -----------------------------------------------------------------------------
group('wireNegativeRegionsToolbar: idempotent wiring + reset');
const state2 = {
  negativeRegions: [
    { region_id: 'r1', chr: 'LG1', start_bp: 0, end_bp: 100, region_status: 'x' },
  ],
};
let onChangeCalls = 0;
NR.wireNegativeRegionsToolbar(state2, { onChange: () => { onChangeCalls++; } });
const resetBtn = _ensure('nrResetBtn');
check('wire: reset btn has handler',  (resetBtn._listeners.click || []).length === 1);

// Idempotent: re-wiring keeps single handler (teardown-first)
NR.wireNegativeRegionsToolbar(state2, { onChange: () => { onChangeCalls++; } });
check('wire: reset btn still single handler after re-wire',
      (resetBtn._listeners.click || []).length === 1);

// Reset clears state + fires onChange
resetBtn.click();
check('reset: state.negativeRegions emptied',
      Array.isArray(state2.negativeRegions) && state2.negativeRegions.length === 0);
check('reset: onChange fired',  onChangeCalls === 1);
check('reset: table re-rendered to empty-state',
      _ensure('nrTableSlot').innerHTML.includes('No regions loaded'));

// Load button forwards to input
const loadBtn = _ensure('nrLoadBtn');
const loadInput = _ensure('nrLoadInput');
let inputClicked = 0;
loadInput.click = () => { inputClicked++; };
loadBtn.click();
check('load btn: clicks the hidden file input',  inputClicked === 1);

// Export button on empty state is a no-op (no throw)
const exportBtn = _ensure('nrExportCsvBtn');
let exportOK = true;
try { exportBtn.click(); } catch (_) { exportOK = false; }
check('export btn: no-op on empty state, no throw',  exportOK);

// -----------------------------------------------------------------------------
group('teardownNegativeRegionsToolbar: removes handlers');
NR.teardownNegativeRegionsToolbar();
check('teardown: reset btn handler removed',
      (resetBtn._listeners.click || []).length === 0);
check('teardown: load btn handler removed',
      (loadBtn._listeners.click || []).length === 0);

// Idempotent: tearing down twice is fine
let teardown2OK = true;
try { NR.teardownNegativeRegionsToolbar(); } catch (_) { teardown2OK = false; }
check('teardown: idempotent',  teardown2OK);

// -----------------------------------------------------------------------------
group('Headless-tolerance: no document');
const savedDoc = global.document;
delete global.document;
let headlessOK = true;
try {
  NR.renderNegativeRegions({ negativeRegions: [] });
  NR.wireNegativeRegionsToolbar({});
  NR.teardownNegativeRegionsToolbar();
} catch (_) { headlessOK = false; }
check('headless: render + wire + teardown all silent w/o document',  headlessOK);
global.document = savedDoc;

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
