// tests/test_karyotype_tier_karyotype.js
//
// Unit coverage for karyotype_tier's karyotype + tier renderers, which legacy
// referenced via TODO_MISSING markers (renderCandidateKaryotypeBody,
// renderTierAxesGrid, getKaryotypeLabel, getKaryotypeLabelCaveat,
// buildKaryotypeRows, isKaryoTwoTrack, ...). The cartridge ports them
// to:
//   pages/review/karyotype_tier/karyo_labels.js
//   pages/review/karyotype_tier/karyo_rows.js
//   pages/review/karyotype_tier/tier_axes.js
//   pages/review/karyotype_tier/karyo_body.js
//
// Covers:
//   - KARYO_DETAILED_LABELS + KARYO_LEGACY_LABELS_K3 vocab tables
//   - ensureKaryoLabelVocab / setKaryoLabelVocab w/ localStorage persistence
//   - getKaryotypeLabel: legacy + detailed paths + K out-of-range fallback
//   - getKaryotypeLabelCaveat: returns caveat only in detailed mode
//   - isKaryoTwoTrack / karyoBandToTrackMap: structural detection
//   - buildKaryotypeRows: samples + track_idx + sigma propagation
//   - filterKaryoRows: free-text + band filter; case-insensitive
//   - sortKaryoRows: numeric vs string keys; asc/desc
//   - TIER_AXES (14 entries) + TIER_GROUPS (6 entries) frozen
//   - tierAxisValueColor: pass/fail/unknown + tier-specific palettes
//   - renderTierAxesGrid: empty-state ("not yet computed") + value pills
//   - renderKaryotypeBodyHtml: header pills + table rows + escaping
//   - renderKaryotypeBody + wireKaryotypeToolbar: filter/sort/export wiring
//   - exportKaryotypeTSV: header + escaping

import * as KL from '../atlases/inversion/pages/review/karyotype_tier/karyo_labels.js';
import * as KR from '../atlases/inversion/pages/review/karyotype_tier/karyo_rows.js';
import * as TA from '../atlases/inversion/pages/review/karyotype_tier/tier_axes.js';
import * as KB from '../atlases/inversion/pages/review/karyotype_tier/karyo_body.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// localStorage shim — same shape candidate_focus uses
const _store = {};
global.localStorage = {
  getItem: (k) => Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null,
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; },
  clear: () => { for (const k of Object.keys(_store)) delete _store[k]; },
};

// -----------------------------------------------------------------------------
group('karyo_labels: vocab tables');
check('KARYO_LABEL_VOCABS frozen',     Object.isFrozen(KL.KARYO_LABEL_VOCABS));
check('KARYO_DETAILED_LABELS frozen',  Object.isFrozen(KL.KARYO_DETAILED_LABELS));
check('K=3 detailed = H1/H1, H1/H2, H2/H2',
      KL.KARYO_DETAILED_LABELS[3].join(',') === 'H1/H1,H1/H2,H2/H2');
check('K=6 detailed has 6 entries',    KL.KARYO_DETAILED_LABELS[6].length === 6);
check('legacy K=3 labels frozen',      Object.isFrozen(KL.KARYO_LEGACY_LABELS_K3));

// -----------------------------------------------------------------------------
group('karyo_labels: ensure + setKaryoLabelVocab');
const s1 = {};
check('ensure default legacy',         KL.ensureKaryoLabelVocab(s1) === 'legacy');
check('state.labelVocab set',          s1.labelVocab === 'legacy');

// setKaryoLabelVocab persists
check('set detailed: true',            KL.setKaryoLabelVocab(s1, 'detailed') === true);
check('state.labelVocab updated',      s1.labelVocab === 'detailed');
check('localStorage persisted',
      localStorage.getItem('inversion_atlas.labelVocab') === 'detailed');

// New state reads from storage
const s2 = {};
check('new state reads detailed from storage',
      KL.ensureKaryoLabelVocab(s2) === 'detailed');

