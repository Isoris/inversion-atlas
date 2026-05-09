# SV evidence: chrom-level scroll + per-candidate detail + how candidates get created

You're describing the right model. Let me confirm it from the code,
because there's a real ambiguity in today's setup that's worth
naming, and the answer changes how versioning fits in.

---

## What the code actually shows

### Scrolling LG28 today (Z outliers, local PCA)

You're right: `data/precomp/LG28.json` is the single hot-tier file
that drives the scrubber. Its top-level keys include `windows`,
`sim_thumb`, `sim_scales`, `z_clip`, `z_max_min`, `theta_range`,
`l1_envelopes`, `l2_envelopes`, `l1_boundaries`, `l2_boundaries` —
everything you need to draw Z, sim_mat, candidate strips along the
chromosome. **One file. One fetch. RAM-resident.**

### What's not in `LG28.json` today

Looking at the chrom-aggregate keys, there's **no per-window SV
density**, **no per-window SV count**, **no per-window SV-evidence
strip**. The chrom-level scrubber doesn't currently render a
genome-wide SV track.

### What does exist for SV today

Three Python producers (`engines/producers/STEP_SV_*.py`) each emit
one JSON per candidate at:

```
data/candidates/<cand_id>/
├── sv_genotype_counts.json         (STEP_SV_GT_AGG)
├── sv_evidence_combinations.json   (STEP_SV_EVID_COMB)
└── sv_support_by_sample.json       (STEP_SV_SUPPORT)
```

The producer takes a candidate's `(chrom, boundary_left_bp,
boundary_right_bp, locked_karyotype_labels)` as input and emits
SV-call tables, UpSet combinations, per-sample dosage matrices —
but only **for the SV calls inside that candidate's window**. Open
LG28's `sv_genotype_counts.json` for `cand_LG28_15Mb` and you see
8 SV calls inside the 15.1–18.1 Mb candidate window. **Not all
LG28's SVs.** Just the ones near this candidate's boundaries.

The SV evidence page (`page_sv_evidence.js`) loads exactly these
per-candidate JSONs via `mod.loadCandidate(cid)` and renders the
SV table + UpSet plot + dosage heatmap. It is **not** scrolling
SVs across the chromosome.

---

## So your question, reframed

You're asking two things:

1. **Should there be a chrom-level SV summary in `LG28.json` (or
   alongside) so the scrubber can show SV density as you scroll?**
2. **When you create a candidate, where does the SV data come
   from — the chrom-level summary, the raw SV calls (VCF), or
   something in between?**

Both are real architecture questions. Let me answer each.

---

## Q1: chrom-level SV data for the scrubber strip

This is missing today. If you want a "SV density per window" track
in the scrubber (e.g., red ticks where DELLY/Manta calls cluster),
the right shape is the same shape `LG28.json` already uses for Z
and theta:

```jsonc
"windows": [
  {
    "center_mb": 15.1,
    "z": 2.31,
    "theta_pi": 0.0042,
    "sv_density":     0.47,    // ← NEW: per-Mb SV count, normalized
    "sv_n_inv_calls": 3,        // ← NEW: count of INV calls in window
    "sv_n_bnd_calls": 1         // ← NEW: count of BND calls in window
  },
  ...
]
```

That's a chrom-level aggregate, one row per scrubber window, no
SV detail (no individual sv_id, no genotype counts). It's just
**density / count tracks** suitable for a strip overlay.

The producer for this would be a fourth Python script:
`STEP_SV_CHROM_AGG_emit_density.py` that reads the same merged
DELLY+Manta VCF that the per-candidate producers use, but instead
of filtering to one candidate's window, it bins counts across the
whole chromosome at scrubber-window resolution and writes either:

(a) Inline into `LG28.json`'s `windows[]` array (the scrubber
    pre-existing pattern), or
(b) A sibling file `data/precomp/{chrom}/sv_density.tsv` registered
    as a hot-tier `chrom_change`-preloaded layer (the pattern
    `repeat_density` already uses).

(b) is cleaner because:
- `LG28.json` is already big; bloating it slows initial load.
- A TSV is parsable through the existing `format: tsv` + `fields:`
  filter pattern (we just wired that).
- Adding more chrom-level metrics later doesn't keep editing the
  Z-scrubber file.

So the model becomes:

```
HOT, chrom_change:
  scrubber_main          → LG28.json (Z, theta, sim, envelopes, candidate_proposals)
  repeat_density         → repeat_density.scrubber_windows.json
  sv_density             → sv_density.scrubber_windows.tsv  (NEW)
  candidate_tracks       → candidate_tracks.json (per-candidate hint blobs)
