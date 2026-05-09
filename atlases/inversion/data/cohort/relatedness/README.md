# data/relatedness/

Relatedness results — kinship, IBS, IBD, transmission tables —
read by the atlas as **Mode B (raw-folder interface)**.

The atlas reads these files directly through the resolver-registry.
**Do NOT re-export raw tool output as JSON.** Each tool's native
output format is registered as its own layer.

---

## Layout

```
data/relatedness/
├── ngsrelate/
│   └── <run_id>/
│       ├── relatedness.tsv         ← canonical ngsRelate output
│       ├── samples.txt             ← optional: line-per-sample order file
│       ├── params.json             ← run parameters (n_sites_min, F mode, etc.)
│       └── README.md               ← run-specific notes
├── king/                           (future) KING IBD segments
│   └── <run_id>/
│       └── king.seg                ← KING segment table
├── hap_ibd/                        (future) hap-IBD output
│   └── <run_id>/
│       └── chrom_<X>.ibd.gz
└── README.md                       ← this file
```

`<run_id>` is a free-form short identifier per run, e.g.
`broodstock_qc_pass_v1`, `natora_pruned_81_v1`. Convention: short,
underscore-only, no spaces.

---

## ngsRelate column convention

The atlas registry reads `data/relatedness/ngsrelate/<run_id>/relatedness.tsv`
with `format: tsv` and the schema in
`registries/schemas/relatedness_ngsrelate.schema.json`.

ngsRelate (default 2-population, fixed-F) writes a tab-separated
file with one row per sample pair. Column set is stable across
runs; only the row count changes.

| Column | Type | Meaning |
|---|---|---|
| `a` | int | first sample index (0-based, into samples.txt) |
| `b` | int | second sample index |
| `nSites` | int | number of sites compared for this pair |
| `J7` | float | IBD-component probability (Jacquard 7) |
| `J8` | float | IBD-component probability (Jacquard 8) |
| `J9` | float | IBD-component probability (Jacquard 9) |
| `rab` | float | relatedness coefficient |
| `Fa` | float | inbreeding coefficient of sample a |
| `Fb` | float | inbreeding coefficient of sample b |
| `theta` | float | kinship coefficient |
| `inbreed_a` | float | alternate inbreeding estimate for a |
| `inbreed_b` | float | alternate inbreeding estimate for b |
| `2of3_IDB` | float | 2-of-3 IBD probability |
| `FDiff` | float | F differential |
| `loglh` | float | optimised log-likelihood |
| `nIter` | int | number of EM iterations |
| `coverage` | float | mean per-site coverage for the pair |
| `IBS0` | float | proportion IBS=0 sites |
| `IBS1` | float | proportion IBS=1 sites |
| `IBS2` | float | proportion IBS=2 sites |
| `R0` | float | derived ratio for PO/FS discrimination |
| `R1` | float | derived ratio for PO/FS discrimination |
| `KING` | float | KING-robust kinship estimator |

If a future ngsRelate version adds columns, **append** them and
update the schema. Don't reorder. The `fields:` filter on the layer
entry lets analysis modules pick a subset.

---

## How the atlas reads it

```js
// inside an analysis module, never inside a page

// Default — return all 23 columns
const allRows = await registry.resolve('relatedness_ngsrelate', {
  run_id: 'broodstock_qc_pass_v1'
});

// Mendelian inheritance only needs a few columns — drop the rest at
// parse time, save RAM, get a separate cache entry. The engine's
// `fields:` filter is wired (see SCAFFOLDING_NOTES.md TODO 1, done
// 2026-05-06 chat ~33).
const slimRows = await registry.resolve('relatedness_ngsrelate', {
  run_id: 'broodstock_qc_pass_v1',
  fields: ['a', 'b', 'theta', 'IBS0', 'IBS1', 'IBS2', 'KING']
});
```

`allRows` and `slimRows` cache separately (the cache key includes a
sorted `#fields=` suffix), so the wider read isn't served from the
narrower cache. Field order in the array doesn't matter — `['a','b']`
and `['b','a']` hit the same cache entry.

Numeric coercion still applies: `theta` comes back as a number,
`NA` as null. Sample IDs (in the `samples.txt` sidecar, not the
relatedness file itself) come back as strings.

The first call with a given `(run_id, fields)` parses + caches; later
calls return from warm cache.

---

## The IBS0 motivation

The pre-existing `data/precomp/catfish_226_relatedness.json` is a
columnar single-JSON Mode A artifact. It carries `pairs.a[]`,
`pairs.b[]`, `pairs.theta[]` — three of ngsRelate's twenty-three
columns. Useful for hub/family classification but **not enough for
Mendelian inheritance QC of inversion candidates**, where we need
IBS0 to discriminate parent-offspring from full-sib pairs and
distinguish real PO contradictions from genotyping noise.

Re-baking that JSON to add IBS0 today would be a one-time fix, but
the next analysis will want some other column we didn't think of
(R0/R1, KING-robust, J7/J8/J9 for IBD components). The Mode B layer
makes the bake step unnecessary: ask for the columns you need at
call time, the parser does the rest.

---

## What the atlas does NOT do

- Does not write into this folder. Pipeline-side R/Python writes
  ngsRelate output here.
- Does not interpret kinship thresholds. Mendelian inheritance,
  family detection, PO/FS classification all live in
  `analysis/mendelian_inheritance.js` and friends.
- Does not enforce sample ID consistency. The pipeline's
  `samples.txt` is the truth for index → sample-ID mapping. The
  registry exposes the file; analysis modules decide what to do with
  the indices.

---

## TODO before this folder is "live"

1. Confirm actual LANTA path for ngsRelate output and adjust the
   layer entry's `path` template if `data/relatedness/ngsrelate/<run_id>/`
   differs from the canonical pipeline location.
2. Populate at least one `<run_id>/` directory with a real
   `relatedness.tsv` to exercise the schema.
3. If ngsRelate is invoked with non-default flags (e.g. `-l 1` for
   long output, or `-F` for fixed-F), confirm the column set matches
   the schema before going live.
