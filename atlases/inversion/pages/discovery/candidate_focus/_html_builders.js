// pages/discovery/candidate_focus/_html_builders.js
//
// HTML-builder sub-module for candidate_focus (chat 36 round 5 step 2, 2026-05-07).
// 16 functions that return strings: the candidate-detail page composes
// these into a single innerHTML write in renderCandidateMetadata.
//
// All bodies extracted byte-verbatim from legacy/Inversion_atlas.html.
// Bodies that read bare `state` get `const state = _pageState;` injected
// as their first statement (local_pca_dosage round 4 shim pattern). The shim is
// active because candidate_focus.js's entry points (renderCandidateMetadata,
// wireCandidateNav, mount) call _setActiveState(state) on entry —
// ES module live-binding means this module sees the active state
// reference automatically.
//
// Cross-module refs:
//   - candidateNavHtml uses candidateListIndexOf, candidateListSortedByPos
//     from ./_list.js.
//   - All bodies use _pageState from ./_state.js.

import { _pageState } from './_state.js';
import { candidateListIndexOf, candidateListSortedByPos, isInCandidateList } from './_list.js';
import { _esc, _fmt4, _fmtP, groupColor } from '../../../shared/page1_data_helpers.js';
// 2026-05-26: previously called as a global from the legacy monolith; the
// ES-module port left it dangling — every candidate render logged
// "loadHaplotypeLabels is not defined". Wire the existing module.
import { loadHaplotypeLabels } from '../../../shared/haplotype_labels.js';

// 2026-05-26: ported from legacy/Inversion_atlas.html ports lines 14187 +
// 58222. Both are short and pure; keeping them local to this file avoids
// a new shared module for two callers. If a 3rd caller appears, promote.

export function _candidateL2Ids(c) {
  if (!c) return [];
  const out = new Set();
  if (Array.isArray(c.l2_ids)) {
    for (const id of c.l2_ids) if (id) out.add(id);
  }
  const state = _pageState;
  if (Array.isArray(c.l2_indices) && state && state.data && Array.isArray(state.data.l2_envelopes)) {
    for (const li of c.l2_indices) {
      const env = state.data.l2_envelopes[li];
      if (env && env.candidate_id) out.add(env.candidate_id);
    }
  }
  return Array.from(out);
}

function _ancGetGlobalQ(stateData) {
  const L = stateData && stateData.ancestry_q_global;
  if (!L || !Array.isArray(L.samples) || !Array.isArray(L.q)) return null;
  return { K: L.K, samples: L.samples, q: L.q,
           source: 'q_global.tsv (genome-wide, all chroms)' };
}

// ---------------------------------------------------------------------------
// Module-private constants (extracted from legacy)
// ---------------------------------------------------------------------------

// _BLOCK_DISPLAY_ORDER — legacy line 58681. Used by candidateBlockChipsHtml
// to render the 18-block chip row (SCHEMA §21).
const _BLOCK_DISPLAY_ORDER = [
  // Existence
  { bt: 'existence_layer_a',    label: 'A',     group: 'exist' },
  { bt: 'existence_layer_b',    label: 'B',     group: 'exist' },
  { bt: 'existence_layer_c',    label: 'C',     group: 'exist' },
  { bt: 'existence_layer_d',    label: 'D',     group: 'exist' },
  // Boundaries
  { bt: 'boundary_left',        label: 'bp L',  group: 'bound' },
  { bt: 'boundary_right',       label: 'bp R',  group: 'bound' },
  // Carrier reconciliation
  { bt: 'carrier_reconciliation', label: 'carriers', group: 'carry' },
  // Internal dynamics
  { bt: 'internal_dynamics',    label: 'internal', group: 'intern' },
  // Mechanism
  { bt: 'mechanism',            label: 'mechanism', group: 'mech' },
  // Age
  { bt: 'age_evidence',         label: 'age',   group: 'age' },
  // Frequency + hypothesis
  { bt: 'frequency',            label: 'freq',  group: 'freq' },
  { bt: 'hypothesis_verdict',   label: 'verdict', group: 'verdict' },
  // Morphology + composition
  { bt: 'morphology',           label: 'morph', group: 'sup' },
  { bt: 'band_composition',     label: 'bands', group: 'sup' },
  // Burden
  { bt: 'burden',               label: 'burden', group: 'burden' },
  // Supportive
  { bt: 'block_detect',         label: 'block', group: 'sup' },
  { bt: 'triangle_insulation',  label: '△ insul', group: 'sup' },
  { bt: 'peel_diagnostic',      label: 'peel',  group: 'sup' },
  { bt: 'synteny_dollo',        label: 'synteny', group: 'sup' },
  // Synthesis (always last)
  { bt: 'final_classification', label: '★ final', group: 'synth' },
];

// Which blocks contribute axes vs supportive-only. Mirrors SCHEMA §21.6.
// Used inside candidateBlockChipsHtml to grey-out axis-only chips.
const _BLOCKS_WITH_AXIS_DERIVATION = new Set([
  'existence_layer_a', 'existence_layer_b', 'existence_layer_c', 'existence_layer_d',
  'boundary_left', 'boundary_right',         // contribute via reconciliation
  'carrier_reconciliation',
  'internal_dynamics',
  'mechanism',
  'age_evidence',
  'frequency',
  'hypothesis_verdict',
  'burden',
]);

// _CAND_STORAGE_PREFIX, _BLOCK_DISPLAY_ORDER etc. live above. The dosage
// heatmap panel needs its own state initializer (candidate_focus-private).

// DOSAGE_HEATMAP_DEFAULTS — legacy line 15613. Used by _ensureDosageHmState.
const DOSAGE_HEATMAP_DEFAULTS = {
  MISSING_THRESHOLD: 0.20,    // drop markers with > 20% missing
  DEFAULT_CAP: 200,
  HARD_CAP: 500,
  WINDOW_RADIUS: 5,           // ±5 windows in cursor-bound mode
  MAX_CHUNK_CACHE: 50,        // LRU cap for dosage chunks
  DEBOUNCE_MS: 150,
};

// _ensureDosageHmState — legacy line 16795 (candidate_focus-private). Lazy-init
// state.__dosageHm; used by candidateDosageHeatmapHtml + the wire.
function _ensureDosageHmState() {
  const state = _pageState;
  if (!state.__dosageHm) {
    state.__dosageHm = {
      mode: null, candidate_id: null,
      cap_n: DOSAGE_HEATMAP_DEFAULTS.DEFAULT_CAP,
      last_region_key: null, pending_fetch: null, debounce_handle: null,
      last_chunk: null, last_sq: null, show_cursor: false,
      hover_static: { last_cell: null, raf_handle: null },
      hover_cursor: { last_cell: null, raf_handle: null },
    };
  }
  return state.__dosageHm;
}

// ---------------------------------------------------------------------------
// HTML builders
// ---------------------------------------------------------------------------

// --- candidateNavHtml — extracted from legacy ---
export function candidateNavHtml(c) {
  const state = _pageState;
  const sorted = candidateListSortedByPos();
  const idx = candidateListIndexOf(c);
  const inList = idx >= 0;
  const total = sorted.length;
  const isConfirmedMode = state.candidatePageMode === 'confirmed';
  const positionLabel = inList
    ? `${idx + 1} / ${total}`
    : (total > 0 ? `(unsaved) of ${total}` : '(unsaved, list empty)');
  const prevDisabled = total === 0 || (inList && idx === 0);
  const nextDisabled = total === 0 || (inList && idx === total - 1);
  const confirmed = !!c.confirmed;
  // v3.56: in confirmed mode show a mode badge so the user understands the
  // navigation is filtered to confirmed-only.
  const modeBadge = isConfirmedMode
    ? `<span style="background: var(--good); color: #0e1116; padding: 2px 8px;
         border-radius: 12px; font-family: var(--mono); font-size: 10px;
         font-weight: 600; letter-spacing: 0.04em;">CONFIRMED ONLY</span>`
    : '';
  return `
    <div class="cand-section" style="display: flex; align-items: center; gap: 12px; padding: 10px 14px;
                                       background: var(--panel-2); border: 1px solid var(--rule);
                                       border-radius: 4px; margin-bottom: 14px;">
      ${modeBadge}
      <button id="candNavPrev" ${prevDisabled ? 'disabled' : ''}
              title="Previous candidate by genomic position (Left arrow)"
              style="background: var(--panel); border: 1px solid var(--rule); color: var(--ink);
                     border-radius: 3px; padding: 6px 14px; font-family: var(--mono); font-size: 12px;
                     cursor: ${prevDisabled ? 'default' : 'pointer'}; opacity: ${prevDisabled ? 0.4 : 1};">
        ‹  prev
      </button>
      <span style="font-family: var(--mono); font-size: 11px; color: var(--ink-dim);
                   min-width: 110px; text-align: center;">
        candidate ${positionLabel}
      </span>
      <button id="candNavNext" ${nextDisabled ? 'disabled' : ''}
              title="Next candidate by genomic position (Right arrow)"
              style="background: var(--panel); border: 1px solid var(--rule); color: var(--ink);
                     border-radius: 3px; padding: 6px 14px; font-family: var(--mono); font-size: 12px;
                     cursor: ${nextDisabled ? 'default' : 'pointer'}; opacity: ${nextDisabled ? 0.4 : 1};">
        next  ›
      </button>
      <div style="flex: 1;"></div>
      <!-- 2026-05-20 (SPEC_haplotype_burden_coloring.md Phase 1 deliverable #3):
           per-candidate group-label export. Emits a TSV joining
           sample_id × macrostripe_id × microgroup_id × stability_score
           so downstream R / pandas can test burden differences between
           trajectory-defined haplotype groups. Per the SPEC's stated
           weekly goal — "make sure the atlas can export the group labels
           cleanly. That is enough." — burden columns ship in Phase 2. -->
      <button id="candExportGroupLabelsBtn"
              title="Export per-sample group labels (sample_id × macrostripe_id × microgroup_id × stability_score) for this candidate as a TSV. Columns the producer hasn't computed yet are left blank."
              style="background: var(--panel); border: 1px solid var(--rule); color: var(--ink-dim);
                     border-radius: 3px; padding: 6px 10px; font-family: var(--mono);
                     font-size: 11.5px; cursor: pointer;">
        📊 export group labels
      </button>
      <button id="candConfirmedToggle" title="Mark this candidate as confirmed (visible on the confirmed tab)"
              style="background: ${confirmed ? 'var(--good)' : 'var(--panel)'};
                     color: ${confirmed ? '#0e1116' : 'var(--ink-dim)'};
                     border: 1px solid ${confirmed ? 'var(--good)' : 'var(--rule)'};
                     border-radius: 3px; padding: 6px 12px; font-family: var(--mono);
                     font-size: 12px; cursor: pointer; font-weight: ${confirmed ? '600' : '400'};">
        ${confirmed ? '✓ confirmed' : '☐ mark confirmed'}
      </button>
    </div>
  `;
}

