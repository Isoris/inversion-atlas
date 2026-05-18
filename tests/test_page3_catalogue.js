// tests/test_page3_catalogue.js
//
// Unit coverage for pages/catalogue/catalogue/catalogue.js.
//
// Legacy referenced renderCatalogue / _buildCatalogueRows / _sortCatalogueRows
// throughout the file via `typeof renderCatalogue === 'function'` guards but
// never defined any of them — every legacy call was a no-op (chat-33
// audit). The cartridge ships the first-pass implementation covering
// filter / verdict / view / sort / disp + per-row selection + favorites
// + TSV / Markdown / JSON exports.
//
// Covers:
//   - CAT_COLUMNS + CAT_VIEW_MODES frozen vocabularies
//   - buildCatalogueRows: normalization + span_kb derivation + invalid drops
//   - filterCatalogueRows: free-text + verdict + fav-view + l2_raw
//   - sortCatalogueRows: asc/desc, null-last, stable id tiebreaker
//   - visibleColumns: simple vs detailed
//   - renderCatHeaderHtml: sort arrows + escaping
//   - renderCatBodyHtml: HTML escape, .selected, star/sel attrs, empty
//   - exportCatalogueTSV / Markdown / JSON: header + escaping + meta
//   - renderCatalogue: DOM mock orchestrator + empty-state toggle
//   - wireCatalogueToolbar: filter input / verdict change / sort flip /
//     star-toggle / sel-toggle / select-all / clear / view-fav / view-l2 /
//     disp simple / detailed / exports via onDownload callback
//   - teardownCatalogueToolbar: idempotent + handler removal
//   - Headless tolerance: no document → silent return

import * as CAT from '../atlases/inversion/pages/catalogue/catalogue/catalogue.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('CAT_COLUMNS + CAT_VIEW_MODES vocab');
check('CAT_COLUMNS frozen',         Object.isFrozen(CAT.CAT_COLUMNS));
check('CAT_COLUMNS entries frozen', CAT.CAT_COLUMNS.every(c => Object.isFrozen(c)));
check('CAT_VIEW_MODES frozen',      Object.isFrozen(CAT.CAT_VIEW_MODES));
check('CAT_VIEW_MODES has l2_raw + fav',
      CAT.CAT_VIEW_MODES.includes('l2_raw') && CAT.CAT_VIEW_MODES.includes('fav'));
check('CAT_COLUMNS has star + sel + id', (() => {
  const keys = CAT.CAT_COLUMNS.map(c => c.key);
  return keys.includes('star') && keys.includes('sel') && keys.includes('id');
})());

// -----------------------------------------------------------------------------
group('buildCatalogueRows');
const state0 = {
  catalogueRows: [
    { id: 'L2_a', chr: 'LG28', parent_l1: 'L1_01', start_bp: 1_000_000, end_bp: 1_500_000,
      K: 3, verdict: 'TWO_INVERSIONS', n_windows: 12, n_samples: 87, silhouette: 0.42 },
    { id: 'L2_b', chr: 'LG14', start_bp: 5_000_000, end_bp: 5_200_000, K: 6,
      verdict: 'CROSSOVER_ARTIFACTS', cluster_ok: true },
    { id: '', chr: 'LG1', start_bp: 0, end_bp: 100 },  // invalid (no id)
    null,
    'not-an-object',
    { id: 'L2_c', chr: 'LG28' },  // optional fields missing
  ],
};
const rows = CAT.buildCatalogueRows(state0);
check('builds: 3 valid rows kept',    rows.length === 3);
check('builds: empty-id dropped',     rows.every(r => r.id !== ''));
check('builds: span_kb derived for L2_a',
      Math.abs(rows[0].span_kb - 500) < 1e-9);
check('builds: nullable defaults',
      rows[2].silhouette === null && rows[2].cluster_ok === null);
check('builds: parent_l1 propagated', rows[0].parent_l1 === 'L1_01');