// Invalid value rejected
check('set invalid: false',            KL.setKaryoLabelVocab(s1, 'wat') === false);
check('state.labelVocab unchanged',    s1.labelVocab === 'detailed');

localStorage.clear();

// -----------------------------------------------------------------------------
group('karyo_labels: getKaryotypeLabel');
const sL = { labelVocab: 'legacy' };
check('legacy K=3 band 0',             KL.getKaryotypeLabel(sL, 0, 3) === 'band 1 (lo)');
check('legacy K=3 band 2',             KL.getKaryotypeLabel(sL, 2, 3) === 'band 3 (hi)');
check('legacy K=6 fall back to "band N"', KL.getKaryotypeLabel(sL, 0, 6) === 'band 1');

const sD = { labelVocab: 'detailed' };
check('detailed K=3 band 0',           KL.getKaryotypeLabel(sD, 0, 3) === 'H1/H1');
check('detailed K=3 band 1',           KL.getKaryotypeLabel(sD, 1, 3) === 'H1/H2');
check('detailed K=6 band 4',           KL.getKaryotypeLabel(sD, 4, 6) === 'H2/H3');
check('detailed K=10 falls back',      KL.getKaryotypeLabel(sD, 0, 10) === 'band 1');

check('bandIdx < 0 → "?"',             KL.getKaryotypeLabel(sD, -1, 3) === '?');

// Caveat
check('detailed caveat non-null',      typeof KL.getKaryotypeLabelCaveat(sD) === 'string');
check('legacy caveat null',            KL.getKaryotypeLabelCaveat(sL) === null);

// -----------------------------------------------------------------------------
group('karyo_rows: isKaryoTwoTrack + bandToTrackMap');
const candSingle = { locked_labels: [0, 1, 2], K: 3 };
const candTwo = {
  K: 6, locked_labels: [0, 1, 2, 3, 4, 5],
  tracks: [
    { active_bands: [0, 1, 2] },
    { active_bands: [3, 4, 5] },
  ],
};
const candFakeTwo = {
  K: 6,
  tracks: [{ active_bands: [0] }, { active_bands: [] }],
  locked_labels: [],
};

check('single-track: false',           KR.isKaryoTwoTrack(candSingle) === false);
check('two-track: true',               KR.isKaryoTwoTrack(candTwo) === true);
check('empty track active_bands: false', KR.isKaryoTwoTrack(candFakeTwo) === false);

const m = KR.karyoBandToTrackMap(candTwo);
check('bandToTrackMap: band 1 → 0',    m.get(1) === 0);
check('bandToTrackMap: band 4 → 1',    m.get(4) === 1);
check('bandToTrackMap: band 99 absent', !m.has(99));

// -----------------------------------------------------------------------------
group('karyo_rows: buildKaryotypeRows');
const samples = [
  { ind: 'IndA', cga: 'CGA_A', family_id: 1, ancestry: 'AS' },
  { ind: 'IndB', cga: 'CGA_B', family_id: 2, ancestry: 'EU' },
  { ind: 'IndC', cga: 'CGA_C', family_id: -1, ancestry: '' },
];
const cand1 = { K: 3, locked_labels: [0, 1, 2] };
const rows1 = KR.buildKaryotypeRows(cand1, samples, null);
check('build: 3 rows',                  rows1.length === 3);
check('build: cga propagated',          rows1[0].cga === 'CGA_A');
check('build: k_label propagated',      rows1[2].k_label === 2);
check('build: family_id default -1',    rows1[2].family_id === -1);
check('build: sigma NaN when no spread', Number.isNaN(rows1[0].sigma));
check('build: track_idx null on single', rows1[0].track_idx === null);

const sigmaSpread = new Float64Array([0.01, 0.04, 0.20]);
const rowsSig = KR.buildKaryotypeRows(cand1, samples, sigmaSpread);
check('build w/ sigmaSpread: propagated', Math.abs(rowsSig[1].sigma - 0.04) < 1e-9);

