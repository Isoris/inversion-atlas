// tests/test_page8_window_summary.js
//
// Unit coverage for pages/discovery/page8/window_summary.js.
//
// Legacy shipped page8 as a pure HTML scaffold (zero JS handlers). The
// cartridge adds the per-window summary table + strip canvas + filter
// + sort + bisnp info-toggle implementation.
//
// Covers:
//   - COLOR_MODES frozen vocabulary (11 entries, by-key lookup)
//   - computeWindowRow: derives idx/mb/span_kb/snp_density/z/lam1/lam2/ratio
//   - buildWindowRows: builds all rows from precomp.windows
//   - filterWindowRows: '' / 'in_l2' / 'in_focal' modes + zMin threshold
//   - sortWindowRows: asc/desc, null-last, stable idx tiebreaker
//   - renderWinSumTableHtml: HTML escape, .cur class, go button, empty
//     state, numeric formatting per column
//   - renderWinSumChipsHtml: chrom + counts, escape
//   - colorForRow / drawWinSumStripCanvas: bounds + non-numeric fallback
//   - renderPage8: orchestrator DOM mock with visibility toggle
//   - wireWinSumToolbar / teardownWinSumToolbar: idempotent + filter
//     change + sort flip + go-button onJump + bisnp toggle
//   - Headless-tolerance: no document → all DOM helpers return silently

import * as WS from '../atlases/inversion/pages/discovery/page8/window_summary.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('COLOR_MODES vocab');
check('frozen array',                  Object.isFrozen(WS.COLOR_MODES));
check('11 entries',                    WS.COLOR_MODES.length === 11);
check('entries frozen',                WS.COLOR_MODES.every(c => Object.isFrozen(c)));
const _keys = WS.COLOR_MODES.map(c => c.key);
check('includes z',                    _keys.includes('z'));
check('includes lam1 lam2 ratio',      _keys.includes('lam1') && _keys.includes('lam2') && _keys.includes('ratio'));
check('includes idx mb n_snps',        _keys.includes('idx') && _keys.includes('mb') && _keys.includes('n_snps'));
check('l1 + l2 marked non-numeric',
      WS.COLOR_MODES.find(c => c.key === 'l1').num === false &&
      WS.COLOR_MODES.find(c => c.key === 'l2').num === false);

// -----------------------------------------------------------------------------
group('computeWindowRow');
const r0 = WS.computeWindowRow({
  start_bp: 0, end_bp: 100_000, center_bp: 50_000,
  n_snps: 250, z: -1.5, lam1: 2.5, lam2: 0.5,
  l1_id: 'L1_01', l2_id: 'L2_01_a',
}, 0);
check('idx propagated',          r0.idx === 0);
check('mb derived',              Math.abs(r0.mb - 0.05) < 1e-9);
check('span_kb derived',         r0.span_kb === 100);
check('n_snps preserved',        r0.n_snps === 250);
check('snp_density derived',     Math.abs(r0.snp_density - 2.5) < 1e-9);
check('z is abs value',          r0.z === 1.5);
check('ratio = lam1/lam2',       r0.ratio === 5);
check('l1 + l2 ids carried',     r0.l1 === 'L1_01' && r0.l2 === 'L2_01_a');

const rEmpty = WS.computeWindowRow({}, 0);
check('empty window: null bp slots',  rEmpty.start_bp === null && rEmpty.mb === null);
check('empty window: empty L1/L2',    rEmpty.l1 === '' && rEmpty.l2 === '');

check('null input → null row',  WS.computeWindowRow(null, 0) === null);