check('builds: non-object state → []', CAT.buildCatalogueRows(null).length === 0);

// -----------------------------------------------------------------------------
group('filterCatalogueRows');
const allRows = rows;
check('no filter: all rows',
      CAT.filterCatalogueRows(allRows, { catFilter: '', catVerdictFilter: '', catViewMode: 'l2_raw' }).length === 3);

const fLG28 = CAT.filterCatalogueRows(allRows, { catFilter: 'LG28' });
check('free-text filter LG28: 2 rows', fLG28.length === 2);

const fL2a = CAT.filterCatalogueRows(allRows, { catFilter: 'L2_a' });
check('free-text filter L2_a: 1 row',  fL2a.length === 1 && fL2a[0].id === 'L2_a');

const fVerd = CAT.filterCatalogueRows(allRows, { catVerdictFilter: 'TWO_INVERSIONS' });
check('verdict filter: 1 row',         fVerd.length === 1);

const favSet = new Set(['L2_b']);
const fFav = CAT.filterCatalogueRows(allRows, { catViewMode: 'fav', catFavorites: favSet });
check('fav view: only favorited',      fFav.length === 1 && fFav[0].id === 'L2_b');

const fFavNoSet = CAT.filterCatalogueRows(allRows, { catViewMode: 'fav' });
check('fav view w/o favs Set: empty',  fFavNoSet.length === 0);

// -----------------------------------------------------------------------------
group('sortCatalogueRows');
const ascId = CAT.sortCatalogueRows(allRows, 'id', 'asc');
check('sort id asc: L2_a first',  ascId[0].id === 'L2_a');
const descId = CAT.sortCatalogueRows(allRows, 'id', 'desc');
check('sort id desc: L2_c first', descId[0].id === 'L2_c');

// span_kb null-last
const sortSpan = CAT.sortCatalogueRows(allRows, 'span_kb', 'desc');
check('sort span_kb desc: null-last (L2_c)',
      sortSpan[sortSpan.length - 1].id === 'L2_c');

// Stable tiebreaker: equal K, sort by id asc
const tieRows = [
  { id: 'b', K: 3 }, { id: 'a', K: 3 }, { id: 'c', K: 3 },
];
const tieSort = CAT.sortCatalogueRows(tieRows, 'K', 'asc');
check('stable tiebreaker id asc',  tieSort.map(r => r.id).join('') === 'abc');

// Unknown key → id-asc
const unkSort = CAT.sortCatalogueRows(allRows, '__bogus__', 'asc');
check('unknown key fallback id-asc', unkSort[0].id === 'L2_a');

// -----------------------------------------------------------------------------
group('visibleColumns');
const simpleCols = CAT.visibleColumns('simple');
const detailedCols = CAT.visibleColumns('detailed');
check('simple < detailed',   simpleCols.length < detailedCols.length);
check('simple: no parent_l1', !simpleCols.some(c => c.key === 'parent_l1'));
check('detailed: has parent_l1', detailedCols.some(c => c.key === 'parent_l1'));
check('simple: keeps id + verdict',
      simpleCols.some(c => c.key === 'id') && simpleCols.some(c => c.key === 'verdict'));

// -----------------------------------------------------------------------------
group('renderCatHeaderHtml');
const hdr = CAT.renderCatHeaderHtml('detailed', 'span_kb', 'desc');
check('header: id <th> rendered',         hdr.includes('data-sort="id"'));
check('header: span_kb gets sort-desc',   hdr.includes('sort-desc') && hdr.includes('data-sort="span_kb"'));
check('header: ▼ arrow on sorted column', hdr.includes('▼'));

