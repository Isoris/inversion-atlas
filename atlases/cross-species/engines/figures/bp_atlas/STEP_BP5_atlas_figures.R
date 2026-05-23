#!/usr/bin/env Rscript
# ============================================================================
# STEP_BP5_atlas_figures.R
#
# Five paper-quality figures for the haplotype-pair breakpoint atlas.
# Focus is on INVERSIONS and INVERTED TRANSLOCATIONS only — the events
# that actually support the MS_Inversions candidates. Pure
# interchromosomal breakpoints and non-collinear noise are excluded;
# STEP_BP3 already split those into context_breakpoints.tsv.
#
#   F1  pair_dotplots.pdf       one dotplot panel per pair, Fig 1B style
#                               (Genome 2 position vs Genome 1 position)
#   F2  pair_ribbons.pdf        synteny ribbon plot per pair, Fig 2E /
#                               Fig S28 style — chromosome bars connected
#                               by colored bands. Inversions in red,
#                               inverted translocations in dark red.
#   F3  zone_landscape.pdf      genome-wide zone density on the anchor
#                               species with population candidates
#                               underlaid (Fig 6 style)
#   F4  candidate_zooms.pdf     ★ THE PAPER FIGURE ★
#                               One panel per population candidate: zoomed
#                               ribbon view showing what each pair does to
#                               that interval. Pick the best 6–10 for the
#                               main figure; the rest go to supplementary.
#   F5  classification_bars.pdf bar plot of population candidates by
#                               classification + supporting confidence
#
# Usage:
#   Rscript STEP_BP5_atlas_figures.R \
#       --paf-dir   results_bpatlas/02_paf/ \
#       --zones     results_bpatlas/04_overlap/zones_with_pop.tsv \
#       --candidates results_bpatlas/04_overlap/candidates_with_bp.tsv \
#       --pairs     results_bpatlas/01_pairs/pairs.tsv \
#       --out       results_bpatlas/05_figures/
#
# Dependencies: ggplot2, data.table, optparse
# ============================================================================

suppressPackageStartupMessages({
  library(optparse)
  library(data.table)
  library(ggplot2)
})

# ----------------------------------------------------------------------------
opts <- parse_args(OptionParser(option_list = list(
  make_option("--paf-dir",     type = "character", help = "Directory of pairwise PAFs"),
  make_option("--zones",       type = "character", help = "zones_with_pop.tsv from STEP_BP4"),
  make_option("--candidates",  type = "character", help = "candidates_with_bp.tsv from STEP_BP4"),
  make_option("--pairs",       type = "character", help = "pairs.tsv from STEP_BP1"),
  make_option("--out",         type = "character", help = "output directory"),
  make_option("--min-block-bp", type = "integer", default = 50000L,
              help = "filter PAF blocks below this length [50kb]"),
  make_option("--max-pairs-on-grid", type = "integer", default = 9L,
              help = "max pairs to put in the dotplot/ribbon grid [9]"),
  make_option("--zoom-pad-kb",  type = "integer", default = 1000L,
              help = "padding around each candidate for the zoom view [1000kb]")
)))

dir.create(opts$out, recursive = TRUE, showWarnings = FALSE)

# Color palette for ribbon bands. Inversions and inverted translocations
# are the two classes the paper cares about; collinear and pure
# translocations get muted colors so the eye goes to the right place.
BAND_COLS <- c(
  "collinear"               = "#7fb3a8",
  "translocation"           = "#f0a040",
  "inversion"               = "#cc3333",
  "inverted_translocation"  = "#7a1f1f"
)

# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
read_paf <- function(path) {
  if (!file.exists(path) || file.size(path) == 0L) return(NULL)
  fread(path, header = FALSE, sep = "\t", fill = TRUE,
        select = 1:12,
        col.names = c("qname","qlen","qstart","qend","strand",
                      "tname","tlen","tstart","tend",
                      "matches","aln_len","mapq"),
        colClasses = c(qname="character", qlen="integer",
                       qstart="integer", qend="integer",
                       strand="character", tname="character",
                       tlen="integer", tstart="integer",
                       tend="integer", matches="integer",
                       aln_len="integer", mapq="integer"))[
        , span := qend - qstart][]
}

