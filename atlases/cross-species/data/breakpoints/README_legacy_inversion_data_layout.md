# data/cross_species/

Cross-species comparative results — synteny, breakpoint reuse, PAF
alignments, ortholog mappings — read by the atlas as
**Mode B (raw-folder interface)**.

This folder hosts evidence from comparing the *C. gariepinus* hatchery
reference genome against *C. macrocephalus*, *C. batrachus* (mac, gar
hybrid haplotypes), and other catfish genomes (9-11 species total per
the catfish-synteny-toolkit design).

---

## Layout

```
data/cross_species/
├── synteny/
│   └── <ref>__vs__<query>/
│       ├── alignment.paf            ← wfmash output
│       ├── synteny_blocks.tsv       ← parsed synteny blocks
│       └── params.json              ← wfmash flags, identity threshold
├── breakpoints/
│   └── <ref>__vs__<query>/
│       └── breakpoint_reuse.tsv     ← shared breakpoints
├── orthologs/                        (future)
│   └── <ref>__vs__<query>/
│       └── orthologs.tsv
├── multi_species/
│   └── <run_id>/
│       └── synteny_multispecies.json   ← curated multi-way comparison (Mode A)
└── README.md                        ← this file
```

`<ref>__vs__<query>` uses double underscore to separate the
two genome IDs, e.g. `C_gar_v1__vs__C_mac_v1`. Genome IDs are
short, underscore-only, no spaces. The pair is directional: `<ref>`
is the coordinate system of the output rows.

---

## Column conventions

### `synteny/<pair>/synteny_blocks.tsv`

Tab-separated, with header. One row per syntenic block.

| Column | Type | Meaning |
|---|---|---|
| `ref_chrom` | string | reference chromosome |
| `ref_start` | int | block start in ref coordinates |
| `ref_end` | int | block end in ref coordinates |
| `query_chrom` | string | query chromosome |
| `query_start` | int | block start in query coordinates |
| `query_end` | int | block end in query coordinates |
| `strand` | string | `+` or `-` |
| `identity` | float | mean per-base identity within block |
| `n_alignments` | int | number of underlying wfmash alignments aggregated |

### `breakpoints/<pair>/breakpoint_reuse.tsv`

Tab-separated, with header. One row per shared breakpoint.

| Column | Type | Meaning |
|---|---|---|
| `ref_chrom` | string | |
| `ref_bp` | int | breakpoint position in ref coordinates |
| `query_chrom` | string | |
| `query_bp` | int | breakpoint position in query coordinates |
| `support_class` | string | enum: `strong`, `moderate`, `weak` |
| `evidence_types` | string | comma-separated, e.g. `wfmash,manta_bnd,delly_inv` |
| `notes` | string | free text |

### `multi_species/<run_id>/synteny_multispecies.json`

Curated JSON (Mode A — atlas-shaped, not raw tool output). Already
referenced by the existing `synteny_multispecies` layer entry, which
is `provisional: true` and `owned_by: "genome"` — the future genome
atlas inherits this layer; we keep it provisional in the inversion
atlas as a fallback.

---

## How the atlas reads it

```js
// Mode B — raw synteny blocks for a specific pair
const blocks = await registry.resolve('cross_species_synteny_blocks', {
  pair: 'C_gar_v1__vs__C_mac_v1'
});

// Mode B — breakpoint reuse for a pair, optionally a chrom subset
const breaks = await registry.resolve('cross_species_breakpoint_reuse', {
  pair: 'C_gar_v1__vs__C_mac_v1',
  // optional fields filter:
  fields: ['ref_chrom', 'ref_bp', 'query_chrom', 'query_bp', 'support_class']
});

// Mode A — pre-baked multi-species view (existing layer, provisional)
const multi = await registry.resolve('synteny_multispecies', {});
```

---

## What the atlas does NOT do

- Does not run wfmash, minimap2, or any aligner. Those live in
  pipeline scripts.
- Does not perform synteny block aggregation from raw PAF. The
  pipeline aggregates; atlas reads the aggregate.
- Does not score breakpoint reuse. That logic belongs in
  `analysis/cross_species_support.js` (future), which would join
  reused breakpoints against the active inversion candidate's
  boundaries.

---

## Ownership note

The existing `synteny_multispecies` layer is flagged
`owned_by: "genome"` because cross-species evidence is atlas-wide
(genome-atlas concern), not inversion-specific. The succession rule
(README_PAIRING.md §11) says the inversion atlas's provisional entry
is silently overridden when the genome atlas registers itself. Layer
entries added in this folder follow the same convention: declare
`provisional: true, owned_by: "genome"` so the genome atlas can take
ownership without conflict.

---

## TODO before this folder is "live"

1. Confirm canonical wfmash output paths on LANTA. The catfish-synteny
   -toolkit was designed but not yet wired to a real run output here.
2. Decide on the parsed `synteny_blocks.tsv` aggregator script —
   pipeline side. Schema lock-in waits until that script exists.
3. The `multi_species/<run_id>/` JSON shape needs the genome atlas's
   input. Hold the schema as a placeholder until the genome atlas
   gets started.