// -----------------------------------------------------------------------------
group('renderCatBodyHtml');
const selSet = new Set(['L2_a']);
const favSetH = new Set(['L2_b']);
const bodyHtml = CAT.renderCatBodyHtml(allRows, 'detailed', selSet, favSetH);
check('body: <tr> per row',              (bodyHtml.match(/<tr/g) || []).length === 3);
check('body: L2_a tr has .selected',     bodyHtml.includes('data-id="L2_a"') && bodyHtml.includes('class="selected"'));
check('body: L2_a checkbox checked',     bodyHtml.includes('data-sel="L2_a"') && bodyHtml.includes('checked'));
check('body: L2_b star filled (★)',      bodyHtml.includes('data-star="L2_b"') && bodyHtml.includes('>★<'));
check('body: L2_a star empty (☆)',       bodyHtml.includes('data-star="L2_a"') && bodyHtml.includes('>☆<'));

const bodyEmpty = CAT.renderCatBodyHtml([], 'detailed', selSet, favSetH);
check('body empty: shows hint',          bodyEmpty.includes('No rows match'));

const bodyEsc = CAT.renderCatBodyHtml([{ id: '<bad>', chr: 'X', verdict: 'V' }], 'detailed', selSet, favSetH);
check('body: HTML escapes < in id (in data-id attr)',
      bodyEsc.includes('data-id="&lt;bad&gt;"'));

// -----------------------------------------------------------------------------
group('exportCatalogueTSV');
const tsv = CAT.exportCatalogueTSV(allRows, 'detailed');
const tsvLines = tsv.split('\n');
check('TSV: header line present', tsvLines[0].includes('id') && tsvLines[0].includes('verdict'));
check('TSV: 3 data rows',         tsvLines.length === 4);
check('TSV: no embedded tab', !tsvLines.slice(1).some(line => line.split('\t').length > tsvLines[0].split('\t').length));

// TSV escape: tab/newline stripped
const tabRow = [{ id: 'L2_tab', chr: 'a\tb\nc', start_bp: 0, end_bp: 100 }];
const tsvTab = CAT.exportCatalogueTSV(CAT.buildCatalogueRows({ catalogueRows: tabRow }), 'detailed');
check('TSV: embedded \\t/\\n stripped',  !tsvTab.split('\n').slice(1).some(l => l.includes('\t' + 'b')));

// -----------------------------------------------------------------------------
group('exportCatalogueMarkdown');
const md = CAT.exportCatalogueMarkdown(allRows, 'detailed');
const mdLines = md.split('\n');
check('MD: header line + sep',  mdLines[0].includes('| id') && mdLines[1].includes('---'));
check('MD: 3 rows after sep',   mdLines.length === 5);

const mdEsc = CAT.exportCatalogueMarkdown([{ id: 'a|b', chr: 'x' }], 'detailed');
check('MD: pipe escaped',  mdEsc.includes('a\\|b'));

// -----------------------------------------------------------------------------
group('exportCatalogueJSON');
const json = CAT.exportCatalogueJSON(allRows, 'detailed', { chrom: 'LG28' });
const parsed = JSON.parse(json);
check('JSON: parseable',                  typeof parsed === 'object');
check('JSON: schema_version present',     parsed.schema_version === 'catalogue.v1');
check('JSON: chrom propagated',           parsed.chrom === 'LG28');
check('JSON: 3 rows',                     parsed.rows.length === 3);
check('JSON: columns includes id',        parsed.columns.includes('id'));
check('JSON: generated_at present',       typeof parsed.generated_at === 'string');

// -----------------------------------------------------------------------------
// DOM mocks for renderer + wiring
// -----------------------------------------------------------------------------

class FakeNode {
  constructor(id, tag) {
    this.id = id; this.tagName = tag || 'div';
    this.innerHTML = ''; this.textContent = '';
    this.style = {}; this.value = ''; this._listeners = {};
    this.children = []; this._attrs = {};
    if (tag === 'a') this.click = () => { this._clicked = true; };
  }
  addEventListener(evt, cb) { (this._listeners[evt] = this._listeners[evt] || []).push(cb); }
  removeEventListener(evt, cb) {
    const list = this._listeners[evt] || [];
    const idx = list.indexOf(cb);
    if (idx >= 0) list.splice(idx, 1);
  }
  appendChild(c) { this.children.push(c); }
  removeChild(c) {
    const idx = this.children.indexOf(c);
    if (idx >= 0) this.children.splice(idx, 1);
  }
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return this._attrs[k]; }
  fire(evt, payload) {
    (this._listeners[evt] || []).forEach(cb => cb(payload || { target: this }));
  }
}

