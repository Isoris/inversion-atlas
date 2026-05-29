// tests/test_shared_atlas_chrome.js
//
// Unit coverage for shared/atlas_chrome.js — generic atlas-chrome
// helpers (tab-stage-pill click handler + global-settings button
// wiring). Headless DOM polyfill (matching the convention from
// smoke_review_page_ancestry_scroller_round5.mjs).

import {
  wireTabStagePills,
  setActiveStageOn,
  getActiveStageOf,
  syncPillsToActivePage,
  wireGlobalSettingsBtn,
  bootstrapAtlasChrome,
} from '../atlases/inversion/shared/atlas_chrome.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
// FakeNode polyfill — minimal DOM, matches the convention used by
// the page-cartridge smoke tests. We only model what the chrome
// helpers actually use: attributes, querySelector{All}, event
// listeners, and a `.click()` method.
// =====================================================================

class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this._attrs = Object.create(null);
    this._listeners = Object.create(null);
    this._classes = new Set();
    this.children = [];
    this.parent = null;
    // For elements that also act as page buttons: a clickedCount we
    // can check in assertions.
    this.clickedCount = 0;
  }
  setAttribute(k, v) {
    this._attrs[k] = String(v);
    if (k === 'class') {
      this._classes = new Set(String(v).split(/\s+/).filter(Boolean));
    }
  }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; }
  removeAttribute(k) { delete this._attrs[k]; }
  addEventListener(evt, cb) {
    (this._listeners[evt] = this._listeners[evt] || []).push(cb);
  }
  removeEventListener(evt, cb) {
    const list = this._listeners[evt] || [];
    const idx = list.indexOf(cb);
    if (idx >= 0) list.splice(idx, 1);
  }
  click() {
    this.clickedCount++;
    const list = this._listeners.click || [];
    for (const cb of list) cb({ target: this });
  }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  get classList() { return this._classes; }
  set className(s) { this.setAttribute('class', s); }
  get className() { return this.getAttribute('class') || ''; }

  // querySelector / querySelectorAll — minimal subset:
  //   - tag name only (e.g. 'button')
  //   - '.className'
  //   - 'button[data-page]', 'button[data-page][data-stage="X"]'
  //   - 'button[data-page].active'
  querySelectorAll(sel) {
    const out = [];
    this._walk((n) => { if (_matches(n, sel)) out.push(n); });
    return out;
  }
  querySelector(sel) {
    let out = null;
    this._walk((n) => {
      if (out) return;
      if (_matches(n, sel)) out = n;
    });
    return out;
  }
  _walk(fn) {
    for (const c of this.children) { fn(c); c._walk(fn); }
  }
}

function _matches(n, sel) {
  // simple selectors only — good enough for the chrome helpers
  if (!sel) return false;
  if (sel === n.tag) return true;
  if (sel.startsWith('.')) return n._classes.has(sel.slice(1));
  // 'button[data-page]'
  let m = sel.match(/^([a-z]+)\[([a-z-]+)\]$/);
  if (m) {
    return n.tag === m[1] && n._attrs[m[2]] !== undefined;
  }
  // 'button[data-page][data-stage="X"]'
  m = sel.match(/^([a-z]+)\[([a-z-]+)\]\[([a-z-]+)="([^"]+)"\]$/);
  if (m) {
    return n.tag === m[1] && n._attrs[m[2]] !== undefined && n._attrs[m[3]] === m[4];
  }
  // 'button[data-page].active'
  m = sel.match(/^([a-z]+)\[([a-z-]+)\]\.([a-z]+)$/);
  if (m) {
    return n.tag === m[1] && n._attrs[m[2]] !== undefined && n._classes.has(m[3]);
  }
  // '.tab-stage-pill'
  if (sel.startsWith('.')) return n._classes.has(sel.slice(1));
  return false;
}

// LocalStorage polyfill for the settings-btn persistence path.
global.localStorage = {
  _store: Object.create(null),
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._store, k) ? this._store[k] : null; },
  setItem(k, v) { this._store[k] = String(v); },
  removeItem(k) { delete this._store[k]; },
};

// CSS polyfill (the chrome helper uses CSS.escape when available; we
// leave it undefined so the helper's fallback kicks in).

// =====================================================================
// Build a fixture tab bar.
// =====================================================================