# Build a polygon table for a synteny ribbon. Each band is 4 corners
# linking the query block (top, y=1) to the target block (bottom, y=0).
# Strand-flipped bands have their bottom corners swapped so the polygon
# crosses itself — that visual X is the inversion signal.
make_ribbons <- function(paf, q_chrom, t_chrom = NULL, min_block = 50000L) {
  if (is.null(paf) || nrow(paf) == 0L) return(NULL)
  d <- paf[qname == q_chrom & span >= min_block]
  if (!is.null(t_chrom)) d <- d[tname == t_chrom]
  if (nrow(d) == 0L) return(NULL)

  d[, block_id := .I]
  rbindlist(lapply(seq_len(nrow(d)), function(i) {
    r <- d[i]
    if (r$strand == "+") {
      data.table(block_id = r$block_id,
                 corner = 1:4,
                 x = c(r$qstart, r$qend, r$tend, r$tstart),
                 y = c(1, 1, 0, 0),
                 strand = r$strand,
                 tname = r$tname)
    } else {
      data.table(block_id = r$block_id,
                 corner = 1:4,
                 x = c(r$qstart, r$qend, r$tstart, r$tend),
                 y = c(1, 1, 0, 0),
                 strand = r$strand,
                 tname = r$tname)
    }
  }))
}

# Classify a polygon row into one of the 4 band classes
classify_bands <- function(poly, anchor_chrom) {
  poly[, qchrom_match := (anchor_chrom == tname)]
  poly[, band_class := fcase(
    strand == "+" &  qchrom_match, "collinear",
    strand == "+" & !qchrom_match, "translocation",
    strand == "-" &  qchrom_match, "inversion",
    strand == "-" & !qchrom_match, "inverted_translocation",
    default = "other")]
  poly[, band_class := factor(band_class,
    levels = c("collinear","translocation","inversion","inverted_translocation"))]
  poly
}

# ----------------------------------------------------------------------------
# Pick the pair subset to plot (A/A first, then mixed; cap at max-pairs-on-grid)
# ----------------------------------------------------------------------------
pairs <- fread(opts$pairs)
plot_pairs <- pairs[order(query_qc != "A" | target_qc != "A", pair_idx)]
plot_pairs <- head(plot_pairs, opts$`max-pairs-on-grid`)

# ----------------------------------------------------------------------------
# F1: dotplots
# ----------------------------------------------------------------------------
cat("[STEP_BP5] F1: pair dotplots\n", file = stderr())

dotplot_list <- list()
for (i in seq_len(nrow(plot_pairs))) {
  pid <- plot_pairs$pair_id[i]
  paf <- read_paf(file.path(opts$`paf-dir`, paste0(pid, ".paf")))
  if (is.null(paf) || nrow(paf) == 0L) next
  paf <- paf[span >= opts$`min-block-bp`]
  if (nrow(paf) == 0L) next
  paf[, qmid := (qstart + qend) / 2]
  paf[, tmid := (tstart + tend) / 2]

  p <- ggplot(paf, aes(x = qmid / 1e6, y = tmid / 1e6, color = strand)) +
    geom_point(size = 0.3, alpha = 0.6) +
    scale_color_manual(values = c("+" = "#222222", "-" = "#cc3333")) +
    facet_grid(tname ~ qname, scales = "free", space = "free", switch = "y") +
    labs(title = pid,
         subtitle = sprintf("query=%s (%s) vs target=%s (%s)",
                            plot_pairs$query_id[i], plot_pairs$query_qc[i],
                            plot_pairs$target_id[i], plot_pairs$target_qc[i]),
         x = "Query position (Mb)", y = "Target position (Mb)") +
    theme_bw(base_size = 7) +
    theme(strip.text = element_text(size = 5),
          legend.position = "none",
          panel.grid = element_blank(),
          panel.spacing = unit(0.05, "lines"))
  dotplot_list[[pid]] <- p
}
if (length(dotplot_list) > 0L) {
  pdf(file.path(opts$out, "pair_dotplots.pdf"), width = 10, height = 12)
  for (p in dotplot_list) print(p)
  dev.off()
  cat(sprintf("  wrote pair_dotplots.pdf (%d panels)\n",
              length(dotplot_list)), file = stderr())
}