const _nodes = new Map();
function _ensure(id) {
  if (!_nodes.has(id)) _nodes.set(id, new FakeNode(id));
  return _nodes.get(id);
}

global.document = {
  body: new FakeNode('body'),
  getElementById: (id) => _ensure(id),
  createElement: (tag) => new FakeNode('<' + tag + '>', tag),
};
global.window = global;

// -----------------------------------------------------------------------------
group('renderCatalogue: orchestrator');
// Empty state
const emptyState = { catalogueRows: [] };
CAT.renderCatalogue(emptyState);
check('empty: catEmpty visible',  _ensure('catEmpty').style.display === 'block');
check('empty: defaults seeded',   typeof emptyState.catFilter === 'string'
      && emptyState.catFavorites instanceof Set);

// Populated state
const popState = {
  catalogueRows: [
    { id: 'L2_a', chr: 'LG28', start_bp: 0, end_bp: 100_000, K: 3, verdict: 'TWO_INVERSIONS' },
    { id: 'L2_b', chr: 'LG14', start_bp: 0, end_bp: 200_000, K: 6, verdict: 'NOISY_REGION' },
  ],
  catFavorites: new Set(['L2_a']),
  catSelection: new Set(),
  catFilter: '',
  catVerdictFilter: '',
  catViewMode: 'l2_raw',
  catDispMode: 'detailed',
  catSortKey: 'id',
  catSortDir: 'asc',
};
CAT.renderCatalogue(popState);
check('populated: catEmpty hidden',     _ensure('catEmpty').style.display === 'none');
check('populated: head populated',      _ensure('catHead').innerHTML.includes('data-sort="id"'));
check('populated: body has 2 rows',     (_ensure('catBody').innerHTML.match(/<tr/g) || []).length === 2);
check('populated: selInfo "0 selected of 2"',
      _ensure('catSelInfo').textContent === '0 selected of 2');

// -----------------------------------------------------------------------------
group('wireCatalogueToolbar: filter + sort + selection + exports');
const downloads = [];
let changeCalls = 0;
CAT.wireCatalogueToolbar(popState, {
  onChange:   () => { changeCalls++; },
  onDownload: (name, content, mime) => { downloads.push({ name, content, mime }); },
});

// Filter input
const filt = _ensure('catFilter');
filt.value = 'LG28';
filt.fire('input', { target: filt });
check('filter: state mutated',       popState.catFilter === 'LG28');
check('filter: body has 1 row',      (_ensure('catBody').innerHTML.match(/<tr/g) || []).length === 1);
check('filter: onChange fired',      changeCalls >= 1);

// Reset filter
filt.value = '';
filt.fire('input', { target: filt });

// Verdict filter
const verdSel = _ensure('catVerdictFilter');
verdSel.value = 'NOISY_REGION';
verdSel.fire('change', { target: verdSel });
check('verdict filter: state mutated', popState.catVerdictFilter === 'NOISY_REGION');
check('verdict filter: 1 row visible', (_ensure('catBody').innerHTML.match(/<tr/g) || []).length === 1);

// Reset verdict
verdSel.value = '';
verdSel.fire('change', { target: verdSel });

// Sort flip
const head = _ensure('catHead');
const fakeTh = new FakeNode('th_id', 'th');
fakeTh.setAttribute('data-sort', 'id');
head.fire('click', { target: fakeTh });
check('sort flip: dir → desc (id was asc)',  popState.catSortDir === 'desc');
head.fire('click', { target: fakeTh });
check('sort flip again: dir → asc',           popState.catSortDir === 'asc');

