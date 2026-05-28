# Methods — population-genomic detection and karyotyping of polymorphic inversions

> Draft methods manuscript, auto-assembled from the implementation. Focus is on
> the **mathematics and statistics** of the analysis chain, from raw dosage to
> per-regime population statistics. Visualisation / atlas-UI machinery is
> deliberately omitted. Each step cites the implementing module as
> `path:line` so the formulas can be checked against source. Default parameter
> values are given inline and collected in the table at the end.
>
> **Provenance note.** Most of the chain is implemented in JavaScript in this
> repository and the formulas below were read directly from source. Two stages
> are computed by external engines and are flagged explicitly: (i) the
> per-window local-PCA precompute (`z`, `λ₁`, `λ₂`, PC scores) is produced by an
> upstream R pipeline that writes the per-chromosome precomp JSON consumed here;
> (ii) per-group nucleotide diversity / F_ST / d_XY are computed by atlas-core's
> `region_popstats` engine reached over HTTP. For those two, the forms given are
> the standard estimators the data/contract imply and should be confirmed
> against the engine source before publication.

---

## 0. Cohort, input encoding, and windowing

### 0.1 Cohort

The reference cohort is **226 individuals** of pure *Clarias gariepinus*
(African catfish) from a hatchery pedigree. All worked examples below use
linkage group **LG28**, whose precompute carries `n_samples = 226` and
`n_windows = 4302` (`atlases/inversion/data/precomp/LG28.json`,
`schema_version = 3`).

### 0.2 Allele dosage

The atomic input is **allele dosage** `d_{s,m} ∈ [0, 2]` for sample `s` at
biallelic marker `m`: the (possibly imputed) expected count of the alternate
allele, i.e. `0 = REF/REF`, `1 = REF/ALT`, `2 = ALT/ALT`. Dosage is streamed
from a Beagle/VCF-derived store. In the compact transport encoding a byte
`v ∈ [0,254]` decodes as `d = v / 127` and `v = 255` marks missing
(`shared/similarity_matrix.js:28`); the legacy heatmap path carries `d ∈ [0,2]`
directly as `Float64`.

### 0.3 Windows and the hierarchical envelope tree

The chromosome is partitioned into contiguous, non-overlapping **windows**
indexed `w = 0 … n_windows−1`. Each window record carries genomic coordinates
and the local-PCA summary:

```
windows[w] = { idx, start_bp, end_bp, center_mb,
               z, lam1, lam2,
               pc1 : Float64[n_samples],
               pc2 : Float64[n_samples] }
```

(observed shape, `LG28.json`). On LG28 the first window spans
`100 247–135 535 bp` (≈35 kb). Windows are grouped into a two-level
**envelope** hierarchy stored alongside the windows:

- **L1 envelopes / boundaries** — coarse blocks (`l1_envelopes`, `l1_boundaries`).
- **L2 envelopes / boundaries** — finer candidate regions (`l2_envelopes`,
  `l2_boundaries`); an L2 envelope is the unit a candidate inversion is called
  on. Envelopes are named e.g. `C_gar_LG28_d17L2_0010_03` (cohort `C_gar`,
  chromosome `LG28`, detector `d17`, level `L2`, block `0010`, envelope `03`).

This envelope tree is the scaffold on which all later per-region statistics are
computed.

---

## 1. Local PCA on dosage and the genome-wide structure scan

### 1.1 Per-window local PCA

For each window `w` a local principal-component analysis is run on the
sample × marker dosage submatrix `D^{(w)}` (samples in rows). Columns
(markers) are mean-centred; the leading eigenvectors of the
sample-covariance are taken, giving per-sample scores on the first two axes,
stored as `pc1[s]`, `pc2[s]`, together with the two leading eigenvalues
`λ₁ = lam1 ≥ λ₂ = lam2`. (The precompute itself is produced upstream; the atlas
consumes `pc1/pc2/lam1/lam2` per window.)

Because the sign of an eigenvector is arbitrary, PC1 is **sign-anchored** across
windows before any cross-window comparison (see §4.5).

### 1.2 The |Z| detection statistic

The genome-wide detection track is the per-window field `z`. The precompute
sets `z_column = "lam_1"` (`LG28.json`), i.e.

```
Z(w) = λ₁(w)          (leading local-PCA eigenvalue; "local |Z|")
```

A window with a strong single axis of population structure — the signature of a
segregating inversion — has large `λ₁` and a large eigenvalue ratio `λ₁/λ₂`.
`z_clip = 5` and `z_max_min = 2.5` are **display/scaling** parameters, not an
absolute detection cut: on LG28 `λ₁` never falls below ≈ 7.9 (§11.1), so
candidate regions are identified as *relative* `λ₁` maxima with elevated
`λ₁/λ₂`, not by thresholding `λ₁` against 2.5. The eigenvalue ratio recurs as a
band-quality term (§3.1). A complementary robust per-sample residual diagnostic
uses the median / MAD of within-band PC1 rather than the mean/SD
(`pages/discovery/local_pca_dosage/diag_residuals.js:19`).

### 1.3 Window × window similarity matrix

To find runs of windows that share the same structure, a window-vs-window
similarity is built from **Pearson correlation of sample dosage vectors**, with
optional per-marker polarity correction `d ← 2 − d`:

```
r_{ij} = Σ_m (d_i[m]−d̄_i)(d_j[m]−d̄_j)
         ───────────────────────────────────
              (n−1) · sd_i · sd_j
```

over markers `m` present in both samples (pairwise deletion). If either SD is 0
or fewer than `SIMILARITY_MIN_MARKERS = 20` markers are shared, the entry is set
to the neutral value 0 (`shared/similarity_matrix.js:147`, threshold at `:34`).
Setting `absoluteValue = true` uses `|r_{ij}|` so that outer-polarity flips do
not break a block. Adjacent-window agreement of these structures is later
quantified by ARI/NMI (§2.4).

### 1.4 Per-window K-means banding

Within a window the per-sample PC1 scores are clustered in 1-D by Lloyd's
algorithm with quantile initialisation (`shared/kmeans.js:31`):

