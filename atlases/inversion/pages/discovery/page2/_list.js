// pages/discovery/page2/_list.js
//
// Candidate-list management sub-module for page2 (chat 36 round 5
// step 2, 2026-05-07). 8 functions that manage state.candidateList:
// JSON serialization, position-sorted indexing, the list-pane DOM,
// and persistence to localStorage.
//
// All bodies extracted byte-verbatim from legacy/Inversion_atlas.html.
// State shim same as _html_builders.js.
//
// Note: refreshCandidateUI and _navigateToCandidate are in page2.js
// main (not here) because they orchestrate full-page re-renders by
// calling renderCandidateMetadata. Keeping them in main avoids a
// _list.js → page2.js → _list.js parse-time cycle and matches the
// page1 round-4 pattern of orchestrators living in main.

import { _pageState } from './_state.js';
import { refreshCandidateUI } from '../page2.js';
import { persistActiveCandidateId } from '../../../shared/active_candidate.js';
import { isAutoCandidate } from '../page1/inheritance.js';

// ---------------------------------------------------------------------------
// Module-private constants (extracted from legacy)
// ---------------------------------------------------------------------------

// _candIdCounter — legacy line 56789. Incremented per makeCandidateId.
let _candIdCounter = 0;

// MAX_TRACKS — legacy line 56960. v4 turn 36: cap candidate.tracks length.
const MAX_TRACKS = 2;

// _CAND_STORAGE_PREFIX — legacy line 57304. localStorage namespace prefix.
const _CAND_STORAGE_PREFIX = 'pca_scrubber_v3.candidates.';

// ---------------------------------------------------------------------------
// Page2-private helpers (extracted from legacy)
// ---------------------------------------------------------------------------

// --- makeCandidateId — legacy line 56790 ---
function makeCandidateId() {
  _candIdCounter++;
  return 'cand_' + Date.now().toString(36) + '_' + _candIdCounter.toString(36) +
         '_' + Math.random().toString(36).slice(2, 6);
}

// --- _candStorageKey — legacy line 57306 ---
function _candStorageKey(chrom) {
  return _CAND_STORAGE_PREFIX + (chrom || '_unknown');
}

// --- _defaultSingleTrack — legacy line 56964 ---
// v4 turn 36: builds the default single-track payload for old candidates
// (back-compat). Mirrors the cand-level fields onto track[0].
function _defaultSingleTrack(cand) {
  const K = (cand && Number.isInteger(cand.K) && cand.K > 0) ? cand.K : 3;
  const active_bands = [];
  for (let i = 0; i < K; i++) active_bands.push(i);
  return {
    track_idx: 0,
    active_bands,
    regime_id: (cand && cand.regime_id) || null,
    confirmed: !!(cand && cand.confirmed),
    notes:     (cand && cand.notes) || '',
    aggregate_concordance:  (cand && isFinite(cand.aggregate_concordance))
                              ? cand.aggregate_concordance : null,
    band_continuity_pct:    (cand && isFinite(cand.band_continuity_pct))
                              ? cand.band_continuity_pct : null,
    band_continuity_verdict:(cand && cand.band_continuity_verdict) || null,
    regime_counts:          (cand && Array.isArray(cand.regime_counts))
                              ? cand.regime_counts.slice() : null,
    fish_calls:             (cand && Array.isArray(cand.fish_calls))
                              ? cand.fish_calls : null,
  };
}

