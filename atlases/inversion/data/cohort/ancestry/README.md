# data/ancestry/

Ancestry results — global Q matrices, per-window/per-region local Q,
F matrices — read by the atlas in **mixed mode**:

- **Mode B (raw-folder interface)** for static, pre-computed Q/F
  matrices that the manuscript pipeline writes once.
- **Operation-backed (server-driven)** for groupwise Q computed
  on-demand from sample groups the user picks at runtime
  (`/api/ancestry/groupwise_q` on popstats_server.py).

The two modes coexist. The runtime ancestry layer
(`ancestry_q_groupwise`) already exists as operation-backed; this
folder adds the pipeline-side static layers.

---

## Layout

```
data/ancestry/
├── global/
│   └── K<k>/
│       ├── ngsadmix.qopt                ← per-sample Q (canonical)
│       ├── ngsadmix.fopt                ← per-site F
│       ├── samples.txt                  ← sample order
│       └── params.json                  ← K, seed, conv, n_iter
├── instant_q/                            (server consumes this; not browser-read)
│   └── <chrom>/
│       └── K<k>/
│           └── local_Q.<scale>.bin      ← binary Q matrix per window
├── windows/                              (pre-aggregated for the atlas)
│   └── <chrom>_K<k>.tsv                 ← long-format Q-by-window for plotting
└── README.md                            ← this file
```

The `instant_q/` subdirectory is **not** read by the browser. The
server reads it on demand when answering `POST /api/ancestry/groupwise_q`.
The browser only sees its outputs through the operation layer.

---

## Column conventions

### `global/K<k>/ngsadmix.qopt`

Whitespace-separated. One row per sample (in `samples.txt` order).
K columns, each ∈ [0, 1], rows sum to 1.

| Column | Type | Meaning |
|---|---|---|
| `Q1` … `QK` | float | per-cluster ancestry proportion |

No header in the file; the schema knows the K from the path.

### `windows/<chrom>_K<k>.tsv`

Long-format, with header. One row per (window, sample, cluster)
triple. Used by the local-ancestry scrubber.

| Column | Type | Meaning |
|---|---|---|
| `chrom` | string | LG name |
| `window_idx` | int | 0-based window index along chrom |
| `start_bp` | int | window start |
| `end_bp` | int | window end |
| `sample_id` | string | canonical sample ID |
| `cluster` | int | cluster index, 0…K-1 |
| `q` | float | ancestry proportion for this cluster in this window |

---

## How the atlas reads it

Static global Q (Mode B):

```js
const globalQ = await registry.resolve('ancestry_global_q', { K: 8 });
// Array of { sample_id, Q: [q1, ..., qK] }
```

Per-window local ancestry (Mode B, big files — chunked or pre-aggregated):

```js
const winQ = await registry.resolve('ancestry_local_q_windows',
                                    { chrom: 'C_gar_LG28', K: 8 });
```

Groupwise Q on demand (operation, already exists):

```js
const grpQ = await registry.resolve('ancestry_q_groupwise', {
  chrom: 'C_gar_LG28',
  groups: { HOM_REF: [...], HET: [...], HOM_INV: [...] },
  K: 8
});
```

---

## What the atlas does NOT do

- Does not run NGSadmix or instant_q. Those live in the pipeline.
- Does not decide K. K=8 is the canonical value for this cohort but
  any K with files on disk can be requested.
- Does not interpret cluster identity. Cluster ordering can rotate
  across runs; sample-mapping logic lives in analysis modules.

---

## TODO before this folder is "live"

1. Confirm canonical NGSadmix output paths on LANTA. The schema
   and layer entry currently assume the layout above; adjust
   `path` templates if the real layout differs.
2. Decide whether the pipeline pre-aggregates `windows/<chrom>_K<k>.tsv`
   or whether the atlas requests a server endpoint to do it.
   Pre-aggregation is faster for the atlas but means an extra
   pipeline step. Defaulting to pre-aggregation in the schema; flip
   to operation-backed if the file size becomes problematic.
3. Populate `global/K8/` for the current 226-sample cohort to exercise
   the schema and layer entry.
