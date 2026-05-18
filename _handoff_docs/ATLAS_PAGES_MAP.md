# ATLAS_PAGES_MAP — pages × JS × what each one does

**Purpose**: a single overview of every page registered in
`atlases/inversion/manifest.json`. For each page: stage, HTML/JS
entry, subdir files (the modules that do the actual work), and a
one-paragraph description of what the page is for. Use this as the
seed for per-page READMEs.

**Sources**:
- `atlases/inversion/manifest.json` — id, label, stage, paths
- `atlases/inversion/registries/data/pages.registry.json` — `_doc` per
  page (longform descriptions, where present)
- Top-of-file comments in each `pages/<stage>/<page>/*.js` module

**Tier legend**:
- ✅ shipped — full renderer present
- 🟡 stub — HTML scaffold + lifecycle wired, renderers TODO
- 🔵 thin-loader — entry stub; real renderer lives in an external `js/atlas_*.js` window-global

---

## Stages (from `manifest.json#stages`)

| order | id              | label           | rough role |
|------:|-----------------|-----------------|------------|
| 1 | `discovery`     | discovery 1     | core local-PCA detection scanners (|Z|, θπ, GHSL) |
| 2 | `discovery_2`   | discovery 2     | supplementary detection / inspection cartridges |
| 3 | `classification`| classification  | per-candidate karyotype / popstats / boundaries / SV (absorbs legacy refinement + classification + synthesis) |
| 4 | `catalogue`     | catalogue       | cohort-level catalogues, marker panels, annotation cockpit |
| 5 | `evolution`     | evolution       | polarize / age / mosaicism / archaeology |
| 6 | `comparative`   | comparative     | cross-species (Cgar × Cmac × multi-species) |
| 7 | `help`          | help            | static reference |

---

## DISCOVERY 1 (3 pages — the local-PCA scanners)

### page1 — local PCA |Z|  ✅
- **HTML**: `pages/discovery/page1.html` · **JS**: `pages/discovery/page1.js`
- **Subdir**: `pages/discovery/page1/` (28 modules — the largest page)
- **Tooltip**: Local PCA on dosage. Sim_mat heatmap, robust |Z|, per-sample lines, K-means PCA, L3 contingency. THE big page.
- **Requires**: `scrubber_main`, `repeat_density`, `band_trajectories`, `candidate_tracks`
- **Slots**: `activeChrom` (+ optional `activeCandidate`)
- **What it does**: chromosome-wide PCA-based inversion scanner with six side-by-side panels (sim_mat, |Z|, lines, PCA, L3 contingency, sidebar). The scrubber walks every window; clicks on any panel update `state.cur`, the central cursor. Per-window K-means labels feed L3 concordance tables. **60 fps target; layers must be hot-tier.**
- **Subdir module map**:
  - `_state.js` — owns `_pageState` ref + `_setActiveState` swap
  - `_data.js` — re-export shim → `shared/page1_data_helpers.js`
  - `chrom_cache.js` — in-memory cache of parsed chromosome JSONs
  - `idb.js` / `idb_restore.js` — IndexedDB persistence + session replay
  - `enrichment.js` — merge dropped enrichment JSON into `state.data`
  - `z_panel.js` — robust-|Z| waveform + 9 strip overlays
  - `sim_panel.js` — sim_mat heatmap + minimap variant
  - `lines_panel.js` — per-sample PC1/PC2 line traces + color modes
  - `pca_panel.js` — per-window scatter + anchor strip + sidebars
  - `l3_panel.js` — 3 L3 contingency modes (primary / per-K slab / scale-stability)
  - `candidates.js` — candidate-overlay primitives (lane layout, band paint)
  - `band_diagnostics.js` / `band_diagnostics_html.js` — per-band GHSL/θπ/ROH summary
  - `band_trace_state.js` / `band_trace_tooltip.js` — single-cohort fish-set trace
  - `active_samples.js` — cohort-wide exclude filter (CGA-keyed)
  - `diag_residuals.js` — per-fish residual-Z diagnostic + color mode
  - `events.js` — canvas clicks + central `setCur` orchestrator
  - `hotkeys.js` — ←/→/n/p/f/b/c hotkeys
  - `inheritance.js` / `inheritance_tooltip.js` — inheritance-group clustering wrapper
  - `lineage.js` — state-managed lineage compute (wraps `shared/clustering.js`)
  - `l2_sweep.js` — L2-sweep auto-promote pipeline (every L2 → synthetic candidate)
  - `manual_groups.js` — user-defined fish groups
  - `sidebar.js` — wires every aside control
  - `panel_resize.js` — drag bottom edges of sim / Z / lines / PCA / L3
  - `fish_inspect_popover.js` — click-near-trace fish detail card

