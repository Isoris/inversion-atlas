# AUDIT_FIRST — read before writing any code

**This is the most important file in the package. Read it before anything else.**

## The rule

Before designing or coding anything, audit what already exists in
the atlas folders. The mistake to avoid: inventing components from
scratch when working code is already present.

## The audit checklist

For EVERY new chat that touches this project, run this checklist
before writing the first line of code:

### 1. List the atlas package contents

```bash
find atlases/inversion/ -type f -name "*.py" -o -name "*.js" -o -name "*.c" -o -name "*.json" \
  | grep -v "data/precomp" | sort
```

### 2. Check for an existing server

```bash
ls atlases/*/server/ 2>/dev/null
```

If you find a server folder, read its `SERVER_README.md` or any
top-level documentation file. Grep for route definitions:

```bash
grep -n "@app.\(get\|post\|put\|delete\)" atlases/*/server/*.py
```

The endpoints listed there are the **real** API surface. The
registry's `operations.registry.json` MUST match these. If it
doesn't, the registry is wrong, not the server.

### 3. Check for existing engines

```bash
ls atlases/*/engines/ 2>/dev/null
find atlases/*/engines/ -name "Makefile" -o -name "README.md"
```

Compute engines (C binaries, R scripts, Python pipelines) usually
live here or are referenced from the server config. Don't propose
writing new engines without checking what's already compiled.

### 4. Check for existing analysis modules

```bash
ls atlases/*/analysis/ 2>/dev/null
ls atlases/*/shared/ 2>/dev/null
```

Browser-side compute lives in `analysis/`. Generic algorithmic
primitives (kmeans, hungarian, contingency tables) live in
`shared/`. Don't reimplement these.

### 5. Check for existing pages

```bash
find atlases/*/pages/ -name "*.html" -o -name "*.js" | wc -l
```

If there are 23 pages already split, the design task is migration,
not new construction.

### 5.5. Check for existing CSS

```bash
find atlas-core/css/ atlases/*/css/ -name "*.css" 2>/dev/null
```

The atlas has a layered CSS system: `tokens.css` (design system) +
`base.css` (generic chrome) + `shell.css` (topbar) live in
`atlas-core/css/`. Per-atlas styles live under
`<atlas>/css/`. Atlas-wide stylesheets are declared in the
manifest's `stylesheets` array and loaded at register time. Per-page
stylesheets are declared on the page entry and loaded by the
router on mount. Don't add inline `<style>` blocks to pages.

### 6. Check the legacy reference

```bash
ls atlases/*/legacy/ 2>/dev/null
wc -l atlases/*/legacy/*.html 2>/dev/null
```

If there's a legacy monolith, it's the behavioral truth. Grep it
when uncertain about how a feature behaves today.

### 7. Read the handoff docs

```bash
ls inversion-atlas/handoff_docs/ | sort | tail -3
```

The most recent handoffs explain what the previous chat actually
did, what's broken, what's open.

## Examples of what audit-first prevents

### Example 1 (already happened)

The previous chat designed `core/server/` with a generic Flask
shell and an `atlases/<id>/server-adapters/` system for mounting
atlas-specific routes. The reality:

- `atlases/inversion/server/popstats_server.py` already exists,
  2109 LOC, FastAPI (not Flask), with caching, content-addressable
  hashing, ANGSD patch support.
- `engines/fast_ld/` already exists, 2516 LOC of C + Python.
- The server has 12 real endpoints with documented request shapes.
- `operations.registry.json` was populated with INVENTED endpoint
  names (`fst_hom1_hom2`, `theta_pi_by_invgt`, `lof_burden`, etc.)
  that DO NOT EXIST in the real server.

The fix:
- Drop core/server/ stubs (atlas owns the server).
- Recover the real server into `atlases/inversion/server/`.
- Rewrite `operations.registry.json` against the real route
  definitions in `popstats_server.py`.

