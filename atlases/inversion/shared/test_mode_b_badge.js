// Smoke tests for the inversion-atlas Mode-B helper module
// (core/mode_b_badge.js).
//
// Mirrors the structure of the diversity-atlas test but exercises the
// inversion-specific call shapes:
//   - opts.context propagates into the badge text (chrom / candidate id)
//   - extractRows maps an object payload to an entries-style row array
//     (candidate_lineage.versions is a map, not an array)
//
// Run from the inversion-atlas root:
//   node atlases/inversion/shared/test_mode_b_badge.js
import {
  probeModeB, renderModeBBadge, distinctCount,
} from '../../../core/mode_b_badge.js';

// ----- fake DOM ---------------------------------------------------------
// 2026-05-20: extended for the click-to-expand-card wiring renderModeBBadge
// now installs on first render (see diversity-atlas's matching test for the
// shared fake-DOM rationale).
const _domElements = new Map();
function _makeSlot(id) {
  const attrs = {};
  const el = {
    id,
    className: '',
    textContent: '',
    title: '',
    dataset: {},
    style: {},
    _handlers: {},
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k)    { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
    addEventListener(type, fn) { (this._handlers[type] ||= []).push(fn); },
    removeEventListener(type, fn) {
      const list = this._handlers[type];
      if (!list) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
  };
  _domElements.set(id, el);
  return el;
}
globalThis.document = {
  getElementById(id) { return _domElements.get(id) || null; },
};

function ok(cond, msg) {
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`  ok: ${msg}`);
}

// ----- test 1: scrubber_main-style probe (windows + samples) -----------
console.log('scrubber_main-shape payload → ● live badge with context:');
{
  _domElements.clear();
  _makeSlot('lpdModeBBadge');
  const payload = {
    chrom: 'C_gar_LG28',
    windows: Array.from({ length: 1893 }, (_, i) => ({ start: i * 50000 })),
    samples: Array.from({ length: 226 }, (_, i) => `CGA${i}`),
  };
  const registry = { resolve: () => payload };
  const probe = await probeModeB(registry, 'scrubber_main', { chrom: 'C_gar_LG28' }, {
    extractRows: (p) => (p && Array.isArray(p.windows)) ? p.windows : null,
  });
  renderModeBBadge('lpdModeBBadge', probe, {
    label:    'discovery axes',
    layerKey: 'scrubber_main',
    context:  'C_gar_LG28',
    compare:  (r) => ({
      pass: r.n === 1893 && r.payload.samples.length === 226,
      summary: `${r.n} windows · ${r.payload.samples.length} samples`,
    }),
  });
  const slot = document.getElementById('lpdModeBBadge');
  ok(slot.className === 'data-source-badge live', 'live class');
  ok(slot.textContent.includes('C_gar_LG28'),       'context (chrom) in text');
  ok(slot.textContent.includes('1893 windows'),     'window count in text');
  ok(slot.textContent.includes('226 samples'),      'sample count in text');
}

// ----- test 2: candidate_lineage map → array projection ----------------
console.log('candidate_lineage map payload → entries-style rows:');
{
  _domElements.clear();
  _makeSlot('cfModeBBadge');
  const payload = {
    candidate_id:       'ALPHA01',
    active_version_id:  'v2_theta_refined',
    status:             'active',
    versions: {
      'v1_initial':         { status: 'deprecated', created_at: '2026-04-01' },
      'v2_theta_refined':   { status: 'active',     refined_at: '2026-04-15' },
    },
  };
  const registry = { resolve: () => payload };
  const probe = await probeModeB(registry, 'candidate_lineage', { candidate_id: 'ALPHA01' }, {
    extractRows: (p) => {
      if (!p || !p.versions || typeof p.versions !== 'object') return null;
      return Object.entries(p.versions).map(([version_id, meta]) =>
        Object.assign({ version_id }, meta || {}));
    },
  });
  ok(probe.ok === true,        'probe ok');
  ok(probe.n === 2,            'extracted 2 version entries from the map');
  ok(probe.rows[0].version_id, 'rows carry version_id from the map key');
  ok(distinctCount(probe.rows, 'status') === 2,
                               'distinctCount works across the projected rows');
  renderModeBBadge('cfModeBBadge', probe, {
    label:    'candidate lineage',
    layerKey: 'candidate_lineage',
    context:  'ALPHA01',
    compare:  (r) => ({
      pass: !!r.payload.active_version_id && r.n >= 1,
      summary: `${r.n} versions · active = ${r.payload.active_version_id}`,
    }),
  });
  const slot = document.getElementById('cfModeBBadge');
  ok(slot.className === 'data-source-badge live', 'live class');
  ok(slot.textContent.includes('ALPHA01'),         'context (candidate_id) in text');
  ok(slot.textContent.includes('active = v2_theta_refined'), 'active version surfaced');
}

// ----- test 3: registry not injected → ○ unavailable ------------------
console.log('registry not injected → demo badge:');
{
  _domElements.clear();
  _makeSlot('lpdModeBBadge');
  const probe = await probeModeB(undefined, 'scrubber_main', { chrom: 'C_gar_LG28' });
  renderModeBBadge('lpdModeBBadge', probe, {
    label: 'discovery axes', layerKey: 'scrubber_main', context: 'C_gar_LG28',
  });
  const slot = document.getElementById('lpdModeBBadge');
  ok(slot.className === 'data-source-badge demo', 'demo class');
  ok(slot.textContent.includes('standalone'),      'hint mentions standalone mode');
  ok(slot.textContent.includes('C_gar_LG28'),       'context still in text on failure');
}

console.log('\nALL OK');
