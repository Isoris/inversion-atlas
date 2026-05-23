// tests/test_shared_inheritance_gather.js
//
// Unit coverage for shared/inheritance_gather.js — gather active
// candidate set for inheritance compute (legacy lines 41196-41245).

import * as G from '../atlases/popstats/shared/inheritance_gather.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('gatherActiveCandidatesForInheritance: basic');

const state = {
  k: 3,
  activeMode: 'default',
  candidates: {
    cA: { K: 3, start_bp: 5_000_000, end_bp: 6_000_000, locked_labels: [0, 1, 2], confirmed: true, source: 'manual' },
    cB: { K: 4, start_bp: 1_000_000, end_bp: 2_000_000, locked_labels: [0, 1, 2, 3], confirmed: true, source: 'merge' },
    cC: { K: 6, start_bp: 3_000_000, end_bp: 4_000_000, locked_labels: [0, 1, 2, 3, 4, 5], confirmed: true, source: 'l2_envelope' },
  },
};
const items = G.gatherActiveCandidatesForInheritance(state);
check('returns 3 items',                items.length === 3);
check('sorted by start_bp ascending',
      items[0].id === 'cB' && items[1].id === 'cC' && items[2].id === 'cA');
check('seq_num assigned 1..N',
      items[0].seq_num === 1 && items[2].seq_num === 3);
check('each item carries id + K + bp + labels',
      items.every(it => it.id && it.K && Number.isFinite(it.start_bp) && it.labels));
check('meta carries source',            items[0].meta.source === 'merge');

// -----------------------------------------------------------------------------
group('detailed mode');
const detailedState = {
  activeMode: 'detailed',
  candidates: { ignored: { K: 3, start_bp: 0, end_bp: 1, locked_labels: [0], confirmed: true } },
  candidates_detailed: {
    detA: { K: 3, start_bp: 100, end_bp: 200, locked_labels: [0, 1, 2], confirmed: true, source: 'detailed' },
  },
};
const detItems = G.gatherActiveCandidatesForInheritance(detailedState);
check('detailed mode reads candidates_detailed',
      detItems.length === 1 && detItems[0].id === 'detA');

// Override via opts.mode
const detOverride = G.gatherActiveCandidatesForInheritance(detailedState, { mode: 'default' });
check('opts.mode override switches to default candidates',
      detOverride.length === 1 && detOverride[0].id === 'ignored');

// -----------------------------------------------------------------------------
group('exclusions');
// Auto-promotion: source starts with 'auto_' AND not confirmed
const autoState = {
  candidates: {
    confirmed_auto: { K: 3, start_bp: 0, end_bp: 1, locked_labels: [0], confirmed: true, source: 'auto_l2_sweep' },
    unconfirmed_auto: { K: 3, start_bp: 0, end_bp: 1, locked_labels: [0], confirmed: false, source: 'auto_l2_sweep' },
    no_labels: { K: 3, start_bp: 0, end_bp: 1, locked_labels: [], confirmed: true, source: 'manual' },
    missing_labels: { K: 3, start_bp: 0, end_bp: 1, confirmed: true, source: 'manual' },
    no_start_bp: { K: 3, end_bp: 1, locked_labels: [0], confirmed: true, source: 'manual' },
    no_end_bp: { K: 3, start_bp: 0, locked_labels: [0], confirmed: true, source: 'manual' },
    valid: { K: 3, start_bp: 0, end_bp: 1, locked_labels: [0], confirmed: true, source: 'manual' },
    valid_unconfirmed_manual: { K: 3, start_bp: 0, end_bp: 1, locked_labels: [0], confirmed: false, source: 'manual' },
  },
};
const filtered = G.gatherActiveCandidatesForInheritance(autoState);
const ids = filtered.map(it => it.id).sort();
check('auto + unconfirmed dropped',     !ids.includes('unconfirmed_auto'));
check('confirmed auto kept',             ids.includes('confirmed_auto'));
check('empty labels dropped',           !ids.includes('no_labels'));
check('missing labels dropped',         !ids.includes('missing_labels'));
check('missing start_bp dropped',       !ids.includes('no_start_bp'));
check('missing end_bp dropped',         !ids.includes('no_end_bp'));
check('valid kept',                      ids.includes('valid'));
check('valid_unconfirmed_manual kept (auto-rule only filters auto_*)',
      ids.includes('valid_unconfirmed_manual'));

// -----------------------------------------------------------------------------
group('defaults');
// K fallback: candidate without K uses state.k
const sFallbackK = {
  k: 7,
  candidates: {
    c: { start_bp: 0, end_bp: 1, locked_labels: [0], confirmed: true, source: 'manual' },
  },
};
check('K falls back to state.k',
      G.gatherActiveCandidatesForInheritance(sFallbackK)[0].K === 7);

// opts.defaultK overrides state.k
check('opts.defaultK wins over state.k',
      G.gatherActiveCandidatesForInheritance(sFallbackK, { defaultK: 12 })[0].K === 12);

// Default K when state.k missing → 3
const noK = { candidates: { c: { start_bp: 0, end_bp: 1, locked_labels: [0], confirmed: true, source: 'manual' } } };
check('missing state.k → defaults to 3',
      G.gatherActiveCandidatesForInheritance(noK)[0].K === 3);

// -----------------------------------------------------------------------------
group('edge cases');
check('null state → []',                G.gatherActiveCandidatesForInheritance(null).length === 0);
check('no candidates → []',             G.gatherActiveCandidatesForInheritance({}).length === 0);
check('detailed mode w/o detailed map → []',
      G.gatherActiveCandidatesForInheritance({ activeMode: 'detailed' }).length === 0);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
