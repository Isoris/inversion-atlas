// shared/empty_state_panel.js
// =====================================================================
// Onboarding empty-state panel shared across evolution-atlas pages.
//
// Replaces the developer-text empty state ("atlasState.inversion.X needs
// a dosage matrix + inv_idx") with a structured panel that tells the
// USER what the page is for, where the data comes from, and what
// action to take next.
//
// HTML contract: each page already has a sentinel <div id="..."Empty">
// with `display:none;` toggled by the page's compute path. This module
// repaints that div's innerHTML when the page hits the empty branch.
//
// Pure DOM, no atlas-specific imports.
// =====================================================================

/**
 * Render an onboarding-style empty state into `el`.
 *
 * @param {HTMLElement} el            target sentinel (e.g. #hapNetEmpty)
 * @param {Object}      cfg
 * @param {string}      cfg.title       e.g. "Haplotype network not loaded"
 * @param {string}      cfg.description one-line summary of the page
 * @param {string[]}    [cfg.sources]   bullet list of where data comes from
 * @param {Array<{label, onClick, primary?:boolean}>} [cfg.actions]
 * @param {string}      [cfg.help_url]  optional doc URL surfaced as a small ⓘ link
 * @returns {{ teardown: Function }}
 */
export function renderEmptyStatePanel(el, cfg) {
  if (!el || typeof document === 'undefined') {
    return { teardown: () => {} };
  }
  const c = cfg || {};

  // Build the DOM.
  el.innerHTML = '';
  el.classList.add('ev-empty-panel');

  const card = document.createElement('div');
  card.className = 'ev-empty-card';

  if (c.title) {
    const h = document.createElement('div');
    h.className = 'ev-empty-title';
    h.textContent = c.title;
    card.appendChild(h);
  }

  if (c.description) {
    const d = document.createElement('div');
    d.className = 'ev-empty-desc';
    d.textContent = c.description;
    card.appendChild(d);
  }

  if (Array.isArray(c.sources) && c.sources.length > 0) {
    const h = document.createElement('div');
    h.className = 'ev-empty-h';
    h.textContent = 'How to get data here';
    card.appendChild(h);
    const ul = document.createElement('ul');
    ul.className = 'ev-empty-list';
    for (const s of c.sources) {
      const li = document.createElement('li');
      li.textContent = s;
      ul.appendChild(li);
    }
    card.appendChild(ul);
  }

  const handlerCleanups = [];

  if (Array.isArray(c.actions) && c.actions.length > 0) {
    const row = document.createElement('div');
    row.className = 'ev-empty-actions';
    for (const a of c.actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = a.primary ? 'ev-empty-btn ev-empty-btn-primary'
                              : 'ev-empty-btn';
      b.textContent = a.label;
      if (typeof a.onClick === 'function') {
        const cb = (e) => { try { a.onClick(e); } catch (_) {} };
        b.addEventListener('click', cb);
        handlerCleanups.push(() => b.removeEventListener('click', cb));
      }
      row.appendChild(b);
    }
    card.appendChild(row);
  }

  if (c.help_url) {
    const a = document.createElement('a');
    a.className = 'ev-empty-help';
    a.href = c.help_url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'ⓘ help';
    card.appendChild(a);
  }

  el.appendChild(card);

  return {
    teardown: () => {
      for (const fn of handlerCleanups) { try { fn(); } catch (_) {} }
      if (el && typeof el.classList === 'object') el.classList.remove('ev-empty-panel');
    },
  };
}

/**
 * One-call wrapper: navigates to another page by clicking its tab-bar
 * button if present. Safe no-op when the target button doesn't exist.
 *
 * @param {string} pageId  the `data-page` value of the target tab-bar button
 */
export function navigateToPage(pageId) {
  if (typeof document === 'undefined' || !pageId) return;
  const btn = document.querySelector('button[data-page="' + _cssEscape(pageId) + '"]');
  if (btn && typeof btn.click === 'function') btn.click();
}

function _cssEscape(s) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(s);
  }
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
