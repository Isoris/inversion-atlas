// shared/atlas_chrome.js
// =====================================================================
// GENERIC ATLAS-CHROME HELPERS — tab-stage-pill click handler +
// global-settings-button wiring + active-page sync.
//
// SCOPE: this file is intentionally atlas-agnostic. No reference to
// inversion-specific state, paths, or vocabulary. Imports nothing
// from atlases/inversion/. Other atlases (diversity, genome,
// ancestry) can drop this same file into their cartridge or — once
// atlas-core ships — import it from atlas-core instead.
//
// CANDIDATE FOR PROMOTION TO atlas-core: this module is a near-perfect
// match for atlas-core/js/atlas_chrome.js. When atlas-core ships
// its own version, each cartridge's import path flips from
// '../../shared/atlas_chrome.js' → 'atlas-core/atlas_chrome.js' and
// the cartridge copy can be deleted in one revert.
//
// EXPECTED DOM (provided by the atlas shell — atlas-core or the
// assembled index.html — NOT by any single cartridge):
//
//   <nav id="tabBar" data-active-stage="<initial-stage>">
//     <button id="globalSettingsBtn" …>⚙</button>
//
//     <button class="tab-stage-pill" data-stage="discovery"
//             data-expanded="1">discover</button>
//     <button class="tab-stage-pill" data-stage="classification">…</button>
//     <!-- one pill per stage -->
//
//     <button data-page="local_pca_dosage" data-stage="discovery"
//             class="active">1 local PCA |z|</button>
//     <!-- one page button per page, with data-stage matching one
//          of the declared stages -->
//   </nav>
//
// CSS contract (provided by atlas_chrome.css alongside this file):
//   - `.tab-stage-pill` styling + dot/count/arrow children
//   - `#tabBar[data-active-stage="X"] button[data-page]:not([data-stage="X"]) { display:none; }`
//     for every declared stage. Folds page buttons by active stage.
//   - `.tab-stage-pill[data-expanded="1"]` visual state for the
//     active pill (rotated arrow, brighter border, etc.)
// =====================================================================

// =====================================================================
// 1. Tab-stage-pill click handler
// =====================================================================

/**
 * Attach click handlers to all `.tab-stage-pill` elements inside
 * `rootEl`. Clicking a pill:
 *
 *   1. sets `data-active-stage` on `#tabBar` (or `rootEl`) to the
 *      clicked pill's `data-stage` (drives the CSS-based folding
 *      that hides every page button outside the active stage)
 *   2. toggles `data-expanded` on each pill (only one pill is
 *      expanded at a time — the currently-active stage)
 *   3. clicks the FIRST page button inside that stage (so the
 *      router actually navigates to a page in the new stage —
 *      otherwise the user clicks a stage pill and sees nothing
 *      because no page is currently active in that stage)
 *
 * Idempotent: calling twice replaces the handlers.
 *
 * @param {HTMLElement} rootEl     usually `document.getElementById('tabBar')`
 * @param {Object} [opts]
 * @param {Function} [opts.onStageChange]  optional callback(stageName)
 * @returns {{teardown: Function, setActiveStage: Function}}
 */
export function wireTabStagePills(rootEl, opts) {
  if (!rootEl) return { teardown: () => {}, setActiveStage: () => {} };
  const o = opts || {};
  // Replace any previously-attached handlers.
  const prev = rootEl.__atlasChromePillHandlers__;
  if (prev) prev.teardown();

  const pills = rootEl.querySelectorAll('.tab-stage-pill');
  const handlers = [];

  const handlePillClick = (pill) => {
    const stage = pill.getAttribute('data-stage');
    if (!stage) return;
    const currentStage = rootEl.getAttribute('data-active-stage');
    const isCollapsed  = rootEl.getAttribute('data-collapsed') === '1';

    // Same pill clicked while its sub-tabs are expanded → collapse them.
    // The CSS rule `#tabBar[data-collapsed="1"] button[data-page]` hides
    // every page button; the pill's data-expanded is cleared so the
    // arrow indicator returns to its idle state.
    if (stage === currentStage && !isCollapsed) {
      rootEl.setAttribute('data-collapsed', '1');
      pill.removeAttribute('data-expanded');
      if (typeof o.onStageChange === 'function') {
        try { o.onStageChange(stage); } catch (_) { /* swallow */ }
      }
      return;
    }

    // Otherwise: expand (clearing any collapsed state) and, if switching
    // to a different stage, click into its first page so the router
    // actually navigates.
    rootEl.removeAttribute('data-collapsed');
    setActiveStageOn(rootEl, stage);
    if (stage !== currentStage) {
      const firstPageBtn = rootEl.querySelector(
        'button[data-page][data-stage="' + _cssEscape(stage) + '"]',
      );
      if (firstPageBtn && typeof firstPageBtn.click === 'function') {
        firstPageBtn.click();
      }
    }
    if (typeof o.onStageChange === 'function') {
      try { o.onStageChange(stage); } catch (_) { /* swallow */ }
    }
  };

  for (const pill of pills) {
    const cb = () => handlePillClick(pill);
    pill.addEventListener('click', cb);
    handlers.push({ pill, cb });
  }

  const teardown = () => {
    for (const h of handlers) {
      try { h.pill.removeEventListener('click', h.cb); } catch (_) {}
    }
    rootEl.__atlasChromePillHandlers__ = null;
  };

  rootEl.__atlasChromePillHandlers__ = { teardown };

  return {
    teardown,
    setActiveStage: (stage) => setActiveStageOn(rootEl, stage),
  };
}

