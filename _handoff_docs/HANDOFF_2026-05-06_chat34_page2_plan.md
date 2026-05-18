# HANDOFF — page2 migration plan (the candidate-detail page)

**Date:** 2026-05-06 (chat ~34, page-2 handoff written ahead of work)
**Reads:** This file FIRST, then `HANDOFF_2026-05-06_chat34_eighth_page1_parity.md`
(for the recipe that worked on page1), then `PAGE_MIGRATION_RECIPE.md`.
**Project:** MS_Inversions_North_african_catfish — 226-sample pure
*C. gariepinus* hatchery cohort, LANTA HPC.

---

## TL;DR for the next session

Page2 is the candidate-detail page. **41 helpers to migrate, 40 found in
legacy with real bodies (2359 LOC total); 1 not found** (`renderCatalogue`,
likely page-4 territory mis-flagged as a page-2 dep — leave stubbed).

**The recipe is identical to page1's eighth-pass.** The work this session
did on page1 (extract verbatim from legacy → use the `_pageState` shim
instead of refactoring 19 bodies → smoke-test under fake DOM) generalizes
1:1 to page2. Expect page2 to take ~30% the time of page1 because:
- The recipe is now mature and Quentin signed off on it.
- The shared helpers from `_state.js` and `_data.js` (after the page1
  split) are reusable as-is.
- The legacy bodies are mostly HTML-builder strings with much less
  draw-call complexity than page1's panels.

**One important callout:** page2's registry entry is mis-labeled.
The `pages.registry.json` says page2 = "cohort overview" with
`requires_layers: [scrubber_main, cohort_sample_manifest]`, but the
page2.js code (and the legacy bodies) is the **candidate detail page**.
The fragment HTML has `#candidateMeta` and `#candidateEmpty` elements,
and the entry-points are `renderCandidateMetadata` and `wireCandidateNav`.
**Resolve this BEFORE migrating** (see "Step 0 — registry reality check"
below).

---

## What page2 IS

A multi-panel deep-dive on a single promoted candidate inversion.
The user promotes an interval to the candidate list (from page1 or
karyotype_tier), then opens it here.

`renderCandidateMetadata(state)` builds the entire page from ~15
sub-panel HTML builders:

| Sub-panel | Builder | Legacy line | LOC |
|---|---|---|---|
| Prev/next nav + confirmed toggle | `candidateNavHtml(c)` | 58589 | 54 |
| Header (chrom, span, source, K) | `candidateHeaderHtml(c)` | 58483 | 58 |
| 18-block chip row + inspector | `candidateBlockChipsHtml(c)` | 58731 | 79 |
| Location strip + multi-panel grid | `candidateRichCardHtml(c)` | 58911 | 112 |
| σ verdict + chart + drifters | `candidateSummaryHtml(c, profile, bands)` | 59745 | 96 |
| K=6 nesting verdict + per-group purity | `candidateSubbandHtml(c)` | 59876 | 100 |
| FIG_C07 ridgeline (het shape) | `candidateHetShapeHtml(c)` | 59988 | 64 |
| FIG_C08 dosage heatmap (static) | `candidateDosageHeatmapHtml(c)` | 17407 | 30 |
| σ profile rendering | `candidateProfileHtml(c, profile)` | 59842 | 25 |
| σ chart | `candidateSigmaChartHtml(c, profile)` | 60053 | 34 |
| Per-band composition cards | `candidateBandsHtml(c, bands)` | 60088 | 68 |
| Per-band haplotype labels | `candidateHaplotypeAnnotationsHtml(c)` | 60697 | 147 |
| Ancestry-confound panel (v4 turn 9) | `candidateAncestryConfoundHtml(c)` | 58292 | 121 |
| Regime registry strip (v4 turn 15b) | `candidateRegimeRowHtml(c)` | 14096 | 87 |
| Cheat30 age & origin (turn 119) | `candidateAgeOriginHtml(c)` | 60499 | 83 |
| Notes textarea | `candidateNotesHtml(c)` | 60585 | 11 |

