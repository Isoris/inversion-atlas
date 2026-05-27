// tests/test_classification_candidate_regimes.js
//
// Smoke test for the new candidate_regimes page (Part A of the
// haplotype_regimes audit, 2026-05-27). Verifies module loads,
// exports mount/unmount, and mount(null, ...) degrades cleanly
// without a chromosome selected. Does NOT exercise the full
// pipeline run — that needs a DOM + chrom data the test harness
// doesn't have.

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// Minimal DOM: just enough for setStatus to no-op cleanly + for the
// router-style mount sequence to run through.
class FakeNode {
  constructor() {
    this.style = {};
    this.children = [];
    this.innerHTML = '';
    this.textContent = '';
    this.dataset = {};
    this._listeners = {};
  }
  querySelector(_) { return null; }
  querySelectorAll(_) { return []; }
  addEventListener(evt, cb) { (this._listeners[evt] = this._listeners[evt] || []).push(cb); }
  removeEventListener() {}
  appendChild(c) { this.children.push(c); }
  setAttribute() {}
  getAttribute() { return null; }
}
globalThis.document = {
  body: new FakeNode(),
  getElementById: () => null,
  createElement: () => new FakeNode(),
  querySelector: () => null,
};
globalThis.window = globalThis;
globalThis.localStorage = {
  _store: {},
  getItem(k) { return this._store[k] || null; },
  setItem(k, v) { this._store[k] = String(v); },
  removeItem(k) { delete this._store[k]; },
};

const page = await import('../atlases/inversion/pages/classification/candidate_regimes.js');

// =====================================================================
group('Module surface');

check('exports mount',    typeof page.mount   === 'function');
check('exports unmount',  typeof page.unmount === 'function');
check('mount is async',   page.mount.constructor.name === 'AsyncFunction');
check('unmount is async', page.unmount.constructor.name === 'AsyncFunction');

// =====================================================================
group('mount() with no activeChrom degrades cleanly');

const root = new FakeNode();
const atlasState = { inversion: {}, shared: {} };
const registry = { resolve: async () => null };

let mountThrew = false;
let mountErr = null;
try { await page.mount(root, atlasState, registry); }
catch (e) { mountThrew = true; mountErr = e; }
check('mount() does not throw when activeChrom is null',
      !mountThrew, mountErr && mountErr.message);

// Should not have called registry.resolve since no chrom.
// (we can't easily inspect; just verify mount completed without exception)

// =====================================================================
group('unmount() runs cleanly');

let unmountThrew = false;
try { await page.unmount(root); }
catch (e) { unmountThrew = true; }
check('unmount() does not throw',  !unmountThrew);

// =====================================================================
group('mount() with activeChrom but failing registry');

const root2 = new FakeNode();
const atlasState2 = {
  inversion: {},
  shared: { activeChrom: 'LG28' },
};
const registry2 = { resolve: async () => { throw new Error('mock-fail'); } };

let mount2Threw = false;
try { await page.mount(root2, atlasState2, registry2); }
catch (e) { mount2Threw = true; }
check('mount() catches registry.resolve errors internally',
      !mount2Threw);

// =====================================================================
group('mount() with activeChrom + minimal chrom precomp');

const fakeData = {
  chrom: 'LG28',
  n_windows: 4,
  n_samples: 6,
  samples: [
    { id: 'A' }, { id: 'B' }, { id: 'C' },
    { id: 'D' }, { id: 'E' }, { id: 'F' },
  ],
  windows: [
    { pc1: Float32Array.from([-1, -1, 0, 0, 1, 1]) },
    { pc1: Float32Array.from([-1, -1, 0, 0, 1, 1]) },
    { pc1: Float32Array.from([-1, -1, 0, 0, 1, 1]) },
    { pc1: Float32Array.from([-1, -1, 0, 0, 1, 1]) },
  ],
  l2_envelopes: [],
};
const root3 = new FakeNode();
const atlasState3 = {
  inversion: {},
  shared: { activeChrom: 'LG28' },
};
const registry3 = { resolve: async () => fakeData };

let mount3Threw = false;
let mount3Err = null;
try { await page.mount(root3, atlasState3, registry3); }
catch (e) { mount3Threw = true; mount3Err = e; }
check('mount() with valid chrom data does not throw',
      !mount3Threw, mount3Err && mount3Err.message);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
