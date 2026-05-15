#!/usr/bin/env Rscript
###############################################################################
# scan_rare_pairs.R
#
# Discovery scan over the master sidecar to flag genomic windows enriched for
# supported MINOR2/MINOR3 pairs that segregate among a small but coherent
# subset of samples. These are candidates for low-frequency / rare inversions
# or other rare structural haplotypes that biallelic-only PCA misses.
#
# Logic:
#   1) Filter sidecar to rows where:
#        - role_b is MINOR2 or MINOR3                       (multi-allelic extras)
#        - n_samples_with_b is in [min_carriers, max_carriers]
#                                                            (rare but real)
#        - min_pair_allele_count >= min_pair_count           (decent read support)
#        - hwe_pval >= hwe_pval_floor (if requested)        (skip artefacts)
#   2) Group by sliding window along chrom; count rows per window.
#   3) Output windows with ≥ min_pairs_per_window rows.
#
# Use after running mgl10_to_beagle.R; takes only the sidecar as input.
#
# Usage:
#   Rscript scan_rare_pairs.R \
#     --sidecar master.beagle.pairs.tsv \
#     --window_bp 100000 \
#     --min_carriers 4 --max_carriers 30 \
#     --min_pair_count 6 \
#     --min_pairs_per_window 5 \
#     --out rare_pair_windows.tsv
###############################################################################

suppressPackageStartupMessages({
  library(optparse)
  library(data.table)
})

option_list <- list(
  make_option("--sidecar",  type="character", help="master .pairs.tsv from mgl10_to_beagle.R"),
  make_option("--out",      type="character", help="output windows .tsv"),
  make_option("--window_bp", type="integer", default=100000L,
              help="window size in bp [default %default]"),
  make_option("--step_bp",   type="integer", default=0L,
              help="step size in bp (0 = non-overlapping windows = window_bp) [default %default]"),
  make_option("--min_carriers", type="integer", default=4L,
              help="min individuals carrying the rarer allele in pair [default %default]"),
  make_option("--max_carriers", type="integer", default=30L,
              help="max individuals carrying the rarer allele in pair [default %default]"),
  make_option("--min_pair_count", type="integer", default=6L,
              help="min total reads in pair [default %default]"),
  make_option("--min_pairs_per_window", type="integer", default=5L,
              help="window flagged if ≥ this many qualifying pairs [default %default]"),
  make_option("--include_minor1_minor2", type="logical", default=TRUE,
              help="also include MINOR1_MINOR2 / MINOR1_MINOR3 pairs (the cross-extras) [default %default]")
)
opt <- parse_args(OptionParser(option_list=option_list))

for (req in c("sidecar","out")) {
  if (is.null(opt[[req]])) stop("missing --", req, call.=FALSE)
}
if (opt$step_bp <= 0L) opt$step_bp <- opt$window_bp

# ---------------------------------------------------------------------------
# Load and filter
# ---------------------------------------------------------------------------
sc <- fread(opt$sidecar)
n_total <- nrow(sc)
message(sprintf("[scan] sidecar rows: %d", n_total))

# Pairs of interest: anything involving MINOR2 or MINOR3 as the second role
roles_b_keep <- c("MINOR2", "MINOR3")
roles_a_keep <- "MAJOR"
if (isTRUE(opt$include_minor1_minor2)) roles_a_keep <- c("MAJOR", "MINOR1")

sc[, n_minor_carriers := pmin(as.integer(n_samples_with_a),
                               as.integer(n_samples_with_b))]

ok <- (sc$role_b %in% roles_b_keep) &
      (sc$role_a %in% roles_a_keep) &
      (sc$n_minor_carriers >= opt$min_carriers) &
      (sc$n_minor_carriers <= opt$max_carriers) &
      (as.integer(sc$min_pair_allele_count) >= opt$min_pair_count)

qual <- sc[ok]
message(sprintf("[scan] qualifying rare-pair rows: %d (%.2f%%)",
                nrow(qual), 100*nrow(qual)/max(n_total,1)))

