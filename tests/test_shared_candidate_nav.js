// tests/test_shared_candidate_nav.js
//
// Unit coverage for shared/candidate_nav.js — the cross-page inline
// candidate-navigation bar used by pages 4/6/7/11 (legacy lines
// 58552-58590 + 59653-59745).
//
// Covers:
//   - candidateListSortedByPos: sort by start_bp asc, optional confirmed-only filter
//   - candidateListIndexOf: id lookup
//   - candidateListClosestIndex: midpoint fallback
//   - navStateFor: posLabel + prev/next target + disabled flags + off-list
//   - buildCandidateNavHtml: HTML escape + idPrefix namespacing
//   - renderCandidateNavInline: DOM element creation + wired onNavigate /
//     onClearActive callbacks; idempotent against missing document

import * as NAV from '../atlases/inversion/shared/candidate_nav.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('candidateListSortedByPos');
const sUnsorted = {
  candidateList: [
    { id: 'c3', start_bp: 5_000_000, confirmed: true },
    { id: 'c1', start_bp: 1_000_000, confirmed: false },
    { id: 'c2', start_bp: 3_000_000, confirmed: true },
  ],
};
const sorted = NAV.candidateListSortedByPos(sUnsorted);
check('sorts ascending',                sorted.map(c => c.id).join(',') === 'c1,c2,c3');
check('does not mutate original list',
      sUnsorted.candidateList[0].id === 'c3');

// confirmed-only mode
const sConf = Object.assign({}, sUnsorted, { candidatePageMode: 'confirmed' });
const confOnly = NAV.candidateListSortedByPos(sConf);
check('confirmed mode: 2 entries',      confOnly.length === 2);
check('confirmed mode: drops c1',       !confOnly.some(c => c.id === 'c1'));

// Empty / nullish
check('no list → []',                   NAV.candidateListSortedByPos({}).length === 0);
check('null state → []',                NAV.candidateListSortedByPos(null).length === 0);

// Nullish start_bp sorts last
const sBad = {
  candidateList: [
    { id: 'a', start_bp: 5 },
    { id: 'b' },  // no start_bp
    { id: 'c', start_bp: 1 },
  ],
};
const badSorted = NAV.candidateListSortedByPos(sBad);
check('null start_bp sorts last',       badSorted[badSorted.length - 1].id === 'b');

// -----------------------------------------------------------------------------
group('candidateListIndexOf');
check('finds c2 at idx 1',              NAV.candidateListIndexOf(sUnsorted, { id: 'c2' }) === 1);
check('not found → -1',                 NAV.candidateListIndexOf(sUnsorted, { id: 'c99' }) === -1);
check('null candidate → -1',            NAV.candidateListIndexOf(sUnsorted, null) === -1);

// -----------------------------------------------------------------------------
group('candidateListClosestIndex');
const sMid = {
  candidateList: [
    { id: 'a', start_bp: 100, end_bp: 200 },
    { id: 'b', start_bp: 300, end_bp: 400 },
    { id: 'c', start_bp: 800, end_bp: 900 },
  ],
};
check('mid 250 → idx 0 (a midpoint 150)',
      NAV.candidateListClosestIndex(sMid, { start_bp: 200, end_bp: 300 }) === 0);
check('mid 350 → idx 1 (b midpoint 350)',
      NAV.candidateListClosestIndex(sMid, { start_bp: 300, end_bp: 400 }) === 1);
check('mid 1000 → idx 2 (c midpoint 850)',
      NAV.candidateListClosestIndex(sMid, { start_bp: 950, end_bp: 1050 }) === 2);
check('no candidate → -1',              NAV.candidateListClosestIndex(sMid, null) === -1);
check('empty list → -1',                NAV.candidateListClosestIndex({}, { start_bp: 0, end_bp: 1 }) === -1);