// --- candidateHeaderHtml — extracted from legacy ---
export function candidateHeaderHtml(c) {
  const state = _pageState;
  const span_mb = (c.end_bp - c.start_bp) / 1e6;
  // Object-literal values are eagerly evaluated, so we have to guard the
  // l2_indices access for candidates that don't carry it (e.g. test fixtures
  // or candidates promoted from external sources without a merge history).
  const nL2 = (c.l2_indices && c.l2_indices.length) || 0;
  // 2026-05-20: extended source label map. Each `source` tag emits a
  // short human-readable phrase + a coloured chip via .src-chip-* CSS
  // classes (see inversion.css). The chip lets the user tell at a
  // glance whether a candidate came from a manual draft, the L2-sweep
  // auto-promoter, the V-walker seed-promote, the L3-pair merge, or
  // the Cramér's V auto-merge (per SPEC_cramers_v_seed_merge.md
  // Phase 1 deliverable #3).
  const sourceLabelMap = {
    'l2_single':                  'single L2 (from catalogue)',
    'l2_merge':                   `${nL2} L2s merged (from catalogue L1 view)`,
    'lock_promote':               'locked colors on diagnostic page',
    'seed_promote':               'V-walker seed → promote',
    'l3_pair_merge':              'L3 adjacent-pair Cramér merge',
    'auto_l2_sweep':              'auto: L2-sweep (inheritance)',
    'auto_cramers_v_local':       'auto: Cramér V · insulated_local',
    'auto_cramers_v_macrostripe': 'auto: Cramér V · post_long_range',
  };
  const sourceLabel = sourceLabelMap[c.source] || c.source;
  const sourceChipClass = `src-chip src-chip-${(c.source || 'unknown').replace(/[^a-z0-9_]/g, '_')}`;
  const refEnv = state.data && state.data.l2_envelopes
    ? state.data.l2_envelopes[c.ref_l2] : null;
  const refId = refEnv ? (refEnv.candidate_id || `L2_${c.ref_l2}`) : `L2_${c.ref_l2}`;
  // Per-band sample counts
  let bandCounts = '';
  if (c.locked_labels) {
    const counts = new Array(c.K).fill(0);
    for (let i = 0; i < c.locked_labels.length; i++) {
      const k = c.locked_labels[i];
      if (k >= 0 && k < c.K) counts[k]++;
    }
    bandCounts = counts.map((n, k) => {
      const sw = `<span style="display:inline-block;width:9px;height:9px;border-radius:1px;background:${groupColor(k)};vertical-align:middle;margin-right:4px;"></span>`;
      return `<span style="display:inline-block;margin-right:14px;">${sw}band ${k}: <b>${n}</b></span>`;
    }).join('');
  }
  // v4 turn 24: lead with display name (LG28.15-16Mb.A) in the eyebrow
  // header. The h3 stays informative (chrom + Mb range with bp precision)
  // but the display name is the primary identifier.
  const dispName = (typeof _candidateDisplayName === 'function')
    ? _candidateDisplayName(c) : (c.id || '?');
  const internalId = c.id || c.candidate_id || '';
  return `
    <div class="cand-section">
      <div class="cand-eyebrow">candidate · <b style="color:var(--ink);">${dispName}</b>
        <span class="cand-internal-id" title="Internal candidate ID (used in exports, regime registry, JSON saves). The display name above is derived from chrom + Mb range and is purely cosmetic.">${internalId}</span>
      </div>
      <h3 class="cand-h3">${c.chrom} · ${(c.start_bp/1e6).toFixed(2)}–${(c.end_bp/1e6).toFixed(2)} Mb
        <span style="font-size:13px;color:var(--ink-dim);font-weight:400;">(${span_mb.toFixed(2)} Mb span, ${c.end_w - c.start_w + 1} windows)</span>
      </h3>
      <div class="cand-meta-row">
        <div><span>source:</span><span class="${sourceChipClass}" title="Candidate provenance — where this candidate was created.">${sourceLabel}</span></div>
        <div><span>L2 indices:</span>[${(c.l2_indices || []).join(', ')}]</div>
        <div><span>reference L2:</span>${refId} (idx ${c.ref_l2})</div>
        <div><span>reference window:</span>${c.ref_window}</div>
        <div><span>K (bands):</span>${c.K}</div>
        <div style="margin-top:6px;"><span>band sample counts:</span>${bandCounts}</div>
      </div>
      <div class="cand-actions">
        <button id="candidateJumpBtn">↩ jump to reference window in diagnostic</button>
        <button id="candidateLockBtn">🔒 apply candidate's bands as color lock</button>
        <button id="candidateDosageHeatmapBtn"
                title="Open the dosage heatmap page for this candidate (sample × marker dosage matrix with K=3 group track + polarity stripe + role-pair sidecar). Page shows an empty state when no dosage payload is loaded — drag-drop the candidate's mgl_heatmap_json or dosage_chunk JSON to populate.">📊 dosage heatmap</button>
        <button id="candidateListToggleBtn">${isInCandidateList(c.id) ? '☆ remove from saved list' : '★ add to saved list'}</button>
        <button id="candidateClearBtn" class="danger">✕ clear candidate</button>
      </div>
    </div>
  `;
}

// --- candidateBlockChipsHtml — extracted from legacy ---
export function candidateBlockChipsHtml(c) {
  const state = _pageState;
  if (!c) return '';
  const cid = c.id || (c.ref_l2 != null ? `ref_l2_${c.ref_l2}` : null);
  if (!cid) return '';

  const blocks = (state.data && state.data.evidence_blocks &&
                  state.data.evidence_blocks[cid]) || {};
  const totalKnown = _BLOCK_DISPLAY_ORDER.length;
  const loaded = _BLOCK_DISPLAY_ORDER.filter(e => blocks[e.bt] != null).length;

  // Group spacers — gap between groups for visual sectioning
  const chipsHtml = _BLOCK_DISPLAY_ORDER.map((entry, i) => {
    const has = blocks[entry.bt] != null;
    const isSynthesis = entry.bt === 'final_classification' || entry.bt === 'classification';
    const isAxisContrib = _BLOCKS_WITH_AXIS_DERIVATION.has(entry.bt);
    // Determine chip color: gold for synthesis · green if loaded + axis · blue if loaded supportive · grey if missing
    let bg, fg, border;
    if (!has) {
      bg = 'transparent';
      fg = 'var(--ink-dimmer)';
      border = 'var(--rule)';
    } else if (isSynthesis) {
      bg = 'rgba(245,165,36,0.18)';
      fg = 'var(--ink)';
      border = 'rgba(245,165,36,0.85)';
    } else if (isAxisContrib) {
      bg = 'rgba(34,160,80,0.18)';
      fg = 'var(--ink)';
      border = 'rgba(34,160,80,0.85)';
    } else {
      bg = 'rgba(48,116,200,0.15)';
      fg = 'var(--ink)';
      border = 'rgba(48,116,200,0.65)';
    }
    // Group divider — small left-margin between groups (visual sectioning)
    const prev = _BLOCK_DISPLAY_ORDER[i - 1];
    const groupChange = prev && prev.group !== entry.group;
    const ml = groupChange ? '8px' : '2px';
    const tooltipFresh = has
      ? `${entry.bt} loaded · click to inspect raw JSON`
      : `${entry.bt} not loaded for this candidate · drop the corresponding structured/${entry.bt}.json file via 📦 load registry on page 4`;
    return `<button type="button"
              class="cand-block-chip"
              data-block-type="${entry.bt}"
              data-cid="${cid}"
              data-has="${has ? '1' : '0'}"
              title="${tooltipFresh}"
              style="background: ${bg}; color: ${fg};
                     border: 1px solid ${border}; border-radius: 3px;
                     padding: 3px 8px; font-family: var(--mono);
                     font-size: 10.5px; font-weight: ${has ? '600' : '400'};
                     cursor: ${has ? 'pointer' : 'default'};
                     margin-left: ${ml};
                     opacity: ${has ? '1' : '0.55'};
                     letter-spacing: 0.02em; white-space: nowrap;">${entry.label}</button>`;
  }).join('');

  // Lead label + summary count — informative for non-experts
  return `
    <div class="cand-section">
      <div class="cand-eyebrow">structured blocks · SCHEMA §21</div>
      <div style="display: flex; align-items: center; flex-wrap: wrap;
                  gap: 0; padding: 8px 10px; background: var(--panel-2);
                  border: 1px solid var(--rule); border-radius: 4px;
                  margin-bottom: 12px;">
        <span style="font-family: var(--mono); font-size: 10.5px;
                     color: var(--ink-dim); margin-right: 8px;">
          <b style="color: var(--ink);">${loaded}</b>/${totalKnown} loaded:
        </span>
        ${chipsHtml}
        <span style="font-family: var(--mono); font-size: 10px;
                     color: var(--ink-dimmer); margin-left: auto; padding-left: 12px;">
          ${loaded > 0 ? 'click a chip to inspect raw JSON' : 'load via 📦 on page 4'}
        </span>
      </div>
      <div id="candBlockInspectors" style="margin-bottom: 12px;"></div>
    </div>
  `;
}

