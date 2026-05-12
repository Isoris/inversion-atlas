// tests/test_shared_pc_accessors.js
//
// Unit coverage for shared/pc_accessors.js — per-window PC accessors
// + viewControls persistence (legacy lines 9951-10043).

import * as PA from '../atlases/inversion/shared/pc_accessors.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

function _makeLS() {
  const store = {};
  return {
    getItem: (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}

// -----------------------------------------------------------------------------
group('PC_AXES');
check('frozen + 4 entries',
      Object.isFrozen(PA.PC_AXES) && PA.PC_AXES.length === 4);
check('contains pc1..pc4',
      ['pc1','pc2','pc3','pc4'].every(k => PA.PC_AXES.includes(k)));

// -----------------------------------------------------------------------------
group('getPC');
const state = {
  flipPC1: true,
  pc1Sign: [1, -1, 1],
  data: {
    windows: [
      { pc1: [0.1, 0.2, 0.3], pc2: [0.4, 0.5, 0.6] },
      { pc1: [0.7, 0.8, 0.9], pc2: [1.0, 1.1, 1.2] },
      { pc1: [1.3, 1.4, 1.5], pc2: [1.6, 1.7, 1.8] },
    ],
  },
};
const w0 = PA.getPC(state, 0);
check('returns pc1 + pc2 + sign',  w0.pc1 && w0.pc2 && typeof w0.sign === 'number');
check('sign +1 at index 0',         w0.sign === 1);
check('sign -1 at index 1 (flipped)', PA.getPC(state, 1).sign === -1);

// No state.flipPC1 → sign always 1
const stateNoFlip = Object.assign({}, state, { flipPC1: false });
check('flipPC1=false → sign always 1',  PA.getPC(stateNoFlip, 1).sign === 1);

// Null / missing
check('null state → null',          PA.getPC(null, 0) === null);
check('no data → null',              PA.getPC({}, 0) === null);
check('out-of-range winIdx → null',  PA.getPC(state, 99) === null);

// -----------------------------------------------------------------------------
group('availablePCs');
check('empty data → [pc1, pc2]',
      PA.availablePCs({}).join(',') === 'pc1,pc2');
check('null state → [pc1, pc2]',
      PA.availablePCs(null).join(',') === 'pc1,pc2');

const state3PC = {
  data: { windows: [{ pc1: [1], pc2: [1], pc3: [1] }] },
};
check('PC3 detected',
      PA.availablePCs(state3PC).join(',') === 'pc1,pc2,pc3');

const state4PC = {
  data: { windows: [{ pc1: [1], pc2: [1], pc3: [1], pc4: [1] }] },
};
check('PC4 detected',
      PA.availablePCs(state4PC).join(',') === 'pc1,pc2,pc3,pc4');

// Only PC1 in data — defensive fallback adds PC2
const statePC1Only = {
  data: { windows: [{ pc1: [1] }] },
};
check('PC1-only data: defensive fallback to [pc1, pc2]',
      PA.availablePCs(statePC1Only).join(',') === 'pc1,pc2');

// -----------------------------------------------------------------------------
group('getPCByAxis');
check('pc1 returned',           Array.isArray(PA.getPCByAxis(state, 0, 'pc1')));
check('pc2 returned',           Array.isArray(PA.getPCByAxis(state, 0, 'pc2')));
check('missing axis → null',    PA.getPCByAxis(state, 0, 'pc3') === null);
check('out-of-range → null',    PA.getPCByAxis(state, 99, 'pc1') === null);
check('null state → null',      PA.getPCByAxis(null, 0, 'pc1') === null);

// -----------------------------------------------------------------------------
group('getPCRender');
const r0 = PA.getPCRender(state, 0, 'pc1', 'pc2');
check('returns x + y + signX + signY + axisX + axisY',
      r0.x && r0.y && r0.signX === 1 && r0.signY === 1
        && r0.axisX === 'pc1' && r0.axisY === 'pc2');

// Sign-flip applies to PC1 only
const r1 = PA.getPCRender(state, 1, 'pc1', 'pc2');
check('PC1 at flipped window: signX = -1',  r1.signX === -1);
check('PC2 never flipped: signY = 1',       r1.signY === 1);

// PC2 as X axis: no flip even when state.flipPC1=true
const r2 = PA.getPCRender(state, 1, 'pc2', 'pc1');
check('PC2 as X: signX = 1',  r2.signX === 1);
check('PC1 as Y at flipped window: signY = -1',  r2.signY === -1);

// Default axes when omitted
const rDefault = PA.getPCRender(state, 0);
check('default axes pc1×pc2',
      rDefault.axisX === 'pc1' && rDefault.axisY === 'pc2');

// -----------------------------------------------------------------------------
group('saveViewControls + loadViewControls');
const ls = _makeLS();
const sSave = {
  viewControls: {
    pcaXY: ['pc1', 'pc3'],
    linesYsources: ['snp_density', 'pca'],
    linked: true,
  },
};
PA.saveViewControls(sSave, { localStorage: ls });
check('LS write happened',
      ls.getItem(PA.VIEW_CONTROLS_STORAGE_KEY) !== null);

const sLoad = { viewControls: {} };
PA.loadViewControls(sLoad, { localStorage: ls });
check('pcaXY restored',           sLoad.viewControls.pcaXY.join(',') === 'pc1,pc3');
check('linesYsources restored',
      sLoad.viewControls.linesYsources.join(',') === 'snp_density,pca');
check('linked restored',          sLoad.viewControls.linked === true);

// Save with no viewControls: no-op
let safeSave = true;
try { PA.saveViewControls({}, { localStorage: ls }); } catch (_) { safeSave = false; }
check('save no viewControls: no-throw',  safeSave);

// Corrupt LS entry: load silent fallback
const lsBad = _makeLS();
lsBad.setItem(PA.VIEW_CONTROLS_STORAGE_KEY, 'not-json{');
const sBad = { viewControls: { pcaXY: ['pc1', 'pc2'] } };
PA.loadViewControls(sBad, { localStorage: lsBad });
check('corrupt LS: pcaXY unchanged',
      sBad.viewControls.pcaXY.join(',') === 'pc1,pc2');

// Invalid pcaXY shape (same axis twice) ignored
const lsBadShape = _makeLS();
lsBadShape.setItem(PA.VIEW_CONTROLS_STORAGE_KEY,
                   JSON.stringify({ pcaXY: ['pc1', 'pc1'] }));
const sBadShape = { viewControls: { pcaXY: ['pc1', 'pc2'] } };
PA.loadViewControls(sBadShape, { localStorage: lsBadShape });
check('duplicate pcaXY axes ignored',
      sBadShape.viewControls.pcaXY.join(',') === 'pc1,pc2');

// -----------------------------------------------------------------------------
group('reconcileViewControlsForData');
// Available PCs: pc1, pc2 only. viewControls.pcaXY references PC3 — should reset.
const sRecon = {
  data: { windows: [{ pc1: [1], pc2: [1] }] },
  viewControls: { pcaXY: ['pc1', 'pc3'] },
};
PA.reconcileViewControlsForData(sRecon);
check('PC3 not available: reset to [pc1, pc2]',
      sRecon.viewControls.pcaXY.join(',') === 'pc1,pc2');

// All-valid: untouched
const sValid = {
  data: { windows: [{ pc1: [1], pc2: [1], pc3: [1] }] },
  viewControls: { pcaXY: ['pc2', 'pc3'] },
};
PA.reconcileViewControlsForData(sValid);
check('all-valid pcaXY untouched',
      sValid.viewControls.pcaXY.join(',') === 'pc2,pc3');

// Null state: no-throw
let safeRecon = true;
try { PA.reconcileViewControlsForData(null); } catch (_) { safeRecon = false; }
check('null state: no-throw',  safeRecon);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