// --- _ensureTracks — legacy line 56992 ---
// v4 turn 36: normalize candidate.tracks. Synthesize default if missing.
// Cap at MAX_TRACKS. Defensive cleaning of per-track fields.
function _ensureTracks(cand) {
  if (!cand) return null;
  const K = Number.isInteger(cand.K) ? cand.K : 3;
  let tracks = Array.isArray(cand.tracks) ? cand.tracks : null;

  // Missing or empty → synthesize default single-track.
  if (!tracks || tracks.length === 0) {
    cand.tracks = [_defaultSingleTrack(cand)];
    return cand.tracks;
  }

  // Cap at MAX_TRACKS.
  if (tracks.length > MAX_TRACKS) {
    console.warn(`[v4 turn 36] candidate ${cand.id || '?'} has ${tracks.length} tracks; truncating to ${MAX_TRACKS}`);
    tracks = tracks.slice(0, MAX_TRACKS);
  }

  // Per-track normalization
  const cleaned = tracks.map((t, idx) => {
    if (!t || typeof t !== 'object') t = {};
    let bands = Array.isArray(t.active_bands) ? t.active_bands : null;
    if (!bands || bands.length === 0) bands = bands || [];
    bands = bands.filter(b => Number.isInteger(b) && b >= 0 && b < K);
    return {
      track_idx: Number.isInteger(t.track_idx) ? t.track_idx : idx,
      active_bands: bands,
      regime_id: t.regime_id || null,
      confirmed: !!t.confirmed,
      notes: typeof t.notes === 'string' ? t.notes : '',
      aggregate_concordance:   isFinite(t.aggregate_concordance)   ? t.aggregate_concordance   : null,
      band_continuity_pct:     isFinite(t.band_continuity_pct)     ? t.band_continuity_pct     : null,
      band_continuity_verdict: t.band_continuity_verdict           || null,
      regime_counts:           Array.isArray(t.regime_counts) ? t.regime_counts.slice() : null,
      fish_calls:              Array.isArray(t.fish_calls)    ? t.fish_calls            : null,
    };
  });

  cand.tracks = cleaned;
  return cand.tracks;
}

// --- isInCandidateList — extracted from legacy line 57409 (page2-private) ---
// Tiny predicate. Used by addCandidateToList and by _wires/_html_builders
// to render add/remove buttons in the candidate header.
export function isInCandidateList(id) {
  const state = _pageState;
  return state.candidateList.some(c => c.id === id);
}

// --- addCandidateToList — extracted from legacy ---
export function addCandidateToList(cand) {
  const state = _pageState;
  if (!cand || !cand.id) return;
  if (isInCandidateList(cand.id)) return;   // already there
  state.candidateList.push(cand);
  persistCandidateList();
  refreshCandidateListUI(state);
  refreshCandidateUI(state);
}

// --- persistCandidateList — extracted from legacy ---
export function persistCandidateList() {
  const state = _pageState;
  if (!state.data) return;
  // turn 129: keep state.candidates (dict, read by inheritance compute)
  // in sync with state.candidateList (array, mutated by every UI surface).
  // Pre-bridge, this dict was only ever populated by Save-Session import,
  // so interactively-saved candidates never reached runInheritanceCompute()
  // and the grouping / I·g pills stayed empty. Idempotent + cheap.
  if (typeof _rebuildCandidateRegistries === 'function') {
    try { _rebuildCandidateRegistries(); } catch (_) {}
  }
  // turn 153: candidate-list mutations are the canonical trigger for
  // inheritance recompute. Pre-turn-153 the I·g pills auto-detected
  // staleness on draw via the cache-key compare, but the G-panel
  // inheritance tab and the matrix popup did NOT — they rendered against
  // whatever state.inheritanceResult happened to hold. After this hook,
  // every add / remove / import / L3-commit / refinement that funnels
  // through persistCandidateList invalidates the inheritance cache when
  // the candidate set has actually changed, and notifies open consumers.
  // Cheap (one O(N) hash + one map walk); idempotent (no-op when keys
  // match, e.g. when persistCandidateList is called for non-list-changing
  // reasons like favorites toggles in the Save-Session payload).
  if (typeof _autoRegisterInheritanceOnCandidateChange === 'function') {
    try { _autoRegisterInheritanceOnCandidateChange(); } catch (_) {}
  }
  try {
    const key = _candStorageKey(state.data.chrom);
    const arr = state.candidateList.map(candidateToJSON);
    localStorage.setItem(key, JSON.stringify(arr));
  } catch (e) {
    // localStorage may be unavailable (private mode, quota exceeded, etc.).
    // We surface the failure but don't crash — the list still works in memory.
    console.warn('[candidate] persist failed:', e.message);
  }
}