// --- candidateLocMiniHtml — extracted from legacy line 59024 (candidate_focus-private support) ---
// --- candidatePanelStubHtml — extracted from legacy line 59036 (candidate_focus-private support) ---
function candidateLocMiniHtml(kind, title, canvasId) {
  return `
    <div style="display: flex; flex-direction: column; gap: 4px;">
      <div style="font-family: var(--mono); font-size: 10px; color: var(--ink-dim);
                  text-transform: uppercase; letter-spacing: 0.05em;">${title}</div>
      <canvas id="${canvasId}"
              style="display: block; width: 100%; height: 60px;
                     background: var(--panel); border: 1px solid var(--rule); border-radius: 3px;"></canvas>
    </div>
  `;
}
function candidatePanelStubHtml({id, title, subtitle, dataReady, dataNote}) {
  const statusCol = dataReady ? 'var(--good)' : 'var(--ink-dim)';
  const statusLbl = dataReady ? '✓ data ready' : '✗ needs pipeline data';
  return `
    <div id="${id}"
         style="background: var(--panel-2); border: 1px solid var(--rule); border-radius: 4px;
                padding: 12px; min-height: 140px; display: flex; flex-direction: column;">
      <div style="display: flex; justify-content: space-between; align-items: baseline;">
        <div>
          <div style="font-family: var(--mono); font-size: 11.5px; font-weight: 600;
                      color: var(--ink);">${title}</div>
          <div style="font-family: var(--mono); font-size: 10px; color: var(--ink-dim);
                      margin-top: 2px;">${subtitle}</div>
        </div>
        <div style="font-family: var(--mono); font-size: 9.5px; color: ${statusCol};
                    white-space: nowrap; padding-left: 12px;">${statusLbl}</div>
      </div>
      <div style="flex: 1; display: flex; align-items: center; justify-content: center;
                  margin-top: 10px; color: var(--ink-dimmer); font-family: var(--mono);
                  font-size: 10.5px; text-align: center; line-height: 1.4;">
        ${dataNote}
      </div>
    </div>
  `;
}

// --- candidateRichCardHtml — extracted from legacy ---
export function candidateRichCardHtml(c) {
  const state = _pageState;
  const ghslReady = !!(state.data && state.data.ghsl_panel);
  return `
    <div class="cand-section">
      <div class="cand-eyebrow">candidate focus</div>
      <h4 class="cand-h4">location overview</h4>
      <div id="candLocationStrip"
           style="display: grid; grid-template-columns: 2fr 1.5fr 1fr; gap: 10px;
                  margin: 8px 0 16px; padding: 10px;
                  background: var(--panel-2); border: 1px solid var(--rule); border-radius: 4px;">
        ${candidateLocMiniHtml('simdat',    'simdat snapshot',  'cand-mini-simdat')}
        ${candidateLocMiniHtml('l1',        'L1 envelope',      'cand-mini-l1')}
        ${candidateLocMiniHtml('karyo',     'karyogram',        'cand-mini-karyo')}
      </div>

      <h4 class="cand-h4" style="margin-top: 18px;">analysis panels</h4>

      <!-- Local PCA full-width -->
      <div id="cp-localpca"
           style="background: var(--panel-2); border: 1px solid var(--rule); border-radius: 4px;
                  padding: 12px; margin-top: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: baseline;
                    margin-bottom: 8px;">
          <div>
            <div style="font-family: var(--mono); font-size: 11.5px; font-weight: 600; color: var(--ink);">
              Local PCA</div>
            <div style="font-family: var(--mono); font-size: 10px; color: var(--ink-dim); margin-top: 2px;">
              mean PC1 vs mean PC2 across candidate windows · colored by locked labels</div>
          </div>
          <div style="font-family: var(--mono); font-size: 9.5px; color: var(--good);">✓ live</div>
        </div>
        <canvas id="cp-localpca-canvas"
                style="display: block; width: 100%; height: 200px; background: var(--panel);
                       border: 1px solid var(--rule); border-radius: 3px; cursor: crosshair;"></canvas>
      </div>

      <!-- PC1 lines full-width -->
      <div id="cp-lines"
           style="background: var(--panel-2); border: 1px solid var(--rule); border-radius: 4px;
                  padding: 12px; margin-top: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: baseline;
                    margin-bottom: 8px;">
          <div>
            <div style="font-family: var(--mono); font-size: 11.5px; font-weight: 600; color: var(--ink);">
              PC1 track per sample</div>
            <div style="font-family: var(--mono); font-size: 10px; color: var(--ink-dim); margin-top: 2px;">
              one line per sample, x = window position within candidate · y = sign-aligned PC1</div>
          </div>
          <div style="font-family: var(--mono); font-size: 9.5px; color: var(--good);">✓ live</div>
        </div>
        <canvas id="cp-lines-canvas"
                style="display: block; width: 100%; height: 110px; background: var(--panel);
                       border: 1px solid var(--rule); border-radius: 3px;"></canvas>
      </div>

      <!-- GHSL per band full-width -->
      <div id="cp-ghsl"
           style="background: var(--panel-2); border: 1px solid var(--rule); border-radius: 4px;
                  padding: 12px; margin-top: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: baseline;
                    margin-bottom: 8px;">
          <div>
            <div style="font-family: var(--mono); font-size: 11.5px; font-weight: 600; color: var(--ink);">
              GHSL per band</div>
            <div style="font-family: var(--mono); font-size: 10px; color: var(--ink-dim); margin-top: 2px;">
              within-sample haplotype similarity grouped by locked band · primary scale</div>
          </div>
          <div style="font-family: var(--mono); font-size: 9.5px; color: ${ghslReady ? 'var(--good)' : 'var(--ink-dim)'};">
            ${ghslReady ? '✓ live' : '✗ no GHSL JSON loaded'}
          </div>
        </div>
        <div id="cp-ghsl-bands" style="display: grid; gap: 8px; min-height: 100px;
                                          ${ghslReady ? '' : 'align-items: center; justify-content: center;'}
                                          color: var(--ink-dimmer); font-family: var(--mono); font-size: 10.5px;">
          ${ghslReady ? '' : 'Load a GHSL JSON for this chromosome to populate this panel.'}
        </div>
      </div>

      <!-- Popgen placeholder grid (still pipeline-blocked) -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 10px;">
        ${candidatePanelStubHtml({
          id: 'cp-theta',
          title: 'θ per band',
          subtitle: 'nucleotide diversity per K-means cluster',
          dataReady: false,
          dataNote: 'needs --track_theta_per_band from C++ pop-stats engine (LANTA)',
        })}
        ${candidatePanelStubHtml({
          id: 'cp-het',
          title: 'heterozygosity per band',
          subtitle: 'mean per-sample H grouped by band',
          dataReady: false,
          dataNote: 'needs --track_h_persample from pop-stats engine',
        })}
        ${candidatePanelStubHtml({
          id: 'cp-fst',
          title: 'Fst Hom1 vs Hom2',
          subtitle: 'between-arrangement Fst (excludes het band)',
          dataReady: false,
          dataNote: 'needs --track_fst_K1K3 (with K1=Hom1, K3=Hom2) from pop-stats engine',
        })}
        ${candidatePanelStubHtml({
          id: 'cp-thetapi',
          title: 'θπ IVGT',
          subtitle: 'pairwise diversity for inverted vs standard arrangements',
          dataReady: false,
          dataNote: 'needs --track_pi_arrangement from pop-stats engine',
        })}
      </div>
    </div>
  `;
}