// -----------------------------------------------------------------------------
group('navStateFor');
// No active candidate
const noActive = NAV.navStateFor({ candidateList: sMid.candidateList });
check('no active: posLabel = whole genome', noActive.posLabel === 'whole genome view');
check('no active: prev + next disabled when no list... wait list exists',
      noActive.prevTarget && noActive.prevTarget.id === 'a');
check('no active: nextTarget set',      noActive.nextTarget && noActive.nextTarget.id === 'c');

// Active = first
const sFirst = Object.assign({}, sMid, { candidate: { id: 'a' } });
const nFirst = NAV.navStateFor(sFirst);
check('first active: posLabel "1 / 3"',  nFirst.posLabel === 'candidate 1 / 3');
check('first active: prev disabled',     nFirst.prevDisabled === true);
check('first active: next NOT disabled', nFirst.nextDisabled === false);
check('first active: nextTarget = b',    nFirst.nextTarget.id === 'b');

// Active = middle
const sMidActive = Object.assign({}, sMid, { candidate: { id: 'b' } });
const nMid = NAV.navStateFor(sMidActive);
check('middle: prev not disabled',       nMid.prevDisabled === false);
check('middle: next not disabled',       nMid.nextDisabled === false);
check('middle: prevTarget = a',          nMid.prevTarget.id === 'a');
check('middle: nextTarget = c',          nMid.nextTarget.id === 'c');

// Active = last
const sLast = Object.assign({}, sMid, { candidate: { id: 'c' } });
const nLast = NAV.navStateFor(sLast);
check('last: next disabled',             nLast.nextDisabled === true);
check('last: prev NOT disabled',         nLast.prevDisabled === false);

// Off-list candidate
const sOff = Object.assign({}, sMid, { candidate: { id: 'zzz', start_bp: 250, end_bp: 350 } });
const nOff = NAV.navStateFor(sOff);
check('off-list: posLabel "off-list"',   nOff.posLabel === 'candidate (off-list)');
check('off-list: off flag true',         nOff.offList === true);

// Empty list, no active
const nEmpty = NAV.navStateFor({});
check('empty: prev disabled',            nEmpty.prevDisabled === true);
check('empty: next disabled',            nEmpty.nextDisabled === true);

// -----------------------------------------------------------------------------
group('buildCandidateNavHtml');
const html1 = NAV.buildCandidateNavHtml(sFirst, { idPrefix: 'bnd' });
check('html: bndNavPrev id',             html1.includes('id="bndNavPrev"'));
check('html: bndNavNext id',             html1.includes('id="bndNavNext"'));
check('html: bndNavGenome id',           html1.includes('id="bndNavGenome"'));
check('html: posLabel rendered',         html1.includes('candidate 1 / 3'));
check('html: prev disabled attr',        html1.includes('disabled title="Previous'));
check('html: active id shown',           html1.includes('>a</span>'));

const htmlNoActive = NAV.buildCandidateNavHtml({ candidateList: [] });
check('html: "no candidate selected" hint',
      htmlNoActive.includes('no candidate selected'));

// HTML escape
const htmlEsc = NAV.buildCandidateNavHtml({
  candidateList: [{ id: '<bad>', start_bp: 0 }],
  candidate: { id: '<bad>' },
});
check('html: escapes < in id',           htmlEsc.includes('&lt;bad&gt;'));
check('html: does not output raw <bad>', !htmlEsc.includes('>(<bad>)<'));

// Default prefix
const htmlDef = NAV.buildCandidateNavHtml(sFirst);
check('html: default prefix "cand"',     htmlDef.includes('id="candNavPrev"'));

// -----------------------------------------------------------------------------
// DOM mocks
// -----------------------------------------------------------------------------