// Sort new key
const thK = new FakeNode('th_K', 'th');
thK.setAttribute('data-sort', 'K');
head.fire('click', { target: thK });
check('sort new key: catSortKey = K',  popState.catSortKey === 'K');
check('sort new key: dir = asc',       popState.catSortDir === 'asc');

// Star toggle (body click)
const bodyNode = _ensure('catBody');
const starBtn = new FakeNode('btn_star', 'button');
starBtn.setAttribute('data-star', 'L2_b');
bodyNode.fire('click', { target: starBtn });
check('star toggle: L2_b favorited',  popState.catFavorites.has('L2_b'));
bodyNode.fire('click', { target: starBtn });
check('star toggle: L2_b unfavorited', !popState.catFavorites.has('L2_b'));

// Sel toggle
const selBox = new FakeNode('box_sel', 'input');
selBox.setAttribute('data-sel', 'L2_a');
bodyNode.fire('click', { target: selBox });
check('sel toggle: L2_a selected',     popState.catSelection.has('L2_a'));
bodyNode.fire('click', { target: selBox });
check('sel toggle: L2_a unselected',   !popState.catSelection.has('L2_a'));

// Select-all
const selAll = _ensure('catSelectAll');
selAll.fire('click', {});
check('selectAll: 2 rows selected',    popState.catSelection.size === 2);

// Clear
const clr = _ensure('catClearSel');
clr.fire('click', {});
check('clear: 0 rows selected',        popState.catSelection.size === 0);

// View modes
_ensure('catViewFav').fire('click', {});
check('view fav: catViewMode = fav',   popState.catViewMode === 'fav');
_ensure('catViewL2').fire('click', {});
check('view l2: catViewMode = l2_raw', popState.catViewMode === 'l2_raw');

// Disp modes
_ensure('catDispSimple').fire('click', {});
check('disp simple: catDispMode = simple',     popState.catDispMode === 'simple');
_ensure('catDispDetailed').fire('click', {});
check('disp detailed: catDispMode = detailed', popState.catDispMode === 'detailed');

// Exports
_ensure('catExportTSV').fire('click', {});
_ensure('catExportMD').fire('click', {});
_ensure('catExportJSON').fire('click', {});
check('export TSV downloaded',  downloads.some(d => d.name.endsWith('.tsv')));
check('export MD downloaded',   downloads.some(d => d.name.endsWith('.md')));
check('export JSON downloaded', downloads.some(d => d.name.endsWith('.json')));

const jsonDownload = downloads.find(d => d.name.endsWith('.json'));
const exportedJson = JSON.parse(jsonDownload.content);
check('export JSON: filter context preserved',
      typeof exportedJson.filter === 'object' && exportedJson.filter.sortKey === 'K');

// Idempotent re-wire
CAT.wireCatalogueToolbar(popState, {});
check('rewire: filter input still single handler',
      (filt._listeners.input || []).length === 1);

// -----------------------------------------------------------------------------
group('promoteRowsToCandidates');
const promoteRows = [
  { id: 'L2_a', chr: 'LG28', start_bp: 0, end_bp: 100_000, K: 3, verdict: 'TWO_INVERSIONS' },
  { id: 'L2_b', chr: 'LG14', start_bp: 5_000_000, end_bp: 5_500_000, K: 6, verdict: '' },
  { id: 'L2_c', chr: 'LG1',  start_bp: 0, end_bp: 100, K: 3, verdict: 'NA' },
];
const existingList = [{ id: 'cand_existing', chrom: 'LGZ', start_bp: 0, end_bp: 100 }];
const promRes = CAT.promoteRowsToCandidates(promoteRows, existingList);
check('promote: 3 new candidates',          promRes.promoted.length === 3);
check('promote: list grows from 1 to 4',     promRes.candidateList.length === 4);
check('promote: original list not mutated',  existingList.length === 1);
check('promote: each promoted has id',
      promRes.promoted.every(c => typeof c.id === 'string' && c.id.length > 0));
