// pages/discovery/candidate_focus/_wires.js
//
// Wire-up sub-module for candidate_focus (chat 36 round 5 step 2, 2026-05-07).
// 7 functions that attach event handlers to DOM elements after
// renderCandidateMetadata's innerHTML write. Includes the per-band
// click handlers, haplotype-annotation textarea wiring, regime-row
// chip wiring, and the dosage-heatmap pan/zoom wiring.
//
// All bodies extracted byte-verbatim from legacy/Inversion_atlas.html.
// State shim same as _html_builders.js.
//
// Cross-module refs:
//   - _wireCandidateHaplotypeAnnotations uses candidateHaplotypeAnnotationsHtml
//     from ./_html_builders.js.
//   - wireCandidateButtons uses addCandidateToList, candidateFromJSON,
//     candidateToJSON from ./_list.js, and refreshCandidateUI from
//     '../candidate_focus.js' (cycle-resolved by ES module live-binding).
//   - All bodies use _pageState from ./_state.js.

import { _pageState } from './_state.js';
import { candidateHaplotypeAnnotationsHtml, _candidateL2Ids, _ensureDosageHmState } from './_html_builders.js';
import { addCandidateToList, candidateFromJSON, candidateToJSON, isInCandidateList } from './_list.js';
import { refreshCandidateUI } from '../candidate_focus.js';
// 2026-05-29: the candidate dosage heatmap renderer was never ported
// (the legacy `_redrawCandidateHeatmap` / `_buildSampleLookups` /
// `computeStripeQuality` were called but undefined → ReferenceError →
// blank panel). Reuse the dedicated dosage_heatmap page's canonical
// painter + legacy-chunk adapter against a chunk fetched from the
// /api/dosage/chunk bridge for the candidate's bp range.
import { adaptLegacyChunk } from '../dosage_heatmap/adapters.js';
import { paintDosageHeatmap, deriveSampleOrder } from '../dosage_heatmap/renderer.js';
import { fitCanvasNoDpr } from '../../../shared/page1_utils.js';