// Two-track
const candTT = {
  K: 6, locked_labels: [0, 1, 3, 4, 2, 5],
  tracks: [{ active_bands: [0, 1, 2] }, { active_bands: [3, 4, 5] }],
};
const rowsTT = KR.buildKaryotypeRows(candTT, [], null);
check('build TT: 6 rows',               rowsTT.length === 6);
check('build TT: si=0 → track 0',       rowsTT[0].track_idx === 0);
check('build TT: si=2 → track 1',       rowsTT[2].track_idx === 1);

// Missing samples slot defaults to "IndN"
const candNoSamp = { K: 2, locked_labels: [0, 1] };
const rowsND = KR.buildKaryotypeRows(candNoSamp, [], null);
check('build w/o samples: cga "Ind0"',  rowsND[0].cga === 'Ind0');

check('build invalid → []',  KR.buildKaryotypeRows(null, [], null).length === 0);

// -----------------------------------------------------------------------------
group('karyo_rows: filter + sort');
const rowsForFilter = [
  { si: 0, cga: 'CGA_A', ind: 'IndA', k_label: 0, sigma: 0.1, family_id: 1, ancestry: 'AS' },
  { si: 1, cga: 'CGA_B', ind: 'IndB', k_label: 1, sigma: 0.5, family_id: 2, ancestry: 'EU' },
  { si: 2, cga: 'CGA_C', ind: 'IndC', k_label: 0, sigma: 0.2, family_id: 1, ancestry: '' },
];
const fAll = KR.filterKaryoRows(rowsForFilter, { filter: '', bandFilter: '' });
check('filter: empty → all',            fAll.length === 3);
const fBand = KR.filterKaryoRows(rowsForFilter, { filter: '', bandFilter: 'k0' });
check('filter: band k0 → 2 rows',       fBand.length === 2);
const fText = KR.filterKaryoRows(rowsForFilter, { filter: 'CGA_B' });
check('filter: text CGA_B → 1 row',     fText.length === 1);
const fCase = KR.filterKaryoRows(rowsForFilter, { filter: 'as' });
check('filter: case-insensitive AS',    fCase.length === 1);
const fFam = KR.filterKaryoRows(rowsForFilter, { filter: '1' });
check('filter: family "1" → 2 rows',    fFam.length === 2);

const sAsc = KR.sortKaryoRows(rowsForFilter, { sortKey: 'sigma', sortAsc: true });
check('sort sigma asc: 0.1 first',      sAsc[0].sigma === 0.1);
const sDesc = KR.sortKaryoRows(rowsForFilter, { sortKey: 'sigma', sortAsc: false });
check('sort sigma desc: 0.5 first',     sDesc[0].sigma === 0.5);
const sStr = KR.sortKaryoRows(rowsForFilter, { sortKey: 'cga', sortAsc: false });
check('sort cga desc: CGA_C first',     sStr[0].cga === 'CGA_C');

// -----------------------------------------------------------------------------
group('tier_axes: vocab');
check('TIER_AXES has 14 entries',       TA.TIER_AXES.length === 14);
check('TIER_AXES frozen',               Object.isFrozen(TA.TIER_AXES));
check('TIER_AXES entries frozen',       TA.TIER_AXES.every(a => Object.isFrozen(a)));
check('TIER_GROUPS has 6 entries',      TA.TIER_GROUPS.length === 6);
check('confidence_tier present',        TA.TIER_AXES.some(a => a.id === 'confidence_tier'));

// -----------------------------------------------------------------------------
group('tier_axes: color palette');
check('pass → green',                    TA.tierAxisValueColor('existence_layer_a', 'pass').includes('34,160,80'));
check('fail → red',                      TA.tierAxisValueColor('existence_layer_b', 'fail').includes('224,85,92'));
check('unknown → grey',                  TA.tierAxisValueColor('any_axis', 'unknown').includes('120,130,145'));
check('T1 → green',                      TA.tierAxisValueColor('confidence_tier', 'T1').includes('34,160,80'));
check('T4 → amber',                      TA.tierAxisValueColor('confidence_tier', 'T4').includes('245,165,36'));
check('multi_family → green',            TA.tierAxisValueColor('family_linkage', 'multi_family').includes('34,160,80'));
check('pca_family_confounded → red',     TA.tierAxisValueColor('family_linkage', 'pca_family_confounded').includes('224,85,92'));
check('default neutral hue',             TA.tierAxisValueColor('mechanism_class', 'NAHR').includes('120,140,180'));

