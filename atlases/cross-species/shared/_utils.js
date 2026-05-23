// atlases/cross-species/shared/_utils.js
//
// Page-side helpers small enough that cross-atlas-importing them
// from inversion/shared/ would be more friction than copying.
// Currently: _esc (HTML escape). Add more here only if they're
// truly cross-species-internal; bigger things go in their own
// shared module so cross-atlas consumers can register them.

/** HTML-escape a string. Safe for use inside innerHTML / template strings. */
export function _esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
