#!/usr/bin/env Rscript
# ============================================================================
# STEP_BP5b_miniprot_dotplots.R
#
# Builds homologous-gene dotplots from miniprot anchor PAFs (one per
# haplotype, produced by STEP_BP1b). For each haplotype pair, finds the
# proteins anchored in BOTH haplotypes and plots their (query_pos,
# target_pos) coordinates — exactly the *T. cristinae* paper Fig 1B
# style, just done with proteins instead of k-mer anchors.
#
# Why this is a separate figure track from STEP_BP5's pair_dotplots:
#   - wfmash dotplots show DNA-alignment density (segmenty, blurry in
#     repeat-rich regions, broken in fast-evolving introns).
#   - miniprot dotplots show GENE order — sharper diagonals, cleanest
#     signal for inversion/translocation visualization.
#
# These are the dotplots Quentin specifically asked for: "By searching
# homologous genes between them, we drew homologous gene dot-plots".
# Reference for that approach is e.g. the Nature Comms catfish paper
# pattern Quentin already cited.
#
# Output:
#   F1  miniprot_dotplots_all.pdf   one panel per pair (max-pairs cap)
#   F2  miniprot_dotplots_focal.pdf zoomed on each chromosome where a
#                                    population candidate lives
#
# Usage:
#   Rscript STEP_BP5b_miniprot_dotplots.R \
#       --anchors-dir results_bpatlas/02b_miniprot_anchors/ \
#       --pairs       results_bpatlas/01_pairs/pairs.tsv \
#       --candidates  results_bpatlas/04_overlap/candidates_with_bp.tsv \
#       --out         results_bpatlas/05b_miniprot_figures/
#
# Dependencies: data.table, ggplot2, optparse
# ============================================================================

suppressPackageStartupMessages({
  library(optparse)
  library(data.table)
  library(ggplot2)
})

opts <- parse_args(OptionParser(option_list = list(
  make_option("--anchors-dir", type = "character", help = "Directory of per-haplotype miniprot PAFs"),
  make_option("--pairs",       type = "character", help = "pairs.tsv from STEP_BP1"),
  make_option("--candidates",  type = "character", default = "",
              help = "OPTIONAL candidates_with_bp.tsv — drives focal panels"),
  make_option("--out",         type = "character", help = "output directory"),
  make_option("--min-identity", type = "double", default = 0.5,
              help = "filter miniprot anchors below this identity [0.5]"),
  make_option("--min-aln-bp",   type = "integer", default = 200L,
              help = "filter anchors below this alignment length in bp [200]"),
  make_option("--max-pairs-on-grid", type = "integer", default = 9L,
              help = "max pairs to put in the dotplot grid [9]")
)))

dir.create(opts$out, recursive = TRUE, showWarnings = FALSE)

# ----------------------------------------------------------------------------
# Parse miniprot PAF. miniprot writes standard PAF where:
#   col 1  query name = PROTEIN ID (from proteome)
#   col 5  strand of protein-to-genome alignment
#   col 6  target name = genome chromosome
#   col 7-9 target lengths/start/end on genome
# We keep one row per (protein_id, target_chrom, target_mid) as the anchor.
# Best-hit-per-protein: keep the row with highest matches.
# ----------------------------------------------------------------------------
read_miniprot <- function(path, min_identity = 0.5, min_aln_bp = 200L) {
  if (!file.exists(path) || file.size(path) == 0L) return(NULL)
  dt <- fread(path, header = FALSE, sep = "\t", fill = TRUE,
              select = 1:12,
              col.names = c("protein_id","plen","pstart","pend","strand",
                            "tname","tlen","tstart","tend",
                            "matches","aln_len","mapq"),
              colClasses = c(protein_id="character", plen="integer",
                             pstart="integer", pend="integer",
                             strand="character", tname="character",
                             tlen="integer", tstart="integer",
                             tend="integer", matches="integer",
                             aln_len="integer", mapq="integer"))
  dt[, identity := matches / pmax(aln_len, 1L)]
  dt <- dt[identity >= min_identity & aln_len >= min_aln_bp]
  if (nrow(dt) == 0L) return(NULL)
  # best hit per protein
  setorder(dt, protein_id, -matches)
  dt <- dt[, .SD[1], by = protein_id]
  dt[, t_mid := (tstart + tend) %/% 2L]
  dt
}