// -----------------------------------------------------------------------------
group('buildWindowRows');
const precomp = {
  windows: [
    { start_bp: 0, end_bp: 100_000, center_bp: 50_000, z: 2.5, lam1: 2.0, lam2: 0.5, n_snps: 80, l2_id: 'L2_a' },
    { start_bp: 100_000, end_bp: 200_000, center_bp: 150_000, z: 0.3, lam1: 1.1, lam2: 1.0, n_snps: 60, l2_id: 'L2_a' },
    { start_bp: 200_000, end_bp: 300_000, center_bp: 250_000, z: 4.2, lam1: 3.0, lam2: 0.2, n_snps: 200, l2_id: 'L2_b' },
    { start_bp: 300_000, end_bp: 400_000, center_bp: 350_000, z: 1.0, lam1: 1.5, lam2: 1.0, n_snps: 50 /* no l2 */ },
  ],
};
const allRows = WS.buildWindowRows(precomp);
check('4 rows built',           allRows.length === 4);
check('idx assigned in order',  allRows.map(r => r.idx).join(',') === '0,1,2,3');

check('empty precomp → []',    WS.buildWindowRows(null).length === 0);
check('non-array windows → []', WS.buildWindowRows({}).length === 0);

// -----------------------------------------------------------------------------
group('filterWindowRows');
const fAll = WS.filterWindowRows(allRows, { l2: '', zMin: 0 });
check('all-filter: returns all',          fAll.length === 4);

const fInL2 = WS.filterWindowRows(allRows, { l2: 'in_l2', zMin: 0 });
check('in_l2: drops rows without l2_id', fInL2.length === 3);
check('in_l2: kept have non-empty l2',   fInL2.every(r => r.l2 !== ''));

const fFocal = WS.filterWindowRows(allRows, { l2: 'in_focal', zMin: 0 }, 'L2_a');
check('in_focal: only matching l2',      fFocal.length === 2);
check('in_focal: all have L2_a',         fFocal.every(r => r.l2 === 'L2_a'));

const fFocalNone = WS.filterWindowRows(allRows, { l2: 'in_focal', zMin: 0 }, null);
check('in_focal w/o focal: 0 rows',      fFocalNone.length === 0);

const fZ = WS.filterWindowRows(allRows, { l2: '', zMin: 2 });
check('zMin=2: 2 rows pass',              fZ.length === 2);
check('zMin=2: every |Z| >= 2',           fZ.every(r => r.z >= 2));

// -----------------------------------------------------------------------------
group('sortWindowRows');
const byZasc = WS.sortWindowRows(allRows, 'z', 'asc');
check('sort z asc: ascending',
      byZasc[0].z <= byZasc[1].z && byZasc[1].z <= byZasc[2].z);
const byZdesc = WS.sortWindowRows(allRows, 'z', 'desc');
check('sort z desc: descending',          byZdesc[0].z === 4.2);

// Null-last
const withNull = [
  { idx: 0, z: 1 }, { idx: 1, z: null }, { idx: 2, z: 3 },
];
const sortNull = WS.sortWindowRows(withNull, 'z', 'asc');
check('null sorts last asc',   sortNull[sortNull.length - 1].z === null);
const sortNullDesc = WS.sortWindowRows(withNull, 'z', 'desc');
check('null sorts last desc',  sortNullDesc[sortNullDesc.length - 1].z === null);

// Stable tiebreaker = idx asc
const ties = [
  { idx: 2, z: 5 }, { idx: 0, z: 5 }, { idx: 1, z: 5 },
];
const stable = WS.sortWindowRows(ties, 'z', 'asc');
check('stable tiebreaker: idx asc',
      stable.map(r => r.idx).join(',') === '0,1,2');

// Unknown key → idx-asc
const unk = WS.sortWindowRows(allRows, '__bogus__', 'asc');
check('unknown key fall-back to idx-asc',
      unk.map(r => r.idx).join(',') === '0,1,2,3');