// --- wireCandidateButtons — extracted from legacy ---
// 2026-05-19: navigation rewritten for atlas-core. The legacy DOM
// (`#tabBar button`, `.page.active`) doesn't exist under the new
// shell — those clicks were silent no-ops. We now:
//   1. mutate the surviving local_pca_dosage state stash on
//      `atlasState.inversion._local_pca_dosage_state` so its next
//      mount picks up the desired cursor / lockedLabels;
//   2. set `window.location.hash` so the router mounts the page.
// This produces the same end-user effect (jump to page 1 with the
// right cursor / coloring) without depending on always-mounted
// page elements.
export function wireCandidateButtons(c, profile) {
  const state = _pageState;
  const _getInv = () => {
    if (typeof window === 'undefined') return null;
    const as = window.atlasState;
    if (!as) return null;
    return as.inversion || (as.inversion = {});
  };
  const jumpBtn = document.getElementById('candidateJumpBtn');
  if (jumpBtn) jumpBtn.addEventListener('click', () => {
    const inv = _getInv();
    if (inv && inv._local_pca_dosage_state && Number.isFinite(c.ref_window)) {
      inv._local_pca_dosage_state.cur = c.ref_window | 0;
    }
    try { window.location.hash = '#/inversion/local_pca_dosage'; } catch (_) {}
  });
  // "Apply candidate's bands as color lock" — push the candidate's locked labels
  // back into state.lockedLabels so page 1 PCA also colors using these bands.
  const lockBtn = document.getElementById('candidateLockBtn');
  if (lockBtn) lockBtn.addEventListener('click', () => {
    state.lockedLabels = new Int8Array(c.locked_labels);
    state.lockedRefL2 = c.ref_l2;
    if (typeof refreshLockBtn === 'function') refreshLockBtn();
    // Also mirror onto the local_pca_dosage state stash so when the
    // router remounts page 1, drawPCA / renderL3Panel pick up the
    // locked labels without any post-mount cleanup.
    const inv = _getInv();
    if (inv && inv._local_pca_dosage_state) {
      inv._local_pca_dosage_state.lockedLabels = state.lockedLabels;
      inv._local_pca_dosage_state.lockedRefL2  = state.lockedRefL2;
    }
    try { window.location.hash = '#/inversion/local_pca_dosage'; } catch (_) {}
  });
  // 📊 dosage heatmap — switch to the dosage_heatmap page with this
  // candidate's label set. The dosage_heatmap page reads
  // `atlasState.inversion.dosage_heatmap_state` for its rich payload
  // (mgl_heatmap_result or legacy_chunk); we set the candidate_label so
  // the header reflects the active candidate even when no dosage
  // payload is loaded (empty state shows context instead of "—").
  const dhBtn = document.getElementById('candidateDosageHeatmapBtn');
  if (dhBtn) dhBtn.addEventListener('click', () => {
    const inv = _getInv();
    if (inv) {
      const prev = inv.dosage_heatmap_state || {};
      inv.dosage_heatmap_state = Object.assign({}, prev, {
        candidate_label: c.label || c.id || null,
      });
    }
    try { window.location.hash = '#/inversion/dosage_heatmap'; } catch (_) {}
  });

  const clearBtn = document.getElementById('candidateClearBtn');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    // turn 128: page 2 ✕ button now mirrors page 4 (karyotype/tier) red ✕.
    // If the focused candidate is in the saved list, fully remove it
    // (drops from list AND clears focus AND persists null AND refreshes
    // every dependent UI). If it's not in the saved list (e.g. promoted
    // but never saved), keep the legacy "just unfocus" behaviour.
    if (state.candidate && isInCandidateList(state.candidate.id)) {
      if (confirm('Remove this candidate from the saved list?')) {
        removeCandidateFully(state.candidate.id);
      }
    } else {
      if (confirm('Clear the current candidate?')) clearCandidate();
    }
  });
  // Add / remove from saved list (Turn C)
  const listToggleBtn = document.getElementById('candidateListToggleBtn');
  if (listToggleBtn) listToggleBtn.addEventListener('click', () => {
    if (!state.candidate) return;
    if (isInCandidateList(state.candidate.id)) {
      removeCandidateFromList(state.candidate.id);
    } else {
      // Save a deep-copy snapshot so live edits don't mutate the saved entry,
      // except for notes which we want to stay synced with the active candidate.
      const snapshot = candidateFromJSON(candidateToJSON(state.candidate));
      addCandidateToList(snapshot);
    }
    refreshCandidateUI(state);   // re-renders the button label
  });
  // Drifter chips → add to tracked set on page 1
  document.querySelectorAll('#candidate_focus .drifter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const si = parseInt(chip.dataset.si, 10);
      if (!isFinite(si)) return;
      if (!state.tracked.includes(si)) {
        state.tracked.push(si);
        if (state.tracked.length > state.trackedN)
          state.tracked = state.tracked.slice(-state.trackedN);
      }
      renderTrackedList();
      drawPCA();
      renderL3Panel();
    });
  });
  // Notes — autosave to the candidate object on input
  const notesEl = document.getElementById('candNotes');
  if (notesEl) notesEl.addEventListener('input', e => {
    if (state.candidate) state.candidate.notes = e.target.value;
  });
}

// --- _wireCandidateBlockChips — extracted from legacy ---
export function _wireCandidateBlockChips() {
  const chips = document.querySelectorAll('.cand-block-chip');
  chips.forEach(chip => {
    if (chip.dataset.wired === '1') return;
    const has = chip.dataset.has === '1';
    if (!has) { chip.dataset.wired = '1'; return; }   // dim chips inert
    chip.addEventListener('click', () => _toggleBlockInspector(
      chip.dataset.cid, chip.dataset.blockType, chip
    ));
    chip.dataset.wired = '1';
  });
}

// --- wireCandidateAncestryConfound — extracted from legacy ---
export function wireCandidateAncestryConfound(c) {
  // Currently the panel is read-only (no interactive elements). This wirer
  // exists for symmetry with the rest of the candidate page and to hold
  // future interactions (threshold sliders, Q-source picker, etc.).
  void c;
}