```
kmeans1D(values, K):
  centres_k ← quantile sorted[(k+0.5)/K · n]          k = 0 … K−1
  repeat ≤ 12 epochs:
    label_i ← argmin_k |value_i − centre_k|
    centre_k ← mean{ value_i : label_i = k }
  relabel so centre_0 ≤ … ≤ centre_{K−1}
```

`K` may be fixed (default `K = 3`) or selected adaptively
(`adaptiveK1D`, `shared/kmeans.js:182`): for `k = k_min … k_max` (default
`2 … 5`) run `kmeans1D`, reject any `k` whose smallest group `< minNGroup`
(default 5), and keep the `k` with the highest **1-D silhouette**

```
s_i = (b_i − a_i) / max(a_i, b_i),     silhouette = (1/n) Σ_i s_i
```

where `a_i` is the mean distance from `i` to others in its cluster and `b_i` the
minimum over other clusters of the mean distance to that cluster. The silhouette
floor (default `0.45`) is advisory: the highest-silhouette `k` is returned even
if below threshold. **Per-window** labels are used everywhere downstream; they
are never broadcast across an envelope (the load-bearing rule in
`band_tracking/index.js`).

`K = 3` is the expected banding for a single biallelic inversion: the three
clusters are the two homokaryotypes and the central heterokaryotype band.

### 1.5 Scale-stability and σ-profile classifiers

Two auxiliary classifiers summarise whether the banding is real and how many
inversions are present.

**Scale stability** (`shared/scale_stability.js`) clusters the same region at
three scales (a 5-window neighbourhood, the enclosing L2 envelope, and the whole
candidate) and compares adjacent scales by ARI (§2.4). With both gap ARIs
`≥ 0.85` and no fuse/split events it emits `STABLE_3BAND` or `STABLE_6BAND`;
a clean 3→6 refinement (exactly three fuse events, no splits) gives
`NESTED_3IN6`; conflicting fuses+splits give `OVERLAP_BREAKS_3`; otherwise
`UNSTABLE`.

**σ-profile** (`shared/sigma_profile.js`) takes per-sample SD of PC1 across the
candidate span, `σ_s = sd_w(PC1_s(w))`, and from the quantiles `q50, q90` and the
high-σ tail fraction `ratio_high = #{σ > 2·q50}/n` classifies the region:
`TWO_INVERSIONS` (q50 < 0.05 and ratio_high < 0.05), `CROSSOVER_ARTIFACTS`
(bimodal by Sarle's coefficient `BC = (skew²+1)/kurtosis > 5/9` with
0.02 < ratio_high < 0.25), `NOISY_REGION` (q90 > 0.10), else `UNDETERMINED`.

---

## 2. Contingency currency: the atomic L3 primitives

Every cross-window / cross-seed comparison reduces to comparing two
**label vectors** over the same samples. These primitives
(`shared/contingency.js`, `shared/hungarian.js`) are reused throughout.

### 2.1 Contingency table and χ²

For label vectors `A` (`K_a` classes) and `B` (`K_b` classes) over `n` samples,
`M_{ab} = #{i : A_i = a, B_i = b}` (`contingency.js:30`). With row/column
marginals `r_a, c_b` and expected `E_{ab} = r_a c_b / n`,

```
χ² = Σ_{a,b} (M_{ab} − E_{ab})² / E_{ab}.
```

### 2.2 Cramér's V

The association strength between two partitions:

```
V = sqrt( χ² / ( n · (min(r,c) − 1) ) )  ∈ [0,1]
```

where `r, c` are the numbers of non-empty rows/columns
(`contingency.js:201`). `V = 1` is a perfect 1-to-1 correspondence of clusters;
`V = 0` is independence. No small-sample bias correction is applied. V is the
single most reused statistic in the pipeline — it measures whether two windows
band the cohort the same way.

### 2.3 Label alignment (Hungarian / permutation)

Cluster ids are arbitrary, so before reading the diagonal of a contingency
table the two label sets are aligned. For small `K` all `K!` permutations of
`B`'s labels are enumerated and the one maximising the diagonal sum
`Σ_r M_{r,π(r)}` is chosen (`shared/hungarian.js:46`). The aligned
**concordance** is `concord = (Σ_r M_{rr}) / n`; a chain break is declared when
`concord < 0.50`.

### 2.4 Partition-agreement indices

Adjusted Rand Index (`contingency.js:117`), with `C(k)=k(k−1)/2`:

```
ARI = ( Σ C(M_{ab}) − [Σ C(r_a)·Σ C(c_b)] / C(n) )
      ───────────────────────────────────────────────
      ( ½[Σ C(r_a)+Σ C(c_b)] − [Σ C(r_a)·Σ C(c_b)] / C(n) )
```

Normalised Mutual Information (Strehl–Ghosh, `contingency.js:153`):

```
NMI = 2 I(A;B) / (H(A) + H(B)),
I = Σ_{ab} (M_{ab}/n) ln( (M_{ab}/n) / ((r_a/n)(c_b/n)) ),
H(A) = −Σ_a (r_a/n) ln(r_a/n).
```

### 2.5 Jaccard index

Sample-set overlap, used for walking a band across windows
(`shared/band_tracking/single_band.js:64`):

```
J(A,B) = |A ∩ B| / |A ∪ B|  ∈ [0,1].
```

### 2.6 Off-diagonal entropy H_off

Given a Hungarian-aligned table, `H_off` measures whether the "travellers"
(off-diagonal mass) move **coherently** into one cell or **scatter** uniformly
(`band_tracking/anchor_signals.js:61`). For each row `r`, with off-diagonal
cells `v` summing to `row_off` and `n_off` admissible off-cells,

```
H_row(r) = [ −Σ_v (v/row_off) ln(v/row_off) ] / ln(n_off),
H_off    = Σ_r H_row(r)·row_off  /  Σ_r row_off  ∈ [0,1].
```

`H_off → 0`: all crossover mass lands in a single band (a coherent
recombinant/crossover); `H_off → 1`: travellers spread evenly (random
scattering, i.e. a regime end); `H_off = NaN`: perfect alignment, no travellers.
`(V, H_off)` together drive the window classifier (§3.2).