# ----------------------------------------------------------------------------
# F2: synteny ribbons per pair
# ----------------------------------------------------------------------------
cat("[STEP_BP5] F2: pair synteny ribbons\n", file = stderr())

ribbon_list <- list()
for (i in seq_len(nrow(plot_pairs))) {
  pid <- plot_pairs$pair_id[i]
  paf <- read_paf(file.path(opts$`paf-dir`, paste0(pid, ".paf")))
  if (is.null(paf) || nrow(paf) == 0L) next
  paf <- paf[span >= opts$`min-block-bp`]
  if (nrow(paf) == 0L) next

  # Pick top-N query chroms by total aligned span — keep panel readable
  qchroms_ranked <- paf[, .(span_total = sum(span)), by = qname][
    order(-span_total)][1:min(.N, 12L), qname]
  paf_sub <- paf[qname %in% qchroms_ranked]

  pieces <- lapply(qchroms_ranked, function(qc) {
    poly <- make_ribbons(paf_sub, qc, min_block = opts$`min-block-bp`)
    if (!is.null(poly)) {
      poly[, qchrom := qc]
      classify_bands(poly, anchor_chrom = qc)
    } else NULL
  })
  poly_all <- rbindlist(pieces, fill = TRUE)
  if (nrow(poly_all) == 0L) next

  # Plot ordering: collinear in the back, inversions / inverted translocations on top
  poly_all[, plot_order := as.integer(band_class)]
  poly_all <- poly_all[order(plot_order)]

  p <- ggplot(poly_all,
              aes(x = x / 1e6, y = y, group = block_id, fill = band_class)) +
    geom_polygon(alpha = 0.6, color = NA) +
    scale_fill_manual(values = BAND_COLS, drop = FALSE,
                      name = "Band class",
                      guide = guide_legend(override.aes = list(alpha = 1))) +
    facet_wrap(~ qchrom, scales = "free_x", ncol = 2) +
    scale_y_continuous(breaks = c(0, 1),
                       labels = c(plot_pairs$target_id[i],
                                  plot_pairs$query_id[i]),
                       expand = c(0.05, 0)) +
    labs(title = paste0("Synteny ribbons — ", pid),
         subtitle = sprintf("inversions in red, inverted translocations in dark red"),
         x = "Query position (Mb)", y = "") +
    theme_bw(base_size = 8) +
    theme(panel.grid = element_blank(),
          strip.background = element_rect(fill = "#eaeaea"),
          legend.position = "bottom")
  ribbon_list[[pid]] <- p
}
if (length(ribbon_list) > 0L) {
  pdf(file.path(opts$out, "pair_ribbons.pdf"), width = 11, height = 14)
  for (p in ribbon_list) print(p)
  dev.off()
  cat(sprintf("  wrote pair_ribbons.pdf (%d panels)\n",
              length(ribbon_list)), file = stderr())
}

# ----------------------------------------------------------------------------
# F3: zone landscape
# ----------------------------------------------------------------------------
cat("[STEP_BP5] F3: zone landscape\n", file = stderr())