// --- candidateSummaryHtml — extracted from legacy ---
export function candidateSummaryHtml(c, profile, bands) {
  if (!c) return '';
  const span_mb = (c.end_bp - c.start_bp) / 1e6;
  // Per-band sample counts
  const counts = new Array(c.K).fill(0);
  if (c.locked_labels) {
    for (let i = 0; i < c.locked_labels.length; i++) {
      const k = c.locked_labels[i];
      if (k >= 0 && k < c.K) counts[k]++;
    }
  }
  const total = counts.reduce((a, b) => a + b, 0);
  // K-band breakdown as ratio string ("75 / 76 / 75")
  const bandSplit = counts.join(' / ');
  // Find largest band and its top family
  const largestBandIdx = counts.indexOf(Math.max(...counts));
  let topFamLargest = 'n/a', topFamLargestPct = 0;
  if (bands && bands[largestBandIdx]) {
    const b = bands[largestBandIdx];
    if (b.families.length > 0 && b.n > 0) {
      const top = b.families[0];
      topFamLargest = top.family_id === 'unknown' ? 'unknown' : `F${top.family_id}`;
      topFamLargestPct = Math.round((top.n / b.n) * 100);
    }
  }
  // Coherence proxy: max top-family fraction across bands (higher = more family-LD-ish)
  let maxFamFrac = 0;
  if (bands) {
    for (const b of bands) {
      if (b.families.length > 0 && b.n > 0) {
        const frac = b.families[0].n / b.n;
        if (frac > maxFamFrac) maxFamFrac = frac;
      }
    }
  }
  const coherenceLabel = maxFamFrac > 0.85
    ? `<span style="color:var(--bad);">${(maxFamFrac*100).toFixed(0)}% (likely family LD)</span>`
    : maxFamFrac > 0.6
      ? `<span style="color:var(--accent);">${(maxFamFrac*100).toFixed(0)}% (mixed)</span>`
      : `<span style="color:var(--good);">${(maxFamFrac*100).toFixed(0)}% (looks biological)</span>`;
  // Verdict
  const verdict = profile ? profile.verdict : 'NA';
  const verdictClass = verdict.toLowerCase();
  // Drifters
  const drifterText = profile
    ? `${profile.n_high} (${(profile.ratio_high*100).toFixed(0)}%)`
    : 'n/a';
  // Source
  const nL2src = (c.l2_indices && c.l2_indices.length) || 0;
  // 2026-05-20: extended short labels — keep concise for the summary
  // grid where horizontal space is tight. See candidateHeaderHtml for
  // the long-form labels + colour chip rationale.
  const sourceLabelShortMap = {
    'l2_single':                  'single L2',
    'l2_merge':                   `${nL2src} L2s merged`,
    'lock_promote':               'locked colors',
    'seed_promote':               'V-walker seed',
    'l3_pair_merge':              'L3-pair merge',
    'auto_l2_sweep':              'auto · L2-sweep',
    'auto_cramers_v_local':       'auto · V local',
    'auto_cramers_v_macrostripe': 'auto · V macrostripe',
  };
  const sourceLabel = sourceLabelShortMap[c.source] || c.source;
  const sourceChipClassShort = `src-chip src-chip-${(c.source || 'unknown').replace(/[^a-z0-9_]/g, '_')}`;

  return `
    <div class="cand-section">
      <div class="cand-eyebrow">summary</div>
      <h4 class="cand-h4" style="margin-bottom:14px;">key facts at a glance</h4>
      <div class="summary-grid">
        <div class="sum-cell">
          <div class="sum-label">span</div>
          <div class="sum-value"><b>${span_mb.toFixed(2)}</b> Mb · ${c.end_w - c.start_w + 1} W</div>
        </div>
        <div class="sum-cell">
          <div class="sum-label">K bands (split)</div>
          <div class="sum-value">${bandSplit} <span class="sum-sub">of ${total}</span></div>
        </div>
        <div class="sum-cell">
          <div class="sum-label">σ verdict</div>
          <div class="sum-value"><span class="verdict-badge ${verdictClass}" style="margin:0;">${verdict}</span></div>
        </div>
        <div class="sum-cell">
          <div class="sum-label">drifters (σ&gt;2·q50)</div>
          <div class="sum-value">${drifterText}</div>
        </div>
        <div class="sum-cell">
          <div class="sum-label">top family (largest band)</div>
          <div class="sum-value"><b>${topFamLargest}</b> <span class="sum-sub">${topFamLargestPct}% of band ${largestBandIdx}</span></div>
        </div>
        <div class="sum-cell">
          <div class="sum-label">coherence (max top-fam)</div>
          <div class="sum-value">${coherenceLabel}</div>
        </div>
        <div class="sum-cell">
          <div class="sum-label">source</div>
          <div class="sum-value"><span class="${sourceChipClassShort}" title="Candidate provenance — see header for the long-form description.">${sourceLabel}</span></div>
        </div>
      </div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--ink-dimmer);margin-top:12px;line-height:1.5;">
        Quick read: low coherence + clear σ verdict + balanced K-band split → likely real inversion.
        High coherence (one family fills a band) → suspect family LD, not biology.
      </div>
    </div>
  `;
}

// --- candidateSubbandHtml — extracted from legacy ---
export function candidateSubbandHtml(c) {
  if (!c) return '';
  const sub = c.k6_substructure;
  if (!sub || !sub.verdict) {
    return `
      <div class="cand-section">
        <div class="cand-eyebrow">K=6 substructure</div>
        <div style="color:var(--ink-dim);font-size:12px;line-height:1.6;">
          K=6 substructure not computed for this candidate. Re-promote to enable.
        </div>
      </div>
    `;
  }
  const verdict = sub.verdict;
  const verdictColor = verdict === 'NESTED'        ? 'var(--good)'
                     : verdict === 'CROSS_CUTTING' ? 'var(--bad)'
                     : verdict === 'MIXED'         ? 'var(--accent)'
                                                   : 'var(--ink-dim)';
  const verdictHelp = verdict === 'NESTED'
    ? 'K=6 sub-bands cleanly nest inside K=3 majors. Keep g0a/g0b as annotation; do not promote K=6 to separate inversions.'
    : verdict === 'CROSS_CUTTING'
    ? 'K=6 cuts across K=3 majors. This may indicate a second system (independent inversion) overlapping this candidate.'
    : verdict === 'MIXED'
    ? 'Partial nesting: some K=6 groups nest cleanly, others cut across K=3. Review per-group purity below before deciding.'
    : 'No K=6 cluster data available for this candidate.';
  const thr = sub.purity_threshold != null
    ? sub.purity_threshold.toFixed(2) : '0.80';
  // Per-K6-group rows with sub-band label (g{parent}{letter}), purity %,
  // parent K=3 major, and whether the group is "pure" (purity ≥ threshold).
  const rows = [];
  const K6 = sub.K6;
  for (let r = 0; r < K6; r++) {
    const parent = sub.parent_of_k6[r];
    const purity = sub.purity[r];
    const letter = (sub.subband_letter && sub.subband_letter[r]) || '?';
    const subbandLabel = parent >= 0 ? `g${parent}${letter}` : 'g?';
    const purityPct = isFinite(purity) ? (purity * 100).toFixed(0) + '%' : '–';
    const isPure = isFinite(purity) && purity >= sub.purity_threshold;
    const rowColor = parent < 0 ? 'var(--ink-dimmer)'
                   : isPure ? 'var(--good)' : 'var(--bad)';
    rows.push(`
      <tr style="font-family:var(--mono);font-size:10.5px;">
        <td style="padding:3px 8px;color:${rowColor};font-weight:600;">k${r}</td>
        <td style="padding:3px 8px;color:${rowColor};">${subbandLabel}</td>
        <td style="padding:3px 8px;color:var(--ink-dim);">${parent >= 0 ? `g${parent}` : '–'}</td>
        <td style="padding:3px 8px;color:${rowColor};text-align:right;">${purityPct}</td>
        <td style="padding:3px 8px;color:${rowColor};">${isPure ? '✓ pure' : (parent < 0 ? 'no data' : '✗ impure')}</td>
      </tr>
    `);
  }
  // Fish-stability summary
  let nStable = 0, nUnstable = 0, nNoSub = 0;
  if (Array.isArray(c.fish_calls)) {
    for (const fc of c.fish_calls) {
      if (!fc || fc.subband_stability == null) { nNoSub++; continue; }
      if (fc.subband_stability >= 1) nStable++;
      else nUnstable++;
    }
  }
  const totalFish = nStable + nUnstable + nNoSub;
  const stabilitySummary = totalFish > 0
    ? `<b>${nStable}</b> / ${nStable + nUnstable} fish have stable sub-band paths (stay in one K=3 major across all supporting intervals)`
    : 'no fish-call data';
  return `
    <div class="cand-section">
      <div class="cand-eyebrow">K=6 substructure</div>
      <h4 class="cand-h4" style="display:flex;align-items:center;gap:10px;">
        nesting verdict
        <span style="display:inline-block;padding:2px 10px;border-radius:3px;
                     font-family:var(--mono);font-size:11px;
                     background:${verdictColor};color:#0e1116;font-weight:700;">${verdict}</span>
        <span style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);font-weight:400;">
          ${sub.n_pure}/${sub.n_with_data} K6 groups pure (≥ ${thr})
        </span>
      </h4>
      <div style="color:var(--ink-dim);font-size:11.5px;line-height:1.5;margin-bottom:10px;">
        ${verdictHelp}
      </div>
      <table style="border-collapse:collapse;width:100%;max-width:560px;
                    background:var(--panel-2);border:1px solid var(--rule);">
        <thead>
          <tr style="font-family:var(--mono);font-size:9.5px;color:var(--ink-dim);
                     text-transform:uppercase;letter-spacing:0.04em;
                     background:var(--panel-3);">
            <th style="padding:4px 8px;text-align:left;">K6 group</th>
            <th style="padding:4px 8px;text-align:left;">sub-band</th>
            <th style="padding:4px 8px;text-align:left;">K3 parent</th>
            <th style="padding:4px 8px;text-align:right;">purity</th>
            <th style="padding:4px 8px;text-align:left;">status</th>
          </tr>
        </thead>
        <tbody>${rows.join('')}</tbody>
      </table>
      <div style="font-family:var(--mono);font-size:10.5px;color:var(--ink-dim);
                  margin-top:10px;line-height:1.5;">
        Fish stability: ${stabilitySummary}.
      </div>
    </div>
  `;
}