function buildTabBar() {
  const tabBar = new FakeNode('nav');
  tabBar.setAttribute('id', 'tabBar');
  tabBar.setAttribute('data-active-stage', 'discovery');
  // 3 stage pills + 6 page buttons (2 per stage)
  for (const stage of ['discovery', 'classification', 'help']) {
    const pill = new FakeNode('button');
    pill.setAttribute('class', 'tab-stage-pill');
    pill.setAttribute('data-stage', stage);
    if (stage === 'discovery') pill.setAttribute('data-expanded', '1');
    tabBar.appendChild(pill);
  }
  // Page buttons
  for (const [page, stage] of [
    ['local_pca_dosage', 'discovery'], ['candidate_focus', 'discovery'],
    ['karyotype_tier', 'classification'], ['popstats', 'classification'],
    ['help', 'help'], ['page_help2', 'help'],
  ]) {
    const btn = new FakeNode('button');
    btn.setAttribute('data-page', page);
    btn.setAttribute('data-stage', stage);
    if (page === 'local_pca_dosage') btn.setAttribute('class', 'active');
    tabBar.appendChild(btn);
  }
  return tabBar;
}

// =====================================================================
group('wireTabStagePills — click handler attaches and toggles state');

const tabBar = buildTabBar();
const result = wireTabStagePills(tabBar);
check('result has teardown',       typeof result.teardown === 'function');
check('result has setActiveStage', typeof result.setActiveStage === 'function');

// Click the "classification" pill.
const classificationPill = tabBar.querySelectorAll('.tab-stage-pill')[1];
check('found classification pill', classificationPill && classificationPill.getAttribute('data-stage') === 'classification');
classificationPill.click();

check('tabBar data-active-stage = classification',
      tabBar.getAttribute('data-active-stage') === 'classification');
check('discovery pill loses data-expanded',
      tabBar.querySelectorAll('.tab-stage-pill')[0].getAttribute('data-expanded') == null);
check('classification pill gains data-expanded',
      classificationPill.getAttribute('data-expanded') === '1');

// First page button in classification stage should have been clicked.
const karyotype_tier = tabBar.querySelectorAll('button[data-page]').find(
  b => b.getAttribute('data-page') === 'karyotype_tier'
);
check('first classification page button clicked',
      karyotype_tier && karyotype_tier.clickedCount >= 1);

// =====================================================================
group('wireTabStagePills — idempotent (no double-fire on re-wire)');

const tabBar2 = buildTabBar();
wireTabStagePills(tabBar2);
wireTabStagePills(tabBar2);   // re-wire should replace, not stack
const cl2 = tabBar2.querySelectorAll('.tab-stage-pill')[1];
cl2.click();
// First classification page button should have been clicked exactly
// once per pill click, not 2x (would happen if handlers stacked).
const page4_2 = tabBar2.querySelectorAll('button[data-page]').find(
  b => b.getAttribute('data-page') === 'karyotype_tier'
);
check('re-wire is idempotent (single click → single page click)',
      page4_2 && page4_2.clickedCount === 1);

// =====================================================================
group('setActiveStageOn — programmatic stage switch');

const tabBar3 = buildTabBar();
wireTabStagePills(tabBar3);
setActiveStageOn(tabBar3, 'help');
check('data-active-stage = help',           tabBar3.getAttribute('data-active-stage') === 'help');
check('help pill is now expanded',
      tabBar3.querySelectorAll('.tab-stage-pill')
        .find(p => p.getAttribute('data-stage') === 'help')
        .getAttribute('data-expanded') === '1');
check('discovery pill no longer expanded',
      tabBar3.querySelectorAll('.tab-stage-pill')
        .find(p => p.getAttribute('data-stage') === 'discovery')
        .getAttribute('data-expanded') == null);

// =====================================================================
group('getActiveStageOf');

check('returns current active stage', getActiveStageOf(tabBar3) === 'help');
check('returns null for null root',   getActiveStageOf(null) === null);

// =====================================================================
group('syncPillsToActivePage — pill follows the active page');