// --- _wireCandidateHaplotypeAnnotations — extracted from legacy ---
export function _wireCandidateHaplotypeAnnotations(c, sectionEl) {
  if (!c) return;
  // turn 2l: support an explicit section element for non-page-2 hosts
  // (annotation cockpit, future floating panels). Falls back to the
  // page-2 default ID when no element is passed.
  const section = sectionEl || document.getElementById('hapLabelsSection');
  if (!section) return;
  const status = section.querySelector('#hapLabelsStatus')
    || document.getElementById('hapLabelsStatus');

  let saveTimer = null;
  function flashStatus(msg) {
    if (!status) return;
    status.textContent = msg;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (status) status.textContent = ''; }, 1800);
  }

  function rerender() {
    // Re-render this section in place. Used after vocab change or
    // auto-fill — saves the user from a full candidate_focus redraw.
    const newHtml = candidateHaplotypeAnnotationsHtml(c);
    const parent = section.parentNode;
    section.outerHTML = newHtml;
    // The replacement section is now in `parent`. Find it by ID; if the
    // section had a custom ID (cockpit case), we look for the new section
    // by going to whatever child of parent now matches.
    const newSection = parent
      ? (parent.querySelector('#hapLabelsSection')
         || parent.querySelector('.cand-section'))
      : document.getElementById('hapLabelsSection');
    _wireCandidateHaplotypeAnnotations(c, newSection || undefined);
  }

  // Vocabulary picker
  const vocabPicker = section.querySelector('#hapVocabPicker');
  if (vocabPicker) {
    vocabPicker.addEventListener('change', () => {
      setHaplotypeVocab(c, vocabPicker.value);
      rerender();
    });
  }

  // Auto-fill buttons
  const autoBtn = section.querySelector('#hapAutoFillBtn');
  if (autoBtn) {
    autoBtn.addEventListener('click', () => {
      const r = applyAutoClassificationToCandidate(c, { confidenceFloor: 'low' });
      flashStatus(`auto-filled ${r.applied}, skipped ${r.skipped}`);
      rerender();
    });
  }
  const cohortBtn = section.querySelector('#hapAutoFillCohortBtn');
  if (cohortBtn) {
    cohortBtn.addEventListener('click', () => {
      const r = applyAutoClassificationToAllCandidates({ confidenceFloor: 'low' });
      flashStatus(`cohort auto-fill: ${r.totalApplied} filled, ${r.totalSkipped} skipped`);
      rerender();
    });
  }

  // Picker (dropdown) interactions
  const pickers = section.querySelectorAll('.hap-label-picker');
  pickers.forEach(picker => {
    const bandIdx = parseInt(picker.getAttribute('data-band-idx'), 10);
    const customInput = section.querySelector(`.hap-label-custom[data-band-idx="${bandIdx}"]`);
    picker.addEventListener('change', () => {
      const v = picker.value;
      if (v === '__custom__') {
        // Reveal custom input, focus it, don't save yet
        if (customInput) {
          customInput.style.display = 'inline-block';
          customInput.focus();
        }
      } else {
        if (customInput) customInput.style.display = 'none';
        setHaplotypeLabel(c, bandIdx, v);
        flashStatus(`band ${bandIdx} → ${v || '(cleared)'}`);
      }
    });
    // Arrow-key navigation: Up/Down cycles the picker; Tab moves to next band
    picker.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        const next = section.querySelector(`.hap-label-picker[data-band-idx="${bandIdx + 1}"]`);
        if (next) next.focus();
      }
    });
  });

  // Custom-input handlers
  const customs = section.querySelectorAll('.hap-label-custom');
  customs.forEach(custom => {
    const bandIdx = parseInt(custom.getAttribute('data-band-idx'), 10);
    let debounce = null;
    custom.addEventListener('input', () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        setHaplotypeLabel(c, bandIdx, custom.value);
        flashStatus(`band ${bandIdx} → ${custom.value || '(cleared)'}`);
      }, 250);
    });
    custom.addEventListener('change', () => {
      setHaplotypeLabel(c, bandIdx, custom.value);
      flashStatus(`band ${bandIdx} → ${custom.value || '(cleared)'}`);
    });
  });

  // Free-text handlers (vocab=free)
  const frees = section.querySelectorAll('.hap-label-free');
  frees.forEach(inp => {
    const bandIdx = parseInt(inp.getAttribute('data-band-idx'), 10);
    let debounce = null;
    inp.addEventListener('input', () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        setHaplotypeLabel(c, bandIdx, inp.value);
        flashStatus(`band ${bandIdx} saved`);
      }, 250);
    });
    inp.addEventListener('change', () => {
      setHaplotypeLabel(c, bandIdx, inp.value);
      flashStatus(`band ${bandIdx} saved`);
    });
  });
}