// --- refreshCandidateListUI — extracted from legacy ---
export function refreshCandidateListUI() {
  const state = _pageState;
  const container = document.getElementById('candListContainer');
  const counter = document.getElementById('candListCount');
  if (!container) return;
  if (counter) counter.textContent = String(state.candidateList.length);
  if (state.candidateList.length === 0) {
    container.innerHTML =
      '<div class="cand-list-empty">No saved candidates for this chromosome.<br><br>' +
      'On page 2, click <b>★ add to list</b> to save the active candidate here.</div>';
    return;
  }
  // v3.82: helper for the K=6 nesting chip. Returns inline HTML or empty
  // string when the candidate has no K=6 substructure data (e.g. loaded
  // from an older JSON without a K6 pass). Tooltip carries the purity
  // counts so the user can hover for "X of Y K6 groups pure".
  function _subbandChipHTML(cand) {
    const sub = cand.k6_substructure;
    if (!sub || !sub.verdict) return '';
    const v = sub.verdict;  // 'NESTED' | 'MIXED' | 'CROSS_CUTTING' | 'NO_DATA'
    const verdict = v === 'NO_DATA' ? 'NA' : v;
    const label = verdict === 'NESTED'        ? 'K6 nested'
                : verdict === 'MIXED'         ? 'K6 mixed'
                : verdict === 'CROSS_CUTTING' ? 'K6 cross'
                                              : 'K6 –';
    const np = sub.n_pure != null ? sub.n_pure : '?';
    const nd = sub.n_with_data != null ? sub.n_with_data : '?';
    const thr = sub.purity_threshold != null
      ? sub.purity_threshold.toFixed(2) : '0.80';
    const tip = `K=6 substructure verdict: ${verdict}\n` +
                `${np}/${nd} K6 groups pure (purity ≥ ${thr})\n` +
                (verdict === 'NESTED'
                  ? 'Sub-bands cleanly nest inside K=3 majors → keep as g0a/g0b annotation'
                  : verdict === 'CROSS_CUTTING'
                  ? 'K=6 cuts across K=3 majors → possible second system'
                  : verdict === 'MIXED'
                  ? 'Partial nesting → review per-K6-group purity'
                  : 'No K=6 pass available for this candidate');
    return `<span class="cli-subband" data-verdict="${verdict}" title="${tip.replace(/"/g, '&quot;')}">${label}</span>`;
  }
  // Sort: confirmed (manual) candidates first by created_at descending; then
  // auto-promoted candidates (algorithm-proposed, awaiting user review) at
  // the bottom. Auto candidates render with a dashed-border `.is-auto`
  // visual treatment + 🤖 prefix so they're immediately distinguishable
  // from user-confirmed ones. (turn 130 follow-up — review-surfaces spec.)
  const sorted = state.candidateList.slice().sort((a, b) => {
    const aAuto = isAutoCandidate(a);
    const bAuto = isAutoCandidate(b);
    if (aAuto !== bAuto) return aAuto ? 1 : -1;   // non-auto first
    return b.created_at - a.created_at;
  });
  // v4 turn 41 (Ask C step 6): two-track helpers reused from drawCandidateBar
  // (turn 40). Inline here so refreshCandidateListUI doesn't depend on the
  // canvas code path.
  function _isTwoTrackCand(cand) {
    return cand && Array.isArray(cand.tracks) && cand.tracks.length === 2 &&
           cand.tracks.every(t => t && Array.isArray(t.active_bands) &&
                                   t.active_bands.length > 0);
  }
  function _trackPrimaryBandColor(track) {
    if (!track || !Array.isArray(track.active_bands) ||
        track.active_bands.length === 0) return null;
    return (typeof groupColor === 'function')
      ? groupColor(track.active_bands[0]) : null;
  }
  // Format a track's active_bands as compact chips. Returns '' when the
  // track has all K bands active (= today's "use every cluster" semantics);
  // we show nothing rather than enumerating "g0,g1,...,gK-1" (too noisy
  // for the default case). Subset → comma-separated mini-swatches.
  function _trackBandsChipsHTML(track, K) {
    if (!track || !Array.isArray(track.active_bands)) return '';
    const ab = track.active_bands;
    if (ab.length === 0) return '';
    if (ab.length === K) return '';
    return ab.map(b => {
      const col = (typeof groupColor === 'function') ? groupColor(b) : '#888';
      return `<span class="cli-band-chip" style="background:${col};border-color:${col};">g${b}</span>`;
    }).join('');
  }
  container.innerHTML = sorted.map(c => {
    const isActive = state.candidate && state.candidate.id === c.id;
    const span_mb = (c.end_bp - c.start_bp) / 1e6;
    const id = (c.id || '').replace(/^cand_/, '');
    const nL2 = (c.l2_indices && c.l2_indices.length) || 0;
    const label = c.notes
      ? c.notes.slice(0, 40).replace(/</g, '&lt;')
      : `${(c.start_bp/1e6).toFixed(2)}–${(c.end_bp/1e6).toFixed(2)} Mb`;
    const subbandChip = _subbandChipHTML(c);
    // v4 turn 41: two-track marker in the title row + per-track meta lines
    // below the candidate meta. Single-track candidates render exactly as
    // before (the conditional blocks emit empty strings).
    const isTwoTrack = _isTwoTrackCand(c);
    // turn 130 follow-up: auto-promoted candidates wear a dashed outline
    // and 🤖 prefix so the user can scan the list and know which entries
    // are user-confirmed vs algorithm-proposed awaiting review.
    const isAuto = isAutoCandidate(c);
    const autoPrefix = isAuto ? '<span class="cli-auto-prefix" title="Algorithm-proposed candidate (auto-promoted from L2-sweep). Review and Confirm to add to your saved list, or Dismiss to drop.">🤖&nbsp;</span>' : '';
    let twoTrackBadge = '';
    let perTrackMeta = '';
    if (isTwoTrack) {
      const c1 = _trackPrimaryBandColor(c.tracks[0]) || '#888';
      const c2 = _trackPrimaryBandColor(c.tracks[1]) || '#888';
      twoTrackBadge =
        `<span class="cli-two-track-badge" title="Two-track candidate (overlapping inversions). Track 1 and track 2 share this region with different K-band assignments.">` +
        `<span class="cli-tt-pip" style="background:${c1};"></span>` +
        `<span class="cli-tt-pip" style="background:${c2};"></span>` +
        `</span>`;
      const K = c.K || 3;
      perTrackMeta = c.tracks.map((t, ti) => {
        const tColor = _trackPrimaryBandColor(t) || '#888';
        const bandsHtml = _trackBandsChipsHTML(t, K);
        const bandsLabel = bandsHtml
          ? bandsHtml
          : `<span class="cli-track-allbands">all ${K} bands</span>`;
        return `<div class="cli-track-row" title="Track ${ti + 1} of 2 — bands assigned to this parallel inversion call.">` +
               `<span class="cli-track-tag" style="border-color:${tColor};color:${tColor};">${ti + 1}/2</span>` +
               bandsLabel +
               `</div>`;
      }).join('');
    } else if (Array.isArray(c.tracks) && c.tracks.length === 1) {
      // Single-track with a non-default active_bands subset → show the
      // subset chips inline (one extra info row, no two-track badge). All-
      // bands-active single-tracks render unchanged from today.
      const t = c.tracks[0];
      const K = c.K || 3;
      const bandsHtml = _trackBandsChipsHTML(t, K);
      if (bandsHtml) {
        perTrackMeta = `<div class="cli-track-row" title="Active bands for this candidate (subset of K=${K} clusters).">${bandsHtml}</div>`;
      }
    }
    return `
      <div class="cand-list-item ${isActive ? 'active' : ''}${isTwoTrack ? ' two-track' : ''}${isAuto ? ' is-auto' : ''}" data-cid="${c.id}">
        <button class="cli-remove" data-cid="${c.id}" title="Remove from list">✕</button>
        <div class="cli-id">${autoPrefix}${twoTrackBadge}${label}</div>
        <div class="cli-meta">
          ${subbandChip}${c.chrom} · K=${c.K} · ${span_mb.toFixed(2)} Mb · ${nL2} L2${nL2 === 1 ? '' : 's'}
        </div>
        ${perTrackMeta}
      </div>
    `;
  }).join('');
  // Wire clicks: card → make active; ✕ → remove
  container.querySelectorAll('.cand-list-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.classList.contains('cli-remove')) return;   // handled below
      const cid = el.dataset.cid;
      const cand = state.candidateList.find(c => c.id === cid);
      if (cand) {
        // Make this the active candidate (deep copy so list stays separate)
        state.candidate = candidateFromJSON(candidateToJSON(cand));
        // v4 turn 56: persist the active candidate ID so reloads remember
        // which one the user was last working on from the sidebar list.
        persistActiveCandidateId(cand.id || '');
        refreshCandidateUI(state);
        refreshCandidateListUI(state);
        renderCandidateKaryotype();
      }
    });
  });
  container.querySelectorAll('.cli-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const cid = btn.dataset.cid;
      if (confirm('Remove this candidate from the saved list?')) {
        // turn 128: delegate to the canonical removeCandidateFully so this
        // path stays in sync with the page 2 ✕ button.
        removeCandidateFully(cid);
      }
    });
  });
}