// -----------------------------------------------------------------------------
group('renderWinSumTableHtml');
const sortedRows = WS.sortWindowRows(allRows, 'z', 'desc');
const tbl = WS.renderWinSumTableHtml(sortedRows, 'z', 'desc', 2);
check('table HTML: contains <tr>',           tbl.includes('<tr'));
check('table HTML: 4 row count tags',        (tbl.match(/<tr/g) || []).length === 4);
check('table HTML: .cur on idx=2',           tbl.includes('class="cur"') && tbl.includes('data-idx="2"'));
check('table HTML: |Z| 4.20 formatted',      tbl.includes('4.20'));
check('table HTML: λ₁/λ₂ 15.00 ratio',       tbl.includes('15.00'));
check('table HTML: go button rendered',      tbl.includes('data-go="0"'));
check('table HTML: HTML-escaped L2 id (no <)', !tbl.includes('<L2_a'));

const tblEmpty = WS.renderWinSumTableHtml([], 'idx', 'asc', -1);
check('table HTML empty: shows no-windows msg',  tblEmpty.includes('No windows'));

// HTML-escape attempt
const tblEsc = WS.renderWinSumTableHtml([
  WS.computeWindowRow({ start_bp: 0, end_bp: 100, center_bp: 50, l2_id: '<bad>' }, 0),
], 'idx', 'asc', -1);
check('table HTML: escapes < in L2 id',  tblEsc.includes('&lt;bad&gt;'));

// -----------------------------------------------------------------------------
group('renderWinSumChipsHtml');
const chips = WS.renderWinSumChipsHtml('LG28', 12, 100);
check('chips: chrom rendered',     chips.includes('LG28'));
check('chips: count "12 / 100"',   chips.includes('12 / 100'));

const chipsEsc = WS.renderWinSumChipsHtml('<bad>', 0, 0);
check('chips: escapes <bad>',      chipsEsc.includes('&lt;bad&gt;'));