### page12 — local PCA θπ  🟡
- **HTML/JS**: `pages/discovery/page12.{html,js}` · **Subdir**: `page12/` (`_state.js` only)
- **What it does**: same six-panel layout as page1, but driven by θπ (per-window nucleotide diversity) instead of dosage. Empty-state until the R pipeline ships any of `theta_pi_per_window` / `theta_pi_local_pca` / `theta_pi_envelopes` / `cusum_theta`. Orthogonal validation axis vs page1.

### page15 — local PCA GHSL  🟡
- **HTML/JS**: `pages/discovery/page15.{html,js}` · **Subdir**: `page15/` (`_state.js` only)
- **What it does**: third evidence axis — GHSL haplotype-pair sequence divergence. Five `[data-gh-layer]` indicator chips toggle 🟢/⚪ off `state.layersPresent`. Full six-panel renderers TODO_MISSING (sibling of page1's drawZ/drawSim/etc.).

---

## DISCOVERY 2 (10 pages — supplementary scanners / inspectors)

### page2 — candidate focus deep-dive  ✅
- **HTML/JS**: `pages/discovery/page2.{html,js}` · **Subdir**: `page2/` (5 modules)
- **What it does**: per-candidate multi-panel detail page composed of ~15 sub-panels: header, sigma profile, K=6 nesting, FIG_C07 ridgeline, FIG_C08 dosage heatmap, per-band composition, ancestry confound, regime row, age origin, notes. Reuses page1's cluster-cache for the L2 recompute.
- **Subdir**: `_state.js`, `_draw_panels.js` (7 canvas painters), `_html_builders.js` (16 HTML builders), `_list.js` (candidate-list management), `_wires.js` (event wires).

### page22 — haplotype regimes (Stage 4 bruteforce projection)  ✅
- **HTML/JS**: `pages/discovery/page22.{html,js}` · **Subdir**: `page22/` (3 modules)
- **What it does**: long-range haplotype regimes — wires the v3.4 banding pipeline (Stage 1 seed discovery → Stage 2 cross-seed voting → Stage 3 chain walk → Stage 4 bruteforce projection) into the atlas-core shell. 2×2 panel grid: chrom-scope and genome-scope versions of target-band lanes + PC1 lines. Action bar exposes "run pipeline" + "export catalogue". Calibration target: LG28 prototype 15.115–18.005 Mb, 60/106/60 karyotype.
- **Subdir**: `regimes_page.js` (4-panel layout + header), `regimes_panel.js` (lines-panel with regime y-axis), `regimes_pc1_panel.js` (PC1-lines variant).
- **Connection point to the seeds→candidates wiring HANDOFF** — this page's pipeline produces the `stage3.loci[]` that `analysis/seeds_to_candidates/` (PR #18 spec) will promote into `state.candidateList`.

### tree_panel — NJ sample tree  ✅
- **JS**: `tree_panel.js` · **Subdir**: `tree_panel/{_state, renderer, selection}.js`
- **What it does**: neighbour-joining tree built on dosage distances, cluster colouring + ARI-vs-clusters badge (HANDOFF_5).

### fingerprint_track — diversity regimes per window  ✅
- **JS**: `fingerprint_track.js` · **Subdir**: `fingerprint_track/{_state, renderer, selection, proportions}.js`
- **What it does**: per-window diversity-regime fingerprint with rank-equivalence regime IDs, switch markers, fragment-proportions treemap, architecture-scenario verdict (HANDOFF_6). Consumes `shared/mgl_fingerprinter.fingerprintCandidate`.

### similarity_matrix — per-window sample×sample heatmap  ✅
- **JS**: `similarity_matrix.js` · **Subdir**: `similarity_matrix/{_state, renderer, selection}.js`
- **What it does**: per-window similarity heatmap + block detection + adjacent-window ARI transition strip (HANDOFF_10).

### pca_scatter_per_window — per-window PC1×PC2 scatter  ✅
- **JS**: `pca_scatter_per_window.js` · **Subdir**: `pca_scatter_per_window/{_state, renderer, selection}.js`
- **What it does**: per-window PCA scatter with cluster colouring + λ-magnitude scrubber (SPEC_0 §10 Phase 1).

### dosage_heatmap — sample × marker dosage  ✅
- **JS**: `dosage_heatmap.js` · **Subdir**: `dosage_heatmap/{_state, renderer, selection, adapters}.js`
- **What it does**: sample × marker dosage heatmap with K=3 group track + polarity stripe. Two input shapes via `adapters.js`: new SPEC_0 `mgl_heatmap_json` or legacy candidate-chunk shape (SPEC_0 §11).

### nested_inversion_detector — nested-inversion detector  ✅
- **JS**: `nested_inversion_detector.js` · **Subdir**: `nested_inversion_detector/{_state, renderer, selection}.js`
- **What it does**: 3 stratum tracks (HOM1 / HET / HOM2) + contiguous inner-interval overlays (HANDOFF_7).

### dosage_cluster_adaptive_k — adaptive-K clustering  ✅
- **JS**: `dosage_cluster_adaptive_k.js` · **Subdir**: `dosage_cluster_adaptive_k/{_state, renderer, selection}.js`
- **What it does**: adaptive-K sample clustering on per-window dosage profiles, per-K scoring table, cluster mean-curve display (HANDOFF_8).

---

## CLASSIFICATION (5 pages — per-candidate review / refinement / synthesis)

### karyotype_tier — karyotype / tier  ✅
- **HTML/JS**: `pages/review/karyotype_tier.{html,js}` · **Subdir**: `karyotype_tier/` (5 modules)
- **What it does**: two-tab candidate-level review. **Karyotype tab**: per-sample regime breakdown, each row a fish with locked K=3 label (HOMO_1/HET/HOMO_2 ordered by median PC1) + active-band track pills for two-track candidates; sortable / filterable / band-filterable. **Tier tab**: 14-axis classification grid (empty-state until cluster-side ships `final_classification.json`).
- **Subdir**: `_state.js`, `karyo_body.js` (body + toolbar), `karyo_labels.js` (K=3..K=6 label vocab), `karyo_rows.js` (sort/filter pure helpers), `tier_axes.js` (14-axis schema + palette + grid).
- ⚠️ Registry mismatch flagged: `requires_layers` says `candidate_sv_counts + candidate_boundaries` — page actually consumes `final_classification` + `classification`.

### popstats — popstats  🔵
- **HTML/JS**: `pages/review/popstats.{html,js}` · **Subdir**: `popstats/` (`_state.js` only)
- **What it does**: chromosome-level popstats track stack — |Z|, SNP density, BEAGLE uncertainty, depth, θπ, F_ST, Hobs/Hexp, ancestry delta12. Thin loader stub for `window.renderPopstatsPage` (external `js/atlas_page6_wiring.js`); falls back to missing-renderer message if absent.
- ⚠️ Registry mismatch flagged: declares `candidate_gene_cargo` + `activeCandidate` — page is chromosome-level.

### ancestry_per_window — ancestry  🔵
- **HTML/JS**: `pages/review/ancestry_per_window.{html,js}` · **Subdir**: `ancestry_per_window/` (`_state.js` only)
- **What it does**: per-window ancestry view — three chip toggles (K-cluster label, Q-value heatmap, delta12). Loads `<chrom>_phase4_ancestry.json` via drag-drop; renders sample × window heatmaps. Thin loader stub for `window.renderAncestryPage`.
- ⚠️ Registry mismatch flagged: declares `candidate_marker_primers` + `activeCandidate` — page is chromosome-level.

### boundary_refinement — boundaries  ✅
- **HTML/JS**: `pages/review/boundary_refinement.{html,js}` · **Subdir**: `boundary_refinement/` (3 modules)
- **What it does**: boundary-zone refinement for a promoted candidate. Auto-propose runs `BOUNDARY_TRACK_WEIGHTS`-weighted algorithm (`_bndAutoPropose`); manual override at scrubber cursor via E (left) / F (right) hotkeys; B saves, R resets. Nine scan-radius steps (1 kb → 5 Mb). TE-density panel, ncRNA-density panel, focal-vs-background widget.
- **Vocab contract**: `boundary_zone` is the default verdict; `exact_breakpoint` reserved for junction-level evidence only.
- **Subdir**: `_state.js`, `boundaries.js` (pure helpers — binary search, smoothing, MAD), `boundaries_ui.js` (toolbar + actions).
- ⚠️ Registry mismatch flagged: declares `candidate_final_class + candidate_breeding_card` — possible swap with karyotype_tier's declared `candidate_sv_counts + candidate_boundaries`.

### sv_evidence — SV calls × karyotype  🔵
- **HTML/JS**: `pages/review/sv_evidence.{html,js}` · **Subdir**: `sv_evidence/` (`_state.js` only)
- **What it does**: read-only candidate-level view of SV calls clustered around boundaries, scored against karyotype groups. Three stacked panels: SV table, UpSet plot of caller intersections, dosage heatmap. Thin loader for `window.AtlasSVEvidence` object (`init` / `loadCandidate` / `destroy`). Loads `json/sv_genotype_counts/<cid>.json` per candidate. Registry alignment ✅.

---

## CATALOGUE (8 pages — cohort-level catalogues + annotation cockpit)

### catalogue — catalogue  ✅
- **HTML/JS**: `pages/catalogue/catalogue.{html,js}` · **Subdir**: `catalogue/` (3 modules)
- **What it does**: sortable/filterable catalogue of all L2 envelopes (or L1-merged inversions). Hover any column header for definition; export selected rows as TSV / Markdown. Bulk breeding-card export (HTML + JSON) via Turn-146 pipeline.
- **Subdir**: `_state.js`, `catalogue.js` (the rendering pipeline legacy never shipped), `_breeding_export.js` (Turn-146 export pipeline).

### confirmed_carousel — confirmed carousel  ✅
- **HTML/JS**: `pages/catalogue/confirmed_carousel.{html,js}` · **Subdir**: `confirmed_carousel/` (2 modules)
- **What it does**: prev/next carousel through `state.candidateList.filter(c => c.confirmed === true)`. Reuses page2's candidate-detail rendering for each card. The legacy `confirmedNav*` JS never existed — this is a fresh implementation.

### marker_panels — marker panels  ✅
- **HTML/JS**: `pages/catalogue/marker_panels.{html,js}` · **Subdir**: `marker_panels/` (`_state.js` only)
- **What it does**: diagnostic PCR marker panel cards for each candidate's regime call (g0/g1/g2 from `fish_regime_calls.tsv`). Reproduces the genome-based regime call with 3–10 markers per candidate. Card content: tier badge (HIGH/MEDIUM/LOW), expected accuracy, n markers, panel class, per-regime marker counts, Tm range + multiplex spread, warning tags, optional per-marker table.

### stats_profile — stats profile  ✅
- **HTML/JS**: `pages/catalogue/stats_profile.{html,js}` · **Subdir**: `stats_profile/` (`_state.js` only)
- **Stage in manifest**: `classification` (NB: stage value disagrees with directory location; both kept here under catalogue for narrative coherence with the manifest dir layout).
- **What it does**: statistical profile of inversion-associated genomic features — comparative summary of breakpoint context, genomic composition, functional cargo, population variation, breeding burden. Auto-derives rows from `cs_breakpoints + candidate list`; overlay `stats_profile` JSON/TSV for annotated rows (gene density, GO/KEGG, ROH, deleterious burden, F_ST). Synthesis figure for the manuscript.

### marker_readiness — marker readiness panel  ✅
- **HTML/JS**: `pages/catalogue/marker_readiness.{html,js}` · **Subdir**: `marker_readiness/` (`_state.js` only)
- **Stage in manifest**: `classification`.
- **What it does**: private-indel marker readiness — Tier 1 (clean dosage AF + controls + bighead specificity), Tier 2 (multi-marker or strong tag), Tier 3 (breakpoint PCR, DEMOTED), Tier 4 (exploratory). Atlas computes `private_score / dosage_score / gel_visibility` live from `variant_afs.json`. Auto-suggests positive/negative control samples. Includes 5-step pilot validation checklist with cross-species controls.

### annotation_cockpit — annotation cockpit  ✅
- **HTML/JS**: `pages/catalogue/annotation_cockpit.{html,js}` · **Subdir**: `annotation_cockpit/` (`_state.js` only)
- **What it does**: per-sample-lines canvas with cursor-driven candidate selection. Every promoted candidate is a faint rectangle in mb-space; per-sample PC1 trajectories drawn beneath. ←/→ moves cursor (Shift jumps boundaries, Esc clears); digit keys 0–9 select a band of the candidate under the cursor → linkage shading + linkage table + haplotype-annotation panel.

### page8 — per-window summary table  ✅
- **HTML/JS**: `pages/discovery/page8.{html,js}` (stage = `catalogue` in manifest) · **Subdir**: `page8/` (2 modules)
- **What it does**: sortable read-out of |Z|, λ1/λ2, eigenvalue ratio, ANGSD biallelic-SNP counts per window for the active chrom. Per-window strip canvas coloured by the active sortable column (default |Z|) with L1/L2 zone bars. ANGSD bi-SNP discovery parameter info panel for full provenance.

### page19 — negative regions catalogue  ✅
- **HTML/JS**: `pages/discovery/page19.{html,js}` (stage = `catalogue` in manifest) · **Subdir**: `page19/` (2 modules)
- **What it does**: region-level catalogue of "no detectable inversion" calls — complement of catalogue. Each region carries a `region_status` (e.g. `no_detectable_inversion_high_confidence`); static caution banner explicitly warns against binary positive/negative misreading. Drag-drop `negative_regions.json/.tsv`; summary cards per `region_status`; CSV export.

### overview — synthesis overview  🟡
- **HTML/JS**: `pages/catalogue/overview.{html,js}` · **Subdir**: `overview/` (`_state.js` only)
- **What it does**: registered but EMPTY in legacy — the synthesis-stage tab. Body is `<div id='overview'></div>`. Reserved for future high-level workflow summary, candidate counts per stage, layer-presence checklist.

---

## EVOLUTION (9 pages — per-candidate evolution + archaeology)

All evolution cartridges consume `mgl_adapter` primitives (PCA / dosage / heatmap / NJ tree) plus the evolution-specific helpers:
- `shared/mgl_founder_consensus.js`
- `shared/mgl_doubleton_sfs_clusters.js`
- `shared/mgl_haplotype_network.js`
- `shared/mgl_outgroup_synteny.js`
- `shared/mgl_inversion_divergence.js`
- `shared/mgl_mosaicism_detector.js`
- `shared/mgl_kinship_downweight.js`
- `shared/mgl_event_tree.js`
- `shared/mgl_archaeology_classifier.js`

### polarize_msa_stacked — stacked-consensus MSA  ✅
- **Subdir**: `polarize_msa_stacked/{_state, builder, renderer, selection}.js`
- **What it does**: outgroup row + INV founder-like consensus row + per-subgroup consensus rows (from 2D-SFS doubleton hierarchical clustering) + STD consensus row, fed into the existing dosage-heatmap renderer with a tier-confidence stripe on top. Confidence + reason tier per site.

### haplotype_network — INV haplotype MST  ✅
- **Subdir**: `haplotype_network/{_state, renderer, selection}.js`
- **What it does**: minimum-spanning haplotype network of INV chromosomes. Nodes are Hamming-radius clusters (sized by chromosome count, coloured by 2D-SFS subgroup); edges are pairwise mutational distance. Force-directed layout (Mulberry32 PRNG).

### polarize_synteny_vote — outgroup-synteny vote  🟡
- **Subdir**: `polarize_synteny_vote/` (`_state.js` only)
- **What it does**: per-outgroup-species breakpoint-orientation vote (HOM_A / HOM_B / unresolved), aggregated to an arrangement verdict. Renderers TODO.

### age_divergence — age + divergence  🟡
- **Subdir**: `age_divergence/` (`_state.js` only)
- **What it does**: per-candidate age estimate — dXY between arrangements, private variant density on derived class, MRCA depth, segregating-sites summary.

### mosaicism_leakage — leakage / recombinant tracts  🟡
- **Subdir**: `mosaicism_leakage/` (`_state.js` only)
- **What it does**: recombinant-tract / polarity-switch detector on INV chromosomes. Per-sample per-window mosaic-call + summary leakage score.

### inv_internal_substructure — sub-PCA on derived-only  🟡
- **Subdir**: `inv_internal_substructure/` (`_state.js` only)
- **What it does**: sub-PCA on derived-only samples — looks for haplotype clusters / nested rearrangements / sublineages inside the inversion class.

### layer_cleaning — Layer 0/1 noise removal  🟡
- **Subdir**: `layer_cleaning/` (`_state.js` only)
- **What it does**: kinship + family-size downweighting + hatchery-duplicate exclusion so close relatives don't double-count in deep-Layer-2 stats.

### event_tree_relative_ordering — relative ordering of inversions  🟡
- **Subdir**: `event_tree_relative_ordering/` (`_state.js` only)
- **What it does**: relative-ordering inference across multiple inversions on the same chromosome — carrier-overlap nesting, internal diversity ranking, outgroup presence, age class chaining.

### archaeology_synthesis_card — Step-6 verdict card  🟡
- **Subdir**: `archaeology_synthesis_card/` (`_state.js` only)
- **What it does**: per-candidate synthesis card pulling together polarity, age class, integrity, mosaicism, frequency, π/dXY/F_ST, private/fixed counts, confidence. The Step-6 verdict.

---

## COMPARATIVE (2 pages — cross-species)

### cross_species_breakpoints — cross-species breakpoints (Cgar × Cmac)  ✅
- **HTML/JS**: `pages/comparative/cross_species_breakpoints.{html,js}` · **Subdir**: `cross_species_breakpoints/` (`_state.js` only)
- **What it does**: chromosome-scale rearrangements between Cgar and Cmac from a wfmash 1-to-1 alignment (`cs_breakpoints_v1` schema). Each breakpoint renders both species' coordinates, a syntenic-block linking line, and flanking repeat-element density on both species. Six-panel layout: toolbar, catalogue table, focus card, synteny, dotplot, focal-vs-bg. Spalax-style TE enrichment at breakpoints is the manuscript hook.
- **Three-cohort discipline** (critical): F1 hybrid (assembly paper) ≠ 226-sample pure C. gariepinus (current inversion atlas) ≠ pure C. macrocephalus wild (future paper).

### multi_species_cockpit — multi-species classification cockpit  ✅
- **HTML/JS**: `pages/comparative/multi_species_cockpit.{html,js}` · **Subdir**: `multi_species_cockpit/` (`_state.js` only)
- **What it does**: place each Cgar↔Cmac breakpoint on the catfish phylogeny; click a species in the tree to see how its homologous region compares (chromosome context, orientation, boundary status). Auto-suggests architecture class (A–F) from lineage distribution. Owns 6 JSON layers: `dotplot_mashmap_v1`, `synteny_multispecies_v1`, `phylo_tree_v1`, `dxy_per_inversion_v1`, `comparative_te_breakpoint_fragility_v1`, `karyotype_lineage_v1`. Default 9-species reference tree (Tros, Smer, Tfulv, Ipun, Hwyc, Phyp, Capus, Cfus, Cmac, Cgar) when no `phylo_tree_v1` is loaded. Persists classifications to `localStorage`.

---

## HELP (1 page)

### help — help  ✅
- **HTML/JS**: `pages/comparative/help.{html,js}` · **Subdir**: `help/` (`_state.js` only)
- **What it does**: static quick-reference / help page — purely declarative HTML with help / vocabulary / hotkeys / pipeline reference content (~1158 LOC HTML). `renderPage5()` is a true no-op. `PAGE5_META` carries `{id, stage, label, num:16, static:true}` for the tab router.

---

## ON-DISK BUT UNREGISTERED

The following directory exists under `pages/` but is **not in the manifest** (so the shell will not mount it):

### `pages/review/fish_ancestry_scroller/` (4 modules)
- `_state.js`, `layers.js` (3 numbered layers + brick-metrics block), `right_panel.js` (3 blocks: context / view-mode / overlay), `selection.js` (brick hit-test).
- Backed by `SPEC_fish_ancestry_scroller.md`. Either in-progress (needs a manifest entry + a top-level `fish_ancestry_scroller.{js,html}`) or deprecated.

---

## TOTALS

- **In manifest**: 37 entries across 7 stages
- **Files**: ~70 page-level JS modules + 38 page entry files (HTML + JS pairs)
- **Tier breakdown** (rough):
  - ✅ shipped: ~18 pages
  - 🟡 stub / renderers TODO: ~14 pages (mostly evolution + classification stage-2 pages)
  - 🔵 thin-loader: 3 pages (popstats, ancestry_per_window, sv_evidence)

---

## Recommended next docs

1. **`shared/band_tracking/README.md`** — 32 source files, zero overview. The pipeline diagram already lives in `index.js`; pull it out + add a section that ties each file back to `specs_done/SPEC_band_track_extraction_and_l3_single_band_rows.md`.
2. **`shared/README.md`** — list every primitive (mgl_*, kmeans, hungarian, contingency, het_rate, per_l2_cluster, clustering, page1_data_helpers) with a one-line purpose. Right now you have to grep to find them.
3. **`SPEC_band_track_extraction_and_l3_single_band_rows.md`** addendum — implementation-status table mapping each SPEC section to the file in `shared/band_tracking/` that now implements it.
4. **`analysis/README.md`** — list every analysis module (`karyotype_assignment`, `window_chain_to_candidates`, `scrubber_main_validator`, `anchor_track_cache`, planned `seeds_to_candidates`) with the JSON-in / out + adapter pattern.

---

https://claude.ai/code/session_01KN8Jkn7aaWJvu53xd3EGnx