// -----------------------------------------------------------------------------
group('tier_axes: renderTierAxesGrid');
const gridEmpty = TA.renderTierAxesGrid(null);
check('grid empty: "not yet computed" pills',
      (gridEmpty.match(/not yet computed/g) || []).length === 14);
check('grid empty: all 14 axis labels rendered',
      TA.TIER_AXES.every(ax => gridEmpty.includes(ax.label)));
check('grid empty: 6 section labels',
      TA.TIER_GROUPS.every(g => gridEmpty.includes(g.label)));

const gridFilled = TA.renderTierAxesGrid({
  existence_layer_a: 'pass',
  confidence_tier:   'T1',
});
check('grid filled: pass pill rendered',  gridFilled.includes('>pass<'));
check('grid filled: T1 pill rendered',    gridFilled.includes('>T1<'));
check('grid filled: still 12 placeholders',
      (gridFilled.match(/not yet computed/g) || []).length === 12);

// HTML escape attempt
const gridEsc = TA.renderTierAxesGrid({ existence_layer_a: '<script>x</script>' });
check('grid: escapes <script>',           !gridEsc.includes('<script>x'));
check('grid: produces &lt;script&gt;',     gridEsc.includes('&lt;script&gt;'));

// -----------------------------------------------------------------------------
group('karyo_body: renderKaryotypeBodyHtml pure builder');
// Need groupColor from shared. The renderer doesn't depend on document.
const popState = {
  candidate: {
    id: 'cand_A', chrom: 'LG28', start_bp: 1_000_000, end_bp: 2_000_000,
    K: 3, locked_labels: [0, 1, 2],
  },
  data: { samples: samples },
  labelVocab: 'detailed',
  karyoUi: { sortKey: 'k_label', sortAsc: true, filter: '', bandFilter: '' },
};
const html = KB.renderKaryotypeBodyHtml(popState);
check('body html: ck-header rendered',     html.includes('ck-header'));
check('body html: K=3 mentioned',          html.includes('K=3'));
check('body html: H1/H1 label',            html.includes('H1/H1'));
check('body html: 4 <tr> (1 header + 3 body)',
      (html.match(/<tr>/g) || []).length === 4);
check('body html: toolbar input',          html.includes('id="ckFilter"'));
check('body html: export button',          html.includes('id="ckExportTSV"'));
check('body html: TwoTrack badge absent',  !html.includes('ck-two-track-badge'));

// Two-track
const popTT = {
  candidate: candTT,
  data: { samples: [] },
  labelVocab: 'legacy',
};
const htmlTT = KB.renderKaryotypeBodyHtml(popTT);
check('body html TT: badge present',       htmlTT.includes('ck-two-track-badge'));
check('body html TT: Track 1 column',      htmlTT.includes('Track 1'));
check('body html TT: Track 2 column',      htmlTT.includes('Track 2'));
check('body html TT: T1 pill',             htmlTT.includes('>T1<'));

// No candidate
check('body html: no candidate → ""',     KB.renderKaryotypeBodyHtml({ candidate: null }) === '');

// Escape: candidate id with <script>
const popEsc = {
  candidate: { id: 'cand_<bad>', chrom: 'X', start_bp: 0, end_bp: 100, K: 1, locked_labels: [0] },
  data: { samples: [{ cga: '<bad>cga', ind: 'I' }] },
  karyoUi: {},
};
const htmlEsc = KB.renderKaryotypeBodyHtml(popEsc);
check('body html: escapes <bad>',  !htmlEsc.includes('cand_<bad>') && htmlEsc.includes('&lt;bad&gt;'));