```

Scrubbing reads all of these from RAM, draws strips. **Zero
per-candidate JSONs opened during scroll.**

---

## Q2: how does candidate creation use the registry?

This is the cleanest part of the design and you've already named it
correctly. There are three distinct moments:

### Moment A — proposing a candidate from chrom-level data

The user is scrolling LG28 with Z outliers + theta troughs visible.
They lasso a region or an L2 envelope or auto-merge picks one. The
candidate is **proposed from data already in RAM**:
- `state.data.windows[i]` (loaded from `LG28.json`)
- `state.data.l2_envelopes[]`
- `state.data.boundaries`

**No registry write yet.** The candidate exists only in
`state.candidate` (single object) and optionally `state.candidateList`
(localStorage). This is the existing flow.

### Moment B — promoting the candidate (running the producer)

The user clicks "compute SV evidence" or similar. Now the candidate's
`(chrom, start_bp, end_bp, locked_labels)` are inputs to the three
SV producers. The producers run on LANTA against the merged VCF
**because the VCF is on LANTA** — that's the raw SV data, not in
the browser. They emit:

```
data/candidates/<cid>/sv_genotype_counts.json
data/candidates/<cid>/sv_evidence_combinations.json
data/candidates/<cid>/sv_support_by_sample.json
```

**This is where the registry write you mentioned belongs.** The
producer's emit step writes to the canonical per-candidate folder.
The atlas then reads these files through the existing
`candidate_sv_counts` and (future) `candidate_sv_combinations` /
`candidate_sv_support` layers.

The producers are pipeline-side (Python on LANTA). Today they are
launched manually via the SLURM script. In a fully wired flow, the
atlas could trigger them via a server endpoint
(`POST /compute/sv_evidence` on `popstats_server.py`, similar to how
ANGSD HoverE is triggered today). But that's optional —
the script-by-hand pattern works.

### Moment C — reading the candidate's SV data in the page

The user opens the SV evidence page on this candidate. The page
calls `registry.resolve('candidate_sv_counts', { candidate_id: cid })`
which reads the JSON the producer wrote. **The page never touches
the raw VCF.** It never touches the chrom-level density file
either — that's the scroll path, not the deep-dive path.

So the answer to "where does SV data come from when creating a
candidate":
- **Chrom-level density** comes from precomp (loaded once with
  LG28.json).
- **Per-candidate detail** comes from running the producer against
  the raw VCF at promotion time.
- **The registry's role** is to read what the producer wrote, not
  to write into the producer's input.

---

## Where versioning fits

Now the versioning model makes more sense in this context:

### Versioning the candidate detail (per-candidate folder)

When boundaries are refined (v1 → v2), the producer **must be
re-run** with the new `(start_bp, end_bp)`. Different boundaries
mean different SV calls inside the window. Versioned output:

```
data/candidates/<cid>/
├── lineage.json
├── v1_localPCA_initial/
│   ├── sv_genotype_counts.json        ← from producer run #1
│   ├── sv_evidence_combinations.json  ← (boundaries 15.1–18.0)
│   └── sv_support_by_sample.json
└── v2_theta_refined/
    ├── sv_genotype_counts.json        ← from producer run #2
    ├── sv_evidence_combinations.json  ← (boundaries 15.4–17.2)
    └── sv_support_by_sample.json
