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
import { candidateHaplotypeAnnotationsHtml, _candidateL2Ids } from './_html_builders.js';
import { addCandidateToList, candidateFromJSON, candidateToJSON, isInCandidateList } from './_list.js';
import { refreshCandidateUI } from '../candidate_focus.js';

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