---

## 3. Seed discovery and candidate-interval construction (Cluster 1)

Three interchangeable entry paths produce the same object — a **seed** with `K`
per-band sample sets and a window extent `[s_window, e_window]`.

### 3.1 Band quality

A per-window quality gate combines three normalised terms
(`band_tracking/band_quality.js`):

```
band_quality(w) = min( silhouette_norm , size_balance , eig_ratio_norm )  ∈ [0,1]

silhouette_norm = clamp(silhouette, 0, 1)                      (§1.4)
size_balance    = H(cluster sizes) / ln(K_eff)
                = [ −Σ_c (n_c/n) ln(n_c/n) ] / ln(K_eff)
eig_ratio_norm  = 1 − exp( −((λ₁/λ₂) − 1) / 1.5 )
```

`size_balance` is 1 for perfectly even clusters and small for a dominant
cluster; `eig_ratio_norm` saturates (`λ₁/λ₂ = 2 → 0.63`, `= 4 → 0.95`). The
anchor-selection gate is `band_quality ≥ 0.50` (`seed_discovery.js`); chain
extension requires `band_quality ≥ 0.40`.

### 3.2 Per-window classification and the V/H_off walker

Each window is labelled relative to the tracked anchor banding
(`band_tracking/window_classification.js:37`), defaults
`v_high = 0.70, v_moderate = 0.40, h_low = 0.40, h_high = 0.70,
bq_min = 0.40`:

```
band_quality < 0.40           → UNRELIABLE
¬finite(V)                    → UNRELIABLE
V ≥ 0.70                      → INTERIOR      (stable plateau)
V < 0.40                      → REGIME_END
0.40 ≤ V < 0.70:
    ¬finite(H_off) or H_off≤0.40 → CROSSOVER   (coherent travellers)
    otherwise                    → REGIME_END  (scatter → end)
```

The seed walker extends outward from a high-quality anchor, including
`INTERIOR`/`CROSSOVER` windows and incrementing a counter on `REGIME_END`; it
**stops after ≥ 2 consecutive `REGIME_END`** windows (hysteresis), and `holds`
on `UNRELIABLE` without advancing the counter. This yields the seed extent
`[s_window, e_window]`.

### 3.3 Het-skeleton path (alternative)

A skeleton-first construction without the quality gate
(`band_tracking/het.js`, `hom.js`): in each window the candidate **HET** band is
the intermediate-PC1 cluster (`het_detect_candidate_band`); a HET seed is
Jaccard-walked forward and backward, joining the next window's band when
`J ≥ 0.5` (`het_track_skeleton`), and converted to bp coordinates
(`het_define_interval`). The two homokaryotype anchors `HOM_A` (low PC1),
`HOM_B` (high PC1) are taken from each skeleton and assigned by
fraction-above-threshold voting (`hom_anchor_to_het`).

### 3.4 Merging adjacent seeds

Adjacent intervals are fused by a Cramér's-V test
(`shared/cramers_v_merge.js`, defaults `mergeThr = 0.85, α = 0.05,
minSamples = 4`). Build the Hungarian-aligned `K×K` table, compute `V`, `χ²`
with `df = (K−1)²`, and the survival `p = P(χ²_{df} ≥ obs)`:

```
V ≥ 0.85 and p ≤ 0.05   → MERGE
< 4 shared samples       → INSUFFICIENT
otherwise                → SEPARATE.
```

Consecutive `MERGE` verdicts are chained into one seed.

### 3.5 Per-band sample sets across the seed

Over the seed's windows the per-band sample set is consolidated either by
intersection (`locusBandSampleSets`) or by majority vote
(`locusBandSampleSetsMajority`), giving the final `K` sample sets per seed
(`band_tracking/locus_construction.js`).

---

## 4. Long-range segregation voting (Cluster 2)

The long-range signal is built by letting **every band-subset of every seed
(a "focal") vote on every target window** genome-wide, then taking a consensus.
For a seed with `K` bands the voter universe is its `2^K − 1` non-empty band
subsets.

### 4.1 Projection of a focal onto a target

`classifyProjection(focal_samples, target_labels, K_target)`
(`band_tracking/projection.js`) computes, for each target band `t`, the
**purity**

```
purity[t] = |focal ∩ target_band_t| / |focal|.
```

A target band is **VISITED** if `purity[t] ≥ subset_purity = 0.80`, or, failing
that, by accumulating bands in descending purity until the cumulative purity
`≥ split_total_purity = 0.80` with each contributor `≥ split_min_purity = 0.20`.
A band with `purity[t] ≤ ambiguous_threshold = 0.10` is **EXCLUDED**. The
configuration of visited/excluded bands yields a **pattern class**:

| pattern class | meaning |
|---|---|
| `SINGLE` | one visited band, `max purity ≥ 0.80` (focal stays together) |
| `SUBSET` | focal is a clean subset of one target band |
| `COHERENT_SPLIT` | ≥2 visited bands, daughters stable (Jaccard ≥ 0.70 across windows) |
| `SUBSET_SPLIT` / `SPLIT_TWO` | structured 2-way split |
| `RANDOM_FAN` / `SCATTER` | dispersed, uninformative |
| `EMPTY` | no overlap |

### 4.2 Vote weights and the co-association matrix

Each projection casts a weighted vote (`band_tracking/vote_evidence.js:36`):

```
SINGLE = SUBSET = 1.0 ;  SUBSET_SPLIT = COHERENT_SPLIT = 0.7 ;
SPLIT_TWO = 0.5 ;  RANDOM_FAN = SCATTER = EMPTY = 0.0 .
```

These accumulate a `K×K` **co-association** matrix on the target's bands: for a
band pair `(i,j)`, `together` += weight when both are visited (or both excluded
in different groups), `apart` += weight when one is visited and one excluded, and

```
coassoc[i,j] = together[i,j] / total[i,j]  ∈ [0,1].
```

### 4.3 Partition enumeration and scoring