check('promote: provisional + not confirmed',
      promRes.promoted.every(c => c.provisional === true && c.confirmed === false));
check('promote: promoted_from = catalogue',
      promRes.promoted.every(c => c.promoted_from === 'catalogue'));
check('promote: chrom propagated',           promRes.promoted[0].chrom === 'LG28');
check('promote: bp ranges preserved',
      promRes.promoted[0].start_bp === 0 && promRes.promoted[0].end_bp === 100_000);
check('promote: locked_labels init []',      Array.isArray(promRes.promoted[0].locked_labels));

// Duplicate skip
const promRes2 = CAT.promoteRowsToCandidates(promoteRows, promRes.candidateList);
check('promote: dupe ids skipped',           promRes2.promoted.length === 0);
check('promote: list size unchanged',        promRes2.candidateList.length === 4);

// Empty / null inputs
check('promote: null rows → empty promoted', CAT.promoteRowsToCandidates(null, []).promoted.length === 0);
check('promote: null list defaults to []',   CAT.promoteRowsToCandidates([{ id: 'X' }]).candidateList.length === 1);

// -----------------------------------------------------------------------------
group('promoteSelectedToCandidates');
const promState = {
  catalogueRows: [
    { id: 'L2_a', chr: 'LG28', start_bp: 0, end_bp: 100_000, K: 3 },
    { id: 'L2_b', chr: 'LG14', start_bp: 0, end_bp: 200_000, K: 6 },
  ],
  catSelection: new Set(['L2_a']),
  candidateList: [],
};
const promSelRes = CAT.promoteSelectedToCandidates(promState);
check('promoteSel: only selected row promoted',     promSelRes.promoted.length === 1);
check('promoteSel: state.candidateList mutated',    promState.candidateList.length === 1);
check('promoteSel: state.candidate set to active',  promState.candidate.id === 'L2_a');
check('promoteSel: returned active matches',        promSelRes.active.id === 'L2_a');

// No selection
const promEmpty = CAT.promoteSelectedToCandidates({ catalogueRows: promoteRows, catSelection: new Set() });
check('promoteSel: empty selection → 0 promoted',   promEmpty.promoted.length === 0);
check('promoteSel: active null',                    promEmpty.active === null);

// -----------------------------------------------------------------------------
group('wireCatalogueToolbar: view-as-candidate button');
const sP = {
  catalogueRows: [
    { id: 'L2_a', chr: 'LG28', start_bp: 0, end_bp: 100_000, K: 3 },
  ],
  catSelection: new Set(['L2_a']),
  candidateList: [],
};
let onPromoteResult = null;
CAT.wireCatalogueToolbar(sP, {
  onPromote: (_, r) => { onPromoteResult = r; },
});
const viewBtn = _ensure('catViewAsCandidate');
viewBtn.fire('click', {});
check('view-as-cand: state.candidateList grown',     sP.candidateList.length === 1);
check('view-as-cand: state.candidate activated',     sP.candidate && sP.candidate.id === 'L2_a');
check('view-as-cand: onPromote fired with result',   onPromoteResult && onPromoteResult.promoted.length === 1);

// Click again → already promoted, nothing happens
const beforeLen = sP.candidateList.length;
onPromoteResult = null;
viewBtn.fire('click', {});
check('view-as-cand: idempotent (no dupes)',         sP.candidateList.length === beforeLen);
check('view-as-cand: onPromote NOT fired when empty', onPromoteResult === null);

CAT.teardownCatalogueToolbar();

// -----------------------------------------------------------------------------
group('Diamond column + strictness mode');
check('CAT_DIAMOND_MODES frozen',
      Object.isFrozen(CAT.CAT_DIAMOND_MODES) && CAT.CAT_DIAMOND_MODES.length === 3);
check('CAT_COLUMNS includes diamond',
      CAT.CAT_COLUMNS.some(c => c.key === 'diamond' && c.kind === 'diamond'));