// --- _wireCandidateBandClicks — extracted from legacy ---
export function _wireCandidateBandClicks(c, bands) {
  const state = _pageState;
  if (!c || !Array.isArray(bands)) return;
  const grid = document.getElementById('candBandGrid');
  if (!grid) return;
  const cards = grid.querySelectorAll('.cand-band-card');
  cards.forEach(card => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.getAttribute('data-band-idx'), 10);
      if (Number.isNaN(idx)) return;
      const band = bands[idx];
      if (!band || !Array.isArray(band.members) || band.members.length === 0) return;
      // Highlight active card
      cards.forEach(cc => {
        cc.style.borderColor = '';
        cc.style.background = '';
      });
      card.style.borderColor = '#f5a524';
      card.style.background = 'rgba(245, 165, 36, 0.08)';
      // Set tracked
      const _state = (typeof window !== 'undefined' && window.state) ? window.state : state;
      _state.tracked = band.members.slice();
      // Render the genome-wide linkage table
      _renderGenomeLinkageTable(c, idx, band);
      // Force a redraw of the main lines panel if drawLines exists
      if (typeof drawLines === 'function') {
        try { drawLines(); } catch (_) {}
      }
    });
  });
}

// --- _wireCandidateRegimeRow — extracted from legacy ---
export function _wireCandidateRegimeRow(c) {
  if (!c) return;
  document.querySelectorAll('[data-cand-regime-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.candRegimeAction;
      if (action === 'open') {
        _openRegimeDialog({ mode: 'list' });
      } else if (action === 'assign') {
        const l2Ids = _candidateL2Ids(c);
        // v4 turn 48: read the staged track from the button. Defaults
        // to 0 (single-track / back-compat).
        const trackStr = btn.dataset.candRegimeTrack;
        const stagedTrackIdx = trackStr != null ? parseInt(trackStr, 10) : 0;
        _openRegimeDialog({
          mode: 'assign',
          stagedL2Ids: l2Ids,
          stagedCandId: c.id,
          stagedTrackIdx: Number.isInteger(stagedTrackIdx) ? stagedTrackIdx : 0,
        });
      }
    });
  });
  document.querySelectorAll('[data-cand-regime-edit]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rid = btn.dataset.candRegimeEdit;
      _openRegimeDialog({ mode: 'edit', editId: rid });
    });
  });
}

