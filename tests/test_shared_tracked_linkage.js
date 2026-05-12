// tests/test_shared_tracked_linkage.js
//
// Unit coverage for shared/tracked_linkage.js — per-candidate
// dominance projection across a tracked-fish set (legacy lines
// 46711-46860).

import * as TLP from '../atlases/inversion/shared/tracked_linkage.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('Constants');
check('TLP_PURITY_FLOOR = 0.30',     TLP.TLP_PURITY_FLOOR === 0.30);
check('TLP_MIN_FISH = 3',            TLP.TLP_MIN_FISH === 3);
check('TLP_INH_GROUP_COLORS frozen', Object.isFrozen(TLP.TLP_INH_GROUP_COLORS));
check('palette has 10 colors',       TLP.TLP_INH_GROUP_COLORS.length === 10);

// -----------------------------------------------------------------------------
group('tlpInhGroupColor');
check('group 0 → first palette color',  TLP.tlpInhGroupColor(0) === TLP.TLP_INH_GROUP_COLORS[0]);
check('group 5 → 6th color',            TLP.tlpInhGroupColor(5) === TLP.TLP_INH_GROUP_COLORS[5]);
check('group 12 → wraps mod 10',        TLP.tlpInhGroupColor(12) === TLP.TLP_INH_GROUP_COLORS[2]);
check('null → neutral grey',            TLP.tlpInhGroupColor(null) === '#7a8398');
check('-1 → neutral grey',              TLP.tlpInhGroupColor(-1) === '#7a8398');

// -----------------------------------------------------------------------------
group('computeTrackedLinkageProjection: basic');
// 10 fish, 3 candidates with K=3. Tracked fish = [0, 1, 2, 3, 4].
const items = [
  { id: 'c1', K: 3, seq_num: 1, start_bp: 100, end_bp: 200,
    labels: [0, 0, 0, 1, 2, 1, 0, 2, 1, 0] },  // tracked → 3*0, 1*1, 1*2
  { id: 'c2', K: 3, seq_num: 2, start_bp: 300, end_bp: 400,
    labels: [1, 1, 1, 1, 1, 0, 0, 0, 0, 0] },  // tracked → 5*1
  { id: 'c3', K: 3, seq_num: 3, start_bp: 500, end_bp: 600,
    labels: [-1, -1, -1, -1, -1, 0, 0, 0, 0, 0] },  // tracked → 0 hits
];

const proj = TLP.computeTrackedLinkageProjection([0, 1, 2, 3, 4], items);
check('returns object with n_total = 5',  proj.n_total === 5);
// c3 has 0 hits → skipped; c1 + c2 land in per_candidate
check('c3 skipped (0 hits)',              proj.per_candidate.length === 2);
const c1 = proj.per_candidate.find(r => r.candidate_id === 'c1');
const c2 = proj.per_candidate.find(r => r.candidate_id === 'c2');
check('c1 dominant_band = 0',             c1.dominant_band === 0);
check('c1 dominant_count = 3',            c1.dominant_count === 3);
check('c1 purity = 0.6',                  Math.abs(c1.purity - 0.6) < 1e-9);
check('c1 per_band_counts = [3,1,1]',     c1.per_band_counts.join(',') === '3,1,1');
check('c2 dominant_band = 1',             c2.dominant_band === 1);
check('c2 purity = 1.0',                  c2.purity === 1.0);
check('c2 inh_group_id = null (no inh)',  c2.inh_group_id === null);
check('c2 inh_group_color = neutral grey', c2.inh_group_color === '#7a8398');
// Pass-through fields
check('c1 seq_num propagated',            c1.seq_num === 1);
check('c1 start_bp propagated',           c1.start_bp === 100);
check('c1 K propagated',                  c1.K === 3);

// -----------------------------------------------------------------------------
group('computeTrackedLinkageProjection: edge cases');
// Below min fish
check('below min: empty per_candidate',
      TLP.computeTrackedLinkageProjection([0, 1], items).per_candidate.length === 0);

// Empty / null inputs
check('null fishIdx → empty',
      TLP.computeTrackedLinkageProjection(null, items).per_candidate.length === 0);
check('null items → empty',
      TLP.computeTrackedLinkageProjection([0, 1, 2, 3, 4], null).per_candidate.length === 0);
check('empty items → empty',
      TLP.computeTrackedLinkageProjection([0, 1, 2, 3, 4], []).per_candidate.length === 0);

// Custom minFish
check('custom minFish: 1-fish tracked allowed',
      TLP.computeTrackedLinkageProjection([0], items, null, { minFish: 1 })
        .per_candidate.length >= 1);

