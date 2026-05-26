# SPEC — catalogue L1-merged + L3 view modes

**Status**: SPEC ONLY — authored 2026-05-21 from the dead-button audit
(Group 3). The two view-mode buttons ship in
[`catalogue.html:10-12`](../atlases/inversion/pages/catalogue/catalogue.html#L10-L12)
inside the existing view-mode row (which already wires `catViewL2` +
`catViewFav` via [`catalogue/catalogue.js:899-900`](../atlases/inversion/pages/catalogue/catalogue/catalogue.js)).
Two of the four buttons in the row work; two don't.

**Implemented in**: nothing for these two specifically. Companion code
that exists:
- `catViewL2` (working): one row per raw L2 envelope from `state.data.l2_envelopes`.
- `catViewFav` (working): filters to rows the user has starred.
- Wiring pattern: [`catalogue/catalogue.js`](../atlases/inversion/pages/catalogue/catalogue/catalogue.js) uses a `state.viewMode` slot read by `buildCatalogueRows` + `filterCatalogueRows`.

---

## 1. Goal

Two additional view modes for the L2 catalogue table:

### 1.1 L1-merged view (`catViewL1`)
Tooltip says: "L2s merged left-to-right by concord ≥ merge_thr
(final-style catalogue)". One row per L1-equivalent (a contiguous run
of L2 envelopes whose adjacent-pair concordance exceeds a threshold).
The "final-style catalogue" is the curated view used in manuscript
supplementary tables — readers see ONE entry per inversion-system, not
per raw envelope.