// buildCatalogueRows propagates diamond_summary
const rowsWithSummary = CAT.buildCatalogueRows({
  catalogueRows: [{
    id: 'L2_a', chr: 'LG28', start_bp: 0, end_bp: 100,
    diamond_summary: { n_loose: 2, n_strict: 1, n_strict2: 0, n_diamonds: 2 },
  }],
});
check('build: diamond_summary propagated',  rowsWithSummary[0].diamond_summary.n_loose === 2);
check('build: missing summary → null',
      CAT.buildCatalogueRows({ catalogueRows: [{ id: 'X', chr: 'Y', start_bp: 0, end_bp: 1 }] })[0].diamond_summary === null);

// renderCatBodyHtml renders the diamond cell per mode
const rowsForDiamond = [{
  id: 'L2_a', chr: 'LG28', start_bp: 0, end_bp: 100,
  diamond_summary: { n_loose: 3, n_strict: 2, n_strict2: 1, n_diamonds: 3 },
}];
const htmlLoose = CAT.renderCatBodyHtml(rowsForDiamond, 'detailed', new Set(), new Set(), 'loose');
check('body: loose mode shows 3',           htmlLoose.includes('◇ 3') || htmlLoose.includes(' 3<'));
const htmlStrict = CAT.renderCatBodyHtml(rowsForDiamond, 'detailed', new Set(), new Set(), 'strict');
check('body: strict mode shows ◆ 2',         htmlStrict.includes('◆ 2'));
const htmlStrict2 = CAT.renderCatBodyHtml(rowsForDiamond, 'detailed', new Set(), new Set(), 'strict2');
check('body: strict2 mode shows ◆◆ 1',       htmlStrict2.includes('◆◆ 1'));

// No diamonds → em-dash
const noDiaRow = [{ id: 'L2_b', chr: 'X', start_bp: 0, end_bp: 1, diamond_summary: null }];
const htmlNoDia = CAT.renderCatBodyHtml(noDiaRow, 'detailed', new Set(), new Set(), 'loose');
check('body: no diamonds shows —',           htmlNoDia.includes('—'));

// Wire toolbar: diamond-mode buttons mutate state.catDiamondMode
const sD = {
  catalogueRows: rowsForDiamond,
  catSelection: new Set(),
  catFavorites: new Set(),
  catDiamondMode: 'loose',
};
CAT.wireCatalogueToolbar(sD, {});
const diaStrict = _ensure('catDiamondStrict');
diaStrict.fire('click', {});
check('wire: strict button → state.catDiamondMode = strict',
      sD.catDiamondMode === 'strict');

const diaStrict2 = _ensure('catDiamondStrict2');
diaStrict2.fire('click', {});
check('wire: strict2 button',                sD.catDiamondMode === 'strict2');

const diaLoose = _ensure('catDiamondLoose');
diaLoose.fire('click', {});
check('wire: loose button',                  sD.catDiamondMode === 'loose');

CAT.teardownCatalogueToolbar();

// -----------------------------------------------------------------------------
group('teardownCatalogueToolbar');
CAT.teardownCatalogueToolbar();
check('teardown: filter handler removed',
      (filt._listeners.input || []).length === 0);
check('teardown: selectAll handler removed',
      (selAll._listeners.click || []).length === 0);

let teardown2OK = true;
try { CAT.teardownCatalogueToolbar(); } catch (_) { teardown2OK = false; }
check('teardown: idempotent', teardown2OK);

// -----------------------------------------------------------------------------
group('Headless tolerance');
const savedDoc = global.document;
delete global.document;
let headlessOK = true;
try {
  CAT.renderCatalogue({});
  CAT.wireCatalogueToolbar({});
  CAT.teardownCatalogueToolbar();
} catch (_) { headlessOK = false; }
check('headless: silent w/o document', headlessOK);
global.document = savedDoc;

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