The target's `K` bands are grouped by enumerating **all Bell(K) set partitions**
(via restricted-growth strings; Bell(3)=5, Bell(6)=203, capped at `K = 10`,
hard-fail at 13). Each partition `P` is scored against the co-association matrix
(`band_tracking/partition_enumerate.js`):

```
score(P) = Σ_{i<j} w_{ij}·[ same_block_P(i,j) ? coassoc_{ij} : 1−coassoc_{ij} ]
           ─────────────────────────────────────────────────────────────────
                               Σ_{i<j} w_{ij}
```

i.e. the pair-weight-normalised fraction of votes consistent with `P`.

### 4.4 Consensus class

The top partitions within `δ = 0.10` of the best score are examined and a
consensus verdict assigned (`band_tracking/partition_consensus.js`, defaults
`strong = 0.50, soft = 0.65, clean = 0.85`):

```
best < 0.50                                  → NO_CLEAN_CONSENSUS
several incompatible high-score partitions   → MULTI_LAYER_STRUCTURE
some band(s) with hidden-regime residual ≥.5 → AMBIGUOUS_BAND
best ∈ [0.65,0.85) with fragmentation        → OVERLAPPING_VOTES
best ≥ 0.85, single top pick                  → CLEAN_PARTITION
best ∈ [0.65,0.85), single dominant pick      → SOFT_PARTITION
```

This per-target consensus, aggregated over all voters by the breadth-voting
wrapper (`band_tracking/breadth_voting.js`), is the **long-range segregation
pattern**: which sample sets travel together genome-wide.

### 4.5 PC1 sign anchoring and trajectory grouping

To compare PC1 across windows, the sign is anchored to a reference pool: the
band with the largest `|mean PC1|` contributes up to 10 reference samples, and

```
sign(w) = sign( mean_{s∈ref} PC1_s(w) )  ∈ {−1,+1}
```

(`band_tracking/trajectory.js`). Per-band PC1 means form a time series across
windows; two bands are grouped when their Pearson trajectory correlation
`|r| ≥ 0.70`.

---

## 5. Dosage overlay and per-sample karyotype calling (Cluster 3a–3b)

### 5.1 Polarised dosage tiers

For each consensus macro-band the mean polarised dosage `μ` over its
samples × markers is classified (`band_tracking/dosage_overlay.js`, defaults):

```
μ ≤ 0.30           → HOM_REF
0.70 ≤ μ ≤ 1.30    → HET
μ ≥ 1.70           → HOM_INV
otherwise          → AMBIGUOUS_DOSAGE   ( n < 5 → AMBIGUOUS )
```

### 5.2 Counting independent arrangement axes

HET-class macro-bands are clustered by single-linkage on Jaccard of their
sample sets: merge when `J ≥ 0.70`, require inter-cluster `J ≤ 0.30`; the number
of resulting clusters is the number of **independent arrangement axes**
(HET-disjointness), distinguishing one inversion from several overlapping ones.

### 5.3 Karyotype call by concordance