class FakeNode {
  constructor(id, tag) {
    this.id = id; this.tagName = tag || 'div';
    this.innerHTML = ''; this.textContent = '';
    this.style = { cssText: '' }; this.value = ''; this._listeners = {};
    this.children = []; this._attrs = {}; this.className = '';
    this._htmlIdMap = new Map();
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
  fire(evt, payload) { (this._listeners[evt] || []).forEach(cb => cb(payload || {})); }
  // Parse innerHTML for #ids and produce per-id child nodes lazily on
  // querySelector. Good enough for our test (the nav bar uses ids only).
  querySelector(sel) {
    if (typeof sel !== 'string' || !sel.startsWith('#')) return null;
    const id = sel.slice(1);
    if (this._htmlIdMap.has(id)) return this._htmlIdMap.get(id);
    if (this.innerHTML && this.innerHTML.includes('id="' + id + '"')) {
      const child = new FakeNode(id, 'button');
      this._htmlIdMap.set(id, child);
      return child;
    }
    return null;
  }
}

global.document = {
  body: new FakeNode('body'),
  createElement: (tag) => new FakeNode('<' + tag + '>', tag),
};
global.window = global;

// -----------------------------------------------------------------------------
group('renderCandidateNavInline');
const sR = {
  candidateList: [
    { id: 'p', start_bp: 100 }, { id: 'q', start_bp: 200 }, { id: 'r', start_bp: 300 },
  ],
  candidate: { id: 'q' },
};
let navTarget = null;
let clearedFor = null;
const bar = NAV.renderCandidateNavInline(sR, {
  idPrefix: 'tst',
  onNavigate:    (_, t) => { navTarget = t.id; },
  onClearActive: ()    => { clearedFor = 'cleared'; },
});
check('returns a node',                  !!bar);
check('node.className',                  bar.className === 'cand-nav-inline');
// 2026-05-20: cssText assertion retired — styling is now class-based
// (rules live under .cand-nav-inline in inversion.css), no inline styles
// on the bar or its children.
check('node.innerHTML populated',        bar.innerHTML.length > 0);
check('innerHTML has tstNavPrev id',     bar.innerHTML.includes('id="tstNavPrev"'));
check('innerHTML has cnav-btn class',    bar.innerHTML.includes('class="cnav-btn"'));

// Click prev → onNavigate fires with target p
const prevBtn = bar.querySelector('#tstNavPrev');
prevBtn.fire('click', {});
check('prev click: navTarget = p',       navTarget === 'p');

// Click next → onNavigate fires with target r
const nextBtn = bar.querySelector('#tstNavNext');
nextBtn.fire('click', {});
check('next click: navTarget = r',       navTarget === 'r');

// Click genome → onClearActive fires
const genomeBtn = bar.querySelector('#tstNavGenome');
genomeBtn.fire('click', {});
check('genome click: cleared',           clearedFor === 'cleared');

// Disabled prev when active = first: clicking doesn't navigate
const sFA = Object.assign({}, sR, { candidate: { id: 'p' } });
let firstNavTarget = null;
const barFirst = NAV.renderCandidateNavInline(sFA, {
  idPrefix: 'fa', onNavigate: (_, t) => { firstNavTarget = t.id; },
});
const prevBtnDisabled = barFirst.querySelector('#faNavPrev');
prevBtnDisabled.fire('click', {});
check('disabled prev: onNavigate NOT fired (sequenced gating)', firstNavTarget === null);

// No callbacks → no throw
const barNoCb = NAV.renderCandidateNavInline(sR, { idPrefix: 'nc' });
const prevNoCb = barNoCb.querySelector('#ncNavPrev');
let noCbOK = true;
try { prevNoCb.fire('click', {}); } catch (_) { noCbOK = false; }
check('no callbacks: click no-throw',    noCbOK);

// -----------------------------------------------------------------------------
group('Headless tolerance');
const savedDoc = global.document;
delete global.document;
check('renderCandidateNavInline → null w/o document',
      NAV.renderCandidateNavInline(sR) === null);
// Pure helpers still work without document
check('navStateFor still works headless',
      typeof NAV.navStateFor(sR).posLabel === 'string');
check('buildCandidateNavHtml still works headless',
      typeof NAV.buildCandidateNavHtml(sR) === 'string');
global.document = savedDoc;

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