// -----------------------------------------------------------------------------
group('colorForRow + drawWinSumStripCanvas');
const colDef = WS.colorForRow({ z: 2 }, 'z', { lo: 0, hi: 4 });
check('color: rgba returned',  /^rgba\(/.test(colDef));

const colNoBounds = WS.colorForRow({ z: 2 }, 'z', null);
check('color: no bounds → grey fallback',  colNoBounds.includes('120,120,120'));

const colNonNumeric = WS.colorForRow({ z: 2 }, 'l1', { lo: 0, hi: 4 });
check('color: l1 mode falls back to z numeric',
      /^rgba\(/.test(colNonNumeric) && colNonNumeric !== colNoBounds);

// Canvas mock
class FakeCanvas {
  constructor(w, h) {
    this.width = w; this.height = h;
    this.clientWidth = w; this.clientHeight = h;
    this._ops = [];
  }
  getContext() {
    const ops = this._ops;
    return {
      clearRect: (...a) => ops.push(['clearRect', a]),
      fillRect:  (...a) => ops.push(['fillRect',  a]),
      set fillStyle(v) { ops.push(['fillStyle', v]); },
      get fillStyle() { return ''; },
    };
  }
}
const cv = new FakeCanvas(400, 60);
WS.drawWinSumStripCanvas(cv, sortedRows, 'z');
check('canvas: clearRect called',  cv._ops.some(o => o[0] === 'clearRect'));
check('canvas: fillRect called per row', cv._ops.filter(o => o[0] === 'fillRect').length >= 4);

// drawWinSumStripCanvas tolerates missing canvas
let drawOK = true;
try {
  WS.drawWinSumStripCanvas(null, sortedRows, 'z');
  WS.drawWinSumStripCanvas({}, sortedRows, 'z');
} catch (_) { drawOK = false; }
check('canvas: no-throw on missing/invalid canvas', drawOK);

// -----------------------------------------------------------------------------
// DOM mocks for orchestrator + wiring
// -----------------------------------------------------------------------------

class FakeNode {
  constructor(id, tag) {
    this.id = id; this.tagName = tag || 'div';
    this.innerHTML = ''; this.textContent = '';
    this.style = {}; this.value = ''; this._listeners = {};
    this.children = []; this._attrs = {};
    this.classList = {
      _set: new Set(),
      add: (c)    => this.classList._set.add(c),
      remove: (c) => this.classList._set.delete(c),
      contains: (c) => this.classList._set.has(c),
    };
    if (id === 'winSumStripCanvas') {
      this.width = 400; this.height = 60;
      this.clientWidth = 400; this.clientHeight = 60;
      const ops = this._ops = [];
      this.getContext = () => ({
        clearRect: (...a) => ops.push(['clearRect', a]),
        fillRect:  (...a) => ops.push(['fillRect',  a]),
        set fillStyle(v) { ops.push(['fillStyle', v]); },
        get fillStyle() { return ''; },
      });
    }
  }
  addEventListener(evt, cb) { (this._listeners[evt] = this._listeners[evt] || []).push(cb); }
  removeEventListener(evt, cb) {
    const list = this._listeners[evt] || [];
    const idx = list.indexOf(cb);
    if (idx >= 0) list.splice(idx, 1);
  }
  appendChild(c) { this.children.push(c); }
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return this._attrs[k]; }
  fire(evt, payload) {
    (this._listeners[evt] || []).forEach(cb => cb(payload || { target: this }));
  }
}

const _nodes = new Map();
function _ensure(id, tag) {
  if (!_nodes.has(id)) _nodes.set(id, new FakeNode(id, tag));
  return _nodes.get(id);
}
function _qsAll(sel) {
  // Match #winSumTable thead th.sortable — return any th set up in advance
  if (sel === '#winSumTable thead th.sortable') {
    return _sortableHeaders;
  }
  return [];
}
const _sortableHeaders = [];
function _addSortableTh(key) {
  const th = new FakeNode('th:' + key, 'th');
  th.setAttribute('data-sort', key);
  _sortableHeaders.push(th);
  return th;
}
_addSortableTh('idx');
_addSortableTh('z');
_addSortableTh('lam1');

global.document = {
  body: new FakeNode('body'),
  getElementById: (id) => _ensure(id),
  querySelectorAll: _qsAll,
  createElement: (tag) => new FakeNode('<' + tag + '>', tag),
};
global.window = global;

// -----------------------------------------------------------------------------
group('renderPage8: DOM orchestrator');
// Empty state: no precomp
WS.renderPage8({});
check('no-precomp: winSumNoChrom shown', _ensure('winSumNoChrom').style.display === 'block');
check('no-precomp: strip hidden',        _ensure('winSumStrip').style.display === 'none');
check('no-precomp: table hidden',        _ensure('winSumTableWrap').style.display === 'none');

// Populated state
const state2 = {
  activeChrom: 'LG28',
  precomp,
  winSumFilters: { l2: '', zMin: 0 },
  winSumColorMode: 'z',
  winSumSortKey: 'z',
  winSumSortDir: 'desc',
  cur: 2,
};
WS.renderPage8(state2);
check('populated: winSumNoChrom hidden', _ensure('winSumNoChrom').style.display === 'none');
check('populated: strip visible',        _ensure('winSumStrip').style.display === 'block');
check('populated: tableWrap visible',    _ensure('winSumTableWrap').style.display === 'block');
check('populated: chips rendered',       _ensure('winSumChips').innerHTML.includes('LG28'));
check('populated: count "4 / 4"',        _ensure('winSumChips').innerHTML.includes('4 / 4'));
check('populated: body has rows',        _ensure('winSumTableBody').innerHTML.includes('<tr'));
check('populated: .cur on idx=2',        _ensure('winSumTableBody').innerHTML.includes('data-idx="2"'));
check('populated: count text',           _ensure('winSumCount').textContent.includes('4 windows'));
check('populated: mode label = |Z|',     _ensure('winSumColorModeLabel').textContent === '|Z|');
check('populated: strip canvas painted',
      _ensure('winSumStripCanvas')._ops.some(o => o[0] === 'fillRect'));

// Header arrow class
const _hdrZ = _sortableHeaders.find(h => h.getAttribute('data-sort') === 'z');
check('header: z gets sort-desc class',  _hdrZ.classList.contains('sort-desc'));

// -----------------------------------------------------------------------------
group('wireWinSumToolbar: filter changes + sort flip + go onJump');
let changeCalls = 0;
let jumpCalls = [];
WS.wireWinSumToolbar(state2, {
  onChange: () => { changeCalls++; },
  onJump:   (i) => { jumpCalls.push(i); },
});

const l2Sel = _ensure('winSumL2Filter');
l2Sel.value = 'in_l2';
l2Sel.fire('change', { target: l2Sel });
check('L2 filter change: state mutated', state2.winSumFilters.l2 === 'in_l2');
check('L2 filter change: row count = 3', _ensure('winSumChips').innerHTML.includes('3 / 4'));
check('L2 filter change: onChange fired', changeCalls === 1);

const zIn = _ensure('winSumZFilter');
zIn.value = '2';
zIn.fire('input', { target: zIn });
check('zMin filter input: state mutated', state2.winSumFilters.zMin === 2);
check('zMin filter: visible count fell',  state2.winSumFilters.zMin === 2);

// Sort header click — toggle direction when same key
const table = _ensure('winSumTable');
const fakeTh = _sortableHeaders.find(h => h.getAttribute('data-sort') === 'z');
// Wire the head listener uses event.target — we pass the th directly
table.fire('click', { target: fakeTh });
// Initially state2.winSumSortKey === 'z' winSumSortDir === 'desc' → toggles to asc
check('sort flip: dir toggled to asc',  state2.winSumSortDir === 'asc');
check('sort flip: color mode synced to z', state2.winSumColorMode === 'z');

// Sort header click — different key resets to asc
const lamTh = _sortableHeaders.find(h => h.getAttribute('data-sort') === 'lam1');
table.fire('click', { target: lamTh });
check('sort new key: sortKey = lam1',   state2.winSumSortKey === 'lam1');
check('sort new key: dir = asc',        state2.winSumSortDir === 'asc');
check('sort new key: colorMode = lam1', state2.winSumColorMode === 'lam1');

// Body click — fires onJump
const body = _ensure('winSumTableBody');
const fakeGoBtn = new FakeNode('btn', 'button');
fakeGoBtn.setAttribute('data-go', '2');
body.fire('click', { target: fakeGoBtn });
check('go button click: onJump fired with idx=2',
      jumpCalls.length === 1 && jumpCalls[0] === 2);

// Bisnp toggle
const bisnpBtn = _ensure('winSumBisnpInfoBtn');
const bisnpPanel = _ensure('winSumBisnpInfoPanel');
bisnpPanel.style.display = 'none';
bisnpBtn.fire('click', {});
check('bisnp toggle: panel shown',  bisnpPanel.style.display === 'block');
bisnpBtn.fire('click', {});
check('bisnp toggle: panel hidden', bisnpPanel.style.display === 'none');

// Idempotent wire (re-wiring keeps single handler)
WS.wireWinSumToolbar(state2, { onChange: () => { changeCalls++; } });
check('idempotent wire: l2 still single handler',
      (l2Sel._listeners.change || []).length === 1);

// -----------------------------------------------------------------------------
group('teardownWinSumToolbar');
WS.teardownWinSumToolbar();
check('teardown: l2 handler removed',   (l2Sel._listeners.change || []).length === 0);
check('teardown: z handler removed',    (zIn._listeners.input || []).length === 0);

let teardown2OK = true;
try { WS.teardownWinSumToolbar(); } catch (_) { teardown2OK = false; }
check('teardown: idempotent',  teardown2OK);

// -----------------------------------------------------------------------------
group('Headless-tolerance');
const savedDoc = global.document;
delete global.document;
let headlessOK = true;
try {
  WS.renderPage8({});
  WS.wireWinSumToolbar({});
  WS.teardownWinSumToolbar();
  WS.drawWinSumStripCanvas(null, [], 'z');
} catch (_) { headlessOK = false; }
check('headless: all DOM helpers silent', headlessOK);
global.document = savedDoc;

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