// --- candidateToJSON — extracted from legacy ---
export function candidateToJSON(cand) {
  if (!cand) return null;
  return {
    id:            cand.id,
    source:        cand.source,
    chrom:         cand.chrom,
    l2_indices:    Array.from(cand.l2_indices),
    ref_l2:        cand.ref_l2,
    ref_window:    cand.ref_window,
    K:             cand.K,
    locked_labels: cand.locked_labels ? Array.from(cand.locked_labels) : null,
    start_w:       cand.start_w,
    end_w:         cand.end_w,
    start_bp:      cand.start_bp,
    end_bp:        cand.end_bp,
    created_at:    cand.created_at,
    notes:         cand.notes || '',
    confirmed:     !!cand.confirmed,           // v3.47: user-flagged "confirmed" candidates
    // v4 turn 10 (SCHEMA §24): window-resolution + L3-cuts round-trip.
    // Old candidates without these fields read back as resolution='L2' and
    // l3_cuts=[] in candidateFromJSON, preserving back-compat.
    resolution:    cand.resolution || 'L2',
    l3_cuts:       Array.isArray(cand.l3_cuts) ? cand.l3_cuts.slice() : [],
    // v4 turn 35: parent_split_id links sibling candidates emitted by the
    // same split-commit. null when this candidate was committed without
    // splits. Old candidates without this field read back as null.
    parent_split_id: cand.parent_split_id || null,
    // v4 turn 47: top-level metric round-trip. Pre-turn-47 these were
    // computed at commit and dropped on save/load. Pure correctness fix
    // — turn 45's registry export reads c.regime_counts for the
    // regime_counts_whole_region column; turn 46's fish_regime_calls
    // export iterates c.fish_calls. Without round-trip, both produce
    // 'NA'/empty after a save+load cycle. _recomputePerTrackAssignments
    // (turn 44) also benefits — it can now re-derive per-track values
    // after load instead of relying on the per-track payload alone.
    aggregate_concordance:   isFinite(cand.aggregate_concordance)
                                ? cand.aggregate_concordance : null,
    band_continuity_pct:     isFinite(cand.band_continuity_pct)
                                ? cand.band_continuity_pct : null,
    band_continuity_verdict: cand.band_continuity_verdict || null,
    regime_counts:           Array.isArray(cand.regime_counts)
                                ? cand.regime_counts.slice() : null,
    fish_calls:              Array.isArray(cand.fish_calls)
                                ? cand.fish_calls.slice() : null,
    qc_status:               cand.qc_status || null,
    // v4 turn 51: extend the round-trip to cover the remaining commit-
    // time + page-3 user-curated fields. Boundaries are particularly
    // important — pre-turn-51, every browser reload silently dropped
    // user-curated boundary work because persistCandidateList →
    // candidateToJSON omitted these fields.
    //
    //   interval_roles      — array of {l2_idx, role}, set at commit.
    //                         Without it, interval_support.tsv is empty
    //                         post-load (mirrors turn 47's fish_calls fix).
    //   band_diagnostics    — object, set at commit. Used by
    //                         band_diagnostics.tsv export.
    //   k6_substructure     — object, set at commit. Used by registry
    //                         export's subband_nesting_status column.
    //   boundary_left       — page-3-curated record (zone_start_bp,
    //                         zone_end_bp, score, support, etc.). User
    //                         effort.
    //   boundary_right      — same as left, for the right zone.
    //   breakpoint_status   — page-3 enum: boundary_zone_only |
    //                         exact_breakpoint | unrefined.
    //   boundary_notes      — page-3 free-text notes.
    //
    // All seven fields read back as undefined in candidateFromJSON when
    // missing from the source JSON (preserves back-compat with pre-turn-51
    // saves; downstream consumers gracefully degrade).
    interval_roles:    Array.isArray(cand.interval_roles)
                          ? cand.interval_roles.map(r => ({ ...r })) : null,
    band_diagnostics:  (cand.band_diagnostics && typeof cand.band_diagnostics === 'object')
                          ? cand.band_diagnostics : null,
    k6_substructure:   (cand.k6_substructure && typeof cand.k6_substructure === 'object')
                          ? cand.k6_substructure : null,
    boundary_left:     (typeof _bndCloneRecord === 'function')
                          ? _bndCloneRecord(cand.boundary_left)
                          : (cand.boundary_left || null),
    boundary_right:    (typeof _bndCloneRecord === 'function')
                          ? _bndCloneRecord(cand.boundary_right)
                          : (cand.boundary_right || null),
    breakpoint_status: cand.breakpoint_status || null,
    boundary_notes:    cand.boundary_notes || null,
    // v4 turn 36 (Ask C step 1): tracks payload. Always emitted as an array
    // of length 1..MAX_TRACKS with normalized per-track fields. Missing
    // tracks on a cand object → emit a single-track default.
    tracks: (Array.isArray(cand.tracks) && cand.tracks.length > 0)
              ? cand.tracks.map(t => ({
                  track_idx: t.track_idx,
                  active_bands: Array.isArray(t.active_bands) ? t.active_bands.slice() : [],
                  regime_id: t.regime_id || null,
                  confirmed: !!t.confirmed,
                  notes: t.notes || '',
                  aggregate_concordance:   isFinite(t.aggregate_concordance)   ? t.aggregate_concordance   : null,
                  band_continuity_pct:     isFinite(t.band_continuity_pct)     ? t.band_continuity_pct     : null,
                  band_continuity_verdict: t.band_continuity_verdict           || null,
                  regime_counts:           Array.isArray(t.regime_counts) ? t.regime_counts.slice() : null,
                  fish_calls:              Array.isArray(t.fish_calls)    ? t.fish_calls.slice()    : null,
                }))
              : [_defaultSingleTrack(cand)],
  };
}

