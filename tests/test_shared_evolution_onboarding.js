// tests/test_shared_evolution_onboarding.js
//
// Coverage for atlases/evolution/shared/{empty_state_panel,onboarding,auto_seed_inv_idx}.js.
// Pure JS — no real DOM (a minimal polyfill mirrors what's needed).

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
// Minimal DOM polyfill — only the methods the panel + registry touch.
// =====================================================================

class FakeEl {
  constructor(tag) {
    this.tagName = (tag || 'div').toUpperCase();
    this.children = [];
    this.attrs = {};
    this.style = {};
    this._cls = new Set();
    this.innerHTML = '';
    this.textContent = '';
    this._listeners = {};
  }
  appendChild(c) { this.children.push(c); c.parent = this; c.parentNode = this; return c; }
  insertBefore(c) { this.children.unshift(c); c.parent = this; c.parentNode = this; return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k)    { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(evt, cb) {
    (this._listeners[evt] = this._listeners[evt] || []).push(cb);
  }
  removeEventListener(evt, cb) {
    const arr = this._listeners[evt] || [];
    const i = arr.indexOf(cb);
    if (i >= 0) arr.splice(i, 1);
  }
  click() {
    (this._listeners.click || []).forEach((cb) => { try { cb({}); } catch (_) {} });
  }
  get classList() {
    const self = this;
    return {
      add:    (k) => self._cls.add(k),
      remove: (k) => self._cls.delete(k),
      contains: (k) => self._cls.has(k),
    };
  }
  querySelector(sel) {
    // Very simple: only matches `button[data-page="X"]`.
    const m = /^button\[data-page="([^"]+)"\]$/.exec(sel);
    if (!m) return null;
    return _findByDataPage(this, m[1]);
  }
}
function _findByDataPage(el, page) {
  if (!el || !el.children) return null;
  for (const c of el.children) {
    if (c.tagName === 'BUTTON' && c.attrs && c.attrs['data-page'] === page) return c;
    const hit = _findByDataPage(c, page);
    if (hit) return hit;
  }
  return null;
}