### 1.2 L3 view (`catViewL3`)
Tooltip says: "L3 view — sub-L2 cluster groupings (placeholder; will
populate when wired)". Inverse of L1: one row per sub-L2 cluster, where
each L2 envelope's K-means clusters are surfaced as individual rows.
Used to inspect within-L2 substructure (e.g. "L2#27 has 3 sub-bands;
which is the inversion-carrier subcluster?").

Both views render through the same `_paintCatalogueRow` machinery as
the working L2-raw view — only the row source changes.

## 2. L1-merged view — design

### 2.1 Row source

For the active chromosome, walk `state.data.l2_envelopes` left-to-right.
For each adjacent pair `(L2_i, L2_{i+1})`, compute a concordance score
(Cramér's V on the Hungarian-aligned K-means contingency, the same
metric the L3-pairs table already uses in
[`pages/discovery/haplotype_regimes.js:_renderL3PairsTable`](../atlases/inversion/pages/discovery/haplotype_regimes.js)).

Merge into a single L1 row whenever `V >= merge_thr` (default 0.50,
configurable per below). The result is a list of `L1_chains`, each one
a contiguous run of L2 indices that share carriers.

### 2.2 Per-row aggregation

Each L1 row's displayed fields are aggregates over its constituent L2s:

| column | aggregation |
|---|---|
| id | `L1_<chrom>_<first L2 idx>` |
| chrom | (same for all members) |
| start_bp | min over members |
| end_bp | max over members |
| span_bp | end_bp − start_bp |
| n_l2 | members.length |
| K | most-common K across members |
| verdict | per-row aggregator (see §2.3) |
| family_purity | weighted mean (weight = member span) |
| n_windows | sum |
| min_concord | min over the adjacent-pair Vs (the WEAKEST link in the chain) |

### 2.3 Verdict aggregation

When members disagree on verdict (e.g. mostly TWO_INVERSIONS with one
CROSSOVER_ARTIFACTS), the row's verdict reflects the majority. Special
rule: any single `NOISY_REGION` member downgrades the whole row to
`MIXED` so the user notices a chain with a weak link.

### 2.4 `merge_thr` knob

Controlled via a numeric input next to the view-mode buttons (label:
"concord threshold:"). Default 0.50. Persisted in localStorage as
`pca_scrubber_v3.catL1MergeThr`. Range [0.0, 1.0] step 0.05. Changing
the threshold re-runs `_buildL1Chains` and re-renders the table —
cheap relative to the K-means cost (concordance is reused from the L3
pairs cache).

## 3. L3 view — design

### 3.1 Row source

For the active chromosome, for each `L2_i` in `state.data.l2_envelopes`,
get the K-means cluster from `getL2Cluster(state, i)` and emit ONE row
per cluster (band). Result: roughly `n_l2 × mean(K)` rows — ~3-6× the
L2-raw count.

### 3.2 Per-row fields

| column | meaning |
|---|---|
| id | `L3_<chrom>_<L2_idx>_<k>` (e.g. `L3_LG07_27_2` = L2 #27, band 2) |
| parent_l2 | the L2 envelope id this band belongs to |
| chrom | (from parent L2) |
| start_bp | parent L2's start (the L3 inherits the L2's bp range) |
| end_bp | parent L2's end |
| span_bp | (same as L2) |
| band | the K-means band index (0..K-1) |
| n_carriers | count of samples with `locked_labels[si] === band` |
| frac_carriers | n_carriers / n_samples |
| within_band_pc1_spread | σ of PC1 values for carriers (cluster tightness) |

### 3.3 What L3 view IS NOT

It's NOT the same as "show all bands per L2 in the L2-raw table" — the
L2-raw view shows ONE row per envelope with K-band pills; the L3 view
shows ONE row per band with the carrier list usable for sorting /
filtering by band-level fields.

Use cases the L3 view enables:
- "Which sub-band is the inversion carrier in L2 #27?" — sort L3 rows
  by frac_carriers descending; the rare-allele subcluster shows up at
  the bottom.
- "Find all bands with within_band_pc1_spread > 0.10" — sort by spread
  desc, scan for high-σ bands that may be unstable cluster calls.
- "Compare carrier counts across all L2s × all K-bands" — the
  per-(L2, K) granularity is in the L3 view.

## 4. Wire-up

Two new wires inside `wireCatalogueToolbar`:

```js
const viewL1 = document.getElementById('catViewL1');
const viewL3 = document.getElementById('catViewL3');

if (viewL1) {
  viewL1.addEventListener('click', () => _setViewMode(state, 'l1'));
}
if (viewL3) {
  viewL3.addEventListener('click', () => _setViewMode(state, 'l3'));
}
```

Plus two new branches in `buildCatalogueRows(state)`:

```js
if (state.viewMode === 'l1') return _buildL1Chains(state);
if (state.viewMode === 'l3') return _buildL3Bands(state);
// existing branches for 'l2' / 'fav' / etc.
```

The .active class swap inside `_setViewMode` is generic; the wire above
extends it to include the two new buttons.

## 5. Caching

Both views derive from `state.data.l2_envelopes` + the per-L2 cluster
cache (already on `state.data._l2ClusterCache` per the 2026-05-21 perf
work). Build them on first activation, cache on state:

```js
state._catalogueL1Cache = { chrom, mergeThr, rows };
state._catalogueL3Cache = { chrom, rows };
```

Invalidate when `state.data` identity changes (chrom switch) or when
the clustering knobs change (re-uses `clusterCacheKey(ctx)` — same
invariant the L2-cluster cache uses).

## 6. Empty + degraded states

| condition | behaviour |
|---|---|
| `state.data.l2_envelopes` empty | both buttons disabled; tooltip "no L2 envelopes loaded" |
| L1 chain compute fails (e.g. cluster cache empty) | row shows "—" for concord-aggregated fields; warning toast "L1 chains: some adjacent-pair concords unavailable; using L2-raw fallback for those rows" |
| L3 view but `locked_labels` undefined | row n_carriers/frac_carriers shows "—"; tooltip explains "locked_labels not set — promote a candidate or run K-means first" |

## 7. Failure modes

| # | condition | behaviour |
|---|---|---|
| 7.1 | merge_thr set to 0.0 | every adjacent pair merges → one giant L1 chain spanning the chrom. Render the row as usual (validates the cap); user sees the warning that they've collapsed all structure |
| 7.2 | merge_thr set to 1.0 | nothing merges → L1 view degenerates to L2-raw view. Row count matches L2-raw; user notices the threshold is too strict |
| 7.3 | L3 row count explodes (e.g. nL2 × K = 500+ rows) | use the existing catalogue table's pagination/virtualization. If not yet implemented for L2-raw at this scale, both views inherit the same cap |

## 8. Decision rationale

- **Why concordance not just adjacency for L1 merging**: pure adjacency
  merges L2s that happen to be neighbours but carry different
  samples — defeats the "show me one row per inversion-system" purpose.
  Concordance ensures that members of a chain share the same carrier
  partition.
- **Why default merge_thr = 0.50**: matches the existing lineage compute
  default in `lineage.js#LINEAGE_DEFAULT_THRESHOLD`. Coherent across
  the atlas's concordance UIs.
- **Why "MIXED" verdict downgrade rule**: a NOISY_REGION L2 in a chain
  means the chain spans a region where the clustering is unreliable.
  Surfacing this as MIXED forces the user to look — alternatives like
  "majority wins" or "ignore noisy" hide the weak link.
- **Why L3 = one row per band (not per (L2, band, sample))**: a per-sample
  L3 view is per-candidate work (karyotype_tier already does it). The
  catalogue's purpose is cohort-level inventory; a band-level row is
  the right granularity here.

## 9. Open questions for Quentin

1. **L1 merge_thr default**: 0.50 to match lineage compute. Confirm or
   suggest different (e.g. 0.70 for "stricter")?
2. **L3 row coverage**: emit a row per band for EVERY L2, OR skip
   bands with n_carriers = 0? Default: emit all (consistent count
   per L2 = simpler scan).
3. **Column visibility**: which columns should the L1 view hide that
   make sense for L2-raw (e.g. silhouette, coherence)? Both views
   currently inherit the L2-raw column set; they may need their own
   subset.
4. **Sort behaviour on view switch**: preserve the user's current sort
   column even when it doesn't exist in the new view (silently
   fall back to default)? Or reset to default on every switch?
5. **L1 → L3 chain rendering**: should an L1 row's L3 view show all the
   band-rows of its constituent L2s clustered together (chain-grouped),
   or scattered through the L3 row list?