// --- candidateFromJSON — extracted from legacy ---
export function candidateFromJSON(obj) {
  if (!obj) return null;
  const cand = {
    id:            obj.id || makeCandidateId(),
    source:        obj.source,
    chrom:         obj.chrom,
    l2_indices:    Array.isArray(obj.l2_indices) ? obj.l2_indices : [],
    ref_l2:        obj.ref_l2,
    ref_window:    obj.ref_window,
    K:             obj.K,
    locked_labels: obj.locked_labels ? new Int8Array(obj.locked_labels) : null,
    start_w:       obj.start_w,
    end_w:         obj.end_w,
    start_bp:      obj.start_bp,
    end_bp:        obj.end_bp,
    created_at:    obj.created_at || Date.now(),
    notes:         obj.notes || '',
    confirmed:     !!obj.confirmed,
    // v4 turn 10 (SCHEMA §24): default to L2 resolution for old candidates
    // that don't carry these fields. Empty l3_cuts list preserves "no cuts".
    resolution:    (obj.resolution === 'W') ? 'W' : 'L2',
    l3_cuts:       Array.isArray(obj.l3_cuts) ? obj.l3_cuts.slice() : [],
    // v4 turn 35: parent_split_id round-trips. Missing → null (back-compat).
    parent_split_id: obj.parent_split_id || null,
    // v4 turn 47: top-level metric round-trip (mirrors candidateToJSON).
    // Pre-turn-47 saves don't carry these fields → loaded as undefined,
    // and downstream consumers (registry export, fish-regime export)
    // gracefully degrade. Post-turn-47 saves restore them on load.
    aggregate_concordance:   isFinite(obj.aggregate_concordance)
                                ? obj.aggregate_concordance : undefined,
    band_continuity_pct:     isFinite(obj.band_continuity_pct)
                                ? obj.band_continuity_pct : undefined,
    band_continuity_verdict: obj.band_continuity_verdict || undefined,
    regime_counts:           Array.isArray(obj.regime_counts)
                                ? obj.regime_counts.slice() : undefined,
    fish_calls:              Array.isArray(obj.fish_calls)
                                ? obj.fish_calls.slice() : undefined,
    qc_status:               obj.qc_status || undefined,
    // v4 turn 51: round-trip the remaining commit-time + page-3 fields
    // (mirrors candidateToJSON additions). Pre-turn-51 saves don't carry
    // these → load as undefined; downstream consumers gracefully
    // degrade. Boundary fields are particularly important — pre-turn-51,
    // user-curated boundary work was silently dropped on every reload.
    interval_roles:    Array.isArray(obj.interval_roles)
                          ? obj.interval_roles.map(r => ({ ...r })) : undefined,
    band_diagnostics:  (obj.band_diagnostics && typeof obj.band_diagnostics === 'object')
                          ? obj.band_diagnostics : undefined,
    k6_substructure:   (obj.k6_substructure && typeof obj.k6_substructure === 'object')
                          ? obj.k6_substructure : undefined,
    boundary_left:     (obj.boundary_left && typeof obj.boundary_left === 'object')
                          ? obj.boundary_left : undefined,
    boundary_right:    (obj.boundary_right && typeof obj.boundary_right === 'object')
                          ? obj.boundary_right : undefined,
    breakpoint_status: obj.breakpoint_status || undefined,
    boundary_notes:    obj.boundary_notes || undefined,
    // v4 turn 36 (Ask C step 1): preserve tracks if present; otherwise
    // _ensureTracks below synthesizes a single-track default from the
    // top-level fields (full back-compat for old saves).
    tracks: Array.isArray(obj.tracks) ? obj.tracks : null,
  };
  // Idempotent normalize: ensures tracks is always [1..MAX_TRACKS] long
  // with cleaned per-track fields, ready for downstream consumers.
  _ensureTracks(cand);
  // v4 turn 44 (Ask C step 9): re-derive per-track regime_counts /
  // fish_calls from active_bands so two-track candidates have honest
  // per-track numbers (rather than mirrored top-level). Idempotent —
  // calling on a candidate that already has correct per-track values
  // is a no-op.
  if (typeof _recomputePerTrackAssignments === 'function') {
    try { _recomputePerTrackAssignments(cand); } catch (_) {}
  }
  return cand;
}