zones <- fread(opts$zones, sep = "\t")
cands <- fread(opts$candidates, sep = "\t")
if (nrow(zones) > 0L) {
  zones[, conf_factor := factor(confidence,
                                levels = c("high", "medium", "low"))]
  zones[, supp_label := ifelse(overlaps_pop_candidate == "yes",
                               "supports population candidate",
                               "fixed/recent (no pop signal)")]

  p3 <- ggplot() +
    geom_rect(data = cands,
              aes(xmin = start / 1e6, xmax = end / 1e6,
                  ymin = -0.6, ymax = -0.1),
              fill = "#ff8c42", alpha = 0.5) +
    geom_segment(data = zones,
                 aes(x = zone_start / 1e6, xend = zone_end / 1e6,
                     y = 1, yend = 1, color = conf_factor,
                     linewidth = supp_label),
                 lineend = "round") +
    geom_point(data = zones,
               aes(x = zone_centroid / 1e6, y = 1,
                   color = conf_factor, shape = supp_label),
               size = 2) +
    facet_wrap(~ chrom, ncol = 2, scales = "free_x") +
    scale_color_manual(values = c("high" = "#1b5e20",
                                  "medium" = "#fbc02d",
                                  "low" = "#9e9e9e"),
                       name = "Zone confidence") +
    scale_shape_manual(values = c("supports population candidate" = 19,
                                  "fixed/recent (no pop signal)" = 1),
                       name = "Population overlap") +
    scale_linewidth_manual(values = c("supports population candidate" = 1.0,
                                      "fixed/recent (no pop signal)" = 0.4),
                           guide = "none") +
    coord_cartesian(ylim = c(-0.7, 1.5)) +
    labs(title = "Inversion + inverted-translocation zones on the anchor species",
         subtitle = "Orange bars: 226-sample population candidates; dots: minimap2 zones",
         x = "Position (Mb)", y = "") +
    theme_bw(base_size = 9) +
    theme(axis.text.y = element_blank(),
          axis.ticks.y = element_blank(),
          strip.background = element_rect(fill = "#eaeaea"),
          legend.position = "bottom")

  ggsave(file.path(opts$out, "zone_landscape.pdf"),
         p3, width = 11, height = 8.5)
  cat("  wrote zone_landscape.pdf\n", file = stderr())
}

# ----------------------------------------------------------------------------
# F4: per-candidate zoom — THE paper-quality figure
#
# For each candidate with structural support, build a stacked ribbon view
# showing each supporting pair's behavior across the candidate interval ±
# zoom-pad-kb. Population interval shaded; boundaries dashed.
# ----------------------------------------------------------------------------
cat("[STEP_BP5] F4: per-candidate zooms\n", file = stderr())