Per axis, per sample, two state estimates are compared
(`band_tracking/karyotype_caller.js`): `state_pc1` (from macro-band membership)
and `state_dosage` (from §5.1 applied to the sample's own dosage):

```
both non-NA and equal      → AGREE     → call = state, confidence = HIGH
both non-NA and different   → DISAGREE  → call = FLAGGED  (sent to Mendelian gates)
either NA                   → AMBIGUOUS → call = NA, confidence = LOW
```

### 5.4 Candidate-level model verdict

Three evidence streams — trajectory grouping (§4.5), projection pattern class
(§4.1), and vote consensus class (§4.4) — are folded into per-band agreement and
a model verdict (`band_tracking/karyotype_model.js`, defaults `min_bands = 3,
min_agreement_frac = 0.66, max_sign_split_frac = 0.20`):

```
n_bands < 3                                  → AMBIGUOUS
disagree fraction > 1 − 0.66 = 0.34          → COMPLEX
> 2 macro-groups                             → MULTI_ALLELIC
≤ 2 macro-groups and ≥ 2 non-empty IV tiers  → BIALLELIC
otherwise                                    → AMBIGUOUS
```

---

## 6. Regime construction and consistency statistics (Cluster 3c–3g)

A **regime** is a long-range haplotype-segregation unit. Its per-sample calls and
summary statistics are computed in `shared/mgl_regime_consistency.js`
(defaults at `:37`): `het_dosage ∈ [0.6, 1.4]`, `hom_a ≤ 0.4`, `hom_b ≥ 1.6`,
`cramers_v_step = 1`.

### 6.1 Per-sample regime call

Each sample's mean dosage within the regime is tiered
(`mgl_regime_consistency.js:494`):

```
d ≤ 0.4              → homA_like
0.6 ≤ d ≤ 1.4        → het_like
d ≥ 1.6              → homB_like
between tiers, OR
  support fraction < uncertain_support_max (0.5)   → uncertain
```

The support fraction of a call is the fraction of windows in which the sample's
banded membership matches the reference (seed) banding after Hungarian
alignment; low-support calls are demoted to `uncertain`.

### 6.2 Cross-window stability — mean Cramér's V

The internal stability of the `K`-band partition is the mean Cramér's V over
adjacent window pairs (step 1), each pair Hungarian-aligned first
(`mgl_regime_consistency.js:352`):

```
V̄ = mean_{w} cramersV( align( labels(w), labels(w+1) ), K, K ),
agreement(w) = (#samples in same aligned cluster) / n.
```

### 6.3 Long-range support fraction

A window "supports" the regime iff a majority of carriers match the reference
banding; the support fraction is (`mgl_regime_consistency.js:289`):

```
support_fraction = #{ w : match(w)/total(w) ≥ 0.5 } / n_windows.
```

Per-window support for the QC table additionally requires
`agreement ≥ 0.6` and `V ≥ 0.4` (`:415`).

### 6.4 Regime classification

A controlled vocabulary is assigned by a first-match decision table
(`mgl_regime_consistency.js:625`), with `V = V̄`, `sup = support_fraction`,
`K = n_bands`, `activeK = active_band_count`:

```
¬finite(V) or n_windows<4 or n_pairs<2 or n_samples<8 → low_confidence_regime
possible_ancestry_confounding                          → ancestry_confounded_regime
V < 0.25                                               → diffuse_regime
V ≥ 0.5 and sup < 0.5                                  → split_regime
V ≥ 0.5 and sup ≥ 0.5:
    activeK ≥ 3 and K ≥ 4                              → nested_multiband_regime
    K = 3 and het-band present and activeK = 3         → stable_three_band_regime
    otherwise                                          → stable_two_band_regime
otherwise                                              → low_confidence_regime
```

The vocabulary is deliberately descriptive — it never asserts Mendelian
inheritance, which is tested separately (§9).

### 6.5 Composite confidence

A single `[0,1]` confidence folds stability, support, span and sample size
(`mgl_regime_consistency.js:656`):

```
V   = clip(V̄, 0, 1)
sup = clip(support_fraction, 0, 1)
w_T = min(1, ln(1+n_windows) / ln(51))     (span term, saturates at 50 windows)
s_T = min(1, sqrt(n_samples) / 10)         (size term, saturates at 100 samples)
core       = 0.45·V + 0.45·sup + 0.10
confidence = clip( core · (0.5 + 0.5·w_T) · (0.5 + 0.5·s_T), 0, 1 ).
```

`V` and support dominate; span and sample size act as multiplicative discounts
for short or small regimes.

### 6.6 Support score (transparency decomposition)

A separate auditable score weights four interpretable components
(`mgl_regime_consistency.js:834`):

```
support_score = 0.4·agreement + 0.3·persistence + 0.2·band_balance + 0.1·qc
persistence  = min(1, long_range_support_windows / 20)
band_balance = 1 − Gini(per-band counts)
qc           = 1 if no QC notes else 0.5.
```

### 6.7 Band → haplotype labelling

Bands are named by ordering their median PC1
(`shared/band_haplotype_assign.js`): homokaryotype-like bands sorted ascending
become `H1/H1, H2/H2, H3/H3, …`; a het-like band is labelled `H_a/H_b` from its
two nearest homokaryotype medians (`|median_het − median_hom|`).

### 6.8 Band divergence (mode test)

Whether a band is hom-like, het-like, or mixed is decided from its per-sample
heterozygosity distribution (`shared/band_divergence.js`): tiers
`het < 0.40` (hom-like), `≥ 0.50` (het-like), else ambiguous; a `K=2` 1-D
K-means with a gap test `|c₀−c₁| ≥ 2·σ_pooled` and `≥ 0.15` absolute, each mode
`≥ 3` samples, flags a band as `mixed` (n_modes = 2).

### 6.9 Arrangement-identity between intervals

Given two intervals already implicated in the same long-range pattern,
`relateIntervals` (`band_tracking/haplotype_regime.js:142`) decides their
physical relationship from Jaccard overlaps of their `HOM_A/HOM_B/HET` sample
sets (defaults: extension 0.70, nested-subset 0.85, shared-het 0.60,
swapped-cross 0.70, max gap 500 kb):

```
cross-Jaccard(A.homA↔B.homB, A.homB↔B.homA) ≥ 0.70 (and > straight)  → SWAPPED  (PC1 sign flip)
mean(J_homA, J_homB, J_het) ≥ 0.70                                    → EXTENSION (same arrangement)
|small ∩ large| / |small| ≥ 0.85                                      → NESTED
J_het ≥ 0.60                                                          → SHARED_HET
otherwise                                                            → UNRELATED
```

Regimes are then formed by union-find over `EXTENSION` (sign +1) and `SWAPPED`
(sign −1) edges with affinity `≥ 0.60`, propagating sign flips
(`clusterHaplotypeRegimes`, `:326`).

### 6.10 Cross-regime topology

Pairwise regime relationships (`band_tracking/regime_topology.js:95`, defaults:
adjacent gap ≤ 2 Mb, related-Jaccard ≥ 0.30, nested-containment ≥ 0.80,
chained ≥ 3 shared HOM samples and HOM-Jaccard ≥ 0.50):

```
containment ≥ 0.80 and max J ≥ 0.30                  → NESTED
bp overlap and max J < 0.30                          → OVERLAPPING_CONFLICT
gap ≤ 2Mb, ≥3 shared HOM, max(J_homA,J_homB) ≥ 0.50  → CHAINED
gap ≤ 2Mb, max J < 0.30                              → ADJACENT
otherwise                                            → INDEPENDENT
```

`CHAINED` edges are walked (BFS) into multi-inversion lineage chains.

### 6.11 Positional and structural annotation

Each regime is annotated with chromosome position
(`shared/regime_annotation/positional.js`): `CENTROMERIC` (overlaps centromere),
`PERICENTROMERIC` (≤ 5 Mb from centromere), `SUBTELOMERIC` (≤ 2 Mb from
telomere), `ARM_SCALE` (length ≥ 0.30 × arm), else `INTERSTITIAL`; and a
structural label (`structure.js`) from the number of macro-bands `M`, boundary
sharpness, and internal nesting: `SIMPLE_HAPLOTYPE_SPLIT` (M=2),
`INVERSION_DOSAGE_LIKE` (M=3), `NESTED_OR_COMPOUND` (M∈[4,6]),
`NOISE_OR_RECOMBINANT` (consensus `RANDOM_FAN`), etc. Boundary sharpness ≥ 0.70
is `sharp`, ≤ 0.30 `diffuse`.

---

## 7. Quality-control / confounding flags

Each regime carries QC booleans propagated into the classification (§6.4):

- `possible_ancestry_confounding` — set when the banding co-varies with global
  ancestry (the imported `population.ngsadmix_q` / per-window ancestry-Δ track),
  i.e. the "inversion" may be a population-structure artifact.
- `possible_family_confounding` — set when carriers cluster within pedigree
  families rather than segregating independently (cohort relatedness).
- `missingness` — per-regime fraction of missing dosage.

A regime flagged for ancestry confounding is reclassified
`ancestry_confounded_regime` regardless of its V/support (§6.4), and its `qc`
term in the support score (§6.6) drops to 0.5.

---

## 8. Population-genetic statistics per regime group (classification stage)

Once a regime supplies sample groups (the K-means **bands**, faithful for any
`K`, or their collapse to homA/het/homB karyotype tiers), per-group statistics
are computed.

### 8.1 Grouping contract

Each registered candidate exports two groupings: `band_groups`
(`{band_0:[…], …}`, one group per K-means band) and `regime_groups`
(`{H1/H1, H1/H2, H2/H2, uncertain}`, the biallelic dosage collapse). The
band-level grouping is faithful for `K > 3` (multi-haplotype systems); the tier
collapse is the conventional biallelic-inversion view.

### 8.2 Diversity / divergence (external engine)

`θ_π`, `F_ST` and `d_XY` per group are computed by atlas-core's
`region_popstats` engine, reached as
`POST /api/popstats/groupwise` with body
`{chrom, region, groups, metrics, win_bp = 50 000, step_bp = 10 000}`
(`atlases/inversion/registries/runners/popstats.py:33`). The runner persists the
JSON response; the estimators themselves live in the engine, not in this
repository. The standard estimators the contract implies are:

```
π   = (1/L) Σ_sites [ n/(n−1) · 2 p (1−p) ]            (within-group nucleotide diversity)
d_XY = (1/L) Σ_sites [ p_X (1−p_Y) + p_Y (1−p_X) ]     (between-group divergence)
F_ST = (d_XY − π̄_within) / d_XY                        (Hudson-style)
```

with per-site alt-allele frequencies `p` and group sizes `n`. **Confirm the
exact estimator (Hudson vs. Weir–Cockerham) against the engine source.**

### 8.3 Heterozygosity and HWE

Observed and expected heterozygosity and the inbreeding coefficient

```
H_obs = #HET / n ,   H_exp = 2 p (1−p) ,   F_IS = (H_exp − H_obs)/H_exp
```

are reported per group; the manuscript profile tests `mean F_IS ≠ 0` (departure
from Hardy–Weinberg) region-vs-genome by a t-test and a Wilcoxon rank-sum
(`pages/catalogue/stats_profile.js:360`). A formal per-genotype HWE χ² is not
wired, though the χ² machinery (`contingency.js:433`) is available.

### 8.4 Focal-vs-background permutation test

The manuscript bundle reports a **Cochran–Armitage trend test** of per-sample
dosage support for the inverted arrangement, with the empirical p-value
`p = rank(observed)/n_perm` from label permutations, Bonferroni-corrected across
candidates (`shared/manuscript_bundle.js:89`). The statistic/null are evaluated
upstream; the JS layer formats the result.

### 8.5 Wilcoxon rank-sum / Mann–Whitney (in-repo)

Fully implemented in `shared/wilcoxon.js:53`. With pooled mid-ranks,
`U_a = R_a − n_a(n_a+1)/2`, null mean `μ = n_a n_b / 2`, tie-corrected variance

```
σ² = (n_a n_b / 12) · [ (N+1) − Σ_t (t³−t)/(N(N−1)) ],
z  = (|U_a − μ| − 0.5) / σ          (continuity-corrected),
p  = 2(1 − Φ(z)),
```

with `Φ` the normal CDF (Abramowitz–Stegun 7.1.26). This drives the
functional-burden group comparisons.

### 8.6 Functional burden per candidate

Per candidate, six interval-aggregated metrics — `π`, `π_N/π_S`, `π₀/π₄`, VESM
burden, LOF burden, ROH overlap — are compared across karyotype groups
(STD/STD, HET, INV/INV) by Kruskal–Wallis (p < 0.05) plus pairwise Wilcoxon
(`shared/functional_burden.js`), giving verdicts `neutral / inv_elevated /
inv_depleted / heterosis_like / mixed / underpowered`; ≥ 3 elevated load metrics
tag the candidate `load_rich`.

### 8.7 Neighbour-joining tree (in-repo)

Sample relationships on inversion-core dosage are summarised by an NJ tree
(`shared/mgl_nj_tree.js`). Pairwise distance is Euclidean
`d_{ij} = sqrt(Σ_m (d_{mi} − d_{mj})²)` or mean absolute difference
`(1/M) Σ_m |d_{mi} − d_{mj}|`; the Saitou–Nei Q-matrix is

```
Q_{ij} = (n−2) d_{ij} − Σ_k d_{ik} − Σ_k d_{jk},
```

joining the minimal-`Q` pair with branch lengths
`L_{iu} = ½ d_{ij} + (Σ_k d_{ik} − Σ_k d_{jk})/(2(n−2))`, `L_{ju} = d_{ij} − L_{iu}`,
and `d_{uk} = ½(d_{ik} + d_{jk} − d_{ij})` until two nodes remain. Cluster vs.
tree agreement is reported as ARI.

### 8.8 XP-EHH (consumed)

Per-window cross-population extended-haplotype-homozygosity
`XP-EHH = ln(EHH_test/EHH_ref)` is read from a precomputed layer (computed by
selscan); outliers are `|z(XP-EHH)| ≥ 2.0` or the top 1 %
(`shared/xpehh_per_window.js:51`).

---

## 9. Relatedness and Mendelian transmission per regime (relatedness atlas)

These consume the regime catalogue + cohort kinship; they are run on a separate
page but are part of the scientific chain.

### 9.1 Trio Mendelian support

`band_tracking/regime_mendelian.js` runs two methods. **Method A** counts
per-trio Mendelian contradictions of the karyotype calls (an offspring
karyotype impossible from the parents' karyotypes). **Method B** is a per-family
χ² goodness-of-fit of observed offspring karyotype counts to the Mendelian
expectation given parental karyotypes (e.g. HET × HET → 1:2:1; HET × HOM →
1:1). The per-regime verdict is `SUPPORTED / INCONCLUSIVE / CONTRADICTED`.

### 9.2 Dyad transmission and meiotic drive

`band_tracking/regime_dyad_mendelian.js` pools single-parent (dyad)
transmissions and tests the transmitted-allele count against the binomial null
`Binom(n, ½)`; deviation classes are `MENDELIAN / MILD_DRIVE / STRONG_DRIVE /
INVIABILITY / INSUFFICIENT_DATA`.

### 9.3 Cohort linkage and recombination

`band_tracking/regime_linkage.js` builds the `3×3` karyotype contingency between
two regimes across the cohort and reports Cramér's V; a family-level testcross
estimates the recombination fraction `r̂ = #recombinant / #total` from
doubly-heterozygous parents, with verdict `LINKED / WEAKLY_LINKED /
INDEPENDENT / INSUFFICIENT_DATA`.

### 9.4 Inverse pedigree from regime co-membership

`band_tracking/regime_pedigree.js` classifies a sample pair's relatedness from
the fraction of regimes in which they share a karyotype class →
`DUPLICATE / FIRST_DEGREE / SECOND_DEGREE / UNRELATED / INSUFFICIENT_DATA`,
cross-checked against ngsRelate/KING kinship `φ` (parent–offspring `φ ≈ 0.25`).

---

## 10. Catalogue serialisation and reproducibility

The regime catalogue is serialised to a `manifest.json + knobs.json +
catalogue.json` triple, **content-addressed by a knob hash** (SHA-1 prefix of
the parameter set) so a given parameterisation reproduces a stable artifact
(`band_tracking/regime_catalogue.js`). Each catalogue record carries the regime
summary, per-sample calls, per-window support, QC, and both groupings (§8.1).

---

## 11. Results — worked example on LG28 (226 *C. gariepinus*)

### 11.1 Genome-wide scan

The LG28 precompute holds **4302 windows** with per-window local-PCA summaries
for all 226 samples. The leading-eigenvalue track `Z(w) = λ₁(w)` ranges
`7.94 – 50.28` (mean ≈ 22.7) across the chromosome. Because `λ₁` is an
eigenvalue magnitude, every window exceeds the nominal display floor
(`z_max_min = 2.5`); detection therefore keys on **relative peaks** in `λ₁` and
on the eigenvalue ratio `λ₁/λ₂`, not on an absolute cutoff. The strongest peak
is a contiguous run at windows 238–244 (≈ 2.00–2.11 Mb) where `λ₁` reaches
**50.28** (window 243, 2 051 341–2 100 716 bp) with `λ₁/λ₂ = 4.52` — a single
dominant axis of structure against a background ratio of ≈ 2.85 (window 0). A
secondary peak sits near 19.88 Mb (window 4280, `λ₁ = 47.06`, ratio 5.88).
These relative maxima are the candidate regions carried into banding.

### 11.2 A clean three-band inversion karyotype

The L2 candidate `C_gar_LG28_d17L2_0010` resolves at `K = 3`. The consensus call
over its core envelopes (`02+03+04`,
`arrangement_calls/lg28_2026-05-06_run/CLEAN_envs_02-03-04_consensus.json`) gives
per-envelope band sizes:

| envelope | band 0 | band 1 (centre) | band 2 | total |
|---|---|---|---|---|
| 02 | 61 | 103 | 62 | 226 |
| 03 | 62 | 104 | 60 | 226 |
| 04 | 71 | 95 | 60 | 226 |

The central (heterokaryotype) band consistently contains ≈ 2× each flanking
homokaryotype: **61 : 103 : 62 ≈ 1 : 2 : 1**, the Hardy–Weinberg expectation for
a balanced biallelic inversion polymorphism at intermediate frequency
(here alt-arrangement frequency `q ≈ (½·103 + 62)/226 ≈ 0.50`). The band PC1
centres are well separated and ordered (`−0.089, +0.005, +0.079`), and every
cross-window voter projection is `pattern_class = SUBSET` with
`voter_consensus = 0.867` — i.e. the three windows agree on the same three-band
partition, yielding a `CLEAN_PARTITION` consensus and a
`stable_three_band_regime` classification (§6.4).

### 11.2a The locus across its full window span

The same `K = 3` call was made on a sliding triple of envelopes spanning
`d17L2_0010` envelopes 01–08 (`arrangement_calls/lg28_2026-05-06_run/`, ten
consensus files). Per-envelope band sizes (each summing to 226):

| consensus (envelopes) | band sizes per envelope |
|---|---|
| 01-02-03 | 61:103:62 · 62:102:62 · 62:104:60 |
| 02-03-04 | 61:103:62 · 62:104:60 · 71:95:60 |
| 03-04-05 | 62:104:60 · 71:95:60 · **91:67:68** |
| 04-05-06 | 71:95:60 · **91:67:68** · 76:96:54 |
| 05-06-07 | 71:95:60 · 76:96:54 · 88:78:60 |
| 06-07-08 | 83:84:59 · 76:96:54 · 88:78:60 |

The core envelopes (01–04) hold a clean ≈ 1:2:1 split; the middle band erodes
from envelope 05 onward (the heterokaryotype band shrinks, `91:67:68`), tracing
the regime decaying along the chromosome rather than ending abruptly.

### 11.3 A boundary anomaly

Walking the same locus one envelope further (`03+04+05`, the
`acrossanomaly` consensus) the third envelope's banding shifts to
`91 : 67 : 68`, breaking the 1:2:1 ratio — the empirical signature of a regime
boundary / recombination at envelope 05, exactly what the `REGIME_END`
classifier (§3.2) and the σ-profile `CROSSOVER_ARTIFACTS` verdict (§1.5) are
designed to flag. A two-envelope call (`01+02`) returns to clean 1:2:1
(`62:102:62`, `61:103:62`) but is `LABEL_AMBIGUOUS`, illustrating the
`low_confidence_regime` gate (too few windows/pairs) of §6.4.

### 11.4 Cohort diversity context

An independent diversity layer (`cohort_diversity_v1.json`, MODULE_3,
226-sample pure *C. gariepinus* hatchery) provides per-sample genome-wide
baselines that frame the inversion calls. For a representative individual
(`CGA009`): heterozygosity `H = 0.0047`, `F_ROH = 0.254` over 3 190 ROH
segments, and in-ROH vs out-of-ROH diversity `θ_in = 0.00120` vs
`θ_out = 0.00501` (ratio `θ_in/θ_out = 0.239`). The ≈ 4-fold diversity
reduction inside runs of homozygosity is the cohort-wide backdrop against which
a balanced, diversity-retaining inversion polymorphism (§11.2) stands out.

### 11.5 Repeat-density track

A per-window repeat-density layer aligned to the same 4302-window scubber grid
(`LG28.repeat_density.scrubber_windows.json`) is available for breakpoint-repeat
context at the candidate edges. It is a real precomputed track on this
chromosome; per-candidate breakpoint-enrichment statistics on top of it were not
computed in this run.

### 11.6 What was not produced

Consistent with §9, the static snapshot analysed here contains **no** per-group
`θ_π`/`F_ST`/`d_XY`, no permutation-test p-values, no XP-EHH, and no
regime-level Mendelian/linkage results for this cohort: those stages were not
executed. The SV-evidence and cross-species breakpoint layers exist only as
empty scaffolds. The verified results are the genome-wide `λ₁` scan (§11.1), the
`K = 3` arrangement calls with their ≈ 1:2:1 banding and voter consensus
(§11.2–11.3), and the cohort-diversity baseline (§11.4).

---

## Appendix A — Default parameters

| Stage | Parameter | Default | Source |
|---|---|---|---|
| Window K-means | K (fixed) | 3 | `kmeans.js` / page state |
| adaptiveK1D | k range / silhouette / min group | 2–5 / 0.45 / 5 | `kmeans.js:182` |
| Similarity | min shared markers | 20 | `similarity_matrix.js:34` |
| Detection | `z_column` / `z_clip` / call floor | `lam_1` / 5 / 2.5 | `LG28.json` |
| Scale stability | stable ARI | 0.85 | `scale_stability.js` |
| Band quality | anchor gate / extend gate | 0.50 / 0.40 | `band_quality.js`, `seed_discovery.js` |
| Window class | v_high / v_mod / h_low / h_high | 0.70 / 0.40 / 0.40 / 0.70 | `window_classification.js:37` |
| Walker | consecutive REGIME_END to stop | 2 | `seed_discovery.js` |
| Skeleton walk | min Jaccard | 0.50 | `single_band.js` |
| Seed merge | V / α / min samples | 0.85 / 0.05 / 4 | `cramers_v_merge.js` |
| Projection | subset / exclude / split-min / split-total | 0.80 / 0.10 / 0.20 / 0.80 | `projection.js` |
| Vote weights | SINGLE/SUBSET … FAN | 1.0 … 0.0 | `vote_evidence.js:36` |
| Partition | δ-window / Bell cap | 0.10 / K≤10 | `partition_*` |
| Consensus | strong / soft / clean | 0.50 / 0.65 / 0.85 | `partition_consensus.js` |
| Trajectory | grouping \|r\| / ref n | 0.70 / 10 | `trajectory.js` |
| Dosage tiers | homA / het / homB | ≤0.4 / [0.6,1.4] / ≥1.6 | `mgl_regime_consistency.js:37` |
| Regime support | uncertain support max | 0.5 | `mgl_regime_consistency.js:501` |
| Per-window support | agreement / V min | 0.6 / 0.4 | `mgl_regime_consistency.js:415` |
| Regime class | diffuse V / split sup / nested K | 0.25 / 0.5 / ≥4 | `mgl_regime_consistency.js:625` |
| Confidence | span/size saturation | 50 windows / 100 samples | `mgl_regime_consistency.js:656` |
| Karyotype model | min bands / agreement / sign-split | 3 / 0.66 / 0.20 | `karyotype_model.js` |
| Arrangement identity | ext / nested / shared-het / swap / gap | 0.70 / 0.85 / 0.60 / 0.70 / 500 kb | `haplotype_regime.js:142` |
| Topology | adjacent gap / related J / nested / chained | 2 Mb / 0.30 / 0.80 / 3,0.50 | `regime_topology.js:95` |
| popstats | win_bp / step_bp | 50 000 / 10 000 | `popstats.py:33` |
| XP-EHH | outlier z / top pct | 2.0 / 1 % | `xpehh_per_window.js:51` |

## Appendix B — Statistic provenance and run status

Three columns: implemented **in-repo**, computed by an **external** engine, and
whether it was actually **run on this 226-sample cohort** (i.e. a result artifact
exists). The last column is what separates the verified results (§11) from the
merely-implemented method.

| Statistic | In-repo | External | Run on cohort |
|---|---|---|---|
| Local PCA, λ₁/λ₂, PC scores | — | upstream R precompute | ✓ (LG28, 4302 win) |
| Cramér's V, χ², ARI, NMI, Jaccard, H_off | ✓ | — | ✓ |
| K-means (1-D, adaptive), silhouette | ✓ | — | ✓ |
| Band quality, window classification, walker | ✓ | — | ✓ |
| Projection, voting, partition consensus | ✓ | — | ✓ (arrangement run) |
| Dosage tiers, karyotype call, regime stats, confidence | ✓ | — | ✓ |
| Arrangement identity, topology, annotation | ✓ | — | partial |
| Cohort diversity (H, F_ROH, θ_in/θ_out) | — | upstream (MODULE_3) | ✓ |
| Repeat density track | — | upstream | ✓ (track only) |
| Wilcoxon / Mann–Whitney | ✓ | — | ✗ not run |
| NJ tree (Saitou–Nei) | ✓ | — | ✗ not run |
| Functional burden | ✓ | — | ✗ no input data |
| θπ / F_ST / d_XY | — | `region_popstats` (HTTP) | ✗ not run |
| Cochran–Armitage permutation p | format only | upstream | ✗ not run |
| XP-EHH | flagging only | selscan | ✗ no data |
| Mendelian / kinship (trio, dyad, linkage, pedigree) | regime-level ✓ | base: ngsRelate/KING | ✗ not run |
| SV-genotype Fisher evidence | stub (placeholder p) | — | ✗ empty scaffold |
| Cross-species breakpoint tiers | not implemented | — | ✗ empty scaffold |

*End of methods draft.*
