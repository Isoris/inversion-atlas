# Scrolling vs. candidate-scoped data — answer + design call

You're asking the right question. Let me lay out what's actually
loaded during a left-to-right genomic scroll versus what's only
loaded when you focus on one candidate, then locate where versioning
fits without breaking the scroll.

---

## The two access patterns the atlas already separates

### Pattern A — "I'm scrolling along the chromosome"

These layers fire on `chrom_change` and live in **HOT tier (RAM)**.
One file per chrom. Loaded once when you open LG28; sub-millisecond
reads as you scroll:

```
scrubber_main              data/precomp/{chrom}.json
repeat_density             data/precomp/{chrom}/repeat_density.scrubber_windows.json
band_nodes                 data/precomp/{chrom}/band_nodes.tsv
band_edges                 data/precomp/{chrom}/band_edges.tsv
transition_events          data/precomp/{chrom}/transition_events.tsv
band_trajectories          data/precomp/{chrom}/band_trajectories.tsv
het_band_backbones         data/precomp/{chrom}/het_band_backbones.tsv
candidate_track_proposals  data/precomp/{chrom}/candidate_track_proposals.tsv
candidate_tracks           data/precomp/{chrom}/candidate_tracks.json
```

Notice the last two: `candidate_tracks.json` and `candidate_track_proposals.tsv`
are **per-chromosome aggregates**. They contain the small per-candidate
hints (id, start_bp, end_bp, status flag) needed to *draw the candidate
strip on the scrubber*. They do NOT contain SV evidence, gene cargo,
markers, lineage, or anything heavy. **One file, all candidates on
the chromosome, hot tier.**

### Pattern B — "I clicked on a specific candidate"

These fire on `candidate_change` and live in **WARM tier (IndexedDB)**.
One file per candidate, per aspect:

```
candidate_sv_counts            data/candidates/{cid}/sv_genotype_counts.json    (~8 KB observed)
candidate_boundaries           data/candidates/{cid}/boundaries_refined.json
candidate_gene_cargo           data/candidates/{cid}/gene_cargo.json
candidate_marker_primers       data/candidates/{cid}/marker_primers.json
candidate_breeding_card        data/candidates/{cid}/breeding_readiness_card.json
candidate_final_class          data/candidates/{cid}/final_classification.json
candidate_karyotype_per_sample data/candidates/{cid}/karyotype.json
arrangement_calls              data/arrangement_calls/{cid}/arrangement_calls.json
```

These fire **only when the user picks a candidate**. They do NOT
fire on scroll. Eight ~10 KB JSON fetches, in parallel, when you
focus on one candidate. After that, IndexedDB caches them, so
clicking back to that candidate later is instant.

---

## Why the scroll doesn't open many SV JSONs

The scrubber strip you scroll through reads `candidate_tracks.json`
— **one per-chrom file** that already aggregates every candidate on
the chrom into a small array of `{id, start_bp, end_bp, label,
status}` entries. So scrolling LG28 with 23 candidates on it is one
fetch, one parse, fits in RAM, sub-ms reads.

The 8-file-per-candidate explosion only happens when you **click** a
candidate to deep-dive. That's the right design — you don't load
LG28's 23 × 8 = 184 files just to scroll past them on the strip.

So the existing model is already correct for scroll. **Versioning
does not change this.**

---

## Where versioning fits without breaking scroll

This is where I should have been more careful. There are two layers
of fields, and they need different homes:

### Lightweight, scroll-relevant fields → stay in `candidate_tracks.json`

The per-chrom aggregate file already carries each candidate's
`{id, start_bp, end_bp, status}`. For versioning to work in the
scrubber strip, this file needs **two more fields per candidate
entry**:

```jsonc
{
  "id":               "1715000000000_a4b",
  "active_version_id": "v2_theta_refined",   // ← NEW
  "n_versions":        2,                    // ← NEW (optional, for badge)
  "chrom":            "C_gar_LG28",
  "start_bp":         15400000,              // ← from the active version
  "end_bp":           17200000,              // ← from the active version
  "status":           "active",
  "label":            "LG28-15M"
}
```

**That's it for the scroll path.** The scrubber strip has everything
it needs to draw the candidate at its active-version boundaries
without opening any per-candidate folder.

The pipeline that emits `candidate_tracks.json` becomes responsible
for reading each candidate's `lineage.json` and copying the
active-version boundaries up to this aggregate. That's a one-line
change in whatever R/Python script generates `candidate_tracks.json`.

### Heavy, deep-dive-only fields → per-candidate folder, per-version subfolder

