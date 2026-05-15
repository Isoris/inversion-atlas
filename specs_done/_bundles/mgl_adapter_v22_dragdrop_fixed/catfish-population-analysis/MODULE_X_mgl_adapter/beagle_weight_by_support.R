#!/usr/bin/env Rscript
###############################################################################
# beagle_weight_by_support.R
#
# Reweight a Beagle (output of beagle_filter_pairs.R or master) by per-row
# support, so that low-support pairs contribute proportionally less to the
# PCA. Reads the corresponding sidecar to find each row's pair_count.
#
#   gl' = (gl - 1/3) * sqrt(w) + 1/3
#
# Then re-normalize to sum = 1 per individual to handle FP drift.
#
# w is the row weight, computed from pair_count (or another support stat)
# according to one of several normalization modes.
#
# DOWNSTREAM USE:
#   - Pass to PCAngsd: this is what the weighter is for.
#   - Do NOT pass to NGSadmix / ngsRelate: the weighted GLs are no longer
#     proper P(reads|genotype) likelihoods; allele-freq estimation from them
#     is biased toward the flat prior for low-support rows.
#
# Modes:
#   max     w = pair_count / max_pair_count_in_input        (every w in (0, 1])
#   median  w = pair_count / median_pair_count_in_input     (typical row w=1)
#   fixed   w = pair_count / fixed_value                    (interpretable: "this many reads = full weight")
#   none    w = 1                                           (passthrough; no weighting)
#
#   --cap_at_one  if true (default), w is capped at 1 in median/fixed modes
#                 so that high-support rows never get *upweighted*; this is
#                 conservative and only ever shrinks low-support rows.
#
#   --weight_stat  which sidecar column to use as support
#                  pair_count             (default; total reads in pair)
#                  min_pair_allele_count  (bottleneck — min of count_a, count_b)
#                  n_samples_with_either  (# inds with ≥1 read in the pair)
#
#   --power     exponent to apply to w before sqrt (default 1.0).
#               sqrt(w^2) = w → linear weighting (variance ∝ w^2)
#               sqrt(w)   = standard PCA precision weighting (variance ∝ w)
#               sqrt(w^0.5) = mild weighting (variance ∝ sqrt(w))
#
# Usage:
#   Rscript beagle_weight_by_support.R \
#     --beagle  filtered.beagle.gz \
#     --sidecar filtered.beagle.pairs.tsv \
#     --mode    max \
#     --weight_stat pair_count \
#     --out     filtered.weighted.beagle.gz
###############################################################################

suppressPackageStartupMessages({
  library(optparse)
  library(data.table)
})

option_list <- list(
  make_option("--beagle",   type="character", help="input Beagle .beagle.gz"),
  make_option("--sidecar",  type="character", help="matching .pairs.tsv sidecar"),
  make_option("--out",      type="character", help="output weighted .beagle.gz"),
  make_option("--mode",     type="character", default="max",
              help="normalization mode: max | median | fixed | none [default %default]"),
  make_option("--fixed_value", type="numeric", default=100.0,
              help="reference count for mode=fixed [default %default]"),
  make_option("--weight_stat", type="character", default="pair_count",
              help="sidecar column to use as support: pair_count | min_pair_allele_count | n_samples_with_either [default %default]"),
  make_option("--power",    type="numeric", default=1.0,
              help="exponent applied to w before sqrt scaling (1=standard precision weighting) [default %default]"),
  make_option("--cap_at_one", type="logical", default=TRUE,
              help="cap w at 1 (no upweighting); conservative [default %default]"),
  make_option("--write_weight_table", type="logical", default=TRUE,
              help="also write .weights.tsv: marker, support, w, sqrt_w_eff [default %default]")
)
opt <- parse_args(OptionParser(option_list=option_list))

for (req in c("beagle","sidecar","out")) {
  if (is.null(opt[[req]])) stop("missing --", req, call.=FALSE)
}
if (!opt$mode %in% c("max","median","fixed","none"))
  stop("unknown --mode: ", opt$mode)
if (!opt$weight_stat %in% c("pair_count","min_pair_allele_count",
                             "n_samples_with_either"))
  stop("unknown --weight_stat: ", opt$weight_stat)

# ---------------------------------------------------------------------------
# Load sidecar; build a marker -> support lookup
# ---------------------------------------------------------------------------
sc <- fread(opt$sidecar)
support_vec <- suppressWarnings(as.numeric(sc[[opt$weight_stat]]))
if (any(is.na(support_vec))) {
  warning(sprintf("[weight] %d / %d rows have NA in '%s'; treating as 0 support",
                  sum(is.na(support_vec)), length(support_vec), opt$weight_stat))
  support_vec[is.na(support_vec)] <- 0
}
support_vec[support_vec < 0] <- 0