### Example 2 (to avoid)

A future chat decides "we need a karyotype assignment endpoint" and
adds it to the operations registry. Audit-first catches that:

- Karyotype assignment runs in the BROWSER (local PCA on dosage,
  K-means, Hungarian assignment, purity threshold).
- It belongs in `atlases/inversion/analysis/karyotype_assignment.js`
  with `source: 'analysis'`.
- It does NOT need a server endpoint.

### Example 3 (to avoid)

A future chat starts a "new" page for population structure, not
realizing population analysis already exists in:

- `data/cohort/sample_groups.tsv` (NGSadmix K=8 groups)
- `engines/...` (the upstream NGSadmix pipeline outputs)
- Any existing `pages/discovery/candidate_focus.html` or similar

Audit-first catches that the inputs are already there.

### Example 4 (round 2, 2026-05-06)

The local_pca_dosage migration had 49 `TODO_MISSING(X)` markers. A future chat
might extract bodies for all 49 from legacy. Audit-first catches
that 15 of the 49 are FALSE POSITIVES:
- 10 are closure-scoped (a local `const X = ...` in the parent
  function already covers every call site — the extraction tool
  didn't model lexical scope when it generated the markers).
- 5 are lexical artefacts (the bare word appears only inside
  template literals, comment text, or DOM `el.dataset.foo` accesses
  — never as an unresolved identifier).

The fix is **scope-check before extracting**: for each TODO name,
verify there is no local definition and the references are real
calls, not text. See `PAGE_MIGRATION_RECIPE.md` Step 2.5.

## How to do an audit fast

```bash
# One-liner that gives the full picture
cd atlas-workspace 2>/dev/null || cd inversion-atlas

echo "=== Pages ==="
find atlases -path "*/pages/*" -name "*.html" 2>/dev/null | wc -l
echo "pages"

echo "=== Server endpoints ==="
grep -h "@app.\(get\|post\|put\|delete\)" atlases/*/server/*.py 2>/dev/null \
  | grep -oE '"/[^"]*"' | sort -u

echo "=== Engines ==="
find atlases/*/engines/ -name "Makefile" -o -name "README.md" 2>/dev/null

echo "=== Analysis modules ==="
ls atlases/*/analysis/*.js 2>/dev/null

echo "=== CSS ==="
find atlas-core/css/ atlases/*/css/ -name "*.css" 2>/dev/null

echo "=== Latest handoff ==="
ls -t inversion-atlas/handoff_docs/HANDOFF_*.md 2>/dev/null | head -1

echo "=== Test suites ==="
find . -name "test_*.py" -o -name "test_*.js" 2>/dev/null | wc -l
echo "tests"
```

Five lines of bash, runs in <1 second, prevents 10 minutes of
designing the wrong thing.

## When the audit shows a gap

If the audit shows something is genuinely missing — say there's no
`analysis/karyotype_assignment.js` and a page needs one — that's a
real task. Build it.

But the test must always be: "is this missing in fact, or am I just
not looking hard enough?" The audit-first rule is about asking that
question every time, not about being lazy.

## Audit log

Every chat that does substantial work should write a one-line entry
to a top-level `AUDIT_LOG.md` recording what they audited and what
they found. This makes the next chat's audit faster — they can
diff against the previous chat's audit instead of starting fresh.

Example entry:
```
2026-05-06: Audited Atlas_turn166_round2_2026-05-05.tar.gz.
  - Found existing popstats_server.py (2109 LOC, FastAPI, 12 endpoints)
  - Found existing engine_fast_ld/ (2516 LOC C+Python)
  - Found existing producers/ (SV evidence pipeline)
  - Recovered all three into inversion-atlas/atlases/inversion/server/
    and atlases/inversion/engines/.
  - Rewrote operations.registry.json against real endpoints.
  - Dropped fake core/server/ stubs.
```

That's it. Audit first. Build only what's missing.