// Tracked fish with negative labels skipped
const allNeg = [{ id: 'cX', K: 3, labels: [-1, -1, -1, -1, -1] }];
check('all-negative labels: candidate skipped',
      TLP.computeTrackedLinkageProjection([0, 1, 2, 3, 4], allNeg)
        .per_candidate.length === 0);

// -----------------------------------------------------------------------------
group('computeTrackedLinkageProjection: inheritance group lookup');
const inh = {
  items_meta: [{ id: 'c1' }, { id: 'c2' }],
  band_index: [
    { item_idx: 0, band: 0 }, { item_idx: 0, band: 1 }, { item_idx: 0, band: 2 },
    { item_idx: 1, band: 0 }, { item_idx: 1, band: 1 }, { item_idx: 1, band: 2 },
  ],
  cut: { group_id_per_band: [3, 1, 1, 1, 5, 5] },
};
const projInh = TLP.computeTrackedLinkageProjection([0, 1, 2, 3, 4], items, inh);
const c1Inh = projInh.per_candidate.find(r => r.candidate_id === 'c1');
const c2Inh = projInh.per_candidate.find(r => r.candidate_id === 'c2');
check('c1 dominant band 0 → group_id 3',  c1Inh.inh_group_id === 3);
check('c1 group color = palette[3]',
      c1Inh.inh_group_color === TLP.TLP_INH_GROUP_COLORS[3]);
check('c2 dominant band 1 → group_id 5',  c2Inh.inh_group_id === 5);

// Missing inheritance: graceful fallback (null + grey)
const projNoInh = TLP.computeTrackedLinkageProjection([0, 1, 2, 3, 4], items, null);
check('no inh: inh_group_id null',
      projNoInh.per_candidate.every(r => r.inh_group_id === null));

// Mismatched id in inh.items_meta → group lookup misses, falls back to null
const inhMismatch = {
  items_meta: [{ id: 'unknown' }],
  band_index: [{ item_idx: 0, band: 0 }],
  cut: { group_id_per_band: [7] },
};
const projMismatch = TLP.computeTrackedLinkageProjection([0, 1, 2, 3, 4], items, inhMismatch);
check('mismatched inh id: falls back to null',
      projMismatch.per_candidate.every(r => r.inh_group_id === null));

// -----------------------------------------------------------------------------
group('filterByPurityFloor');
const filtered = TLP.filterByPurityFloor(proj);
check('default floor: c1 (purity 0.6) kept',
      filtered.some(r => r.candidate_id === 'c1'));
check('default floor: c2 (purity 1.0) kept',
      filtered.some(r => r.candidate_id === 'c2'));

const filteredStrict = TLP.filterByPurityFloor(proj, 0.7);
check('strict floor 0.7: c1 dropped',
      !filteredStrict.some(r => r.candidate_id === 'c1'));
check('strict floor 0.7: c2 kept',
      filteredStrict.some(r => r.candidate_id === 'c2'));

check('null projection → []',  TLP.filterByPurityFloor(null).length === 0);

// -----------------------------------------------------------------------------
group('drawTrackedLinkageStrip');
// Fake canvas context that records calls
class FakeCtx {
  constructor() {
    this.calls = [];
    this.fillStyle = '';
    this.font = '';
    this.textAlign = '';
    this.textBaseline = '';
  }
  save()      { this.calls.push(['save']); }
  restore()   { this.calls.push(['restore']); }
  fillRect(x, y, w, h) { this.calls.push(['fillRect', x, y, w, h, this.fillStyle]); }
  fillText(s, x, y)    { this.calls.push(['fillText', s, x, y, this.fillStyle]); }
}

// Projection from earlier: 2 candidates kept. Mb range covers c1 (100bp = 0.0001 Mb).
const projForDraw = TLP.computeTrackedLinkageProjection([0, 1, 2, 3, 4], [
  { id: 'c1', K: 3, seq_num: 1, start_bp: 10_000_000, end_bp: 12_000_000,
    labels: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },  // purity 1.0
  { id: 'c2', K: 3, seq_num: 2, start_bp: 15_000_000, end_bp: 16_000_000,
    labels: [0, 0, 1, 1, 2, 2, 2, 2, 2, 2] },  // purity 0.4 (below default floor)
]);

const ctx = new FakeCtx();
TLP.drawTrackedLinkageStrip(ctx, { l: 50, t: 10 }, 600, 200, 5, 20, projForDraw);
check('drawStrip: save/restore called',
      ctx.calls[0][0] === 'save' && ctx.calls[ctx.calls.length - 1][0] === 'restore');
