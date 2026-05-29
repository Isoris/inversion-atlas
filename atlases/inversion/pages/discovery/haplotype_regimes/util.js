// pages/discovery/haplotype_regimes/util.js
//
// Tiny shared helpers — _setStatus updates the page's bottom status
// bar, _esc HTML-escapes user-supplied strings before they hit
// innerHTML in the L3 pairs table + regimes summary. Both used from
// many sibling modules; centralising them avoids cyclic imports.

/**
 * Update the page's status bar (the rightmost element of the
 * `.rg-actionbar` strip). No-op when `root` is null or the strip
 * isn't in the DOM yet.
 */
export function setStatus(root, msg) {
  if (!root) return;
  const el = root.querySelector ? root.querySelector('#rgStatus') : null;
  if (el) el.textContent = msg;
}

/**
 * HTML-escape `s` for safe insertion into innerHTML. Used by the
 * L3 pairs table + regimes summary rows.
 */
export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