// --- _wireCandidateDosageHeatmap — extracted from legacy ---
export function _wireCandidateDosageHeatmap(c) {
  if (!c) return;
  const sec = document.querySelector(`.dh-section[data-cand-id="${c.id}"]`);
  if (!sec) return;
  const canvas = sec.querySelector('canvas.dh-canvas');
  if (!canvas) return;
  const infoSlot = sec.querySelector('[data-dh-info]');
  const hm = _ensureDosageHmState();
  hm.candidate_id = c.id;
  // Toolbar event wiring (cap buttons + sq button)
  sec.querySelectorAll('.dh-cap-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const n = parseInt(btn.dataset.cap, 10);
      if (!Number.isFinite(n)) return;
      hm.cap_n = n;
      sec.querySelectorAll('.dh-cap-btn').forEach(b =>
        b.classList.toggle('active', parseInt(b.dataset.cap, 10) === n));
      _redrawCandidateHeatmap(c, canvas, infoSlot);
    });
  });
  const sqBtn = sec.querySelector('.dh-sq-btn');
  if (sqBtn) {
    sqBtn.addEventListener('click', () => {
      const chunk = hm.last_chunk;
      if (!chunk) {
        sqBtn.textContent = 'load dosage first';
        sqBtn.disabled = true;
        setTimeout(() => { sqBtn.textContent = 'Compute stripe quality'; sqBtn.disabled = false; }, 1500);
        return;
      }
      sqBtn.textContent = 'computing…';
      sqBtn.disabled = true;
      // Run on next tick so the label paints
      setTimeout(() => {
        const lk = _buildSampleLookups(chunk, c);
        const rows = computeStripeQuality(chunk, lk._groupOfSample, lk._pc1OfSample);
        hm.last_sq = { candidate_id: c.id, rows };
        sqBtn.textContent = `recompute (${rows.filter(r => r.stripe_quality === 'core').length} core)`;
        sqBtn.disabled = false;
        _redrawCandidateHeatmap(c, canvas, infoSlot);
      }, 0);
    });
  }
  // Initial draw
  _redrawCandidateHeatmap(c, canvas, infoSlot);
}

// ---------------------------------------------------------------------------
// 2026-05-29: candidate dosage-heatmap renderer (ported).
//
// Fetches a dosage chunk for the candidate's bp range from the
// /api/dosage/chunk bridge, adapts it with the dedicated dosage_heatmap
// page's legacy-chunk adapter, and paints it with that page's canonical
// painter (blue→white→red divergent dosage ramp). Samples are grouped by
// the candidate's locked K-means band so the group track + by-group
// ordering surface the karyotype structure.
//
// An in-flight token guards against rapid cap-button clicks (only the
// latest fetch paints). Fail-soft: every error path writes a one-line
// reason into the info slot instead of throwing.
// ---------------------------------------------------------------------------
let _candHeatmapReqId = 0;

async function _redrawCandidateHeatmap(c, canvas, infoSlot) {
  if (!c || !canvas) return;
  const state = _pageState;
  const hm = _ensureDosageHmState();
  const setInfo = (msg) => { if (infoSlot) infoSlot.textContent = msg; };
  const chrom = c.chrom || (state && state.data && state.data.chrom) || null;
  const startBp = Number.isFinite(c.start_bp) ? (c.start_bp | 0) : null;
  const endBp   = Number.isFinite(c.end_bp)   ? (c.end_bp   | 0) : null;
  if (!chrom || startBp == null || endBp == null || endBp <= startBp) {
    setInfo('candidate has no bp range');
    return;
  }
  const cap = (hm.cap_n | 0) || 200;

  // Prefer the synthetic dosage_chunks index template when present;
  // else hit the canonical bridge endpoint directly.
  const dc = state && state.data && state.data.dosage_chunks;
  const tmpl = (dc && Array.isArray(dc.chunks) && dc.chunks[0] && (dc.chunks[0].url || dc._endpoint)) || null;
  let url;
  if (tmpl && tmpl.indexOf('__START__') >= 0) {
    url = tmpl.replace('__CHROM__', encodeURIComponent(chrom))
              .replace('__START__', String(startBp))
              .replace('__END__',   String(endBp))
              .replace('__CAP__',   String(cap));
  } else {
    url = `/api/dosage/chunk?chrom=${encodeURIComponent(chrom)}&start=${startBp}&end=${endBp}&cap=${cap}`;
  }

  setInfo('loading dosage…');
  const myReq = ++_candHeatmapReqId;
  let chunk = null;
  try {
    const r = await fetch(url);
    if (!r.ok) { setInfo(`dosage chunk HTTP ${r.status} — is atlas_server.py running?`); return; }
    chunk = await r.json();
  } catch (_) {
    setInfo('dosage chunk fetch failed — is atlas_server.py running?');
    return;
  }
  if (myReq !== _candHeatmapReqId) return;   // a newer cap click superseded us
  if (!chunk || !Array.isArray(chunk.markers) || !Array.isArray(chunk.dosage) || chunk.markers.length === 0) {
    setInfo('no dosage markers in this candidate range');
    return;
  }
  hm.last_chunk = chunk;

  const lk = _buildSampleLookups(chunk, c);
  const sample_group = _sampleGroupArray(chunk, lk);
  const data = adaptLegacyChunk(chunk, { sample_group });
  if (!data) { setInfo('could not adapt dosage chunk'); return; }

  fitCanvasNoDpr(canvas);
  try {
    const sample_order = deriveSampleOrder(
      sample_group ? 'by_group' : 'natural', data.n_samples, data);
    paintDosageHeatmap(canvas, data, {
      sample_order,                            // derived order array (by band when grouped)
      color_mode:          'dosage',           // blue→white→red divergent
      vmin: 0, vmax: 2,
      show_group_track:    !!sample_group,
      show_polarity_track: false,
    });
  } catch (e) {
    setInfo('heatmap paint failed: ' + (e && e.message ? e.message : 'error'));
    return;
  }
  const mb = ((endBp - startBp) / 1e6).toFixed(2);
  let info = `${chunk.markers.length} markers · ${chunk.samples.length} samples · ${mb} Mb`;
  // Fold in the stripe-quality tier breakdown when it's been computed for
  // THIS candidate (the "Compute stripe quality" button populates last_sq).
  if (hm.last_sq && hm.last_sq.candidate_id === c.id && Array.isArray(hm.last_sq.rows)) {
    const t = { core: 0, peripheral: 0, junk: 0 };
    for (const r of hm.last_sq.rows) if (t[r.stripe_quality] != null) t[r.stripe_quality]++;
    info += ` · stripe: ${t.core} core / ${t.peripheral} periph / ${t.junk} junk`;
  }
  setInfo(info);
}