# Reference value
ref_val <- switch(opt$mode,
  none    = 1,
  max     = max(support_vec, na.rm=TRUE),
  median  = max(median(support_vec, na.rm=TRUE), 1),
  fixed   = opt$fixed_value
)
if (!is.finite(ref_val) || ref_val <= 0) ref_val <- 1
message(sprintf("[weight] mode=%s  weight_stat=%s  reference=%.3f  power=%.3f  cap=%s",
                opt$mode, opt$weight_stat, ref_val, opt$power, opt$cap_at_one))

if (opt$mode == "none") {
  w_raw <- rep(1.0, nrow(sc))
} else {
  w_raw <- support_vec / ref_val
}
if (opt$power != 1.0) w_raw <- w_raw ^ opt$power
if (isTRUE(opt$cap_at_one)) w_raw <- pmin(w_raw, 1.0)
w_raw[w_raw < 0] <- 0
sqrt_w <- sqrt(w_raw)

# Map marker -> sqrt_w
marker_to_sqrtw <- new.env(hash=TRUE, parent=emptyenv())
for (i in seq_len(nrow(sc))) {
  assign(sc$marker[i], sqrt_w[i], envir=marker_to_sqrtw)
}

# ---------------------------------------------------------------------------
# Stream Beagle, apply per-row weighting
# ---------------------------------------------------------------------------
in_con  <- gzfile(opt$beagle, open="r")
out_con <- gzfile(opt$out,    open="w")

hdr <- readLines(in_con, n=1L)
writeLines(hdr, out_con)

# Determine n_ind from header: 3 + 3 * n_ind columns
hdr_fields <- strsplit(hdr, "\t", fixed=TRUE)[[1]]
n_ind <- (length(hdr_fields) - 3L) %/% 3L
message(sprintf("[weight] beagle has %d individuals (%d GL columns)",
                n_ind, 3L * n_ind))

n_rows <- 0L
n_skipped <- 0L
n_zero_w  <- 0L
THIRD <- 1.0 / 3.0

repeat {
  line <- readLines(in_con, n=1L)
  if (length(line) == 0L) break
  fields <- strsplit(line, "\t", fixed=TRUE)[[1]]
  if (length(fields) < 3L + 3L*n_ind) {
    warning(sprintf("[weight] skipping malformed line: %s", substr(line, 1, 50)))
    n_skipped <- n_skipped + 1L
    next
  }
  marker <- fields[1]
  if (!exists(marker, envir=marker_to_sqrtw, inherits=FALSE)) {
    # Marker not in sidecar — pass through unchanged
    writeLines(line, out_con)
    n_rows <- n_rows + 1L
    next
  }
  sw <- get(marker, envir=marker_to_sqrtw, inherits=FALSE)

  if (sw <= 0) {
    # Zero weight: emit row with all flat GLs (still a valid Beagle row)
    flat <- rep(sprintf("%.6f", THIRD), 3L * n_ind)
    new_line <- paste(c(fields[1:3], flat), collapse="\t")
    writeLines(new_line, out_con)
    n_zero_w <- n_zero_w + 1L
    n_rows <- n_rows + 1L
    next
  }

  # Parse GLs: 3 per ind, interleaved
  gl_fields <- fields[4:length(fields)]
  gls <- as.numeric(gl_fields)
  gl_mat <- matrix(gls, nrow=3L, ncol=n_ind)   # 3 × n_ind, cols = inds

  # Apply: gl' = (gl - 1/3) * sqrt(w) + 1/3
  gl_w <- (gl_mat - THIRD) * sw + THIRD

  # Renormalize per-individual to sum=1 (handles FP drift; flat rows stay flat)
  col_sums <- colSums(gl_w)
  bad <- !is.finite(col_sums) | col_sums <= 1e-12
  if (any(bad)) gl_w[, bad] <- THIRD
  col_sums[bad] <- 1
  gl_w <- sweep(gl_w, 2, col_sums, "/")

  # Clip tiny negatives caused by FP (shouldn't happen but defensive)
  gl_w[gl_w < 0] <- 0

  out_gls <- sprintf("%.6f", as.numeric(gl_w))
  new_line <- paste(c(fields[1:3], out_gls), collapse="\t")
  writeLines(new_line, out_con)
  n_rows <- n_rows + 1L
}

close(in_con); close(out_con)

if (isTRUE(opt$write_weight_table)) {
  wtab_path <- paste0(sub("\\.gz$","",opt$out), ".weights.tsv")
  wtab <- data.table(
    marker      = sc$marker,
    support     = support_vec,
    w           = w_raw,
    sqrt_w_eff  = sqrt_w
  )
  fwrite(wtab, wtab_path, sep="\t")
  message(sprintf("[weight] weight table: %s", wtab_path))
}

message(sprintf("[weight] wrote %d rows (%d skipped, %d emitted as flat due to zero weight)",
                n_rows, n_skipped, n_zero_w))
message(sprintf("[weight] output: %s", opt$out))
message(sprintf("[weight] NOTE: weighted Beagle is for PCA only. Do not use for NGSadmix/ngsRelate."))