check('drawStrip: fillRect called for c1 (purity 1.0)',
      ctx.calls.some(c => c[0] === 'fillRect'));
// c2's purity 0.4 is above default floor 0.30 so it should also draw.
const fillRectCount = ctx.calls.filter(c => c[0] === 'fillRect').length;
check('drawStrip: 2 fill rects (c1 + c2)',  fillRectCount === 2);

// Label "I1·b0 · 100%" should appear for c1 (wide + purity ≥ 0.5)
const labels = ctx.calls.filter(c => c[0] === 'fillText').map(c => c[1]);
check('drawStrip: c1 label rendered',
      labels.some(l => l.includes('I1·b0') && l.includes('100%')));

// purityFloor override
const ctx2 = new FakeCtx();
TLP.drawTrackedLinkageStrip(ctx2, { l: 50, t: 10 }, 600, 200, 5, 20, projForDraw, { purityFloor: 0.9 });
const fillRectCount2 = ctx2.calls.filter(c => c[0] === 'fillRect').length;
check('drawStrip: custom floor 0.9 → only c1 (purity 1.0) kept',
      fillRectCount2 === 1);

// Outside visible range
const ctx3 = new FakeCtx();
TLP.drawTrackedLinkageStrip(ctx3, { l: 50, t: 10 }, 600, 200, 100, 200, projForDraw);
check('drawStrip: outside visible range → no fillRect',
      ctx3.calls.filter(c => c[0] === 'fillRect').length === 0);

// Headless safety
let headlessOK = true;
try {
  TLP.drawTrackedLinkageStrip(null, { l: 0, t: 0 }, 100, 100, 0, 1, projForDraw);
  TLP.drawTrackedLinkageStrip({}, { l: 0, t: 0 }, 100, 100, 0, 1, projForDraw);
  TLP.drawTrackedLinkageStrip(ctx, { l: 0, t: 0 }, 100, 100, 0, 1, null);
  TLP.drawTrackedLinkageStrip(ctx, { l: 0, t: 0 }, 100, 100, 0, 1, { per_candidate: [] });
} catch (_) { headlessOK = false; }
check('drawStrip: headless safety',  headlessOK);

// -----------------------------------------------------------------------------
group('inheritanceSuggestionsForCandidate');
const inhFixture = {
  rtab: {},
  items_meta: [{ id: 'c1' }, { id: 'c2' }],
  band_index: [
    { item_idx: 0, band: 0 }, { item_idx: 0, band: 1 }, { item_idx: 0, band: 2 },
    { item_idx: 1, band: 0 }, { item_idx: 1, band: 1 }, { item_idx: 1, band: 2 },
  ],
  cut: { group_id_per_band: [3, 1, 1, 1, 5, 5] },
};
const c1Sugg = TLP.inheritanceSuggestionsForCandidate({ id: 'c1' }, inhFixture);
check('c1 band 0 → group 3',   c1Sugg[0] === 3);
check('c1 band 1 → group 1',   c1Sugg[1] === 1);
check('c1 band 2 → group 1',   c1Sugg[2] === 1);

const c2Sugg = TLP.inheritanceSuggestionsForCandidate({ id: 'c2' }, inhFixture);
check('c2 band 0 → group 1',   c2Sugg[0] === 1);
check('c2 band 1 → group 5',   c2Sugg[1] === 5);

const unknownSugg = TLP.inheritanceSuggestionsForCandidate({ id: 'cZ' }, inhFixture);
check('unknown candidate → {}',  Object.keys(unknownSugg).length === 0);

check('null candidate → {}',
      Object.keys(TLP.inheritanceSuggestionsForCandidate(null, inhFixture)).length === 0);
check('null inh → {}',
      Object.keys(TLP.inheritanceSuggestionsForCandidate({ id: 'c1' }, null)).length === 0);
check('inh missing items_meta → {}',
      Object.keys(TLP.inheritanceSuggestionsForCandidate({ id: 'c1' }, { rtab: {} })).length === 0);
check('inh missing rtab → {}',
      Object.keys(TLP.inheritanceSuggestionsForCandidate({ id: 'c1' }, { items_meta: [] })).length === 0);

// inh with items_meta + rtab but missing band_index → empty object
const inhMinimal = { items_meta: [{ id: 'c1' }], rtab: {} };
check('inh missing band_index → {}',
      Object.keys(TLP.inheritanceSuggestionsForCandidate({ id: 'c1' }, inhMinimal)).length === 0);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