// Build the per-(chunk-sample) group array (HOMO_1 / HET / HOMO_2 / null)
// from the lookup callbacks, for the heatmap's group track + by-group
// ordering. Returns null when no sample resolves a group.
function _sampleGroupArray(chunk, lk) {
  if (!chunk || !Array.isArray(chunk.samples) || !lk) return null;
  const out = new Array(chunk.samples.length);
  let any = false;
  for (let i = 0; i < chunk.samples.length; i++) {
    const g = lk._groupOfSample(i);
    out[i] = g || null;
    if (g) any = true;
  }
  return any ? out : null;
}

// 2026-05-29: ported from legacy Inversion_atlas.html (16935). Maps each
// chunk sample index → its coarse karyotype group + a PC1-like score,
// returned as callbacks (the shape computeStripeQuality expects).
// Group source priority: candidate.fish_calls regime (already karyotype-
// classified) → locked_labels band index → the L2 envelope at the cursor.
function _buildSampleLookups(chunk, cand) {
  const state = _pageState;
  const cohortSamples = (state && state.data && state.data.samples) ? state.data.samples : [];
  const NAMES3 = ['HOMO_1', 'HET', 'HOMO_2'];
  // sample-id → cohort index.
  const idToCohort = new Map();
  for (let ci = 0; ci < cohortSamples.length; ci++) {
    const s = cohortSamples[ci];
    for (const id of [s && s.id, s && s.cga, s && s.ind, s && s.sample]) {
      if (id != null) idToCohort.set(String(id).toUpperCase(), ci);
    }
  }
  const chunkToCohort = new Array(chunk.samples.length);
  for (let i = 0; i < chunk.samples.length; i++) {
    const key = String(chunk.samples[i]).toUpperCase();
    chunkToCohort[i] = idToCohort.has(key) ? idToCohort.get(key) : -1;
  }

  function _groupOfSample(chunkSi) {
    const ci = chunkToCohort[chunkSi];
    if (ci < 0) return null;
    // 1. candidate.fish_calls regime (already karyotype-classified).
    if (cand && Array.isArray(cand.fish_calls)) {
      const fc = cand.fish_calls.find(f => f && f.sample_idx === ci);
      if (fc && fc.regime != null) {
        const K = cand.K || 3;
        return (K === 3) ? (NAMES3[fc.regime] || null) : `g${fc.regime}`;
      }
    }
    // 2. locked_labels band index (raw K-means band → karyotype by index).
    const labels = cand && (cand.locked_labels || cand.labels);
    if (Array.isArray(labels) && Number.isInteger(labels[ci]) && labels[ci] >= 0) {
      const lab = labels[ci];
      return NAMES3[lab] || `g${lab}`;
    }
    // 3. L2 envelope at the cursor (cursor-mode fallback).
    const cur = Number.isFinite(state && state.cur) ? (state.cur | 0) : 0;
    if (state && state.data && Array.isArray(state.data.l2_envelopes)) {
      const env = state.data.l2_envelopes.find(e =>
        e && e._s0 != null && cur >= e._s0 && cur <= e._e0);
      if (env && env.labels && env.labels[ci] != null) {
        const lbl = env.labels[ci];
        return NAMES3[lbl] || `g${lbl}`;
      }
    }
    return null;
  }

  function _pc1OfSample(chunkSi) {
    const ci = chunkToCohort[chunkSi];
    if (ci < 0) return 0;
    if (cand && Array.isArray(cand.fish_calls)) {
      const fc = cand.fish_calls.find(f => f && f.sample_idx === ci);
      if (fc && Number.isFinite(fc.u))   return fc.u;
      if (fc && Number.isFinite(fc.pc1)) return fc.pc1;
    }
    return 0;   // fallback: group ordering only
  }

  return { _groupOfSample, _pc1OfSample };
}

