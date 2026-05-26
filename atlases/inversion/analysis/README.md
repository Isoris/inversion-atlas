# atlases/inversion/analysis/

**Browser-side biology compute.** Modules here run inversion-specific
analyses in the browser, called via the registry's `source: analysis`
dispatcher.

This is distinct from:

- `engines/` — Python compute that runs on the server (heavy lifts:
  FST, BEAGLE, coverage extraction)
- `shared/` — generic algorithmic primitives (kmeans, hungarian) that
  several analyses depend on but don't perform analysis themselves
- `pages/` — UI only; no biology logic

## The canonical shape

Every analysis module exports one or more analysis functions that
follow this exact signature:

```js
export async function runMyAnalysis(reg, ctx) {
  // 1. Ask reg for inputs
  const [a, b] = await Promise.all([
    reg.resolve('input_a', { ... }),
    reg.resolve('input_b', { ... })
  ]);

  // 2. Compute (pure logic, no DOM, no fetch)
  const result = doTheMath(a, b);

  // 3. Write back through reg so other pages get it from cache
  await reg.set('my_analysis_result', result, { ... });

  // 4. Return to caller
  return result;
}
```

That's it. Three constraints, three benefits.

**Three constraints:**

1. **Receives `reg + ctx`, never imports state directly.** The module
   must be testable in isolation by passing a mock registry. If your
   module imports `AtlasState` or calls `fetch()` directly, that's a
   bug.
2. **Pure compute on the inside.** No DOM, no fetch, no setTimeout.
   All I/O goes through `reg`. This makes the module deterministic
   and testable.
3. **Writes results back through `reg`.** Don't just return the
   value. Writing through `reg.set()` puts it in the warm cache so
   page B doesn't recompute what page A just produced.

**Three benefits:**

1. **Cross-page cache.** Page A computes the Mendelian test; page B
   reads it instantly from cache; page C invalidates it when the
   user re-runs karyotype assignment.
2. **Module isolation.** ES module scoping means `const`s here don't
   leak. The user's note on scoping applies directly: `const X = ...`
   inside this module is private; only `export`-ed names are visible
   elsewhere; nothing touches `window`.
3. **Testable.** `import { runMendelianTest } from './mendelian.js'`
   in a test file, pass a mock `reg` that returns canned data, assert
   on the return value. No browser, no DOM, no atlas shell needed.

## Registering an analysis with the registry

In `registries/data/layers.registry.json`:

```json
"mendelian_test": {
  "tier": "warm",
  "source": "analysis",
  "analysis": "analysis/mendelian.js#runMendelianTest",
  "schema": "schemas/mendelian_test.schema.json",
  "cache_key": "mendelian:{candidate_id}"
}
```

The `analysis` field uses `path#export_name` syntax. The registry's
analysis dispatcher dynamically imports the module and calls the
named export with `(reg, ctx)`.

## Modules in this directory

| File | Status | Purpose |
|---|---|---|
| `mendelian.js` | shim → popstats | Re-exports `runMendelianTest` from `atlases/popstats/analysis/mendelian.js`. Chi-sq + p-value + `findTrios` all implemented (2026-05-26). End-to-end Mendelian pipeline now resolves: candidate → karyotypes → trios → chi-sq → verdict. |
| `karyotype_assignment.js` | shim → popstats | Re-exports `assignKaryotypes` from `atlases/popstats/analysis/karyotype_assignment.js` (2026-05-26). K-means K=3 on per-sample mean (PC1, PC2) across the candidate's slab; centroids auto-sorted by PC1; per-sample purity gates AMBIGUOUS calls. Supports `ctx.invert_orientation` for candidates whose PC1 sign is flipped vs reference. |
| `trio_finder.js` | shim → popstats | Re-exports `findCohortTrios` from `atlases/popstats/analysis/trio_finder.js` (2026-05-26). Thin analysis-shape wrapper around `findTrios` (the public export from mendelian.js); resolves cohort_relatedness via the registry, writes back to warm cache so siblings hit cache. |
| `linkage.js` | future | Linkage of inversion karyotype with phenotype |
| `purity_score.js` | future | Per-cluster purity (uses `purity_threshold = 0.80`). NB: karyotype_assignment.js already returns per-sample purity-derived AMBIGUOUS flags; this module would expose the raw scalar purity values for downstream visualisations. |

## Anti-patterns (don't do these)

```js
// ❌ Reaches into globals
const data = window.AtlasState.inversion.data;

// ❌ Direct fetch
const data = await fetch('/api/...').then(r => r.json());

// ❌ DOM manipulation
document.getElementById('result').textContent = '...';

// ❌ Returns result without caching
return result;   // caller has it but page B will recompute

// ❌ Module-level mutable state
let _cachedResult = null;   // breaks isolation across calls
```

```js
// ✅ Goes through registry
const data = await reg.resolve('candidate_evidence', { candidate_id });

// ✅ Pure return + cache write
await reg.set('my_result', result, { candidate_id });
return result;

// ✅ Module-level constants are fine (immutable, scoped)
const ALPHA = 0.05;
const KARYOTYPE_STATES = ['HOM_REF', 'HET', 'HOM_INV'];
```

## How to add a new analysis

1. Create `analysis/my_thing.js` following the canonical shape.
2. Add an entry to `registries/data/layers.registry.json` with
   `source: 'analysis'` and `analysis: 'analysis/my_thing.js#myFn'`.
3. Write a JSON Schema for the result at
   `registries/schemas/my_thing.schema.json`.
4. Write a test at `registries/tests/test_my_thing.js` using a mock
   registry.
5. Pages call `await reg.resolve('my_thing', {...args})`. They never
   import the module directly.

## The scoping note (for the record)

Per the architecture discussion: ES module `const` is module-private
unless explicitly `export`-ed. This means analysis modules are
naturally isolated without the registry having to enforce anything.
The registry's job is data resolution; module isolation is JavaScript's
job.

```js
// mendelian.js
const ALPHA = 0.05;              // private — NOT visible outside this file
const EXPECTED = Object.freeze({...});  // private

export const MODULE_VERSION = '1.0.0';  // exported — visible via import

export async function runMendelianTest(reg, ctx) { ... }
```

Other modules see `runMendelianTest` and `MODULE_VERSION` only. They
never see `ALPHA` or `EXPECTED`. No `window.X = ...` anywhere — if
you need cross-module sharing, that's what `export` is for.