// --- candidateHetShapeHtml — extracted from legacy ---
export function candidateHetShapeHtml(c) {
  const state = _pageState;
  if (!c) return '';
  let diag = c.band_diagnostics;
  if (!diag && state.data && c.ref_l2 != null && state.data.l2_envelopes &&
      typeof getL2Cluster === 'function' &&
      typeof computeBandDiagnostics === 'function') {
    try {
      const refCl = getL2Cluster(c.ref_l2);
      const refEnv = state.data.l2_envelopes[c.ref_l2];
      if (refCl && refEnv) {
        diag = computeBandDiagnostics(refCl, refEnv, c.ref_l2);
      }
    } catch (e) { /* fall through, render empty */ }
  }
  if (!diag || !diag.het_shape) {
    return `
      <div class="cand-section">
        <div class="cand-eyebrow">het shape</div>
        <div style="color:var(--ink-dim);font-size:12px;line-height:1.6;">
          Het layer not loaded — ridgeline unavailable. Load a GHSL panel
          enrichment JSON to see per-band heterozygosity distributions.
        </div>
      </div>
    `;
  }
  const fig = (typeof _hetRidgelineFigureHtml === 'function')
    ? _hetRidgelineFigureHtml(diag) : '';
  const supportLine = (typeof _hetSupportLineHtml === 'function')
    ? _hetSupportLineHtml(diag) : '';
  const hs = diag.het_shape;
  // Interpretation hint based on support_kind + ratio
  let interp = '';
  if (hs.support_ratio != null) {
    if (hs.support_kind === 'middle_vs_flanks') {
      interp = hs.support_passes
        ? `Middle band carries the heterozygosity peak — consistent with the inversion-Hardy-Weinberg pattern (heterozygous arrangement carriers in the middle band).`
        : hs.support_marginal
        ? `Middle band has slightly elevated heterozygosity vs flanking bands; signal is weak.`
        : `Middle band heterozygosity is not distinguishably higher than flanks — bands may not reflect the canonical inversion-Hardy-Weinberg pattern.`;
    } else if (hs.support_kind === 'max_min_spread') {
      interp = hs.support_passes
        ? `Bands differ markedly in heterozygosity (≥ 1.5× spread).`
        : hs.support_marginal
        ? `Bands show modest heterozygosity differences.`
        : `Bands have similar heterozygosity distributions.`;
    }
  }
  return `
    <div class="cand-section">
      <div class="cand-eyebrow">het shape</div>
      <div style="display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap;">
        <div>${fig}</div>
        <div style="flex:1;min-width:240px;font-size:11.5px;line-height:1.6;color:var(--ink);">
          ${supportLine}
          ${interp ? `<div style="margin-top:8px;color:var(--ink-dim);">${interp}</div>` : ''}
          <div style="margin-top:10px;font-family:var(--mono);font-size:10px;color:var(--ink-dimmer);">
            Computed at ref_l2 = ${c.ref_l2 != null ? c.ref_l2 : '?'} ·
            ${hs.n_bins}-bin histogram on [${hs.bin_lo}, ${hs.bin_hi}]
          </div>
        </div>
      </div>
    </div>
  `;
}

// --- candidateDosageHeatmapHtml — extracted from legacy ---
export function candidateDosageHeatmapHtml(c) {
  const state = _pageState;
  if (!c) return '';
  const hasIdx = !!(state.data && state.data.dosage_chunks);
  const capN = (_ensureDosageHmState().cap_n) || DOSAGE_HEATMAP_DEFAULTS.DEFAULT_CAP;
  const capButtons = [100, 200, 500].map(n =>
    `<button class="dh-cap-btn ${n === capN ? 'active' : ''}" data-cap="${n}">${n}</button>`
  ).join('');
  const note = hasIdx
    ? `<span class="dim">dosage_chunks index loaded — ${state.data.dosage_chunks.chunks.length} chunk(s) registered</span>`
    : `<span class="dim">no dosage_chunks index — load enrichment JSON to enable</span>`;
  const sqStatus = (state.data && Array.isArray(state.data.candidate_sample_coherence))
    ? '<span class="dim">stripe quality: from layer</span>'
    : '<button class="dh-sq-btn" type="button" title="Compute stripe quality from dosage chunk">Compute stripe quality</button>';
  return `
    <div class="cand-section dh-section" data-cand-id="${c.id}">
      <div class="cand-eyebrow">dosage heatmap (FIG_C08-style)</div>
      <div class="dh-toolbar">
        <span class="dh-lbl">Markers shown:</span>
        <span class="dh-cap-group">${capButtons}</span>
        <span class="dh-info-slot dim" data-dh-info="1"></span>
        ${sqStatus}
      </div>
      <div class="dh-canvas-wrap">
        <canvas class="dh-canvas" data-mode="candidate"
                style="width: 100%; height: 420px; display: block;"></canvas>
      </div>
      <div class="dh-note">${note}</div>
    </div>
  `;
}

// --- candidateProfileHtml — extracted from legacy ---
export function candidateProfileHtml(c, profile) {
  if (!profile) {
    return `
      <div class="cand-section">
        <div class="cand-eyebrow">σ-profile verdict (across full candidate span)</div>
        <div style="color:var(--ink-dim);font-size:12px;">
          Cannot compute profile — candidate span has fewer than 2 windows or fewer than 10 finite samples.
        </div>
      </div>
    `;
  }
  const verdictClass = profile.verdict.toLowerCase();
  return `
    <div class="cand-section">
      <div class="cand-eyebrow">σ-profile verdict (across full candidate span)</div>
      <h4 class="cand-h4" style="display:flex;align-items:center;">
        verdict
        <span class="verdict-badge ${verdictClass}">${profile.verdict}</span>
      </h4>
      <div style="color:var(--ink-dim);font-size:12px;line-height:1.6;">
        ${profile.reason}
      </div>
    </div>
  `;
}

// --- candidateSigmaChartHtml — extracted from legacy ---
export function candidateSigmaChartHtml(c, profile) {
  const state = _pageState;
  if (!profile || !profile.sd) {
    return '';
  }
  let drifterChips = '';
  if (profile.top_high && profile.top_high.length > 0) {
    drifterChips = profile.top_high.map(({si, sigma}) => {
      const cga = (state.data.samples[si].cga || state.data.samples[si].ind);
      return `<span class="drifter-chip" data-si="${si}">${cga} σ${sigma.toFixed(3)}</span>`;
    }).join('');
  }
  return `
    <div class="cand-section">
      <div class="cand-eyebrow">σ across candidate (per-sample, sorted)</div>
      <h4 class="cand-h4">distribution</h4>
      <div class="sigma-chart"><canvas id="candSigmaCanvas"></canvas></div>
      <div class="sigma-stats">
        <span>q50: <b>${profile.q50.toFixed(3)}</b></span>
        <span>q90: <b>${profile.q90.toFixed(3)}</b></span>
        <span>q95: <b>${profile.q95.toFixed(3)}</b></span>
        <span>drifters (σ&gt;2·q50): <b>${profile.n_high}</b> (${(profile.ratio_high*100).toFixed(0)}%)</span>
        <span>bimodality coef: <b>${profile.bimodality_coef.toFixed(2)}</b> ${profile.is_bimodal ? '(bimodal)' : '(unimodal)'}</span>
      </div>
      ${drifterChips ? `
        <div style="margin-top:10px;">
          <div style="font-family:var(--mono);font-size:10px;color:var(--ink-dim);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">
            top drifters · click to track in page 1
          </div>
          ${drifterChips}
        </div>
      ` : ''}
    </div>
  `;
}