When the user clicks a candidate, the eight existing layers fetch
under `data/candidates/{cid}/{version_id}/...`. Lineage adds one
more file at the candidate root (not under a version subfolder
because lineage is the index *across* versions):

```
data/candidates/1715000000000_a4b/
├── lineage.json                            ← which versions exist + active
├── v1_localPCA_initial/
│   ├── boundaries_refined.json
│   ├── gene_cargo.json
│   ├── sv_genotype_counts.json
│   ├── ...
│   └── mendelian_inheritance.json          ← analysis output for v1
└── v2_theta_refined/
    ├── boundaries_refined.json
    ├── gene_cargo.json
    ├── sv_genotype_counts.json
    ├── ...
    └── mendelian_inheritance.json          ← analysis output for v2
```

Clicking a candidate fires `candidate_change`. The prewarm scheduler
fetches `lineage.json` and the eight version-scoped files in
parallel. Same as today, just one extra file. Eight files become nine.

Switching versions while staying on the same candidate fires the
event again; nine more fetches against the new version subfolder.
IndexedDB keeps both versions cached, so flipping between them is
instant after the first visit.

---

## The actual question: is this fit for purpose?

Yes, with one nuance worth flagging. Three scenarios:

### Scenario 1 — scrolling LG28 left to right
**Cost:** zero candidate-folder reads. The scrubber reads
`candidate_tracks.json` once, draws all 23 candidates on the strip,
done. Versioning adds two fields per candidate entry to that file.
**No regression.**

### Scenario 2 — clicking one candidate to deep-dive
**Cost today:** 8 parallel warm-tier fetches.
**Cost with versioning:** 9 parallel warm-tier fetches (one extra
for `lineage.json`).
The 9 fetches happen once per (candidate, version) pair, then sit
in IndexedDB. **Negligible.**

### Scenario 3 — comparing v1 vs v2 of the same candidate
**Cost today:** can't be done — v1's data was overwritten.
**Cost with versioning:** 18 fetches the first time (9 for v1, 9
for v2), 0 fetches every time after thanks to IndexedDB.
**This is the new capability, and it costs ~80 KB of network +
parse on first visit, zero after.**

So scrolling stays cheap. Versioning costs are only paid when you
actually open versioned data. That's the right shape.

---

## The one nuance: `dosage_chunk_layer`

Among the candidate-scoped layers, `dosage_chunk_layer` is the
heaviest by far — it's a server-computed dosage chunk, not a small
JSON. It's `source: operation` (not file), so it's not a "file
explosion" concern, but if dosage chunks become per-version (which
they should, since refined boundaries change which dosage windows
matter), the operation cache key needs `version_id` in it too.

That's a one-line change to the operation entry's `cache_key`
template. Server-side, the dosage cache is already content-addressable
(hashes the request payload), so different boundaries → different
hash → different cache slot. **No regression there either.**

---

## Direct answer to your question

> "If we scroll from start to end on genomic coordinates, it's not
> fit to open many SV JSONs and so on. Or is it just good like that?"

**It's already good like that.** The scroll path uses one per-chrom
aggregate file (`candidate_tracks.json`), not per-candidate files.
Adding versioning to the model only changes what happens when the
user *focuses* on a candidate — which is exactly when you'd want to
load that candidate's deep data anyway.

> "Have the full and have the candidate one maybe versions"

Yes, that's exactly the split:

- **The full** = `candidate_tracks.json` per chrom. Lightweight summary
  of all candidates including each one's active version. Scroll-friendly.
- **The candidate one** = `data/candidates/{cid}/{version_id}/...`
  Deep data, only loaded on click, cached forever after first load.

Versioning sits **inside** the candidate-deep-dive boundary; it
doesn't leak into the scroll path. The scrubber gets the
active-version boundaries from the aggregate file and never opens a
per-candidate folder.

---

## Tiny update to the previous plan

The previous plan was complete except for one missing piece: I didn't
explicitly say `candidate_tracks.json` needs `active_version_id` and
`n_versions` per entry. That's the fix. Path templates for the per-
candidate layers still gain `/{version_id}`. `lineage.json` still
sits at the candidate root. Everything else is unchanged.

Implementation order remains: schema for `candidate_lineage`, layer
entry, path-template edits, optional state method. Plus one note for
whoever maintains the `candidate_tracks.json` generator script: add
`active_version_id` per entry.

Net change to "what gets loaded during scroll": zero. The aggregate
file gets two more small fields per candidate, that's it.
