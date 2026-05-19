# HANDOFF — atlas-core integration: chrome + loader

Date: 2026-05-13
Scope: tab pills, global-settings button, precomp loader, schema-v2 badge, JS-scripts badge

This is the integration contract between **inversion-atlas** (cartridge)
and **atlas-core** (shell). Two things ship in this cartridge that
atlas-core will eventually take over; one thing is a stub that
atlas-core still needs to fulfil.

---

## 1. Generic atlas chrome — shipped here, candidate for atlas-core

The cartridge now ships two files that any other atlas can reuse:

- `atlases/inversion/shared/atlas_chrome.js` — tab-pill click
  handler, programmatic stage switching, sync-pills-to-active-page,
  global-settings-button toggle, one-call bootstrap helper.
- `atlases/inversion/shared/atlas_chrome.css` — tab-pill style,
  active-stage folding rules, global-settings-button style, stage
  hue palette (parameterised via `--atlas-stage-hue-<stage>` CSS
  custom properties).

These files are written to be **atlas-agnostic**. No reference to
inversion-specific state, paths, or vocabulary.

### Promotion plan

When atlas-core ships its own copy:

1. Move both files to `atlas-core/atlas_chrome.{js,css}`.
2. Drop the cartridge copies and the `atlas_chrome.css` entry from
   each cartridge's `manifest.json#stylesheets`.
3. Atlas-core's shell imports `atlas_chrome.js` and calls
   `bootstrapAtlasChrome({tabBar, globalSettingsBtn, wrap})` once
   after the shell HTML is injected.

### HTML contract (provided by the shell, NOT by cartridges)

```html
<nav id="tabBar" data-active-stage="discovery">
  <button id="globalSettingsBtn" …>⚙</button>

  <!-- one pill per workflow stage declared in the active atlas's
       manifest.stages. The shell renders these from the manifest. -->
  <button class="tab-stage-pill" data-stage="discovery"
          data-expanded="1">discover</button>
  <button class="tab-stage-pill" data-stage="classification">…</button>

  <!-- one page button per page in the active atlas's manifest.pages.
       Page buttons have data-stage matching one of the declared
       stages. -->
  <button data-page="local_pca_dosage" data-stage="discovery"
          class="active">1 local PCA |z|</button>
</nav>
```

### Routing contract

Clicking a `.tab-stage-pill`:

1. Sets `data-active-stage` on `#tabBar` (drives the CSS-based
   folding that hides every page button outside the active stage).
2. Sets `data-expanded="1"` on the clicked pill (only one expanded
   at a time).
3. **Clicks the first page button in that stage** so the router
   actually navigates to a page in the new stage. The shell's
   existing page-button click dispatcher owns the actual mount.

When the router mounts a page, call `syncPillsToActivePage(tabBar)`
to keep the pills in agreement with the active page button.

---

## 2. Stage vocabulary — canonical 5

The inversion atlas's manifest now declares these stages:

```
discovery → classification → catalogue → comparative → help
```

Help is rightmost. The `synthesis` stage from earlier drafts has
been folded into `classification` (stats_profile stats profile, marker_readiness
marker panel, overview overview now all live in
`classification`).

Other atlases can declare different stages — the chrome CSS reads
hues from CSS custom properties so any stage name works as long as
the atlas provides a hue.

---

## 3. Precomp loader — STILL A STUB, atlas-core needs to wire it

`pages/discovery/local_pca_dosage/sidebar.js:404` currently warns and exits:

```js
console.warn('[sidebar TODO] #fileInput → loadMultipleJSONs not ported '
           + '(legacy line 55392). The atlas-core shell owns data '
           + 'loading; route through there.');
```

### What atlas-core needs to provide

1. A loader that:
   - reads the `#fileInput` file list,
   - parses each as JSON,
   - detects schema version (legacy lines 52836–53038 of
     `legacy/Inversion_atlas.html` — schema v1 vs v2),
   - merges into `atlasState.inversion.data` keyed by chrom or
     layer name.
2. After load completes, call **`local_pca_dosage.applyData(legacyState, data)`**
   (exported from `pages/discovery/local_pca_dosage.js:91`) so the page
   re-renders.
3. Update `#schemaBadge` (the v1/v2 indicator) — `pages/discovery/
   local_pca_dosage.js:281-287` already has the rendering code; atlas-core just
   needs to trigger that path with the right `state.schemaVersion`.

### What's missing on the cartridge side (lower priority)

- `#jsScriptsBadge` (the "JS · N scripts loaded" indicator) has
  zero references in the cartridge. The legacy implementation lives
  at lines 55045 and 55178 of `legacy/Inversion_atlas.html`. It's a
  loader-side concern; safe to defer until atlas-core ships its
  loader, since the badge tracks the scripts atlas-core itself
  injects.

---

## 4. Test coverage

- `tests/test_shared_atlas_chrome.js` — 32 assertions on the chrome
  JS module (tab-pill click, idempotent re-wire, programmatic
  setActiveStage, sync-to-active-page, teardown, onStageChange
  callback, null tolerance, settings btn toggle + localStorage
  persistence + onToggle, combined bootstrap).
- The chrome CSS has no JS-side tests (it's pure CSS). Visual
  verification happens in the assembled atlas-workspace.

---

## 5. Settings-button position

`#globalSettingsBtn` is currently styled as the first child of
`#tabBar` with `margin: 4px 12px 4px 0` — sits at the **upper-left**
of the tab bar, immediately before the stage pills. If a future
design wants it upper-right instead, change the rule in
`atlas_chrome.css` to `margin-left: auto` and re-order the HTML in
the shell so the button comes after the pills.

---

## 6. Open follow-ups (not in this commit)

- Port `#jsScriptsBadge` updater from legacy (see §3 above).
- Once atlas-core ships its loader: de-stub
  `pages/discovery/local_pca_dosage/sidebar.js` (`#fileInput`, `#chromSelect`,
  `#clearJsonCacheBtn` handlers).
- Once atlas-core ships its chrome: delete cartridge copies of
  `atlas_chrome.{js,css}` and remove the manifest stylesheet entry.
- The `card-tier between/within arrangement-divergence axes` work
  (queued from the user's earlier note — separate commit).