const tabBar4 = buildTabBar();
// Strip default expanded, then mark a classification page as active.
const classificationPill4 = tabBar4.querySelectorAll('.tab-stage-pill')[1];
classificationPill4.removeAttribute('data-expanded');
tabBar4.querySelectorAll('.tab-stage-pill')[0].removeAttribute('data-expanded');
tabBar4.querySelectorAll('button[data-page]')[0]._classes.delete('active');
const page4_4 = tabBar4.querySelectorAll('button[data-page]')
  .find(b => b.getAttribute('data-page') === 'karyotype_tier');
page4_4.setAttribute('class', 'active');
page4_4._classes.add('active');

syncPillsToActivePage(tabBar4);
check('synced stage = classification',          tabBar4.getAttribute('data-active-stage') === 'classification');
check('classification pill expanded after sync', classificationPill4.getAttribute('data-expanded') === '1');

// =====================================================================
group('wireTabStagePills — teardown removes handlers');

const tabBar5 = buildTabBar();
const r = wireTabStagePills(tabBar5);
r.teardown();
const pill5 = tabBar5.querySelectorAll('.tab-stage-pill')[1];
pill5.click();
check('after teardown: data-active-stage unchanged',
      tabBar5.getAttribute('data-active-stage') === 'discovery');

// =====================================================================
group('wireTabStagePills — onStageChange callback');

const tabBar6 = buildTabBar();
const changes = [];
wireTabStagePills(tabBar6, { onStageChange: (s) => changes.push(s) });
tabBar6.querySelectorAll('.tab-stage-pill')[2].click();
check('onStageChange called with new stage', changes.length === 1 && changes[0] === 'help');

// =====================================================================
group('wireTabStagePills — null root tolerance');

const noop = wireTabStagePills(null);
check('null root: returns noop teardown + setActiveStage',
      typeof noop.teardown === 'function' && typeof noop.setActiveStage === 'function');
// Should not throw:
noop.teardown();
noop.setActiveStage('help');
check('null root: noop calls do not throw', true);

// =====================================================================
group('wireGlobalSettingsBtn — toggle + persistence');

const btn = new FakeNode('button');
const wrap = new FakeNode('div');
// Clear localStorage between tests.
delete global.localStorage._store['atlas_chrome.sidebar'];

const s = wireGlobalSettingsBtn(btn, wrap, { storageKey: 'atlas_chrome.sidebar' });
check('default sidebar = expanded',  wrap.getAttribute('data-sidebar') === 'expanded');
btn.click();
check('click 1: sidebar = collapsed',  wrap.getAttribute('data-sidebar') === 'collapsed');
check('persisted to localStorage',     global.localStorage._store['atlas_chrome.sidebar'] === 'collapsed');
btn.click();
check('click 2: sidebar = floating',   wrap.getAttribute('data-sidebar') === 'floating');
check('floating persisted',            global.localStorage._store['atlas_chrome.sidebar'] === 'floating');
btn.click();
check('click 3 (wrap): sidebar = expanded', wrap.getAttribute('data-sidebar') === 'expanded');

// Restore from localStorage on next wire.
global.localStorage._store['atlas_chrome.sidebar'] = 'collapsed';
const btn2 = new FakeNode('button');
const wrap2 = new FakeNode('div');
wireGlobalSettingsBtn(btn2, wrap2);
check('restores persisted state (collapsed)',
      wrap2.getAttribute('data-sidebar') === 'collapsed');

// onToggle callback
const toggles = [];
const btn3 = new FakeNode('button');
const wrap3 = new FakeNode('div');
delete global.localStorage._store['atlas_chrome.sidebar'];
wireGlobalSettingsBtn(btn3, wrap3, { onToggle: (st) => toggles.push(st) });
btn3.click();
check('onToggle fired with next state', toggles.length === 1 && toggles[0] === 'collapsed');

// Teardown
const btn4 = new FakeNode('button');
const wrap4 = new FakeNode('div');
delete global.localStorage._store['atlas_chrome.sidebar'];
const r4 = wireGlobalSettingsBtn(btn4, wrap4);
const beforeTeardown = wrap4.getAttribute('data-sidebar');
r4.teardown();
btn4.click();
check('after teardown: state did not change',
      wrap4.getAttribute('data-sidebar') === beforeTeardown);