// -----------------------------------------------------------------------------
group('karyo_body: exportKaryotypeTSV');
const tsv = KB.exportKaryotypeTSV(popState.candidate, KR.buildKaryotypeRows(popState.candidate, samples, null));
const tsvLines = tsv.split('\n');
check('TSV: candidate metadata header',  tsvLines[0].startsWith('# candidate'));
check('TSV: column header line present', tsvLines.some(l => l.startsWith('si\tcga')));
check('TSV: 3 data rows',                tsvLines.length >= 4 + 3 - 1);  // 3 meta + header + 3 rows

// Embedded tab stripped
const tsvEsc = KB.exportKaryotypeTSV(
  { id: 'c', chrom: 'X', start_bp: 0, end_bp: 1, K: 1 },
  [{ si: 0, cga: 'tab\there', ind: 'I', k_label: 0, sigma: 0.5, family_id: 1, ancestry: '' }]
);
check('TSV: embedded \\t stripped',  !tsvEsc.split('\n').slice(4).some(l => l.split('\t').length > 8));

// -----------------------------------------------------------------------------
// DOM mocks for orchestrator wiring
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
group('karyo_body: renderKaryotypeBody DOM');
KB.renderKaryotypeBody(popState);
const content = _ensure('candKaryoContent');
check('content innerHTML populated',     content.innerHTML.length > 0);
check('content has ck-table',            content.innerHTML.includes('ck-table'));
check('ckInfo set',                      _ensure('ckInfo').textContent.includes('3 of 3'));

// -----------------------------------------------------------------------------
group('karyo_body: wireKaryotypeToolbar');
const exports = [];
let changeCalls = 0;
KB.wireKaryotypeToolbar(popState, {
  onChange: () => { changeCalls++; },
  onExport: (n, c, m) => { exports.push({ n, c, m }); },
});

const filt = _ensure('ckFilter');
filt.value = 'CGA_A';
filt.fire('input', { target: filt });
check('filter: state mutated',           popState.karyoUi.filter === 'CGA_A');
check('filter: count = "1 of 3"',        _ensure('ckInfo').textContent.includes('1 of 3'));
check('filter: onChange fired',          changeCalls >= 1);

// Reset
filt.value = '';
filt.fire('input', { target: filt });

const band = _ensure('ckBandFilter');
band.value = 'k1';
band.fire('change', { target: band });
check('band filter: state mutated',      popState.karyoUi.bandFilter === 'k1');

// Reset
band.value = '';
band.fire('change', { target: band });

// Export
const exp = _ensure('ckExportTSV');
exp.fire('click', {});
check('export TSV via onExport',         exports.length === 1);
check('export filename has cand id',     exports[0].n.includes('cand_A'));
check('export content has TSV header',   exports[0].c.startsWith('# candidate'));

// Idempotent re-wire
KB.wireKaryotypeToolbar(popState, {});
check('rewire: filter single handler',
      (filt._listeners.input || []).length === 1);

// -----------------------------------------------------------------------------
group('karyo_body: teardownKaryotypeToolbar');
KB.teardownKaryotypeToolbar();
check('teardown: filter handler removed',  (filt._listeners.input || []).length === 0);
check('teardown: band handler removed',    (band._listeners.change || []).length === 0);

let teardown2OK = true;
try { KB.teardownKaryotypeToolbar(); } catch (_) { teardown2OK = false; }
check('teardown: idempotent', teardown2OK);

// -----------------------------------------------------------------------------
group('Headless tolerance');
const savedDoc = global.document;
delete global.document;
let headlessOK = true;
try {
  KB.renderKaryotypeBody({ candidate: null });
  KB.wireKaryotypeToolbar({});
  KB.teardownKaryotypeToolbar();
} catch (_) { headlessOK = false; }
check('headless: all silent', headlessOK);
global.document = savedDoc;

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