# ----------------------------------------------------------------------------
# Build a paired anchor table by intersecting two haplotypes' miniprot PAFs
# on protein_id.  Returns: protein_id, q_chrom, q_mid, q_strand,
# t_chrom, t_mid, t_strand
# ----------------------------------------------------------------------------
pair_anchors <- function(q_dt, t_dt) {
  if (is.null(q_dt) || is.null(t_dt)) return(NULL)
  m <- merge(
    q_dt[, .(protein_id, q_chrom = tname, q_mid = t_mid, q_strand = strand,
             q_aln = aln_len, q_id = identity)],
    t_dt[, .(protein_id, t_chrom = tname, t_mid = t_mid, t_strand = strand,
             t_aln = aln_len, t_id = identity)],
    by = "protein_id")
  if (nrow(m) == 0L) return(NULL)
  # Effective anchor strand: '+' if both same, '-' if flipped
  m[, anchor_strand := ifelse(q_strand == t_strand, "+", "-")]
  m
}

# ----------------------------------------------------------------------------
# Driver
# ----------------------------------------------------------------------------
pairs <- fread(opts$pairs)
plot_pairs <- pairs[order(query_qc != "A" | target_qc != "A", pair_idx)]
plot_pairs <- head(plot_pairs, opts$`max-pairs-on-grid`)

# Cache miniprot per haplotype (read once, reuse across pairs)
hap_cache <- list()
get_hap <- function(hid) {
  if (!is.null(hap_cache[[hid]])) return(hap_cache[[hid]])
  path <- file.path(opts$`anchors-dir`, paste0(hid, ".paf"))
  d <- read_miniprot(path, opts$`min-identity`, opts$`min-aln-bp`)
  hap_cache[[hid]] <<- d
  d
}

# ----------------------------------------------------------------------------
# F1: per-pair gene-anchor dotplots (genome-wide)
# ----------------------------------------------------------------------------
cat("[STEP_BP5b] F1: miniprot dotplots, genome-wide\n", file = stderr())

dot_list <- list()
for (i in seq_len(nrow(plot_pairs))) {
  pid <- plot_pairs$pair_id[i]
  q <- get_hap(plot_pairs$query_id[i])
  t <- get_hap(plot_pairs$target_id[i])
  m <- pair_anchors(q, t)
  if (is.null(m) || nrow(m) == 0L) next

  # Only show top N query chroms to keep panel readable
  q_top <- m[, .N, by = q_chrom][order(-N)][1:min(.N, 12L), q_chrom]
  m <- m[q_chrom %in% q_top]

  p <- ggplot(m, aes(x = q_mid / 1e6, y = t_mid / 1e6,
                     color = anchor_strand)) +
    geom_point(size = 0.25, alpha = 0.6) +
    scale_color_manual(values = c("+" = "#222222", "-" = "#cc3333")) +
    facet_grid(t_chrom ~ q_chrom, scales = "free", space = "free", switch = "y") +
    labs(title = paste0("Gene-anchor dotplot — ", pid),
         subtitle = sprintf("%d shared proteins; query=%s (%s), target=%s (%s)",
                            nrow(m),
                            plot_pairs$query_id[i], plot_pairs$query_qc[i],
                            plot_pairs$target_id[i], plot_pairs$target_qc[i]),
         x = "Query position (Mb)",
         y = "Target position (Mb)") +
    theme_bw(base_size = 7) +
    theme(strip.text = element_text(size = 5),
          legend.position = "none",
          panel.grid = element_blank(),
          panel.spacing = unit(0.05, "lines"))
  dot_list[[pid]] <- p
}

