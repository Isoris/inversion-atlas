// shared/auto_seed_badge.js
// =====================================================================
// Visible badge for pages whose input was auto-synthesised by
// auto_seed_inv_idx — tells the user the displayed metrics are based
// on a heuristic INV/STD partition, not a curated karyotype call.
//
// Why this matters: the median-PC1 split inside autoSeedInvIdx is a
// useful default but it is NOT a substitute for a real arrangement
// caller. Without a visible signal users could mistake the page's
// dXY / FST / network output for a final result. The badge is a
// small inline chip with `ⓘ auto-seeded` and a tooltip explaining
// the heuristic.
//
// Pure DOM. Caller passes a label element (typically the page's
// `#xxxCandidateLabel`) and optional override text.
// =====================================================================

const BADGE_CLASS = 'ev-autoseed-chip';

/**
 * Attach an "auto-seeded" badge next to `labelEl`. Idempotent — calling
 * twice does not duplicate the badge.
 *
 * @param {HTMLElement} labelEl   the page's candidate-label / chrom-label element
 * @param {Object} [opts]
 * @param {string} [opts.text='auto-seeded']    chip body text
 * @param {string} [opts.title]                 hover tooltip (default explains the heuristic)
 */
export function attachAutoSeedBadge(labelEl, opts) {
  if (!labelEl || typeof document === 'undefined') return;
  const parent = labelEl.parentNode || labelEl;
  // Idempotent — if already attached, just update the text.
  let chip = parent.querySelector ? parent.querySelector('.' + BADGE_CLASS) : null;
  const o = opts || {};
  const text = o.text || 'auto-seeded';
  const title = o.title || (
    'INV / STD partition derived by splitting samples at the median '
    + 'of their mean PC1 across the active candidate\'s window range. '
    + 'Heuristic only — verify against a curated karyotype call '
    + 'before reporting.'
  );
  if (chip) {
    chip.textContent = 'ⓘ ' + text;
    chip.title = title;
    return;
  }
  chip = document.createElement('span');
  chip.className = BADGE_CLASS;
  chip.textContent = 'ⓘ ' + text;
  chip.title = title;
  if (typeof labelEl.insertAdjacentElement === 'function') {
    labelEl.insertAdjacentElement('afterend', chip);
  } else if (labelEl.parentNode && typeof labelEl.parentNode.insertBefore === 'function') {
    labelEl.parentNode.insertBefore(chip, labelEl.nextSibling || null);
  }
}

/**
 * Remove any auto-seeded badge previously attached next to `labelEl`.
 *
 * @param {HTMLElement} labelEl
 */
export function detachAutoSeedBadge(labelEl) {
  if (!labelEl || typeof document === 'undefined') return;
  const parent = labelEl.parentNode || labelEl;
  if (!parent || typeof parent.querySelector !== 'function') return;
  const chip = parent.querySelector('.' + BADGE_CLASS);
  if (chip && typeof chip.remove === 'function') chip.remove();
  else if (chip && chip.parentNode) chip.parentNode.removeChild(chip);
}