if (nrow(qual) == 0L) {
  fwrite(data.table(chrom=character(), window_start=integer(), window_end=integer(),
                    n_qualifying_pairs=integer(),
                    n_unique_sites=integer(),
                    median_carriers=numeric(),
                    median_pair_count=numeric(),
                    example_markers=character()),
         opt$out, sep="\t")
  message(sprintf("[scan] no qualifying pairs; wrote empty %s", opt$out))
  quit(status=0)
}

# ---------------------------------------------------------------------------
# Window scan (sliding)
# ---------------------------------------------------------------------------
qual[, pos := as.integer(pos)]

scan_one_chrom <- function(d) {
  d <- d[order(pos)]
  if (nrow(d) == 0L) return(NULL)
  pos_max <- max(d$pos)
  starts <- seq.int(0L, pos_max, by = opt$step_bp)
  out <- list()
  for (st in starts) {
    en <- st + opt$window_bp
    in_win <- d[pos >= st & pos < en]
    if (nrow(in_win) < opt$min_pairs_per_window) next
    out[[length(out)+1]] <- data.table(
      chrom = d$chrom[1],
      window_start = st,
      window_end   = en,
      n_qualifying_pairs = nrow(in_win),
      n_unique_sites     = uniqueN(in_win$pos),
      median_carriers    = as.numeric(median(in_win$n_minor_carriers)),
      median_pair_count  = as.numeric(median(as.integer(in_win$pair_count))),
      example_markers    = paste(head(in_win$marker, 3), collapse=";")
    )
  }
  if (length(out) == 0L) return(NULL)
  rbindlist(out)
}

windows <- qual[, scan_one_chrom(.SD), by = chrom]
if (is.null(windows) || nrow(windows) == 0L) {
  fwrite(data.table(chrom=character(), window_start=integer(), window_end=integer(),
                    n_qualifying_pairs=integer(),
                    n_unique_sites=integer(),
                    median_carriers=numeric(),
                    median_pair_count=numeric(),
                    example_markers=character()),
         opt$out, sep="\t")
  message(sprintf("[scan] no windows reached threshold; wrote empty %s", opt$out))
  quit(status=0)
}

# Merge overlapping flagged windows per chrom (helps when step_bp < window_bp)
setorder(windows, chrom, window_start)
merged <- windows[, {
  if (.N == 1L) {
    .SD
  } else {
    out <- list()
    cur <- .SD[1]
    for (i in 2:.N) {
      if (.SD$window_start[i] <= cur$window_end) {
        cur$window_end          <- max(cur$window_end, .SD$window_end[i])
        cur$n_qualifying_pairs  <- cur$n_qualifying_pairs + .SD$n_qualifying_pairs[i]
        cur$n_unique_sites      <- cur$n_unique_sites + .SD$n_unique_sites[i]
        cur$median_carriers     <- (cur$median_carriers + .SD$median_carriers[i]) / 2
        cur$median_pair_count   <- (cur$median_pair_count + .SD$median_pair_count[i]) / 2
        cur$example_markers     <- paste(cur$example_markers, .SD$example_markers[i], sep=" | ")
      } else {
        out[[length(out)+1]] <- cur
        cur <- .SD[i]
      }
    }
    out[[length(out)+1]] <- cur
    rbindlist(out)
  }
}, by = chrom]

setorder(merged, -n_qualifying_pairs)
fwrite(merged, opt$out, sep="\t")

message(sprintf("[scan] flagged %d windows in %d chromosomes",
                nrow(merged), uniqueN(merged$chrom)))
message(sprintf("[scan] top window: %s:%d-%d  n_pairs=%d  n_sites=%d  median_carriers=%.1f",
                merged$chrom[1], merged$window_start[1], merged$window_end[1],
                merged$n_qualifying_pairs[1], merged$n_unique_sites[1],
                merged$median_carriers[1]))
message(sprintf("[scan] output: %s", opt$out))