const _ids = Object.create(null);
const fakeDocument = {
  _root: new FakeEl('body'),
  createElement(tag) { return new FakeEl(tag); },
  getElementById(id) { return _ids[id] || null; },
  querySelector(sel) { return this._root.querySelector(sel); },
  _register(id, el) { _ids[id] = el; this._root.appendChild(el); el.attrs.id = id; },
  _clear() { for (const k of Object.keys(_ids)) delete _ids[k]; this._root = new FakeEl('body'); },
};
globalThis.document = fakeDocument;
globalThis.CSS = { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&') };
globalThis.localStorage = { _store: {}, getItem(k){return this._store[k]||null;}, setItem(k,v){this._store[k]=String(v);} };

const {
  renderEmptyStatePanel,
  navigateToPage,
} = await import('../atlases/evolution/shared/empty_state_panel.js');
const {
  applyOnboarding,
  resetOnboarding,
  _REGISTRY,
} = await import('../atlases/evolution/shared/onboarding.js');
const {
  autoSeedInvIdx,
  chromDosageMatrix,
  autoSeedDosageInput,
} = await import('../atlases/evolution/shared/auto_seed_inv_idx.js');
const {
  attachAutoSeedBadge,
  detachAutoSeedBadge,
} = await import('../atlases/evolution/shared/auto_seed_badge.js');
const {
  paintCanvasAxes,
  paintMatrixLabels,
  paintLegend,
} = await import('../atlases/evolution/shared/canvas_axes.js');

// =====================================================================
group('empty_state_panel.renderEmptyStatePanel');

const target = new FakeEl('div');
fakeDocument._register('hapNetEmpty', target);
let clicked = 0;
const r = renderEmptyStatePanel(target, {
  title: 'Test panel',
  description: 'this is a test',
  sources: ['source 1', 'source 2'],
  actions: [
    { label: 'Primary', primary: true, onClick: () => clicked++ },
    { label: 'Secondary',                onClick: () => clicked++ },
  ],
});
check('renderEmptyStatePanel returns teardown',  typeof r.teardown === 'function');
check('target class set',                        target.classList.contains('ev-empty-panel'));
check('target has card child',                   target.children.length === 1);
const card = target.children[0];
check('card has 5 children (title/desc/h/list/actions)', card.children.length === 5);
const titleEl = card.children[0];
check('title text written',                      titleEl.textContent === 'Test panel');
const actionsRow = card.children[4];
check('actions row has 2 buttons',               actionsRow.children.length === 2);
actionsRow.children[0].click();
actionsRow.children[1].click();
check('both action onClick fired',               clicked === 2);

// =====================================================================
group('empty_state_panel.navigateToPage');

// Place a fake button in the root so querySelector can find it.
const fakeBtn = new FakeEl('button');
fakeBtn.attrs['data-page'] = 'local_pca_dosage';
let navHit = 0;
fakeBtn.addEventListener('click', () => navHit++);
fakeDocument._root.appendChild(fakeBtn);
navigateToPage('local_pca_dosage');
check('navigateToPage clicks matching button',   navHit === 1);
navigateToPage('not_a_real_page');
check('navigateToPage no-ops on missing button', navHit === 1);

// =====================================================================
group('onboarding registry');

fakeDocument._clear();
const target2 = new FakeEl('div');
fakeDocument._register('hapNetEmpty', target2);
resetOnboarding('haplotype_network');
applyOnboarding('haplotype_network');
check('applyOnboarding renders once',            target2.children.length === 1);
applyOnboarding('haplotype_network');
check('applyOnboarding is idempotent same lifecycle', target2.children.length === 1);
resetOnboarding('haplotype_network');
target2.innerHTML = '';
target2.children = [];
applyOnboarding('haplotype_network');
check('applyOnboarding renders again after reset', target2.children.length === 1);

check('registry has 9 entries',                  Object.keys(_REGISTRY).length === 9);
const expectedPages = [
  'haplotype_network', 'age_divergence', 'inv_internal_substructure',
  'mosaicism_leakage', 'layer_cleaning', 'polarize_msa_stacked',
  'polarize_synteny_vote', 'event_tree_relative_ordering',
  'archaeology_synthesis_card',
];
for (const p of expectedPages) {
  check(`registry has ${p}`,                     !!_REGISTRY[p]);
  check(`${p} sentinelId is non-empty`,          typeof _REGISTRY[p].sentinelId === 'string' && _REGISTRY[p].sentinelId.length > 0);
  const cfg = _REGISTRY[p].cfg();
  check(`${p} cfg has title`,                    typeof cfg.title === 'string' && cfg.title.length > 0);
  check(`${p} cfg has description`,              typeof cfg.description === 'string' && cfg.description.length > 0);
  check(`${p} cfg has ≥1 source`,                Array.isArray(cfg.sources) && cfg.sources.length >= 1);
  check(`${p} cfg has ≥1 action`,                Array.isArray(cfg.actions) && cfg.actions.length >= 1);
  check(`${p} first action is primary`,          !!cfg.actions[0].primary);
}

// =====================================================================
group('auto_seed_inv_idx');

// No atlas state → null.
check('no atlas state → null',                   autoSeedInvIdx(null) === null);
check('no inversion → null',                     autoSeedInvIdx({}) === null);
check('no candidate → null',                     autoSeedInvIdx({ inversion: { _local_pca_dosage_state: { data: { windows: [], samples: [] } } }, shared: {} }) === null);

// Build a minimal chrom precomp: 8 samples, 3 windows. PC1 separates
// samples 0–3 (negative) from 4–7 (positive).
const samples = [
  { cga: 's0' }, { cga: 's1' }, { cga: 's2' }, { cga: 's3' },
  { cga: 's4' }, { cga: 's5' }, { cga: 's6' }, { cga: 's7' },
];
const win = (pc1) => ({ pc1: Float32Array.from(pc1), dosage: Float32Array.from(pc1.map(v => v < 0 ? 0 : 2)) });
const _w = (offset) => win([-2 + offset, -1.5 + offset, -1.2 + offset, -0.5 + offset,
                            0.5 + offset, 1.0 + offset, 1.5 + offset, 2.0 + offset]);
const data = {
  chrom: 'LG28',
  samples,
  n_samples: 8,
  windows: Array.from({ length: 12 }, (_, i) => _w(i * 0.05)),
};
const cand = { start_w: 0, end_w: 11, chrom: 'LG28', label: 'cand_demo' };
const seed = autoSeedInvIdx({
  inversion: { _local_pca_dosage_state: { data } },
  shared: { activeCandidate: cand },
});
check('seed returns object',                     seed && typeof seed === 'object');
check('seed inv_idx is Int32Array',              seed.inv_idx instanceof Int32Array);
check('seed std_idx is Int32Array',              seed.std_idx instanceof Int32Array);
check('inv_idx + std_idx cover all samples',     seed.inv_idx.length + seed.std_idx.length === 8);
const allIdx = new Set([...seed.inv_idx, ...seed.std_idx]);
check('every sample appears exactly once',       allIdx.size === 8);
check('inv ≤ std (smaller class picked)',        seed.inv_idx.length <= seed.std_idx.length);
check('candidate label contains chrom',          /LG28/.test(seed.candidate_label));

// chromDosageMatrix
const dm = chromDosageMatrix(data);
check('chromDosageMatrix not null',              dm !== null);
check('chromDosageMatrix has correct n_markers', dm.n_markers === 12);
check('chromDosageMatrix has correct n_samples', dm.n_samples === 8);
check('flat dosage row-major n*nS finite',       dm.values.length === 12 * 8);

// chromDosageMatrix returns null when there's <10 dosage rows.
check('chromDosageMatrix null with too few rows',
      chromDosageMatrix({ samples, windows: [win([0,0,0,0,0,0,0,0])] }) === null);

// autoSeedDosageInput — full bundle.
const input = autoSeedDosageInput({
  inversion: { _local_pca_dosage_state: { data } },
  shared: { activeCandidate: cand },
});
check('autoSeedDosageInput not null',            input !== null);
check('input has dosage + n_markers + n_samples',
      input.dosage && input.n_markers === 12 && input.n_samples === 8);
check('input has inv_idx + std_idx arrays',      Array.isArray(input.inv_idx) && Array.isArray(input.std_idx));
check('input is flagged auto_seeded',            input._auto_seeded === true);

// Returns null when no upstream data is available.
check('autoSeedDosageInput null without atlas state',
      autoSeedDosageInput(null) === null);

// =====================================================================
group('auto_seed_badge');

fakeDocument._clear();
const headerWrap = new FakeEl('div');
const lbl = new FakeEl('span');
headerWrap.appendChild(lbl);
// insertAdjacentElement polyfill for the test FakeEl.
lbl.insertAdjacentElement = (pos, node) => {
  if (pos === 'afterend' && lbl.parent) lbl.parent.children.push(node);
};
// Parent's querySelector needs to scan its own children for the chip class.
headerWrap.querySelector = (sel) => {
  if (sel === '.ev-autoseed-chip') {
    for (const c of headerWrap.children) {
      if (c.className === 'ev-autoseed-chip') return c;
    }
  }
  return null;
};
attachAutoSeedBadge(lbl);
check('badge attached as sibling',     headerWrap.children.length === 2);
const chip = headerWrap.children[1];
check('badge has chip class',          chip.className === 'ev-autoseed-chip');
check('badge text starts with ⓘ',      /^ⓘ/.test(chip.textContent));
check('badge has tooltip',             typeof chip.title === 'string' && chip.title.length > 20);
attachAutoSeedBadge(lbl);   // idempotent
check('attaching twice is idempotent', headerWrap.children.length === 2);

attachAutoSeedBadge(lbl, { text: 'demo' });
check('badge text overridable',        chip.textContent === 'ⓘ demo');

// detach
chip.remove = function () {
  const i = headerWrap.children.indexOf(this);
  if (i >= 0) headerWrap.children.splice(i, 1);
};
detachAutoSeedBadge(lbl);
check('badge detached',                headerWrap.children.length === 1);

// Null + missing-DOM safety.
attachAutoSeedBadge(null);
detachAutoSeedBadge(null);
check('null label is a no-op',         true);

// =====================================================================
group('canvas_axes');

// Mock canvas context that records what was called.
function makeCtx() {
  return {
    _calls: [],
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    font: '', textAlign: 'left', textBaseline: 'alphabetic',
    fillRect:    function () { this._calls.push('fillRect');    },
    strokeRect:  function () { this._calls.push('strokeRect');  },
    fillText:    function () { this._calls.push('fillText');    },
    beginPath:   function () {},
    stroke:      function () { this._calls.push('stroke');      },
    moveTo:      function () {},
    lineTo:      function () {},
    save:        function () {},
    restore:     function () {},
    translate:   function () {},
    rotate:      function () {},
    arc:         function () {},
    fill:        function () { this._calls.push('fill');        },
    clearRect:   function () {},
  };
}

const c = makeCtx();
paintCanvasAxes(c, {
  plot: { x: 60, y: 20, w: 300, h: 200 },
  xRange: [-2, 2],
  yRange: [0, 0.05],
  xLabel: 'PC1 (40%)',
  yLabel: 'PC2 (12%)',
  nXTicks: 4, nYTicks: 4,
});
check('paintCanvasAxes draws frame',       c._calls.includes('strokeRect'));
check('paintCanvasAxes paints tick labels', c._calls.filter(k => k === 'fillText').length >= 4);

const c2 = makeCtx();
paintMatrixLabels(c2, {
  plot: { x: 90, y: 50, w: 200, h: 200 },
  rowLabels: ['inv 0', 'inv 1', 'inv_with_a_very_long_label'],
  colLabels: ['inv 0', 'inv 1', 'inv 2'],
  maxChars: 8,
});
check('paintMatrixLabels writes labels',   c2._calls.filter(k => k === 'fillText').length >= 6);

const c3 = makeCtx();
paintLegend(c3, {
  origin: { x: 90, y: 280 },
  entries: [
    { label: 'nested',  color: '#3074C8' },
    { label: 'sister',  color: '#A060B8' },
  ],
});
check('paintLegend draws swatches', c3._calls.filter(k => k === 'fillRect').length === 2);
check('paintLegend writes labels',  c3._calls.filter(k => k === 'fillText').length === 2);

// Null safety.
paintCanvasAxes(null, {});
paintCanvasAxes(c, null);
paintMatrixLabels(null, {});
paintMatrixLabels(c, null);
paintLegend(null, {});
paintLegend(c, null);
check('canvas_axes helpers null-safe',     true);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