if (nrow(cands) > 0L && nrow(zones) > 0L) {
  pad <- opts$`zoom-pad-kb` * 1000L
  pdf(file.path(opts$out, "candidate_zooms.pdf"), width = 10, height = 8)
  panels_written <- 0L

  for (ci in seq_len(nrow(cands))) {
    cand <- cands[ci]
    if (cand$classification == "inversion_like_no_bp_support") next

    win_start <- max(0, cand$start - pad)
    win_end   <- cand$end + pad
    chrom <- cand$chrom

    # Find the supporting zones for this candidate, then the pairs that fed them
    sup_ids_raw <- paste(cand$left_zone_ids, cand$right_zone_ids,
                         cand$inner_zone_ids, sep = "; ")
    sup_zone_ids <- unique(unlist(strsplit(sup_ids_raw, "; ", fixed = TRUE)))
    sup_zone_ids <- sup_zone_ids[nchar(sup_zone_ids) > 0L]
    if (length(sup_zone_ids) == 0L) next

    sup_z <- zones[zone_id %in% sup_zone_ids]
    contrib_pairs <- unique(unlist(strsplit(
      paste(sup_z$support_pairs, collapse = "; "), "; ", fixed = TRUE)))
    contrib_pairs <- contrib_pairs[nchar(contrib_pairs) > 0L]
    if (length(contrib_pairs) == 0L) next

    pair_meta <- pairs[pair_id %in% contrib_pairs]
    pair_meta[, qc_combo := paste0(query_qc, target_qc)]
    pair_meta[, kind_rank := fifelse(grepl("^within_", pair_kind), 0L, 1L)]
    pair_meta <- pair_meta[order(kind_rank, qc_combo, pair_id)]

    all_poly <- rbindlist(lapply(seq_len(nrow(pair_meta)), function(j) {
      pm <- pair_meta[j]
      paf <- read_paf(file.path(opts$`paf-dir`, paste0(pm$pair_id, ".paf")))
      if (is.null(paf)) return(NULL)
      sub <- paf[qname == chrom & qend >= win_start & qstart <= win_end &
                 span >= 20000L]
      if (nrow(sub) == 0L) return(NULL)
      poly <- make_ribbons(sub, chrom, min_block = 20000L)
      if (is.null(poly)) return(NULL)
      poly <- classify_bands(poly, anchor_chrom = chrom)
      poly[, pair_id := pm$pair_id]
      poly[, pair_label := paste0(pm$pair_id, " (", pm$qc_combo, ")")]
      poly[, pair_rank := j]
      poly
    }), fill = TRUE)

    if (nrow(all_poly) == 0L) next
    all_poly[, pair_label := factor(pair_label,
       levels = unique(pair_label[order(pair_rank)]))]
    all_poly[, plot_order := as.integer(band_class)]
    all_poly <- all_poly[order(plot_order)]

    p <- ggplot(all_poly, aes(x = x / 1e6, y = y, group = block_id,
                              fill = band_class)) +
      geom_rect(data = data.frame(xmin = cand$start / 1e6,
                                  xmax = cand$end / 1e6),
                aes(xmin = xmin, xmax = xmax, ymin = -0.05, ymax = 1.05),
                inherit.aes = FALSE,
                fill = "#ff8c42", alpha = 0.18) +
      geom_polygon(alpha = 0.6, color = NA) +
      geom_vline(xintercept = c(cand$start, cand$end) / 1e6,
                 color = "#cc4400", linetype = "dashed", linewidth = 0.4) +
      facet_wrap(~ pair_label, ncol = 1, strip.position = "right") +
      scale_fill_manual(values = BAND_COLS, drop = FALSE, name = "Band class") +
      scale_y_continuous(breaks = c(0, 1),
                         labels = c("target", "query"),
                         expand = c(0.05, 0)) +
      coord_cartesian(xlim = c(win_start, win_end) / 1e6) +
      labs(title = paste0("Candidate ", cand$candidate_id,
                          "  —  ", cand$classification,
                          " (best support: ", cand$best_supporting_confidence, ")"),
           subtitle = sprintf("%s:%.2f–%.2f Mb (%.2f Mb wide); %d pairs supporting",
                              chrom, cand$start / 1e6, cand$end / 1e6,
                              cand$width_bp / 1e6, nrow(pair_meta)),
           x = "Position (Mb)", y = "") +
      theme_bw(base_size = 8) +
      theme(panel.grid = element_blank(),
            strip.background = element_rect(fill = "#eaeaea"),
            strip.text.y = element_text(angle = 0, size = 6),
            legend.position = "bottom",
            panel.spacing.y = unit(0.1, "lines"))
    print(p)
    panels_written <- panels_written + 1L
  }
  dev.off()
  cat(sprintf("  wrote candidate_zooms.pdf (%d panels)\n",
              panels_written), file = stderr())
}

# ----------------------------------------------------------------------------
# F5: classification bars
# ----------------------------------------------------------------------------
cat("[STEP_BP5] F5: classification bars\n", file = stderr())
if (nrow(cands) > 0L) {
  cands[, classification := factor(classification,
    levels = c("inversion_candidate",
               "nested_compound_inversion_candidate",
               "inverted_translocation_candidate",
               "inversion_like_with_partial_bp_support",
               "inversion_like_no_bp_support"))]
  cands[, best_supporting_confidence := factor(best_supporting_confidence,
    levels = c("high", "medium", "low"))]

  p5 <- ggplot(cands, aes(x = classification, fill = best_supporting_confidence)) +
    geom_bar(color = "black", linewidth = 0.2) +
    scale_fill_manual(values = c("high" = "#1b5e20",
                                 "medium" = "#fbc02d",
                                 "low" = "#9e9e9e"),
                      name = "Best supporting\nzone confidence",
                      na.value = "#cccccc") +
    coord_flip() +
    labs(title = "Population candidates by structural classification",
         subtitle = sprintf("%d candidates total", nrow(cands)),
         x = "", y = "Number of candidates") +
    theme_bw(base_size = 10)

  ggsave(file.path(opts$out, "classification_bars.pdf"),
         p5, width = 9, height = 5)
  cat("  wrote classification_bars.pdf\n", file = stderr())
}

cat("[STEP_BP5] done.\n", file = stderr())