// 2026-05-29: ported verbatim from legacy Inversion_atlas.html (15901).
// Per-sample stripe-quality tier (core / peripheral / junk) from the
// dosage chunk: agreement_fraction over informative markers (those whose
// HOMO_1↔HOMO_2 mean dosage differ most) + a centroid-z on the band's
// PC1 distribution. STEP29 candidate-coherence pipeline.
function computeStripeQuality(chunk, sampleGroup, samplePC1) {
  const nSamples = chunk.samples.length;
  const nMarkers = chunk.markers.length;
  const grpOf = new Array(nSamples);
  const grpIdx = { HOMO_1: [], HET: [], HOMO_2: [] };
  for (let si = 0; si < nSamples; si++) {
    const g = sampleGroup(si);
    grpOf[si] = g;
    if (grpIdx[g]) grpIdx[g].push(si);
  }
  const grpMean = {
    HOMO_1: new Float64Array(nMarkers),
    HET:    new Float64Array(nMarkers),
    HOMO_2: new Float64Array(nMarkers),
  };
  for (const g of ['HOMO_1', 'HET', 'HOMO_2']) {
    const idxs = grpIdx[g];
    if (idxs.length < 2) {
      for (let mi = 0; mi < nMarkers; mi++) grpMean[g][mi] = NaN;
      continue;
    }
    for (let mi = 0; mi < nMarkers; mi++) {
      const row = chunk.dosage[mi];
      let n = 0, sum = 0;
      for (const si of idxs) {
        const v = row[si];
        if (v == null || !Number.isFinite(v) || v < 0) continue;
        n++; sum += v;
      }
      grpMean[g][mi] = (n > 0) ? sum / n : NaN;
    }
  }
  const absDelta = new Float64Array(nMarkers);
  for (let mi = 0; mi < nMarkers; mi++) {
    const d = grpMean.HOMO_2[mi] - grpMean.HOMO_1[mi];
    absDelta[mi] = Number.isFinite(d) ? Math.abs(d) : 0;
  }
  const sortedAbs = Array.from(absDelta).sort((a, b) => a - b);
  const q75 = sortedAbs[Math.floor(sortedAbs.length * 0.75)];
  const infoThresh = Math.max(q75, 0.1);
  let infoIdx = [];
  for (let mi = 0; mi < nMarkers; mi++) if (absDelta[mi] >= infoThresh) infoIdx.push(mi);
  if (infoIdx.length < 10) {
    const ranked = Array.from({ length: nMarkers }, (_, mi) => mi);
    ranked.sort((a, b) => absDelta[b] - absDelta[a]);
    infoIdx = ranked.slice(0, Math.min(50, nMarkers));
  }
  const pc1Stats = {};
  for (const g of ['HOMO_1', 'HET', 'HOMO_2']) {
    const vals = grpIdx[g].map(samplePC1).filter(Number.isFinite);
    if (vals.length === 0) { pc1Stats[g] = null; continue; }
    vals.sort((a, b) => a - b);
    const median = vals[(vals.length - 1) >> 1];
    const dev = vals.map(v => Math.abs(v - median));
    dev.sort((a, b) => a - b);
    const mad = dev[(dev.length - 1) >> 1];
    pc1Stats[g] = { median, mad: mad > 0 ? mad : 1 };
  }
  const out = [];
  for (let si = 0; si < nSamples; si++) {
    const g = grpOf[si];
    let agreeFrac = NaN;
    if (g && grpMean[g] && grpIdx[g].length >= 2) {
      const others = ['HOMO_1', 'HET', 'HOMO_2'].filter(x => x !== g);
      let nValid = 0, nOwnCloser = 0;
      for (const mi of infoIdx) {
        const x = chunk.dosage[mi][si];
        if (x == null || !Number.isFinite(x) || x < 0) continue;
        const own = grpMean[g][mi];
        const otherMean = (grpMean[others[0]][mi] + grpMean[others[1]][mi]) / 2;
        if (!Number.isFinite(own) || !Number.isFinite(otherMean)) continue;
        const dOwn = Math.abs(x - own);
        const dOther = Math.abs(x - otherMean);
        nValid++;
        if (dOwn < dOther) nOwnCloser++;
      }
      if (nValid > 0) agreeFrac = nOwnCloser / nValid;
    }
    let cohClass;
    if (Number.isNaN(agreeFrac) || agreeFrac == null) {
      cohClass = 'insufficient';
    } else if (g === 'HET') {
      cohClass = (agreeFrac >= 0.55) ? 'coherent'
               : (agreeFrac >= 0.40) ? 'intermediate'
               : 'discordant';
    } else {
      cohClass = (agreeFrac >= 0.70) ? 'coherent'
               : (agreeFrac >= 0.45) ? 'intermediate'
               : 'discordant';
    }
    let centroidZ = NaN;
    const pc1 = samplePC1(si);
    if (g && pc1Stats[g] && Number.isFinite(pc1)) {
      centroidZ = (pc1 - pc1Stats[g].median) / pc1Stats[g].mad;
    }
    let tier;
    if (g === 'HET') {
      tier = (cohClass === 'coherent') ? 'core'
           : (cohClass === 'intermediate' && Number.isFinite(centroidZ) && centroidZ < 3) ? 'peripheral'
           : (cohClass === 'discordant') ? 'junk'
           : 'peripheral';
    } else if (g === 'HOMO_1' || g === 'HOMO_2') {
      tier = (cohClass === 'coherent' && Number.isFinite(centroidZ) && centroidZ < 2) ? 'core'
           : ((cohClass === 'coherent' || cohClass === 'intermediate') &&
              Number.isFinite(centroidZ) && centroidZ < 4) ? 'peripheral'
           : 'junk';
    } else {
      tier = 'unknown';
    }
    out.push({
      sample: chunk.samples[si],
      coarse_group: g || 'unknown',
      agreement_fraction: Number.isFinite(agreeFrac) ? agreeFrac : null,
      coherence_class: cohClass,
      centroid_z_score: Number.isFinite(centroidZ) ? centroidZ : null,
      stripe_quality: tier,
      tier_rule: `coherence=${cohClass};z=${Number.isFinite(centroidZ) ? centroidZ.toFixed(1) : 'NA'};group=${g || 'unknown'}`,
      n_informative_markers: infoIdx.length,
    });
  }
  return out;
}