```

Re-running the producer is the **act of creating a new version**.
Two refinements = two producer runs = two version subfolders.

### Versioning the chrom-level density (NOT versioned)

`sv_density.scrubber_windows.tsv` is computed from the chromosome-
wide VCF, independent of any candidate. **It does not need
versioning.** Refining a candidate's boundaries does not change
chrom-wide SV density — only which SVs fall inside that candidate's
window. The scrubber strip stays the same.

That's the right separation: **versioning is per-candidate, not
per-chromosome.** The scroll path stays cheap because nothing in it
is candidate-versioned.

---

## What this means for the previous plan

The previous `CANDIDATE_VERSIONING_LOCAL.md` is still right. This
doc adds two clarifications:

1. **Producers write to `data/candidates/<cid>/<version_id>/...`**
   when run for a refined candidate. The version_id is determined
   at the producer-run step (either the user names it, or the
   producer auto-generates from a timestamp). The producer's
   output filenames don't change; only the path prefix.

2. **The scrubber needs a chrom-level SV density layer** if you
   want SV visibility while scrolling. That's a separate piece of
   work from versioning — it's a fourth producer + one new
   hot-tier layer entry. Not blocked on anything else.

---

## Three concrete pieces of work, ordered

In dependency order, none of them blocking each other:

### Piece α — chrom-level SV density layer (scroll-friendly)

- One new producer script: `STEP_SV_CHROM_AGG_emit_density.py`
- Writes `data/precomp/{chrom}/sv_density.scrubber_windows.tsv`
- One new hot-tier layer entry `sv_density`, `preload_on:
  chrom_change`, `format: tsv`
- One new schema `sv_density_scrubber_windows.schema.json`

Effort: ~1 session. Independent of versioning. Gives you the SV
strip on the scrubber.

### Piece β — candidate versioning (the previous plan)

- `lineage.json` per candidate
- Path templates for per-candidate layers gain `/{version_id}`
- `candidate_tracks.json` aggregate gains `active_version_id` per
  entry
- `setActiveCandidateVersion()` on AtlasState

Effort: ~1 session. Independent of α.

### Piece γ — producer wiring for versioned output

- Producer scripts accept a `--version-id` flag
- Output path becomes `data/candidates/<cid>/<version_id>/...`
- `lineage.json` is updated atomically when a producer run completes
  (either by the producer itself, or by a small sibling step)
- Optional: `POST /compute/sv_evidence` endpoint on
  `popstats_server.py` so the browser can trigger the producer

Effort: ~1-2 sessions, depends on β being done first.

α and β are parallel. γ comes after β. None of the three blocks the
ngsRelate / Mendelian work that's already wired.

---

## Direct answer to your question

> "If we scroll from start to end on genomic coordinates, it's not
> fit to open many SV JSONs and so on. Or is it just good like
> that?"

Two parts:

- **Today:** the scroll opens `LG28.json` (one file, RAM) and
  doesn't open SV JSONs. So scroll cost is fine. But the scroll
  also doesn't *show* any SV info — there's no chrom-level SV
  track yet.
- **If you want SV visibility on the scrubber:** add a chrom-level
  density layer (Piece α). That's one extra small file per chrom,
  hot tier, loaded with the rest. Per-candidate SV detail stays
  per-candidate, only loaded on click.

> "When we create candidate it uses the registry to write that
> candidate using the data in precomp or sv raw data or it depends"

Depends — and the existing producer pipeline already gets it right:

- **Chrom-level metadata** (envelope, boundaries hint) comes from
  precomp (already in RAM via LG28.json).
- **Per-candidate SV detail** comes from running producers against
  the raw VCF on LANTA. The producer outputs land in
  `data/candidates/<cid>/<version_id>/...` and the registry serves
  them on `candidate_change`.
- **Versioning ties them together**: one candidate = one folder =
  multiple version subfolders, each with its own producer-emitted
  JSONs. The chrom-level density is shared across all candidates
  on that chromosome and is not versioned.

That's the full chain. Same shape on both sides: Z and theta come
from `LG28.json` and stay in RAM for scroll; SV would do the same
with a chrom-level density layer if you want it. Per-candidate SV
detail stays per-candidate, with versioning inside the
per-candidate boundary.