// Programmatic setSidebar
const btn5 = new FakeNode('button');
const wrap5 = new FakeNode('div');
const r5 = wireGlobalSettingsBtn(btn5, wrap5);
r5.setSidebar('collapsed');
check('programmatic setSidebar: collapsed', wrap5.getAttribute('data-sidebar') === 'collapsed');
r5.setSidebar('floating');
check('programmatic setSidebar: floating',  wrap5.getAttribute('data-sidebar') === 'floating');
r5.setSidebar('expanded');
check('programmatic setSidebar: expanded',  wrap5.getAttribute('data-sidebar') === 'expanded');
r5.setSidebar('not_a_state');   // ignored
check('invalid state: ignored',             wrap5.getAttribute('data-sidebar') === 'expanded');

// Button reflects state via data-state + glyph.
const btn6 = new FakeNode('button');
const wrap6 = new FakeNode('div');
delete global.localStorage._store['atlas_chrome.sidebar'];
const r6 = wireGlobalSettingsBtn(btn6, wrap6);
check('button data-state: expanded',         btn6.getAttribute('data-state') === 'expanded');
btn6.click();
check('after click: button data-state = collapsed',  btn6.getAttribute('data-state') === 'collapsed');
btn6.click();
check('after click: button data-state = floating',   btn6.getAttribute('data-state') === 'floating');

// =====================================================================
group('bootstrapAtlasChrome — one-call wiring');

const tabBar7 = buildTabBar();
const btn7 = new FakeNode('button');
const wrap7 = new FakeNode('div');
delete global.localStorage._store['atlas_chrome.sidebar'];
const boot = bootstrapAtlasChrome({
  tabBar: tabBar7,
  globalSettingsBtn: btn7,
  wrap: wrap7,
});
check('returns { teardown, chrome }',
      typeof boot.teardown === 'function'
   && boot.chrome && boot.chrome.pills && boot.chrome.settings);
// Auto-synced pill to the active page (local_pca_dosage in fixture → discovery).
check('pills synced to active page on bootstrap',
      tabBar7.getAttribute('data-active-stage') === 'discovery');
// Settings btn works.
btn7.click();
check('bootstrap: settings btn toggles',  wrap7.getAttribute('data-sidebar') === 'collapsed');
// Combined teardown.
boot.teardown();
const dpill7 = tabBar7.querySelectorAll('.tab-stage-pill')[1];
dpill7.click();
check('bootstrap teardown: pill click no-op', tabBar7.getAttribute('data-active-stage') === 'discovery');

// =====================================================================
group('atlas_chrome.css covers every manifest-declared stage');

// Regression guard for the "tabs are a complete mess" bug. The
// folding rule needs ONE selector per `data-active-stage="X"` value
// that any manifest declares; missing rules silently kept every page
// button from every stage visible when that stage was active.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const CHROME_CSS = join(REPO_ROOT, 'atlases', 'inversion', 'shared', 'atlas_chrome.css');

const cssText = existsSync(CHROME_CSS) ? readFileSync(CHROME_CSS, 'utf8') : '';

// Collect every stage value any manifest declares.
const ATLASES_DIR = join(REPO_ROOT, 'atlases');
const stageSet = new Set();
if (existsSync(ATLASES_DIR)) {
  for (const atlas of readdirSync(ATLASES_DIR)) {
    const mf = join(ATLASES_DIR, atlas, 'manifest.json');
    if (!existsSync(mf)) continue;
    try {
      const m = JSON.parse(readFileSync(mf, 'utf8'));
      const pages = Array.isArray(m && m.pages) ? m.pages : [];
      for (const p of pages) {
        if (p && typeof p.stage === 'string' && p.stage) stageSet.add(p.stage);
      }
    } catch (_) {}
  }
}
check('discovered ≥1 stage from manifests', stageSet.size >= 1);

for (const stage of stageSet) {
  const fold   = cssText.indexOf(`#tabBar[data-active-stage="${stage}"]`)         >= 0;
  const pillEx = cssText.indexOf(`.tab-stage-pill[data-stage="${stage}"][data-expanded="1"]`) >= 0;
  const hue    = cssText.indexOf(`--atlas-stage-hue-${stage}:`)                    >= 0;
  check(`stage "${stage}" has folding rule`,        fold);
  check(`stage "${stage}" has expanded-pill rule`,  pillEx);
  check(`stage "${stage}" has hue token`,           hue);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