Wire-up after DOM insertion:
| Wire fn | Legacy line | LOC |
|---|---|---|
| `wireCandidateButtons(c, profile)` | 62359 | 76 |
| `wireCandidateNav(c)` | (already extracted) | — |
| `_wireCandidateBlockChips()` | 58813 | 12 |
| `wireCandidateAncestryConfound(c)` | 58414 | 6 |
| `_wireCandidateHaplotypeAnnotations(c)` | 60845 | 126 |
| `_wireCandidateBandClicks(c, bands)` | 60179 | 30 |
| `_wireCandidateRegimeRow(c)` | 14202 | 31 |
| `_wireCandidateDosageHeatmap()` | 17439 | 46 |

Plus the candidate-list management:
| Helper | Legacy line | LOC |
|---|---|---|
| `addCandidateToList(c)` | 57413 | 8 |
| `persistCandidateList()` | 57310 | 34 |
| `refreshCandidateListUI()` | 62528 | 172 |
| `refreshCandidateUI()` | 57582 | 36 |
| `candidateToJSON(c)` | 57124 | 102 |
| `candidateFromJSON(o)` | 57227 | 73 |
| `candidateListSortedByPos()` | 58552 | 11 |
| `candidateListIndexOf(id)` | 58564 | 8 |
| `candidateListClosestIndex(c, list)` | 58575 | 13 |
| `_navigateToCandidate(dir)` | 59597 | 39 |

Plus the support / drawing:
| Helper | Legacy line | LOC |
|---|---|---|
| `sigmaProfileCandidate(c)` | 10406 | 54 |
| `candidateBandComposition(c)` | 10465 | 36 |
| `drawCandLocalPCA(...)` | 59255 | 19 |
| `drawCandLinesPanel(...)` | 59275 | 86 |
| `drawCandGHSLPerBand(...)` | 59362 | 102 |
| `drawCandidateSigmaChart(c, profile, ctx, geom)` | 62436 | 64 |
| `drawCandidateLocationStrip(...)` | 59072 | 6 |