// --- candidateBandsHtml — extracted from legacy ---
export function candidateBandsHtml(c, bands) {
  if (!bands || bands.length === 0) return '';
  const cards = bands.map(b => {
    const swatchColor = groupColor(b.k);
    // Top family info
    let famInfo = '';
    if (b.families.length > 0 && b.n > 0) {
      const top = b.families[0];
      const topPct = Math.round((top.n / b.n) * 100);
      const famLabel = top.family_id === 'unknown' ? 'unknown' : `F${top.family_id}`;
      famInfo = `
        <div class="compo-row">
          top family: <b>${famLabel}</b> (${top.n}/${b.n}, ${topPct}%)
          <span class="compo-bar" style="width:80px;"><span style="width:${topPct}%;"></span></span>
        </div>
      `;
      // Show next 2 families if they exist
      const others = b.families.slice(1, 3).filter(f => f.n > 0);
      if (others.length > 0) {
        famInfo += others.map(f => {
          const lbl = f.family_id === 'unknown' ? 'unknown' : `F${f.family_id}`;
          return `<div class="compo-row" style="font-size:10px;color:var(--ink-dimmer);">${lbl}: ${f.n}</div>`;
        }).join('');
      }
    } else {
      famInfo = '<div class="compo-row" style="color:var(--ink-dimmer);">no family info</div>';
    }
    // Ancestry info (only if >1 distinct ancestry)
    let ancInfo = '';
    if (b.ancestries.length > 1) {
      ancInfo = '<div class="compo-row" style="margin-top:6px;">ancestry:</div>';
      ancInfo += b.ancestries.slice(0, 4).map(a => {
        const pct = Math.round(a.frac * 100);
        return `<div class="compo-row" style="font-size:10px;color:var(--ink-dimmer);">${a.label}: ${a.n} (${pct}%)</div>`;
      }).join('');
    }
    return `
      <div class="band-card cand-band-card" data-band-idx="${b.k}"
           title="Click to project these ${b.n} fish across the chromosome — see which candidates' bands they belong to (turn 2j: genome-wide linkage)"
           style="cursor:pointer;transition:border-color 0.15s, background 0.15s;">
        <div class="band-head">
          <span class="band-swatch" style="background:${swatchColor};"></span>
          <span class="band-title">band ${b.k}</span>
          <span class="band-count">${b.n} samples</span>
        </div>
        ${famInfo}
        ${ancInfo}
      </div>
    `;
  }).join('');
  return `
    <div class="cand-section">
      <div class="cand-eyebrow">band composition</div>
      <h4 class="cand-h4">family / ancestry breakdown by band</h4>
      <div class="band-grid" id="candBandGrid">${cards}</div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--ink-dimmer);margin-top:10px;line-height:1.5;">
        Top family ≈100% in every band → <b>family LD</b>, not real inversion.
        Top family fractions varying widely across bands → <b>real biological signal</b>.<br>
        <b>Click any band</b> to project its fish across the chromosome (turn 2j).
      </div>
    </div>
    <div class="cand-section" id="candGenomeLinkageSection" style="display:none;">
      <div class="cand-eyebrow">genome-wide linkage</div>
      <h4 class="cand-h4" id="candGenomeLinkageHeader">click a band above</h4>
      <div id="candGenomeLinkageBody" style="font-size:11px;color:var(--ink-dimmer);">—</div>
    </div>
  `;
}

// --- candidateHaplotypeAnnotationsHtml — extracted from legacy ---
export function candidateHaplotypeAnnotationsHtml(c) {
  if (!c) return '';
  const K = c.K || c.K_used || 0;
  if (!K) return '';
  const labels = loadHaplotypeLabels(c);
  const suggestions = _inheritanceSuggestionsForCandidate(c);
  const haveSuggestions = Object.keys(suggestions).length > 0;

  // turn 2f: auto-classifier suggestions per band + vocabulary picker
  const vocab = (typeof getHaplotypeVocab === 'function') ? getHaplotypeVocab(c) : 'standard';
  const vocabOptions = (typeof _HAP_VOCAB_OPTIONS === 'object' && _HAP_VOCAB_OPTIONS[vocab])
    ? _HAP_VOCAB_OPTIONS[vocab] : [];
  const classifier = (typeof autoClassifyCandidate === 'function') ? autoClassifyCandidate(c) : null;
  const classifierByBand = {};
  if (classifier && Array.isArray(classifier.per_band)) {
    for (const pb of classifier.per_band) classifierByBand[pb.k] = pb;
  }

  // Helper: render the per-band cell
  function bandCell(b) {
    const swatch = groupColor(b);
    const userVal = labels[b] != null ? String(labels[b]) : '';
    const sugId = suggestions[b];
    const inhText = (sugId != null) ? `inh${sugId}` : '';
    const cls = classifierByBand[b];
    const autoLabel = cls ? cls.label : '';
    const autoConf = cls ? cls.confidence : 'none';
    const autoReason = cls ? cls.reason : '';
    const confColor = {
      high: '#3cc08a', medium: '#f5a524', low: '#e0555c', none: '#7a8398',
    }[autoConf] || '#7a8398';
    const isPicker = vocab !== 'free';
    const inputCol = isPicker ? renderPicker(b, userVal, autoLabel, vocabOptions) : renderFreeText(b, userVal);
    return `
      <div class="hap-row" style="display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid var(--rule);">
        <span class="band-swatch" style="background:${swatch};display:inline-block;width:12px;height:12px;border-radius:2px;flex:0 0 12px;"></span>
        <span style="font-family:var(--mono);font-size:11px;flex:0 0 44px;">band ${b}</span>
        ${inputCol}
        <span class="hap-conf" title="${escapeHtmlAttr(autoReason)}"
              style="font-family:var(--mono);font-size:9px;color:${confColor};flex:0 0 60px;">
          ${autoConf !== 'none' ? `auto:${autoConf}` : '—'}
        </span>
        <span class="hap-suggestion" style="font-family:var(--mono);font-size:9px;color:var(--ink-dimmer);flex:0 0 38px;">${inhText}</span>
      </div>
    `;
  }

  function escapeHtmlAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderPicker(b, userVal, autoLabel, options) {
    // The picker is a select element with the vocab options + a "custom..." entry.
    // Selected value:
    //   if userVal in options -> userVal
    //   if userVal is non-empty and not in options -> trigger custom mode
    //   if userVal is empty and autoLabel exists -> autoLabel (with "(auto)" marker)
    //   else -> empty placeholder
    const inOptions = options.includes(userVal);
    const useCustom = userVal && !inOptions;
    const showAuto = !userVal && autoLabel;
    const opts = options.map(o => {
      const sel = (o === userVal) ? ' selected' : '';
      return `<option value="${escapeHtmlAttr(o)}"${sel}>${escapeHtmlAttr(o)}</option>`;
    }).join('');
    const autoOption = showAuto
      ? `<option value="${escapeHtmlAttr(autoLabel)}" selected style="color:#7a8398;">${escapeHtmlAttr(autoLabel)} (auto)</option>`
      : '';
    const blankOption = (!userVal && !showAuto) ? '<option value="" selected>—</option>' : '<option value="">—</option>';
    const customOption = `<option value="__custom__"${useCustom ? ' selected' : ''}>custom…</option>`;
    return `
      <select class="hap-label-picker" data-band-idx="${b}"
              style="flex:1;font-family:var(--mono);font-size:11px;padding:3px 4px;background:var(--panel-2);border:1px solid var(--rule);color:var(--ink);border-radius:2px;">
        ${blankOption}
        ${autoOption}
        ${opts}
        ${customOption}
      </select>
      <input type="text" class="hap-label-custom" data-band-idx="${b}"
             value="${useCustom ? escapeHtmlAttr(userVal) : ''}"
             placeholder="type custom"
             style="flex:1;font-family:var(--mono);font-size:11px;padding:3px 6px;background:var(--panel-2);border:1px solid var(--rule);color:var(--ink);border-radius:2px;display:${useCustom ? 'inline-block' : 'none'};">
    `;
  }

  function renderFreeText(b, userVal) {
    return `
      <input type="text" class="hap-label-free" data-band-idx="${b}"
             placeholder="e.g. H1/H1, AA, REF/INV"
             value="${escapeHtmlAttr(userVal)}"
             style="flex:1;font-family:var(--mono);font-size:11px;padding:3px 6px;background:var(--panel-2);border:1px solid var(--rule);color:var(--ink);border-radius:2px;">
    `;
  }

  let rows = '';
  for (let b = 0; b < K; b++) rows += bandCell(b);

  // Vocabulary picker
  const vocabOpts = ['standard', 'binary', 'multi2', 'multi3', 'free'].map(v =>
    `<option value="${v}"${v === vocab ? ' selected' : ''}>${v}</option>`
  ).join('');

  const headerNote = haveSuggestions
    ? 'Bands sharing an <i>inh-group</i> behave identically across candidates — they likely carry the same haplotype background.'
    : 'Run inheritance compute (auto-triggers when ≥2 candidates exist) to see which bands behave alike.';

  return `
    <div class="cand-section" id="hapLabelsSection">
      <div class="cand-eyebrow">haplotype annotations</div>
      <h4 class="cand-h4">label each band's haplotype identity</h4>
      <div style="font-size:11px;color:var(--ink-dimmer);margin-bottom:8px;line-height:1.5;">
        ${headerNote}
        Labels persist in your browser and become the input for the atlas→phase 7 export.
      </div>

      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;font-size:11px;flex-wrap:wrap;">
        <label style="font-family:var(--mono);">vocabulary:
          <select id="hapVocabPicker" style="margin-left:4px;font-family:var(--mono);font-size:11px;padding:2px 4px;background:var(--panel-2);border:1px solid var(--rule);color:var(--ink);border-radius:2px;">
            ${vocabOpts}
          </select>
        </label>
        <button id="hapAutoFillBtn" title="Apply atlas's auto-suggestions to empty bands. Confident suggestions are filled; uncertain ones are skipped."
                style="font-family:var(--mono);font-size:11px;padding:3px 8px;background:var(--panel-2);border:1px solid var(--rule);color:var(--ink);border-radius:2px;cursor:pointer;">
          🪄 auto-fill empty bands
        </button>
        <button id="hapAutoFillCohortBtn" title="Apply auto-suggestions to ALL candidates' empty bands. One click for the cohort."
                style="font-family:var(--mono);font-size:11px;padding:3px 8px;background:var(--panel-2);border:1px solid var(--rule);color:var(--ink);border-radius:2px;cursor:pointer;">
          🪄🪄 auto-fill cohort
        </button>
        <span id="hapLabelsStatus" style="font-size:10px;color:var(--ink-dimmer);font-family:var(--mono);"></span>
      </div>

      <div style="display:flex;flex-direction:column;gap:0;">
        ${rows}
      </div>

      <div style="font-size:10px;color:var(--ink-dimmer);margin-top:8px;line-height:1.5;">
        <b>Confidence</b>:
        <span style="color:#3cc08a;">high</span> — strong evidence (clear het signal, PC1 ordering matches);
        <span style="color:#f5a524;">medium</span> — supported but ambiguous;
        <span style="color:#e0555c;">low</span> — guess; please review.
        Hover the confidence label to see the reason.<br>
        <b>Keys</b>: ↑/↓ to cycle through vocab options, Tab to next band, Enter to confirm.
      </div>
    </div>
  `;
}