if (length(dot_list) > 0L) {
  pdf(file.path(opts$out, "miniprot_dotplots_all.pdf"), width = 11, height = 13)
  for (p in dot_list) print(p)
  dev.off()
  cat(sprintf("  wrote miniprot_dotplots_all.pdf (%d panels)\n",
              length(dot_list)), file = stderr())
}

# ----------------------------------------------------------------------------
# F2: focal — zoom on each chromosome that hosts a population candidate
# Each chromosome gets one PDF page per pair, zoomed to the chromosome.
# This is the figure that will go alongside STEP_BP5's candidate_zooms.pdf:
#   wfmash ribbons + miniprot gene anchors = dual confirmation.
# ----------------------------------------------------------------------------
cat("[STEP_BP5b] F2: focal chromosome dotplots\n", file = stderr())

if (nchar(opts$candidates) > 0L && file.exists(opts$candidates)) {
  cands <- fread(opts$candidates, sep = "\t")
  focal_chroms <- unique(cands$chrom)
  cat(sprintf("  %d focal chromosomes (carry population candidates)\n",
              length(focal_chroms)), file = stderr())

  pdf(file.path(opts$out, "miniprot_dotplots_focal.pdf"),
      width = 10, height = 7)
  panels <- 0L

  for (chr in focal_chroms) {
    chr_cands <- cands[chrom == chr]
    for (i in seq_len(nrow(plot_pairs))) {
      pid <- plot_pairs$pair_id[i]
      q <- get_hap(plot_pairs$query_id[i])
      t <- get_hap(plot_pairs$target_id[i])
      m <- pair_anchors(q, t)
      if (is.null(m) || nrow(m) == 0L) next

      m_chr <- m[q_chrom == chr]
      if (nrow(m_chr) < 5L) next

      # Pick the dominant target chrom for this query chrom (highest count)
      tt <- m_chr[, .N, by = t_chrom][order(-N)]
      main_t <- tt$t_chrom[1]
      m_chr_main <- m_chr[t_chrom == main_t]
      m_chr_other <- m_chr[t_chrom != main_t]

      p <- ggplot() +
        # Population candidate strips
        geom_rect(data = chr_cands,
                  aes(xmin = start / 1e6, xmax = end / 1e6,
                      ymin = -Inf, ymax = Inf),
                  fill = "#ff8c42", alpha = 0.15,
                  inherit.aes = FALSE) +
        # Off-target hits in grey behind
        geom_point(data = m_chr_other,
                   aes(x = q_mid / 1e6, y = t_mid / 1e6),
                   color = "#aaaaaa", size = 0.25, alpha = 0.4) +
        # Main-target diagonal in red/black
        geom_point(data = m_chr_main,
                   aes(x = q_mid / 1e6, y = t_mid / 1e6,
                       color = anchor_strand),
                   size = 0.4, alpha = 0.75) +
        scale_color_manual(values = c("+" = "#222222", "-" = "#cc3333"),
                           name = "Anchor strand") +
        labs(title = sprintf("%s — %s", chr, pid),
             subtitle = sprintf("query chrom=%s, dominant target=%s; %d main + %d off-target anchors; orange = population candidate intervals",
                                chr, main_t, nrow(m_chr_main), nrow(m_chr_other)),
             x = sprintf("%s position (Mb) on query (%s)", chr, plot_pairs$query_id[i]),
             y = sprintf("%s position (Mb) on target (%s)", main_t, plot_pairs$target_id[i])) +
        theme_bw(base_size = 9) +
        theme(panel.grid = element_blank(),
              legend.position = "bottom")
      print(p)
      panels <- panels + 1L
    }
  }
  dev.off()
  cat(sprintf("  wrote miniprot_dotplots_focal.pdf (%d panels)\n",
              panels), file = stderr())
} else {
  cat("  no candidates file — skipping focal dotplots\n", file = stderr())
}

cat("[STEP_BP5b] done.\n", file = stderr())