/**
 * Programmatically set the active stage on the tab bar. Updates
 *   - rootEl's `data-active-stage` attribute
 *   - each pill's `data-expanded` attribute (one expanded at a time)
 *
 * Does NOT click into a page — call this from the router after a
 * page mount to keep the pills in sync, or call it directly from
 * the pill click path.
 *
 * @param {HTMLElement} rootEl
 * @param {string} stage
 */
export function setActiveStageOn(rootEl, stage) {
  if (!rootEl || !stage) return;
  rootEl.setAttribute('data-active-stage', stage);
  const pills = rootEl.querySelectorAll('.tab-stage-pill');
  for (const p of pills) {
    if (p.getAttribute('data-stage') === stage) {
      p.setAttribute('data-expanded', '1');
    } else {
      p.removeAttribute('data-expanded');
    }
  }
}

/**
 * Detect the active stage from the rootEl's current attribute.
 *
 * @param {HTMLElement} rootEl
 * @returns {string|null}
 */
export function getActiveStageOf(rootEl) {
  if (!rootEl) return null;
  return rootEl.getAttribute('data-active-stage') || null;
}

/**
 * Sync the tab-bar pills to the stage of the currently-active page
 * button. Called by the router after mounting a page (the shell
 * already knows which page is active — this just keeps the pills
 * in agreement).
 *
 * @param {HTMLElement} rootEl
 */
export function syncPillsToActivePage(rootEl) {
  if (!rootEl) return;
  const activePageBtn = rootEl.querySelector('button[data-page].active');
  if (!activePageBtn) return;
  const stage = activePageBtn.getAttribute('data-stage');
  if (stage) setActiveStageOn(rootEl, stage);
}

// =====================================================================
// 2. Global-settings-button wiring
// =====================================================================

/**
 * Wire the global-settings gear button. Clicking it toggles a
 * `[data-sidebar]` attribute on the supplied `wrapEl` between
 * 'expanded' and 'collapsed' — atlases that have a sidebar use
 * this to hide / show it.
 *
 * Idempotent: calling twice replaces the handler.
 *
 * @param {HTMLElement} btnEl    the gear button
 * @param {HTMLElement} wrapEl   the layout wrap element to toggle
 * @param {Object} [opts]
 * @param {string}  [opts.storageKey='atlas_chrome.sidebar']
 * @param {Function}[opts.onToggle] callback(nextState: 'expanded'|'collapsed')
 * @returns {{teardown: Function, setSidebar: Function}}
 */
export function wireGlobalSettingsBtn(btnEl, wrapEl, opts) {
  if (!btnEl || !wrapEl) return { teardown: () => {}, setSidebar: () => {} };
  const o = opts || {};
  const storageKey = typeof o.storageKey === 'string'
    ? o.storageKey : 'atlas_chrome.sidebar';
  const prev = btnEl.__atlasChromeSettingsHandler__;
  if (prev) prev.teardown();

  // Restore persisted state, defaulting to 'expanded'.
  let state = 'expanded';
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'collapsed' || saved === 'expanded') state = saved;
  } catch (_) {}
  wrapEl.setAttribute('data-sidebar', state);

  const setSidebar = (next) => {
    if (next !== 'expanded' && next !== 'collapsed') return;
    state = next;
    wrapEl.setAttribute('data-sidebar', next);
    try { localStorage.setItem(storageKey, next); } catch (_) {}
    if (typeof o.onToggle === 'function') {
      try { o.onToggle(next); } catch (_) {}
    }
  };

  const cb = () => setSidebar(state === 'expanded' ? 'collapsed' : 'expanded');
  btnEl.addEventListener('click', cb);

  const teardown = () => {
    try { btnEl.removeEventListener('click', cb); } catch (_) {}
    btnEl.__atlasChromeSettingsHandler__ = null;
  };

  btnEl.__atlasChromeSettingsHandler__ = { teardown };
  return { teardown, setSidebar };
}

// =====================================================================
// 3. One-call bootstrap
// =====================================================================

/**
 * Convenience wrapper: wire BOTH the tab pills AND the settings
 * button + sync the pills to the currently-active page. Returns a
 * combined teardown.
 *
 * Atlas-shell startup typically calls this once after the shell
 * HTML is injected.
 *
 * @param {Object} args
 * @param {HTMLElement} args.tabBar              `#tabBar`
 * @param {HTMLElement} [args.globalSettingsBtn] `#globalSettingsBtn`
 * @param {HTMLElement} [args.wrap]              layout wrap for the
 *                                                sidebar toggle
 * @param {Object}      [args.opts]              forwarded individually
 * @returns {{teardown: Function, chrome: Object}}
 */
export function bootstrapAtlasChrome(args) {
  const a = args || {};
  const pills    = wireTabStagePills(a.tabBar, a.opts && a.opts.tabPills);
  const settings = (a.globalSettingsBtn && a.wrap)
    ? wireGlobalSettingsBtn(a.globalSettingsBtn, a.wrap, a.opts && a.opts.settings)
    : { teardown: () => {}, setSidebar: () => {} };
  if (a.tabBar) syncPillsToActivePage(a.tabBar);
  return {
    teardown: () => { pills.teardown(); settings.teardown(); },
    chrome:   { pills, settings },
  };
}

// =====================================================================
// Helpers
// =====================================================================

function _cssEscape(s) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(s);
  }
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