// --- candidateAncestryConfoundHtml — extracted from legacy ---
export function candidateAncestryConfoundHtml(c) {
  const state = _pageState;
  if (!c) return '';
  const sd = state.data || {};

  // Load the three layers
  const globalQ = _ancGetGlobalQ(sd);
  const chromQ  = _ancGetChromQ(sd);
  const snpSup  = _ancGetSnpSupport(sd, c.start_bp, c.end_bp);

  // Run the three tests
  const t1 = _ancRunSampleTest(c, globalQ);
  const t2 = _ancRunSampleTest(c, chromQ);
  let t3 = { ok: false, why: 'layer absent' };
  if (snpSup && Array.isArray(snpSup.snps)) {
    const coh = _ancSnpCoherence(snpSup.snps);
    if (coh.ok) {
      t3 = Object.assign({}, coh, {
        ok: true,
        verdict: _ancVerdictSnpLevel(coh),
        source: snpSup.source, K: snpSup.K,
      });
    } else {
      t3 = { ok: false, why: coh.why || 'snp coherence failed', source: snpSup.source };
    }
  }

  const combined = _ancCombinedVerdict(t1, t2, t3);

  // Test card renderers
  function pillFor(verdict) {
    const cls = ({
      'BAND_TRACKS_ANCESTRY':         'suspect',
      'BAND_INDEPENDENT_OF_ANCESTRY': 'independent',
      'INCONCLUSIVE':                 'inconclusive',
      'Q_COHERENT':                   'suspect',
      'Q_MIXED':                      'independent',
      'Q_PARTIAL':                    'inconclusive',
    })[verdict] || 'empty';
    return '<span class="anc-verdict-pill ' + cls + '">' + verdict + '</span>';
  }
  function emptyCard(name, why) {
    return '<div class="anc-test-card">' +
           '<div class="anc-test-name">' + name + '</div>' +
           '<div class="anc-test-empty">layer not loaded — ' + why + '</div>' +
           '<span class="anc-verdict-pill empty">NO DATA</span>' +
           '</div>';
  }
  function sampleCard(name, t) {
    if (!t.ok) return '<div class="anc-test-card">' +
                      '<div class="anc-test-name">' + name + '</div>' +
                      '<div class="anc-test-empty">' + t.why + '</div>' +
                      '<span class="anc-verdict-pill empty">N/A</span>' +
                      '</div>';
    return '<div class="anc-test-card">' +
           '<div class="anc-test-name">' + name + '</div>' +
           '<div class="anc-test-source">' + t.source + ' · K=' + t.K + '</div>' +
           '<div class="anc-test-metric">' +
              '<div><span>Cramér V</span><b>' + t.cramersV.toFixed(3) + '</b></div>' +
              '<div><span>max |corr|</span><b>' + t.maxAbsCorr.toFixed(3) + '</b></div>' +
              '<div><span>n samples</span>' + t.n + (t.n_missing ? ' (' + t.n_missing + ' unmatched)' : '') + '</div>' +
           '</div>' +
           pillFor(t.verdict) +
           '</div>';
  }
  function snpCard(name, t) {
    if (!t.ok) return '<div class="anc-test-card">' +
                      '<div class="anc-test-name">' + name + '</div>' +
                      '<div class="anc-test-empty">' + t.why + '</div>' +
                      '<span class="anc-verdict-pill empty">N/A</span>' +
                      '</div>';
    return '<div class="anc-test-card">' +
           '<div class="anc-test-name">' + name + '</div>' +
           '<div class="anc-test-source">' + t.source + '</div>' +
           '<div class="anc-test-metric">' +
              '<div><span>coherence</span><b>' + (t.coherence * 100).toFixed(1) + '%</b></div>' +
              '<div><span>dominant Q</span>Q' + t.dominantQ + '</div>' +
              '<div><span>entropy</span>' + t.entropy.toFixed(2) + ' bits</div>' +
              '<div><span>n biSNPs</span>' + t.n + '</div>' +
           '</div>' +
           pillFor(t.verdict) +
           '</div>';
  }

  const card1 = (t1.ok || globalQ) ? sampleCard('Test 1 · genome-wide ancestry confound', t1)
                                   : emptyCard('Test 1 · genome-wide ancestry confound',
                                               'state.data.ancestry_q_global missing (apply R-side patch + re-run export)');
  const card2 = (t2.ok || chromQ)  ? sampleCard('Test 2 · focal-chrom ancestry confound', t2)
                                   : emptyCard('Test 2 · focal-chrom ancestry confound',
                                               'state.data.ancestry_q_chrom missing (apply R-side patch + re-run export)');
  const card3 = (t3.ok || snpSup)  ? snpCard('Test 3 · SNP-level Q coherence', t3)
                                   : emptyCard('Test 3 · SNP-level Q coherence',
                                               'state.data.snp_q_support missing (run MODULE_2C + add to ancestry export)');

  // Combined verdict text
  const combinedText = ({
    'ALL_THREE_SUSPECT':  'STRONG SUSPECT — bands track Q both genome-wide AND on this chromosome, AND the SNPs in this candidate anchor to a single Q component. Most likely ancestry/broodline artifact rather than a real inversion.',
    'GENOME_ONLY':        'PARTIAL — bands track genome-wide ancestry but NOT focal-chrom ancestry. Candidate may sit on a chromosome that breaks the cohort-level pattern. Worth examining alongside the focal-chrom Q distribution.',
    'FOCAL_ONLY':         'INTERESTING — bands track focal-chromosome ancestry but NOT genome-wide ancestry. Consistent with real chromosomal structure where one broodline contributed THIS chromosome, even though samples are mixed elsewhere. Not a generic ancestry artifact.',
    'SAMPLE_INDEPENDENT': 'CLEAN — bands do NOT track sample ancestry at either scale. Strong "real local biology" signal. Cross-validate with Test 3 SNP coherence: mixed SNPs strengthens the call.',
    'PARTIAL':            'PARTIAL — mixed signals across the three tests. Examine each card; weigh genome-wide vs focal-chrom carefully if they disagree.',
    'EMPTY':              'NO DATA — none of the three Q layers loaded. Apply the R-side export patch and re-run export_ancestry_to_json_v1.R to enable the panel.',
  })[combined] || 'PARTIAL — see individual cards.';

  return '<div class="cand-section" id="candAncestryConfoundSec">' +
         '<div class="cand-eyebrow">ancestry-confound assessment</div>' +
         '<h4 class="cand-h4">do these K-bands track sample ancestry?</h4>' +
         '<div class="anc-confound-grid">' + card1 + card2 + card3 + '</div>' +
         '<div class="anc-combined-row">' +
           '<span class="anc-combined-label">combined</span>' +
           '<span class="anc-combined-text">' + combinedText + '</span>' +
         '</div>' +
         '<div class="anc-confound-help">' +
           'Three tests. Test 1+2 use Cramér\'s V (categorical association of K-bands vs argmax-Q) and max ' +
           '|Pearson correlation| (band indicator vs Q column); thresholds suspect&nbsp;V≥0.6 or |corr|≥0.7, ' +
           'independent V&lt;0.3 and |corr|&lt;0.4. Test 3 measures the modal best-Q fraction across SNPs ' +
           'in the candidate\'s span; ≥65% coherent, &lt;40% mixed. Combined synthesis prefers the ' +
           'discordance pattern over a flat AND. Not a publication-ready threshold — verdicts are decision ' +
           'support, not validated calls.' +
         '</div>' +
         '</div>';
}