// --- candidateListSortedByPos — extracted from legacy ---
export function candidateListSortedByPos() {
  const state = _pageState;
  if (!state.candidateList) return [];
  let list = state.candidateList.slice();
  // v3.56: when in confirmed mode (page 8), only confirmed candidates appear
  // in the navigation. This narrows prev/next so users walk only the final
  // inversion set. Switching back to page 2 restores the full list.
  if (state.candidatePageMode === 'confirmed') {
    list = list.filter(c => c && c.confirmed);
  }
  return list.sort((a, b) => a.start_bp - b.start_bp);
}

// --- candidateListIndexOf — extracted from legacy ---
export function candidateListIndexOf(c) {
  if (!c) return -1;
  const sorted = candidateListSortedByPos();
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].id === c.id) return i;
  }
  return -1;
}

// --- candidateListClosestIndex — extracted from legacy ---
export function candidateListClosestIndex(c) {
  if (!c) return -1;
  const sorted = candidateListSortedByPos();
  if (sorted.length === 0) return -1;
  let bestI = 0, bestD = Infinity;
  const cMid = (c.start_bp + c.end_bp) / 2;
  for (let i = 0; i < sorted.length; i++) {
    const mid = (sorted[i].start_bp + sorted[i].end_bp) / 2;
    const d = Math.abs(mid - cMid);
    if (d < bestD) { bestD = d; bestI = i; }
  }
  return bestI;
}