**Total: 40 helpers, 2359 LOC** — this is what migrates from legacy.
The 1 NOT found (`renderCatalogue`) is page-4 territory; leave it as
a forever-stub if it ends up being called from page2 (audit during
implementation; if it's never called, just delete the TODO).

---

## Recipe (mirrors page1 eighth-pass exactly)

**Step 0 — registry reality check (DO THIS FIRST):**

The current `pages.registry.json` page2 entry says:
```json
"page2": {
  "requires_layers": ["scrubber_main", "cohort_sample_manifest"],
  "requires_slots": ["activeChrom"],
  "preloads": ["scrubber_main"]
}
```
But the actual page2 is the candidate detail page, which needs:
- `activeCandidate` slot (NOT just `activeChrom`).
- `scrubber_main` (yes, for cluster recompute on candidate's L2).
- `candidate_tracks` and likely several others (`dosage_chunk_layer`,
  `cohort_sample_froh`, `ancestry_global_q`, `het_band_backbones`,
  `arrangement_calls`).

Two possible fixes:
1. **Update page2's registry entry** to match candidate-detail reality.
   Add `activeCandidate` to `requires_slots`, expand `requires_layers`
   to the actual deps, update `_label` to "candidate detail".
2. **Or** the original intent was that page2 was supposed to be the
   cohort overview and the candidate detail belongs on a different
   page id. Check `manifest.json` page list and the legacy file's
   page tab labels (legacy line 7248 has `<div id="page2"`) to confirm.

Audit `legacy/Inversion_atlas.html` line 7248 and the tab bar
definitions to confirm which intent is correct, then update the
registry. Don't begin migration until this is resolved — getting it
wrong here cascades through every layer requirement check.

**Step 1 — Audit page2.html fragment:**

`atlases/inversion/pages/discovery/page2.html` is currently 12 lines
(the empty-state placeholder). Verify against legacy line 7248. Most
of the actual UI is built dynamically by `renderCandidateMetadata`,
so the fragment may legitimately stay tiny — just `#candidateMeta`
and `#candidateEmpty` containers.

**Step 2 — Audit CSS for page2:**

```bash
# Comment-stripped selector parity check
grep -E "^[^/]*#page2|^[^/]*#candidate" atlases/inversion/css/inversion.css | wc -l
grep -E "#page2|#candidate" legacy/Inversion_atlas.html | grep -v "^[[:space:]]*//" | wc -l
```
If the counts match, CSS is fine. If not, sync.

**Step 3 — Extract the 40 helpers verbatim:**

Use the same Python script pattern from page1's eighth pass:

```python
import re, json
text = open('legacy/Inversion_atlas.html').read()
lines = text.split('\n')

helpers = [
  'sigmaProfileCandidate', 'candidateBandComposition',
  'candidateNavHtml', 'candidateHeaderHtml', 'candidateBlockChipsHtml',
  'candidateRichCardHtml', 'candidateSummaryHtml', 'candidateSubbandHtml',
  'candidateHetShapeHtml', 'candidateDosageHeatmapHtml',
  'candidateProfileHtml', 'candidateSigmaChartHtml', 'candidateBandsHtml',
  'candidateHaplotypeAnnotationsHtml', 'candidateAncestryConfoundHtml',
  'candidateRegimeRowHtml', 'candidateAgeOriginHtml', 'candidateNotesHtml',
  'wireCandidateButtons', '_wireCandidateBlockChips',
  'wireCandidateAncestryConfound', '_wireCandidateHaplotypeAnnotations',
  '_wireCandidateBandClicks', '_wireCandidateRegimeRow',
  '_wireCandidateDosageHeatmap',
  'addCandidateToList', 'persistCandidateList', 'refreshCandidateListUI',
  'refreshCandidateUI', 'candidateToJSON', 'candidateFromJSON',
  'candidateListSortedByPos', 'candidateListIndexOf',
  'candidateListClosestIndex', '_navigateToCandidate',
  'drawCandLocalPCA', 'drawCandLinesPanel', 'drawCandGHSLPerBand',
  'drawCandidateSigmaChart', 'drawCandidateLocationStrip',
]

def extent(name):
    pat = re.compile(r'^function\s+' + re.escape(name) + r'\s*\(')
    start = None
    for i, l in enumerate(lines):
        if pat.match(l): start = i; break
    if start is None: return None
    depth = 0; started = False
    for j in range(start, len(lines)):
        for ch in lines[j]:
            if ch == '{': depth += 1; started = True
            elif ch == '}':
                depth -= 1
                if started and depth == 0: return (start, j)
    return None
```

Then rewrite each body using the same `_pageState` shim:
```python
def rewrite(name, body):
    body = body.rstrip()
    body = body.replace(
        "(typeof window !== 'undefined' && window.state) ? window.state : state",
        "_pageState"
    )
    # If body uses bare `state`, inject `const state = _pageState;` at top
    has_bare_state = bool(re.search(r'(?<![._\w])\bstate\b(?!\s*=)', body[body.find('{')+1:]))
    has_const_state = '  const _state = ' in body
    has_state_arg = re.match(r'function\s+\w+\s*\(state\b', body) is not None
    if not has_state_arg and has_bare_state and not has_const_state:
        idx = body.find('{')
        nl = body.find('\n', idx)
        body = body[:nl+1] + '  const state = _pageState;\n' + body[nl+1:]
    return body
```

**Step 4 — Wire `_pageState` in page2.js:**

Same pattern as page1.js eighth pass — add at the top:
```js
let _pageState = null;
function _setActiveState(s) { _pageState = s; }
```

Patch every `export function NAME(state, ...)` to set `_setActiveState(state)`
on the first line.

**Step 5 — Cross-page imports (KEY DECISION):**

Page2 reuses several helpers that page1 already defined. After the page1
split (round 4), these will be in `pages/discovery/page1/_state.js` and
`pages/discovery/page1/_data.js`. **Don't duplicate them in page2.** Either:

a. Hoist the shared helpers to `atlases/inversion/shared/` (recommended
   for: `getPC`, `getPCByAxis`, `getPCRender`, `availablePCs`,
   `getL2Cluster`, `getL2ClusterAt`, `allSampleIdx`, `buildIndexes`,
   `computePC1Signs`, `populateSimScales`, `buildFamilyPalette`,
   `detectSchemaAndLayers`, `inferLayersFromV1`, `listLayers`,
   `_isLinesColorModeAvailable`, `currentMbRange`, `getActiveSimScale`,
   `loadViewControls`/`saveViewControls`/`reconcileViewControlsForData`,
   the family-palette constants).

b. Or, keep them in page1 modules and have page2 import directly from
   `pages/discovery/page1/_data.js` (cross-page module imports are fine
   in ES modules; the manifest's `module:` entry just specifies the
   atlas-router entry point).

Option (a) is cleaner long-term — `shared/` is where reusable
state-aware utilities belong. Option (b) is faster if the next session
is in a hurry. Either way, the SAME `_pageState` reference must NOT be
shared between pages — each page has its own `_pageState` because the
page's mount sets it. Cross-imports of helpers reading `_pageState`
will see only the importing module's `_pageState`, which would be
wrong. So if a helper is used by both page1 AND page2, **it must take
`state` as an explicit arg**, not read `_pageState`. Either (i) refactor
those helpers to take state as first arg, or (ii) keep two copies.

**Recommended:** for the page1+page2 shared helpers, make them all
take `state` as first arg in `shared/` (no `_pageState` shim). The
page1 split will need this anyway because the panel modules will be
better off taking `state` explicitly than relying on `_pageState`
across module boundaries.

**Step 6 — Smoke test:**

Same harness as page1's eighth pass:
```bash
node /tmp/smoke_page2.mjs   # mount/unmount with synthetic candidate
```
Build a synthetic state with `state.candidate = { id: 'cand1', chrom: 'LG12', ... }`
and a fake registry returning a `scrubber_main` precomp. Page2's
`renderCandidateMetadata` should run end-to-end without throwing.

**Step 7 — Update audit log + recipe + this handoff:**

Same docs to update. The pattern is now mature.

---

## Open questions for next session

1. **Page2 registry entry mismatch** (Step 0 above). Resolve before
   migrating.
2. **Cross-page helper sharing strategy** (Step 5 above). Decide before
   the page1 split.
3. **Does page2 need `state.candidate` to be a slot in the
   `SLOT_REGISTRY` or is it ad-hoc?** Check `atlases/inversion/shared/state.js`.
4. **`renderCatalogue` (1 helper not in legacy)** — is it called by any
   extracted page2 body? If yes, where does its real body live? Likely
   in a different page's territory or a v4-rename.

---

## Sequence of work over upcoming sessions

1. **Round 4 (next):** split page1.js into 10 sub-modules. Plan in
   `HANDOFF_2026-05-06_chat34_eighth_page1_parity.md`. The split
   resolves Step 5 above for page1 — once panel modules exist, the
   shared-helper question for page2 is concrete.

2. **Round 5:** page2 migration following this handoff.

3. **Rounds 6–N:** pages 3, 4, 6, 7, 8, 12, 15, 19 (and any others
   in the manifest). Each follows the same recipe; the speed picks
   up as the shared helpers stabilize.

---

## Files NOT to drop

This handoff bundle includes everything from the start of the chat
plus everything produced this session. See the bundle README
(`BUNDLE_README.md`) for the full inventory.

---

## Communication preferences (unchanged)

Quentin is French-native, fluent English, based in Bangkok. PhD on
LANTA HPC. Manuscript v19→v20 targeting Nature Communications. Terse
and direct. Wants signal not flattery. Pushes back precisely when
outputs are wrong. Three cohorts MUST never be conflated:
- **F₁ hybrid** (*C. gariepinus* × *C. macrocephalus*) — genome
  assembly paper only.
- **226-sample pure *C. gariepinus* hatchery cohort on LANTA** —
  current inversion work; K clusters reflect hatchery broodline
  structure, NOT species admixture.
- **Pure *C. macrocephalus* wild cohort** — future paper.