// --- candidateRegimeRowHtml — extracted from legacy ---
export function candidateRegimeRowHtml(c) {
  if (!c) return '';
  // Collect all L2 IDs this candidate covers. Prefer c.l2_indices when
  // available (numeric indices into d.l2_envelopes); fall back to c.l2_ids
  // if the candidate carries those directly.
  const l2Ids = _candidateL2Ids(c);
  // L2-level claims (legacy / shared across tracks)
  const l2Claimed = new Set();
  for (const lid of l2Ids) {
    for (const r of _regimesForL2(lid)) l2Claimed.add(r.id);
  }
  // Determine if this is a two-track candidate (turn 36+). Same definition
  // used everywhere: tracks.length === 2 AND both have ≥1 active band.
  const isTwoTrack = !!(Array.isArray(c.tracks) && c.tracks.length === 2 &&
    c.tracks.every(t => t && Array.isArray(t.active_bands) &&
                        t.active_bands.length > 0));

  // Per-track regime claims (turn 48). Each two-track candidate may have
  // distinct regimes per track. Single-track: track 0 only.
  const nTracks = isTwoTrack ? 2 : 1;
  const trackClaimed = [];
  for (let ti = 0; ti < nTracks; ti++) {
    const claims = (typeof _regimesForCandTrack === 'function')
      ? _regimesForCandTrack(c.id, ti) : [];
    trackClaimed.push(claims.map(r => r.id).sort());
  }

  // Helper: render one regime chip + edit button, with a small track
  // suffix when isTwoTrack.
  function renderChip(rid, trackSuffix) {
    const col = _regimeColor(rid);
    const style = 'background:' + col.bg + ';border-color:' + col.border + ';color:' + col.fg + ';';
    const suffix = trackSuffix ? '<span class="cand-regime-track-tag">' + trackSuffix + '</span>' : '';
    return '<span class="cand-regime-chip" style="' + style + '">' + _esc(rid) + suffix +
           '<button class="cand-regime-edit-chip" data-cand-regime-edit="' + _esc(rid) +
           '" style="color:' + col.fg + ';"' +
           ' title="Edit regime ' + _esc(rid) + '">edit</button></span>';
  }

  let html = '<div class="cand-regime-row">';
  html += '<span class="cand-regime-label">regimes:</span>';

  if (!isTwoTrack) {
    // Single-track: union of L2-level + track-0 claims (legacy paths
    // continue working; track 0 is the implicit single-track scope).
    const union = new Set([...l2Claimed, ...trackClaimed[0]]);
    const claimedIds = Array.from(union).sort();
    if (claimedIds.length === 0) {
      html += '<span class="cand-regime-none">— none —</span>';
    } else {
      for (const rid of claimedIds) html += renderChip(rid, '');
    }
    html += '<button class="cand-regime-assign" data-cand-regime-action="assign"' +
            ' data-cand-regime-track="0"' +
            ' title="Assign this candidate&#39;s L2 envelopes to a regime">+ assign to regime</button>';
  } else {
    // Two-track: show per-track chips, plus separate assign buttons. L2-
    // level claims are rendered ONCE (they apply to the whole region) at
    // the start of the row to avoid double-counting on per-track lines.
    if (l2Claimed.size > 0) {
      html += '<span class="cand-regime-l2-prefix" title="Regime claimed via L2 envelope membership (covers both tracks).">L2:</span>';
      for (const rid of Array.from(l2Claimed).sort()) html += renderChip(rid, '');
    }
    for (let ti = 0; ti < 2; ti++) {
      // Use the track's primary band color as a thin prefix so the user
      // visually distinguishes track 1's row from track 2's.
      const primaryBand = c.tracks[ti].active_bands[0];
      const tColor = groupColor(primaryBand);
      const tStyle = 'border-color:' + tColor + ';color:' + tColor + ';';
      html += '<span class="cand-regime-track-prefix" style="' + tStyle + '">t' + (ti + 1) + '/2</span>';
      const trackIds = trackClaimed[ti];
      if (trackIds.length === 0) {
        html += '<span class="cand-regime-none">—</span>';
      } else {
        for (const rid of trackIds) html += renderChip(rid, '');
      }
      html += '<button class="cand-regime-assign" data-cand-regime-action="assign"' +
              ' data-cand-regime-track="' + ti + '"' +
              ' title="Assign track ' + (ti + 1) + ' to a regime">+ assign t' + (ti + 1) + '</button>';
    }
  }
  html += '<button class="cand-regime-open" data-cand-regime-action="open"' +
          ' title="Open the regime registry">⚙ registry</button>';
  html += '</div>';
  return html;
}

// --- candidateAgeOriginHtml — extracted from legacy ---
export function candidateAgeOriginHtml(c) {
  const state = _pageState;
  if (!c) return '';
  const cid = (c.id != null) ? c.id : c.candidate_id;
  const chromBlock = (state.cheat30Results && c.chrom) ? state.cheat30Results[c.chrom] : null;
  // Header — common to all states
  const header =
    '<div class="cand-section ageorig-section">' +
    '<div class="cand-eyebrow">age &amp; origin <span class="dim" style="font-weight:normal;">(cheat30 / GDS by genotype)</span></div>';
  // No file loaded for this chrom
  if (!chromBlock) {
    return header +
      '<div class="ageorig-empty">' +
      'No <code>cheat30_gds_results_' + _esc(c.chrom || '?') + '.json</code> loaded.' +
      '<br><span class="dim">Run <code>cheat30_gds_by_genotype.R</code> on this chromosome and drop the JSON onto the schema badge to populate this panel.</span>' +
      '</div></div>';
  }
  // File loaded but this candidate not in it
  const r = (chromBlock.candidates) ? chromBlock.candidates[cid] : null;
  if (!r) {
    return header +
      '<div class="ageorig-empty">' +
      'No cheat30 result for <code>' + _esc(cid) + '</code>.' +
      '<br><span class="dim">cheat30 ran on ' + _esc(c.chrom || '?') +
      ' but did not return results for this candidate. Likely cause: too few samples per class (need \u22655 in REF and INV).</span>' +
      '</div></div>';
  }
  // Full panel
  const cls = _AGEORIG_CLASS[r.origin_class] || _AGEORIG_CLASS.inconclusive;
  const bimodalWarn = r.is_bimodal
    ? '<div class="ageorig-bimodal-warn">\u26a0 I/I distribution is bimodal (dip P = ' + _fmtP(r.dip_p) +
      ') \u2014 multiple haplotype backgrounds among HOM_INV carriers, consistent with recurrent inversion.</div>'
    : '';
  // Numbers grid
  const num = (label, value, tooltip) =>
    '<div class="ageorig-num-row" title="' + _esc(tooltip || '') + '">' +
    '<span class="ageorig-num-label">' + label + '</span>' +
    '<span class="ageorig-num-value">' + value + '</span>' +
    '</div>';
  const nums =
    num('separation P', _fmtP(r.separation_p),
        'Wilcoxon: same-genotype GDS > different-genotype GDS. Small P = real inversion (genotype predicts haplotype background).') +
    num('separation effect', _fmt4(r.separation_effect),
        'mean(GDS_same) \u2212 mean(GDS_different). Larger gap = stronger genotype-haplotype association.') +
    num('age proxy', _fmt4(r.age_proxy),
        'mean(GDS_REF/REF) \u2212 mean(GDS_REF/INV). Ordinal proxy: larger = more diverged arrangements (older). NOT a clock.') +
    num('dip stat', _fmt4(r.dip_stat),
        "Hartigan's dip test on the I/I distribution. Higher = more multimodal.") +
    num('mean GDS same-pair',  _fmt4(r.mean_ibs_same),
        'Mean GDS across REF/REF + INV/INV pairs.') +
    num('mean GDS diff-pair',  _fmt4(r.mean_ibs_diff),
        'Mean GDS across REF/INV pairs.') +
    num('n samples',
        '<span style="color:#7ad394">' + (r.n_ref || 0) + '</span> ' +
        '<span class="dim">/</span> ' +
        '<span style="color:#7ad3db">' + (r.n_het || 0) + '</span> ' +
        '<span class="dim">/</span> ' +
        '<span style="color:#e07a7a">' + (r.n_inv || 0) + '</span>',
        'REF / HET / INV sample counts (cheat30 requires \u22655 in REF and INV).');
  // Pill + explanation
  const pill =
    '<div class="ageorig-verdict-pill" style="background:' + cls.color +
    ';color:#0d0f12;">' + cls.label + '</div>' +
    '<div class="ageorig-verdict-explain">' + _esc(cls.explanation) + '</div>';
  // Ridgeline plot
  const ridgeline = _drawCheat30Ridgeline(r.pair_density, r.pair_summaries, { width: 380, height: 180 });
  // Layout: ridgeline left, verdict+numbers right
  return header +
    '<div class="ageorig-grid">' +
      '<div class="ageorig-left">' +
        '<div class="ageorig-ridgeline">' + ridgeline + '</div>' +
      '</div>' +
      '<div class="ageorig-right">' +
        pill +
        bimodalWarn +
        '<div class="ageorig-numbers">' + nums + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="ageorig-caveat">cheat30 measures genotype-pair GDS \u2014 ' +
    '"shared haplotype background per arrangement", NOT a molecular clock. ' +
    'Age proxy is ordinal (compare candidates) not absolute (no Mya).' +
    '</div>' +
    '</div>';
}

// --- candidateNotesHtml — extracted from legacy ---
export function candidateNotesHtml(c) {
  const noteVal = c.notes ? c.notes.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
  return `
    <div class="cand-section">
      <div class="cand-eyebrow">notes</div>
      <textarea id="candNotes" class="cand-notes"
                placeholder="Free-text notes for this candidate. Persists in the candidate object during the session."
      >${noteVal}</textarea>
    </div>
  `;
}
